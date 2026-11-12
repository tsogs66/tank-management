/*
 * Notes → calendar and alarm. What time a note rings, what the calendar file
 * says, and that an alarm rings once, not for ever and not for last week.
 *
 * Run: node scripts/test-note-reminders.js
 */
'use strict';
process.env.TZ = 'Asia/Kolkata'; /* UTC+5:30, so a wrong zone shows up */
const R = require('../public/js/note-reminders.js');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

const NOW = Date.parse('2026-11-12T04:00:00Z'); /* 09:30 local */
const note = (o) => Object.assign({ id: 'n-1', title: 'Class survey', body: 'Book the surveyor', deadline: '2026-11-12T12:00', alarm: true, calendar: true, leadMin: 0 }, o || {});

console.log('\nwhen it rings');
check('a deadline is the wall-clock time on this device (12:00 IST = 06:30 UTC)', new Date(R.deadlineMs(note())).toISOString(), '2026-11-12T06:30:00.000Z');
check('"at the time" rings at the deadline', R.fireMs(note()), R.deadlineMs(note()));
check('15 minutes before', R.deadlineMs(note()) - R.fireMs(note({ leadMin: 15 })), 15 * 60000);
check('a day before', R.deadlineMs(note()) - R.fireMs(note({ leadMin: 1440 })), 1440 * 60000);
check('an unknown lead falls back to the time itself', R.leadMin(note({ leadMin: 7 })), 0);
check('no deadline: nothing to ring', R.fireMs(note({ deadline: '' })), null);
check('a bad date is no deadline', R.deadlineMs(note({ deadline: 'soon' })), null);
check('without a deadline neither is wanted', JSON.stringify(R.wants(note({ deadline: '' }))), '{"calendar":false,"alarm":false}');
check('only what was ticked is wanted', JSON.stringify(R.wants(note({ calendar: false }))), '{"calendar":false,"alarm":true}');

console.log('\nwhat the device is told to keep');
const list = [
  note({ id: 'a', deadline: '2026-11-12T18:00' }),
  note({ id: 'b', deadline: '2026-11-12T11:00' }),
  note({ id: 'c', deadline: '2026-11-12T08:00' }),           /* already past */
  note({ id: 'd', alarm: false }),                             /* calendar only */
  note({ id: 'e', deadline: '' }),                             /* no deadline */
  note({ id: 'f', deadline: '2026-11-12T10:00', leadMin: 60 }), /* rings 09:00: past */
];
check('only future alarms, soonest first', R.upcomingAlarms(list, NOW).map((a) => a.id), ['b', 'a']);
check('each carries what the phone needs', Object.keys(R.upcomingAlarms(list, NOW)[0]).sort(), ['body', 'deadlineAt', 'fireAt', 'id', 'leadMin', 'title']);

console.log('\nrings once, and not for last week');
const at = (iso) => Date.parse(iso);
const n12 = [note({ deadline: '2026-11-12T12:00' })]; /* fires 06:30Z */
check('before the time: not due', R.dueAlarms(n12, at('2026-11-12T06:29:59Z')).length, 0);
check('at the time: due', R.dueAlarms(n12, at('2026-11-12T06:30:00Z')).length, 1);
check('five minutes late (program was closed): still rings', R.dueAlarms(n12, at('2026-11-12T06:35:00Z')).length, 1);
check('an hour late: not sprung on the chief', R.dueAlarms(n12, at('2026-11-12T07:30:00Z')).length, 0);
const key = R.firedKey(R.dueAlarms(n12, at('2026-11-12T06:30:00Z'))[0]);
check('once rung it does not ring again', R.dueAlarms(n12, at('2026-11-12T06:31:00Z'), { [key]: true }).length, 0);
const moved = [note({ deadline: '2026-11-12T12:20' })];
check('moving the deadline makes it ring afresh', R.dueAlarms(moved, at('2026-11-12T06:50:00Z'), { [key]: true }).length, 1);
check('a calendar-only note never rings', R.dueAlarms([note({ alarm: false })], at('2026-11-12T06:30:00Z')).length, 0);

console.log('\nthe calendar file');
const ics = R.buildIcs([note({ title: 'Survey, class; "annual"', body: 'Line one\nLine two\\end', leadMin: 15 })], { now: at('2026-11-12T04:00:00Z'), vesselName: 'MV TEST' });
const lines = ics.text.split('\r\n');
check('CRLF line ends, ending on one', ics.text.endsWith('\r\n') && !/[^\r]\n/.test(ics.text), true);
check('a calendar with one event', [ics.count, lines[0], lines[1], lines[lines.length - 2]], [1, 'BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR']);
check('start is in UTC, converted from the ship clock', lines.includes('DTSTART:20261112T063000Z'), true);
check('and lasts half an hour', lines.includes('DTEND:20261112T070000Z'), true);
check('a stable id, so adding again updates rather than duplicates', lines.includes('UID:n-1@cheng-aio'), true);
check('commas and semicolons are escaped', lines.includes('SUMMARY:Survey\\, class\\; "annual"'), true);
const desc = ics.text.replace(/\r\n /g, '');
check('newlines and backslashes are escaped, and the ship is named', desc.includes('DESCRIPTION:Line one\\nLine two\\\\end\\nShip: MV TEST'), true);
check('the alert is 15 minutes before', lines.includes('TRIGGER:-PT15M'), true);
check('at the time: zero trigger', R.buildIcs([note()]).text.includes('TRIGGER:PT0S'), true);
check('a note with no deadline is left out', R.buildIcs([note({ deadline: '' })]).count, 0);
check('every line is within 75 octets', lines.every((l) => Buffer.byteLength(l) <= 75), true);
const long = R.buildIcs([note({ body: 'Ö'.repeat(120) + ' end' })]);
check('a long note is folded, not cut: unfolding restores it', long.text.replace(/\r\n /g, '').includes('Ö'.repeat(120) + ' end'), true);
check('and folding never splits a character', long.text.split('\r\n').every((l) => !l.includes('�') && Buffer.byteLength(l) <= 75), true);
check('several notes make several events', R.buildIcs([note({ id: 'x' }), note({ id: 'y' })]).count, 2);
check('file name from one note', R.icsFilename([note({ title: 'Class Survey!' })]), 'cheng-aio-class-survey.ics');
check('file name for several', R.icsFilename([note({ id: 'x' }), note({ id: 'y' })]), 'cheng-aio-notes.ics');

console.log('\nthe Notes page uses it');
const src = require('fs').readFileSync(require('path').join(__dirname, '../public/js/notes.js'), 'utf8');
check('notes.js offers the calendar and alarm, and starts the watcher outside AIO',
  /id="noteCalendar"/.test(src) && /id="noteAlarm"/.test(src) && /ChengReminders\.start\(loadAll\)/.test(src) && /!embedded\(\)/.test(src), true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
