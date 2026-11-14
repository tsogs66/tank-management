/**
 * Extract calibration tables from PDF via scripts/import-pdf-tables.py (pdfplumber).
 * Groups tables by tank; auto-skips L.C.G / T.C.G / V.C.G / IMOM hydrostatic blocks.
 * Supports async jobs with live progress for OCR / multi-page extracts.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnPython } = require('./python-run');
const tableCheck = require('./table-check');
const { detectCalcType } = require('./calc');

const DEFAULT_MAX_SECONDS = Number(process.env.TMS_PDF_MAX_SECONDS) || 4 * 60 * 60;
const JOBS = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function publicJob(job) {
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    pct: job.pct,
    message: job.message,
    page: job.page,
    pages: job.pages,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    elapsedMs: Date.now() - job.startedAtMs,
    error: job.error || null,
    result: job.status === 'done' ? job.result : undefined,
  };
}

function updateJob(id, patch) {
  const job = JOBS.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: nowIso() });
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of JOBS) {
    if (job.startedAtMs < cutoff) JOBS.delete(id);
  }
}

function parseProgressLine(line, onProgress) {
  if (!onProgress || !line.startsWith('PROGRESS\t')) return;
  try {
    const payload = JSON.parse(line.slice('PROGRESS\t'.length));
    onProgress(payload);
  } catch (_) { /* ignore malformed */ }
}

function runExtractor(pdfPath, pageList, opts = {}) {
  return new Promise(async (resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'import-pdf-tables.py');
    const args = [script, pdfPath];
    if (Array.isArray(pageList) && pageList.length) {
      for (const p of pageList) args.push('--page', String(p));
    }
    if (opts.pageFrom) args.push('--from', String(opts.pageFrom));
    if (opts.pageTo) args.push('--to', String(opts.pageTo));
    if (opts.spanUntilNextTank === false) args.push('--no-span-until-next-tank');
    else args.push('--span-until-next-tank');
    if (opts.tableRole && opts.tableRole !== 'auto') {
      args.push('--table-role', String(opts.tableRole));
    }
    // OCR only the pages that have no text. 'force' (every page) is an explicit choice;
    // ticking the box is not that, because OCR on a page that already has text only loses detail.
    const ocrMode = opts.ocr === 'force' ? 'force' : (opts.ocr === false || opts.ocr === 'false' ? 'off' : 'auto');
    args.push('--ocr', ocrMode);
    // A book can be 300 MB. Stop reading after a time limit and hand back what was read,
    // rather than run for ever; the rest can be imported as a page range.
    const maxSeconds = Number(opts.maxSeconds) > 0 ? Number(opts.maxSeconds) : DEFAULT_MAX_SECONDS;
    if (maxSeconds) args.push('--max-seconds', String(Math.floor(maxSeconds)));
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    // Heartbeat while OCR subprocess is silent
    let beat = null;
    if (onProgress) {
      beat = setInterval(() => {
        onProgress({ phase: 'heartbeat', message: 'Still working…' });
      }, 2000);
    }
    try {
      const { code, out, err, cmd } = await spawnPython(args, {
        maxBuffer: 512 * 1024 * 1024,
        onStderrLine: (line) => parseProgressLine(line, onProgress),
      });
      if (beat) clearInterval(beat);
      if (code !== 0) {
        return reject(new Error(err || out || `PDF import failed (${cmd}, exit ${code})`));
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.error && !(parsed.tables || []).length) {
          return reject(new Error(parsed.error));
        }
        if (err && /ocr|tesseract/i.test(err) && !parsed.ocrUsed) {
          const warnLines = err.split(/\r?\n/).filter((l) => l && !l.startsWith('PROGRESS\t'));
          if (warnLines.length) {
            parsed.warnings = [...(parsed.warnings || []), warnLines.join(' ').trim().slice(0, 300)];
          }
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error('Failed to parse PDF importer JSON: ' + e.message));
      }
    } catch (e) {
      if (beat) clearInterval(beat);
      reject(e);
    }
  });
}

