// Form config — per-mode field visibility + required rules.
//
// Each QA mode has a config object that the modal reads to decide:
//   1. Which common form rows render (Title / Severity / Type / Note / etc).
//   2. Which panels mount (driven by panel-registry, but config can override).
//   3. Which fields block save when empty.
//
// State per field/panel: 'hidden' | 'optional' | 'required'.
// User overrides live in chrome.storage.local["settings"].modeForms[mode].
// getEffectiveFormConfig(mode) deep-merges DEFAULT_FORM_CONFIG[mode] with user
// overrides — empty user override = inherit default.
//
// Sub-fields per panel are declared but not yet user-editable in the v0.4.0
// MVP UI. Schema is here so v0.5.0 can expand panel rows in the form builder
// without a migration.
(function () {
  const COMMON_FIELDS = [
    { id: 'title',       label: 'Title',                always: true },     // always visible — core
    { id: 'severity',    label: 'Severity',             always: true },
    { id: 'type',        label: 'Issue type' },
    { id: 'element',     label: 'Element selector(s)' },                    // picked element list
    { id: 'computed',    label: 'Computed (actual) CSS' },                  // browser-read CSS values
    { id: 'note',        label: 'Note (free text)' },
    { id: 'expectedCss', label: 'Expected CSS rows' },
    { id: 'figmaLink',   label: 'Figma link' },
    { id: 'screenshots', label: 'Screenshots' }
  ];

  // Sub-fields per panel — declared so the form builder UI can show them in
  // expand-rows. Order matters; matches panel.render order.
  const PANEL_FIELDS = {
    'runtime-context': [
      { id: 'reproSteps',   label: 'Steps to reproduce' },
      { id: 'expected',     label: 'Expected behavior' },
      { id: 'actual',       label: 'Actual behavior' }
    ],
    'design-fidelity': [
      { id: 'mismatchCategory', label: 'Mismatch category' },
      { id: 'notes',            label: 'Implementation notes' }
    ],
    'app-state': [
      { id: 'role',             label: 'User role' },
      { id: 'tenantId',         label: 'Tenant / account ID' },
      { id: 'actionAttempted',  label: 'Action attempted' },
      { id: 'formPayload',      label: 'Form payload' }
    ],
    'a11y-findings': [
      { id: 'selectedRule',      label: 'WCAG rule' },
      { id: 'affectedUserGroup', label: 'Affected user group' },
      { id: 'fixSuggestion',     label: 'Fix suggestion' }
    ],
    'i18n-findings': [
      { id: 'locale',         label: 'Locale' },
      { id: 'direction',      label: 'Direction (LTR/RTL)' },
      { id: 'i18nKey',        label: 'i18n key' },
      { id: 'bugCategory',    label: 'Bug category' },
      { id: 'sourceString',   label: 'Source string' },
      { id: 'renderedString', label: 'Rendered string' },
      { id: 'linguisticOrTechnical', label: 'Type (linguistic / technical)' }
    ],
    'pin-notes': [
      { id: 'allPinNotes',    label: 'Pin notes (all pins)' }
    ]
  };

  // DEFAULT_FORM_CONFIG — the "factory" config for each mode. Defaults reflect
  // research-backed minimum viable fields per mode (see Sprint 2 research).
  const DEFAULT_FORM_CONFIG = {
    'prod-bug': {
      fields: {
        title: 'required',  severity: 'required',  type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'hidden', figmaLink: 'hidden',
        screenshots: 'optional'
      },
      panels: {
        'runtime-context': { state: 'required', fields: { reproSteps: 'required', expected: 'optional', actual: 'optional' } },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    },
    'design-fidelity': {
      fields: {
        title: 'required',  severity: 'optional', type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'optional', figmaLink: 'optional',
        screenshots: 'required'
      },
      panels: {
        'design-fidelity': { state: 'required', fields: { mismatchCategory: 'required', notes: 'optional' } },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    },
    'admin': {
      fields: {
        title: 'required',  severity: 'required',  type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'hidden', figmaLink: 'hidden',
        screenshots: 'optional'
      },
      panels: {
        'runtime-context': { state: 'optional', fields: { reproSteps: 'required', expected: 'optional', actual: 'optional' } },
        'app-state':       { state: 'required', fields: { role: 'required', tenantId: 'optional', actionAttempted: 'required', formPayload: 'optional' } },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    },
    'a11y': {
      fields: {
        title: 'required',  severity: 'required',  type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'hidden', figmaLink: 'hidden',
        screenshots: 'optional'
      },
      panels: {
        'a11y-findings':   { state: 'required', fields: { selectedRule: 'optional', affectedUserGroup: 'optional', fixSuggestion: 'required' } },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    },
    'i18n': {
      fields: {
        title: 'required',  severity: 'optional',  type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'hidden', figmaLink: 'hidden',
        screenshots: 'optional'
      },
      panels: {
        'i18n-findings':   { state: 'required', fields: { locale: 'optional', direction: 'optional', bugCategory: 'required', sourceString: 'optional', renderedString: 'optional', linguisticOrTechnical: 'optional', i18nKey: 'optional' } },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    },
    'custom': {
      // Custom mode is fully user-driven. Default = everything visible & optional.
      fields: {
        title: 'required',  severity: 'required',  type: 'optional',
        element: 'optional', computed: 'optional',
        note: 'optional',   expectedCss: 'optional', figmaLink: 'optional',
        screenshots: 'optional'
      },
      panels: {
        'runtime-context': { state: 'optional', fields: {} },
        'design-fidelity': { state: 'optional', fields: {} },
        'app-state':       { state: 'optional', fields: {} },
        'a11y-findings':   { state: 'optional', fields: {} },
        'i18n-findings':   { state: 'optional', fields: {} },
        'pin-notes':       { state: 'optional', fields: {} }
      }
    }
  };

  // Deep-merge user override onto default. Treats string values as terminals
  // (not merge-able) so { 'title': 'required' } overwrite cleanly.
  function mergeConfig(defaults, override) {
    if (!override || typeof override !== 'object') return defaults;
    const out = JSON.parse(JSON.stringify(defaults));
    if (override.fields) {
      out.fields = { ...out.fields, ...override.fields };
    }
    if (override.panels) {
      for (const [pid, pcfg] of Object.entries(override.panels)) {
        if (!out.panels[pid]) out.panels[pid] = { state: 'optional', fields: {} };
        if (pcfg.state) out.panels[pid].state = pcfg.state;
        if (pcfg.fields) out.panels[pid].fields = { ...out.panels[pid].fields, ...pcfg.fields };
      }
    }
    return out;
  }

  // Public resolver. Reads default + user override, returns merged config.
  // Settings is passed in (not read from chrome.storage) so this is sync and
  // works in both content + settings contexts.
  function getEffectiveFormConfig(mode, settings) {
    const m = mode || 'custom';
    const def = DEFAULT_FORM_CONFIG[m] || DEFAULT_FORM_CONFIG.custom;
    const userOverride = settings?.modeForms?.[m] || null;
    return mergeConfig(def, userOverride);
  }

  // Convenience: visible field ids only (for form-modal conditional render).
  function visibleFields(config) {
    const out = [];
    for (const [id, state] of Object.entries(config.fields || {})) {
      if (state !== 'hidden') out.push(id);
    }
    return out;
  }

  function requiredFields(config) {
    const out = [];
    for (const [id, state] of Object.entries(config.fields || {})) {
      if (state === 'required') out.push(id);
    }
    return out;
  }

  function visiblePanels(config) {
    const out = [];
    for (const [id, p] of Object.entries(config.panels || {})) {
      if (p.state !== 'hidden') out.push(id);
    }
    return out;
  }

  function requiredPanels(config) {
    const out = [];
    for (const [id, p] of Object.entries(config.panels || {})) {
      if (p.state === 'required') out.push(id);
    }
    return out;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.formConfig = {
    DEFAULT_FORM_CONFIG,
    COMMON_FIELDS,
    PANEL_FIELDS,
    getEffectiveFormConfig,
    visibleFields,
    requiredFields,
    visiblePanels,
    requiredPanels,
    mergeConfig
  };
})();
