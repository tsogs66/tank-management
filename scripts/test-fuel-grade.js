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

assert.strictEqual(Core.FUEL_TYPES.find((t) => t.id === 'mdo').label, 'MDO/MGO');
assert.strictEqual(Core.fuelGradeFromName('M.G.O. STORAGE TK (S)'), 'mgo');
assert.strictEqual(Core.fuelGradeFromName('L.S.M.G.O. SERVICE'), 'lsmgo');
assert.strictEqual(Core.fuelGradeFromName('LS H.F.O. SETTLING TK'), 'lsfo');

assert.strictEqual(
  Core.sectionForRow({ name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'hfo' }, {}),
  'do',
  'Monitoring home section follows the name when grade was left on hfo'
);

const hfoTank = { id: 'hfo-s', name: 'NO.3 H.F.O. TK (S)', fuelGrade: 'hfo', category: 'fuel' };
const mdoTank = { id: 'mdo-set', name: 'M.D.O. SETTLING TK', fuelGrade: 'hfo', category: 'fuel' };
const mgoTank = { id: 'mgo-st', name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'mgo', category: 'fuel' };
const lsTank = { id: 'ls-set', name: 'LS H.F.O. SETTLING TK', fuelGrade: 'hfo', category: 'fuel' };

const moved = {
  tanks: { fuel: [Object.assign({}, hfoTank), Object.assign({}, mdoTank), Object.assign({}, mgoTank), Object.assign({}, lsTank)] },
};
const form = {
  rows: {
    'hfo-s': { fuelType: 'lsmgo' },
    'mdo-set': { fuelType: 'hfo' },
    'mgo-st': { fuelType: 'mdo' },
    'ls-set': { fuelType: 'hfo' },
  },
};
const changed = Core.applyCarriedFuelGrades(moved, form);
assert.strictEqual(changed.tanks, true);
assert.strictEqual(moved.tanks.fuel[0].fuelGrade, 'lsmgo', 'HFO tank carrying LSMGO takes that grade');
assert.strictEqual(moved.tanks.fuel[1].fuelGrade, 'mdo', 'M.D.O. plate is not left on the hfo default');
assert.strictEqual(form.rows['mdo-set'].fuelType, 'mdo', 'stale hfo row follows the MDO plate');
assert.strictEqual(moved.tanks.fuel[2].fuelGrade, 'mgo', 'MGO stays mgo inside the MDO/MGO bucket');
assert.strictEqual(moved.tanks.fuel[3].fuelGrade, 'hfo', 'LS H.F.O. stays residual');
const again = Core.applyCarriedFuelGrades(moved, form);
assert.strictEqual(again.tanks, false);
assert.strictEqual(again.form, false);

const back = {
  tanks: { fuel: [{ id: 'hfo-s', name: 'NO.3 H.F.O. TK (S)', fuelGrade: 'lsmgo', category: 'fuel' }] },
};
Core.applyCarriedFuelGrades(back, { rows: { 'hfo-s': { fuelType: 'hfo' } } });
assert.strictEqual(back.tanks.fuel[0].fuelGrade, 'hfo', 'moving LSMGO back to HFO stores hfo');

const Graphics = require('../public/js/tank-graphics.js');
const carried = Graphics.withIdentity(
  { name: 'NO.3 H.F.O. TK (S)', fuelGrade: 'hfo', category: 'fuel' },
  'lsmgo'
);
assert.strictEqual(Graphics.contentKey(carried), 'lsmgo');
assert.strictEqual(Graphics.contentLabel(carried), 'LSMGO');
assert.strictEqual(Graphics.baseColour(carried), '#E8A8B8');
const svg = Graphics.tankSvg(carried, 69, { safeFill: 85, details: { grade: Graphics.contentLabel(carried), pct: '69%' } });
assert.ok(svg.includes('LSMGO'), 'the drawing prints LSMGO');
assert.ok(svg.includes(Graphics.liquidColour(carried)), 'the liquid uses the LSMGO colour');
assert.ok(!svg.includes('#6B3A1F') && !svg.includes('#6b3a1f'));

assert.strictEqual(
  Graphics.contentKey({ name: 'M.D.O. SETTLING TK', fuelGrade: 'hfo', category: 'fuel' }),
  'mdo'
);
assert.strictEqual(
  Graphics.contentLabel({ name: 'M.D.O. SETTLING TK', fuelGrade: 'hfo', category: 'fuel' }),
  'MDO'
);
assert.strictEqual(
  Graphics.contentKey({ name: 'NO.3 H.F.O. TK (S)', fuelGrade: 'hfo', category: 'fuel' }),
  'hfo'
);
assert.strictEqual(
  Graphics.contentKey({ name: 'LS H.F.O. SERVICE TK', fuelGrade: 'hfo', category: 'fuel' }),
  'hfo'
);
assert.strictEqual(
  Graphics.identityGrade({ name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'mgo' }, 'mdo'),
  'mgo'
);

console.log('ok — MGO / LSMGO default to distillate, HFO stays residual, a moved tank takes the carried grade');
