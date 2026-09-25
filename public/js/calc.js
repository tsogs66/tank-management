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

/** Preferred sounding-table increments for millimetre / centimetre axes. */
const PREFERRED_INCREMENTS_MM = [1, 2, 5, 10, 20, 25, 50, 100];
/** Preferred increments for metre-scale sounding/ullage/depth axes. */
const PREFERRED_INCREMENTS_M = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
/** @deprecated use PREFERRED_INCREMENTS_MM — kept for callers that import the old name */
const PREFERRED_INCREMENTS = PREFERRED_INCREMENTS_MM;

/**
 * Detect calibration sounding / ullage / depth axis units.
 *
 * Common books tabulate millimetres (integer steps: 0, 50, 100, …).
 * When the depth column contains decimal steps (0.10, 0.25, 1.50, …) the
 * table is in metres. A single fractional tip (pipe-height endpoint) on an
 * otherwise integer mm axis does not flip the unit.
 *
 * Explicit `tank.soundingUnit` ('mm' | 'm' | 'cm') always wins.
 */
function normalizeLengthUnit(unit) {
  const u = String(unit == null ? '' : unit).trim().toLowerCase();
  if (u === 'mm' || u === 'millimetre' || u === 'millimeter' || u === 'millimeters') return 'mm';
  if (u === 'cm' || u === 'centimetre' || u === 'centimeter' || u === 'centimeters') return 'cm';
  if (u === 'm' || u === 'metre' || u === 'meter' || u === 'meters' || u === 'metres') return 'm';
  return null;
}

/** Millimetres per named length unit — for converting trim/heel ↔ sounding axes. */
const MM_PER_UNIT = { mm: 1, cm: 10, m: 1000 };

/**
 * Convert a length between mm / cm / m.
 * Example: lengthToUnit(9, 'mm', 'm') → 0.009; lengthToUnit(120, 'cm', 'm') → 1.2
 */
function lengthToUnit(value, fromUnit, toUnit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return v;
  const from = normalizeLengthUnit(fromUnit) || 'mm';
  const to = normalizeLengthUnit(toUnit) || 'mm';
  if (from === to) return v;
  return (v * MM_PER_UNIT[from]) / MM_PER_UNIT[to];
}

function detectSoundingUnit(tank) {
  const explicit = normalizeLengthUnit(tank && tank.soundingUnit);
  if (explicit) return explicit;

  const nums = [];
  for (const axis of [tank && tank.trimAxis, tank && tank.listAxis, tank && tank.volumeCurve && tank.volumeCurve.x]) {
    if (!Array.isArray(axis)) continue;
    for (const v of axis) {
      const n = Number(v);
      if (Number.isFinite(n)) nums.push(n);
    }
  }
  if (nums.length < 2) return 'mm';

  // Drop a solitary trailing tip (often the pipe height, e.g. 781.2 on an mm table).
  const body = nums.length > 3 ? nums.slice(0, -1) : nums;
  const fractional = body.filter((v) => Math.abs(v - Math.round(v)) > 1e-6);
  const maxAbs = Math.max(...body.map((v) => Math.abs(v)));

  if (fractional.length >= 2) return 'm';
  if (fractional.length >= 1 && maxAbs <= 40) return 'm';
  return 'mm';
}

/**
 * Detect the unit of trim/heel *length correction values* (may differ from the
 * sounding axis). E.g. sounding table in metres while heel/trim corrections
 * are tabulated in millimetres.
 *
 * Explicit `tank.correctionUnit` (or trimCorrectionUnit / heelCorrectionUnit)
 * always wins. Otherwise infer from correction-grid magnitudes vs sounding unit.
 */
function detectCorrectionUnit(tank, soundingUnit) {
  const explicit = normalizeLengthUnit(tank && tank.correctionUnit)
    || normalizeLengthUnit(tank && tank.trimCorrectionUnit)
    || normalizeLengthUnit(tank && tank.heelCorrectionUnit);
  if (explicit) return explicit;

  const su = normalizeLengthUnit(soundingUnit) || detectSoundingUnit(tank);
  const samples = [];
  for (const grid of [tank && tank.trimGrid, tank && tank.listGrid]) {
    if (!Array.isArray(grid)) continue;
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i];
      if (!Array.isArray(row)) continue;
      for (let j = 0; j < row.length; j++) {
        const n = Number(row[j]);
        if (Number.isFinite(n) && Math.abs(n) > 1e-9) samples.push(Math.abs(n));
      }
    }
  }
  if (!samples.length) return su;

  samples.sort((a, b) => a - b);
  const maxAbs = samples[samples.length - 1];
  const median = samples[Math.floor(samples.length / 2)];

  // Sounding in metres: corrections that look like whole millimetres (9, 14, 120…)
  // must be converted (÷1000) before adding to the metre sounding.
  if (su === 'm') {
    if (median >= 0.5 || maxAbs > 1) return 'mm';
    return 'm';
  }
  // Sounding in cm: large integer corrections are often mm sticks.
  if (su === 'cm') {
    if (median >= 10 && maxAbs >= 50) return 'mm';
    return 'cm';
  }
  // Sounding in mm — corrections share mm (Veniamis-style, often with a divisor).
  return 'mm';
}

