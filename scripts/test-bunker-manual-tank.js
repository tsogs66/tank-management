/**
 * Bunkering plan with a tank worked by manual (double) interpolation.
 * Such a tank has no table in the program to turn a volume into a level: the current reading is the observed
 * volume in m³, and the ullages are the chief's own figures. A volume must never be shown as an ullage.
 * Volumes, quantities to go and times are worked from the m³ as for any other tank.
 */
'use strict';
const assert = require('assert');
const Core = require('../public/js/bunkering-core.js');
let pass = 0; let failed = 0;
function check(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } }

const manual = { id: 'm1', name: 'HFO MANUAL', fuelGrade: 'hfo', side: 'port', fuelRole: 'storage', tankNo: 1, capacity: 500, capacityM3: 500,
  calibration: {}, calcType: 'doubleInterpManual', soundingMethod: 'doubleInterpManual' };
const bundle = { vessel: { name: 'T' }, voyage: {}, readings: {}, tanks: { fuel: [manual] },
  fuelReport: { header: {}, rows: { m1: { reading: 120, fuelType: 'hfo' } } } };
const plan = (slot) => Core.normalizePlan(bundle, { header: { fuelType: 'hfo', deliveryRateMTPerHour: 200, bunkerQuantityMT: 100, density15: 0.98, tempC: 40 },
  sequence: [{ tankId: 'm1', status: 'filling', targetVolumeM3: 300, currentSoundingMM: 180, ...slot }] }, null);
const row = (slot) => Core.computeBunkerPlan(bundle, plan(slot), null).rows[0];

check('the tank is flagged as manual', () => { assert.strictEqual(row({}).manualGauge, true); });
check('a volume is never shown as a starting or target ullage', () => {
  const r = row({});
  assert.strictEqual(r.startingUllageMM, null, 'starting ullage not invented from the 120 m³ ROB');
  assert.strictEqual(r.targetUllageMM, null, 'target ullage not invented from the 300 m³ target');
  assert.strictEqual(r.targetReadingMM, null);
});
check('the typed ullages are used as entered', () => {
  const r = row({ startingUllageMM: 1850, targetUllageMM: 920 });
  assert.strictEqual(r.startingUllageMM, 1850);
  assert.strictEqual(r.targetUllageMM, 920);
});
check('no "outside the calibration table" warning for a tank that has none', () => {
  assert.ok(!row({}).warnings.some((w) => /calibration table/.test(w)));
});
check('the observed m³ is the current volume, and the rest is worked from it', () => {
  const r = row({});
  assert.strictEqual(r.currentVolumeM3, 180);
  assert.strictEqual(r.startingRobM3, 120);
  assert.ok(r.quantityAddMT > 0, 'quantity added in MT from the volume received');
  assert.ok(r.remainingToTargetMT > 0, 'quantity still to go');
  assert.ok(Math.abs(r.remainingToTargetM3 - 120) < 1e-6, '300 − 180 m³ to go');
  assert.notStrictEqual(r.etaLabel, '—', 'estimated time still given');
});
check('the typed ullage does not change any figure worked from the volume', () => {
  const a = row({}), b = row({ startingUllageMM: 1850, targetUllageMM: 920 });
  for (const k of ['currentVolumeM3', 'quantityAddMT', 'remainingToTargetMT', 'etaLabel', 'planAddMT', 'targetVolumePercent']) {
    assert.deepStrictEqual(b[k], a[k], k);
  }
});
check('the projected level of a manual tank is a volume only, not a level', () => {
  const r = row({});
  assert.strictEqual(r.estimatedUllageMM, null);
  assert.strictEqual(r.estimatedSoundingMM, null);
  if (r.estimatedVolumeM3 != null) assert.ok(r.estimatedVolumeM3 >= 180, 'volume projected forward from the reading');
});
check('typed ullages survive the plan being saved and reloaded', () => {
  const p = plan({ startingUllageMM: 1850, targetUllageMM: 920 });
  const again = Core.normalizePlan(bundle, JSON.parse(JSON.stringify(p)), null);
  assert.strictEqual(again.sequence[0].startingUllageMM, 1850);
  assert.strictEqual(again.sequence[0].targetUllageMM, 920);
});
check('only manual-interpolation and direct-gauge tanks are treated this way', () => {
  const calc = require('../server/calc.js');
  assert.strictEqual(calc.usesDirectM3Input({ calcType: 'doubleInterpManual' }), true);
  assert.strictEqual(calc.usesDirectM3Input({ calcType: 'gaugeDirect' }), true);
  assert.strictEqual(calc.usesDirectM3Input({ calcType: 'direct', soundingMethod: 'sounding' }), false);
  assert.strictEqual(calc.usesDirectM3Input({ calcType: 'trimHeel', soundingMethod: 'ullage' }), false);
});

console.log(failed ? `\nFAILED — ${failed} of ${pass + failed}` : `\nPASSED — ${pass} checks`);
process.exit(failed ? 1 : 0);
