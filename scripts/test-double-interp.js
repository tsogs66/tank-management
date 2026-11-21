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

/* Excel DOUBLE INTERPOLATION quadrant (four corners + axis mid targets). */
{
  const sounding = [4071, 4041, 4021];
  const trimAx = [0, 0.41, 1];
  const corners = [
    [384.905, null, 393.96],
    [null, null, null],
    [376.008, null, 384.971],
  ];
  const g = calc.buildExcelQuadrantGrid(sounding, trimAx, corners);
  assert.ok(g, 'quadrant grid builds');
  near(g[1][0], 379.567, 0.002, 'left column mid sounding (C4)');
  near(g[1][2], 388.567, 0.02, 'right column mid sounding (E4)');
  near(g[1][1], 383.257, 0.02, 'trim centre before heel add (D4 base)');

  const heelAx = [0, -0.4, -1];
  const heelCorners = [
    [0, null, 54.043],
    [null, null, null],
    [0, null, 53.339],
  ];
  const heelG = calc.buildExcelQuadrantGrid(sounding, heelAx, heelCorners);
  near(heelG[1][1], 21.448, 0.02, 'heel centre (D11)');
  const trimWithHeel = calc.buildExcelQuadrantGrid(sounding, trimAx, corners, heelG[1][1]);
  near(trimWithHeel[1][1], 404.705, 0.02, 'trim centre with heel (D4)');

  const vol = calc.manualDoubleInterpolation({
    sounding: 4041,
    trim: 0.41,
    heel: -0.4,
    soundingAxis: sounding,
    trimAxis: trimAx,
    heelAxis: heelAx,
    trimGrid: corners,
    heelGrid: heelCorners,
  });
  near(vol, 404.705, 0.02, 'manual double interp at sheet targets (volume heel)');

  assert.deepStrictEqual(calc.excelAxisBracket(0.41), [0, 0.41, 1], 'trim bracket positive');
  assert.deepStrictEqual(calc.excelAxisBracket(-0.4), [0, -0.4, -1], 'heel bracket negative');
  pass += 2;

  const volSound = calc.manualDoubleInterpolation({
    sounding: 4041,
    trim: 0.41,
    heel: -0.4,
    heelMode: 'sounding',
    soundingAxis: sounding,
    trimAxis: trimAx,
    heelAxis: heelAx,
    trimGrid: corners,
    heelGrid: heelCorners,
  });
  assert.ok(volSound && typeof volSound === 'object', 'sounding heel returns detail object');
  near(volSound.heelCorrection, 21.448, 0.02, 'sounding mode heel cm');
  near(volSound.correctedSounding, 4041 + 21.448, 0.02, 'sounding after heel');
  assert.ok(Number.isFinite(volSound.volumeM3), 'sounding mode volume');
  pass += 3;
}

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

/* Direct volume path must add the signed heel table value, not subtract it. */
const directHeeled = read('direct', 1, 'stem');
near(directHeeled.volumeObserved, directHeeled.trimVolume + directHeeled.heelVolume,
  1e-6, 'direct: observed = trim volume + signed heel correction');

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


