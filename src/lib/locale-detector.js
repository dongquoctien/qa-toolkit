// Detect the active locale from a URL given a profile.localeStrategy block.
// Honors prefixDefaultLocale: when false, the default locale is served at "/"
// without a "/<locale>/" prefix.
(function () {
  function detectLocale(url, strategy) {
    if (!strategy || strategy.type === 'none') return strategy?.defaultLocale ?? null;

    const u = (() => { try { return new URL(url); } catch { return null; } })();
    if (!u) return null;

    switch (strategy.type) {
      case 'url-prefix': {
        const supported = strategy.supportedLocales || [];
        const segs = u.pathname.split('/').filter(Boolean);
        const first = segs[0];
        if (first && supported.includes(first)) return first;
        // No prefix → either default-without-prefix, or unknown.
        if (strategy.prefixDefaultLocale === false) return strategy.defaultLocale ?? null;
        return strategy.defaultLocale ?? null;
      }
      case 'subdomain': {
        const sub = u.hostname.split('.')[0];
        const supported = strategy.supportedLocales || [];
        return supported.includes(sub) ? sub : (strategy.defaultLocale ?? null);
      }
      case 'query-param': {
        const v = u.searchParams.get(strategy.paramName || 'lang');
        return v || (strategy.defaultLocale ?? null);
      }
      case 'cookie': {
        const name = strategy.cookieName || 'locale';
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
        return m ? decodeURIComponent(m[1]) : (strategy.defaultLocale ?? null);
      }
      case 'html-lang': {
        return document.documentElement.lang || (strategy.defaultLocale ?? null);
      }
      default:
        return strategy.defaultLocale ?? null;
    }
  }

  function detectPage(url, pageDetection) {
    if (!Array.isArray(pageDetection) || pageDetection.length === 0) return null;
    const u = (() => { try { return new URL(url); } catch { return null; } })();
    if (!u) return null;
    for (const rule of pageDetection) {
      try {
        const re = new RegExp(rule.pattern);
        if (re.test(u.pathname)) return rule.pageName;
      } catch { /* bad regex in profile, skip */ }
    }
    return null;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.localeDetector = { detectLocale, detectPage };

  if (typeof module !== 'undefined') module.exports = { detectLocale, detectPage };
})();
