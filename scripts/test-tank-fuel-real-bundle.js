/**
 * The tank fuel register against the app's own calculation, not hand-made rows.
 *
 * A first version of the register read each tank's weight from a field that only the grade totals have
 * (`actualMT`); tank rows call it `weightAirMT`. Hand-made test rows had the wrong name too, so everything
 * passed and nothing was ever recorded on a ship. This test builds a real vessel, sounds a real tank before and
 * after a delivery through computeFuelReport, and follows the figures all the way to the blended tank.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-fuel-real-'));
process.env.CHENG_PRO_DATA_DIR = dir;
const store = require('../server/store.js');
const Core = require('../public/js/bunkering-core.js');
const FRCore = require('../public/js/fuel-report-core.js');
const R = require('../public/js/tank-fuel-register.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

const vessel = store.createVessel({ name: 'Real Ship' });
const tank = store.upsertTank(vessel.id, {
  name: 'NO.1 H.F.O. TK (P)', category: 'fuel', calcType: 'trimHeel', fuelGrade: 'hfo', pipeHeight: 100,
  capacity: 740.33, correctionDivisor: 10, soundingMethod: 'ullage',
  trimAxis: [0, 20, 40, 60, 80, 100], trimVals: [-2, -1, 0, 1, 2, 3],
  trimGrid: [[-3, -2, 0, 2, 5, 9], [-10, -5, 0, 7, 14, 22], [-15, -8, 0, 7, 14, 22],
    [-15, -7, 0, 7, 15, 22], [-15, -7, 0, 8, 15, 23], [-15, -8, 0, 7, 15, 22]],
  listAxis: [0, 20, 40, 60, 80, 100], listVals: [-3, -1, 0, 1, 3],
  listGrid: [[91, 6, 0, 5, 101], [30, 1, 0, 5, 45], [-12, -5, 0, 2, 11], [-28, -8, 0, 5, 8], [-37, -10, 0, 8, 14], [-45, -12, 0, 10, 21]],
  volumeCurve: { x: [0, 20, 40, 60, 80, 100], v: [0, 20, 60, 130, 240, 380] },
});
const bundle = store.getVesselBundle(vessel.id);
const t = (bundle.tanks.fuel || []).find((x) => x.id === tank.id);
ok(t, 'the vessel and its tank exist');

const form = (reading) => {
  const f = FRCore.emptyFuelReport(bundle);
  f.rows[t.id] = { ...(f.rows[t.id] || {}), fuelType: 'hfo', reading, method: 'ullage', tempC: 40, unit: 'den15', unitValue: 0.98, inUse: false, section: '' };
  return f;
};

/* before: monitoring; after: the same tank sounded fuller (a smaller ullage) */
bundle.fuelReport = form(70);
const rowOf = (rep) => rep.sections.flatMap((s) => s.rows).find((r) => r.tankId === t.id);
const before = rowOf(FRCore.computeFuelReport(bundle, bundle.fuelReport, null));
ok(before && before.weightAirMT != null && before.weightAirMT > 0, 'a tank row carries its weight as weightAirMT (and has no actualMT)');
ok(before.actualMT === undefined, 'the row has no actualMT — only the grade totals do');

const afterForm = form(25);
bundle.bunkerAfter = afterForm;
const after = Core.computeAfterBunkering(bundle, afterForm, null);
const afterRow = rowOf(after);
ok(afterRow.weightAirMT > before.weightAirMT, 'sounded fuller after the delivery');
ok(after.priorTank && after.priorTank[t.id] && Math.abs(after.priorTank[t.id].mt - before.weightAirMT) < 1e-6, 'the before weight of the tank is kept with the after report');

const loads = Core.tankLoadsFromAfter(after);
ok(loads.length === 1 && loads[0].tankId === t.id, 'the tank that took fuel is listed');
ok(loads[0].beforeMt === Math.round(before.weightAirMT * 1000) / 1000, 'with its real before weight');
ok(loads[0].afterMt === Math.round(afterRow.weightAirMT * 1000) / 1000, 'and its real after weight');
ok(loads[0].grade === 'hfo', 'and its grade');

