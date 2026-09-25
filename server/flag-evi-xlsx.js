/** Detect and parse FLAG EVI dual-sheet (Trim + Heeling Correction) XLSX workbooks. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnPython } = require('./python-run');

function looksLikeFlagEviName(filename) {
  const n = String(filename || '').toLowerCase();
  return /\.(xlsx|xlsm)$/.test(n);
}

async function parseFlagEviXlsx(buffer) {
  const token = crypto.randomBytes(6).toString('hex');
  const tmp = path.join(os.tmpdir(), `flag-evi-${Date.now()}-${token}.xlsx`);
  fs.writeFileSync(tmp, buffer);
  try {
    const script = path.join(__dirname, '..', 'scripts', 'import-flag-evi-xlsx.py');
    const { code, out, err } = await spawnPython([script, tmp], {
      maxBuffer: 128 * 1024 * 1024,
    });
    let parsed;
    try {
      if (!String(out || '').trim()) {
        throw new Error(err && String(err).trim()
          ? String(err).trim().split('\n').slice(-3).join(' ')
          : 'Importer produced no output (Python script missing or not readable outside the app package)');
      }
      parsed = JSON.parse(out);
    } catch (e) {
      throw new Error(`Failed to parse FLAG EVI workbook output: ${e.message}`);
    }
    if (code !== 0 || parsed.error) {
      throw new Error(parsed.error || err || 'FLAG EVI workbook import failed');
    }
    return parsed;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** Quick structural sniff — true when both trim + heel sheets exist. */
async function isFlagEviWorkbook(buffer) {
  try {
    const parsed = await parseFlagEviXlsx(buffer);
    return !!(parsed && parsed.format === 'flag-evi-xlsx' && (parsed.tanks || []).length);
  } catch {
    return false;
  }
}

module.exports = {
  looksLikeFlagEviName,
  parseFlagEviXlsx,
  isFlagEviWorkbook,
};
