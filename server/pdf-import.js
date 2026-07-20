/**
 * Extract calibration tables from PDF via scripts/import-pdf-tables.py (pdfplumber).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function runExtractor(pdfPath, pageList) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'import-pdf-tables.py');
    const args = [script, pdfPath];
    if (Array.isArray(pageList) && pageList.length) {
      for (const p of pageList) args.push('--page', String(p));
    }
    const py = spawn('python3', args, { maxBuffer: 64 * 1024 * 1024 });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(err || out || `PDF import failed (exit ${code})`));
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.error && !(parsed.tables || []).length) {
          return reject(new Error(parsed.error));
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error('Failed to parse PDF importer JSON: ' + e.message));
      }
    });
  });
}

async function extractFromBuffer(buffer, opts = {}) {
  const tmp = path.join(os.tmpdir(), `fuel-tms-pdf-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await runExtractor(tmp, opts.pages);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function extractFromPath(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) throw new Error('PDF not found: ' + filePath);
  return runExtractor(filePath, opts.pages);
}

/**
 * Map one extracted table into tank calibration fields.
 * target: "trim" | "list" | "volume" | "full" | "auto"
 */
function tableToCalibration(table, target = 'auto', existing = {}) {
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
      // Also apply volume curve if present
      if ((parsed.volumeCurve?.x || []).length > 1) {
        patch.volumeCurve = parsed.volumeCurve;
      }
      // Seed a flat list/heel table from the zero-trim column if none exists
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

  // Raw preview only — caller should show table for manual mapping
  return {
    raw: table.raw || table.preview || [],
    note: 'Could not auto-detect grid; preview raw cells and re-import after fixing PDF layout',
  };
}

/** Compact list for API responses (omit huge raw matrices unless requested). */
function summarizeTables(result, includeRaw = false) {
  return {
    pages: result.pages,
    file: result.file,
    tables: (result.tables || []).map((t) => ({
      id: t.id,
      page: t.page,
      index: t.index,
      rows: t.rows,
      cols: t.cols,
      titleHint: t.titleHint || '',
      kind: t.parsed?.kind || 'unknown',
      soundingIncrement: t.parsed?.soundingIncrement,
      capacity: t.parsed?.capacity,
      preview: t.preview,
      parsed: t.parsed,
      ...(includeRaw ? { raw: t.raw } : {}),
    })),
  };
}

module.exports = {
  extractFromBuffer,
  extractFromPath,
  tableToCalibration,
  summarizeTables,
};
