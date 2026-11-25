/**
 * Consumption plan (Bunker Consumption): the days of a sea leg are distance / (speed x 24) and the quantity is the daily
 * consumption x the exact days. Calculated days are shown to two decimals (the Days box, the result boxes and the printout);
 * days typed by hand and port stays show as typed.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'public', 'js', 'bunker-consumption.js');
let src = fs.readFileSync(file, 'utf8');
assert.ok(src.includes('return { render };'), 'the module still ends with its render export');
src = src.replace('return { render };', 'return { render, legDays, legQty, legMarginMt, summarize, daysShown, resultCardsHtml };');
const sb = { window: {}, document: { getElementById: () => null, querySelector: () => null, addEventListener() {} }, console, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(sb);
vm.runInContext(src.replace(/^const BunkerConsumption/m, 'var BunkerConsumption'), sb);
const C = sb.BunkerConsumption;

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

const sea = { port: false, from: 'A', to: 'B', distance: 1000, speed: 12, dailyCons: 30, days: null, marginPct: 10 };
ok(near(C.legDays(sea), 1000 / (12 * 24)), 'sea days = distance / (speed x 24) = 3.4722...');
ok(near(C.legQty(sea), 30 * (1000 / 288)), 'quantity = daily consumption x the exact days (104.1666...)');
ok(near(C.legMarginMt(sea), C.legQty(sea) * 0.1), 'the margin is a percentage of that quantity');
ok(C.daysShown(sea, C.legDays(sea)) === 3.47, 'the Days box shows the worked days to two decimals (3.47)');
ok(C.daysShown({ ...sea, distance: 1100 }, 1100 / 288) === 3.82, 'and rounds the second decimal (3.819 -> 3.82)');
ok(C.daysShown({ ...sea, days: 3.456, daysManual: true }, 3.456) === 3.456, 'days typed by hand show as typed');
ok(C.daysShown({ port: true, days: 1.5 }, 1.5) === 1.5, 'a port stay shows as typed');

const port = { port: true, from: 'P', to: 'P', distance: null, speed: null, dailyCons: 5, days: 2.5, marginPct: 0 };
const side = { grade: 'HFO', legs: [sea, port, { ...sea, distance: 777, speed: 11.3 }], currentRob: 1000, qtyReceive: 0, deliveryRob: null };
const sum = C.summarize(side);
const seaDays = 1000 / 288 + 777 / (11.3 * 24);
ok(near(sum.daysSea, seaDays) && near(sum.daysPort, 2.5), 'the totals add the exact days of the sea legs and of the port stays');
ok(near(sum.totalCons, 30 * (1000 / 288) + 5 * 2.5 + 30 * (777 / (11.3 * 24))), 'total consumption adds every leg');
const html = C.resultCardsHtml(sum);
const cards = {};
for (const m of html.matchAll(/<b>([^<]*)<\/b>(?:<span[^>]*>[^<]*<\/span>)?<\/div><div class="bp-result-title">([^<]*)</g)) cards[m[2]] = m[1];
const card = (t) => cards[t];
ok(card('Days at Sea') === seaDays.toFixed(2), 'the Days at Sea box shows two decimals: ' + card('Days at Sea'));
ok(card('Days at Port / Anchor') === '2.50', 'the Days at Port / Anchor box shows two decimals');
ok(!/\.\d{3}/.test(card('Days at Sea')) && !/\.\d{3}/.test(card('Days at Port / Anchor')), 'no third decimal in the days boxes');

console.log(`consumption days: ${pass} checks passed`);
