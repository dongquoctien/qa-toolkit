// Design fidelity panel — design-fidelity mode.
//
// Drives the "implementation vs Figma" workflow. The single most useful
// structured field per OverlayQA / UI Match / Pixelay research is the
// MISMATCH CATEGORY radio — spacing / color / typography / alignment / asset.
// It routes the bug instantly to the right designer review stack.
//
// Auto-populated:
//   - Figma link (already auto-matched at issue-build time, lives on issue.expected.figmaLink)
//   - Breakpoint (from issue.context.breakpoint)
//   - Section breadcrumb (from issue.expected.figmaBreadcrumb when auto-matched)
//
// User-edited (persists into issue.panels['design-fidelity']):
//   - mismatchCategory: enum
//   - notes: free text per-property hint (rarely used; main detail goes in
//     the modal's Expected CSS rows + Pin notes)
(function () {
  const PANEL_ID = 'design-fidelity';

  const CATEGORIES = [
    { id: 'spacing',     label: 'Spacing',     hint: 'padding / margin / gap differs' },
    { id: 'color',       label: 'Color',       hint: 'fg / bg / border color off' },
    { id: 'typography',  label: 'Typography',  hint: 'font-size / weight / line-height' },
    { id: 'alignment',   label: 'Alignment',   hint: 'flex / grid / position wrong' },
    { id: 'asset',       label: 'Asset',       hint: 'icon / image / illustration mismatch' },
    { id: 'other',       label: 'Other',       hint: 'something else' }
  ];

  function isAvailable(_issue) { return true; }

  function getData(issue) {
    return (issue.panels && issue.panels[PANEL_ID]) || {};
  }

  function render(issue) {
    const data = getData(issue);
    const cat = data.mismatchCategory || '';
    const notes = data.notes || '';
    const figLink = issue.expected?.figmaLink || '';
    const breadcrumb = issue.expected?.figmaBreadcrumb || '';
    const auto = !!issue.expected?.figmaAutoMatched;
    const bp = issue.context?.breakpoint?.label || issue.context?.breakpoint?.generic || '';

    const radios = CATEGORIES.map((c) => `
      <label class="qa-df-radio">
        <input type="radio" name="qa-df-category" value="${escapeAttr(c.id)}" ${cat === c.id ? 'checked' : ''} />
        <span class="qa-df-radio-body">
          <strong>${escapeHtml(c.label)}</strong>
          <small>${escapeHtml(c.hint)}</small>
        </span>
      </label>
    `).join('');

    const figmaBlock = figLink ? `
      <div class="qa-df-figma">
        <div class="qa-df-figma-head">
          ${auto ? '<span class="qa-df-auto-tag">⚡ auto-matched</span>' : ''}
          <a href="${escapeAttr(figLink)}" target="_blank" rel="noopener" class="qa-df-figma-link">Open in Figma ↗</a>
        </div>
        ${breadcrumb ? `<div class="qa-df-breadcrumb"><code>${escapeHtml(breadcrumb)}</code></div>` : ''}
      </div>
    ` : `
      <div class="qa-df-figma-empty">
        <small>No Figma link auto-matched. Paste one in the Figma link field above to enable design comparisons.</small>
      </div>
    `;

    return `
      <div class="qa-df">
        <div class="qa-df-section">
          <label class="qa-df-label">Mismatch category</label>
          <div class="qa-df-radios">${radios}</div>
        </div>

        <div class="qa-df-section">
          <label class="qa-df-label">Figma reference</label>
          ${figmaBlock}
          ${bp ? `<div class="qa-df-bp"><strong>Breakpoint:</strong> ${escapeHtml(bp)}</div>` : ''}
        </div>

        <div class="qa-df-section">
          <label class="qa-df-label">Implementation notes <small class="qa-muted">(optional — main values go in Expected CSS rows above)</small></label>
          <textarea class="qa-df-notes" rows="2" placeholder="e.g. design uses var(--text-body-md) — implementation hardcodes 15px">${escapeHtml(notes)}</textarea>
        </div>
      </div>
    `;
  }

  function mount(panelEl, _issue, onChange) {
    const fire = () => { if (onChange) onChange(); };
    panelEl.addEventListener('change', fire);
    panelEl.addEventListener('input', fire);
    return () => { /* no manual listeners to clean */ };
  }

  function harvest(panelEl, _issue) {
    const cat = panelEl.querySelector('input[name="qa-df-category"]:checked')?.value || '';
    const notes = panelEl.querySelector('.qa-df-notes')?.value?.trim() || '';
    return { mismatchCategory: cat, notes };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'Design fidelity',
    modes: ['design-fidelity'],
    defaultCollapsed: false,
    isAvailable,
    render,
    mount,
    harvest
  };

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  if (target.QA.panelRegistry?.register) {
    target.QA.panelRegistry.register(panel);
  } else {
    target.QA.panels = target.QA.panels || {};
    target.QA.panels[PANEL_ID] = panel;
  }
})();
