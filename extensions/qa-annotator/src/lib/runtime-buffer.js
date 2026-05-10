// Runtime buffer — runs in the page's MAIN world (not the isolated content
// script). Intercepts console.error/warn + fetch/XHR failures and ring-buffers
// the last N events. The content script reads via window.postMessage.
//
// Why MAIN world: the isolated content script has its own window.fetch
// reference, so we cannot intercept the *page's* requests by overriding from
// there. This file is loaded via <script> tag injection by content.js,
// declared in `web_accessible_resources` so the page can fetch it.
//
// Privacy: redact patterns are sent in by the content script via a config
// message; bodies are scrubbed before storage. Defaults are conservative.
(function () {
  if (window.__qaRuntimeBufferLoaded) return;          // idempotent — content script may inject twice
  window.__qaRuntimeBufferLoaded = true;

  const MAX_CONSOLE = 50;
  const MAX_NETWORK = 20;

  const state = {
    console: [],                     // [{ level, args, at, stack }]
    network: [],                     // [{ method, url, status, durationMs, at, requestBody?, responseBody? }]
    redactPatterns: [],              // [RegExp]
    enabled: { console: false, network: false }
  };

  function redact(text) {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const re of state.redactPatterns) {
      try { out = out.replace(re, '▮'.repeat(8)); } catch { /* bad regex — skip */ }
    }
    return out;
  }

  function safeStringify(arg) {
    if (arg == null) return String(arg);
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
    try { return JSON.stringify(arg, null, 0).slice(0, 2000); }
    catch { return String(arg); }
  }

  function pushConsole(level, args) {
    if (!state.enabled.console) return;
    const flat = args.map(safeStringify).map(redact).join(' ');
    state.console.push({
      level,
      message: flat.slice(0, 4000),
      at: Date.now(),
      stack: (new Error().stack || '').split('\n').slice(2, 6).join('\n')
    });
    if (state.console.length > MAX_CONSOLE) state.console.shift();
  }

  function pushNetwork(entry) {
    if (!state.enabled.network) return;
    state.network.push(entry);
    if (state.network.length > MAX_NETWORK) state.network.shift();
  }

  // Wrap console.error/warn — keep the original call working.
  const origError = console.error.bind(console);
  const origWarn  = console.warn.bind(console);
  console.error = function (...args) { pushConsole('error', args); return origError(...args); };
  console.warn  = function (...args) { pushConsole('warn',  args); return origWarn(...args);  };

  // Capture global JS errors + unhandled rejections (most prod bugs surface here).
  window.addEventListener('error', (e) => {
    pushConsole('error', [e.message + (e.filename ? ` (${e.filename}:${e.lineno || '?'})` : '')]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : safeStringify(e.reason);
    pushConsole('error', ['Unhandled promise rejection: ' + reason]);
  });

  // ============ fetch override ============
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const start = performance.now();
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
    try {
      const res = await origFetch.apply(this, arguments);
      if (res && res.status >= 400 && state.enabled.network) {
        // Clone so reading body doesn't consume the original response.
        let respBody = '';
        try {
          const cloned = res.clone();
          const text = await cloned.text();
          respBody = redact(text.slice(0, 1000));
        } catch { /* opaque or aborted — skip body */ }
        pushNetwork({
          method, url: redact(url), status: res.status,
          durationMs: Math.round(performance.now() - start),
          at: Date.now(),
          responseBody: respBody
        });
      }
      return res;
    } catch (err) {
      if (state.enabled.network) {
        pushNetwork({
          method, url: redact(url), status: 0,
          durationMs: Math.round(performance.now() - start),
          at: Date.now(),
          error: String(err?.message || err)
        });
      }
      throw err;
    }
  };

  // ============ XHR override ============
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _method = 'GET', _url = '', _start = 0;
    const origOpen = xhr.open;
    xhr.open = function (method, url) {
      _method = method; _url = url || '';
      return origOpen.apply(xhr, arguments);
    };
    const origSend = xhr.send;
    xhr.send = function () {
      _start = performance.now();
      xhr.addEventListener('loadend', () => {
        if (xhr.status >= 400 && state.enabled.network) {
          let respBody = '';
          try { respBody = redact(String(xhr.responseText || '').slice(0, 1000)); } catch {}
          pushNetwork({
            method: _method, url: redact(_url), status: xhr.status,
            durationMs: Math.round(performance.now() - _start),
            at: Date.now(),
            responseBody: respBody
          });
        }
      });
      xhr.addEventListener('error', () => {
        if (state.enabled.network) {
          pushNetwork({
            method: _method, url: redact(_url), status: 0,
            durationMs: Math.round(performance.now() - _start),
            at: Date.now(),
            error: 'XHR network error'
          });
        }
      });
      return origSend.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // ============ Bridge to content script via window.postMessage ============
  // Protocol: content script sends `{ src: 'qa-ext', type: 'config'|'request' }`,
  // we reply `{ src: 'qa-runtime', type: 'snapshot', payload: {...} }`.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.src !== 'qa-ext') return;
    if (data.type === 'config') {
      // payload: { redactPatterns: ['...regex...'], enabled: { console, network } }
      const cfg = data.payload || {};
      state.redactPatterns = (cfg.redactPatterns || []).map((p) => {
        try { return new RegExp(p, 'gi'); } catch { return null; }
      }).filter(Boolean);
      state.enabled.console = !!cfg.enabled?.console;
      state.enabled.network = !!cfg.enabled?.network;
    } else if (data.type === 'request') {
      window.postMessage({
        src: 'qa-runtime',
        type: 'snapshot',
        requestId: data.requestId || null,
        payload: {
          console: state.console.slice(),
          network: state.network.slice(),
          env: {
            url: location.href,
            userAgent: navigator.userAgent,
            language: navigator.language,
            viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
          }
        }
      }, '*');
    } else if (data.type === 'clear') {
      state.console.length = 0;
      state.network.length = 0;
    }
  });

  // Notify content script we're up.
  window.postMessage({ src: 'qa-runtime', type: 'ready' }, '*');
})();
