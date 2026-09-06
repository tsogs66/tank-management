'use strict';
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'public/js/api.js'), 'utf8');
let fails = 0, checks = 0;
function check(label, cond) {
  checks += 1;
  console.log(cond ? `  ok   ${label}` : `  FAIL ${label}`);
  if (!cond) fails += 1;
}
console.log('\ntank manual sync only');
check('boot does not auto-flush queue', !/await Api\.flushQueue\(\);\s*\} catch/.test(app));
check('sync loop never calls flushQueue', !/startSyncLoop[\s\S]*flushQueue\(/.test(app) || !/function startSyncLoop[\s\S]*await Api\.flushQueue/.test(app));
check('online reconnect does not flush', !/addEventListener\('online'[\s\S]{0,240}flushQueue\(/.test(api));
check('manual flush button remains', app.includes('id="btn-flush"'));
check('settings hint says press Flush', app.includes('until you press Flush, Push, or Pull'));
console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
