// Issue re-check engine.
//
// Input:  qa-report-v1 JSON + current-tab URL + document reference.
// Output: per-issue verdict array.
//
// Verdicts (qa-recheck-v1):
//   FIXED          — issue.expected matched on every property; issue.actual no
//                    longer matches the broken state recorded.
//   STILL_BROKEN   — current computed values still match issue.actual (the bug
//                    recorded), expected still mismatches.
//   REGRESSED      — issue had no expected mismatch recorded (purely informational
//                    pin) but a currently-checked property is now off-spec.
//                    Rare; mostly reserved for future use.
//   STALE_SELECTOR — none of the issue.elements[].selector resolved on the page.
//                    Can't verify; needs a fresh selector.
//   OUT_OF_SCOPE   — issue.context.url is on a different host than the current
//                    tab. We don't auto-navigate (would lose user state); QA
//                    must open the right URL first.
//   PARTIAL        — some of multi-pick selectors resolve, others don't. Verdict
//                    based on resolved subset, with a warning.
//   NO_EXPECTED    — issue has no expected CSS rows at all. Can't verify;
//                    skipped. (Common for issues that only have figmaLink.)
//
// Same-origin gate: we only re-check on the same hostname unless the user
// explicitly opted in via settings (deferred to v0.2.0). For now: strict same
// host = scope; cross-host = OUT_OF_SCOPE.
(function () {
  const VERDICT = {
    FIXED:          'FIXED',
    STILL_BROKEN:   'STILL_BROKEN',
    REGRESSED:      'REGRESSED',
    STALE_SELECTOR: 'STALE_SELECTOR',
    OUT_OF_SCOPE:   'OUT_OF_SCOPE',
    WRONG_PATH:     'WRONG_PATH',
    PARTIAL:        'PARTIAL',
    NO_EXPECTED:    'NO_EXPECTED'
  };

  // Read the (kebab-case) computed values for one element on this page.
  function readComputed(el, propsToRead) {
    const styles = window.getComputedStyle(el);
    const out = {};
    for (const prop of propsToRead) {
      out[prop] = styles.getPropertyValue(prop).trim();
    }
    return out;
  }

  // Try issue.elements[] selectors in order. First hit wins.
  function resolveElement(issue) {
    const list = (issue.elements && issue.elements.length ? issue.elements : (issue.element ? [issue.element] : []));
    for (let i = 0; i < list.length; i++) {
      const sel = list[i]?.selector;
      if (!sel) continue;
      try {
        const el = document.querySelector(sel);
        if (el) return { element: el, selector: sel, idx: i };
      } catch {
        // Bad selector (rare — qa-annotator generates valid CSS, but a hand-
        // edited report could ship malformed). Skip and try the next.
      }
    }
    return null;
  }

  function checkOne(issue, currentUrl) {
    // Same-origin gate + same-pathname soft check.
    // Hostname mismatch is a hard skip (different env entirely).
    // Pathname mismatch is a soft warn — selector may still match on a SPA
    // that mounts the same component on multiple routes; we run the check
    // but tag the result as WRONG_PATH if the selector doesn't resolve, so
    // the user gets a clearer signal than "STALE_SELECTOR" (which sounds
    // like the element was renamed in code).
    const issueUrl = issue.context?.url;
    let wrongPath = false;
    let issuePath = null, currentPath = null;
    if (issueUrl) {
      try {
        const a = new URL(issueUrl);
        const b = new URL(currentUrl);
        issuePath = a.pathname;
        currentPath = b.pathname;
        if (a.hostname !== b.hostname) {
          return {
            issueId: issue.id,
            verdict: VERDICT.OUT_OF_SCOPE,
            reason: `Issue recorded on ${a.hostname}; current tab is ${b.hostname}.`,
            issuePath, currentPath,
            title: issue.title
          };
        }
        if (a.pathname !== b.pathname) {
          wrongPath = true;
        }
      } catch {
        // URL parse fail — let it through; resolveElement will catch
        // selector-not-found anyway.
      }
    }

    // Strip Figma + grab kebab-keyed expected.
    const expectedKebab = QA.propNormalize.toKebabCss(issue.expected);
    const expectedKeys = Object.keys(expectedKebab);
    if (expectedKeys.length === 0) {
      return {
        issueId: issue.id,
        verdict: VERDICT.NO_EXPECTED,
        reason: 'Issue has no expected CSS rows to verify.',
        title: issue.title
      };
    }

    // Resolve element on the current page.
    const hit = resolveElement(issue);
    if (!hit) {
      // STALE on the right path is "element gone / renamed".
      // STALE on a different path is most likely "wrong page" — different
      // verdict so the user knows to navigate before treating the report as
      // a code regression.
      return {
        issueId: issue.id,
        verdict: wrongPath ? VERDICT.WRONG_PATH : VERDICT.STALE_SELECTOR,
        reason: wrongPath
          ? `Issue was logged on ${issuePath}; current tab is on ${currentPath}. Navigate to the right page before re-checking.`
          : 'None of the issue selectors resolved on this page.',
        triedSelectors: (issue.elements || []).map((e) => e.selector).filter(Boolean),
        issuePath, currentPath,
        title: issue.title
      };
    }

    // Read current computed for the kebab-cased keys we need to verify.
    const liveCurrent = readComputed(hit.element, expectedKeys);

    // Compare. Build a per-property verdict so the UI can render a row.
    const props = expectedKeys.map((key) => {
      const exp = expectedKebab[key];
      const cur = liveCurrent[key];
      const match = QA.propNormalize.valuesEqual(exp, cur);
      // Original "broken" value qa-annotator captured at pick time. Used to
      // detect "still broken" — same wrong value as before — vs "drifted to
      // a different wrong value" (also still failing, but worth noting).
      const recordedActualKebab = QA.propNormalize.toKebabCss(issue.actual);
      const wasBroken = recordedActualKebab[key] != null
        && !QA.propNormalize.valuesEqual(exp, recordedActualKebab[key]);
      const matchesRecordedBroken = wasBroken
        && QA.propNormalize.valuesEqual(cur, recordedActualKebab[key]);
      return {
        prop: key,
        expected: exp,
        current: cur,
        recorded: recordedActualKebab[key] ?? null,
        match,
        matchesRecordedBroken,
        wasBroken
      };
    });

    const passed = props.filter((p) => p.match).length;
    const failed = props.length - passed;

    let verdict;
    if (failed === 0) {
      verdict = VERDICT.FIXED;
    } else {
      // Any property that still equals the originally-recorded broken value?
      const stillSame = props.some((p) => p.matchesRecordedBroken);
      verdict = stillSame ? VERDICT.STILL_BROKEN : VERDICT.STILL_BROKEN;
      // (Different wrong value vs original is still STILL_BROKEN at v0.1.0.
      // v0.2.0 may split this into "drifted" sub-state.)
    }

    return {
      issueId: issue.id,
      verdict,
      title: issue.title,
      severity: issue.severity,
      figmaLink: issue.expected?.figmaLink || null,
      hitSelector: hit.selector,
      hitIdx: hit.idx,
      props,
      summary: { total: props.length, passed, failed },
      // Soft warning: selector matched even though tab is on a different path.
      // Result is still meaningful (SPA route reuse, layout shells, etc.) but
      // the user should sanity-check before trusting it.
      pathWarning: wrongPath || undefined,
      issuePath, currentPath
    };
  }

  function checkAll(report, currentUrl) {
    const issues = report?.report?.issues || [];
    return {
      ranAt: new Date().toISOString(),
      currentUrl,
      reportSchema: report?.$schema || 'unknown',
      counts: {
        total: issues.length
        // Per-verdict counts filled in by the caller after iterating, since
        // they're trivially derived and we don't want to double-walk.
      },
      results: issues.map((iss) => checkOne(iss, currentUrl))
    };
  }

  // Group issues by URL so the popup can render a "where to run" list.
  // Returns an array of { url, hostname, pathname, count, issueIds[] } sorted
  // by descending count then path.
  function groupIssuesByUrl(report) {
    const issues = report?.report?.issues || [];
    const map = new Map();
    for (const iss of issues) {
      const u = iss.context?.url;
      if (!u) {
        // Bucket urlless issues under a sentinel — they'll show as a separate
        // group the user can decide what to do with (rare; manual-capture
        // issues without a context.url).
        const key = '(no url)';
        const entry = map.get(key) || { url: null, hostname: null, pathname: null, count: 0, issueIds: [] };
        entry.count++;
        entry.issueIds.push(iss.id);
        map.set(key, entry);
        continue;
      }
      let parsed;
      try { parsed = new URL(u); } catch { parsed = null; }
      // Bucket key strips query+hash so /foo?a=1 and /foo?a=2 group together.
      const key = parsed ? `${parsed.origin}${parsed.pathname}` : u;
      const entry = map.get(key) || {
        url: key,
        hostname: parsed?.hostname || null,
        pathname: parsed?.pathname || null,
        count: 0,
        issueIds: []
      };
      entry.count++;
      entry.issueIds.push(iss.id);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.pathname || '').localeCompare(String(b.pathname || ''));
    });
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.issueRecheck = { VERDICT, checkAll, checkOne, readComputed, resolveElement, groupIssuesByUrl };
})();
