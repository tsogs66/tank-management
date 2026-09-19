/**
 * Books that say the same things a different way.
 *
 * FLAG EVI writes its header as one row — the depth labels and the trim
 * numbers together — with ullage first and everything in millimetres. A
 * JEWEL book splits that header over two rows, puts sounding first, and
 * writes its depths in centimetres.
 *
 * Only the split header shows up as an error ("No tanks parsed"). The other
 * two would import without complaint and be wrong on the sounding board, so
 * what is checked here is not that a JEWEL book imports, but that it imports
 * with its depths the right way round and in the right unit.
 *
 * The sample is built here rather than shipped: the fault is in the layout,
 * and a layout is small enough to write down.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnPython } = require('../server/python-run');

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.log('skip — xlsx not installed');
  process.exit(0);
}

/* A tank 6.51 m deep: sounding 0 cm is ullage 651 cm, and they add up to the
   pipe height on every row. Depths in centimetres, volumes in m³. */
const ROWS = [
  [0, 651, 11.2, 10.3, 9.5],
  [10, 641, 14.6, 13.6, 12.7],
  [20, 631, 18.5, 17.4, 16.3],
  [650, 1, 995.1, 995.2, 994.9],
];

function jewelSheet(kind) {
  const axis = kind === 'trim' ? [-1, 0, 1] : [-2, 0, 2];
  const aoa = [
    ['NO.1 H.F.O. TANK (P)'],
    [],
    ['SOUNDING cm', 'ULLAGE  cm', kind === 'trim' ? 'TRIM m3' : 'HEEL m3'],
    [null, null, ...axis],
    ...ROWS,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

function jewelWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, jewelSheet('trim'), 'Trim Correction');
  XLSX.utils.book_append_sheet(wb, jewelSheet('heel'), 'Heeling Correction');
  return wb;
}

function checkTank(tank, where) {
  assert.ok(tank, `${where}: no tank parsed from a JEWEL-layout book`);

  // Centimetres on the page, millimetres in the app.
  assert.strictEqual(tank.pipeHeight, 6510,
    `${where}: pipe height should be 6510 mm (651 cm), got ${tank.pipeHeight}`);
  assert.strictEqual(tank.soundingIncrement, 100,
    `${where}: rows are 10 cm apart, so 100 mm, got ${tank.soundingIncrement}`);

  // The column the book calls ULLAGE has to arrive as ullage. Swapped, the
  // first row would read 0 here instead of the full 6510.
  const ullage = tank.ullageAxis || [];
  const sounding = tank.soundingAxis || [];
  assert.ok(ullage.length >= 4 && sounding.length >= 4,
    `${where}: both depth axes should survive (got ${ullage.length}/${sounding.length})`);
  assert.strictEqual(ullage[0], 6510,
    `${where}: sounding 0 is ullage 6510 mm — depth columns are the wrong way round (got ${ullage[0]})`);
  assert.strictEqual(sounding[0], 0,
    `${where}: the first row is sounding 0, got ${sounding[0]}`);
  assert.strictEqual(ullage[3], 10, `${where}: last row ullage 1 cm = 10 mm, got ${ullage[3]}`);
  assert.strictEqual(sounding[3], 6500, `${where}: last row sounding 650 cm = 6500 mm, got ${sounding[3]}`);

  assert.ok(Math.abs(tank.capacity - 995.2) < 0.01,
    `${where}: capacity should be 995.2 m³, got ${tank.capacity}`);
}

async function viaPython(file) {
  const script = path.join(__dirname, 'import-flag-evi-xlsx.py');
  const { out, err } = await spawnPython([script, file], { maxBuffer: 32 * 1024 * 1024 });
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    console.log('skip python — ' + (err || out || e.message).slice(0, 120).trim());
    return null;
  }
  if (parsed.error && /openpyxl/i.test(parsed.error)) {
    console.log('skip python — openpyxl not installed');
    return null;
  }
  assert.ok(!parsed.error, 'python importer: ' + parsed.error);
  return parsed.tanks[0];
}

function viaBrowser(buffer) {
  global.XLSX = XLSX;
  require('../public/js/flag-evi-xlsx-browser.js');
  const view = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return global.FlagEviXlsxBrowser.parseFlagEviArrayBuffer(view);
}

async function main() {
  const file = path.join(os.tmpdir(), `jewel-layout-${process.pid}.xlsx`);
  XLSX.writeFile(jewelWorkbook(), file);
  try {
    const buffer = fs.readFileSync(file);

    /* The phone and the desktop read the same book with different code. */
    const browser = await viaBrowser(buffer);
    assert.strictEqual(browser.format, 'flag-evi-xlsx');
    checkTank(browser.tanks[0], 'browser parser');

    const python = await viaPython(file);
    if (python) {
      checkTank(python, 'python importer');
      assert.strictEqual(python.pipeHeight, browser.tanks[0].pipeHeight,
        'the two parsers disagree on pipe height');
      assert.strictEqual(python.capacity, browser.tanks[0].capacity,
        'the two parsers disagree on capacity');
    }
    console.log('ok — split header, swapped depth columns and centimetres');
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