/** Extract from a file already on disk (an upload held there, never read into memory). */
async function extractFromFile(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) throw new Error('PDF not found: ' + filePath);
  return runExtractor(filePath, opts.pages, opts);
}

async function extractFromBuffer(buffer, opts = {}) {
  const tmp = path.join(os.tmpdir(), `fuel-tms-pdf-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await runExtractor(tmp, opts.pages, opts);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function extractFromPath(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) throw new Error('PDF not found: ' + filePath);
  return runExtractor(filePath, opts.pages, opts);
}

/**
 * Start reading a PDF in the background.
 * `source` is a Buffer, or { path, owns } for a file on disk: with `owns` the
 * job deletes the file when it finishes, so a 300 MB upload never sits in memory
 * and never lingers on disk.
 */
function startExtractJob(source, opts = {}) {
  cleanupJobs();
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id,
    status: 'queued',
    phase: 'queued',
    pct: 0,
    message: 'Queued…',
    page: null,
    pages: null,
    startedAt: nowIso(),
    startedAtMs: Date.now(),
    updatedAt: nowIso(),
    error: null,
    result: null,
  };
  JOBS.set(id, job);

  setImmediate(async () => {
    updateJob(id, { status: 'running', phase: 'start', pct: 1, message: 'Saving upload…' });
    const onDisk = source && typeof source === 'object' && !Buffer.isBuffer(source) && source.path;
    const tmp = onDisk ? source.path : path.join(os.tmpdir(), `fuel-tms-pdf-job-${id}.pdf`);
    try {
      if (!onDisk) fs.writeFileSync(tmp, source);
      updateJob(id, { phase: 'start', pct: 2, message: 'Starting PDF reader…' });
      const raw = await runExtractor(tmp, opts.pages, {
        ...opts,
        onProgress: (p) => {
          const patch = {
            status: 'running',
            phase: p.phase || job.phase,
            message: p.message || job.message,
          };
          if (p.pct != null) patch.pct = p.pct;
          if (p.page != null) patch.page = p.page;
          if (p.pages != null) patch.pages = p.pages;
          // heartbeats only refresh updatedAt / message
          if (p.phase === 'heartbeat') {
            updateJob(id, { message: p.message || 'Still working…' });
            return;
          }
          updateJob(id, patch);
        },
      });
      const includeRaw = !!opts.includeRaw;
      const summary = summarizeTables(raw, includeRaw, { findExisting: opts.findExisting });
      job.raw = raw; // kept so the tanks can be created without sending the file again
      updateJob(id, {
        status: 'done',
        phase: 'done',
        pct: 100,
        message: 'Done',
        result: { ok: true, ...summary },
      });
    } catch (e) {
      updateJob(id, {
        status: 'error',
        phase: 'error',
        message: e.message || 'PDF import failed',
        error: e.message || String(e),
      });
    } finally {
      if (!onDisk || source.owns) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
    }
  });

  return publicJob(job);
}

function getJob(id) {
  cleanupJobs();
  return publicJob(JOBS.get(id));
}

/** The full extraction of a finished job (the matrices too), or null once it has expired. */
function getJobRaw(id) {
  cleanupJobs();
  const job = JOBS.get(id);
  return job && job.status === 'done' ? job.raw || null : null;
}

/**
 * Map one extracted table into tank calibration fields.
 * target: "trim" | "list" | "volume" | "full" | "auto"
 */
function tableToCalibration(table, target = 'auto', existing = {}) {
  if (table.skipped || table.parsed?.kind === 'hydrostatic') {
    throw new Error(table.skipReason || 'Hydrostatic L.C.G/T.C.G/V.C.G/IMOM table disregarded');
  }

  const parsed = table.parsed || {};
  const kind = parsed.kind || 'unknown';
  const role = table.tableRole || parsed.tableRole || null;
  let mode = target;
  if (mode === 'auto') {
    if (role === 'heel') mode = 'list';
    else if (role === 'volume' || kind === 'volumeCurve') mode = 'volume';
    else if (role === 'trim' || kind === 'grid') mode = 'full';
    else mode = kind === 'volumeCurve' ? 'volume' : kind === 'grid' ? 'full' : 'raw';
  }

  if (mode === 'volume') {
    const x = parsed.volumeCurve?.x || [];
    const v = parsed.volumeCurve?.v || [];
    if (x.length < 2) throw new Error('No volume curve found in this table');
    return {
      volumeCurve: { x, v },
      soundingIncrement: parsed.soundingIncrement || existing.soundingIncrement,
      capacity: parsed.capacity || existing.capacity,
    };
  }

  if (mode === 'trim' || mode === 'list' || mode === 'full') {
    if (mode === 'list') {
      const axis = (parsed.listAxis || []).length ? parsed.listAxis : (parsed.trimAxis || []);
      const vals = (parsed.listVals || []).length ? parsed.listVals : (parsed.trimVals || []);
      const grid = (parsed.listGrid || []).length ? parsed.listGrid : (parsed.trimGrid || []);
      if (axis.length < 2 || vals.length < 2) {
        throw new Error('No sounding × heel/list grid found in this table');
      }
      const zeroed = withZeroColumn(vals, grid);
      return {
        listAxis: axis,
        listVals: zeroed.vals,
        listGrid: zeroed.grid,
        heelIncrement: parsed.heelIncrement || parsed.soundingIncrement || existing.heelIncrement,
      };
    }

    const axis = parsed.trimAxis || [];
    const vals = parsed.trimVals || [];
    const grid = parsed.trimGrid || [];
    if (axis.length < 2 || vals.length < 2) {
      throw new Error('No sounding × trim/list grid found in this table');
    }

    const patch = {
      trimAxis: axis,
      trimVals: vals,
      trimGrid: grid,
      soundingIncrement: parsed.soundingIncrement || existing.soundingIncrement,
      capacity: parsed.capacity || existing.capacity,
    };
    // A trim *correction* table (mm/cm over a sounding, e.g. "SOUNDING BY THE
    // HEAD ... BY THE STERN") is zero at even trim by definition, same as a
    // heel/list correction — supply the column if the book left it out. A
    // trim *volume* table (Nikolas D-style) is not: 0 trim does not mean 0
    // volume, so it is left to bracket whichever two real columns straddle it.
    if (parsed.gridKind === 'correction') {
      const zeroed = withZeroColumn(patch.trimVals, patch.trimGrid);
      patch.trimVals = zeroed.vals;
      patch.trimGrid = zeroed.grid;
    }

    if (mode === 'full') {
      if ((parsed.volumeCurve?.x || []).length > 1) {
        patch.volumeCurve = parsed.volumeCurve;
      }
      if ((parsed.listGrid || []).length && (parsed.listAxis || []).length) {
        const zeroed = withZeroColumn(parsed.listVals, parsed.listGrid);
        patch.listAxis = parsed.listAxis;
        patch.listVals = zeroed.vals;
        patch.listGrid = zeroed.grid;
        patch.heelIncrement = parsed.heelIncrement || parsed.soundingIncrement || existing.heelIncrement || 1;
      } else if (!(existing.listGrid || []).length) {
        patch.listSeed = true; // a stand-in made from the trim table until a real heel table is found
        const z = vals.findIndex((a) => Number(a) === 0);
        const col = z >= 0 ? z : Math.floor(vals.length / 2);
        const listVals = existing.listVals?.length ? existing.listVals : [-2, -1, 0, 1, 2];
        patch.listAxis = axis.slice();
        patch.listVals = listVals;
        patch.listGrid = axis.map((_, r) =>
          listVals.map(() => Number(grid[r]?.[col]) || 0)
        );
        patch.heelIncrement = parsed.soundingIncrement || existing.heelIncrement || 1;
      }
    }
    return patch;
  }

  return {
    raw: table.raw || table.preview || [],
    note: 'Could not auto-detect grid; preview raw cells and re-import after fixing PDF layout',
  };
}

/**
 * A heel/list table that is printed without a 0 column (-2 -1 | 1 2): a correction at zero heel is
 * zero by definition, so the column is supplied - the calculator needs it to pass through the upright
 * position, and the book leaves it out only because it would be all zeros.
 */
function withZeroColumn(vals, grid) {
  const v = (vals || []).map(Number);
  if (v.length < 2 || v.some((n) => Number.isNaN(n)) || v.includes(0)) return { vals, grid };
  const at = v.findIndex((n) => n > 0);
  if (at <= 0 || !v.slice(0, at).every((n) => n < 0)) return { vals, grid };   // needs both sides of upright
  return {
    vals: [...v.slice(0, at), 0, ...v.slice(at)],
    grid: (grid || []).map((row) => [...row.slice(0, at), 0, ...row.slice(at)]),
  };
}

const STATUS_RANK = { ok: 0, warn: 1, fail: 2 };

/**
 * Check every usable table before anyone is shown it or it is stored: repair the
 * slips that can be repaired with certainty, refuse what cannot, and compare
 * with every other source there is (the same tank elsewhere in the book, the
 * tank's capacity, the tank as it is stored now). See table-check.js.
 */
function reviewTables(tables, opts = {}) {
  const usable = (t) => !t.skipped && t.parsed && (t.parsed.kind === 'grid' || t.parsed.kind === 'volumeCurve');
  const byTank = new Map();
  for (const t of tables) {
    if (!usable(t)) continue;
    const key = String(t.tankName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!byTank.has(key)) byTank.set(key, []);
    byTank.get(key).push(t);
  }
  // A table that was found but could not be read is not silent: it is shown as failed, with the reason.
  for (const t of tables) {
    if (t.skipped || usable(t) || !t.parsed || t.parsed.kind !== 'unknown') continue;
    t.review = {
      status: 'fail',
      score: 0,
      issues: [{
        severity: 'error',
        code: 'unreadable',
        message: 'A table was found on this page but it could not be read as a calibration table (the columns could not be told apart). Check the page, or import it from a clearer copy.',
      }],
      repairs: [],
      cross: [],
      repaired: 0,
    };
  }
  for (const t of tables) {
    if (!usable(t)) continue;
    const key = String(t.tankName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const siblings = (byTank.get(key) || []).filter((o) => o !== t).map((o) => ({
      ...o.parsed, label: `the ${o.tableRole || o.kind} table on page ${o.pageStart || o.page}`,
    }));
    let existing = null;
    try { existing = typeof opts.findExisting === 'function' ? opts.findExisting(t.tankName) : null; } catch (_) { existing = null; }
    const { parsed, review } = tableCheck.reviewParsed(t.parsed, {
      capacity: Number(t.capacityHint) || 0,
      soundingMethod: t.soundingMethod || t.parsed.soundingMethod,
      existing,
      siblings,
    });
    t.parsed = parsed;
    t.review = review;
    if (parsed.capacity) t.capacity = parsed.capacity;
    if (parsed.soundingIncrement) t.soundingIncrement = parsed.soundingIncrement;
  }
}

function tankReview(group, tables) {
  const ts = tables.filter((t) => (group.tableIds || []).includes(t.id) && t.review);
  if (!ts.length) return null;
  let status = 'ok';
  let score = 100;
  let issues = 0;
  let repaired = 0;
  for (const t of ts) {
    if (STATUS_RANK[t.review.status] > STATUS_RANK[status]) status = t.review.status;
    score = Math.min(score, t.review.score);
    issues += t.review.issues.length;
    repaired += t.review.repaired || 0;
  }
  return { status, score, issues, repaired };
}

/** Compact list for API responses (omit huge raw matrices unless requested). */
function summarizeTables(result, includeRaw = false, opts = {}) {
  const tables = (result.tables || []).map((t) => ({
    id: t.id,
    page: t.page,
    pageStart: t.pageStart != null ? t.pageStart : t.page,
    pageEnd: t.pageEnd != null ? t.pageEnd : t.page,
    pageSpan: t.pageSpan || null,
    continued: !!t.continued,
    mergedFrom: t.mergedFrom || null,
    index: t.index,
    rows: t.rows,
    cols: t.cols,
    titleHint: t.titleHint || '',
    tankName: t.tankName || t.titleHint || '',
    tableRole: t.tableRole || t.parsed?.tableRole || null,
    pattern: t.pattern
      ? {
          role: t.pattern.role,
          colCount: t.pattern.colCount,
          axisVals: t.pattern.axisVals,
          header: (t.pattern.header || []).slice(0, 16),
        }
      : null,
    layoutHint: t.layoutHint || '',
    soundingMethod: t.soundingMethod || t.parsed?.soundingMethod || null,
    skipped: !!t.skipped,
    skipReason: t.skipReason || null,
    removedHydroHeaders: t.removedHydroHeaders || [],
    kind: t.parsed?.kind || 'unknown',
    soundingIncrement: t.parsed?.soundingIncrement,
    capacity: t.parsed?.capacity,
    tankNameSource: t.tankNameSource || null,
    tankNameConfidence: t.tankNameConfidence != null ? t.tankNameConfidence : null,
    nameRaw: t.nameRaw || '',
    capacityHint: t.capacityHint || null,
    ocr: !!t.ocr,
    preview: t.preview,
    parsed: t.parsed,
    ...(includeRaw ? { raw: t.raw } : {}),
  }));

  reviewTables(tables, opts);
  const tanks = (result.tanks || []).map((g) => ({ ...g, review: tankReview(g, tables) }));

  return {
    pages: result.pages,
    file: result.file,
    ocrUsed: !!result.ocrUsed,
    skippedHydrostatic: result.skippedHydrostatic || tables.filter((t) => t.skipped).length,
    warnings: result.warnings || [],
    spanUntilNextTank: result.spanUntilNextTank !== false,
    tableRoleFilter: result.tableRoleFilter || null,
    pageFilter: result.pageFilter || null,
    layoutFamilies: result.layoutFamilies || [...new Set(tables.filter((t) => !t.skipped).map((t) => t.layoutHint).filter(Boolean))],
    tanks,
    ocrPages: result.ocrPages || [],
    tables,
    usableTables: tables.filter((t) => !t.skipped && t.kind !== 'hydrostatic' && t.kind !== 'unknown'),
  };
}

/** Infer category / side / grade / calc type from a sounding-book tank title. */
function inferTankMeta(name) {
  const u = String(name || '').toUpperCase();
  let category = 'fuel';
  if (/\b(FW|F\.?\s*W\.?|FRESH\s*WATER|POTABLE|DRINKING)\b/.test(u)) category = 'water';
  else if (/\b(SW|S\.?\s*W\.?|BALLAST|SEA\s*WATER)\b/.test(u)) category = 'misc';
  else if (/\b(LO|L\.?\s*O\.?|LUBE|LUB\s*OIL)\b/.test(u)) category = 'lube';
  else if (/\b(SLUDGE|BILGE|WASTE|SEWAGE)\b/.test(u)) category = 'misc';

  let side = 'center';
  if (/\(\s*P\s*\)|\bPORT\b|\(P\)/.test(u)) side = 'port';
  else if (/\(\s*S\s*\)|\bSTBD\b|\bSTARBOARD\b|\(S\)/.test(u)) side = 'starboard';

  let fuelGrade = 'hfo';
  if (/\b(MGO|M\.?\s*G\.?\s*O\.?|GAS\s*OIL)\b/.test(u)) fuelGrade = 'mgo';
  else if (/\b(MDO|M\.?\s*D\.?\s*O\.?|D\.?\s*O\.?\s*T\.?|DIESEL)\b/.test(u)) fuelGrade = 'mdo';
  else if (/\b(LSFO|VLSFO|ULSFO)\b/.test(u)) fuelGrade = 'lsfo';
  else if (/\b(HFO|H\.?\s*F\.?\s*O\.?|F\.?\s*O\.?\s*T\.?|FUEL\s*OIL)\b/.test(u)) fuelGrade = 'hfo';

  const tankNoMatch = u.match(/\b(?:NO\.?\s*)?(\d+)\b/);
  const tankNo = tankNoMatch ? Number(tankNoMatch[1]) : null;

  return {
    name: String(name || 'Imported tank').trim().slice(0, 120),
    category,
    side,
    fuelGrade,
    tankNo,
    fuelRole: 'storage',
    calcType: 'direct',
    soundingMethod: 'sounding',
    // Head (bow, fore) trim is positive, stern (aft) negative: a PDF import is read in that sense.
    trimAxisSense: 'bow',
    correctionDivisor: 10,
    pipeHeight: 0,
  };
}

function pickBestTableForTank(tables, tableIds) {
  const ids = new Set(tableIds || []);
  const candidates = (tables || []).filter((t) =>
    ids.has(t.id) && !t.skipped && t.parsed?.kind && t.parsed.kind !== 'hydrostatic' && t.parsed.kind !== 'unknown'
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const score = (t) => {
      const p = t.parsed || {};
      if (p.kind === 'grid') {
        const heel = (t.tableRole || p.tableRole) === 'heel';
        // a heel table is the second table of a tank, never the one it is built on
        return (heel ? 40 : 100) + (p.trimAxis || []).length * 2 + (p.trimVals || []).length;
      }
      if (p.kind === 'volumeCurve') return 50 + ((p.volumeCurve && p.volumeCurve.x) || []).length;
      return 0;
    };
    return score(b) - score(a);
  });
  return candidates[0];
}

/**
 * Build tank records + calibration patches from an extract result.
 * Does not write to the store — caller applies via upsertTank / updateCalibration.
 */
function planTankCreates(result, opts = {}) {
  const summary = summarizeTables(result, true, { findExisting: opts.findExisting });
  const selectedNames = Array.isArray(opts.tankNames) && opts.tankNames.length
    ? new Set(opts.tankNames.map((n) => String(n)))
    : null;
  const plans = [];

  for (const group of summary.tanks || []) {
    if (selectedNames && !selectedNames.has(group.name)) continue;
    const table = pickBestTableForTank(summary.tables, group.tableIds);
    if (!table) continue;
    const meta = inferTankMeta(group.name);
    // Fail-safe: a table the checks refuse is not stored unless the user said to.
    const allowed = typeof opts.allowFailed === 'function' ? opts.allowFailed(group.name) : !!opts.allowFailed;
    if (table.review && table.review.status === 'fail' && !allowed) {
      const first = table.review.issues.find((i) => i.severity === 'error');
      plans.push({
        name: meta.name,
        tableId: table.id,
        blocked: true,
        error: `Failed the checks: ${first ? first.message : 'see the table review'}`,
        review: table.review,
      });
      continue;
    }
    let patch;
    try {
      patch = tableToCalibration(table, opts.target || 'auto', {});
    } catch (e) {
      plans.push({
        name: meta.name,
        error: e.message,
        tableId: table.id,
      });
      continue;
    }
    // A tank's book has a table for each of trim, heel and volume. They are one tank: take what
    // each of the others adds (a real heel table in place of the stand-in, a volume curve) so
    // nothing the book holds is thrown away.
    const mergedFrom = [];
    const axisUnits = new Set(table.parsed && table.parsed.axisUnit ? [table.parsed.axisUnit] : []);
    for (const o of summary.tables) {
      if (o.id === table.id || !(group.tableIds || []).includes(o.id) || o.skipped) continue;
      if (!o.parsed || (o.parsed.kind !== 'grid' && o.parsed.kind !== 'volumeCurve')) continue;
      if (o.review && o.review.status === 'fail' && !allowed) continue;
      const role = o.tableRole || o.parsed.tableRole;
      try {
        if (role === 'heel' && o.parsed.kind === 'grid' && (patch.listSeed || !(patch.listGrid || []).length)) {
          Object.assign(patch, tableToCalibration(o, 'list', {}));
          delete patch.listSeed;
          mergedFrom.push(o.id);
          if (o.parsed.axisUnit) axisUnits.add(o.parsed.axisUnit);
        } else if (o.parsed.kind === 'volumeCurve' && !((patch.volumeCurve && patch.volumeCurve.x) || []).length) {
          const v = tableToCalibration(o, 'volume', {});
          patch.volumeCurve = v.volumeCurve;
          mergedFrom.push(o.id);
          if (o.parsed.axisUnit) axisUnits.add(o.parsed.axisUnit);
        } else if (role !== 'heel' && o.parsed.kind === 'grid' && !(patch.trimGrid || []).length) {
          const g = tableToCalibration(o, 'trim', {});
          Object.assign(patch, { trimAxis: g.trimAxis, trimVals: g.trimVals, trimGrid: g.trimGrid });
          mergedFrom.push(o.id);
          if (o.parsed.axisUnit) axisUnits.add(o.parsed.axisUnit);
        }
      } catch (_) { /* a table that cannot be read adds nothing */ }
    }
    delete patch.listSeed;
    // A table of corrections has no capacity of its own (its largest figure is a correction, not a
    // volume): the tank's capacity comes from its capacity curve.
    const correctionPrimary = table.parsed && (table.parsed.gridKind === 'correction' || table.tableRole === 'heel');
    if (correctionPrimary) delete patch.capacity;
    if (patch.volumeCurve && patch.volumeCurve.v && patch.volumeCurve.v.length) {
      patch.capacity = Math.max(...patch.volumeCurve.v.filter((v) => Number.isFinite(v)));
    }
    if (patch.raw && !patch.trimAxis && !patch.volumeCurve) {
      plans.push({
        name: meta.name,
        error: patch.note || 'Could not parse table',
        tableId: table.id,
      });
      continue;
    }
    const calcType = (patch.trimGrid || []).length ? 'direct' : meta.calcType;
    const soundingMethod = table.soundingMethod || table.parsed?.soundingMethod || meta.soundingMethod;
    const tank = {
      ...meta,
      calcType,
      soundingMethod,
      capacity: patch.capacity || (correctionPrimary ? (Number(table.capacityHint) || 0) : table.capacity) || meta.capacity || 0,
      soundingIncrement: patch.soundingIncrement || table.soundingIncrement || 1,
      heelIncrement: patch.heelIncrement || 1,
      ...patch,
      soundingMethod,
      pdfSource: group.name,
      pdfTableId: table.id,
    };
    // The tables of one tank can be in different units (soundings in metres for the corrections,
    // gauge in centimetres for the capacity). One unit is stored only when they all agree; otherwise
    // the app reads each table's own axis, as it does for a book imported from Excel.
    if (axisUnits.size === 1) tank.soundingUnit = [...axisUnits][0];
    // Ask the finished tables what arrangement they are in; keep the guess
    // above when they do not say clearly.
    const verdict = detectCalcType(tank);
    if (verdict.confident && verdict.calcType) tank.calcType = verdict.calcType;
    tank.calcTypeReason = verdict.reason;
    tank.calcTypeConfident = !!verdict.confident;
    plans.push({
      name: meta.name,
      tableId: table.id,
      kind: table.parsed?.kind,
      layoutHint: table.layoutHint,
      tank,
      patch,
      review: table.review || null,
      mergedFrom,
    });
  }
  return plans;
}

module.exports = {
  extractFromBuffer,
  extractFromFile,
  extractFromPath,
  startExtractJob,
  getJob,
  getJobRaw,
  reviewTables,
  tableToCalibration,
  summarizeTables,
  inferTankMeta,
  pickBestTableForTank,
  planTankCreates,
  withZeroColumn,
};
