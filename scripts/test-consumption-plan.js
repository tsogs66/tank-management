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


/* ---- fill the empty MT/day boxes from the log ---- */
const sg = CP.defaultPlan(vessel);
Object.assign(sg.legs[0], { from: 'A', to: 'B', distance: 600, speed: 12 });
sg.legs[0].fuels[0].daily = 31;                       /* typed: must stay */
sg.legs.push(CP.newLeg(sg, vessel)); Object.assign(sg.legs[1], { port: true, from: 'B', to: 'B', days: 2 });
const nFilled = CP.suggestDaily(sg, { HFO: { sea: 29.5, port: 1.2 }, 'MDO/MGO': { sea: 2.345, port: 3.1 }, LSMGO: { sea: 9, port: 9 } });
ok(nFilled === 3 && sg.legs[0].fuels[0].daily === 31, 'a figure already typed is never changed');
ok(sg.legs[0].fuels[1].daily === 2.35 && sg.legs[1].fuels[0].daily === 1.2 && sg.legs[1].fuels[1].daily === 3.1, 'sea lines get the sea average, port lines the port average, to two decimals');
ok(CP.suggestDaily(sg, {}) === 0 && CP.suggestDaily(sg, { HFO: { sea: null, port: 0 } }) === 0, 'nothing is filled when the log has nothing for that fuel');

/* ---- ports and automatic distance (the data for it is optional; the plan keeps what it is told) ---- */
const sp = CP.defaultPlan(vessel);
Object.assign(sp.legs[0], { from: 'ROTTERDAM, NL', to: 'KEPPEL, SG', fromPort: 31140, toPort: 50000, distance: 8387, distAuto: true, seaNote: 'via Suez Canal', speed: 12 });
sp.sea = { avoid: ['suez'], areas: ['red_sea'] };
const sb = CP.ensurePlan(JSON.parse(JSON.stringify(CP.finalize(sp))), vessel);
ok(sb.legs[0].fromPort === 31140 && sb.legs[0].toPort === 50000 && sb.legs[0].distAuto === true && sb.legs[0].seaNote === 'via Suez Canal', 'picked ports and the automatic mark survive saving');
ok(sb.sea.avoid[0] === 'suez' && sb.sea.areas[0] === 'red_sea', 'the route options survive saving');
sb.legs[0].distance = null; ok(CP.ensurePlan(JSON.parse(JSON.stringify(sb)), vessel).legs[0].distAuto === false, 'an automatic mark without a distance is dropped');
ok(CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)] }, vessel).sea.avoid.length === 0, 'a plan saved before this has empty route options');
ok(/8387\.00\*/.test(CP.printBody(sp, vessel, {})) && /sea-lane network/.test(CP.printBody(sp, vessel, {})), 'the printout marks an automatic distance and says how it was made');
ok(!/sea-lane network/.test(CP.printBody(CP.defaultPlan(vessel), vessel, {})), 'a plan with typed distances has no such note');
ok(typeof CP.seaLoader === 'function', 'the loader for the optional sea data is exported');

