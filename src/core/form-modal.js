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

      const finish = (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        overlay.removeEventListener('paste', onPaste);
        resolve(result);
      };

      $$('.qa-cancel').forEach((btn) => btn.addEventListener('click', () => finish(null)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      $('.qa-save').addEventListener('click', () => {
        // Final harvest of the active expected pane before save.
        harvestActivePane(overlay, expectedModel);
        finish(harvest(overlay, issue, shots, expectedModel));
      });

      // Computed tabs (only present when multi-pick + values differ)
      const elementsForTabs = issue.elements && issue.elements.length > 1 ? issue.elements : [issue.element];
      bindComputedTabs(overlay, issue, elementsForTabs);

      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      document.addEventListener('keydown', onKey, true);

      // Property combo
      $('.qa-prop-datalist').innerHTML = COMMON_PROPS.map((p) => `<option value="${p}"></option>`).join('');

      // Expected tabs (multi-pick only) + initial pane render
      bindExpectedTabs(overlay, issue, elementsAll, expectedModel);
      renderExpectedPane(overlay, issue, elementsAll, expectedModel);

      // Image gallery
      const renderGallery = () => {
        const gal = $('.qa-gallery');
        gal.innerHTML = '';
        if (shots.length === 0) {
          gal.innerHTML = '<div class="qa-gallery-empty">No images yet. Use the buttons below to add one.</div>';
          return;
        }
        shots.forEach((shot, i) => {
          const item = document.createElement('div');
          item.className = 'qa-thumb';
          item.draggable = true;
          item.dataset.idx = String(i);
          item.innerHTML = `
            <span class="qa-thumb-handle" title="Drag to reorder">⠿</span>
            <span class="qa-thumb-num">${i + 1}</span>
            <img src="${shot.dataUrl}" alt="" />
            <span class="qa-thumb-meta">${shot.source || ''}</span>
            <button class="qa-thumb-del" type="button" title="Remove">×</button>
          `;
          item.querySelector('.qa-thumb-del').addEventListener('click', (e) => {
            e.stopPropagation();
            shots.splice(i, 1);
            renderGallery();
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
      setTimeout(() => $('.qa-title')?.focus(), 0);
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

  function harvest(root, issue, shots, expectedModel) {
    const $ = (sel) => root.querySelector(sel);
    const get = (sel) => $(sel)?.value ?? '';
    const out = { ...issue };
    out.title    = get('.qa-title');
    out.severity = get('.qa-severity');
    out.type     = get('.qa-type');
    out.note     = get('.qa-note');

    // Build shared expected from model.sharedRows + figma fields.
    const expected = {};
    for (const { key, value } of expectedModel.sharedRows) {
      const k = (key || '').trim();
      const v = (value || '').trim();
      if (k && v) expected[k] = v;
    }
    const figmaLink = get('.qa-figma-link').trim();
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

  function renderHtml(issue, opts = {}) {
    const sevs   = (self.QA?.SEVERITIES || ['critical','major','minor','info']);
    const types  = (self.QA?.ISSUE_TYPES || ['visual','content','i18n','a11y','interactive','broken']);
    const sevOpts  = sevs.map((s) => `<option value="${s}" ${s===issue.severity?'selected':''}>${s}</option>`).join('');
    const typeOpts = types.map((t) => `<option value="${t}" ${t===issue.type?'selected':''}>${t}</option>`).join('');

    const elements = issue.elements && issue.elements.length > 1 ? issue.elements : [issue.element];
    const isMulti = elements.length > 1;
    const perEl = Array.isArray(issue.computedPerElement) ? issue.computedPerElement : null;
    const showSelectable = isMulti && perEl && perEl.length === elements.length && !issue.computedAllIdentical;
    const elementsList = elements.map((el, i) => `
      <li class="qa-element-row${showSelectable ? ' qa-selectable' : ''}${showSelectable && i === 0 ? ' is-active' : ''}" data-idx="${i}"${showSelectable ? ' tabindex="0" role="button" aria-label="Show computed values for element ' + (i + 1) + '"' : ''}>
        <span class="qa-num">${i + 1}</span><code class="qa-code-inline">${escape(el.selector)}</code>
      </li>
    `).join('');

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

    return `
      <div class="qa-modal" role="dialog" aria-label="QA issue">
        <header class="qa-modal-header">
          <span class="qa-id-badge">${issue.id}</span>
          <span class="qa-vp-chip" title="${escape(tooltipLines)}">${escape(chipText)}</span>
          <span class="qa-modal-meta">${sectionLabel} · ${sourceLabel}${elements.length > 1 ? ` · ${elements.length} elements` : ''}</span>
          <button class="qa-cancel qa-icon-btn" aria-label="Close">×</button>
        </header>

        <section class="qa-modal-body">
          <div class="qa-row">
            <label>Title</label>
            <input class="qa-title" type="text" placeholder="Short description" value="${escape(issue.title || '')}" />
          </div>

          <div class="qa-row qa-row-2">
            <div>
              <label>Severity</label>
              <select class="qa-severity">${sevOpts}</select>
            </div>
            <div>
              <label>Type</label>
              <select class="qa-type">${typeOpts}</select>
            </div>
          </div>

          <div class="qa-row">
            <label>${elements.length > 1 ? `Elements (${elements.length})` : 'Element'}</label>
            <ul class="qa-elements-list">${elementsList}</ul>
          </div>

          <div class="qa-row">
            <label>Computed (actual)</label>
            ${renderComputedBlock(issue, elements)}
          </div>

          <div class="qa-row">
            <div class="qa-label-row">
              <label>Expected (Figma / spec)</label>
              <button class="qa-add-row qa-link-btn" type="button">+ Add property</button>
            </div>
            ${elements.length > 1 ? renderExpectedTabsStrip(elements) : ''}
            <div class="qa-expected-pane" data-tab="all"></div>
            <datalist id="qa-prop-options" class="qa-prop-datalist"></datalist>
          </div>

          <div class="qa-row">
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
          </div>

          <div class="qa-row">
            <label>Note</label>
            <textarea class="qa-note" rows="3" placeholder="Free-text context (paste images here too)"></textarea>
          </div>

          <div class="qa-row">
            <div class="qa-label-row">
              <label>Screenshots</label>
              <span class="qa-hint">drag to reorder · click to preview</span>
            </div>
            <div class="qa-gallery"></div>
            <div class="qa-gallery-actions">
              ${opts.disableRecapture ? '' : '<button class="qa-recapture" type="button" title="Capture the current page again">Recapture</button>'}
              <button class="qa-paste" type="button" title="Paste image from clipboard (Ctrl/Cmd+V)">Paste image</button>
              <button class="qa-upload" type="button" title="Upload image file(s)">Upload…</button>
              <input class="qa-upload-input" type="file" accept="image/*" multiple style="display:none" />
            </div>
          </div>
        </section>

        <footer class="qa-modal-footer">
          <button class="qa-cancel qa-btn-ghost" type="button">Cancel</button>
          <button class="qa-save qa-btn-primary" type="button">Save issue</button>
        </footer>
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
