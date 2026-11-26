// Offline route map (Mercator, canvas). Works in browsers (window.SeaMap) and exports the pure helpers to Node for tests.
//   SeaMap.decodeLand(json)  -> land rings (Float64Array of [lon, lat, ...] with a bounding box each)
//   SeaMap.create(host, { land, zones, areas, onClose }) -> { setRoutes(routes), fit(), resize(), destroy() }
//   route = { path: [[lat, lon], ...], color, label, from: {lat, lon, name}, to: {lat, lon, name}, ecaRuns: [{eca, from, to}], passages: ['suez', ...] }
// Planning picture only: generalised coastline, not a chart.
(function (root) {
  'use strict';
  const MAXLAT = 82, R_NM = 3440.065, rad = Math.PI / 180;
  const my = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * rad / 2)) / rad; // Mercator y in degrees-equivalent
  const myInv = y => (2 * Math.atan(Math.exp(y * rad)) - Math.PI / 2) / rad;
  const PASSAGE_AT = { suez: [32.5, 30.3, 'Suez'], panama: [-79.6, 9.1, 'Panama'], babalmandab: [43.3, 12.6, 'Bab-el-Mandeb'], malacca: [101.0, 2.8, 'Malacca'],
    ormuz: [56.5, 26.5, 'Hormuz'], south_africa: [20.0, -35.0, 'Cape of Good Hope'], sunda: [105.9, -6.2, 'Sunda'], gibraltar: [-5.6, 36.0, 'Gibraltar'],
    bosporus: [29.0, 41.1, 'Bosporus'], dardanelles: [26.4, 40.1, 'Dardanelles'], chili: [-70.0, -53.5, 'Magellan'], bering: [-169.0, 65.7, 'Bering'] };
  const PASSAGE_NAMES = Object.keys(PASSAGE_AT);

  function decodeLand(json) {
    const q = json.q || 100, out = [];
    for (const flat of json.rings) {
      const n = flat.length / 2, pts = new Float64Array(flat.length);
      let x = 0, y = 0, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (let i = 0; i < n; i++) {
        x += flat[2 * i]; y += flat[2 * i + 1];
        const lon = x / q, lat = y / q; pts[2 * i] = lon; pts[2 * i + 1] = lat;
        if (lon < minx) minx = lon; if (lon > maxx) maxx = lon; if (lat < miny) miny = lat; if (lat > maxy) maxy = lat;
      }
      out.push({ pts, minx, miny, maxx, maxy });
    }
    return out;
  }
  /** Make a path's longitudes continuous (a route across the 180th meridian goes on to 190, 200 ... instead of jumping back). */
  function unwrap(path) {
    const out = []; let off = 0;
    path.forEach((p, i) => {
      if (i) { const prev = path[i - 1][1]; const d = p[1] - prev; if (d > 180) off -= 360; else if (d < -180) off += 360; }
      out.push([p[0], p[1] + off]);
    });
    return out;
  }
  function niceNm(nm) { const e = Math.pow(10, Math.floor(Math.log10(nm))); const f = nm / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e; }

  function create(host, opts) {
    const doc = host.ownerDocument;
    const canvas = doc.createElement('canvas'); canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab;';
    host.appendChild(canvas);
    const ctx2 = canvas.getContext('2d');
    const st = { lon: 0, y: 0, k: 4, routes: [], w: 300, h: 300, dpr: 1, showEca: true, showAreas: true };
    const land = opts.land || [];
    function resize() {
      st.dpr = (host.ownerDocument.defaultView && host.ownerDocument.defaultView.devicePixelRatio) || 1;
      const r = host.getBoundingClientRect(); st.w = Math.max(100, r.width); st.h = Math.max(100, r.height);
      canvas.width = Math.round(st.w * st.dpr); canvas.height = Math.round(st.h * st.dpr); draw();
    }
    const X = lon => (lon - st.lon) * st.k + st.w / 2, Y = lat => (st.y - my(lat)) * st.k + st.h / 2;
    const lonAt = px => (px - st.w / 2) / st.k + st.lon, latAt = py => myInv(st.y - (py - st.h / 2) / st.k);

    function fit() {
      const pts = []; st.routes.forEach(r => unwrap(r.path).forEach(p => pts.push(p)));
      if (!pts.length) { st.lon = 0; st.y = my(20); st.k = Math.max(0.8, st.w / 360); draw(); return; }
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      pts.forEach(p => { const yy = my(p[0]); x0 = Math.min(x0, p[1]); x1 = Math.max(x1, p[1]); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); });
      const padX = Math.max(1.5, (x1 - x0) * 0.08), padY = Math.max(1.5, (y1 - y0) * 0.08);
      x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
      st.lon = (x0 + x1) / 2; st.y = (y0 + y1) / 2; st.k = Math.min(st.w / (x1 - x0), st.h / (y1 - y0)); st.k = Math.max(0.6, Math.min(st.k, 400)); draw();
    }
    function ringPath(c, pts, off) {
      c.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const x = X(pts[i] + off), y = Y(pts[i + 1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.closePath();
    }
    function drawGrid(c) {
      const spans = [1, 2, 5, 10, 15, 30, 45]; const step = spans.find(s => s * st.k >= 70) || 90;
      c.save(); c.strokeStyle = 'rgba(160,190,220,.18)'; c.fillStyle = 'rgba(180,205,230,.7)'; c.lineWidth = 1; c.font = '10px sans-serif';
      const lo = Math.floor(lonAt(0) / step) * step, hi = lonAt(st.w);
      for (let l = lo; l <= hi; l += step) { const x = X(l); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, st.h); c.stroke(); let n = ((l + 540) % 360) - 180; c.fillText(Math.abs(n) + (n < 0 ? 'W' : n > 0 ? 'E' : ''), x + 2, st.h - 3); }
      const la0 = Math.max(-MAXLAT, latAt(st.h)), la1 = Math.min(MAXLAT, latAt(0));
      for (let l = Math.ceil(la0 / step) * step; l <= la1; l += step) { const y = Y(l); c.beginPath(); c.moveTo(0, y); c.lineTo(st.w, y); c.stroke(); c.fillText(Math.abs(l) + (l < 0 ? 'S' : l > 0 ? 'N' : ''), 3, y - 2); }
      c.restore();
    }
    function polyFill(c, ring, color, offs) {
      c.fillStyle = color;
      offs.forEach(off => { c.beginPath(); ring.forEach((p, i) => { const x = X(p[0] + off), y = Y(p[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); c.fill(); });
    }
    function draw() {
      const c = ctx2; c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      c.fillStyle = '#0f2a40'; c.fillRect(0, 0, st.w, st.h);
      drawGrid(c);
      const x0 = lonAt(0), x1 = lonAt(st.w), yTop = latAt(0), yBot = latAt(st.h);
      const offs = [-720, -360, 0, 360, 720].filter(o => true);
      // zones under the land so the coast stays crisp
      if (st.showEca && opts.zones) opts.zones.forEach(z => z.rings.forEach(r => polyFill(c, r, 'rgba(255,196,80,.30)', offs.filter(o => Math.abs(o) <= 360))));
      if (st.showAreas && opts.areas) opts.areas.forEach(a => { const b = a.box; polyFill(c, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], 'rgba(230,60,60,.25)', offs.filter(o => Math.abs(o) <= 360)); });
      c.fillStyle = '#d9d4c2'; c.strokeStyle = '#8c8777'; c.lineWidth = 0.6;
      for (const r of land) {
        for (const off of offs) {
          if (r.maxx + off < x0 || r.minx + off > x1 || r.maxy < yBot || r.miny > yTop) continue;
          ringPath(c, r.pts, off); c.fill(); c.stroke();
        }
      }
      // routes
      st.routes.forEach(r => {
        const P = unwrap(r.path); if (P.length < 2) return;
        [-360, 0, 360].forEach(off => {
          c.lineJoin = 'round'; c.lineCap = 'round';
          c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 5; c.beginPath(); P.forEach((p, i) => { const x = X(p[1] + off), y = Y(p[0]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
          c.strokeStyle = r.color || '#27d3ff'; c.lineWidth = 3; c.beginPath(); P.forEach((p, i) => { const x = X(p[1] + off), y = Y(p[0]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
          (r.ecaRuns || []).filter(e => e.eca && e.pts && e.pts.length > 1).forEach(e => {
            const E = unwrapNear(e.pts, P); c.strokeStyle = '#ff9f1c'; c.lineWidth = 5; c.beginPath();
            E.forEach((p, i) => { const x = X(p[1] + off), y = Y(p[0]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
          });
        });
        (r.passages || []).forEach(id => { const q = PASSAGE_AT[id]; if (!q) return; const x = X(q[0] + nearOffset(q[0], P)), y = Y(q[1]); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3.5, 0, 6.3); c.fill(); c.stroke(); label(c, q[2], x + 6, y - 5, '#fff'); });
      });
      // ports
      st.routes.forEach(r => [r.from, r.to].forEach((p, i) => {
        if (!p) return; const P = unwrap(r.path); const lon = p.lon + nearOffset(p.lon, P); const x = X(lon), y = Y(p.lat);
        c.fillStyle = i ? '#ff5470' : '#4cd964'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 5, 0, 6.3); c.fill(); c.stroke(); label(c, p.name, x + 8, y + 4, '#fff');
      }));
      drawScale(c);
    }
    function nearOffset(lon, P) { const mid = P[Math.floor(P.length / 2)][1]; return Math.round((mid - lon) / 360) * 360; }
    function unwrapNear(pts, P) { const u = unwrap(pts); const o = nearOffset(u[0][1], P); return u.map(p => [p[0], p[1] + o]); }
    function label(c, text, x, y, col) { c.font = '12px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(text, x, y); c.fillStyle = col; c.fillText(text, x, y); }
    function drawScale(c) {
      const lat = latAt(st.h / 2), nmPerPx = 60 * Math.cos(lat * rad) / st.k; const nm = niceNm(nmPerPx * 110), px = nm / nmPerPx, x = 14, y = st.h - 24;
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + px, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); c.moveTo(x + px, y - 4); c.lineTo(x + px, y + 4); c.stroke();
      label(c, nm.toLocaleString('en-US') + ' nm', x, y - 8, '#fff');
    }
    function zoomAt(px, py, f) { const lo = lonAt(px), la = latAt(py); st.k = Math.max(0.5, Math.min(2500, st.k * f)); st.lon = lo - (px - st.w / 2) / st.k; st.y = my(la) + (py - st.h / 2) / st.k; clamp(); draw(); }
    function clamp() { st.y = Math.max(my(-MAXLAT) + 5, Math.min(my(MAXLAT) - 5, st.y)); }
    // pointers: drag and pinch
    const ptrs = new Map(); let pinch = 0;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); pinch = 0; canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (ptrs.size === 1) { st.lon -= (e.offsetX - prev[0]) / st.k; st.y += (e.offsetY - prev[1]) / st.k; clamp(); draw(); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch); pinch = d; }
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    canvas.addEventListener('dblclick', e => zoomAt(e.offsetX, e.offsetY, 2));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null; if (ro) ro.observe(host);
    resize();
    return {
      setRoutes(routes) { st.routes = routes || []; fit(); }, fit, resize,
      zoom(f) { zoomAt(st.w / 2, st.h / 2, f); },
      set(opt) { Object.assign(st, opt); draw(); },
      state: () => ({ lon: st.lon, y: st.y, k: st.k }),
      toDataURL: () => canvas.toDataURL('image/png'),
      destroy() { if (ro) ro.disconnect(); canvas.remove(); },
    };
  }
  const api = { create, decodeLand, unwrap, my, myInv, niceNm, PASSAGE_AT, PASSAGE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeaMap = api;
})(typeof self !== 'undefined' ? self : this);
