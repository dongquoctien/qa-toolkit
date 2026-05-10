// Service worker placeholder. v0.0.1 only handles install/update lifecycle.
// Real message routing arrives in v0.1.0 with the recorder + issue checker.

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[qa-test-runner]', details.reason, '— scaffold v0.0.1');
});
