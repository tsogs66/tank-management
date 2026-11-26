'use strict';
// Sanity test for the sea-lane network. Reference distances are ROUGH commonly quoted figures (nautical miles)
// from memory, NOT an authoritative table; tolerance is deliberately wide (10%).
const assert = require('assert'), fs = require('fs'), path = require('path');
const SR = require('../public/sea-distance/sea-route.js'), PL = require('../public/sea-distance/port-list.js');
const d = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const net = d('public/sea-distance/marnet.json'), sr = SR.create(net), pl = PL.create(d('public/sea-distance/ports.json'));
const port = id => { const p = pl.byId(id); assert(p, 'port ' + id); return p; };
const P = { RTM: port(31140), SIN: port(50000), NYC: port(7640), HK: port(57840), CPT: port(46770), FUJ: port(48262),
  BOM: port(48840), YOK: port(61390), COL: port(9865), HOU: port(9240), SHA: port(59970) };
const named = (q, cc) => { const p = pl.search(q, { country: cc })[0]; assert(p, q); return p; };

// graph integrity
assert(net.format === 'marnet-v1' && net.nodes.length > 9000 && net.edges.length > 15000, 'network size');
assert(net.edges.every(e => e[0] >= 0 && e[1] < net.nodes.length && e[2] < net.tags.length), 'edge indices');

