// Wrapper around axe-core for per-element a11y scans.
//
// axe.min.js is bundled in src/vendor and loaded as a content_script ahead of
// this file in the manifest. axe attaches to window.axe globally — we expose
// QA.a11yScan with a single async `scan(element)` method that returns a
// trimmed-down violation list suitable for the issue model.
//
// What gets returned (one per violation):
//   {
//     id:          'color-contrast',
//     impact:      'serious' | 'critical' | 'moderate' | 'minor',
//     description: 'Element has insufficient color contrast of 2.34',
//     help:        'Elements must meet minimum color contrast ratio thresholds',
//     helpUrl:     'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
//     wcag:        ['wcag143', 'wcag2aa'],            // tags filtered to WCAG SC
//     selectors:   ['.cta-primary'],                  // failing nodes (subset of subtree)
//     summary:     'Fix any of the following:\n  Element has...'
//   }
//
// Scope: axe.run({ include: [element] }) — scans the picked element + its
// descendants. We don't run a full-page audit because that would surface
// violations the QA author didn't pick; we want signal scoped to their click.
(function () {
  function isReady() {
    return typeof self !== 'undefined' && typeof self.axe === 'object' && typeof self.axe.run === 'function';
  }

  function tagsToWcag(tags) {
    return (tags || []).filter((t) => /^wcag(\d+)?(a|aa|aaa|2a|2aa|2aaa|22a|22aa|22aaa|143|412)$/i.test(t));
  }

  function trimNode(node) {
    return {
      target: Array.isArray(node.target) ? node.target.map(String) : [],
      html: (node.html || '').slice(0, 240),
      failureSummary: (node.failureSummary || '').slice(0, 600)
    };
  }

  // Run axe scoped to one element's subtree. Returns trimmed violations array
  // (or empty array when axe is not loaded — never throws).
  async function scan(element, options = {}) {
    if (!isReady() || !element) return [];
    const runOpts = {
      // Only the rules QA actually cares about at pick time. The full set
      // includes lots of page-level rules (landmark, region, document-title)
      // that don't apply to a sub-element scope and only generate noise.
      runOnly: options.runOnly || {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      },
      resultTypes: ['violations'],
      // Disable rules that need page context.
      rules: {
        'region': { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
        'document-title': { enabled: false },
        'html-has-lang': { enabled: false },
        'bypass': { enabled: false }
      }
    };
    let raw;
    try {
      raw = await self.axe.run({ include: [[element]] }, runOpts);
    } catch (e) {
      console.warn('[QA] axe.run failed', e);
      return [];
    }
    // axe `include` is a *starting context*, not a strict filter — some rules
    // (color-contrast, page-level checks) still report nodes outside the
    // subtree. Filter post-hoc so we only surface violations whose failing
    // node is the picked element or its descendant.
    const isInsideTarget = (node) => {
      try { return element === node || (element.contains && element.contains(node)); }
      catch { return false; }
    };
    const matchesNode = (axeNode) => {
      if (!Array.isArray(axeNode.target) || !axeNode.target[0]) return false;
      try {
        const matched = document.querySelectorAll(axeNode.target.join(' '));
        for (const n of matched) if (isInsideTarget(n)) return true;
        return false;
      } catch { return false; }
    };

    const violations = (raw?.violations || [])
      .map((v) => {
        const inScopeNodes = (v.nodes || []).filter(matchesNode);
        if (inScopeNodes.length === 0) return null;
        return {
          id: v.id,
          impact: v.impact || 'minor',
          description: (v.description || '').slice(0, 280),
          help: (v.help || '').slice(0, 200),
          helpUrl: v.helpUrl || '',
          wcag: tagsToWcag(v.tags),
          selectors: inScopeNodes.slice(0, 5).map((n) => Array.isArray(n.target) ? n.target.join(' ') : ''),
          nodes: inScopeNodes.slice(0, 3).map(trimNode)
        };
      })
      .filter(Boolean);
    return violations;
  }

  // Quick contrast check without running full axe — used by inspector tooltip
  // to surface a contrast badge in real time. Returns { ratio, fg, bg, fail }
  // or null when colors are indeterminate (transparent / images / etc.).
  function quickContrast(element) {
    if (!element || !isReady()) return null;
    try {
      const cs = getComputedStyle(element);
      const fg = parseColor(cs.color);
      // Walk up looking for a non-transparent background.
      let bg = null, cur = element;
      while (cur && !bg) {
        const bcs = getComputedStyle(cur);
        const c = parseColor(bcs.backgroundColor);
        if (c && c.a > 0.05) bg = c;
        cur = cur.parentElement;
      }
      if (!fg || !bg) return null;
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(cs.fontSize);
      const isBold = parseInt(cs.fontWeight, 10) >= 700;
      const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);
      const aa = isLarge ? 3 : 4.5;
      return {
        ratio: Math.round(ratio * 100) / 100,
        fg: rgbToHex(fg), bg: rgbToHex(bg),
        fail: ratio < aa,
        threshold: aa
      };
    } catch {
      return null;
    }
  }

  function parseColor(s) {
    if (!s || s === 'transparent') return null;
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/.exec(s);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
  }
  function rgbToHex(c) {
    return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function relLum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrastRatio(a, b) {
    const la = relLum(a), lb = relLum(b);
    const [lo, hi] = la < lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.a11yScan = { scan, quickContrast, isReady };
})();
