/**
 * FLAG EVI dual-sheet XLSX → direct volume trim/heel tanks.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnPython } = require('../server/python-run');

const sample = process.env.FLAG_EVI_SAMPLE
  || path.join(os.tmpdir(), 'FLAG_EVI_FO_TANKS.xlsx');

async function main() {
  if (!fs.existsSync(sample)) {
    console.log('skip — sample workbook missing (' + sample + '). Set FLAG_EVI_SAMPLE to run.');
    return;
  }
  const script = path.join(__dirname, 'import-flag-evi-xlsx.py');
  const { code, out, err } = await spawnPython([script, sample], {
    maxBuffer: 128 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error('bad JSON: ' + e.message + '\n' + (err || out || '').slice(0, 400));
  }
  assert.strictEqual(code, 0, parsed.error || err || 'parser failed');
  assert.strictEqual(parsed.format, 'flag-evi-xlsx');
  assert.ok(parsed.tankCount >= 17, 'expected 17 tanks, got ' + parsed.tankCount);
  const first = parsed.tanks[0];
  assert.strictEqual(first.calcType, 'direct');
  assert.ok(first.trimAxis.length > 10);
  assert.ok(first.listAxis.length > 10);
  assert.strictEqual(first.trimAxisSense, 'bow');
  // Printed FLAG EVI trim headers kept as-is (no import-time negate).
  assert.ok(Array.isArray(first.trimVals) && first.trimVals.length >= 4);
  assert.ok(Math.abs(first.capacity - 463.476) < 0.01);
  console.log('ok — FLAG EVI import parsed', parsed.tankCount, 'tanks');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
