/**
 * Push to peer must build its body without a Node Buffer.
 *
 * The on-device server (ChEng AIO shell and standalone Tank Chief) has no
 * Buffer global. The old push did Buffer.from(...) and the screen reported
 * "Buffer is not defined", so the bunker reports never left the ship.
 * The bytes and the fallback digest have to match what a Node peer checks.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-sync-bytes-'));
process.env.TMS_DATA_DIR = dataDir;
process.env.CHENG_PRO_DATA_DIR = dataDir;

const { syncUtf8Bytes, sha256HexPure } = require('../server/index.js');

let pass = 0;
const is = (got, want, what) => {
  assert.strictEqual(got, want, what);
  pass += 1;
};

function nodeHex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

for (const text of ['', 'bunker', 'café — bunker plan', 'A'.repeat(1000), JSON.stringify({ bunkerHistory: { plans: [{ id: 'p1' }] } })]) {
  const bytes = syncUtf8Bytes(text);
  assert.ok(bytes instanceof Uint8Array, 'sync body is bytes');
  assert.strictEqual(Buffer.isBuffer(bytes), false, 'sync body is not a Node Buffer');
  is(bytes.length, Buffer.from(text, 'utf8').length, 'byte length matches Node for ' + JSON.stringify(text).slice(0, 24));
  is(Buffer.compare(Buffer.from(bytes), Buffer.from(text, 'utf8')), 0, 'bytes match Node utf8');
  is(sha256HexPure(bytes), nodeHex(text), 'fallback sha256 matches Node');
  is(sha256HexPure(text), nodeHex(text), 'fallback sha256 accepts a string');
}

const slice = syncUtf8Bytes('abcdef').subarray(2, 5);
is(new TextDecoder().decode(slice), 'cde', 'a chunk slice is the bytes in the middle');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const pushAt = src.indexOf("app.post('/api/sync/push'");
assert.ok(pushAt > 0, 'push route exists');
const pushSrc = src.slice(pushAt, pushAt + 2500);
assert.ok(!pushSrc.includes('Buffer.from'), 'push to peer does not call Buffer.from');
assert.ok(pushSrc.includes('syncUtf8Bytes'), 'push to peer encodes with syncUtf8Bytes');
pass += 2;

console.log('sync bytes ok (' + pass + ')');
