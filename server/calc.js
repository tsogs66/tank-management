/**
 * Tank sounding calculation engine
 * Double interpolation + ASTM Table 54B VCF + WCF
 */
'use strict';

/** True when axis runs low→high (e.g. -2,-1,0,1,2). False for high→low (2,1,0,-1,-2). */
function isAscending(arr) {
  if (!arr || arr.length < 2) return true;
  // Prefer endpoints; fall back to first non-equal neighbor
  if (arr[arr.length - 1] !== arr[0]) return arr[arr.length - 1] > arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== arr[0]) return arr[i] > arr[0];
  }
  return true;
}

/**
 * Find bracketing indices [lo, hi] for value v on a monotonic axis.
 * Supports ascending (-2,-1,0,1,2) and descending (2,1,0,-1,-2) tables.
 * Values outside the axis clamp to the nearest end segment.
 */
function bracket(arr, v) {
  const n = arr.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [0, 0];
  const asc = isAscending(arr);

  if (asc) {
    if (v <= arr[0]) return [0, 1];
    if (v >= arr[n - 1]) return [n - 2, n - 1];
  } else {
    if (v >= arr[0]) return [0, 1];
    if (v <= arr[n - 1]) return [n - 2, n - 1];
  }

  let a = 0, b = n - 1;
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (asc) {
      if (arr[m] <= v) a = m; else b = m;
    } else {
      if (arr[m] >= v) a = m; else b = m;
    }
  }
  return [a, b];
}

function linearInterp(xArr, yArr, x) {
  const n = xArr.length;
  if (n === 0) return 0;
  if (n === 1) return yArr[0];
  const [lo, hi] = bracket(xArr, x);
  const x1 = xArr[lo], x2 = xArr[hi];
  const y1 = yArr[lo], y2 = yArr[hi];
  if (x2 === x1) return y1;
  // Works for both ascending and descending x (signs cancel)
  return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
}

/**
 * Bilinear ("double") interpolation over a 2-D grid, equivalent to VBA Interp2().
 * xAxis/yAxis may be ascending or descending (e.g. trim -2…+2 or +2…-2).
 * xAxis: row axis (length n), yAxis: column axis (length m), grid: n x m values.
 */
function bilinearInterp(xAxis, yAxis, grid, x, y) {
  const [lx, ux] = bracket(xAxis, x);
  const [ly, uy] = bracket(yAxis, y);
  const v = (i, j) => grid[i][j];

  if (lx === ux && ly === uy) return v(lx, ly);

  const x1 = xAxis[lx], x2 = xAxis[ux];
  const y1 = yAxis[ly], y2 = yAxis[uy];

  if (lx === ux) {
    const f11 = v(lx, ly), f12 = v(lx, uy);
    return y2 === y1 ? f11 : f11 + (f12 - f11) * (y - y1) / (y2 - y1);
  }
  if (ly === uy) {
    const f11 = v(lx, ly), f21 = v(ux, ly);
    return x2 === x1 ? f11 : f11 + (f21 - f11) * (x - x1) / (x2 - x1);
  }
  const f11 = v(lx, ly), f21 = v(ux, ly), f12 = v(lx, uy), f22 = v(ux, uy);
  let fxy = f11 * (x2 - x) * (y2 - y)
          + f21 * (x - x1) * (y2 - y)
          + f12 * (x2 - x) * (y - y1)
          + f22 * (x - x1) * (y - y1);
  fxy /= (x2 - x1) * (y2 - y1);
  return fxy;
}

/** Preferred sounding-table increments (cm), matching ship calibration books. */
const PREFERRED_INCREMENTS = [1, 2, 5, 10, 20, 25, 50];

/**
 * Detect the dominant step of a sounding/depth axis.
 * Prefers 1, 2, 5, 10 (also accepts 20/25/50 as used in some HFO tables).
 */
function detectIncrement(axis) {
  if (!axis || axis.length < 2) return 1;
  const diffs = [];
  for (let i = 1; i < axis.length; i++) {
    const d = Math.abs(axis[i] - axis[i - 1]);
    if (d > 0) diffs.push(Math.round(d * 1000) / 1000);
  }
  if (!diffs.length) return 1;

  // Mode of diffs
  const counts = new Map();
  for (const d of diffs) counts.set(d, (counts.get(d) || 0) + 1);
  let best = diffs[0], bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) { best = d; bestN = n; }
  }

  // Snap to a preferred increment when very close
  for (const p of PREFERRED_INCREMENTS) {
    if (Math.abs(best - p) < 1e-6) return p;
  }
  return best;
}