/* ---- ECA: split a line into outside / inside stretches ---- */
const zl = (z) => ({ mediterranean: 'Mediterranean Sea', north_sea: 'North Sea & English Channel', baltic: 'Baltic Sea' }[z] || z);
const ecaLeg = CP.emptyLeg(2);
Object.assign(ecaLeg, { from: 'KEPPEL', to: 'ROTTERDAM', fromPort: 1, toPort: 2, distance: 8387, distAuto: true, speed: 12, ecaNm: 2429, marginPct: 5 });
ecaLeg.fuels[0] = { grade: 'HFO', daily: 30 }; ecaLeg.fuels[1] = { grade: 'LSMGO', daily: 2 };
const runs = [{ eca: false, nm: 4992, from: [1, 103], to: [36, -5.6] }, { eca: true, zone: 'mediterranean', nm: 2011, from: [36, -5.6], to: [31, 32.3] }, { eca: false, nm: 966, from: [31, 32.3], to: [48.5, -5] }, { eca: true, zone: 'north_sea', nm: 418, from: [48.5, -5], to: [51.9, 4.4] }];
const parts = CP.splitLegAtEca(ecaLeg, runs, zl, 'LSMGO');
ok(parts.length === 4 && parts.reduce((a, l) => a + l.distance, 0) === 8387, 'four stretches that add up to the distance of the line');
ok(parts[0].from === 'KEPPEL' && parts[3].to === 'ROTTERDAM' && parts[0].fromPort === 1 && parts[3].toPort === 2 && parts[1].fromPort === null, 'the first and last stretch keep the ports; the others have none');
ok(/ECA entry 36\.0N 5\.6W \(Mediterranean Sea\)/.test(parts[0].to) && /ECA exit/.test(parts[1].to), 'the stretches are named by where the ECA starts and ends');
ok(parts[1].ecaNm === parts[1].distance && parts[0].ecaNm === null && parts[1].fuels[0].grade === 'LSMGO' && parts[0].fuels[0].grade === 'HFO', 'only the ECA stretches count as ECA and take the ECA fuel');
ok(parts.every((l) => l.marginPct === 5 && l.speed === 12 && l.fuels[0].daily === 30 && l.distAuto), 'speed, margin and MT/day carry over');
ok(CP.splitLegAtEca(ecaLeg, [runs[0]], zl) === null && CP.splitLegAtEca(ecaLeg, [], zl) === null, 'a line with a single stretch is not split');
const adj = CP.splitLegAtEca(ecaLeg, [runs[0], { eca: true, zone: 'north_sea', nm: 400, from: [1, 1], to: [2, 2] }, { eca: true, zone: 'baltic', nm: 800, from: [2, 2], to: [3, 3] }], zl);
ok(adj.length === 2 && /North Sea & English Channel, Baltic Sea/.test(adj[1].ecaZones), 'neighbouring ECA stretches (North Sea then Baltic) become one line');
/* ---- fuels the plan offers: a grade nobody holds or burns is left out ---- */
ok(CP.cleanFuels([{ id: 'HFO', active: true }, { id: 'MDO/MGO', active: false }, { id: 'LSMGO', active: true }]).map((f) => f.id).join() === 'HFO,LSMGO', 'a distillate with no stock and no use is not offered while another distillate is in use');
ok(CP.cleanFuels([{ id: 'HFO', active: true }, { id: 'MDO/MGO', active: false }, { id: 'LSMGO', active: false }]).map((f) => f.id).join() === 'HFO,MDO/MGO,LSMGO', 'when none of a kind is in use they all stay, so there is always a fuel to pick');
ok(CP.cleanFuels([{ id: 'HFO' }, { id: 'LSMGO' }]).map((f) => f.id).join() === 'HFO,LSMGO', 'a host that says nothing about use gets every fuel');
const onlyLs = CP.cleanFuels([{ id: 'HFO', active: true }, { id: 'MDO/MGO', active: false }, { id: 'LSMGO', active: true }]);
ok(CP.defaultPlan(onlyLs).legs[0].fuels[1].grade === 'LSMGO', 'the default second fuel is then the LSMGO');
/* ---- moving a line and removing it keep the route data tidy ---- */
const gl = CP.ensurePlan(Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { legs: [Object.assign(CP.emptyLeg(2), { from: 'A', to: 'B', distance: 10, distAuto: true, grp: { id: 'g1', fromPort: 1, toPort: 2, from: 'A', to: 'Z' } })] }), vessel).legs[0];
ok(gl.grp && gl.grp.id === 'g1' && gl.grp.toPort === 2 && gl.keepWhole === false, 'the route a split line came from is kept with it');
ok(CP.ensurePlan(Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { legs: [Object.assign(CP.emptyLeg(2), { grp: { id: 'x', fromPort: 0, toPort: 2 } })] }), vessel).legs[0].grp === null, 'a group without both ports is dropped');
ok(CP.ensurePlan(Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { sea: { minEca: true, minEcaPct: 15 } }), vessel).sea.minEca === true && CP.ensurePlan(Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { sea: {} }), vessel).sea.minEcaPct === 10, 'the ECA-minimising option and its percentage are kept, 10 % by default');
/* ---- pilot areas as their own lines ---- */
const pRuns = [{ eca: true, zone: 'mediterranean', nm: 700, from: [43.3, 5.3], to: [36, -6] }, { eca: false, nm: 3800, from: [36, -6], to: [25, -79.7] }, { eca: true, zone: 'north_america', nm: 690, from: [25, -79.7], to: [29.95, -90] }];
const pLeg = Object.assign(CP.emptyLeg(2), { from: 'MARSEILLE', to: 'NEW ORLEANS', fromPort: 1, toPort: 2, distance: 5190, distAuto: true, speed: 14, ecaNm: 1390, marginPct: 5 });
pLeg.fuels[0] = { grade: 'HFO', daily: 30 };
const pp = CP.splitLegAtEca(pLeg, pRuns, zl, 'LSMGO', { pilotNm: 10, approachNm: 0 });
ok(pp.length === 5, 'with pilot areas the line becomes five: pilot out, ECA, outside, ECA, pilot in');
ok(pp.reduce((a, l) => a + l.distance, 0) === 5190, 'the five lines still add up to the distance of the line');
ok(pp[0].distance === 10 && pp[4].distance === 10, 'each pilot area is the length asked for (10 nm)');
ok(pp[0].from === 'MARSEILLE' && /^Pilot drop-off /.test(pp[0].to) && /^Pilot drop-off /.test(pp[1].from) && /^Pilot pick-up /.test(pp[3].to) && /^Pilot pick-up /.test(pp[4].from) && pp[4].to === 'NEW ORLEANS', 'they are named by the pilot drop-off point and the pilot pick-up point');
ok(pp[0].fromPort === 1 && pp[4].toPort === 2 && pp[1].fromPort === null && pp[2].toPort === null, 'the first and last pilot lines keep the ports');
ok(pp[0].fuels[0].grade === 'LSMGO' && pp[1].fuels[0].grade === 'LSMGO' && pp[2].fuels[0].grade === 'HFO' && pp[3].fuels[0].grade === 'LSMGO' && pp[4].fuels[0].grade === 'LSMGO', 'a pilot area takes the ECA fuel when it lies inside the ECA');
ok(/pilot area at departure/.test(pp[0].seaNote) && /pilot area at arrival/.test(pp[4].seaNote), 'and says what it is');
ok(pp[0].ecaNm === 10 && pp[2].ecaNm === null, 'the ECA distance of a pilot area counts');
const pa = CP.splitLegAtEca(Object.assign(JSON.parse(JSON.stringify(pLeg)), { distance: 5230 }), pRuns, zl, 'LSMGO', { pilotNm: 10, approachNm: 20 });
ok(pa.length === 5 && pa[0].distance === 30 && pa[4].distance === 30 && pa.reduce((a, l) => a + l.distance, 0) === 5230, 'an approach allowance (20 nm) belongs to the pilot lines: 10 + 20 nm each, total unchanged');
const noPilot = CP.splitLegAtEca(pLeg, pRuns, zl, 'LSMGO', { pilotNm: 0 });
ok(noPilot.length === 3, 'without the option the line splits at the ECA only');
ok(CP.splitLegAtEca(pLeg, [{ eca: false, nm: 5000, from: [1, 1], to: [2, 2] }], zl, 'LSMGO', { pilotNm: 10 }) === null, 'a route with no ECA is not split (pilot areas go with an ECA split)');
const tiny = CP.splitLegAtEca(Object.assign(JSON.parse(JSON.stringify(pLeg)), { distance: 40 }), [{ eca: true, zone: 'north_sea', nm: 10, from: [51, 3], to: [51, 2] }, { eca: false, nm: 30, from: [51, 2], to: [50, 0] }], zl, 'LSMGO', { pilotNm: 10 });
ok(tiny.reduce((a, l) => a + l.distance, 0) === 40 && tiny.every((l) => l.distance >= 1), 'a short route still adds up and has no empty line (pilot area limited to 40% of a stretch)');
const sp0 = CP.ensurePlan(Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { sea: {} }), vessel).sea;
ok(sp0.pilotSplit === true && sp0.pilotNm === 10, 'the pilot split is on by default, 10 nm');
/* ---- automatic split: the default compliant fuel and the option ---- */
ok(CP.defaultEcaFuel([{ id: 'HFO' }, { id: 'LSFO' }, { id: 'MDO/MGO' }, { id: 'LSMGO' }]) === 'LSMGO', 'the ECA lines default to LSMGO when the vessel has it');
ok(CP.defaultEcaFuel([{ id: 'HFO' }, { id: 'MGO' }]) === 'MGO', 'else to MDO/MGO (MGO counts as the same grade)');
ok(CP.defaultEcaFuel([{ id: 'Residual', family: 'residual' }, { id: 'Distillate', family: 'distillate' }]) === 'Distillate', 'else to any distillate of the vessel');
ok(CP.defaultEcaFuel([{ id: 'HFO' }, { id: 'LSFO' }]) === '' && CP.defaultEcaFuel([]) === '', 'with no distillate the fuel is left as it is');
const withLegs = (sea) => Object.assign(JSON.parse(JSON.stringify(CP.defaultPlan(vessel))), { sea });
ok(CP.ensurePlan(withLegs({}), vessel).sea.autoSplit === true && CP.ensurePlan(withLegs({ autoSplit: false }), vessel).sea.autoSplit === false, 'a line splits automatically unless the plan says otherwise, and the choice is kept');
const spl = CP.defaultPlan(vessel); spl.legs = parts; spl.legs[0].ecaNm = null;
ok(CP.routeSummary(spl).totalEca === parts[1].distance + parts[3].distance, 'the route total counts the distance inside the ECA');
ok(/Distance in ECA/.test(CP.routeCardsHtml(CP.routeSummary(spl))) && !/Distance in ECA/.test(CP.routeCardsHtml(CP.routeSummary(CP.defaultPlan(vessel)))), 'the ECA card appears only when there is ECA distance');
ok(/Of which in ECA/.test(CP.printBody(spl, vessel, {})), 'the printout shows the ECA distance');
const eb = CP.ensurePlan(JSON.parse(JSON.stringify(CP.finalize(Object.assign(CP.defaultPlan(vessel), { legs: [ecaLeg], sea: { avoid: [], areas: [], ecaOff: ['baltic'], ecaFuel: 'LSMGO' } })))), vessel);
ok(eb.legs[0].ecaNm === 2429 && eb.sea.ecaOff[0] === 'baltic' && eb.sea.ecaFuel === 'LSMGO', 'ECA distance and the ECA options survive saving');

