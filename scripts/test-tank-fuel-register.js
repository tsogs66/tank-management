/* Tank fuel register: blend on bunkering, estimate between soundings, empty-tank warnings. */
const R = require('../public/js/tank-fuel-register.js');
const Core = require('../public/js/bunkering-core.js');
let fails = 0, checks = 0;
const near = (l, a, b, e = 1e-6) => { checks++; const ok = a != null && Math.abs(a - b) <= e; console.log((ok ? '  ok   ' : '  FAIL ') + l + (ok ? '' : ` (${a} vs ${b})`)); if (!ok) fails++; };
const is = (l, a, b) => { checks++; const ok = JSON.stringify(a) === JSON.stringify(b); console.log((ok ? '  ok   ' : '  FAIL ') + l + (ok ? '' : ` (${JSON.stringify(a)} vs ${JSON.stringify(b)})`)); if (!ok) fails++; };

console.log('blend');
{
  const b = R.blend({ mt: 60, lcv: 40000, sulphur: 0.5, density: 0.98 }, { mt: 40, lcv: 41000, sulphur: 0.1, density: 0.85 });
  near('mass total', b.mt, 100);
  near('LCV by mass', b.lcv, 40400, 1);
  near('sulphur by mass', b.sulphur, 0.34, 1e-4);
  near('density by volume (not by mass)', b.density, 100 / (60 / 0.98 + 40 / 0.85), 1e-3);
  const e = R.blend({ mt: 0, lcv: null, sulphur: null, density: null }, { mt: 30, lcv: 40500, sulphur: 0.49, density: 0.99 });
  is('an empty tank takes the delivery as it is', [e.mt, e.lcv, e.sulphur, e.density], [30, 40500, 0.49, 0.99]);
  const u = R.blend({ mt: 50, lcv: null, sulphur: 0.5, density: 0.98 }, { mt: 50, lcv: 40000, sulphur: 0.1, density: 0.98 });
  is('an unknown old LCV stays unknown when it is half the tank', u.lcv, null);
  const small = R.blend({ mt: 1, lcv: null, sulphur: 0.5, density: 0.98 }, { mt: 99, lcv: 40000, sulphur: 0.1, density: 0.98 });
  is('an unknown heel of 1 % is ignored', small.lcv, 40000);
  is('LCV in MJ/kg is read as kJ/kg', R.lcvKjKg(40.5), 40500);
}

console.log('bunkering events');
const ev1 = { id: 'b1', ts: '2026-11-01T10:00:00Z', tanks: [
    { tankId: 'T2P', tankName: 'HFO 2P', grade: 'hfo', beforeMt: 0, afterMt: 300 },
    { tankId: 'T3P', tankName: 'HFO 3P', grade: 'hfo', beforeMt: 0, afterMt: 200 },
    { tankId: 'MGO1', tankName: 'MGO 1', grade: 'mdo', beforeMt: 40, afterMt: 100 }],
  bdns: [{ number: '111', grade: 'hfo', qty: 500, lcv: 40200, sulphur: 2.8, density: 0.985 },
         { number: '112', grade: 'mdo', qty: 60, lcv: 42700, sulphur: 0.09, density: 0.86 }] };
const reg1 = R.build([ev1]);
is('residual into an empty tank sticks to that BDN', [reg1.tanks.T2P.lcv, reg1.tanks.T2P.sulphur, reg1.tanks.T2P.bdns[0].numbers], [40200, 2.8, ['111']]);
is('two tanks from one BDN both carry it', reg1.tanks.T3P.lcv, 40200);
near('distillate into a part-full tank is blended (heel properties unknown, 40 of 100 MT → unknown LCV)', reg1.tanks.MGO1.lcv == null ? -1 : 0, -1);
const evKnown = { id: 'b0', ts: '2026-10-01T10:00:00Z', tanks: [{ tankId: 'MGO1', grade: 'mdo', beforeMt: 0, afterMt: 40 }],
  bdns: [{ number: '099', grade: 'mdo', qty: 40, lcv: 42500, sulphur: 0.05, density: 0.85 }] };
const reg2 = R.build([ev1, evKnown]);
near('with the earlier BDN known, the top-up is mass-weighted LCV', reg2.tanks.MGO1.lcv, (40 * 42500 + 60 * 42700) / 100, 1);
near('and sulphur', reg2.tanks.MGO1.sulphur, (40 * 0.05 + 60 * 0.09) / 100, 1e-4);
is('a blended tank lists both lots', reg2.tanks.MGO1.bdns.length, 2);
is('events in any order replay by time', R.build([evKnown, ev1]).tanks.MGO1.lcv, reg2.tanks.MGO1.lcv);
is('the same bunkering saved twice counts once', R.build([ev1, { ...ev1, savedAt: '2026-11-01T12:00:00Z' }]).history.length, 3);
const later = { id: 'b2', ts: '2026-11-10T10:00:00Z', tanks: [{ tankId: 'T2P', grade: 'hfo', beforeMt: 100, afterMt: 400 }],
  bdns: [{ number: '222', grade: 'hfo', qty: 300, lcv: 40800, sulphur: 0.45, density: 0.98 }] };
