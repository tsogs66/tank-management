'use strict';
// 20 benchmark routes supplied by the user (fixtures/sea-benchmark.json). The router (with great-circle legs) must land inside the reference
// range, or within the stated tolerance of it. The references are rounded figures, often pilot station to pilot station, so a ship-position
// distance that is a little shorter is expected; this test keeps the accuracy from drifting, it does not prove it.
const assert = require('assert'), fs = require('fs'), path = require('path');
const SR = require('../public/sea-distance/sea-route.js'), PL = require('../public/sea-distance/port-list.js');
const d = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const bench = d('scripts/fixtures/sea-benchmark.json');
const rt = SR.create(d('public/sea-distance/marnet.json'), { land: SR.decodeLand(d('public/sea-distance/land.json')) }), pl = PL.create(d('public/sea-distance/ports.json'));
const pick = (name, cc) => { const l = pl.all().filter(p => p.cc === cc && p.name.includes(name)); assert(l.length, 'port ' + name); l.sort((a, b) => 'LMSV'.indexOf(a.size || 'V') - 'LMSV'.indexOf(b.size || 'V')); return l[0]; };
let sum = 0;
for (const r of bench.routes) {
  const A = pick(r.from.name, r.from.cc), B = pick(r.to.name, r.to.cc), x = rt.route(A, B, {});
  assert(x.ok, 'route ' + r.n);
  const err = x.nm < r.lo ? (x.nm - r.lo) / r.lo * 100 : x.nm > r.hi ? (x.nm - r.hi) / r.hi * 100 : 0;
  assert(Math.abs(err) <= r.tolPct, `route ${r.n} ${A.name} -> ${B.name}: ${x.nm} nm against ${r.lo}-${r.hi} (${err.toFixed(1)}%)`);
  assert(x.nm >= x.directNm - 0.5, 'never shorter than the straight line');
  sum += Math.abs(err);
}
assert(sum / bench.routes.length < 2.5, 'mean error ' + (sum / bench.routes.length).toFixed(2) + ' %');
console.log('sea-benchmark OK (' + bench.routes.length + ' routes, mean error ' + (sum / bench.routes.length).toFixed(2) + ' %)');
