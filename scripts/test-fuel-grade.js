'use strict';

const assert = require('assert');
const Core = require('../public/js/fuel-report-core.js');

function home(tank) {
  return Core.sectionForTank(tank);
}

assert.strictEqual(home({ name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'hfo' }), 'do',
  'dotted M.G.O. is distillate even when the stored grade defaulted to hfo');
assert.strictEqual(home({ name: 'M.G.O. SERVICE TK', fuelGrade: 'hfo' }), 'do');
assert.strictEqual(home({ name: 'LSMGO SERVICE TK', fuelGrade: 'hfo' }), 'do');
assert.strictEqual(home({ name: 'L.S.M.G.O. TK', fuelGrade: 'hfo' }), 'do');
assert.strictEqual(home({ name: 'MDO TK (P)', fuelGrade: 'hfo' }), 'do');
assert.strictEqual(home({ name: 'MGO STORAGE TK (S)', fuelGrade: 'mgo' }), 'do');

assert.strictEqual(home({ name: 'NO.3 HFO TK (S)', fuelGrade: 'hfo' }), 'fuel',
  'an HFO tank stays residual');
assert.strictEqual(home({ name: 'LS H.F.O. SERVICE TK', fuelGrade: 'hfo' }), 'fuel');
assert.strictEqual(home({ name: 'HFO OVERFLOW TK', fuelGrade: 'hfo' }), 'fuel');

assert.strictEqual(Core.defaultFuelType({ name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'hfo' }), 'mdo');
assert.strictEqual(Core.defaultFuelType({ name: 'LSMGO SERVICE TK', fuelGrade: 'hfo' }), 'lsmgo');
assert.strictEqual(Core.defaultFuelType({ name: 'NO.3 HFO TK (S)', fuelGrade: 'hfo' }), 'hfo');

assert.strictEqual(Core.fuelGradeFromName('M.G.O. STORAGE TK (S)'), 'mgo');
assert.strictEqual(Core.fuelGradeFromName('L.S.M.G.O. SERVICE'), 'lsmgo');
assert.strictEqual(Core.fuelGradeFromName('LS H.F.O. SETTLING TK'), 'lsfo');

assert.strictEqual(
  Core.sectionForRow({ name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'hfo' }, {}),
  'do',
  'Monitoring home section follows the name when grade was left on hfo'
);

console.log('ok — MGO / LSMGO default to distillate, HFO stays residual');