/* the preview the After page shows, from a summary with a delivery note */
const summary = { bunkeringId: 'bk_real', bdnNumber: 'T-001', bdn: { fuelType: 'hfo', quantityMT: 100, sulphurPercent: 0.49, density15: 0.98, lcv: 40500 } };
const prev = R.previewBunkering(bundle, loads, summary);
ok(prev.tanks.length === 1 && prev.tanks[0].gained, 'the preview sees the tank gain');
ok(prev.tanks[0].result.lcv == null, 'the tank held fuel with no figures on record, so its blend stays unknown rather than invented');
ok(prev.tanks[0].lots.length === 1 && prev.tanks[0].lots[0].numbers[0] === 'T-001', 'but the delivery is listed against it');

/* net specific energy typed in MJ/kg (a test report gives it that way) is kept as kJ/kg */
const mj = Core.computeBunkerSummary(bundle, { bunkeringId: 'bk_mj', bdnNumber: 'MJ-1', bdn: { fuelType: 'hfo', quantityMT: 100, sulphurPercent: 0.49, density15: 0.98, lcv: 40.5 } }, null, null);
ok(mj.bdn && mj.bdn.lcv === 40500, 'an LCV typed as 40.5 (MJ/kg) is kept as 40 500 kJ/kg');
const kj = Core.computeBunkerSummary(bundle, { bunkeringId: 'bk_kj', bdnNumber: 'KJ-1', bdn: { fuelType: 'hfo', quantityMT: 100, sulphurPercent: 0.49, density15: 0.98, lcv: 40500 } }, null, null);
ok(kj.bdn && kj.bdn.lcv === 40500, 'an LCV typed in kJ/kg is left alone');

/* with an earlier bunkering on record for the tank, the blend is worked out */
const earlier = { bunkeringId: 'bk_old', loadsTs: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', bdnNumber: 'T-000',
  bdn: { fuelType: 'hfo', quantityMT: 40, sulphurPercent: 2.5, density15: 0.98, lcv: 40000 },
  tankLoads: [{ tankId: t.id, grade: 'hfo', beforeMt: 0, afterMt: Math.round(before.weightAirMT * 1000) / 1000 }] };
const prev2 = R.previewBunkering({ ...bundle, bunkerSummary: earlier }, loads, summary);
const bm = before.weightAirMT, ld = afterRow.weightAirMT - bm;
ok(Math.abs(prev2.tanks[0].result.lcv - (bm * 40000 + ld * 40500) / (bm + ld)) < 1, 'with the earlier BDN known, the LCV is the mass-weighted blend');
ok(Math.abs(prev2.tanks[0].result.sulphur - (bm * 2.5 + ld * 0.49) / (bm + ld)) < 1e-3, 'and so is the sulphur');
ok(prev2.tanks[0].lots.length === 2, 'both BDN lots are listed');

/* saved as a bunkering and read back the way the bridge does */
const saved = { ...summary, loadsTs: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T11:00:00Z', tankLoads: loads };
const b2 = { ...bundle, bunkerSummary: saved, bunkerHistory: { summaries: [{ form: saved }] } };
const reg = R.build(R.eventsFromBundle(b2));
ok(Object.keys(reg.tanks).length === 1, 'the register has the tank');
ok(reg.tanks[t.id].bdns.length === 1 && reg.tanks[t.id].bdns[0].numbers[0] === 'T-001', 'with the BDN of the delivery');

/* the monitoring figures the bridge hands to Voyage Chief come from the same field */
const rob = {};
for (const section of FRCore.computeFuelReport(bundle, bundle.fuelReport, null).sections) {
  for (const row of section.rows) if (row.weightAirMT != null) rob[row.tankId] = row.weightAirMT;
}
ok(rob[t.id] > 0, 'the monitoring ROB per tank is read from weightAirMT');

/* no source file may read a tank's weight from the grade-only field again */
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
for (const f of ['bunkering-core.js', 'app.js']) {
  ok(!/row\.actualMT/.test(src(f)), `${f} does not read row.actualMT`);
}

console.log(`tank fuel register on real data: ${pass} checks passed`);
