/**
 * Lifting a signature or a logo off the paper it was photographed on.
 *
 * Ported from the voyage-manager app so both programmes treat an uploaded
 * signature the same way. The approach, and why it is not a plain luminance
 * threshold:
 *
 * Real photos are not ink-on-white. The paper is off-white, carries texture and
 * is unevenly lit, so a fixed cutoff keeps the shadow down one edge as a grey
 * slab. Two things drive the decision instead:
 *
 *  - Paper brightness is estimated LOCALLY, on a coarse grid using a high
 *    percentile per block, then dilated and smoothed. Each pixel is judged
 *    against the paper beside it, which cancels the lighting gradient.
 *  - Chroma counts as evidence of ink. Paper stays near-neutral however it is
 *    lit, while ballpoint and stamp ink are strongly coloured, so a saturated
 *    pixel is kept even where it is no darker than its surroundings.
 *
 * Alpha is ramped rather than switched so stroke edges stay smooth, and the
 * result is cropped to the ink because the print slot is only a few cm wide. If
 * nothing resembling ink is found the original is returned untouched — an image
 * is never silently blanked.
 */
const ImageCutout = (() => {

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Invalid image'));
      img.src = dataUrl;
    });
  }

  /** True when every pixel is fully opaque, so PNG buys nothing. */
  function isOpaque(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
    return true;
  }

  /**
   * PNG only where it earns its place. Transparency has to survive — flattened
   * to JPEG a cut-out signature would print as a white box over the sheet — but
   * a photographed logo with its background left on is opaque, and as PNG it is
   * several hundred KB that then rides in every page load. Those go to JPEG.
   */
  function encode(canvas, ctx, w, h, fallback) {
    try {
      return isOpaque(ctx, w, h)
        ? canvas.toDataURL('image/jpeg', 0.85)
        : canvas.toDataURL('image/png');
    } catch {
      return fallback;
    }
  }

  /**
   * Scale an uploaded file down, keeping transparency where the image has any.
   */
  async function toPngDataUrl(file, maxEdge = 900, onProgress = null) {
    if (onProgress) onProgress(3, 'Reading the file…');
    const raw = await readFileAsDataUrl(file);
    if (!raw || typeof raw !== 'string' || !raw.startsWith('data:image/')) return raw;
    const img = await loadImage(raw);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!(w > 0 && h > 0)) return raw;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return encode(canvas, ctx, w, h, raw);
  }

  /**
   * Bounds of the main body of ink, ignoring strays.
   *
   * A signature is usually photographed on a page holding other marks. The
   * bounding box of every surviving pixel would swallow those and leave the real
   * signature a small feature of a large crop, which then scales to nothing in
   * the print slot. So the ink is grouped into connected blobs and only the main
   * cluster is kept: the largest blob, anything close enough to belong to the
   * same signature (dots, detached strokes), and anything large enough to be a
   * second half. Runs on a downsampled mask — this is grouping, not precision.
   */
  function inkClusterBounds(px, w, h, { alphaMin = 24, nearFrac = 0.12, keepFrac = 0.35 } = {}) {
    const scale = Math.max(1, Math.ceil(Math.max(w, h) / 320));
    const mw = Math.ceil(w / scale);
    const mh = Math.ceil(h / scale);
    const mask = new Uint8Array(mw * mh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > alphaMin) mask[((y / scale) | 0) * mw + ((x / scale) | 0)] = 1;
      }
    }
    const label = new Int32Array(mw * mh).fill(-1);
    const comps = [];
    const stack = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || label[i] !== -1) continue;
      const id = comps.length;
      const c = { area: 0, x0: mw, y0: mh, x1: -1, y1: -1 };
      comps.push(c);
      stack.length = 0;
      stack.push(i);
      label[i] = id;
      while (stack.length) {
        const p = stack.pop();
        const cx = p % mw;
        const cy = (p / mw) | 0;
        c.area++;
        if (cx < c.x0) c.x0 = cx;
        if (cx > c.x1) c.x1 = cx;
        if (cy < c.y0) c.y0 = cy;
        if (cy > c.y1) c.y1 = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
            const q = ny * mw + nx;
            if (mask[q] && label[q] === -1) { label[q] = id; stack.push(q); }
          }
        }
      }
    }
    // Drop specks before grouping, so surviving grain cannot anchor the crop.
    const minArea = Math.max(3, Math.round(mw * mh * 0.0002));
    const kept = comps.filter((c) => c.area >= minArea);
    if (!kept.length) return null;
    kept.sort((a, b) => b.area - a.area);
    const main = kept[0];
    const near = Math.max(mw, mh) * nearFrac;
    let x0 = main.x0;
    let y0 = main.y0;
    let x1 = main.x1;
    let y1 = main.y1;
    // Grown against the running box, so a chain of strokes pulls the whole
    // signature in while an isolated corner fragment stays out.
    for (let i = 1; i < kept.length; i++) {
      const c = kept[i];
      const gapX = Math.max(0, Math.max(x0 - c.x1, c.x0 - x1));
      const gapY = Math.max(0, Math.max(y0 - c.y1, c.y0 - y1));
      if ((gapX <= near && gapY <= near) || c.area >= main.area * keepFrac) {
        if (c.x0 < x0) x0 = c.x0;
        if (c.x1 > x1) x1 = c.x1;
        if (c.y0 < y0) y0 = c.y0;
        if (c.y1 > y1) y1 = c.y1;
      }
    }
    return {
      minX: x0 * scale,
      minY: y0 * scale,
      maxX: Math.min(w - 1, (x1 + 1) * scale - 1),
      maxY: Math.min(h - 1, (y1 + 1) * scale - 1),
    };
  }

  /**
   * Coarse per-block estimate of a channel, dilated then smoothed, with a
   * bilinear sampler. Used twice: for how BRIGHT the paper is (high percentile,
   * max-dilated — paper is the brightest thing in a block that also holds ink)
   * and for how SATURATED it is (low percentile, min-dilated — paper is the
   * least saturated).
   */
  function paperField(values, w, h, { percentile, dilate }) {
    const block = Math.max(8, Math.round(Math.min(w, h) / 24));
    const gw = Math.max(1, Math.ceil(w / block));
    const gh = Math.max(1, Math.ceil(h / block));
    const grid = new Float32Array(gw * gh);
    const bucket = [];
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        bucket.length = 0;
        const bx1 = Math.min(w, (gx + 1) * block);
        const by1 = Math.min(h, (gy + 1) * block);
        for (let y = gy * block; y < by1; y++) {
          for (let x = gx * block; x < bx1; x++) bucket.push(values[y * w + x]);
        }
        if (!bucket.length) { grid[gy * gw + gx] = dilate === 'max' ? 255 : 0; continue; }
        bucket.sort((a, b) => a - b);
        grid[gy * gw + gx] = bucket[Math.min(bucket.length - 1, Math.floor(bucket.length * percentile))];
      }
    }
    // Blocks buried under a thick stroke inherit the paper beside them.
    const dilated = new Float32Array(grid.length);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let m = dilate === 'max' ? 0 : Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const v = grid[ny * gw + nx];
            if (dilate === 'max' ? v > m : v < m) m = v;
          }
        }
        dilated[gy * gw + gx] = m;
      }
    }
    // Smooth, so the estimate does not step between blocks.
    const smooth = new Float32Array(grid.length);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            sum += dilated[ny * gw + nx];
            n++;
          }
        }
        smooth[gy * gw + gx] = sum / n;
      }
    }
    return (x, y) => {
      const fx = Math.min(gw - 1, Math.max(0, x / block - 0.5));
      const fy = Math.min(gh - 1, Math.max(0, y / block - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(gw - 1, x0 + 1);
      const y1 = Math.min(gh - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const a = smooth[y0 * gw + x0];
      const b = smooth[y0 * gw + x1];
      const c = smooth[y1 * gw + x0];
      const d = smooth[y1 * gw + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
  }

  /** Let the browser paint between phases of otherwise blocking pixel work. */
  function breathe() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Make the paper transparent and crop to the ink.
   *
   * `onProgress(pct, message)` is called between phases, and the work yields to
   * the event loop around each one so the bar actually paints — this is several
   * hundred thousand pixels and blocks the main thread otherwise.
   */
  async function removeBackground(srcDataUrl, {
    lo = 10, hi = 40, neutralLo = 26, neutralHi = 62, chroma = 1.3, pad = 6, onProgress = null,
  } = {}) {
    const report = async (pct, message) => {
      if (onProgress) { onProgress(pct, message); await breathe(); }
    };
    await report(5, 'Reading the image…');
    if (!srcDataUrl || typeof srcDataUrl !== 'string' || !srcDataUrl.startsWith('data:image/')) {
      return srcDataUrl;
    }
    const img = await loadImage(srcDataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!(w > 0 && h > 0)) return srcDataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;

    await report(15, 'Measuring the paper…');
    const luma = new Float32Array(w * h);
    const sat = new Float32Array(w * h);
    for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      luma[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[p] = Math.max(r, g, b) - Math.min(r, g, b);
    }

    const paperLumaAt = paperField(luma, w, h, { percentile: 0.9, dilate: 'max' });
    await report(35, 'Measuring the paper colour…');
    /* Paper is not always neutral: photographed under warm light, or on cream
       stock, it carries a tint of its own that would otherwise read as ink and
       defeat the crop entirely. So saturation is judged against the paper beside
       it too — the same trick the luminance test uses for shadows. On genuinely
       white paper this estimate is ~0 and the test is unchanged. */
    const paperSatAt = paperField(sat, w, h, { percentile: 0.1, dilate: 'min' });
    await report(50, 'Separating the ink…');

    /* Two independent kinds of evidence, each with its own ramp. Coloured pixels
       are ink even when pale, so chroma gets the low bar. A neutral pixel could
       equally be paper grain or a shadow, so it has to be clearly darker than the
       paper beside it before it counts — one shared threshold let paper texture
       through as ink and defeated the crop entirely. Black ink still passes
       easily on the neutral ramp, being far darker than any grain. */
    const span = Math.max(1, hi - lo);
    const neutralSpan = Math.max(1, neutralHi - neutralLo);
    const ramp = (v, from, width) => (v <= from ? 0 : Math.min(1, (v - from) / width));
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let inkCount = 0;
    const band = Math.max(1, Math.ceil(h / 8));
    for (let y0b = 0; y0b < h; y0b += band) {
      const yEnd = Math.min(h, y0b + band);
      for (let y = y0b; y < yEnd; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const i = p * 4;
          if (px[i + 3] === 0) continue;
          const coloured = Math.max(0, sat[p] - paperSatAt(x, y));
          const darker = paperLumaAt(x, y) - luma[p];
          const k = Math.max(ramp(coloured * chroma, lo, span), ramp(darker, neutralLo, neutralSpan));
          const a = Math.round(px[i + 3] * k);
          px[i + 3] = a;
          if (a > 24) {
            inkCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      await report(50 + Math.round((yEnd / h) * 35), 'Separating the ink…');
    }
    // Nothing that looked like ink — leave the image exactly as it came in.
    if (maxX < 0 || inkCount < (w * h) * 0.0005) return srcDataUrl;

    await report(88, 'Trimming to the signature…');
    ctx.putImageData(data, 0, 0);
    const bounds = inkClusterBounds(px, w, h) || { minX, minY, maxX, maxY };
    const x0 = Math.max(0, bounds.minX - pad);
    const y0 = Math.max(0, bounds.minY - pad);
    const cw = Math.min(w, bounds.maxX + pad + 1) - x0;
    const ch = Math.min(h, bounds.maxY + pad + 1) - y0;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
    await report(100, 'Done');
    try { return out.toDataURL('image/png'); } catch { return srcDataUrl; }
  }

  return { readFileAsDataUrl, toPngDataUrl, removeBackground };
})();

window.ImageCutout = ImageCutout;
