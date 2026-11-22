/**
 * Two fuels delivered by one supplier, one barge and one transaction (VLSFO with LSMGO on one BDN): the second fuel
 * has its own hose connect, pump start, pump stop and disconnect, with its own pumping time and rate.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bunker-times-'));
process.env.CHENG_PRO_DATA_DIR = dir;
const store = require('../server/store.js');
const Core = require('../public/js/bunkering-core.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

const vessel = store.createVessel({ name: 'Times Ship' });
const bundle = store.getVesselBundle(vessel.id);
const ev = (date, time) => ({ date, time });

const base = {
  bunkeringId: 'bk_t', bdnNumber: 'B-1', port: 'Singapore', bargeName: 'Barge 1', supplier: 'Supplier 1',
  events: { alongside: ev('2026-11-20', '06:00'), connect: ev('2026-11-20', '07:00'), pumpStart: ev('2026-11-20', '07:30'),
    pumpStop: ev('2026-11-20', '10:30'), disconnect: ev('2026-11-20', '11:00'), castOff: ev('2026-11-20', '12:00') },
  bdn: { fuelType: 'lsfo', quantityMT: 500, sulphurPercent: 0.49, density15: 0.98, lcv: 40.5 },
};

/* one fuel: no second set at all */
const one = Core.computeBunkerSummary(bundle, base, null, null);
ok(one.events2 === null, 'with one fuel there is no second set of times');
ok(one.timing.second === null, 'and no second timing');
ok(one.timing.pumpingHours === 3, 'the first fuel pumps for 3 h as before');
ok(Core.SUMMARY_LINE_EVENTS.map((e) => e.id).join() === 'connect,pumpStart,pumpStop,disconnect', 'the second set is the hose and pump events only');

/* two fuels on one delivery */
const two = Core.computeBunkerSummary(bundle, {
  ...base,
  bdn2: { fuelType: 'lsmgo', quantityMT: 100, sulphurPercent: 0.09, density15: 0.86, lcv: 42.7, number: 'B-1' },
  events2: { connect: ev('2026-11-20', '10:45'), pumpStart: ev('2026-11-20', '11:00'), pumpStop: ev('2026-11-20', '12:15'), disconnect: ev('2026-11-20', '12:30') },
}, null, null);
ok(two.events2 && two.events2.pumpStart.time === '11:00', 'the second fuel keeps its own pump start');
ok(two.events2.disconnect.time === '12:30' && two.events2.connect.time === '10:45', 'and its own connect and disconnect');
ok(two.events.pumpStart.time === '07:30', 'the first fuel times are untouched');
ok(two.timing.second && two.timing.second.pumpingHours === 1.25, 'the second fuel pumped for 1.25 h');
ok(two.timing.second.hoseHours === 1.75, 'with the hose connected for 1.75 h');
ok(two.timing.second.fuelLabel === two.bdn2.label && /LSMGO|MGO/i.test(two.timing.second.fuelLabel), 'labelled with its grade');
ok(two.timing.pumpingHours === 3, 'the first fuel is still 3 h');
ok(two.lineEventLabels.length === 4, 'the labels for the second set are supplied');
ok(two.bdn.lcv === 40500 && two.bdn2.lcv === 42700, 'LCV in MJ/kg is read as kJ/kg on both notes');

/* second fuel entered the wrong way round is said out loud, not hidden */
const bad = Core.computeBunkerSummary(bundle, {
  ...base,
  bdn2: { fuelType: 'lsmgo', quantityMT: 100, number: 'B-1' },
  events2: { connect: ev('2026-11-20', '12:30'), pumpStart: ev('2026-11-20', '12:15'), pumpStop: ev('2026-11-20', '11:00'), disconnect: ev('2026-11-20', '10:45') },
}, null, null);
ok(bad.timing.second.pumpingHours === null && bad.timing.second.hoseHours === null, 'negative gaps are dropped, not reported as durations');
ok(bad.timing.second.warnings.length === 2, 'and each is warned about');

/* a saved summary from before has no second set: it still loads */
const old = Core.normalizeSummary(bundle, { ...base, bdn2: { fuelType: 'lsmgo', quantityMT: 50, number: 'B-1' } });
ok(old.events2 && old.events2.connect.date === '' && old.events2.pumpStop.time === '', 'an older summary gets an empty second set');

/* removing the second fuel drops the second set from the report */
const removed = Core.computeBunkerSummary(bundle, { ...base, bdn2: null, events2: two.events2 }, null, null);
ok(removed.events2 === null && removed.timing.second === null, 'without a second fuel its times are not reported');

console.log(`bunker second-fuel times: ${pass} checks passed`);
