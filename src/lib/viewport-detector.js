// Capture a rich snapshot of "what screen the QA is testing on" so AI / dev
// readers can disambiguate issues that only repro at a specific size.
//
// Output shape:
//   {
//     viewport: { w, h, dpr, orientation },
//     document: { w, h, scrollX, scrollY },
//     breakpoint: {
//       label: "lg",          // Tailwind label
//       generic: "desktop",   // mobile|tablet|desktop|tv
//       all: { tailwind: "lg", bootstrap: "lg", generic: "desktop" }
//     },
//     device: {
//       platform: "Win32",
//       isMobile: false,
//       isTouch: false,
//       userAgent: "...",
//       userAgentBrand: ["Chromium", "Brave"],
//       prefersDark: true,
//       prefersReducedMotion: false
//     }
//   }
(function () {
  // Tailwind v3 defaults
  const TAILWIND_BREAKPOINTS = [
    { name: 'xs',  min: 0    },  // < 640
    { name: 'sm',  min: 640  },
    { name: 'md',  min: 768  },
    { name: 'lg',  min: 1024 },
    { name: 'xl',  min: 1280 },
    { name: '2xl', min: 1536 }
  ];

  // Bootstrap 5 defaults
  const BOOTSTRAP_BREAKPOINTS = [
    { name: 'xs',  min: 0    },  // < 576
    { name: 'sm',  min: 576  },
    { name: 'md',  min: 768  },
    { name: 'lg',  min: 992  },
    { name: 'xl',  min: 1200 },
    { name: 'xxl', min: 1400 }
  ];

  // Generic 4-tier
  const GENERIC_BREAKPOINTS = [
    { name: 'mobile',  min: 0    },
    { name: 'tablet',  min: 768  },
    { name: 'desktop', min: 1280 },
    { name: 'tv',      min: 1920 }
  ];

  function pickBreakpoint(width, ladder) {
    let pick = ladder[0].name;
    for (const b of ladder) if (width >= b.min) pick = b.name;
    return pick;
  }

  function uaBrands() {
    try {
      const brands = navigator.userAgentData?.brands;
      if (Array.isArray(brands)) {
        return brands
          .map((b) => b.brand)
          .filter((n) => n && !/Not.A.Brand/i.test(n) && !/^Chromium$/i.test(n));
      }
    } catch { /* old browser */ }
    return [];
  }

  function snapshot() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const orientation = w >= h ? 'landscape' : 'portrait';

    const tw = pickBreakpoint(w, TAILWIND_BREAKPOINTS);
    const bs = pickBreakpoint(w, BOOTSTRAP_BREAKPOINTS);
    const gen = pickBreakpoint(w, GENERIC_BREAKPOINTS);

    const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    let isMobile = false;
    try { isMobile = !!navigator.userAgentData?.mobile; } catch { /* ignore */ }
    if (!isMobile) isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);

    return {
      viewport: { w, h, dpr: round(dpr, 2), orientation },
      document: {
        w: document.documentElement.scrollWidth || w,
        h: document.documentElement.scrollHeight || h,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      },
      breakpoint: {
        label: tw,        // primary label = Tailwind (most common in projects we target)
        generic: gen,
        all: { tailwind: tw, bootstrap: bs, generic: gen }
      },
      device: {
        platform: navigator.userAgentData?.platform || navigator.platform || 'unknown',
        isMobile,
        isTouch,
        userAgent: navigator.userAgent,
        userAgentBrand: uaBrands(),
        prefersDark: matchMedia?.('(prefers-color-scheme: dark)')?.matches || false,
        prefersReducedMotion: matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false
      }
    };
  }

  // Compact label for chips/tooltips: "1280×800 · lg · @2x · landscape"
  function formatChip(snap) {
    const { viewport: v, breakpoint: b } = snap;
    const dprPart = v.dpr !== 1 ? ` · @${v.dpr}x` : '';
    return `${v.w}×${v.h} · ${b.label}${dprPart}`;
  }

  // Multi-line tooltip with everything.
  function formatTooltip(snap) {
    const { viewport: v, document: d, breakpoint: b, device: dev } = snap;
    return [
      `Viewport: ${v.w}×${v.h} (${v.orientation}, dpr ${v.dpr})`,
      `Document: ${d.w}×${d.h}, scroll ${d.scrollX},${d.scrollY}`,
      `Breakpoint: ${b.label} (Tailwind) · ${b.all.bootstrap} (Bootstrap) · ${b.generic}`,
      `Device: ${dev.platform}${dev.isMobile ? ' · mobile' : ''}${dev.isTouch ? ' · touch' : ''}`,
      `Theme: ${dev.prefersDark ? 'dark' : 'light'}${dev.prefersReducedMotion ? ' · reduced-motion' : ''}`
    ].join('\n');
  }

  function round(n, places) { const p = Math.pow(10, places); return Math.round(n * p) / p; }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.viewportDetector = { snapshot, formatChip, formatTooltip };
})();
