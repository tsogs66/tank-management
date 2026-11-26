/* Consumption plan — one route table, a fuel per line.
 *
 * Shared by Tank Chief, Voyage Chief and ChEng AIO (one file, so the two programs cannot drift apart).
 *
 *  - The route (port or sea, From, To, distance, speed, days) is typed once, not once per fuel.
 *  - Every line carries one or more fuels: a grade picked from the vessel's own fuels, and its MT per day.
 *    The fuel list comes from the host (the grades of the vessel's tanks); with none, Residual and Distillate.
 *  - Sea days = distance / (speed x 24); quantity = MT per day x the exact days; margin % is per line.
 *  - Stock (ROB, to receive, unpumpable, weather reserve, delivery ROB) is kept per grade, with the stem advice.
 *  - Plans saved by the earlier two-block layout are read and converted. The plan is also saved in that older
 *    two-block shape beside the new one, so a device that has not been updated yet still shows something sensible.
 *
 *  - Voyage legs are consecutive: the plan is leg 1, and `plan.extra` holds the following legs. Each leg has its own route and
 *    stock inputs; its Current ROB is the previous leg's Next Departure ROB. A side-by-side table shows every leg and the combined total.
 *
 * The calculation is plain functions (testable in Node). `mount()` draws the page into a host element.
 */
