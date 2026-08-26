/**
 * A CommonJS loader, so the phone can run the server's own route code.
 *
 * The alternative was a second implementation of the API for the device, and
 * on this program that is the wrong trade: a separate router would mean a
 * separate set of defaults, rounding and edge cases, and the failure mode is a
 * phone quietly reporting a different tonnage from the ship's computer. Here
 * there is one router. The device loads the same server files and gives them
 * somewhere to put their data.
 *
 * What is substituted, and why it is safe to substitute:
 *
 *   fs, path, crypto   the shim in node-shim.js, over IndexedDB
 *   express, cors      the shim below — the server uses six methods of it
 *   multer             a stub; nothing that uploads a file is served here
 *   ./store            the shared database module, already loaded
 *   the importers      stubs that refuse clearly
 *
 * The importers are the honest limit of this. Reading a calibration book out
 * of a scanned PDF is Python and Tesseract work; it cannot happen inside a
 * webview whatever is written here. Those endpoints say so plainly rather than
 * failing in some way that could be mistaken for an empty result. Import on
 * the desktop, then sync.
 */
const NodeRequire = (() => {
  const modules = new Map();   // id -> exports
  const sources = new Map();   // id -> source text

  /** A module that exists only to refuse, naming what would be needed. */
  function unavailable(what) {
    const fail = () => {
      const err = new Error(
        `${what} needs the desktop application — it runs Python and OCR, which a phone `
        + 'cannot. Import on Windows and sync to this device.');
      err.status = 501;
      throw err;
    };
    return new Proxy({}, { get: () => fail });
  }

  const builtins = {
    fs: () => NodeShim.fs,
    path: () => NodeShim.path,
    crypto: () => NodeShim.crypto,
    os: () => ({ tmpdir: () => '/tmp' }),
    express: () => ExpressShim.express,
    cors: () => () => (req, res, next) => next && next(),
    multer: () => Object.assign(() => ({
      single: () => (req, res, next) => next && next(),
      array: () => (req, res, next) => next && next(),
    }), { memoryStorage: () => ({}), diskStorage: () => ({}) }),
    './store': () => window.StoreCore,
    '../public/js/fuel-report-core': () => window.FuelReportCore,
    '../public/js/bunkering-core': () => window.BunkeringCore,
    './excel-import': () => unavailable('Excel import'),
    './pdf-import': () => unavailable('PDF calibration import'),
    './tank-table-io': () => unavailable('Spreadsheet export'),
    './giorgis-fuel-csv': () => unavailable('The fuel CSV importer'),
    './giorgis-lube-xlsx': () => unavailable('The lube spreadsheet importer'),
    './python-run': () => unavailable('Python'),
    child_process: () => unavailable('Running another program'),
  };

  /** Register a server file's text, keyed the way its siblings require it. */
  function provide(id, text) { sources.set(id, text); }

  function req(id) {
    if (modules.has(id)) return modules.get(id);
    if (builtins[id]) {
      const built = builtins[id]();
      modules.set(id, built);
      return built;
    }
    if (!sources.has(id)) {
      throw new Error(`node-require: nothing registered for '${id}'`);
    }
    const module = { exports: {} };
    modules.set(id, module.exports);
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', 'process',
      sources.get(id));
    fn(req, module, module.exports, '/app/server', `/app/server/${id}`, {
      env: {}, platform: 'browser', argv: [], cwd: () => '/app',
      // Nothing here is the main module; that is what keeps index.js from
      // trying to listen on a port.
      exit: () => {},
    });
    modules.set(id, module.exports);
    return module.exports;
  }

  return { provide, require: req, modules };
})();

/**
 * Enough of Express for the routes to register and answer.
 *
 * Only what the server actually uses: six ways to declare a route, and five
 * ways to answer one. Paths are matched by the same :param convention Express
 * uses, longest literal prefix first so /api/vessels/:id/bunker-plan is not
 * swallowed by /api/vessels/:id/:part.
 */
const ExpressShim = (() => {
  const routes = [];

  function compile(pattern) {
    const names = [];
    const rx = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([A-Za-z0-9_]+)/g, (_, name) => { names.push(name); return '([^/]+)'; })
      .replace(/\*/g, '.*');
    return { rx: new RegExp(`^${rx}$`), names };
  }

  function makeApp() {
    const app = {};
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      app[method] = (pattern, ...handlers) => {
        if (typeof pattern !== 'string') return app;   // app.get('name') config form
        const { rx, names } = compile(pattern);
        // Middleware before the handler (multer) is dropped: the stub above
        // already made those endpoints refuse.
        routes.push({ method: method.toUpperCase(), pattern, rx, names, handler: handlers[handlers.length - 1] });
        return app;
      };
    }
    app.use = () => app;
    app.listen = () => ({ address: () => ({ port: 0 }), on: () => {}, close: () => {} });
    app.set = () => app;
    return app;
  }

  const express = Object.assign(makeApp, {
    static: () => (req, res, next) => next && next(),
    json: () => (req, res, next) => next && next(),
    urlencoded: () => (req, res, next) => next && next(),
    Router: makeApp,
  });

  /**
   * Order the table the way Express would: a route declared earlier wins, and
   * that is exactly how index.js is written — the specific
   * /api/vessels/:id/bunker-plan is declared above the catch-all
   * /api/vessels/:id/:part. Registration order is preserved, so nothing needs
   * re-sorting; this only drops the SPA fallback, which has no meaning here.
   */
  function table() { return routes.filter((r) => r.pattern.startsWith('/api/')); }

  return { express, table, routes };
})();

window.NodeRequire = NodeRequire;
window.ExpressShim = ExpressShim;
