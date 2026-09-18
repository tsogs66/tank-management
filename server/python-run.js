/**
 * Resolve a Python executable that can run project scripts.
 * On Windows, `python3` is often a Store/Core stub without pip packages;
 * prefer `python` / absolute installs when they have the needed modules.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const WIN_EXTRA_PATHS = [
  'C:\\Program Files\\Tesseract-OCR',
  'C:\\Program Files (x86)\\Tesseract-OCR',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tesseract-OCR'),
  path.join(process.env.APPDATA || '', 'Python', 'Python311', 'Scripts'),
  path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts'),
  path.join(process.env.APPDATA || '', 'Python', 'Python313', 'Scripts'),
  'C:\\Program Files\\Python311',
  'C:\\Program Files\\Python311\\Scripts',
  'C:\\Program Files\\Python312',
  'C:\\Program Files\\Python312\\Scripts',
].filter(Boolean);

function existing(p) {
  try { return p && fs.existsSync(p); } catch { return false; }
}

function enrichedEnv() {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const parts = WIN_EXTRA_PATHS.filter(existing);
    env.PATH = parts.concat([env.PATH || '']).join(path.delimiter);
  }
  return env;
}

/**
 * The interpreter shipped inside the desktop installer, if this is one.
 *
 * It is tried before anything on the machine. A vessel's computer may have no
 * Python at all, or an old one, or a Microsoft Store stub with none of the
 * packages — the bundled one is the interpreter this application was tested
 * against, so it goes first and the importers work on a fresh install with no
 * internet connection to fetch anything.
 */
function bundledPython() {
  const home = process.env.TMS_PYTHON_HOME;
  if (!home) return [];
  const names = process.platform === 'win32'
    ? [
        path.join(home, 'python.exe'),
        path.join(home, 'python', 'python.exe'),
      ]
    : [
        path.join(home, 'bin', 'python3'),
        path.join(home, 'bin', 'python'),
        path.join(home, 'python', 'bin', 'python3'),
        path.join(home, 'python', 'bin', 'python'),
      ];
  return names.filter(existing);
}

function pythonCandidates() {
  const bundled = bundledPython();
  if (process.platform !== 'win32') {
    return [...bundled, 'python3', 'python'];
  }
  const abs = [
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python313\\python.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Python', 'bin', 'python.exe'),
  ].filter(existing);
  return [...bundled, ...abs, 'python', 'py'];
}

/**
 * Electron packs the app into app.asar. asarUnpack copies Python scripts to
 * app.asar.unpacked, but __dirname still points inside the archive. Node can
 * read asar paths; a spawned Python cannot. Rewrite to the unpacked twin, or
 * copy the script to a real temp file as a last resort.
 */
function resolveChildProcessPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return filePath;
  /* Path segment app.asar → app.asar.unpacked (keep leading separator). */
  const unpacked = filePath.replace(/(^|[/\\])app\.asar(?=[/\\]|$)/g, '$1app.asar.unpacked');
  if (unpacked !== filePath && existing(unpacked)) return unpacked;
  if (!/(^|[/\\])app\.asar(?=[/\\]|$)/.test(filePath)) return filePath;
  /* Still an asar virtual path — materialize for the child process. */
  try {
    if (!existing(filePath) && !existing(unpacked)) return unpacked !== filePath ? unpacked : filePath;
    const src = existing(unpacked) ? unpacked : filePath;
    const dest = path.join(
      os.tmpdir(),
      `cheng-py-${path.basename(src).replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    );
    fs.copyFileSync(src, dest);
    return dest;
  } catch {
    return unpacked !== filePath ? unpacked : filePath;
  }
}

function rewriteSpawnArgs(args) {
  return (args || []).map((arg) => {
    if (typeof arg !== 'string') return arg;
    if (!/\.(py|xlsx|xlsm|pdf)$/i.test(arg) && !arg.includes('app.asar')) return arg;
    return resolveChildProcessPath(arg);
  });
}

function spawnPython(args, opts = {}) {
  const candidates = pythonCandidates();
  const onStderrLine = typeof opts.onStderrLine === 'function' ? opts.onStderrLine : null;
  const resolvedArgs = rewriteSpawnArgs(args);

  return new Promise((resolve, reject) => {
    const env = enrichedEnv();
    let idx = 0;
    const tried = [];

    function tryNext(lastErr) {
      if (idx >= candidates.length) {
        return reject(lastErr || new Error(
          'No working Python found (tried: ' + tried.join(', ') + '). '
          + (process.env.TMS_PYTHON_HOME
            ? 'The interpreter bundled with this installation could not be run.'
            : 'Install Python 3.11+ and: python -m pip install -r requirements.txt ocrmypdf')
        ));
      }
      const cmd = candidates[idx++];
      tried.push(cmd);
      let settled = false;
      const spawnArgs = cmd === 'py' ? ['-3', ...resolvedArgs] : resolvedArgs;
      const child = spawn(cmd, spawnArgs, {
        env,
        maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
        windowsHide: true,
      });
      let out = '';
      let err = '';
      let errBuf = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => {
        const chunk = d.toString();
        err += chunk;
        if (!onStderrLine) return;
        errBuf += chunk;
        let nl;
        while ((nl = errBuf.indexOf('\n')) >= 0) {
          const line = errBuf.slice(0, nl).replace(/\r$/, '');
          errBuf = errBuf.slice(nl + 1);
          if (line) onStderrLine(line);
        }
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        tryNext(e);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        if (onStderrLine && errBuf.trim()) onStderrLine(errBuf.replace(/\r$/, ''));
        resolve({ code, out, err, cmd });
      });
    }

    tryNext();
  });
}

/**
 * Spawn a long-running Python process (e.g. the voyage sync server).
 * Tries each candidate until spawn succeeds; rejects only when none work.
 * Always attaches an 'error' listener so ENOENT cannot crash Electron's main process.
 */
function spawnPythonProcess(args, opts = {}) {
  const candidates = pythonCandidates();
  const env = { ...enrichedEnv(), ...(opts.env || {}) };
  const tried = [];
  const resolvedArgs = rewriteSpawnArgs(args);

  return new Promise((resolve, reject) => {
    let idx = 0;

    function tryNext(lastErr) {
      if (idx >= candidates.length) {
        return reject(lastErr || new Error(
          'No working Python found (tried: ' + tried.join(', ') + '). '
          + (process.env.TMS_PYTHON_HOME
            ? 'The interpreter bundled with this installation could not be run.'
            : 'Install Python 3.11+ (Windows: `python` or the `py` launcher).')
        ));
      }
      const cmd = candidates[idx++];
      tried.push(cmd);
      const spawnArgs = cmd === 'py' ? ['-3', ...resolvedArgs] : resolvedArgs;
      let settled = false;
      let child;
      try {
        child = spawn(cmd, spawnArgs, {
          cwd: opts.cwd,
          env,
          stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
      } catch (e) {
        return tryNext(e);
      }

      const fail = (err) => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        tryNext(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        child.removeListener('error', fail);
        child.removeListener('spawn', ok);
        resolve(child);
      };

      child.once('error', fail);
      if (typeof child.on === 'function') child.once('spawn', ok);
      /* Node without a reliable 'spawn' event: resolve once we have a pid. */
      setImmediate(() => {
        if (!settled && child.pid) ok();
      });
    }

    tryNext();
  });
}

module.exports = {
  spawnPython,
  spawnPythonProcess,
  enrichedEnv,
  pythonCandidates,
  resolveChildProcessPath,
  rewriteSpawnArgs,
};
