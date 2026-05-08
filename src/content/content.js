// Content script bootstrap.
// Owns: inspector lifecycle, message handling, screenshot capture, modal flow.
//
// Capture order (important for fidelity):
//   1. User picks element(s) → inspector calls onPick.
//   2. Stop inspector + hide bar/highlight/rings.
//   3. Wait one paint frame so the overlays are actually gone.
//   4. captureVisibleTab → crop + draw red border.
//   5. Open modal with screenshots[0] already populated.
//   6. User can recapture (re-query selectors, scroll bbox, close modal, draw
//      inspector-style rings, capture, remove rings, reopen modal), paste, etc.
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

  function snapshotLiveLayout(live) {
    return live
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${r.top.toFixed(2)}:${r.left.toFixed(2)}:${r.width.toFixed(2)}:${r.height.toFixed(2)}`;
      })
      .join('|');
  }

  /** Wait until rects stop moving between frames (lazy layout / scroll tail). */
  async function waitLiveLayoutStable(live, maxMs = 450) {
    const t0 = performance.now();
    let prev = snapshotLiveLayout(live);
    while (performance.now() - t0 < maxMs) {
      await new Promise((r) => requestAnimationFrame(r));
      const next = snapshotLiveLayout(live);
      if (next === prev) return;
      prev = next;
    }
  }

  async function captureCropped(rects, annotate = true) {
    const r = await rpc({ type: MSG.CAPTURE_VISIBLE });
    if (!r || r.error || !r.dataUrl) {
      console.warn('[QA] capture failed', r?.error);
      return null;
    }
    return await QA.screenshot.cropAndAnnotate(r.dataUrl, rects, { annotate });
  }

  // Slice cap: 8 viewports = ~6400px tall on a 800px screen, ~12s wall time at
  // 1 capture per ~500ms (Chrome captureVisibleTab quota: ~2/sec/tab).
  const MAX_SLICES = 8;
  const SLICE_DELAY_MS = 550;

  /**
   * Capture every viewport-slice needed to cover docBbox and stitch them.
   * Falls back to single-shot captureCropped when bbox fits the viewport.
   *
   * docRects: [{ x, y, w, h }] in DOCUMENT coords (rect.left + scrollX, etc.)
   */
  async function captureStitchedFromDoc(docRects) {
    if (!docRects || docRects.length === 0) return null;

    let minY = Infinity, maxY = -Infinity;
    for (const r of docRects) {
      minY = Math.min(minY, r.y);
      maxY = Math.max(maxY, r.y + r.h);
    }
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const PADDING = 80;
    const startY = Math.max(0, Math.floor(minY - PADDING));
    const endY   = Math.ceil(maxY + PADDING);
    const bboxH  = endY - startY;

    // Single slice fits — use the existing single-shot path with viewport rects.
    if (bboxH <= vh) {
      const cx = (Math.min(...docRects.map((r) => r.x)) + Math.max(...docRects.map((r) => r.x + r.w))) / 2;
      const cy = (minY + maxY) / 2;
      await scrollAndSettle(Math.max(0, cx - vw / 2), Math.max(0, cy - vh / 2));
      const viewportRects = docRects.map((r) => ({
        x: r.x - window.scrollX,
        y: r.y - window.scrollY,
        w: r.w, h: r.h
      }));
      return await captureCropped(viewportRects, true);
    }

    // Multi-slice path. scroll positions cover [startY .. endY].
    const positions = [];
    let y = startY;
    while (y < endY && positions.length < MAX_SLICES) {
      positions.push(y);
      y += vh;
    }
    if (y < endY) {
      console.warn('[QA] bbox exceeds MAX_SLICES; capturing first', MAX_SLICES, 'viewports only');
    }

    const slices = [];
    for (const sy of positions) {
      await scrollAndSettle(0, sy);
      // captureVisibleTab is throttled (~2 calls/sec/tab). Pace requests so
      // none get rejected with "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND".
      await new Promise((r) => setTimeout(r, SLICE_DELAY_MS));
      const r = await rpc({ type: MSG.CAPTURE_VISIBLE });
      if (!r || r.error || !r.dataUrl) {
        console.warn('[QA] slice capture failed', r?.error);
        return null;
      }
      slices.push({ dataUrl: r.dataUrl, scrollY: window.scrollY });
    }

    return await QA.screenshot.cropAndAnnotateStitched({
      slices,
      docRects,
      viewport: { w: vw, h: vh }
    });
  }

  /**
   * scrollTo(left, top) and wait for the scroll to settle.
   * Listener is registered BEFORE scrollTo so we can't miss a synchronous
   * scrollend (Chrome 114+). If the requested position equals the current one,
   * scrollend never fires — the timeout resolves the promise.
   */
  async function scrollAndSettle(left, top, timeoutMs = 550) {
    const atTarget = Math.abs(window.scrollX - left) < 1 && Math.abs(window.scrollY - top) < 1;
    if (atTarget) { await nextPaint(); return; }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('scrollend', onEnd);
        clearTimeout(tid);
        resolve();
      };
      const onEnd = () => finish();
      const tid = setTimeout(finish, timeoutMs);
      window.addEventListener('scrollend', onEnd, { passive: true, once: true });
      window.scrollTo({ left, top, behavior: 'auto' });
    });
    await nextPaint();
  }

  /** Convert viewport-coord rects (rect.x = rect.left) to document coords. */
  function rectsViewportToDoc(rects) {
    const sx = window.scrollX;
    const sy = window.scrollY;
    return rects.map((r) => ({ x: r.x + sx, y: r.y + sy, w: r.w, h: r.h }));
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

  async function recaptureWithLiveDom(partial, overlayEl) {
    const spec = partial.elements || [partial.element];
    const live = spec.map((e) => {
      if (!e || !e.selector) return null;
      try {
        return document.querySelector(e.selector);
      } catch {
        return null;
      }
    });
    if (live.some((el) => !el)) {
      alert('One or more picked elements are no longer on the page; cannot recapture.');
      return null;
    }

    // Modal CSS uses `display: flex !important`; inline `display:none` loses.
    overlayEl.style.setProperty('display', 'none', 'important');
    overlayEl.style.setProperty('visibility', 'hidden', 'important');
    await nextPaint();
    await waitLiveLayoutStable(live, 400);

    // Document-coord rects: rect.left + scrollX. Stitching path will handle
    // tall bboxes (header + footer) by capturing multiple viewport slices.
    const docRects = live.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left + window.scrollX),
        y: Math.round(r.top  + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    });

    try {
      const cropped = await captureStitchedFromDoc(docRects);
      return makeShot(partial.id, cropped, 'auto');
    } finally {
      overlayEl.style.removeProperty('display');
      overlayEl.style.removeProperty('visibility');
    }
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
    // Convert viewport-coord rects to document coords so stitching can decide
    // whether the bbox needs more than one viewport (e.g. picked header + footer).
    const rects = (partial.elements || [partial.element]).map((e) => e.rect);
    const docRects = rectsViewportToDoc(rects);
    const initialCrop = await captureStitchedFromDoc(docRects);
    const firstShot = makeShot(partial.id, initialCrop, 'auto');
    partial.screenshots = firstShot ? [firstShot] : [];
    // Maintain back-compat alias
    partial.screenshot = partial.screenshots[0] || null;

    const result = await QA.formModal.open(partial, {
      onRecapture: (overlayEl) => recaptureWithLiveDom(partial, overlayEl),
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
