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
    if (opts.ocr) args.push('--ocr');
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
        maxBuffer: 128 * 1024 * 1024,
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

function startExtractJob(buffer, opts = {}) {
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
    const tmp = path.join(os.tmpdir(), `fuel-tms-pdf-job-${id}.pdf`);
    try {
      fs.writeFileSync(tmp, buffer);
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
      const summary = summarizeTables(raw, includeRaw);
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
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  });

  return publicJob(job);
}

function getJob(id) {
  cleanupJobs();
  return publicJob(JOBS.get(id));
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
  const mode = target === 'auto'
    ? (kind === 'volumeCurve' ? 'volume' : kind === 'grid' ? 'full' : 'raw')
    : target;

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
    const axis = parsed.trimAxis || [];
    const vals = parsed.trimVals || [];
    const grid = parsed.trimGrid || [];
    if (axis.length < 2 || vals.length < 2) {
      throw new Error('No sounding × trim/list grid found in this table');
    }

    if (mode === 'list') {
      return {
        listAxis: axis,
        listVals: vals,
        listGrid: grid,
        heelIncrement: parsed.soundingIncrement || existing.heelIncrement,
      };
    }

    const patch = {
      trimAxis: axis,
      trimVals: vals,
      trimGrid: grid,
      soundingIncrement: parsed.soundingIncrement || existing.soundingIncrement,
      capacity: parsed.capacity || existing.capacity,
    };

    if (mode === 'full') {
      if ((parsed.volumeCurve?.x || []).length > 1) {
        patch.volumeCurve = parsed.volumeCurve;
      }
      if (!(existing.listGrid || []).length) {
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

/** Compact list for API responses (omit huge raw matrices unless requested). */
function summarizeTables(result, includeRaw = false) {
  const tables = (result.tables || []).map((t) => ({
    id: t.id,
    page: t.page,
    index: t.index,
    rows: t.rows,
    cols: t.cols,
    titleHint: t.titleHint || '',
    tankName: t.tankName || t.titleHint || '',
    layoutHint: t.layoutHint || '',
    soundingMethod: t.soundingMethod || t.parsed?.soundingMethod || null,
    skipped: !!t.skipped,
    skipReason: t.skipReason || null,
    removedHydroHeaders: t.removedHydroHeaders || [],
    kind: t.parsed?.kind || 'unknown',
    soundingIncrement: t.parsed?.soundingIncrement,
    capacity: t.parsed?.capacity,
    preview: t.preview,
    parsed: t.parsed,
    ...(includeRaw ? { raw: t.raw } : {}),
  }));

    return {
    pages: result.pages,
    file: result.file,
    ocrUsed: !!result.ocrUsed,
    skippedHydrostatic: result.skippedHydrostatic || tables.filter((t) => t.skipped).length,
    warnings: result.warnings || [],
    layoutFamilies: result.layoutFamilies || [...new Set(tables.filter((t) => !t.skipped).map((t) => t.layoutHint).filter(Boolean))],
    tanks: result.tanks || [],
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
      if (p.kind === 'grid') return 100 + (p.trimAxis || []).length * 2 + (p.trimVals || []).length;
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
  const summary = summarizeTables(result, true);
  const selectedNames = Array.isArray(opts.tankNames) && opts.tankNames.length
    ? new Set(opts.tankNames.map((n) => String(n)))
    : null;
  const plans = [];

  for (const group of summary.tanks || []) {
    if (selectedNames && !selectedNames.has(group.name)) continue;
    const table = pickBestTableForTank(summary.tables, group.tableIds);
    if (!table) continue;
    const meta = inferTankMeta(group.name);
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
      capacity: patch.capacity || table.capacity || meta.capacity || 0,
      soundingIncrement: patch.soundingIncrement || table.soundingIncrement || 1,
      heelIncrement: patch.heelIncrement || 1,
      ...patch,
      soundingMethod,
      pdfSource: group.name,
      pdfTableId: table.id,
    };
    plans.push({
      name: meta.name,
      tableId: table.id,
      kind: table.parsed?.kind,
      layoutHint: table.layoutHint,
      tank,
      patch,
    });
  }
  return plans;
}

module.exports = {
  extractFromBuffer,
  extractFromPath,
  startExtractJob,
  getJob,
  tableToCalibration,
  summarizeTables,
  inferTankMeta,
  pickBestTableForTank,
  planTankCreates,
};