/**
 * Apply a signed length correction onto a sounding, converting correction-table
 * units into the sounding-table unit. Sign is already in `corrRaw` (positive
 * adds, negative subtracts). `divisor` scales raw table values (Excel ×10 books).
 */
function applyLengthCorrection(sounding, corrRaw, divisor, correctionUnit, soundingUnit) {
  const raw = Number(corrRaw);
  if (!Number.isFinite(raw) || raw === 0) return Number(sounding) || 0;
  const native = raw / (Number(divisor) > 0 ? Number(divisor) : 1);
  const delta = lengthToUnit(native, correctionUnit, soundingUnit);
  return (Number(sounding) || 0) + delta;
}

/**
 * UI soundings are entered in centimetres. Convert cm → native table units.
 */
function cmToTableUnits(cm, unitOrTank) {
  const v = Number(cm);
  if (!Number.isFinite(v)) return v;
  const unit = typeof unitOrTank === 'string'
    ? (normalizeLengthUnit(unitOrTank) || unitOrTank)
    : detectSoundingUnit(unitOrTank);
  if (unit === 'm') return v / 100;
  if (unit === 'cm') return v;
  return v * 10; // mm (default)
}

/** Inverse of cmToTableUnits — table-native value → centimetres for the UI. */
function tableUnitsToCm(tableVal, unitOrTank) {
  const v = Number(tableVal);
  if (!Number.isFinite(v)) return v;
  const unit = typeof unitOrTank === 'string'
    ? (normalizeLengthUnit(unitOrTank) || unitOrTank)
    : detectSoundingUnit(unitOrTank);
  if (unit === 'm') return v * 100;
  if (unit === 'cm') return v;
  return v / 10; // mm
}

/**
 * Detect the dominant step of a sounding/depth axis.
 * Prefers ship-book increments for the detected unit (mm or m).
 */