/** Excel-compatible FLOOR(n, significance) toward −∞. */
function excelFloor(n, significance) {
  const s = Math.abs(Number(significance) || 0);
  if (!s) return n;
  return Math.floor(n / s) * s;
}

/** Excel-compatible CEILING(n, significance) toward +∞. */
function excelCeiling(n, significance) {
  const s = Math.abs(Number(significance) || 0);
  if (!s) return n;
  return Math.ceil(n / s) * s;
}

/**
 * Double interpolation with sounding-table increment (Excel Tank-sheet style):
 *   FLOOR/CEILING the sounding to the table step (1, 2, 5, 10, …),
 *   Interp2 at both bounds, then Interp1 between those results.
 * Works with ascending or descending trim/list column axes.
 */
function bilinearInterpInc(xAxis, yAxis, grid, x, y, xInc) {
  const inc = Number(xInc) > 0 ? Number(xInc) : detectIncrement(xAxis);
  if (!inc || !xAxis || xAxis.length < 2) {
    return bilinearInterp(xAxis, yAxis, grid, x, y);
  }

  const xLo = excelFloor(x, inc);
  const xHi = excelCeiling(x, inc);
  if (xLo === xHi) {
    return bilinearInterp(xAxis, yAxis, grid, x, y);
  }

  const vLo = bilinearInterp(xAxis, yAxis, grid, xLo, y);
  const vHi = bilinearInterp(xAxis, yAxis, grid, xHi, y);
  return linearInterp([xLo, xHi], [vLo, vHi], x);
}

/** Resolve sounding / heel increments from tank metadata or axis spacing. */
function resolveIncrements(tank) {
  const soundingInc = Number(tank.soundingIncrement) > 0
    ? Number(tank.soundingIncrement)
    : detectIncrement(tank.trimAxis);
  const heelInc = Number(tank.heelIncrement) > 0
    ? Number(tank.heelIncrement)
    : (tank.listAxis && tank.listAxis.length
      ? detectIncrement(tank.listAxis)
      : soundingInc);
  return { soundingInc, heelInc };
}

/**
 * ASTM Table 54B Volume Correction Factor (VCF), reconstructed from the
 * 'ASTM Tables' sheet formulas (columns K..W). Selects a density-dependent
 * alpha (thermal expansion coefficient per the ASTM-IP-API Petroleum
 * Measurement Tables) then applies the standard exponential correction.
 */
function vcf54B(density15, tempC) {
  const J = Math.round(1000 * density15 * 100) / 100; // density in kg/m3
  const round7 = (v) => Math.round(v * 1e7) / 1e7;
  const K = round7((186.9696 / (J * J)) + (0.4862 / J));   // 0.839 <= d < 1.075
  const L = round7((594.5418 / (J * J)) + (0 / J));         // 0.7875 <= d < 0.839
  const M = round7(-0.00336312 + 2680.3206 / (J * J));      // 0.7705 <= d < 0.7875
  const N = round7((346.4228 / (J * J)) + (0.4388 / J));    // d < 0.7705
  const O = round7((330.301 / (J * J)) + (0 / J));          // d >= 1.075 (fallback)

  let alpha;
  if (density15 < 0.7705) alpha = N;
  else if (density15 < 0.7875) alpha = M;
  else if (density15 < 0.839) alpha = L;
  else if (density15 < 1.075) alpha = K;
  else alpha = O;

  const round8 = (v) => Math.round(v * 1e8) / 1e8;
  const round9 = (v) => Math.round(v * 1e9) / 1e9;
  const dT = Math.round((tempC - 15) * 100) / 100;
  const R = round8(alpha * dT);
  const T = round9(alpha * alpha * dT * dT * 0.8);
  const U = round8(-R - T);
  const V = Math.exp(U);
  return Math.round(V * 10000) / 10000;
}

/** WCF (weight correction, from ASTM Table 56 as used in the workbook: density15 - 0.0011 air buoyancy allowance). */
function wcf56(density15) {
  return density15 - 0.0011;
}

/**
 * Full double-interpolation calculation for one tank + one reading.
 * tank: extracted tank definition (see tanks-data.js)
 * inputs: { reading, trim, list, tempC, density15, gaugeType }
 *   reading: raw sounding/ullage/dip/depth/gauge value, in the tank's native unit
 *     (or a volume in m3 directly, when gaugeType === 'volume')
 *   gaugeType: 'meter' (default) reads `reading` through the calibration table/grid.
 *     'volume' treats `reading` as an already-known volume in m3 (some small
 *     settling/service tanks are logged as a direct volume-gauge reading rather
 *     than a meter/ullage figure) and skips interpolation entirely.
 */
