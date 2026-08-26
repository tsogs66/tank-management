/**
 * Resolve a Python executable that can run project scripts.
 * On Windows, `python3` is often a Store/Core stub without pip packages;
 * prefer `python` / absolute installs when they have the needed modules.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
    ? [path.join(home, 'python', 'python.exe')]
    : [path.join(home, 'python', 'bin', 'python3'), path.join(home, 'python', 'bin', 'python')];
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

function spawnPython(args, opts = {}) {
  const candidates = pythonCandidates();
  const onStderrLine = typeof opts.onStderrLine === 'function' ? opts.onStderrLine : null;

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
      const spawnArgs = cmd === 'py' ? ['-3', ...args] : args;
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

module.exports = { spawnPython, enrichedEnv, pythonCandidates };