function detectIncrement(axis, unit) {
  if (!axis || axis.length < 2) return unit === 'm' ? 0.01 : 1;
  const diffs = [];
  for (let i = 1; i < axis.length; i++) {
    const d = Math.abs(axis[i] - axis[i - 1]);
    if (d > 0) diffs.push(Math.round(d * 1000) / 1000);
  }
  if (!diffs.length) return unit === 'm' ? 0.01 : 1;

  // Mode of diffs
  const counts = new Map();
  for (const d of diffs) counts.set(d, (counts.get(d) || 0) + 1);
  let best = diffs[0], bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) { best = d; bestN = n; }
  }

  const preferred = unit === 'm' ? PREFERRED_INCREMENTS_M : PREFERRED_INCREMENTS_MM;
  const tol = unit === 'm' ? 1e-9 : 1e-6;
  for (const p of preferred) {
    if (Math.abs(best - p) < tol) return p;
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

/**
 * Put back the upright column the booklets leave out.
 *
 * A heeling table prints -4 -3 -2 -1 1 2 3 4 and no zero: upright there is no
 * correction, so the column would be all zeros and the page saved the width.
 * Reading straight from -1 to +1 across that gap invents a correction for an
 * upright ship, because the two sides are not mirror images. On the FLAG EVI
 * book it reaches 20 mm, and where the heel table is a volume correction that
 * lands in the answer whole: NO.1 H.F.O. TK (P) at ullage 1080 came out 1.175
 * m3 over the figure the same table gives by hand.
 */
function insertUprightColumn(vals, grid) {
  if (!vals || vals.length < 2 || !grid || !grid.length) return { vals, grid };
  if (vals.some((v) => Number(v) === 0)) return { vals, grid };
  let at = -1;
  for (let i = 1; i < vals.length; i++) {
    if ((Number(vals[i - 1]) < 0) !== (Number(vals[i]) < 0)) { at = i; break; }
  }
  if (at < 0) return { vals, grid };
  return {
    vals: vals.slice(0, at).concat(0, vals.slice(at)),
    grid: grid.map((row) => row.slice(0, at).concat(0, row.slice(at))),
  };
}

/** Resolve sounding / heel increments from tank metadata or axis spacing. */
function resolveIncrements(tank) {
  const unit = detectSoundingUnit(tank);
  const correctionUnit = detectCorrectionUnit(tank, unit);
  const soundingInc = Number(tank.soundingIncrement) > 0
    ? Number(tank.soundingIncrement)
    : detectIncrement(tank.trimAxis, unit);
  const heelInc = Number(tank.heelIncrement) > 0
    ? Number(tank.heelIncrement)
    : (tank.listAxis && tank.listAxis.length
      ? detectIncrement(tank.listAxis, unit)
      : soundingInc);
  return { soundingInc, heelInc, soundingUnit: unit, correctionUnit };
}

/**
 * ASTM Table 54B thermal expansion coefficient (alpha) for a density @15°C,
 * reconstructed from the 'ASTM Tables' sheet formulas (columns K..W).
 * Returns the coefficient plus the density band it was selected from, so the
 * report calculation annex can show which band was applied.
 */
function alpha54B(density15) {
  const J = Math.round(1000 * density15 * 100) / 100; // density in kg/m3
  const round7 = (v) => Math.round(v * 1e7) / 1e7;
  const K = round7((186.9696 / (J * J)) + (0.4862 / J));   // 0.839 <= d < 1.075
  const L = round7((594.5418 / (J * J)) + (0 / J));         // 0.7875 <= d < 0.839
  const M = round7(-0.00336312 + 2680.3206 / (J * J));      // 0.7705 <= d < 0.7875
  const N = round7((346.4228 / (J * J)) + (0.4388 / J));    // d < 0.7705
  const O = round7((330.301 / (J * J)) + (0 / J));          // d >= 1.075 (fallback)

  if (density15 < 0.7705) return { alpha: N, band: 'd < 0.7705' };
  if (density15 < 0.7875) return { alpha: M, band: '0.7705 <= d < 0.7875' };
  if (density15 < 0.839) return { alpha: L, band: '0.7875 <= d < 0.839' };
  if (density15 < 1.075) return { alpha: K, band: '0.839 <= d < 1.075' };
  return { alpha: O, band: 'd >= 1.075' };
}

/**
 * VCF (ASTM 54B) with every intermediate of the workbook formula, for report
 * annexes: alpha band, dT, the exponent, and the rounded factor.
 */
function vcfDetail54B(density15, tempC) {
  const { alpha, band } = alpha54B(density15);
  const round8 = (v) => Math.round(v * 1e8) / 1e8;
  const round9 = (v) => Math.round(v * 1e9) / 1e9;
  const dT = Math.round((tempC - 15) * 100) / 100;
  const R = round8(alpha * dT);
  const T = round9(alpha * alpha * dT * dT * 0.8);
  const U = round8(-R - T);
  const V = Math.exp(U);
  return {
    density15,
    tempC,
    deltaT: dT,
    alpha,
    band,
    exponent: U,
    vcf: Math.round(V * 10000) / 10000,
  };
}

/**
 * ASTM Table 54B Volume Correction Factor (VCF). Selects a density-dependent
 * alpha (thermal expansion coefficient per the ASTM-IP-API Petroleum
 * Measurement Tables) then applies the standard exponential correction.
 */
function vcf54B(density15, tempC) {
  return vcfDetail54B(density15, tempC).vcf;
}

/** WCF (weight correction, from ASTM Table 56 as used in the workbook: density15 - 0.0011 air buoyancy allowance). */
function wcf56(density15) {
  return density15 - 0.0011;
}

/**
 * True when trim/volume tables are sounding-from-bottom (volume rises with the
 * axis). False for ullage-indexed tables (volume falls as the axis rises).
 * Veniamis correction tanks are sounding tables even when the user enters ullage.
 */
function tablesUseSounding(tank) {
  const vc = tank && tank.volumeCurve;
  if (vc && Array.isArray(vc.v) && vc.v.length >= 2) {
    return Number(vc.v[vc.v.length - 1]) >= Number(vc.v[0]);
  }
  /* Direct / capacity grids: even-keel (or mid) column climbing = sounding. */
  const grid = tank && tank.trimGrid;
  const vals = tank && tank.trimVals;
  if (grid && grid.length >= 2) {
    let mid = 0;
    if (Array.isArray(vals) && vals.length) {
      let best = Infinity;
      vals.forEach((v, i) => {
        const a = Math.abs(Number(v));
        if (Number.isFinite(a) && a < best) { best = a; mid = i; }
      });
    } else {
      mid = Math.max(0, Math.floor(((vals || []).length || 1) / 2));
    }
    const first = Number(grid[0][mid]);
    const last = Number(grid[grid.length - 1][mid]);
    if (Number.isFinite(first) && Number.isFinite(last) && first !== last) {
      return last >= first;
    }
  }
  return true;
}

/**
 * True when the tank carries parallel ullage + sounded depth columns (same
 * rows as trimAxis). Switching sounding↔ullage then remaps through those
 * columns instead of subtracting from pipe height.
 */
function hasDualDepthAxes(tank) {
  const u = tank && tank.ullageAxis;
  const s = tank && tank.soundingAxis;
  if (!Array.isArray(u) || !Array.isArray(s) || u.length < 2 || s.length < 2) return false;
  let pairs = 0;
  const n = Math.min(u.length, s.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(Number(u[i])) && Number.isFinite(Number(s[i]))) pairs += 1;
  }
  return pairs >= 2;
}

/**
 * Map a user sounding into the calibration table's axis units (Excel Setup!F).
 * entryMethod: 'ullage' | 'dip' | 'sounding' — how `reading` was taken.
 * Trim/heel interpolation must see this table-scale value, never a scaled trim.
 */
