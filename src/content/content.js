// Content script bootstrap.
// Owns: inspector lifecycle, message handling, screenshot capture, modal flow.
//
// Capture order (important for fidelity):
//   1. User picks element(s) → inspector calls onPick.
//   2. Stop inspector + hide bar/highlight/rings.
//   3. Wait one paint frame so the overlays are actually gone.
//   4. captureVisibleTab → crop + draw red border.
//   5. Open modal with screenshots[0] already populated.
//   6. User can recapture, paste, upload, reorder, delete.
(function () {
  const MSG = QA.MSG;

  let activeProfile = null;
  let figmaTree = null;
  let issues = [];

  async function init() {
    activeProfile = await rpc({ type: MSG.PROFILE_GET_ACTIVE });
    issues = await rpc({ type: MSG.ISSUE_LIST }) || [];
    const settings = await rpc({ type: MSG.SETTING_GET });
    applySettings(settings);
    await loadFigmaTreeFor(activeProfile);
    QA.overlay.setCount(issues.length);
  }

  async function loadFigmaTreeFor(profile) {
    if (!profile?.id) { figmaTree = null; return; }
    figmaTree = await rpc({ type: MSG.FIGMA_TREE_GET, payload: profile.id });
  }

  function applySettings(settings) {
    if (!settings) return;
    if (settings.inspectorColor) {
      // Override the bundled default. Children (modal, bar, multi-rings, screenshot)
      // all read --qa-accent live, so this propagates immediately.
      document.documentElement.style.setProperty('--qa-accent', settings.inspectorColor);
      document.documentElement.style.setProperty('--qa-accent-hover', darken(settings.inspectorColor, 0.08));
    }
  }

  // Tiny color darkener — mixes with black by `amt` (0..1).
  function darken(hex, amt) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.round(((n >> 16) & 0xFF) * (1 - amt)));
    const g = Math.max(0, Math.round(((n >> 8) & 0xFF) * (1 - amt)));
    const b = Math.max(0, Math.round((n & 0xFF) * (1 - amt)));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function rpc(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (resp) => resolve(resp));
    });
  }

  function nextPaint() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  async function captureCropped(rects) {
    const r = await rpc({ type: MSG.CAPTURE_VISIBLE });
    if (!r || r.error || !r.dataUrl) {
      console.warn('[QA] capture failed', r?.error);
      return null;
    }
    return await QA.screenshot.cropAndAnnotate(r.dataUrl, rects);
  }

  function makeShot(id, cropped, sourceLabel = 'auto') {
    if (!cropped || !cropped.dataUrl) return null;
    const idx = Date.now() % 100000;
    return {
      filename: `${id}-${sourceLabel}-${idx}.png`,
      relativePath: `screenshots/${id}-${sourceLabel}-${idx}.png`,
      dataUrl: cropped.dataUrl,
      captureViewport: { w: window.innerWidth, h: window.innerHeight },
      crop: cropped.crop || null,
      source: sourceLabel,
      capturedAt: new Date().toISOString()
    };
  }

  async function startInspector() {
    if (!activeProfile) {
      activeProfile = await rpc({ type: MSG.PROFILE_GET_ACTIVE });
    }
    if (!activeProfile) {
      alert('QA Annotator: no active profile. Open Settings → Import a profile.');
      return;
    }
    QA.overlay.show();

    const onPick = async (elements) => {
      // Pause inspector + hide ALL overlays so capture sees only the page.
      QA.inspector.stop();
      QA.overlay.hide();
      await nextPaint();

      try {
        await openIssueForElements(elements);
      } catch (e) {
        console.warn('[QA] pick failed', e);
      }

      // Resume inspector for next pick.
      QA.overlay.show();
      QA.overlay.setPickedCount(0);
      QA.inspector.start({ onPick, onMultiChange: QA.overlay.setPickedCount });
    };

    QA.inspector.start({ onPick, onMultiChange: QA.overlay.setPickedCount });
  }

  function stopInspector() {
    QA.inspector.stop();
    QA.overlay.hide();
    QA.overlay.setPickedCount(0);
  }

  async function openIssueForElements(elements) {
    const adapter = QA.adapterRegistry.get(activeProfile);
    const partial = QA.issueBuilder.buildPartial(elements, {
      profile: activeProfile,
      adapter,
      existingIds: issues.map((i) => i.id),
      figmaTree
    });

    // Auto-capture BEFORE opening modal — overlays are already hidden.
    const rects = (partial.elements || [partial.element]).map((e) => e.rect);
    const initialCrop = await captureCropped(rects);
    const firstShot = makeShot(partial.id, initialCrop, 'auto');
    partial.screenshots = firstShot ? [firstShot] : [];
    // Maintain back-compat alias
    partial.screenshot = partial.screenshots[0] || null;

    const result = await QA.formModal.open(partial, {
      // Recapture: hide modal, capture, restore.
      onRecapture: async (overlayEl) => {
        overlayEl.style.visibility = 'hidden';
        await nextPaint();
        try {
          const cropped = await captureCropped(rects);
          return makeShot(partial.id, cropped, 'auto');
        } finally {
          overlayEl.style.visibility = '';
        }
      },
      // Paste from clipboard image (returns one shot or null).
      onPasteFromClipboard: async () => {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            for (const t of item.types) {
              if (t.startsWith('image/')) {
                const blob = await item.getType(t);
                const dataUrl = await blobToDataUrl(blob);
                return makeShot(partial.id, { dataUrl, crop: null }, 'paste');
              }
            }
          }
        } catch (e) {
          alert('Could not read clipboard. Browser may need permission, or there is no image on the clipboard.\n\nDetails: ' + (e?.message || e));
        }
        return null;
      },
      // Upload file picker.
      onUploadFile: async (file) => {
        if (!file || !file.type.startsWith('image/')) return null;
        const dataUrl = await blobToDataUrl(file);
        return makeShot(partial.id, { dataUrl, crop: null }, 'upload');
      }
    });

    if (result) {
      // Keep singular alias in sync for export back-compat.
      result.screenshot = result.screenshots?.[0] || null;
      await rpc({ type: MSG.ISSUE_SAVE, payload: result });
      issues.push(result);
      QA.overlay.setCount(issues.length);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        switch (message?.type) {
          case MSG.INSPECTOR_TOGGLE: {
            if (QA.inspector.isActive()) stopInspector();
            else await startInspector();
            sendResponse({ active: QA.inspector.isActive() });
            return;
          }
          case MSG.INSPECTOR_STATE: {
            sendResponse({ active: QA.inspector.isActive(), issuesCount: issues.length });
            return;
          }
          case 'qa/profile/active-changed': {
            activeProfile = message.payload || null;
            // Re-load tree to match the newly active profile.
            loadFigmaTreeFor(activeProfile).catch(() => {});
            sendResponse({ ok: true });
            return;
          }
          case MSG.SETTING_CHANGED: {
            applySettings(message.payload);
            sendResponse({ ok: true });
            return;
          }
          default:
            sendResponse({ error: 'unknown message' });
        }
      } catch (e) {
        sendResponse({ error: String(e?.message || e) });
      }
    })();
    return true;
  });

  window.addEventListener('qa:stop-inspect', stopInspector);
  window.addEventListener('qa:commit-multi', () => {
    if (QA.inspector.getPickedCount() > 0) QA.inspector.commitAndPick();
  });

  init().catch((e) => console.warn('[QA] init failed', e));
})();
