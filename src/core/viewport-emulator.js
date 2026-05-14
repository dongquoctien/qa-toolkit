// QA.viewportEmulator — squeeze host-page content into a fixed-width column so
// QA can test mobile/tablet layouts without resizing the browser window. The
// modal + popup stay at full size on the right side of the screen.
//
// Mechanism: move all non-QA body children into a wrapper div with fixed width,
// turn body into a 2-column flex layout. Media queries trigger because the
// wrap's width drives CSS layout (not window.innerWidth). JS-based responsive
// (which reads window.innerWidth) still sees the real viewport — accepted
// trade-off vs. requiring chrome.debugger permission.
//
// State: per-tab sessionStorage key `qa-viewport-w` keeps the choice across
// reloads. Auto-restore on content script load.
//
// Inspector lifecycle: while inspector is active, emulator auto-disables so
// element bounding rects line up with real viewport coordinates. Re-enables on
// inspector stop.
(function () {
  const STORAGE_KEY = 'qa-viewport-w';
  const WRAP_ID = 'qa-viewport-wrap';
  const CHIP_ID = 'qa-viewport-chip';

  let active = false;
  let activeWidth = 0;
  let savedBodyStyle = '';
  let savedHtmlStyle = '';
  let pausedForInspector = false;
  let pausedWidth = 0;

  function chip(width) {
    const el = document.createElement('div');
    el.id = CHIP_ID;
    el.className = 'qa-ext-ui';
    el.textContent = `📱 ${width}×${window.innerHeight}`;
    return el;
  }

  function isQaNode(n) {
    if (n.nodeType !== 1) return false;
    if (n.classList && n.classList.contains('qa-ext-ui')) return true;
    if (n.id && n.id.startsWith('qa-')) return true;
    return false;
  }

  function enable(width) {
    if (active) {
      if (activeWidth === width) return;
      disable();
    }
    if (!width || width < 200 || width > 2400) return;

    active = true;
    activeWidth = width;
    savedBodyStyle = document.body.getAttribute('style') || '';
    savedHtmlStyle = document.documentElement.getAttribute('style') || '';

    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;

    // Move non-QA children into wrap
    const children = Array.from(document.body.childNodes);
    children.forEach((n) => {
      if (isQaNode(n)) return;
      wrap.appendChild(n);
    });

    document.body.appendChild(wrap);
    document.body.appendChild(chip(width));

    // Force 2-column layout via inline style — survives host CSS overrides
    document.body.style.cssText = `
      margin: 0 !important;
      padding: 0 !important;
      display: flex !important;
      align-items: stretch !important;
      overflow: hidden !important;
      height: 100vh !important;
      background: #1f2937 !important;
    `;
    document.documentElement.style.cssText = `
      overflow: hidden !important;
    `;

    // sessionStorage for per-tab persistence
    try { sessionStorage.setItem(STORAGE_KEY, String(width)); } catch {}

    broadcastState();
  }

  function disable() {
    if (!active) return;
    active = false;
    activeWidth = 0;

    const wrap = document.getElementById(WRAP_ID);
    if (wrap) {
      // Move children back to body
      while (wrap.firstChild) {
        document.body.insertBefore(wrap.firstChild, wrap);
      }
      wrap.remove();
    }
    document.getElementById(CHIP_ID)?.remove();

    // Restore inline styles
    if (savedBodyStyle) document.body.setAttribute('style', savedBodyStyle);
    else document.body.removeAttribute('style');
    if (savedHtmlStyle) document.documentElement.setAttribute('style', savedHtmlStyle);
    else document.documentElement.removeAttribute('style');

    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}

    broadcastState();
  }

  function toggle(width) {
    if (active && (!width || width === activeWidth)) disable();
    else enable(width);
  }

  // Inspector lifecycle hooks — called by content.js
  function pauseForInspector() {
    if (!active) return;
    pausedForInspector = true;
    pausedWidth = activeWidth;
    disable();
  }

  function resumeAfterInspector() {
    if (!pausedForInspector) return;
    pausedForInspector = false;
    enable(pausedWidth);
    pausedWidth = 0;
  }

  function broadcastState() {
    try {
      window.postMessage({
        src: 'qa-ext',
        type: 'viewport-state',
        active,
        width: activeWidth
      }, '*');
    } catch {}
  }

  // Restore from sessionStorage on load (after content scripts settle)
  function restoreFromSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const w = parseInt(raw, 10);
        if (w >= 200 && w <= 2400) {
          // Defer one frame so host page DOM is stable
          requestAnimationFrame(() => enable(w));
        }
      }
    } catch {}
  }

  self.QA = self.QA || {};
  self.QA.viewportEmulator = {
    enable,
    disable,
    toggle,
    pauseForInspector,
    resumeAfterInspector,
    isActive: () => active,
    getWidth: () => activeWidth,
    restoreFromSession
  };
})();
