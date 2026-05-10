// Player — replays a recorded TestSequence and reports pass/fail per step.
// Placeholder until v0.1.0.
//
// Replay strategy per step:
//   1. Resolve selector via SelectorStrategy.resolve(step) — hybrid lookup.
//   2. If not found within waitMs (default 5000), record FAIL_NOT_FOUND.
//   3. Execute action (click / type / wait).
//   4. Run assertion (if present); on mismatch record FAIL_ASSERT.
//   5. Capture optional screenshot for the report.
//
// Output: { steps: [{ status, durationMs, screenshot?, error? }], summary }
(function () {
  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.player = {
    async run(sequence) {
      console.warn('[qa-test-runner] player.run — not implemented in v0.0.1');
      return { steps: [], summary: { total: 0, passed: 0, failed: 0 } };
    }
  };
})();