/* ---- shortest route and the map on the printout are options kept with the plan ---- */
ok(CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)] }, vessel).sea.greatCircle === true && CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)] }, vessel).sea.printMap === true, 'both options are on by default');
const off = CP.ensurePlan(JSON.parse(JSON.stringify(CP.finalize(Object.assign(CP.defaultPlan(vessel), { sea: { avoid: [], areas: [], ecaOff: [], ecaFuel: '', printMap: false, greatCircle: false } })))), vessel);
ok(off.sea.greatCircle === false && off.sea.printMap === false, 'and an option that was switched off stays off');

/* ---- map: the route behind an automatic line is kept so the map can draw it again ---- */
const mapLeg = CP.emptyLeg(2); Object.assign(mapLeg, { from: 'A', to: 'B', fromPort: 7, toPort: 9, routeFrom: 7, routeTo: 9, distance: 3000, distAuto: true, speed: 12 });
ok(CP.ensurePlan(JSON.parse(JSON.stringify(CP.finalize(Object.assign(CP.defaultPlan(vessel), { legs: [mapLeg] })))), vessel).legs[0].routeFrom === 7, 'the ports behind an automatic route survive saving');
const typedLeg = JSON.parse(JSON.stringify(mapLeg)); typedLeg.distAuto = false;
ok(CP.ensurePlan(Object.assign(CP.defaultPlan(vessel), { legs: [typedLeg] }), vessel).legs[0].routeFrom === null, 'a distance typed by hand has no route to draw');
const mapParts = CP.splitLegAtEca(Object.assign(JSON.parse(JSON.stringify(mapLeg)), { ecaNm: 500 }), [{ eca: false, nm: 2500, from: [1, 1], to: [2, 2] }, { eca: true, zone: 'baltic', nm: 500, from: [2, 2], to: [3, 3] }], zl);
ok(mapParts.every((l) => l.routeFrom === 7 && l.routeTo === 9), 'the stretches of a split line still point to the whole route');

