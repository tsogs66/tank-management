/**
 * Bunkering core — plan + live monitoring, after-bunkering tank condition, and
 * the bunkering report summary (BDN paperwork).
 *
 * Shared by both sides: loaded as a plain <script> in the SPA (picking up the
 * calc + fuel-report globals) and require()d from server/index.js, so a plan
 * computes identically online, offline and on the server.
 *
 * The three screens are one chain, and each stage reads the stage before it:
 *
 *   Fuel Report          ROB before bunkering (per tank + per grade)
 *      -> Bunker Plan    target volume/ullage per tank, delivery rate, live intake
 *      -> After report   fresh soundings; added = present - prior ROB
 *      -> Summary        BDN vs received, times alongside/pumping, tanks after
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../server/calc'), require('./fuel-report-core'));
  } else {
    root.BunkeringCore = factory(root, root.FuelReportCore);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (calc, FuelReport) {
'use strict';

const { computeTank, mtFromVolume, volumeFromMT, blendFuels } = calc;

/** Tank slots on the plan sheet (workbook sequence 1..6). */
const PLAN_SLOTS = 6;

/** Ship's condition on the summary sheet. */
const SHIP_CONDITIONS = [
  { id: 'ballast', label: 'BALLAST' },
  { id: 'laden', label: 'LADEN' },
];

/** Timestamp pairs on the summary sheet, in the order they happen. */
const SUMMARY_EVENTS = [
  { id: 'alongside', label: 'ALONGSIDE' },
  { id: 'connect', label: 'CONNECT' },
  { id: 'pumpStart', label: 'PUMP START' },
  { id: 'pumpStop', label: 'PUMP STOP' },
  { id: 'disconnect', label: 'DISCONNECT' },
  { id: 'castOff', label: 'CAST OFF' },
];

const COMMON_FUEL_GRADES = [
  'IFO 180cst', 'IFO 380cst', 'VLSFO 380cst', 'ULSFO', 'LSMGO DMA', 'MGO DMA', 'MDO DMB',
];

function num(v, fallback = null) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 3) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const f = Math.pow(10, d);
  return Math.round(Number(v) * f) / f;
}

/** Slack allowed against a filling limit before a row is flagged as overfilled. */
function fillTolerance(capacity) {
  return Math.max(0.05, (num(capacity, 0) || 0) * 0.001);
}

function fuelTanks(bundle) {
  return ((bundle && bundle.tanks && bundle.tanks.fuel) || []).filter(Boolean);
}

function findTank(bundle, tankId) {
  return fuelTanks(bundle).find((t) => t.id === tankId) || null;
}

/** Top of a tank's calibration scale — the ullage/dip range the tables cover. */
function scaleTop(tank) {
  return FuelReport.soundingPipeHeight(tank);
}

/**
 * Inverse of the calibration lookup: the reading (in the tank's own scale)
 * that holds `targetVolume` m³ at this trim and heel.
 *
 * computeTank is monotonic in the reading — rising for dip tanks, falling for
 * ullage tanks — so a bisection converges on either. Returns null when the
 * target is outside what the table covers.
 */
function readingForVolume(tank, targetVolume, ctx = {}) {
  const target = num(targetVolume);
  const top = scaleTop(tank);
  if (target == null || !(top > 0)) return null;

  const at = (reading) => computeTank(tank, {
    reading,
    trim: ctx.trim || 0,
    list: ctx.list || 0,
    tempC: 15,
    density15: null,
  }).volumeObserved;

  let lo = 0;
  let hi = top;
  let vLo = at(lo);
  let vHi = at(hi);
  const rising = vHi >= vLo;
  const min = rising ? vLo : vHi;
  const max = rising ? vHi : vLo;
  if (target < min - 1e-6 || target > max + 1e-6) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = at(mid);
    if (Math.abs(v - target) < 1e-6) return round(mid, 1);
    if (rising ? v < target : v > target) lo = mid;
    else hi = mid;
  }
  return round((lo + hi) / 2, 1);
}

