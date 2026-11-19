/**
 * Tank Chief Monitoring — a saved report must stay the current one.
 * Inside Cheng AIO, currentBundle() is a COPY of the held bundle with the ship's identity laid over it. Saving onto
 * the copy left the held bundle on the OLD report, and the next render read it back: the sheet reverted until the
 * program was closed and reopened. Saving, flushing and deleting must write the held bundle (STATE.bundle).
 * A report also carries a description, shown in Saved reports.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../public/js/fuel-report.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '../public/js/fuel-report-core.js'), 'utf8');
let fails = 0; let checks = 0;
function check(name, ok) { checks++; if (!ok) { fails++; console.log('  FAIL ' + name); } else console.log('  ok   ' + name); }
const body = (name) => { const i = src.indexOf('async function ' + name); return src.slice(i, i + 3200); };

check('saveReport writes the held bundle, not the AIO copy', /async function saveReport[\s\S]{0,700}const bundle = STATE\.bundle;/.test(src));
check('flushIfDirty reads the held bundle', /async function flushIfDirty\(\) \{\s*const bundle = STATE\.bundle;/.test(src));
check('deleting a saved report updates the held bundle', /STATE\.bundle\.reportHistory = res\.history \|\| \[\];/.test(src));
check('no save path assigns onto currentBundle()', !/currentBundle\(\)\.(fuelReport|reportHistory) =/.test(src) && !/const bundle = currentBundle\(\);\s*const form = \{ \.\.\.view\.form, updatedAt/.test(body('saveReport')));
check('the sheet has a description field that is saved with the form header', /data-head="description"/.test(src));
check('a filed report keeps its description', /description: String\(computed\.header\.description/.test(core));
check('Saved reports lists the description', /<th>Description<\/th>/.test(src) && /s\.description \|\|/.test(src));

const bunk = fs.readFileSync(path.join(__dirname, '../public/js/bunkering-report.js'), 'utf8');
check('Bunkering plan / after / summary saves write the held bundle', /async function saveChainPart[\s\S]{0,200}const b = heldBundle\(\);/.test(bunk) && /function heldBundle\(\) \{ return STATE\.bundle; \}/.test(bunk));
check('the Bunkering history delete and the plan clock write the held bundle', /heldBundle\(\)\.bunkerHistory = res\.history/.test(bunk) && /const b = heldBundle\(\);\s*b\.bunkerPlan = form;/.test(bunk));

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