/* ---- approach allowance and ECA areas that take effect later ---- */
ok(CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)] }, vessel).sea.approachNm === 0 && CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)], sea: { approachNm: 12 } }, vessel).sea.approachNm === 12 && CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)], sea: { approachNm: 900 } }, vessel).sea.approachNm === 100, 'the approach allowance is off by default, saved, and limited to 100 nm');
ok(Array.isArray(CP.ensurePlan({ v: 2, legs: [CP.emptyLeg(2)], sea: { ecaOn: ['north_east_atlantic'] } }, vessel).sea.ecaOn), 'areas switched on before they take effect are kept with the plan');

/* ---- grade names written differently still match ---- */
ok(CP.normGrade('LS MGO') === 'LSMGO' && CP.normGrade('ulsmgo') === 'LSMGO' && CP.normGrade('LS-MGO') === 'LSMGO' && CP.normGrade('LSMGO') === 'LSMGO', 'LSMGO written in its usual ways is one grade');
ok(CP.normGrade('VLSFO') === 'LSFO' && CP.normGrade('HSFO') === 'HFO' && CP.normGrade('MGO') === 'MDO/MGO', 'fuel names stay mapped');
ok(CP.cleanFuels([{ id: 'HFO' }, { id: 'LSMGO' }, { id: 'MDO/MGO', active: false }]).map((f) => f.id).join() === 'HFO,LSMGO', 'an unused MDO/MGO tank is left out of the vessel fuel list when LSMGO covers distillates');


