// QA.viewportEmulator — viewport emulation via chrome.debugger
// (Emulation.setDeviceMetricsOverride) so CSS media queries trigger correctly
// AND window.innerWidth/devicePixelRatio match the emulated viewport.
//
// The heavy lifting happens in the service worker (which owns the debugger
// session). This content-script module only:
//   1. Renders the indicator chip "📱 360×640" pinned top-right of the real
//      viewport. The host page itself is fully resized by the debugger, so
//      no DOM wrap is needed.
//   2. Pauses emulation during inspector to keep click coords aligned with the
//      *real* mouse position. The chrome.debugger override remaps the device
//      pixel ratio + mobile flag — without pausing, hover highlight lags.
//   3. Persists chosen width in per-tab sessionStorage so reload re-applies.
//
// Caveats:
//   - The debugger banner ("QA Annotator is debugging this browser") will be
//     visible while emulation is on. We accept it because CSS media queries
//     need real emulation; DOM-wrap (v0.6.0) couldn't trigger them.
//   - On detach (banner X clicked), the page snaps back to native. Content
//     script gets MSG.VIEWPORT_STATE = inactive on next popup open.
(function () {
  const STORAGE_KEY = 'qa-viewport-w';
  const CHIP_ID = 'qa-viewport-chip';

  let activeWidth = 0;
  let pausedForInspector = false;
  let pausedWidth = 0;

  function showChip(width, height) {
    hideChip();
    const el = document.createElement('div');
    el.id = CHIP_ID;
    el.className = 'qa-ext-ui';
    el.textContent = `📱 ${width}×${height}`;
    document.body.appendChild(el);
  }

  function hideChip() {
    document.getElementById(CHIP_ID)?.remove();
  }

  async function enable(width) {
    if (!width || width < 200 || width > 2400) return;
    // Service worker handles the actual emulation.
    const res = await chrome.runtime.sendMessage({
      type: 'qa/viewport/set',
      payload: { width }
    });
    if (!res?.ok) {
      console.warn('[QA] viewport emulation failed:', res?.error);
      return;
    }
    activeWidth = res.width;
    // Show chip with the actual height the SW applied (height map varies by preset).
    const heightMap = { 360: 640, 414: 896, 768: 1024, 1024: 1366 };
    showChip(width, heightMap[width] || Math.round(width * 16 / 9));
    try { sessionStorage.setItem(STORAGE_KEY, String(width)); } catch {}
  }

  async function disable() {
    if (!activeWidth) return;
    activeWidth = 0;
    hideChip();
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    try {
      await chrome.runtime.sendMessage({
        type: 'qa/viewport/set',
        payload: { width: 0 }
      });
    } catch {/* SW might be sleeping — ok */}
  }

  function pauseForInspector() {
    if (!activeWidth) return;
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

  function restoreFromSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const w = parseInt(raw, 10);
      if (w >= 200 && w <= 2400) {
        requestAnimationFrame(() => enable(w));
      }
    } catch {}
  }

  self.QA = self.QA || {};
  self.QA.viewportEmulator = {
    enable,
    disable,
    pauseForInspector,
    resumeAfterInspector,
    isActive: () => !!activeWidth,
    getWidth: () => activeWidth,
    restoreFromSession
  };
})();
