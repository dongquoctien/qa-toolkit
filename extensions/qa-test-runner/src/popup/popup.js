// Popup placeholder for qa-test-runner v0.0.1.
// All buttons are disabled — wiring lands when v0.1.0 ships the recorder
// and issue-regression checker. See ../../README.md for the milestone plan.
(function () {
  document.getElementById('open-settings')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Settings page not built yet — open the README in a new tab as a stand-in.
    chrome.tabs.create({ url: chrome.runtime.getURL('../../README.md') });
  });
})();
