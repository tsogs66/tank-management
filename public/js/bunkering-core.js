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

/** Filling limit the plan targets against (workbook Report sheet). */
const SAFE_FILL = 0.85;

/**
 * Valve state of one tank in the sequence. Bunkering runs tank by tank, so each
 * slot is opened, held, and closed on its own while the barge keeps pumping.
 */
const TANK_STATES = [
  { id: 'pending', label: 'PENDING', next: 'filling', action: 'Start' },
  { id: 'filling', label: 'FILLING', next: 'paused', action: 'Pause' },
  { id: 'paused', label: 'PAUSED', next: 'filling', action: 'Resume' },
  { id: 'done', label: 'DONE', next: 'pending', action: 'Reopen' },
];

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

/**
 * Ways of spreading a delivery over the tanks, as on the old bunkering page.
 * These fill the plan sequence with targets; nothing is written to the tanks
 * until the tanks are actually sounded on the after-bunkering report.
 */
const DISTRIBUTION_MODES = [
  { id: 'level-storage', label: 'Smart — level up the emptiest first' },
  { id: 'equal-storage', label: 'Equal — all storage' },
  { id: 'port-storage', label: 'Port storage only' },
  { id: 'starboard-storage', label: 'Starboard storage only' },
  { id: 'no1-storage', label: 'No.1 tanks only' },
  { id: 'no2-storage', label: 'No.2 tanks only' },
  { id: 'no3-storage', label: 'No.3 tanks only' },
  { id: 'settling', label: 'Settling tanks' },
  { id: 'service', label: 'Service tanks' },
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

/** How far a measured intake may sit from the delivery note before it is a protest. */
const BDN_TOLERANCE_PERCENT = 0.5;

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

/**
 * Elapsed time as a clock reads it: floored, never rounded up.
 *
 * Rounding made the pumping clock show 0h 01m after thirty seconds — it claimed
 * time that had not passed, on a figure the engineer copies into the paperwork
 * and which multiplies the rate into an expected quantity. A clock shows 1h 59m
 * until it is 2h 00m.
 */
function hoursLabel(hours) {
  const h = num(hours);
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  const totalMinutes = Math.floor(h * 60 + 1e-9);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

/**
 * The same elapsed time with seconds, for the live monitoring panel.
 *
 * A pumping clock that only moves once a minute looks stopped, which is the one
 * thing a monitoring screen must never look like while fuel is going aboard.
 * Printouts and history keep the minute form — seconds are noise there.
 */
function hmsLabel(hours) {
  const h = num(hours);
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  const totalSeconds = Math.floor(h * 3600 + 1e-9);
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s`;
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
      // What the delivery note says was pumped. Entered when the transfer is
      // finished, and held apart from bunkerQuantityMT, which is the quantity
      // that was ordered.
      bdnQuantityMT: '',
    },
    sequence: Array.from({ length: PLAN_SLOTS }, () => ({
      tankId: '',
      targetVolumeM3: '',
      currentSoundingMM: '',
      status: 'pending',
      startedAt: null,
      pausedAt: null,
      elapsedPausedMs: 0,
      completedAt: null,
    })),
    distributionMode: 'equal-storage',
    status: 'planning',
    startedAt: null,
    pausedAt: null,
    elapsedPausedMs: 0,
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
  for (const slot of seq) {
    if (!TANK_STATES.some((s) => s.id === slot.status)) slot.status = 'pending';
    slot.elapsedPausedMs = num(slot.elapsedPausedMs, 0) || 0;
  }
  return {
    header: { ...base.header, ...(src.header || {}) },
    sequence: seq,
    distributionMode: src.distributionMode || base.distributionMode,
    status: src.status || base.status,
    startedAt: src.startedAt || null,
    pausedAt: src.pausedAt || null,
    elapsedPausedMs: num(src.elapsedPausedMs, 0) || 0,
    completedAt: src.completedAt || null,
    updatedAt: src.updatedAt || null,
  };
}

/**
 * Time one tank has actually been taking fuel — its own start, minus its own
 * pauses, stopping when it was closed off.
 */
function tankClock(slot, now = Date.now()) {
  const status = TANK_STATES.some((s) => s.id === slot.status) ? slot.status : 'pending';
  const startMs = slot.startedAt ? Date.parse(slot.startedAt) : null;
  if (!startMs) {
    return { status, running: false, elapsedHours: 0, elapsedLabel: '—', elapsedLabelLive: '—' };
  }
  const pauseMs = slot.pausedAt ? Date.parse(slot.pausedAt) : null;
  const endMs = slot.completedAt ? Date.parse(slot.completedAt) : (pauseMs || now);
  const elapsedMs = Math.max(0, endMs - startMs - (num(slot.elapsedPausedMs, 0) || 0));
  const hours = elapsedMs / 3600000;
  return {
    status,
    running: status === 'filling',
    elapsedHours: round(hours, 4),
    elapsedLabel: hoursLabel(hours),
    elapsedLabelLive: hmsLabel(hours),
  };
}

/**
 * Pumping clock. Elapsed time since the transfer was started (pauses removed)
 * and what the barge's stated rate says should be aboard by now — the figure
 * to hold the measured intake against.
 */
function pumpingClock(plan, rate, receivedMT, now = Date.now()) {
  const startMs = plan.startedAt ? Date.parse(plan.startedAt) : null;
  if (!startMs) {
    return {
      running: false, started: false, elapsedHours: null,
      elapsedLabel: '—', elapsedLabelLive: '—', expectedMT: null, varianceMT: null,
    };
  }
  const pauseMs = plan.pausedAt ? Date.parse(plan.pausedAt) : null;
  const endMs = plan.completedAt ? Date.parse(plan.completedAt) : (pauseMs || now);
  const elapsedMs = Math.max(0, endMs - startMs - (num(plan.elapsedPausedMs, 0) || 0));
  const elapsedHours = elapsedMs / 3600000;
  const expected = rate > 0 ? round(rate * elapsedHours, 3) : null;
  return {
    running: Boolean(plan.startedAt) && !pauseMs && !plan.completedAt,
    started: true,
    paused: Boolean(pauseMs) && !plan.completedAt,
    completed: Boolean(plan.completedAt),
    elapsedHours: round(elapsedHours, 4),
    elapsedLabel: hoursLabel(elapsedHours),
    elapsedLabelLive: hmsLabel(elapsedHours),
    expectedMT: expected,
    varianceMT: expected != null && receivedMT != null ? round(receivedMT - expected, 3) : null,
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

  const filling = plan.sequence.filter((s) => s.tankId && s.status === 'filling').length;
  // The barge pumps at one rate; tanks taking fuel at the same time share it.
  const rateShare = rate > 0 && filling > 0 ? rate / filling : 0;

  /* Per-row workings the estimating pass needs, keyed by slot index. */
  const estimateBasis = new Map();

  const rows = plan.sequence.map((slot, i) => {
    const out = {
      slot: i + 1,
      tankId: slot.tankId || '',
      status: slot.status || 'pending',
      clock: tankClock(slot),
      rateShareMTPerHour: slot.status === 'filling' ? round(rateShare, 3) : 0,
      remainingToTargetM3: null,
      remainingToTargetMT: null,
      etaHours: null,
      etaLabel: '—',
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
      // Filled in by the estimating pass below, once the measured rate is known.
      estimateRateMTPerHour: 0,
      estimatedVolumeM3: null,
      estimatedVolumePercent: null,
      estimatedReadingMM: null,
      estimatedUllageMM: null,
      // The estimate in the same units the current-sound box is entered in,
      // which is not always an ullage — half these tanks are dipped.
      estimatedSoundingMM: null,
      estimatedAddedMT: null,
      estimatedFrom: '',
      estimatedAgeHours: null,
      estimatedAgeLabel: '—',
      estimatedToTargetHours: null,
      estimatedToTargetLabel: '—',
      estimatedTargetAtIso: null,
      estimatedToLimitHours: null,
      estimatedToLimitLabel: '—',
      estimatedLimitAtIso: null,
      estimatedOverLimit: false,
      reversedReading: false,
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
    const cap85 = capacity * SAFE_FILL;

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
        out.warnings.push(`above the 85% filling limit — ${round(out.currentVolumePercent, 1)}% `
          + `(${round(out.currentVolumeM3, 1)} of ${round(capacity, 1)} m³, limit ${round(cap85, 1)})`);
      }
      if (capacity > 0 && out.currentVolumeM3 > capacity) out.warnings.push('above 100% capacity');

      /* Very likely the reading was entered in the other sense.
       *
       * This column takes the reading in the tank's own gauging method, but
       * every other reading on the sheet is shown as an ullage, and nothing
       * used to say which was wanted. Entering the ullage into a dipped tank
       * turns an empty tank into a full one.
       *
       * Being merely high is not the marker. Flipping a high reading in a
       * roughly symmetric tank always yields a low one, so "the other sense
       * looks plausible" flags every genuine overfill too — a real 90% fill
       * would be accused of being a typo. What does mark it is the reading
       * running the tank up to the very top of its calibration table and
       * staying there: a controlled transfer stops well short of that, and a
       * reading that saturates is far more often the wrong sense than a tank
       * genuinely brimmed. Anything short of that is left to the 85% warning
       * to report as the overfill it may well be. */
      if (out.currentVolumeM3 >= capacity - fillTolerance(capacity)) {
        // A flipped reading of exactly zero is a real reading — an empty
        // dipped tank — so the bound is inclusive.
        const alt = (scaleTop(tank) || 0) - native;
        const altRes = alt >= 0
          ? computeTank(tank, { reading: alt, trim: trimByStern, list: heel, tempC, density15 })
          : null;
        const altVol = altRes ? altRes.volumeObserved : null;
        /* The opening volume came off the fuel report's own interpolation, so
           comparing to it needs real slack, not a floating-point epsilon. */
        const slack = fillTolerance(capacity);
        if (altVol != null && altVol <= cap85 + slack && altVol >= startVol - slack) {
          out.reversedReading = true;
          out.warnings.push(`this column takes a ${String(out.startingMethod).toUpperCase()} for this tank `
            + `— ${round(out.currentSoundingMM, 0)} read the other way is `
            + `${round(altVol, 1)} m³ (${round((altVol / capacity) * 100, 1)}%)`);
        }
      }
    }

    /* The estimating pass below needs the tank and its opening volume again;
       hold on to them rather than looking them up a second time. */
    estimateBasis.set(i, { tank, capacity, startVol, anchorAtH: num(slot.currentSoundingAtElapsedH, 0) || 0 });

    // What is left to put in this tank, and how long that takes at its share of
    // the delivery rate.
    if (out.targetVolumeM3 != null) {
      const nowVol = out.currentVolumeM3 != null ? out.currentVolumeM3 : startVol;
      const toGo = Math.max(0, out.targetVolumeM3 - nowVol);
      out.remainingToTargetM3 = round(toGo, 3);
      out.remainingToTargetMT = density15 != null
        ? round(mtFromVolume(toGo, density15, tempC), 3)
        : null;
      if (out.rateShareMTPerHour > 0 && out.remainingToTargetMT != null) {
        out.etaHours = round(out.remainingToTargetMT / out.rateShareMTPerHour, 3);
        out.etaLabel = hoursLabel(out.etaHours);
      }
      if (out.status === 'filling' && toGo <= 0.001) out.warnings.push('target reached — close this tank');
    }
    if (out.status === 'done' && out.currentSoundingMM == null) {
      out.warnings.push('closed without a final sounding');
    }

    return out;
  });

  const used = rows.filter((r) => r.tankId);
  const sum = (key) => used.reduce((a, r) => a + (num(r[key], 0) || 0), 0);
  const receivedMT = round(sum('quantityAddMT'), 3);
  const plannedAddMT = round(sum('planAddMT'), 3);
  const remaining = quantity != null ? Math.max(0, quantity - (receivedMT || 0)) : null;

  const liveClock = pumpingClock(plan, rate, receivedMT);
  const measuredRate = liveClock.elapsedHours != null && liveClock.elapsedHours > 0.03 && receivedMT > 0
    ? round(receivedMT / liveClock.elapsedHours, 2)
    : null;
  const workingRate = measuredRate != null ? measuredRate : rate;
  const etcHours = workingRate > 0 && remaining != null && liveClock.started && !liveClock.completed
    ? remaining / workingRate
    : null;
  const etcAtIso = etcHours != null && liveClock.running
    ? new Date(Date.now() + etcHours * 3600000).toISOString()
    : null;

  /* ------------------------------------------------------------------ *
   * Operation estimates.
   *
   * Where the sounding pipe would read now, if nobody has been down to
   * look, and when each tank reaches its target — carried forward from the
   * last real measurement at the rate the fuel is actually coming aboard.
   *
   * The rate everything here is projected at is observed, not agreed — which
   * is why this pass runs after the received total is known rather than
   * inside the row loop above.
   *
   * Observed does not mean received over pumping time, though. That figure
   * decays the longer nobody sounds a tank, because the fuel keeps coming
   * while the measured total stands still, and it halves when half the tanks
   * are still unsounded, because their intake is missing from the total
   * while their pumping time is not. Instead take each sounded tank's
   * measured intake over the time that tank had actually been open when it
   * was sounded: a rate measured over the window it was measured in, which
   * neither decays nor cares how many tanks are still unsounded. Multiplied
   * by the tanks now open, that is what the barge is delivering. Until
   * something has been sounded there is nothing to observe, and the planned
   * rate stands in — estimateBasisLabel says which is in use.
   *
   * Anchors are held in each tank's own running hours, not wall time, so a
   * tank shut for twenty minutes does not come back claiming to have taken
   * fuel while its valve was closed.
   *
   * Every figure here is kept apart from quantityAddMT and receivedMT on
   * purpose. Those are what the BDN is reconciled against and they must
   * come from a sounding somebody actually took.
   * ------------------------------------------------------------------ */
  let sampleMT = 0;
  let sampleH = 0;
  for (const out of rows) {
    const basis = estimateBasis.get(out.slot - 1);
    if (!basis || out.quantityAddMT == null || !(basis.anchorAtH > 0)) continue;
    sampleMT += out.quantityAddMT;
    sampleH += basis.anchorAtH;
  }
  const observedShare = sampleH > 0.03 && sampleMT > 0 ? round(sampleMT / sampleH, 3) : null;
  const estimateShare = observedShare != null ? observedShare
    : (workingRate > 0 && filling > 0 ? workingRate / filling : 0);
  const estimating = estimateShare > 0 && density15 != null;
  for (const out of rows) {
    const basis = estimateBasis.get(out.slot - 1);
    if (!estimating || !basis || out.status !== 'filling' || basis.capacity <= 0) continue;
    const { tank, capacity, startVol, anchorAtH } = basis;

    out.estimateRateMTPerHour = round(estimateShare, 3);
    const anchorVol = out.currentVolumeM3 != null ? out.currentVolumeM3 : startVol;
    const sinceH = Math.max(0, (out.clock.elapsedHours || 0) - (out.currentVolumeM3 != null ? anchorAtH : 0));
    {
      /* Run even at zero elapsed. A tank sounded this second projects to the
         level just read off the tape, which is the honest answer; leaving the
         row blank until a minute has passed only looks broken. */
      const addedVol = volumeFromMT(estimateShare * sinceH, density15, tempC) || 0;
      const estVol = Math.min(anchorVol + addedVol, capacity);
      out.estimatedVolumeM3 = round(estVol, 3);
      out.estimatedVolumePercent = round((estVol / capacity) * 100, 1);
      const estReading = readingForVolume(tank, estVol, ctx);
      out.estimatedReadingMM = estReading;
      out.estimatedUllageMM = estReading != null ? asUllage(tank, estReading) : null;
      out.estimatedSoundingMM = estReading == null ? null
        : (out.startingMethod === FuelReport.normalizeMethod(tank.soundingMethod)
          ? round(estReading, 0)
          : round((scaleTop(tank) || 0) - estReading, 0));
      out.estimatedFrom = out.currentVolumeM3 != null ? 'last sounding' : 'opening ullage';
      out.estimatedAgeHours = round(sinceH, 4);
      out.estimatedAgeLabel = hmsLabel(sinceH);
      out.estimatedAddedMT = round(mtFromVolume(Math.max(0, estVol - startVol), density15, tempC), 3);
    }

    /* When this tank reaches the 85% filling limit at the projected rate.
       The whole point of running the level forward is to see a limit coming
       before it arrives, so it is counted whether or not a target was set —
       an untargeted tank left open is exactly the one that overfills. */
    {
      const nowVol = out.estimatedVolumeM3 != null ? out.estimatedVolumeM3 : anchorVol;
      const lim = capacity * SAFE_FILL;
      out.estimatedOverLimit = nowVol > lim + fillTolerance(capacity);
      const toLimMT = mtFromVolume(Math.max(0, lim - nowVol), density15, tempC);
      if (toLimMT != null) {
        const h = toLimMT / estimateShare;
        out.estimatedToLimitHours = round(h, 3);
        out.estimatedToLimitLabel = out.estimatedOverLimit ? 'over' : hmsLabel(h);
        if (out.clock.running && !out.estimatedOverLimit) {
          out.estimatedLimitAtIso = new Date(Date.now() + h * 3600000).toISOString();
        }
      }
    }

    // How long until this tank reaches its target, counted from the
    // estimated level rather than from the last sounding, so the clock
    // keeps running between soundings instead of standing still.
    if (out.targetVolumeM3 != null) {
      const fromVol = out.estimatedVolumeM3 != null ? out.estimatedVolumeM3 : anchorVol;
      const toGoMT = mtFromVolume(Math.max(0, out.targetVolumeM3 - fromVol), density15, tempC);
      if (toGoMT != null) {
        const h = toGoMT / estimateShare;
        out.estimatedToTargetHours = round(h, 3);
        out.estimatedToTargetLabel = hmsLabel(h);
        if (out.clock.running) {
          out.estimatedTargetAtIso = new Date(Date.now() + h * 3600000).toISOString();
        }
      }
    }
  }
  const estimatedReceivedMT = rows.reduce(
    (a, r) => a + (r.estimatedAddedMT != null ? r.estimatedAddedMT : (num(r.quantityAddMT, 0) || 0)), 0);

  // When the parcel finishes, counted from the estimated intake at the
  // observed rate — the estimates panel's own clock, kept apart from the
  // countdown in the pumping panel, which runs on the measured total alone.
  const estRemaining = estimating && quantity != null
    ? Math.max(0, quantity - estimatedReceivedMT)
    : null;
  /* ------------------------------------------------------------------ *
   * Finishing the transfer: the measured intake against the delivery note.
   *
   * The received figure here is the sum of the soundings, and nothing else —
   * no estimate reaches it. A tank that took fuel and was never sounded is
   * named rather than counted as zero, and the difference is withheld until
   * every one of them has a reading. Reporting a shortfall built out of tanks
   * nobody has sounded would advise a letter of protest against a supplier
   * who delivered exactly what the note says.
   * ------------------------------------------------------------------ */
  const bdnQuantity = num(header.bdnQuantityMT);
  const tookFuel = used.filter((r) => r.status === 'done' || r.status === 'filling' || r.status === 'paused');
  const unsounded = tookFuel.filter((r) => r.currentSoundingMM == null).map((r) => r.name);
  const reversed = used.filter((r) => r.reversedReading).map((r) => r.name);
  const finished = Boolean(plan.completedAt);
  const reconcilable = bdnQuantity != null && tookFuel.length > 0 && unsounded.length === 0;
  const bdnDifference = reconcilable ? round((receivedMT || 0) - bdnQuantity, 3) : null;
  const bdnDifferencePercent = reconcilable && bdnQuantity
    ? round((((receivedMT || 0) - bdnQuantity) / bdnQuantity) * 100, 3)
    : null;

  const estOperationRate = estimateShare * (filling || 1);
  const estEtcHours = estRemaining != null && estOperationRate > 0
    && liveClock.started && !liveClock.completed
    ? estRemaining / estOperationRate
    : null;

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
      clock: liveClock,
      /* The rate the fuel is actually coming aboard at, rather than the one
         agreed beforehand. Ignored until there is enough of it to mean
         anything — a couple of minutes and some fuel — because received over a
         very short elapsed time swings wildly. */
      actualRateMTPerHour: measuredRate,
      rateSourceIsMeasured: measuredRate != null,
      effectiveRateMTPerHour: workingRate,
      etcHours: etcHours != null ? round(etcHours, 3) : null,
      etcLabel: etcHours != null ? hoursLabel(etcHours) : '—',
      etcAtIso: etcAtIso,
      countdownLabel: etcHours != null ? hmsLabel(etcHours) : '—',
      /* The estimates panel. Everything below is projected, never measured. */
      estimateShareMTPerHour: round(estimateShare, 3),
      estimateRateMTPerHour: round(estimateShare * (filling || 1), 3),
      estimateRateIsMeasured: observedShare != null || measuredRate != null,
      estimateBasisLabel: observedShare != null
        ? `observed — ${round(observedShare * (filling || 1), 1)} MT/h from the soundings taken`
        : (measuredRate != null
          ? `measured — ${round(measuredRate, 1)} MT/h over the pumping time`
          : (rate > 0 ? `planned — ${round(rate, 1)} MT/h, nothing sounded yet` : 'no rate to project from')),
      estimating: estimating,
      /* Received, carried forward to this moment: measured where a tank has
         been sounded since it opened, estimated where it has not. Shown
         alongside receivedMT, never in place of it. */
      estimatedReceivedMT: estimating ? round(estimatedReceivedMT, 3) : null,
      estimatedAheadMT: estimating ? round(estimatedReceivedMT - (receivedMT || 0), 3) : null,
      estimatedRemainingMT: estRemaining != null ? round(estRemaining, 3) : null,
      estimatedLimitSoonestHours: rows.reduce((a, r) => (r.estimatedToLimitHours != null
        && !r.estimatedOverLimit && (a == null || r.estimatedToLimitHours < a)
        ? r.estimatedToLimitHours : a), null),
      estimatedOverLimitTanks: rows.filter((r) => r.estimatedOverLimit).map((r) => r.name),
      estimatedEtcHours: estEtcHours != null ? round(estEtcHours, 3) : null,
      estimatedEtcLabel: estEtcHours != null ? hmsLabel(estEtcHours) : '—',
      estimatedEtcAtIso: estEtcHours != null && liveClock.running
        ? new Date(Date.now() + estEtcHours * 3600000).toISOString()
        : null,
      estimatedPercentComplete: estimating && quantity > 0
        ? round((estimatedReceivedMT / quantity) * 100, 1)
        : null,
      tanksFilling: filling,
      /* How many of the tanks taking fuel have actually been sounded. Without
         it, receivedMT reads 0 and the variance against the expected intake
         becomes a shortfall the barge never caused. */
      tanksSounded: rows.filter((r) => r.tankId && r.currentSoundingMM != null).length,
      rateSharePerTank: round(rateShare, 3),
      // Longest ETA among the open tanks — when the last one reaches its target.
      etaHours: used.reduce((a, r) => (r.etaHours != null ? Math.max(a, r.etaHours) : a), 0) || null,
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
    reconciliation: {
      finished,
      completedAtIso: plan.completedAt || null,
      tanksUsed: tookFuel.length,
      tanksUnsounded: unsounded,
      tanksReversed: reversed,
      receivedMT,
      bdnQuantityMT: bdnQuantity,
      differenceMT: bdnDifference,
      differencePercent: bdnDifferencePercent,
      reconcilable,
      pendingReason: reconcilable ? null
        : tookFuel.length === 0 ? 'no-tanks'
          : unsounded.length ? 'unsounded'
            : 'no-bdn',
      /* A delivery note is normally accepted within half a percent; past that,
         short, is what a letter of protest is for. */
      tolerancePercent: BDN_TOLERANCE_PERCENT,
      withinTolerance: bdnDifferencePercent != null
        ? Math.abs(bdnDifferencePercent) <= BDN_TOLERANCE_PERCENT
        : null,
      protestAdvised: bdnDifferencePercent != null
        ? bdnDifferencePercent < -BDN_TOLERANCE_PERCENT
        : null,
    },
    before: report,
    status: plan.status,
    form: plan,
    generatedAt: new Date().toISOString(),
  };
}

/** Tanks a distribution mode applies to, within the grade being loaded. */
function tanksForMode(bundle, mode, fuelType, byTank) {
  const graded = fuelTanks(bundle).filter((t) => {
    const row = byTank.get(t.id);
    // Match on what the fuel report says the tank is carrying, falling back to
    // the tank's own grade for tanks that have never been sounded.
    const grade = (row && row.fuelType) || FuelReport.defaultFuelType(t);
    return grade === fuelType;
  });
  switch (mode) {
    case 'port-storage': return graded.filter((t) => t.fuelRole === 'storage' && t.side === 'port');
    case 'starboard-storage': return graded.filter((t) => t.fuelRole === 'storage' && t.side === 'starboard');
    case 'no1-storage': return graded.filter((t) => t.fuelRole === 'storage' && Number(t.tankNo) === 1);
    case 'no2-storage': return graded.filter((t) => t.fuelRole === 'storage' && Number(t.tankNo) === 2);
    case 'no3-storage': return graded.filter((t) => t.fuelRole === 'storage' && Number(t.tankNo) === 3);
    case 'settling': return graded.filter((t) => t.fuelRole === 'settling');
    case 'service': return graded.filter((t) => t.fuelRole === 'service');
    case 'equal-storage':
    default: return graded.filter((t) => t.fuelRole === 'storage');
  }
}

/**
 * Spread `quantityMT` over the tanks a mode selects, weighted by the space each
 * has left below the 85% filling limit, and hand back plan sequence entries
 * (tank + target volume). Tanks are never targeted above that limit, so a
 * quantity that does not fit comes back short with a warning rather than
 * silently overfilling.
 */
/**
 * Free-space weighted: every tank takes a slice in proportion to the room it
 * has, capped at its own limit, with anything a capped tank cannot take passed
 * on. Tanks finish at different levels but all of them are worked at once.
 */
function shareByFreeSpace(rows, volume) {
  const share = new Map(rows.map((r) => [r.tank.id, 0]));
  let toPlace = volume;
  for (let pass = 0; pass < 4 && toPlace > 0.001; pass++) {
    const open = rows.filter((r) => share.get(r.tank.id) < r.free - 0.001);
    const openFree = open.reduce((a, r) => a + (r.free - share.get(r.tank.id)), 0);
    if (!open.length || openFree <= 0.001) break;
    let placed = 0;
    for (const r of open) {
      const room = r.free - share.get(r.tank.id);
      const take = Math.min(room, toPlace * (room / openFree));
      share.set(r.tank.id, share.get(r.tank.id) + take);
      placed += take;
    }
    toPlace -= placed;
  }
  return share;
}

/**
 * Level up the emptiest first.
 *
 * The emptiest tank is brought up to the level of the next emptiest; then those
 * two rise together to the third, and so on, until the parcel runs out or every
 * tank reaches its 85% limit. That answers both halves of what is wanted from a
 * fill plan at once: the tank with least in it is filled first and the rest of
 * the parcel spills into the next, and because tanks only ever rise to meet the
 * one above, they finish level with each other rather than at whatever
 * proportion of their own size they happened to get.
 *
 * Levels are compared as a percentage of capacity, not as depth, so a small
 * tank and a large one at the same percentage are treated as equally full.
 */
function shareByLevellingUp(rows, volume) {
  const share = new Map(rows.map((r) => [r.tank.id, 0]));
  const level = (r) => (r.capacity > 0
    ? ((r.startVol + share.get(r.tank.id)) / r.capacity) * 100
    : 100);
  const limitLevel = (r) => (r.capacity > 0 ? (r.limit / r.capacity) * 100 : 0);
  let left = volume;

  for (let guard = 0; guard < rows.length * 4 && left > 0.001; guard += 1) {
    const open = rows.filter((r) => level(r) < limitLevel(r) - 1e-9);
    if (!open.length) break;
    const lowest = Math.min(...open.map(level));
    const group = open.filter((r) => level(r) <= lowest + 1e-9);
    // Rise to whichever comes first: the next tank up, or the group's own limit.
    const above = open.map(level).filter((l) => l > lowest + 1e-9);
    const nextLevel = Math.min(
      above.length ? Math.min(...above) : Infinity,
      ...group.map(limitLevel)
    );
    const perPercent = group.reduce((a, r) => a + r.capacity / 100, 0);
    if (!(perPercent > 0)) break;
    const needed = (nextLevel - lowest) * perPercent;
    const step = Math.min(needed, left);
    const rise = step / perPercent;
    for (const r of group) share.set(r.tank.id, share.get(r.tank.id) + (rise * r.capacity) / 100);
    left -= step;
    if (step < needed - 0.001) break;   // parcel ran out part-way up
  }
  return share;
}

function distributeToSequence(bundle, opts = {}, conversion = null) {
  const quantity = num(opts.quantityMT);
  const fuelType = opts.fuelType || 'lsfo';
  const mode = opts.mode || 'equal-storage';
  const tempC = num(opts.tempC, 15) || 15;
  const density15 = num(opts.density15);
  const warnings = [];

  if (!(quantity > 0)) return { sequence: [], warnings: ['enter a bunker quantity first'] };
  if (!(density15 > 0)) return { sequence: [], warnings: ['enter the bunker density @15 °C first'] };

  const { byTank } = robBeforeBunkering(bundle, conversion);
  const tanks = tanksForMode(bundle, mode, fuelType, byTank);
  if (!tanks.length) return { sequence: [], warnings: [`no ${fuelType.toUpperCase()} tanks match "${mode}"`] };

  const levelUp = mode.startsWith('level');
  const rows = tanks.map((tank) => {
    const row = byTank.get(tank.id);
    const startVol = row && row.measuredM3 != null ? row.measuredM3 : 0;
    const capacity = num(tank.capacity, 0) || 0;
    const limit = capacity * SAFE_FILL;
    return {
      tank,
      startVol,
      capacity,
      limit,
      free: Math.max(0, limit - startVol),
      startPercent: capacity > 0 ? (startVol / capacity) * 100 : 0,
    };
  }).filter((r) => r.free > 0.01)
    // Emptiest first: that is the order the tanks are opened in, and for the
    // levelling allocator it is also the order they receive fuel.
    .sort((a, b) => (levelUp ? a.startPercent - b.startPercent : b.free - a.free));

  if (!rows.length) return { sequence: [], warnings: ['the matching tanks are already at the 85% limit'] };

  const totalVolume = volumeFromMT(quantity, density15, tempC) || 0;
  const totalFree = rows.reduce((a, r) => a + r.free, 0);
  if (totalVolume > totalFree + 0.01) {
    const shortM3 = totalVolume - totalFree;
    const shortMT = mtFromVolume(shortM3, density15, tempC);
    warnings.push(`the ${rows.length} selected tank(s) hold ${round(totalFree, 1)} m³ below the 85% limit, `
      + `${round(shortM3, 1)} m³ (${round(shortMT, 1)} MT) short of this parcel — `
      + 'select more tanks or reduce the quantity; the shortfall is left unallocated');
  }
  // A tank already over the limit before a drop is put into it is worth saying
  // out loud at planning time, not only once it is filling.
  for (const r of rows) {
    if (r.capacity > 0 && r.startPercent > SAFE_FILL * 100 + 0.05) {
      warnings.push(`${r.tank.name} is already at ${round(r.startPercent, 1)}% `
        + `(${round(r.startVol, 1)} of ${round(r.capacity, 1)} m³) — above the 85% limit before bunkering`);
    }
  }

  const share = levelUp
    ? shareByLevellingUp(rows, Math.min(totalVolume, totalFree))
    : shareByFreeSpace(rows, Math.min(totalVolume, totalFree));

  const sequence = rows
    .filter((r) => share.get(r.tank.id) > 0.001)
    .slice(0, PLAN_SLOTS)
    .map((r) => ({
      tankId: r.tank.id,
      targetVolumeM3: round(r.startVol + share.get(r.tank.id), 3),
      currentSoundingMM: '',
    }));

  if (rows.length > PLAN_SLOTS) {
    warnings.push(`${rows.length - PLAN_SLOTS} matching tank(s) did not fit the ${PLAN_SLOTS} plan slots`);
  }
  return { sequence, mode, fuelType, warnings };
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

  const rawPumping = eventGapHours(summary.events.pumpStart, summary.events.pumpStop);
  const rawAlongside = eventGapHours(summary.events.alongside, summary.events.castOff);
  // A negative gap means the times were entered the wrong way round. Reporting
  // it as a duration would be nonsense and hiding it as a dash lets the typo
  // through, so it is dropped and said out loud instead.
  const timingWarnings = [];
  if (rawPumping != null && rawPumping < 0) timingWarnings.push('Pump stop is before pump start — check the times.');
  if (rawAlongside != null && rawAlongside < 0) timingWarnings.push('Cast off is before alongside — check the times.');
  const pumpingHours = rawPumping != null && rawPumping >= 0 ? rawPumping : null;
  const alongsideHours = rawAlongside != null && rawAlongside >= 0 ? rawAlongside : null;

  /* The BDN can only be reconciled once the tanks have been sounded. Until then
     there is no measured figure, and the difference is unknown — not zero, and
     emphatically not a shortfall. Saying otherwise on this sheet would advise a
     letter of protest against a supplier over soundings nobody has taken yet. */
  const comparable = bdnQuantity != null && receivedQuantity != null;

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
      differenceMT: comparable ? round(receivedQuantity - bdnQuantity, 3) : null,
      // A BDN is normally accepted within 0.5%; anything past that is a protest.
      // Guarded on both figures: without the measurement this divided a missing
      // receipt by the BDN and reported a flat -100%.
      differencePercent: comparable && bdnQuantity
        ? round(((receivedQuantity - bdnQuantity) / bdnQuantity) * 100, 3)
        : null,
      comparable,
      pendingReason: comparable ? null
        : bdnQuantity == null ? 'no-bdn'
          : 'no-measurement',
    },
    timing: {
      warnings: timingWarnings,
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
  SAFE_FILL,
  BDN_TOLERANCE_PERCENT,
  TANK_STATES,
  tankClock,
  DISTRIBUTION_MODES,
  tanksForMode,
  distributeToSequence,
  pumpingClock,
  SHIP_CONDITIONS,
  SUMMARY_EVENTS,
  COMMON_FUEL_GRADES,
  readingForVolume,
  asUllage,
  fillTolerance,
  scaleTop,
  hoursLabel,
  hmsLabel,
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
