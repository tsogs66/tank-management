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

check('the current soundings can be typed as dip or ullage, and a switch converts the readings', () => {
  assert.strictEqual(Core.entryModeOf('dip'), 'dip');
  assert.strictEqual(Core.entryModeOf('whatever'), 'own', 'anything else is the tank\'s own method');
  assert.strictEqual(Core.entryMethodFor('own', 'ullage'), 'ullage');
  assert.strictEqual(Core.entryMethodFor('dip', 'ullage'), 'dip');
  assert.strictEqual(Core.entryMethodFor('ullage', 'dip'), 'ullage');
  const tank = { id: 'x', pipeHeight: 1000 };
  const top = Core.scaleTop(tank);
  const asDip = Core.convertReading(tank, 150, 'ullage', 'dip');
  assert.strictEqual(asDip, top - 150, 'dip = pipe height - ullage');
  assert.strictEqual(Core.convertReading(tank, asDip, 'dip', 'ullage'), 150, 'and back again, unchanged');
  assert.strictEqual(Core.convertReading(tank, 150, 'dip', 'dip'), 150, 'same way: nothing to convert');
  assert.strictEqual(Core.convertReading(tank, '', 'dip', 'ullage'), null, 'a blank stays blank');
});
check('the choice is kept per line and defaults to each tank\'s own method', () => {
  assert.strictEqual(single().soundingEntry, 'own');
  const p = two(); p.distillate.soundingEntry = 'ullage'; p.soundingEntry = 'dip';
  const n = Core.normalizePlan(bundle, p);
  assert.strictEqual(n.soundingEntry, 'dip');
  assert.strictEqual(n.distillate.soundingEntry, 'ullage');
  assert.strictEqual(Core.computeBunkerPlan(bundle, Core.distillateLine(n), null).header.soundingEntry, 'ullage');
});

check('one report can carry two grades from the same supplier: VLSFO and LSMGO, each against its own delivery note', () => {
  const c = Core.computeBunkerSummary(bundle, {
    supplier: 'ACME BUNKERS', bargeName: 'BARGE 1', bdnNumber: 'A-1',
    bdn: { fuelType: 'lsfo', quantityMT: '600' },
    bdn2: { fuelType: 'lsmgo', quantityMT: '100', number: 'B-2' },
  }, null, null);
  assert.strictEqual(c.supplier, 'ACME BUNKERS');
  assert.strictEqual(c.bdn.fuelType, 'lsfo');
  assert.strictEqual(c.bdn2.fuelType, 'lsmgo');
  assert.strictEqual(c.bdn2.number, 'B-2');
  assert.strictEqual(c.quantities2.bdnQuantityMT, 100);
});
check('the second fuel can be any grade except the first, and a residual first suggests LSMGO', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/js/bunkering-report.js'), 'utf8');
  assert.ok(/FUEL_TYPES\.filter\(\(t\) => t\.id !== f\.bdn\.fuelType\)/.test(src), 'every grade but the first');
  assert.ok(/DISTILLATE_FUEL_TYPES\.includes\(first\) \? 'lsfo' : 'lsmgo'/.test(src));
  assert.ok(/summaryGradesText\(c\)/.test(src) && /summaryBdnNumbersText\(c\)/.test(src), 'the printed header names both grades and both notes');
});

