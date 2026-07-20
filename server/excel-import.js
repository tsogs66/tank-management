/**
 * Import calibration tables from CAPTAIN VENIAMIS Tank1–Tank4 sheets via Python/openpyxl.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function defaultWorkbookPath() {
  return path.join(__dirname, '..', 'TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm');
}

function runImporter(workbookPath) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'import-excel-tanks.py');
    const py = spawn('python3', [script, workbookPath], { maxBuffer: 64 * 1024 * 1024 });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(err || `Excel import failed (exit ${code})`));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('Failed to parse importer JSON: ' + e.message));
      }
    });
  });
}

async function importWorkbook(filePath) {
  const target = filePath || defaultWorkbookPath();
  if (!fs.existsSync(target)) {
    throw new Error('Workbook not found: ' + target);
  }
  return runImporter(target);
}

async function importWorkbookBuffer(buffer, tmpName = 'upload.xlsm') {
  const tmp = path.join(require('os').tmpdir(), `fuel-tms-${Date.now()}-${tmpName}`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await runImporter(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

module.exports = { importWorkbook, importWorkbookBuffer, defaultWorkbookPath };
