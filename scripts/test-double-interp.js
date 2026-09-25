/**
 * Double interpolation against a real calibration book.
 *
 * FLAG EVI, NO.1 H.F.O. TK (P), ullage 1080 mm with 0.41 m of trim by the
 * stem. The figures below are the printed page, so the expected answers are
 * the ones an engineer gets by hand:
 *
 *   ullage 1050 -> +1.0 m 384.971   even keel 376.008
 *   ullage 1100 -> +1.0 m 376.074   even keel 367.215
 *   down the ullage column first: 379.6328 and 370.7322
 *   then across the trim: 370.7322 + (379.6328 - 370.7322) * 0.41 = 374.3814
 *
 * Two things have to hold for that figure to come out of the app.
 *
 * The heeling table must leave an upright ship alone. It prints no zero
 * column, and reading straight from -1 to +1 across the gap used to fake a
 * 1.174 correction, which the volume-correction path subtracted whole:
 * 375.556 against the book's 374.381.
 *
 * And the trim has to reach the tank's columns in the tank's own sign. This
 * book heads its positive columns TRIM BY STEM, but the importer flips them
 * to run by the stern, as the Giorgis books do. The engineer enters 0.41
 * either way, so both arrangements are tested from the same entry.
 */
'use strict';
const assert = require('assert');
const calc = require('../server/calc.js');
const FRCore = require('../public/js/fuel-report-core.js');

const ULLAGE = [950, 1000, 1050, 1100, 1150, 1200];
const STEM_VALS = [1, 0, -0.5, -1, -1.5, -2, -3, -4];          // as the sheet prints it
const STEM_GRID = [
  [402.997, 393.906, 389.377, 384.885, 380.430, 376.012, 367.291, 358.719],
  [393.960, 384.905, 380.428, 375.988, 371.585, 367.220, 358.604, 350.137],
  [384.971, 376.008, 371.583, 367.195, 362.845, 358.532, 350.020, 341.658],
  [376.074, 367.215, 362.842, 358.507, 354.209, 349.948, 341.541, 333.283],
  [367.280, 358.525, 354.204, 349.921, 345.676, 341.468, 333.165, 325.012],
  [358.591, 349.940, 345.672, 341.441, 337.248, 333.092, 324.893, 316.845],
];
const LIST_VALS = [-4, -3, -2, -1, 1, 2, 3, 4];                 // no upright column
const LIST_GRID = [
  [205.890, 157.517, 107.187, 54.744, -55.893, -111.816, -168.138, -228.319],
  [203.241, 155.490, 105.812, 54.043, -55.892, -111.815, -167.809, -224.345],
  [200.587, 153.464, 104.431, 53.339, -55.668, -111.816, -167.810, -223.907],
  [197.957, 151.436, 103.053, 52.633, -54.994, -111.622, -167.811, -223.908],
  [195.335, 149.418, 101.678, 51.933, -54.263, -110.912, -167.644, -223.905],
  [192.711, 147.411, 100.299, 51.230, -53.539, -109.613, -167.009, -223.771],
];

/* The same table as the FLAG EVI importer stores it: headers negated, then
   sorted ascending with the grid columns carried along. */
const negated = STEM_VALS.map((v) => -v);
const order = negated.map((_, i) => i).sort((a, b) => negated[a] - negated[b]);
const STERN_VALS = order.map((i) => negated[i]);
const STERN_GRID = STEM_GRID.map((row) => order.map((i) => row[i]));

const tankOf = (calcType, axis) => ({
  name: 'NO.1 H.F.O. TK (P)', calcType, correctionDivisor: 1,
  capacity: 463.476, soundingMethod: 'ullage', soundingUnit: 'mm', correctionUnit: 'mm',
  trimAxis: ULLAGE, listAxis: ULLAGE, listVals: LIST_VALS, listGrid: LIST_GRID,
  ...(axis === 'stem'
    ? { trimAxisSense: 'stem', trimVals: STEM_VALS, trimGrid: STEM_GRID }
    : { trimVals: STERN_VALS, trimGrid: STERN_GRID,
        ...(axis === 'stern' ? { trimAxisSense: 'stern' } : {}) }),
});
const read = (calcType, list, axis) => calc.computeTank(tankOf(calcType, axis),
  { reading: 1080, trim: 0.41, list, tempC: 15, entryMethod: 'ullage', readingUnit: 'mm' });

