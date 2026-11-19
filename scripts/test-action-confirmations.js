/* Printing, exporting and saving tell the user they worked. */
'use strict';
const fs = require('fs'), path = require('path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
const brand = rd('branding.js'), app = rd('app.js'), bc = rd('bunker-consumption.js'), card = rd('tank-sounding-card.js');
let fails = 0, checks = 0;
const check = (n, ok) => { checks++; if (!ok) { fails++; console.log('  FAIL ' + n); } else console.log('  ok   ' + n); };
check('every print route (bridge, iframe, window.print) confirms through one helper', /function notePrint\(/.test(brand) && (brand.match(/notePrint\(\);/g) || []).length >= 5 && /notePrint\(false\)/.test(brand));
check('the consumption plan fallback print and the sounding card say it was sent', /window\.print\(\);\s*showToast\('Sent to print/.test(bc) && /showToast\('Sent to print/.test(card));
check('Print & Save on the consumption plan also says it was saved', /saveToHistory\(_plan, name\);\s*showToast\('Bunker plan saved'\);\s*doPrint/.test(bc));
check('export links answer when tapped', /document\.addEventListener\('click'[\s\S]{0,500}Download started/.test(app));
check('a message that follows another waits its turn', /showToast\._until/.test(app) && /showToast\._d = setTimeout/.test(app));
console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
