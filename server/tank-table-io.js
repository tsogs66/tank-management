/**
 * Per-tank calibration table export/import (CSV + Excel).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const tableIo = require('./table-io');
const { spawnPython } = require('./python-run');

function runPython(args) {
  const script = path.join(__dirname, '..', 'scripts', 'tank-table-xlsx.py');
  return spawnPython([script, ...args]).then(({ code, out, err }) => {
    if (code !== 0) {
      try {
        const parsed = JSON.parse(out);
        if (parsed.error) return Promise.reject(new Error(parsed.error));
      } catch (_) { /* ignore */ }
      return Promise.reject(new Error(err || out || `tank-table-xlsx failed (exit ${code})`));
    }
    try {
      return JSON.parse(out);
    } catch (e) {
      return Promise.reject(new Error('Failed to parse xlsx tool JSON: ' + e.message));
    }
  });
}

async function exportXlsxBuffer(tank) {
  const tmpJson = path.join(os.tmpdir(), `fuel-tms-tank-${Date.now()}.json`);
  const tmpXlsx = path.join(os.tmpdir(), `fuel-tms-tank-${Date.now()}.xlsx`);
  fs.writeFileSync(tmpJson, JSON.stringify(tank));
  try {
    await runPython(['export', '--in', tmpJson, '--out', tmpXlsx]);
    return fs.readFileSync(tmpXlsx);
  } finally {
    try { fs.unlinkSync(tmpJson); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpXlsx); } catch { /* ignore */ }
  }
}

async function importXlsxBuffer(buffer, name = 'tank.xlsx') {
  const tmp = path.join(os.tmpdir(), `fuel-tms-import-${Date.now()}-${name}`);
  fs.writeFileSync(tmp, buffer);
  try {
    const result = await runPython(['import', '--in', tmp]);
    if (!result.calibration) throw new Error(result.error || 'No calibration in workbook');
    return result.calibration;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function exportCsv(tank) {
  return tableIo.tankToCsv(tank);
}

function importCsv(text) {
  return tableIo.csvToCalibration(text);
}

/**
 * Detect file type and return calibration patch.
 */
async function importTableBuffer(buffer, filename = '') {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
    return importXlsxBuffer(buffer, path.basename(filename) || 'tank.xlsx');
  }
  // CSV / TSV / text
  const text = buffer.toString('utf8');
  // strip BOM
  const clean = text.replace(/^\uFEFF/, '');
  return importCsv(clean);
}

module.exports = {
  exportCsv,
  importCsv,
  exportXlsxBuffer,
  importXlsxBuffer,
  importTableBuffer,
};
