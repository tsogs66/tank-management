#!/usr/bin/env node
/**
 * Stage the Python and Tesseract runtime that ships inside the Windows
 * installer.
 *
 * Four features — PDF calibration import, Excel import, XLSX export and the
 * lube spreadsheet — run Python. A vessel's computer cannot be assumed to have
 * it, and the whole point of an installer is that the ship does not need an
 * internet connection to make the program work. So the interpreter, the
 * packages it needs and the OCR engine are downloaded here, at build time, on
 * a machine that does have a connection, and folded into the installer.
 *
 * Run on Windows during the release build. Elsewhere it reports what it would
 * fetch and exits without failing, so a Linux build simply ships without the
 * runtime and the four features say what is missing.
 *
 *   node scripts/stage-runtime.js            stage into desktop/runtime
 *   node scripts/stage-runtime.js --check    report only
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'desktop', 'runtime');
const PY_DIR = path.join(OUT, 'python');
const TESS_DIR = path.join(OUT, 'tesseract');

/* Pinned so a build is reproducible and so the packages in requirements.txt
   are the ones this was tested against. */
const PYTHON_VERSION = '3.11.9';
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}`
  + `/python-${PYTHON_VERSION}-embed-amd64.zip`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const checkOnly = process.argv.includes('--check');

function get(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects for ${url}`));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${res.statusCode} fetching ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function unzip(zip, into) {
  fs.mkdirSync(into, { recursive: true });
  // Every supported Windows runner has PowerShell; on Linux, unzip.
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zip, '-d', into], { stdio: 'inherit' });
  }
}

/**
 * The embeddable Python ships with site-packages switched off, which means pip
 * installs nothing importable. Uncommenting the import site line in the ._pth
 * file turns it back on — without this the packages land on disk and then
 * cannot be imported at run time, which looks exactly like a broken install.
 */
function enableSitePackages() {
  for (const name of fs.readdirSync(PY_DIR)) {
    if (!name.endsWith('._pth')) continue;
    const p = path.join(PY_DIR, name);
    const text = fs.readFileSync(p, 'utf8')
      .replace(/^#\s*import site\s*$/m, 'import site');
    fs.writeFileSync(p, text.includes('import site') ? text : `${text}\nimport site\n`);
    console.log(`  site-packages enabled in ${name}`);
  }
}

async function main() {
  console.log(`Staging the desktop runtime into ${OUT}`);
  console.log(`  Python ${PYTHON_VERSION} (embeddable, amd64)`);
  console.log('  packages from requirements.txt');
  console.log('  Tesseract OCR, if TESSERACT_DIR points at an installation');

  if (checkOnly) return;
  if (process.platform !== 'win32') {
    console.log('\nNot running on Windows — nothing staged.');
    console.log('The build will produce an installer without the Python runtime,');
    console.log('and the PDF/Excel importers will report it as missing.');
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tms-runtime-'));

  const zip = path.join(tmp, 'python.zip');
  console.log(`\nFetching ${PYTHON_URL}`);
  await get(PYTHON_URL, zip);
  unzip(zip, PY_DIR);
  enableSitePackages();

  const getPip = path.join(tmp, 'get-pip.py');
  console.log(`Fetching ${GET_PIP_URL}`);
  await get(GET_PIP_URL, getPip);
  const py = path.join(PY_DIR, 'python.exe');
  execFileSync(py, [getPip, '--no-warn-script-location'], { stdio: 'inherit' });
  execFileSync(py, ['-m', 'pip', 'install', '--no-warn-script-location',
    '-r', path.join(ROOT, 'requirements.txt')], { stdio: 'inherit' });

  /* Tesseract is a native installer rather than a package, so the workflow
     installs it on the runner and points here at the result. */
  const tess = process.env.TESSERACT_DIR;
  if (tess && fs.existsSync(tess)) {
    fs.cpSync(tess, TESS_DIR, { recursive: true });
    console.log(`Tesseract copied from ${tess}`);
  } else {
    console.log('No TESSERACT_DIR set — shipping without OCR.');
    console.log('Text-based calibration PDFs still import; scanned ones will not.');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nRuntime staged.');
}

main().catch((err) => {
  console.error(`\nCould not stage the runtime: ${err.message}`);
  process.exit(1);
});
