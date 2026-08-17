/**
 * Fuel Oil Report ("TANK CONDITION") core — the workbook Data-entry sheet and
 * its printed Report sheet, reproduced for the app.
 *
 * Shared by both sides: loaded as a plain <script> in the SPA (picking up the
 * calc globals from /js/calc.js) and require()d from server/index.js, so a
 * report computes identically online, offline and on the server.
 *
 * Sheet mapping (TANK MANAGEMENT … .xlsm):
 *   Data!H   raw sounding/ullage input (mm)      -> row.reading
 *   Data!V   1 = Dip, 2 = Ullage                 -> row.method
 *   Data!AD  1 HFO / 2 LSFO / 3 MDO-MGO / 4 LSMGO -> row.fuelType
 *   Data!U   "tank in use" tick                  -> row.inUse
 *   Data!T   petroleum unit standard             -> row.unit
 *   Data!L   petroleum unit value                -> row.unitValue
 *   Data!D   volume 100% m3   Report!C  = D * 0.96  (capacity in MT)
 *   Data!I   observed volume  Data!O = I / D        (volume %)
 *   Data!M   density @15      Data!N = VCF 54B
 *   Data!P   GSV = I * VCF    Data!Q = WCF 56   Data!R = P * Q (weight in air)
 *   Data!O30:R30  grade totals     Data!O31:R31 log book     Data!O32:R32 difference
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../server/calc'));
  } else {
    // Browser: /js/calc.js has already defined its helpers as globals.
    root.FuelReportCore = factory(root);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (calc) {
'use strict';

const { computeTank, vcfDetail54B, wcf56, lerpLookup } = calc;

/** Report types — workbook Data!Y3:Y9 / Data!U28. */
const REPORT_TYPES = [
  'Arrival',
  'Departure',
  'Monitoring',
  'Pre-Bunkering',
  'Bunker Survey',
  'Bunker Survey - Charterer',
  'Bunker Survey - Owner',
];

/** Grade buckets the weights are totalled into — workbook Data!AD7:AD10. */
const FUEL_TYPES = [
  { id: 'hfo', label: 'HFO', section: 'fuel' },
  { id: 'lsfo', label: 'LSFO', section: 'fuel' },
  { id: 'mdo', label: 'MDO/MGO', section: 'do' },
  { id: 'lsmgo', label: 'LSMGO', section: 'do' },
];

/** Petroleum unit standards — workbook Data!T7:T10. */
const UNIT_STANDARDS = [
  { id: 'den15', label: 'DEN @ 15 C' },
  { id: 'api60', label: 'API @ 60 F' },
  { id: 'rd60', label: 'RD @ 60 F' },
  { id: 'sg15', label: 'SG @ 15 C' },
];

const METHODS = [
  { id: 'ullage', label: 'ULLAGE' },
  { id: 'dip', label: 'DIP' },
];

/** Heel selector — workbook Data!W3:W11 (port negative, starboard positive). */
const HEEL_OPTIONS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

const SECTIONS = [
  { id: 'fuel', title: 'FUEL OIL', grades: ['hfo', 'lsfo'] },
  { id: 'do', title: 'DIESEL OIL / GAS OIL', grades: ['mdo', 'lsmgo'] },
];

/** Workbook Report!C11 = 100% m3 * 0.96 (tonnage capacity of a full tank). */
const CAPACITY_MT_FACTOR = 0.96;
/** Workbook Report!E22 — safe filling limit applied to the tonnage capacity. */
const SAFE_FILL_RATIO = 0.85;
/** Workbook Report!D35 = litres * 0.882 (lube oil density). */
const LUBE_DENSITY = 0.882;

const LUBE_FIELDS = [
  { id: 'cylHigh', label: 'CYL. OIL HIGH TBN' },
  { id: 'cylLow', label: 'CYL. OIL LOW TBN' },
  { id: 'meSystem', label: 'M/E SYSTEM OIL' },
  { id: 'dgSystem', label: 'D/G SYSTEM OIL' },
];

const RECEIVED_FIELDS = [
  { id: 'hfo', label: 'HFO' },
  { id: 'lsHfo', label: 'LS HFO' },
  { id: 'mdoMgo', label: 'MDO / MGO' },
  { id: 'water', label: 'FRESH WATER' },
];