const near = (r, ref, tol, label) => { assert(r.ok, label + ': ' + r.error); const err = Math.abs(r.nm - ref) / ref; assert(err <= (tol || 0.10), `${label}: ${r.nm} nm vs ~${ref} (${(err * 100).toFixed(1)}%)`); return r; };
const suez = near(sr.route(P.RTM, P.SIN), 8300, 0.10, 'Rotterdam-Singapore via Suez');
const cape = near(sr.route(P.RTM, P.SIN, { avoid: ['suez'] }), 11700, 0.10, 'Rotterdam-Singapore via Cape');
assert(suez.passages.includes('suez') && !cape.passages.includes('suez'), 'avoid suez changes route');
assert(cape.passages.includes('south_africa'), 'Cape route passes south_africa');
near(sr.route(P.RTM, P.NYC), 3450, 0.10, 'Rotterdam-New York');
near(sr.route(P.SIN, P.HK), 1440, 0.10, 'Singapore-Hong Kong');
near(sr.route(P.RTM, P.CPT), 6000, 0.10, 'Rotterdam-Cape Town');
near(sr.route(P.RTM, P.FUJ), 6300, 0.10, 'Rotterdam-Fujairah');
near(sr.route(P.SIN, P.YOK), 2900, 0.10, 'Singapore-Yokohama');
near(sr.route(P.RTM, P.COL), 4800, 0.10, 'Rotterdam-Colon');
// regions added in phase 2 (wider tolerance, figures are rough)
near(sr.route(P.RTM, named('gdansk', 'PL')), 850, 0.15, 'Rotterdam-Gdansk (Baltic)');
near(sr.route(P.RTM, named('istanbul', 'TR')), 3100, 0.15, 'Rotterdam-Istanbul (Bosphorus)');
near(sr.route(P.HOU, P.RTM), 5000, 0.12, 'Houston-Rotterdam (Gulf of Mexico)');
near(sr.route(named('los angeles', 'US'), P.YOK), 4800, 0.12, 'Los Angeles-Yokohama (Pacific)');
near(sr.route(named('sydney', 'AU'), P.SIN), 4000, 0.12, 'Sydney-Singapore (Australia)');
near(sr.route(named('santos', 'BR'), P.RTM), 5400, 0.12, 'Santos-Rotterdam (South America)');
// symmetry; Northwest Passage excluded by default
const ab = sr.route(P.FUJ, P.BOM), ba = sr.route(P.BOM, P.FUJ);
assert(ab.ok && Math.abs(ab.nm - ba.nm) < 0.5, 'symmetric');
assert(!sr.route(P.RTM, P.YOK).passages.includes('northwest'), 'northwest avoided by default');
// coverage: over 93 % of the listed ports have a lane node within 100 nm (the rest are river and lake ports and a few remote coasts, flagged as low confidence)
let ok100 = 0; for (const p of pl.all()) if (sr.nearest(p)[0].nm <= 100) ok100++;
assert(ok100 / pl.all().length > 0.93, 'coverage within 100 nm: ' + ok100);
// a point far inland is refused, not guessed
assert(!sr.route({ lat: 50.0, lon: 70.0 }, P.RTM).ok, 'inland point refused');
// areas to keep out of: a blocked area changes the route, a port inside it is still reachable, and the user is warned
assert(SR.PASSAGES.length >= 10 && SR.PASSAGES[0].id === 'suez' && SR.AREAS.some(a => a.id === 'gulf_aden'), 'passages and areas are listed');
const open_ = sr.route(P.SIN, P.RTM), noAden = sr.route(P.SIN, P.RTM, { areas: ['gulf_aden'] });
assert(open_.passages.includes('suez') && noAden.ok && !noAden.passages.includes('suez') && noAden.nm > open_.nm + 2000, 'keeping out of the Gulf of Aden sends the ship round the Cape');
const toDjibouti = sr.route(P.FUJ, { lat: 11.6, lon: 43.1 }, { areas: ['gulf_aden'] });
assert(toDjibouti.ok && toDjibouti.warnings.some(w => /inside an avoided area/.test(w)), 'a port inside an avoided area is reachable, with a warning');
// great-circle legs: the route is shortened wherever the sea is open, never through land, a canal or an avoided passage
const land = SR.decodeLand(d('public/sea-distance/land.json')), srg = SR.create(net, { land });
const pipRing = (pts, lo, la) => { let c = false; for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) if ((pts[i + 1] > la) !== (pts[j + 1] > la) && lo < (pts[j] - pts[i]) * (la - pts[i + 1]) / (pts[j + 1] - pts[i + 1]) + pts[i]) c = !c; return c; };
const onLand = (lo, la) => land.some(r => lo >= r.minx && lo <= r.maxx && la >= r.miny && la <= r.maxy && pipRing(r.pts, lo, la));
const sample = (A, B, r) => [[A.lat, A.lon]].concat(r.path, [[B.lat, B.lon]]);
const nearEnd = (p, A, B) => SR.gc({ lat: p[0], lon: p[1] }, A) < 15 || SR.gc({ lat: p[0], lon: p[1] }, B) < 15;
for (const [A, B, o] of [[P.FUJ, P.BOM, {}], [P.CPT, named('santos', 'BR'), {}], [P.HOU, P.RTM, {}], [P.SIN, P.RTM, { avoid: ['suez'] }], [P.RTM, P.NYC, {}]]) {
  const raw = sr.route(A, B, o), gcr = srg.route(A, B, o);
  assert(gcr.ok && gcr.nm <= raw.nm + 0.1 && gcr.nm >= gcr.directNm - 0.5, 'great-circle route is shorter than the lanes and never shorter than the straight line');
  assert(Math.abs(gcr.networkNm - raw.nm) < 0.2 && gcr.savedNm >= 0, 'the lane figure is still reported');
  for (const p of SR.gcPoints([A.lat, A.lon], [B.lat, B.lon], 1000, false)) assert(p.length === 2);
  const pts = sample(A, B, gcr); let worst = 0;
  for (let k = 1; k < pts.length; k++) for (const q of SR.gcPoints(pts[k - 1], pts[k], 6, false)) { if (nearEnd(q, A, B)) continue; if (onLand(q[1], q[0])) worst++; }
  assert(worst === 0, 'no point of the great-circle route is on land (' + worst + ')');
}
const open2 = srg.route(P.FUJ, P.BOM); assert(Math.abs(open2.nm - open2.directNm) < 1, 'open water: the route is the great circle itself');
const noSuezG = srg.route(P.SIN, P.RTM, { avoid: ['suez'] });
assert(noSuezG.ok && !noSuezG.passages.includes('suez') && noSuezG.nm > 11000, 'avoiding Suez still goes round the Cape with great-circle legs');
assert(!noSuezG.path.some(p => p[1] >= 32 && p[1] <= 32.9 && p[0] >= 29.5 && p[0] <= 31.5), 'and never through the canal');
const viaSuezG = srg.route(P.SIN, P.RTM); assert(viaSuezG.passages.includes('suez') && viaSuezG.nm < sr.route(P.SIN, P.RTM).nm, 'via Suez the canal stays, the rest is shortened');
assert(srg.route(P.SIN, P.RTM, { greatCircle: false }).nm === sr.route(P.SIN, P.RTM).nm, 'greatCircle:false gives the lane route');
const t0 = Date.now(); srg.route(P.HOU, P.SIN); assert(Date.now() - t0 < 1500, 'a long route is calculated in well under a second or two');
console.log('sea-route OK (coverage<=100nm: ' + ok100 + '/' + pl.all().length + ')');