const reg3 = R.build([ev1, later]);
near('a later top-up of a used tank blends with the earlier BDN', reg3.tanks.T2P.lcv, (100 * 40200 + 300 * 40800) / 400, 1);
is('properties at a time before the second bunkering', R.propertiesAt(reg3, 'T2P', '2026-11-05T00:00:00Z').lcv, 40200);
is('properties after it', Math.round(R.propertiesAt(reg3, 'T2P', '2026-11-11T00:00:00Z').lcv), Math.round((100 * 40200 + 300 * 40800) / 400));
is('a tank with no bunkering yet has none', R.propertiesAt(reg3, 'T9', '2026-11-11T00:00:00Z'), null);
const nobdn = R.build([{ id: 'x', ts: '2026-11-01T00:00:00Z', tanks: [{ tankId: 'A', grade: 'lsmgo', beforeMt: 0, afterMt: 20 }], bdns: [] }]);
is('no matching delivery note leaves properties unknown and says so', [nobdn.tanks.A.lcv, nobdn.notes.length], [null, 1]);
const dup = R.combineBdns([{ number: 'a', qty: 100, lcv: 40000, sulphur: 0.4, density: 0.98 }, { number: 'b', qty: 300, lcv: 41000, sulphur: 0.2, density: 0.98 }]);
near('two notes of one grade combine by quantity', dup.lcv, 40750, 1);

console.log('estimate and warnings');
is('estimate = measured + loaded − burned', R.estimateRob({ measuredMt: 300, loadedSinceMt: 0, consumedSinceMt: 24 }).mt, 276);
is('a negative estimate is clamped and flagged', (({ mt, clamped }) => [mt, clamped])(R.estimateRob({ measuredMt: 10, consumedSinceMt: 25 })), [0, true]);
is('no base, no estimate', R.estimateRob({}).ok, false);
is('an estimate of zero is empty', R.tankStatus({ estMt: 0 }).level, 'empty');
is('less than this entry burns is empty', R.tankStatus({ estMt: 20, entryConsMt: 24 }).level, 'empty');
is('about a day left is low', R.tankStatus({ estMt: 20, entryConsMt: 5, burnMtPerDay: 24 }).level, 'low');
is('plenty is ok', R.tankStatus({ estMt: 200, entryConsMt: 24, burnMtPerDay: 24 }).level, 'ok');
is('no base is unknown', R.tankStatus({ estMt: null }).level, 'unknown');
is('a 5 MT drift on a 500 MT tank is within 2 %', R.drift(296, 291, 500).flag, false);
is('a 20 MT drift on a 500 MT tank is flagged', R.drift(296, 276, 500).flag, true);
console.log('from a vessel bundle');
{
  const form = { bunkeringId: 'bk1', loadsTs: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T11:00:00Z', supplier: 'S', bdnNumber: '111',
    bdn: { fuelType: 'hfo', quantityMT: 500, lcv: 40.2, sulphurPercent: 2.8, density15: 0.985 },
    bdn2: { fuelType: 'mdo', quantityMT: 60, lcv: 42700, sulphurPercent: 0.09, density15: 0.86, number: '112' },
    tankLoads: [{ tankId: 'A', grade: 'hfo', beforeMt: 0, afterMt: 300 }, { tankId: 'M', grade: 'mdo', beforeMt: 0, afterMt: 60 }] };
  const bundle = { bunkerSummary: form, bunkerHistory: { summaries: [{ form }, { form: { bdn: {} } }] } };
  const evs = R.eventsFromBundle(bundle);
  is('the saved summary and its history copy are the same bunkering', R.build(evs).history.length, 2);
  is('main BDN number comes from the summary, LCV in MJ/kg is converted', [R.build(evs).tanks.A.bdns[0].numbers, R.build(evs).tanks.A.lcv], [['111'], 40200]);
  is('second BDN supplies the distillate tank', R.build(evs).tanks.M.bdns[0].numbers, ['112']);
  is('a summary without tank loads is skipped', R.eventsFromBundle({ bunkerSummary: { bdn: {} } }).length, 0);
}
console.log('Tank Chief hooks');
{
  const after = { priorTank: { A: { mt: 100, grade: 'hfo' }, B: { mt: 50, grade: 'mdo' }, C: { mt: 20, grade: 'hfo' } },
    sections: [{ rows: [
      { tankId: 'A', name: 'HFO 2P', fuelType: 'hfo', actualMT: 400 },
      { tankId: 'B', name: 'MGO 1', fuelType: 'mdo', actualMT: 110 },
      { tankId: 'C', name: 'HFO 3P', fuelType: 'hfo', actualMT: 20 },
      { tankId: 'D', name: 'HFO 4P', fuelType: 'hfo', actualMT: null }] }] };
  const loads = Core.tankLoadsFromAfter(after);
  is('tanks that gained come first, an unsounded tank is left out', loads.map((l) => l.tankId), ['A', 'B', 'C']);
  is('before and after are carried', [loads[0].beforeMt, loads[0].afterMt], [100, 400]);
  const s = Core.normalizeSummary({}, { bdn: { fuelType: 'hfo', lcv: 40200 } });
  is('the summary keeps an LCV on the main BDN', s.bdn.lcv, 40200);
  is('a new summary has an empty LCV box', Core.emptySummary({}).bdn.lcv, '');
  const s2 = Core.normalizeSummary({}, { bdn: {}, bdn2: { fuelType: 'mdo' }, extraBdns: [{ fuelType: 'lsfo' }] });
  is('second and extra notes have an LCV box too', [s2.bdn2.lcv, s2.extraBdns[0].lcv], ['', '']);
}
console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
