// In-page modal for editing a partial Issue.
// Pure DOM, zero deps. Returns a Promise<Issue|null>.
//
// Image gallery:
// - issue.screenshots is an ordered array. Index 0 is the "primary" image.
// - Thumbnails support drag-reorder (HTML5 drag API), delete, click-to-preview.
// - Three add buttons: Recapture (auto-crop again), Paste (clipboard image),
//   Upload (file picker).
(function () {
  const COMMON_PROPS = [
    'font-size', 'font-weight', 'line-height', 'letter-spacing', 'font-family',
    'color', 'background-color', 'background',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border', 'border-radius', 'border-color', 'border-width', 'border-style',
    'box-shadow', 'opacity',
    'display', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-template-rows',
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'text-align', 'text-decoration', 'text-transform',
    'overflow', 'overflow-x', 'overflow-y',
    'transform', 'transition', 'animation',
    'cursor', 'pointer-events',
    'content', 'visibility'
  ];

  function open(issue, opts = {}) {
    return new Promise((resolve) => {
      // Capture the trigger element so we can restore focus when the modal
      // closes — standard a11y pattern. Without this, screen-reader / keyboard
      // users land back at the document root after Save/Cancel.
      const triggerElement = document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

      const overlay = document.createElement('div');
      overlay.className = 'qa-ext-ui qa-modal-overlay';
      overlay.innerHTML = renderHtml(issue, opts);
      document.documentElement.appendChild(overlay);

      const $$ = (sel) => overlay.querySelectorAll(sel);
      const $  = (sel) => overlay.querySelector(sel);

      // Working state lives here so handlers can mutate it without harvesting on every change.
      let shots = Array.isArray(issue.screenshots) ? [...issue.screenshots] : [];

      // Expected model — shared (All) + per-element overrides. For single-pick,
      // overrides is null and the tabs UI is not rendered.
      const elementsAll = (issue.elements && issue.elements.length > 0)
        ? issue.elements
        : (issue.element ? [issue.element] : []);
      const isMultiPick = elementsAll.length > 1;
      const expectedModel = {
        // Strip figma* fields from shared display rows; the figma input owns those.
        sharedRows: extractRowsFromExpected(issue.expected),
        overrides: isMultiPick
          ? (Array.isArray(issue.expectedPerElement) && issue.expectedPerElement.length === elementsAll.length
              ? issue.expectedPerElement.map((o) => o ? { ...o } : null)
              : elementsAll.map(() => null))
          : null,
        activeTab: 'all'   // 'all' | 0 | 1 | 2 ...
      };

      // Cleanup queue — modules (panels, custom listeners) push their own
      // teardown function so finish() runs them all in order before resolve.
      // We register listener removals via this queue too, to avoid TDZ on
      // const-declared handlers (onPaste / onKey are declared lower in this
      // function; an early finish() call would crash trying to read them).
      const cleanups = [];
      // When finish(result) is called with a non-null result we treat it as a
      // successful Save and clear the draft. null = cancel/dismiss → keep draft
      // so the user can recover next time they open this issue.
      const finish = (result) => {
        for (const fn of cleanups) { try { fn(); } catch {} }
        overlay.remove();
        if (triggerElement) {
          try { triggerElement.focus({ preventScroll: true }); } catch {}
        }
        if (result && issue.id) {
          try { chrome.runtime.sendMessage({ type: QA.MSG.DRAFT_CLEAR, payload: issue.id }); } catch {}
        }
        resolve(result);
      };

      // Focus trap — Tab cycles inside the overlay only. Without this, focus
      // escapes to the host page (which the modal visually covers but doesn't
      // own), confusing keyboard users. Recompute focusables every keystroke
      // because panels mount async and screenshots can be added after open.
      const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const onTrap = (e) => {
        if (e.key !== 'Tab') return;
        const items = Array.from(overlay.querySelectorAll(FOCUSABLE_SEL))
          .filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', onTrap, true);
      cleanups.push(() => document.removeEventListener('keydown', onTrap, true));

      // Required fields gate, settings-driven. Any of: title, severity,
      // expected, screenshot. When the validate fails we DON'T finish — we
      // highlight the offending row so the user knows what's missing. The
      // built-in severity is never empty (always pre-seeded), so a strict
      // 'severity' requirement here mostly catches the 'no severity dropdown'
      // edge case in customized profiles.
      // Read required-field map from the form config (Sprint 3 builder).
      // Each common field can be hidden/optional/required per mode; we only
      // validate fields the user marked 'required' in their config.
      const formCfgForValidate = getFormConfig(opts);
      function isReq(id) { return fieldRequired(formCfgForValidate, id); }
      function validateRequired() {
        const errors = [];
        const titleVal = $('.qa-title')?.value?.trim() || '';
        const severityVal = $('.qa-severity')?.value || '';
        const noteVal = $('.qa-note')?.value?.trim() || '';
        const typeVal = $('.qa-type')?.value || '';
        const hasShots = shots && shots.length > 0;
        const hasExpectedCss = (() => {
          const pane = overlay.querySelector('.qa-expected-pane');
          if (!pane) return false;
          for (const row of pane.querySelectorAll('.qa-expected-row')) {
            const k = row.querySelector('.qa-exp-key')?.value?.trim() || '';
            const v = row.querySelector('.qa-exp-val')?.value?.trim() || '';
            if (k && v) return true;
          }
          return false;
        })();
        const hasFigma = !!($('.qa-figma-link')?.value?.trim());
        if (isReq('title')       && !titleVal)         errors.push({ field: 'title',       sel: '.qa-title' });
        if (isReq('severity')    && !severityVal)      errors.push({ field: 'severity',    sel: '.qa-sev-pill' });
        if (isReq('type')        && !typeVal)          errors.push({ field: 'type',        sel: '.qa-type' });
        if (isReq('note')        && !noteVal)          errors.push({ field: 'note',        sel: '.qa-note' });
        if (isReq('expectedCss') && !hasExpectedCss)   errors.push({ field: 'expected CSS', sel: '.qa-expected-pane' });
        if (isReq('figmaLink')   && !hasFigma)         errors.push({ field: 'Figma link',  sel: '.qa-figma-link' });
        if (isReq('screenshots') && !hasShots)         errors.push({ field: 'screenshots', sel: '.qa-gallery' });
        return errors;
      }
      function showValidationErrors(errors) {
        // Clear previous error styles.
        overlay.querySelectorAll('.qa-required-error').forEach((el) => el.classList.remove('qa-required-error'));
        for (const err of errors) {
          const el = $(err.sel);
          if (el) el.classList.add('qa-required-error');
        }
        const banner = overlay.querySelector('.qa-validation-banner');
        if (banner) {
          banner.textContent = `Missing required: ${errors.map((e) => e.field).join(', ')}`;
          banner.hidden = false;
        }
      }
      function hideValidation() {
        overlay.querySelectorAll('.qa-required-error').forEach((el) => el.classList.remove('qa-required-error'));
        const banner = overlay.querySelector('.qa-validation-banner');
        // Don't wipe the draft-restore prompt — that banner reuses the same
        // element but conveys a different action and shouldn't auto-dismiss
        // on the first keystroke.
        if (banner && !banner.classList.contains('qa-draft-banner')) {
          banner.hidden = true;
          banner.textContent = '';
        }
      }
      // Re-validate on input so the user sees errors clear as they type.
      overlay.addEventListener('input', hideValidation);

      // Severity pill — clicking a segment updates the hidden input + visual
       // active state, then dispatches a 'change' so listeners (e.g. validation
       // re-render) react. Hotkey path also routes through setSeverity so the
       // flash + aria-checked stay in sync.
       function setSeverity(sev, flash) {
         const hidden = $('.qa-severity');
         if (!hidden) return;
         if (hidden.value !== sev) {
           hidden.value = sev;
           hidden.dispatchEvent(new Event('change', { bubbles: true }));
         }
         const pill = overlay.querySelector('.qa-sev-pill');
         if (!pill) return;
         pill.querySelectorAll('.qa-sev-btn').forEach((btn) => {
           const isActive = btn.dataset.sev === sev;
           btn.setAttribute('aria-checked', String(isActive));
           btn.tabIndex = isActive ? 0 : -1;
           btn.classList.toggle('is-active', isActive);
         });
         if (flash) {
           pill.classList.remove('qa-flash');
           // Force reflow so re-adding the class restarts the animation.
           void pill.offsetWidth;
           pill.classList.add('qa-flash');
           setTimeout(() => pill.classList.remove('qa-flash'), 320);
         }
       }
       overlay.querySelectorAll('.qa-sev-btn').forEach((btn) => {
         btn.addEventListener('click', (e) => {
           e.preventDefault();
           setSeverity(btn.dataset.sev, false);
         });
         // Arrow-key nav within the radiogroup — standard a11y pattern.
         btn.addEventListener('keydown', (e) => {
           const sevs = (self.QA?.SEVERITIES || ['critical','major','minor','info']);
           const idx = sevs.indexOf(btn.dataset.sev);
           if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
             e.preventDefault();
             setSeverity(sevs[(idx + 1) % sevs.length], false);
             overlay.querySelector(`.qa-sev-btn[data-sev="${sevs[(idx + 1) % sevs.length]}"]`)?.focus();
           } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
             e.preventDefault();
             const prev = (idx - 1 + sevs.length) % sevs.length;
             setSeverity(sevs[prev], false);
             overlay.querySelector(`.qa-sev-btn[data-sev="${sevs[prev]}"]`)?.focus();
           }
         });
       });
       // Make setSeverity reachable from the keydown closure declared above.
       // (It's a function declaration so hoisting works, but exposing on the
       // overlay isn't necessary — keep it local.)

       $$('.qa-cancel').forEach((btn) => btn.addEventListener('click', () => finish(null)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      $('.qa-save').addEventListener('click', () => {
        harvestActivePane(overlay, expectedModel);
        const errors = validateRequired();
        if (errors.length > 0) {
          showValidationErrors(errors);
          const first = $(errors[0].sel);
          // Pill is a div (not focusable) — focus its first button instead.
          const focusable = first?.classList?.contains('qa-sev-pill')
            ? first.querySelector('.qa-sev-btn')
            : first;
          if (focusable && focusable.focus) focusable.focus();
          return;
        }
        finish(harvest(overlay, issue, shots, expectedModel, opts));
      });

      // Computed tabs (only present when multi-pick + values differ)
      const elementsForTabs = issue.elements && issue.elements.length > 1 ? issue.elements : [issue.element];
      bindComputedTabs(overlay, issue, elementsForTabs);

      // Severity hotkeys — settings-configurable. Default 1=critical, 2=major,
      // 3=minor, 4=info. Don't fire when typing into inputs/textareas.
      const sevHotkeys = opts?.settings?.defaults?.severityHotkeys || { 1: 'critical', 2: 'major', 3: 'minor', 4: 'info' };
      const onKey = (e) => {
        if (e.key === 'Escape') { finish(null); return; }
        // Skip if user is currently typing in any input/textarea/select. Check
        // both e.target AND document.activeElement so synthetic events don't
        // bypass the guard. ContentEditable check covers rich text widgets.
        const tgt = e.target;
        const active = document.activeElement;
        const inField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (inField(tgt) || inField(active)) return;
        const mapped = sevHotkeys[e.key];
        if (mapped) {
          setSeverity(mapped, /*flash*/ true);
        }
      };
      document.addEventListener('keydown', onKey, true);
      cleanups.push(() => document.removeEventListener('keydown', onKey, true));

      // Property combo — only present when Expected CSS rows are rendered
      // (mode === 'design-fidelity' / 'custom' OR re-edit with saved data).
      // Other modes drop these elements entirely; null-guard so we don't
      // crash on first pick after switching to a non-design mode.
      const propDatalist = $('.qa-prop-datalist');
      if (propDatalist) {
        propDatalist.innerHTML = COMMON_PROPS.map((p) => `<option value="${p}"></option>`).join('');
      }

      // Expected tabs (multi-pick only) + initial pane render. Both functions
      // already query for elements that may not exist; double-check the pane
      // before driving the binding so they no-op cleanly on non-design modes.
      if (overlay.querySelector('.qa-expected-pane')) {
        bindExpectedTabs(overlay, issue, elementsAll, expectedModel);
        renderExpectedPane(overlay, issue, elementsAll, expectedModel);
      }

      // Re-render the pin-notes panel body when shots change. The panel
      // module reads issue.screenshots at render time, so we sync the local
      // shots[] back onto the issue object first, then re-run the panel's
      // render. Other panels are stateful via their own DOM bindings — we
      // only need to refresh pin-notes specifically because new pins on a
      // newly added shot must appear without closing the modal.
      function refreshPinNotesPanel() {
        issue.screenshots = shots.slice();
        issue.screenshot = shots[0] || null;
        let panelEl = overlay.querySelector('.qa-panel[data-panel-id="pin-notes"]');
        const pinPanel = self.QA?.panels?.['pin-notes'];
        // Count pins so we know whether the panel SHOULD exist now.
        let pinTotalForCheck = 0;
        for (const s of shots) for (const l of (s?.annotations?.layers || [])) if (l.type === 'pin') pinTotalForCheck++;

        // Lazy-mount: panel-registry skipped pin-notes during initial render
        // because isAvailable() returned false (no pins yet). Once the user
        // adds an annotated screenshot, inject the panel into the DOM so the
        // notes UI appears without re-opening the modal.
        if (!panelEl && pinTotalForCheck > 0 && pinPanel?.render) {
          const panelsHost = overlay.querySelector('[data-qa-section="panels"]');
          if (panelsHost) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
              <section class="qa-panel" data-panel-id="pin-notes">
                <header class="qa-panel-head">
                  <h3 class="qa-panel-title">${pinPanel.title || 'Pin notes'}</h3>
                  <button type="button" class="qa-panel-toggle" aria-label="Toggle panel">▾</button>
                </header>
                <div class="qa-panel-body"></div>
              </section>
            `;
            panelEl = wrapper.firstElementChild;
            panelsHost.appendChild(panelEl);
            // Wire the collapse toggle the same way panel-registry would.
            const head = panelEl.querySelector('.qa-panel-head');
            const toggleBtn = panelEl.querySelector('.qa-panel-toggle');
            head.addEventListener('click', () => {
              const isCollapsed = panelEl.dataset.collapsed === '1';
              if (isCollapsed) { delete panelEl.dataset.collapsed; if (toggleBtn) toggleBtn.textContent = '▾'; }
              else { panelEl.dataset.collapsed = '1'; if (toggleBtn) toggleBtn.textContent = '▸'; }
            });
            // Run the panel's mount() for textarea input forwarding.
            if (typeof pinPanel.mount === 'function') {
              try {
                const cleanup = pinPanel.mount(panelEl.querySelector('.qa-panel-body'), issue, () => {});
                if (typeof cleanup === 'function') cleanups.push(cleanup);
              } catch (e) { console.warn('[QA] pin-notes lazy mount failed', e); }
            }
          }
        }
        if (panelEl && pinPanel?.render) {
          const body = panelEl.querySelector('.qa-panel-body');
          if (body) body.innerHTML = pinPanel.render(issue) || '';
        }
        // Header pin chip — count pins across all shots and update or remove.
        let pinTotal = 0;
        for (const s of shots) for (const l of (s?.annotations?.layers || [])) if (l.type === 'pin') pinTotal++;
        let chip = overlay.querySelector('.qa-pin-chip');
        if (pinTotal > 0) {
          if (!chip) {
            // Insert before viewport chip if missing.
            const idBadge = overlay.querySelector('.qa-id-badge');
            const next = idBadge?.nextElementSibling;
            chip = document.createElement('span');
            chip.className = 'qa-pin-chip';
            idBadge?.parentElement?.insertBefore(chip, next);
          }
          chip.textContent = `📍 ${pinTotal}`;
          chip.title = `${pinTotal} numbered pin${pinTotal === 1 ? '' : 's'} across ${shots.length} screenshot${shots.length === 1 ? '' : 's'}`;
        } else if (chip) {
          chip.remove();
        }
      }

      // Image gallery
      const renderGallery = () => {
        const gal = $('.qa-gallery');
        gal.innerHTML = '';
        // Always sync local shots[] back onto issue + refresh pin-notes panel
        // so newly added screenshots' pins show up in the panel immediately.
        refreshPinNotesPanel();
        if (shots.length === 0) {
          gal.innerHTML = '<div class="qa-gallery-empty">No images yet. Use the buttons below to add one.</div>';
          return;
        }
        shots.forEach((shot, i) => {
          const item = document.createElement('div');
          item.className = 'qa-thumb';
          item.draggable = true;
          item.dataset.idx = String(i);
          const layers = shot.annotations?.layers || [];
          const pinsHere = layers.filter((l) => l.type === 'pin').length;
          const otherAnnots = layers.length - pinsHere;
          // Build per-thumbnail badges: pin count (📍 N) and other-shape count.
          const pinBadge = pinsHere > 0
            ? `<span class="qa-thumb-pin-badge" title="${pinsHere} numbered pin${pinsHere === 1 ? '' : 's'}">📍${pinsHere}</span>`
            : '';
          const annotBadge = otherAnnots > 0
            ? `<span class="qa-thumb-annot-badge" title="${otherAnnots} other annotation${otherAnnots === 1 ? '' : 's'} (rect / arrow / text / blur)">✦${otherAnnots}</span>`
            : '';
          item.innerHTML = `
            <span class="qa-thumb-handle" title="Drag to reorder">⠿</span>
            <span class="qa-thumb-num">${i + 1}</span>
            ${pinBadge}${annotBadge}
            <img src="${shot.dataUrl}" alt="" />
            <span class="qa-thumb-meta">${escape(shot.source || '')}</span>
            <button class="qa-thumb-annotate" type="button" title="Annotate (pin / arrow / blur / text)">✎</button>
            <button class="qa-thumb-del" type="button" title="Remove">×</button>
          `;
          item.querySelector('.qa-thumb-del').addEventListener('click', (e) => {
            e.stopPropagation();
            shots.splice(i, 1);
            renderGallery();
          });
          item.querySelector('.qa-thumb-annotate').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!QA.annotationEditor) { alert('Annotation editor not loaded'); return; }
            // Hide modal so editor takes over the screen, restore after.
            overlay.style.setProperty('display', 'none', 'important');
            try {
              const annotated = await QA.annotationEditor.open({
                dataUrl: shot.dataUrl,
                annotations: shot.annotations,
                settings: opts.settings || null,
                severity: issue.severity
              });
              if (annotated) {
                shots[i] = { ...shot, dataUrl: annotated.dataUrl, annotations: annotated.annotations };
                renderGallery();
              }
            } finally {
              overlay.style.removeProperty('display');
            }
          });
          item.querySelector('img').addEventListener('click', () => {
            // Open in new tab as data URL preview
            const w = window.open('about:blank', '_blank');
            if (w) w.document.write(`<img src="${shot.dataUrl}" style="max-width:100%"/>`);
          });
          // Drag reorder
          item.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
            item.classList.add('qa-dragging');
          });
          item.addEventListener('dragend', () => item.classList.remove('qa-dragging'));
          item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('qa-drag-over'); });
          item.addEventListener('dragleave', () => item.classList.remove('qa-drag-over'));
          item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('qa-drag-over');
            const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const to = i;
            if (Number.isFinite(from) && from !== to) {
              const [moved] = shots.splice(from, 1);
              shots.splice(to, 0, moved);
              renderGallery();
            }
          });
          gal.appendChild(item);
        });
      };

      // Recapture — only present when not disabled (e.g. settings page has no
      // source DOM element to re-capture against).
      const recaptureBtn = $('.qa-recapture');
      if (recaptureBtn) {
        recaptureBtn.addEventListener('click', async () => {
          const orig = recaptureBtn.textContent;
          recaptureBtn.textContent = 'Capturing…';
          recaptureBtn.disabled = true;
          try {
            const shot = await opts.onRecapture?.(overlay);
            if (shot) { shots.push(shot); renderGallery(); }
          } finally {
            recaptureBtn.textContent = orig;
            recaptureBtn.disabled = false;
          }
        });
      }

      // New screenshot — manual region drag + annotate.
      const newShotBtn = $('.qa-new-shot');
      if (newShotBtn) {
        newShotBtn.addEventListener('click', async () => {
          if (!opts.onNewScreenshot) return;
          const orig = newShotBtn.textContent;
          newShotBtn.textContent = 'Selecting…';
          newShotBtn.disabled = true;
          try {
            const shot = await opts.onNewScreenshot(overlay);
            if (shot) { shots.push(shot); renderGallery(); }
          } finally {
            newShotBtn.textContent = orig;
            newShotBtn.disabled = false;
          }
        });
      }

      // Paste from clipboard (button)
      $('.qa-paste').addEventListener('click', async () => {
        const shot = await opts.onPasteFromClipboard?.();
        if (shot) { shots.push(shot); renderGallery(); }
      });
      // Paste anywhere in modal (Ctrl/Cmd+V)
      const onPaste = async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const it of items) {
          if (it.type && it.type.startsWith('image/')) {
            e.preventDefault();
            const blob = it.getAsFile();
            if (!blob) continue;
            const dataUrl = await blobToDataUrl(blob);
            shots.push({
              filename: `${issue.id}-paste-${Date.now() % 100000}.png`,
              relativePath: `screenshots/${issue.id}-paste-${Date.now() % 100000}.png`,
              dataUrl,
              source: 'paste',
              capturedAt: new Date().toISOString()
            });
            renderGallery();
            return;
          }
        }
      };
      overlay.addEventListener('paste', onPaste);
      cleanups.push(() => overlay.removeEventListener('paste', onPaste));

      // Upload
      $('.qa-upload-input').addEventListener('change', async (e) => {
        const files = [...(e.target.files || [])];
        for (const f of files) {
          const shot = await opts.onUploadFile?.(f);
          if (shot) shots.push(shot);
        }
        e.target.value = '';
        renderGallery();
      });
      $('.qa-upload').addEventListener('click', () => $('.qa-upload-input').click());

      renderGallery();

      // ── Draft auto-save ──────────────────────────────────────────────
      // Snapshot the modal's editable state (title/severity/type/note/figma
      // /expected/panels) on every input/change, debounced 300ms. Screenshots
      // are NOT included — they're large base64 blobs and the modal already
      // mutates `shots[]` in place, so a restore would just re-render the
      // gallery from issue.screenshots untouched.
      function snapshotDraftState() {
        const snap = {};
        snap.title = $('.qa-title')?.value ?? '';
        snap.severity = $('.qa-severity')?.value ?? '';
        snap.type = $('.qa-type')?.value ?? '';
        snap.note = $('.qa-note')?.value ?? '';
        snap.figmaLink = $('.qa-figma-link')?.value ?? '';
        // Expected CSS rows
        const pane = $('.qa-expected-pane');
        if (pane) {
          snap.expectedRows = Array.from(pane.querySelectorAll('.qa-expected-row')).map((r) => ({
            k: r.querySelector('.qa-exp-key')?.value || '',
            v: r.querySelector('.qa-exp-val')?.value || ''
          })).filter((r) => r.k || r.v);
        }
        return snap;
      }
      function applyDraftState(snap) {
        if (!snap) return;
        if (snap.title != null && $('.qa-title')) $('.qa-title').value = snap.title;
        if (snap.type != null && $('.qa-type')) $('.qa-type').value = snap.type;
        if (snap.note != null && $('.qa-note')) $('.qa-note').value = snap.note;
        if (snap.figmaLink != null && $('.qa-figma-link')) $('.qa-figma-link').value = snap.figmaLink;
        if (snap.severity && typeof setSeverity === 'function') setSeverity(snap.severity, false);
        // Expected rows: leave the existing pane render alone if the draft
        // has no rows; otherwise rebuild via the pane's input setters.
        if (Array.isArray(snap.expectedRows) && snap.expectedRows.length) {
          const pane = $('.qa-expected-pane');
          const existing = pane?.querySelectorAll('.qa-expected-row') || [];
          // Best-effort: overwrite as many rows as we have inputs for; users
          // can use "+ Add property" to grow if the draft had more.
          snap.expectedRows.forEach((row, i) => {
            const target = existing[i];
            if (target) {
              const k = target.querySelector('.qa-exp-key');
              const v = target.querySelector('.qa-exp-val');
              if (k) k.value = row.k;
              if (v) v.value = row.v;
            }
          });
        }
      }
      let draftTimer = null;
      const saveDraft = () => {
        if (!issue.id) return;
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
          try {
            chrome.runtime.sendMessage({
              type: QA.MSG.DRAFT_SAVE,
              payload: { issueId: issue.id, snapshot: snapshotDraftState() }
            });
          } catch {}
        }, 300);
      };
      overlay.addEventListener('input', saveDraft);
      overlay.addEventListener('change', saveDraft);
      cleanups.push(() => clearTimeout(draftTimer));

      // Restore prompt — fetch any existing draft for this issue id; if it's
      // newer than 5s and differs from the current state, show a non-blocking
      // banner asking the user to Restore or Discard. Don't auto-apply: the
      // current modal state may carry fresh data (e.g. just-picked element)
      // that would be silently overwritten.
      if (issue.id) {
        try {
          chrome.runtime.sendMessage({ type: QA.MSG.DRAFT_GET, payload: issue.id }, (draft) => {
            if (!draft || !draft.snapshot) return;
            const ageMs = Date.now() - (draft.savedAt || 0);
            if (ageMs < 5000) return;  // fresh — probably same session, ignore
            const banner = overlay.querySelector('.qa-validation-banner');
            if (!banner) return;
            const ageMin = Math.max(1, Math.round(ageMs / 60000));
            banner.innerHTML = `Restore draft from ~${ageMin} min ago? <button type="button" class="qa-link-btn qa-draft-restore">Restore</button> · <button type="button" class="qa-link-btn qa-draft-discard">Discard</button>`;
            banner.hidden = false;
            banner.classList.add('qa-draft-banner');
            banner.querySelector('.qa-draft-restore')?.addEventListener('click', () => {
              applyDraftState(draft.snapshot);
              banner.hidden = true;
              banner.classList.remove('qa-draft-banner');
            });
            banner.querySelector('.qa-draft-discard')?.addEventListener('click', () => {
              try { chrome.runtime.sendMessage({ type: QA.MSG.DRAFT_CLEAR, payload: issue.id }); } catch {}
              banner.hidden = true;
              banner.classList.remove('qa-draft-banner');
            });
          });
        } catch {}
      }

      // Mount mode-aware panels. Registry is optional — modal still renders
      // without it (the inline fallback in renderPanelsBlock fires).
      if (self.QA?.panelRegistry?.mountAll) {
        const panelsCleanup = self.QA.panelRegistry.mountAll(overlay, issue, opts?.settings || {}, () => { /* onChange — future use */ });
        if (typeof panelsCleanup === 'function') cleanups.push(panelsCleanup);
      }

      setTimeout(() => {
        const titleInput = $('.qa-title');
        if (titleInput) { titleInput.focus(); return; }
        // Title hidden by form config — focus first focusable so a keyboard
        // user lands inside the modal, not on the host page underneath.
        const firstFocusable = overlay.querySelector(FOCUSABLE_SEL);
        if (firstFocusable) firstFocusable.focus();
      }, 0);

      // Build the right-rail TOC. Panels mount async so wait one frame after
      // open before querying [data-qa-section]. Each entry is a dot + label;
      // hovering the strip expands the labels. Active section tracks via
      // IntersectionObserver — whichever section overlaps the top third of
      // the body wins the "active" highlight.
      const SECTION_LABELS = {
        title: 'Title',
        severity: 'Severity / Type',
        element: 'Element',
        computed: 'Computed',
        expected: 'Expected CSS',
        figma: 'Figma',
        note: 'Note',
        panels: 'Panels',
        screenshots: 'Screenshots'
      };
      requestAnimationFrame(() => {
        const toc = overlay.querySelector('.qa-modal-toc');
        const body = overlay.querySelector('.qa-modal-body');
        if (!toc || !body) return;
        const sections = Array.from(body.querySelectorAll('[data-qa-section]'))
          .filter((s) => {
            // Skip empty wrappers (panels block can be empty in some modes).
            if (s.dataset.qaSection === 'panels' && !s.children.length) return false;
            return true;
          });
        if (sections.length < 3) return;  // Not worth showing TOC for 1-2 sections.
        toc.innerHTML = sections.map((s) => {
          const id = s.dataset.qaSection;
          return `<button type="button" class="qa-toc-item" data-target="${id}" title="${SECTION_LABELS[id] || id}">
            <span class="qa-toc-dot"></span>
            <span class="qa-toc-label">${SECTION_LABELS[id] || id}</span>
          </button>`;
        }).join('');
        toc.addEventListener('click', (e) => {
          const btn = e.target.closest('.qa-toc-item');
          if (!btn) return;
          const target = body.querySelector(`[data-qa-section="${btn.dataset.target}"]`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        const items = new Map(
          Array.from(toc.querySelectorAll('.qa-toc-item')).map((b) => [b.dataset.target, b])
        );
        const io = new IntersectionObserver((entries) => {
          // Pick the topmost-visible section; mark its TOC item active.
          const visible = entries.filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible.length === 0) return;
          const id = visible[0].target.dataset.qaSection;
          for (const [, b] of items) b.classList.remove('is-active');
          items.get(id)?.classList.add('is-active');
        }, { root: body, rootMargin: '0px 0px -60% 0px', threshold: 0 });
        for (const s of sections) io.observe(s);
        cleanups.push(() => io.disconnect());
      });
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function getActualMap(issue) {
    const out = {};
    for (const [k, v] of Object.entries(issue.actual || {})) {
      out[camelToKebab(k)] = v;
    }
    return out;
  }
  function camelToKebab(s) { return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }

  function addExpectedRow(listEl, key = '', val = '', actuals = {}) {
    const row = document.createElement('div');
    row.className = 'qa-expected-row';
    const placeholder = key && actuals[key] ? `actual: ${actuals[key]}` : 'value (e.g. 48px)';
    row.innerHTML = `
      <input class="qa-exp-key" list="qa-prop-options" placeholder="property" value="${escape(key)}" />
      <input class="qa-exp-val" placeholder="${escape(placeholder)}" value="${escape(val)}" />
      <button class="qa-row-remove" type="button" title="Remove" aria-label="Remove">×</button>
    `;
    row.querySelector('.qa-exp-key').addEventListener('change', (e) => {
      const k = e.target.value.trim();
      const valInput = row.querySelector('.qa-exp-val');
      valInput.placeholder = k && actuals[k] ? `actual: ${actuals[k]}` : 'value (e.g. 48px)';
    });
    listEl.appendChild(row);
  }

  function harvest(root, issue, shots, expectedModel, opts) {
    const $ = (sel) => root.querySelector(sel);
    const get = (sel) => $(sel)?.value ?? '';
    const out = { ...issue };
    out.title    = get('.qa-title');
    out.severity = get('.qa-severity');
    out.type     = get('.qa-type');
    out.note     = get('.qa-note');
    // tags array is preserved as-is from issue (set at build by auto-tag rules);
    // future: a chip-input UI in the modal will let users add/remove tags here.
    if (!Array.isArray(out.tags)) out.tags = [];

    // Harvest panel data (mode-aware). Existing panels (e.g. inherited from a
    // saved issue from a different mode) are preserved — registry only writes
    // back panels visible in the current mode.
    if (self.QA?.panelRegistry?.harvestAll) {
      try {
        out.panels = self.QA.panelRegistry.harvestAll(root, issue, opts?.settings || {});
      } catch (e) {
        console.warn('[QA] panel harvest failed', e);
      }
    }

    // Build shared expected from model.sharedRows + figma fields.
    // When the corresponding form field is HIDDEN, harvest can't read DOM
    // (the input doesn't exist). Preserve whatever was already on the issue
    // so a Hidden field doesn't silently nuke saved data.
    const formCfgForHarvest = getFormConfig(opts);
    const expected = {};
    if (fieldVisible(formCfgForHarvest, 'expectedCss')) {
      for (const { key, value } of expectedModel.sharedRows) {
        const k = (key || '').trim();
        const v = (value || '').trim();
        if (k && v) expected[k] = v;
      }
    } else {
      // Field hidden — keep original non-figma keys verbatim.
      for (const [k, v] of Object.entries(issue.expected || {})) {
        if (!k.startsWith('figma') && v) expected[k] = v;
      }
    }
    if (fieldVisible(formCfgForHarvest, 'figmaLink')) {
      const figmaLink = get('.qa-figma-link')?.value?.trim() || '';
      if (figmaLink) {
        expected.figmaLink = figmaLink;
        // Carry through auto-match metadata only when the link is unchanged.
        if (issue.expected?.figmaLink === figmaLink) {
          if (issue.expected.figmaNodeId)      expected.figmaNodeId      = issue.expected.figmaNodeId;
          if (issue.expected.figmaBreadcrumb)  expected.figmaBreadcrumb  = issue.expected.figmaBreadcrumb;
          if (issue.expected.figmaScore != null) expected.figmaScore     = issue.expected.figmaScore;
          if (issue.expected.figmaViewport)    expected.figmaViewport    = issue.expected.figmaViewport;
          if (issue.expected.figmaAutoMatched) expected.figmaAutoMatched = true;
        }
      }
    } else {
      // Figma field hidden — preserve all figma* keys verbatim.
      for (const [k, v] of Object.entries(issue.expected || {})) {
        if (k.startsWith('figma') && v != null) expected[k] = v;
      }
    }
    out.expected = expected;

    // Per-element overrides (multi-pick only). Strip figma* keys, drop empty
    // entries down to null so the array stays sparse and exporters can skip.
    if (Array.isArray(expectedModel.overrides)) {
      out.expectedPerElement = expectedModel.overrides.map((entry) => {
        if (!entry) return null;
        const clean = {};
        for (const [k, v] of Object.entries(entry)) {
          if (!k || !v) continue;
          if (k.startsWith('figma')) continue;       // figma fields are shared-only
          clean[k] = v;
        }
        return Object.keys(clean).length === 0 ? null : clean;
      });
    } else {
      delete out.expectedPerElement;
    }

    out.screenshots = shots;
    out.screenshot = shots[0] || null; // back-compat alias for export
    out.updatedAt = new Date().toISOString();
    return out;
  }

  // Convert issue.expected into [{key, value}] rows for the shared (All) pane,
  // dropping figma* keys (those are owned by the figma-link input).
  function extractRowsFromExpected(expected) {
    const rows = [];
    if (expected && typeof expected === 'object') {
      for (const [k, v] of Object.entries(expected)) {
        if (k.startsWith('figma')) continue;
        rows.push({ key: k, value: String(v ?? '') });
      }
    }
    if (rows.length === 0) {
      // Sensible defaults when the issue has no expected yet (matches old UX).
      rows.push({ key: 'font-size', value: '' });
      rows.push({ key: 'font-weight', value: '' });
    }
    return rows;
  }

  // Mode-aware visibility for the legacy "Expected CSS rows" + "Figma link"
  // common-form fields. They're meaningful only when comparing against a
  // design spec — every other mode hides them to reduce friction. We still
  // keep them visible in `custom` mode (no mode set / user picks all) and
  // when the issue already has expected/figma data (re-edit must show what's
  // there so the user can clear it).
  // Read the user-configurable form config for this mode (Sprint 3 form
  // builder). Falls back to optional state when form-config module not loaded.
  function getFormConfig(opts) {
    const settings = opts?.settings || {};
    const mode = settings.mode || 'custom';
    const fc = self.QA?.formConfig;
    if (fc?.getEffectiveFormConfig) {
      return { mode, config: fc.getEffectiveFormConfig(mode, settings) };
    }
    return { mode, config: null };
  }
  function fieldState(formCfg, fieldId) {
    if (!formCfg?.config) return 'optional';
    return formCfg.config.fields?.[fieldId] || 'optional';
  }
  function fieldVisible(formCfg, fieldId) {
    return fieldState(formCfg, fieldId) !== 'hidden';
  }
  function fieldRequired(formCfg, fieldId) {
    return fieldState(formCfg, fieldId) === 'required';
  }

  // Strict mode-config visibility — Hidden in the form builder ALWAYS hides
  // the field, even when the issue has saved data (the data persists in
  // issue.expected so it isn't lost; user just can't see it without flipping
  // back to Optional/Required). Earlier versions force-showed the field on
  // existing data, which contradicted the user's explicit Hidden choice.
  function shouldShowExpectedCss(formCfg, _issue) {
    return fieldVisible(formCfg, 'expectedCss');
  }
  function shouldShowFigmaField(formCfg, _issue) {
    return fieldVisible(formCfg, 'figmaLink');
  }

  function renderHtml(issue, opts = {}) {
    const sevs   = (self.QA?.SEVERITIES || ['critical','major','minor','info']);
    const types  = (self.QA?.ISSUE_TYPES || ['visual','content','i18n','a11y','interactive','broken']);
    const typeOpts = types.map((t) => `<option value="${t}" ${t===issue.type?'selected':''}>${t}</option>`).join('');

    // Severity pill — segmented radio replacing the dropdown. Hidden input keeps
    // the .qa-severity class so harvest()/validate() read .value unchanged, and
    // the existing hotkey handler can still dispatch a 'change' event on it.
    const sevHotkeyMap = opts?.settings?.defaults?.severityHotkeys || { 1: 'critical', 2: 'major', 3: 'minor', 4: 'info' };
    const hotkeyForSev = (sev) => Object.keys(sevHotkeyMap).find((k) => sevHotkeyMap[k] === sev) || '';
    const currentSev = issue.severity || sevs[0];
    const sevPill = `
      <div class="qa-sev-pill" role="radiogroup" aria-label="Severity">
        ${sevs.map((s) => {
          const hk = hotkeyForSev(s);
          const active = s === currentSev;
          return `<button type="button" class="qa-sev-btn" data-sev="${s}" role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}" title="${s}${hk ? ` (hotkey ${hk})` : ''}">
            <span class="qa-sev-dot"></span>
            <span class="qa-sev-label">${s}</span>
            ${hk ? `<span class="qa-sev-hk" aria-hidden="true">${hk}</span>` : ''}
          </button>`;
        }).join('')}
        <input type="hidden" class="qa-severity" value="${escape(currentSev)}" />
      </div>
    `;

    // Manual-only issues have no element refs — skip element list entirely.
    const rawElements = issue.elements && issue.elements.length > 1 ? issue.elements : [issue.element];
    const elements = rawElements.filter(Boolean);
    const isMulti = elements.length > 1;
    const perEl = Array.isArray(issue.computedPerElement) ? issue.computedPerElement : null;
    const showSelectable = isMulti && perEl && perEl.length === elements.length && !issue.computedAllIdentical;
    const elementsList = elements.map((el, i) => `
      <li class="qa-element-row${showSelectable ? ' qa-selectable' : ''}${showSelectable && i === 0 ? ' is-active' : ''}" data-idx="${i}"${showSelectable ? ' tabindex="0" role="button" aria-label="Show computed values for element ' + (i + 1) + '"' : ''}>
        <span class="qa-num">${i + 1}</span><code class="qa-code-inline">${escape(el.selector || '(no selector)')}</code>
      </li>
    `).join('');
    const hasElements = elements.length > 0;

    const sectionLabel = issue.section ? `⌗ ${issue.section}` : '—';
    const src = issue.source;
    const sourceLabel  = src && src.file ? `${src.file}:${src.line ?? '?'}` : 'no source map';

    const ctx = issue.context || {};
    const vp = ctx.viewport || {};
    const bp = ctx.breakpoint || {};
    const dev = ctx.device || {};
    const chipText = ctx.viewportLabel || `${vp.w || '?'}×${vp.h || '?'}`;
    const tooltipLines = [
      `Viewport: ${vp.w}×${vp.h} (${vp.orientation || ''}, dpr ${vp.dpr || 1})`,
      ctx.document ? `Document: ${ctx.document.w}×${ctx.document.h}, scroll ${ctx.document.scrollX},${ctx.document.scrollY}` : '',
      bp.label ? `Breakpoint: ${bp.label} (Tailwind) · ${bp.all?.bootstrap || ''} (Bootstrap) · ${bp.generic}` : '',
      dev.platform ? `Device: ${dev.platform}${dev.isMobile ? ' · mobile' : ''}${dev.isTouch ? ' · touch' : ''}` : '',
      `Theme: ${dev.prefersDark ? 'dark' : 'light'}${dev.prefersReducedMotion ? ' · reduced-motion' : ''}`
    ].filter(Boolean).join('\n');

    const mode = opts?.settings?.mode || null;
    // Resolve form config once per render; passed to all helpers.
    const formCfg = getFormConfig(opts);
    const MODE_LABELS = {
      'prod-bug': 'PROD bug', 'design-fidelity': 'Design',
      'admin': 'Admin', 'a11y': 'A11y', 'i18n': 'i18n', 'custom': 'Custom'
    };
    const modeChip = mode
      ? `<span class="qa-mode-chip" data-mode="${escape(mode)}" title="QA mode: ${escape(MODE_LABELS[mode] || mode)} — change in Settings">${escape(MODE_LABELS[mode] || mode)}</span>`
      : '';

    // Total numbered pins across all screenshots — surfaced so the QA author
    // sees at a glance how many annotations are already attached without
    // expanding every thumbnail.
    const allShots = Array.isArray(issue.screenshots) ? issue.screenshots : (issue.screenshot ? [issue.screenshot] : []);
    let pinTotal = 0;
    for (const s of allShots) for (const l of (s?.annotations?.layers || [])) if (l.type === 'pin') pinTotal++;
    const pinChip = pinTotal > 0
      ? `<span class="qa-pin-chip" title="${pinTotal} numbered pin${pinTotal === 1 ? '' : 's'} across ${allShots.length} screenshot${allShots.length === 1 ? '' : 's'}">📍 ${pinTotal}</span>`
      : '';

    return `
      <div class="qa-modal" role="dialog" aria-modal="true" aria-labelledby="qa-modal-label-${escape(issue.id)}">
        <header class="qa-modal-header">
          <span class="qa-id-badge" id="qa-modal-label-${escape(issue.id)}">${issue.id}</span>
          ${modeChip}
          ${pinChip}
          <span class="qa-vp-chip" title="${escape(tooltipLines)}">${escape(chipText)}</span>
          <span class="qa-modal-meta">${sectionLabel} · ${sourceLabel}${elements.length > 1 ? ` · ${elements.length} elements` : ''}</span>
          <button class="qa-cancel qa-icon-btn" aria-label="Close">×</button>
        </header>

        <nav class="qa-modal-toc" aria-label="Sections in this issue"></nav>

        <section class="qa-modal-body">
          <div class="qa-validation-banner" role="alert" hidden></div>

          ${fieldVisible(formCfg, 'title') ? `
          <div class="qa-row" data-qa-section="title">
            <label>Title${fieldRequired(formCfg, 'title') ? ' <span class="qa-req">*</span>' : ''}</label>
            <input class="qa-title" type="text" placeholder="Short description" value="${escape(issue.title || '')}" />
            ${(issue.tags || []).length ? `<div class="qa-tags-row">${(issue.tags || []).map((t) => `<span class="qa-tag-chip">${escape(t)}</span>`).join('')}</div>` : ''}
          </div>` : ''}

          ${fieldVisible(formCfg, 'severity') || fieldVisible(formCfg, 'type') ? `
          <div class="qa-row qa-row-2" data-qa-section="severity">
            ${fieldVisible(formCfg, 'severity') ? `
            <div>
              <label>Severity${fieldRequired(formCfg, 'severity') ? ' <span class="qa-req">*</span>' : ''}</label>
              ${sevPill}
            </div>` : ''}
            ${fieldVisible(formCfg, 'type') ? `
            <div>
              <label>Type${fieldRequired(formCfg, 'type') ? ' <span class="qa-req">*</span>' : ''}</label>
              <select class="qa-type">${typeOpts}</select>
            </div>` : ''}
          </div>` : ''}

          ${fieldVisible(formCfg, 'element') && hasElements ? `
          <div class="qa-row" data-qa-section="element">
            <label>${elements.length > 1 ? `Elements (${elements.length})` : 'Element'}${fieldRequired(formCfg, 'element') ? ' <span class="qa-req">*</span>' : ''}</label>
            <ul class="qa-elements-list">${elementsList}</ul>
          </div>` : ''}

          ${fieldVisible(formCfg, 'computed') && hasElements ? `
          <div class="qa-row" data-qa-section="computed">
            <label>Computed (actual)${fieldRequired(formCfg, 'computed') ? ' <span class="qa-req">*</span>' : ''}</label>
            ${renderComputedBlock(issue, elements)}
          </div>` : ''}

          ${shouldShowExpectedCss(formCfg, issue) ? `
          <div class="qa-row" data-qa-section="expected">
            <div class="qa-label-row">
              <label>Expected (Figma / spec)</label>
              <button class="qa-add-row qa-link-btn" type="button">+ Add property</button>
            </div>
            ${elements.length > 1 ? renderExpectedTabsStrip(elements) : ''}
            <div class="qa-expected-pane" data-tab="all"></div>
            <datalist id="qa-prop-options" class="qa-prop-datalist"></datalist>
          </div>` : ''}

          ${shouldShowFigmaField(formCfg, issue) ? `
          <div class="qa-row" data-qa-section="figma">
            <div class="qa-label-row">
              <label>Figma link (optional)</label>
              ${issue.expected?.figmaAutoMatched
                ? '<span class="qa-figma-chip" title="Auto-filled by matching the picked element to the Figma frame tree. Edit or clear if wrong.">⚡ auto-matched</span>'
                : ''}
            </div>
            <input class="qa-figma-link" type="url" placeholder="https://www.figma.com/design/...?node-id=..." value="${escape(issue.expected?.figmaLink || '')}" />
            ${issue.expected?.figmaBreadcrumb
                ? `<span class="qa-figma-breadcrumb" title="Figma layer chain"><code>${escape(issue.expected.figmaBreadcrumb)}</code></span>`
                : ''}
          </div>` : ''}

          ${fieldVisible(formCfg, 'note') ? `
          <div class="qa-row" data-qa-section="note">
            <label>Note${fieldRequired(formCfg, 'note') ? ' <span class="qa-req">*</span>' : ''}</label>
            <textarea class="qa-note" rows="3" placeholder="Free-text context (paste images here too)"></textarea>
          </div>` : ''}

          <div data-qa-section="panels">${renderPanelsBlock(issue, opts)}</div>

          ${fieldVisible(formCfg, 'screenshots') ? `
          <div class="qa-row" data-qa-section="screenshots">
            <div class="qa-label-row">
              <label>Screenshots${fieldRequired(formCfg, 'screenshots') ? ' <span class="qa-req">*</span>' : ''}</label>
              <span class="qa-hint">drag to reorder · click to preview</span>
            </div>
            <div class="qa-gallery"></div>
            <div class="qa-gallery-actions">
              ${opts.disableRecapture ? '' : '<button class="qa-recapture" type="button" title="Re-capture the page using the picked element selectors (auto-crop)">Recapture (auto)</button>'}
              <button class="qa-new-shot" type="button" title="Drag to select a custom region of the page, then annotate">New screenshot</button>
              <button class="qa-paste" type="button" title="Paste image from clipboard (Ctrl/Cmd+V)">Paste image</button>
              <button class="qa-upload" type="button" title="Upload image file(s)">Upload…</button>
              <input class="qa-upload-input" type="file" accept="image/*" multiple style="display:none" />
            </div>
          </div>` : ''}
        </section>

        <footer class="qa-modal-footer">
          <button class="qa-cancel qa-btn-ghost" type="button">Cancel</button>
          <button class="qa-save qa-btn-primary" type="button">Save issue</button>
        </footer>
      </div>
    `;
  }

  // Compact display block for the runtime buffer snapshot — shown only when
  // Panel registry block — replaces the static renderRuntimeContext +
  // renderA11yFindings shown in v0.2.0. The registry decides which panels
  // mount based on settings.mode (or settings.customPanels[] in custom mode).
  // Each panel module owns its own render/mount/harvest lifecycle.
  //
  // Backward-compat: if QA.panelRegistry hasn't loaded yet (manifest order
  // changed by accident), fall back to the inline renderers so the modal
  // never shows a blank space.
  function renderPanelsBlock(issue, opts) {
    if (self.QA?.panelRegistry?.renderPanels) {
      return self.QA.panelRegistry.renderPanels(issue, opts?.settings || {});
    }
    return renderRuntimeContext(issue) + renderA11yFindings(issue);
  }

  // console / network capture was on at pick time and the buffer had entries.
  // Each list collapses to "+N more" past 3 to keep the modal readable.
  function renderRuntimeContext(issue) {
    const rc = issue.runtimeContext;
    if (!rc) return '';
    const cons = rc.console || [];
    const net = rc.network || [];
    if (cons.length === 0 && net.length === 0) return '';
    const consPreview = cons.slice(0, 3).map((c) => {
      const lvl = c.level === 'error' ? '✗' : '⚠';
      return `<li><span class="qa-rc-level qa-rc-${escape(c.level)}">${lvl} ${escape(c.level)}</span> <code>${escape((c.message || '').slice(0, 200))}</code></li>`;
    }).join('');
    const consMore = cons.length > 3 ? `<li class="qa-rc-more">+${cons.length - 3} more</li>` : '';
    const netPreview = net.slice(0, 3).map((n) => {
      return `<li><span class="qa-rc-status qa-rc-status-${n.status >= 500 ? '5xx' : n.status >= 400 ? '4xx' : 'fail'}">${n.status || 'ERR'}</span> <code>${escape(n.method || '')} ${escape((n.url || '').slice(0, 120))}</code> <small class="qa-muted">${n.durationMs || 0}ms</small></li>`;
    }).join('');
    const netMore = net.length > 3 ? `<li class="qa-rc-more">+${net.length - 3} more</li>` : '';
    return `
      <div class="qa-row qa-runtime-context">
        <label>Runtime context <span class="qa-rc-tag">auto</span></label>
        ${cons.length > 0 ? `<div class="qa-rc-block">
          <div class="qa-rc-head">Console — ${cons.length}</div>
          <ul class="qa-rc-list">${consPreview}${consMore}</ul>
        </div>` : ''}
        ${net.length > 0 ? `<div class="qa-rc-block">
          <div class="qa-rc-head">Network failures — ${net.length}</div>
          <ul class="qa-rc-list">${netPreview}${netMore}</ul>
        </div>` : ''}
      </div>
    `;
  }

  // Accessibility findings block — shown when axe scan ran at pick time
  // (settings.sources.a11y === true). Per-violation: impact badge + WCAG SC +
  // help link + first failing selector. Contrast badge appears separately even
  // when there are no axe violations (it's a quick standalone check).
  function renderA11yFindings(issue) {
    const f = issue.a11yFindings;
    if (!f) return '';
    const v = f.violations || [];
    const c = f.contrast;
    if (v.length === 0 && !c) return '';

    const impactColor = (impact) => {
      if (impact === 'critical') return 'qa-rc-status-5xx';     // red
      if (impact === 'serious')  return 'qa-rc-status-4xx';     // orange
      return 'qa-rc-status-fail';                                // gray
    };

    const violationItems = v.slice(0, 5).map((vi) => {
      const wcag = (vi.wcag || []).join(' ');
      const help = vi.helpUrl
        ? `<a href="${escape(vi.helpUrl)}" target="_blank" rel="noopener" class="qa-a11y-help">help ↗</a>`
        : '';
      return `<li>
        <span class="qa-rc-status ${impactColor(vi.impact)}">${escape(vi.impact || 'minor')}</span>
        <code>${escape(vi.id)}</code>
        ${wcag ? `<small class="qa-muted">${escape(wcag)}</small>` : ''}
        ${help}
        <div class="qa-a11y-desc">${escape(vi.help || vi.description || '')}</div>
        ${vi.selectors?.length ? `<div class="qa-a11y-sel"><code>${escape(vi.selectors[0])}</code></div>` : ''}
      </li>`;
    }).join('');
    const more = v.length > 5 ? `<li class="qa-rc-more">+${v.length - 5} more</li>` : '';

    const contrastBlock = c
      ? `<div class="qa-rc-block qa-a11y-contrast">
          <div class="qa-rc-head">Contrast</div>
          <div class="qa-a11y-contrast-row">
            <span class="qa-a11y-swatch" style="background:${escape(c.fg)}"></span>
            <span class="qa-a11y-swatch" style="background:${escape(c.bg)}"></span>
            <strong>${c.ratio}:1</strong>
            <small class="qa-muted">need ≥ ${c.threshold}:1</small>
            ${c.fail ? '<span class="qa-rc-status qa-rc-status-4xx">fails AA</span>' : '<span class="qa-rc-status qa-rc-pass">passes AA</span>'}
          </div>
        </div>`
      : '';

    return `
      <div class="qa-row qa-a11y-findings">
        <label>Accessibility <span class="qa-rc-tag">axe-core</span></label>
        ${v.length > 0 ? `<div class="qa-rc-block">
          <div class="qa-rc-head">Violations — ${v.length}</div>
          <ul class="qa-rc-list qa-a11y-list">${violationItems}${more}</ul>
        </div>` : '<div class="qa-rc-block qa-a11y-clean"><span class="qa-rc-status qa-rc-pass">no violations</span></div>'}
        ${contrastBlock}
      </div>
    `;
  }

  function formatRecord(rec) {
    if (!rec) return '';
    return Object.entries(rec).map(([k, v]) => `${camelToKebab(k)}: ${v}`).join('\n');
  }

  function renderComputedBlock(issue, elements) {
    const perEl = Array.isArray(issue.computedPerElement) ? issue.computedPerElement : null;

    // Single-pick or only one entry: plain block.
    if (!perEl || perEl.length <= 1) {
      return `<pre class="qa-pre">${escape(formatRecord(issue.actual || issue.computed))}</pre>`;
    }

    // Multi-pick, all identical → compact grouped label.
    if (issue.computedAllIdentical) {
      const groupLabel = perEl.map((_, i) => `(${i + 1})`).join('') + ' — identical';
      return `
        <div class="qa-computed-multi">
          <div class="qa-computed-group-label">${escape(groupLabel)}</div>
          <pre class="qa-pre">${escape(formatRecord(perEl[0]))}</pre>
        </div>
      `;
    }

    // Multi-pick, values differ → single pane that swaps when the user
    // clicks a row in the Elements list above. Default = (1).
    const initial = 0;
    return `
      <pre class="qa-pre qa-computed-pane" data-current="${initial}">${escape(formatRecord(perEl[initial]))}</pre>
    `;
  }

  // Click/keyboard a row in `.qa-elements-list` → swap the computed pane.
  // Only active when the list rows have `.qa-selectable`.
  function bindComputedTabs(root, issue /*, elements */) {
    const list = root.querySelector('.qa-elements-list');
    const pane = root.querySelector('.qa-computed-pane');
    if (!list || !pane) return;
    const perEl = issue.computedPerElement || [];

    function activate(idx) {
      if (!Number.isFinite(idx) || idx < 0 || idx >= perEl.length) return;
      pane.dataset.current = String(idx);
      pane.textContent = formatRecord(perEl[idx]);
      list.querySelectorAll('.qa-element-row').forEach((row) => {
        row.classList.toggle('is-active', parseInt(row.dataset.idx, 10) === idx);
      });
    }

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.qa-element-row.qa-selectable');
      if (!row) return;
      activate(parseInt(row.dataset.idx, 10));
    });
    list.addEventListener('keydown', (e) => {
      const row = e.target.closest('.qa-element-row.qa-selectable');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(parseInt(row.dataset.idx, 10));
      }
    });
  }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ─── Expected tabs widget (multi-pick) ────────────────────────────────────
  // The widget reuses one `.qa-expected-pane` container and swaps its content
  // when the active tab changes. Persistence lives in `expectedModel`:
  //   sharedRows: [{key, value}, ...]              ← All tab
  //   overrides:  [null | {key:val, ...}, ...]     ← (i) tabs, length = elements
  // Single-pick: overrides is null, the tabs strip is not rendered, and the
  // pane only ever holds the shared rows.

  function renderExpectedTabsStrip(elements) {
    const all = `<button class="qa-exp-tab is-active" type="button" data-tab="all">All</button>`;
    const perEl = elements.map((_, i) =>
      `<button class="qa-exp-tab" type="button" data-tab="${i}">(${i + 1})</button>`
    ).join('');
    return `<div class="qa-expected-tabs" role="tablist">${all}${perEl}</div>`;
  }

  function bindExpectedTabs(root, issue, elements, model) {
    const tabsEl = root.querySelector('.qa-expected-tabs');
    const pane = root.querySelector('.qa-expected-pane');
    const addBtn = root.querySelector('.qa-add-row');
    if (!pane || !addBtn) return;        // mode hides Expected — nothing to bind

    // Add-property button always targets the active tab.
    addBtn.addEventListener('click', () => {
      const list = pane.querySelector('.qa-expected-list');
      if (!list) return;
      addExpectedRow(list, '', '', getActualMap(issue));
    });

    // Remove-row delegation lives on the pane (shared across re-renders).
    pane.addEventListener('click', (e) => {
      const btn = e.target.closest('.qa-row-remove');
      if (btn) btn.closest('.qa-expected-row')?.remove();
    });

    if (!tabsEl) return;   // single-pick: no tabs
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.qa-exp-tab');
      if (!btn) return;
      const next = btn.dataset.tab === 'all' ? 'all' : parseInt(btn.dataset.tab, 10);
      if (next === model.activeTab) return;
      // Harvest current pane into model BEFORE swapping.
      harvestActivePane(root, model);
      model.activeTab = next;
      tabsEl.querySelectorAll('.qa-exp-tab').forEach((b) => {
        b.classList.toggle('is-active', String(b.dataset.tab) === String(next));
      });
      renderExpectedPane(root, issue, elements, model);
    });
  }

  function renderExpectedPane(root, issue, elements, model) {
    const pane = root.querySelector('.qa-expected-pane');
    if (!pane) return;                   // mode hides Expected — no-op
    pane.dataset.tab = String(model.activeTab);
    pane.innerHTML = '';
    const actuals = getActualMap(issue);

    if (model.activeTab === 'all') {
      const list = document.createElement('div');
      list.className = 'qa-expected-list';
      pane.appendChild(list);
      const rows = model.sharedRows.length ? model.sharedRows : [{ key: '', value: '' }];
      for (const r of rows) addExpectedRow(list, r.key, r.value, actuals);
      return;
    }

    // Per-element override pane: heading + editable overrides only. The shared
    // (All) values are not re-rendered here — the colored border on the pane
    // makes it clear the user is editing overrides, not the baseline.
    const idx = model.activeTab;
    const sel = elements[idx]?.selector || `(element ${idx + 1})`;

    const head = document.createElement('div');
    head.className = 'qa-exp-head';
    head.innerHTML = `<span class="qa-exp-head-label">Override for (${idx + 1})</span><code class="qa-code-inline">${escape(sel)}</code>`;
    pane.appendChild(head);

    const list = document.createElement('div');
    list.className = 'qa-expected-list';
    pane.appendChild(list);
    const ovr = model.overrides?.[idx];
    const ovrRows = ovr ? Object.entries(ovr).map(([k, v]) => ({ key: k, value: String(v ?? '') })) : [];
    if (ovrRows.length === 0) {
      addExpectedRow(list, '', '', actuals);
    } else {
      for (const r of ovrRows) addExpectedRow(list, r.key, r.value, actuals);
    }
  }

  // Read whatever rows are currently in the pane and write them back into the
  // model under the active tab key.
  function harvestActivePane(root, model) {
    const pane = root.querySelector('.qa-expected-pane');
    if (!pane) return;
    const rows = [];
    for (const row of pane.querySelectorAll('.qa-expected-row')) {
      const k = row.querySelector('.qa-exp-key')?.value ?? '';
      const v = row.querySelector('.qa-exp-val')?.value ?? '';
      rows.push({ key: k, value: v });
    }
    if (model.activeTab === 'all') {
      // Keep blank trailing rows out of the model — they'd reappear as empty
      // pre-fill on next render and confuse the inheritance display.
      model.sharedRows = rows.filter((r) => r.key.trim() || r.value.trim());
      if (model.sharedRows.length === 0) {
        // Preserve the empty-state defaults so the next render isn't blank.
        model.sharedRows = [{ key: 'font-size', value: '' }, { key: 'font-weight', value: '' }];
      }
    } else {
      const idx = model.activeTab;
      if (!Array.isArray(model.overrides)) return;
      const obj = {};
      for (const r of rows) {
        const k = r.key.trim();
        const v = r.value.trim();
        if (k && v && !k.startsWith('figma')) obj[k] = v;
      }
      model.overrides[idx] = Object.keys(obj).length === 0 ? null : obj;
    }
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.formModal = { open };
})();