/* The book's other arrangement, every figure typed by hand: trim and heel are length corrections, then the
   volume is interpolated between two capacity-table rows. Worked by hand below. */
{
  const sounding = [130, 125, 120];          /* cm: high, target, low */
  const trimAx = [0, 0.5, 1], heelAx = [0, 0.5, 1];
  /* mm corrections at the two bracketing soundings, upright column then the end column */
  const trimCorners = [[0, null, 8], [null, null, null], [0, null, 6]];
  const heelCorners = [[0, null, 4], [null, null, null], [0, null, 2]];
  const capacity = [{ sounding: 125, volume: 10.000 }, { sounding: 126, volume: 10.080 }];
  const base = { sounding: 125, trim: 0.5, heel: 0.5, soundingAxis: sounding, trimAxis: trimAx, heelAxis: heelAx,
    trimGrid: trimCorners, heelGrid: heelCorners, capacity, soundingUnit: 'cm', correctionUnit: 'mm' };

  const a = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm' });
  near(a.trimCorrection, 3.5, 1e-9, 'trim correction at the sounding: (4 + 3) / 2 mm');
  near(a.heelCorrection, 1.5, 1e-9, 'heel correction at the sounding: (2 + 1) / 2 mm');
  near(a.correctedSounding, 125.5, 1e-9, 'corrected sounding = 125 cm + 5 mm');
  near(a.volumeM3, 10.040, 1e-9, 'volume interpolated between the two capacity rows');
  assert.strictEqual(a.outsideCapacity, false, 'the corrected sounding is inside the rows');

  const b = calc.manualDoubleInterpolation({ ...base, arrangement: 'heelThenTrimCm' });
  const s1 = 125 + 1.5 / 10;
  const trimAtS1 = 3 + (s1 - 120) / 10 * 1;      /* 3 mm at 120 cm rising 1 mm per 10 cm */
  near(b.heelCorrection, 1.5, 1e-9, 'heel first');
  near(b.trimCorrection, trimAtS1, 1e-9, 'trim read at the heel-corrected sounding');
  near(b.correctedSounding, s1 + trimAtS1 / 10, 1e-9, 'then trim on top');
  near(b.volumeM3, 10 + 0.08 * (s1 + trimAtS1 / 10 - 125), 6e-4, 'volume from the capacity rows (the program rounds m³ to 0.001)');
  assert.ok(b.correctedSounding > a.correctedSounding, 'reading the trim at the heel-corrected length gives a slightly larger correction');

  const cm = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', correctionUnit: 'cm' });
  near(cm.correctedSounding, 125 + 5, 1e-9, 'the same numbers read as cm move the sounding ten times as far');
  const mmSnd = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', soundingUnit: 'mm', sounding: 1250,
    soundingAxis: [1300, 1250, 1200], capacity: [{ sounding: 1250, volume: 10 }, { sounding: 1260, volume: 10.08 }] });
  near(mmSnd.correctedSounding, 1255, 1e-9, 'a sounding in mm with corrections in mm adds them one for one');

  const noRows = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', capacity: [{ sounding: 125, volume: 10 }, {}] });
  assert.strictEqual(noRows.volumeM3, null, 'no volume until both capacity rows are typed');
  near(noRows.correctedSounding, 125.5, 1e-9, 'but the corrected sounding is still shown');
  const out = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', capacity: [{ sounding: 120, volume: 9 }, { sounding: 121, volume: 9.08 }] });
  assert.strictEqual(out.outsideCapacity, true, 'rows that do not bracket the corrected sounding are flagged');
  const blank = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', trimGrid: [[null, null, null], [null, null, null], [null, null, null]], heelGrid: [[null, null, null], [null, null, null], [null, null, null]] });
  near(blank.correctedSounding, 125, 1e-9, 'blank correction cells are no correction (as in the volume arrangement)');
  near(blank.volumeM3, 10.0, 1e-9, 'so the volume is the capacity-table figure at the sounding as read');
  /* The two existing arrangements are untouched. */
  const old = calc.manualDoubleInterpolation({ ...base, arrangement: 'volume', trimGrid: [[400, null, 410], [null, null, null], [390, null, 400]], heelGrid: [[0, null, 1], [null, null, null], [0, null, 1]] });
  assert.ok(Number.isFinite(old), 'volume arrangement still returns a number');
  pass += 18;
}


