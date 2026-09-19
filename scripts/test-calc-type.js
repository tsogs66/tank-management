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

/* ---- FLAG EVI: a sheet of capacities and a sheet of heel corrections ---- */
const rows = [950, 1000, 1050, 1100, 1150, 1200];
const flagEvi = {
  name: 'NO.1 H.F.O. TK (P)', calcType: 'direct', capacity: 463.476,
  trimAxis: rows, trimVals: [-1, 0, 0.5, 1],
  trimGrid: [[0, 0, 0, 0], [120, 118, 116, 114], [240, 236, 232, 228],
             [360, 354, 348, 342], [430, 424, 418, 412], [463, 457, 451, 445]],
  listAxis: rows, listVals: [-4, -1, 1, 4],
  listGrid: [[205.89, 54.74, -55.89, -228.32], [203.24, 54.04, -55.89, -224.35],
             [200.59, 53.34, -55.67, -223.91], [197.96, 52.63, -54.99, -223.91],
             [195.34, 51.93, -54.26, -223.91], [192.71, 51.23, -53.54, -223.77]],
};
let v = calc.detectCalcType(flagEvi);
is(v.calcType, 'correction', 'capacities plus a heel table in millimetres is a sounding correction');
is(v.confident, true, 'and the tables say so plainly');
assert.ok(/463/.test(v.reason), 'the reason names the tank size it weighed the heel figures against');
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

/* ---- A heel table small enough to be either: never guessed ---- */
const ambiguous = { ...flagEvi, calcType: 'direct',
  listGrid: flagEvi.listGrid.map((r) => r.map((x) => x / 200)) };
v = calc.detectCalcType(ambiguous);
is(v.confident, false, 'a heel table that could be millimetres or cubic metres is left open');
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
const asDirect = calc.computeTank({ ...flagEvi, calcType: 'direct' },
  { reading: 1075, trim: 0, list: 2, entryMethod: 'ullage' });
const asCorrection = calc.computeTank({ ...flagEvi, calcType: 'correction' },
  { reading: 1075, trim: 0, list: 2, entryMethod: 'ullage' });
assert.ok(Math.abs(asDirect.volumeObserved - asCorrection.volumeObserved) > 10,
  'reading a millimetre heel table as cubic metres moves the answer a long way');
pass += 1;

console.log(`calibration arrangements: ${pass} checks passed`);
