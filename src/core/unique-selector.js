// Build a reasonably-stable CSS selector for an element.
// Strategy: id > data-section/data-component > class chain + nth-child fallback.
(function () {
  function escape(str) {
    return CSS && CSS.escape ? CSS.escape(str) : String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function dataAttrSelector(el, attrs) {
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) return `[${a}="${v}"]`;
    }
    return null;
  }

  function selectorPart(el, opts) {
    if (el.id) return `#${escape(el.id)}`;
    const dataSel = dataAttrSelector(el, opts.dataAttrs);
    if (dataSel) return el.tagName.toLowerCase() + dataSel;

    let part = el.tagName.toLowerCase();
    if (el.classList.length) {
      // Take up to 3 class names — keeps selector stable enough.
      const classes = [...el.classList].slice(0, 3).map(escape).join('.');
      part += '.' + classes;
    }
    // nth-of-type for ambiguous siblings
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) {
        const idx = same.indexOf(el) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    return part;
  }

  function buildSelector(el, opts = {}) {
    if (!el || el.nodeType !== 1) return '';
    const dataAttrs = opts.dataAttrs || ['data-section', 'data-component', 'data-page'];
    const stop = ['HTML', 'BODY'];

    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && !stop.includes(cur.tagName) && depth < 8) {
      parts.unshift(selectorPart(cur, { dataAttrs }));
      // If we hit a strong identifier, stop chaining upward.
      if (cur.id || dataAttrSelector(cur, dataAttrs)) break;
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.uniqueSelector = { buildSelector };
})();
