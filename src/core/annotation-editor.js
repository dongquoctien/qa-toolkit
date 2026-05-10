// Canvas-based annotation editor.
//
// Opens after capture (or on demand from the modal's gallery). User draws on
// top of a screenshot; on save the editor flattens the annotation layer onto
// the bitmap and returns both the new dataUrl AND the layers array (so we can
// re-edit later from the settings page).
//
// Tools:
//   pin       — auto-incrementing numbered marker (style from settings)
//   rect      — rectangle outline + 10% fill, role=bug (red) / expected (green) / info (accent)
//   arrow     — line with arrowhead at end point
//   text      — text callout with white pill background
//   blur      — pixelated rectangle (PII redaction)
//   freehand  — pen/marker, accent color
//
// Output:
//   {
//     dataUrl: "data:image/png;base64,…",   // bitmap with layers flattened
//     annotations: { width, height, layers: [...] }
//   }
//
// Persistence shape lives on screenshots[i].annotations. The flattened PNG IS
// the visible artifact (gallery, ZIP, Jira); annotations is only consumed by
// re-edit. If a caller doesn't pass settings, sensible defaults take over.
(function () {
  const PIN_RADIUS = 14;
  const ARROW_HEAD = 14;
  const BLUR_BLOCK = 10;          // pixelated mosaic block size
  const TEXT_PADDING = 6;
  const HISTORY_MAX = 30;

  /**
   * Open the editor over the page. Returns a Promise that resolves with
   * { dataUrl, annotations } or null if cancelled.
   *
   * @param {object} input
   * @param {string} input.dataUrl       — source PNG (already cropped/stitched)
   * @param {object} [input.annotations] — existing layers to re-edit
   * @param {object} [input.settings]    — chrome.storage.local["settings"]
   * @param {string} [input.severity]    — used when capture.pinColorMode === 'severity'
   */
  async function open(input) {
    const settings = input.settings || {};
    const cap = settings.capture || {};
    const accent = (getComputedStyle(document.documentElement).getPropertyValue('--qa-accent').trim()) || '#ec4899';
    const severityColors = (settings.defaults && settings.defaults.severityColors) || {};
    const pinColor = (cap.pinColorMode === 'severity' && severityColors[input.severity]) || accent;
    const pinStyle = cap.pinStyle || 'circle-number';
    const pinPrefix = cap.pinPrefix || '';
    const defaultTool = cap.defaultTool || 'pin';

    return new Promise(async (resolve) => {
      const img = await loadImage(input.dataUrl);
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      const root = document.createElement('div');
      root.className = 'qa-ext-ui qa-annot-overlay';
      root.innerHTML = renderHtml({ pinColor, defaultTool });
      document.documentElement.appendChild(root);

      const stage = root.querySelector('.qa-annot-stage');
      const baseCanvas = root.querySelector('canvas.qa-annot-base');
      const drawCanvas = root.querySelector('canvas.qa-annot-draw');
      const cursorCanvas = root.querySelector('canvas.qa-annot-cursor');
      const status = root.querySelector('.qa-annot-status');

      // Size canvases to natural image dimensions so coordinates match 1:1.
      [baseCanvas, drawCanvas, cursorCanvas].forEach((c) => { c.width = W; c.height = H; });

      // Fit-to-viewport — display size only (transform: scale).
      fitStage(stage, baseCanvas, drawCanvas, cursorCanvas, W, H);
      window.addEventListener('resize', () => fitStage(stage, baseCanvas, drawCanvas, cursorCanvas, W, H));

      // Blur tool calls baseCtx.getImageData() repeatedly to sample pixel
      // colors. Without willReadFrequently:true Chrome warns and falls back to
      // GPU→CPU readback on every call.
      const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
      baseCtx.drawImage(img, 0, 0);

      const drawCtx = drawCanvas.getContext('2d');
      const cursorCtx = cursorCanvas.getContext('2d');

      // Editor state
      const state = {
        tool: defaultTool,
        color: pinColor,
        rectRole: 'bug',                      // bug | expected | info
        textValue: 'Note',
        layers: input.annotations?.layers ? input.annotations.layers.slice() : [],
        history: [],                           // snapshots of layers[]
        future: [],
        pinCounter: 0
      };
      // Recompute pinCounter from existing pins so re-edit doesn't restart at 1.
      for (const l of state.layers) if (l.type === 'pin' && l.n > state.pinCounter) state.pinCounter = l.n;

      function pushHistory() {
        state.history.push(JSON.stringify(state.layers));
        if (state.history.length > HISTORY_MAX) state.history.shift();
        state.future.length = 0;
        updateStatus();
      }
      function undo() {
        if (state.history.length === 0) return;
        state.future.push(JSON.stringify(state.layers));
        state.layers = JSON.parse(state.history.pop());
        // Recompute pinCounter
        state.pinCounter = state.layers.reduce((m, l) => l.type === 'pin' ? Math.max(m, l.n) : m, 0);
        redraw();
        updateStatus();
      }
      function redo() {
        if (state.future.length === 0) return;
        state.history.push(JSON.stringify(state.layers));
        state.layers = JSON.parse(state.future.pop());
        state.pinCounter = state.layers.reduce((m, l) => l.type === 'pin' ? Math.max(m, l.n) : m, 0);
        redraw();
        updateStatus();
      }

      function updateStatus() {
        status.textContent = `${state.layers.length} annotation${state.layers.length === 1 ? '' : 's'} · undo:${state.history.length} · redo:${state.future.length}`;
      }

      function redraw() {
        drawCtx.clearRect(0, 0, W, H);
        for (const l of state.layers) drawLayer(drawCtx, l, baseCtx);
        updateStatus();
      }

      // ============ Tool palette ============
      root.querySelectorAll('[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.tool = btn.dataset.tool;
          root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
          // Show/hide tool-specific options.
          root.querySelectorAll('[data-tool-options]').forEach((opt) => {
            opt.hidden = opt.dataset.toolOptions !== state.tool;
          });
        });
      });
      // Activate default tool button.
      const defaultBtn = root.querySelector(`[data-tool="${defaultTool}"]`);
      if (defaultBtn) defaultBtn.click();

      // Rect role chips
      root.querySelectorAll('[data-rect-role]').forEach((chip) => {
        chip.addEventListener('click', () => {
          state.rectRole = chip.dataset.rectRole;
          root.querySelectorAll('[data-rect-role]').forEach((c) => c.classList.toggle('active', c === chip));
        });
      });
      // Color picker
      const colorInput = root.querySelector('input.qa-annot-color');
      if (colorInput) {
        colorInput.value = pinColor;
        colorInput.addEventListener('input', (e) => { state.color = e.target.value; });
      }
      // Text input
      const textInput = root.querySelector('input.qa-annot-text');
      if (textInput) {
        textInput.addEventListener('input', (e) => { state.textValue = e.target.value || 'Note'; });
      }

      // ============ Pointer handlers ============
      let drag = null;
      const toCanvas = (e) => {
        const r = drawCanvas.getBoundingClientRect();
        const sx = drawCanvas.width / r.width;
        const sy = drawCanvas.height / r.height;
        return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
      };

      drawCanvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        drawCanvas.setPointerCapture(e.pointerId);
        const p = toCanvas(e);
        if (state.tool === 'pin') {
          state.pinCounter += 1;
          const layer = { type: 'pin', x: p.x, y: p.y, n: state.pinCounter, color: state.color, style: pinStyle, prefix: pinPrefix, note: '' };
          pushHistory();
          state.layers.push(layer);
          redraw();
        } else if (state.tool === 'text') {
          const layer = { type: 'text', x: p.x, y: p.y, text: state.textValue, color: '#1f2937', font: '16px ui-sans-serif, system-ui' };
          pushHistory();
          state.layers.push(layer);
          redraw();
        } else if (state.tool === 'freehand') {
          const layer = { type: 'freehand', points: [[p.x, p.y]], color: state.color, width: 3 };
          pushHistory();
          state.layers.push(layer);
          drag = { mode: 'freehand', layer };
          redraw();
        } else {
          // rect, arrow, blur — drag to size
          drag = { mode: state.tool, start: p, end: p };
          redrawCursor();
        }
      });

      drawCanvas.addEventListener('pointermove', (e) => {
        const p = toCanvas(e);
        if (drag) {
          if (drag.mode === 'freehand') {
            drag.layer.points.push([p.x, p.y]);
            redraw();
          } else {
            drag.end = p;
            redrawCursor();
          }
        }
      });

      drawCanvas.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const p = toCanvas(e);
        if (drag.mode === 'freehand') {
          drag.layer.points.push([p.x, p.y]);
        } else if (drag.mode === 'rect') {
          const { x, y, w, h } = rectFromPoints(drag.start, p);
          if (w > 4 && h > 4) {
            const role = state.rectRole;
            const color = role === 'bug' ? '#ef4444' : role === 'expected' ? '#22c55e' : state.color;
            pushHistory();
            state.layers.push({ type: 'rect', x, y, w, h, color, role });
          }
        } else if (drag.mode === 'arrow') {
          if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 6) {
            pushHistory();
            state.layers.push({ type: 'arrow', x1: drag.start.x, y1: drag.start.y, x2: p.x, y2: p.y, color: state.color, width: 3 });
          }
        } else if (drag.mode === 'blur') {
          const { x, y, w, h } = rectFromPoints(drag.start, p);
          if (w > 4 && h > 4) {
            pushHistory();
            state.layers.push({ type: 'blur', x, y, w, h, block: BLUR_BLOCK });
          }
        }
        drag = null;
        cursorCtx.clearRect(0, 0, W, H);
        redraw();
      });

      function redrawCursor() {
        cursorCtx.clearRect(0, 0, W, H);
        if (!drag) return;
        if (drag.mode === 'rect') {
          const { x, y, w, h } = rectFromPoints(drag.start, drag.end);
          const role = state.rectRole;
          const color = role === 'bug' ? '#ef4444' : role === 'expected' ? '#22c55e' : state.color;
          drawRect(cursorCtx, { x, y, w, h, color });
        } else if (drag.mode === 'arrow') {
          drawArrow(cursorCtx, { x1: drag.start.x, y1: drag.start.y, x2: drag.end.x, y2: drag.end.y, color: state.color, width: 3 });
        } else if (drag.mode === 'blur') {
          const { x, y, w, h } = rectFromPoints(drag.start, drag.end);
          cursorCtx.strokeStyle = '#0ea5e9';
          cursorCtx.lineWidth = 2;
          cursorCtx.setLineDash([6, 4]);
          cursorCtx.strokeRect(x, y, w, h);
          cursorCtx.setLineDash([]);
        }
      }

      // ============ Keyboard ============
      function onKey(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        if (e.key === 'Escape') { finish(null); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
        // Tool hotkeys
        const k = e.key.toLowerCase();
        const map = { p: 'pin', r: 'rect', a: 'arrow', t: 'text', b: 'blur', f: 'freehand' };
        if (map[k]) {
          const btn = root.querySelector(`[data-tool="${map[k]}"]`);
          if (btn) btn.click();
        }
      }
      document.addEventListener('keydown', onKey, true);

      // ============ Footer actions ============
      root.querySelector('.qa-annot-undo').addEventListener('click', undo);
      root.querySelector('.qa-annot-redo').addEventListener('click', redo);
      root.querySelector('.qa-annot-clear').addEventListener('click', () => {
        if (!state.layers.length) return;
        if (!confirm('Clear all annotations?')) return;
        pushHistory();
        state.layers = [];
        state.pinCounter = 0;
        redraw();
      });
      root.querySelector('.qa-annot-cancel').addEventListener('click', () => finish(null));
      root.querySelector('.qa-annot-save').addEventListener('click', () => {
        // Flatten: composite the draw canvas onto the base canvas. Blur layers
        // sample baseCtx via getImageData, so reuse that hinted context as the
        // sampling source — no extra readback context needed.
        const out = document.createElement('canvas');
        out.width = W; out.height = H;
        const octx = out.getContext('2d');
        octx.drawImage(baseCanvas, 0, 0);
        for (const l of state.layers) drawLayer(octx, l, baseCtx);
        finish({
          dataUrl: out.toDataURL('image/png'),
          annotations: { width: W, height: H, layers: state.layers }
        });
      });

      function finish(result) {
        document.removeEventListener('keydown', onKey, true);
        root.remove();
        resolve(result);
      }

      // First paint
      redraw();
      updateStatus();
    });
  }

  // ============ Layer renderer ============
  function drawLayer(ctx, l, baseCtx) {
    if (l.type === 'pin')      return drawPin(ctx, l);
    if (l.type === 'rect')     return drawRect(ctx, l);
    if (l.type === 'arrow')    return drawArrow(ctx, l);
    if (l.type === 'text')     return drawText(ctx, l);
    if (l.type === 'blur')     return drawBlur(ctx, l, baseCtx);
    if (l.type === 'freehand') return drawFreehand(ctx, l);
  }

  function drawPin(ctx, l) {
    const { x, y, n, color, style, prefix } = l;
    const label = style === 'letter' ? String.fromCharCode(64 + Math.min(26, n))
                : style === 'prefix' ? `${prefix || 'BUG-'}${n}`
                : String(n);
    ctx.save();
    if (style === 'square-number') {
      const s = PIN_RADIUS * 1.6;
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      roundRect(ctx, x - s, y - s, s * 2, s * 2, 4);
      ctx.fill(); ctx.stroke();
    } else {
      // circle (default) + prefix-style also uses circle
      const r = style === 'prefix' ? PIN_RADIUS * 1.4 : PIN_RADIUS;
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (style === 'prefix' ? '700 12px' : '700 14px') + ' ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
  }

  function drawRect(ctx, { x, y, w, h, color }) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = hexAlpha(color, 0x1A); // ~10%
    ctx.lineWidth = 3;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawArrow(ctx, { x1, y1, x2, y2, color, width = 3 }) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ah = ARROW_HEAD;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ah * Math.cos(ang - Math.PI / 7), y2 - ah * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(x2 - ah * Math.cos(ang + Math.PI / 7), y2 - ah * Math.sin(ang + Math.PI / 7));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawText(ctx, { x, y, text, color = '#1f2937', font = '16px ui-sans-serif, system-ui' }) {
    ctx.save();
    ctx.font = font;
    const m = ctx.measureText(text);
    const tw = m.width;
    const th = parseInt(font, 10) || 16;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundRect(ctx, x - TEXT_PADDING, y - th - TEXT_PADDING, tw + TEXT_PADDING * 2, th + TEXT_PADDING * 2, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawBlur(ctx, { x, y, w, h, block = BLUR_BLOCK }, baseCtx) {
    // Pixelate by sampling baseCtx at coarse grid and re-painting blocks.
    if (!baseCtx) return;
    const ix = Math.max(0, Math.round(x));
    const iy = Math.max(0, Math.round(y));
    const iw = Math.max(1, Math.round(w));
    const ih = Math.max(1, Math.round(h));
    let img;
    try { img = baseCtx.getImageData(ix, iy, iw, ih); }
    catch { return; }                       // tainted canvas — skip silently
    const data = img.data;
    const stride = iw * 4;
    ctx.save();
    for (let by = 0; by < ih; by += block) {
      for (let bx = 0; bx < iw; bx += block) {
        let r = 0, g = 0, b = 0, n = 0;
        const yEnd = Math.min(by + block, ih);
        const xEnd = Math.min(bx + block, iw);
        for (let yy = by; yy < yEnd; yy++) {
          for (let xx = bx; xx < xEnd; xx++) {
            const i = yy * stride + xx * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
        }
        if (n === 0) continue;
        ctx.fillStyle = `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})`;
        ctx.fillRect(ix + bx, iy + by, xEnd - bx, yEnd - by);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ix, iy, iw, ih);
    ctx.restore();
  }

  function drawFreehand(ctx, { points, color, width = 3 }) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  // ============ Helpers ============
  function rectFromPoints(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }
  function hexAlpha(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    return `#${m[1]}${a.toString(16).padStart(2, '0')}`;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  function fitStage(stage, ...canvases) {
    // Stage is centered; canvas natural size up to 90% viewport, preserve aspect.
    const padding = 24;
    const maxW = window.innerWidth - padding * 2;
    const maxH = window.innerHeight - 200;     // toolbar + footer reserve
    if (canvases.length === 0) return;
    const W = canvases[0].width, H = canvases[0].height;
    if (!W || !H) return;
    const scale = Math.min(1, maxW / W, maxH / H);
    stage.style.width = (W * scale) + 'px';
    stage.style.height = (H * scale) + 'px';
  }

  function renderHtml({ pinColor }) {
    const _ = (s) => s; // tag for syntax highlighting later
    return _(`
      <div class="qa-annot-shell">
        <div class="qa-annot-toolbar">
          <div class="qa-annot-tools">
            <button type="button" data-tool="pin" title="Pin (P)">📍 Pin</button>
            <button type="button" data-tool="rect" title="Rectangle (R)">▭ Rect</button>
            <button type="button" data-tool="arrow" title="Arrow (A)">↗ Arrow</button>
            <button type="button" data-tool="text" title="Text (T)">T Text</button>
            <button type="button" data-tool="blur" title="Blur PII (B)">▒ Blur</button>
            <button type="button" data-tool="freehand" title="Freehand (F)">✎ Pen</button>
          </div>
          <div class="qa-annot-options">
            <span data-tool-options="rect" hidden>
              <button type="button" data-rect-role="bug" class="active" title="Bug area">Bug</button>
              <button type="button" data-rect-role="expected" title="Expected area">Expected</button>
              <button type="button" data-rect-role="info" title="Info">Info</button>
            </span>
            <span data-tool-options="text" hidden>
              <input type="text" class="qa-annot-text" value="Note" placeholder="Text" />
            </span>
            <label class="qa-annot-color-wrap">
              Color
              <input type="color" class="qa-annot-color" value="${pinColor}" />
            </label>
          </div>
        </div>
        <div class="qa-annot-stage">
          <canvas class="qa-annot-base"></canvas>
          <canvas class="qa-annot-draw"></canvas>
          <canvas class="qa-annot-cursor"></canvas>
        </div>
        <div class="qa-annot-footer">
          <span class="qa-annot-status"></span>
          <span class="qa-annot-spacer"></span>
          <button type="button" class="qa-annot-undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="qa-annot-redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button type="button" class="qa-annot-clear">Clear all</button>
          <button type="button" class="qa-annot-cancel">Cancel</button>
          <button type="button" class="qa-annot-save qa-primary">Save</button>
        </div>
      </div>
    `);
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.annotationEditor = { open };
})();
