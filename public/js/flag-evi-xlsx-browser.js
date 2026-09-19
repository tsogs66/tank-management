/**
 * Browser-side FLAG EVI Trim + Heeling Correction XLSX parser.
 * Mirrors scripts/import-flag-evi-xlsx.py so Android / offline LocalApi can
 * import dual ullage+sounding workbooks without Python.
 *
 * Requires global XLSX (SheetJS). Default layout: col0=ullage, col1=sounded,
 * then heel/trim/volume columns.
 */
(function (global) {
  'use strict';

  function cleanNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = String(v).trim().replace(/,/g, '');
    if (!s || s === '-' || s === '—') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function cleanTitle(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function isTitleRow(row) {
    if (!row || !row.length) return false;
    const first = cleanTitle(row[0]);
    if (!first || first.length < 3) return false;
    if (cleanNum(row[0]) != null) return false;
    const u = first.toUpperCase();
    if (u.includes('ULLAGE') || u.includes('SOUND') || u.includes('HEEL') || u.includes('TRIM')) {
      if (!/TK|TANK|H\.?F\.?O|D\.?O|MGO|FW|F\.?W|LO|LUBE|SLOP|BILGE/i.test(first)) return false;
    }
    return /TK|TANK|H\.?F\.?O|D\.?O|MGO|FW|F\.?W|LO|LUBE|SLOP|BILGE|NO\.\s*\d/i.test(first);
  }

  function sheetKind(title) {
    const t = String(title || '').toUpperCase();
    if (t.includes('HEEL')) return 'heel';
    if (t.includes('TRIM')) return 'trim';
    return null;
  }

  function looksLikeFlagEvi(sheetNames) {
    const kinds = new Set();
    for (const n of sheetNames || []) {
      const k = sheetKind(n);
      if (k) kinds.add(k);
    }
    return kinds.has('trim') && kinds.has('heel');
  }

  function detectIncrement(axis) {
    if (!axis || axis.length < 2) return 1;
    const diffs = [];
    for (let i = 1; i < Math.min(axis.length, 40); i++) {
      const d = Math.abs(Number(axis[i]) - Number(axis[i - 1]));
      if (d > 1e-9) diffs.push(d);
    }
    if (!diffs.length) return 1;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 1;
  }

  const DEPTH_LABEL = /\b(SOUNDING|SOUNDED|ULLAGE)\b/i;
  const UNIT = /\b(MM|CM|M)\b/i;
  const UNIT_TO_MM = { MM: 1, CM: 10, M: 1000 };
  const DEFAULT_LAYOUT = { ullage: [0, 1], sounding: [1, 1] };

  /**
   * Which column holds which depth, and what it is written in. Returns
   * { ullage: [col, scale], sounding: [col, scale] } with the scale that
   * takes the book's unit to millimetres.
   */
  function readDepthLayout(row) {
    const found = {};
    for (let c = 0; c < Math.min((row || []).length, 12); c++) {
      const value = row[c];
      if (typeof value !== 'string') continue;
      const m = DEPTH_LABEL.exec(value);
      if (!m) continue;
      const which = m[1].toUpperCase() === 'ULLAGE' ? 'ullage' : 'sounding';
      if (found[which]) continue;
      const rest = value.toUpperCase().replace(m[1].toUpperCase(), '');
      const unit = UNIT.exec(rest);
      found[which] = [c, (unit && UNIT_TO_MM[unit[1].toUpperCase()]) || 1];
    }
    return found;
  }

  function numericRun(row, firstCol) {
    const nums = [];
    let start = null;
    for (let c = firstCol; c < Math.min(row.length, 20); c++) {
      const n = cleanNum(row[c]);
      if (n != null) {
        if (start == null) start = c;
        nums.push(n);
      } else if (start != null && nums.length) break;
    }
    return { nums, start };
  }

  /**
   * Where the trim/heel numbers are, and how the depth columns are laid out.
   * They are normally on the labels' own row; a JEWEL book puts them on the
   * row below, so the rows under the labels are tried before giving up.
   */
  function findHeaderRow(rows) {
    for (let index = 0; index < Math.min(rows.length, 40); index++) {
      const row = rows[index];
      if (!row) continue;
      const first = String(row[0] || '').trim().toUpperCase();
      if (!first.includes('ULLAGE') && !first.includes('SOUND') && !first.includes('DEPTH')) continue;
      const found = readDepthLayout(row);
      const layout = Object.keys(found).length ? found : DEFAULT_LAYOUT;

      for (let probe = index; probe < Math.min(index + 3, rows.length); probe++) {
        const candidate = rows[probe];
        if (!candidate) continue;
        const { nums, start } = numericRun(candidate, probe === index ? 1 : 0);
        if (nums.length >= 2 && start != null) return { index: probe, start, layout };
      }
    }
    return { index: null, start: null, layout: null };
  }

  function parseAxisHeaders(rows, headerIndex, valueStart) {
    const row = rows[headerIndex] || [];
    const vals = [];
    for (let c = valueStart; c < Math.min(row.length, valueStart + 24); c++) {
      const n = cleanNum(row[c]);
      if (n == null) {
        if (vals.length) break;
        continue;
      }
      vals.push(n);
    }
    return vals;
  }

  function blockRanges(rows) {
    const titles = [];
    rows.forEach((row, i) => {
      if (isTitleRow(row)) titles.push({ start: i, name: cleanTitle(row[0]) });
    });
    return titles.map((t, idx) => ({
      start: t.start,
      end: idx + 1 < titles.length ? titles[idx + 1].start : rows.length,
      name: t.name,
    }));
  }

  function parseBlock(rows, start, end, name, valueHeaders, valueStart, negateTrim, layout) {
    const axis = [];
    const ullageAxis = [];
    const soundingAxis = [];
    const grid = [];
    let pipeHint = null;
    let ullageHits = 0;
    let soundingHits = 0;

    /* A book that names its columns the other way round, or writes them in
       centimetres, is read by the layout findHeaderRow returned. */
    const cols = layout || DEFAULT_LAYOUT;
    const [ullageCol, ullageScale] = cols.ullage || [null, 1];
    const [soundedCol, soundedScale] = cols.sounding || [null, 1];
    const depthAt = (row, col, scale) => {
      if (col == null) return null;
      const n = cleanNum(row[col]);
      if (n == null || scale === 1) return n;
      return Math.round(n * scale * 1e6) / 1e6;
    };

    for (let r = start + 1; r < end; r++) {
      const row = rows[r];
      if (!row) continue;
      const ullage = depthAt(row, ullageCol, ullageScale);
      const sounded = depthAt(row, soundedCol, soundedScale);
      if (ullage != null) ullageHits += 1;
      if (sounded != null) soundingHits += 1;
      let axisVal;
      if (ullage != null) axisVal = ullage;
      else if (sounded != null) axisVal = sounded;
      else continue;

      const values = [];
      let valid = 0;
      for (let j = 0; j < valueHeaders.length; j++) {
        const number = cleanNum(row[valueStart + j]);
        if (number != null) valid += 1;
        values.push(number == null ? 0 : number);
      }
      if (!valid && ullage == null && sounded == null) continue;

      axis.push(axisVal);
      ullageAxis.push(ullage);
      soundingAxis.push(sounded);
      grid.push(values);

      if (pipeHint == null && sounded != null && ullage != null && sounded + ullage > 0) {
        pipeHint = sounded + ullage;
      } else if (pipeHint == null && sounded != null && (ullage === 0 || ullage == null)) {
        pipeHint = sounded;
      }
    }

    if (axis.length < 2) return null;

    let pipe = pipeHint;
    if (pipe == null) {
      for (let i = 0; i < ullageAxis.length; i++) {
        const u = ullageAxis[i];
        const s = soundingAxis[i];
        if (u != null && s != null && u + s > 0) { pipe = u + s; break; }
      }
    }
    if (pipe != null && pipe > 0) {
      for (let i = 0; i < axis.length; i++) {
        if (ullageAxis[i] == null && soundingAxis[i] != null) {
          ullageAxis[i] = Math.round((pipe - soundingAxis[i]) * 1e6) / 1e6;
        } else if (soundingAxis[i] == null && ullageAxis[i] != null) {
          soundingAxis[i] = Math.round((pipe - ullageAxis[i]) * 1e6) / 1e6;
        }
      }
    }

    let dual = 0;
    for (let i = 0; i < ullageAxis.length; i++) {
      if (ullageAxis[i] != null && soundingAxis[i] != null) dual += 1;
    }

    let headers = valueHeaders.slice();
    let outGrid = grid;
    if (negateTrim) {
      headers = headers.map((h) => -h);
      const order = headers.map((_, i) => i).sort((a, b) => headers[a] - headers[b]);
      headers = order.map((i) => headers[i]);
      outGrid = grid.map((row) => order.map((i) => row[i]));
    }

    const method = ullageHits >= soundingHits ? 'ullage' : 'sounding';
    const out = {
      name,
      axis,
      vals: headers,
      grid: outGrid,
      pipeHint: pipe != null ? pipe : pipeHint,
      increment: detectIncrement(axis),
      soundingMethod: method,
      dualDepth: dual >= 2,
    };
    if (out.dualDepth) {
      out.ullageAxis = ullageAxis.map((u, i) => (u != null ? u : axis[i]));
      out.soundingAxis = soundingAxis.map((s, i) => (s != null ? s : axis[i]));
    }
    return out;
  }

  function robustCapacity(trimVals, trimGrid) {
    if (!trimGrid.length) return 0;
    let col = trimVals.indexOf(0);
    if (col < 0) {
      let best = Infinity;
      trimVals.forEach((v, i) => {
        const a = Math.abs(v);
        if (a < best) { best = a; col = i; }
      });
    }
    let max = 0;
    for (const row of trimGrid) {
      const v = row[col];
      if (typeof v === 'number' && v > max) max = v;
    }
    return Math.round(max * 1e6) / 1e6;
  }

  function sideFromTitle(name) {
    const u = String(name || '').toUpperCase();
    if (/\(P\)|\bPORT\b/.test(u)) return 'port';
    if (/\(S\)|\bSTBD\b|\bSTARBOARD\b/.test(u)) return 'stbd';
    return 'center';
  }

  function tankNoFromTitle(name) {
    const m = String(name || '').match(/NO\.?\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function guessCategory(name) {
    const u = String(name || '').toUpperCase();
    if (/LUBE|Cyl|ME\s*LO|GE\s*LO|LO\b/.test(u)) return 'lube';
    if (/FW|F\.W|FRESH|POTABLE|DISTILL/.test(u)) return 'fresh';
    if (/SLOP|BILGE|WASTE|SEWAGE/.test(u)) return 'misc';
    return 'fuel';
  }

  function tankRole(name) {
    const u = String(name || '').toUpperCase();
    if (/SETTL|SERV|DAY/.test(u)) return 'settling';
    if (/OVERF|OVERFLOW/.test(u)) return 'overflow';
    return 'storage';
  }

  function fuelGrade(name) {
    const u = String(name || '').toUpperCase();
    if (/MGO|MDO|D\.?O|DIESEL|GAS\s*OIL/.test(u)) return 'mgo';
    if (/LSFO|LS\s*FO/.test(u)) return 'lsfo';
    return 'hfo';
  }

  function normKey(name) {
    return String(name || '').toUpperCase().replace(/TANK/g, 'TK').replace(/[^A-Z0-9]/g, '');
  }

  function mergeTank(name, trimBlock, heelBlock) {
    if (!trimBlock) return null;
    const trimVals = trimBlock.vals;
    const trimGrid = trimBlock.grid;
    const trimAxis = trimBlock.axis;
    let evenCol = trimVals.indexOf(0);
    if (evenCol < 0) {
      let best = Infinity;
      trimVals.forEach((v, i) => {
        const a = Math.abs(v);
        if (a < best) { best = a; evenCol = i; }
      });
    }
    const volumeCurve = {
      x: trimAxis.slice(),
      v: trimGrid.map((row) => row[evenCol]),
    };
    const listAxis = heelBlock ? heelBlock.axis : [];
    const listVals = heelBlock ? heelBlock.vals : [];
    const listGrid = heelBlock ? heelBlock.grid : [];
    const hasList = listGrid.some((row) => row.some((v) => Math.abs(v) > 1e-12));

    let pipe = trimBlock.pipeHint;
    if (pipe == null && heelBlock) pipe = heelBlock.pipeHint;

    let method = trimBlock.soundingMethod || 'ullage';
    if (heelBlock && heelBlock.soundingMethod === 'sounding' && method !== 'sounding') {
      if (listAxis.length >= trimAxis.length) method = 'sounding';
    }

    let ullageAxis = trimBlock.ullageAxis;
    let soundingAxis = trimBlock.soundingAxis;
    if (!ullageAxis && heelBlock) {
      ullageAxis = heelBlock.ullageAxis;
      soundingAxis = heelBlock.soundingAxis;
    }

    const tank = {
      name,
      category: guessCategory(name),
      fuelRole: tankRole(name),
      fuelGrade: fuelGrade(name),
      side: sideFromTitle(name),
      tankNo: tankNoFromTitle(name),
      calcType: 'correction',
      trimAxisSense: 'bow',
      capacity: robustCapacity(trimVals, trimGrid),
      pipeHeight: pipe != null ? pipe : 0,
      soundingMethod: method,
      correctionDivisor: 1,
      soundingIncrement: trimBlock.increment,
      heelIncrement: heelBlock && hasList ? heelBlock.increment : trimBlock.increment,
      trimAxis,
      trimVals,
      trimGrid,
      listAxis: hasList ? listAxis : [],
      listVals: hasList ? listVals : [],
      listGrid: hasList ? listGrid : [],
      volumeCurve,
      importFormat: 'flag-evi-xlsx',
      pdfSource: name,
    };
    if (ullageAxis && soundingAxis && ullageAxis.length >= 2 && soundingAxis.length >= 2) {
      tank.ullageAxis = ullageAxis.slice();
      tank.soundingAxis = soundingAxis.slice();
      tank.depthPairMode = 'dual';
    }
    if (hasList && heelBlock && heelBlock.ullageAxis && heelBlock.soundingAxis) {
      tank.listUllageAxis = heelBlock.ullageAxis.slice();
      tank.listSoundingAxis = heelBlock.soundingAxis.slice();
    }
    return tank;
  }

  function sheetToRows(sheet) {
    const ref = sheet['!ref'];
    if (!ref) return [];
    const range = global.XLSX.utils.decode_range(ref);
    const rows = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      for (let C = range.s.c; C <= Math.min(range.e.c, range.s.c + 30); C++) {
        const addr = global.XLSX.utils.encode_cell({ r: R, c: C });
        const cell = sheet[addr];
        row.push(cell ? (cell.v != null ? cell.v : null) : null);
      }
      rows.push(row);
    }
    return rows;
  }

  function extractFromWorkbook(wb) {
    if (!looksLikeFlagEvi(wb.SheetNames)) {
      throw new Error('Not a FLAG EVI dual-sheet workbook (need Trim Correction + Heeling Correction sheets)');
    }
    const trimBlocks = {};
    const heelBlocks = {};
    const sheetsMeta = [];
    const warnings = [];

    for (const sheetName of wb.SheetNames) {
      const kind = sheetKind(sheetName);
      if (!kind) continue;
      const rows = sheetToRows(wb.Sheets[sheetName]);
      const { index: headerIndex, start: valueStart, layout } = findHeaderRow(rows);
      if (headerIndex == null) {
        warnings.push(sheetName + ': no ullage/sounded header row with numeric columns');
        continue;
      }
      const headers = parseAxisHeaders(rows, headerIndex, valueStart);
      if (headers.length < 2) {
        warnings.push(sheetName + ': fewer than 2 trim/heel columns');
        continue;
      }
      let count = 0;
      for (const block of blockRanges(rows)) {
        // Keep printed +/−; calib UI / trimAxisSense handle sense.
        const parsed = parseBlock(
          rows, block.start, block.end, block.name, headers, valueStart, false, layout
        );
        if (!parsed) {
          warnings.push(sheetName + ': ' + block.name + ' — no usable rows');
          continue;
        }
        const key = normKey(block.name);
        const target = kind === 'trim' ? trimBlocks : heelBlocks;
        if (target[key]) warnings.push(sheetName + ': duplicate tank name ' + block.name);
        target[key] = parsed;
        count += 1;
      }
      sheetsMeta.push({ name: sheetName, kind, tankCount: count });
    }

    const tanks = [];
    const allKeys = [...new Set([...Object.keys(trimBlocks), ...Object.keys(heelBlocks)])];
    for (const key of allKeys) {
      const trimB = trimBlocks[key];
      const heelB = heelBlocks[key];
      const name = (trimB || heelB).name;
      if (!trimB) {
        warnings.push(name + ': heel table only — skipped (need trim volumes)');
        continue;
      }
      if (!heelB) warnings.push(name + ': no matching heel table — imported trim only');
      const tank = mergeTank(name, trimB, heelB);
      if (tank) tanks.push(tank);
    }
    if (!tanks.length) throw new Error('No tanks parsed from Trim / Heeling Correction sheets');
    return {
      format: 'flag-evi-xlsx',
      calcType: 'correction',
      trimAxisSense: 'bow',
      tankCount: tanks.length,
      sheets: sheetsMeta,
      warnings,
      tanks,
    };
  }

  async function parseFlagEviArrayBuffer(buf) {
    if (!global.XLSX) throw new Error('SheetJS (XLSX) is not loaded');
    const wb = global.XLSX.read(buf, { type: 'array', cellDates: false });
    return extractFromWorkbook(wb);
  }

  async function parseFlagEviFile(file) {
    const buf = await file.arrayBuffer();
    return parseFlagEviArrayBuffer(buf);
  }

  function looksLikeFlagEviName(name) {
    return /flag\s*evi|trim\s*correction|heeling\s*correction|fo\s*tanks?/i.test(String(name || ''));
  }

  global.FlagEviXlsxBrowser = {
    parseFlagEviFile,
    parseFlagEviArrayBuffer,
    looksLikeFlagEviName,
    looksLikeFlagEvi,
  };
})(typeof window !== 'undefined' ? window : globalThis);
