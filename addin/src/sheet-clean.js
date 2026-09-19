/**
 * The Office.js half of the tidy pass.
 *
 * public/js/sheet-tidy.js decides what a sheet should look like; this reads
 * the sheet, unmerges what is merged, writes the tidied grid back, and says
 * what it changed. Kept apart so the rules can be tested in node without an
 * Excel to run them in.
 */
/* global Excel, SheetTidy */
(function (global) {
  'use strict';

  var tidy = global.SheetTidy || (typeof require === 'function' ? require('../../public/js/sheet-tidy.js') : null);

  function colName(n) {
    var s = '';
    n += 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function a1(rows, cols) {
    return 'A1:' + colName(Math.max(cols, 1) - 1) + Math.max(rows, 1);
  }

  /**
   * Merged cells first: a merge spanning three columns is three columns the
   * parser cannot see. Unmerge, and where the merged value holds exactly as
   * many numbers as the merge was wide, give each column its own.
   */
  async function unmergeSheet(context, sheet) {
    var areas;
    try {
      areas = sheet.getUsedRange().getMergedAreasOrNullObject();
      areas.load('areaCount, areas/items/address, areas/items/values, areas/items/rowCount, areas/items/columnCount');
      await context.sync();
    } catch (e) {
      /* ExcelApi below 1.13 has no merged-area reader — unmerge blind. */
      sheet.getUsedRange().unmerge();
      await context.sync();
      return { unmerged: 0, distributed: 0 };
    }
    if (areas.isNullObject) return { unmerged: 0, distributed: 0 };

    var plan = [];
    (areas.areas.items || []).forEach(function (area) {
      var value = (area.values && area.values[0]) ? area.values[0][0] : '';
      if (area.columnCount > 1) {
        var spread = tidy.distributeMerged(value, area.columnCount);
        if (spread.length > 1 && spread.every(function (v) { return v !== ''; })) {
          plan.push({ address: area.address, values: [spread] });
        }
      }
    });

    sheet.getUsedRange().unmerge();
    await context.sync();

    plan.forEach(function (p) {
      var addr = p.address.indexOf('!') >= 0 ? p.address.split('!')[1] : p.address;
      sheet.getRange(addr).values = p.values;
    });
    await context.sync();
    return { unmerged: areas.areas.items.length, distributed: plan.length };
  }

  /**
   * Tidy one worksheet in place. Returns the report the task pane shows.
   */
  async function tidySheet(sheetName, opts) {
    var report = null;
    await Excel.run(async function (context) {
      var sheet = sheetName
        ? context.workbook.worksheets.getItem(sheetName)
        : context.workbook.worksheets.getActiveWorksheet();

      var merges = await unmergeSheet(context, sheet);

      var used = sheet.getUsedRange();
      used.load('values, rowCount, columnCount, address');
      await context.sync();

      var result = tidy.tidyGrid(used.values, opts || {});
      var rows = result.rows;
      var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
      rows = rows.map(function (r) {
        var out = r.slice();
        while (out.length < width) out.push('');
        return out;
      });

      /* The tidied grid can be shorter (blank rows) and wider (splits), so
         clear the old block before writing rather than leaving a tail. */
      sheet.getUsedRange().clear(Excel.ClearApplyTo.contents);
      if (rows.length) sheet.getRange(a1(rows.length, width)).values = rows;
      await context.sync();

      report = Object.assign({ sheet: sheetName || 'active' }, result.report, {
        mergedAreasUnmerged: merges.unmerged,
        mergedHeadersSpread: merges.distributed,
        headerRow: result.headerIndex >= 0 ? result.headerIndex + 1 : null,
        rows: rows.length,
        columns: width,
      });
    });
    return report;
  }

  /** Read a sheet without touching it — for the preview before tidying. */
  async function previewSheet(sheetName, opts) {
    var out = null;
    await Excel.run(async function (context) {
      var sheet = sheetName
        ? context.workbook.worksheets.getItem(sheetName)
        : context.workbook.worksheets.getActiveWorksheet();
      var used = sheet.getUsedRange();
      used.load('values, rowCount, columnCount');
      await context.sync();
      var result = tidy.tidyGrid(used.values, opts || {});
      out = {
        before: { rows: used.rowCount, columns: used.columnCount },
        after: { rows: result.rows.length, columns: (result.rows[0] || []).length },
        headerRow: result.headerIndex >= 0 ? result.headerIndex + 1 : null,
        report: result.report,
        sample: result.rows.slice(0, 12),
      };
    });
    return out;
  }

  async function listSheets() {
    var names = [];
    await Excel.run(async function (context) {
      var sheets = context.workbook.worksheets;
      sheets.load('items/name');
      await context.sync();
      names = sheets.items.map(function (s) { return s.name; });
    });
    return names;
  }

  var api = { tidySheet: tidySheet, previewSheet: previewSheet, listSheets: listSheets, colName: colName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.SheetClean = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
