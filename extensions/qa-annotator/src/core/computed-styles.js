// Read selected computed style properties from an element.
(function () {
  const DEFAULT_PROPS = [
    'fontSize', 'fontWeight', 'lineHeight', 'fontFamily',
    'color', 'backgroundColor',
    'width', 'height',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'borderRadius', 'boxShadow',
    'display', 'gap', 'opacity'
  ];

  function readComputed(el, props) {
    const cs = window.getComputedStyle(el);
    const list = (props && props.length) ? props : DEFAULT_PROPS;
    const out = {};
    for (const p of list) {
      const v = cs[p] || cs.getPropertyValue(camelToKebab(p));
      if (v != null && v !== '') out[p] = String(v);
    }
    return out;
  }

  function camelToKebab(s) {
    return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.computedStyles = { readComputed, DEFAULT_PROPS };
})();
