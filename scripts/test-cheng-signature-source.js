/**
 * The Chief Engineer is entered once, for the ship.
 *
 * The Fuel Oil Report carried its own Prepared-by NAME and RANK boxes, and the
 * name typed into them was what every sheet printed -- tank condition and
 * bunkering printouts included, because they all read the same
 * `signature.preparedBy`. So the name had to be retyped per report, and after a
 * crew change any sheet still holding the old text printed an officer who had
 * left the ship. Vessel Setup already held the name AND the signature image.
 *
 * The boxes are gone. A new report takes its signer from the vessel record, and
 * a stored name is kept only where there is one -- a sheet filed under a
 * previous Chief is the record of who signed it, and reprinting it under the
 * relieving officer's name would be a false document.
 *
 * Run: node scripts/test-cheng-signature-source.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE = require(path.join(ROOT, 'public/js/fuel-report-core.js'));
const UI = fs.readFileSync(path.join(ROOT, 'public/js/fuel-report.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const BRANDING = fs.readFileSync(path.join(ROOT, 'public/js/branding.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

const bundle = (chiefEngineer) => ({
  vessel: { id: 'v1', name: 'MV Harbour Key', chiefEngineer },
  tanks: [],
  readings: {},
  voyage: {},
});

/* ---- a new sheet signs itself from the vessel record -------------------- */

check('an empty report takes the Chief Engineer from the vessel',
  CORE.emptyFuelReport(bundle('A. Reyes')).signature.preparedBy, 'A. Reyes');
check('and the rank it prints under',
  CORE.emptyFuelReport(bundle('A. Reyes')).signature.rank, 'Chief Engineer');
check('a vessel naming nobody leaves the line blank rather than inventing one',
  CORE.emptyFuelReport(bundle('')).signature.preparedBy, '');
check('whitespace is not a name',
  CORE.emptyFuelReport(bundle('   ')).signature.preparedBy, '');
check('and a vessel record without the field does not throw',
  CORE.emptyFuelReport({ vessel: {}, tanks: [], readings: {}, voyage: {} }).signature.preparedBy, '');

/* ---- what happens to sheets saved while the boxes existed --------------- */

const norm = (chiefEngineer, stored) => CORE.normalizeForm(bundle(chiefEngineer), { signature: stored }).signature;

/* The case that would have broken: a sheet saved with the boxes left empty. A
   plain spread of `{ preparedBy: '' }` over the default would blank the name
   the vessel now supplies, and the printout would go back to a dash. */
check('a blank stored name falls back to the vessel',
  norm('A. Reyes', { preparedBy: '' }).preparedBy, 'A. Reyes');
check('so does whitespace',
  norm('A. Reyes', { preparedBy: '  ' }).preparedBy, 'A. Reyes');
check('a missing signature block likewise',
  CORE.normalizeForm(bundle('A. Reyes'), {}).signature.preparedBy, 'A. Reyes');

/* The case that must NOT change: a sheet that records who signed it. */
check('a name actually stored on the sheet is kept',
  norm('B. Santos', { preparedBy: 'A. Reyes' }).preparedBy, 'A. Reyes');
check('even when the ship has since changed Chief',
  norm('B. Santos', { preparedBy: 'A. Reyes', rank: 'Chief Engineer' }).preparedBy, 'A. Reyes');
check('a stored rank is kept too',
  norm('B. Santos', { preparedBy: 'A. Reyes', rank: '2nd Engineer' }).rank, '2nd Engineer');
check('and a blank stored rank falls back to the default',
  norm('B. Santos', { rank: '' }).rank, 'Chief Engineer');

/* ---- nothing asks for the name any more -------------------------------- */

check('the Prepared-by NAME and RANK boxes are gone',
  /data-signature=/.test(UI), false);
check('and so is the handler that read them',
  /el\.dataset\.signature/.test(UI), false);
check('the panel says where the name comes from instead',
  /from Vessel Setup/.test(UI), true);
check('and says what will print when Vessel Setup names nobody',
  /the signature line will print blank/.test(UI), true);
check('no other page grew its own box',
  (UI + APP).match(/data-signature=/g), null);

/* ---- the printed block still resolves a name --------------------------- */

check('the signature footer falls back to the vessel Chief Engineer',
  /const signer = String\(signerName \|\| vesselChiefEngineer\(\) \|\| ''\)\.trim\(\);/.test(UI), true);
check('and the image is looked up by that name, so a reprint is honest',
  /function signatureFor\(name\)/.test(UI), true);
check('tank condition prints through the same block',
  /UI\.printSignatureBlock\(computed\.signature && computed\.signature\.preparedBy/.test(APP), true);
check('AIO Vessel Setup overlays the Chief Engineer onto the tank bundle',
  /function overlayAioIdentity\(/.test(UI), true);
check('print helpers read that overlay, not the raw tank folder',
  /return overlayAioIdentity\(STATE\.bundle\)/.test(UI), true);
check('and the live working sheet takes the AIO name',
  /function applyAioIdentity\(/.test(UI) && /view\.form\.signature\.preparedBy = aio\.chiefEngineer/.test(UI), true);
check('signature lookup is loose so a spelling variant still finds the image',
  /function looseSignatureKey\(/.test(UI) && /looseSignatureKey\(k\) === loose/.test(UI), true);
check('Android print does not absolutely-position the signature image',
  /\.fr-print-sign-space img \{[\s\S]{0,280}position: static/.test(BRANDING), true);
check('and the sheet CSS uses flex instead of transform',
  /\.fr-print-sign-space \{[\s\S]{0,180}display: flex/.test(CSS)
    && !/\.fr-print-sign-space img \{[\s\S]{0,120}transform: translateX/.test(CSS), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