/** Pipe / table top used to convert ullage ↔ sounding. Explicit pipe wins;
 *  otherwise dual-axis row sums, else the top of the sounding/ullage axis. */
function effectivePipeHeight(tank) {
  const explicit = Number(tank && tank.pipeHeight);
  if (explicit > 0) return explicit;
  if (hasDualDepthAxes(tank)) {
    let top = 0;
    const n = Math.min(tank.ullageAxis.length, tank.soundingAxis.length);
    for (let i = 0; i < n; i++) {
      const sum = Number(tank.ullageAxis[i]) + Number(tank.soundingAxis[i]);
      if (Number.isFinite(sum) && sum > top) top = sum;
    }
    if (top > 0) return top;
  }
  const axis = (tank && (tank.trimAxis || tank.listAxis)) || [];
  let top = 0;
  for (const v of axis) {
    const n = Number(v);
    if (Number.isFinite(n) && n > top) top = n;
  }
  return top > 0 ? top : 0;
}

/**
 * Map a user reading onto trimAxis. Dual-depth tables remap through the
 * paired ullage/sounding columns; single-axis tables fall back to pipe − reading.
 */
function toTableReading(tank, reading, entryMethod) {
  const method = String(entryMethod || tank && tank.soundingMethod || 'sounding').toLowerCase();
  const ullageEntry = method === 'ullage';
  if (hasDualDepthAxes(tank) && Array.isArray(tank.trimAxis) && tank.trimAxis.length >= 2) {
    const src = ullageEntry ? tank.ullageAxis : tank.soundingAxis;
    return linearInterp(src, tank.trimAxis, reading);
  }
  const pipe = effectivePipeHeight(tank);
  if (tablesUseSounding(tank)) {
    return ullageEntry && pipe > 0 ? pipe - reading : reading;
  }
  return !ullageEntry && pipe > 0 ? pipe - reading : reading;
}

/** Inverse of toTableReading — table-scale value back to the entry method. */
function fromTableReading(tank, tableReading, entryMethod) {
  const method = String(entryMethod || tank && tank.soundingMethod || 'sounding').toLowerCase();
  const ullageEntry = method === 'ullage';
  if (hasDualDepthAxes(tank) && Array.isArray(tank.trimAxis) && tank.trimAxis.length >= 2) {
    const dst = ullageEntry ? tank.ullageAxis : tank.soundingAxis;
    return linearInterp(tank.trimAxis, dst, tableReading);
  }
  const pipe = effectivePipeHeight(tank);
  if (tablesUseSounding(tank)) {
    return ullageEntry && pipe > 0 ? pipe - tableReading : tableReading;
  }
  return !ullageEntry && pipe > 0 ? pipe - tableReading : tableReading;
}

/** Smallest, largest and sign spread of every figure in a grid. */
function gridStats(grid) {
  let min = Infinity;
  let max = -Infinity;
  let neg = 0;
  let n = 0;
  let frac = 0;
  let zeroCount = 0;
  for (const row of grid || []) {
    for (const v of row || []) {
      const x = Number(v);
      if (!Number.isFinite(x)) continue;
      n += 1;
      if (x < min) min = x;
      if (x > max) max = x;
      if (x < 0) neg += 1;
      if (x === 0) {
        zeroCount += 1;
        continue;
      }
      // Volume corrections are printed to ~3 decimal places (m3). Sounding
      // corrections (mm) are whole numbers. Float noise under 1e-6 ignored.
      // Zeros are skipped for the unit vote — empty heel cells are common.
      if (Math.abs(x - Math.round(x)) > 1e-6) frac += 1;
    }
  }
  if (!n) return null;
  return {
    min: min,
    max: max,
    neg: neg,
    n: n,
    frac: frac,
    zeros: zeroCount,
    nonzero: n - zeroCount,
    span: max - min,
    mag: Math.max(Math.abs(min), Math.abs(max)),
  };
}

/**
 * Heel/list table unit: millimetres (integer sounding correction) vs m³
 * (volume correction with decimal places).
 *
 * Comparing magnitude to tank capacity is the wrong tell — a volume heel
 * table can reach nearly the tank's capacity (e.g. 431 on a 463 m³ tank)
 * and still be cubic metres. Decimals decide: no fractional values → mm;
 * fractional values (typically ≤3 d.p.) → m³.
 */
function heelUnitKind(stats) {
  if (!stats || !stats.nonzero) return 'unknown';
  const fracShare = stats.frac / stats.nonzero;
  if (fracShare <= 0.05) return 'mm';
  if (fracShare >= 0.5) return 'm3';
  return 'unknown';
}

