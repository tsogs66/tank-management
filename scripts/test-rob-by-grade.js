/**
 * The Load Tank ROB buttons (Bunker Consumption in Tank Chief, Cons Plan in Voyage Chief) ask Tank Chief for the weight of
 * each fuel grade. A tank keeps its grade in lower case (hfo, lsfo, mdo, mgo) and the plans look for HFO, LSFO, MDO/MGO and
 * LSMGO, so nothing matched and the buttons came back empty.
 */
'use strict';
const assert = require('assert');
const Core = require('../public/js/fuel-report-core.js');
let pass = 0; let failed = 0;
function check(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } }

const tanks = [
  { id: 'a', name: 'NO.1 H.F.O. TK (P)', fuelGrade: 'hfo' },
  { id: 'b', name: 'LS H.F.O. SERVICE TK', fuelGrade: 'lsfo' },
  { id: 'c', name: 'M.G.O. STORAGE TK (S)', fuelGrade: 'hfo' },   // an old import left the form default on it
  { id: 'd', name: 'M.D.O. TK (P)', fuelGrade: 'mdo' },
  { id: 'e', name: 'LSMGO SERVICE TK', fuelGrade: 'other' },
  { id: 'f', name: 'EMPTY TK', fuelGrade: 'hfo' },
];
const weights = { a: 10, b: 20, c: 30, d: 40, e: 50, f: 0 };
const readingOf = (id) => (id in weights ? { result: { weightMT: weights[id] } } : null);

check('weights are added up under the names the plans use', () => {
  const rob = Core.robByGradeLabel(tanks, readingOf);
  assert.deepStrictEqual(rob, { HFO: 10, LSFO: 20, 'MDO/MGO': 70, LSMGO: 50 });
});
check('an MGO plate with a leftover hfo grade counts as distillate', () => {
  assert.strictEqual(Core.robGradeLabel(tanks[2]), 'MDO/MGO');
});
check('a tank not sounded (no reading or no weight) adds nothing', () => {
  const rob = Core.robByGradeLabel(tanks, (id) => (id === 'a' ? null : readingOf(id)));
  assert.strictEqual(rob.HFO, undefined);
});
check('VLSFO and ULSFO tanks are LSFO', () => {
  assert.strictEqual(Core.robGradeLabel({ name: 'X', fuelGrade: 'vlsfo' }), 'LSFO');
  assert.strictEqual(Core.robGradeLabel({ name: 'X', fuelGrade: 'ulsfo' }), 'LSFO');
});
console.log(failed ? '\n' + failed + ' failed' : '\n' + pass + ' passed');
process.exit(failed ? 1 : 0);
