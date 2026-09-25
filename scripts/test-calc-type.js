/**
 * Telling one ship's calibration book from another's.
 *
 * Three arrangements turn up, and a tank imported before the app could tell
 * them apart carries whatever its importer guessed. detectCalcType reads the
 * stored tables and says what they hold; these are the shapes it has to get
 * right, built from the books they came from.
 */
'use strict';
const assert = require('assert');
const calc = require('../server/calc.js');

let pass = 0;
const is = (got, want, what) => { assert.strictEqual(got, want, what); pass += 1; };

/* ---- Capacities + heel in millimetres (whole numbers) ---- */
const rows = [950, 1000, 1050, 1100, 1150, 1200];
const soundingHeel = {
  name: 'NO.1 H.F.O. TK (P)', calcType: 'direct', capacity: 463.476, pipeHeight: 2000,
  trimAxis: rows, trimVals: [-1, 0, 0.5, 1],
  trimGrid: [[0, 0, 0, 0], [120, 118, 116, 114], [240, 236, 232, 228],
             [360, 354, 348, 342], [430, 424, 418, 412], [463, 457, 451, 445]],
  listAxis: rows, listVals: [-4, -1, 1, 4],
  /* Whole millimetres — decimals would mean cubic metres. */
  listGrid: [[206, 55, -56, -228], [203, 54, -56, -224],
             [201, 53, -56, -224], [198, 53, -55, -224],
             [195, 52, -54, -224], [193, 51, -54, -224]],
};
let v = calc.detectCalcType(soundingHeel);
is(v.calcType, 'correction', 'capacities plus a heel table in millimetres is a sounding correction');
is(v.confident, true, 'and the tables say so plainly');
assert.ok(/millimetres|whole numbers/i.test(v.reason), 'the reason names whole-number millimetres');
pass += 1;

/* ---- Same trim capacities, but heel has decimal m³ (Giorgis-style) ---- */
const volumeHeel = {
  ...soundingHeel,
  name: 'NO.1 H.F.O. TANK (P) volume heel',
  calcType: 'correction',
  /* Heel reaches nearly tank capacity — old mag/cap heuristic wrongly called
     this a sounding correction. Decimals make it volume. */
  listGrid: [[430.670, 12.340, -8.120, -145.828], [400.125, 93.005, -33.742, -145.828],
             [360.500, 80.250, -40.125, -120.500], [300.250, 60.125, -50.250, -100.125],
             [200.125, 40.250, -60.125, -80.250], [100.125, 20.250, -70.125, -60.250]],
};
v = calc.detectCalcType(volumeHeel);
is(v.calcType, 'direct', 'capacities plus a decimal heel table is a volume correction');
is(v.confident, true, 'decimals make the unit unambiguous');
assert.ok(/decimal|cubic metres|volume/i.test(v.reason), 'the reason cites decimal cubic metres');
pass += 1;

/* ---- TAB.1 / TAB.2 / TAB.3: two correction tables and a capacity curve ---- */
const threeTable = {
  name: 'NO.1 F.O.T. PORT', calcType: 'correction', capacity: 740.33, correctionDivisor: 10,
  trimAxis: [0, 20, 40, 60, 80, 100], trimVals: [-2, -1, 0, 1, 2, 3],
  trimGrid: [[-3, -2, 0, 2, 5, 9], [-10, -5, 0, 7, 14, 22], [-15, -8, 0, 7, 14, 22],
             [-15, -7, 0, 7, 15, 22], [-15, -7, 0, 8, 15, 23], [-15, -8, 0, 7, 15, 22]],
  listAxis: [0, 20, 40, 60, 80, 100], listVals: [-3, -1, 0, 1, 3],
  listGrid: [[91, 6, 0, 5, 101], [30, 1, 0, 5, 45], [-12, -5, 0, 2, 11],
             [-28, -8, 0, 5, 8], [-37, -10, 0, 8, 14], [-45, -12, 0, 10, 21]],
  volumeCurve: { x: [0, 20, 40, 60, 80, 100], v: [0, 20, 60, 130, 240, 380] },
};
v = calc.detectCalcType(threeTable);
is(v.calcType, 'trimHeel', 'two correction tables and a capacity curve is the trim-heel arrangement');
is(v.confident, true, 'and that one is unambiguous too');

/* ---- Mixed integers and decimals: never guessed ---- */
const mixed = {
  ...soundingHeel,
  listGrid: [[206, 55.5, -56, -228], [203, 54, -56.25, -224],
             [201, 53, -56, -224], [198, 53.1, -55, -224],
             [195, 52, -54, -224], [193, 51, -54, -224]],
};
v = calc.detectCalcType(mixed);
is(v.confident, false, 'a heel table that mixes whole numbers and decimals is left open');
is(v.calcType, 'direct', 'and the stored setting stands until someone says which');

/* ---- Nothing to go on ---- */
is(calc.detectCalcType({ name: 'bare' }).confident, false, 'a tank with no trim table says so');
is(calc.detectCalcType({}).calcType, null, 'and offers nothing in its place');

/* ---- The capacity-table test itself ---- */
const climbing = [[0, 0], [100, 98], [200, 196], [300, 294], [400, 392], [463, 455]];
is(calc.looksLikeCapacityTable(climbing, [0, 1], 463), true, 'a grid that climbs from empty to full is a capacity table');
const wandering = [[-3, 2], [-10, 7], [-15, 7], [-15, 8], [-15, 7], [-16, 7]];
is(calc.looksLikeCapacityTable(wandering, [0, 1], 463), false, 'a grid that goes negative is not');
is(calc.looksLikeCapacityTable(climbing.slice(0, 2), [0, 1], 463), false, 'and two rows are too few to tell');

/* ---- Why it matters: millimetres subtracted as cubic metres ---- */
const asDirect = calc.computeTank({ ...soundingHeel, calcType: 'direct' },
  { reading: 1075, trim: 0, list: 2, entryMethod: 'ullage' });
const asCorrection = calc.computeTank({ ...soundingHeel, calcType: 'correction' },
  { reading: 1075, trim: 0, list: 2, entryMethod: 'ullage' });
/* Both paths clamp negative m³ to zero; compare corrected soundings instead. */
assert.ok(Math.abs(asDirect.correctedReading - asCorrection.correctedReading) > 10,
  'reading a millimetre heel table as cubic metres moves the corrected sounding a long way');
pass += 1;

/* ---- Pipe fallback: method flip works when pipeHeight was never set ---- */
const noPipe = {
  ...soundingHeel, pipeHeight: 0, soundingMethod: 'sounding',
  trimAxis: [0, 1000, 2000, 3000, 4000, 5000],
  calcType: 'correction',
};
const asSounding = calc.toTableReading(noPipe, 1000, 'sounding');
const asUllage = calc.toTableReading(noPipe, 1000, 'ullage');
assert.ok(asSounding === 1000, 'sounding entry passes through');
pass += 1;
assert.ok(asUllage === 4000, 'ullage entry uses table-top pipe when pipeHeight is 0');
pass += 1;

console.log(`calibration arrangements: ${pass} checks passed`);
