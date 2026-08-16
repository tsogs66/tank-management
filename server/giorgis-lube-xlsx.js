/** Parse Giorgis multi-tank lube-oil XLSX workbooks through Python/openpyxl. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnPython } = require('./python-run');

async function parseGiorgisLubeXlsx(buffer) {
  const token = crypto.randomBytes(6).toString('hex');
  const tmp = path.join(os.tmpdir(), `giorgis-lube-${Date.now()}-${token}.xlsx`);
  fs.writeFileSync(tmp, buffer);
  try {
    const script = path.join(__dirname, '..', 'scripts', 'import-giorgis-lube-xlsx.py');
    const { code, out, err } = await spawnPython([script, tmp], {
      maxBuffer: 128 * 1024 * 1024,
    });
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch (e) {
      throw new Error(`Failed to parse lube workbook output: ${e.message}`);
    }
    if (code !== 0 || parsed.error) {
      throw new Error(parsed.error || err || 'Lube workbook import failed');
    }
    return parsed;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
  }
}

module.exports = { parseGiorgisLubeXlsx };
