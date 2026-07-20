/**
 * Round-trip tank calibration tables as editable CSV (and helpers for Excel).
 *
 * CSV format (opens cleanly in Excel / LibreOffice):
 *
 *   META,key,value
 *   META,calcType,correction
 *   META,capacity,500
 *   TRIM,SOUNDING,2,1,0,-1,-2
 *   TRIM,0,0,0,0,0,0
 *   TRIM,50,12.1,12.5,13,12.4,11.9
 *   VOLUME,SOUNDING,VOLUME
 *   VOLUME,0,0
 *   LIST,SOUNDING,-2,-1,0,1,2
 *   LIST,0,0,0,0,0,0
 *
 * Also accepts a plain grid CSV (no section tags):
 *   SOUNDING,2,1,0,-1,-2
 *   0,0,0,0,0,0
 *   ...
 */

const META_KEYS = [
  'calcType',
  'capacity',
  'correctionDivisor',
  'pipeHeight',
  'soundingMethod',
  'soundingIncrement',
  'heelIncrement',
  'name',
];

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/\u2212/g, '-').replace(',', '.');
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function detectInc(axis) {
  if (!axis || axis.length < 2) return 1;
  const diffs = [];
  for (let i = 1; i < axis.length; i++) {
    const d = Math.round(Math.abs(axis[i] - axis[i - 1]) * 1000) / 1000;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 1;
  const counts = new Map();
  for (const d of diffs) counts.set(d, (counts.get(d) || 0) + 1);
  let best = diffs[0];
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  for (const p of [1, 2, 5, 10, 20, 25, 50]) {
    if (Math.abs(best - p) < 1e-6) return p;
  }
  return best;
}

function tankToCsv(tank) {
  const lines = [];
  lines.push('# Vessel Fuel TMS — tank calibration table');
  lines.push(`# tankId: ${tank.id || ''}`);
  lines.push(`# name: ${(tank.name || '').replace(/\n/g, ' ')}`);
  lines.push('# Edit META / TRIM / VOLUME / LIST rows, then Import CSV on Calibration DB.');
  lines.push('META,key,value');
  for (const k of META_KEYS) {
    if (tank[k] == null || tank[k] === '') continue;
    lines.push(['META', k, tank[k]].map(csvEscape).join(','));
  }

  const trimVals = tank.trimVals || [];
  const trimAxis = tank.trimAxis || [];
  const trimGrid = tank.trimGrid || [];
  if (trimVals.length && trimAxis.length) {
    lines.push(['TRIM', 'SOUNDING', ...trimVals].map(csvEscape).join(','));
    trimAxis.forEach((s, i) => {
      const row = trimGrid[i] || [];
      lines.push(['TRIM', s, ...trimVals.map((_, j) => (row[j] != null ? row[j] : 0))].map(csvEscape).join(','));
    });
  }

  const vx = tank.volumeCurve?.x || [];
  const vv = tank.volumeCurve?.v || [];
  if (vx.length) {
    lines.push('VOLUME,SOUNDING,VOLUME');
    vx.forEach((x, i) => {
      lines.push(['VOLUME', x, vv[i] != null ? vv[i] : 0].map(csvEscape).join(','));
    });
  }

  const listVals = tank.listVals || [];
  const listAxis = tank.listAxis || [];
  const listGrid = tank.listGrid || [];
  if (listVals.length && listAxis.length) {
    lines.push(['LIST', 'SOUNDING', ...listVals].map(csvEscape).join(','));
    listAxis.forEach((s, i) => {
      const row = listGrid[i] || [];
      lines.push(['LIST', s, ...listVals.map((_, j) => (row[j] != null ? row[j] : 0))].map(csvEscape).join(','));
    });
  }

  return lines.join('\n') + '\n';
}

function parsePlainGrid(rows) {
  if (rows.length < 2) return null;
  // Find header row with ≥2 numeric cells
  let headerIdx = -1;
  let vals = [];
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const nums = [];
    for (let c = 1; c < rows[i].length; c++) {
      const n = toNum(rows[i][c]);
      if (n != null) nums.push(n);
      else if (nums.length) break;
    }
    if (nums.length >= 2) {
      headerIdx = i;
      vals = nums;
      break;
    }
  }
  if (headerIdx < 0) return null;

  const axis = [];
  const grid = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const s = toNum(rows[i][0]);
    if (s == null) continue;
    const row = [];
    let ok = 0;
    for (let c = 0; c < vals.length; c++) {
      const n = toNum(rows[i][c + 1]);
      if (n == null) row.push(0);
      else {
        row.push(n);
        ok++;
      }
    }
    if (!ok) continue;
    axis.push(s);
    grid.push(row);
  }
  if (axis.length < 2) return null;
  return { vals, axis, grid };
}

