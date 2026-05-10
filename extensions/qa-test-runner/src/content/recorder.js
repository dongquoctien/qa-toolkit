// Recorder — captures user actions on the page and emits them as a sequence
// of TestStep records. Placeholder until v0.1.0.
//
// Planned step shape:
//   { type: 'click', selector, fallbacks[], at, screenshot? }
//   { type: 'type',  selector, value, at }
//   { type: 'wait',  durationMs, reason: 'navigation' | 'manual' }
//   { type: 'assert', selector, kind: 'exists'|'text'|'visible'|'computed', expected }
//
// State machine:
//   idle → recording (user toggles via popup)
//   recording → paused (user clicks Pause in floating bar)
//   recording → idle (user clicks Stop, sequence saved)
(function () {
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.recorder = {
    start() { console.warn('[qa-test-runner] recorder.start — not implemented in v0.0.1'); },
    stop()  { return null; },
    pause() {},
    resume() {}
  };
})();