/* ---- speed and consumption profile ---- */
{
  const prof = CP.cleanProfile({ sea: { ballast: { full: { kn: 14.5, c: [38, 3] }, eco: { kn: 12, c: [27, 3] } }, laden: { full: { kn: 13, c: [40, 3] } } }, port: { ballast: { port: { c: [2, 1.5] }, anchorage: { c: [0, 1.2] } } } }, 2);
  ok(CP.profileHasData(prof) && !CP.profileHasData(CP.cleanProfile(null)), 'a profile with figures is recognised, an empty one is not');
  ok(CP.profileEntry(prof, 'ballast', 'safe') === null && CP.profileEntry(prof, 'ballast', 'full').kn === 14.5, 'a mode without figures is not offered');
  const leg = CP.emptyLeg(2); leg.mode = 'eco';
  ok(CP.applyMode(leg, prof, 'ballast') && leg.speed === 12 && leg.fuels[0].daily === 27 && leg.fuels[1].daily === 3, 'a line in a mode takes the speed and MT/day of the profile');
  ok(CP.applyMode(leg, prof, 'laden') === false && leg.speed === 12, 'a mode without figures for the condition leaves the line alone');
  const pl = CP.emptyLeg(2); pl.port = true; pl.mode = 'full';
  CP.applyMode(pl, prof, 'ballast'); ok(pl.mode === 'port' && pl.fuels[0].daily === 2, 'a sea mode on a port stay becomes Port');
  ok(CP.defaultMode(leg, CP.emptyLeg(2), prof, 'ballast') === 'eco' && CP.defaultMode(null, CP.emptyLeg(2), prof, 'ballast') === 'full', 'a new line starts in the mode of the line before, else full speed');
  const plan = CP.ensurePlan({ v: 2, legs: [Object.assign(CP.emptyLeg(2), { mode: 'full', distance: 290, from: 'A', to: 'B', fuels: [{ grade: 'HFO', daily: null }, { grade: 'LSMGO', daily: null }] })], extra: [{ cond: 'laden', legs: [Object.assign(CP.emptyLeg(2), { mode: 'full', distance: 130, from: 'B', to: 'C', fuels: [{ grade: 'HFO', daily: null }, { grade: 'LSMGO', daily: null }] })] }] }, vessel);
  CP.applyProfileToPlan(plan, prof, 'ballast');
  ok(plan.legs[0].speed === 14.5 && plan.extra[0].legs[0].speed === 13 && plan.extra[0].legs[0].fuels[0].daily === 40, 'each voyage leg uses its own loading condition');
}

