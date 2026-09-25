/**
 * Sheet tidying — the pass that runs before a calibration book is parsed.
 *
 * Calibration books arrive typed by hand. A trim header meant to be five
 * columns is one merged cell reading "2 1 0 -1 -2"; a heel pair is written
 * "-4-1" in a single cell; whole rows are blank because the typist wanted
 * air between blocks. scripts/import-excel-tanks.py expects one value per
 * cell and an unbroken run of rows under the header, so this puts the sheet
 * into that shape first.
 *
 * Pure functions, no Office/SheetJS: the Excel add-in feeds it range values,
 * the browser importer feeds it SheetJS rows, node tests feed it literals.
 *
 * The minus sign carries two meanings in these books, so the rule is fixed
 * here: a '-' sitting directly against the digit before it separates two
 * numbers ("12-34" is 12 and 34, the way a heel pair is typed), anywhere
 * else it is a sign ("12 -34" is 12 and -34, "-4" is -4).
 */
(function (global) {
  'use strict';

  var NUMBER = /-?\d+(?:[.,]\d+)?/;

  function isBlank(v) {
    return v == null || (typeof v === 'string' && v.trim() === '');
  }

  function textOf(v) {
    if (v == null) return '';
    return String(v).replace(/−/g, '-').replace(/\s+/g, ' ').trim();
  }

  function toNum(s) {
    var n = Number(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Every number in a cell, plus any leading label, in the order written.
   * A cell holding one value comes back as one token, so it is safe to run
   * over a whole sheet.
   */
  function splitCell(value) {
    if (value == null || value === '') return [];
    if (typeof value === 'number') return [value];
    if (typeof value === 'boolean') return [value];
    var s = textOf(value);
    if (!s) return [];

    /* Numbers only count when they stand on their own. "NO.1 H.F.O. TK (P)"
       is a tank's name, not a cell someone crowded, so it passes through. */
    var tokens = [];
    var label = '';
    var re = new RegExp(NUMBER.source, 'g');
    var m;
    var last = 0;
    while ((m = re.exec(s)) !== null) {
      var at = m.index;
      var before = at > 0 ? s[at - 1] : '';
      var after = s[at + m[0].length] || '';
      var delimited = m[0][0] === '-' && /\d/.test(before);
      var standalone = (before === '' || delimited || /[\s,;:/|(\[+-]/.test(before))
        && (after === '' || /[\s,;:/|)\]+-]/.test(after));
      if (!standalone) return [s];
      var raw = m[0];
      /* A '-' pressed against the previous digit delimits, it does not sign. */
      if (raw[0] === '-' && at > 0 && /\d/.test(s[at - 1])) raw = raw.slice(1);
      var n = toNum(raw);
      if (n == null) return [s];
      label += s.slice(last, at);
      tokens.push(n);
      last = at + m[0].length;
    }
    label += s.slice(last);

    if (tokens.length < 2) return [tokens.length === 1 && !label.replace(/[\s,;:/|.+-]/g, '') ? tokens[0] : s];
    label = label.replace(/[\s,;:/|+]+/g, ' ').replace(/(^[-\s]+|[-\s]+$)/g, '').trim();
    if (label && /[A-Za-z]/.test(label)) tokens.unshift(label);
    return tokens;
  }

  function rowIsBlank(row) {
    if (!row) return true;
    for (var i = 0; i < row.length; i++) if (!isBlank(row[i])) return false;
    return true;
  }

  function dropBlankRows(rows) {
    var out = [];
    var removed = [];
    (rows || []).forEach(function (row, i) {
      if (rowIsBlank(row)) removed.push(i);
      else out.push(row.slice());
    });
    return { rows: out, removed: removed };
  }

  /**
   * Column widths for one block: a source column becomes as many columns as
   * the widest cell in it needs, so a split pushes its neighbours right
   * rather than writing over them.
   */
  function columnWidths(rows) {
    var widths = [];
    rows.forEach(function (row) {
      (row || []).forEach(function (cell, c) {
        var n = splitCell(cell).length;
        if (n > (widths[c] || 1)) widths[c] = n;
      });
    });
    for (var c = 0; c < widths.length; c++) if (!widths[c]) widths[c] = 1;
    return widths;
  }

  function expandRow(row, widths) {
    var out = [];
    for (var c = 0; c < widths.length; c++) {
      var tokens = splitCell(row ? row[c] : null);
      for (var k = 0; k < widths[c]; k++) out.push(tokens[k] != null ? tokens[k] : '');
    }
    return out;
  }

  function trailingEmptyTrimmed(row) {
    var out = row.slice();
    while (out.length && isBlank(out[out.length - 1])) out.pop();
    return out;
  }

  function looksLikeHeader(row) {
    if (!row) return false;
    var filled = 0;
    var texty = 0;
    for (var c = 0; c < row.length; c++) {
      if (isBlank(row[c])) continue;
      filled++;
      if (splitCell(row[c]).some(function (v) { return typeof v === 'string'; })) texty++;
    }
    return filled >= 2 && texty >= 1;
  }

  function findHeaderRow(rows, limit) {
    var max = Math.min((rows || []).length, limit || 40);
    for (var r = 0; r < max; r++) if (looksLikeHeader(rows[r])) return r;
    return (rows || []).length ? 0 : -1;
  }

  /**
   * A sheet is not one table. A Tank1 sheet carries a tank per block: a
   * title, a header, its rows, then the next tank. Each block answers to its
   * own header, so they are found before anything is widened — a five-column
   * trim header must not stretch the four-column block under it.
   *
   * A block ends at a blank row, or where a new header row starts once the
   * current block has data of its own.
   */
  function splitBlocks(rows) {
    var blocks = [];
    var cur = null;
    var blanks = 0;

    function close() {
      if (cur && cur.rows.length) blocks.push(cur);
      cur = null;
    }

    (rows || []).forEach(function (row, i) {
      if (rowIsBlank(row)) { blanks++; close(); return; }
      var header = looksLikeHeader(row);
      if (cur && header && cur.dataRows > 0) close();
      if (!cur) cur = { start: i, rows: [], headerIndex: -1, dataRows: 0 };
      if (header && cur.headerIndex < 0) cur.headerIndex = cur.rows.length;
      else if (cur.headerIndex >= 0) cur.dataRows++;
      cur.rows.push(row.slice());
    });
    close();
    return { blocks: blocks, blankRowsRemoved: blanks };
  }

  /**
   * One block, squared off to its own header: cells split into the columns
   * beside them, then every row given the header's column count — short rows
   * padded, and anything past the header's width kept and reported rather
   * than dropped, because a book that overruns its header is a book someone
   * needs to look at.
   */
  function tidyBlock(block) {
    var widths = columnWidths(block.rows);
    var cellsSplit = 0;
    block.rows.forEach(function (row) {
      (row || []).forEach(function (cell) {
        if (splitCell(cell).length > 1) cellsSplit++;
      });
    });

    var out = block.rows.map(function (row) { return expandRow(row, widths); });
    var headerIndex = block.headerIndex;
    var columns = headerIndex >= 0
      ? trailingEmptyTrimmed(out[headerIndex]).length
      : out.reduce(function (w, r) { return Math.max(w, trailingEmptyTrimmed(r).length); }, 0);

    var rowsAligned = 0;
    var ragged = 0;
    out = out.map(function (row, i) {
      var trimmed = trailingEmptyTrimmed(row);
      if (trimmed.length === columns) return trimmed;
      if (trimmed.length < columns) {
        if (i !== headerIndex && trimmed.length) rowsAligned++;
        while (trimmed.length < columns) trimmed.push('');
        return trimmed;
      }
      /* Wider than its header — keep the overflow, flag the block. */
      ragged++;
      return trimmed;
    });

    var width = out.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
    out = out.map(function (row) {
      var r = row.slice();
      while (r.length < width) r.push('');
      return r;
    });

    /* The title a block was found under, when it sits above the header. */
    var title = '';
    if (headerIndex > 0) {
      for (var r = headerIndex - 1; r >= 0; r--) {
        var first = out[r] && out[r].find(function (v) { return !isBlank(v); });
        if (typeof first === 'string' && first.trim()) { title = first.trim(); break; }
      }
    }

    return {
      rows: out,
      title: title,
      headerIndex: headerIndex,
      columns: columns,
      cellsSplit: cellsSplit,
      rowsAligned: rowsAligned,
      ragged: ragged,
      columnsAdded: widths.reduce(function (a, w) { return a + (w - 1); }, 0),
    };
  }

  /**
   * Put a sheet into one-value-per-cell shape.
   *
   *   - blank rows dropped
   *   - merged headers already spread by the caller
   *   - cells holding several numbers split into the cells beside them
   *   - every block squared off to its own header's column count
   *
   * Returns the new grid, a line per block, and the totals the task pane
   * shows before it writes anything back.
   */
  function tidyGrid(rows, opts) {
    opts = opts || {};
    var split = splitBlocks(rows);
    var tidied = split.blocks.map(tidyBlock);

    var out = [];
    var blocks = [];
    tidied.forEach(function (b, i) {
      if (i && opts.blockSpacer) out.push([]);
      blocks.push({
        title: b.title,
        firstRow: out.length + 1,
        headerRow: b.headerIndex >= 0 ? out.length + b.headerIndex + 1 : null,
        rows: b.rows.length,
        columns: b.columns,
        cellsSplit: b.cellsSplit,
        rowsAligned: b.rowsAligned,
        ragged: b.ragged,
      });
      b.rows.forEach(function (r) { out.push(r); });
    });

    var width = out.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
    out = out.map(function (row) {
      var r = row.slice();
      while (r.length < width) r.push('');
      return r;
    });

    var sum = function (key) {
      return blocks.reduce(function (a, b) { return a + (b[key] || 0); }, 0);
    };
    return {
      rows: out,
      blocks: blocks,
      headerIndex: blocks.length && blocks[0].headerRow ? blocks[0].headerRow - 1 : -1,
      report: {
        blankRowsRemoved: split.blankRowsRemoved,
        blocks: blocks.length,
        cellsSplit: sum('cellsSplit'),
        columnsAdded: tidied.reduce(function (a, b) { return a + b.columnsAdded; }, 0),
        rowsAligned: sum('rowsAligned'),
        raggedRows: sum('ragged'),
      },
    };
  }

  /**
   * A merged cell spanning N columns whose value holds N numbers was one
   * header row typed across the merge — hand each column its own number.
   * Anything else stays on the anchor and is split by tidyGrid like any
   * other crowded cell.
   */
  function distributeMerged(value, span) {
    var tokens = splitCell(value);
    if (span > 1 && tokens.length === span) return tokens;
    var out = new Array(span).fill('');
    out[0] = value == null ? '' : value;
    return out;
  }

  var api = {
    splitCell: splitCell,
    tidyGrid: tidyGrid,
    splitBlocks: splitBlocks,
    looksLikeHeader: looksLikeHeader,
    dropBlankRows: dropBlankRows,
    findHeaderRow: findHeaderRow,
    columnWidths: columnWidths,
    distributeMerged: distributeMerged,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  global.SheetTidy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