/* Capacity table with corrections, each in the unit the book gives it. Worked by hand. */
{
  const sounding = [130, 125, 120];
  const axisT = [0, 0.5, 1], axisH = [0, 0.5, 1];
  const blank = [[null, null, null], [null, null, null], [null, null, null]];
  const corners = (hi1, lo1) => [[0, null, hi1], [null, null, null], [0, null, lo1]];
  const cap = [{ sounding: 125, volume: 10.000 }, { sounding: 126, volume: 10.080 }];
  const base = { sounding: 125, trim: 0.5, heel: 0.5, soundingAxis: sounding, trimAxis: axisT, heelAxis: axisH,
    capacity: cap, soundingUnit: 'cm', correctionUnit: 'mm', arrangement: 'capacityCorr' };

  /* trim 0.8 / 0.6 m³ and heel 0.4 / 0.2 m³ at the bracketing soundings: 0.35 and 0.15 at the target */
  const vv = calc.manualDoubleInterpolation({ ...base, trimKind: 'volume', heelKind: 'volume', trimGrid: corners(0.8, 0.6), heelGrid: corners(0.4, 0.2) });
  near(vv.trimCorrection, 0.35, 1e-9, 'trim m³ correction at the sounding');
  near(vv.heelCorrection, 0.15, 1e-9, 'heel m³ correction at the sounding');
  near(vv.baseVolumeM3, 10.000, 1e-9, 'capacity-table volume at the sounding as read');
  near(vv.volumeM3, 10.5, 1e-9, 'volume = capacity volume + trim m³ + heel m³');
  near(vv.correctedSounding, 125, 1e-9, 'volume corrections leave the sounding alone');

  const mixed = calc.manualDoubleInterpolation({ ...base, trimKind: 'length', heelKind: 'volume', trimGrid: corners(8, 6), heelGrid: corners(0.4, 0.2) });
  near(mixed.correctedSounding, 125.35, 1e-9, 'a length trim correction (3.5 mm) moves the sounding');
  near(mixed.baseVolumeM3, 10 + 0.08 * 0.35, 1e-9, 'capacity volume at the corrected sounding');
  near(mixed.volumeM3, 10.028 + 0.15, 1e-9, 'then the heel m³ is added');

  const lenTogether = calc.manualDoubleInterpolation({ ...base, trimKind: 'length', heelKind: 'length', lengthOrder: 'together', trimGrid: corners(8, 6), heelGrid: corners(4, 2) });
  const old = calc.manualDoubleInterpolation({ ...base, arrangement: 'trimHeelCm', trimGrid: corners(8, 6), heelGrid: corners(4, 2) });
  near(lenTogether.volumeM3, old.volumeM3, 1e-12, 'both lengths together is the same as the trim-and-heel method');

  const trimFirst = calc.manualDoubleInterpolation({ ...base, trimKind: 'length', heelKind: 'length', lengthOrder: 'trimFirst', trimGrid: corners(8, 6), heelGrid: corners(4, 2) });
  const s1 = 125 + 3.5 / 10;
  const heelAtS1 = 1 + (s1 - 120) / 10 * 1;      /* 1 mm at 120 cm rising 1 mm per 10 cm */
  near(trimFirst.heelCorrection, heelAtS1, 1e-9, 'trim first: the heel is read at the trim-corrected sounding');
  near(trimFirst.correctedSounding, s1 + heelAtS1 / 10, 1e-9, 'and added on top');
  near(trimFirst.volumeM3, 10 + 0.08 * (s1 + heelAtS1 / 10 - 125), 6e-4, 'volume from the capacity rows');
  const heelFirst = calc.manualDoubleInterpolation({ ...base, trimKind: 'length', heelKind: 'length', lengthOrder: 'heelFirst', trimGrid: corners(8, 6), heelGrid: corners(4, 2) });
  const h1 = 125 + 1.5 / 10;
  near(heelFirst.trimCorrection, 3 + (h1 - 120) / 10 * 1, 1e-9, 'heel first: the trim is read at the heel-corrected sounding');
  assert.notStrictEqual(trimFirst.correctedSounding, heelFirst.correctedSounding, 'the order changes the answer slightly');

  const noRows = calc.manualDoubleInterpolation({ ...base, trimKind: 'volume', heelKind: 'volume', trimGrid: corners(0.8, 0.6), heelGrid: corners(0.4, 0.2), capacity: [{ sounding: 125, volume: 10 }, {}] });
  assert.strictEqual(noRows.volumeM3, null, 'no volume until both capacity rows are typed');
  near(noRows.trimCorrection, 0.35, 1e-9, 'but the corrections are still shown');
  const outside = calc.manualDoubleInterpolation({ ...base, trimKind: 'length', heelKind: 'length', trimGrid: corners(80, 60), heelGrid: corners(40, 20), lengthOrder: 'together' });
  assert.strictEqual(outside.outsideCapacity, true, 'a correction that carries the sounding out of the typed rows is flagged');
  pass += 16;
}

console.log(`double interpolation: ${pass} checks passed`);