function computeTank(tank, inputs) {
  const { reading, trim = 0, list = 0, tempC = 15, density15 = null, gaugeType = 'meter' } = inputs;
  const divisor = tank.correctionDivisor || 1;

  let trimCorr = 0, listCorr = 0, corrected = reading;

  const { soundingInc, heelInc } = resolveIncrements(tank);

  if (gaugeType === 'volume') {
    // Volume gauge: the reading IS the observed volume already -- no interpolation.
    var volumeObserved = reading;
    var correctedReadingOut = reading;
    var soundingBottomOut = reading;
  } else if (tank.calcType === 'correction') {
    // Stage 1: trim correction — Excel-style double interp at sounding increment
    trimCorr = bilinearInterpInc(
      tank.trimAxis, tank.trimVals, tank.trimGrid, reading, trim, soundingInc
    );
    corrected = reading + trimCorr / divisor;
    // Stage 2: list/heel correction at heel/list increment
    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, tank.listVals, tank.listGrid, corrected, list, heelInc
      );
      corrected = corrected + listCorr / divisor;
    }
    // Convert ullage -> sounding-from-bottom if this tank is read by ullage
    let soundingFromBottom = corrected;
    if (tank.soundingMethod && tank.soundingMethod.toLowerCase() === 'ullage' && tank.pipeHeight) {
      soundingFromBottom = tank.pipeHeight - corrected;
    }
    // Volume curve is usually 1 cm steps; linearInterp handles any increment
    var volumeObserved = tank.volumeCurve
      ? linearInterp(tank.volumeCurve.x, tank.volumeCurve.v, soundingFromBottom)
      : 0;
    var correctedReadingOut = corrected;
    var soundingBottomOut = soundingFromBottom;
  } else {
    // Direct type: heel correction first, then trim×volume grid (both stepped)
    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, tank.listVals, tank.listGrid, reading, list, heelInc
      );
      corrected = reading + listCorr / divisor;
    }
    volumeObserved = bilinearInterpInc(
      tank.trimAxis, tank.trimVals, tank.trimGrid, corrected, trim, soundingInc
    );
    correctedReadingOut = corrected;
    soundingBottomOut = corrected;
  }

  volumeObserved = Math.max(0, Math.min(volumeObserved, tank.capacity * 1.02));

  let vcf = null, correctedVolume15 = null, wcf = null, weightMT = null;
  if (density15 != null && density15 > 0) {
    vcf = vcf54B(density15, tempC);
    correctedVolume15 = volumeObserved * vcf;
    wcf = wcf56(density15);
    weightMT = correctedVolume15 * wcf;
  }

  return {
    gaugeType,
    soundingIncrement: soundingInc,
    heelIncrement: heelInc,
    trimCorrection: trimCorr,
    listCorrection: listCorr,
    correctedReading: correctedReadingOut,
    soundingFromBottom: soundingBottomOut,
    volumeObserved,
    fillPercent: tank.capacity ? (volumeObserved / tank.capacity) * 100 : null,
    vcf,
    correctedVolume15,
    wcf,
    weightMT,
  };
}


/**
 * Convert MT ↔ observed m³ using ASTM WCF (and optional VCF when temp ≠ 15).
 * volumeObserved ≈ (MT / WCF) / VCF
 */
function volumeFromMT(mt, density15, tempC = 15) {
  const dens = Number(density15);
  const mass = Number(mt);
  if (!(dens > 0) || !(mass >= 0)) return null;
  const wcf = wcf56(dens);
  if (!(wcf > 0)) return null;
  const vol15 = mass / wcf;
  const vcf = vcf54B(dens, tempC ?? 15);
  return vcf > 0 ? vol15 / vcf : vol15;
}

function mtFromVolume(volumeObserved, density15, tempC = 15) {
  const dens = Number(density15);
  const vol = Number(volumeObserved);
  if (!(dens > 0) || !(vol >= 0)) return null;
  const vcf = vcf54B(dens, tempC ?? 15);
  const wcf = wcf56(dens);
  return vol * vcf * wcf;
}

/**
 * Mix fuels of different density @15°C.
 * Each part: { density15, quantityMT } and/or { density15, volumeM3, tempC }
 * method: 'wcf' (default) — blend via vol@15 from WCF; 'mass' — mass-weighted ρ
 */
