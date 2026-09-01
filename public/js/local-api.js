/**
 * The API, served from inside the device.
 *
 * Boots the server's own route table under the shims and answers requests from
 * it, so a phone with no network — and no server anywhere — is a complete
 * installation rather than a viewer for a cached copy.
 *
 * Attaching to a server stays available and unchanged: set an address under
 * Backup / Sync and push or pull. What this removes is the requirement.
 */
const LocalApi = (() => {
  let ready = null;
  let table = null;

  /* The server files the device runs. Copied into the bundle at build time by
     scripts/copy-embedded.js, so there is one copy of them in the repository. */
  const EMBEDDED = ['calc.js', 'bunker-live.js', 'index.js'];
  /* Reference tables the routes open by path — the density conversion table
     and the ISO 8217 specifications. They go into the device's filesystem at
     the same place the server keeps them, so the routes find them unchanged. */
  const SEED = ['conversion.json', 'iso8217.json'];

  /**
   * Resolve where /embedded lives.
   * fetch('/embedded/…') ignores <base href>, so under ChEng AIO (/tanks/) a
   * root-absolute path 404s. Prefer CHENG_PRO_EMBEDDED_BASE (Android shell sets
   * "tanks/embedded/"), then /tanks when mounted there, then /embedded.
   */
  function embeddedBaseCandidates() {
    const out = [];
    const push = (b) => {
      if (!b) return;
      const n = String(b).replace(/\/?$/, '/');
      if (!out.includes(n)) out.push(n);
    };
    try {
      if (typeof window.CHENG_PRO_EMBEDDED_BASE === 'string' && window.CHENG_PRO_EMBEDDED_BASE.trim()) {
        push(window.CHENG_PRO_EMBEDDED_BASE.trim());
      }
    } catch { /* ignore */ }
    try {
      if (typeof window.CHENG_PRO_TANKS_PREFIX === 'string' && window.CHENG_PRO_TANKS_PREFIX) {
        push(String(window.CHENG_PRO_TANKS_PREFIX).replace(/\/$/, '') + '/embedded/');
      }
    } catch { /* ignore */ }
    try {
      const pathName = location.pathname || '';
      if (pathName === '/tanks' || pathName.startsWith('/tanks/')) push('/tanks/embedded/');
      /* Bundled AIO shell at / or /index.html — embedded assets live under tanks/. */
      if (window.CHENG_PRO_BUNDLED
          || (window.ChengProBundled && ChengProBundled.isBundledClient
            && ChengProBundled.isBundledClient())) {
        push('tanks/embedded/');
        push('/tanks/embedded/');
      }
    } catch { /* ignore */ }
    push('/embedded/');
    push('embedded/');
    push('tanks/embedded/');
    return out;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    return res.text();
  }

  async function fetchEmbedded(relPath) {
    const rel = String(relPath || '').replace(/^\//, '');
    const tried = [];
    let lastErr = null;
    for (const base of embeddedBaseCandidates()) {
      const url = base + rel;
      tried.push(url);
      try {
        return await fetchText(url);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      (lastErr && lastErr.message ? lastErr.message : 'Failed to fetch')
      + ' (tried ' + tried.join(', ') + ')'
    );
  }

  async function boot() {
    await NodeShim.load();

    /* The vessel folder has to exist before the store is asked anything, the
       same as on a server's first run. */
    NodeShim.fs.mkdirSync('/app/data/vessels', { recursive: true });

    for (const file of SEED) {
      NodeShim.fs.writeFileSync(`/app/seed/${file}`, await fetchEmbedded(`seed/${file}`));
    }

    for (const file of EMBEDDED) {
      const text = await fetchEmbedded(file);
      const id = `./${file.replace(/\.js$/, '')}`;
      NodeRequire.provide(id, text);
      NodeRequire.provide(file === 'index.js' ? './index' : id, text);
    }
    // Loading index.js registers every route against the Express shim.
    NodeRequire.require('./index');
    table = ExpressShim.table();
    return { routes: table.length, seed: SEED.length };
  }

  function start() {
    if (!ready) ready = boot();
    return ready;
  }

  /** Answer one request, in the shape fetch() would have returned. */
  async function handle(method, rawPath, body) {
    await start();
    const [pathname, search] = String(rawPath).split('?');
    const query = Object.fromEntries(new URLSearchParams(search || ''));

    for (const route of table) {
      if (route.method !== method.toUpperCase()) continue;
      const m = route.rx.exec(pathname);
      if (!m) continue;
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return runRoute(route, { params, query, body, get: () => undefined });
    }
    return { status: 404, body: { error: `No such endpoint: ${method} ${pathname}` } };
  }

  function runRoute(route, req) {
    return new Promise((resolve) => {
      let status = 200;
      let settled = false;
      const done = (payload) => {
        if (settled) return;
        settled = true;
        resolve({ status, body: payload });
      };
      const res = {
        status(code) { status = code; return res; },
        json(payload) { done(payload); return res; },
        send(payload) { done(payload); return res; },
        setHeader() { return res; },
        sendFile() { done({ error: 'Files are not served on this device' }); return res; },
        end() { done(null); return res; },
      };
      try {
        const out = route.handler(req, res, (err) => {
          if (err) { status = err.status || 500; done({ error: err.message }); }
        });
        // Some handlers are async (asyncHandler wraps them).
        if (out && typeof out.then === 'function') {
          out.catch((err) => {
            status = err.status || 500;
            done({ error: err.message || 'Request failed' });
          });
        }
      } catch (err) {
        status = err.status || 500;
        done({ error: err.message || 'Request failed' });
      }
    });
  }

  /* Backup and restore of the whole device database, which is also how the
     parity test gets a known starting point into it. */
  /** Every vessel file on the device, for backup. */
  function snapshot() {
    const all = NodeShim.snapshot();
    return Object.fromEntries(Object.entries(all).filter(([p]) => p.startsWith('/app/data/')));
  }

  /**
   * Replace the vessel database.
   *
   * Scoped to the data folder on purpose. The reference tables the routes read
   * — the density conversion table, the ISO 8217 specifications — are part of
   * the program, not of anybody's records, and wiping them on a restore left
   * three endpoints answering 404 on a device that had just been handed a
   * perfectly good backup.
   */
  async function restore(map) {
    await start();
    NodeShim.fs.rmSync('/app/data', { recursive: true });
    NodeShim.fs.mkdirSync('/app/data/vessels', { recursive: true });
    for (const [p, contents] of Object.entries(map || {})) NodeShim.fs.writeFileSync(p, contents);
    await NodeShim.flush();
  }
  function flush() { return NodeShim.flush(); }

  return { start, handle, snapshot, restore, flush };
})();

window.LocalApi = LocalApi;
