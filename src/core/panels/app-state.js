// App state panel — admin mode.
//
// Captures the runtime context that admin / CMS bugs need to reproduce:
// who the user is (role), which tenant/account they're acting on, what they
// were trying to do, and the live UI state at click time. Internal-tool bug
// templates (Payload CMS, Strapi, Magento admin) converge on this shape.
//
// Auto-detected (read-only):
//   - route        — location.pathname (set by content.js at issue-build)
//   - openModal    — `[role=dialog][data-id], .modal[data-id]` if any
//   - tableState   — `.data-table[data-sort], data-filter` if any
//
// User-edited (persists into issue.panels['app-state']):
//   - role         — text input (auto-prefilled from data-user-role attr if present)
//   - tenantId     — text input
//   - actionAttempted — text input ("Trying to save user 123")
//   - formPayload  — textarea (often pasted JSON of the form being submitted)
(function () {
  const PANEL_ID = 'app-state';

  function isAvailable(_issue) { return true; }

  function getData(issue) {
    return (issue.panels && issue.panels[PANEL_ID]) || {};
  }

  // Auto-detect from the current page DOM at render time. Selectors come from
  // settings.appStateSelectors when available so admins can tune them per
  // project, but we ship sensible defaults.
  function detectFromDom() {
    const selectors = (self.QA?._liveSettings?.appStateSelectors) || {
      role:      '[data-user-role]',
      tenant:    '[data-tenant-id]',
      modal:     '[role=dialog][data-id], .modal[data-id]',
      table:     '.data-table[data-sort], [data-table-state]'
    };
    const out = {};
    try {
      const roleEl = document.querySelector(selectors.role);
      if (roleEl) out.detectedRole = roleEl.getAttribute('data-user-role') || roleEl.textContent.trim().slice(0, 80);
      const tenantEl = document.querySelector(selectors.tenant);
      if (tenantEl) out.detectedTenant = tenantEl.getAttribute('data-tenant-id') || tenantEl.textContent.trim().slice(0, 80);
      const modalEl = document.querySelector(selectors.modal);
      if (modalEl) out.openModal = (modalEl.getAttribute('data-id') || modalEl.getAttribute('aria-label') || '').slice(0, 120);
      const tableEl = document.querySelector(selectors.table);
      if (tableEl) {
        out.tableState = ['data-sort', 'data-filter', 'data-page'].map((a) => {
          const v = tableEl.getAttribute(a);
          return v ? `${a.replace('data-', '')}=${v}` : null;
        }).filter(Boolean).join(', ');
      }
    } catch { /* selectors might be malformed — ignore */ }
    out.route = location.pathname + location.search;
    return out;
  }

  function render(issue) {
    const data = getData(issue);
    const auto = data.auto || detectFromDom();
    const role = data.role || auto.detectedRole || '';
    const tenantId = data.tenantId || auto.detectedTenant || '';
    const action = data.actionAttempted || '';
    const formPayload = data.formPayload || '';

    const autoLine = `
      <div class="qa-as-auto">
        <div><strong>Route:</strong> <code>${escapeHtml(auto.route || '')}</code></div>
        ${auto.openModal ? `<div><strong>Open modal:</strong> <code>${escapeHtml(auto.openModal)}</code></div>` : ''}
        ${auto.tableState ? `<div><strong>Table state:</strong> <code>${escapeHtml(auto.tableState)}</code></div>` : ''}
      </div>
    `;

    return `
      <div class="qa-as">
        <div class="qa-as-grid">
          <label class="qa-as-field">
            <span>User role</span>
            <input type="text" class="qa-as-role" value="${escapeAttr(role)}" placeholder="super-admin / operator / viewer" />
          </label>
          <label class="qa-as-field">
            <span>Tenant / account ID</span>
            <input type="text" class="qa-as-tenant" value="${escapeAttr(tenantId)}" placeholder="omh / 1234" />
          </label>
          <label class="qa-as-field qa-as-span-2">
            <span>Action attempted</span>
            <input type="text" class="qa-as-action" value="${escapeAttr(action)}" placeholder="e.g. Trying to save user 123 with new email" />
          </label>
          <label class="qa-as-field qa-as-span-2">
            <span>Form payload <small class="qa-muted">(optional, paste JSON to capture the request body)</small></span>
            <textarea class="qa-as-payload" rows="3" placeholder='{ "email": "new@…", "role": "admin" }'>${escapeHtml(formPayload)}</textarea>
          </label>
        </div>
        ${autoLine}
      </div>
    `;
  }

  function mount(panelEl, _issue, onChange) {
    const fire = () => { if (onChange) onChange(); };
    panelEl.addEventListener('input', fire);
    return () => { /* no manual listeners */ };
  }

  function harvest(panelEl, _issue) {
    const role = panelEl.querySelector('.qa-as-role')?.value?.trim() || '';
    const tenantId = panelEl.querySelector('.qa-as-tenant')?.value?.trim() || '';
    const actionAttempted = panelEl.querySelector('.qa-as-action')?.value?.trim() || '';
    const formPayload = panelEl.querySelector('.qa-as-payload')?.value?.trim() || '';
    const auto = detectFromDom();
    return { role, tenantId, actionAttempted, formPayload, auto };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'App state',
    modes: ['admin'],
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
