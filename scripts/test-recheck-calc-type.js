/**
 * Repairing a tank's table type must not cost it its tables.
 *
 * upsertTank fills anything absent from its argument with empty defaults, so
 * writing back only the field that changed takes the trim grid, the heel grid
 * and the capacity curve with it. That is exactly what the repair button did
 * the first time it was run against a real ship's data.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-recheck-'));
process.env.CHENG_PRO_DATA_DIR = dir;
const store = require('../server/store.js');
const calc = require('../server/calc.js');

const vessel = store.createVessel({ name: 'Test Ship' });
const tank = store.upsertTank(vessel.id, {
  name: 'NO.1 F.O.T. PORT', category: 'fuel', calcType: 'direct',
  capacity: 740.33, correctionDivisor: 10, soundingMethod: 'ullage',
  trimAxis: [0, 20, 40, 60, 80, 100], trimVals: [-2, -1, 0, 1, 2, 3],
  trimGrid: [[-3, -2, 0, 2, 5, 9], [-10, -5, 0, 7, 14, 22], [-15, -8, 0, 7, 14, 22],
             [-15, -7, 0, 7, 15, 22], [-15, -7, 0, 8, 15, 23], [-15, -8, 0, 7, 15, 22]],
  listAxis: [0, 20, 40, 60, 80, 100], listVals: [-3, -1, 0, 1, 3],
  listGrid: [[91, 6, 0, 5, 101], [30, 1, 0, 5, 45], [-12, -5, 0, 2, 11],
             [-28, -8, 0, 5, 8], [-37, -10, 0, 8, 14], [-45, -12, 0, 10, 21]],
  volumeCurve: { x: [0, 20, 40, 60, 80, 100], v: [0, 20, 60, 130, 240, 380] },
});

const readBack = () => {
  const b = store.getVesselBundle(vessel.id);
  return Object.values(b.tanks).filter(Array.isArray).reduce((a, c) => a.concat(c), [])
    .find((t) => t.id === tank.id);
};

let pass = 0;
const verdict = calc.detectCalcType(readBack());
assert.strictEqual(verdict.calcType, 'trimHeel', 'the stored tables say trim-heel');
assert.strictEqual(verdict.confident, true, 'and say it plainly');
pass += 2;

/* The trap, written down so it stays written down. */
store.upsertTank(vessel.id, { id: tank.id, category: 'fuel', calcType: 'trimHeel' });
assert.strictEqual((readBack().trimGrid || []).length, 0,
  'writing back one field alone empties the grids — this is why the repair sends the whole tank');
pass += 1;

/* And the way the repair actually writes. */
store.upsertTank(vessel.id, { ...tank, calcType: 'trimHeel' });
const after = readBack();
assert.strictEqual(after.calcType, 'trimHeel', 'the type is repaired');
assert.strictEqual((after.trimGrid || []).length, 6, 'the trim grid is still there');
assert.strictEqual((after.listGrid || []).length, 6, 'so is the heel grid');
assert.strictEqual((after.volumeCurve.x || []).length, 6, 'so is the capacity curve');
assert.strictEqual(after.capacity, 740.33, 'and the capacity');
pass += 5;

fs.rmSync(dir, { recursive: true, force: true });
console.log(`calibration repair: ${pass} checks passed`);