function blendFuels(parts = [], method = 'wcf') {
  const rows = [];
  let totalMT = 0;
  let totalVol15 = 0;
  let massRhoSum = 0;

  for (const p of parts || []) {
    const dens = Number(p.density15);
    if (!(dens > 0)) continue;
    let mt = p.quantityMT != null && p.quantityMT !== '' ? Number(p.quantityMT) : null;
    let volObs = p.volumeM3 != null && p.volumeM3 !== '' ? Number(p.volumeM3) : null;
    const tempC = p.tempC != null && p.tempC !== '' ? Number(p.tempC) : 15;
    const wcf = wcf56(dens);
    const vcf = vcf54B(dens, tempC);

    if (mt == null && volObs != null) mt = volObs * vcf * wcf;
    if (volObs == null && mt != null && wcf > 0) {
      const vol15 = mt / wcf;
      volObs = vcf > 0 ? vol15 / vcf : vol15;
    }
    if (mt == null || !(mt >= 0) || !(wcf > 0)) continue;

    const vol15 = mt / wcf;
    rows.push({
      label: p.label || '',
      density15: dens,
      quantityMT: mt,
      volumeM3: volObs,
      volume15: vol15,
      tempC,
      wcf,
      vcf,
    });
    totalMT += mt;
    totalVol15 += vol15;
    massRhoSum += mt * dens;
  }

  if (!rows.length || totalVol15 <= 0) {
    return { parts: rows, totalMT: 0, totalVol15: 0, blendedDensity15: null, method };
  }

  let blendedDensity15;
  if (method === 'mass') {
    blendedDensity15 = massRhoSum / totalMT;
  } else {
    // Consistent with WCF: M = V15 * (ρ - 0.0011) → ρ = M/V15 + 0.0011
    blendedDensity15 = totalMT / totalVol15 + 0.0011;
  }
  blendedDensity15 = Math.round(blendedDensity15 * 1e6) / 1e6;

  return {
    parts: rows,
    totalMT: Math.round(totalMT * 1000) / 1000,
    totalVol15: Math.round(totalVol15 * 1000) / 1000,
    blendedDensity15,
    blendedWcf: wcf56(blendedDensity15),
    method,
  };
}

/**
 * Live bunkering progress from planned MT, pumping rate, and clock.
 */
function bunkerProgress({
  plannedMT = 0,
  receivedMT = null,
  rateMTPerHour = 0,
  startedAt = null,
  pausedAt = null,
  elapsedPausedMs = 0,
  now = Date.now(),
} = {}) {
  const planned = Math.max(0, Number(plannedMT) || 0);
  const rate = Math.max(0, Number(rateMTPerHour) || 0);
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const pauseMs = pausedAt ? new Date(pausedAt).getTime() : null;

  let elapsedMs = 0;
  if (startMs) {
    const endMs = pauseMs || nowMs;
    elapsedMs = Math.max(0, endMs - startMs - (Number(elapsedPausedMs) || 0));
  }
  const elapsedHours = elapsedMs / 3600000;
  const estimatedFromRate = rate > 0 ? rate * elapsedHours : 0;

  let received = receivedMT != null && receivedMT !== ''
    ? Math.max(0, Number(receivedMT) || 0)
    : estimatedFromRate;
  if (planned > 0) received = Math.min(received, planned);

  const remaining = Math.max(0, planned - received);
  const timeRemainingHours = rate > 0 ? remaining / rate : null;
  const pct = planned > 0 ? (received / planned) * 100 : 0;

  return {
    plannedMT: planned,
    receivedMT: Math.round(received * 1000) / 1000,
    remainingMT: Math.round(remaining * 1000) / 1000,
    rateMTPerHour: rate,
    elapsedMs,
    elapsedHours: Math.round(elapsedHours * 10000) / 10000,
    timeUsedLabel: formatDuration(elapsedMs),
    timeRemainingHours,
    timeRemainingMs: timeRemainingHours != null ? timeRemainingHours * 3600000 : null,
    timeRemainingLabel: timeRemainingHours != null ? formatDuration(timeRemainingHours * 3600000) : '—',
    percentComplete: Math.round(pct * 10) / 10,
    etaAt: timeRemainingHours != null && !pauseMs
      ? new Date(nowMs + timeRemainingHours * 3600000).toISOString()
      : null,
    paused: Boolean(pauseMs),
  };
}

function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

module.exports = {
  isAscending,
  linearInterp,
  bracket,
  bilinearInterp,
  bilinearInterpInc,
  detectIncrement,
  excelFloor,
  excelCeiling,
  resolveIncrements,
  PREFERRED_INCREMENTS,
  vcf54B,
  wcf56,
  computeTank,
  volumeFromMT,
  mtFromVolume,
  blendFuels,
  bunkerProgress,
  formatDuration,
};
