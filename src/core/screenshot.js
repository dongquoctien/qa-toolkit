// Crop + annotate a captured tab screenshot to focus on picked elements.
//
// Input: full-viewport PNG data URL (from chrome.tabs.captureVisibleTab) +
//        list of element rects in viewport coordinates (CSS px).
// Output: cropped PNG data URL with a red border drawn around each element rect.
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

  async function cropAndAnnotate(fullDataUrl, rects) {
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

    // Border around each element rect, translated into the cropped frame.
    const accent = getAccentColor();
    ctx.strokeStyle = accent;
    ctx.lineWidth = BORDER_WIDTH * Math.max(1, Math.min(dpr, 2));
    ctx.shadowColor = accent + '66'; // ~40% alpha
    ctx.shadowBlur = 8 * dpr;
    for (const r of rects) {
      const x = (r.x - minX) * dpr;
      const y = (r.y - minY) * dprY;
      const w = r.w * dpr;
      const h = r.h * dprY;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.shadowBlur = 0;

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
  target.QA.screenshot = { cropAndAnnotate };
})();
