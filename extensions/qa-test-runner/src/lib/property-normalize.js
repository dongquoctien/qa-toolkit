// Bridge between qa-annotator's mixed property naming:
//   issue.expected uses kebab-case ('font-size', 'border-radius') for user-typed
//   rows AND camelCase for figma* fields.
//   issue.actual uses camelCase ('fontSize', 'borderRadius') because it comes
//   from getComputedStyle() reads.
//
// To compare apples to apples we normalize both sides to kebab-case before
// diffing. Figma fields are explicitly skipped — they describe the design
// reference, not a CSS property to verify.
(function () {
  const FIGMA_KEYS = new Set([
    'figmaAutoMatched', 'figmaBreadcrumb', 'figmaLink',
    'figmaNodeId', 'figmaScore', 'figmaViewport'
  ]);

  function camelToKebab(s) {
    return String(s).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  }

  function kebabToCamel(s) {
    return String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function isCssProperty(key) {
    return !FIGMA_KEYS.has(key);
  }

  // Normalize an object's keys to kebab-case, dropping Figma metadata.
  function toKebabCss(record) {
    const out = {};
    if (!record || typeof record !== 'object') return out;
    for (const [k, v] of Object.entries(record)) {
      if (!isCssProperty(k)) continue;
      const key = k.includes('-') ? k : camelToKebab(k);
      out[key] = v;
    }
    return out;
  }

  // Coarse equality — strings compared trimmed + lowercased. CSS values that
  // mean the same thing but render differently (e.g. '0' vs '0px', '#fff' vs
  // 'rgb(255,255,255)') are NOT folded — that's a v0.2.0 nicety. v0.1.0 keeps
  // it strict and lets the report surface false positives that the QA can
  // dismiss as "values match, formatter differs".
  function valuesEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.propNormalize = {
    camelToKebab, kebabToCamel, isCssProperty, toKebabCss, valuesEqual, FIGMA_KEYS
  };
})();