let pass = 0;
const near = (got, want, tol, what) => {
  assert.ok(Math.abs(got - want) <= tol,
    `${what}: got ${got.toFixed(4)}, expected ${want.toFixed(4)}`);
  pass++;
};

near(calc.bilinearInterpInc(ULLAGE, STEM_VALS, STEM_GRID, 1080, 0.41, 50),
     374.3814, 0.0005, 'the printed columns, read at 0.41 by the stem');

/* 0.41 by the bow reaches the same pair of columns whichever way round the
   tank's own axis was stored. */
for (const axis of ['stem', 'stern', undefined]) {
  const how = axis || 'no sense recorded';
  near(read('correction', 0, axis).volumeObserved, 374.3814, 0.0005, `volume upright, ${how}`);
  near(read('direct', 0, axis).volumeObserved, 374.3814, 0.0005, `volume upright, direct, ${how}`);
}
assert.strictEqual(calc.trimAxisSign({}), -1, 'a tank with no sense reads its columns by the stern');
assert.strictEqual(calc.trimAxisSign({ trimAxisSense: 'bow' }), 1, 'a bow-positive axis is taken as read');
pass += 2;

/* Upright, the heeling table must not touch the figure. */
near(read('correction', 0, 'stem').listCorrection, 0, 1e-9, 'heel correction at no list');

/* A tabulated angle still reads straight off its own column, and the ullage
   it corrects to gives the hand figure. */
const heeled = read('correction', 1, 'stem');
near(heeled.listCorrection, -55.2636, 0.0005, 'heel correction at 1 deg to starboard');
near(heeled.correctedReading, 1024.7364, 0.0005, 'ullage after the heel correction');
near(heeled.volumeObserved, 384.1973, 0.0005, 'volume at 1 deg to starboard');

/* Half a degree now interpolates 0 -> 1 deg, not -1 -> +1 deg. */
near(read('correction', 0.5, 'stem').listCorrection, -27.6318, 0.0005, 'heel correction at half a degree');

/* The upright column goes in once, and only where it is missing. */
const already = calc.insertUprightColumn([-2, -1, 0, 1, 2], [[1, 2, 3, 4, 5]]);
assert.deepStrictEqual(already.vals, [-2, -1, 0, 1, 2], 'an existing zero column is left alone');
const oneSided = calc.insertUprightColumn([1, 2, 3], [[1, 2, 3]]);
assert.deepStrictEqual(oneSided.vals, [1, 2, 3], 'an axis that never crosses zero is left alone');
const put = calc.insertUprightColumn([-4, -1, 1, 4], [[10, 20, 30, 40]]);
assert.deepStrictEqual(put.vals, [-4, -1, 0, 1, 4], 'zero goes in where the sign turns');
assert.deepStrictEqual(put.grid[0], [10, 20, 0, 30, 40], 'and the row gains a zero to match');
pass += 4;

/* Trim carries one sign for the engineer: fwd - aft, the way the monitoring
   page shows it. M/V FLAG EVI on 14/09: 8.08 forward, 7.67 aft. */
const draftFwd = 8.08, draftAft = 7.67;
near(draftFwd - draftAft, 0.41, 1e-9, 'trim from the drafts');
assert.strictEqual(FRCore.trimSense(draftFwd - draftAft), 'by bow', 'down by the head reads as by bow');
assert.strictEqual(FRCore.trimSense(draftAft - draftFwd), 'by stern', 'the other sign reads as by stern');
assert.strictEqual(FRCore.trimSense(0), 'even keel', 'no trim reads as even keel');
assert.strictEqual(FRCore.trimSense(0.004), 'even keel', 'a hair of trim still reads as even keel');
assert.strictEqual(FRCore.trimLabel(-1.2), '1.20 m by stern', 'the label spells the sense out');
pass += 5;

console.log(`double interpolation: ${pass} checks passed`);
