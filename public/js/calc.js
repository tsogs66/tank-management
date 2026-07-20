/* Tank calculation engine (browser) */
'use strict';
/** True when axis runs low→high (e.g. -2,-1,0,1,2). False for high→low (2,1,0,-1,-2). */
function isAscending(arr) {
  if (!arr || arr.length < 2) return true;
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

  if (gaugeType === 'volume') {
    // Volume gauge: the reading IS the observed volume already -- no interpolation.
    var volumeObserved = reading;
    var correctedReadingOut = reading;
    var soundingBottomOut = reading;
  } else if (tank.calcType === 'correction') {
    // Stage 1: trim correction (bilinear), applied to the raw reading
    trimCorr = bilinearInterp(tank.trimAxis, tank.trimVals, tank.trimGrid, reading, trim);
    corrected = reading + trimCorr / divisor;
    // Stage 2: list/heel correction (bilinear), applied to the trim-corrected reading
    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterp(tank.listAxis, tank.listVals, tank.listGrid, corrected, list);
      corrected = corrected + listCorr / divisor;
    }
    // Convert ullage -> sounding-from-bottom if this tank is read by ullage
    let soundingFromBottom = corrected;
    if (tank.soundingMethod && tank.soundingMethod.toLowerCase() === 'ullage' && tank.pipeHeight) {
      soundingFromBottom = tank.pipeHeight - corrected;
    }
    var volumeObserved = tank.volumeCurve
      ? linearInterp(tank.volumeCurve.x, tank.volumeCurve.v, soundingFromBottom)
      : 0;
    var correctedReadingOut = corrected;
    var soundingBottomOut = soundingFromBottom;
  } else {
    // Direct type: heel correction first (to the reading), then a bilinear
    // lookup on the trim grid (which holds volume directly) at the
    // heel-corrected reading & trim.
    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterp(tank.listAxis, tank.listVals, tank.listGrid, reading, list);
      corrected = reading + listCorr / divisor;
    }
    volumeObserved = bilinearInterp(tank.trimAxis, tank.trimVals, tank.trimGrid, corrected, trim);
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