(function (root, factory) {
  'use strict';
  const StemAdvice = (typeof module === 'object' && module.exports) ? require('./stem-advice.js') : root.StemAdvice;
  const api = factory(StemAdvice);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConsumptionPlan = api;
})(typeof window !== 'undefined' ? window : globalThis, function (StemAdvice) {
  'use strict';

  const MAX_SLOTS = 4;
  const MAX_LEGS = 6;
  const FALLBACK_FUELS = [{ id: 'Residual', family: 'residual' }, { id: 'Distillate', family: 'distillate' }];

  /* ------------------------------------------------------------------ grades ---- */
  /** Same fuel under different names (VLSFO / LSFO, MGO / MDO/MGO) is one grade. */
  function normGrade(g) {
    const u = String(g == null ? '' : g).trim().toUpperCase();
    const c = u.replace(/[\s_-]+/g, '');
    return ({ VLSFO: 'LSFO', ULSFO: 'LSFO', LSHFO: 'LSFO', LSIFO: 'LSFO', HSFO: 'HFO', 'MO/MGO': 'MDO/MGO', MDO: 'MDO/MGO', MGO: 'MDO/MGO', ULSMGO: 'LSMGO', LSMDO: 'LSMGO' })[c] || ({ LSMGO: 'LSMGO', LSFO: 'LSFO', HFO: 'HFO' })[c] || u;
  }
  /** Residual or distillate: only used to keep the older two-block shape and for the Residual / Distillate fallback. */
  function familyOf(g) {
    return /MGO|MDO|GAS ?OIL|DISTIL|DMA|DMB|DMZ/i.test(String(g || '')) ? 'distillate' : 'residual';
  }
  /** The fuels a plan offers. A host may mark a grade `active: false` (a tank that holds none and was never burned, such as the default MDO/MGO tank on a ship that
   *  runs on LSMGO): it is left out, unless that would leave a kind of fuel (residual / distillate) with nothing to pick. */
  function cleanFuels(list) {
    const out = []; const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((f) => {
      const id = String((f && (f.id != null ? f.id : f.label)) || '').trim();
      if (!id || seen.has(normGrade(id))) return;
      seen.add(normGrade(id));
      out.push({ id, family: (f && f.family) || familyOf(id), active: !(f && f.active === false) });
    });
    const kept = out.filter((f) => f.active || !out.some((g) => g.family === f.family && g.active));
    return kept.length ? kept.map((f) => ({ id: f.id, family: f.family })) : FALLBACK_FUELS.slice();
  }

  /* ------------------------------------------------------------------ plan ---- */
  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  function emptyFuel() { return { grade: '', daily: null }; }
  function emptyLeg(slots) {
    const fuels = [];
    for (let i = 0; i < (slots || 2); i++) fuels.push(emptyFuel());
    return { port: false, from: '', to: '', fromPort: null, toPort: null, distance: null, distAuto: false, seaNote: '', ecaNm: null, ecaZones: '', ecaRuns: null, routeFrom: null, routeTo: null, grp: null, keepWhole: false, speed: null, days: null, daysManual: false, marginPct: null, fuels };
  }
  function legIsBlank(leg) {
    if (!leg) return true;
    return !leg.port && !String(leg.from || '').trim() && !String(leg.to || '').trim()
      && leg.distance == null && leg.speed == null && leg.days == null
      && !(leg.fuels || []).some((f) => num(f.daily) != null);
  }
  function defaultPlan(fuels) {
    const plan = { v: 2, voyageNo: '', date: '', remarks: '', fuelSlots: 2, legs: [], stocks: {} };
    plan.legs = [newLeg(plan, fuels)];
    return plan;
  }
  /** A fresh line: its fuels start as the previous line's (so a voyage on one set of fuels needs no re-picking), else the defaults. */
  function newLeg(plan, fuels) {
    const slots = plan.fuelSlots || 2;
    const leg = emptyLeg(slots);
    const prev = (plan.legs || []).slice().reverse().find((l) => (l.fuels || []).some((f) => f.grade));
    const list = cleanFuels(fuels);
    const resid = list.find((f) => f.family === 'residual');
    const dist = list.find((f) => f.family === 'distillate');
    const defaults = [resid || list[0], dist && dist !== (resid || list[0]) ? dist : list[1]].filter(Boolean);
    for (let i = 0; i < slots; i++) {
      leg.fuels[i].grade = prev && prev.fuels[i] && prev.fuels[i].grade ? prev.fuels[i].grade : (defaults[i] ? defaults[i].id : '');
    }
    return leg;
  }

  function legDays(leg) {
    const typed = leg.days != null && leg.days !== '' && !isNaN(leg.days);
    if (leg.port) return typed ? Number(leg.days) : null;
    /* A sea leg's days follow distance and speed (and are nothing when either is cleared); only days typed by hand are kept. */
    if (leg.daysManual && typed) return Number(leg.days);
    const d = Number(leg.distance); const s = Number(leg.speed);
    if (d > 0 && s > 0) return d / (s * 24);
    if (leg.daysManual === undefined && typed) return Number(leg.days);
    return null;
  }
  /** Quantity of one fuel on one line: MT per day x the exact days. */
  function fuelQty(leg, fuel) {
    const daily = Number(fuel && fuel.daily);
    if (!fuel || fuel.daily == null || fuel.daily === '' || isNaN(daily) || !(daily >= 0)) return null;
    const days = legDays(leg);
    if (days != null && days > 0) return daily * days;
    /* No distance, speed or days on a line with its From and To filled in: the figure entered is that line's quantity. */
    const noRun = !(Number(leg.distance) > 0) && !(Number(leg.speed) > 0) && !(Number(leg.days) > 0);
    if (noRun && String(leg.from || '').trim() && String(leg.to || '').trim()) return daily;
    return days == null ? null : daily * days;
  }
  function fuelMargin(leg, fuel) {
    const qty = fuelQty(leg, fuel);
    const mp = Number(leg.marginPct);
    if (qty == null || leg.marginPct == null || leg.marginPct === '' || isNaN(mp)) return null;
    return qty * (mp / 100);
  }

  /** Days and distance: shared by every fuel, worked out once. */
  function routeSummary(plan) {
    let daysPort = 0; let daysSea = 0; let totalDist = 0; let totalEca = 0;
    (plan.legs || []).forEach((leg) => {
      const days = legDays(leg);
      const dist = Number(leg.distance);
      if (dist > 0) totalDist += dist;
      if (!leg.port && Number(leg.ecaNm) > 0) totalEca += Number(leg.ecaNm);
      if (days != null) { if (leg.port) daysPort += days; else daysSea += days; }
    });
    return { daysPort, daysSea, totalDist, totalEca };
  }

  function stockOf(plan, grade) {
    const s = (plan.stocks || {})[normGrade(grade)];
    return s || {};
  }
  /** Leg 1 is the plan itself; the legs after it are in plan.extra. Each has { legs, stocks, legTitle }. */
  function sectionList(plan) { return [plan].concat(Array.isArray(plan.extra) ? plan.extra : []); }
  /** The grades in use on the plan (every voyage leg), in the order they first appear. */
  function gradesInUse(plan) {
    const out = []; const seen = new Set();
    const add = (g) => { const k = normGrade(g); if (k && !seen.has(k)) { seen.add(k); out.push(g); } };
    sectionList(plan).forEach((sec) => (sec.legs || []).forEach((leg) => (leg.fuels || []).forEach((f) => { if (f.grade && num(f.daily) != null) add(f.grade); })));
    sectionList(plan).forEach((sec) => Object.keys(sec.stocks || {}).forEach((k) => {
      const st = sec.stocks[k] || {};
      if (['currentRob', 'qtyReceive', 'deliveryRob', 'unpumpableMt', 'weatherMarginMt'].some((f) => num(st[f]) != null)) add(st.label || k);
    }));
    return out;
  }

  /** One grade across the whole plan: what it burns, what it needs, what is left. Same formulas as the earlier two-block plan. */
  function gradeSummary(plan, grade) {
    const want = normGrade(grade);
    let totalCons = 0; let margin = 0;
    (plan.legs || []).forEach((leg) => {
      (leg.fuels || []).forEach((f) => {
        if (normGrade(f.grade) !== want) return;
        const q = fuelQty(leg, f);
        if (q == null) return;
        totalCons += q;
        const m = fuelMargin(leg, f);
        if (m != null) margin += m;
      });
    });
    const st = stockOf(plan, grade);
    const required = totalCons + margin;
    const rob = num(st.currentRob);
    const receive = num(st.qtyReceive) || 0;
    const delivery = num(st.deliveryRob);
    const arrivalRob = rob == null ? null : rob - required;
    const nextDepRob = arrivalRob == null ? null : arrivalRob + receive;
    const stemAdvice = StemAdvice && StemAdvice.advise ? StemAdvice.advise(st, { required, rob, receive }) : null;
    const stem = stemAdvice && stemAdvice.stemStill != null ? stemAdvice.stemStill : (rob == null ? null : Math.max(0, required - rob - receive));
    return {
      grade, totalCons, margin, required, rob, receive, delivery, arrivalRob, nextDepRob, stem, stemAdvice,
      excessMargin: (delivery == null || nextDepRob == null) ? null : nextDepRob - delivery,
      excessActual: (delivery == null || rob == null) ? null : ((rob + receive) - totalCons) - delivery,
    };
  }

  /** Every voyage leg worked out in turn. A later leg starts with the ROB the previous leg ends with (Next Departure ROB). */
  function chain(plan) {
    const grades = gradesInUse(plan);
    const sections = []; let prev = null;
    sectionList(plan).forEach((sec, i) => {
      let eff = sec;
      if (i > 0) {
        const stocks = JSON.parse(JSON.stringify(sec.stocks || {}));
        grades.forEach((g) => {
          const k = normGrade(g);
          const st = stocks[k] || (stocks[k] = { label: g });
          const p = prev.sums[k];
          st.currentRob = p && p.nextDepRob != null ? p.nextDepRob : null;
        });
        eff = { legs: sec.legs, stocks };
      }
      const sums = {};
      grades.forEach((g) => { sums[normGrade(g)] = gradeSummary(eff, g); });
      prev = { sec, route: routeSummary(sec), sums };
      sections.push(prev);
    });
    return { grades, sections };
  }
  /** All the legs together: days, distance, what each grade burns and needs, and where it ends. */
  function combined(plan) {
    const c = chain(plan);
    const secs = c.sections;
    const route = secs.reduce((a, s) => ({ daysPort: a.daysPort + s.route.daysPort, daysSea: a.daysSea + s.route.daysSea, totalDist: a.totalDist + s.route.totalDist, totalEca: a.totalEca + (s.route.totalEca || 0) }), { daysPort: 0, daysSea: 0, totalDist: 0, totalEca: 0 });
    const grades = c.grades.map((g) => {
      const k = normGrade(g);
      let totalCons = 0; let margin = 0; let required = 0; let receive = 0;
      secs.forEach((s) => { const u = s.sums[k]; totalCons += u.totalCons; margin += u.margin; required += u.required; receive += u.receive; });
      const first = secs[0].sums[k]; const last = secs[secs.length - 1].sums[k];
      return { grade: g, totalCons, margin, required, receive, startRob: first.rob, arrivalRob: last.arrivalRob, nextDepRob: last.nextDepRob, stem: last.stem };
    });
    return { route, grades, chain: c };
  }
  /** Fill the empty MT/day boxes from what the ship really burned. stats: { grade: { sea, port } } in MT per day.
   *  Sea lines get the sea figure, port and anchorage lines the port figure. A box that already has a figure is never changed.
   *  A fuel only gets figures when the grade is picked on the line, so nothing is added that was not chosen. Returns how many were filled. */
  function suggestDaily(plan, stats) {
    const by = {};
    Object.keys(stats || {}).forEach((g) => { by[normGrade(g)] = stats[g]; });
    let filled = 0;
    sectionList(plan).forEach((sec) => (sec.legs || []).forEach((leg) => (leg.fuels || []).forEach((f) => {
      if (!f.grade || num(f.daily) != null) return;
      const st = by[normGrade(f.grade)];
      const v = st ? (leg.port ? st.port : st.sea) : null;
      if (v != null && isFinite(v) && v > 0) { f.daily = Math.round(v * 100) / 100; filled++; }
    })));
    return filled;
  }
  function secTitle(sec, i) { return 'Leg ' + (i + 1) + (sec && String(sec.legTitle || '').trim() ? ': ' + String(sec.legTitle).trim() : ''); }
  /** A following voyage leg: one blank line on the fuels the last line used. */
  function newSection(plan, fuels) {
    const secs = sectionList(plan);
    const last = secs[secs.length - 1];
    return { legTitle: '', legs: [newLeg({ fuelSlots: plan.fuelSlots || 2, legs: last.legs }, fuels)], stocks: {} };
  }

  /* ------------------------------------------------- the earlier two-block shape ---- */
  const LEGACY = {
    residual: { grade: 'HFO' },
    distillate: { grade: 'MDO/MGO' },
  };
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return h;
  }
  function legacyLegs(side) {
    return Array.isArray(side && side.legs) ? side.legs : [];
  }
  /** Convert a plan saved as { residual:{grade,legs,..}, distillate:{..} } into one route table with two fuels per line. */
  function fromLegacy(raw, fuels) {
    const plan = defaultPlan(fuels);
    plan.legs = [];
    ['voyageNo', 'date', 'remarks', 'saveName', 'savedAt'].forEach((k) => { if (raw[k] != null) plan[k] = raw[k]; });
    const resSide = raw.residual || {};
    const disSide = raw.distillate || {};
    const resGrade = resSide.grade || LEGACY.residual.grade;
    const disGrade = disSide.grade || LEGACY.distillate.grade;
    const key = (l) => [l.port ? 1 : 0, String(l.from || '').trim().toLowerCase(), String(l.to || '').trim().toLowerCase(), l.distance == null ? '' : Number(l.distance), l.speed == null ? '' : Number(l.speed)].join('|');
    const mk = (l, grade0, daily0, grade1, daily1) => {
      const leg = emptyLeg(2);
      leg.port = !!l.port; leg.from = l.from || ''; leg.to = l.to || '';
      leg.distance = l.distance ?? null; leg.speed = l.speed ?? null; leg.days = l.days ?? null;
      leg.daysManual = l.daysManual === undefined ? (l.days != null) : !!l.daysManual;
      leg.marginPct = (l.marginPct == null || l.marginPct === '' || isNaN(Number(l.marginPct))) ? null : Number(l.marginPct);
      leg.fuels[0] = { grade: grade0, daily: daily0 ?? null };
      leg.fuels[1] = { grade: grade1, daily: daily1 ?? null };
      return leg;
    };
    const dLegs = legacyLegs(disSide).filter((l) => !legIsBlank(Object.assign({ fuels: [] }, l, { fuels: l.dailyCons != null ? [{ daily: l.dailyCons }] : [] })));
    const dUsed = new Set();
    legacyLegs(resSide).forEach((l, i) => {
      const k = key(l);
      let j = dLegs.findIndex((d, n) => !dUsed.has(n) && key(d) === k);
      /* lines with no route typed at all (only figures) pair up by position; lines with a route pair only by that route */
      const routeless = (x) => !String(x.from || '').trim() && !String(x.to || '').trim() && x.distance == null && x.speed == null && !x.port;
      if (j < 0 && routeless(l) && dLegs[i] && routeless(dLegs[i]) && !dUsed.has(i)) j = i;
      const d = j >= 0 ? dLegs[j] : null;
      if (j >= 0) dUsed.add(j);
      plan.legs.push(mk(l, resGrade, l.dailyCons, disGrade, d ? d.dailyCons : null));
    });
    dLegs.forEach((d, n) => { if (!dUsed.has(n)) plan.legs.push(mk(d, resGrade, null, disGrade, d.dailyCons)); });
    if (!plan.legs.length) plan.legs = [newLeg(plan, fuels)];
    [[resGrade, resSide], [disGrade, disSide]].forEach(([g, s]) => {
      const st = {};
      ['currentRob', 'qtyReceive', 'deliveryRob', 'unpumpableMt', 'weatherMarginMt'].forEach((f) => { if (s[f] != null && s[f] !== '') st[f] = s[f]; });
      if (Object.keys(st).length) { st.label = g; plan.stocks[normGrade(g)] = st; }
    });
    return plan;
  }
  /** The plan in the earlier two-block shape: each line's daily figures summed per family (for devices not yet updated). */
  function toLegacy(plan) {
    const out = {};
    ['residual', 'distillate'].forEach((fam) => {
      const grades = {};
      const legs = (plan.legs || []).map((l) => {
        let daily = null;
        (l.fuels || []).forEach((f) => {
          if (!f.grade || num(f.daily) == null || familyOf(f.grade) !== fam) return;
          daily = (daily || 0) + Number(f.daily);
          grades[f.grade] = (grades[f.grade] || 0) + 1;
        });
        return { port: !!l.port, from: l.from || '', to: l.to || '', distance: l.distance ?? null, speed: l.speed ?? null,
          dailyCons: daily, days: l.days ?? null, daysManual: !!l.daysManual, marginPct: l.marginPct ?? null };
      });
      const top = Object.keys(grades).sort((a, b) => grades[b] - grades[a])[0] || LEGACY[fam].grade;
      const st = stockOf(plan, top);
      out[fam] = Object.assign({ grade: top, legs }, ['currentRob', 'qtyReceive', 'deliveryRob', 'unpumpableMt', 'weatherMarginMt']
        .reduce((o, f) => { o[f] = st[f] ?? null; return o; }, {}));
    });
    return out;
  }
  function legacySig(plan) {
    const l = toLegacy(plan);
    return hash(JSON.stringify([l.residual, l.distillate]));
  }

  function normalizeSection(sec, slots) {
    sec.legs = (Array.isArray(sec.legs) ? sec.legs : []).map((l) => {
      const leg = Object.assign(emptyLeg(slots), l);
      leg.port = !!leg.port;
      leg.from = leg.from || ''; leg.to = leg.to || '';
      leg.fromPort = Number(leg.fromPort) > 0 ? Number(leg.fromPort) : null; leg.toPort = Number(leg.toPort) > 0 ? Number(leg.toPort) : null;
      leg.distAuto = !!leg.distAuto && leg.distance != null; leg.seaNote = leg.distAuto ? String(leg.seaNote || '') : '';
      leg.routeFrom = leg.distAuto && Number(leg.routeFrom) > 0 ? Number(leg.routeFrom) : null; leg.routeTo = leg.distAuto && Number(leg.routeTo) > 0 ? Number(leg.routeTo) : null;
      leg.ecaNm = leg.distAuto && Number(leg.ecaNm) > 0 ? Number(leg.ecaNm) : null; leg.ecaZones = leg.ecaNm ? String(leg.ecaZones || '') : '';
      leg.ecaRuns = leg.distAuto && Array.isArray(leg.ecaRuns) ? leg.ecaRuns.slice(0, 12).map((r) => ({ eca: !!r.eca, zone: r.zone || null, nm: Number(r.nm) || 0, from: r.from || null, to: r.to || null })) : null;
      /* the route a split line came from, kept whatever is typed on the line, so Recalculate can rebuild the whole route */
      leg.grp = (leg.grp && leg.grp.id && Number(leg.grp.fromPort) > 0 && Number(leg.grp.toPort) > 0) ? { id: String(leg.grp.id), fromPort: Number(leg.grp.fromPort), toPort: Number(leg.grp.toPort), from: String(leg.grp.from || ''), to: String(leg.grp.to || '') } : null;
      leg.keepWhole = !!leg.keepWhole;
      leg.marginPct = (leg.marginPct == null || leg.marginPct === '' || isNaN(Number(leg.marginPct))) ? null : Number(leg.marginPct);
      const f = Array.isArray(leg.fuels) ? leg.fuels.map((x) => ({ grade: (x && x.grade) || '', daily: x && x.daily != null && x.daily !== '' ? Number(x.daily) : null })) : [];
      while (f.length < slots) f.push(emptyFuel());
      leg.fuels = f;
      return leg;
    });
    /* one trailing blank line is kept so "Add destination / stay" has a place to start; stray blanks are dropped */
    while (sec.legs.length > 1 && legIsBlank(sec.legs[sec.legs.length - 1]) && legIsBlank(sec.legs[sec.legs.length - 2])) sec.legs.pop();
    return sec;
  }
  function normalizeLegs(plan) {
    const slots = Math.max(1, Math.min(MAX_SLOTS, Number(plan.fuelSlots) || 2));
    plan.fuelSlots = slots;
    normalizeSection(plan, slots);
    const extra = (Array.isArray(plan.extra) ? plan.extra : []).slice(0, MAX_LEGS - 1).map((x) => {
      const sec = { legTitle: (x && x.legTitle) || '', legs: x && x.legs, stocks: x && x.stocks && typeof x.stocks === 'object' ? x.stocks : {} };
      normalizeSection(sec, slots);
      if (!sec.legs.length) sec.legs = [emptyLeg(slots)];
      return sec;
    });
    if (extra.length) plan.extra = extra; else delete plan.extra;
    return plan;
  }

  /** Any saved plan -> a current plan. Reads the new shape; converts the earlier one; and if a device that has not been updated
   *  changed the earlier shape since this plan was last saved, that newer edit wins. */
  function ensurePlan(raw, fuels) {
    let plan;
    if (!raw || typeof raw !== 'object') plan = defaultPlan(fuels);
    else if (raw.v === 2 && Array.isArray(raw.legs)) {
      plan = JSON.parse(JSON.stringify(raw));
      if (raw.legacySig != null && (raw.residual || raw.distillate) && hash(JSON.stringify([raw.residual, raw.distillate])) !== raw.legacySig) {
        const re = fromLegacy(raw, fuels);
        re.fuelSlots = Math.max(2, plan.fuelSlots || 2);
        if (plan.extra) re.extra = plan.extra;
        if (plan.legTitle) re.legTitle = plan.legTitle;
        plan = re;
      }
    } else if (raw.residual || raw.distillate) plan = fromLegacy(raw, fuels);
    else plan = defaultPlan(fuels);
    plan.v = 2;
    if (typeof plan.remarks !== 'string') plan.remarks = plan.remarks == null ? '' : String(plan.remarks);
    if (!plan.stocks || typeof plan.stocks !== 'object') plan.stocks = {};
    const sea = plan.sea && typeof plan.sea === 'object' ? plan.sea : {};
    function cleanManual(m) {
      const out = {}; if (!m || typeof m !== 'object') return out;
      Object.keys(m).slice(0, 40).forEach((k) => { const w = Array.isArray(m[k]) ? m[k].filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).slice(0, 200).map((p) => [Math.max(-85, Math.min(85, Number(p[0]))), Number(p[1])]) : []; if (w.length) out[String(k)] = w; });
      return out;
    }
    plan.sea = { avoid: Array.isArray(sea.avoid) ? sea.avoid.map(String) : [], areas: Array.isArray(sea.areas) ? sea.areas.map(String) : [], ecaOff: Array.isArray(sea.ecaOff) ? sea.ecaOff.map(String) : [], ecaOn: Array.isArray(sea.ecaOn) ? sea.ecaOn.map(String) : [], ecaFuel: typeof sea.ecaFuel === 'string' ? sea.ecaFuel : '', printMap: sea.printMap !== false, greatCircle: sea.greatCircle !== false, autoSplit: sea.autoSplit !== false, minEca: !!sea.minEca, minEcaPct: Number(sea.minEcaPct) > 0 ? Math.min(50, Number(sea.minEcaPct)) : 10, pilotSplit: sea.pilotSplit !== false, pilotNm: Number(sea.pilotNm) > 0 ? Math.min(50, Number(sea.pilotNm)) : 10, approachNm: Number(sea.approachNm) > 0 ? Math.min(100, Number(sea.approachNm)) : 0, manual: cleanManual(sea.manual) };
    normalizeLegs(plan);
    delete plan.residual; delete plan.distillate; delete plan.legacySig;
    return plan;
  }
  /** Before saving: the plan plus its earlier-shape twin. */
  function finalize(plan) {
    const out = JSON.parse(JSON.stringify(plan));
    const l = toLegacy(out);
    out.residual = l.residual; out.distillate = l.distillate;
    out.legacySig = hash(JSON.stringify([l.residual, l.distillate]));
    return out;
  }

  /* ------------------------------------------------------------------ display ---- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtN(v, d) { return v == null || v === '' || isNaN(v) ? '—' : Number(v).toFixed(d == null ? 2 : d); }
  function fmtFuel(v) { return fmtN(v, 3); }
  /** The Days box: days worked out from distance and speed show to two decimals; days typed by hand and port stays show as typed. */
  function daysShown(leg, days) {
    if (days == null) return '';
    const worked = !leg.port && !(leg.daysManual && leg.days != null) && Number(leg.distance) > 0 && Number(leg.speed) > 0;
    return worked ? Math.round(days * 100) / 100 : days;
  }
  function stemText(grade, sum) {
    return StemAdvice && StemAdvice.sentence ? StemAdvice.sentence(grade, sum.stemAdvice, fmtFuel) : '';
  }
  function resultCard(title, value, unit, raw) {
    const blank = value == null || value === '';
    const neg = typeof raw === 'number' && isFinite(raw) && raw < 0 ? ' bp-result-neg' : '';
    const unitHtml = blank || !unit ? '' : `<span class="bp-result-unit">${unit}</span>`;
    return `<div class="bp-result${neg}"><div class="bp-result-value"><b>${blank ? '—' : value}</b>${unitHtml}</div><div class="bp-result-title">${title}</div></div>`;
  }
  function routeCardsHtml(route) {
    return [
      resultCard('Days at Port / Anchor', fmtN(route.daysPort, 2), 'days'),
      resultCard('Days at Sea', fmtN(route.daysSea, 2), 'days'),
      resultCard('Total Distance', fmtN(route.totalDist, 0), 'NM'),
    ].concat(route.totalEca > 0 ? [resultCard('Distance in ECA', fmtN(route.totalEca, 0), 'NM')] : []).join('');
  }
  function gradeCardsHtml(sum) {
    return [
      resultCard('Total Consumption', fmtFuel(sum.totalCons), 'MT'),
      resultCard('Total Margin', fmtFuel(sum.margin), 'MT'),
      resultCard('Required Quantity', fmtFuel(sum.required), 'MT'),
      resultCard('Arrival ROB', sum.arrivalRob == null ? '' : fmtFuel(sum.arrivalRob), 'MT', sum.arrivalRob),
      resultCard('Next Departure ROB', sum.nextDepRob == null ? '' : fmtFuel(sum.nextDepRob), 'MT', sum.nextDepRob),
      resultCard('Stem still needed', sum.stem == null ? '' : fmtFuel(sum.stem), 'MT'),
      resultCard('Excess (Margin) Quantity', sum.excessMargin == null ? '' : fmtFuel(sum.excessMargin), 'MT', sum.excessMargin),
      resultCard('Excess (Actual) Quantity', sum.excessActual == null ? '' : fmtFuel(sum.excessActual), 'MT', sum.excessActual),
    ].join('');
  }

  /** Every leg side by side, with the combined figures: the plan at a glance. Nothing when there is only one leg. */
  function overviewHtml(plan) {
    const cm = combined(plan); const secs = cm.chain.sections;
    if (secs.length < 2) return '';
    const th = secs.map((x, i) => `<th>Leg ${i + 1}${String(x.sec.legTitle || '').trim() ? `<span class="cp-title">${esc(String(x.sec.legTitle).trim())}</span>` : ''}</th>`).join('') + '<th class="cp-comb">Combined</th>';
    const row = (label, vals, comb, d, neg) => `<tr><th scope="row">${label}</th>`
      + vals.map((v) => `<td class="${neg && v != null && v < 0 ? 'cp-neg' : ''}">${fmtN(v, d)}</td>`).join('')
      + `<td class="cp-comb ${neg && comb != null && comb < 0 ? 'cp-neg' : ''}">${fmtN(comb, d)}</td></tr>`;
    let h = `<tr><th scope="col"></th>${th}</tr>`;
    h = `<thead>${h}</thead><tbody>`;
    h += row('Days at port / anchor', secs.map((x) => x.route.daysPort), cm.route.daysPort, 2);
    h += row('Days at sea', secs.map((x) => x.route.daysSea), cm.route.daysSea, 2);
    h += row('Distance (NM)', secs.map((x) => x.route.totalDist), cm.route.totalDist, 0);
    if (cm.route.totalEca > 0) h += row('of which in ECA (NM)', secs.map((x) => x.route.totalEca || 0), cm.route.totalEca, 0);
    cm.grades.forEach((g) => {
      const k = normGrade(g.grade);
      const col = (f) => secs.map((x) => x.sums[k][f]);
      h += `<tr class="cp-grade-row"><th colspan="${secs.length + 2}">${esc(g.grade)} (MT)</th></tr>`;
      h += row('Starting ROB', col('rob'), g.startRob, 3, true);
      h += row('Total consumption', col('totalCons'), g.totalCons, 3);
      h += row('Total margin', col('margin'), g.margin, 3);
      h += row('Required quantity', col('required'), g.required, 3);
      h += row('To receive', col('receive'), g.receive, 3);
      h += row('Arrival ROB', col('arrivalRob'), g.arrivalRob, 3, true);
      h += row('Next departure ROB', col('nextDepRob'), g.nextDepRob, 3, true);
      h += row('Stem still needed', col('stem'), g.stem, 3);
    });
    return `<div class="table-scroll cp-overview" role="region" aria-label="Voyage legs side by side"><table>${h}</tbody></table></div>`;
  }

  /* ------------------------------------------------------------------ sea distance (optional) ---- */
  function posText(p) {
    if (!p) return '';
    return Math.abs(p[0]).toFixed(1) + (p[0] >= 0 ? 'N' : 'S') + ' ' + Math.abs(p[1]).toFixed(1) + (p[1] >= 0 ? 'E' : 'W');
  }
  /** The compliant fuel an ECA line takes when the user has not named one: LSMGO, else MDO/MGO, else any distillate of the vessel's own fuels; '' when there is none. */
  function defaultEcaFuel(fuels) {
    const list = Array.isArray(fuels) ? fuels : [];
    const by = (pred) => list.find(pred);
    const hit = by((f) => normGrade(f.id) === 'LSMGO') || by((f) => normGrade(f.id) === 'MDO/MGO') || by((f) => f.family === 'distillate');
    return hit ? hit.id : '';
  }

  /** Split a line whose route enters or leaves an ECA into one line per stretch (outside / inside), each with its own distance.
   *  runs: [{ eca, zone, nm, from:[lat,lon], to:[lat,lon] }] in order; zoneLabel(id) names a zone; ecaGrade (optional) replaces Fuel 1 on the ECA stretches.
   *  The distances add up to the original line's distance. Returns the new lines, or null when there is nothing to split. */
  function splitLegAtEca(leg, runs, zoneLabel, ecaGrade, opts) {
    if (!leg || !Array.isArray(runs) || runs.length < 2) return null;
    /* neighbouring ECA stretches (for example North Sea then Baltic) are one stretch for the fuel */
    const merged = [];
    runs.forEach((r) => {
      const last = merged[merged.length - 1];
      if (last && last.eca && r.eca) { last.nm += Number(r.nm) || 0; last.to = r.to; if (r.zone && !last.zones.includes(r.zone)) last.zones.push(r.zone); }
      else merged.push({ eca: !!r.eca, zone: r.zone, zones: r.zone ? [r.zone] : [], nm: Number(r.nm) || 0, from: r.from, to: r.to });
    });
    runs = merged;
    if (runs.length < 2) return null;
    /* Pilot areas: the first and last pilotNm of the route become their own lines (port to the pilot drop-off point, pilot pick-up point to port):
       slow manoeuvring water with its own MT/day, inside or outside the ECA like the stretch next to it. The length is taken out of the stretch beside it,
       so the lines still add up to the distance of the line; the approach allowance (if any) belongs to these lines. */
    const pilotNm = opts && Number(opts.pilotNm) > 0 ? Number(opts.pilotNm) : 0;
    const appr = opts && Number(opts.approachNm) > 0 ? Number(opts.approachNm) : 0;
    if (pilotNm > 0) {
      const lerp = (a, b, t) => { let dl = b[1] - a[1]; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360; let lo = a[1] + dl * t; if (lo > 180) lo -= 360; else if (lo < -180) lo += 360; return [a[0] + (b[0] - a[0]) * t, lo]; };
      const first = runs[0]; const last = runs[runs.length - 1];
      const pOut = Math.min(pilotNm, (Number(first.nm) || 0) * 0.4); const pIn = Math.min(pilotNm, (Number(last.nm) || 0) * 0.4);
      if (pOut >= 1 && first.from && first.to) {
        const pt = lerp(first.from, first.to, pOut / first.nm);
        const piece = { eca: first.eca, zone: first.zone, zones: (first.zones || []).slice(), nm: pOut + appr, from: first.from, to: pt, pilot: 'out' };
        first.nm -= pOut; first.from = pt; runs.unshift(piece);
      }
      if (pIn >= 1 && last.from && last.to) {
        const pt = lerp(last.from, last.to, 1 - pIn / last.nm);
        const piece = { eca: last.eca, zone: last.zone, zones: (last.zones || []).slice(), nm: pIn + appr, from: pt, to: last.to, pilot: 'in' };
        last.nm -= pIn; last.to = pt; runs.push(piece);
      }
    }
    const gid = (opts && opts.group) || 'g' + Math.random().toString(36).slice(2, 9);
    const zl = (r) => (r.zones || []).map(zoneLabel).join(', ');
    /* where the line between stretch k and k+1 lies, in words */
    const edge = (k) => runs[k].pilot === 'out' ? 'Pilot drop-off ' + posText(runs[k].to)
      : runs[k + 1].pilot === 'in' ? 'Pilot pick-up ' + posText(runs[k].to)
      : (runs[k + 1].eca ? 'ECA entry ' : 'ECA exit ') + posText(runs[k].to) + (runs[k + 1].eca ? ' (' + zl(runs[k + 1]) + ')' : '');
    const total = Number(leg.distance) || 0;
    const sum = runs.reduce((a, r) => a + (Number(r.nm) || 0), 0);
    if (!(total > 0) || !(sum > 0)) return null;
    const dist = runs.map((r) => Math.max(1, Math.round((Number(r.nm) || 0) * total / sum)));
    const diff = Math.round(total) - dist.reduce((a, b) => a + b, 0);
    dist[dist.indexOf(Math.max(...dist))] += diff;
    return runs.map((r, k) => {
      const nl = JSON.parse(JSON.stringify(leg));
      const first = k === 0; const last = k === runs.length - 1;
      const name = r.pilot === 'out' ? 'pilot area at departure, ' + (r.eca ? 'ECA ' : 'outside ECA ') : r.pilot === 'in' ? 'pilot area at arrival, ' + (r.eca ? 'ECA ' : 'outside ECA ') : (r.eca ? 'ECA ' : 'outside ECA ');
      nl.from = first ? leg.from : edge(k - 1);
      nl.to = last ? leg.to : edge(k);
      nl.fromPort = first ? leg.fromPort : null; nl.toPort = last ? leg.toPort : null;
      nl.distance = dist[k]; nl.distAuto = true; nl.daysManual = false; nl.days = null;
      nl.seaNote = name + 'stretch of ' + leg.from + ' → ' + leg.to + (r.eca ? ' (' + zl(r) + ')' : '');
      nl.ecaNm = r.eca ? dist[k] : null; nl.ecaZones = r.eca ? zl(r) : ''; nl.ecaRuns = null;
      nl.keepWhole = false; nl.grp = { id: gid, fromPort: leg.routeFrom || leg.fromPort, toPort: leg.routeTo || leg.toPort, from: leg.from, to: leg.to };
      if (r.eca && ecaGrade && nl.fuels && nl.fuels[0]) nl.fuels[0].grade = ecaGrade;
      return nl;
    });
  }

  /** Loads the offline port list and sea-lane router from `base` (a folder holding port-list.js, sea-route.js, ports.json, marnet.json).
   *  Returns a function that loads them once and resolves to { ports, router, SeaRoute }. A host that has no such folder passes no `sea` and the page works as before. */
  function seaLoader(base) {
    let pending = null;
    const script = (url) => new Promise((resolve, reject) => {
      const el = document.createElement('script'); el.src = url; el.onload = resolve; el.onerror = () => reject(new Error('could not load ' + url));
      document.head.appendChild(el);
    });
    const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
    let mapPending = null; let landRings = null;
    const loadMap = () => mapPending || (mapPending = script(base + 'sea-map.js')
      .then(() => ({ SeaMap: window.SeaMap, land: landRings })).catch((e) => { mapPending = null; throw e; }));
    return function load() {
      if (!pending) {
        pending = Promise.all([script(base + 'port-list.js'), script(base + 'sea-route.js'), script(base + 'eca-zones.js'), json(base + 'ports.json'), json(base + 'marnet.json'), json(base + 'land.json')])
          .then((r) => { landRings = window.SeaRoute.decodeLand(r[5]); return ({ ports: window.PortList.create(r[3]), router: window.SeaRoute.create(r[4], { land: landRings }), SeaRoute: window.SeaRoute, Eca: window.EcaZones, loadMap }); })
          .catch((e) => { pending = null; throw e; });
      }
      return pending;
    };
  }
  function portLabel(p) { return p.name + ', ' + p.cc; }

  const STYLE = `
    /* The entry lines keep readable box sizes and scroll sideways when the screen is narrower, instead of squeezing From / To and the figures. */
    .cp-route .table-scroll { overflow-x: auto !important; -webkit-overflow-scrolling: touch; max-height: none !important; padding-bottom: 8px; }
    .cp-route .bunker-table { table-layout: fixed !important; width: max-content !important; min-width: 0 !important; }
    /* also on a phone held upright: the host may turn bunker tables into stacked cards with fixed captions, which do not fit these columns; here the line stays a row you scroll along */
    .cp-route .bunker-table { display: table !important; }
    .cp-route .bunker-table thead { display: table-header-group !important; }
    .cp-route .bunker-table tbody { display: table-row-group !important; }
    .cp-route .bunker-table tr { display: table-row !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: none !important; }
    .cp-route .bunker-table td { display: table-cell !important; width: auto; padding: 3px 2px !important; }
    .cp-route .bunker-table td::before { content: none !important; display: none !important; }
    .cp-route .bunker-table td.col-from, .cp-route .bunker-table td.col-to { grid-column: auto; }
    .cp-route .bunker-table .col-drag, .cp-route .bunker-table .col-del { width: 40px !important; }
    .cp-route .bunker-table .col-port { width: 44px !important; }
    .cp-route .bunker-table .col-from, .cp-route .bunker-table .col-to { width: 220px !important; min-width: 220px; }
    .cp-route .bunker-table .col-num { width: 88px !important; }
    .cp-route .bunker-table .col-margin { width: 80px !important; }
    .cp-route .bunker-table .col-fuel { width: 150px !important; min-width: 140px; }
    .cp-route .bunker-table .col-qty { width: 96px !important; min-width: 90px; }
    .cp-route .bunker-table input[type="text"], .cp-route .bunker-table input[type="number"], .cp-route .bunker-table select { font-size: 14px !important; min-height: 32px; }
    .cp-fuelbox { display: flex; flex-direction: column; gap: 3px; width: 100%; }
    .cp-fuelbox select, .cp-fuelbox input { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; }
    .cp-route .col-qty input { width: 100%; min-width: 0; }
    .cp-hint { margin-bottom: 12px; }
    .cp-slotbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
    .cp-route { margin: 10px 0; }
    .cp-grade-title { display: flex; align-items: baseline; gap: 8px; }
    .cp-grade-note { font-size: .8em; opacity: .75; }
    .cp-sec { margin: 14px 0; padding-top: 4px; }
    .cp-sec + .cp-sec { border-top: 2px solid rgba(128,128,128,.35); padding-top: 14px; }
    .cp-sec-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .cp-sec-head h3 { margin: 0; }
    .cp-sec-head input { flex: 1 1 220px; min-width: 0; }
    .cp-seaopts { margin: 8px 0; padding: 6px 10px; border: 1px solid rgba(128,128,128,.35); border-radius: 8px; }
    .cp-seaopts summary { cursor: pointer; font-weight: 600; }
    .cp-seaopts fieldset { border: 0; margin: 6px 0 0; padding: 0; }
    .cp-seaopts legend { font-size: .85em; opacity: .75; padding: 0; }
    .cp-seaopts label { display: inline-flex; gap: 5px; align-items: center; margin: 3px 12px 3px 0; white-space: nowrap; }
    /* buttons that can be seen: a real border and fill, a stronger one for the main actions, a clearly dim disabled state */
    .cp-slotbar button, .cp-seaopts button, .cp-seanote button, .cp-btn, .cp-del, .cp-drag {
      border: 1px solid rgba(128,128,128,.7); border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
      background: rgba(128,128,128,.16); background: color-mix(in srgb, currentColor 12%, transparent);
      font-weight: 600; cursor: pointer; opacity: 1; }
    .cp-slotbar button:hover:not(:disabled), .cp-seaopts button:hover:not(:disabled), .cp-seanote button:hover:not(:disabled), .cp-del:hover, .cp-drag:hover {
      background: rgba(128,128,128,.3); background: color-mix(in srgb, currentColor 24%, transparent); }
    .cp-slotbar button.cp-strong, .cp-seanote button.cp-strong, .cp-strong { border-width: 2px; border-color: #d9a441; background: rgba(217,164,65,.22); }
    .cp-slotbar button:disabled { opacity: .35; cursor: not-allowed; border-style: dashed; font-weight: 400; }
    .cp-del { min-width: 34px; padding: 4px 8px; }
    .cp-drag { min-width: 34px; padding: 4px 6px; cursor: grab; touch-action: none; user-select: none; letter-spacing: -1px; }
    .cp-route .col-drag, .cp-route .col-del { width: 40px; padding: 2px; text-align: center; }
    tr.cp-dragging { opacity: .45; }
    tr.cp-drop-before > td { box-shadow: inset 0 3px 0 #d9a441; }
    tr.cp-drop-after > td { box-shadow: inset 0 -3px 0 #d9a441; }
    .cp-grouptools { margin: 6px 0; }
    .cp-seanote { font-size: .82em; opacity: .85; margin: 4px 0; }
    .cp-route input.cp-auto { font-style: italic; border-style: dashed; }
    .cp-mapov { position: fixed; inset: 0; z-index: 100000; background: #0b1620; color: #e8eef5; display: flex; flex-direction: column; }
    .cp-mapbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 8px 12px; background: #13283b; }
    .cp-mapbar button { min-width: 38px; padding: 6px 10px; }
    .cp-askov { z-index: 100000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
    .cp-askbox { background: #13283b; color: #fff; padding: 18px 20px; border-radius: 10px; max-width: 460px; width: calc(100% - 32px); box-shadow: 0 10px 40px rgba(0,0,0,.5); }
    .cp-askbox p { margin: 0 0 14px; line-height: 1.4; }
    .cp-askbtns { display: flex; gap: 10px; justify-content: flex-end; }
    .cp-mapedit { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .cp-mapedit[hidden], .cp-mapedithint[hidden], .cp-mapbar button[hidden] { display: none; }
    .cp-mapedithint { flex-basis: 100%; font-size: 12px; opacity: .85; }
    .cp-mapbar label { display: inline-flex; gap: 5px; align-items: center; white-space: nowrap; }
    .cp-mapinfo { flex: 1 1 100%; font-size: .85em; opacity: .9; }
    .cp-mapcanvas { flex: 1 1 auto; position: relative; min-height: 200px; }
    .cp-mapnote { font-size: .75em; opacity: .75; padding: 4px 12px; background: #13283b; }
    .cp-overview { margin: 12px 0; }
    .cp-overview table { border-collapse: collapse; width: 100%; min-width: 420px; font-variant-numeric: tabular-nums; }
    .cp-overview th, .cp-overview td { padding: 4px 8px; text-align: right; border-bottom: 1px solid rgba(128,128,128,.25); white-space: nowrap; }
    .cp-overview thead th { text-align: right; }
    .cp-overview tbody th[scope="row"] { text-align: left; font-weight: 500; }
    .cp-overview .cp-grade-row th { text-align: left; background: rgba(128,128,128,.14); font-weight: 700; }
    .cp-overview .cp-comb { font-weight: 700; border-left: 2px solid rgba(128,128,128,.4); }
    .cp-overview .cp-neg { color: #d9534f; }
    .cp-overview .cp-title { display: block; font-weight: 400; font-size: .8em; opacity: .75; white-space: normal; max-width: 160px; margin-left: auto; }
  `;

  /* ------------------------------------------------------------------ print ---- */
  function printBody(plan, fuels, adapter) {
    const cm = combined(plan);
    const secs = cm.chain.sections;
    const multi = secs.length > 1;
    const slots = plan.fuelSlots || 2;
    const metaGrid = adapter.printMetaGrid || ((items) => items.map((i) => `<div>${esc(i.label)}: ${i.value}</div>`).join(''));
    const mt = (v) => (v == null ? '—' : fmtFuel(v) + ' MT');
    const head = ['<th style="width:5%">P/A</th>', '<th style="width:13%">From</th>', '<th style="width:13%">To</th>', '<th style="width:8%">Dist</th>', '<th style="width:8%">Speed</th>', '<th style="width:8%">Days</th>']
      .concat(Array.from({ length: slots }, (_, i) => `<th>Fuel ${i + 1}</th><th>MT/day</th><th>Qty MT</th>`))
      .concat(['<th style="width:7%">Margin %</th>']).join('');
    const routeBlock = (sec, route, title) => {
      const rows = sec.legs.filter((l) => !legIsBlank(l) || (l.fuels || []).some((f) => fuelQty(l, f) != null)).map((l) => {
        const days = legDays(l);
        const cells = l.fuels.slice(0, slots).map((f) => {
          const q = fuelQty(l, f);
          return `<td>${esc(f.grade || '')}</td><td>${num(f.daily) != null ? fmtN(f.daily, 2) : ''}</td><td>${q != null ? fmtFuel(q) : ''}</td>`;
        }).join('');
        return `<tr><td>${l.port ? '●' : ''}</td><td class="row-lbl">${esc(l.from)}</td><td class="row-lbl">${esc(l.to)}</td>`
          + `<td>${l.distance != null ? fmtN(l.distance, 2) + (l.distAuto ? '*' : '') : ''}</td><td>${l.speed != null ? fmtN(l.speed, 2) : ''}</td>`
          + `<td>${days != null ? fmtN(days, 2) : ''}</td>${cells}<td>${l.marginPct != null ? fmtN(l.marginPct, 1) : ''}</td></tr>`;
      }).join('');
      return `<section class="pr-section"><h3 class="pr-section-title">${esc(title)}</h3><div class="pr-section-body">
      <table class="pr-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      ${metaGrid([
        { label: 'Days Port', value: fmtN(route.daysPort, 2) },
        { label: 'Days Sea', value: fmtN(route.daysSea, 2) },
        { label: 'Total Distance', value: fmtN(route.totalDist, 0) + ' nm' },
      ].concat(route.totalEca > 0 ? [{ label: 'Of which in ECA', value: fmtN(route.totalEca, 0) + ' nm' }] : []), route.totalEca > 0 ? 4 : 3)}</div></section>`;
    };
    const gradeBlock = (g, s, title) => `<section class="pr-section"><h3 class="pr-section-title">${esc(title)}</h3><div class="pr-section-body">
        ${metaGrid([
          { label: 'Current ROB', value: mt(s.rob) },
          { label: 'Qty to Receive', value: s.receive ? mt(s.receive) : '—' },
          { label: 'Total Consumption', value: mt(s.totalCons) },
          { label: 'Total Margin', value: mt(s.margin) },
          { label: 'Required Quantity', value: mt(s.required) },
          { label: 'Arrival ROB', value: mt(s.arrivalRob) },
          { label: 'Next Departure ROB', value: mt(s.nextDepRob) },
          { label: 'Delivery / Redelivery ROB', value: mt(s.delivery) },
          { label: 'Excess (Margin) Quantity', value: mt(s.excessMargin) },
          { label: 'Excess (Actual) Quantity', value: mt(s.excessActual) },
          { label: 'Unpumpable', value: s.stemAdvice && s.stemAdvice.unpumpable ? mt(s.stemAdvice.unpumpable) : '—' },
          { label: 'Weather reserve', value: s.stemAdvice && s.stemAdvice.weather ? mt(s.stemAdvice.weather) : '—' },
          { label: 'Order', value: s.stemAdvice && s.stemAdvice.orderMt != null ? mt(s.stemAdvice.orderMt) : '—' },
          { label: 'Stem still needed', value: mt(s.stem) },
        ], 4)}
        <div class="pr-remarks"><div class="pr-remarks-body">${esc(stemText(g, s))}</div></div></div></section>`;
    let body = '';
    secs.forEach((x, i) => {
      body += routeBlock(x.sec, x.route, multi ? `${secTitle(x.sec, i)} — route and fuels` : 'Route and fuels');
      cm.grades.forEach((g) => {
        const s = x.sums[normGrade(g.grade)];
        if (multi && !s.totalCons && !s.required && s.rob == null && !s.receive) return;
        body += gradeBlock(g.grade, s, multi ? `${g.grade} — ${secTitle(x.sec, i)}` : g.grade);
      });
    });
    if (multi) {
      body += `<section class="pr-section"><h3 class="pr-section-title">All voyage legs combined</h3><div class="pr-section-body">${metaGrid([
        { label: 'Days Port', value: fmtN(cm.route.daysPort, 2) },
        { label: 'Days Sea', value: fmtN(cm.route.daysSea, 2) },
        { label: 'Total Distance', value: fmtN(cm.route.totalDist, 0) + ' nm' },
      ], 3)}</div></section>`;
      cm.grades.forEach((g) => {
        body += `<section class="pr-section"><h3 class="pr-section-title">${esc(g.grade)} — combined</h3><div class="pr-section-body">${metaGrid([
          { label: 'Starting ROB', value: mt(g.startRob) },
          { label: 'Qty to Receive', value: g.receive ? mt(g.receive) : '—' },
          { label: 'Total Consumption', value: mt(g.totalCons) },
          { label: 'Total Margin', value: mt(g.margin) },
          { label: 'Required Quantity', value: mt(g.required) },
          { label: 'Final Arrival ROB', value: mt(g.arrivalRob) },
          { label: 'Final Next Departure ROB', value: mt(g.nextDepRob) },
          { label: 'Stem still needed', value: mt(g.stem) },
        ], 4)}</div></section>`;
      });
    }
    return body
      + (adapter && adapter.mapHtml ? adapter.mapHtml : '')
      + `<div class="pr-remarks"><div class="pr-remarks-title">Remarks</div><div class="pr-remarks-body">${esc(plan.remarks || '—')}</div></div>`
      + `<div class="pr-remarks"><div class="pr-remarks-title">Calculation basis</div><div class="pr-remarks-body">`
      + 'Sea days = Dist ÷ (Speed × 24). Quantity = MT per day × Days, for each fuel on the line. Each line may carry its own Margin % '
      + '(line margin = Qty × Margin%). Required = Σ Qty + Σ line margins. Arrival ROB = Current ROB − Required. '
      + 'Next Departure ROB = Arrival ROB + Qty to Receive. Order = Required + unpumpable + weather reserve − Current ROB.'
      + (sectionList(plan).some((x) => x.legs.some((l) => l.distAuto)) ? ' * Distance calculated offline from a sea-lane network (planning estimate, not for navigation).' : '')
      + (multi ? ' Voyage legs are consecutive: the Current ROB of a leg is the Next Departure ROB of the leg before it.' : '')
      + '</div></div>';
  }

  /* ------------------------------------------------------------------ the page ---- */
  function mount(host, adapter) {
    const A = adapter;
    const ui = Object.assign({ panel: 'form-panel', btn: 'btn small', primary: 'btn primary small', ghost: 'btn small', hist: 'form-panel' }, A.ui || {});
    const ctx = { fuels: cleanFuels(A.fuels ? A.fuels() : null), plan: null, history: [], timer: null, sea: null, portMap: new Map(), seaOpen: false };

    if (!document.getElementById('cp-style')) {
      const st = document.createElement('style'); st.id = 'cp-style'; st.textContent = STYLE; document.head.appendChild(st);
    }
    const data = A.load() || {};
    ctx.plan = ensurePlan(data.plan, ctx.fuels); refreshFuels(); conformToVessel();
    ctx.history = Array.isArray(data.history) ? data.history : [];
    if (!ctx.plan.voyageNo) ctx.plan.voyageNo = (A.voyageNo && A.voyageNo()) || '';
    if (!ctx.plan.date) ctx.plan.date = new Date().toISOString().slice(0, 10);

    const $ = (sel) => host.querySelector(sel);
    const toast = (m) => { try { A.toast && A.toast(m); } catch (_) { /* ignore */ } };

    /** A question with OK / Cancel that is drawn by the page itself. The browser's own dialog is silently refused (answers "no") inside some embedded frames and apps, which made
     *  Clear, Delete and Recalculate look dead. */
    function askYes(message, okLabel) {
      if (A.confirm) { try { return Promise.resolve(A.confirm(message)); } catch (_) { /* use ours */ } }
      return new Promise((resolve) => {
        const ov = document.createElement('div'); ov.className = 'cp-mapov cp-askov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
        ov.innerHTML = `<div class="cp-askbox"><p></p><div class="cp-askbtns"><button type="button" class="${ui.btn}" data-ask="no">Cancel</button><button type="button" class="${ui.primary}" data-ask="yes"></button></div></div>`;
        ov.querySelector('p').textContent = message; ov.querySelector('[data-ask="yes"]').textContent = okLabel || 'OK';
        const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); } };
        ov.addEventListener('click', (e) => { const k = e.target.dataset && e.target.dataset.ask; if (k) done(k === 'yes'); else if (e.target === ov) done(false); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov); const y = ov.querySelector('[data-ask="yes"]'); if (y) y.focus();
      });
    }
    /** The vessel's fuels again from the host (the loaded vessel or its tanks may have changed since the page was opened). True when the list changed. */
    function refreshFuels() {
      const raw = A.fuels ? A.fuels() : null;
      ctx.fuelsKnown = Array.isArray(raw) && raw.some((f) => f && (f.id || f.label));
      const next = cleanFuels(raw);
      const changed = next.map((f) => normGrade(f.id)).join('|') !== ctx.fuels.map((f) => normGrade(f.id)).join('|');
      ctx.fuels = next; return changed;
    }
    function hasStock(st) { return !!st && ['currentRob', 'qtyReceive', 'deliveryRob', 'unpumpableMt', 'weatherMarginMt'].some((f) => num(st[f]) != null); }
    /** Put the plan on the loaded vessel's fuels: a line whose fuel this vessel does not have takes the vessel's fuel of the same kind (residual / distillate); a ROB figure
     *  of a fuel the vessel does not have moves with it. Returns how many lines were changed. */
    function conformToVessel() {
      if (!ctx.fuelsKnown) return 0;
      const known = new Set(ctx.fuels.map((f) => normGrade(f.id)));
      const map = new Map(); let n = 0;
      const target = (g) => {
        const k = normGrade(g); if (!k || known.has(k)) return null;
        if (!map.has(k)) { const same = ctx.fuels.filter((f) => f.family === familyOf(g)); map.set(k, same.length ? same[0].id : null); }
        return map.get(k);
      };
      sectionList(ctx.plan).forEach((sec) => {
        (sec.legs || []).forEach((leg) => (leg.fuels || []).forEach((f) => { const t = f.grade ? target(f.grade) : null; if (t) { f.grade = t; n++; } }));
        Object.keys(sec.stocks || {}).forEach((k) => {
          const from = sec.stocks[k]; const label = (from && from.label) || k;
          if (known.has(normGrade(label))) return;
          const t = target(label);
          if (t) { const nk = normGrade(t); if (!hasStock(sec.stocks[nk])) sec.stocks[nk] = Object.assign({}, from, { label: t }); }
          delete sec.stocks[k];
        });
      });
      return n;
    }
    function persistNow() {
      clearTimeout(ctx.timer);
      return Promise.resolve(A.persist({ plan: finalize(ctx.plan), history: ctx.history })).catch((e) => console.warn('consumption plan persist', e));
    }
    function scheduleSave() { clearTimeout(ctx.timer); ctx.timer = setTimeout(persistNow, 400); }

    /* ---- drawing ---- */
    function gradeOptions(selected) {
      const list = ctx.fuels.slice();
      if (selected && !list.some((f) => normGrade(f.id) === normGrade(selected))) list.push({ id: selected });
      const hit = normGrade(selected);
      return '<option value="">— fuel —</option>'
        + list.map((f) => `<option value="${esc(f.id)}" ${normGrade(f.id) === hit && hit ? 'selected' : ''}>${esc(f.id)}</option>`).join('');
    }
    function rowHtml(leg, i) {
      const days = legDays(leg);
      const slots = ctx.plan.fuelSlots;
      const cells = leg.fuels.slice(0, slots).map((f, s) => {
        const q = fuelQty(leg, f);
        return `<td class="col-fuel cp-fuelcell"><div class="cp-fuelbox"><select data-f="grade" data-s="${s}" title="Fuel burned on this line">${gradeOptions(f.grade)}</select>`
          + `<input type="number" step="0.01" data-f="daily" data-s="${s}" value="${f.daily ?? ''}" placeholder="MT/day" inputmode="decimal"></div></td>`
          + `<td class="col-qty"><input type="number" readonly tabindex="-1" data-qty="${s}" value="${q == null ? '' : fmtFuel(q)}"></td>`;
      }).join('');
      return `<tr data-row="${i}">
        <td class="col-drag"><button type="button" class="cp-drag" data-drag="${i}" title="Drag to move this line up or down (or press the arrow keys)" aria-label="Move line ${i + 1}: drag, or press the up and down arrow keys">⠿</button></td>
        <td class="col-port"><input type="checkbox" data-f="port" ${leg.port ? 'checked' : ''} title="Port or anchorage stay"></td>
        <td class="col-from"><input type="text" data-f="from" value="${esc(leg.from)}" placeholder="From" autocomplete="off"${ctx.sea ? ' list="cp-ports"' : ''}></td>
        <td class="col-to"><input type="text" data-f="to" value="${esc(leg.to)}" placeholder="To / destination" autocomplete="off"${ctx.sea ? ' list="cp-ports"' : ''}></td>
        <td class="col-num"><input type="number" step="0.1" data-f="distance" value="${leg.distance ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"${leg.distAuto ? ' class="cp-auto" title="Calculated offline from the sea lanes: ' + esc(leg.seaNote || '') + '"' : ''}></td>
        <td class="col-num"><input type="number" step="0.1" data-f="speed" value="${leg.speed ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
        <td class="col-num"><input type="number" step="0.001" data-f="days" value="${daysShown(leg, days)}" inputmode="decimal"></td>
        ${cells}
        <td class="col-margin"><input type="number" step="0.1" data-f="marginPct" value="${leg.marginPct ?? ''}" placeholder="%" title="Safety margin % for this destination / stay only" inputmode="decimal"></td>
        <td class="col-del"><button type="button" class="${ui.btn} cp-del" data-act="del-leg" data-row="${i}" title="Remove this line" aria-label="Remove line ${i + 1}">✕</button></td>
      </tr>`;
    }
    function secAt(i) { return sectionList(ctx.plan)[i] || ctx.plan; }
    function secIndexOf(el) { const e = el && el.closest ? el.closest('[data-sec]') : null; return e ? Number(e.dataset.sec) : 0; }
    function stockHtml(grade, si, sum) {
      const st = stockOf(secAt(si), grade);
      const g = esc(grade);
      const field = (f, label, title, cls) => `<div class="field ${cls || ''}"><label>${label}</label><input type="number" step="0.001" data-sf="${f}" data-grade="${g}" value="${st[f] ?? ''}"${title ? ` title="${title}"` : ''}></div>`;
      const robField = si === 0 ? field('currentRob', 'Current ROB (MT)')
        : `<div class="field"><label>Current ROB (MT) · from leg ${si}</label><input type="number" readonly tabindex="-1" data-chained="${g}" value="${sum.rob == null ? '' : fmtFuel(sum.rob)}" title="The Next Departure ROB of the previous voyage leg"></div>`;
      return `<div class="bunker-side" data-grade="${g}">
        <h3 class="cp-grade-title">${g}</h3>
        <div class="bunker-totals">
          ${robField}
          ${field('qtyReceive', 'Quantity to Receive (MT)')}
          ${field('unpumpableMt', 'Unpumpable (MT)', 'Oil that cannot be pumped out of the tanks; it is held back from the usable quantity')}
          ${field('weatherMarginMt', 'Weather reserve (MT)', 'Extra tonnes kept for bad weather')}
          ${field('deliveryRob', 'Delivery / Redelivery ROB (MT)', '', 'full')}
        </div>
        <div class="bunker-results" data-results="${g}">${gradeCardsHtml(sum)}</div>
        <div class="stem-advice" data-stem="${g}">${esc(stemText(grade, sum))}</div>
      </div>`;
    }
    function sectionHtml(cs, si, multi) {
      const sec = cs.sec;
      const slots = ctx.plan.fuelSlots;
      const head = Array.from({ length: slots }, (_, s) => `<th class="col-fuel">Fuel ${s + 1} · MT/day</th><th class="col-qty">Qty MT</th>`).join('');
      const used = gradesInUse(ctx.plan);
      return `<section class="cp-sec" data-sec="${si}">
        ${multi ? `<div class="cp-sec-head"><h3>Voyage leg ${si + 1}</h3><input type="text" data-cp="legTitle" value="${esc(sec.legTitle || '')}" placeholder="Name of this leg (optional), e.g. Singapore → Rotterdam" aria-label="Name of voyage leg ${si + 1}" autocomplete="off"></div>` : ''}
        <div class="cp-route">
          <div class="table-scroll" role="region" aria-label="Route and fuels, voyage leg ${si + 1}">
            <table class="bunker-table">
              <thead><tr>
                <th class="col-drag" title="Drag a line to move it"></th><th class="col-port" title="Check if port or anchorage">P/A</th><th class="col-from">From</th><th class="col-to">To</th>
                <th class="col-num">Dist nm</th><th class="col-num">Speed kn</th><th class="col-num">Days</th>
                ${head}
                <th class="col-margin" title="Optional reserve for this line only">Margin %</th><th class="col-del"></th>
              </tr></thead>
              <tbody>${sec.legs.map(rowHtml).join('')}</tbody>
            </table>
          </div>
          <div class="bunker-leg-actions cp-slotbar">
            <button type="button" class="${ui.btn}" data-act="add-leg">Add destination / stay</button>
            <button type="button" class="${ui.btn}" data-act="remove-leg" ${sec.legs.length <= 1 ? 'disabled' : ''} title="${sec.legs.length <= 1 ? 'A plan keeps at least one line' : 'Remove the last line (or use the ✕ on any line)'}">Remove last line</button>
            ${ctx.sea ? `<button type="button" class="${ui.btn} cp-strong" data-act="sea-recalc" title="Work the distance of every route again from its ports, also where you typed a distance">Recalculate distances</button> <button type="button" class="${ui.btn}" data-act="sea-map-all">Map of all lines</button>` : ''}
          </div>
          ${seaNotesHtml(sec)}
          <div class="bunker-results" data-results="route">${routeCardsHtml(cs.route)}</div>
        </div>
        <div class="bunker-plan-grid">${used.length ? used.map((g) => stockHtml(g, si, cs.sums[normGrade(g)])).join('') : '<div class="hint">Pick a fuel and a MT/day on a line to see its quantities, ROB and stem advice.</div>'}</div>
      </section>`;
    }
    /* ---- sea distance ---- */
    /** The ECA zones measured for a plan: those in force on the plan's date (or switched on by the user), minus the ones switched off. */
    function ecaIdsFor(plan) {
      if (!ctx.sea || !ctx.sea.Eca) return [];
      return ctx.sea.Eca.inForce(plan.date, plan.sea.ecaOn).filter((id) => !plan.sea.ecaOff.includes(id));
    }
    function passageName(id) { const p = ctx.sea && ctx.sea.SeaRoute.PASSAGES.find((x) => x.id === id); return p ? p.label : id; }
    /** The route between two ports. With "keep out of the ECA" on, also tries routes that weigh ECA water heavier and takes the one with the fewest ECA miles
     *  that is no more than the chosen percentage longer than the shortest. */
    const gcNm = (p, q) => { const r = Math.PI / 180, h = Math.sin((q[0] - p[0]) * r / 2) ** 2 + Math.cos(p[0] * r) * Math.cos(q[0] * r) * Math.sin((q[1] - p[1]) * r / 2) ** 2; return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h))); };
    /** Waypoints the user moved by hand for the route a -> b (a route drawn the other way round is the same one reversed), or null. */
    function manualFor(a, b) {
      const m = ctx.plan.sea.manual || {};
      if (m[a.id + '|' + b.id]) return m[a.id + '|' + b.id].map((p) => p.slice());
      if (m[b.id + '|' + a.id]) return m[b.id + '|' + a.id].map((p) => p.slice()).reverse();
      return null;
    }
    function routeFor(a, b) {
      const man = manualFor(a, b);
      if (man) {
        const pts = [[a.lat, a.lon]].concat(man, [[b.lat, b.lon]]); let nm = 0; for (let i = 1; i < pts.length; i++) nm += gcNm(pts[i - 1], pts[i]);
        return { ok: true, nm, path: man, passages: [], warnings: [], savedNm: 0, manual: man.length, waypoints: man };
      }
      const pa = { lat: a.lat, lon: a.lon }, pb = { lat: b.lat, lon: b.lon };
      const opt = { avoid: ctx.plan.sea.avoid, areas: ctx.plan.sea.areas, greatCircle: ctx.plan.sea.greatCircle !== false };
      const r0 = ctx.sea.router.route(pa, pb, opt);
      if (!r0.ok || !ctx.plan.sea.minEca || !ctx.sea.Eca) return r0;
      const ids = ecaIdsFor(ctx.plan);
      if (!ids.length) return r0;
      const test = (lo, la) => !!ctx.sea.Eca.zoneAt(lo, la, ids), key = ids.join(',');
      const ecaNm = (r) => ctx.sea.Eca.measure([[a.lat, a.lon]].concat(r.path, [[b.lat, b.lon]]), ids).ecaNm;
      const e0 = ecaNm(r0);
      if (e0 < 1) return r0;
      const cap = r0.nm * (1 + (ctx.plan.sea.minEcaPct || 10) / 100);
      let best = r0, bestE = e0;
      [0.5, 1, 2, 4, 8].forEach((w) => {
        const r = ctx.sea.router.route(pa, pb, Object.assign({}, opt, { eca: { test, key, weight: w } }));
        if (!r.ok || r.nm > cap) return;
        const e = ecaNm(r);
        if (e < bestE - 1 || (Math.abs(e - bestE) <= 1 && r.nm < best.nm)) { best = r; bestE = e; }
      });
      if (best !== r0) best.ecaMin = { savedNm: Math.round(e0 - bestE), extraNm: Math.round(best.nm - r0.nm) };
      return best;
    }
    function computeLeg(leg) {
      const a = ctx.sea.ports.byId(leg.fromPort); const b = ctx.sea.ports.byId(leg.toPort);
      if (!a || !b) return false;
      const r = routeFor(a, b);
      if (!r.ok) { leg.distAuto = false; leg.seaNote = ''; toast(r.error); return false; }
      const approach = ctx.plan.sea.approachNm > 0 ? 2 * ctx.plan.sea.approachNm : 0; // pilot station / approach at both ends
      leg.distance = Math.round(r.nm + approach); leg.distAuto = true; leg.daysManual = false; leg.days = null;
      leg.ecaNm = null; leg.ecaZones = ''; leg.ecaRuns = null; leg.routeFrom = leg.fromPort; leg.routeTo = leg.toPort;
      if (ctx.sea.Eca) {
        const ids = ecaIdsFor(ctx.plan);
        const m = ctx.sea.Eca.measure([[a.lat, a.lon]].concat(r.path, [[b.lat, b.lon]]), ids);
        if (m.ecaNm >= 1) {
          leg.ecaNm = Math.min(leg.distance, Math.round(m.ecaNm));
          leg.ecaZones = Object.keys(m.zones).map((z) => ctx.sea.Eca.label(z)).join(', ');
          leg.ecaRuns = m.runs.slice(0, 12).map((x) => ({ eca: x.eca, zone: x.zone, nm: Math.round(x.nm * 10) / 10, from: x.from, to: x.to }));
        }
      }
      leg.seaNote = (r.manual ? 'on your own route (' + r.manual + ' waypoint' + (r.manual === 1 ? '' : 's') + ')' : r.passages.length ? 'via ' + r.passages.map(passageName).join(', ') : 'open sea') + (r.savedNm >= 1 ? ' · great-circle legs save ' + Math.round(r.savedNm) + ' nm' : '') + (r.ecaMin ? ' · kept out of the ECA: ' + r.ecaMin.savedNm + ' nm less in the ECA for ' + r.ecaMin.extraNm + ' nm more distance' : '') + (approach ? ' · includes ' + approach + ' nm of approach' : '') + (r.warnings.length ? ' — ' + r.warnings.join('; ') : '');
      return true;
    }
    /** Fill a line's distance from its two ports, unless a distance was typed by hand. */
    function autoDistance(leg) {
      if (!ctx.sea || leg.port || !leg.fromPort || !leg.toPort) return false;
      if (leg.distance != null && !leg.distAuto) return false;
      return computeLeg(leg);
    }
    /** The grade the ECA lines take: the one picked in the options, else the vessel's compliant distillate. */
    function ecaFuelNow() { return ctx.plan.sea.ecaFuel || defaultEcaFuel(ctx.fuels); }
    /** What a split also does: the pilot areas at both ends as their own lines, and the approach allowance that goes with them. */
    function splitOpts() { return { pilotNm: ctx.plan.sea.pilotSplit !== false ? (ctx.plan.sea.pilotNm || 10) : 0, approachNm: ctx.plan.sea.approachNm || 0 }; }
    /** Replace a line whose route crosses an ECA boundary by one line per stretch (outside / inside), when the plan is set to do so. Returns the number of lines now in its place (0 = left alone). */
    function autoSplitAt(sec, i) {
      const leg = sec.legs[i];
      if (ctx.plan.sea.autoSplit === false || !leg || leg.keepWhole || !ctx.sea || !ctx.sea.Eca) return 0;
      if (!(leg.ecaNm > 0) || !Array.isArray(leg.ecaRuns) || leg.ecaRuns.length < 2) return 0;
      const pieces = splitLegAtEca(leg, leg.ecaRuns, (z) => ctx.sea.Eca.label(z), ecaFuelNow(), splitOpts());
      if (!pieces) return 0;
      sec.legs.splice(i, 1, ...pieces);
      return pieces.length;
    }
    /** The routes of a section as units: a plain line with both ports, or a run of lines split from one route (they share a group). */
    function routeUnits(sec) {
      const units = []; const legs = sec.legs;
      for (let i = 0; i < legs.length; i++) {
        const l = legs[i];
        if (l.grp) { let j = i; while (j + 1 < legs.length && legs[j + 1].grp && legs[j + 1].grp.id === l.grp.id) j++; units.push({ start: i, end: j, group: true }); i = j; }
        else if (!l.port && l.fromPort && l.toPort) units.push({ start: i, end: i, group: false });
      }
      return units;
    }
    /** True when someone typed a distance on a line of the unit: Recalculate would overwrite it. */
    function unitEdited(sec, u) {
      return sec.legs.slice(u.start, u.end + 1).some((l) => !l.port && !l.distAuto && l.distance != null);
    }
    /** The line a unit is rebuilt from: itself, or for a split route the original line again (ports and names of the route, fuels of the stretch outside the ECA). */
    function unitTemplate(sec, u) {
      if (!u.group) return sec.legs[u.start];
      const pieces = sec.legs.slice(u.start, u.end + 1); const g = pieces[0].grp;
      const tpl = JSON.parse(JSON.stringify(pieces.find((p) => !(p.ecaNm > 0)) || pieces[0]));
      return Object.assign(tpl, { from: g.from, to: g.to, fromPort: g.fromPort, toPort: g.toPort, port: false, grp: null, keepWhole: false, distance: null, distAuto: false, days: null, daysManual: false, ecaNm: null, ecaZones: '', ecaRuns: null });
    }
    /** Work the route of a unit again from its ports and put the result (split again when the plan says so) in its place. Returns false when no route was found. */
    function rebuildUnit(sec, u, keepWhole) {
      const tpl = unitTemplate(sec, u);
      if (!computeLeg(tpl)) return false;
      if (keepWhole) tpl.keepWhole = true;
      sec.legs.splice(u.start, u.end - u.start + 1, tpl);
      autoSplitAt(sec, u.start);
      return true;
    }
    /** Recalculate every route that has its two ports. `force` also replaces distances that were typed by hand. */
    function recalcAuto(force) {
      let n = 0;
      sectionList(ctx.plan).forEach((sec) => {
        const units = routeUnits(sec);
        for (let k = units.length - 1; k >= 0; k--) { // from the last, so the indexes of the earlier ones stay valid
          const u = units[k];
          if (!force && unitEdited(sec, u)) continue;
          if (!u.group && !force) { const l = sec.legs[u.start]; if (!(l.distAuto || l.distance == null)) continue; }
          if (rebuildUnit(sec, u, !u.group && sec.legs[u.start].keepWhole)) n++;
        }
      });
      return n;
    }
    /** Work again every route between two ports (either way round), after the waypoints of that route changed. */
    function recalcRoute(aId, bId) {
      let n = 0; const same = (x, y) => (String(x) === String(aId) && String(y) === String(bId)) || (String(x) === String(bId) && String(y) === String(aId));
      sectionList(ctx.plan).forEach((sec) => {
        const units = routeUnits(sec);
        for (let k = units.length - 1; k >= 0; k--) {
          const u = units[k]; const l = sec.legs[u.start]; const g = u.group ? l.grp : l;
          if (!same(g.fromPort, g.toPort)) continue;
          if (rebuildUnit(sec, u, !u.group && l.keepWhole)) n++;
        }
      });
      return n;
    }
    function recalcEditedCount() {
      let n = 0;
      sectionList(ctx.plan).forEach((sec) => routeUnits(sec).forEach((u) => { if (unitEdited(sec, u)) n++; }));
      return n;
    }
    /** Move line `from` to the final index `to`. A line moved out of a split route takes the whole route out of its group (the lines stay as they are). */
    function moveLeg(sec, from, to) {
      if (from === to || !sec.legs[from] || to < 0 || to >= sec.legs.length) return false;
      const l = sec.legs[from]; const gid = l.grp && l.grp.id;
      sec.legs.splice(from, 1); sec.legs.splice(to, 0, l);
      if (gid) sec.legs.forEach((x) => { if (x.grp && x.grp.id === gid) x.grp = null; });
      return true;
    }
    const ROUTE_COLORS = ['#27d3ff', '#7dff7d', '#ff7de9', '#ffd84d', '#b48cff', '#ff8c5a'];
    /** Lines (with their section number) that were measured from two ports; lines split from the same route share one drawing. */
    function mapGroups(items) {
      const seen = new Map();
      items.forEach(({ leg, si }) => { if (!leg.routeFrom || !leg.routeTo) return; const k = si + '|' + leg.routeFrom + '|' + leg.routeTo; if (!seen.has(k)) seen.set(k, { si, from: leg.routeFrom, to: leg.routeTo, nm: 0, eca: 0 }); const g = seen.get(k); g.nm += Number(leg.distance) || 0; g.eca += Number(leg.ecaNm) || 0; });
      return [...seen.values()];
    }
    /** The routes behind the chosen lines: drawn paths (with the ECA stretches), the text for the legend, and the colours. */
    function buildMapRoutes(items, plan) {
      const groups = mapGroups(items); const routes = []; const info = [];
      const ids = ecaIdsFor(plan);
      groups.forEach((g, n) => {
        const a = ctx.sea.ports.byId(g.from); const b = ctx.sea.ports.byId(g.to); if (!a || !b) return;
        const r = routeFor(a, b);
        if (!r.ok) return;
        const pts = [[a.lat, a.lon]].concat(r.path, [[b.lat, b.lon]]);
        const m = ctx.sea.Eca ? ctx.sea.Eca.measure(pts, ids) : { runs: [], ecaNm: 0 };
        const color = ROUTE_COLORS[(groups.length > 1 ? n : g.si) % ROUTE_COLORS.length];
        routes.push({ path: pts, color, from: { lat: a.lat, lon: a.lon, name: a.name }, to: { lat: b.lat, lon: b.lon, name: b.name }, ecaRuns: m.runs, passages: r.passages, aId: a.id, bId: b.id, waypoints: r.waypoints || [], manual: !!r.manual });
        info.push({ color, text: `${a.name} → ${b.name}: ${fmtN(r.nm, 0)} nm${m.ecaNm >= 1 ? ` · ECA ${fmtN(m.ecaNm, 0)} nm` : ''}${r.passages.length ? ' · via ' + r.passages.map(passageName).join(', ') : ''}` });
      });
      return { groups, routes, info, ids, areas: ctx.sea.SeaRoute.AREAS.filter((x) => plan.sea.areas.includes(x.id)) };
    }
    /** The route map as a picture for the printout: drawn off screen, returned as an HTML block (empty when there is nothing to draw). */
    async function printMapHtml(plan) {
      if (!ctx.sea || plan.sea.printMap === false) return '';
      const items = []; sectionList(plan).forEach((sec, si) => sec.legs.forEach((leg) => items.push({ leg, si })));
      if (!mapGroups(items).length) return '';
      try {
        const assets = await ctx.sea.loadMap();
        const built = buildMapRoutes(items, plan); if (!built.routes.length) return '';
        const holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:1100px;height:620px;';
        document.body.appendChild(holder);
        const ctl = assets.SeaMap.create(holder, { land: assets.land, zones: ctx.sea.Eca ? ctx.sea.Eca.ZONES.filter((z) => built.ids.includes(z.id)) : [], areas: built.areas });
        ctl.setRoutes(built.routes);
        const url = ctl.toDataURL(); ctl.destroy(); holder.remove();
        const legend = built.info.map((i) => `<div><span style="color:${i.color}">■</span> ${esc(i.text)}</div>`).join('');
        return `<section class="pr-section" style="page-break-inside:avoid"><h3 class="pr-section-title">Route map</h3><div class="pr-section-body">`
          + `<img src="${url}" alt="Route map" style="width:100%;height:auto;display:block;border:1px solid #999">`
          + `<div style="font-size:9pt;margin-top:4px">${legend}</div>`
          + `<div style="font-size:8pt;margin-top:3px">Orange: stretches inside an ECA (outlines for planning, not the official limits). Planning picture from a coarse sea-lane network and a generalised coastline (Natural Earth), not a chart and not for navigation. Port data: NGA World Port Index (Pub. 150), U.S. Government work in the public domain, provided as is; no NGA endorsement.</div></div></section>`;
      } catch (e) { console.warn('route map for the printout', e); return ''; }
    }
    async function showMap(items) {
      if (!ctx.sea || !mapGroups(items).length) { toast('Pick From and To ports from the list to see a route on the map'); return; }
      let assets; try { assets = await ctx.sea.loadMap(); } catch (e) { toast('The map could not be loaded'); return; }
      const SM = assets.SeaMap;
      const built = buildMapRoutes(items, ctx.plan); const routes = built.routes; const ids = built.ids;
      const info = built.info.map((i) => `<span style="color:${i.color}">■</span> ${esc(i.text)}`);
      if (!routes.length) { toast('No route could be drawn'); return; }
      const ov = document.createElement('div'); ov.className = 'cp-mapov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Route map');
      ov.innerHTML = `<div class="cp-mapbar"><strong>Route map</strong>
        <label><input type="checkbox" data-map="eca" checked> ECA zones</label><label><input type="checkbox" data-map="areas" checked> Avoided areas</label>
        <button type="button" class="${ui.btn}" data-map="in" aria-label="Zoom in">+</button><button type="button" class="${ui.btn}" data-map="out" aria-label="Zoom out">−</button>
        <button type="button" class="${ui.btn}" data-map="fit">Fit</button>
        <button type="button" class="${ui.btn} cp-strong" data-map="edit" title="Drag the waypoints like on an ECDIS, add one from the + on a leg, double-click one to remove it">Edit route</button>
        <span class="cp-mapedit" hidden>${routes.length > 1 ? `<select data-map="which" aria-label="Route to edit">${routes.map((r, i) => `<option value="${i}">${esc(r.from.name)} → ${esc(r.to.name)}</option>`).join('')}</select>` : ''}
          <button type="button" class="${ui.primary}" data-map="apply" title="Use this route and recalculate the lines">Apply and recalculate</button>
          <button type="button" class="${ui.btn}" data-map="delwp" title="Remove the selected waypoint (or double-click it)">Delete waypoint</button>
          <button type="button" class="${ui.btn}" data-map="reset" title="Throw away your waypoints: back to the automatic route">Back to automatic</button>
          <button type="button" class="${ui.btn}" data-map="cancel">Cancel</button></span>
        <button type="button" class="${ui.primary}" data-map="close">Close</button>
        <div class="cp-mapinfo">${info.join('<br>')}</div><div class="cp-mapedithint" hidden>Drag a white dot to move a waypoint; drag a + to add one; double-click a waypoint to remove it. Red leg: crosses land. Yellow dashed: close to land.</div></div><div class="cp-mapcanvas"></div>
        <div class="cp-mapnote">Planning picture from a coarse sea-lane network and a generalised coastline (Natural Earth), not a chart and not for navigation. ECA zones follow the published coordinates; avoided areas are approximate boxes.</div>`;
      document.body.appendChild(ov);
      const areas = built.areas;
      const ctl = SM.create(ov.querySelector('.cp-mapcanvas'), { land: assets.land, zones: ctx.sea.Eca ? ctx.sea.Eca.ZONES.filter((z) => ids.includes(z.id)) : [], areas });
      ctl.setRoutes(routes);
      const close = () => { ctl.destroy(); ov.remove(); document.removeEventListener('keydown', onKey); };
      let ed = null, edRoute = null; const bar = ov.querySelector('.cp-mapedit'), hint = ov.querySelector('.cp-mapedithint'), infoEl = ov.querySelector('.cp-mapinfo');
      const infoHtml = () => info.join('<br>');
      const stopEdit = () => { if (ed) ed.stop(); ed = null; ctl.setRoutes(routes); bar.hidden = true; hint.hidden = true; ov.querySelector('[data-map="edit"]').hidden = false; infoEl.innerHTML = infoHtml(); };
      const startEdit = (idx) => {
        if (ed) ed.stop();
        const r = routes[idx]; edRoute = r;
        ctl.setRoutes(routes.filter((x) => x !== r));
        const live = (wps) => {
          const pts = [[r.from.lat, r.from.lon]].concat(wps, [[r.to.lat, r.to.lon]]); let nm = 0; for (let i = 1; i < pts.length; i++) nm += gcNm(pts[i - 1], pts[i]);
          const m = ctx.sea.Eca ? ctx.sea.Eca.measure(pts, ids) : { runs: [], ecaNm: 0 };
          infoEl.innerHTML = `<strong>${esc(r.from.name)} → ${esc(r.to.name)}</strong>: ${fmtN(nm, 0)} nm${m.ecaNm >= 1 ? ` · ECA ${fmtN(m.ecaNm, 0)} nm` : ''} · ${wps.length} waypoint${wps.length === 1 ? '' : 's'}`;
          return { ecaRuns: m.runs };
        };
        ed = ctl.edit({ from: r.from, to: r.to, color: r.color, wps: r.waypoints, onChange: live, crosses: (p, q) => (ctx.sea.router.segmentCheck ? ctx.sea.router.segmentCheck(p, q) : { land: false, near: false }) });
        bar.hidden = false; hint.hidden = false; ov.querySelector('[data-map="edit"]').hidden = true;
      };
      const onKey = (e) => { if (e.key === 'Escape') { if (ed) stopEdit(); else close(); } else if ((e.key === 'Delete' || e.key === 'Backspace') && ed && ed.selected() >= 0) { e.preventDefault(); ed.removeSelected(); } };
      document.addEventListener('keydown', onKey);
      ov.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.map === 'which' && ed) startEdit(Number(e.target.value)); });
      ov.addEventListener('click', (e) => {
        const k = e.target.dataset && e.target.dataset.map; if (!k) return;
        if (k === 'edit') startEdit(0);
        else if (k === 'which') return;
        else if (k === 'cancel') stopEdit();
        else if (k === 'delwp') { if (ed && !ed.removeSelected()) toast('Click a waypoint first'); }
        else if (k === 'reset') { if (!edRoute) return; const m = ctx.plan.sea.manual; delete m[edRoute.aId + '|' + edRoute.bId]; delete m[edRoute.bId + '|' + edRoute.aId]; const n = recalcRoute(edRoute.aId, edRoute.bId); renderGrid(); scheduleSave(); close(); toast(n ? 'Automatic route restored: ' + n + ' route' + (n === 1 ? '' : 's') + ' recalculated' : 'Automatic route restored'); }
        else if (k === 'apply') {
          if (!ed || !edRoute) return; const wps = ed.get(); const key = edRoute.aId + '|' + edRoute.bId;
          const m = ctx.plan.sea.manual; delete m[edRoute.bId + '|' + edRoute.aId]; if (wps.length) m[key] = wps; else delete m[key];
          const n = recalcRoute(edRoute.aId, edRoute.bId); renderGrid(); scheduleSave(); close();
          toast(n ? 'Your route is used: ' + n + ' route' + (n === 1 ? '' : 's') + ' recalculated' : 'Your route is saved, but no line uses these ports yet');
        }
        else if (k === 'close') close(); else if (k === 'in') ctl.zoom(1.6); else if (k === 'out') ctl.zoom(1 / 1.6); else if (k === 'fit') ctl.fit();
        else if (k === 'eca') ctl.set({ showEca: e.target.checked }); else if (k === 'areas') ctl.set({ showAreas: e.target.checked });
      });
    }
    function seaOptsHtml() {
      if (!ctx.sea) return '';
      const SR = ctx.sea.SeaRoute; const av = new Set(ctx.plan.sea.avoid); const ar = new Set(ctx.plan.sea.areas);
      const chk = (kind, id, label, on) => `<label><input type="checkbox" data-sea-${kind}="${esc(id)}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
      const passes = SR.PASSAGES.map((p) => chk('avoid', p.id, p.label, av.has(p.id))).join('');
      const areas = SR.AREAS.map((a) => chk('area', a.id, a.label, ar.has(a.id))).join('');
      const onNow = new Set(ecaIdsFor(ctx.plan));
      const ecaBoxes = ctx.sea.Eca ? ctx.sea.Eca.ZONES.map((z) => chk('eca', z.id, z.label + (z.from && !ctx.sea.Eca.inForce(ctx.plan.date).includes(z.id) ? ' · from ' + z.from : ''), onNow.has(z.id))).join('') : '';
      const autoFuel = defaultEcaFuel(ctx.fuels);
      const ecaFuelOptions = `<option value="">${autoFuel ? '— automatic: ' + esc(autoFuel) + ' —' : '— keep the fuel —'}</option>` + ctx.fuels.map((f) => `<option value="${esc(f.id)}" ${f.id === ctx.plan.sea.ecaFuel ? 'selected' : ''}>${esc(f.id)}</option>`).join('');
      return `<details class="cp-seaopts" ${ctx.seaOpen ? 'open' : ''}><summary>Distance from ports · route options</summary>
        <div class="cp-seanote">Type a few letters in From / To and pick the port: the distance is filled in offline (a distance you type is never replaced). Port stays have no distance.</div>
        <fieldset><legend>Avoid passages</legend>${passes}</fieldset>
        <fieldset><legend>Keep out of areas (approximate boxes you choose, not official designations)</legend>${areas}</fieldset>
        <fieldset><legend>Measure the distance inside these ECA zones (IMO coordinates: North America, US Caribbean, North-East Atlantic, Canadian Arctic, Norwegian Sea, and the Mediterranean wording of MEPC.361(79); China follows the Ministry of Transport scheme; Baltic and North Sea are drawn from the regulation wording)</legend>${ecaBoxes}</fieldset>
        <fieldset><legend>ECA lines</legend>
          <label><input type="checkbox" data-sea-autosplit ${ctx.plan.sea.autoSplit !== false ? 'checked' : ''}> Split a line automatically where its route enters or leaves an ECA: one line outside (normal fuel), one inside (ECA fuel)</label>
          <label><input type="checkbox" data-sea-minecas ${ctx.plan.sea.minEca ? 'checked' : ''}> Keep the route out of the ECA as far as it is cheap (saves distillate): accept up to <input type="number" min="1" max="50" step="1" style="width:4em" data-sea-minecapct value="${ctx.plan.sea.minEcaPct || 10}"> % longer distance</label>
          <label>Fuel 1 on the ECA lines becomes <select data-sea-ecafuel>${ecaFuelOptions}</select></label>
          <label><input type="checkbox" data-sea-pilotsplit ${ctx.plan.sea.pilotSplit !== false ? 'checked' : ''}> Also split off the pilot areas: the first and last <input type="number" min="1" max="50" step="1" style="width:4em" data-sea-pilotnm value="${ctx.plan.sea.pilotNm || 10}"> nm of the route become their own lines (port → pilot drop-off point, pilot pick-up point → port), so slow manoeuvring has its own MT/day</label></fieldset>
        <fieldset><legend>Route</legend><label><input type="checkbox" data-sea-greatcircle ${ctx.plan.sea.greatCircle !== false ? 'checked' : ''}> Shortest route: great-circle legs wherever the sea is open (recommended)</label></fieldset>
        <fieldset><legend>Approach</legend><label>Add <input type="number" min="0" max="100" step="1" style="width:4.5em" data-sea-approach value="${ctx.plan.sea.approachNm || ''}" placeholder="0"> nm at each end for the pilot station / port approach (published tables often measure from pilot station to pilot station; leave empty for the shortest route)</label></fieldset>
        <fieldset><legend>Printout</legend><label><input type="checkbox" data-sea-printmap ${ctx.plan.sea.printMap !== false ? 'checked' : ''}> Include the route map on the printout</label></fieldset>
        <div class="cp-seanote">Planning estimate: a coarse sea-lane network, shortened by great-circle legs where the sea is open (checked against a generalised coastline). Not for navigation. Arctic routes are never used.</div>
        <div class="cp-seanote"><strong>Port data</strong>: derived from the World Port Index (Pub. 150) of the U.S. National Geospatial-Intelligence Agency (NGA), a U.S. Government work in the public domain (17 U.S.C. § 105). Provided “as is”, without warranty as to accuracy, currency or completeness (10 U.S.C. § 456). For general information and planning only: not an official NGA navigational product and not for primary navigation or passage planning; consult current charts, Sailing Directions, Notices to Mariners and port authorities. No endorsement by NGA or the U.S. Government is implied (10 U.S.C. § 425). <strong>Sea lanes</strong>: Eurostat SeaRoute network (EUPL-1.2, based on Oak Ridge National Laboratory data, 2000).</div>
      </details>`;
    }
    function seaNotesHtml(sec) {
      const rows = sec.legs.map((l, i) => {
        if (!l.distAuto || !l.seaNote) return '';
        const eca = l.ecaNm > 0 ? ` · ECA: ${fmtN(l.ecaNm, 0)} of ${fmtN(l.distance, 0)} nm (${esc(l.ecaZones)})` : '';
        const split = l.ecaNm > 0 && Array.isArray(l.ecaRuns) && l.ecaRuns.length > 1
          ? ` <button type="button" class="${ui.btn}" data-act="eca-split" data-row="${i}" title="Replace this line by one line per stretch, outside and inside the ECA">Split into ECA / non-ECA lines</button>` : '';
        const map = l.routeFrom && l.routeTo ? ` <button type="button" class="${ui.btn}" data-act="sea-map" data-row="${i}" title="Show this route on a map">Map</button>` : '';
        return `<div class="cp-seanote">◆ ${esc(l.from)} → ${esc(l.to)}: ${fmtN(l.distance, 0)} nm ${esc(l.seaNote)}${eca}${split}${map}</div>`;
      });
      const tools = [];
      sec.legs.forEach((l, i) => {
        if (!l.grp || (i > 0 && sec.legs[i - 1].grp && sec.legs[i - 1].grp.id === l.grp.id)) return;
        let n = 1; while (i + n < sec.legs.length && sec.legs[i + n].grp && sec.legs[i + n].grp.id === l.grp.id) n++;
        tools.push(`<div class="cp-seanote cp-grouptools">Route ${esc(l.grp.from)} → ${esc(l.grp.to)} is split into ${n} line${n === 1 ? '' : 's'}${(ctx.plan.sea.manual || {})[l.grp.fromPort + '|' + l.grp.toPort] || (ctx.plan.sea.manual || {})[l.grp.toPort + '|' + l.grp.fromPort] ? ' (on your own route)' : ''}: <button type="button" class="${ui.btn} cp-strong" data-act="sea-recalc-group" data-row="${i}" title="Work this route again from its ports and split it again">Recalculate this route</button> <button type="button" class="${ui.btn}" data-act="merge-group" data-row="${i}" title="Replace these lines by one line again">Back to one line</button></div>`);
      });
      return rows.join('') + tools.join('');
    }
    function gridHtml() {
      const plan = ctx.plan;
      const slots = plan.fuelSlots;
      const c = chain(plan);
      const multi = c.sections.length > 1;
      return `<div class="bunker-leg-actions cp-slotbar">
          <button type="button" class="${ui.btn}" data-act="add-fuel" ${slots >= MAX_SLOTS ? 'disabled' : ''} title="Another fuel on every line">+ Fuel column</button>
          <button type="button" class="${ui.btn}" data-act="remove-fuel" ${slots <= 1 ? 'disabled' : ''}>− Fuel column</button>
          <button type="button" class="${ui.btn}" data-act="add-voyage" ${c.sections.length >= MAX_LEGS ? 'disabled' : ''} title="A following voyage leg that starts with the ROB this one ends with">+ Next voyage leg</button>
          <button type="button" class="${ui.btn}" data-act="remove-voyage" ${multi ? '' : 'disabled'}>− Last voyage leg</button>
        </div>
        ${seaOptsHtml()}
        ${multi ? `<h3 class="cp-ov-title">All voyage legs side by side</h3><div data-cp="overview">${overviewHtml(plan)}</div>` : ''}
        ${c.sections.map((cs, si) => sectionHtml(cs, si, multi)).join('')}`;
    }
    function renderGrid() {
      const g = $('[data-cp="grid"]');
      if (!g) return;
      if (!ctx.plan.sea || !Array.isArray(ctx.plan.legs)) ctx.plan = ensurePlan(ctx.plan, ctx.fuels); // a plan without its route options would stop the page drawing
      const keep = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
      const at = keep ? { sec: secIndexOf(keep), row: keep.closest('tr') && keep.closest('tr').dataset.row, f: keep.dataset.f, s: keep.dataset.s, sf: keep.dataset.sf, grade: keep.dataset.grade, cp: keep.dataset.cp } : null;
      g.innerHTML = gridHtml();
      if (at) {
        let sel = null;
        const pre = `[data-sec="${at.sec}"] `;
        if (at.sf) sel = `${pre}[data-sf="${at.sf}"][data-grade="${at.grade}"]`;
        else if (at.f && at.row != null) sel = `${pre}tr[data-row="${at.row}"] [data-f="${at.f}"]${at.s != null ? `[data-s="${at.s}"]` : ''}`;
        else if (at.cp === 'legTitle') sel = `${pre}[data-cp="legTitle"]`;
        const el = sel && g.querySelector(sel);
        if (el && el.focus) el.focus();
      }
    }
    /** Typing: refresh quantities and results in place, without redrawing (a redraw would drop the box being tapped). */
    function syncAll() {
      const c = chain(ctx.plan);
      host.querySelectorAll('[data-sec]').forEach((el) => {
        const si = Number(el.dataset.sec); const sec = secAt(si); const cs = c.sections[si];
        if (!sec || !cs) return;
        el.querySelectorAll('tr[data-row]').forEach((tr) => {
          const leg = sec.legs[Number(tr.dataset.row)];
          if (!leg) return;
          const daysEl = tr.querySelector('[data-f="days"]');
          if (daysEl && document.activeElement !== daysEl) daysEl.value = daysShown(leg, legDays(leg));
          leg.fuels.slice(0, ctx.plan.fuelSlots).forEach((f, s) => {
            const q = tr.querySelector(`[data-qty="${s}"]`);
            if (q) q.value = fuelQty(leg, f) == null ? '' : fmtFuel(fuelQty(leg, f));
          });
          ['distance', 'speed'].forEach((f) => { const inp = tr.querySelector(`[data-f="${f}"]`); if (inp) inp.disabled = !!leg.port; });
          const dEl = tr.querySelector('[data-f="distance"]');
          if (dEl && document.activeElement !== dEl) dEl.value = leg.distance == null ? '' : leg.distance;
          if (dEl) dEl.classList.toggle('cp-auto', !!leg.distAuto);
        });
        const rc = el.querySelector('[data-results="route"]'); if (rc) rc.innerHTML = routeCardsHtml(cs.route);
        el.querySelectorAll('[data-results]:not([data-results="route"])').forEach((r) => {
          const sum = cs.sums[normGrade(r.dataset.results)];
          if (!sum) return;
          r.innerHTML = gradeCardsHtml(sum);
          const st = el.querySelector(`[data-stem="${r.dataset.results}"]`);
          if (st) st.textContent = stemText(r.dataset.results, sum);
        });
        el.querySelectorAll('[data-chained]').forEach((inp) => {
          const sum = cs.sums[normGrade(inp.dataset.chained)];
          inp.value = sum && sum.rob != null ? fmtFuel(sum.rob) : '';
        });
      });
      const ov = $('[data-cp="overview"]'); if (ov) ov.innerHTML = overviewHtml(ctx.plan);
    }
    function gradesSignature() { return gradesInUse(ctx.plan).map(normGrade).join('|'); }

    function renderHistory() {
      const panel = $('[data-cp="history"]');
      if (!panel) return;
      const body = $('[data-cp="history-body"]');
      const cnt = $('[data-cp="history-count"]');
      if (cnt) cnt.textContent = '(' + ctx.history.length + ')';
      if (!ctx.history.length) { panel.style.display = 'none'; return; }
      panel.style.display = '';
      const q = (($('[data-cp="history-search"]') || {}).value || '').trim().toLowerCase();
      const rows = [];
      ctx.history.forEach((h, i) => {
        const date = h.date || (h.savedAt ? String(h.savedAt).slice(0, 10) : '—');
        const hay = [date, h.savedAt, h.voyageNo, h.saveName, h.remarks].join(' ').toLowerCase();
        if (q && !hay.includes(q)) return;
        const plan = ensurePlan(h, ctx.fuels);
        const req = combined(plan).grades.map((g) => `${esc(g.grade)} ${fmtFuel(g.required)}`).join(' · ') || '—';
        rows.push(`<tr><td>${esc(date)}</td><td>${esc(h.saveName || '—')}</td><td>${esc(h.voyageNo || '—')}</td><td>${req} MT req</td>`
          + `<td><button type="button" class="${ui.btn}" data-hist="load" data-i="${i}">Load</button> <button type="button" class="${ui.btn}" data-hist="print" data-i="${i}">Print</button> `
          + `<button type="button" class="${ui.btn}" data-hist="del" data-i="${i}">Del</button></td></tr>`);
      });
      body.innerHTML = rows.length ? rows.join('') : '<tr class="empty-row"><td colspan="5">No saved calculation matches your search.</td></tr>';
    }

    function pageHtml() {
      const nav = (A.buttons || []).map((b) => `<button type="button" class="${ui.btn}" data-btn="${esc(b.id)}" ${b.hidden ? 'style="display:none;"' : ''}>${esc(b.label)}</button>`).join('');
      return `<div class="${ui.panel} bc-page no-print">
        <h2 class="bc-page-title">Bunker Consumption Calculation</h2>
        <div class="hint cp-hint">Plan fuel burn by voyage leg. Type the route once; on each line pick the fuel burned and its MT per day (add a fuel column for a third fuel).
          Sea days = Distance ÷ (Speed × 24); quantity = MT per day × days; each line can carry its own margin %. Port or anchorage days are typed in. A fuel burned as needed
          (for example LSMGO) is just its average MT per day. A voyage that follows another is a next voyage leg: it starts with the ROB the leg before ends with, and all legs are shown side by side with the combined total.</div>
        <div class="bunker-plan-head">
          <div class="field"><label>Vessel</label><input data-cp="vessel" readonly></div>
          <div class="field"><label>Voyage No.</label><input data-cp="voyageNo"></div>
          <div class="field"><label>Date</label><input type="date" data-cp="date"></div>
          <div class="btn-row" style="margin:0;">${nav}<button type="button" class="${ui.btn}" data-btn="clear">Clear</button></div>
        </div>
        <datalist id="cp-ports"></datalist>
        <div data-cp="grid"></div>
        <div class="bunker-plan-footer">
          <label class="bunker-remarks"><span>Remarks</span><textarea data-cp="remarks" rows="4" placeholder="Remarks for this calculation"></textarea></label>
          <div class="btn-row bunker-plan-actions">
            <button type="button" class="${ui.btn}" data-btn="save">Save</button>
            <button type="button" class="${ui.btn}" data-btn="print">Print</button>
            <button type="button" class="${ui.primary}" data-btn="save-print">Save &amp; Print</button>
          </div>
        </div>
      </div>
      <div class="${ui.hist} no-print" data-cp="history" style="display:none;">
        <details class="hist-fold">
          <summary><h2 class="bc-page-title">Saved Calculations <span class="hist-count" data-cp="history-count"></span></h2><span class="hist-tap">tap to open</span></summary>
          <input type="search" class="hist-search" data-cp="history-search" placeholder="Search by date, name or description" aria-label="Search saved calculations" autocomplete="off">
          <div class="scroll-x table-scroll"><table>
            <thead><tr><th>Date</th><th>Name</th><th>Voyage</th><th>Required</th><th></th></tr></thead>
            <tbody data-cp="history-body"></tbody>
          </table></div>
        </details>
      </div>`;
    }

    /* ---- actions ---- */
    function sheetHtml(plan, mapHtml) {
      const vessel = (A.vesselName && A.vesselName()) || '';
      const voyageNo = plan.voyageNo || '—';
      const meta = (A.printMetaGrid || ((items) => items.map((i) => `${esc(i.label)}: ${i.value}`).join(' · ')));
      const metaItems = [{ label: 'Voyage No.', value: esc(voyageNo) }, { label: 'Date', value: esc(plan.date || '—') }, { label: 'Vessel', value: esc(vessel) }]
        .concat((A.printExtraMeta && A.printExtraMeta()) || []);
      return { vessel, voyageNo, html: `${A.printHeader ? A.printHeader({ vessel, voyageNo }) : ''}${meta(metaItems, 4)}${printBody(plan, ctx.fuels, mapHtml && !A.printMapSeparate ? Object.assign({}, A, { mapHtml }) : A)}${A.printSignature ? A.printSignature() : ''}` };
    }
    async function doPrint(plan) {
      const mapHtml = await printMapHtml(plan);
      const s = sheetHtml(plan, mapHtml);
      if (A.printSheet) A.printSheet(s.html, plan, { mapHtml: A.printMapSeparate ? mapHtml : '' });
    }
    async function askName() {
      if (A.askName) return A.askName(ctx.plan);
      return ctx.plan.saveName || '';
    }
    async function saveToHistory(name) {
      const snap = finalize(ctx.plan);
      snap.saveName = name == null ? (ctx.plan.saveName || '') : name;
      snap.savedAt = new Date().toISOString();
      ctx.plan.saveName = snap.saveName;
      ctx.history.unshift(snap);
      if (ctx.history.length > 50) ctx.history.length = 50;
      await persistNow();
      renderHistory();
    }
    /** Put the ROB of the log or the tanks into the first voyage leg. `rob` is { gradeName: MT }. Every fuel the vessel has gets its figure, also one no line burns yet.
     *  A figure is matched by grade name; one that matches no fuel of the vessel goes to the vessel's only fuel of the same kind (residual / distillate), else it is reported.
     *  Returns { loaded: [{ grade, mt }], unmatched: [{ grade, mt }] }. */
    function loadRob(rob) {
      refreshFuels();
      const entries = Object.keys(rob || {}).map((k) => ({ k, mt: Number(rob[k]) || 0, used: false })).filter((e) => e.mt > 0);
      const targets = ctx.fuels.map((f) => f.id);
      gradesInUse(ctx.plan).forEach((g) => { if (!targets.some((x) => normGrade(x) === normGrade(g))) targets.push(g); });
      const got = new Map();
      targets.forEach((g) => { // exact (or same-name) matches first
        entries.forEach((e) => { if (normGrade(e.k) === normGrade(g)) { got.set(g, (got.get(g) || 0) + e.mt); e.used = true; } });
      });
      entries.filter((e) => !e.used && /FO\b|HFO|IFO|MGO|MDO|MFO|GAS ?OIL|DISTIL|RESID|DMA|DMB|DMZ|BUNKER|FUEL/i.test(e.k)).forEach((e) => { // then by kind, when it is a fuel name and there is no doubt which fuel it is
        const fam = familyOf(e.k); const cands = targets.filter((g) => familyOf(g) === fam && !got.has(g));
        const sameKind = targets.filter((g) => familyOf(g) === fam);
        if (cands.length === 1 || (sameKind.length === 1)) { const g = cands.length === 1 ? cands[0] : sameKind[0]; got.set(g, (got.get(g) || 0) + e.mt); e.used = true; }
      });
      const loaded = [];
      got.forEach((v, g) => {
        const key = normGrade(g);
        ctx.plan.stocks[key] = Object.assign(ctx.plan.stocks[key] || {}, { label: g, currentRob: Math.round(v * 1000) / 1000 });
        loaded.push({ grade: g, mt: Math.round(v * 1000) / 1000 });
      });
      renderGrid(); scheduleSave();
      return { loaded, unmatched: entries.filter((e) => !e.used).map((e) => ({ grade: e.k, mt: e.mt })) };
    }

    host.innerHTML = pageHtml();
    const set = (sel, v) => { const el = $(sel); if (el) el.value = v; };
    set('[data-cp="vessel"]', (A.vesselName && A.vesselName()) || '');
    set('[data-cp="voyageNo"]', ctx.plan.voyageNo || '');
    set('[data-cp="date"]', ctx.plan.date || '');
    set('[data-cp="remarks"]', ctx.plan.remarks || '');
    renderGrid();
    renderHistory();

    /* ---- drag a line to another place (mouse, finger or pen), or move it with the arrow keys ---- */
    let dragState = null;
    function clearDropMarks() { host.querySelectorAll('.cp-drop-before,.cp-drop-after,.cp-dragging').forEach((el) => el.classList.remove('cp-drop-before', 'cp-drop-after', 'cp-dragging')); }
    /** Where the pointer says the line goes: the number of rows (the dragged one excluded) that stay above it. */
    function dropIndex(tbody, fromTr, y) {
      const rows = [...tbody.querySelectorAll('tr[data-row]')].filter((r) => r !== fromTr);
      let pos = rows.length;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (y < b.top + b.height / 2) { pos = i; break; } }
      return { pos, rows };
    }
    host.addEventListener('pointerdown', (e) => {
      const h = e.target.closest && e.target.closest('[data-drag]');
      if (!h || !host.contains(h) || (e.button != null && e.button > 0)) return;
      const tr = h.closest('tr[data-row]'); if (!tr) return;
      e.preventDefault();
      dragState = { h, tr, tbody: tr.parentNode, si: secIndexOf(tr), from: Number(tr.dataset.row), pos: null, id: e.pointerId };
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
      tr.classList.add('cp-dragging');
    });
    host.addEventListener('pointermove', (e) => {
      if (!dragState || e.pointerId !== dragState.id) return;
      const { pos, rows } = dropIndex(dragState.tbody, dragState.tr, e.clientY);
      host.querySelectorAll('.cp-drop-before,.cp-drop-after').forEach((el) => el.classList.remove('cp-drop-before', 'cp-drop-after'));
      if (rows.length) { if (pos < rows.length) rows[pos].classList.add('cp-drop-before'); else rows[rows.length - 1].classList.add('cp-drop-after'); }
      dragState.pos = pos;
      if (e.clientY < 60) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 14); // scroll while dragging near the edge
    });
    function endDrag(e, cancel) {
      if (!dragState || (e && e.pointerId !== dragState.id)) return;
      const d = dragState; dragState = null;
      try { d.h.releasePointerCapture(d.id); } catch (_) {}
      clearDropMarks();
      if (cancel || d.pos == null) return;
      const sec = secAt(d.si);
      const to = d.pos; // the line ends up with `pos` lines above it
      const hadGroup = !!(sec.legs[d.from] && sec.legs[d.from].grp);
      if (moveLeg(sec, d.from, to)) { renderGrid(); scheduleSave(); toast(hadGroup ? 'Line moved; its route is no longer treated as one split route' : 'Line moved'); }
    }
    host.addEventListener('pointerup', (e) => endDrag(e, false));
    host.addEventListener('pointercancel', (e) => endDrag(e, true));
    host.addEventListener('keydown', (e) => {
      const h = e.target.closest && e.target.closest('[data-drag]');
      if (!h || !host.contains(h) || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const tr = h.closest('tr[data-row]'); const si = secIndexOf(tr); const sec = secAt(si); const from = Number(tr.dataset.row);
      const to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (moveLeg(sec, from, to)) {
        renderGrid(); scheduleSave();
        const el = host.querySelector(`[data-sec="${si}"] tr[data-row="${to}"] [data-drag]`); if (el && el.focus) el.focus();
      }
    });
    const onHostClick = async (e) => {
      const t = e.target.closest('[data-act],[data-btn],[data-hist]');
      if (!t || !host.contains(t)) return;
      const act = t.dataset.act;
      if (act === 'add-leg') { const sec = secAt(secIndexOf(t)); sec.legs.push(newLeg({ fuelSlots: ctx.plan.fuelSlots, legs: sec.legs }, ctx.fuels)); renderGrid(); scheduleSave(); return; }
      if (act === 'del-leg') {
        const sec = secAt(secIndexOf(t)); const i = Number(t.dataset.row);
        if (!sec.legs[i]) return;
        if (sec.legs.length > 1) sec.legs.splice(i, 1); else sec.legs[0] = newLeg({ fuelSlots: ctx.plan.fuelSlots, legs: sec.legs }, ctx.fuels);
        renderGrid(); scheduleSave(); return;
      }
      if (act === 'merge-group' || act === 'sea-recalc-group') {
        const sec = secAt(secIndexOf(t)); const u = routeUnits(sec).find((x) => x.group && x.start === Number(t.dataset.row));
        if (!u) return;
        if (act === 'sea-recalc-group' && unitEdited(sec, u) && !(await askYes('You typed a distance on one of these lines. Recalculating rebuilds the route from its ports and replaces it. Continue?', 'Recalculate'))) return;
        if (rebuildUnit(sec, u, act === 'merge-group')) { renderGrid(); scheduleSave(); toast(act === 'merge-group' ? 'Back to one line' : 'Route recalculated'); }
        return;
      }
      if (act === 'remove-leg') { const sec = secAt(secIndexOf(t)); if (sec.legs.length > 1) sec.legs.pop(); renderGrid(); scheduleSave(); return; }
      if (act === 'sea-map-all') { const items = []; sectionList(ctx.plan).forEach((sec, si) => sec.legs.forEach((leg) => items.push({ leg, si }))); showMap(items); return; }
      if (act === 'sea-map') { const si = secIndexOf(t); const leg = secAt(si).legs[Number(t.dataset.row)]; if (leg) showMap([{ leg, si }]); return; }
      if (act === 'eca-split') {
        const sec = secAt(secIndexOf(t)); const i = Number(t.dataset.row); const leg = sec.legs[i];
        if (!leg || !ctx.sea || !ctx.sea.Eca) return;
        const pieces = splitLegAtEca(leg, leg.ecaRuns, (z) => ctx.sea.Eca.label(z), ecaFuelNow(), splitOpts());
        if (!pieces) return;
        sec.legs.splice(i, 1, ...pieces); renderGrid(); scheduleSave();
        toast('Line split into ' + pieces.length + ' lines' + (ecaFuelNow() ? ': Fuel 1 is ' + ecaFuelNow() + ' on the ECA lines' : ''));
        return;
      }
      if (act === 'sea-recalc') {
        const edited = recalcEditedCount();
        if (edited && !(await askYes(edited + ' route' + (edited === 1 ? ' has' : 's have') + ' a distance you typed. Recalculate replaces it with the sea-lane distance (a split route is rebuilt, with the MT/day of its line outside the ECA). Continue?', 'Recalculate'))) return;
        const n = recalcAuto(true); renderGrid(); scheduleSave();
        toast(n ? n + ' distance' + (n === 1 ? '' : 's') + ' recalculated' : 'No automatic distances to recalculate: pick From and To ports from the list');
        return;
      }
      if (act === 'add-voyage') {
        if (sectionList(ctx.plan).length < MAX_LEGS) { (ctx.plan.extra = ctx.plan.extra || []).push(newSection(ctx.plan, ctx.fuels)); renderGrid(); scheduleSave(); }
        return;
      }
      if (act === 'remove-voyage') {
        const ex = ctx.plan.extra || [];
        if (!ex.length) return;
        const last = ex[ex.length - 1];
        const filled = last.legs.some((l) => !legIsBlank(l)) || Object.keys(last.stocks || {}).length;
        if (filled && !(await askYes('Remove the last voyage leg and its figures?', 'Remove'))) return;
        ex.pop(); if (!ex.length) delete ctx.plan.extra;
        renderGrid(); scheduleSave();
        return;
      }
      if (act === 'add-fuel') {
        if (ctx.plan.fuelSlots < MAX_SLOTS) { ctx.plan.fuelSlots++; normalizeLegs(ctx.plan); renderGrid(); scheduleSave(); }
        return;
      }
      if (act === 'remove-fuel') {
        if (ctx.plan.fuelSlots > 1) {
          const s = ctx.plan.fuelSlots - 1;
          const used = sectionList(ctx.plan).some((sec) => sec.legs.some((l) => l.fuels[s] && num(l.fuels[s].daily) != null));
          if (used && !(await askYes('The last fuel column has figures. Remove it?', 'Remove'))) return;
          ctx.plan.fuelSlots--; sectionList(ctx.plan).forEach((sec) => sec.legs.forEach((l) => { l.fuels.length = ctx.plan.fuelSlots; }));
          renderGrid(); scheduleSave();
        }
        return;
      }
      if (t.dataset.hist) {
        const i = Number(t.dataset.i); const h = ctx.history[i];
        if (!h) return;
        if (t.dataset.hist === 'load') {
          const snap = JSON.parse(JSON.stringify(h)); delete snap.savedAt;
          refreshFuels(); ctx.plan = ensurePlan(snap, ctx.fuels); conformToVessel();
          set('[data-cp="voyageNo"]', ctx.plan.voyageNo || ''); set('[data-cp="date"]', ctx.plan.date || ''); set('[data-cp="remarks"]', ctx.plan.remarks || '');
          renderGrid(); scheduleSave(); toast('Loaded saved calculation');
        } else if (t.dataset.hist === 'print') doPrint(ensurePlan(h, ctx.fuels));
        else if (t.dataset.hist === 'del' && await askYes('Delete this saved calculation?', 'Delete')) { ctx.history.splice(i, 1); await persistNow(); renderHistory(); }
        return;
      }
      const btn = t.dataset.btn;
      if (btn === 'clear') {
        if (!(await askYes('Clear the consumption plan? All lines and figures on this page are removed (saved calculations are kept).', 'Clear'))) return;
        const voyageNo = (A.voyageNo && A.voyageNo()) || ctx.plan.voyageNo || '';
        const keepSea = ctx.plan.sea ? Object.assign({}, ctx.plan.sea, { manual: {} }) : null; // the route options are settings, not figures: they stay
        refreshFuels();
        ctx.plan = ensurePlan(defaultPlan(ctx.fuels), ctx.fuels); if (keepSea) ctx.plan.sea = keepSea; ctx.plan.voyageNo = voyageNo; ctx.plan.date = new Date().toISOString().slice(0, 10);
        set('[data-cp="voyageNo"]', voyageNo); set('[data-cp="date"]', ctx.plan.date); set('[data-cp="remarks"]', '');
        renderGrid(); scheduleSave(); toast('Consumption plan cleared');
      } else if (btn === 'print') doPrint(ctx.plan);
      else if (btn === 'save' || btn === 'save-print') {
        const name = await askName();
        if (name === null) return;
        await saveToHistory(name);
        toast('Bunker plan saved');
        if (btn === 'save-print') doPrint(ctx.plan);
      } else {
        const b = (A.buttons || []).find((x) => x.id === btn);
        if (b && b.onClick) {
          const r = await b.onClick({ loadRob, plan: ctx.plan, render: renderGrid });
          if (r && r.changed != null) { renderGrid(); scheduleSave(); toast(r.changed ? r.message : r.empty); }
          if (r && r.rob) {
            const res = loadRob(r.rob); const mt = (x) => x.grade + ' ' + fmtN(x.mt, 1);
            if (res.loaded.length) toast((r.message || 'ROB loaded') + ': ' + res.loaded.map(mt).join(' · ') + ' MT' + (res.unmatched.length ? ' — not placed (this vessel has no such fuel): ' + res.unmatched.map(mt).join(' · ') : ''));
            else toast(res.unmatched.length ? 'Fuel found (' + res.unmatched.map(mt).join(' · ') + ' MT) but the vessel has no fuel of that name: check the fuel grades of its tanks' : (r.empty || 'No fuel weight found'));
          }
        }
      }
        };
    host.addEventListener('click', (e) => { onHostClick(e).catch((err) => { console.error('consumption plan', err); toast('That did not work (' + (err && err.message || err) + '). Nothing was changed; try again or reopen the page.'); }); });

    host.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cp === 'voyageNo') { ctx.plan.voyageNo = t.value.trim(); scheduleSave(); return; }
      if (t.dataset.cp === 'remarks') { ctx.plan.remarks = t.value; scheduleSave(); return; }
      if (t.dataset.cp === 'history-search') { renderHistory(); return; }
      if (t.dataset.cp === 'legTitle') { secAt(secIndexOf(t)).legTitle = t.value; syncAll(); scheduleSave(); return; }
      const tr = t.closest && t.closest('tr[data-row]');
      if (tr && t.dataset.f) {
        const rowSec = secAt(secIndexOf(t));
        const leg = rowSec.legs[Number(tr.dataset.row)];
        if (!leg) return;
        const f = t.dataset.f;
        if (f === 'from' || f === 'to') {
          leg[f] = t.value; leg.grp = null;
          if (ctx.sea) {
            const key = f === 'from' ? 'fromPort' : 'toPort';
            const port = ctx.portMap.get(t.value);
            if (port) {
              leg[key] = port.id;
              leg.grp = null; leg.keepWhole = false;
              if (autoDistance(leg)) {
                const k = autoSplitAt(rowSec, Number(tr.dataset.row));
                renderGrid(); scheduleSave();
                const fuelNote = ecaFuelNow() ? ': Fuel 1 is ' + ecaFuelNow() + ' on the ECA lines' : '';
                toast(k ? 'Distance filled and the line split into ' + k + ' lines at the ECA' + fuelNote : 'Distance filled from the sea lanes (planning estimate)');
                return;
              }
            } else {
              if (leg[key]) { leg[key] = null; if (leg.distAuto) { leg.distAuto = false; leg.seaNote = ''; leg.ecaNm = null; leg.ecaZones = ''; leg.ecaRuns = null; } }
              const dl = $('#cp-ports');
              if (dl) {
                const res = t.value.trim().length >= 2 ? ctx.sea.ports.search(t.value, { limit: 12 }) : [];
                res.forEach((p) => ctx.portMap.set(portLabel(p), p));
                dl.innerHTML = res.map((p) => `<option value="${esc(portLabel(p))}"></option>`).join('');
              }
            }
          }
        }
        else if (f === 'port') { /* handled on change */ }
        else if (f === 'grade') { /* handled on change */ }
        else if (f === 'daily') { leg.fuels[Number(t.dataset.s)].daily = num(t.value); }
        else {
          const v = num(t.value);
          if (f === 'days') { leg.days = v; leg.daysManual = v != null; }
          else {
            leg[f] = v;
            if (f === 'distance') { leg.distAuto = false; leg.seaNote = ''; leg.ecaNm = null; leg.ecaZones = ''; leg.ecaRuns = null; leg.routeFrom = null; leg.routeTo = null; }
            if (f === 'distance' || f === 'speed') { if (!leg.port) { leg.daysManual = false; leg.days = null; } }
          }
        }
        syncAll();
        if (f === 'daily') { const sig = gradesSignature(); if (sig !== ctx._sig) { ctx._sig = sig; renderGrid(); } }
        scheduleSave();
      } else if (t.dataset.sf) {
        const key = normGrade(t.dataset.grade);
        const sec = secAt(secIndexOf(t));
        if (!sec.stocks) sec.stocks = {};
        const st = sec.stocks[key] || (sec.stocks[key] = { label: t.dataset.grade });
        st[t.dataset.sf] = num(t.value);
        syncAll(); scheduleSave();
      }
    });
    host.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.cp === 'date') { ctx.plan.date = t.value; scheduleSave(); return; }
      if (t.dataset.seaApproach !== undefined) {
        const v = Number(t.value); ctx.plan.sea.approachNm = v > 0 ? Math.min(100, v) : 0;
        const n = recalcAuto(); renderGrid(); scheduleSave(); if (n) toast(n + ' distance' + (n === 1 ? '' : 's') + ' recalculated'); return;
      }
      if (t.dataset.seaGreatcircle !== undefined) { ctx.plan.sea.greatCircle = !!t.checked; const n = recalcAuto(); renderGrid(); scheduleSave(); if (n) toast(n + ' distance' + (n === 1 ? '' : 's') + ' recalculated'); return; }
      if (t.dataset.seaMinecas !== undefined) { ctx.plan.sea.minEca = !!t.checked; const n = recalcAuto(); renderGrid(); scheduleSave(); toast(n ? n + ' route' + (n === 1 ? '' : 's') + ' worked again' + (t.checked ? ' with fewer miles in the ECA' : '') : 'Pick From and To ports to see the effect'); return; }
      if (t.dataset.seaMinecapct !== undefined) { const v = Number(t.value); ctx.plan.sea.minEcaPct = v > 0 ? Math.min(50, v) : 10; if (ctx.plan.sea.minEca) { const n = recalcAuto(); renderGrid(); if (n) toast(n + ' route' + (n === 1 ? '' : 's') + ' worked again'); } scheduleSave(); return; }
      if (t.dataset.seaPilotsplit !== undefined) { ctx.plan.sea.pilotSplit = !!t.checked; scheduleSave(); return; }
      if (t.dataset.seaPilotnm !== undefined) { const v = Number(t.value); ctx.plan.sea.pilotNm = v > 0 ? Math.min(50, v) : 10; scheduleSave(); return; }
      if (t.dataset.seaAutosplit !== undefined) { ctx.plan.sea.autoSplit = !!t.checked; scheduleSave(); return; }
      if (t.dataset.seaPrintmap !== undefined) { ctx.plan.sea.printMap = !!t.checked; scheduleSave(); return; }
      if (t.dataset.seaEcafuel !== undefined) { ctx.plan.sea.ecaFuel = t.value; scheduleSave(); return; }
      if (t.dataset.seaAvoid !== undefined || t.dataset.seaArea !== undefined || t.dataset.seaEca !== undefined) {
        const isEca = t.dataset.seaEca !== undefined;
        const id = isEca ? t.dataset.seaEca : t.dataset.seaAvoid !== undefined ? t.dataset.seaAvoid : t.dataset.seaArea;
        const notYet = isEca && ctx.sea.Eca && !ctx.sea.Eca.inForce(ctx.plan.date).includes(id); // an area that takes effect later is off until the user switches it on
        const list = isEca ? (notYet ? ctx.plan.sea.ecaOn : ctx.plan.sea.ecaOff) : t.dataset.seaAvoid !== undefined ? ctx.plan.sea.avoid : ctx.plan.sea.areas;
        const i = list.indexOf(id);
        const on = isEca && !notYet ? !t.checked : t.checked; // an unticked ECA zone in force is switched off
        if (on && i < 0) list.push(id); else if (!on && i >= 0) list.splice(i, 1);
        const n = recalcAuto(); renderGrid(); scheduleSave();
        if (n) toast(n + ' distance' + (n === 1 ? '' : 's') + ' recalculated');
        return;
      }
      const tr = t.closest && t.closest('tr[data-row]');
      if (!tr || !t.dataset.f) return;
      const leg = secAt(secIndexOf(t)).legs[Number(tr.dataset.row)];
      if (!leg) return;
      if (t.dataset.f === 'port') {
        leg.port = !!t.checked;
        if (!leg.port) { leg.daysManual = false; leg.days = null; }
        renderGrid(); scheduleSave();
      } else if (t.dataset.f === 'grade') {
        leg.fuels[Number(t.dataset.s)].grade = t.value;
        ctx._sig = gradesSignature(); renderGrid(); scheduleSave();
      }
    });
    host.addEventListener('toggle', (e) => { if (e.target && e.target.classList && e.target.classList.contains('cp-seaopts')) ctx.seaOpen = e.target.open; }, true);
    if (A.sea && typeof A.sea === 'function') A.sea().then((x) => { ctx.sea = x; renderGrid(); }).catch((e) => console.warn('sea distance not available', e));
    ctx._sig = gradesSignature();
    return { render: renderGrid, plan: () => ctx.plan, persist: persistNow };
  }

  return {
    MAX_SLOTS, MAX_LEGS, FALLBACK_FUELS, sectionList, suggestDaily, chain, combined, newSection, overviewHtml, normGrade, familyOf, cleanFuels,
    emptyLeg, defaultPlan, newLeg, legIsBlank, legDays, fuelQty, fuelMargin, routeSummary, gradeSummary, gradesInUse, stockOf,
    ensurePlan, finalize, fromLegacy, toLegacy, legacySig, daysShown, printBody, fmtN, fmtFuel, routeCardsHtml, gradeCardsHtml,
    mount, seaLoader, splitLegAtEca, defaultEcaFuel,
  };
});
