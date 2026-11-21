/**
 * What is in each storage tank: the BDN behind it, and its LCV, sulphur and density.
 *
 * A bunkering puts fuel into a tank that holds some already (its "before" ROB, from the soundings) and ends with the
 * "after" ROB. What was loaded is after − before. The tank's properties then become the mass-weighted blend of the
 * old content and the delivery:  LCV and sulphur by mass, density by volume (ρ = Σm ÷ Σ(m/ρ)). A tank bunkered
 * empty simply takes the delivery's figures — the residual case. Burning fuel lowers the ROB but leaves the
 * properties alone, so the register only changes at a bunkering.
 *
 * Between soundings the ROB is an estimate: the last measured value, plus what was bunkered, minus what the log says
 * was burned from that tank since. That is estimateRob(); tankStatus() says when the estimate has run out.
 *
 * Pure functions, no DOM, no storage: the same file runs in Tank Chief and Voyage Chief and is tested on its own.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TankFuelRegister = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GAIN_EPS = 0.05;          /* MT — a tank that gained less than this took no fuel */
  var UNKNOWN_SHARE = 0.05;     /* an unknown old property is ignored if the old content is under this share */

  var RESIDUAL = ['hfo', 'lsfo', 'ulsfo', 'vlsfo'];
  var DISTILLATE = ['mdo', 'mgo', 'lsmgo', 'lsmdo', 'dmb', 'dma'];

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function round(v, d) {
    if (v == null) return null;
    var f = Math.pow(10, d == null ? 3 : d);
    return Math.round(v * f) / f;
  }
  function family(grade) {
    var g = String(grade || '').toLowerCase();
    if (RESIDUAL.indexOf(g) >= 0) return 'residual';
    if (DISTILLATE.indexOf(g) >= 0) return 'distillate';
    return g;
  }
  /* BDNs often state net specific energy in MJ/kg; the program works in kJ/kg. */
  function lcvKjKg(v) {
    var n = num(v);
    if (n == null || n <= 0) return null;
    return n < 100 ? round(n * 1000, 0) : n;
  }

  /** Weighted mean that goes unknown when one side is unknown and not negligible. */
  function mixValue(a, ma, b, mb) {
    var total = ma + mb;
    if (!(total > 0)) return null;
    if (a == null && b == null) return null;
    if (a == null) return (ma / total) < UNKNOWN_SHARE ? b : null;
    if (b == null) return (mb / total) < UNKNOWN_SHARE ? a : null;
    return (a * ma + b * mb) / total;
  }
  function mixDensity(a, ma, b, mb) {
    if (a == null || b == null || !(a > 0) || !(b > 0)) return mixValue(a, ma, b, mb);
    return (ma + mb) / (ma / a + mb / b);
  }

  /**
   * Blend what is in a tank with what was loaded into it.
   * old / add: { mt, lcv, sulphur, density }. Returns the same shape.
   */
  function blend(old, add) {
    var mo = Math.max(0, num(old && old.mt) || 0);
    var ma = Math.max(0, num(add && add.mt) || 0);
    if (!(ma > 0)) return { mt: mo, lcv: old ? old.lcv : null, sulphur: old ? old.sulphur : null, density: old ? old.density : null };
    if (!(mo > 0)) return { mt: ma, lcv: add.lcv, sulphur: add.sulphur, density: add.density };
    return {
      mt: mo + ma,
      lcv: round(mixValue(num(old.lcv), mo, num(add.lcv), ma), 0),
      sulphur: round(mixValue(num(old.sulphur), mo, num(add.sulphur), ma), 4),
      density: round(mixDensity(num(old.density), mo, num(add.density), ma), 4)
    };
  }

  /** One delivery note for a grade: several notes of the same grade are combined by quantity. */
  function combineBdns(list) {
    var rows = (list || []).filter(Boolean);
    if (!rows.length) return null;
    if (rows.length === 1) {
      var r = rows[0];
      return { numbers: r.number ? [String(r.number)] : [], lcv: lcvKjKg(r.lcv), sulphur: num(r.sulphur), density: num(r.density), mt: num(r.qty) };
    }
    var acc = { mt: 0, lcv: null, sulphur: null, density: null, numbers: [] };
    rows.forEach(function (r) {
      var q = Math.max(0, num(r.qty) || 0);
      var next = blend({ mt: acc.mt, lcv: acc.lcv, sulphur: acc.sulphur, density: acc.density },
        { mt: q, lcv: lcvKjKg(r.lcv), sulphur: num(r.sulphur), density: num(r.density) });
      acc.mt = next.mt; acc.lcv = next.lcv; acc.sulphur = next.sulphur; acc.density = next.density;
      if (r.number) acc.numbers.push(String(r.number));
    });
    return acc;
  }

  function bdnForGrade(bdns, grade) {
    var exact = (bdns || []).filter(function (b) { return b && String(b.grade || '').toLowerCase() === String(grade || '').toLowerCase(); });
    if (exact.length) return combineBdns(exact);
    var fam = (bdns || []).filter(function (b) { return b && family(b.grade) === family(grade); });
    return combineBdns(fam);
  }

  /**
   * Turn one bunkering into per-tank results, given the register state before it.
   *   event: { id, ts, tanks:[{tankId, tankName, grade, beforeMt, afterMt}],
   *            bdns:[{number, grade, qty, lcv, sulphur, density, supplier}] }
   *   state: { [tankId]: { mt, lcv, sulphur, density, bdns:[...] } }   (properties of the content before)
   * Returns { tanks:[{tankId, grade, beforeMt, afterMt, loadedMt, lots, result:{lcv,sulphur,density}, estimatedBefore}], notes:[] }.
   */
  function applyEvent(state, event) {
    var notes = [];
    var out = [];
    ((event && event.tanks) || []).forEach(function (t) {
      var before = num(t.beforeMt), after = num(t.afterMt);
      var cur = (state && state[t.tankId]) || { mt: 0, lcv: null, sulphur: null, density: null, bdns: [] };
      if (after == null) return;
      var beforeMt = before == null ? (num(cur.mt) || 0) : before;
      var loaded = after - beforeMt;
      if (!(loaded > GAIN_EPS)) {
        /* Nothing loaded here: the tank keeps what it had. */
        out.push({ tankId: t.tankId, tankName: t.tankName, grade: t.grade, beforeMt: beforeMt, afterMt: after, loadedMt: 0,
          lots: cur.bdns || [], result: { lcv: cur.lcv, sulphur: cur.sulphur, density: cur.density }, gained: false });
        return;
      }
      var delivery = bdnForGrade(event.bdns, t.grade);
      if (!delivery) {
        notes.push('No delivery note of grade ' + t.grade + ' for ' + (t.tankName || t.tankId) + ' — properties left unknown.');
        out.push({ tankId: t.tankId, tankName: t.tankName, grade: t.grade, beforeMt: beforeMt, afterMt: after, loadedMt: round(loaded, 3),
          lots: cur.bdns || [], result: { lcv: null, sulphur: null, density: null }, gained: true });
        return;
      }
      var mixed = blend({ mt: beforeMt, lcv: cur.lcv, sulphur: cur.sulphur, density: cur.density },
        { mt: loaded, lcv: delivery.lcv, sulphur: delivery.sulphur, density: delivery.density });
      var lots = beforeMt > GAIN_EPS ? (cur.bdns || []).slice() : [];
      lots.push({ numbers: delivery.numbers, mt: round(loaded, 3), lcv: delivery.lcv, sulphur: delivery.sulphur });
      out.push({
        tankId: t.tankId, tankName: t.tankName, grade: t.grade, beforeMt: beforeMt, afterMt: after, loadedMt: round(loaded, 3),
        lots: lots, result: { lcv: mixed.lcv, sulphur: mixed.sulphur, density: mixed.density }, gained: true,
        estimatedBefore: before == null
      });
    });
    return { tanks: out, notes: notes };
  }

  /**
   * Replay every event in time order. Returns { tanks: { [tankId]: {tankId, grade, ts, afterMt, lcv, sulphur, density, bdns} },
   * history: [{ts, id, tankId, ...}] } — the properties each tank has now, and each step on the way.
   */
  function build(events) {
    var list = (events || []).filter(function (e) { return e && e.ts != null && Array.isArray(e.tanks); });
    /* The same bunkering saved twice is one bunkering: the latest save of an id wins. */
    var byId = {};
    list.forEach(function (e, i) {
      var k = e.id || ('anon' + i);
      if (!byId[k] || String(e.savedAt || e.ts) >= String(byId[k].savedAt || byId[k].ts)) byId[k] = e;
    });
    var ordered = Object.keys(byId).map(function (k) { return byId[k]; })
      .sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    var state = {}, tanks = {}, history = [], notes = [];
    ordered.forEach(function (ev) {
      var res = applyEvent(state, ev);
      notes = notes.concat(res.notes);
      res.tanks.forEach(function (t) {
        state[t.tankId] = { mt: t.afterMt, lcv: t.result.lcv, sulphur: t.result.sulphur, density: t.result.density, bdns: t.lots };
        tanks[t.tankId] = {
          tankId: t.tankId, tankName: t.tankName, grade: t.grade, ts: ev.ts, afterMt: t.afterMt,
          lcv: t.result.lcv, sulphur: t.result.sulphur, density: t.result.density, bdns: t.lots
        };
        history.push({ id: ev.id, ts: ev.ts, tankId: t.tankId, grade: t.grade, beforeMt: t.beforeMt, afterMt: t.afterMt,
          loadedMt: t.loadedMt, gained: t.gained, lcv: t.result.lcv, sulphur: t.result.sulphur, density: t.result.density,
          lots: t.lots, estimatedBefore: !!t.estimatedBefore });
      });
    });
    return { tanks: tanks, history: history, notes: notes };
  }

  /**
   * The bunkerings a vessel bundle holds: every saved bunkering summary that carries its tanks' before and after ROB
   * (current one and the saved history). Summaries saved before this existed have no tank loads and are skipped.
   */
  function eventsFromBundle(bundle) {
    var forms = [];
    if (bundle && bundle.bunkerSummary) forms.push(bundle.bunkerSummary);
    var hist = bundle && bundle.bunkerHistory && bundle.bunkerHistory.summaries;
    (hist || []).forEach(function (h) { if (h && h.form) forms.push(h.form); });
    var out = [];
    forms.forEach(function (f) {
      if (!f || !Array.isArray(f.tankLoads) || !f.tankLoads.length) return;
      var bdns = [];
      var add = function (b, number) {
        if (!b) return;
        bdns.push({ number: number != null ? number : b.number, grade: b.fuelType, qty: b.quantityMT, lcv: b.lcv,
          sulphur: b.sulphurPercent, density: b.density15, supplier: f.supplier });
      };
      add(f.bdn, f.bdnNumber);
      add(f.bdn2);
      (f.extraBdns || []).forEach(function (e) { add(e); });
      out.push({ id: f.bunkeringId || ('sum_' + (f.updatedAt || '')), ts: f.loadsTs || f.date, savedAt: f.updatedAt,
        tanks: f.tankLoads, bdns: bdns });
    });
    return out;
  }

  /** The tank's properties as they were at a moment: the latest bunkering step at or before it. */
  function propertiesAt(register, tankId, ts) {
    var t = ts == null ? Infinity : new Date(ts).getTime();
    var best = null;
    ((register && register.history) || []).forEach(function (h) {
      if (h.tankId !== tankId || !h.gained) return;
      if (new Date(h.ts).getTime() <= t && (!best || new Date(h.ts) >= new Date(best.ts))) best = h;
    });
    return best ? { lcv: best.lcv, sulphur: best.sulphur, density: best.density, ts: best.ts, lots: best.lots, blend: (best.lots || []).length > 1 } : null;
  }

  /**
   * ROB of a tank now: the last measured value, plus bunkered, minus what the log has burned from it since.
   * Never below zero; `clamped` says the arithmetic went negative (the tank selection in the log is probably wrong).
   */
  function estimateRob(p) {
    var base = num(p && p.measuredMt);
    if (base == null) return { ok: false, reason: 'no ROB base for this tank' };
    var loaded = Math.max(0, num(p.loadedSinceMt) || 0);
    var consumed = Math.max(0, num(p.consumedSinceMt) || 0);
    var raw = base + loaded - consumed;
    return { ok: true, mt: Math.max(0, round(raw, 3)), raw: round(raw, 3), clamped: raw < 0 };
  }

  /**
   * Whether the tank being burned from is, by the estimate, about to run out or already has.
   * p: { estMt, entryConsMt, burnMtPerDay, lowHours }
   */
  function tankStatus(p) {
    var est = num(p && p.estMt);
    if (est == null) return { level: 'unknown', text: 'No ROB base for this tank' };
    var cons = Math.max(0, num(p.entryConsMt) || 0);
    var burn = num(p.burnMtPerDay);
    var lowHours = num(p.lowHours) == null ? 24 : num(p.lowHours);
    if (est <= 0) return { level: 'empty', text: 'Estimated empty' };
    if (cons > 0 && est < cons) return { level: 'empty', text: 'Less than this entry burns (est. ' + round(est, 1) + ' MT)' };
    if (burn != null && burn > 0) {
      var hours = est / burn * 24;
      if (hours <= lowHours) return { level: 'low', hours: hours, text: 'About ' + Math.round(hours) + ' h left at the current burn' };
    }
    return { level: 'ok', text: '' };
  }

  /** Estimate against what the next sounding shows. */
  function drift(estMt, measuredMt, capacityMt) {
    var e = num(estMt), m = num(measuredMt);
    if (e == null || m == null) return null;
    var diff = round(m - e, 3);
    var ref = num(capacityMt) || Math.max(m, e, 1);
    return { diffMt: diff, pct: round(Math.abs(diff) / ref * 100, 2), flag: Math.abs(diff) / ref > 0.02 };
  }

  return { eventsFromBundle: eventsFromBundle, blend: blend, combineBdns: combineBdns, applyEvent: applyEvent, build: build, propertiesAt: propertiesAt,
    estimateRob: estimateRob, tankStatus: tankStatus, drift: drift, lcvKjKg: lcvKjKg, family: family };
});
