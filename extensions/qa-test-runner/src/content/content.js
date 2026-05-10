// Content script — runs in the page's isolated world. Receives messages from
// popup / background and executes them against this tab's DOM.
//
// v0.1.0 ships only the issue-recheck path. recorder/player still placeholders.
(function () {
  if (window.__qaTestRunnerLoaded) return;
  window.__qaTestRunnerLoaded = true;

  const MSG = (window.QA && window.QA.MSG) || {};

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === MSG.ISSUE_RECHECK_RUN) {
      // Re-check the report against the current page synchronously — no async
      // work, just selector resolution + getComputedStyle reads. Returns the
      // qa-recheck-v1 result object.
      try {
        const report = message.payload?.report;
        if (!report) {
          sendResponse({ error: 'missing report payload' });
          return false;
        }
        if (!window.QA?.issueRecheck?.checkAll) {
          sendResponse({ error: 'issueRecheck module not loaded' });
          return false;
        }
        const result = window.QA.issueRecheck.checkAll(report, location.href);
        // Per-verdict counts the engine left for the caller.
        result.counts = aggregateCounts(result.results);
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ error: String(e?.message || e) });
      }
      return false;  // sync response
    }

    return false;
  });

  function aggregateCounts(results) {
    const out = { total: results.length };
    for (const r of results) {
      out[r.verdict] = (out[r.verdict] || 0) + 1;
    }
    return out;
  }
})();
