/**
 * Import calibration tables from CAPTAIN VENIAMIS / GIORGIS Tank1–Tank4 sheets via Python/openpyxl.
 */
const path = require('path');
const fs = require('fs');
const { spawnPython } = require('./python-run');

function defaultWorkbookPath() {
  return path.join(__dirname, '..', 'TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm');
}

async function runImporter(workbookPath) {
  const script = path.join(__dirname, '..', 'scripts', 'import-excel-tanks.py');
  const { code, out, err, cmd } = await spawnPython([script, workbookPath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (code !== 0) {
    throw new Error(err || out || `Excel import failed (${cmd}, exit ${code})`);
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error('Failed to parse importer JSON: ' + e.message);
  }
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