const CONSUMPTION_FIELDS = [
  { id: 'atSea', label: 'At sea' },
  { id: 'atAnchor', label: 'At anchorage' },
  { id: 'atPort', label: 'In port' },
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

/** 'sounding' / 'dip' / 'depth' all mean "measured from the tank bottom". */
function normalizeMethod(method) {
  return /dip|sound|depth/i.test(String(method || '')) ? 'dip' : 'ullage';
}

/**
 * Sounding-pipe height used to flip a reading between ullage and dip.
 * Workbook Setup!C — here taken from the tank, falling back to the top of the
 * calibration axis (the giorgis tables run 0 … pipe height in mm).
 */
function soundingPipeHeight(tank) {
  const explicit = num(tank && tank.pipeHeight, 0);
  if (explicit > 0) return explicit;
  const axes = [tank && tank.trimAxis, tank && tank.listAxis, tank && tank.volumeCurve && tank.volumeCurve.x];
  let max = 0;
  for (const axis of axes) {
    if (!Array.isArray(axis) || !axis.length) continue;
    for (const v of axis) {
      const n = Number(v);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/** Default grade bucket for a tank, from its calibration-DB fuel grade. */
function defaultFuelType(tank) {
  const grade = String((tank && tank.fuelGrade) || '').toLowerCase();
  if (grade === 'lsfo') return 'lsfo';
  if (grade === 'mgo' || grade === 'mdo' || grade === 'lsmgo') return grade === 'lsmgo' ? 'lsmgo' : 'mdo';
  return 'hfo';
}

/** Which printed block a tank belongs to by its calibration-DB grade. */
function sectionForTank(tank) {
  const grade = String((tank && tank.fuelGrade) || '').toLowerCase();
  return grade === 'mdo' || grade === 'mgo' || grade === 'lsmgo' ? 'do' : 'fuel';
}

/** The block a fuel type belongs in — MDO/MGO and LSMGO are diesel/gas oil. */
function sectionForFuelType(fuelType) {
  const entry = FUEL_TYPES.find((f) => f.id === fuelType);
  return entry ? entry.section : 'fuel';
}

/**
 * Which block a row is actually printed in.
 *
 * It follows the fuel type the tank is carrying, so an HFO tank run on LSMGO
 * counts under DIESEL OIL / GAS OIL and each block totals only what is really
 * in it. For a tank left on its own grade this is the same answer as the
 * calibration DB gives, so nothing moves unless the fuel type says so.
 *
 * `row.section` pins a row to one block when the automatic answer is not
 * wanted; '' (the default) means follow the fuel type.
 */
function sectionForRow(tank, rowForm) {
  const pinned = rowForm && rowForm.section;
  if (pinned === 'fuel' || pinned === 'do') return pinned;
  const fuelType = (rowForm && rowForm.fuelType) || defaultFuelType(tank);
  return sectionForFuelType(fuelType);
}

function fuelTanks(bundle) {
  return ((bundle && bundle.tanks && bundle.tanks.fuel) || []).filter(Boolean);
}

/**
 * Density @15°C from the selected petroleum unit standard.
 * Workbook Data!M: DEN @15 is used as entered, API/RD go through the
 * Conversion sheet lookup tables.
 */
function densityFromUnit(unit, unitValue, conversion) {
  const value = num(unitValue);
  if (value == null) return { density15: null, source: 'no unit value entered' };
  if (value <= 0) return { density15: null, source: 'unit value must be greater than zero' };
  const tables = conversion || {};
  if (unit === 'api60') {
    const d = lerpLookup(tables.apiToDensity15 || [], value);
    return d == null
      ? { density15: null, source: 'API outside Conversion sheet range' }
      : { density15: d, source: `API ${value} -> Conversion sheet` };
  }
  if (unit === 'rd60' || unit === 'sg15') {
    const d = lerpLookup(tables.rdToDensity15 || [], value);
    return d == null
      ? { density15: null, source: 'RD/SG outside Conversion sheet range' }
      : { density15: d, source: `RD/SG ${value} -> Conversion sheet` };
  }
  return { density15: value, source: 'entered as density @15°C' };
}

/** A blank row seeded from the tank definition and its last saved reading. */
function defaultRow(tank, reading) {
  const r = reading || {};
  return {
    fuelType: defaultFuelType(tank),
    reading: r.reading != null ? r.reading : '',
    method: normalizeMethod(tank.soundingMethod),
    tempC: r.tempC != null ? r.tempC : '',
    unit: 'den15',
    unitValue: r.density15 != null ? r.density15 : '',
    inUse: false,
    // '' = follow the fuel type; 'fuel' / 'do' = pinned to a block by the user.
    section: '',
  };
}

function emptyFuelReport(bundle) {
  const voyage = (bundle && bundle.voyage) || {};
  const rows = {};
  for (const tank of fuelTanks(bundle)) {
    rows[tank.id] = defaultRow(tank, (bundle.readings || {})[tank.id]);
  }
  const date = voyage.date || new Date().toISOString().slice(0, 10);
  const time = voyage.time || '12:00';
  return {
    header: {
      voyageNo: voyage.voyageNo || '',
      date,
      time,
      reportType: REPORT_TYPES.includes(voyage.reportType) ? voyage.reportType : 'Monitoring',
      port: voyage.port || '',
      draftFwd: voyage.draftFwd != null ? voyage.draftFwd : '',
      draftAft: voyage.draftAft != null ? voyage.draftAft : '',
      heel: voyage.heel != null ? voyage.heel : 0,
      engineRoomTemp: voyage.engineRoomTemp != null ? voyage.engineRoomTemp : '',
      seaTemp: voyage.seaTemp != null ? voyage.seaTemp : '',
    },
    rows,
    logbook: { hfo: '', lsfo: '', mdo: '', lsmgo: '' },
    lube: { cylHigh: '', cylLow: '', meSystem: '', dgSystem: '' },
    received: { hfo: '', lsHfo: '', mdoMgo: '', water: '' },
    consumption: {
      atSea: '', atAnchor: '', atPort: '',
      boilerSea: '', boilerAnchor: '', boilerPort: '',
    },
    signature: { preparedBy: '', rank: 'Chief Engineer' },
    options: { capacityMtFactor: CAPACITY_MT_FACTOR, lubeDensity: LUBE_DENSITY },
    updatedAt: null,
  };
}

/** Merge a stored form over the defaults so new tanks always get a row. */
function normalizeForm(bundle, form) {
  const base = emptyFuelReport(bundle);
  const src = form || {};
  const rows = {};
  for (const tank of fuelTanks(bundle)) {
    rows[tank.id] = { ...base.rows[tank.id], ...((src.rows || {})[tank.id] || {}) };
  }
  return {
    header: { ...base.header, ...(src.header || {}) },
    rows,
    logbook: { ...base.logbook, ...(src.logbook || {}) },
    lube: { ...base.lube, ...(src.lube || {}) },
    received: { ...base.received, ...(src.received || {}) },
    consumption: { ...base.consumption, ...(src.consumption || {}) },
    signature: { ...base.signature, ...(src.signature || {}) },
    options: { ...base.options, ...(src.options || {}) },
    updatedAt: src.updatedAt || null,
  };
}

function trimLabel(trimByStern) {
  const t = num(trimByStern, 0) || 0;
  if (Math.abs(t) < 0.005) return 'even keel';
  return `${Math.abs(t).toFixed(2)} m by ${t > 0 ? 'stern' : 'fore'}`;
}

/** Ullage and dip in mm from the entered sounding and the sounding-pipe height. */
function soundingPair(method, reading, pipeHeight) {
  if (reading == null) return { ullageMm: null, dipMm: null };
  const pipe = num(pipeHeight, 0) || 0;
  const other = pipe > 0 ? round(pipe - reading, 1) : null;
  if (method === 'dip') return { dipMm: round(reading, 1), ullageMm: other };
  return { ullageMm: round(reading, 1), dipMm: other };
}

function heelLabel(heel) {
  const h = num(heel, 0) || 0;
  if (!h) return 'upright';
  return `${Math.abs(h)}° to ${h > 0 ? 'starboard' : 'port'}`;
}

/**
 * Compute one report row: reading -> volume -> VCF/WCF -> weight in air,
 * keeping every intermediate for the printed calculation annex.
 */
function computeRow(tank, rowForm, ctx) {
  const row = rowForm || {};
  const section = sectionForRow(tank, row);
  const fuelType = FUEL_TYPES.some((f) => f.id === row.fuelType) ? row.fuelType : defaultFuelType(tank);
  const method = normalizeMethod(row.method);
  const unit = UNIT_STANDARDS.some((u) => u.id === row.unit) ? row.unit : 'den15';
  const reading = num(row.reading);
  const tempC = num(row.tempC, 15);
  const capacity = num(tank.capacity, 0) || 0;
  const { density15, source: densitySource } = densityFromUnit(unit, row.unitValue, ctx.conversion);

  const nativeMethod = normalizeMethod(tank.soundingMethod);
  const pipeHeight = soundingPipeHeight(tank);
  // The calibration grid is indexed in the tank's own method. A reading taken
  // the other way round is flipped through the sounding-pipe height first
  // (workbook Setup!E/F).
  const flipped = reading != null && method !== nativeMethod && pipeHeight > 0;
  const nativeReading = flipped ? pipeHeight - reading : reading;

  const pair = soundingPair(method, reading, pipeHeight);
  const out = {
    tankId: tank.id,
    name: tank.name || tank.id,
    side: tank.side || '',
    fuelRole: tank.fuelRole || '',
    calcType: tank.calcType || 'direct',
    tankGrade: tank.fuelGrade || '',
    section,
    homeSection: sectionForTank(tank),
    moved: section !== sectionForTank(tank),
    fuelType,
    fuelTypeLabel: (FUEL_TYPES.find((f) => f.id === fuelType) || {}).label || fuelType,
    // Pinned rows are the ones the user held in place against the fuel type.
    pinned: Boolean(row.section === 'fuel' || row.section === 'do'),
    autoSection: sectionForFuelType(fuelType),
    // True when a pin is holding the row away from where its fuel type puts it.
    sectionMismatch: sectionForFuelType(fuelType) !== section,
    reading: reading != null ? reading : '',
    method,
    methodLabel: method === 'dip' ? 'DIP' : 'ULLAGE',
    ullageMm: pair.ullageMm,
    dipMm: pair.dipMm,
    tempC: row.tempC === '' || row.tempC == null ? '' : tempC,
    unit,
    unitLabel: (UNIT_STANDARDS.find((u) => u.id === unit) || {}).label || unit,
    unitValue: row.unitValue === '' || row.unitValue == null ? '' : num(row.unitValue),
    inUse: Boolean(row.inUse),
    capacity100M3: round(capacity, 3),
    capacity100MT: round(capacity * ctx.capacityMtFactor, 3),
    capacity85M3: round(capacity * SAFE_FILL_RATIO, 3),
    measuredM3: null,
    volumePercent: null,
    density15: density15 != null ? round(density15, 4) : null,
    densitySource,
    vcf: null,
    gsv15M3: null,
    wcf: null,
    weightAirMT: null,
    warnings: [],
    trace: {
      nativeMethod,
      pipeHeight: pipeHeight || null,
      flipped,
      nativeReading: nativeReading != null ? round(nativeReading, 3) : null,
      trimUsed: ctx.trimByStern,
      heelUsed: ctx.heel,
    },
  };

  if (reading == null) {
    out.warnings.push('no sounding entered');
    return out;
  }
  if (flipped && pipeHeight <= 0) out.warnings.push('no sounding-pipe height to convert dip/ullage');

  const result = computeTank(tank, {
    reading: nativeReading,
    trim: ctx.trimByStern,
    list: ctx.heel,
    tempC,
    density15,
    gaugeType: 'meter',
  });

  out.measuredM3 = round(result.volumeObserved, 3);
  out.volumePercent = capacity > 0 ? round((result.volumeObserved / capacity) * 100, 1) : null;
  out.trace.soundingIncrement = result.soundingIncrement;
  out.trace.heelIncrement = result.heelIncrement;
  out.trace.trimCorrection = round(result.trimCorrection, 4);
  out.trace.listCorrection = round(result.listCorrection, 4);
  out.trace.correctedReading = round(result.correctedReading, 3);
  out.trace.soundingFromBottom = round(result.soundingFromBottom, 3);

  if (density15 == null) {
    out.warnings.push('no density — weight not computed');
    return out;
  }

  const vcfDetail = vcfDetail54B(density15, tempC);
  out.vcf = vcfDetail.vcf;
  out.gsv15M3 = round(result.correctedVolume15, 3);
  out.wcf = round(wcf56(density15), 4);
  out.weightAirMT = round(result.weightMT, 3);
  out.trace.vcf = vcfDetail;
  out.trace.wcfFormula = 'density@15 − 0.0011 (air buoyancy, ASTM Table 56)';
  if (capacity > 0 && result.volumeObserved > capacity) out.warnings.push('above 100% capacity');
  return out;
}

function sumRows(rows, key) {
  return rows.reduce((acc, r) => acc + (num(r[key], 0) || 0), 0);
}

/**
 * Build the whole report: header, both tank blocks, grade totals against the
 * log book, lube oil, received quantities and daily consumption.
 */
function computeFuelReport(bundle, form, conversion) {
  const normalized = normalizeForm(bundle, form);
  const header = normalized.header;
  const capacityMtFactor = num(normalized.options.capacityMtFactor, CAPACITY_MT_FACTOR) || CAPACITY_MT_FACTOR;
  const lubeDensity = num(normalized.options.lubeDensity, LUBE_DENSITY) || LUBE_DENSITY;

  const draftFwd = num(header.draftFwd, 0) || 0;
  const draftAft = num(header.draftAft, 0) || 0;
  const meanDraft = (draftFwd + draftAft) / 2;
  // Displayed trim keeps the workbook's fwd − aft sign (Data!J7); the
  // calibration tables are indexed by trim *by the stern*, so the lookup uses
  // aft − fwd.
  const trim = draftFwd - draftAft;
  const trimByStern = draftAft - draftFwd;
  const heel = num(header.heel, 0) || 0;

  const ctx = { conversion, capacityMtFactor, trimByStern, heel };

  const sections = SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    grades: section.grades,
    rows: [],
  }));
  const byId = new Map(sections.map((s) => [s.id, s]));

  for (const tank of fuelTanks(bundle)) {
    const out = computeRow(tank, normalized.rows[tank.id], ctx);
    (byId.get(out.section) || sections[0]).rows.push(out);
  }

  for (const section of sections) {
    const capacityMT = sumRows(section.rows, 'capacity100MT');
    const inUse = section.rows.filter((r) => r.inUse && r.density15 != null);
    section.totals = {
      tanks: section.rows.length,
      capacity100M3: round(sumRows(section.rows, 'capacity100M3'), 3),
      capacity100MT: round(capacityMT, 3),
      capacity85MT: round(capacityMT * SAFE_FILL_RATIO, 3),
      measuredM3: round(sumRows(section.rows, 'measuredM3'), 3),
      gsv15M3: round(sumRows(section.rows, 'gsv15M3'), 3),
      weightAirMT: round(sumRows(section.rows, 'weightAirMT'), 3),
      // Workbook Data!X28 / Y28 — mean density of the tanks ticked "in use".
      averageDensityInUse: inUse.length
        ? round(inUse.reduce((a, r) => a + r.density15, 0) / inUse.length, 4)
        : null,
      tanksInUse: section.rows.filter((r) => r.inUse).length,
      movedIn: section.rows.filter((r) => r.moved).length,
      pinned: section.rows.filter((r) => r.pinned).length,
      mismatched: section.rows.filter((r) => r.sectionMismatch).length,
    };
  }

  const allRows = sections.reduce((acc, s) => acc.concat(s.rows), []);
  const grades = FUEL_TYPES.map((grade) => {
    const rows = allRows.filter((r) => r.fuelType === grade.id);
    const used = rows.some((r) => r.weightAirMT != null);
    const actualMT = used ? round(sumRows(rows, 'weightAirMT'), 3) : null;
    const logbookMT = num(normalized.logbook[grade.id]);
    return {
      id: grade.id,
      label: grade.label,
      section: grade.section,
      tanks: rows.length,
      actualMT,
      logbookMT,
      differenceMT: actualMT != null && logbookMT != null ? round(actualMT - logbookMT, 3) : null,
    };
  });

  const lubeRows = LUBE_FIELDS.map((f) => {
    const litres = num(normalized.lube[f.id]);
    return {
      id: f.id,
      label: f.label,
      litres,
      mt: litres != null ? round((litres * lubeDensity) / 1000, 3) : null,
    };
  });

  return {
    vessel: {
      name: (bundle.vessel && bundle.vessel.name) || '',
      imo: (bundle.vessel && bundle.vessel.imo) || '',
      flag: (bundle.vessel && bundle.vessel.flag) || '',
      type: (bundle.vessel && bundle.vessel.type) || '',
    },
    header: {
      ...header,
      draftFwd,
      draftAft,
      meanDraft: round(meanDraft, 3),
      trim: round(trim, 3),
      trimByStern: round(trimByStern, 3),
      trimLabel: trimLabel(trimByStern),
      heel,
      heelLabel: heelLabel(heel),
      condition: String(header.reportType || '').toUpperCase(),
      dateTime: [header.date, header.time].filter(Boolean).join(' '),
    },
    sections,
    grades,
    totals: {
      capacity100M3: round(sumRows(allRows, 'capacity100M3'), 3),
      capacity100MT: round(sumRows(allRows, 'capacity100MT'), 3),
      measuredM3: round(sumRows(allRows, 'measuredM3'), 3),
      gsv15M3: round(sumRows(allRows, 'gsv15M3'), 3),
      weightAirMT: round(sumRows(allRows, 'weightAirMT'), 3),
      tanksSounded: allRows.filter((r) => r.measuredM3 != null).length,
      tanks: allRows.length,
    },
    lube: {
      density: lubeDensity,
      rows: lubeRows,
      totalLitres: round(lubeRows.reduce((a, r) => a + (r.litres || 0), 0), 3),
      totalMT: round(lubeRows.reduce((a, r) => a + (r.mt || 0), 0), 3),
    },
    received: RECEIVED_FIELDS.map((f) => ({ id: f.id, label: f.label, value: num(normalized.received[f.id]) })),
    consumption: CONSUMPTION_FIELDS.map((f) => ({ id: f.id, label: f.label, value: num(normalized.consumption[f.id]) })),
    consumptionBoiler: CONSUMPTION_FIELDS.map((f) => ({
      id: f.id,
      label: f.label,
      value: num(normalized.consumption[{ atSea: 'boilerSea', atAnchor: 'boilerAnchor', atPort: 'boilerPort' }[f.id]]),
    })),
    signature: normalized.signature,
    options: { capacityMtFactor, lubeDensity, safeFillRatio: SAFE_FILL_RATIO },
    form: normalized,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Readings written back from the report rows, so the rest of the app (dashboard,
 * bunkering, voyage calc) sees the same soundings the report was built from.
 */
function readingsFromReport(bundle, computed) {
  const readings = { ...((bundle && bundle.readings) || {}) };
  const savedAt = new Date().toISOString();
  for (const section of computed.sections) {
    for (const row of section.rows) {
      if (row.measuredM3 == null) continue;
      readings[row.tankId] = {
        reading: num(row.trace.nativeReading),
        trim: computed.header.trimByStern,
        list: computed.header.heel,
        tempC: num(row.tempC, 15),
        density15: row.density15,
        gaugeType: 'meter',
        source: 'fuel-report',
        result: {
          soundingIncrement: row.trace.soundingIncrement,
          heelIncrement: row.trace.heelIncrement,
          trimCorrection: row.trace.trimCorrection,
          listCorrection: row.trace.listCorrection,
          correctedReading: row.trace.correctedReading,
          soundingFromBottom: row.trace.soundingFromBottom,
          volumeObserved: row.measuredM3,
          fillPercent: row.volumePercent,
          vcf: row.vcf,
          correctedVolume15: row.gsv15M3,
          wcf: row.wcf,
          weightMT: row.weightAirMT,
        },
        savedAt,
      };
    }
  }
  return readings;
}

/** Compact snapshot appended to the report history on "PRINT & SAVE". */
function snapshotFromReport(computed) {
  return {
    id: `rep_${Date.now().toString(36)}`,
    savedAt: computed.generatedAt,
    reportType: computed.header.reportType,
    voyageNo: computed.header.voyageNo,
    port: computed.header.port,
    date: computed.header.date,
    time: computed.header.time,
    totals: computed.totals,
    grades: computed.grades.map((g) => ({
      id: g.id,
      label: g.label,
      actualMT: g.actualMT,
      logbookMT: g.logbookMT,
      differenceMT: g.differenceMT,
    })),
    form: computed.form,
  };
}

return {
  REPORT_TYPES,
  FUEL_TYPES,
  UNIT_STANDARDS,
  METHODS,
  HEEL_OPTIONS,
  SECTIONS,
  LUBE_FIELDS,
  RECEIVED_FIELDS,
  CONSUMPTION_FIELDS,
  CAPACITY_MT_FACTOR,
  SAFE_FILL_RATIO,
  LUBE_DENSITY,
  normalizeMethod,
  soundingPipeHeight,
  soundingPair,
  defaultFuelType,
  sectionForTank,
  sectionForFuelType,
  sectionForRow,
  densityFromUnit,
  emptyFuelReport,
  normalizeForm,
  computeRow,
  computeFuelReport,
  readingsFromReport,
  snapshotFromReport,
};
}));
