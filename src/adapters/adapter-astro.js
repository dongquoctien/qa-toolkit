// Astro adapter — reads `data-astro-source-loc` and `data-astro-source-file`
// attributes that Astro injects when `vite.build.sourcemap` is enabled.
//
// Format observed:
//   data-astro-source-file="/abs/path/src/components/Hero.astro"
//   data-astro-source-loc="83:12"
(function () {
  function findClosestSourceEl(el) {
    let cur = el;
    let depth = 0;
    while (cur && depth < 12) {
      if (cur.hasAttribute && cur.hasAttribute('data-astro-source-loc')) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  function trimToProjectRoot(absPath) {
    if (!absPath) return null;
    // Heuristic: strip everything before "/src/" so the path is repo-relative.
    const m = absPath.replace(/\\/g, '/').match(/\/(src\/.*)$/);
    return m ? m[1] : absPath;
  }

  const adapter = {
    type: 'astro',
    matches: (el) => !!findClosestSourceEl(el),
    extractSource(el /*, profile */) {
      const src = findClosestSourceEl(el);
      if (!src) return { file: null, line: null, column: null, adapter: 'astro' };
      const file = trimToProjectRoot(src.getAttribute('data-astro-source-file'));
      const loc = src.getAttribute('data-astro-source-loc') || '';
      const [lineStr, colStr] = loc.split(':');
      return {
        file: file || null,
        line: lineStr ? parseInt(lineStr, 10) : null,
        column: colStr ? parseInt(colStr, 10) : null,
        adapter: 'astro'
      };
    }
  };
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.adapters = target.QA.adapters || {};
  target.QA.adapters.astro = adapter;
})();
