/**
 * Just enough of Node's fs, path and crypto for the vessel database to run in
 * a browser.
 *
 * The database is the same file on the server and on the phone (store-core.js),
 * so that one set of defaults and merge rules governs both. It was written
 * against Node's synchronous filesystem, and this supplies that: a plain map
 * from path to contents, held in memory, written through to IndexedDB.
 *
 * In memory is not a compromise here. A vessel's records are JSON documents
 * measured in kilobytes — the whole database is smaller than one calibration
 * PDF — and holding it lets every read be synchronous, which is what the store
 * expects. IndexedDB is where it survives the app being closed.
 *
 * Only the calls store-core.js actually makes are implemented. Anything else
 * throws rather than returning something plausible: a filesystem that quietly
 * pretends is how a ship ends up with a report full of confident zeroes.
 */
const NodeShim = (() => {
  const DB = 'tms-fs';
  const STORE = 'files';
  const files = new Map();        // absolute path -> string contents
  const dirs = new Set(['/']);    // absolute paths known to exist
  let db = null;
  let pending = new Map();        // path -> contents (or null to delete)
  let flushTimer = null;
  let flushing = null;

  /* ---------------------------------------------------------------- path -- */

  function normalize(p) {
    const absolute = String(p).startsWith('/');
    const out = [];
    for (const part of String(p).split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { out.pop(); continue; }
      out.push(part);
    }
    return (absolute ? '/' : '') + out.join('/');
  }

  const path = {
    join: (...parts) => normalize(parts.filter((p) => p != null && p !== '').join('/')),
    dirname: (p) => {
      const n = normalize(p);
      const i = n.lastIndexOf('/');
      if (i <= 0) return i === 0 ? '/' : '.';
      return n.slice(0, i);
    },
    basename: (p) => normalize(p).split('/').pop(),
    sep: '/',
  };

  /* ------------------------------------------------------------ indexeddb -- */

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Read every stored file into memory. Call once, before anything else. */
  async function load() {
    db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        files.set(cur.key, cur.value);
        let d = path.dirname(cur.key);
        while (d && d !== '/' && !dirs.has(d)) { dirs.add(d); d = path.dirname(d); }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return { files: files.size };
  }

  /* Writes go to memory at once and to IndexedDB on the next tick, batched.
     A tank sounding typed on deck must not wait on a disk transaction, but it
     must not be lost either, so flush() is also called when the app is hidden
     or closed. */
  function schedulePersist(p, contents) {
    pending.set(p, contents);
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 0);
  }

  function flush() {
    if (!db || !pending.size) return flushing || Promise.resolve();
    const batch = pending;
    pending = new Map();
    flushing = new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const [p, contents] of batch) {
        if (contents == null) os.delete(p);
        else os.put(contents, p);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return flushing;
  }

  if (typeof document !== 'undefined') {
    // pagehide fires where unload does not, notably when a phone browser is
    // backgrounded and later discarded.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', () => flush());
  }

  /* ------------------------------------------------------------------ fs -- */

  function enoent(p) {
    const err = new Error(`ENOENT: no such file or directory, '${p}'`);
    err.code = 'ENOENT';
    return err;
  }

  const fs = {
    existsSync(p) {
      const n = normalize(p);
      return files.has(n) || dirs.has(n);
    },
    readFileSync(p, enc) {
      const n = normalize(p);
      if (!files.has(n)) throw enoent(n);
      const text = files.get(n);
      // The store reads utf8 text only; a Buffer would be a lie here.
      if (enc && enc !== 'utf8' && enc !== 'utf-8') {
        throw new Error(`node-shim: only utf8 reads are supported (asked for ${enc})`);
      }
      return text;
    },
    writeFileSync(p, contents) {
      const n = normalize(p);
      const text = typeof contents === 'string' ? contents : String(contents);
      files.set(n, text);
      fs.mkdirSync(path.dirname(n), { recursive: true });
      schedulePersist(n, text);
    },
    mkdirSync(p, opts) {
      const n = normalize(p);
      if (!opts || !opts.recursive) { dirs.add(n); return; }
      const parts = n.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) { cur += `/${part}`; dirs.add(cur); }
    },
    readdirSync(p) {
      const n = normalize(p) === '/' ? '' : normalize(p);
      const seen = new Set();
      for (const key of [...files.keys(), ...dirs]) {
        if (key === n || !key.startsWith(`${n}/`)) continue;
        seen.add(key.slice(n.length + 1).split('/')[0]);
      }
      return [...seen];
    },
    renameSync(from, to) {
      const a = normalize(from);
      const b = normalize(to);
      if (!files.has(a)) throw enoent(a);
      fs.writeFileSync(b, files.get(a));
      files.delete(a);
      schedulePersist(a, null);
    },
    rmSync(p, opts) {
      const n = normalize(p);
      const recursive = opts && opts.recursive;
      for (const key of [...files.keys()]) {
        if (key === n || (recursive && key.startsWith(`${n}/`))) {
          files.delete(key);
          schedulePersist(key, null);
        }
      }
      for (const d of [...dirs]) {
        if (d === n || (recursive && d.startsWith(`${n}/`))) dirs.delete(d);
      }
    },
    statSync(p) {
      const n = normalize(p);
      if (files.has(n)) return { isDirectory: () => false, isFile: () => true };
      if (dirs.has(n)) return { isDirectory: () => true, isFile: () => false };
      throw enoent(n);
    },
  };

  const crypto = {
    randomUUID: () => (self.crypto && self.crypto.randomUUID
      ? self.crypto.randomUUID()
      // Older Android webviews have crypto but not randomUUID.
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
      })),
  };

  /** Everything the shim holds, for backup and for the parity test. */
  function snapshot() { return Object.fromEntries(files); }
  async function replace(map) {
    files.clear();
    dirs.clear();
    dirs.add('/');
    for (const [p, contents] of Object.entries(map || {})) fs.writeFileSync(p, contents);
    await flush();
  }

  return { fs, path, crypto, load, flush, snapshot, replace };
})();

window.NodeShim = NodeShim;
