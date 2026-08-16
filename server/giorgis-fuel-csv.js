/**
 * Parse Giorgis-style multi-tank workbook CSVs (fuel / misc / fresh water).
 *
 * Layout per tank block (variants):
 *   TITLE,,,,,,,,,,,,,,,,,,
 *   [optional SOUNDING ullage / labels]
 *   Depth|GAUGE|SOUNDING, trimVals..., [gap], Depth|GAUGE, heelVals...
 *   axis, vol@trim..., [soundingCm], heelAxis, heelVals...
 *
 * Left = depth/ullage × trim → direct volume grid
 * Right = heel/list corrections (optional)
 */
const { detectInc } = require('./table-io');
const { inferTankMeta } = require('./pdf-import');

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

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/^\uFEFF/, '').replace(/\u2212/g, '-').replace(/,/g, '');
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellNonEmpty(c) {
  return String(c || '').trim() !== '';
}

function cleanTitle(name) {
  let t = String(name || '').replace(/^\uFEFF/, '').trim();
  t = t.replace(/^\d+\s+compart:\s*/i, '');
  t = t.replace(/\s*-\s*Volume\s+in\s+m(?:3|³)\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
}

function isMetadataTitle(first) {
  const u = String(first || '').replace(/^\uFEFF/, '').trim().toUpperCase();
  return (
    /^COMPARTMENT\s+IDENT/.test(u)
    || /^CONTENTS\s*:/.test(u)
    || /^EXTREME\s+POINTS/.test(u)
    || /^FORE\s+END\b/.test(u)
    || /^SOUNDING\s+DEVICE/.test(u)
    || /^X\s*=/.test(u)
    || /^Y\s*=/.test(u)
    || /^Z\s*=/.test(u)
    || /^FILL\s*%/.test(u)
  );
}

function looksLikeTankTitle(first, restNonEmpty) {
  if (restNonEmpty > 0) return false;
  const raw = String(first || '').replace(/^\uFEFF/, '').trim();
  if (!raw || raw.length < 3) return false;
  if (isMetadataTitle(raw)) return false;
  // Prefer "NAME - Volume in m3" over "N compart: NAME"
  if (/^\d+\s+compart:/i.test(raw)) return false;
  const u = raw.toUpperCase();
  if (/^(SOUNDING|DEPTH|GAUGE|ULLAGE|FILL)\b/.test(u)) return false;
  if (toNum(u) != null) return false;

  return (
    /\bTANK\b/.test(u)
    || /\bTK\.?\b/.test(u)
    || /\bH\.?\s*F\.?\s*O\.?\b/.test(u)
    || /\bM\.?\s*D\.?\s*O\.?\b/.test(u)
    || /\bM\.?\s*G\.?\s*O\.?\b/.test(u)
    || /\bF\.?\s*W\.?\b/.test(u)
    || /\bL\.?\s*O\.?\b/.test(u)
    || /\bSETTLING\b/.test(u)
    || /\bSERVICE\b/.test(u)
    || /\bOVERFLOW\b/.test(u)
    || /\bSTORAGE\b/.test(u)
    || /\bBILGE\b/.test(u)
    || /\bSLUDGE\b/.test(u)
    || /\bSEWAGE\b/.test(u)
    || /\bDRAIN\b/.test(u)
    || /\bSTERN\b/.test(u)
    || /\bSUMP\b/.test(u)
    || /\bBALLAST\b/.test(u)
    || /\bDISTILLED\b/.test(u)
    || /\bDRINKING\b/.test(u)
    || /\bFRESH\s*WATER\b/.test(u)
    || /VOLUME\s+IN\s+M/.test(u)
  );
}

function isLabelRow(cells) {
  const joined = cells.map((c) => String(c || '').trim()).filter(Boolean).join(' ').toUpperCase();
  if (!joined) return false;
  // Pure section labels without numeric trim headers
  if (/^SOUNDING\b/.test(joined) && /\bULLAGE\b/.test(joined) && !/-?\d/.test(joined)) return true;
  return false;
}

function isAxisHeaderRow(cells) {
  const first = String(cells[0] || '').trim().toUpperCase();
  if (!/^(DEPTH|SOUNDING|ULLAGE|GAUGE|GAUGE\s+ULL|SOUNDING\s+ULLAGE)?$/.test(first) && toNum(cells[0]) != null) {
    return false;
  }
  // Need ≥2 numeric axis headers after col0
  let nums = 0;
  for (let i = 1; i < cells.length; i++) {
    if (toNum(cells[i]) != null) nums++;
  }
  return nums >= 2 && (
    /^(DEPTH|SOUNDING|ULLAGE|GAUGE)/.test(first)
    || first === ''
    || toNum(cells[0]) == null
  );
}

function isBlankRow(cells) {
  return !cells.some(cellNonEmpty);
}

function parseHeaderAxes(cells) {
  const nums = [];
  for (let i = 0; i < cells.length; i++) {
    const n = toNum(cells[i]);
    if (n != null) nums.push({ i, n });
  }
  if (nums.length < 2) return null;

  const groups = [];
  let cur = [nums[0]];
  for (let k = 1; k < nums.length; k++) {
    const prev = nums[k - 1];
    const now = nums[k];
    const gapEmpty = now.i - prev.i > 1;
    if (gapEmpty && cur.length >= 2) {
      groups.push(cur);
      cur = [now];
    } else {
      cur.push(now);
    }
  }
  if (cur.length) groups.push(cur);

  let trimGroup = groups[0];
  let heelGroup = groups.length > 1 ? groups[groups.length - 1] : null;
  if (!trimGroup || trimGroup.length < 2) return null;
  if (heelGroup && heelGroup[0].i <= trimGroup[trimGroup.length - 1].i) {
    heelGroup = null;
  }

  // Drop trailing trim header that sits immediately before a text label (e.g. extra "3" before Ullage)
  while (trimGroup.length > 2) {
    const last = trimGroup[trimGroup.length - 1];
    const nextCell = String(cells[last.i + 1] || '').trim().toUpperCase();
    if (nextCell && toNum(nextCell) == null && /ULLAGE|DEPTH|GAUGE|FILL|SOUNDING/.test(nextCell)) {
      // Keep if this column is part of a clean sequence ending before the label — only drop duplicate-ish extras
      const prev = trimGroup[trimGroup.length - 2];
      if (last.n === prev.n || last.n === trimGroup[trimGroup.length - 3]?.n) {
        trimGroup = trimGroup.slice(0, -1);
        continue;
      }
    }
    break;
  }

  const trimVals = trimGroup.map((x) => x.n);
  const trimStartCol = trimGroup[0].i;
  const trimEndCol = trimGroup[trimGroup.length - 1].i;
  const heelVals = heelGroup ? heelGroup.map((x) => x.n) : [];
  const heelStartCol = heelGroup ? heelGroup[0].i : -1;
  // Heel axis is the Depth/GAUGE label column before heel numbers (may have empty cols in between)
  let heelAxisCol = -1;
  if (heelStartCol > 0) {
    let c = heelStartCol - 1;
    while (c > trimEndCol && !cellNonEmpty(cells[c])) c--;
    if (c > trimEndCol && toNum(cells[c]) == null) heelAxisCol = c;
    else heelAxisCol = heelStartCol - 1;
  }
  let soundingCmCol = -1;
  if (heelAxisCol > trimEndCol + 1) {
    const mid = heelAxisCol - 1;
    if (mid > trimEndCol) soundingCmCol = mid;
  }

  return {
    trimVals,
    trimStartCol,
    heelVals,
    heelStartCol,
    heelAxisCol,
    soundingCmCol,
  };
}

function shrinkTrimToData(axes, dataRows) {
  if (!axes || !dataRows.length) return axes;
  let width = axes.trimVals.length;
  while (width > 2) {
    let filled = 0;
    let checked = 0;
    for (const row of dataRows.slice(0, 12)) {
      const n = toNum(row[axes.trimStartCol + width - 1]);
      checked++;
      if (n != null) filled++;
    }
    if (filled === 0 && checked > 0) {
      width--;
      continue;
    }
    break;
  }
  if (width === axes.trimVals.length) return axes;
  return {
    ...axes,
    trimVals: axes.trimVals.slice(0, width),
  };
}

function inferCategory(name, forced) {
  if (forced && ['fuel', 'lube', 'water', 'misc'].includes(forced)) return forced;
  const u = String(name || '').toUpperCase();
  if (/\b(FW|F\.?\s*W\.?|FRESH\s*WATER|POTABLE|DRINKING|DISTILLED)\b/.test(u) || /\bF\.W\.TK\b/.test(u)) {
    return 'water';
  }
  if (/\b(LO|L\.?\s*O\.?|LUBE|LUB\s*OIL|CYL\.?\s*O)\b/.test(u) && !/\bFO\b|\bH\.?\s*F\.?\s*O\b/.test(u)) {
    // LO drain / GE LO overflow are misc oily systems, not lube storage tables
    if (/\b(DRAIN|OVERFLOW|BILGE|SLUDGE|SEWAGE)\b/.test(u)) return 'misc';
    return 'lube';
  }
  if (/\b(BILGE|SLUDGE|SEWAGE|DRAIN|STERN\s*TUBE|OILY|HOLDING|SUMP)\b/.test(u)) return 'misc';
  if (/\b(BALLAST|SW|S\.?\s*W\.?|SEA\s*WATER)\b/.test(u)) return 'misc';
  return 'fuel';
}

function enrichMeta(name, category) {
  const cleaned = cleanTitle(name);
  const meta = inferTankMeta(cleaned);
  const u = cleaned.toUpperCase();
  meta.name = cleaned;
  meta.category = category;

  if (/\bOVERFLOW\b/.test(u)) meta.fuelRole = 'overflow';
  else if (/\bSETTLING|SETT\.?\b/.test(u)) meta.fuelRole = 'settling';
  else if (/\bSERVICE\b/.test(u)) meta.fuelRole = 'service';
  else if (/\bSUMP\b/.test(u)) meta.fuelRole = 'other';
  else meta.fuelRole = 'storage';

  if (category === 'water') meta.fuelGrade = 'other';
  else if (category === 'lube') meta.fuelGrade = 'other';
  else if (category === 'misc') meta.fuelGrade = 'other';
  else if (/\bM\.?\s*G\.?\s*O\.?\b|\bMGO\b/.test(u)) meta.fuelGrade = 'mgo';
  else if (/\bM\.?\s*D\.?\s*O\.?\b|\bMDO\b/.test(u)) meta.fuelGrade = 'mdo';
  else if (/\bLS\b.*\bH\.?\s*F\.?\s*O|\bLSFO\b|\bVLSFO\b/.test(u)) meta.fuelGrade = 'lsfo';
  else if (/\bH\.?\s*F\.?\s*O|\bHFO\b|\bF\.?\s*O\.?\b/.test(u)) meta.fuelGrade = 'hfo';

  // Side from P/S in FW names like F.W.TK.P
  if (/\.P\b|\(P\)|\bPORT\b|_P\b|\bTK\.?P\b/.test(u)) meta.side = 'port';
  else if (/\.S\b|\(S\)|\bSTBD\b|\bSTARBOARD\b|_S\b|\bTK\.?S\b/.test(u)) meta.side = 'starboard';

  meta.calcType = 'direct';
  meta.correctionDivisor = 1;
  return meta;
}

function gridHasSignal(grid) {
  if (!grid || !grid.length) return false;
  for (const row of grid) {
    for (const v of row) {
      if (v != null && Number(v) !== 0) return true;
    }
  }
  return false;
}

function detectSoundingMethod(axis, evenKeelVols) {
  if (!axis || axis.length < 3 || !evenKeelVols || evenKeelVols.length < 3) return 'ullage';
  const n = Math.min(axis.length, evenKeelVols.length);
  let rising = 0;
  let falling = 0;
  for (let i = 1; i < n; i++) {
    const dv = evenKeelVols[i] - evenKeelVols[i - 1];
    if (dv > 1e-6) rising++;
    else if (dv < -1e-6) falling++;
  }
  return rising > falling ? 'sounding' : 'ullage';
}

function robustCapacity(trimVals, trimGrid) {
  if (!trimGrid || !trimGrid.length) return 0;
  let col = (trimVals || []).findIndex((v) => Number(v) === 0);
  if (col < 0) col = Math.floor((trimVals || []).length / 2);
  const vals = [];
  for (const row of trimGrid) {
    const v = Number(row[col]);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  if (!vals.length) {
    for (const row of trimGrid) {
      for (const x of row) {
        const v = Number(x);
        if (Number.isFinite(v) && v > 0) vals.push(v);
      }
    }
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  const idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.98));
  return Math.round(vals[idx] * 1000) / 1000;
}

function parseTankBlock(name, rows, opts = {}) {
  if (!rows || rows.length < 2) return null;

  let headerIdx = -1;
  let axes = null;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (isLabelRow(rows[i])) continue;
    if (!isAxisHeaderRow(rows[i]) && i > 0) {
      // Still try parseHeaderAxes for bare numeric header rows
    }
    const candidate = parseHeaderAxes(rows[i]);
    if (candidate && candidate.trimVals.length >= 2 && (isAxisHeaderRow(rows[i]) || i === 0)) {
      headerIdx = i;
      axes = candidate;
      break;
    }
    // Fallback: first row with ≥2 numeric headers after a title-ish first cell
    if (candidate && candidate.trimVals.length >= 2 && toNum(rows[i][0]) == null) {
      headerIdx = i;
      axes = candidate;
      break;
    }
  }
  if (!axes || headerIdx < 0) return null;

  const bodyPreview = rows.slice(headerIdx + 1, headerIdx + 16).filter((r) => toNum(r[0]) != null);
  axes = shrinkTrimToData(axes, bodyPreview);

  const trimAxis = [];
  const trimGrid = [];
  const listAxis = [];
  const listGrid = [];
  const volPairs = new Map();

  const evenCol = axes.trimVals.findIndex((v) => Number(v) === 0);
  const ek = evenCol >= 0 ? evenCol : 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;
    // Stop if a new tank title appears inside leftover rows
    const first = (row[0] || '').trim();
    if (looksLikeTankTitle(first, row.slice(1).filter(cellNonEmpty).length)) break;

    const trimS = toNum(row[0]);
    if (trimS == null) continue;

    const tRow = axes.trimVals.map((_, j) => {
      const n = toNum(row[axes.trimStartCol + j]);
      return n != null ? n : 0;
    });
    if (!tRow.some((_, j) => toNum(row[axes.trimStartCol + j]) != null)) continue;
    trimAxis.push(trimS);
    trimGrid.push(tRow);

    if (axes.soundingCmCol >= 0) {
      const scm = toNum(row[axes.soundingCmCol]);
      if (scm != null) volPairs.set(scm, tRow[ek]);
    }

    if (axes.heelStartCol >= 0 && axes.heelVals.length >= 2 && axes.heelAxisCol >= 0) {
      const heelS = toNum(row[axes.heelAxisCol]);
      if (heelS == null) continue;
      const hRow = axes.heelVals.map((_, j) => {
        const n = toNum(row[axes.heelStartCol + j]);
        return n != null ? n : 0;
      });
      if (!hRow.some((_, j) => toNum(row[axes.heelStartCol + j]) != null)) continue;
      listAxis.push(heelS);
      listGrid.push(hRow);
    }
  }

  if (trimAxis.length < 2) return null;

  const evenKeelVols = trimGrid.map((r) => r[ek]);
  const soundingMethod = detectSoundingMethod(trimAxis, evenKeelVols);
  const capacity = robustCapacity(axes.trimVals, trimGrid);
  const category = inferCategory(name, opts.category);
  const meta = enrichMeta(name, category);

  const tank = {
    ...meta,
    name: meta.name,
    category,
    calcType: 'direct',
    soundingMethod,
    correctionDivisor: 1,
    capacity,
    soundingIncrement: detectInc(trimAxis),
    heelIncrement: listAxis.length >= 2 ? detectInc(listAxis) : detectInc(trimAxis),
    trimAxis,
    trimVals: axes.trimVals,
    trimGrid,
    listAxis: [],
    listVals: [],
    listGrid: [],
    volumeCurve: { x: [], v: [] },
    pdfSource: cleanTitle(name),
    importFormat: category === 'fuel' ? 'giorgis-fuel-csv'
      : category === 'water' ? 'giorgis-water-csv'
        : category === 'misc' ? 'giorgis-misc-csv'
          : 'giorgis-workbook-csv',
  };

  if (listAxis.length >= 2 && gridHasSignal(listGrid)) {
    tank.listAxis = listAxis;
    tank.listVals = axes.heelVals;
    tank.listGrid = listGrid;
  }

  if (volPairs.size >= 2) {
    const xs = [...volPairs.keys()].sort((a, b) => a - b);
    tank.volumeCurve = { x: xs, v: xs.map((x) => volPairs.get(x)) };
  } else {
    // Even-keel volume curve from trim grid
    tank.volumeCurve = { x: trimAxis.slice(), v: evenKeelVols.slice() };
  }

  return tank;
}

