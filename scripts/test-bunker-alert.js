/*
 * Bunkering alarm: when does a tank start warning, what does it say, how often.
 *
 * The rule, as the chief engineer gave it: warn five minutes before a tank
 * reaches its target volume, or when any tank is five minutes from 85% — with
 * the message "Chief, {tank name} at {% target volume} prepare to close the
 * valve now". These checks pin each part of that, and the edges around it that
 * decide whether the alarm is a help or a nuisance: a paused valve must not
 * keep ringing, a tank close to target must not be drowned out by one that is
 * only close to the limit, and the voice must not talk over itself.
 *
 * Run: node modules/tanks/scripts/test-bunker-alert.js
 */
'use strict';

const Alert = require('../public/js/bunker-alert');

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? `  ok   ${label}` : `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) fails += 1;
}

const NOW = Date.parse('2026-11-12T10:00:00Z');
const inMin = (m) => new Date(NOW + m * 60000).toISOString();

/* One open tank, as computeBunkerPlan describes it. */
function row(over) {
  return Object.assign({
    slot: 1,
    tankId: 'fuel3',
    name: 'NO.2 H.F.O. TANK (P)',
    status: 'filling',
    targetVolumeM3: 1800,
    targetVolumePercent: 76.8,
    capacity100M3: 2343.98,
    remainingToTargetM3: 400,
    estimatedVolumeM3: 1400,
    estimatedTargetAtIso: inMin(30),
    estimatedToTargetHours: 0.5,
    estimatedLimitAtIso: inMin(60),
    estimatedToLimitHours: 1,
    estimatedOverLimit: false,
    estimatedVolumePercent: 59.7,
  }, over || {});
}

console.log('\nthe five-minute window on a target');
check('thirty minutes out: quiet', Alert.evaluate([row()], NOW), []);
check('six minutes out: still quiet',
  Alert.evaluate([row({ estimatedTargetAtIso: inMin(6) })], NOW), []);
check('five minutes out: the alarm starts (inclusive)',
  Alert.evaluate([row({ estimatedTargetAtIso: inMin(5) })], NOW).length, 1);
const near = Alert.evaluate([row({ estimatedTargetAtIso: inMin(4) })], NOW)[0];
check('four minutes out: names the tank', near.name, 'NO.2 H.F.O. TANK (P)');
check('it is about the target', near.kind, 'target');
check('and says the target volume %, which is the plan\'s own figure', near.percent, 76.8);
check('with about four minutes left', Math.round(near.minutes), 4);
check('not yet reached', near.reached, false);

console.log('\nthe 85% limit, with or without a target');
const noTarget = row({
  targetVolumeM3: null, targetVolumePercent: null, remainingToTargetM3: null,
  estimatedTargetAtIso: null, estimatedToTargetHours: null,
  estimatedLimitAtIso: inMin(3),
});
const lim = Alert.evaluate([noTarget], NOW)[0];
check('an untargeted tank three minutes from 85% alarms', lim && lim.kind, 'limit');
check('and says 85', lim && lim.percent, 85);
check('five minutes from the limit is in the window',
  Alert.evaluate([Object.assign({}, noTarget, { estimatedLimitAtIso: inMin(5) })], NOW).length, 1);
check('six is not', Alert.evaluate([Object.assign({}, noTarget, { estimatedLimitAtIso: inMin(6) })], NOW), []);

console.log('\nwhichever comes first is what is said');
const both = (target, limit) => Alert.evaluate([row({
  estimatedTargetAtIso: inMin(target), estimatedLimitAtIso: inMin(limit),
})], NOW)[0];
check('target first: the target %', both(2, 4).kind + '@' + both(2, 4).percent, 'target@76.8');
check('limit first: 85, not a target it will not reach in time', both(4, 2).kind + '@' + both(4, 2).percent, 'limit@85');
check('a tie goes to the target the chief set', both(3, 3).kind, 'target');
check('a target well past the limit still warns on the limit',
  Alert.evaluate([row({ targetVolumeM3: 2100, targetVolumePercent: 89.6,
    estimatedTargetAtIso: inMin(20), estimatedLimitAtIso: inMin(2) })], NOW)[0].kind, 'limit');

console.log('\nalready there');
const over = Alert.evaluate([row({ estimatedOverLimit: true, estimatedLimitAtIso: null })], NOW)[0];
check('over the limit: reached, zero minutes', over.reached + '/' + over.minutes, 'true/0');
check('and it is the limit that is over', over.kind, 'limit');
const hit = Alert.evaluate([row({ estimatedVolumeM3: 1800, estimatedTargetAtIso: null, estimatedToTargetHours: null })], NOW)[0];
check('projected volume at the target: reached', hit.reached, true);
check('nothing left to go: reached',
  Alert.evaluate([row({ remainingToTargetM3: 0, estimatedTargetAtIso: inMin(40) })], NOW)[0].reached, true);
check('a time already in the past counts as reached, not as negative minutes',
  Alert.evaluate([row({ estimatedTargetAtIso: inMin(-2) })], NOW)[0].minutes, 0);

console.log('\nonly a valve that is open');
for (const status of ['pending', 'paused', 'done']) {
  check(`${status}: never alarms, however close`,
    Alert.evaluate([row({ status, estimatedTargetAtIso: inMin(1) })], NOW), []);
}
check('a slot with no tank is ignored',
  Alert.evaluate([row({ tankId: '', estimatedTargetAtIso: inMin(1) })], NOW), []);
check('so are bad inputs', Alert.evaluate(null, NOW).length + Alert.evaluate([null, undefined, {}], NOW).length, 0);

console.log('\nthe projection is not always there');
check('hours stand in when there is no absolute time',
  Alert.evaluate([row({ estimatedTargetAtIso: null, estimatedToTargetHours: 4 / 60 })], NOW).length, 1);
check('the plan\'s own ETA stands in when nothing was projected',
  Alert.evaluate([row({ estimatedTargetAtIso: null, estimatedToTargetHours: null,
    estimatedLimitAtIso: null, estimatedToLimitHours: null, etaHours: 3 / 60 })], NOW).length, 1);
check('no projection and no target: nothing to warn about',
  Alert.evaluate([row({ targetVolumeM3: null, estimatedTargetAtIso: null, estimatedToTargetHours: null,
    estimatedLimitAtIso: null, estimatedToLimitHours: null })], NOW), []);
check('a zero target is not a target',
  Alert.evaluate([row({ targetVolumeM3: 0, estimatedTargetAtIso: inMin(1),
    estimatedLimitAtIso: inMin(60) })], NOW), []);
check('the percentage falls back to target / capacity',
  Alert.evaluate([row({ targetVolumePercent: null, estimatedTargetAtIso: inMin(2) })], NOW)[0].percent.toFixed(1),
  (1800 / 2343.98 * 100).toFixed(1));

console.log('\nseveral tanks');
const two = Alert.evaluate([
  row({ slot: 1, tankId: 'a', name: 'A', estimatedTargetAtIso: inMin(4) }),
  row({ slot: 2, tankId: 'b', name: 'B', estimatedTargetAtIso: inMin(1) }),
  row({ slot: 3, tankId: 'c', name: 'C', estimatedTargetAtIso: inMin(40) }),
], NOW);
check('only the two inside the window', two.map((a) => a.tankId), ['b', 'a']);
check('soonest first', two[0].minutes < two[1].minutes, true);
const frozen = [row({ estimatedTargetAtIso: inMin(2) })];
const before = JSON.stringify(frozen);
Alert.evaluate(frozen, NOW);
check('the plan\'s rows are not altered', JSON.stringify(frozen), before);
check('the window can be changed',
  Alert.evaluate([row({ estimatedTargetAtIso: inMin(8) })], NOW, { windowMin: 10 }).length, 1);

console.log('\nwhat it says');
const a80 = { name: 'NO.1 H.F.O. TANK (P)', percent: 80, kind: 'target', minutes: 3, reached: false };
check('on screen: the chief\'s wording',
  Alert.message(a80), 'Chief, NO.1 H.F.O. TANK (P) at 80% — prepare to close the valve now');
check('by voice: the same, with "percent" spelled out',
  Alert.speech(a80), 'Chief, Number 1 H F O TANK port at 80 percent, prepare to close the valve now.');
check('a fractional target keeps its decimal',
  Alert.message(Object.assign({}, a80, { percent: 76.8 })).includes('76.8%'), true);
check('a whole one drops the .0', Alert.fmtPercent(85.0), '85');
check('rounded to one decimal', Alert.fmtPercent(76.84), '76.8');
check('starboard', Alert.speakableName('NO.3 F.O. TANK (S)'), 'Number 3 F O TANK starboard');
check('centre', Alert.speakableName('F.O. SERVICE TANK (C)'), 'F O SERVICE TANK centre');
check('a plain name is left alone', Alert.speakableName('SETTLING TANK'), 'SETTLING TANK');
check('how long is left, in words',
  Alert.detail({ kind: 'target', minutes: 3.2, reached: false, percent: 80 }), 'target in about 4 min');
check('under a minute', Alert.detail({ kind: 'target', minutes: 0.4, reached: false, percent: 80 }), 'target in under a minute');
check('the limit says so', Alert.detail({ kind: 'limit', minutes: 2, reached: false, percent: 85 }), '85% filling limit in about 2 min');
check('reached', Alert.detail({ kind: 'target', minutes: 0, reached: true, percent: 80 }), 'TARGET REACHED');
check('over the limit', Alert.detail({ kind: 'limit', minutes: 0, reached: true, percent: 85 }), 'AT THE FILLING LIMIT');

console.log('\nwhen it speaks');
const tankA = { slot: 1, tankId: 'a', kind: 'target' };
const tankB = { slot: 2, tankId: 'b', kind: 'target' };
const p = Alert.createVoicePlanner({ repeatMs: 30000 });
check('announced the moment it enters the window', p.due([tankA], 0).length, 1);
check('not again straight away', p.due([tankA], 1000).length, 0);
check('nor at twenty-nine seconds', p.due([tankA], 29000).length, 0);
check('repeated at thirty', p.due([tankA], 30000).length, 1);
check('and again thirty after that, not sooner', p.due([tankA], 59000).length + p.due([tankA], 60000).length, 1);
const q = Alert.createVoicePlanner({ repeatMs: 30000 });
q.due([tankA], 0);
check('a second tank is announced when it arrives', q.due([tankA, tankB], 5000).map((a) => a.tankId), ['b']);
q.silence([tankA, tankB]);
check('silenced: neither speaks again', q.due([tankA, tankB], 100000).length, 0);
check('and the planner knows it', q.silencedAll([tankA, tankB]), true);
check('a NEW tank after silencing is not covered by it',
  q.due([tankA, tankB, { slot: 3, tankId: 'c', kind: 'target' }], 100500).map((a) => a.tankId), ['c']);
q.due([], 200000);
check('once they clear, the silence is forgotten', q.silencedAll([tankA]), false);
check('a valve closed and reopened is announced afresh', q.due([tankA], 210000).length, 1);
const r = Alert.createVoicePlanner({ repeatMs: 30000 });
r.due([tankA], 0);
check('target turning into the limit is a new warning',
  r.due([{ slot: 1, tankId: 'a', kind: 'limit' }], 1000).length, 1);
check('reset starts over', (r.reset(), r.due([tankA], 2000).length), 1);

console.log('\nthe defaults, which is what the program actually uses');
const d = Alert.createVoicePlanner();
d.due([tankA], 0);
check('a default planner is quiet at twenty-nine seconds', d.due([tankA], 29000).length, 0);
check('and speaks again at thirty', d.due([tankA], 30000).length, 1);

console.log('\nthe constants are the ones asked for');
check('five minutes', Alert.WINDOW_MIN, 5);
check('85%', Alert.LIMIT_PERCENT, 85);
check('the voice repeats every thirty seconds', Alert.REPEAT_MS, 30000);

console.log('\nthe voice: a calm, firm officer, not a navigation app');
const V = (name, lang, local) => ({ name, lang: lang || 'en-GB', localService: local !== false });
const pool = [
  V('Microsoft Zira - English (United States)', 'en-US'),
  V('Samantha', 'en-US'),
  V('Google UK English Female', 'en-GB', false),
  V('Google UK English Male', 'en-GB', false),
  V('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB', false),
  V('Daniel', 'en-GB'),
  V('Thomas', 'fr-FR'),
  V('eSpeak English', 'en'),
];
check('a natural British male voice beats every other', Alert.pickVoice(pool).name, 'Microsoft Ryan Online (Natural) - English (United Kingdom)');
check('without it, a local deep male voice (Daniel) over a female one',
  Alert.pickVoice(pool.filter((v) => !/Ryan|Google/.test(v.name))).name, 'Daniel');
check('a female voice is never preferred while a male one exists',
  /Zira|Samantha|Female/.test(Alert.pickVoice(pool.filter((v) => !/Ryan/.test(v.name))).name), false);
check('a natural female voice does not outrank a plain neutral one',
  Alert.pickVoice([V('Microsoft Aria Online (Natural)', 'en-US', false), V('Voice 7', 'en-US')]).name, 'Voice 7');
check('a French voice is never used, however good its name', Alert.scoreVoice(V('Thomas', 'fr-FR')), -Infinity);
check('a robotic engine is the last resort', Alert.scoreVoice(V('eSpeak English', 'en')) < Alert.scoreVoice(V('Zira', 'en-US')), true);
check('only robotic and female voices: still one is picked, not none', Alert.pickVoice([V('Samantha', 'en-US')]).name, 'Samantha');
check('no English voice at all: leave it to the device default', Alert.pickVoice([V('Thomas', 'fr-FR')]), null);
check('no voices yet (they load late): null, not a crash', Alert.pickVoice([]), null);
check('lang with an underscore is read as English', Alert.scoreVoice(V('Daniel', 'en_GB')) > 0, true);
const male = Alert.deliveryFor(V('Daniel'));
const unknown = Alert.deliveryFor(V('Voice 7', 'en-US'));
check('slow and firm', male.rate < 0.95 && male.rate >= 0.8, true);
check('lower than normal pitch', male.pitch < 1, true);
check('a voice not known to be male is lowered further', unknown.pitch < male.pitch, true);
check('a female voice is not mistaken for male', Alert.deliveryFor(V('Samantha')).pitch, unknown.pitch);
check('the order is given in phrases, with the pauses where an officer puts them',
  Alert.phrases('Chief, Number 1 H F O TANK port at 80 percent, prepare to close the valve now.'),
  ['Chief', 'Number 1 H F O TANK port at 80 percent', 'prepare to close the valve now.']);
check('a single phrase stays whole', Alert.phrases('Prepare to close the valve now.'), ['Prepare to close the valve now.']);
check('empty is nothing to say', Alert.phrases(''), []);
check('the words are the chief\'s, unchanged by phrasing',
  Alert.phrases(Alert.speech(a80)).join(', '), Alert.speech(a80));

console.log('\nthe engine-room horn stays soft');
check('quiet enough to sit under a voice', Alert.BED.level <= 0.1, true);
check('and quieter still while the voice speaks', Alert.BED.duck < Alert.BED.level / 2, true);
check('a slow pulse, not a siren', Alert.BED.pulseHz > 0.3 && Alert.BED.pulseHz < 1.5, true);
check('a low horn', Alert.BED.toneHz < 300, true);

console.log(fails ? `\nFAILED — ${fails} of ${checks} checks` : `\nPASSED — ${checks} checks`);
process.exit(fails ? 1 : 0);
