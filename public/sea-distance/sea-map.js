// Offline route map (Mercator, canvas). Works in browsers (window.SeaMap) and exports the pure helpers to Node for tests.
//   SeaMap.decodeLand(json)  -> land rings (Float64Array of [lon, lat, ...] with a bounding box each)
//   SeaMap.create(host, { land, zones, areas, lanes, detail, onClose }) -> { setRoutes(routes), fit(), resize(), destroy() }
//   map.edit({ from, to, wps, color, onChange(wps) -> { ecaRuns }, crosses(a, b) -> { land, near }, onSelect(i) }) -> { get(), set(wps), removeSelected(), selected(), stop() }: drag the waypoints, add one from the + in the middle of a leg, double-click one to remove it
//   route = { path: [[lat, lon], ...], color, label, from: {lat, lon, name}, to: {lat, lon, name}, ecaRuns: [{eca, from, to}], passages: ['suez', ...] }
//   opts.detail = { land(): Promise<detail-land json>, water(): Promise<detail-water json> } loads the 1:10m layers when the map is zoomed in (fine coastline, lakes, rivers, 200 m line, names of straits, channels, gulfs, bays);
//   opts.ports = the port list (World Port Index) drawn as pink squares with their names, towns and cities from detail.places(); opts.lanes = the sea-lane network (marnet json): drawn as thin lines, the canals and narrow passages (tagged edges) highlighted.
//   map.set({ showLanes, showNames, showRivers, showDepth, showGrid, showEca, showAreas }); map.where() -> { lat, lon, zoom, nmPerPx }
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
  /** Lines (rivers) from the detail file: [{ r: rank, n: name, f: delta-encoded flat }] -> { pts, bbox, r, n }. */
  function decodeLines(list, q) {
    q = q || 100; const out = [];
    for (const l of list || []) {
      const f = l.f, n = f.length / 2, pts = new Float64Array(f.length); let x = 0, y = 0, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (let i = 0; i < n; i++) { x += f[2 * i]; y += f[2 * i + 1]; const lo = x / q, la = y / q; pts[2 * i] = lo; pts[2 * i + 1] = la; if (lo < minx) minx = lo; if (lo > maxx) maxx = lo; if (la < miny) miny = la; if (la > maxy) maxy = la; }
      out.push({ pts, minx, miny, maxx, maxy, r: l.r, n: l.n });
    }
    return out;
  }
  /** The web-map style zoom level (256 px tiles) of a view with k pixels per degree: names show from their min_label on. */
  const zoomLevel = k => Math.log2(Math.max(1e-6, 360 * k / 256));
  /** The grid step in degrees for a view with k pixels per degree (about 80 px between lines), and a label like 12°30'N. */
  const GRID_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 45, 90];
  const gridStep = k => GRID_STEPS.find(s => s * k >= 80) || 90;
  function fmtDeg(v, isLat, step) {
    const hem = isLat ? (v < 0 ? 'S' : v > 0 ? 'N' : '') : (v < 0 ? 'W' : v > 0 ? 'E' : ''); const a = Math.abs(v);
    if (step >= 1) return Math.round(a) + '°' + hem;
    let d = Math.floor(a + 1e-9), m = (a - d) * 60; const dec = step >= 0.05 ? 0 : step >= 0.01 ? 1 : 2;
    let ms = m.toFixed(dec); if (Number(ms) >= 60) { d += 1; ms = (0).toFixed(dec); }
    return d + '°' + (Number(ms) < 10 ? '0' : '') + ms + "'" + hem;
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
    const st = { lon: 0, y: 0, k: 4, routes: [], w: 300, h: 300, dpr: 1, showEca: true, showAreas: true, showLanes: false, showNames: true, showRivers: true, showDepth: true, showGrid: true, showPlaces: true, showCountries: true, countries: null, showPorts: true, boxes: [], detailPlaces: null, cursor: null, detailLand: null, detailWater: null, asked: {} };
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
      st.lon = (x0 + x1) / 2; st.y = (y0 + y1) / 2; st.k = Math.min(st.w / (x1 - x0), st.h / (y1 - y0)); st.k = Math.max(0.6, Math.min(st.k, 1500)); draw();
    }
    function ringPath(c, pts, off) {
      c.beginPath();
      for (let i = 0; i < pts.length; i += 2) { const x = X(pts[i] + off), y = Y(pts[i + 1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.closePath();
    }
    function drawGrid(c) {
      if (!st.showGrid) return;
      const step = gridStep(st.k);
      c.save(); c.strokeStyle = 'rgba(160,190,220,.18)'; c.fillStyle = 'rgba(180,205,230,.8)'; c.lineWidth = 1; c.font = '10px sans-serif';
      const lo = Math.floor(lonAt(0) / step) * step, hi = lonAt(st.w);
      for (let l = lo; l <= hi + 1e-9; l += step) { const x = Math.round(X(l)) + 0.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, st.h); c.stroke(); const n = ((l + 540) % 360) - 180; c.fillText(fmtDeg(Math.round(n / step) * step, false, step), x + 3, 11); }
      const la0 = Math.max(-MAXLAT, latAt(st.h)), la1 = Math.min(MAXLAT, latAt(0));
      for (let l = Math.ceil(la0 / step) * step; l <= la1 + 1e-9; l += step) { const v = Math.round(l / step) * step, y = Math.round(Y(v)) + 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(st.w, y); c.stroke(); c.fillText(fmtDeg(v, true, step), 3, y - 2); }
      c.restore();
    }
    function polyFill(c, ring, color, offs) {
      c.fillStyle = color;
      offs.forEach(off => { c.beginPath(); ring.forEach((p, i) => { const x = X(p[0] + off), y = Y(p[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); c.fill(); });
    }
    /** Ask for the detailed layers once the view is zoomed in enough to need them. */
    function wantDetail() {
      const d = opts.detail; if (!d) return;
      if (!st.asked.countries && d.countries) { st.asked.countries = 1; Promise.resolve(d.countries()).then(j => { if (!j) return; st.countries = (j.countries || []).map(n => ({ name: n[0], lon: n[1], lat: n[2], min: n[3], max: n[4] })); draw(); }).catch(() => { st.asked.countries = 0; }); }
      if (st.k >= 6 && !st.asked.water && d.water) { st.asked.water = 1; Promise.resolve(d.water()).then(j => { if (!j) return; st.detailWater = { lakes: decodeLand({ q: j.q, rings: j.lakes || [] }), shelf: decodeLand({ q: j.q, rings: j.shelf || [] }), rivers: decodeLines(j.rivers, j.q), reefs: decodeLines(j.reefs, j.q), names: (j.names || []).map(n => ({ name: n[0], lon: n[1], lat: n[2], cls: n[3], min: n[4] == null ? 5 : n[4], size: n[5] })).sort((p, q2) => q2.size - p.size) }; draw(); }).catch(() => { st.asked.water = 0; }); }
      if (st.k >= 12 && !st.asked.places && d.places) { st.asked.places = 1; Promise.resolve(d.places()).then(j => { if (!j) return; st.detailPlaces = (j.places || []).map(p => ({ name: p[0], lon: p[1], lat: p[2], z: p[3], cap: p[4], pop: p[5] })); draw(); }).catch(() => { st.asked.places = 0; }); }
      if (st.k >= 10 && !st.asked.land && d.land) { st.asked.land = 1; Promise.resolve(d.land()).then(j => { if (!j) return; st.detailLand = { mid: decodeLand({ q: j.q, rings: j.mid || [] }), fine: decodeLand({ q: j.q, rings: j.fine || [] }) }; draw(); }).catch(() => { st.asked.land = 0; }); }
    }
    function lanePoints() {
      if (st.laneNodes || !opts.lanes) return;
      st.laneNodes = opts.lanes.nodes; st.laneEdges = opts.lanes.edges; st.laneTags = opts.lanes.tags || [];
    }
    function drawLanes(c, offs) {
      lanePoints(); if (!st.laneNodes) return;
      const N = st.laneNodes, E = st.laneEdges, x0 = lonAt(0) - 1, x1 = lonAt(st.w) + 1, yT = latAt(0) + 1, yB = latAt(st.h) - 1; const all = st.k >= 8;
      c.save(); c.lineCap = 'round';
      for (const pass of [0, 1]) {
        c.beginPath();
        for (const off of offs) for (let i = 0; i < E.length; i++) {
          const e = E[i], special = e[2] >= 0; if (special !== (pass === 1)) continue; if (!special && !all) continue;
          const a = N[e[0]], b = N[e[1]], ax = a[0] + off, bx = b[0] + off;
          if ((ax < x0 && bx < x0) || (ax > x1 && bx > x1) || (a[1] < yB && b[1] < yB) || (a[1] > yT && b[1] > yT)) continue;
          c.moveTo(X(ax), Y(a[1])); c.lineTo(X(bx), Y(b[1]));
        }
        if (pass === 0) { c.strokeStyle = 'rgba(120,200,255,.35)'; c.lineWidth = 0.8; c.setLineDash([]); } else { c.strokeStyle = 'rgba(255,214,102,.9)'; c.lineWidth = 1.6; }
        c.stroke();
      }
      c.restore();
    }
    function drawCountries(c) {
      if (!st.countries || !st.showCountries) return; const z = zoomLevel(st.k), boxes = st.boxes;
      c.save(); c.textAlign = 'center'; c.font = '600 12px sans-serif'; c.lineJoin = 'round';
      for (const n of st.countries) {
        if (z + 0.9 < n.min || z > n.max + 1.5) continue; const lon = n.lon + Math.round((st.lon - n.lon) / 360) * 360, x = X(lon), y = Y(n.lat); if (x < -60 || x > st.w + 60 || y < -10 || y > st.h + 10) continue;
        const t = n.name.toUpperCase().split('').join(String.fromCharCode(8202)), w = c.measureText(t).width + 8, bx = [x - w / 2, y - 12, x + w / 2, y + 4];
        if (boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue; boxes.push(bx);
        c.lineWidth = 3; c.strokeStyle = 'rgba(60,56,44,.55)'; c.strokeText(t, x, y); c.fillStyle = 'rgba(255,252,240,.92)'; c.fillText(t, x, y);
      }
      c.restore();
    }
    function drawNames(c) {
      const W = st.detailWater; if (!W || !st.showNames) return; const z = zoomLevel(st.k), boxes = st.boxes;
      c.save(); c.textAlign = 'center'; c.lineJoin = 'round';
      for (const n of W.names) {
        if (z + 0.4 < n.min) continue; const lon = n.lon + Math.round((st.lon - n.lon) / 360) * 360, x = X(lon), y = Y(n.lat); if (x < -40 || x > st.w + 40 || y < -10 || y > st.h + 10) continue;
        const strait = /strait|channel|passage|canal|sound|narrows|pass/i.test(n.cls + ' ' + n.name), small = /bay|gulf|bight|cove|inlet|fjord/i.test(n.cls);
        c.font = (strait ? 'italic 600 ' : small ? 'italic ' : 'italic 500 ') + (strait ? 12 : 11) + 'px sans-serif';
        const w = c.measureText(n.name).width + 6, bx = [x - w / 2, y - 12, x + w / 2, y + 3];
        if (boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) continue; boxes.push(bx);
        c.lineWidth = 3; c.strokeStyle = 'rgba(8,24,38,.85)'; c.strokeText(n.name, x, y); c.fillStyle = strait ? '#9fe0ff' : '#8fb4d0'; c.fillText(n.name, x, y);
      }
      c.restore();
    }
    const tcase = t => String(t || '').toLowerCase().replace(/(^|[\s\-\/(])([a-z\u00c0-\u024f])/g, (m, a, b) => a + b.toUpperCase()).replace(/ (Of|De|Du|Der|La|Le|Les|Y|Da|Do|Dos|Das|Del|Al|El|The|On|Upon|Sur)(?= )/g, (m) => m.toLowerCase());
    /** Port symbols and names (World Port Index) and towns / cities (Natural Earth), the larger ones first, no label over another. */
    function drawPlaces(c) {
      const z = zoomLevel(st.k), x0 = lonAt(0) - 1, x1 = lonAt(st.w) + 1, yT = latAt(0) + 1, yB = latAt(st.h) - 1, boxes = st.boxes, items = [];
      const clear = bx => !boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1]);
      c.save(); c.lineJoin = 'round';
      const put = (name, lon, lat, kind, size) => {
        const x = X(lon + Math.round((st.lon - lon) / 360) * 360), y = Y(lat); if (x < -20 || x > st.w + 20 || y < -10 || y > st.h + 10) return;
        c.font = (kind === 'port' ? '600 ' : kind === 'cap' ? '600 ' : '') + size + 'px sans-serif'; const w = c.measureText(name).width, bx = [x + 6, y - 11, x + 10 + w, y + 4];
        if (!clear(bx)) return; boxes.push([x - 5, y - 6, x + 5, y + 6]); boxes.push(bx);
        if (kind === 'port') { c.fillStyle = '#ff5ea8'; c.strokeStyle = '#000'; c.lineWidth = 1; c.fillRect(x - 3, y - 3, 6, 6); c.strokeRect(x - 3, y - 3, 6, 6); }
        else { c.fillStyle = kind === 'cap' ? '#ffe082' : '#f4f4f4'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, kind === 'cap' ? 3.5 : 2.5, 0, 6.3); c.fill(); c.stroke(); }
        c.textAlign = 'left'; c.lineWidth = 3; c.strokeStyle = 'rgba(8,24,38,.9)'; c.strokeText(name, x + 8, y + 3); c.fillStyle = kind === 'port' ? '#ffb3d6' : kind === 'cap' ? '#ffe082' : '#f4f4f4'; c.fillText(name, x + 8, y + 3);
      };
      if (st.showPorts && opts.ports) {
        const minZ = { L: 3.5, M: 5, S: 7, V: 8.5 };
        for (const p of opts.ports) { if (z < (minZ[p.size] != null ? minZ[p.size] : 8.5)) continue; if (p.lon < x0 - 360 || p.lat < yB || p.lat > yT) continue; items.push([0, -(p.size === 'L' ? 4 : p.size === 'M' ? 3 : p.size === 'S' ? 2 : 1), p.name, p.lon, p.lat, 'port']); }
      }
      if (st.showPlaces && st.detailPlaces) for (const p of st.detailPlaces) { if (z + 0.2 < p.z) continue; if (p.lat < yB || p.lat > yT) continue; items.push([1, p.cap ? -9 : -Math.log10(p.pop + 1), p.name, p.lon, p.lat, p.cap ? 'cap' : 'city']); }
      items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0; for (const it of items) { if (n > 700) break; const before = boxes.length; put(it[5] === 'port' ? tcase(it[2]) : it[2], it[3], it[4], it[5], it[5] === 'port' ? 11 : it[5] === 'cap' ? 12 : 11); if (boxes.length > before) n++; }
      c.restore();
    }
    function draw() {
      st.boxes = []; wantDetail();
      const c = ctx2; c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      const W = st.detailWater, shelfOn = !!(W && st.showDepth && st.k >= 6);
      c.fillStyle = shelfOn ? '#1d4d70' : '#0f2a40'; c.fillRect(0, 0, st.w, st.h); // shelf: lighter water shallower than 200 m, the deep sea darker
      if (shelfOn) { c.fillStyle = '#0f2a40'; for (const r of W.shelf) for (const off of [-360, 0, 360]) { if (r.maxx + off < lonAt(0) || r.minx + off > lonAt(st.w) || r.maxy < latAt(st.h) || r.miny > latAt(0)) continue; ringPath(c, r.pts, off); c.fill(); } }
      drawGrid(c);
      const x0 = lonAt(0), x1 = lonAt(st.w), yTop = latAt(0), yBot = latAt(st.h);
      const offs = [-720, -360, 0, 360, 720].filter(o => true);
      // zones under the land so the coast stays crisp
      if (st.showEca && opts.zones) opts.zones.forEach(z => z.rings.forEach(r => polyFill(c, r, 'rgba(255,196,80,.30)', offs.filter(o => Math.abs(o) <= 360))));
      if (st.showAreas && opts.areas) opts.areas.forEach(a => { const b = a.box; polyFill(c, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], 'rgba(230,60,60,.25)', offs.filter(o => Math.abs(o) <= 360)); });
      c.fillStyle = '#d9d4c2'; c.strokeStyle = '#8c8777'; c.lineWidth = 0.6;
      const D = st.detailLand, tier = D && st.k >= 60 && D.fine.length ? D.fine : D && st.k >= 10 && D.mid.length ? D.mid : land, minPx = tier === land ? 0 : 2.5 / st.k;
      for (const r of tier) {
        if (minPx && r.maxx - r.minx < minPx && r.maxy - r.miny < minPx) { // too small to outline: still show the island as a dot
          for (const off of offs) { if (r.maxx + off < x0 || r.minx + off > x1 || r.maxy < yBot || r.miny > yTop) continue; const dx = X((r.minx + r.maxx) / 2 + off), dy = Y((r.miny + r.maxy) / 2); c.beginPath(); c.arc(dx, dy, 1.6, 0, 6.3); c.fill(); }
          continue;
        }
        for (const off of offs) {
          if (r.maxx + off < x0 || r.minx + off > x1 || r.maxy < yBot || r.miny > yTop) continue;
          ringPath(c, r.pts, off); c.fill(); c.stroke();
        }
      }
      if (W && st.k >= 6) { // lakes and rivers above the land
        c.fillStyle = '#1d4d70'; c.strokeStyle = '#4f8fb8'; c.lineWidth = 0.6;
        for (const r of W.lakes) for (const off of offs) { if (r.maxx + off < x0 || r.minx + off > x1 || r.maxy < yBot || r.miny > yTop) continue; ringPath(c, r.pts, off); c.fill(); c.stroke(); }
        if (st.showRivers) {
          c.lineJoin = 'round'; c.strokeStyle = '#4f9fd0'; const z = zoomLevel(st.k);
          for (const l of W.rivers) {
            if (l.r > z + 2.5) continue; if (l.maxx < x0 || l.minx > x1 || l.maxy < yBot || l.miny > yTop) continue;
            c.lineWidth = Math.max(0.7, Math.min(2.4, 2.8 - l.r * 0.25)); c.beginPath();
            for (let i = 0; i < l.pts.length; i += 2) { const x = X(l.pts[i]), y = Y(l.pts[i + 1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
          }
        }
      }
      if (W && st.showRivers && st.k >= 8) { c.save(); c.strokeStyle = '#d9a7e8'; c.lineWidth = 1.2; c.setLineDash([2, 3]); for (const l of W.reefs || []) { if (l.maxx < x0 || l.minx > x1 || l.maxy < yBot || l.miny > yTop) continue; c.beginPath(); for (let i = 0; i < l.pts.length; i += 2) { const x = X(l.pts[i]), y = Y(l.pts[i + 1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); } c.restore(); }
      if (st.showLanes) drawLanes(c, offs.filter(o => Math.abs(o) <= 360));
      drawCountries(c);
      drawNames(c);
      if (st.k >= 3.5) drawPlaces(c);
      if (st.showNames && st.k >= 5) { c.save(); c.font = '600 11px sans-serif'; c.textAlign = 'center'; for (const id of PASSAGE_NAMES) { const q = PASSAGE_AT[id], x = X(q[0] + Math.round((st.lon - q[0]) / 360) * 360), y = Y(q[1]); if (x < 0 || x > st.w || y < 0 || y > st.h) continue; c.fillStyle = '#ffd666'; c.beginPath(); c.arc(x, y, 3, 0, 6.3); c.fill(); c.lineWidth = 3; c.strokeStyle = 'rgba(8,24,38,.85)'; c.strokeText(q[2], x, y - 7); c.fillText(q[2], x, y - 7); } c.restore(); }
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
    function zoomAt(px, py, f) { const lo = lonAt(px), la = latAt(py); st.k = Math.max(0.5, Math.min(9000, st.k * f)); st.lon = lo - (px - st.w / 2) / st.k; st.y = my(la) + (py - st.h / 2) / st.k; clamp(); draw(); }
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
    const readout = doc.createElement('div'); readout.style.cssText = 'position:absolute;right:6px;bottom:4px;font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e8f2fa;background:rgba(8,24,38,.75);padding:2px 6px;border-radius:3px;pointer-events:none;';
    if (host.ownerDocument.defaultView && host.ownerDocument.defaultView.getComputedStyle(host).position === 'static') host.style.position = 'relative'; host.appendChild(readout);
    const showCursor = (px, py) => { const la = latAt(py), lo = wrapLon(lonAt(px)); readout.textContent = fmtDeg(la, true, 0.01) + '  ' + fmtDeg(lo, false, 0.01) + '   zoom ' + Math.round(st.k / 0.8) / 10 + '×'; };
    canvas.addEventListener('pointermove', e => showCursor(e.offsetX, e.offsetY)); canvas.addEventListener('pointerleave', () => { readout.textContent = ''; });
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
      where: () => ({ lat: myInv(st.y), lon: wrapLon(st.lon), zoom: zoomLevel(st.k), nmPerPx: 60 * Math.cos(myInv(st.y) * rad) / st.k }),
      detailLoaded: () => ({ land: !!st.detailLand, water: !!st.detailWater }),
      destroy() { if (ro) ro.disconnect(); canvas.remove(); readout.remove(); },
    };
  }
  const api = { create, decodeLand, decodeLines, zoomLevel, gridStep, fmtDeg, unwrap, my, myInv, niceNm, PASSAGE_AT, PASSAGE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeaMap = api;
})(typeof self !== 'undefined' ? self : this);
