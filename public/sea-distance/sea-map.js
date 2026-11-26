// Offline route map (Mercator, canvas). Works in browsers (window.SeaMap) and exports the pure helpers to Node for tests.
//   SeaMap.decodeLand(json)  -> land rings (Float64Array of [lon, lat, ...] with a bounding box each)
//   SeaMap.create(host, { land, zones, areas, onClose }) -> { setRoutes(routes), fit(), resize(), destroy() }
//   map.edit({ from, to, wps, color, onChange(wps) -> { ecaRuns }, crosses(a, b) -> { land, near }, onSelect(i) }) -> { get(), set(wps), removeSelected(), selected(), stop() }: drag the waypoints, add one from the + in the middle of a leg, double-click one to remove it
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
    st.edit = null; st.drag = null;
    const wrapLon = lo => ((lo + 540) % 360) - 180;
    /** Points along the great circle a -> b ([lat, lon]), about every `step` degrees, both ends included. */
    function gcSample(a, b, step) {
      const la1 = a[0] * rad, lo1 = a[1] * rad, la2 = b[0] * rad, lo2 = b[1] * rad;
      const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)));
      if (d < 1e-9) return [a.slice(), b.slice()];
      const n = Math.max(1, Math.ceil(d / rad / step)), out = [];
      for (let k = 0; k <= n; k++) {
        const f = k / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
        out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / rad, Math.atan2(y, x) / rad]);
      }
      return out;
    }
    /** The edited route as one list of points: the from port, the waypoints, the to port. */
    const editPts = () => [[st.edit.from.lat, st.edit.from.lon]].concat(st.edit.wps, [[st.edit.to.lat, st.edit.to.lon]]);
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
      if (st.edit) drawEdit(c);
      // ports
      st.routes.concat(st.edit ? [{ from: st.edit.from, to: st.edit.to, path: unwrap(editPts()) }] : []).forEach(r => [r.from, r.to].forEach((p, i) => {
        if (!p) return; const P = unwrap(r.path); const lon = p.lon + nearOffset(p.lon, P); const x = X(lon), y = Y(p.lat);
        c.fillStyle = i ? '#ff5470' : '#4cd964'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 5, 0, 6.3); c.fill(); c.stroke(); label(c, p.name, x + 8, y + 4, '#fff');
      }));
      drawScale(c);
    }
    function drawEdit(c) {
      const E = st.edit, pts = editPts(), U = unwrap(pts);
      [-360, 0, 360].forEach(off => {
        c.lineJoin = 'round'; c.lineCap = 'round';
        for (let i = 1; i < pts.length; i++) {
          const seg = gcSample(pts[i - 1], pts[i], 1.5), Us = unwrapNear(seg, U);
          const chk = E.crosses ? E.crosses(pts[i - 1], pts[i]) : { land: false, near: false };
          c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 5; c.setLineDash([]);
          c.beginPath(); Us.forEach((p, k) => { const x = X(p[1] + off), y = Y(p[0]); if (k) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
          c.strokeStyle = chk.land ? '#ff3b3b' : chk.near ? '#ffd23f' : (E.color || '#27d3ff'); c.lineWidth = 3; c.setLineDash(chk.near ? [7, 5] : []);
          c.beginPath(); Us.forEach((p, k) => { const x = X(p[1] + off), y = Y(p[0]); if (k) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
        }
        (E.ecaRuns || []).filter(e => e.eca && e.pts && e.pts.length > 1).forEach(e => {
          const Q = unwrapNear(e.pts, U); c.strokeStyle = '#ff9f1c'; c.lineWidth = 5; c.beginPath();
          Q.forEach((p, i) => { const x = X(p[1] + off), y = Y(p[0]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
        });
        // + in the middle of each leg, then the waypoints
        for (let i = 1; i < pts.length; i++) {
          const h = midOf(pts[i - 1], pts[i]); const x = X(h[1] + nearOffset(h[1], U) + off), y = Y(h[0]);
          c.fillStyle = 'rgba(255,255,255,.85)'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 5, 0, 6.3); c.fill(); c.stroke();
          c.strokeStyle = '#000'; c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.moveTo(x, y - 3); c.lineTo(x, y + 3); c.stroke();
        }
        E.wps.forEach((w, i) => {
          const x = X(U[i + 1][1] + off), y = Y(w[0]), sel = E.sel === i;
          c.fillStyle = sel ? '#ffd23f' : '#ffffff'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, sel ? 9 : 7, 0, 6.3); c.fill(); c.stroke();
          c.fillStyle = '#000'; c.font = '10px sans-serif'; c.textAlign = 'center'; c.fillText(String(i + 1), x, y + 3.5); c.textAlign = 'start';
        });
      });
    }
    /** The great-circle half-way point of a leg. */
    const midOf = (a, b) => gcMid(a, b);
    function gcMid(a, b) {
      const la1 = a[0] * rad, lo1 = a[1] * rad, la2 = b[0] * rad, lo2 = b[1] * rad;
      const bx = Math.cos(la2) * Math.cos(lo2 - lo1), by = Math.cos(la2) * Math.sin(lo2 - lo1);
      const la = Math.atan2(Math.sin(la1) + Math.sin(la2), Math.sqrt((Math.cos(la1) + bx) ** 2 + by * by)), lo = lo1 + Math.atan2(by, Math.cos(la1) + bx);
      return [la / rad, wrapLon(lo / rad)];
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
    /** What the pointer is on in edit mode: a waypoint ({wp: i}), the + of a leg ({mid: i}), or nothing. */
    function hitEdit(px, py) {
      if (!st.edit) return null;
      const E = st.edit, pts = editPts(), U = unwrap(pts), R = 14;
      for (const off of [-360, 0, 360]) {
        for (let i = E.wps.length - 1; i >= 0; i--) if (Math.hypot(X(U[i + 1][1] + off) - px, Y(E.wps[i][0]) - py) <= R) return { wp: i };
        for (let i = 1; i < pts.length; i++) { const h = gcMid(pts[i - 1], pts[i]); if (Math.hypot(X(h[1] + nearOffset(h[1], U) + off) - px, Y(h[0]) - py) <= R - 3) return { mid: i - 1 }; }
      }
      return null;
    }
    const changed = () => { if (st.edit.onChange) { const r = st.edit.onChange(st.edit.wps.map(w => w.slice())); if (r && r.ecaRuns) st.edit.ecaRuns = r.ecaRuns; } draw(); };
    canvas.addEventListener('pointerdown', e => {
      if (st.edit) {
        const h = hitEdit(e.offsetX, e.offsetY);
        if (h) {
          canvas.setPointerCapture(e.pointerId);
          if (h.mid != null) { st.edit.wps.splice(h.mid, 0, gcMid(editPts()[h.mid], editPts()[h.mid + 1])); h.wp = h.mid; st.edit.dirty = true; }
          st.edit.sel = h.wp; st.drag = { i: h.wp, id: e.pointerId }; if (st.edit.onSelect) st.edit.onSelect(h.wp); changed(); canvas.style.cursor = 'move'; return;
        }
        if (st.edit.sel >= 0) { st.edit.sel = -1; if (st.edit.onSelect) st.edit.onSelect(-1); draw(); }
      }
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); pinch = 0; canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      if (st.drag && e.pointerId === st.drag.id) {
        st.edit.wps[st.drag.i] = [Math.max(-85, Math.min(85, latAt(e.offsetY))), wrapLon(lonAt(e.offsetX))]; st.edit.dirty = true; changed(); return;
      }
      if (st.edit && !ptrs.has(e.pointerId)) canvas.style.cursor = hitEdit(e.offsetX, e.offsetY) ? 'move' : 'grab';
      if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (ptrs.size === 1) { st.lon -= (e.offsetX - prev[0]) / st.k; st.y += (e.offsetY - prev[1]) / st.k; clamp(); draw(); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch); pinch = d; }
    });
    const up = e => { if (st.drag && e.pointerId === st.drag.id) { st.drag = null; canvas.style.cursor = 'grab'; if (st.edit && st.edit.onCommit) st.edit.onCommit(st.edit.wps.map(w => w.slice())); return; } ptrs.delete(e.pointerId); pinch = 0; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    canvas.addEventListener('dblclick', e => { const h = st.edit && hitEdit(e.offsetX, e.offsetY); if (h && h.wp != null) { st.edit.sel = h.wp; removeSelected(); return; } if (h) return; zoomAt(e.offsetX, e.offsetY, 2); });
    function removeSelected() {
      const E = st.edit; if (!E || E.sel < 0 || E.sel >= E.wps.length) return false;
      E.wps.splice(E.sel, 1); E.sel = -1; E.dirty = true; if (E.onSelect) E.onSelect(-1); changed(); if (E.onCommit) E.onCommit(E.wps.map(w => w.slice())); return true;
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null; if (ro) ro.observe(host);
    resize();
    return {
      setRoutes(routes) { st.routes = routes || []; fit(); }, fit, resize,
      zoom(f) { zoomAt(st.w / 2, st.h / 2, f); },
      set(opt) { Object.assign(st, opt); draw(); },
      state: () => ({ lon: st.lon, y: st.y, k: st.k }),
      /** Edit one route: see the header of this file. */
      edit(cfg) {
        st.edit = { from: cfg.from, to: cfg.to, color: cfg.color, wps: (cfg.wps || []).map(w => w.slice()), sel: -1, dirty: false, ecaRuns: [], onChange: cfg.onChange, onCommit: cfg.onCommit, onSelect: cfg.onSelect, crosses: cfg.crosses };
        changed();
        return {
          get: () => st.edit ? st.edit.wps.map(w => w.slice()) : [],
          set: (w) => { if (st.edit) { st.edit.wps = (w || []).map(p => p.slice()); st.edit.sel = -1; changed(); } },
          removeSelected, selected: () => st.edit ? st.edit.sel : -1, dirty: () => !!(st.edit && st.edit.dirty),
          stop: () => { st.edit = null; st.drag = null; draw(); },
        };
      },
      toDataURL: () => canvas.toDataURL('image/png'),
      destroy() { if (ro) ro.disconnect(); canvas.remove(); },
    };
  }
  const api = { create, decodeLand, unwrap, my, myInv, niceNm, PASSAGE_AT, PASSAGE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeaMap = api;
})(typeof self !== 'undefined' ? self : this);
