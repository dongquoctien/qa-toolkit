// Localization findings panel — i18n mode.
//
// Captures the locale state + classifies the bug per Lokalise / Phrase /
// Crowdin conventions: truncation, mirroring, hardcoded string, plural rule,
// date/number format. The "linguistic vs technical" split routes the issue
// to a translator vs an engineer.
//
// Auto-detected:
//   - locale         — issue.context.locale (set by content.js)
//   - direction      — document.dir (LTR/RTL)
//   - i18nKey        — closest [data-i18n-key] (already in issue.element.i18nKey)
//   - sourceString   — element.textContent
//
// User-edited (issue.panels['i18n-findings']):
//   - direction (override if needed)
//   - bugCategory
//   - sourceString (editable in case auto-detected is too short)
//   - renderedString (what's actually showing — paste-from-screenshot helper)
//   - linguisticOrTechnical
//   - notes
(function () {
  const PANEL_ID = 'i18n-findings';

  const CATEGORIES = [
    { id: '',           label: '— select —' },
    { id: 'truncation', label: 'Truncation / overflow' },
    { id: 'mirroring',  label: 'Mirroring (RTL flip wrong)' },
    { id: 'hardcoded',  label: 'Hardcoded string (no i18n key)' },
    { id: 'plural',     label: 'Plural rule wrong' },
    { id: 'format',     label: 'Date / number / currency format' },
    { id: 'translation',label: 'Translation incorrect' },
    { id: 'missing',    label: 'Missing translation' }
  ];

  function isAvailable(_issue) { return true; }

  function getData(issue) {
    return (issue.panels && issue.panels[PANEL_ID]) || {};
  }

  function autoDirection() {
    return (document?.documentElement?.dir || 'ltr').toLowerCase();
  }

  function render(issue) {
    const data = getData(issue);
    const locale = issue.context?.locale || '';
    const dir = data.direction || autoDirection();
    const cat = data.bugCategory || '';
    const i18nKey = data.i18nKey || issue.element?.i18nKey || '';
    const source = data.sourceString || issue.element?.textContent || '';
    const rendered = data.renderedString || '';
    const lt = data.linguisticOrTechnical || '';
    const notes = data.notes || '';

    const catOpts = CATEGORIES.map((c) => `<option value="${escapeAttr(c.id)}" ${cat === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');

    return `
      <div class="qa-if">
        <div class="qa-if-grid">
          <label class="qa-if-field">
            <span>Locale <small class="qa-muted">(auto)</small></span>
            <input type="text" class="qa-if-locale" value="${escapeAttr(locale)}" placeholder="en, ko, vi, jp" />
          </label>
          <div class="qa-if-field">
            <span>Direction</span>
            <div class="qa-if-radios">
              <label><input type="radio" name="qa-if-dir" value="ltr" ${dir === 'ltr' ? 'checked' : ''} /> LTR</label>
              <label><input type="radio" name="qa-if-dir" value="rtl" ${dir === 'rtl' ? 'checked' : ''} /> RTL</label>
            </div>
          </div>
          <label class="qa-if-field qa-if-span-2">
            <span>i18n key <small class="qa-muted">(auto-detected from <code>data-i18n-key</code>)</small></span>
            <input type="text" class="qa-if-key" value="${escapeAttr(i18nKey)}" placeholder="auth.signIn.welcome" />
          </label>

          <label class="qa-if-field qa-if-span-2">
            <span>Bug category</span>
            <select class="qa-if-cat">${catOpts}</select>
          </label>

          <label class="qa-if-field">
            <span>Source string <small class="qa-muted">(EN / canonical)</small></span>
            <textarea class="qa-if-source" rows="2" placeholder="Welcome">${escapeHtml(source)}</textarea>
          </label>
          <label class="qa-if-field">
            <span>Rendered string <small class="qa-muted">(what shows in <em>${escapeHtml(locale || 'this locale')}</em>)</small></span>
            <textarea class="qa-if-rendered" rows="2" placeholder="환영합니다 (or [missing])">${escapeHtml(rendered)}</textarea>
          </label>

          <div class="qa-if-field qa-if-span-2">
            <span>Type</span>
            <div class="qa-if-radios">
              <label><input type="radio" name="qa-if-lt" value="linguistic" ${lt === 'linguistic' ? 'checked' : ''} /> Linguistic (translator)</label>
              <label><input type="radio" name="qa-if-lt" value="technical" ${lt === 'technical' ? 'checked' : ''} /> Technical (engineer)</label>
            </div>
          </div>

          <label class="qa-if-field qa-if-span-2">
            <span>Notes</span>
            <textarea class="qa-if-notes" rows="2" placeholder="e.g. Korean translation truncates at 12 chars but layout has space for 24">${escapeHtml(notes)}</textarea>
          </label>
        </div>
      </div>
    `;
  }

  function mount(panelEl, _issue, onChange) {
    const fire = () => { if (onChange) onChange(); };
    panelEl.addEventListener('input', fire);
    panelEl.addEventListener('change', fire);
    return () => {};
  }

  function harvest(panelEl, _issue) {
    return {
      locale: panelEl.querySelector('.qa-if-locale')?.value?.trim() || '',
      direction: panelEl.querySelector('input[name="qa-if-dir"]:checked')?.value || 'ltr',
      i18nKey: panelEl.querySelector('.qa-if-key')?.value?.trim() || '',
      bugCategory: panelEl.querySelector('.qa-if-cat')?.value || '',
      sourceString: panelEl.querySelector('.qa-if-source')?.value?.trim() || '',
      renderedString: panelEl.querySelector('.qa-if-rendered')?.value?.trim() || '',
      linguisticOrTechnical: panelEl.querySelector('input[name="qa-if-lt"]:checked')?.value || '',
      notes: panelEl.querySelector('.qa-if-notes')?.value?.trim() || ''
    };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'Localization',
    modes: ['i18n'],
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
