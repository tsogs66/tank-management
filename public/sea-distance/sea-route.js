// Offline sea-distance router over data/sea-lanes/marnet.json (Node + browser: window.SeaRoute).
// APPROXIMATE: each port is joined to its nearest lane nodes by a straight line, then Dijkstra (binary heap) over the lane graph.
(function (root) {
  'use strict';
  const R_NM = 3440.065, rad = Math.PI / 180;
  const gc = (lat1, lon1, lat2, lon2) => { const h = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2; return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h))); };
  const r1 = x => Math.round(x * 10) / 10;
  const ALWAYS_AVOID = ['northwest', 'northeast'], SMALL_CANALS = ['kiel', 'corinth']; // the Kiel and Corinth canals are too small for deep-sea ships: avoided unless {allowSmallCanals:true} // Arctic Northwest Passage and Northern Sea Route are excluded unless {allowNorthwest:true}
  /** Passages a route can be told to avoid (the network's own tags), in the order they are offered. `common` ones are shown first. */
  const PASSAGES = [
    { id: 'suez', label: 'Suez Canal', common: true }, { id: 'panama', label: 'Panama Canal', common: true },
    { id: 'babalmandab', label: 'Bab-el-Mandeb', common: true }, { id: 'malacca', label: 'Malacca Strait', common: true },
    { id: 'ormuz', label: 'Strait of Hormuz', common: true }, { id: 'south_africa', label: 'Cape of Good Hope', common: true },
    { id: 'sunda', label: 'Sunda Strait' }, { id: 'gibraltar', label: 'Strait of Gibraltar' }, { id: 'bosporus', label: 'Bosporus' },
    { id: 'dardanelles', label: 'Dardanelles' }, { id: 'chili', label: 'Chile / Magellan passage' }, { id: 'bering', label: 'Bering Strait' },
    { id: 'dover', label: 'Dover Strait' },
  ];
  /** Areas a route can be told to keep out of (approximate boxes [minLon, minLat, maxLon, maxLat]; the user decides which apply: they are not official designations).
   *  A port inside an area is still reachable: lane nodes within EXEMPT_NM of the From / To point are not blocked. */
  const AREAS = [
    { id: 'gulf_aden', label: 'Gulf of Aden', box: [43, 10.5, 53, 15.5] },
    { id: 'red_sea', label: 'Red Sea', box: [32, 12.5, 43.6, 28] },
    { id: 'somali_basin', label: 'Somali Basin / West Arabian Sea', box: [44, -6, 62, 12] },
    { id: 'gulf_of_guinea', label: 'Gulf of Guinea', box: [-10, -6, 12, 6] },
    { id: 'black_sea', label: 'Black Sea', box: [27.5, 40.9, 41.8, 47] },
    { id: 'taiwan_strait', label: 'Taiwan Strait', box: [117, 22.5, 121, 26] },
  ];
  const EXEMPT_NM = 200;
  /** Open-water regions of the passages a route can be told to avoid. A great-circle shortcut may not cut through the region of an avoided passage. */
  const PASSAGE_BOX = {
    suez: [32.0, 29.5, 32.9, 31.5], panama: [-80.2, 8.85, -79.3, 9.45], babalmandab: [42.9, 12.3, 43.6, 13.0], malacca: [99.0, 1.0, 104.0, 6.0],
    ormuz: [55.9, 26.0, 57.0, 27.2], south_africa: [12.0, -70.0, 30.0, -33.0], sunda: [105.4, -6.7, 106.3, -5.7], gibraltar: [-5.95, 35.7, -5.2, 36.2],
    bosporus: [28.9, 40.95, 29.25, 41.35], dardanelles: [26.0, 39.9, 26.6, 40.5], chili: [-76.0, -58.0, -64.0, -50.0], bering: [-171.0, 64.5, -167.0, 66.5],
    kiel: [9.0, 53.8, 10.2, 54.4], corinth: [22.9, 37.85, 23.1, 38.0], dover: [1.0, 50.8, 1.8, 51.2],
  };
  /** Does the straight segment (x1,y1)-(x2,y2) touch the box [minx, miny, maxx, maxy]? (Liang-Barsky) */
  function segHitsBox(x1, y1, x2, y2, b) {
    if (x2 - x1 > 180) x2 -= 360; else if (x2 - x1 < -180) x2 += 360; // a leg over the 180th meridian goes the short way round
    return hitsBox(x1, y1, x2, y2, b) || hitsBox(x1, y1, x2, y2, [b[0] - 360, b[1], b[2] - 360, b[3]]) || hitsBox(x1, y1, x2, y2, [b[0] + 360, b[1], b[2] + 360, b[3]]);
  }
  function hitsBox(x1, y1, x2, y2, b) {
    let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1;
    for (const [p, q] of [[-dx, x1 - b[0]], [dx, b[2] - x1], [-dy, y1 - b[1]], [dy, b[3] - y1]]) {
      if (p === 0) { if (q < 0) return false; } else { const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
    }
    return true;
  }
  const SHORTCUT_STEP_NM = 4, LAND_MARGIN_DEG = 0.05, ENDPOINT_FREE_NM = 12, DENSIFY_NM = 50, CELL = 0.2;

  /** Land rings from data/map/land.json (integers in 1/q degree, delta-encoded) -> { pts, minx, miny, maxx, maxy } per ring. */
  function decodeLand(json) {
    const q = json.q || 100, out = [];
    for (const flat of json.rings) {
      const n = flat.length / 2, pts = new Float64Array(flat.length);
      let x = 0, y = 0, minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (let i = 0; i < n; i++) {
        x += flat[2 * i]; y += flat[2 * i + 1];
        const lo = x / q, la = y / q; pts[2 * i] = lo; pts[2 * i + 1] = la;
        if (lo < minx) minx = lo; if (lo > maxx) maxx = lo; if (la < miny) miny = la; if (la > maxy) maxy = la;
      }
      out.push({ pts, minx, miny, maxx, maxy });
    }
    return out;
  }
  /** Land test with a coarse grid in front of it: open-sea cells answer at once, only cells with a coast need the exact polygon test. */
  function landTester(rings) {
    const NX = Math.round(360 / CELL), NY = Math.round(180 / CELL), coast = new Uint8Array(NX * NY), memo = new Uint8Array(NX * NY); // memo: 0 unknown, 1 sea, 2 land
    const cx = lo => Math.min(NX - 1, Math.max(0, Math.floor((lo + 180) / CELL))), cy = la => Math.min(NY - 1, Math.max(0, Math.floor((la + 90) / CELL)));
    for (const r of rings) {
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (CELL / 2)));
        for (let k = 0; k <= n; k++) { const ix = cx(p[i] + dx * k / n), iy = cy(p[i + 1] + dy * k / n); coast[iy * NX + ix] = 1; }
      }
    }
    const pip = (lo, la) => {
      for (const r of rings) {
        if (lo < r.minx || lo > r.maxx || la < r.miny || la > r.maxy) continue;
        const pts = r.pts; let c = false;
        for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) if ((pts[i + 1] > la) !== (pts[j + 1] > la) && lo < (pts[j] - pts[i]) * (la - pts[i + 1]) / (pts[j + 1] - pts[i + 1]) + pts[i]) c = !c;
        if (c) return true;
      }
      return false;
    };
    const wrap = lo => (lo > 180 ? lo - 360 : lo < -180 ? lo + 360 : lo);
    function isLand(lo, la) { // exact, with no margin
      lo = wrap(lo); const k = cy(la) * NX + cx(lo);
      if (coast[k]) return pip(lo, la);
      if (!memo[k]) memo[k] = pip(lo, la) ? 2 : 1;
      return memo[k] === 2;
    }
    /** Land or within about 3 nm of land (the coast is generalised, so keep clear of it). */
    function nearLand(lo, la) {
      lo = wrap(lo); const k = cy(la) * NX + cx(lo);
      if (!coast[k]) { // an open cell can still sit next to a coast cell: check the neighbours only when the point is near the cell edge
        const fx = (lo + 180) / CELL - Math.floor((lo + 180) / CELL), fy = (la + 90) / CELL - Math.floor((la + 90) / CELL);
        if (fx > 0.2 && fx < 0.8 && fy > 0.2 && fy < 0.8) return isLand(lo, la);
      }
      return isLand(lo, la) || isLand(lo + LAND_MARGIN_DEG, la) || isLand(lo - LAND_MARGIN_DEG, la) || isLand(lo, la + LAND_MARGIN_DEG) || isLand(lo, la - LAND_MARGIN_DEG);
    }
    return { isLand, nearLand };
  }
  /** Points along the great circle from a to b ([lat, lon]), every stepNm at most, including a, excluding b when `openEnd`. */
  function gcPoints(a, b, stepNm, openEnd) {
    const la1 = a[0] * rad, lo1 = a[1] * rad, la2 = b[0] * rad, lo2 = b[1] * rad;
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)));
    const nm = d * R_NM, n = Math.max(1, Math.ceil(nm / stepNm)), out = [];
    if (d < 1e-9) return [a.slice()];
    for (let k = 0; k <= n; k++) {
      if (openEnd && k === n) break;
      const f = k / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
      out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / rad, Math.atan2(y, x) / rad]);
    }
    return out;
  }

  /** Douglas-Peucker on [lat, lon] points (distance in degrees, longitude scaled by the latitude). */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    const rel = (p, a) => { let dl = p[1] - a[1]; dl = ((dl + 540) % 360) - 180; return [(p[0] - a[0]), dl * Math.cos(a[0] * rad)]; };
    while (stack.length) {
      const [i, j] = stack.pop(); const a = pts[i], b = rel(pts[j], a); const L = Math.hypot(b[0], b[1]);
      let worst = -1, wd = 0;
      for (let k = i + 1; k < j; k++) {
        const p = rel(pts[k], a); const d = L < 1e-9 ? Math.hypot(p[0], p[1]) : Math.abs(p[0] * b[1] - p[1] * b[0]) / L;
        if (d > wd) { wd = d; worst = k; }
      }
      if (worst >= 0 && wd > tol) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
    }
    return pts.filter((_, k) => keep[k]);
  }

  class Heap { // min-heap of [key, value]
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  }

  function create(net, copts) {
    if (net.format !== 'marnet-v1') throw new Error('unsupported network format');
    const lt = copts && copts.land && copts.land.length ? landTester(copts.land) : null;
    const N = net.nodes.length, lon = new Float64Array(N), lat = new Float64Array(N);
    net.nodes.forEach((p, i) => { lon[i] = p[0]; lat[i] = p[1]; });
    const adj = Array.from({ length: N }, () => []);
    for (const [a, b, t] of net.edges) { const nm = gc(lat[a], lon[a], lat[b], lon[b]); adj[a].push([b, nm, t]); adj[b].push([a, nm, t]); }

    function nearest(pt, k) {
      const best = []; // sorted ascending [d, i]
      for (let i = 0; i < N; i++) {
        const d = gc(pt.lat, pt.lon, lat[i], lon[i]);
        if (best.length < k || d < best[best.length - 1][0]) { best.push([d, i]); best.sort((x, y) => x[0] - y[0]); if (best.length > k) best.pop(); }
      }
      return best;
    }
    const ecaCache = new Map();
    /** 1 for every lane node inside the area `test` describes; computed once per area set. */
    function ecaNodes(key, test) {
      let a = ecaCache.get(key);
      if (!a) { a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = test(lon[i], lat[i]) ? 1 : 0; if (ecaCache.size > 4) ecaCache.clear(); ecaCache.set(key, a); }
      return a;
    }
    /** route(from, to, {avoid:[passage names e.g. 'suez','panama'], allowNorthwest:false, maxAttachNm:300, k:3}) with from/to = {lat, lon}. */
    function route(from, to, opts) {
      opts = opts || {};
      const avoidNames = new Set((opts.avoid || []).concat(opts.allowNorthwest ? [] : ALWAYS_AVOID, opts.allowSmallCanals ? [] : SMALL_CANALS).map(s => String(s).toLowerCase()));
      const avoidT = new Set(); net.tags.forEach((t, i) => { if (avoidNames.has(t.toLowerCase())) avoidT.add(i); });
      // passages the network does not tag (Hormuz, Cape of Good Hope, Sunda, Bosporus, Dardanelles): no lane may cross their region
      const tagged = new Set(net.tags.map(t => t.toLowerCase()));
      const edgeBoxes = [...avoidNames].filter(n => PASSAGE_BOX[n] && !tagged.has(n)).map(n => PASSAGE_BOX[n]);
      const maxA = opts.maxAttachNm || 300, k = opts.k || 3, warnings = [];
      const areaIds = new Set((opts.areas || []).map(s => String(s).toLowerCase()));
      const boxes = AREAS.filter(a => areaIds.has(a.id)).map(a => a.box);
      const A = nearest(from, k), B = nearest(to, k);
      if (A[0][0] > maxA) return { ok: false, error: `from point is ${Math.round(A[0][0])} nm from the nearest lane node (limit ${maxA})` };
      if (B[0][0] > maxA) return { ok: false, error: `to point is ${Math.round(B[0][0])} nm from the nearest lane node (limit ${maxA})` };
      const goal = new Map(B.filter(x => x[0] <= maxA).map(x => [x[1], x[0]]));
      const blocked = new Uint8Array(N);
      if (boxes.length) {
        for (let i = 0; i < N; i++) {
          if (!boxes.some(b => lon[i] >= b[0] && lon[i] <= b[2] && lat[i] >= b[1] && lat[i] <= b[3])) continue;
          if (gc(from.lat, from.lon, lat[i], lon[i]) <= EXEMPT_NM || gc(to.lat, to.lon, lat[i], lon[i]) <= EXEMPT_NM) continue;
          blocked[i] = 1;
        }
      }
      /* Keep out of an area (ECA): with opts.eca = { test(lon, lat) -> bool, key, weight }, a mile of lane inside it costs (1 + weight) miles, so the
         route stays outside as long as that is cheap; the distance reported is always the real one. */
      const ecaOpt = opts.eca && Number(opts.eca.weight) > 0 && typeof opts.eca.test === 'function' ? opts.eca : null;
      const inE = ecaOpt ? ecaNodes(ecaOpt.key || 'eca', ecaOpt.test) : null, kw = ecaOpt ? Number(ecaOpt.weight) : 0;
      const prevNm = ecaOpt ? new Float64Array(N) : null;
      const exN = new Uint8Array(N); // lane nodes near the From / To port stay usable even inside an avoided region (a port can lie in it)
      if (edgeBoxes.length) for (let i = 0; i < N; i++) if (gc(from.lat, from.lon, lat[i], lon[i]) <= EXEMPT_NM || gc(to.lat, to.lon, lat[i], lon[i]) <= EXEMPT_NM) exN[i] = 1;
      const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), prevT = new Int16Array(N).fill(-1), heap = new Heap();
      for (const [d, i] of A) if (d <= maxA) { dist[i] = d; heap.push(d, i); }
      let bestTotal = Infinity, bestNode = -1;
      while (heap.size) {
        const [du, u] = heap.pop();
        if (du > dist[u]) continue;
        if (du >= bestTotal) break;
        if (goal.has(u) && du + goal.get(u) < bestTotal) { bestTotal = du + goal.get(u); bestNode = u; }
        for (const [v, nm, t] of adj[u]) {
          if (t >= 0 && avoidT.has(t)) continue;
          if (blocked[v]) continue;
          if (edgeBoxes.length && !exN[u] && !exN[v] && edgeBoxes.some(b => segHitsBox(lon[u], lat[u], lon[v], lat[v], b))) continue;
          const nd = du + (inE ? nm * (1 + kw * (inE[u] + inE[v]) * 0.5) : nm); if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevT[v] = t; if (prevNm) prevNm[v] = nm; heap.push(nd, v); }
        }
      }
      if (bestNode < 0) return { ok: false, error: 'no route with the given restrictions' };
      const nodesPath = []; const used = new Set(); let c = bestNode;
      while (c >= 0) { nodesPath.push(c); if (prevT[c] >= 0) used.add(net.tags[prevT[c]]); c = prev[c]; }
      nodesPath.reverse();
      const aNm = dist[nodesPath[0]], bNm = goal.get(bestNode);
      if (prevNm) { let lane = 0; for (let q = bestNode; prev[q] >= 0; q = prev[q]) lane += prevNm[q]; bestTotal = aNm + lane + bNm; } // the real length of the weighted route
      const inside = pt => AREAS.filter(ar => areaIds.has(ar.id) && pt.lon >= ar.box[0] && pt.lon <= ar.box[2] && pt.lat >= ar.box[1] && pt.lat <= ar.box[3]).map(ar => ar.label);
      [['from', from], ['to', to]].forEach(([w, pt]) => { const l = inside(pt); if (l.length) warnings.push(`${w} is inside an avoided area (${l.join(', ')}): the route may be unrealistic`); });
      if (aNm > 100) warnings.push(`from is ${Math.round(aNm)} nm from the nearest lane node: low confidence`);
      if (bNm > 100) warnings.push(`to is ${Math.round(bNm)} nm from the nearest lane node: low confidence`);
      const passages = [...used].filter(t => t !== 'segment' && t !== 'segment2');
      let pathPts = nodesPath.map(i => [lat[i], lon[i]]), total = bestTotal, shortcuts = 0, turning = null;
      if (lt && opts.greatCircle !== false) {
        // Great-circle shortcuts: join the route's own points by the shortest line wherever the sea is open.
        const P = [[from.lat, from.lon]].concat(pathPts, [[to.lat, to.lon]]);
        const seg = [-1].concat(nodesPath.map((nd, k) => (k === 0 ? -1 : prevT[nd])), [-1]); // seg[k] = tag of the edge arriving at P[k] (attach legs and untagged lanes are -1)
        const passTag = k => seg[k] >= 0 && net.tags[seg[k]] !== 'segment' && net.tags[seg[k]] !== 'segment2' && net.tags[seg[k]] !== 'dover'; // the Dover Strait is wide: its lane may be replaced by a straight line over open sea
        const tagAhead = new Int32Array(P.length + 1); for (let k = P.length - 1; k >= 0; k--) tagAhead[k] = tagAhead[k + 1] + (passTag(k) ? 1 : 0);
        const blockedBoxes = [...avoidNames].filter(n => PASSAGE_BOX[n]).map(n => PASSAGE_BOX[n]).concat(boxes);
        const inBox = (lo, la) => blockedBoxes.some(b => lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]);
        const free = (pt, p) => gc(pt.lat, pt.lon, p[0], p[1]) <= ENDPOINT_FREE_NM;
        const exempt = p => gc(from.lat, from.lon, p[0], p[1]) <= EXEMPT_NM || gc(to.lat, to.lon, p[0], p[1]) <= EXEMPT_NM;
        const ecaOf = (p, q) => { let n = 0; for (const x of gcPoints(p, q, SHORTCUT_STEP_NM, false)) if (ecaOpt.test(x[1], x[0])) n++; return n * SHORTCUT_STEP_NM; };
        let ecaCum = null;
        if (ecaOpt) { ecaCum = [0]; for (let q = 1; q < P.length; q++) ecaCum.push(ecaCum[q - 1] + ecaOf(P[q - 1], P[q])); }
        const clear = (a, b) => {
          if (tagAhead[a + 1] - tagAhead[b + 1] > 0) return false; // never replace a canal or strait the network marks
          if (ecaCum && ecaOf(P[a], P[b]) > ecaCum[b] - ecaCum[a] + 2) return false; // a straight line must not spend more miles in the ECA than the lanes it replaces
          for (const p of gcPoints(P[a], P[b], SHORTCUT_STEP_NM, false)) {
            if (inBox(p[1], p[0]) && !exempt(p)) return false;
            if (free(from, p) || free(to, p)) continue;
            if (lt.nearLand(p[1], p[0])) return false;
          }
          return true;
        };
        const out = [P[0]]; let i = 0;
        while (i < P.length - 1) {
          const r = P.length - 1 - i, tries = [...new Set([P.length - 1, i + Math.ceil(r * 0.8), i + Math.ceil(r * 0.6), i + Math.ceil(r * 0.4), i + Math.ceil(r * 0.25), i + Math.ceil(r * 0.15), i + 8, i + 5, i + 3, i + 2])]
            .filter(j => j > i + 1 && j < P.length).sort((x, y) => y - x);
          let next = i + 1;
          for (const j of tries) { if (clear(i, j)) { next = j; shortcuts++; break; } }
          out.push(P[next]); i = next;
        }
        let len = 0; for (let k = 1; k < out.length; k++) len += gc(out[k - 1][0], out[k - 1][1], out[k][0], out[k][1]);
        // keep it only if it is really shorter than the lane route (it always should be)
        if (len < bestTotal - 0.05) {
          total = len; turning = out.slice(1, -1);
          const dense = [];
          for (let k = 1; k < out.length; k++) gcPoints(out[k - 1], out[k], DENSIFY_NM, true).forEach(q => dense.push(q));
          dense.push(out[out.length - 1]);
          pathPts = dense.slice(1, -1);
        }
      }
      // passages the network does not tag (Hormuz, Cape of Good Hope, Sunda, Bosporus, Dardanelles): reported when the route crosses their region
      const finalPts = [[from.lat, from.lon]].concat(pathPts, [[to.lat, to.lon]]);
      for (const n of Object.keys(PASSAGE_BOX)) {
        if (tagged.has(n) || passages.includes(n)) continue;
        const b = PASSAGE_BOX[n];
        for (let k = 1; k < finalPts.length; k++) if (segHitsBox(finalPts[k - 1][1], finalPts[k - 1][0], finalPts[k][1], finalPts[k][0], b)) { passages.push(n); break; }
      }
      return {
        ok: true, nm: r1(total), laneNm: r1(bestTotal - aNm - bNm), networkNm: r1(bestTotal), savedNm: r1(bestTotal - total), shortcuts,
        directNm: r1(gc(from.lat, from.lon, to.lat, to.lon)),
        attach: { from: r1(aNm), to: r1(bNm) },
        passages,
        /* the points where the route turns, to edit: great-circle legs between them reproduce `path` */
        waypoints: (turning || simplify([[from.lat, from.lon]].concat(pathPts, [[to.lat, to.lon]]), 0.25).slice(1, -1)).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]),
        path: pathPts, warnings,
      };
    }
    /** Does the great-circle leg a -> b ([lat, lon]) cross land, or pass close to it? Needs the coastline; ends within a few miles of a port are not judged. */
    function segmentCheck(a, b) {
      if (!lt) return { land: false, near: false };
      let land = false, near = false;
      const pts = gcPoints(a, b, 3, false);
      pts.forEach((p, k) => {
        if (gc(a[0], a[1], p[0], p[1]) <= ENDPOINT_FREE_NM || gc(b[0], b[1], p[0], p[1]) <= ENDPOINT_FREE_NM) return;
        if (lt.isLand(p[1], p[0])) land = true; else if (lt.nearLand(p[1], p[0])) near = true;
      });
      return { land, near: near || land };
    }
    /** Is a point on land / close to land? ([lat, lon]) */
    function pointCheck(p) {
      if (!lt) return { land: false, near: false };
      const land = lt.isLand(p[1], p[0]);
      return { land, near: land || lt.nearLand(p[1], p[0]) };
    }
    /** The nearest sea to a point on land: searched outwards in rings of 0.05 degrees up to 4 degrees, preferring water that is not close to the coast. Returns [lat, lon] (the same point when it is already at sea). */
    function snapToSea(p) {
      if (!lt || !lt.isLand(p[1], p[0])) return [p[0], p[1]];
      let fallback = null;
      for (let r = 0.05; r <= 4; r += 0.05) {
        const steps = Math.max(12, Math.round(r * 160));
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * 2 * Math.PI;
          const la = Math.max(-85, Math.min(85, p[0] + r * Math.sin(a))); let lo = p[1] + r * Math.cos(a) / Math.max(0.2, Math.cos(la * Math.PI / 180));
          if (lo > 180) lo -= 360; else if (lo < -180) lo += 360;
          if (lt.isLand(lo, la)) continue;
          if (!lt.nearLand(lo, la)) return [Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4];
          if (!fallback) fallback = [Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4];
        }
        if (fallback && r > 0.6) return fallback;
      }
      return fallback || [p[0], p[1]];
    }
    return { route, segmentCheck, pointCheck, snapToSea, nearest: (pt, kk) => nearest(pt, kk || 1).map(x => ({ nm: r1(x[0]), lat: lat[x[1]], lon: lon[x[1]] })), nodeCount: N };
  }
  const api = { create, decodeLand, gcPoints, PASSAGES, AREAS, gc: (a, b) => gc(a.lat, a.lon, b.lat, b.lon) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeaRoute = api;
})(typeof self !== 'undefined' ? self : this);