function looksLikeGiorgisWorkbookCsv(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const head = clean.slice(0, 12000).toUpperCase();
  if (/^ID\s*,\s*NAME\s*,/i.test(clean)) return false;
  if (/META\s*,\s*KEY\s*,\s*VALUE/i.test(head)) return false;
  const hasAxis = /\b(DEPTH|SOUNDING|ULLAGE|GAUGE)\b/.test(head);
  const hasTankish = /\b(TANK|TK\.|BILGE|SLUDGE|SEWAGE|F\.W\.|VOLUME IN M|COMPART:)\b/.test(head);
  return hasAxis && hasTankish;
}

function looksLikeGiorgisFuelWorkbook(text) {
  return looksLikeGiorgisWorkbookCsv(text);
}

function guessForcedCategory(text, filename = '') {
  const fn = String(filename || '').toLowerCase();
  const head = String(text || '').slice(0, 8000).toUpperCase();
  if (/fresh|fresg|water|fw\b/.test(fn) || /\bF\.W\.TK\b|\bFRESH\s*WATER\b|\bDRINKING\s*W/.test(head)) {
    return 'water';
  }
  if (/misc/.test(fn) || /\b(BILGE|SLUDGE|SEWAGE|STERN\s*TUBE|OILY\s*BILGE|CLEAN\s*DRAIN)\b/.test(head)) {
    // Prefer misc when those titles dominate and HFO storage titles are absent
    if (!/\bNO\.\d+\s+H\.?\s*F\.?\s*O/.test(head)) return 'misc';
  }
  if (/lube|l\.o/.test(fn)) return 'lube';
  return null;
}