/** Same reading expressed as an ullage, whichever way the tank is gauged. */
function asUllage(tank, reading) {
  const r = num(reading);
  if (r == null) return null;
  if (FuelReport.normalizeMethod(tank.soundingMethod) === 'ullage') return round(r, 1);
  const top = scaleTop(tank);
  return top > 0 ? round(top - r, 1) : null;
}

function hoursLabel(hours) {
  const h = num(hours);
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 60) return `${whole + 1}h 00m`;
  return `${whole}h ${String(mins).padStart(2, '0')}m`;
}

/* ---------------------------------------------------------------- plan ---- */

/**
 * ROB before bunkering, taken from the saved fuel report — the "initial data"
 * the plan and the after-report both start from.
 */
function robBeforeBunkering(bundle, conversion) {
  const report = FuelReport.computeFuelReport(bundle, bundle && bundle.fuelReport, conversion);
  const byTank = new Map();
  for (const section of report.sections) {
    for (const row of section.rows) byTank.set(row.tankId, row);
  }
  return { report, byTank };
}

function emptyBunkerPlan(bundle, conversion) {
  const voyage = (bundle && bundle.voyage) || {};
  const { report } = robBeforeBunkering(bundle, conversion);
  return {
    header: {
      date: voyage.date || new Date().toISOString().slice(0, 10),
      voyageNo: voyage.voyageNo || '',
      port: voyage.port || '',
      draftFwd: report.header.draftFwd || '',
      draftAft: report.header.draftAft || '',
      heel: report.header.heel || 0,
      fuelType: 'lsfo',
      fuelGrade: '',
      density15: '',
      tempC: '',
      deliveryRateMTPerHour: '',
      bunkerQuantityMT: '',
    },
    sequence: Array.from({ length: PLAN_SLOTS }, () => ({
      tankId: '',
      targetVolumeM3: '',
      currentSoundingMM: '',
    })),
    status: 'planning',
    startedAt: null,
    completedAt: null,
    updatedAt: null,
  };
}

function normalizePlan(bundle, form, conversion) {
  const base = emptyBunkerPlan(bundle, conversion);
  const src = form || {};
  const seq = [];
  for (let i = 0; i < PLAN_SLOTS; i++) {
    seq.push({ ...base.sequence[i], ...((src.sequence || [])[i] || {}) });
  }
  return {
    header: { ...base.header, ...(src.header || {}) },
    sequence: seq,
    status: src.status || base.status,
    startedAt: src.startedAt || null,
    completedAt: src.completedAt || null,
    updatedAt: src.updatedAt || null,
  };
}

/**
 * Plan sheet + live monitoring.
 *
 * Planning fills TARGET VOL. -> target ullage and plan add MT; during the
 * transfer, CURRENT SOUND. per tank drives the actual intake, what is left to
 * load, and how long that will take at the delivery rate.
 */
