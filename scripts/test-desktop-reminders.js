/*
 * Windows desktop: the alarm rings once at its time and not for stale ones,
 * a new sync replaces the old set, and the calendar file is written under a
 * safe name and opened.
 *
 * Run: node scripts/test-desktop-reminders.js
 */
'use strict';
const path = require('path');
const { createReminders, GRACE_MS } = require('../desktop/reminders');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

(async () => {
  let t = 1000000;
  const rung = [];
  const timers = [];
  const r = createReminders({
    now: () => t,
    setInterval: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearInterval: (i) => { if (timers[i]) timers[i].live = false; },
    notify: (a) => rung.push(a.id),
  });
  const a = (id, at, extra) => Object.assign({ id, title: 'T' + id, body: '', fireAt: t + at, deadlineAt: t + at }, extra);

  console.log('\nringing');
  check('a sync reports how many it holds', r.sync([a('x', 60000), a('y', 120000)]), 2);
  check('and starts watching', timers.filter((x) => x.live).length, 1);
  t += 59000; r.tick();
  check('not before the time', rung, []);
  t += 1000; r.tick();
  check('at the time it rings', rung, ['x']);
  r.tick();
  check('and only once', rung, ['x']);
  t += 60000; r.tick();
  check('the next rings in its turn', rung, ['x', 'y']);
  check('nothing left pending', r.pending().length, 0);

  console.log('\nsyncing replaces');
  rung.length = 0;
  r.sync([a('p', 1000), a('q', 2000)]);
  r.sync([a('q', 2000)]);
  t += 5000; r.tick();
  check('a note removed by the second sync does not ring', rung, ['q']);
  check('an empty sync stops the watch', (r.sync([]), timers[timers.length - 1].live), false);
  check('bad entries are ignored', r.sync([null, { id: 'z' }, { fireAt: 5 }, a('ok', 9000)]), 1);

  console.log('\nstale');
  rung.length = 0;
  r.sync([a('late', 1000)]);
  t += 1000 + GRACE_MS + 1; r.tick();
  check('an alarm missed by more than ten minutes is dropped, not sprung', rung, []);
  check('and not kept', r.pending().length, 0);
  r.sync([a('err', 1000), a('after', 1000)]);
  const bad = createReminders({ now: () => t, setInterval: () => 0, clearInterval() {}, notify: (x) => { if (x.id === 'err') throw new Error('toast'); rung.push(x.id); } });
  bad.sync([a('err', 0), a('after', 0)]); bad.tick();
  check('a failing notification does not stop the others', rung, ['after']);

  console.log('\nthe calendar file');
  const writes = [], opened = [];
  const cal = createReminders({
    tmpDir: path.join('/tmp', 'x'),
    mkdir: async () => {},
    writeFile: async (f, text) => writes.push([f, text]),
    openFile: async (f) => { opened.push(f); return ''; },
  });
  const file = await cal.openCalendar('../evil/..\\name:*.ics', 'BEGIN:VCALENDAR');
  check('written under the temp folder, with a safe name', path.dirname(file), path.join('/tmp', 'x', 'cheng-aio-calendar'));
  check('no path tricks survive', /[\\/:*]/.test(path.basename(file).replace(/\.ics$/, '')), false);
  check('the text is what was given', writes[0][1], 'BEGIN:VCALENDAR');
  check('and it is opened', opened, [file]);
  check('a name without .ics gets one', cal.safeName('notes'), 'notes.ics');
  const fail = createReminders({ tmpDir: '/tmp', mkdir: async () => {}, writeFile: async () => {}, openFile: async () => 'No application is associated' });
  check('no calendar program: empty result, so the page can say so', await fail.openCalendar('a.ics', 'x'), '');

  console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
  process.exit(fails ? 1 : 0);
})();
