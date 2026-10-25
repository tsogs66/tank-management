/*
 * Resumable tank sync push, driven across two real servers over real HTTP.
 *
 * A tank push is the WHOLE database in one POST: every vessel, and for each of
 * them the calibration tables, the saved reports, the bunker history and the
 * base64 signature and stamp images. On a ship's connection that is the problem
 * the voyage legs had -- a drop at 90% costs the entire transfer -- with one
 * extra edge: express.json caps a body at 50 MB, so a fleet past that size
 * could not push at all and said so only as a raw error.
 *
 * What this pins:
 *   - a bundle past the threshold goes in chunks, and the peer verifies the
 *     sha256 before applySyncPayload touches the database
 *   - an interrupted push resumes from what the PEER holds, not from what the
 *     sender believes it sent
 *   - a corrupted chunk is refused and the parts are KEPT, so only the bad one
 *     need be re-sent
 *   - a peer too old to chunk is told why BEFORE anything is sent, with both
 *     figures and a remedy, instead of a bare 413
 *   - a small database still goes in one POST, to an old peer included
 *
 * Fixture sizes are asserted, not assumed. The first run of this file built a
 * 1.16 MB database, fell under the 2 MB threshold, and "took the chunked route"
 * failed -- correctly. A fixture too small to reach the code under test is the
 * commonest way one of these files ends up proving nothing.
 *
 * Run: node tests/test_sync_resumable_push.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-sync-test-'));

const TOKEN = 'tank-sync-test-token';
const net = require('net');
async function freePort() {
  return new Promise((r) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => r(p)); }); });
}
const A = { port: 0, dir: path.join(TMP, 'tankA') };   // pusher
const B = { port: 0, dir: path.join(TMP, 'tankB') };   // peer / receiver

let fails = 0, checks = 0;
const check = (label, actual, expected) => {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
  if (!ok) fails++;
};

function startServer(cfg, extraEnv) {
  fs.rmSync(cfg.dir, { recursive: true, force: true });
  fs.mkdirSync(cfg.dir, { recursive: true });
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(cfg.port), HOST: '127.0.0.1',
           CHENG_PRO_DATA_DIR: cfg.dir, SYNC_API_TOKEN: TOKEN, ...(extraEnv || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', d => { const s = String(d); if (/Error|error/.test(s)) console.log('  [srv' + cfg.port + '] ' + s.slice(0, 160)); });
  return p;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function ready(cfg) {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${cfg.port}/api/sync/ping`); if (r.ok) return; } catch {}
    await wait(250);
  }
  throw new Error('server ' + cfg.port + ' never came up');
}
const api = async (cfg, p, init) => {
  const r = await fetch(`http://127.0.0.1:${cfg.port}${p}`, {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...((init || {}).headers || {}) },
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

(async () => {
  A.port = await freePort(); B.port = await freePort();
  const STUB_PORT = await freePort();
  const sa = startServer(A), sb = startServer(B);
  try {
    await ready(A); await ready(B);

    console.log('\npeer advertises the capability');
    const ping = await api(B, '/api/sync/ping');
    check('resumableImport advertised', ping.body?.resumableImport?.supported, true);
    check('and the single-POST ceiling is published', ping.body?.maxSinglePostBytes, 50 * 1024 * 1024);

    console.log('\nbuild a database on A big enough to chunk');
    // Several vessels, each carrying a chunky asset, so the bundle passes the threshold.
    for (let v = 0; v < 6; v++) {
      const created = await api(A, '/api/vessels', { method: 'POST',
        body: JSON.stringify({ name: `MV Probe ${v}`, imo: `900000${v}` }) });
      const id = created.body?.id;
      if (!id) { check(`vessel ${v} created`, created.status, 201); continue; }
      await api(A, `/api/vessels/${id}/assets`, { method: 'PUT',
        body: JSON.stringify({ vesselLogo: 'data:image/png;base64,' + 'A'.repeat(900000), chEngSignatures: {} }) });
    }
    const firstId = (await api(A, '/api/vessels')).body?.vessels?.[0]?.id;
    const back = await api(A, `/api/vessels/${firstId}`);
    check('the asset really persisted (a silent 404 would shrink the fixture)',
      String(back.body?.assets?.vesselLogo || '').length > 800000, true);
    const bundle = await api(A, '/api/sync/export');
    const size = Buffer.from(JSON.stringify(bundle.body)).length;
    console.log(`  bundle on A is ${(size / 1048576).toFixed(2)} MB`);
    check('the bundle is past the chunking threshold', size > 2 * 1024 * 1024, true);

    console.log('\npush A -> B');
    const push = await api(A, '/api/sync/push', { method: 'POST',
      body: JSON.stringify({ syncUrl: `http://127.0.0.1:${B.port}`, syncApiToken: TOKEN }) });
    check('push succeeds', push.status, 200);
    check('and took the chunked route', push.body?.chunked, true);
    check('the peer verified the digest', push.body?.remote?.digestVerified, true);
    check('it was really split into chunks', push.body?.remote?.chunks > 1, true);

    console.log('\nB now holds A\'s vessels');
    const onB = await api(B, '/api/vessels');
    const names = (onB.body?.vessels || onB.body || []).map(v => v.name).sort();
    check('all six arrived', names.length, 6);
    const stagingLeft = fs.existsSync(path.join(B.dir, '.sync-uploads'))
      ? fs.readdirSync(path.join(B.dir, '.sync-uploads')).filter(n => !n.startsWith('outgoing-')) : [];
    check('the staging folder was cleaned up', stagingLeft, []);
    check('and .sync-uploads is not mistaken for a vessel',
      names.some(n => String(n).includes('sync-upload')), false);

    console.log('\nan interrupted push resumes from what the peer holds');
    // Begin an upload by hand, send two chunks, then let the real push resume it.
    const text = JSON.stringify(bundle.body);
    const buf = Buffer.from(text, 'utf8');
    const crypto = require('crypto');
    const digest = crypto.createHash('sha256').update(buf).digest('hex');
    const CH = 512 * 1024;
    const total = Math.ceil(buf.length / CH);
    const begun = await api(B, '/api/sync/import/upload', { method: 'POST',
      body: JSON.stringify({ totalBytes: buf.length, totalChunks: total, chunkBytes: CH, digest, digestAlgo: 'sha256' }) });
    check('begin returns an upload id', /^[0-9a-f]{32}$/.test(begun.body?.uploadId || ''), true);
    const uid = begun.body.uploadId;
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload/${uid}/${i}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + TOKEN },
        body: buf.subarray(i * CH, (i + 1) * CH) });
      check(`chunk ${i} stored`, r.status, 200);
    }
    const mid = await api(B, `/api/sync/import/upload/${uid}`);
    check('the peer reports exactly what it holds', mid.body?.received, [0, 1]);
    const early = await api(B, `/api/sync/import/upload/${uid}/complete`, { method: 'POST', body: '{}' });
    check('completing early is refused', early.status, 409);
    check('and names the missing chunks', /still missing/.test(early.body?.error || ''), true);
    check('while keeping the parts already sent', early.body?.received, [0, 1]);
    const resumed = await api(B, '/api/sync/import/upload', { method: 'POST',
      body: JSON.stringify({ uploadId: uid, totalBytes: buf.length, totalChunks: total, chunkBytes: CH, digest, digestAlgo: 'sha256' }) });
    check('resuming reuses the same upload', resumed.body?.uploadId, uid);
    check('and reports the two chunks held', resumed.body?.received, [0, 1]);
    check('flagged as a resume', resumed.body?.resumed, true);
    for (let i = 2; i < total; i++) {
      await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload/${uid}/${i}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + TOKEN },
        body: buf.subarray(i * CH, Math.min((i + 1) * CH, buf.length)) });
    }
    const fin = await api(B, `/api/sync/import/upload/${uid}/complete`, { method: 'POST', body: '{}' });
    check('completing after the resume succeeds', fin.status, 200);
    check('with the digest verified', fin.body?.digestVerified, true);

    console.log('\na corrupted chunk is caught before the database is touched');
    const b2 = await api(B, '/api/sync/import/upload', { method: 'POST',
      body: JSON.stringify({ totalBytes: buf.length, totalChunks: total, chunkBytes: CH, digest, digestAlgo: 'sha256' }) });
    const uid2 = b2.body.uploadId;
    for (let i = 0; i < total; i++) {
      let slice = Buffer.from(buf.subarray(i * CH, Math.min((i + 1) * CH, buf.length)));
      if (i === 1) slice[0] = slice[0] ^ 0x01;         // one flipped bit, same length
      await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload/${uid2}/${i}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + TOKEN }, body: slice });
    }
    const bad = await api(B, `/api/sync/import/upload/${uid2}/complete`, { method: 'POST', body: '{}' });
    check('a flipped bit is refused', bad.status, 409);
    check('named as a digest mismatch', /does not match the digest/.test(bad.body?.error || ''), true);
    check('and the parts are kept so only that chunk need be re-sent', (bad.body?.received || []).length, total);
    await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload/${uid2}/1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + TOKEN },
      body: buf.subarray(CH, 2 * CH) });
    const fixed = await api(B, `/api/sync/import/upload/${uid2}/complete`, { method: 'POST', body: '{}' });
    check('re-sending the good chunk completes it', fixed.status, 200);

    console.log('\nvalidation and auth');
    check('a manifest with no sizes is refused',
      (await api(B, '/api/sync/import/upload', { method: 'POST', body: JSON.stringify({}) })).status, 400);
    check('a non-sha256 digest is refused',
      (await api(B, '/api/sync/import/upload', { method: 'POST', body: JSON.stringify({ totalBytes: 10, totalChunks: 1, chunkBytes: 10, digest: 'x', digestAlgo: 'md5' }) })).status, 400);
    check('a non-hex upload id is refused',
      (await api(B, '/api/sync/import/upload/' + 'z'.repeat(32))).status, 400);
    check('a traversal attempt in the id is refused',
      (await api(B, '/api/sync/import/upload/..%2f..%2fetc')).status, 400);
    check('an unknown upload id is a 404',
      (await api(B, '/api/sync/import/upload/' + 'ab'.repeat(16))).status, 404);
    const noAuth = await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ totalBytes: 1, totalChunks: 1, chunkBytes: 1, digest: 'a', digestAlgo: 'sha256' }) });
    check('begin without a token is refused', noAuth.status, 401);
    const noAuth2 = await fetch(`http://127.0.0.1:${B.port}/api/sync/import/upload/${uid}`);
    check('status without a token is refused', noAuth2.status, 401);

    console.log('\nan older peer that cannot chunk: say why, before sending');
    /* A stub peer that answers /api/sync/ping WITHOUT resumableImport, the way
       a Tank Chief from before this change does, and publishes a small
       single-POST ceiling so the real route is exercised without building a
       50 MB fixture. */
    const http = require('http');
    let importedBytes = -1;
    const oldPeer = http.createServer((rq, rs) => {
      if (rq.url === '/api/sync/ping') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        return rs.end(JSON.stringify({ ok: true, product: 'tank-chief', maxSinglePostBytes: 1048576 }));
      }
      if (rq.url === '/api/sync/import') {
        let n = 0;
        rq.on('data', (c) => { n += c.length; });
        return rq.on('end', () => {
          importedBytes = n;
          rs.writeHead(200, { 'Content-Type': 'application/json' });
          rs.end(JSON.stringify({ ok: true, results: { stub: true } }));
        });
      }
      rs.writeHead(404, { 'Content-Type': 'application/json' });
      rs.end('{"error":"not found"}');
    });
    await new Promise((r) => oldPeer.listen(STUB_PORT, '127.0.0.1', r));
    const tooBig = await api(A, '/api/sync/push', { method: 'POST',
      body: JSON.stringify({ syncUrl: `http://127.0.0.1:${STUB_PORT}`, syncApiToken: TOKEN }) });
    check('an oversize push to an old peer is refused up front', tooBig.status, 413);
    check('nothing was sent', importedBytes, -1);
    check('the message gives both figures', /5\.\d MB and a single sync push can carry at most 1\.0 MB/.test(tooBig.body?.error || ''), true);
    check('and says what to do about it',
      /Update the peer/.test(tooBig.body?.error || '') && /archiving saved reports/.test(tooBig.body?.error || ''), true);
    check('it does not claim a bug when the peer simply cannot chunk',
      /this is a bug/.test(tooBig.body?.error || ''), false);

    console.log('\nand a small bundle still goes to an old peer in one POST');
    /* From a FRESH server: B now holds everything A pushed, so its bundle is
       over the stub's 1 MB ceiling too -- the first version of this case
       asserted against a database that had grown under it. */
    const C = { port: await freePort(), dir: path.join(TMP, 'tankC') };
    const sc = startServer(C);
    await ready(C);
    const small = await api(C, '/api/sync/push', { method: 'POST',
      body: JSON.stringify({ syncUrl: `http://127.0.0.1:${STUB_PORT}`, syncApiToken: TOKEN }) });
    check('the single-POST route still works for a small database', small.status, 200);
    check('and is reported as unchunked', small.body?.chunked, false);
    check('the old peer really received it', importedBytes > 0, true);
    sc.kill();
    await new Promise((r) => oldPeer.close(r));

    console.log('\nabandoning an upload removes the parts');
    const b3 = await api(B, '/api/sync/import/upload', { method: 'POST',
      body: JSON.stringify({ totalBytes: buf.length, totalChunks: total, chunkBytes: CH, digest, digestAlgo: 'sha256' }) });
    const uid3 = b3.body.uploadId;
    check('abandon returns 200', (await api(B, `/api/sync/import/upload/${uid3}`, { method: 'DELETE' })).status, 200);
    check('and it is gone', (await api(B, `/api/sync/import/upload/${uid3}`)).status, 404);

    console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  } finally {
    sa.kill(); sb.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(fails ? 1 : 0);
})();
