/**
 * Dual ullage + sounding axes: method flips remap through the pair,
 * not pipe − reading. Single-axis tanks still use subtraction.
 */
'use strict';

const assert = require('assert');
const calc = require('../server/calc');

const dual = {
  soundingMethod: 'ullage',
  pipeHeight: 5071,
  trimAxis: [0, 50, 100, 150, 200],
  ullageAxis: [0, 50, 100, 150, 200],
  soundingAxis: [5071, 5021, 4971, 4921, 4871],
  volumeCurve: { x: [0, 50, 100, 150, 200], v: [463, 463, 463, 463, 463] },
};

assert.strictEqual(calc.hasDualDepthAxes(dual), true, 'dual detected');

/* Ullage entry on an ullage-primary table is a no-op remap. */
assert.strictEqual(calc.toTableReading(dual, 100, 'ullage'), 100);

/* Sounding entry maps through the pair → ullage on trimAxis. */
assert.ok(Math.abs(calc.toTableReading(dual, 4971, 'sounding') - 100) < 1e-9,
  'sounding 4971 → ullage 100 via pair');
assert.ok(Math.abs(calc.toTableReading(dual, 5021, 'sounding') - 50) < 1e-9);

/* Inverse: table ullage → sounding display. */
assert.ok(Math.abs(calc.fromTableReading(dual, 100, 'sounding') - 4971) < 1e-9);

/* Must NOT equal naive pipe − reading when the pair is used (same here, but
   prove we prefer the pair path even if pipe were wrong). */
const wrongPipe = { ...dual, pipeHeight: 9999 };
assert.ok(Math.abs(calc.toTableReading(wrongPipe, 4971, 'sounding') - 100) < 1e-9,
  'dual remap ignores wrong pipeHeight');

/* Single-axis fallback still subtracts. */
const single = {
  soundingMethod: 'ullage',
  pipeHeight: 5000,
  trimAxis: [0, 100, 200],
  volumeCurve: { x: [0, 100, 200], v: [10, 5, 0] }, // falling = ullage table
};
assert.strictEqual(calc.hasDualDepthAxes(single), false);
assert.strictEqual(calc.toTableReading(single, 100, 'sounding'), 4900,
  'single-axis sounding→ullage uses pipe − reading');
assert.strictEqual(calc.toTableReading(single, 100, 'ullage'), 100);

console.log('ok — dual-depth remap');
