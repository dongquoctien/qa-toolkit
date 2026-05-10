// Runtime context panel — prod-bug + admin modes.
//
// Two halves: USER FIELDS (repro steps + expected vs actual) and AUTO DATA
// (console errors + network failures + browser env, captured at pick time
// by the Sprint 1 runtime buffer). User fields are editable and persist into
// issue.panels['runtime-context']; auto data is read-only and lives on
// issue.runtimeContext (set by content.js before the modal opens).
//
// Research-backed MVP per Atlassian / Chromium / Sentry templates:
//   1. Steps to reproduce (numbered list, top-of-form because it's the
//      single most-skipped field — putting it first nudges completion).
//   2. Expected behavior (one short sentence)
//   3. Actual behavior (one short sentence)
//   4. Auto-attached: console (last 50), network (last 20 ≥400), env.
(function () {
  const PANEL_ID = 'runtime-context';

  // Always show in prod-bug and admin modes — even when there are no console
  // errors / network failures, the user still wants to write the repro steps.
  function isAvailable(_issue) { return true; }

  function getData(issue) {
    return (issue.panels && issue.panels[PANEL_ID]) || {};
  }

  function render(issue) {
    const data = getData(issue);
    const steps = Array.isArray(data.reproSteps) && data.reproSteps.length ? data.reproSteps : [''];
    const expected = data.expected || '';
    const actual = data.actual || '';
    const rc = issue.runtimeContext;

    const stepRows = steps.map((s, i) => stepRowHtml(i + 1, s)).join('');

    const consoleBlock = (rc?.console?.length)
      ? renderConsoleList(rc.console)
      : '';
    const networkBlock = (rc?.network?.length)
      ? renderNetworkList(rc.network)
      : '';
    const envLine = rc?.env
      ? `<div class="qa-rcp-env"><strong>Env:</strong> ${escapeHtml(rc.env.userAgent || 'unknown UA')} · viewport ${rc.env.viewport?.w || '?'}×${rc.env.viewport?.h || '?'}@${rc.env.viewport?.dpr || 1}x · lang ${escapeHtml(rc.env.language || '')}</div>`
      : '';

    return `
      <div class="qa-rcp">
        <div class="qa-rcp-section">
          <label class="qa-rcp-label">Steps to reproduce</label>
          <ol class="qa-rcp-steps">${stepRows}</ol>
          <button type="button" class="qa-rcp-add-step qa-link-btn">+ Add step</button>
        </div>

        <div class="qa-rcp-row">
          <div class="qa-rcp-col">
            <label class="qa-rcp-label">Expected behavior</label>
            <textarea class="qa-rcp-expected" rows="2" placeholder="What should happen">${escapeHtml(expected)}</textarea>
          </div>
          <div class="qa-rcp-col">
            <label class="qa-rcp-label">Actual behavior</label>
            <textarea class="qa-rcp-actual" rows="2" placeholder="What happened">${escapeHtml(actual)}</textarea>
          </div>
        </div>

        ${(consoleBlock || networkBlock || envLine) ? `
          <div class="qa-rcp-auto">
            <div class="qa-rcp-auto-head">
              <span>Auto-attached</span>
              <span class="qa-rcp-auto-tag">captured at pick time</span>
            </div>
            ${consoleBlock}
            ${networkBlock}
            ${envLine}
          </div>
        ` : `
          <div class="qa-rcp-auto-empty">
            <small>No console errors or network failures captured. Enable in Settings → Capture sources.</small>
          </div>
        `}
      </div>
    `;
  }

  function stepRowHtml(num, value) {
    return `
      <li class="qa-rcp-step">
        <span class="qa-rcp-step-num">${num}</span>
        <input type="text" class="qa-rcp-step-input" placeholder="What did you do?" value="${escapeAttr(value)}" />
        <button type="button" class="qa-rcp-step-remove" aria-label="Remove step" title="Remove">×</button>
      </li>
    `;
  }

  function renderConsoleList(items) {
    const preview = items.slice(0, 5).map((c) => {
      const lvl = c.level === 'error' ? '✗' : '⚠';
      return `<li><span class="qa-rcp-lvl qa-rcp-lvl-${escapeAttr(c.level || 'warn')}">${lvl} ${escapeHtml(c.level || '')}</span> <code>${escapeHtml((c.message || '').slice(0, 200))}</code></li>`;
    }).join('');
    const more = items.length > 5 ? `<li class="qa-rcp-more">+${items.length - 5} more</li>` : '';
    return `
      <div class="qa-rcp-block">
        <div class="qa-rcp-block-head">Console — ${items.length}</div>
        <ul class="qa-rcp-list">${preview}${more}</ul>
      </div>
    `;
  }

  function renderNetworkList(items) {
    const preview = items.slice(0, 5).map((n) => {
      const cls = n.status >= 500 ? 'qa-rcp-status-5xx' : n.status >= 400 ? 'qa-rcp-status-4xx' : 'qa-rcp-status-fail';
      return `<li><span class="qa-rcp-status ${cls}">${n.status || 'ERR'}</span> <code>${escapeHtml((n.method || '') + ' ' + (n.url || '').slice(0, 120))}</code> <small class="qa-muted">${n.durationMs || 0}ms</small></li>`;
    }).join('');
    const more = items.length > 5 ? `<li class="qa-rcp-more">+${items.length - 5} more</li>` : '';
    return `
      <div class="qa-rcp-block">
        <div class="qa-rcp-block-head">Network failures — ${items.length}</div>
        <ul class="qa-rcp-list">${preview}${more}</ul>
      </div>
    `;
  }

  function mount(panelEl, issue, onChange) {
    const fire = () => { if (onChange) onChange(); };

    // Add-step button.
    const addBtn = panelEl.querySelector('.qa-rcp-add-step');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const list = panelEl.querySelector('.qa-rcp-steps');
        const num = list.querySelectorAll('.qa-rcp-step').length + 1;
        const li = document.createElement('li');
        li.innerHTML = stepRowHtml(num, '').trim().replace(/^<li[^>]*>|<\/li>$/g, '');
        li.className = 'qa-rcp-step';
        list.appendChild(li);
        li.querySelector('.qa-rcp-step-input')?.focus();
        fire();
      });
    }

    // Remove-step (event delegation — works for dynamically added rows).
    panelEl.addEventListener('click', (e) => {
      const remBtn = e.target.closest && e.target.closest('.qa-rcp-step-remove');
      if (!remBtn) return;
      const li = remBtn.closest('.qa-rcp-step');
      if (!li) return;
      const list = li.parentElement;
      // Don't remove the last row — clear it instead so the user always has at least one input.
      if (list.querySelectorAll('.qa-rcp-step').length <= 1) {
        const inp = li.querySelector('.qa-rcp-step-input');
        if (inp) inp.value = '';
      } else {
        li.remove();
        // Renumber.
        list.querySelectorAll('.qa-rcp-step').forEach((step, i) => {
          const num = step.querySelector('.qa-rcp-step-num');
          if (num) num.textContent = String(i + 1);
        });
      }
      fire();
    });

    // Forward textarea / input changes upward (for future dirty-state markers).
    panelEl.addEventListener('input', fire);

    return () => { /* event listeners are auto-cleaned when panelEl removes from DOM */ };
  }

  function harvest(panelEl, _issue) {
    const reproSteps = [...panelEl.querySelectorAll('.qa-rcp-step-input')]
      .map((i) => (i.value || '').trim())
      .filter(Boolean);
    const expected = panelEl.querySelector('.qa-rcp-expected')?.value?.trim() || '';
    const actual = panelEl.querySelector('.qa-rcp-actual')?.value?.trim() || '';
    return { reproSteps, expected, actual };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  const panel = {
    id: PANEL_ID,
    title: 'Runtime context',
    modes: ['prod-bug', 'admin'],
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
