/**
 * Squaring off a calibration book before it is parsed.
 *
 * These are the shapes the books actually arrive in: a trim header typed
 * across one merged cell, a heel pair written "-4-1", blocks of different
 * widths stacked down one sheet with air between them. The importer expects
 * one value per cell and rows that answer to their header, so this is what
 * has to come out the other side.
 */
'use strict';
const assert = require('assert');
const tidy = require('../public/js/sheet-tidy.js');

let pass = 0;
const is = (got, want, what) => { assert.deepStrictEqual(got, want, what); pass += 1; };

/* ---- A minus sign means two things, and the books use both ---- */
is(tidy.splitCell('2 1 0 -1 -2'), [2, 1, 0, -1, -2], 'a trim header typed into one cell');
is(tidy.splitCell('-4-1'), [-4, 1], 'a heel pair: leading minus signs, the second one delimits');
is(tidy.splitCell('12 -34'), [12, -34], 'a minus with air before it is a sign');
is(tidy.splitCell('1000-1050'), [1000, 1050], 'a sounding range delimits');
is(tidy.splitCell('463.476'), [463.476], 'one number stays one number');
is(tidy.splitCell('12,5'), [12.5], 'a decimal comma is a decimal point');
is(tidy.splitCell('TRIM 1.5 2,0'), ['TRIM', 1.5, 2], 'a label keeps its place ahead of its numbers');

/* A tank's name has digits in it and must survive untouched. */
is(tidy.splitCell('NO.1 H.F.O. TK (P)'), ['NO.1 H.F.O. TK (P)'], 'a tank name is not a crowded cell');
is(tidy.splitCell('HFO No.2 (S)'), ['HFO No.2 (S)'], 'digits pressed against letters are part of the name');
is(tidy.splitCell(''), [], 'an empty cell holds nothing');
is(tidy.splitCell(0), [0], 'a zero is a value, not an empty cell');

/* ---- Each block answers to its own header, not the sheet's widest ---- */
const sheet = [
  ['NO.1 H.F.O. TK (P)'],
  ['SOUNDING', '2 1 0 -1 -2'],
  [0, '0 0 0 0 0'],
  [50, '12.1 12.5 13 12.4 11.9'],
  [],
  [],
  ['NO.2 MDO TK (S)'],
  ['ULLAGE', '1 0 -1'],
  [0, '0 0 0'],
  [100, '5.5 5.4 5.3'],
];
const out = tidy.tidyGrid(sheet);

is(out.report.blocks, 2, 'two tanks on the sheet are two blocks');
is(out.report.blankRowsRemoved, 2, 'the air between blocks goes');
is(out.blocks[0].columns, 6, 'the first block is as wide as its own five-column header');
is(out.blocks[1].columns, 4, 'the second block keeps its three-column header, not the first block\'s');
is(out.blocks[0].title, 'NO.1 H.F.O. TK (P)', 'a block is named by the title above its header');
is(out.rows[1], ['SOUNDING', 2, 1, 0, -1, -2], 'the crowded header became one cell per column');
is(out.rows[3], [50, 12.1, 12.5, 13, 12.4, 11.9], 'its row lines up under it');
is(out.rows[5].slice(0, 4), ['ULLAGE', 1, 0, -1], 'the narrower block is not stretched to match the wider one');

/* A short row under a header is padded, never left ragged. */
const short = tidy.tidyGrid([['ULLAGE', '1 0 -1'], [0, '0 0 0'], [200, '9.9']]);
is(short.rows[2], [200, 9.9, '', ''], 'a row that stops early is padded to its header');
is(short.report.rowsAligned, 1, 'and counted, so the chief can go and look');

/* A row wider than its header is kept and flagged rather than trimmed. */
const wide = tidy.tidyGrid([['ULLAGE', '1 0'], [0, '0 0 0']]);
is(wide.report.raggedRows, 1, 'a row overrunning its header is reported, not silently cut');
is(wide.rows[1].length >= 4, true, 'and its values are still there');

/* ---- A merged header spread back across the columns it covered ---- */
is(tidy.distributeMerged('2 1 0 -1 -2', 5), [2, 1, 0, -1, -2], 'a merge as wide as its numbers hands one to each column');
is(tidy.distributeMerged('SOUNDING', 3), ['SOUNDING', '', ''], 'anything else stays on the anchor');

console.log(`sheet-tidy: ${pass} checks passed`);