function parseVolumePairs(rows, startCol = 0) {
  const x = [];
  const v = [];
  for (const row of rows) {
    const a = toNum(row[startCol]);
    const b = toNum(row[startCol + 1]);
    if (a == null || b == null) continue;
    // skip header-like 0,0 only if labeled — keep numeric pairs
    x.push(a);
    v.push(b);
  }
  // drop if first pair looks like non-data and too short
  if (x.length < 2) return null;
  return { x, v };
}

/**
 * Parse calibration CSV text into a calibration patch.
 */
function csvToCalibration(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  const rows = [];
  for (const line of rawLines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    rows.push(splitCsvLine(line).map((c) => c.trim()));
  }
  if (!rows.length) throw new Error('Empty CSV');

  const first = (rows[0][0] || '').toUpperCase();
  const isSectioned = ['META', 'TRIM', 'LIST', 'VOLUME'].includes(first);

  const patch = {};

  if (!isSectioned) {
    // Plain grid → trim table; or 2-col volume curve
    if (rows[0].length <= 3) {
      const vol = parseVolumePairs(rows.slice(rows[0][0] && toNum(rows[0][0]) == null ? 1 : 0));
      if (vol) {
        patch.volumeCurve = vol;
        patch.soundingIncrement = detectInc(vol.x);
        patch.capacity = Math.max(...vol.v);
        return patch;
      }
    }
    const grid = parsePlainGrid(rows);
    if (!grid) throw new Error('Could not parse CSV as sounding×trim grid or volume curve');
    patch.trimAxis = grid.axis;
    patch.trimVals = grid.vals;
    patch.trimGrid = grid.grid;
    patch.soundingIncrement = detectInc(grid.axis);
    // Do not infer capacity from trim grid — correction tables are small numbers
    return patch;
  }

  const sections = { META: [], TRIM: [], LIST: [], VOLUME: [] };
  for (const row of rows) {
    const tag = (row[0] || '').toUpperCase();
    if (!sections[tag]) continue;
    sections[tag].push(row.slice(1));
  }

  for (const row of sections.META) {
    const key = row[0];
    const val = row[1];
    if (!key || !META_KEYS.includes(key)) continue;
    if (key === 'calcType' || key === 'soundingMethod' || key === 'name') patch[key] = val;
    else patch[key] = toNum(val) ?? val;
  }

  if (sections.TRIM.length >= 2) {
    const header = sections.TRIM[0];
    // header: SOUNDING, t1, t2, ...  OR just t1,t2,...
    let vals;
    let dataStart = 1;
    if (String(header[0]).toUpperCase() === 'SOUNDING' || toNum(header[0]) == null) {
      vals = header.slice(1).map(toNum).filter((n) => n != null);
    } else {
      vals = header.map(toNum).filter((n) => n != null);
      dataStart = 0;
    }
    const axis = [];
    const grid = [];
    for (const row of sections.TRIM.slice(Math.max(dataStart, 1))) {
      const s = toNum(row[0]);
      if (s == null) continue;
      axis.push(s);
      grid.push(vals.map((_, j) => toNum(row[j + 1]) ?? 0));
    }
    if (axis.length && vals.length) {
      patch.trimAxis = axis;
      patch.trimVals = vals;
      patch.trimGrid = grid;
      if (patch.soundingIncrement == null) patch.soundingIncrement = detectInc(axis);
    }
  }

  if (sections.LIST.length >= 2) {
    const header = sections.LIST[0];
    let vals;
    if (String(header[0]).toUpperCase() === 'SOUNDING' || toNum(header[0]) == null) {
      vals = header.slice(1).map(toNum).filter((n) => n != null);
    } else {
      vals = header.map(toNum).filter((n) => n != null);
    }
    const axis = [];
    const grid = [];
    for (const row of sections.LIST.slice(1)) {
      const s = toNum(row[0]);
      if (s == null) continue;
      axis.push(s);
      grid.push(vals.map((_, j) => toNum(row[j + 1]) ?? 0));
    }
    if (axis.length && vals.length) {
      patch.listAxis = axis;
      patch.listVals = vals;
      patch.listGrid = grid;
      if (patch.heelIncrement == null) patch.heelIncrement = detectInc(axis);
    }
  }

  if (sections.VOLUME.length >= 2) {
    const body = sections.VOLUME.slice(1);
    // skip header row VOLUME,SOUNDING,VOLUME already sliced — first data may still be labels
    const start = toNum(body[0]?.[0]) == null ? 1 : 0;
    const vol = parseVolumePairs(body.slice(start));
    if (vol) {
      patch.volumeCurve = vol;
      if (patch.capacity == null) patch.capacity = Math.max(...vol.v);
      if (patch.soundingIncrement == null) patch.soundingIncrement = detectInc(vol.x);
    }
  }

  if (!patch.trimAxis && !patch.listAxis && !patch.volumeCurve) {
    throw new Error('CSV has META/section tags but no TRIM, LIST, or VOLUME data');
  }
  return patch;
}

module.exports = {
  tankToCsv,
  csvToCalibration,
  META_KEYS,
  detectInc,
};
