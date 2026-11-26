'use strict';
// ECA zones for the offline route tools: outlines are APPROXIMATE (planning), so the checks use ports well inside or well outside, and wide ranges.
const assert = require('assert'), fs = require('fs'), path = require('path');
const E = require('../public/sea-distance/eca-zones.js'), SR = require('../public/sea-distance/sea-route.js'), PL = require('../public/sea-distance/port-list.js');
const d = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const pl = PL.create(d('public/sea-distance/ports.json')), router = SR.create(d('public/sea-distance/marnet.json'));
const port = (re, cc) => { const p = pl.all().find(x => re.test(x.name) && x.cc === cc); assert(p, String(re)); return p; };
const at = p => E.zoneAt(p.lon, p.lat);                                    // every area, also those that take effect later
const atNow = p => E.zoneAt(p.lon, p.lat, E.inForce('2026-11-26'));      // the areas in force on 26 Nov 2026

// ports inside and outside the zones
const IN = [[/^ROTTERDAM/, 'NL', 'north_sea'], [/^HAMBURG/, 'DE', 'north_sea'], [/LE HAVRE$/, 'FR', 'north_sea'], [/^SOUTHAMPTON/, 'GB', 'north_sea'], [/^GDANSK/, 'PL', 'baltic'],
  [/^KIEL$/, 'DE', 'baltic'], [/SANKT-PETERBURG/, 'RU', 'baltic'], [/^HELSINKI/, 'FI', 'baltic'], [/^BARCELONA/, 'ES', 'mediterranean'], [/GENOVA/, 'IT', 'mediterranean'],
  [/ISKANDARIYH/, 'EG', 'mediterranean'], [/BUR SAID/, 'EG', 'mediterranean'], [/^HAIFA/, 'IL', 'mediterranean'], [/^NEW YORK CITY/, 'US', 'north_america'],
  [/^HOUSTON/, 'US', 'north_america'], [/^HALIFAX/, 'CA', 'north_america'], [/^LOS ANGELES/, 'US', 'north_america'], [/^SEATTLE/, 'US', 'north_america'],
  [/^HONOLULU/, 'US', 'north_america'], [/^SAN JUAN/, 'PR', 'us_caribbean']];
const OUT = [[/PUERTO DE BILBAO/, 'ES'], [/^LISBOA/, 'PT'], [/^LAS PALMAS/, 'ES'], [/^ODESA/, 'UA'], [/^ISTANBUL/, 'TR'], [/^VERACRUZ/, 'MX'], [/^CAPE TOWN/, 'ZA'],
  [/KEPPEL/, 'SG'], [/FUJAYRAH/, 'AE'], [/^CONSTANTA/, 'RO'], [/^SINES/, 'PT']];
for (const [re, cc, z] of IN) assert.strictEqual(atNow(port(re, cc)), z, 'inside ' + z + ': ' + re);
for (const [re, cc] of OUT) assert.strictEqual(atNow(port(re, cc)), null, 'outside every ECA in force: ' + re);

// measuring a route
const measure = (A, B, opts, ids) => { const x = router.route(A, B, opts); assert(x.ok); const m = E.measure([[A.lat, A.lon]].concat(x.path, [[B.lat, B.lon]]), ids || E.inForce('2026-11-26')); return { x, m }; };
const SIN = port(/KEPPEL/, 'SG'), RTM = port(/^ROTTERDAM/, 'NL'), HAM = port(/^HAMBURG/, 'DE');
const a = measure(SIN, RTM);
assert(Math.abs(a.m.totalNm - a.x.nm) < 15, 'measured length matches the route length: ' + a.m.totalNm + ' vs ' + a.x.nm);
assert(a.m.zones.mediterranean > 1500 && a.m.zones.mediterranean < 2500, 'Singapore-Rotterdam via Suez: Mediterranean part ' + a.m.zones.mediterranean);
assert(a.m.zones.north_sea > 250 && a.m.zones.north_sea < 600, 'and the Channel / North Sea part ' + a.m.zones.north_sea);
assert(a.m.runs.map(r => r.eca).join() === 'false,true,false,true', 'outside, Mediterranean, outside, North Sea');
const c = measure(SIN, RTM, { avoid: ['suez'] });
assert(!c.m.zones.mediterranean && c.m.zones.north_sea > 250, 'round the Cape there is no Mediterranean part');
const h = measure(RTM, HAM); assert(Math.abs(h.m.ecaNm - h.m.totalNm) < 1, 'Rotterdam-Hamburg is all inside the North Sea ECA');
assert(measure(SIN, RTM, null, ['baltic']).m.ecaNm === 0, 'switching a zone off removes it from the measure');
// a leg across the 180th meridian goes the short way round (it used to be sampled through the North Sea)
const pac = E.measure([[34, -118], [35.5, 140]]);
assert(!pac.zones.north_sea && pac.zones.north_america > 100, 'Pacific crossing: only the North American coast counts');
assert(E.label('baltic') === 'Baltic Sea' && E.ZONES.length === 6, 'zone list');
// areas that take effect later
assert(!E.inForce('2026-11-26').includes('north_east_atlantic') && E.inForce('2027-09-01').includes('north_east_atlantic') && E.inForce('2026-11-26', ['north_east_atlantic']).includes('north_east_atlantic'), 'the North-East Atlantic ECA counts from 1 Sep 2027 or when switched on');
const ids26 = E.inForce('2026-11-26'), ids28 = E.inForce('2028-01-01');
const hv = port(/LE HAVRE$/, 'FR'), ny = port(/^NEW YORK CITY/, 'US'), hvx = router.route(hv, ny, {}), hvPts = [[hv.lat, hv.lon]].concat(hvx.path, [[ny.lat, ny.lon]]);
assert(E.measure(hvPts, ids28).ecaNm > E.measure(hvPts, ids26).ecaNm + 200, 'from 2027 the North-East Atlantic adds distance to Le Havre - New York');
const OFFICIAL_IN = [[/^NEW ORLEANS/, 'US', 'north_america'], [/^BALTIMORE/, 'US', 'north_america'], [/^TAMPA/, 'US', 'north_america'], [/^MONTREAL/, 'CA', 'north_america'], [/^SAN FRANCISCO/, 'US', 'north_america'],
  [/^PORTLAND/, 'US', 'north_america'], [/^ANCHORAGE/, 'US', 'north_america'], [/^LISBOA/, 'PT', 'north_east_atlantic'], [/^CORK/, 'IE', 'north_east_atlantic'], [/^DUBLIN/, 'IE', 'north_east_atlantic'], [/REYKJAVIK/, 'IS', 'north_east_atlantic'], [/^SINES/, 'PT', 'north_east_atlantic'], [/^CADIZ/, 'ES', 'north_east_atlantic']];
for (const [re, cc, z] of OFFICIAL_IN) assert.strictEqual(at(port(re, cc)), z, 'inside ' + z + ': ' + re);
for (const [re, cc] of [[/^CHICAGO/, 'US'], [/^FREEPORT/, 'BS'], [/^NASSAU/, 'BS'], [/^HABANA|BAHAI DE LA HABANA/, 'CU'], [/^KINGSTON/, 'JM'], [/^LAS PALMAS/, 'ES']]) assert.strictEqual(at(port(re, cc)), null, 'outside every area (Great Lakes, Bahamas, Cuba, Jamaica, Canaries): ' + re);
console.log('eca OK');
