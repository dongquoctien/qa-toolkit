// Floating status bar in the page when inspector is on.
(function () {
  let bar = null, dotEl = null, countEl = null, multiEl = null, doneBtn = null, stopBtn = null;

  function ensure() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'qa-ext-ui qa-bar';
    bar.innerHTML = `
      <span class="qa-bar-dot" aria-hidden="true"></span>
      <span>QA Inspector</span>
      <span class="qa-bar-count" title="Saved issues">0</span>
      <span class="qa-bar-multi qa-hidden" title="Picked elements"></span>
      <button class="qa-bar-done qa-hidden" type="button" title="Open issue with picked elements (Enter)">Done</button>
      <button class="qa-bar-stop" type="button" title="Stop inspector (Esc)">Stop</button>
    `;
    document.documentElement.appendChild(bar);
    dotEl = bar.querySelector('.qa-bar-dot');
    countEl = bar.querySelector('.qa-bar-count');
    multiEl = bar.querySelector('.qa-bar-multi');
    doneBtn = bar.querySelector('.qa-bar-done');
    stopBtn = bar.querySelector('.qa-bar-stop');
    doneBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('qa:commit-multi')));
    stopBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('qa:stop-inspect')));
    return bar;
  }

  function show() { ensure().classList.add('qa-on'); }
  function hide() { ensure().classList.remove('qa-on'); }
  function setCount(n) { ensure(); if (countEl) countEl.textContent = String(n); }
  function setPickedCount(n) {
    ensure();
    if (n > 0) {
      multiEl.textContent = `+${n}`;
      multiEl.classList.remove('qa-hidden');
      doneBtn.classList.remove('qa-hidden');
      doneBtn.textContent = `Done (${n})`;
    } else {
      multiEl.classList.add('qa-hidden');
      doneBtn.classList.add('qa-hidden');
    }
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.overlay = { show, hide, setCount, setPickedCount };
})();
