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
  const FALLBACK_FUELS = [{ id: 'Residual', family: 'residual' }, { id: 'Distillate', family: 'distillate' }];

  /* ------------------------------------------------------------------ grades ---- */
  /** Same fuel under different names (VLSFO / LSFO, MGO / MDO/MGO) is one grade. */
  function normGrade(g) {
    const u = String(g == null ? '' : g).trim().toUpperCase();
    return ({ VLSFO: 'LSFO', ULSFO: 'LSFO', 'MO/MGO': 'MDO/MGO', MDO: 'MDO/MGO', MGO: 'MDO/MGO' })[u] || u;
  }
  /** Residual or distillate: only used to keep the older two-block shape and for the Residual / Distillate fallback. */
  function familyOf(g) {
    return /MGO|MDO|GAS ?OIL|DISTIL|DMA|DMB|DMZ/i.test(String(g || '')) ? 'distillate' : 'residual';
  }
  function cleanFuels(list) {
    const out = []; const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((f) => {
      const id = String((f && (f.id != null ? f.id : f.label)) || '').trim();
      if (!id || seen.has(normGrade(id))) return;
      seen.add(normGrade(id));
      out.push({ id, family: (f && f.family) || familyOf(id) });
    });
    return out.length ? out : FALLBACK_FUELS.slice();
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
    return { port: false, from: '', to: '', distance: null, speed: null, days: null, daysManual: false, marginPct: null, fuels };
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
    let daysPort = 0; let daysSea = 0; let totalDist = 0;
    (plan.legs || []).forEach((leg) => {
      const days = legDays(leg);
      const dist = Number(leg.distance);
      if (dist > 0) totalDist += dist;
      if (days != null) { if (leg.port) daysPort += days; else daysSea += days; }
    });
    return { daysPort, daysSea, totalDist };
  }

  function stockOf(plan, grade) {
    const s = (plan.stocks || {})[normGrade(grade)];
    return s || {};
  }
  /** The grades in use on the plan, in the order they first appear. */
  function gradesInUse(plan) {
    const out = []; const seen = new Set();
    const add = (g) => { const k = normGrade(g); if (k && !seen.has(k)) { seen.add(k); out.push(g); } };
    (plan.legs || []).forEach((leg) => (leg.fuels || []).forEach((f) => { if (f.grade && num(f.daily) != null) add(f.grade); }));
    Object.keys(plan.stocks || {}).forEach((k) => {
      const s = plan.stocks[k] || {};
      if (['currentRob', 'qtyReceive', 'deliveryRob', 'unpumpableMt', 'weatherMarginMt'].some((f) => num(s[f]) != null)) add(s.label || k);
    });
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

  function normalizeLegs(plan) {
    const slots = Math.max(1, Math.min(MAX_SLOTS, Number(plan.fuelSlots) || 2));
    plan.fuelSlots = slots;
    plan.legs = (Array.isArray(plan.legs) ? plan.legs : []).map((l) => {
      const leg = Object.assign(emptyLeg(slots), l);
      leg.port = !!leg.port;
      leg.from = leg.from || ''; leg.to = leg.to || '';
      leg.marginPct = (leg.marginPct == null || leg.marginPct === '' || isNaN(Number(leg.marginPct))) ? null : Number(leg.marginPct);
      const f = Array.isArray(leg.fuels) ? leg.fuels.map((x) => ({ grade: (x && x.grade) || '', daily: x && x.daily != null && x.daily !== '' ? Number(x.daily) : null })) : [];
      while (f.length < slots) f.push(emptyFuel());
      leg.fuels = f;
      return leg;
    });
    /* one trailing blank line is kept so "Add destination / stay" has a place to start; stray blanks are dropped */
    while (plan.legs.length > 1 && legIsBlank(plan.legs[plan.legs.length - 1]) && legIsBlank(plan.legs[plan.legs.length - 2])) plan.legs.pop();
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
        plan = re;
      }
    } else if (raw.residual || raw.distillate) plan = fromLegacy(raw, fuels);
    else plan = defaultPlan(fuels);
    plan.v = 2;
    if (typeof plan.remarks !== 'string') plan.remarks = plan.remarks == null ? '' : String(plan.remarks);
    if (!plan.stocks || typeof plan.stocks !== 'object') plan.stocks = {};
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
    ].join('');
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

  const STYLE = `
    .cp-route .bunker-table .col-fuel { width: 124px; min-width: 110px; }
    .cp-route .bunker-table .col-qty { width: 86px; min-width: 80px; }
    .cp-fuelbox { display: flex; flex-direction: column; gap: 3px; width: 100%; }
    .cp-fuelbox select, .cp-fuelbox input { display: block; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; }
    .cp-route .col-qty input { width: 100%; min-width: 0; }
    .cp-hint { margin-bottom: 12px; }
    .cp-slotbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
    .cp-route { margin: 10px 0; }
    .cp-grade-title { display: flex; align-items: baseline; gap: 8px; }
    .cp-grade-note { font-size: .8em; opacity: .75; }
  `;

  /* ------------------------------------------------------------------ print ---- */
  function printBody(plan, fuels, adapter) {
    const route = routeSummary(plan);
    const slots = plan.fuelSlots || 2;
    const metaGrid = adapter.printMetaGrid || ((items) => items.map((i) => `<div>${esc(i.label)}: ${i.value}</div>`).join(''));
    const head = ['<th style="width:5%">P/A</th>', '<th style="width:13%">From</th>', '<th style="width:13%">To</th>', '<th style="width:8%">Dist</th>', '<th style="width:8%">Speed</th>', '<th style="width:8%">Days</th>']
      .concat(Array.from({ length: slots }, (_, i) => `<th>Fuel ${i + 1}</th><th>MT/day</th><th>Qty MT</th>`))
      .concat(['<th style="width:7%">Margin %</th>']).join('');
    const rows = plan.legs.filter((l) => !legIsBlank(l) || (l.fuels || []).some((f) => fuelQty(l, f) != null)).map((l) => {
      const days = legDays(l);
      const cells = l.fuels.slice(0, slots).map((f) => {
        const q = fuelQty(l, f);
        return `<td>${esc(f.grade || '')}</td><td>${num(f.daily) != null ? fmtN(f.daily, 2) : ''}</td><td>${q != null ? fmtFuel(q) : ''}</td>`;
      }).join('');
      return `<tr><td>${l.port ? '●' : ''}</td><td class="row-lbl">${esc(l.from)}</td><td class="row-lbl">${esc(l.to)}</td>`
        + `<td>${l.distance != null ? fmtN(l.distance, 2) : ''}</td><td>${l.speed != null ? fmtN(l.speed, 2) : ''}</td>`
        + `<td>${days != null ? fmtN(days, 2) : ''}</td>${cells}<td>${l.marginPct != null ? fmtN(l.marginPct, 1) : ''}</td></tr>`;
    }).join('');
    const routeBlock = `<section class="pr-section"><h3 class="pr-section-title">Route and fuels</h3><div class="pr-section-body">
      <table class="pr-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
      ${metaGrid([
        { label: 'Days Port', value: fmtN(route.daysPort, 2) },
        { label: 'Days Sea', value: fmtN(route.daysSea, 2) },
        { label: 'Total Distance', value: fmtN(route.totalDist, 0) + ' nm' },
      ], 3)}</div></section>`;
    const grades = gradesInUse(plan).map((g) => {
      const s = gradeSummary(plan, g);
      const mt = (v) => (v == null ? '—' : fmtFuel(v) + ' MT');
      return `<section class="pr-section"><h3 class="pr-section-title">${esc(g)}</h3><div class="pr-section-body">
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
    }).join('');
    return routeBlock + grades
      + `<div class="pr-remarks"><div class="pr-remarks-title">Remarks</div><div class="pr-remarks-body">${esc(plan.remarks || '—')}</div></div>`
      + `<div class="pr-remarks"><div class="pr-remarks-title">Calculation basis</div><div class="pr-remarks-body">`
      + 'Sea days = Dist ÷ (Speed × 24). Quantity = MT per day × Days, for each fuel on the line. Each line may carry its own Margin % '
      + '(line margin = Qty × Margin%). Required = Σ Qty + Σ line margins. Arrival ROB = Current ROB − Required. '
      + 'Next Departure ROB = Arrival ROB + Qty to Receive. Order = Required + unpumpable + weather reserve − Current ROB.'
      + '</div></div>';
  }

  /* ------------------------------------------------------------------ the page ---- */
  function mount(host, adapter) {
    const A = adapter;
    const ui = Object.assign({ panel: 'form-panel', btn: 'btn small', primary: 'btn primary small', ghost: 'btn small', hist: 'form-panel' }, A.ui || {});
    const ctx = { fuels: cleanFuels(A.fuels ? A.fuels() : null), plan: null, history: [], timer: null };

    if (!document.getElementById('cp-style')) {
      const st = document.createElement('style'); st.id = 'cp-style'; st.textContent = STYLE; document.head.appendChild(st);
    }
    const data = A.load() || {};
    ctx.plan = ensurePlan(data.plan, ctx.fuels);
    ctx.history = Array.isArray(data.history) ? data.history : [];
    if (!ctx.plan.voyageNo) ctx.plan.voyageNo = (A.voyageNo && A.voyageNo()) || '';
    if (!ctx.plan.date) ctx.plan.date = new Date().toISOString().slice(0, 10);

    const $ = (sel) => host.querySelector(sel);
    const toast = (m) => { try { A.toast && A.toast(m); } catch (_) { /* ignore */ } };

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
        <td class="col-port"><input type="checkbox" data-f="port" ${leg.port ? 'checked' : ''} title="Port or anchorage stay"></td>
        <td class="col-from"><input type="text" data-f="from" value="${esc(leg.from)}" placeholder="From" autocomplete="off"></td>
        <td class="col-to"><input type="text" data-f="to" value="${esc(leg.to)}" placeholder="To / destination" autocomplete="off"></td>
        <td class="col-num"><input type="number" step="0.1" data-f="distance" value="${leg.distance ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
        <td class="col-num"><input type="number" step="0.1" data-f="speed" value="${leg.speed ?? ''}" ${leg.port ? 'disabled' : ''} inputmode="decimal"></td>
        <td class="col-num"><input type="number" step="0.001" data-f="days" value="${daysShown(leg, days)}" inputmode="decimal"></td>
        ${cells}
        <td class="col-margin"><input type="number" step="0.1" data-f="marginPct" value="${leg.marginPct ?? ''}" placeholder="%" title="Safety margin % for this destination / stay only" inputmode="decimal"></td>
      </tr>`;
    }
    function stockHtml(grade) {
      const st = stockOf(ctx.plan, grade);
      const g = esc(grade);
      const field = (f, label, title, cls) => `<div class="field ${cls || ''}"><label>${label}</label><input type="number" step="0.001" data-sf="${f}" data-grade="${g}" value="${st[f] ?? ''}"${title ? ` title="${title}"` : ''}></div>`;
      const sum = gradeSummary(ctx.plan, grade);
      return `<div class="bunker-side" data-grade="${g}">
        <h3 class="cp-grade-title">${g}</h3>
        <div class="bunker-totals">
          ${field('currentRob', 'Current ROB (MT)')}
          ${field('qtyReceive', 'Quantity to Receive (MT)')}
          ${field('unpumpableMt', 'Unpumpable (MT)', 'Oil that cannot be pumped out of the tanks; it is held back from the usable quantity')}
          ${field('weatherMarginMt', 'Weather reserve (MT)', 'Extra tonnes kept for bad weather')}
          ${field('deliveryRob', 'Delivery / Redelivery ROB (MT)', '', 'full')}
        </div>
        <div class="bunker-results" data-results="${g}">${gradeCardsHtml(sum)}</div>
        <div class="stem-advice" data-stem="${g}">${esc(stemText(grade, sum))}</div>
      </div>`;
    }
    function gridHtml() {
      const plan = ctx.plan;
      const slots = plan.fuelSlots;
      const head = Array.from({ length: slots }, (_, s) => `<th class="col-fuel">Fuel ${s + 1} · MT/day</th><th class="col-qty">Qty MT</th>`).join('');
      const grades = gradesInUse(plan);
      return `<div class="cp-route">
        <div class="table-scroll" role="region" aria-label="Route and fuels">
          <table class="bunker-table">
            <thead><tr>
              <th class="col-port" title="Check if port or anchorage">P/A</th><th class="col-from">From</th><th class="col-to">To</th>
              <th class="col-num">Dist nm</th><th class="col-num">Speed kn</th><th class="col-num">Days</th>
              ${head}
              <th class="col-margin" title="Optional reserve for this line only">Margin %</th>
            </tr></thead>
            <tbody>${plan.legs.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <div class="bunker-leg-actions cp-slotbar">
          <button type="button" class="${ui.btn}" data-act="add-leg">Add destination / stay</button>
          <button type="button" class="${ui.btn}" data-act="remove-leg" ${plan.legs.length <= 1 ? 'disabled' : ''}>Remove last line</button>
          <button type="button" class="${ui.btn}" data-act="add-fuel" ${slots >= MAX_SLOTS ? 'disabled' : ''} title="Another fuel on every line">+ Fuel column</button>
          <button type="button" class="${ui.btn}" data-act="remove-fuel" ${slots <= 1 ? 'disabled' : ''}>− Fuel column</button>
        </div>
        <div class="bunker-results" data-results="route">${routeCardsHtml(routeSummary(plan))}</div>
      </div>
      <div class="bunker-plan-grid">${grades.length ? grades.map(stockHtml).join('') : '<div class="hint">Pick a fuel and a MT/day on a line to see its quantities, ROB and stem advice.</div>'}</div>`;
    }
    function renderGrid() {
      const g = $('[data-cp="grid"]');
      if (!g) return;
      const keep = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
      const at = keep ? { row: keep.closest('tr') && keep.closest('tr').dataset.row, f: keep.dataset.f, s: keep.dataset.s, sf: keep.dataset.sf, grade: keep.dataset.grade } : null;
      g.innerHTML = gridHtml();
      if (at) {
        let sel = null;
        if (at.sf) sel = `[data-sf="${at.sf}"][data-grade="${at.grade}"]`;
        else if (at.f && at.row != null) sel = `tr[data-row="${at.row}"] [data-f="${at.f}"]${at.s != null ? `[data-s="${at.s}"]` : ''}`;
        const el = sel && g.querySelector(sel);
        if (el && el.focus) el.focus();
      }
    }
    /** Typing: refresh quantities and results in place, without redrawing (a redraw would drop the box being tapped). */
    function syncAll() {
      host.querySelectorAll('tr[data-row]').forEach((tr) => {
        const leg = ctx.plan.legs[Number(tr.dataset.row)];
        if (!leg) return;
        const daysEl = tr.querySelector('[data-f="days"]');
        if (daysEl && document.activeElement !== daysEl) daysEl.value = daysShown(leg, legDays(leg));
        leg.fuels.slice(0, ctx.plan.fuelSlots).forEach((f, s) => {
          const q = tr.querySelector(`[data-qty="${s}"]`);
          if (q) q.value = fuelQty(leg, f) == null ? '' : fmtFuel(fuelQty(leg, f));
        });
        ['distance', 'speed'].forEach((f) => { const el = tr.querySelector(`[data-f="${f}"]`); if (el) el.disabled = !!leg.port; });
      });
      const rc = $('[data-results="route"]'); if (rc) rc.innerHTML = routeCardsHtml(routeSummary(ctx.plan));
      host.querySelectorAll('[data-results]:not([data-results="route"])').forEach((el) => {
        const sum = gradeSummary(ctx.plan, el.dataset.results);
        el.innerHTML = gradeCardsHtml(sum);
        const st = host.querySelector(`[data-stem="${el.dataset.results}"]`);
        if (st) st.textContent = stemText(el.dataset.results, sum);
      });
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
        const req = gradesInUse(plan).map((g) => `${esc(g)} ${fmtFuel(gradeSummary(plan, g).required)}`).join(' · ') || '—';
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
          (for example LSMGO) is just its average MT per day.</div>
        <div class="bunker-plan-head">
          <div class="field"><label>Vessel</label><input data-cp="vessel" readonly></div>
          <div class="field"><label>Voyage No.</label><input data-cp="voyageNo"></div>
          <div class="field"><label>Date</label><input type="date" data-cp="date"></div>
          <div class="btn-row" style="margin:0;">${nav}<button type="button" class="${ui.btn}" data-btn="clear">Clear</button></div>
        </div>
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
    function sheetHtml(plan) {
      const vessel = (A.vesselName && A.vesselName()) || '';
      const voyageNo = plan.voyageNo || '—';
      const meta = (A.printMetaGrid || ((items) => items.map((i) => `${esc(i.label)}: ${i.value}`).join(' · ')));
      const metaItems = [{ label: 'Voyage No.', value: esc(voyageNo) }, { label: 'Date', value: esc(plan.date || '—') }, { label: 'Vessel', value: esc(vessel) }]
        .concat((A.printExtraMeta && A.printExtraMeta()) || []);
      return { vessel, voyageNo, html: `${A.printHeader ? A.printHeader({ vessel, voyageNo }) : ''}${meta(metaItems, 4)}${printBody(plan, ctx.fuels, A)}${A.printSignature ? A.printSignature() : ''}` };
    }
    function doPrint(plan) {
      const s = sheetHtml(plan);
      if (A.printSheet) A.printSheet(s.html, plan);
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
    function loadRob(rob) {
      /* rob: { gradeLabel: MT } from the log or the tanks. Matched by grade; the Residual / Distillate fallback takes its family. */
      let any = false;
      const entries = Object.keys(rob || {}).map((k) => [k, Number(rob[k]) || 0]);
      const pick = (grade) => {
        let v = 0;
        entries.forEach(([k, mt]) => { if (normGrade(k) === normGrade(grade)) v += mt; });
        if (!(v > 0) && FALLBACK_FUELS.some((f) => normGrade(f.id) === normGrade(grade))) {
          entries.forEach(([k, mt]) => { if (familyOf(k) === familyOf(grade)) v += mt; });
        }
        return v;
      };
      gradesInUse(ctx.plan).forEach((g) => {
        const v = pick(g);
        if (v > 0) {
          const key = normGrade(g);
          ctx.plan.stocks[key] = Object.assign(ctx.plan.stocks[key] || {}, { label: g, currentRob: Math.round(v * 1000) / 1000 });
          any = true;
        }
      });
      renderGrid(); scheduleSave();
      return any;
    }

    host.innerHTML = pageHtml();
    const set = (sel, v) => { const el = $(sel); if (el) el.value = v; };
    set('[data-cp="vessel"]', (A.vesselName && A.vesselName()) || '');
    set('[data-cp="voyageNo"]', ctx.plan.voyageNo || '');
    set('[data-cp="date"]', ctx.plan.date || '');
    set('[data-cp="remarks"]', ctx.plan.remarks || '');
    renderGrid();
    renderHistory();

    host.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-act],[data-btn],[data-hist]');
      if (!t || !host.contains(t)) return;
      const act = t.dataset.act;
      if (act === 'add-leg') { ctx.plan.legs.push(newLeg(ctx.plan, ctx.fuels)); renderGrid(); scheduleSave(); return; }
      if (act === 'remove-leg') { if (ctx.plan.legs.length > 1) ctx.plan.legs.pop(); renderGrid(); scheduleSave(); return; }
      if (act === 'add-fuel') {
        if (ctx.plan.fuelSlots < MAX_SLOTS) { ctx.plan.fuelSlots++; normalizeLegs(ctx.plan); renderGrid(); scheduleSave(); }
        return;
      }
      if (act === 'remove-fuel') {
        if (ctx.plan.fuelSlots > 1) {
          const s = ctx.plan.fuelSlots - 1;
          const used = ctx.plan.legs.some((l) => l.fuels[s] && num(l.fuels[s].daily) != null);
          if (used && !confirm('The last fuel column has figures. Remove it?')) return;
          ctx.plan.fuelSlots--; ctx.plan.legs.forEach((l) => { l.fuels.length = ctx.plan.fuelSlots; });
          renderGrid(); scheduleSave();
        }
        return;
      }
      if (t.dataset.hist) {
        const i = Number(t.dataset.i); const h = ctx.history[i];
        if (!h) return;
        if (t.dataset.hist === 'load') {
          const snap = JSON.parse(JSON.stringify(h)); delete snap.savedAt;
          ctx.plan = ensurePlan(snap, ctx.fuels);
          set('[data-cp="voyageNo"]', ctx.plan.voyageNo || ''); set('[data-cp="date"]', ctx.plan.date || ''); set('[data-cp="remarks"]', ctx.plan.remarks || '');
          renderGrid(); scheduleSave(); toast('Loaded saved calculation');
        } else if (t.dataset.hist === 'print') doPrint(ensurePlan(h, ctx.fuels));
        else if (t.dataset.hist === 'del' && confirm('Delete this saved calculation?')) { ctx.history.splice(i, 1); await persistNow(); renderHistory(); }
        return;
      }
      const btn = t.dataset.btn;
      if (btn === 'clear') {
        if (!confirm('Clear the consumption plan?')) return;
        const voyageNo = (A.voyageNo && A.voyageNo()) || ctx.plan.voyageNo || '';
        ctx.plan = defaultPlan(ctx.fuels); ctx.plan.voyageNo = voyageNo; ctx.plan.date = new Date().toISOString().slice(0, 10);
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
          if (r && r.rob) { const any = loadRob(r.rob); toast(any ? (r.message || 'ROB loaded') : (r.empty || 'No fuel weight found')); }
        }
      }
    });

    host.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.cp === 'voyageNo') { ctx.plan.voyageNo = t.value.trim(); scheduleSave(); return; }
      if (t.dataset.cp === 'remarks') { ctx.plan.remarks = t.value; scheduleSave(); return; }
      if (t.dataset.cp === 'history-search') { renderHistory(); return; }
      const tr = t.closest && t.closest('tr[data-row]');
      if (tr && t.dataset.f) {
        const leg = ctx.plan.legs[Number(tr.dataset.row)];
        if (!leg) return;
        const f = t.dataset.f;
        if (f === 'from' || f === 'to') leg[f] = t.value;
        else if (f === 'port') { /* handled on change */ }
        else if (f === 'grade') { /* handled on change */ }
        else if (f === 'daily') { leg.fuels[Number(t.dataset.s)].daily = num(t.value); }
        else {
          const v = num(t.value);
          if (f === 'days') { leg.days = v; leg.daysManual = v != null; }
          else {
            leg[f] = v;
            if (f === 'distance' || f === 'speed') { if (!leg.port) { leg.daysManual = false; leg.days = null; } }
          }
        }
        syncAll();
        if (f === 'daily') { const sig = gradesSignature(); if (sig !== ctx._sig) { ctx._sig = sig; renderGrid(); } }
        scheduleSave();
      } else if (t.dataset.sf) {
        const key = normGrade(t.dataset.grade);
        const st = ctx.plan.stocks[key] || (ctx.plan.stocks[key] = { label: t.dataset.grade });
        st[t.dataset.sf] = num(t.value);
        syncAll(); scheduleSave();
      }
    });
    host.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.cp === 'date') { ctx.plan.date = t.value; scheduleSave(); return; }
      const tr = t.closest && t.closest('tr[data-row]');
      if (!tr || !t.dataset.f) return;
      const leg = ctx.plan.legs[Number(tr.dataset.row)];
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
    ctx._sig = gradesSignature();
    return { render: renderGrid, plan: () => ctx.plan, persist: persistNow };
  }

  return {
    MAX_SLOTS, FALLBACK_FUELS, normGrade, familyOf, cleanFuels,
    emptyLeg, defaultPlan, newLeg, legIsBlank, legDays, fuelQty, fuelMargin, routeSummary, gradeSummary, gradesInUse, stockOf,
    ensurePlan, finalize, fromLegacy, toLegacy, legacySig, daysShown, printBody, fmtN, fmtFuel, routeCardsHtml, gradeCardsHtml,
    mount,
  };
});
