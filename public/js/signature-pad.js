/* Signature pad — sign a document with a finger or a stylus on the device screen.
 *
 * The point of this is that nothing has to be photographed: strokes are drawn as
 * dark ink on a transparent canvas, which is already the form every printout
 * wants. There is no paper to lift off, so none of the background-removal work
 * runs and nothing can be mistaken for ink.
 *
 * Loaded as a browser script; kept in the UMD shape the other core modules use.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SignaturePad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INK = '#101828';
  const BASE_WIDTH = 2.4;      // CSS px at rest
  const MAX_OUTPUT_WIDTH = 900; // matches the cap on uploaded signatures
  const TRIM_PADDING = 8;      // px of clear space kept around the ink

  /* A stroke is a list of points; keeping them (rather than only the pixels)
     is what makes undo possible and what lets the canvas be re-rendered at a
     new size when the device is rotated mid-signature. */
  function makeState() {
    return { strokes: [], current: null };
  }

  function widthFor(point, pointerType) {
    // Pens report real pressure. Fingers and mice report a constant, so for
    // those the nib stays put rather than jittering on a meaningless number.
    if (pointerType !== 'pen') return BASE_WIDTH;
    const p = typeof point.pressure === 'number' && point.pressure > 0 ? point.pressure : 0.5;
    return BASE_WIDTH * (0.55 + 0.9 * p);
  }

  function drawStroke(ctx, stroke, scale) {
    const pts = stroke.points;
    if (!pts.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;

    if (pts.length === 1) {
      const w = widthFor(pts[0], stroke.pointerType) * scale;
      ctx.beginPath();
      ctx.arc(pts[0].x * scale, pts[0].y * scale, w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Curve through the midpoints so the line reads as handwriting rather than
    // as the polyline the pointer events actually deliver.
    for (let i = 1; i < pts.length; i += 1) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const midPrev = i === 1 ? prev : { x: (pts[i - 2].x + prev.x) / 2, y: (pts[i - 2].y + prev.y) / 2 };
      const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
      ctx.beginPath();
      ctx.lineWidth = widthFor(cur, stroke.pointerType) * scale;
      ctx.moveTo(midPrev.x * scale, midPrev.y * scale);
      ctx.quadraticCurveTo(prev.x * scale, prev.y * scale, mid.x * scale, mid.y * scale);
      ctx.stroke();
    }
  }

  function redraw(canvas, state, scale) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of state.strokes) drawStroke(ctx, s, scale);
    if (state.current) drawStroke(ctx, state.current, scale);
  }

  /* Render the strokes on their own canvas and crop to the ink, so the stored
     image is the signature and not the sheet of screen it was drawn on. */
  function toTrimmedPng(state, cssW, cssH) {
    const scale = Math.min(2, MAX_OUTPUT_WIDTH / Math.max(1, cssW));
    const full = document.createElement('canvas');
    full.width = Math.max(1, Math.round(cssW * scale));
    full.height = Math.max(1, Math.round(cssH * scale));
    const ctx = full.getContext('2d');
    for (const s of state.strokes) drawStroke(ctx, s, scale);

    const { data } = ctx.getImageData(0, 0, full.width, full.height);
    let minX = full.width; let minY = full.height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < full.height; y += 1) {
      for (let x = 0; x < full.width; x += 1) {
        if (data[(y * full.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // nothing was drawn

    const pad = Math.round(TRIM_PADDING * scale);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(full.width - 1, maxX + pad); maxY = Math.min(full.height - 1, maxY + pad);

    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(full, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    // PNG, always: the whole image is ink on transparency, which JPEG cannot carry.
    return out.toDataURL('image/png');
  }

  /**
   * Open the pad. Resolves with a transparent-background PNG data URL, or null
   * if the signer cancelled.
   */
  function open(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      const state = makeState();

      const overlay = document.createElement('div');
      overlay.className = 'sigpad-overlay no-print';
      overlay.innerHTML = `
        <div class="sigpad" role="dialog" aria-modal="true" aria-label="Sign on screen">
          <div class="sigpad-head">
            <div>
              <div class="sigpad-title">Sign on screen</div>
              <div class="sigpad-sub">${opts.signerName ? escapeHtml(opts.signerName) : 'Chief Engineer'}</div>
            </div>
            <button class="btn small" data-act="cancel" type="button">Cancel</button>
          </div>
          <div class="sigpad-sheet">
            <canvas class="sigpad-canvas"></canvas>
            <div class="sigpad-baseline"></div>
            <div class="sigpad-hint">Sign above the line with a finger or a stylus</div>
          </div>
          <div class="sigpad-actions">
            <button class="btn small" data-act="undo" type="button" disabled>Undo</button>
            <button class="btn small" data-act="clear" type="button" disabled>Clear</button>
            <span class="sigpad-spacer"></span>
            <button class="btn primary" data-act="save" type="button" disabled>Use signature</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const canvas = overlay.querySelector('.sigpad-canvas');
      const btn = (act) => overlay.querySelector(`[data-act="${act}"]`);
      let cssW = 0;
      let cssH = 0;
      let scale = 1;

      const syncButtons = () => {
        const has = state.strokes.length > 0;
        btn('undo').disabled = !has;
        btn('clear').disabled = !has;
        btn('save').disabled = !has;
      };

      const fit = () => {
        const box = canvas.parentElement.getBoundingClientRect();
        cssW = Math.max(1, Math.round(box.width));
        cssH = Math.max(1, Math.round(box.height));
        scale = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(cssW * scale);
        canvas.height = Math.round(cssH * scale);
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        redraw(canvas, state, scale);
      };

      const pointFrom = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, pressure: e.pressure };
      };

      const onDown = (e) => {
        // Ignore the palm resting on the glass while a pen is in use.
        if (e.pointerType === 'touch' && state.penUsed) return;
        if (e.pointerType === 'pen') state.penUsed = true;
        canvas.setPointerCapture(e.pointerId);
        state.current = { pointerType: e.pointerType, points: [pointFrom(e)] };
        redraw(canvas, state, scale);
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!state.current) return;
        // Coalesced events keep fast strokes smooth on high-rate digitisers.
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        for (const ev of (events.length ? events : [e])) state.current.points.push(pointFrom(ev));
        redraw(canvas, state, scale);
        e.preventDefault();
      };
      const onUp = (e) => {
        if (!state.current) return;
        state.strokes.push(state.current);
        state.current = null;
        redraw(canvas, state, scale);
        syncButtons();
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
        e.preventDefault();
      };

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('pointerleave', onUp);

      const onResize = () => fit();
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);

      const close = (value) => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('orientationchange', onResize);
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);

      btn('cancel').onclick = () => close(null);
      overlay.onclick = (e) => { if (e.target === overlay) close(null); };
      btn('undo').onclick = () => { state.strokes.pop(); redraw(canvas, state, scale); syncButtons(); };
      btn('clear').onclick = () => { state.strokes = []; redraw(canvas, state, scale); syncButtons(); };
      btn('save').onclick = () => {
        const url = toTrimmedPng(state, cssW, cssH);
        close(url);
      };

      // Lay out first, then size the canvas to whatever the sheet actually got.
      requestAnimationFrame(fit);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* Pointer events cover mouse, touch and pen alike, so a device either has a
     usable pointer or it does not. */
  function isSupported() {
    return typeof window !== 'undefined' && 'PointerEvent' in window;
  }

  return { open, isSupported };
});
