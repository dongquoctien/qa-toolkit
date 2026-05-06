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
      overlay.innerHTML = renderHtml(issue);
      document.documentElement.appendChild(overlay);

      const $$ = (sel) => overlay.querySelectorAll(sel);
      const $  = (sel) => overlay.querySelector(sel);

      // Working state lives here so handlers can mutate it without harvesting on every change.
      let shots = Array.isArray(issue.screenshots) ? [...issue.screenshots] : [];

      const finish = (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        overlay.removeEventListener('paste', onPaste);
        resolve(result);
      };

      $$('.qa-cancel').forEach((btn) => btn.addEventListener('click', () => finish(null)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      $('.qa-save').addEventListener('click', () => finish(harvest(overlay, issue, shots)));

      // Computed tabs (only present when multi-pick + values differ)
      const elementsForTabs = issue.elements && issue.elements.length > 1 ? issue.elements : [issue.element];
      bindComputedTabs(overlay, issue, elementsForTabs);

      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      document.addEventListener('keydown', onKey, true);

      // Property combo
      $('.qa-prop-datalist').innerHTML = COMMON_PROPS.map((p) => `<option value="${p}"></option>`).join('');
      $('.qa-add-row').addEventListener('click', () => {
        addExpectedRow($('.qa-expected-list'), '', '', getActualMap(issue));
      });
      $('.qa-expected-list').addEventListener('click', (e) => {
        const btn = e.target.closest('.qa-row-remove');
        if (btn) btn.closest('.qa-expected-row')?.remove();
      });

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

      // Recapture
      $('.qa-recapture').addEventListener('click', async () => {
        const btn = $('.qa-recapture');
        const orig = btn.textContent;
        btn.textContent = 'Capturing…';
        btn.disabled = true;
        try {
          const shot = await opts.onRecapture?.(overlay);
          if (shot) { shots.push(shot); renderGallery(); }
        } finally {
          btn.textContent = orig;
          btn.disabled = false;
        }
      });

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

      // Pre-fill default expected rows
      const list = $('.qa-expected-list');
      const actuals = getActualMap(issue);
      addExpectedRow(list, 'font-size', '', actuals);
      addExpectedRow(list, 'font-weight', '', actuals);

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

  function harvest(root, issue, shots) {
    const $ = (sel) => root.querySelector(sel);
    const get = (sel) => $(sel)?.value ?? '';
    const out = { ...issue };
    out.title    = get('.qa-title');
    out.severity = get('.qa-severity');
    out.type     = get('.qa-type');
    out.note     = get('.qa-note');

    const expected = {};
    for (const row of root.querySelectorAll('.qa-expected-row')) {
      const k = row.querySelector('.qa-exp-key').value.trim();
      const v = row.querySelector('.qa-exp-val').value.trim();
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

    out.screenshots = shots;
    out.screenshot = shots[0] || null; // back-compat alias for export
    out.updatedAt = new Date().toISOString();
    return out;
  }

  function renderHtml(issue) {
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
            <div class="qa-expected-list"></div>
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
              <button class="qa-recapture" type="button" title="Capture the current page again">Recapture</button>
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

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.formModal = { open };
})();