/** How steadily one column climbs or falls down the sounding axis, 0..1. */
function columnMonotonicity(grid, col) {
  let up = 0, down = 0, n = 0;
  for (let i = 1; i < (grid || []).length; i += 1) {
    const a = Number(grid[i - 1][col]), b = Number(grid[i][col]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    n += 1;
    if (b > a) up += 1; else down += 1;
  }
  return n ? Math.max(up, down) / n : 0;
}

/**
 * Does this grid hold the tank's capacity, or a correction to the sounding?
 *
 * A capacity table never goes negative, reaches the tank's own size, runs all
 * the way from empty to full, and climbs steadily as the tank fills. A
 * correction table does none of those: it stays small, changes sign across the
 * columns, and wanders.
 */
function looksLikeCapacityTable(grid, vals, capacity) {
  const s = gridStats(grid);
  if (!s || (grid || []).length < 4) return false;
  if (s.neg > s.n * 0.02) return false;
  const cap = Number(capacity) > 0 ? Number(capacity) : s.max;
  if (!(cap > 0) || s.max < cap * 0.5 || s.span < cap * 0.5) return false;
  const mid = Math.max(0, Math.floor(((vals || []).length || 1) / 2));
  return columnMonotonicity(grid, mid) >= 0.9;
}

/**
 * Which of the three arrangements a tank's calibration tables are in.
 *
 * Every book lays this out differently, so the tables are asked what they
 * hold rather than the file being trusted to say:
 *
 *   trim grid is a capacity table, heel grid is a correction in millimetres
 *     -> 'correction': heel the sounding, then read the capacity grid
 *
 *   trim and heel are both corrections and a capacity curve is stored
 *     -> 'trimHeel': both corrections at the sounding as read, then the curve
 *
 *   trim grid is a capacity table and the heel grid is in cubic metres
 *     -> 'direct': trim volume minus heel volume
 *
 * Millimetres vs cubic metres is told by decimals on the heel figures —
 * not by comparing heel magnitude to tank capacity (a volume heel table
 * often reaches nearly the tank's own size).
 */
function detectCalcType(tank) {
  const t = tank || {};
  const cap = Number(t.capacity) || 0;
  const hasCurve = !!(t.volumeCurve && Array.isArray(t.volumeCurve.x) && t.volumeCurve.x.length);
  const heel = gridStats(t.listGrid);
  const unsure = (reason) => ({ calcType: t.calcType || null, confident: false, reason, hasCurve });

  if (!t.trimGrid || !t.trimGrid.length) return unsure('no trim table to read');
  const trimIsCapacity = looksLikeCapacityTable(t.trimGrid, t.trimVals, cap);

  if (trimIsCapacity) {
    if (!heel) {
      return { calcType: 'correction', confident: true, hasCurve,
        reason: 'the trim table holds capacities and there is no heel table' };
    }
    const kind = heelUnitKind(heel);
    if (kind === 'mm') {
      return { calcType: 'correction', confident: true, hasCurve,
        reason: 'the trim table holds capacities, and the heel table is whole '
          + 'numbers (millimetres) — a sounding correction, not a volume' };
    }
    if (kind === 'm3') {
      return { calcType: 'direct', confident: true, hasCurve,
        reason: 'the trim table holds capacities, and the heel table has '
          + 'decimal figures (cubic metres) — a volume correction' };
    }
    return unsure('the trim table holds capacities, but the heel figures mix '
      + 'whole numbers and decimals — say which unit in the tank');
  }

  if (hasCurve) {
    return { calcType: 'trimHeel', confident: true, hasCurve,
      reason: 'trim and heel are both corrections and the capacity comes from its own curve' };
  }
  return unsure('neither the trim table nor a capacity curve gives a volume');
}

/**
 * Which way a tank's trim columns run.
 *
 * Books print it both ways. FLAG EVI heads its positive columns TRIM BY STEM,
 * so a positive column is down by the bow; the Giorgis books head theirs by
 * the stern. FLAG EVI imports keep printed +/− and tag trimAxisSense=bow
 * (stem-positive books). Calibration can flip headers or change sense later.
 * The app talks one language to the engineer -- positive is down by the bow --
 * and turns it into the tank's own column sign here, once, per tank.
 *
 * Tanks stored before this carry no sense at all, and every one of them was
 * saved with the columns running by the stern, so that is the default. An
 * importer that knows better says so with `trimAxisSense`.
 */
function trimAxisSign(tank) {
  const sense = String((tank && tank.trimAxisSense) || '').toLowerCase();
  if (sense === 'bow' || sense === 'stem' || sense === 'head' || sense === 'fore') return 1;
  return -1;
}

/**
 * Full double-interpolation calculation for one tank + one reading.
 *
 * Three calibration approaches (tank.calcType):
 *
 *   'correction' — direct sounding correction
 *     Heel/list table is a length correction (mm / cm / m). Apply it to the
 *     sounding first (sign already in the table, converted into sounding-table
 *     units), then either:
 *       • length trim correction + volume curve, or
 *       • trim × volume grid at the heel-corrected sounding (m³ final).
 *
 *   'trimHeel' — trim-heel correction
 *     Interpolate trim AND heel length corrections both at the original table
 *     sounding, convert each into sounding-table units, then
 *       corrected = original ± trim ± heel
 *     (sign already in the interpolated values). Look up the capacity / volume
 *     table at that corrected sounding.
 *     Sounding input is always centimetres; sounding / correction tables may
 *     independently be mm, cm, or m — e.g.
 *       1.207 m = 120 cm + 9 mm − 2 mm
 *              = 1.2 m + 0.009 m − 0.002 m
 *
 *   'direct' — direct volume correction
 *     Heel/list table is a volume correction (m³). Interpolate heel volume and
 *     trim volume independently at the table sounding, then
 *       observed m³ = trimVolume − heelVolume.
 *
 * tank: extracted tank definition (see tanks-data.js)
 * inputs: { reading, trim, list, tempC, density15, gaugeType, entryMethod, readingUnit }
 *   reading: raw sounding/ullage/dip/depth/gauge value. When readingUnit is
 *     'cm' (UI default), converted to the table's detected mm/m/cm units first.
 *     Otherwise treated as already in table-native units (stored readings).
 *   trim: DIRECT table trim in metres (by the stern). Must not be scaled or
 *     multiplied — only used as the column key against trimVals (Excel
 *     Data!AG9 / trimDraft = 1×trim by stern).
 *   entryMethod: how `reading` was taken ('ullage'|'dip'|'sounding'). Defaults
 *     to tank.soundingMethod. Converted to table scale before trim/heel.
 *   gaugeType: 'meter' (default) reads `reading` through the calibration table/grid.
 *     'volume' treats `reading` as an already-known volume in m3 (some small
 *     settling/service tanks are logged as a direct volume-gauge reading rather
 *     than a meter/ullage figure) and skips interpolation entirely.
 */
/** Gauge read directly in m³ (no sounding pipe / calibration table). */
const CALC_TYPE_GAUGE_DIRECT = 'gaugeDirect';
const SOUNDING_GAUGE_DIRECT_M3 = 'gaugeDirectM3';
/** Chief enters trim + heel tables manually in a popup (double interpolation). */
const CALC_TYPE_DOUBLE_INTERP_MANUAL = 'doubleInterpManual';
const SOUNDING_DOUBLE_INTERP_MANUAL = 'doubleInterpManual';

function isGaugeDirectM3Tank(tank) {
  const ct = String(tank && tank.calcType || '');
  const sm = String(tank && tank.soundingMethod || '');
  return ct === CALC_TYPE_GAUGE_DIRECT || sm === SOUNDING_GAUGE_DIRECT_M3;
}

function isDoubleInterpManualTank(tank) {
  const ct = String(tank && tank.calcType || '');
  const sm = String(tank && tank.soundingMethod || '');
  return ct === CALC_TYPE_DOUBLE_INTERP_MANUAL || sm === SOUNDING_DOUBLE_INTERP_MANUAL;
}

function usesDirectM3Input(tank) {
  return isGaugeDirectM3Tank(tank) || isDoubleInterpManualTank(tank);
}

function calcApproachOf(calcType) {
  const t = String(calcType || 'direct');
  if (t === CALC_TYPE_GAUGE_DIRECT) return 'gauge-direct-m3';
  if (t === CALC_TYPE_DOUBLE_INTERP_MANUAL) return 'double-interp-manual';
  if (t === 'correction') return 'sounding-correction';
  if (t === 'trimHeel' || t === 'trim-heel' || t === 'trim_heel') return 'trim-heel-correction';
  return 'volume-correction';
}

function isTrimHeelType(calcType) {
  const t = String(calcType || '');
  return t === 'trimHeel' || t === 'trim-heel' || t === 'trim_heel';
}

/**
 * Bilinear interpolation on a 3×3 (or n×m) grid.
 * yAxis[i] with xAxis[j] → grid[i][j]; target (y, x).
 */
function bilinearGridInterp(yAxis, xAxis, grid, y, x) {
  const ys = (yAxis || []).map(Number);
  const xs = (xAxis || []).map(Number);
  if (ys.length < 2 || xs.length < 2 || !grid || !grid.length) return null;
  const yv = Number(y);
  const xv = Number(x);
  if (!Number.isFinite(yv) || !Number.isFinite(xv)) return null;

  let yi = 0;
  while (yi < ys.length - 2 && yv > ys[yi + 1]) yi += 1;
  yi = Math.max(0, Math.min(yi, ys.length - 2));
  let xi = 0;
  while (xi < xs.length - 2 && xv > xs[xi + 1]) xi += 1;
  xi = Math.max(0, Math.min(xi, xs.length - 2));

  const y0 = ys[yi];
  const y1 = ys[yi + 1];
  const x0 = xs[xi];
  const x1 = xs[xi + 1];
  const ty = y1 === y0 ? 0 : (yv - y0) / (y1 - y0);
  const tx = x1 === x0 ? 0 : (xv - x0) / (x1 - x0);

  const q = (i, j) => {
    const row = grid[i];
    const v = row && row[j];
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  };
  const v00 = q(yi, xi);
  const v10 = q(yi, xi + 1);
  const v01 = q(yi + 1, xi);
  const v11 = q(yi + 1, xi + 1);
  const a = v00 + tx * (v10 - v00);
  const b = v01 + tx * (v11 - v01);
  return Math.round((a + ty * (b - a)) * 1000) / 1000;
}

/**
 * Workbook-style manual double interpolation: trim volume table + heeling correction (m³).
 */
function manualDoubleInterpolation(opts) {
  const o = opts || {};
  const trimVol = bilinearGridInterp(o.soundingAxis, o.trimAxis, o.trimGrid, o.sounding, o.trim);
  const heelCorr = bilinearGridInterp(o.soundingAxis, o.heelAxis, o.heelGrid, o.sounding, o.heel);
  if (trimVol == null && heelCorr == null) return null;
  return Math.round(((trimVol || 0) + (heelCorr || 0)) * 1000) / 1000;
}

function computeTank(tank, inputs) {
  const {
    reading: readingIn,
    trim = 0,
    list = 0,
    tempC = 15,
    density15 = null,
    gaugeType = 'meter',
    entryMethod,
    readingUnit,
  } = inputs;
  const divisor = tank.correctionDivisor || 1;
  // Trim is the direct table column key — never scale/multiply it for lookup.
  // `trim` arrives the way the ship is read: positive down by the bow. Turn it
  // into this tank's column sign — never scale or multiply it beyond that.
  const tableTrim = (Number(trim) || 0) * trimAxisSign(tank);

  const { soundingInc, heelInc, soundingUnit, correctionUnit } = resolveIncrements(tank);
  const heel = insertUprightColumn(tank.listVals, tank.listGrid);
  const method = entryMethod || tank.soundingMethod || 'sounding';
  const approach = calcApproachOf(tank.calcType);
  const directM3 = usesDirectM3Input(tank) || gaugeType === 'volume';
  const effectiveGauge = directM3 ? 'volume' : gaugeType;

  // UI enters centimetres; stored / API readings are already table-native.
  let reading = readingIn;
  if (effectiveGauge !== 'volume' && String(readingUnit || '').toLowerCase() === 'cm') {
    reading = cmToTableUnits(readingIn, soundingUnit);
  }

  let trimCorr = 0, listCorr = 0, corrected = reading;
  let trimVolume = null, heelVolume = null;
  let trimCorrApplied = null, heelCorrApplied = null;

  if (effectiveGauge === 'volume') {
    // Volume gauge / direct m³: the reading IS the observed volume — no calibration table.
    var volumeObserved = Number(reading) || 0;
    var correctedReadingOut = volumeObserved;
    var soundingBottomOut = volumeObserved;
  } else if (tank.calcType === 'correction') {
    // Direct sounding correction (length heel → corrected sounding → volume):
    // Length corrections are converted into sounding-table units before adding.
    const tableReading = toTableReading(tank, reading, method);
    corrected = tableReading;

    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, heel.vals, heel.grid, corrected, list, heelInc
      );
      heelCorrApplied = lengthToUnit(listCorr / divisor, correctionUnit, soundingUnit);
      corrected = applyLengthCorrection(corrected, listCorr, divisor, correctionUnit, soundingUnit);
    }

    if (tank.volumeCurve && Array.isArray(tank.volumeCurve.x) && tank.volumeCurve.x.length) {
      trimCorr = bilinearInterpInc(
        tank.trimAxis, tank.trimVals, tank.trimGrid, corrected, tableTrim, soundingInc
      );
      trimCorrApplied = lengthToUnit(trimCorr / divisor, correctionUnit, soundingUnit);
      corrected = applyLengthCorrection(corrected, trimCorr, divisor, correctionUnit, soundingUnit);
      var volumeObserved = linearInterp(tank.volumeCurve.x, tank.volumeCurve.v, corrected);
    } else {
      volumeObserved = bilinearInterpInc(
        tank.trimAxis, tank.trimVals, tank.trimGrid, corrected, tableTrim, soundingInc
      );
      trimVolume = volumeObserved;
    }
    var correctedReadingOut = fromTableReading(tank, corrected, method);
    var soundingBottomOut = tablesUseSounding(tank)
      ? corrected
      : ((Number(tank.pipeHeight) || 0) > 0 ? (Number(tank.pipeHeight) - corrected) : corrected);
  } else if (isTrimHeelType(tank.calcType)) {
    // Trim-heel correction — both length corrections at the ORIGINAL sounding,
    // converted into sounding-table units, then capacity/volume lookup:
    //   corrected = original ± trim ± heel
    const tableReading = toTableReading(tank, reading, method);

    trimCorr = bilinearInterpInc(
      tank.trimAxis, tank.trimVals, tank.trimGrid, tableReading, tableTrim, soundingInc
    );
    trimCorrApplied = lengthToUnit(trimCorr / divisor, correctionUnit, soundingUnit);

    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, heel.vals, heel.grid, tableReading, list, heelInc
      );
      heelCorrApplied = lengthToUnit(listCorr / divisor, correctionUnit, soundingUnit);
    } else {
      heelCorrApplied = 0;
    }

    corrected = tableReading
      + (trimCorrApplied || 0)
      + (heelCorrApplied || 0);

    if (tank.volumeCurve && Array.isArray(tank.volumeCurve.x) && tank.volumeCurve.x.length) {
      volumeObserved = linearInterp(tank.volumeCurve.x, tank.volumeCurve.v, corrected);
    } else if (tank.trimGrid && tank.trimAxis) {
      // No dedicated capacity curve — treat trim grid as volume at corrected sounding.
      volumeObserved = bilinearInterpInc(
        tank.trimAxis, tank.trimVals, tank.trimGrid, corrected, tableTrim, soundingInc
      );
      trimVolume = volumeObserved;
    } else {
      volumeObserved = 0;
    }
    correctedReadingOut = fromTableReading(tank, corrected, method);
    soundingBottomOut = tablesUseSounding(tank)
      ? corrected
      : ((Number(tank.pipeHeight) || 0) > 0 ? (Number(tank.pipeHeight) - corrected) : corrected);
  } else {
    // Direct volume correction: heel m³ and trim m³ at the same table sounding,
    // final observed volume = trimVolume − heelVolume.
    const tableReading = toTableReading(tank, reading, method);
    corrected = tableReading;

    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, heel.vals, heel.grid, tableReading, list, heelInc
      );
      heelVolume = listCorr / divisor;
    } else {
      heelVolume = 0;
    }

    trimVolume = bilinearInterpInc(
      tank.trimAxis, tank.trimVals, tank.trimGrid, tableReading, tableTrim, soundingInc
    );
    trimCorr = trimVolume;
    volumeObserved = trimVolume - heelVolume;
    correctedReadingOut = fromTableReading(tank, tableReading, method);
    soundingBottomOut = tablesUseSounding(tank)
      ? tableReading
      : ((Number(tank.pipeHeight) || 0) > 0 ? (Number(tank.pipeHeight) - tableReading) : tableReading);
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
    gaugeType: effectiveGauge,
    calcApproach: approach,
    soundingUnit,
    correctionUnit,
    soundingIncrement: soundingInc,
    heelIncrement: heelInc,
    trimCorrection: trimCorr,
    listCorrection: listCorr,
    trimCorrectionApplied: trimCorrApplied,
    heelCorrectionApplied: heelCorrApplied,
    trimVolume,
    heelVolume,
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

