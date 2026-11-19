/**
 * Bunkering plan, two fuel lines. One barge, two hoses: the residual line is the plan itself and an optional
 * distillate line rides inside the same document. Each line has its own grade, rate, tanks and clock; the figures
 * for the whole delivery are the sums, with the later of the two finish times.
 */
'use strict';
const assert = require('assert');
const Core = require('../public/js/bunkering-core.js');
let pass = 0; let failed = 0;
function check(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 3).join('\n       ')); } }

const mk = (id, name, grade, side, role) => ({ id, name, fuelGrade: grade, side, fuelRole: role || 'storage', tankNo: 1, capacityM3: 500, calibration: {} });
const bundle = { vessel: { name: 'T' }, voyage: {}, readings: {}, tanks: [
  mk('h1', 'NO.1 HFO P', 'hfo', 'port'), mk('h2', 'NO.1 HFO S', 'hfo', 'starboard'),
  mk('m1', 'MGO STOR P', 'mdo', 'port'), mk('m2', 'MGO STOR S', 'mdo', 'starboard') ] };

const single = () => Core.normalizePlan(bundle, { header: { fuelType: 'hfo', deliveryRateMTPerHour: 200, bunkerQuantityMT: 800 }, sequence: [{ tankId: 'h1', targetVolumeM3: 400 }] });
const two = () => {
  const p = Core.addDistillateLine(bundle, single());
  p.distillate.header.deliveryRateMTPerHour = 60; p.distillate.header.bunkerQuantityMT = 120;
  p.distillate.sequence[0].tankId = 'm1';
  return p;
};

check('a plan without a distillate line is unchanged (existing saved plans)', () => {
  const p = single();
  assert.strictEqual(p.distillate, null);
  assert.strictEqual(p.header.fuelType, 'hfo');
  assert.strictEqual(Core.computeBunkerPlans(bundle, p, null).b, null);
});
check('adding the distillate line gives it a distillate grade and an empty sequence', () => {
  const p = Core.addDistillateLine(bundle, single());
  assert.ok(Core.DISTILLATE_FUEL_TYPES.includes(p.distillate.header.fuelType));
  assert.strictEqual(p.distillate.sequence.length, Core.PLAN_SLOTS);
  assert.ok(p.distillate.sequence.every((s) => !s.tankId));
  assert.deepStrictEqual(Core.addDistillateLine(bundle, p).distillate, p.distillate, 'adding twice keeps the first');
});
check('each line is worked out at its own rate and time', () => {
  const r = Core.computeBunkerPlans(bundle, two(), null);
  assert.strictEqual(r.a.header.deliveryRateMTPerHour, 200);
  assert.strictEqual(r.b.header.deliveryRateMTPerHour, 60);
  assert.strictEqual(r.a.header.timeToBunkerHours, 4);
  assert.strictEqual(r.b.header.timeToBunkerHours, 2);
  assert.strictEqual(r.b.header.fuelType, 'mdo');
});
check('the whole delivery: quantities and rates add, the finish is the later line', () => {
  const c = Core.computeBunkerPlans(bundle, two(), null).combined;
  assert.strictEqual(c.quantityMT, 920);
  assert.strictEqual(c.rateMTPerHour, 260);
  assert.strictEqual(c.timeToBunkerHours, 4);
  assert.strictEqual(c.twoLines, true);
});
check('the distillate line takes port, date and drafts from the residual line', () => {
  const p = two();
  p.header.port = 'FUJAIRAH'; p.header.draftFwd = 9.1; p.header.draftAft = 9.5; p.header.heel = 1;
  p.distillate.header.port = 'SOMEWHERE ELSE';
  const d = Core.distillateLine(p);
  assert.strictEqual(d.header.port, 'FUJAIRAH');
  assert.strictEqual(d.header.draftFwd, 9.1);
  assert.strictEqual(d.header.heel, 1);
  assert.strictEqual(d.header.fuelType, 'mdo', 'but the grade, rate and quantity stay its own');
});
check('a tank in both lines is an error', () => {
  const p = two(); p.distillate.sequence[1].tankId = 'h1';
  const w = Core.computeBunkerPlans(bundle, p, null).combined.warnings;
  assert.ok(w.some((x) => x.code === 'tank-in-both-lines' && x.level === 'error'));
});
check('a line carrying the wrong family of grade is flagged', () => {
  const p = two(); p.header.fuelType = 'mdo';
  const w = Core.computeBunkerPlans(bundle, p, null).combined.warnings;
  assert.ok(w.some((x) => x.code === 'line-a-grade'));
});
check('the lines have separate clocks', () => {
  const p = two();
  p.startedAt = '2026-11-19T08:00:00.000Z';
  const r = Core.computeBunkerPlans(bundle, p, null);
  assert.strictEqual(r.a.monitoring.clock.started, true);
  assert.strictEqual(r.b.monitoring.clock.started, false, 'starting the residual line leaves the distillate line unstarted');
});
check('an edited line goes back into the plan without touching the other', () => {
  const p = two();
  const edited = Core.distillateLine(p); edited.header.deliveryRateMTPerHour = 90;
  const q = Core.withLine(p, 'B', edited);
  assert.strictEqual(q.distillate.header.deliveryRateMTPerHour, 90);
  assert.strictEqual(q.header.deliveryRateMTPerHour, 200);
  const a2 = Core.residualLine(p); a2.header.deliveryRateMTPerHour = 150;
  const q2 = Core.withLine(p, 'A', a2);
  assert.strictEqual(q2.header.deliveryRateMTPerHour, 150);
  assert.strictEqual(q2.distillate.header.deliveryRateMTPerHour, 60);
});
check('removing the distillate line gives back the single plan', () => {
  assert.strictEqual(Core.removeDistillateLine(two()).distillate, null);
});
check('the saved row records both lines', () => {
  const s = Core.planSnapshots(Core.computeBunkerPlans(bundle, two(), null));
  assert.ok(s.form.distillate, 'the form keeps the distillate line');
  assert.strictEqual(s.distillate.fuelType, 'mdo');
  assert.strictEqual(s.distillate.bunkerQuantityMT, 120);
});
check('the plan survives normalising twice (save, load)', () => {
  const once = Core.normalizePlan(bundle, two());
  const twice = Core.normalizePlan(bundle, JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice.distillate.header, once.distillate.header);
  assert.deepStrictEqual(twice.distillate.sequence, once.distillate.sequence);
});

check('a delivery with two hoses has a second delivery note, reconciled against its own grade', () => {
  const sum = Core.normalizeSummary(bundle, { bdn: { fuelType: 'lsfo', quantityMT: 800 }, bdn2: { fuelType: 'mdo', quantityMT: 120, number: 'B-77' } });
  assert.strictEqual(sum.bdn2.number, 'B-77');
  assert.strictEqual(Core.normalizeSummary(bundle, {}).bdn2, null, 'no second note unless one was added');
  const c = Core.computeBunkerSummary(bundle, sum, null, null);
  assert.strictEqual(c.bdn2.quantityMT, 120);
  assert.strictEqual(c.quantities2.bdnQuantityMT, 120);
  assert.strictEqual(c.quantities2.pendingReason, 'no-measurement', 'no soundings yet: unknown, not a shortfall');
  assert.strictEqual(c.quantities.bdnQuantityMT, 800, 'the first note is unchanged');
  assert.strictEqual(Core.computeBunkerSummary(bundle, {}, null, null).bdn2, null);
});

console.log(failed ? '\nFAILED — ' + failed + ' of ' + (pass + failed) : '\nPASSED — ' + pass + ' checks');
process.exit(failed ? 1 : 0);
