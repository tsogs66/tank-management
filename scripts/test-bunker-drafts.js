/**
 * The four bunkering pages (Plan, Monitoring, After bunkering, Summary): one tap from each other, and every edit
 * on them is kept as the current draft — through leaving the page, closing the program, or a restart.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const br = rd('bunkering-report.js'); const fr = rd('fuel-report.js'); const app = rd('app.js');
const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
let fails = 0; let checks = 0;
const check = (n, ok) => { checks++; if (!ok) { fails++; console.log('  FAIL ' + n); } else console.log('  ok   ' + n); };

check('each of the four pages shows the same navigation bar', ['bunker-plan', 'fuel-report', 'bunker-after', 'bunker-summary']
  .every((p) => new RegExp("bunkerNavHtml\\('" + p + "'\\)").test(br + fr)));
check('the bar goes to the other pages, and from the plan\'s frame inside ChEng AIO asks the shell', /async function bunkerGo\(page\)/.test(fr)
  && /chengaio-navigate', module: 'tanks', page/.test(fr) && /openInAioShell\('bunkeringplan'\)/.test(fr));
check('the bar is styled, sticky and left out of prints', /\.bk-nav \{[\s\S]*position: sticky/.test(css) && /@media print \{ \.bk-nav/.test(css));
check('Plan, After and Summary save every edit as a draft after a moment, and keep a copy on the device at once',
  /const DRAFT_DELAY_MS = 700/.test(br) && /localStorage\.setItem\(draftMirrorKey\(path\)/.test(br)
  && ['bunker-plan', 'bunker-after', 'bunker-summary'].every((p) => new RegExp("hookDraft\\(wrap, '" + p + "'\\)").test(br)));
check('Monitoring does the same, and a draft is not yet the ship\'s current readings', /function scheduleDraft\(\)/.test(fr)
  && /syncReadings: !draft/.test(fr) && /extra = \{ \.\.\.extra, syncReadings: false \}/.test(br));
check('leaving a page, hiding the app or closing it saves the pending drafts', /BunkerReports\.flushDrafts\(\)/.test(app) && /FuelReport\.flushDraft\(\)/.test(app)
  && /pagehide[\s\S]{0,200}flushDrafts\(\)/.test(br) && /visibilitychange[\s\S]{0,300}flushDrafts\(\)/.test(br));
check('a draft that never reached the saved copy comes back when the page is opened', /recoverDraft\('bunker-plan'/.test(br)
  && /recoverDraft\('bunker-after'/.test(br) && /recoverDraft\('bunker-summary'/.test(br) && /readDraftMirror\(\)/.test(fr));
check('a loaded, restored or rebuilt page becomes the current draft too', /if \(planFromPending\) scheduleDraft/.test(br)
  && /if \(afterFromPending\) scheduleDraft/.test(br) && /if \(summaryFromPending\) scheduleDraft/.test(br) && /if \(restoredDraft\) scheduleDraft/.test(fr));
check('an explicit save replaces the draft', /else discardDraft\(path\)/.test(br) && /clearDraftMirror\(\)/.test(fr));
console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