/**
 * Linear interpolate in a sorted [[x,y], ...] table (workbook Conversion sheet).
 * Returns null if empty; clamps outside range to nearest endpoint.
 */
function lerpLookup(pairs, x) {
  const table = (pairs || []).filter((r) => Array.isArray(r) && r.length >= 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1])));
  if (!table.length || !Number.isFinite(Number(x))) return null;
  const v = Number(x);
  const sorted = table.slice().sort((a, b) => Number(a[0]) - Number(b[0]));
  if (v <= Number(sorted[0][0])) return Number(sorted[0][1]);
  if (v >= Number(sorted[sorted.length - 1][0])) return Number(sorted[sorted.length - 1][1]);
  for (let i = 1; i < sorted.length; i++) {
    const x0 = Number(sorted[i - 1][0]);
    const x1 = Number(sorted[i][0]);
    if (v >= x0 && v <= x1) {
      if (x1 === x0) return Number(sorted[i][1]);
      const y0 = Number(sorted[i - 1][1]);
      const y1 = Number(sorted[i][1]);
      const t = (v - x0) / (x1 - x0);
      return Math.round((y0 + t * (y1 - y0)) * 1e6) / 1e6;
    }
  }
  return Number(sorted[sorted.length - 1][1]);
}

/** Inverse lookup: find x for a given y in [[x,y], ...] (monotone tables). */
function lerpLookupInverse(pairs, y) {
  const table = (pairs || []).filter((r) => Array.isArray(r) && r.length >= 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1])));
  if (!table.length || !Number.isFinite(Number(y))) return null;
  const flipped = table.map((r) => [Number(r[1]), Number(r[0])]);
  // If y column is not strictly sorted, sort by y
  flipped.sort((a, b) => a[0] - b[0]);
  return lerpLookup(flipped, y);
}

/** Specific gravity / relative density → density @15°C (kg/L) via Conversion sheet. */
function sgToDensity15(sg, rdToDensity15) {
  return lerpLookup(rdToDensity15, sg);
}

/** Density @15°C (kg/L) → specific gravity / relative density via Conversion sheet. */
function density15ToSg(density15, rdToDensity15) {
  return lerpLookupInverse(rdToDensity15, density15);
}

/** API gravity → density @15°C (kg/L). */
function apiToDensity15(api, apiTable) {
  return lerpLookup(apiTable, api);
}

