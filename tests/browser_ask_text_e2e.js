/*
 * Does the replacement dialog actually appear on screen?
 *
 * Reading the source cannot answer that. The first attempt at this fix, in
 * Voyage Chief, put the dialog inside a page container -- display:none
 * whenever its page is not the open one. The overlay reported itself open,
 * classList agreed, and it laid out at 0x0 with nothing visible. A check that
 * read the class passed it. So this measures getBoundingClientRect() and
 * insists it is non-zero, in a document arranged the way that broke it: the
 * only container present is hidden.
 *
 * Then it drives the dialog the way someone would -- Enter, Escape, a click
 * on the backdrop, the OK button -- because askText's contract is prompt's,
 * and a call site that cannot tell "" from a cancel would delete a vessel
 * name or create one called "undefined".
 *
 * Ported from the parallel fix in tsogs66/tank-management#201, which was
 * closed as superseded; the source-level guard is scripts/test-no-native-prompt.js.
 *
 * Run: node tests/browser_ask_text_e2e.js
 * Needs playwright and a Chromium; skips (exit 0) if either is missing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) {
  try { ({ chromium } = require('playwright-core')); }
  catch (_e) { console.log('playwright not installed — skipping'); process.exit(0); }
}

const ROOT = path.join(__dirname, '..', 'public');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

/* Take the function out of app.js by matching its braces. Slicing to the next
   "\n}\n" breaks the moment a nested block sits at column 0, and a half-copied
   function would fail this file for the wrong reason. */
function extractFunction(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`${signature} not found in app.js`);
  let depth = 0, inStr = null, prev = '';
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    const c = src[i];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
    prev = c;
  }
  throw new Error(`unbalanced braces after ${signature}`);
}

/* Read what askText resolved with, without waiting forever for it.
   A regression that leaves the promise pending -- a key handler that stops
   calling close(), a listener removed too early -- would otherwise hang this
   file until CI killed the job, which reads as infrastructure trouble rather
   than as the bug it is. */
function resolution(page, ms = 3000) {
  return page.evaluate(
    (t) => Promise.race([
      Promise.resolve(window.answer),
      new Promise((r) => setTimeout(() => r('__never_resolved__'), t)),
    ]),
    ms,
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  /* The real stylesheet and the real askText, in a document whose only page
     container is hidden -- the arrangement that broke the first attempt. */
  await page.setContent(`<!doctype html><html><head>
      <style>${fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8')}</style>
    </head><body><div id="page" style="display:none"></div></body></html>`);
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  await page.addScriptTag({ content: extractFunction(app, 'function askText(opts)') });

  console.log('\nthe dialog paints');
  await page.evaluate(() => { window.answer = askText({ title: 'Year', label: 'Year', value: '2025' }); });
  await page.waitForTimeout(50);
  check('the overlay is a direct child of <body>',
    await page.evaluate(() => document.getElementById('ask-text').parentElement.tagName), 'BODY');
  const rect = await page.evaluate(() => {
    const r = document.getElementById('ask-text').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check('it measures non-zero on screen', rect.w > 0 && rect.h > 0, true);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.ask-text-panel').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  check(`the dialog box itself is non-zero (${box.w}x${box.h})`, box.w > 100 && box.h > 50, true);
  check('the input holds the supplied value',
    await page.inputValue('#ask-text-input'), '2025');
  check('and has focus, so the answer can just be typed',
    await page.evaluate(() => document.activeElement && document.activeElement.id), 'ask-text-input');

  console.log('\nEnter accepts the typed text');
  await page.fill('#ask-text-input', '2024');
  await page.keyboard.press('Enter');
  check('askText resolved with what was typed', await resolution(page), '2024');
  check('and the overlay is closed',
    await page.evaluate(() => document.getElementById('ask-text').classList.contains('open')), false);

  console.log('\nEscape cancels, the way prompt() returned null');
  await page.evaluate(() => { window.answer = askText({ title: 'Name' }); });
  await page.waitForTimeout(20);
  await page.keyboard.press('Escape');
  check('askText resolved null', await resolution(page), null);

  console.log('\na click on the backdrop cancels too');
  await page.evaluate(() => { window.answer = askText({ title: 'Name' }); });
  await page.waitForTimeout(20);
  await page.mouse.click(8, 8);
  check('askText resolved null', await resolution(page), null);

  console.log('\nOK returns the text');
  await page.evaluate(() => { window.answer = askText({ title: 'Name', value: 'MV Example' }); });
  await page.waitForTimeout(20);
  await page.click('#ask-text-ok');
  check('askText resolved with the value', await resolution(page), 'MV Example');

  console.log('\nnothing threw along the way');
  check('no uncaught page errors', pageErrors, []);

  await browser.close();
  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
