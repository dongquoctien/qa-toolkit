// Content-script bridge to runtime-buffer.js (which lives in the page MAIN
// world). Injects the buffer once per page, configures it with the user's
// privacy settings, and exposes QA.runtimeBridge.snapshot() returning the
// buffered console + network events at pick time.
//
// Why this split: chrome.scripting.executeScript with world:'MAIN' can do the
// same job, but it requires `scripting` permission + a tab id we don't have
// from a content-script context. Inserting a <script> tag pointing to a
// web_accessible_resource works in plain MV3 content scripts.
(function () {
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};

  let bridgeReady = false;
  const readyWaiters = [];
  let pendingSnapshots = new Map();           // requestId -> { resolve, timer }
  let nextRequestId = 1;

  function injectScript() {
    if (document.querySelector('script[data-qa-runtime-buffer]')) return;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('src/lib/runtime-buffer.js');
    s.dataset.qaRuntimeBuffer = '1';
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.remove();                                // tag is not needed once executed
  }

  function configure(settings) {
    const p = settings?.privacy || {};
    const s = settings?.sources || {};
    window.postMessage({
      src: 'qa-ext',
      type: 'config',
      payload: {
        redactPatterns: p.redactPatterns || [],
        enabled: {
          console: !!s.consoleErrors,
          network: !!s.networkFailures
        }
      }
    }, '*');
  }

  function clear() {
    window.postMessage({ src: 'qa-ext', type: 'clear' }, '*');
  }

  // Returns a Promise resolving with the current buffer snapshot. Times out
  // after 200ms if the buffer doesn't reply (rare — only if the inject failed
  // or the page CSP blocks the script tag).
  function snapshot() {
    return new Promise((resolve) => {
      const requestId = nextRequestId++;
      const timer = setTimeout(() => {
        pendingSnapshots.delete(requestId);
        resolve({ console: [], network: [], env: null, available: false });
      }, 250);
      pendingSnapshots.set(requestId, { resolve, timer });
      window.postMessage({ src: 'qa-ext', type: 'request', requestId }, '*');
    });
  }

  function whenReady() {
    if (bridgeReady) return Promise.resolve();
    return new Promise((r) => readyWaiters.push(r));
  }

  // Listen for replies + ready signal from the buffer.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.src !== 'qa-runtime') return;
    if (data.type === 'ready') {
      bridgeReady = true;
      while (readyWaiters.length) readyWaiters.shift()();
    } else if (data.type === 'snapshot') {
      const pending = pendingSnapshots.get(data.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingSnapshots.delete(data.requestId);
      pending.resolve({ ...(data.payload || {}), available: true });
    }
  });

  target.QA.runtimeBridge = {
    inject: injectScript,
    configure,
    snapshot,
    clear,
    whenReady
  };
})();