/* ---- short-bunker status ---- */
{
  const mk = (rob, daily, days) => CP.ensurePlan({ v: 2, legs: [Object.assign(CP.emptyLeg(2), { from: 'A', to: 'B', distance: days * 240, speed: 10, fuels: [{ grade: 'HFO', daily }, { grade: '', daily: null }] })], stocks: { HFO: { label: 'HFO', currentRob: rob } } }, vessel);
  const st = (p) => CP.gradeStatus(CP.chain(p).sections[0].sums.HFO);
  ok(st(mk(200, 30, 2)).code === 'ok' && st(mk(62, 30, 2)).code === 'tight' && st(mk(40, 30, 2)).code === 'short', 'OK, tight (less than 5 % of the burn left) and short');
  ok(CP.gradeStatus(CP.chain(mk(null, 30, 2)).sections[0].sums.HFO).code === 'none', 'no ROB entered: no verdict');
  ok(CP.gradeStatus(CP.chain(mk(100, 30, 2)).sections[0].sums.HFO, 80).code === 'over', 'ROB plus stem above the tank capacity is flagged');
  const multi = CP.ensurePlan({ v: 2, legs: [Object.assign(CP.emptyLeg(2), { from: 'A', to: 'B', distance: 240, speed: 10, fuels: [{ grade: 'HFO', daily: 30 }, { grade: '', daily: null }] }), Object.assign(CP.emptyLeg(2), { from: 'B', to: 'C', distance: 240, speed: 10, fuels: [{ grade: 'HFO', daily: 30 }, { grade: '', daily: null }] })], stocks: { HFO: { label: 'HFO', currentRob: 40 } } }, vessel);
  const lb = CP.lastSafeBunker(multi, 'HFO');
  ok(lb && lb.index === 1 && lb.last === 'B' && Math.abs(lb.robAtLast - 10) < 1e-9, 'the last place to bunker is the port the line before ends in');
  ok(CP.lastSafeBunker(mk(500, 30, 2), 'HFO') === null, 'no warning when the ROB never reaches the reserve');
}

/* ---- export ---- */
{
  const p = CP.ensurePlan({ v: 2, voyageNo: '7', date: '2026-11-26', legs: [Object.assign(CP.emptyLeg(2), { from: 'Port, A', to: 'B', distance: 240, speed: 10, mode: 'eco', fuels: [{ grade: 'HFO', daily: 30 }, { grade: 'LSMGO', daily: 2 }] })], stocks: { HFO: { label: 'HFO', currentRob: 200 } } }, vessel);
  const csv = CP.planCsv(p, { vessel: 'MV X' }).replace(/^﻿/, '').split('\r\n');
  ok(csv[1] === 'Vessel,MV X' && csv.some((l) => l.startsWith('Leg 1,1,Sea,"Port, A",B')), 'the CSV quotes text that holds a comma and lists every line');
  ok(csv.some((l) => /^Leg 1,HFO,200\.000,/.test(l)), 'and a result row per fuel');
  const txt = CP.planText(p, { vessel: 'MV X' });
  ok(/Port, A → B 240 nm \(Eco speed\)/.test(txt) && /HFO: needs 30\.0 MT/.test(txt), 'the report text names the route, the mode and the fuel needed');
}

