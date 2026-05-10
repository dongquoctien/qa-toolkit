// Panel registry — orchestrates mode-aware modal panels.
//
// Each panel module attaches to QA.panels.<id> via IIFE. The registry imports
// them by name from the global QA namespace at runtime (load order matters —
// panels MUST be in manifest content_scripts before this file).
//
// Panel contract:
//   {
//     id: 'runtime-context',
//     title: 'Runtime context',
//     modes: ['prod-bug', 'admin'],          // primary modes (controls default visibility)
//     defaultCollapsed: false,                // start collapsed even when shown
//     isAvailable(issue): bool,               // hide if no data applies
//     render(issue): string (HTML),
//     mount(panelEl, issue, onChange): cleanupFn,
//     harvest(panelEl, issue): object        // returns the new issue.panels[id] value
//   }
//
// Mode → panels map drives default panel set. Custom mode reads
// settings.customPanels[] (user-saved preset). Within any mode, modal
// expand-on-click works for any registered panel — so user can pull in a
// non-default panel for one issue without changing settings.
(function () {
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};

  const PANEL_MAP = {
    'prod-bug':        ['runtime-context', 'pin-notes'],
    'design-fidelity': ['design-fidelity', 'pin-notes'],
    'admin':           ['app-state', 'runtime-context', 'pin-notes'],
    'a11y':            ['a11y-findings', 'pin-notes'],
    'i18n':            ['i18n-findings', 'pin-notes'],
    'custom':          [] // resolved from settings.customPanels[] at render time
  };

  // Order panels appear in the modal — controls visual top-to-bottom layout.
  // Pin notes always last so the user sees mode-specific data above it.
  const PANEL_ORDER = [
    'runtime-context',
    'design-fidelity',
    'app-state',
    'a11y-findings',
    'i18n-findings',
    'pin-notes'
  ];

  function listAll() {
    const panels = target.QA.panels || {};
    return PANEL_ORDER.map((id) => panels[id]).filter(Boolean);
  }

  function panelsForMode(mode, settings) {
    const all = listAll();
    // Sprint 3: form config takes precedence. If formConfig is loaded, use
    // its panels[].state to drive visibility. Falls back to legacy MODE_MAP
    // when form-config module isn't loaded yet.
    const fc = target.QA?.formConfig;
    if (fc?.getEffectiveFormConfig) {
      const cfg = fc.getEffectiveFormConfig(mode || 'custom', settings || {});
      const visible = new Set();
      for (const [pid, p] of Object.entries(cfg.panels || {})) {
        if (p.state !== 'hidden') visible.add(pid);
      }
      return all.filter((p) => visible.has(p.id));
    }
    // Legacy fallback (Sprint 2)
    if (mode === 'custom') {
      const preset = (settings?.customPanels && settings.customPanels.length)
        ? settings.customPanels
        : PANEL_ORDER;
      return all.filter((p) => preset.includes(p.id));
    }
    const ids = PANEL_MAP[mode] || [];
    return all.filter((p) => ids.includes(p.id));
  }

  // Render panel shells. Each panel sits in its own collapsible <section>.
  // Headers are clickable to toggle collapsed state. The body is whatever the
  // panel.render returns — registry doesn't validate content.
  function renderPanels(issue, settings) {
    const mode = settings?.mode || 'custom';
    const panels = panelsForMode(mode, settings);
    if (panels.length === 0) return '';
    return panels.map((p) => {
      if (p.isAvailable && !p.isAvailable(issue)) return '';
      const collapsed = !!p.defaultCollapsed;
      return `
        <section class="qa-panel" data-panel-id="${escapeHtml(p.id)}"${collapsed ? ' data-collapsed="1"' : ''}>
          <header class="qa-panel-head">
            <h3 class="qa-panel-title">${escapeHtml(p.title)}</h3>
            <button type="button" class="qa-panel-toggle" aria-label="Toggle panel">${collapsed ? '▸' : '▾'}</button>
          </header>
          <div class="qa-panel-body">${p.render(issue) || ''}</div>
        </section>
      `;
    }).join('');
  }

  // Mount every visible panel and return a single cleanup that detaches all of
  // them. onChange is forwarded so panels can mark issue dirty (future use).
  function mountAll(containerEl, issue, settings, onChange) {
    const mode = settings?.mode || 'custom';
    const panels = panelsForMode(mode, settings);
    const cleanups = [];
    for (const p of panels) {
      if (p.isAvailable && !p.isAvailable(issue)) continue;
      const panelEl = containerEl.querySelector(`.qa-panel[data-panel-id="${cssEscape(p.id)}"]`);
      if (!panelEl) continue;
      // Toggle behavior — clicking header collapses/expands.
      const head = panelEl.querySelector('.qa-panel-head');
      const toggleBtn = panelEl.querySelector('.qa-panel-toggle');
      const onToggle = () => {
        const isCollapsed = panelEl.dataset.collapsed === '1';
        if (isCollapsed) {
          delete panelEl.dataset.collapsed;
          if (toggleBtn) toggleBtn.textContent = '▾';
        } else {
          panelEl.dataset.collapsed = '1';
          if (toggleBtn) toggleBtn.textContent = '▸';
        }
      };
      head.addEventListener('click', onToggle);
      cleanups.push(() => head.removeEventListener('click', onToggle));

      // Panel-specific mount.
      if (typeof p.mount === 'function') {
        try {
          const panelBody = panelEl.querySelector('.qa-panel-body');
          const cleanup = p.mount(panelBody, issue, onChange);
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        } catch (e) {
          console.warn(`[QA] panel ${p.id} mount failed`, e);
        }
      }
    }
    return () => cleanups.forEach((fn) => { try { fn(); } catch {} });
  }

  // Read all visible panels back into a `panels` object that the modal merges
  // into issue at save time.
  function harvestAll(containerEl, issue, settings) {
    const mode = settings?.mode || 'custom';
    const panels = panelsForMode(mode, settings);
    const out = { ...(issue.panels || {}) };
    for (const p of panels) {
      if (p.isAvailable && !p.isAvailable(issue)) continue;
      const panelEl = containerEl.querySelector(`.qa-panel[data-panel-id="${cssEscape(p.id)}"]`);
      if (!panelEl) continue;
      if (typeof p.harvest === 'function') {
        try {
          const panelBody = panelEl.querySelector('.qa-panel-body');
          const value = p.harvest(panelBody, issue);
          if (value !== undefined) out[p.id] = value;
        } catch (e) {
          console.warn(`[QA] panel ${p.id} harvest failed`, e);
        }
      }
    }
    return out;
  }

  // List every registered panel's id — used by the settings page to render the
  // "Custom mode panels" checkbox grid.
  function listPanelIds() {
    return listAll().map((p) => ({ id: p.id, title: p.title, modes: p.modes || [] }));
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // CSS.escape isn't available in some older runtimes — fall back to a small
  // replacement that handles `[]`, `.`, `:` and digits.
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^\w-]/g, (c) => '\\' + c);
  }

  target.QA.panelRegistry = {
    register(panel) {
      if (!panel || !panel.id) return;
      target.QA.panels = target.QA.panels || {};
      target.QA.panels[panel.id] = panel;
    },
    panelsForMode,
    renderPanels,
    mountAll,
    harvestAll,
    listPanelIds,
    PANEL_MAP,
    PANEL_ORDER
  };
})();
