// Tiny glob matcher for URL patterns.
// Supports `*` (any chars) and `**` (same — we don't distinguish path depth here).
// Anchored at both ends. Profile patterns look like:
//   "http://localhost:*/*", "https://*.ohmyhotelco.com/*"
(function () {
  function compile(pattern) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  function matchUrl(url, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    return patterns.some((p) => {
      try { return compile(p).test(url); }
      catch { return false; }
    });
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.globMatch = { compile, matchUrl };

  if (typeof module !== 'undefined') module.exports = { compile, matchUrl };
})();