/* ---- scenarios, canals, risk areas, plan against actual ---- */
{
  const base = { v: 2, legs: [Object.assign(CP.emptyLeg(2), { from: 'A', to: 'B', distance: 240, speed: 10, canals: [], fuels: [{ grade: 'HFO', daily: 30 }, { grade: '', daily: null }] })] };
  const a = CP.ensurePlan(Object.assign({ prices: { HFO: 500 } }, JSON.parse(JSON.stringify(base))), vessel);
  const m = CP.scenMetrics(a);
  ok(Math.abs(m.total - 30) < 1e-9 && Math.abs(m.cost - 15000) < 1e-6 && m.dist === 240, 'a scenario comes to its fuel, its distance and its cost');
  const sc = CP.cleanScenarios([{ name: 'x', snap: Object.assign({ scenarios: [1] }, base) }, { name: 'bad' }]);
  ok(sc.length === 1 && !sc[0].snap.scenarios && sc[0].name === 'x', 'saved scenarios are cleaned: no nesting, nothing without a plan');
  ok(CP.cleanScenarios(new Array(12).fill({ snap: base })).length === 8, 'at most eight scenarios');
  const suez = JSON.parse(JSON.stringify(base)); suez.legs[0].distAuto = true; suez.legs[0].canals = ['suez']; suez.legs[0].distance = 240;
  const cp = CP.ensurePlan(Object.assign(suez, { canal: { suez: { hours: 16, fee: 250000 } } }), vessel);
  ok(CP.canalsUsed(cp).suez === 1 && CP.scenMetrics(cp).canalFees === 250000, 'canal dues are counted once per route');
  ok(CP.riskAreasOf([[12.5, 45], [12.5, 50]]).includes('gulf_aden') && !CP.riskAreasOf([[40, -40], [41, -30]]).length, 'a route through the Gulf of Aden is flagged, open Atlantic is not');
  ok(CP.remindersFor(['ice_baltic'], '2027-01-15').length === 1 && CP.remindersFor(['ice_baltic'], '2027-07-15').length === 0, 'winter ice only in the winter months');
  const pv = CP.planVsActual(CP.ensurePlan(Object.assign({ stocks: { HFO: { label: 'HFO', currentRob: 300 } } }, { v: 2, legs: [Object.assign(CP.emptyLeg(2), { from: 'A', to: 'B', distance: 2400, speed: 10, fuels: [{ grade: 'HFO', daily: 30 }, { grade: '', daily: null }] })] }), vessel),
    { to: '2026-11-03T12:00', dist: 500, fuel: { HFO: 70 }, rob: { HFO: 230 } }, '2026-11-01T12:00');
  ok(pv && Math.abs(pv.elapsedDays - 2) < 1e-9 && Math.abs(pv.dist.planned - 480) < 1e-6 && Math.abs(pv.dist.diff - 20) < 1e-6, 'plan against actual: two days of a 10-knot plan is 480 nm');
  ok(Math.abs(pv.rows[0].planned - 60) < 1e-6 && Math.abs(pv.rows[0].pct - 16.6667) < 0.01 && Math.abs(pv.rows[0].robPlanned - 240) < 1e-6, 'and 60 MT of fuel: the log is 17 % over');
  ok(CP.planVsActual(CP.defaultPlan(vessel), { to: '2026-11-03T12:00', dist: 1, fuel: {} }, '') === null, 'no departure, no comparison');
}

console.log(`consumption plan: ${pass} checks passed`);