/**
 * @param {string} text
 * @param {{ category?: string, filename?: string }} [opts]
 */
function parseGiorgisWorkbookCsv(text, opts = {}) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  const rows = lines.map((line) => splitCsvLine(line).map((c) => c.trim()));
  const warnings = [];
  const forced = opts.category || guessForcedCategory(clean, opts.filename);

  const blocks = [];
  let current = null;
  for (const row of rows) {
    const first = (row[0] || '').replace(/^\uFEFF/, '').trim();
    const rest = row.slice(1).filter(cellNonEmpty).length;
    if (looksLikeTankTitle(first, rest)) {
      if (current) blocks.push(current);
      current = { name: first, rows: [] };
      continue;
    }
    if (!current) continue;
    if (isBlankRow(row)) continue;
    current.rows.push(row);
  }
  if (current) blocks.push(current);

  if (!blocks.length) {
    throw new Error('No tank title rows found in Giorgis workbook CSV');
  }

  const tanks = [];
  for (const block of blocks) {
    try {
      const tank = parseTankBlock(block.name, block.rows, { category: forced });
      if (!tank) {
        warnings.push(`Could not parse table for ${cleanTitle(block.name)}`);
        continue;
      }
      tanks.push(tank);
    } catch (e) {
      warnings.push(`${cleanTitle(block.name)}: ${e.message}`);
    }
  }

  if (!tanks.length) {
    throw new Error('Giorgis workbook CSV recognized but no usable tank tables parsed');
  }

  const cats = [...new Set(tanks.map((t) => t.category))];
  const format = cats.length === 1 && cats[0] === 'fuel' ? 'giorgis-fuel-csv'
    : cats.length === 1 && cats[0] === 'water' ? 'giorgis-water-csv'
      : cats.length === 1 && cats[0] === 'misc' ? 'giorgis-misc-csv'
        : 'giorgis-workbook-csv';

  return {
    format,
    tanks,
    warnings,
    tankCount: tanks.length,
    categories: cats,
  };
}

function parseGiorgisFuelCsv(text, opts = {}) {
  return parseGiorgisWorkbookCsv(text, { ...opts, category: opts.category || 'fuel' });
}

function enrichFuelMeta(name) {
  return enrichMeta(name, 'fuel');
}

module.exports = {
  looksLikeGiorgisFuelWorkbook,
  looksLikeGiorgisWorkbookCsv,
  parseGiorgisFuelCsv,
  parseGiorgisWorkbookCsv,
  parseTankBlock,
  enrichFuelMeta,
  guessForcedCategory,
};
