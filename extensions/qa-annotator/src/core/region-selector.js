// Manual region selector — full-screen overlay where the user drags a
// rectangle and confirms to capture. Used by:
//   - Modal "New screenshot" button (manual capture into existing issue)
//   - Popup "Quick capture" button (manual capture into a blank issue)
//
// Returns a Promise<{ x, y, w, h } | null> where the rect is in viewport
// (CSS) coordinates. The caller is responsible for the actual screenshot
// + crop pipeline; this module only deals with the user picking a region.
//
// Constraints:
//   - Viewport-only (no scroll-while-drag). User must scroll to the
//     content first, then click Capture.
//   - Min 8×8 px (anything smaller is treated as a click, not a drag).
//   - Esc cancels. Click backdrop outside an active selection cancels.
//
// Visuals:
//   - Backdrop: 30% black dim across the whole viewport.
//   - Selection: clear inside (no dim), accent border, 4 corner handles.
//   - Floating buttons (Capture / Cancel) appear under the selection.
//   - Top-left helper banner with instructions.
(function () {
  const OVERLAY_ID = 'qa-region-overlay';
  const MIN_SIZE = 8;

  function pick() {
    return new Promise((resolve) => {
      // If an overlay already exists (double-trigger), tear it down first.
      document.getElementById(OVERLAY_ID)?.remove();

      const root = document.createElement('div');
      root.id = OVERLAY_ID;
      root.className = 'qa-ext-ui qa-region-overlay';
      root.innerHTML = renderHtml();
      document.documentElement.appendChild(root);

      const backdrop = root.querySelector('.qa-region-backdrop');
      const cutoutN  = root.querySelector('.qa-region-cutout-n');
      const cutoutS  = root.querySelector('.qa-region-cutout-s');
      const cutoutW  = root.querySelector('.qa-region-cutout-w');
      const cutoutE  = root.querySelector('.qa-region-cutout-e');
      const box      = root.querySelector('.qa-region-box');
      const dims     = root.querySelector('.qa-region-dims');
      const actions  = root.querySelector('.qa-region-actions');
      const captureBtn = root.querySelector('.qa-region-capture');
      const cancelBtn  = root.querySelector('.qa-region-cancel');
      const banner   = root.querySelector('.qa-region-banner');

      // State
      let dragStart = null;
      let dragRect = null;        // confirmed rectangle (after mouseup)
      let isDragging = false;

      function finish(rect) {
        document.removeEventListener('keydown', onKey, true);
        root.remove();
        resolve(rect || null);
      }

      function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

      function rectFrom(start, end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        return { x, y, w, h };
      }

      function paintCutouts(r) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Four cut-out rects so the selection center stays clear (no dim).
        // North band (above selection)
        cutoutN.style.cssText = `top:0; left:0; width:${vw}px; height:${r.y}px;`;
        // South band (below selection)
        cutoutS.style.cssText = `top:${r.y + r.h}px; left:0; width:${vw}px; height:${vh - (r.y + r.h)}px;`;
        // West band (left of selection)
        cutoutW.style.cssText = `top:${r.y}px; left:0; width:${r.x}px; height:${r.h}px;`;
        // East band (right of selection)
        cutoutE.style.cssText = `top:${r.y}px; left:${r.x + r.w}px; width:${vw - (r.x + r.w)}px; height:${r.h}px;`;
        // Position the box around the selection (border + handles).
        box.style.cssText = `display:block; top:${r.y}px; left:${r.x}px; width:${r.w}px; height:${r.h}px;`;
        // Dimensions label inside the box (top-left).
        dims.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
      }

      function paintBackdropFull() {
        // While idle, dim the entire viewport.
        cutoutN.style.cssText = `top:0; left:0; width:100vw; height:100vh;`;
        cutoutS.style.cssText = 'display:none;';
        cutoutW.style.cssText = 'display:none;';
        cutoutE.style.cssText = 'display:none;';
        box.style.display = 'none';
        actions.style.display = 'none';
      }

      function showActions(r) {
        // Place actions just below the selection. If too close to bottom,
        // flip above. Same for right edge — flip left if it overflows.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const PAD = 8;
        const aboveOverflow = r.y + r.h + 36 + PAD > vh;
        const top = aboveOverflow ? Math.max(PAD, r.y - 36 - PAD) : (r.y + r.h + PAD);
        const left = clamp(r.x + r.w - 160, PAD, vw - 160 - PAD);
        actions.style.cssText = `display:flex; top:${top}px; left:${left}px;`;
      }

      paintBackdropFull();

      // ============ Pointer handlers (drag flow) ============
      function onPointerDown(e) {
        // Ignore clicks on action buttons or banner.
        if (e.target.closest('.qa-region-actions') || e.target.closest('.qa-region-banner')) return;
        e.preventDefault();
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        dragRect = null;
        actions.style.display = 'none';
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        const r = rectFrom(dragStart, { x: e.clientX, y: e.clientY });
        if (r.w < 1 && r.h < 1) return;
        paintCutouts(r);
      }

      function onPointerUp(e) {
        if (!isDragging) return;
        isDragging = false;
        const r = rectFrom(dragStart, { x: e.clientX, y: e.clientY });
        if (r.w < MIN_SIZE || r.h < MIN_SIZE) {
          // Treat as a click — reset to idle.
          paintBackdropFull();
          dragStart = null;
          return;
        }
        dragRect = r;
        showActions(r);
      }

      // Capture phase so we don't fight host page click handlers.
      root.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        } else if (e.key === 'Enter' && dragRect) {
          e.preventDefault();
          finish(dragRect);
        }
      }
      document.addEventListener('keydown', onKey, true);

      captureBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dragRect) finish(dragRect);
      });
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        finish(null);
      });

      // First-time hint: nudge the user with the banner for ~3s, then dim.
      setTimeout(() => banner.classList.add('qa-region-banner-dim'), 3000);
    });
  }

  function renderHtml() {
    return `
      <div class="qa-region-banner">
        Drag to select an area · <kbd>Esc</kbd> cancel · <kbd>Enter</kbd> capture
      </div>
      <div class="qa-region-backdrop">
        <div class="qa-region-cutout qa-region-cutout-n"></div>
        <div class="qa-region-cutout qa-region-cutout-s"></div>
        <div class="qa-region-cutout qa-region-cutout-w"></div>
        <div class="qa-region-cutout qa-region-cutout-e"></div>
      </div>
      <div class="qa-region-box">
        <span class="qa-region-dims"></span>
        <span class="qa-region-handle qa-region-handle-nw"></span>
        <span class="qa-region-handle qa-region-handle-ne"></span>
        <span class="qa-region-handle qa-region-handle-sw"></span>
        <span class="qa-region-handle qa-region-handle-se"></span>
      </div>
      <div class="qa-region-actions">
        <button type="button" class="qa-region-cancel">Cancel</button>
        <button type="button" class="qa-region-capture qa-primary">Capture</button>
      </div>
    `;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.regionSelector = { pick };
})();
