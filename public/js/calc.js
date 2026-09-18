/* Tank calculation engine (browser) */
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
  if (!vc || !Array.isArray(vc.v) || vc.v.length < 2) return true;
  return Number(vc.v[vc.v.length - 1]) >= Number(vc.v[0]);
}

/**
 * Map a user sounding into the calibration table's axis units (Excel Setup!F).
 * entryMethod: 'ullage' | 'dip' | 'sounding' — how `reading` was taken.
 * Trim/heel interpolation must see this table-scale value, never a scaled trim.
 */
function toTableReading(tank, reading, entryMethod) {
  const pipe = Number(tank && tank.pipeHeight) || 0;
  const method = String(entryMethod || tank && tank.soundingMethod || 'sounding').toLowerCase();
  const ullageEntry = method === 'ullage';
  if (tablesUseSounding(tank)) {
    return ullageEntry && pipe > 0 ? pipe - reading : reading;
  }
  return !ullageEntry && pipe > 0 ? pipe - reading : reading;
}

/** Inverse of toTableReading — table-scale value back to the entry method. */
function fromTableReading(tank, tableReading, entryMethod) {
  const pipe = Number(tank && tank.pipeHeight) || 0;
  const method = String(entryMethod || tank && tank.soundingMethod || 'sounding').toLowerCase();
  const ullageEntry = method === 'ullage';
  if (tablesUseSounding(tank)) {
    return ullageEntry && pipe > 0 ? pipe - tableReading : tableReading;
  }
  return !ullageEntry && pipe > 0 ? pipe - tableReading : tableReading;
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
function calcApproachOf(calcType) {
  const t = String(calcType || 'direct');
  if (t === 'correction') return 'sounding-correction';
  if (t === 'trimHeel' || t === 'trim-heel' || t === 'trim_heel') return 'trim-heel-correction';
  return 'volume-correction';
}

function isTrimHeelType(calcType) {
  const t = String(calcType || '');
  return t === 'trimHeel' || t === 'trim-heel' || t === 'trim_heel';
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
  const tableTrim = Number(trim) || 0;

  const { soundingInc, heelInc, soundingUnit, correctionUnit } = resolveIncrements(tank);
  const method = entryMethod || tank.soundingMethod || 'sounding';
  const approach = calcApproachOf(tank.calcType);

  // UI enters centimetres; stored / API readings are already table-native.
  let reading = readingIn;
  if (gaugeType !== 'volume' && String(readingUnit || '').toLowerCase() === 'cm') {
    reading = cmToTableUnits(readingIn, soundingUnit);
  }

  let trimCorr = 0, listCorr = 0, corrected = reading;
  let trimVolume = null, heelVolume = null;
  let trimCorrApplied = null, heelCorrApplied = null;

  if (gaugeType === 'volume') {
    // Volume gauge: the reading IS the observed volume already -- no interpolation.
    var volumeObserved = reading;
    var correctedReadingOut = reading;
    var soundingBottomOut = reading;
  } else if (tank.calcType === 'correction') {
    // Direct sounding correction (length heel → corrected sounding → volume):
    // Length corrections are converted into sounding-table units before adding.
    const tableReading = toTableReading(tank, reading, method);
    corrected = tableReading;

    if (tank.listAxis && tank.listAxis.length) {
      listCorr = bilinearInterpInc(
        tank.listAxis, tank.listVals, tank.listGrid, corrected, list, heelInc
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
        tank.listAxis, tank.listVals, tank.listGrid, tableReading, list, heelInc
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
        tank.listAxis, tank.listVals, tank.listGrid, tableReading, list, heelInc
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
    gaugeType,
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
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

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

function lerpLookupInverse(pairs, y) {
  const table = (pairs || []).filter((r) => Array.isArray(r) && r.length >= 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1])));
  if (!table.length || !Number.isFinite(Number(y))) return null;
  const flipped = table.map((r) => [Number(r[1]), Number(r[0])]);
  flipped.sort((a, b) => a[0] - b[0]);
  return lerpLookup(flipped, y);
}

function sgToDensity15(sg, rdToDensity15) {
  return lerpLookup(rdToDensity15, sg);
}

function density15ToSg(density15, rdToDensity15) {
  return lerpLookupInverse(rdToDensity15, density15);
}

function apiToDensity15Lookup(api, apiTable) {
  return lerpLookup(apiTable, api);
}


