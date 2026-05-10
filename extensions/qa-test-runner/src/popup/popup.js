// Popup logic — file picker for the QA report, run-recheck button, result UI.
//
// Flow:
//   1. User picks file (.zip or .json export from qa-annotator)
//   2. We parse → cache the report object in popup-local memory
//   3. User clicks "Re-check on this tab"
//   4. We send ISSUE_RECHECK_RUN to the active tab's content script
//   5. Content script returns qa-recheck-v1 result; we render the list
//   6. User can expand any row for per-property detail OR export the result
//      as JSON for archival.
(function () {
  const MSG = (window.QA && window.QA.MSG) || {};
  const $ = (id) => document.getElementById(id);

  let cachedReport = null;
  let lastResult = null;

  $('report-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      cachedReport = await readReportFromFile(file);
      const issues = cachedReport?.report?.issues || [];
      $('run-recheck').disabled = issues.length === 0;
      const summary = `Loaded ${issues.length} issue${issues.length === 1 ? '' : 's'} from ${escape(file.name)}`;
      flash(summary, issues.length > 0 ? 'info' : 'warn');
    } catch (err) {
      cachedReport = null;
      $('run-recheck').disabled = true;
      flash(`Couldn't parse report: ${err.message || err}`, 'fail');
    }
  });

  $('run-recheck').addEventListener('click', async () => {
    if (!cachedReport) return;
    $('run-recheck').disabled = true;
    $('run-recheck').textContent = 'Re-checking…';
    try {
      const tab = await activeTab();
      const resp = await sendToTab(tab.id, {
        type: MSG.ISSUE_RECHECK_RUN,
        payload: { report: cachedReport }
      });
      if (!resp || resp.error) {
        flash(`Re-check failed: ${resp?.error || 'no response'}. Reload the tab and try again.`, 'fail');
        return;
      }
      lastResult = resp.result;
      renderResult(lastResult);
    } catch (e) {
      flash(`Couldn't reach the page: ${e.message || e}. Make sure the tab is loaded and not chrome://.`, 'fail');
    } finally {
      $('run-recheck').disabled = false;
      $('run-recheck').textContent = 'Re-check on this tab';
    }
  });

  $('export-result').addEventListener('click', () => {
    if (!lastResult) return;
    const blob = new Blob([JSON.stringify({ $schema: 'qa-recheck-v1', ...lastResult }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qa-recheck-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ── helpers ─────────────────────────────────────────────────────

  async function readReportFromFile(file) {
    const lower = (file.name || '').toLowerCase();
    if (lower.endsWith('.json')) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      assertReportShape(parsed);
      return parsed;
    }
    if (lower.endsWith('.zip')) {
      if (!window.QA?.zipStore?.parseZip) {
        throw new Error('zipStore not loaded');
      }
      const entries = await window.QA.zipStore.parseZip(file);
      const jsonEntry = entries.find((e) => /qa-report.*\.json$/i.test(e.path) || e.path.endsWith('.json'));
      if (!jsonEntry) throw new Error('No qa-report*.json found inside the ZIP');
      const text = new TextDecoder('utf-8').decode(jsonEntry.data);
      const parsed = JSON.parse(text);
      assertReportShape(parsed);
      return parsed;
    }
    throw new Error('Unsupported file extension. Use .json or .zip.');
  }

  function assertReportShape(obj) {
    if (!obj || obj.$schema !== 'qa-report-v1') {
      throw new Error('File is not a qa-report-v1 (missing or wrong $schema)');
    }
    if (!obj.report || !Array.isArray(obj.report.issues)) {
      throw new Error('Malformed report — report.issues missing');
    }
  }

  async function activeTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t) throw new Error('no active tab');
    return t;
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  function renderResult(result) {
    $('result-block').hidden = false;
    const counts = result.counts || {};
    const total = counts.total || 0;
    const fixed   = counts.FIXED || 0;
    const broken  = counts.STILL_BROKEN || 0;
    const stale   = counts.STALE_SELECTOR || 0;
    const oos     = counts.OUT_OF_SCOPE || 0;
    const noExp   = counts.NO_EXPECTED || 0;
    $('result-summary').textContent =
      `${fixed} fixed · ${broken} still broken · ${stale} stale · ${oos} out-of-scope · ${noExp} no-expected`;

    const list = $('result-list');
    list.innerHTML = '';
    for (const r of result.results) {
      list.appendChild(renderRow(r));
    }
    $('export-result').disabled = false;
  }

  function renderRow(r) {
    const li = document.createElement('li');
    const verdict = r.verdict || 'UNKNOWN';
    const expandable = !!(r.props && r.props.length);
    li.innerHTML = `
      <span class="verdict-chip verdict-${escape(verdict)}" title="${escape(verdict)}">${escape(verdictShort(verdict))}</span>
      <div class="issue-meta">
        <div class="id-title">
          <span class="id">${escape(r.issueId || '?')}</span>
          <span class="title">${escape(r.title || '(untitled)')}</span>
        </div>
        ${r.reason ? `<div class="reason">${escape(r.reason)}</div>` : ''}
      </div>
      ${expandable ? `<button class="expand-toggle" title="Show per-property detail">▾</button>` : ''}
    `;
    if (expandable) {
      const toggle = li.querySelector('.expand-toggle');
      toggle.addEventListener('click', () => {
        const open = li.classList.toggle('expanded');
        toggle.textContent = open ? '▴' : '▾';
        let table = li.querySelector('.props-table');
        if (open && !table) {
          table = buildPropsTable(r.props);
          li.appendChild(table);
        } else if (!open && table) {
          table.remove();
        }
      });
    }
    return li;
  }

  function buildPropsTable(props) {
    const t = document.createElement('table');
    t.className = 'props-table';
    t.innerHTML = `
      <thead>
        <tr><th>Property</th><th>Expected</th><th>Current</th></tr>
      </thead>
      <tbody>
        ${props.map((p) => `
          <tr>
            <td><code>${escape(p.prop)}</code></td>
            <td class="${p.match ? 'match' : 'mismatch'}"><code>${escape(p.expected ?? '')}</code></td>
            <td class="${p.match ? 'match' : 'mismatch'}"><code>${escape(p.current ?? '')}</code></td>
          </tr>
        `).join('')}
      </tbody>
    `;
    return t;
  }

  function verdictShort(v) {
    return ({
      FIXED: 'FIXED',
      STILL_BROKEN: 'BROKEN',
      REGRESSED: 'REGRESS',
      STALE_SELECTOR: 'STALE',
      OUT_OF_SCOPE: 'OUT-SCOPE',
      PARTIAL: 'PARTIAL',
      NO_EXPECTED: 'NO-EXP'
    })[v] || v;
  }

  function flash(text, _kind) {
    // Inline status — repurpose result summary slot when no result yet.
    const block = $('result-block');
    block.hidden = false;
    $('result-summary').textContent = text;
    if (!lastResult) {
      $('result-list').innerHTML = '';
      $('export-result').disabled = true;
    }
  }

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();
