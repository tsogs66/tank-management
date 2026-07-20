/**
 * Per-tank calibration table export/import (CSV + Excel).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const tableIo = require('./table-io');

function runPython(args, stdinText) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'tank-table-xlsx.py');
    const py = spawn('python3', [script, ...args], { maxBuffer: 64 * 1024 * 1024 });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('close', (code) => {
      if (code !== 0) {
        try {
          const parsed = JSON.parse(out);
          if (parsed.error) return reject(new Error(parsed.error));
        } catch (_) { /* ignore */ }
        return reject(new Error(err || out || `tank-table-xlsx failed (exit ${code})`));
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('Failed to parse xlsx tool JSON: ' + e.message));
      }
    });
    if (stdinText != null) py.stdin.end(stdinText);
    else py.stdin.end();
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
