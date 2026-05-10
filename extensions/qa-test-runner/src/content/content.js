// Content script bootstrap placeholder.
// v0.0.1 only registers a guard so duplicate injections don't double-bind.
// v0.1.0 will wire QA.recorder.start / QA.player.run from popup messages.
(function () {
  if (window.__qaTestRunnerLoaded) return;
  window.__qaTestRunnerLoaded = true;
})();
