// Crop + annotate a captured tab screenshot to focus on picked elements.
//
// Input: full-viewport PNG data URL (from chrome.tabs.captureVisibleTab) +
//        list of element rects in viewport coordinates (CSS px).
// Output: cropped PNG data URL. By default draws a solid accent border + 10%
//         accent fill on each rect. Pass `{ annotate: false }` when DOM rings
//         are already visible in the capture (Recapture path) so we don't
//         double-draw on top of them.
//
// The crop window = bounding box of all element rects + padding, clamped to
// the captured image. A scale factor is applied because captureVisibleTab
// returns a PNG sized to devicePixelRatio.
(function () {
  const PADDING = 80;       // px around the element bounds (in viewport CSS px)
  const BORDER_WIDTH = 3;   // border width in image px (after scaling)

  function getAccentColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--qa-accent').trim();
    return v || '#ec4899';
  }

  async function cropAndAnnotate(fullDataUrl, rects, options = {}) {
    const annotate = options.annotate !== false;
    if (!rects || rects.length === 0) return { dataUrl: fullDataUrl, scale: 1, crop: null };
    const img = await loadImage(fullDataUrl);

    // Scale: captureVisibleTab returns image at device-pixel-ratio. We compare
    // image dimensions against the viewport to find the scale factor.
    const dpr = img.width / window.innerWidth;
    const dprY = img.height / window.innerHeight;
    // Use width-derived dpr; vertical can drift due to scrollbar / device chrome.

    // Bounding box of all picked rects in CSS px (viewport coords).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    minX -= PADDING; minY -= PADDING;
    maxX += PADDING; maxY += PADDING;
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(window.innerWidth, Math.ceil(maxX));
    maxY = Math.min(window.innerHeight, Math.ceil(maxY));
    const cropW = Math.max(1, maxX - minX);
    const cropH = Math.max(1, maxY - minY);

    // Convert crop region to image-pixel coordinates.
    const imgX = Math.round(minX * dpr);
    const imgY = Math.round(minY * dprY);
    const imgW = Math.round(cropW * dpr);
    const imgH = Math.round(cropH * dprY);

    const canvas = document.createElement('canvas');
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl: fullDataUrl, scale: 1, crop: null };

    ctx.drawImage(img, imgX, imgY, imgW, imgH, 0, 0, imgW, imgH);

    if (annotate) {
      // Mimic inspector ring: solid accent border + 10% accent fill.
      const accent = getAccentColor();
      ctx.strokeStyle = accent;
      ctx.lineWidth = BORDER_WIDTH * Math.max(1, Math.min(dpr, 2));
      ctx.fillStyle = accent + '1A'; // ~10% alpha (#RRGGBBAA)
      for (const r of rects) {
        const x = (r.x - minX) * dpr;
        const y = (r.y - minY) * dprY;
        const w = r.w * dpr;
        const h = r.h * dprY;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      scale: dpr,
      crop: { x: minX, y: minY, w: cropW, h: cropH }
    };
  }

  /**
   * Stitch multiple viewport-sized PNG slices into a single tall image, then
   * crop to the document-coord bbox + padding and draw rect borders.
   *
   * Input:
   *   slices: [{ dataUrl, scrollY }]   one viewport capture per scroll position
   *   docRects: [{ x, y, w, h }]       picked element rects in DOCUMENT coords
   *   viewport: { w, h }               innerWidth/innerHeight at capture time
   * Output:
   *   { dataUrl, crop: {x,y,w,h} }     same shape as cropAndAnnotate
   */
  async function cropAndAnnotateStitched({ slices, docRects, viewport }) {
    if (!slices || slices.length === 0 || !docRects || docRects.length === 0) {
      return { dataUrl: null, scale: 1, crop: null };
    }
    const imgs = await Promise.all(slices.map((s) => loadImage(s.dataUrl)));
    // dpr from first slice — captures share a tab's dpr.
    const dpr  = imgs[0].width  / viewport.w;
    const dprY = imgs[0].height / viewport.h;

    // Bounding box of all rects in DOCUMENT coords.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of docRects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    minX -= PADDING; minY -= PADDING;
    maxX += PADDING; maxY += PADDING;
    minX = Math.max(0, Math.floor(minX));
    minY = Math.max(0, Math.floor(minY));
    // Clamp to the actual stitched coverage (covered band [minScrollY .. maxScrollY+vh]).
    const minScrollY = Math.min(...slices.map((s) => s.scrollY));
    const maxScrollY = Math.max(...slices.map((s) => s.scrollY));
    const coveredBottom = maxScrollY + viewport.h;
    maxX = Math.min(viewport.w, Math.ceil(maxX));
    maxY = Math.min(coveredBottom, Math.ceil(maxY));
    minY = Math.max(minScrollY, minY);
    const cropW = Math.max(1, maxX - minX);
    const cropH = Math.max(1, maxY - minY);

    // Crop window in image-pixel coords.
    const imgX = Math.round(minX * dpr);
    const imgW = Math.round(cropW * dpr);
    const imgH = Math.round(cropH * dprY);

    const canvas = document.createElement('canvas');
    canvas.width  = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUrl: null, scale: 1, crop: null };

    // Paint each slice into the canvas at its document-relative offset.
    // Slice at scrollY contains document rows [scrollY, scrollY + viewport.h].
    // We translate that into "rows above minY" and clip to canvas bounds.
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const img = imgs[i];
      const sliceTopDoc = s.scrollY;
      // Where this slice goes in the cropped canvas (in CSS px relative to crop top).
      const dstYCss = sliceTopDoc - minY;
      // Source clip in image pixels.
      // Take the full slice; canvas clipping handles overflow.
      ctx.drawImage(
        img,
        imgX, 0, imgW, img.height,                  // src
        0, Math.round(dstYCss * dprY), imgW, img.height // dst
      );
    }

    // Border + fill on each picked rect (always — caller passes docRects, no DOM rings).
    const accent = getAccentColor();
    ctx.strokeStyle = accent;
    ctx.lineWidth = BORDER_WIDTH * Math.max(1, Math.min(dpr, 2));
    ctx.fillStyle = accent + '1A';
    for (const r of docRects) {
      const x = (r.x - minX) * dpr;
      const y = (r.y - minY) * dprY;
      const w = r.w * dpr;
      const h = r.h * dprY;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      scale: dpr,
      crop: { x: minX, y: minY, w: cropW, h: cropH }
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.screenshot = { cropAndAnnotate, cropAndAnnotateStitched };
})();
