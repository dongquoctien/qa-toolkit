// Inspector engine — hover highlight, click-to-pick, shift-click multi-pick.
//
// Selection model:
//   - Plain click → call onPick(element) with single element. Caller decides whether
//     to open the modal immediately. Selection is reset.
//   - Shift+click → adds element to a selection set, leaves inspector running so
//     the user can keep picking. The floating bar shows "Done" once >=1 picked.
//   - Calling commitMulti() returns the picked elements and clears the set.
//   - Esc cancels everything.
(function () {
  const HIGHLIGHT_ID  = 'qa-inspector-highlight';
  const TOOLTIP_ID    = 'qa-inspector-tooltip';
  const MULTI_RING_ID = 'qa-inspector-multi-ring'; // dynamic — cloned per picked element

  let active = false;
  let onPickCallback = null;     // (element) called on plain click
  let onMultiChange = null;      // (count) called when picked set grows/shrinks
  let lastHover = null;
  let activeMode = null;         // 'a11y' enables the contrast badge in the tooltip
  const picked = new Set();
  const ringEls = new WeakMap(); // element -> outline DIV

  function ensureOverlay() {
    let hl = document.getElementById(HIGHLIGHT_ID);
    if (!hl) {
      hl = document.createElement('div');
      hl.id = HIGHLIGHT_ID;
      document.documentElement.appendChild(hl);
    }
    let tip = document.getElementById(TOOLTIP_ID);
    if (!tip) {
      tip = document.createElement('div');
      tip.id = TOOLTIP_ID;
      document.documentElement.appendChild(tip);
    }
    return { hl, tip };
  }

  function moveHighlight(el) {
    const { hl, tip } = ensureOverlay();
    if (!el || el === document.documentElement || el === document.body) {
      hl.style.display = 'none';
      tip.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    const docX = r.left + window.scrollX;
    const docY = r.top  + window.scrollY;

    hl.style.display = 'block';
    hl.style.transform = `translate(${docX}px, ${docY}px)`;
    hl.style.width  = r.width + 'px';
    hl.style.height = r.height + 'px';

    // Position tooltip:
    // - default: 22px above the element (in document coords)
    // - if element top is within 24px of viewport top (sticky/page header), put tooltip BELOW
    //   so it isn't hidden behind the host's sticky header
    tip.textContent = describe(el);
    tip.style.display = 'block';
    const TIP_H = 22;
    const placeBelow = r.top < TIP_H + 4;
    let tipY = placeBelow ? (docY + r.height + 4) : (docY - TIP_H);

    // Clamp horizontally to viewport so long tooltips don't overflow.
    const tipW = tip.offsetWidth || 200;
    const maxX = window.scrollX + window.innerWidth - tipW - 4;
    const tipX = Math.max(window.scrollX + 4, Math.min(docX, maxX));

    tip.style.transform = `translate(${tipX}px, ${tipY}px)`;
  }

  function getAccent() {
    // Read live so a color-change broadcast updates new rings instantly.
    return getComputedStyle(document.documentElement).getPropertyValue('--qa-accent').trim() || '#ec4899';
  }

  function addPickedRing(el) {
    if (ringEls.has(el)) return;
    const ring = document.createElement('div');
    ring.id = `${MULTI_RING_ID}-${ringEls.size + 1}`;
    const accent = getAccent();
    ring.style.cssText = `
      position: absolute !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
      outline: 2px dashed ${accent} !important;
      outline-offset: 0 !important;
      background: ${accent}1A !important;  /* 10% alpha via #RRGGBBAA */
      border-radius: 2px !important;
    `;
    document.documentElement.appendChild(ring);
    ringEls.set(el, ring);
    positionRing(el);
  }
  function positionRing(el) {
    const ring = ringEls.get(el);
    if (!ring) return;
    const r = el.getBoundingClientRect();
    ring.style.transform = `translate(${r.left + window.scrollX}px, ${r.top + window.scrollY}px)`;
    ring.style.width  = r.width + 'px';
    ring.style.height = r.height + 'px';
  }
  function clearRings() {
    for (const el of picked) {
      const ring = ringEls.get(el);
      if (ring) ring.remove();
      ringEls.delete(el);
    }
    picked.clear();
  }
  function repositionAllRings() {
    for (const el of picked) positionRing(el);
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '';
    const sec = el.closest('[data-section]');
    const secLabel = sec ? `  ⌗${sec.getAttribute('data-section')}` : '';
    const pickedHint = picked.size ? `  · shift+click to add (${picked.size})` : '  · shift+click to add';
    // a11y mode: prepend a quick contrast badge — 0.1 ms on hover, no axe call.
    let a11yBadge = '';
    if (activeMode === 'a11y' && self.QA?.a11yScan?.quickContrast) {
      const c = self.QA.a11yScan.quickContrast(el);
      if (c) a11yBadge = ` ${c.fail ? '✗' : '✓'} ${c.ratio}:1  `;
    }
    return `${a11yBadge}${tag}${id}${cls}${secLabel}${pickedHint}`;
  }

  function isInExtensionUI(el) {
    return !!(el.closest && el.closest('.qa-ext-ui'));
  }

  function onMouseMove(e) {
    if (!active) return;
    const el = e.target;
    if (!el || isInExtensionUI(el)) { lastHover = null; moveHighlight(null); return; }
    lastHover = el;
    moveHighlight(el);
  }

  function onClick(e) {
    if (!active) return;
    const el = e.target;
    if (!el || isInExtensionUI(el)) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      // Multi-pick: add or remove
      if (picked.has(el)) {
        picked.delete(el);
        const ring = ringEls.get(el);
        if (ring) { ring.remove(); ringEls.delete(el); }
      } else {
        picked.add(el);
        addPickedRing(el);
      }
      if (onMultiChange) onMultiChange(picked.size);
    } else {
      // Plain click: if there's already a multi-selection, treat plain click as
      // "add this then commit". Otherwise single-pick path.
      if (picked.size > 0) {
        picked.add(el);
        addPickedRing(el);
        if (onMultiChange) onMultiChange(picked.size);
        commitAndPick();
      } else if (onPickCallback) {
        onPickCallback([el]);
      }
    }
  }

  function commitAndPick() {
    if (picked.size === 0) return;
    const list = [...picked];
    clearRings();
    if (onMultiChange) onMultiChange(0);
    if (onPickCallback) onPickCallback(list);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') stop();
    if (e.key === 'Enter' && picked.size > 0) commitAndPick();
  }

  function onScrollResize() {
    if (!active) return;
    repositionAllRings();
    if (lastHover) moveHighlight(lastHover);
  }

  function start(opts = {}) {
    if (active) return;
    active = true;
    onPickCallback = opts.onPick || null;
    onMultiChange = opts.onMultiChange || null;
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize, true);
    document.documentElement.classList.add('qa-inspect-on');
  }

  function stop() {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScrollResize, true);
    window.removeEventListener('resize', onScrollResize, true);
    document.documentElement.classList.remove('qa-inspect-on');
    moveHighlight(null);
    clearRings();
    onPickCallback = null;
    onMultiChange = null;
  }

  function isActive() { return active; }
  function getPickedCount() { return picked.size; }
  // setMode is called by content.js on init + on settings change. Currently
  // only the 'a11y' value affects rendering (contrast badge in tooltip), but
  // the hook is here so other modes can light up their own affordances later.
  function setMode(mode) { activeMode = mode || null; }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.inspector = { start, stop, isActive, commitAndPick, getPickedCount, setMode };
})();
