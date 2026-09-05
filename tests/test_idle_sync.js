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
console.log('\ntank idle sync wiring');
check('3-minute idle flush constant', app.includes('const IDLE_FLUSH_MS = 3 * 60 * 1000'));
check('activity postpones flush', app.includes('lastActivityAt') && app.includes('noteActivity'));
check('online arms idle flush only', api.includes('requestIdleFlush()') && !/addEventListener\('online'[\s\S]{0,200}flushQueue\(\)/.test(api));
check('savePart queues writes', api.includes('savePart: (id, part, body) => queueWrite('));
check('mutate queues server writes', api.includes('Always queue for server transport'));
check('boot does not flush immediately', app.includes('Api.requestIdleFlush()') && !/await Api\.flushQueue\(\);\s*\} catch/.test(app));
check('manual flush button remains', app.includes('id="btn-flush"'));
console.log(fails ? `\nFAILED — ${fails} of ${checks}` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
