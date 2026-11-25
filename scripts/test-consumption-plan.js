/**
 * Consumption plan (shared module): one route table with a fuel per line.
 *  - sea days = distance / (speed x 24); quantity = MT per day x the exact days; margin % is per line;
 *  - a line carries several fuels (the vessel's own grades; Residual / Distillate when none), each with its MT per day,
 *    so a fuel burned as needed (LSMGO) is only its average per day;
 *  - plans saved by the earlier two-block layout are converted and give the same totals as before;
 *  - the plan is saved with its earlier-shape twin; an edit made there by a device not yet updated wins.
 */
'use strict';
const assert = require('assert');
const CP = require('../public/js/consumption-plan.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const near = (a, b, e = 1e-9) => a != null && Math.abs(a - b) < e;

/* ---- grades ---- */
ok(CP.normGrade('VLSFO') === 'LSFO' && CP.normGrade('mgo') === 'MDO/MGO' && CP.normGrade('HFO') === 'HFO', 'the same fuel under two names is one grade');
ok(CP.cleanFuels(null).map((f) => f.id).join() === 'Residual,Distillate', 'with no fuels in the vessel setup there are two: Residual and Distillate');
ok(CP.cleanFuels([]).length === 2, 'an empty list falls back too');
const vessel = CP.cleanFuels([{ id: 'HFO' }, { id: 'LSFO' }, { id: 'MDO/MGO' }, { id: 'LSMGO' }, { id: 'VLSFO' }]);
ok(vessel.map((f) => f.id).join() === 'HFO,LSFO,MDO/MGO,LSMGO', 'the vessel fuels are used, a repeated name once');
ok(CP.familyOf('LSMGO') === 'distillate' && CP.familyOf('LSFO') === 'residual' && CP.familyOf('Distillate') === 'distillate', 'residual or distillate by name');

/* ---- one plan: a sea leg and a port stay, two fuels each ---- */
const plan = CP.defaultPlan(vessel);
ok(plan.legs.length === 1 && plan.legs[0].fuels.length === 2, 'a new plan has one line with two fuel slots');
ok(plan.legs[0].fuels[0].grade === 'HFO' && plan.legs[0].fuels[1].grade === 'MDO/MGO', 'defaulting to a residual and a distillate of the vessel');
const L1 = plan.legs[0];
Object.assign(L1, { from: 'A', to: 'B', distance: 1000, speed: 12, marginPct: 10 });
L1.fuels[0].daily = 30; L1.fuels[1].daily = 2;
plan.legs.push(CP.newLeg(plan, vessel));
const L2 = plan.legs[1];
Object.assign(L2, { port: true, from: 'B', to: 'B', days: 2.5, marginPct: 0 });
L2.fuels[0].daily = 5; L2.fuels[1].daily = 1;
ok(L2.fuels[0].grade === 'HFO' && L2.fuels[1].grade === 'MDO/MGO', 'a new line starts on the previous line\'s fuels');

ok(near(CP.legDays(L1), 1000 / 288), 'sea days = distance / (speed x 24)');
ok(near(CP.fuelQty(L1, L1.fuels[0]), 30 * 1000 / 288), 'quantity = MT per day x the exact days');
ok(near(CP.fuelQty(L1, L1.fuels[1]), 2 * 1000 / 288), 'LSMGO / distillate as a daily figure: MT per day x the days');
ok(near(CP.fuelMargin(L1, L1.fuels[0]), 30 * 1000 / 288 * 0.1) && near(CP.fuelMargin(L1, L1.fuels[1]), 2 * 1000 / 288 * 0.1), 'the line margin applies to each fuel of the line');
ok(CP.fuelMargin(L2, L2.fuels[0]) === 0, 'a 0 % margin is 0, not blank');
const route = CP.routeSummary(plan);
ok(near(route.daysSea, 1000 / 288) && near(route.daysPort, 2.5) && route.totalDist === 1000, 'days and distance are worked out once, for every fuel');
const hfo = CP.gradeSummary(plan, 'HFO');
ok(near(hfo.totalCons, 30 * 1000 / 288 + 5 * 2.5), 'a grade totals its quantities over every line');
ok(near(hfo.margin, 30 * 1000 / 288 * 0.1), 'and its margins');
ok(near(hfo.required, hfo.totalCons + hfo.margin), 'required = consumption + margin');
ok(CP.gradesInUse(plan).join() === 'HFO,MDO/MGO', 'the grades in use are those with a figure');
plan.stocks.HFO = { label: 'HFO', currentRob: 800, qtyReceive: 100, deliveryRob: 50 };
const h2 = CP.gradeSummary(plan, 'HFO');
ok(near(h2.arrivalRob, 800 - h2.required) && near(h2.nextDepRob, 800 - h2.required + 100), 'arrival and next departure ROB');
ok(near(h2.excessActual, (800 + 100 - h2.totalCons) - 50) && near(h2.excessMargin, h2.nextDepRob - 50), 'both Excess figures');
ok(h2.stem === 0, 'no stem needed with enough ROB');
plan.stocks.HFO.currentRob = 100; plan.stocks.HFO.qtyReceive = 0;
ok(CP.gradeSummary(plan, 'HFO').stem > 0, 'a stem is advised when the ROB falls short');
ok(CP.gradeSummary(plan, 'HFO').stemAdvice.orderMt > 0, 'with the order quantity');

/* a line with From and To and no run: the figure typed is that line's quantity (as before) */
const lone = CP.emptyLeg(2); lone.from = 'X'; lone.to = 'Y'; lone.fuels[0] = { grade: 'HFO', daily: 12 };
ok(CP.fuelQty(lone, lone.fuels[0]) === 12, 'no run on a named line: the figure is the quantity');
ok(CP.daysShown(L1, CP.legDays(L1)) === 3.47, 'worked days show to two decimals');
ok(CP.daysShown({ port: true, days: 2.5 }, 2.5) === 2.5, 'port days show as typed');

/* a fuel not in the vessel list (an older plan) is kept */
const odd = CP.defaultPlan(vessel); odd.legs[0].fuels[0] = { grade: 'ULSFO', daily: 10 }; odd.legs[0].from = 'a'; odd.legs[0].to = 'b';
ok(CP.gradeSummary(odd, 'LSFO').totalCons === 10, 'ULSFO and LSFO are one grade for totals');

/* ---- the earlier two-block layout, converted ---- */
function oldQty(leg) {
  const days = leg.port ? (leg.days == null ? null : Number(leg.days)) : (leg.distance > 0 && leg.speed > 0 ? leg.distance / (leg.speed * 24) : null);
  return days == null ? null : leg.dailyCons * days;
}
const legacy = {
  voyageNo: 'V1', date: '2026-11-20', remarks: 'old', saveName: 'Singapore',
  residual: { grade: 'HFO', currentRob: 800, qtyReceive: 100, deliveryRob: 50, unpumpableMt: 5, weatherMarginMt: 10, legs: [
    { port: false, from: 'A', to: 'B', distance: 1000, speed: 12, dailyCons: 30, days: null, marginPct: 10 },
    { port: true, from: 'B', to: 'B', distance: null, speed: null, dailyCons: 5, days: 2.5, marginPct: 0 },
    { port: false, from: 'B', to: 'C', distance: 600, speed: 11, dailyCons: 28, days: null, marginPct: 5 } ] },
  distillate: { grade: 'LSMGO', currentRob: 90, qtyReceive: 0, legs: [
    { port: false, from: 'A', to: 'B', distance: 1000, speed: 12, dailyCons: 2, days: null, marginPct: 10 },
    { port: true, from: 'B', to: 'B', distance: null, speed: null, dailyCons: 1, days: 2.5, marginPct: 0 },
    { port: false, from: 'B', to: 'C', distance: 600, speed: 11, dailyCons: 2, days: null, marginPct: 5 } ] },
};
const conv = CP.ensurePlan(legacy, vessel);
ok(conv.v === 2 && conv.legs.length === 3, 'an earlier plan becomes one route table (3 lines, not 6)');
ok(conv.voyageNo === 'V1' && conv.saveName === 'Singapore' && conv.remarks === 'old', 'with its voyage, name and remarks');
ok(conv.legs[0].fuels[0].grade === 'HFO' && conv.legs[0].fuels[0].daily === 30 && conv.legs[0].fuels[1].grade === 'LSMGO' && conv.legs[0].fuels[1].daily === 2, 'each line takes the residual and distillate figures of its route');
ok(CP.gradeSummary(conv, 'HFO').stemAdvice.unpumpable === 5 && conv.stocks.HFO.currentRob === 800 && conv.stocks.LSMGO.currentRob === 90, 'the stock of each grade comes across');
const resQty = legacy.residual.legs.reduce((s, l) => s + oldQty(l), 0);
const resMargin = legacy.residual.legs.reduce((s, l) => s + oldQty(l) * (l.marginPct / 100), 0);
ok(near(CP.gradeSummary(conv, 'HFO').totalCons, resQty) && near(CP.gradeSummary(conv, 'HFO').margin, resMargin), 'the residual totals are the same as the earlier layout gave');
const disQty = legacy.distillate.legs.reduce((s, l) => s + oldQty(l), 0);
ok(near(CP.gradeSummary(conv, 'LSMGO').totalCons, disQty), 'and the distillate totals');
const rt = CP.routeSummary(conv);
ok(near(rt.daysSea, 1000 / 288 + 600 / (11 * 24)) && rt.daysPort === 2.5 && rt.totalDist === 1600, 'days and distance are counted once');

/* the two blocks did not line up: the extra distillate line is kept as its own line */
const ragged = JSON.parse(JSON.stringify(legacy));
ragged.distillate.legs.splice(1, 1);                   /* distillate has no port line */
ragged.distillate.legs.push({ port: false, from: 'C', to: 'D', distance: 300, speed: 10, dailyCons: 2, days: null, marginPct: null });
const rg = CP.ensurePlan(ragged, vessel);
ok(rg.legs.length === 4, 'a distillate line that matches no route line is added as a line of its own');
ok(near(CP.gradeSummary(rg, 'LSMGO').totalCons, ragged.distillate.legs.reduce((s, l) => s + oldQty(l), 0)), 'and nothing is lost from the distillate total');
ok(near(CP.gradeSummary(rg, 'HFO').totalCons, resQty), 'nor from the residual total');

/* ---- saved with the earlier shape beside it ---- */
const saved = CP.finalize(conv);
ok(saved.v === 2 && saved.legs.length === 3 && saved.residual && saved.distillate && typeof saved.legacySig === 'number', 'a plan is saved in the new shape and the earlier one');
ok(saved.residual.legs[0].dailyCons === 30 && saved.distillate.legs[0].dailyCons === 2, 'the earlier shape holds the daily figure of each family');
ok(saved.residual.grade === 'HFO' && saved.distillate.grade === 'LSMGO', 'with the grade the plan mostly burns in each');
const back = CP.ensurePlan(saved, vessel);
ok(JSON.stringify(back.legs) === JSON.stringify(conv.legs) && JSON.stringify(back.stocks) === JSON.stringify(conv.stocks), 'reading it back gives the same plan');
/* a device that has not been updated edits the earlier shape */
const stale = JSON.parse(JSON.stringify(saved));
stale.residual.legs[0].dailyCons = 99;
const re = CP.ensurePlan(stale, vessel);
ok(re.legs[0].fuels[0].daily === 99, 'an edit made in the earlier shape by a device not yet updated is not lost');
/* three fuels: still saved, and the families are summed for the older shape */
const three = CP.ensurePlan(saved, vessel); three.fuelSlots = 3; three.legs.forEach((l) => l.fuels.push({ grade: '', daily: null })); CP.ensurePlan(three, vessel);
three.legs[0].fuels[2] = { grade: 'MDO/MGO', daily: 1.5 };
ok(CP.toLegacy(three).distillate.legs[0].dailyCons === 3.5, 'two distillates on a line add up in the earlier shape');

/* ---- more shapes ---- */
ok(CP.ensurePlan(null, vessel).legs.length === 1 && CP.ensurePlan({}, vessel).v === 2, 'nothing saved gives an empty plan');
const four = CP.defaultPlan(vessel); four.fuelSlots = 9; ok(CP.ensurePlan(four, vessel).fuelSlots === CP.MAX_SLOTS, 'at most four fuels per line');
const html = CP.printBody(plan, vessel, {});
ok(/Route and fuels/.test(html) && /Fuel 1/.test(html) && /HFO/.test(html) && /MDO\/MGO/.test(html), 'the printout has the route table and a block per grade');
ok(/3\.47/.test(html) && !/3\.472/.test(html), 'the printout shows two-decimal days');

/* the result boxes: days to two decimals, quantities to three */
const cardsOf = (h) => { const o = {}; for (const m of h.matchAll(/<b>([^<]*)<\/b>(?:<span[^>]*>[^<]*<\/span>)?<\/div><div class="bp-result-title">([^<]*)</g)) o[m[2]] = m[1]; return o; };
const rc = cardsOf(CP.routeCardsHtml(CP.routeSummary(conv)));
const seaDays2 = 1000 / 288 + 600 / (11 * 24);
ok(rc['Days at Sea'] === seaDays2.toFixed(2) && rc['Days at Port / Anchor'] === '2.50', 'the Days at Sea / Port boxes show two decimals: ' + rc['Days at Sea']);
ok(rc['Total Distance'] === '1600', 'distance is a whole number');
const gc = cardsOf(CP.gradeCardsHtml(CP.gradeSummary(conv, 'HFO')));
ok(/^\d+\.\d{3}$/.test(gc['Total Consumption']) && /^\d+\.\d{3}$/.test(gc['Required Quantity']), 'the quantity boxes are three decimals');


/* ---- consecutive voyage legs ---- */
const mv = CP.defaultPlan(vessel);
Object.assign(mv.legs[0], { from: 'A', to: 'B', distance: 1200, speed: 12.5 });           /* 4 days */
mv.legs[0].fuels[0].daily = 30; mv.legs[0].fuels[1].daily = 2;
mv.stocks.HFO = { label: 'HFO', currentRob: 500, qtyReceive: 100 };
mv.stocks['MDO/MGO'] = { label: 'MDO/MGO', currentRob: 20 };
const single = CP.gradeSummary(mv, 'HFO');
ok(CP.chain(mv).sections.length === 1 && near(CP.chain(mv).sections[0].sums.HFO.required, single.required), 'one leg gives the same figures as before');
ok(CP.overviewHtml(mv) === '', 'no side-by-side table with one leg');
CP.sectionList(mv); mv.extra = [CP.newSection(mv, vessel)];
ok(mv.extra[0].legs[0].fuels[0].grade === 'HFO' && mv.extra[0].legs[0].fuels[1].grade === 'MDO/MGO', 'a next leg starts on the fuels the last line used');
Object.assign(mv.extra[0].legs[0], { from: 'B', to: 'C', distance: 2400, speed: 10 });    /* 10 days */
mv.extra[0].legs[0].fuels[0].daily = 25; mv.extra[0].legs[0].fuels[1].daily = 1.5;
mv.extra[0].stocks.HFO = { label: 'HFO', qtyReceive: 50 };
const ch = CP.chain(mv);
ok(near(ch.sections[0].sums.HFO.nextDepRob, 500 - 120 + 100), 'leg 1 ends with ROB + receive - consumption');
ok(near(ch.sections[1].sums.HFO.rob, 480) && near(ch.sections[1].sums.HFO.arrivalRob, 480 - 250) && near(ch.sections[1].sums.HFO.nextDepRob, 280), 'leg 2 starts with the ROB leg 1 ends with');
ok(near(ch.sections[1].sums['MDO/MGO'].rob, 20 - 8), 'the distillate carries over too');
const cm = CP.combined(mv);
const cH = cm.grades.find((g) => g.grade === 'HFO');
ok(near(cH.totalCons, 370) && near(cH.startRob, 500) && near(cH.receive, 150) && near(cH.nextDepRob, 280), 'combined: burned, start ROB, received and end ROB');
ok(near(cm.route.daysSea, 14) && near(cm.route.totalDist, 3600), 'combined days and distance');
ok(/Leg 1/.test(CP.overviewHtml(mv)) && /Combined/.test(CP.overviewHtml(mv)) && /<td class="cp-comb ">370\.000/.test(CP.overviewHtml(mv)), 'the side-by-side table lists every leg and the combined figures');
/* a leg that runs short shows a negative start on the next one, and the stem carries */
mv.stocks.HFO.currentRob = 100;
const sh = CP.chain(mv);
ok(sh.sections[0].sums.HFO.arrivalRob < 0 && sh.sections[1].sums.HFO.rob === sh.sections[0].sums.HFO.nextDepRob, 'a shortage carries into the next leg');
mv.stocks.HFO.currentRob = 500;
/* saved and loaded again, and an old app that ignores the extra legs */
const back2 = CP.ensurePlan(JSON.parse(JSON.stringify(CP.finalize(mv))), vessel);
ok(back2.extra && back2.extra.length === 1 && near(CP.combined(back2).grades[0].totalCons, cH.totalCons), 'the next legs survive saving and loading');
const oldApp = JSON.parse(JSON.stringify(CP.finalize(mv))); oldApp.residual.legs[0].dailyCons = 99;
const edited = CP.ensurePlan(oldApp, vessel);
ok(edited.extra && edited.extra.length === 1 && edited.legs[0].fuels[0].daily === 99, 'an edit made by an older app wins on leg 1 and keeps the next legs');
const pm = CP.printBody(mv, vessel, {});
ok(/Leg 1 — route and fuels/.test(pm) && /Leg 2 — route and fuels/.test(pm) && /All voyage legs combined/.test(pm) && /HFO — combined/.test(pm) && /Final Next Departure ROB/.test(pm), 'the printout has each leg and the combined total');
const many = CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)], extra: Array.from({ length: 9 }, () => ({ legs: [CP.emptyLeg(2)] })) }, vessel);
ok(many.extra.length === CP.MAX_LEGS - 1, 'at most six voyage legs');

console.log(`consumption plan: ${pass} checks passed`);