function computeBunkerPlan(bundle, form, conversion) {
  const plan = normalizePlan(bundle, form, conversion);
  const header = plan.header;
  const { report, byTank } = robBeforeBunkering(bundle, conversion);

  const draftFwd = num(header.draftFwd, 0) || 0;
  const draftAft = num(header.draftAft, 0) || 0;
  const meanDraft = (draftFwd + draftAft) / 2;
  const trim = draftFwd - draftAft;
  const trimByStern = draftAft - draftFwd;
  const heel = num(header.heel, 0) || 0;
  const ctx = { trim: trimByStern, list: heel };

  const rate = num(header.deliveryRateMTPerHour);
  const quantity = num(header.bunkerQuantityMT);
  const fuelType = header.fuelType || 'lsfo';

  // Bunker density/temp: entered on the plan, else carried from the grade's
  // tanks in the fuel report.
  let density15 = num(header.density15);
  const tempC = num(header.tempC, 15) || 15;
  if (density15 == null) {
    const sample = [...byTank.values()].find((r) => r.fuelType === fuelType && r.density15 != null);
    density15 = sample ? sample.density15 : null;
  }

  const rows = plan.sequence.map((slot, i) => {
    const out = {
      slot: i + 1,
      tankId: slot.tankId || '',
      name: '',
      capacity100M3: null,
      capacity85M3: null,
      startingReadingMM: null,
      startingMethod: '',
      startingUllageMM: null,
      startingRobM3: null,
      startingRobMT: null,
      freeM3At85: null,
      targetVolumeM3: num(slot.targetVolumeM3),
      targetVolumePercent: null,
      targetUllageMM: null,
      targetReadingMM: null,
      planAddMT: null,
      currentSoundingMM: num(slot.currentSoundingMM),
      currentVolumeM3: null,
      currentVolumePercent: null,
      quantityAddMT: null,
      warnings: [],
    };
    if (!slot.tankId) return out;

    const tank = findTank(bundle, slot.tankId);
    if (!tank) {
      out.warnings.push('tank not found');
      return out;
    }
    const before = byTank.get(slot.tankId) || null;
    const capacity = num(tank.capacity, 0) || 0;
    const cap85 = capacity * FuelReport.SAFE_FILL_RATIO;

    out.name = tank.name || tank.id;
    out.capacity100M3 = round(capacity, 3);
    out.capacity85M3 = round(cap85, 3);
    out.startingMethod = before ? before.method : FuelReport.normalizeMethod(tank.soundingMethod);
    out.startingReadingMM = before && before.reading !== '' ? num(before.reading) : null;
    out.startingUllageMM = before && before.trace
      ? asUllage(tank, before.trace.nativeReading)
      : null;
    out.startingRobM3 = before ? before.measuredM3 : null;
    out.startingRobMT = before ? before.weightAirMT : null;
    if (before == null || before.measuredM3 == null) {
      out.warnings.push('no ROB in the fuel report for this tank');
    }
    out.freeM3At85 = out.startingRobM3 != null ? round(cap85 - out.startingRobM3, 3) : round(cap85, 3);

    const startVol = out.startingRobM3 != null ? out.startingRobM3 : 0;

    if (out.targetVolumeM3 != null) {
      out.targetVolumePercent = capacity > 0 ? round((out.targetVolumeM3 / capacity) * 100, 1) : null;
      const reading = readingForVolume(tank, out.targetVolumeM3, ctx);
      out.targetReadingMM = reading;
      out.targetUllageMM = reading != null ? asUllage(tank, reading) : null;
      if (reading == null) out.warnings.push('target volume outside the calibration table');
      // Tolerate the rounding in a book capacity (463.5 vs 463.476) before crying overfill.
      if (out.targetVolumeM3 > cap85 + fillTolerance(capacity)) {
        out.warnings.push('target is above the 85% filling limit');
      }
      if (out.targetVolumeM3 < startVol - 1e-6) out.warnings.push('target is below the current ROB');
      const addVol = out.targetVolumeM3 - startVol;
      out.planAddMT = density15 != null
        ? round(mtFromVolume(Math.max(0, addVol), density15, tempC), 3)
        : null;
    }

    if (out.currentSoundingMM != null) {
      const native = out.startingMethod === FuelReport.normalizeMethod(tank.soundingMethod)
        ? out.currentSoundingMM
        : (scaleTop(tank) || 0) - out.currentSoundingMM;
      const res = computeTank(tank, {
        reading: native,
        trim: trimByStern,
        list: heel,
        tempC,
        density15,
      });
      out.currentVolumeM3 = round(res.volumeObserved, 3);
      out.currentVolumePercent = capacity > 0 ? round((res.volumeObserved / capacity) * 100, 1) : null;
      const addVol = res.volumeObserved - startVol;
      out.quantityAddMT = density15 != null
        ? round(mtFromVolume(addVol, density15, tempC), 3)
        : null;
      if (out.currentVolumeM3 > cap85 + fillTolerance(capacity)) {
        out.warnings.push('above the 85% filling limit');
      }
      if (capacity > 0 && out.currentVolumeM3 > capacity) out.warnings.push('above 100% capacity');
    }

    return out;
  });

  const used = rows.filter((r) => r.tankId);
  const sum = (key) => used.reduce((a, r) => a + (num(r[key], 0) || 0), 0);
  const receivedMT = round(sum('quantityAddMT'), 3);
  const plannedAddMT = round(sum('planAddMT'), 3);
  const remaining = quantity != null ? Math.max(0, quantity - (receivedMT || 0)) : null;

  return {
    vessel: {
      name: (bundle.vessel && bundle.vessel.name) || '',
      imo: (bundle.vessel && bundle.vessel.imo) || '',
    },
    header: {
      ...header,
      density15: density15 != null ? round(density15, 4) : null,
      tempC,
      meanDraft: round(meanDraft, 3),
      trim: round(trim, 3),
      trimByStern: round(trimByStern, 3),
      heel,
      deliveryRateMTPerHour: rate,
      bunkerQuantityMT: quantity,
      timeToBunkerHours: rate > 0 && quantity != null ? round(quantity / rate, 2) : null,
      timeToBunkerLabel: rate > 0 && quantity != null ? hoursLabel(quantity / rate) : '—',
    },
    rows,
    totals: {
      tanks: used.length,
      capacity100M3: round(sum('capacity100M3'), 3),
      capacity85M3: round(sum('capacity85M3'), 3),
      startingRobM3: round(sum('startingRobM3'), 3),
      freeM3At85: round(sum('freeM3At85'), 3),
      targetVolumeM3: round(sum('targetVolumeM3'), 3),
      currentVolumeM3: round(sum('currentVolumeM3'), 3),
      plannedAddMT,
      receivedMT,
    },
    monitoring: {
      receivedMT,
      quantityRemainingMT: remaining != null ? round(remaining, 3) : null,
      timeRemainingHours: rate > 0 && remaining != null ? round(remaining / rate, 2) : null,
      timeRemainingLabel: rate > 0 && remaining != null ? hoursLabel(remaining / rate) : '—',
      percentComplete: quantity > 0 ? round(((receivedMT || 0) / quantity) * 100, 1) : null,
      planCoversQuantity: quantity != null && plannedAddMT != null
        ? round(plannedAddMT - quantity, 3)
        : null,
      freeSpaceShortfallM3: quantity != null && density15 != null
        ? round((volumeFromMT(quantity, density15, tempC) || 0) - (sum('freeM3At85') || 0), 3)
        : null,
    },
    before: report,
    status: plan.status,
    form: plan,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------- after bunkering ---- */

/**
 * Tank condition after bunkering: a full fuel-report grid plus, per grade, the
 * ROB it started from and what that makes the intake.
 *
 * `priorRob` is normally filled by "get data" from the saved fuel report; a
 * negative "added" simply means the grade was consumed, not received.
 */
function emptyAfterReport(bundle, conversion) {
  const form = FuelReport.emptyFuelReport(bundle);
  // Start from the pre-bunkering soundings so only what changed has to be typed.
  const src = (bundle && bundle.fuelReport) || null;
  const merged = src ? FuelReport.normalizeForm(bundle, src) : form;
  return {
    ...merged,
    header: { ...merged.header, reportType: 'Bunker Survey' },
    priorRob: priorRobFromFuelReport(bundle, conversion),
    linkedPlanId: null,
    updatedAt: null,
  };
}

/** Per-grade totals of the saved fuel report — the ROB prior to bunkering. */
function priorRobFromFuelReport(bundle, conversion) {
  const report = FuelReport.computeFuelReport(bundle, bundle && bundle.fuelReport, conversion);
  const out = {};
  for (const grade of report.grades) out[grade.id] = grade.actualMT;
  return out;
}

function normalizeAfterReport(bundle, form, conversion) {
  const base = emptyAfterReport(bundle, conversion);
  const src = form || {};
  const merged = FuelReport.normalizeForm(bundle, { ...base, ...src });
  return {
    ...merged,
    priorRob: { ...(base.priorRob || {}), ...(src.priorRob || {}) },
    linkedPlanId: src.linkedPlanId || null,
    updatedAt: src.updatedAt || null,
  };
}

function computeAfterBunkering(bundle, form, conversion) {
  const normalized = normalizeAfterReport(bundle, form, conversion);
  const report = FuelReport.computeFuelReport(bundle, normalized, conversion);

  const grades = report.grades.map((grade) => {
    const priorMT = num(normalized.priorRob[grade.id]);
    const presentMT = grade.actualMT;
    return {
      ...grade,
      priorMT,
      presentMT,
      addedMT: priorMT != null && presentMT != null ? round(presentMT - priorMT, 3) : null,
    };
  });

  return {
    ...report,
    grades,
    priorRob: normalized.priorRob,
    totals: {
      ...report.totals,
      priorMT: round(grades.reduce((a, g) => a + (g.priorMT || 0), 0), 3),
      addedMT: round(grades.reduce((a, g) => a + (g.addedMT || 0), 0), 3),
    },
    form: normalized,
    generatedAt: new Date().toISOString(),
  };
}

/* --------------------------------------------------------------- summary ---- */

function emptySummary(bundle) {
  const voyage = (bundle && bundle.voyage) || {};
  const events = {};
  for (const e of SUMMARY_EVENTS) events[e.id] = { date: '', time: '' };
  return {
    voyageNo: voyage.voyageNo || '',
    date: voyage.date || new Date().toISOString().slice(0, 10),
    port: voyage.port || '',
    events,
    bargeName: '',
    supplier: '',
    fuelGrade: '',
    bdnNumber: '',
    shipCondition: '',
    letterOfProtest: false,
    samplesGiven: false,
    remarks: '',
    lubes: { cylHigh: '', cylLow: '', meSystem: '', dgSystem: '' },
    bdn: { fuelType: 'lsfo', quantityMT: '', sulphurPercent: '', density15: '' },
    updatedAt: null,
  };
}

function normalizeSummary(bundle, form) {
  const base = emptySummary(bundle);
  const src = form || {};
  const events = {};
  for (const e of SUMMARY_EVENTS) {
    events[e.id] = { ...base.events[e.id], ...((src.events || {})[e.id] || {}) };
  }
  return {
    ...base,
    ...src,
    events,
    lubes: { ...base.lubes, ...(src.lubes || {}) },
    bdn: { ...base.bdn, ...(src.bdn || {}) },
  };
}

/** Minutes between two date+time pairs on the summary sheet. */
function eventGapHours(from, to) {
  if (!from || !to || !from.date || !to.date) return null;
  const a = Date.parse(`${from.date}T${(from.time || '00:00')}:00Z`);
  const b = Date.parse(`${to.date}T${(to.time || '00:00')}:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return round((b - a) / 3600000, 2);
}

/**
 * Bunkering report summary — the BDN paperwork, the fuel onboard before and
 * after, and the tanks as they stand after the transfer.
 */
function computeBunkerSummary(bundle, form, after, conversion) {
  const summary = normalizeSummary(bundle, form);
  const afterComputed = after || computeAfterBunkering(bundle, bundle && bundle.bunkerAfter, conversion);

  const fuelOnboard = afterComputed.grades.map((g) => ({
    id: g.id,
    label: g.label,
    previousMT: g.priorMT,
    receivedMT: g.addedMT,
    presentMT: g.presentMT,
  }));

  const bdnGrade = summary.bdn.fuelType || 'lsfo';
  const bdnQuantity = num(summary.bdn.quantityMT);
  const receivedRow = fuelOnboard.find((f) => f.id === bdnGrade) || null;
  const receivedQuantity = receivedRow ? receivedRow.receivedMT : null;

  const tanksAfter = [];
  for (const section of afterComputed.sections) {
    for (const row of section.rows) {
      if (row.measuredM3 != null) tanksAfter.push(row);
    }
  }

  const pumpingHours = eventGapHours(summary.events.pumpStart, summary.events.pumpStop);
  const alongsideHours = eventGapHours(summary.events.alongside, summary.events.castOff);

  return {
    vessel: {
      name: (bundle.vessel && bundle.vessel.name) || '',
      imo: (bundle.vessel && bundle.vessel.imo) || '',
    },
    voyageNo: summary.voyageNo,
    date: summary.date,
    port: summary.port,
    events: summary.events,
    eventLabels: SUMMARY_EVENTS,
    bargeName: summary.bargeName,
    supplier: summary.supplier,
    fuelGrade: summary.fuelGrade,
    bdnNumber: summary.bdnNumber,
    shipCondition: summary.shipCondition,
    letterOfProtest: Boolean(summary.letterOfProtest),
    samplesGiven: Boolean(summary.samplesGiven),
    remarks: summary.remarks,
    lubes: summary.lubes,
    fuelOnboard,
    bdn: {
      ...summary.bdn,
      quantityMT: bdnQuantity,
      sulphurPercent: num(summary.bdn.sulphurPercent),
      density15: num(summary.bdn.density15),
      label: (FuelReport.FUEL_TYPES.find((f) => f.id === bdnGrade) || {}).label || bdnGrade,
    },
    quantities: {
      bdnQuantityMT: bdnQuantity,
      receivedQuantityMT: receivedQuantity,
      differenceMT: bdnQuantity != null && receivedQuantity != null
        ? round(receivedQuantity - bdnQuantity, 3)
        : null,
      // A BDN is normally accepted within 0.5%; anything past that is a protest.
      differencePercent: bdnQuantity ? round(((receivedQuantity - bdnQuantity) / bdnQuantity) * 100, 3) : null,
    },
    timing: {
      pumpingHours,
      pumpingLabel: pumpingHours != null ? hoursLabel(pumpingHours) : '—',
      alongsideHours,
      alongsideLabel: alongsideHours != null ? hoursLabel(alongsideHours) : '—',
      averageRateMTPerHour: pumpingHours > 0 && receivedQuantity != null
        ? round(receivedQuantity / pumpingHours, 2)
        : null,
    },
    tanksAfter,
    after: afterComputed,
    form: summary,
    generatedAt: new Date().toISOString(),
  };
}

/** Compact snapshots for the saved-report histories. */
function planSnapshot(computed) {
  return {
    id: `plan_${Date.now().toString(36)}`,
    savedAt: computed.generatedAt,
    date: computed.header.date,
    voyageNo: computed.header.voyageNo,
    port: computed.header.port,
    fuelType: computed.header.fuelType,
    bunkerQuantityMT: computed.header.bunkerQuantityMT,
    receivedMT: computed.monitoring.receivedMT,
    form: computed.form,
  };
}

function summarySnapshot(computed) {
  return {
    id: `bsum_${Date.now().toString(36)}`,
    savedAt: computed.generatedAt,
    date: computed.date,
    voyageNo: computed.voyageNo,
    port: computed.port,
    supplier: computed.supplier,
    bdnNumber: computed.bdnNumber,
    bdnQuantityMT: computed.quantities.bdnQuantityMT,
    receivedQuantityMT: computed.quantities.receivedQuantityMT,
    differenceMT: computed.quantities.differenceMT,
    form: computed.form,
  };
}

function afterSnapshot(computed) {
  return {
    id: `after_${Date.now().toString(36)}`,
    savedAt: computed.generatedAt,
    date: computed.header.date,
    voyageNo: computed.header.voyageNo,
    port: computed.header.port,
    grades: computed.grades.map((g) => ({
      id: g.id, label: g.label, priorMT: g.priorMT, addedMT: g.addedMT, presentMT: g.presentMT,
    })),
    form: computed.form,
  };
}

return {
  PLAN_SLOTS,
  SHIP_CONDITIONS,
  SUMMARY_EVENTS,
  COMMON_FUEL_GRADES,
  readingForVolume,
  asUllage,
  fillTolerance,
  scaleTop,
  hoursLabel,
  robBeforeBunkering,
  priorRobFromFuelReport,
  emptyBunkerPlan,
  normalizePlan,
  computeBunkerPlan,
  emptyAfterReport,
  normalizeAfterReport,
  computeAfterBunkering,
  emptySummary,
  normalizeSummary,
  computeBunkerSummary,
  planSnapshot,
  afterSnapshot,
  summarySnapshot,
  blendFuels,
};
}));
