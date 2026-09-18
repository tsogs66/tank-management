/**
 * asarUnpack leaves Python scripts in app.asar.unpacked, but __dirname still
 * points inside app.asar — spawn must rewrite paths for child processes.
 *
 * Run: node scripts/test-python-asar-path.js  (from tank-management or AIO module)
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const pythonRun = require('../server/python-run');

const { resolveChildProcessPath, rewriteSpawnArgs } = pythonRun;

assert.strictEqual(typeof resolveChildProcessPath, 'function');
assert.strictEqual(typeof rewriteSpawnArgs, 'function');

const fakeRoot = path.join(os.tmpdir(), `cheng-asar-test-${process.pid}`);
const fakeAsar = path.join(fakeRoot, 'resources', 'app.asar', 'modules', 'tanks', 'scripts');
const fakeUnpacked = path.join(fakeRoot, 'resources', 'app.asar.unpacked', 'modules', 'tanks', 'scripts');
fs.mkdirSync(fakeAsar, { recursive: true });
fs.mkdirSync(fakeUnpacked, { recursive: true });
const asarScript = path.join(fakeAsar, 'import-flag-evi-xlsx.py');
const unpackedScript = path.join(fakeUnpacked, 'import-flag-evi-xlsx.py');
fs.writeFileSync(unpackedScript, '# unpacked\n');
/* Do not create the asar twin — only unpacked exists, as in a real build. */

const resolved = resolveChildProcessPath(asarScript);
assert.strictEqual(
  resolved,
  unpackedScript,
  'asar script path must resolve to app.asar.unpacked twin'
);

const rewritten = rewriteSpawnArgs([asarScript, '/tmp/workbook.xlsx']);
assert.strictEqual(rewritten[0], unpackedScript);
assert.strictEqual(rewritten[1], '/tmp/workbook.xlsx');

/* Plain paths stay unchanged. */
assert.strictEqual(resolveChildProcessPath('/opt/cheng/scripts/x.py'), '/opt/cheng/scripts/x.py');

console.log('ok — asar Python script paths resolve to unpacked files');
