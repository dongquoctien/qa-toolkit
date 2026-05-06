// Generic fallback adapter — no source mapping available.
(function () {
  const adapter = {
    type: 'generic',
    matches: () => true,
    extractSource() {
      return { file: null, line: null, column: null, adapter: 'generic' };
    }
  };
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.adapters = target.QA.adapters || {};
  target.QA.adapters.generic = adapter;
})();
