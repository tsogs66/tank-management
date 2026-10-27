/*
 * window.prompt() is not available everywhere Tank Chief runs.
 *
 * Electron does not implement it: the call THROWS "prompt() is not supported."
 * rather than returning null. Both call sites in public/js/app.js sat in async
 * click handlers, so the throw became a rejected promise nobody was listening
 * for -- "New vessel" and "Clone vessel" did nothing at all when clicked on
 * the Windows desktop build (and inside ChEng AIO, which embeds it), with
 * nothing on screen and nothing in the status line. The Android WebView has no
 * prompt of its own either. alert and confirm do work; only prompt needed
 * replacing.
 *
 * This file guards the source-level invariants. Whether the replacement dialog
 * actually paints is measured in tests/browser_ask_text_e2e.js --
 * it cannot be settled by reading the text, and a dialog built inside a
 * display:none page container opens at 0x0 while still reporting itself open.
 *
 * Run: node scripts/test-no-native-prompt.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const APP = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

/* Strip comments so the explanation above a fix is not mistaken for the fix. */
const code = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\nno call reaches the native prompt');
/* window.prompt inside askText's own fallback is deliberate and is spelled
   with the window. prefix; a bare prompt( is the pattern that breaks. The
   install prompt is deferredInstallPrompt.prompt(), a method, not this. */
const bare = code.match(/(^|[^.\w])prompt\s*\(/g) || [];
check('no bare prompt( remains in public/js/app.js', bare.length, 0);
check('askText is defined', /function\s+askText\s*\(/.test(code), true);
check('askText has a prompt fallback for a document without the dialog',
  /window\.prompt\(/.test(code), true);

console.log('\nthe dialog the program asks with');
check('the overlay is built', /id\s*=\s*'askTextOverlay'/.test(code), true);
for (const id of ['askTextTitle', 'askTextMessage', 'askTextLabel',
                  'askTextInput', 'askTextAccept', 'askTextCancel']) {
  check(`#${id} is in the markup`, code.includes(`id="${id}"`), true);
}
check('it is marked up as a modal dialog',
  /setAttribute\('role',\s*'dialog'\)/.test(code)
  && /setAttribute\('aria-modal',\s*'true'\)/.test(code), true);
/* The one detail that cost a round: inside a page container, which is
   display:none whenever its page is not open, the dialog lays out at 0x0
   while classList and hidden both say it is open. */
check('the overlay is parented to <body>, never to a page container',
  /overlay\.parentElement\s*!==\s*document\.body\)\s*document\.body\.appendChild\(overlay\)/.test(code), true);
check('Escape cancels and Enter accepts',
  /ev\.key\s*===\s*'Escape'/.test(code) && /ev\.key\s*===\s*'Enter'/.test(code), true);
check('a backdrop click cancels', /ev\.target\s*===\s*overlay/.test(code), true);
check('the input takes focus on open', /input\.focus\(\)/.test(code), true);
check('cancel resolves null, the same contract prompt() had',
  /function onCancel\(\)\s*\{\s*close\(null\);\s*\}/.test(code), true);
check('the overlay has styling of its own', /\.ask-text-overlay\s*\{/.test(CSS), true);
check('and is hidden while closed', /\.ask-text-overlay\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(CSS), true);

console.log('\nevery asking call site awaits it');
/* A missed await yields a Promise object, and String(Promise) is truthy --
   the vessel would be named [object Promise]. */
const sites = code.split('\n').filter((l) => /[^.\w]askText\s*\(/.test(l)
  && !/function\s+askText/.test(l));
check('askText is called from the two places that used to prompt', sites.length, 2);
for (const l of sites) {
  check(`awaited: ${l.trim().slice(0, 48)}`, /await\s+askText\s*\(/.test(l), true);
}

console.log('\nthe backup hands the file over through ChengSaveFile');
/* A blob anchor click is a no-op in both Electron and the Android WebView
   while still looking to the page like it worked. */
check('downloadJson prefers ChengSaveFile',
  /if\s*\(window\.ChengSaveFile\)\s*return\s*ChengSaveFile\.saveJson\(/.test(code), true);
const clicks = (code.match(/^\s*a\.click\(\);/gm) || []).length;
check('the only raw anchor click left is downloadJson\'s no-ChengSaveFile fallback',
  clicks, 1);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
