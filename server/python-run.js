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

function pythonCandidates() {
  if (process.platform !== 'win32') {
    return ['python3', 'python'];
  }
  const abs = [
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python313\\python.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Python', 'bin', 'python.exe'),
  ].filter(existing);
  // Prefer absolute installs, then `python`, then `py -3`, avoid bare python3 (Store stub)
  return [...abs, 'python', 'py'];
}

function spawnPython(args, opts = {}) {
  const candidates = pythonCandidates();

  return new Promise((resolve, reject) => {
    const env = enrichedEnv();
    let idx = 0;
    const tried = [];

    function tryNext(lastErr) {
      if (idx >= candidates.length) {
        return reject(lastErr || new Error(
          'No working Python found (tried: ' + tried.join(', ') + '). '
          + 'Install Python 3.11+ and: python -m pip install -r requirements.txt ocrmypdf'
        ));
      }
      const cmd = candidates[idx++];
      tried.push(cmd);
      let settled = false;
      // `py` launcher needs -3 before the script
      const spawnArgs = cmd === 'py' ? ['-3', ...args] : args;
      const child = spawn(cmd, spawnArgs, {
        env,
        maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
        windowsHide: true,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        tryNext(e);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        resolve({ code, out, err, cmd });
      });
    }

    tryNext();
  });
}

module.exports = { spawnPython, enrichedEnv, pythonCandidates };
