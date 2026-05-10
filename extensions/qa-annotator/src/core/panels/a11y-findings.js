// Accessibility findings panel — a11y mode.
//
// Displays the axe-core scan from Sprint 1 (issue.a11yFindings) as the
// primary read-only block, plus user-edited fields the WCAG SC dropdown
// + impact filter + fix suggestion + affected user group. Researched via
// axe-core / Stark / ARC Toolkit field shapes.
//
// User edits (issue.panels['a11y-findings']):
//   - selectedRule       — which violation user is filing (defaults to first)
//   - affectedUserGroup  — keyboard-only / screen-reader / low-vision / cognitive
//   - fixSuggestion      — free text remediation
//
// Display (read from issue.a11yFindings, populated at pick time by content.js):
//   - violations[]       — full list with WCAG SC + helpUrl
//   - contrast           — { ratio, fg, bg, fail }
(function () {
  const PANEL_ID = 'a11y-findings';

  const USER_GROUPS = [
    { id: '',                value: '',                label: '— select —' },
    { id: 'keyboard-only',   value: 'keyboard-only',   label: 'Keyboard-only users' },
    { id: 'screen-reader',   value: 'screen-reader',   label: 'Screen-reader users' },
    { id: 'low-vision',      value: 'low-vision',      label: 'Low-vision users' },
    { id: 'cognitive',       value: 'cognitive',       label: 'Cognitive accessibility' },
    { id: 'motor',           value: 'motor',           label: 'Motor / dexterity' },
    { id: 'all',             value: 'all',             label: 'All users (WCAG general)' }
  ];

  function isAvailable(_issue) { return true; }

  function getData(issue) {
    return (issue.panels && issue.panels[PANEL_ID]) || {};
  }

  function render(issue) {
    const data = getData(issue);
    const findings = issue.a11yFindings || {};
    const violations = findings.violations || [];
    const contrast = findings.contrast;
    const selectedRule = data.selectedRule || violations[0]?.id || '';
    const affected = data.affectedUserGroup || '';
    const fix = data.fixSuggestion || '';

    const groupOpts = USER_GROUPS.map((g) => `<option value="${escapeAttr(g.value)}" ${affected === g.value ? 'selected' : ''}>${escapeHtml(g.label)}</option>`).join('');

    const ruleOpts = violations.length
      ? violations.map((v) => `<option value="${escapeAttr(v.id)}" ${selectedRule === v.id ? 'selected' : ''}>${escapeHtml(v.id)} — ${escapeHtml(v.impact || 'minor')}</option>`).join('')
      : '<option value="">(no violations detected)</option>';

    const violationsBlock = violations.length
      ? renderViolationsList(violations, selectedRule)
      : '<div class="qa-a11y-clean-msg">✓ No axe violations on this element subtree.</div>';

    const contrastBlock = contrast
      ? `<div class="qa-af-contrast">
          <span class="qa-af-swatch" style="background:${escapeAttr(contrast.fg)}" title="foreground"></span>
          <span class="qa-af-swatch" style="background:${escapeAttr(contrast.bg)}" title="background"></span>
          <strong>${contrast.ratio}:1</strong>
          <small class="qa-muted">need ≥ ${contrast.threshold}:1</small>
          ${contrast.fail ? '<span class="qa-rcp-status qa-rcp-status-4xx">fails AA</span>' : '<span class="qa-rcp-status qa-rc-pass">passes AA</span>'}
        </div>`
      : '';

    return `
      <div class="qa-af">
        ${contrastBlock}

        <div class="qa-af-section">
          <label class="qa-af-label">Violations <span class="qa-rcp-auto-tag">axe-core scan</span></label>
          ${violationsBlock}
        </div>

        ${violations.length > 0 ? `
          <div class="qa-af-grid">
            <label class="qa-af-field">
              <span>Filing under rule</span>
              <select class="qa-af-rule">${ruleOpts}</select>
            </label>
            <label class="qa-af-field">
              <span>Affected user group</span>
              <select class="qa-af-group">${groupOpts}</select>
            </label>
          </div>
        ` : ''}

        <div class="qa-af-section">
          <label class="qa-af-label">Fix suggestion</label>
          <textarea class="qa-af-fix" rows="2" placeholder="e.g. add aria-label='Save changes' to the button">${escapeHtml(fix)}</textarea>
        </div>
      </div>
    `;
  }

  function renderViolationsList(violations, selectedRule) {
    const items = violations.slice(0, 5).map((v) => {
      const isSelected = v.id === selectedRule;
      const impactClass = v.impact === 'critical' ? 'qa-rcp-status-5xx'
                       : v.impact === 'serious'  ? 'qa-rcp-status-4xx'
                       : 'qa-rcp-status-fail';
      return `
        <li class="qa-af-violation ${isSelected ? 'is-selected' : ''}">
          <div class="qa-af-violation-row">
            <span class="qa-rcp-status ${impactClass}">${escapeHtml(v.impact || 'minor')}</span>
            <code class="qa-af-rule-id">${escapeHtml(v.id)}</code>
            ${(v.wcag || []).length ? `<small class="qa-muted">${escapeHtml(v.wcag.join(' '))}</small>` : ''}
            ${v.helpUrl ? `<a href="${escapeAttr(v.helpUrl)}" target="_blank" rel="noopener" class="qa-af-help">help ↗</a>` : ''}
          </div>
          <div class="qa-af-desc">${escapeHtml(v.help || v.description || '')}</div>
          ${v.selectors?.length ? `<div class="qa-af-target"><code>${escapeHtml(v.selectors[0])}</code></div>` : ''}
        </li>
      `;
    }).join('');
    const more = violations.length > 5 ? `<li class="qa-rcp-more">+${violations.length - 5} more</li>` : '';
    return `<ul class="qa-af-violations">${items}${more}</ul>`;
  }

  function mount(panelEl, _issue, onChange) {
    const fire = () => { if (onChange) onChange(); };
    panelEl.addEventListener('change', fire);
    panelEl.addEventListener('input', fire);
    return () => {};
  }

  function harvest(panelEl, _issue) {
    const selectedRule = panelEl.querySelector('.qa-af-rule')?.value || '';
    const affectedUserGroup = panelEl.querySelector('.qa-af-group')?.value || '';
    const fixSuggestion = panelEl.querySelector('.qa-af-fix')?.value?.trim() || '';
    return { selectedRule, affectedUserGroup, fixSuggestion };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'Accessibility',
    modes: ['a11y'],
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