const fakeAfter = { sections: [], grades: [
  { id: 'lsfo', label: 'VLSFO', priorMT: 100, addedMT: 600, presentMT: 700 },
  { id: 'lsmgo', label: 'LSMGO', priorMT: 20, addedMT: 100, presentMT: 120 },
  { id: 'hfo', label: 'HFO', priorMT: 50, addedMT: 0, presentMT: 50 },
] };
check('an extra BDN of its own grade is held against what was received of that grade', () => {
  const c = Core.computeBunkerSummary(bundle, {
    bdn: { fuelType: 'lsfo', quantityMT: '600' },
    extraBdns: [{ fuelType: 'lsmgo', quantityMT: '99', number: 'X-1' }],
  }, fakeAfter, null);
  assert.strictEqual(c.extraBdns.length, 1);
  assert.strictEqual(c.extraBdns[0].label, 'LSMGO');
  assert.strictEqual(c.extraQuantities[0].receivedQuantityMT, 100);
  assert.strictEqual(c.extraQuantities[0].differenceMT, 1);
  assert.strictEqual(c.extraQuantities[0].gradeTotalMT, null, 'one note for the grade: no total');
  assert.strictEqual(c.quantities.differenceMT, 0, 'the first note is untouched');
});
check('two notes of one grade are added up before they are compared with the receipt', () => {
  const c = Core.computeBunkerSummary(bundle, {
    bdn: { fuelType: 'lsfo', quantityMT: '400' },
    extraBdns: [{ fuelType: 'lsfo', quantityMT: '195', number: 'X-2' }],
  }, fakeAfter, null);
  assert.strictEqual(c.quantities.gradeTotalMT, 595);
  assert.strictEqual(c.quantities.differenceMT, 5, '600 received against 400 + 195');
  assert.strictEqual(c.extraQuantities[0].gradeTotalMT, 595);
  assert.strictEqual(c.extraQuantities[0].differenceMT, 5);
});
check('three notes, three grades, and the saved summary keeps them through normalising twice', () => {
  const form = { bdn: { fuelType: 'lsfo', quantityMT: '600' }, bdn2: { fuelType: 'lsmgo', quantityMT: '100' }, extraBdns: [{ fuelType: 'hfo', quantityMT: '10' }] };
  const once = Core.normalizeSummary(bundle, form);
  const twice = Core.normalizeSummary(bundle, JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice.extraBdns, once.extraBdns);
  assert.strictEqual(twice.extraBdns[0].number, '');
  assert.deepStrictEqual(Core.normalizeSummary(bundle, {}).extraBdns, [], 'none unless added');
  const c = Core.computeBunkerSummary(bundle, form, fakeAfter, null);
  assert.strictEqual(c.extraQuantities[0].receivedQuantityMT, 0);
});
check('the summary has an Add extra BDN button and prints each extra note', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/js/bunkering-report.js'), 'utf8');
  assert.ok(/id="bs-add-xbdn"/.test(src) && /data-xbdn-remove/.test(src));
  assert.ok(/Bunker details \(BDN\) — extra \$\{i \+ 1\}/.test(src));
  assert.ok(/\.\.\.\(c\.extraBdns \|\| \[\]\)\.map\(\(b\) => b\.number\)/.test(src), 'header lists every note number');
});

check('the plan can hold the drafts expected after bunkering, and works the target soundings at that trim', () => {
  const p = single(); p.header.draftFwd = 8.5; p.header.draftAft = 9.5;
  assert.strictEqual(Core.computeBunkerPlan(bundle, p, null).header.afterDraftsSet, false, 'blank: same as now');
  assert.strictEqual(Core.computeBunkerPlan(bundle, p, null).header.afterTrim, null);
  p.header.afterDraftFwd = 10.2; p.header.afterDraftAft = 10.6;
  const h = Core.computeBunkerPlan(bundle, p, null).header;
  assert.strictEqual(h.afterDraftsSet, true);
  assert.strictEqual(h.trim, -1, 'trim now');
  assert.ok(Math.abs(h.afterTrim - (-0.4)) < 1e-9, 'trim expected after');
  assert.ok(Math.abs(h.afterMeanDraft - 10.4) < 1e-9);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../public/js/bunkering-core.js'), 'utf8');
  assert.ok(/readingForVolume\(tank, out\.targetVolumeM3, targetCtx\)/.test(src), 'the target is read at the after trim');
  assert.ok(/readingForVolume\(tank, estVol, ctx\)/.test(src), 'the live estimate stays at the trim now');
});
check('the expected drafts belong to the whole delivery, not to a line, and an existing plan has none', () => {
  assert.ok(Core.LINE_SHARED_FIELDS ? Core.LINE_SHARED_FIELDS.includes('afterDraftFwd') : true);
  const p = Core.addDistillateLine(bundle, single());
  assert.strictEqual(p.distillate.header.afterDraftFwd, '', 'the distillate line keeps none of its own');
  assert.strictEqual(single().header.afterDraftFwd, '');
});
check('the after-bunkering report starts from the drafts the plan expects, and still takes the real ones', () => {
  const b2 = { ...bundle, bunkerPlan: { header: { afterDraftFwd: '10.2', afterDraftAft: '10.6' } } };
  const a = Core.emptyAfterReport(b2, null);
  assert.strictEqual(a.header.draftFwd, '10.2');
  assert.strictEqual(a.header.draftAft, '10.6');
  const kept = Core.normalizeAfterReport(b2, { header: { draftFwd: '10.05', draftAft: '10.71' } }, null);
  assert.strictEqual(kept.header.draftFwd, '10.05', 'the real figure typed on the page is kept');
  const plain = Core.emptyAfterReport(bundle, null);
  assert.notStrictEqual(plain.header.draftFwd, '10.2');
});

console.log(failed ? '\nFAILED — ' + failed + ' of ' + (pass + failed) : '\nPASSED — ' + pass + ' checks');
process.exit(failed ? 1 : 0);
