/**
 * Bunkering alarm — "prepare to close the valve" before a tank reaches its
 * target, or the 85% filling limit.
 *
 * The decision (evaluate, message, speech, createVoicePlanner) is pure and has
 * no DOM, so it is tested directly. The part that paints the tank, lights the
 * screen edge and talks (update, test, silence) sits below it and only runs in
 * a browser.
 *
 * Why this exists: a tank taking fuel from a barge is closed by hand, and the
 * moment to start closing it is minutes before the level arrives, not when it
 * has. The plan already projects each open tank forward at the measured rate
 * (estimatedTargetAtIso, estimatedLimitAtIso); this turns that projection into
 * something that can be seen from across the engine control room and heard
 * over the noise.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BunkerAlert = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/** The alarm starts this many minutes before the level is reached. */
const WINDOW_MIN = 5;

/** The filling limit the plan works to (SAFE_FILL in the bunkering core). */
const LIMIT_PERCENT = 85;

/** While a tank is still alerting, the voice repeats this often. */
const REPEAT_MS = 30000;

/** Heartbeat to the ChEng AIO shell is dropped by the shell after this long. */
const SHELL_HEARTBEAT = 'chengaio-bunker-alert';

function num(v) {
  if (v === '' || v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Minutes from `now` until a projected moment. The absolute time is preferred:
 * it keeps counting down between full recomputes, where an hours figure would
 * be as stale as the last one.
 */
function minutesUntil(atIso, hours, now) {
  if (atIso) {
    const t = Date.parse(atIso);
    if (Number.isFinite(t)) return (t - now) / 60000;
  }
  const h = num(hours);
  return h == null ? null : h * 60;
}

function fmtPercent(p) {
  const x = num(p);
  if (x == null) return '';
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Which open tanks are inside the warning window, soonest first.
 *
 * A tank is judged on whichever comes first — its own target, or the 85% limit.
 * The limit is counted whether or not a target was set: an untargeted tank left
 * open is exactly the one that overfills. Only a tank that is FILLING is judged;
 * a paused or closed valve is not taking fuel and must not keep alarming.
 */
function evaluate(rows, now, opts) {
  const o = opts || {};
  const windowMin = num(o.windowMin) != null ? Number(o.windowMin) : WINDOW_MIN;
  const limitPercent = num(o.limitPercent) != null ? Number(o.limitPercent) : LIMIT_PERCENT;
  const at = num(now) != null ? Number(now) : Date.now();
  const out = [];

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.tankId || r.status !== 'filling') continue;

    let toTarget = null;
    const target = num(r.targetVolumeM3);
    if (target != null && target > 0) {
      toTarget = minutesUntil(r.estimatedTargetAtIso, r.estimatedToTargetHours, at);
      if (toTarget == null) toTarget = minutesUntil(null, r.etaHours, at);
      const left = num(r.remainingToTargetM3);
      const est = num(r.estimatedVolumeM3);
      if ((left != null && left <= 0.001) || (est != null && est >= target - 0.001)) toTarget = 0;
    }

    let toLimit = null;
    if (r.estimatedOverLimit) {
      toLimit = 0;
    } else {
      toLimit = minutesUntil(r.estimatedLimitAtIso, r.estimatedToLimitHours, at);
      const estPct = num(r.estimatedVolumePercent);
      if (estPct != null && estPct >= limitPercent) toLimit = 0;
    }

    const soonest = Math.min(
      toTarget == null ? Infinity : toTarget,
      toLimit == null ? Infinity : toLimit,
    );
    if (!(soonest <= windowMin)) continue;

    /* Say the limit only when it genuinely comes first. A tie is the
       operator's own target: that is the figure they set and will recognise. */
    const kind = toLimit != null && (toTarget == null || toLimit < toTarget) ? 'limit' : 'target';
    let percent = kind === 'limit' ? limitPercent : num(r.targetVolumePercent);
    if (percent == null && kind === 'target') {
      const cap = num(r.capacity100M3);
      percent = cap > 0 && target != null ? (target / cap) * 100 : null;
    }

    out.push({
      slot: r.slot,
      tankId: r.tankId,
      name: r.name || r.tankId,
      kind,
      minutes: Math.max(0, soonest),
      reached: soonest <= 0,
      percent,
    });
  }
  return out.sort((a, b) => a.minutes - b.minutes || (a.slot || 0) - (b.slot || 0));
}

/** The line on screen. */
function message(a) {
  const pct = fmtPercent(a.percent);
  return `Chief, ${a.name}${pct ? ` at ${pct}%` : ''} — prepare to close the valve now`;
}

/** What is said under the line: how long is left, in words an eye can take in. */
function detail(a) {
  const where = a.kind === 'limit' ? `${fmtPercent(a.percent)}% filling limit` : 'target';
  if (a.reached) return a.kind === 'limit' ? 'AT THE FILLING LIMIT' : 'TARGET REACHED';
  const m = a.minutes;
  const when = m < 1 ? 'under a minute' : `about ${Math.ceil(m)} min`;
  return `${where} in ${when}`;
}

/**
 * A tank name as a person would say it. Speech engines read "NO.1 H.F.O. TANK
 * (P)" as a string of punctuation; the side letters in brackets are the part a
 * chief most needs to hear correctly.
 */
function speakableName(name) {
  return String(name == null ? '' : name)
    .replace(/\bNO\.?\s*(\d+)/gi, 'Number $1')
    .replace(/\(\s*P\s*\)/gi, 'port')
    .replace(/\(\s*S\s*\)/gi, 'starboard')
    .replace(/\(\s*C\s*\)/gi, 'centre')
    .replace(/\./g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the voice says. "percent" is spelled out so it is not read as a symbol. */
function speech(a) {
  const pct = fmtPercent(a.percent);
  return `Chief, ${speakableName(a.name)}${pct ? ` at ${pct} percent` : ''}, prepare to close the valve now.`;
}

/**
 * When to speak. A tank is announced the moment it enters the window, repeated
 * every REPEAT_MS while it stays there, and forgotten when it leaves — so a
 * valve closed and reopened is announced again. Silencing one is remembered
 * only for as long as that tank keeps alerting; a different tank coming into
 * the window after is not covered by it.
 */
function createVoicePlanner(opts) {
  const repeatMs = opts && num(opts.repeatMs) != null ? Number(opts.repeatMs) : REPEAT_MS;
  const spokenAt = new Map();
  const silenced = new Set();
  const keyOf = (a) => `${a.slot}|${a.tankId}|${a.kind}`;
  return {
    due(alerts, now) {
      const live = new Set((alerts || []).map(keyOf));
      for (const k of [...spokenAt.keys()]) if (!live.has(k)) spokenAt.delete(k);
      for (const k of [...silenced]) if (!live.has(k)) silenced.delete(k);
      const due = [];
      for (const a of alerts || []) {
        const k = keyOf(a);
        if (silenced.has(k)) continue;
        const last = spokenAt.get(k);
        if (last == null || now - last >= repeatMs) {
          spokenAt.set(k, now);
          due.push(a);
        }
      }
      return due;
    },
    silence(alerts) { for (const a of alerts || []) silenced.add(keyOf(a)); },
    silencedAll(alerts) { return (alerts || []).length > 0 && (alerts || []).every((a) => silenced.has(keyOf(a))); },
    reset() { spokenAt.clear(); silenced.clear(); },
  };
}

/* ======================================================================== *
 * Browser side. Nothing below runs under Node.
 * ======================================================================== */

const ui = {
  planner: createVoicePlanner(),
  alerts: [],
  test: null,
  audio: null,
  primed: false,
  beeped: false,
  lastRows: [],
  shellActive: false,
};

function hasDom() {
  return typeof document !== 'undefined' && !!document.body;
}

function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (_) { return false; }
}

function ensureStyle() {
  if (!hasDom() || document.getElementById('bunker-alert-style')) return;
  const style = document.createElement('style');
  style.id = 'bunker-alert-style';
  style.textContent = [
    '@keyframes baPulse{0%,100%{opacity:.55}50%{opacity:1}}',
    '@keyframes baRow{0%,100%{box-shadow:0 0 10px 1px rgba(255,59,48,.75),inset 0 0 10px rgba(255,59,48,.45)}',
    '50%{box-shadow:0 0 26px 7px rgba(255,59,48,1),inset 0 0 22px rgba(255,59,48,.85)}}',
    '#bunker-alert-edge{position:fixed;inset:0;z-index:99990;pointer-events:none;',
    'box-shadow:inset 0 0 0 5px #ff3b30,inset 0 0 70px 22px rgba(255,59,48,.8);animation:baPulse 1s ease-in-out infinite;}',
    '#bunker-alert-banner{position:fixed;left:0;right:0;top:0;z-index:99995;display:flex;flex-direction:column;gap:2px;',
    'padding:max(8px,env(safe-area-inset-top,0px)) 14px 8px;background:#b3150c;color:#fff;',
    'box-shadow:0 4px 18px rgba(0,0,0,.5);font:600 15px/1.35 system-ui,sans-serif;}',
    '#bunker-alert-banner .ba-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;}',
    '#bunker-alert-banner .ba-msg{font-weight:800;font-size:16px;}',
    '#bunker-alert-banner .ba-sub{font-weight:600;font-size:12px;letter-spacing:.04em;opacity:.92;text-transform:uppercase;}',
    '#bunker-alert-banner .ba-bar{display:flex;gap:8px;align-items:center;margin-top:4px;}',
    '#bunker-alert-banner .ba-tag{font-size:11px;font-weight:800;letter-spacing:.12em;background:#fff;color:#b3150c;padding:2px 7px;border-radius:4px;}',
    '#bunker-alert-banner button{min-height:36px;padding:4px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.7);',
    'background:rgba(255,255,255,.14);color:#fff;font:700 13px system-ui,sans-serif;cursor:pointer;}',
    'tr.bp-alert>th,tr.bp-alert>td{background:rgba(255,59,48,.22)!important;',
    'box-shadow:inset 0 3px 0 #ff3b30,inset 0 -3px 0 #ff3b30;}',
    'tr.bp-alert>th:first-child{box-shadow:inset 3px 0 0 #ff3b30,inset 0 3px 0 #ff3b30,inset 0 -3px 0 #ff3b30;}',
    'tr.bp-alert{animation:baRow 1s ease-in-out infinite;}',
    '@media (prefers-reduced-motion:reduce){#bunker-alert-edge,tr.bp-alert{animation:none}}',
    '@media print{#bunker-alert-edge,#bunker-alert-banner{display:none!important}}',
  ].join('');
  document.head.appendChild(style);
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A tone first, so the room looks up before the voice says which tank. */
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ui.audio) ui.audio = new AC();
    const ctx = ui.audio;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    const t0 = ctx.currentTime;
    [[880, 0], [660, 0.28]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.28);
    });
  } catch (_) { /* a missing tone must not stop the voice */ }
}

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
}

function speak(text) {
  if (!canSpeak()) return false;
  try {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = (document.documentElement.lang && document.documentElement.lang.length > 1)
      ? document.documentElement.lang : 'en-US';
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 1;
    window.speechSynthesis.speak(u);
    return true;
  } catch (_) { return false; }
}

/**
 * Browsers will not speak or play a tone until the page has been touched. The
 * operator touches Start pumping to begin, which is the moment to get that out
 * of the way — a silent utterance and a muted tone, so the first real warning
 * is not the one that is swallowed.
 */
function prime() {
  if (!hasDom() || ui.primed) return;
  ui.primed = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!ui.audio) ui.audio = new AC();
      if (ui.audio.state === 'suspended' && ui.audio.resume) ui.audio.resume();
    }
  } catch (_) { /* ignore */ }
  try {
    if (canSpeak()) {
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch (_) { /* ignore */ }
}

function edgeEl(on) {
  let el = document.getElementById('bunker-alert-edge');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'bunker-alert-edge';
    el.className = 'no-print';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  } else if (!on && el) {
    el.remove();
  }
}

function bannerEl(on) {
  let el = document.getElementById('bunker-alert-banner');
  if (!on) { if (el) el.remove(); return null; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'bunker-alert-banner';
    el.className = 'no-print';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    document.body.appendChild(el);
    el.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-ba-silence]')) silence();
    });
  }
  return el;
}

function paintBanner(alerts, testing) {
  const el = bannerEl(alerts.length > 0);
  if (!el) return;
  const silenced = ui.planner.silencedAll(alerts);
  const lines = alerts.map((a) => `<div class="ba-line"><span class="ba-msg">${esc(message(a))}</span>`
    + `<span class="ba-sub">${esc(detail(a))}</span></div>`).join('');
  const bar = `<div class="ba-bar">${testing ? '<span class="ba-tag">TEST</span>' : '<span class="ba-tag">WARNING</span>'}`
    + `<button type="button" data-ba-silence${silenced ? ' disabled' : ''}>${silenced ? 'Voice silenced' : 'Silence voice'}</button></div>`;
  const html = lines + bar;
  if (el.dataset.sig !== html) {
    el.innerHTML = html;
    el.dataset.sig = html;
  }
}

/** Light the tank's own row on the plan sheet, wherever it is drawn. */
function paintRows(alerts) {
  /* The sequence sheet only. Other pages reuse data-slot for their own rows. */
  if (!document.getElementById('bp-clock-toggle')) return;
  const hot = new Set(alerts.map((a) => (a.slot || 0) - 1));
  document.querySelectorAll('tr[data-slot]').forEach((tr) => {
    const i = Number(tr.getAttribute('data-slot'));
    tr.classList.toggle('bp-alert', hot.has(i));
  });
  document.querySelectorAll('tr[data-bp-est-slot]').forEach((tr) => {
    const i = Number(tr.getAttribute('data-bp-est-slot'));
    tr.classList.toggle('bp-alert', hot.has(i));
  });
}

/**
 * Inside ChEng AIO the Tank page is a frame, and a frame can only light its
 * own rectangle. The shell lights the whole window, so it is told — and told
 * again every call, because a frame that is closed cannot say it has stopped.
 * The shell lets the glow lapse when the heartbeat does.
 */
function tellShell(alerts) {
  try {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return;
    const active = alerts.length > 0;
    if (!active && !ui.shellActive) return;
    ui.shellActive = active;
    window.parent.postMessage({
      type: SHELL_HEARTBEAT,
      active: alerts.length > 0,
      lines: alerts.map((a) => message(a)),
    }, '*');
  } catch (_) { /* ignore */ }
}

function currentAlerts() {
  return ui.test ? ui.test.alerts : ui.alerts;
}

/**
 * Apply the alarm for these plan rows. Called after every refresh of the plan
 * and every second by the clock tick; cheap enough for that, and idempotent.
 */
function update(rows, opts) {
  if (!hasDom()) return [];
  const now = opts && num(opts.now) != null ? Number(opts.now) : Date.now();
  ui.lastRows = Array.isArray(rows) ? rows : [];
  if (ui.test && now >= ui.test.until) ui.test = null;
  const real = evaluate(rows, now, opts);
  const hadAlerts = ui.alerts.length > 0;
  ui.alerts = real;

  const shown = currentAlerts();
  if (shown.length) ensureStyle();
  edgeEl(shown.length > 0);
  paintBanner(shown, !!ui.test && !real.length);
  paintRows(real);
  tellShell(shown);

  if (shown.length) {
    const due = ui.planner.due(shown, now);
    if (due.length) {
      if (!ui.beeped || !hadAlerts) beep();
      ui.beeped = true;
      due.forEach((a) => speak(speech(a)));
    }
  } else {
    if (hadAlerts || ui.beeped) {
      try { if (canSpeak()) window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
    }
    ui.beeped = false;
    ui.planner.reset();
  }
  return shown;
}

/** Stop the voice for the tanks alerting now; the lights stay until they clear. */
function silence() {
  const shown = currentAlerts();
  ui.planner.silence(shown);
  try { if (canSpeak()) window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
  paintBanner(shown, !!ui.test && !ui.alerts.length);
}

/**
 * Let the operator hear and see the alarm before there is fuel on the way.
 * Whether a tablet's media volume is up, or a voice is installed at all, is
 * only found out by trying it — and the first real warning is the wrong time.
 */
function test(name) {
  if (!hasDom()) return null;
  ensureStyle();
  prime();
  const sample = {
    slot: 0,
    tankId: '__test__',
    name: name || 'NO.1 H.F.O. TANK (P)',
    kind: 'target',
    minutes: 4,
    reached: false,
    percent: 85,
  };
  ui.test = { alerts: [sample], until: Date.now() + 8000 };
  ui.planner.reset();
  ui.beeped = false;
  update(ui.lastRows, { now: Date.now() });
  /* No clock tick runs when nothing is pumping, so the test ends itself. */
  setTimeout(() => update(ui.lastRows, { now: Date.now() }), 8100);
  return sample;
}

/** Remove every trace. For leaving a ship or finishing a transfer. */
function clear() {
  ui.test = null;
  ui.alerts = [];
  ui.planner.reset();
  ui.beeped = false;
  if (!hasDom()) return;
  edgeEl(false);
  bannerEl(false);
  document.querySelectorAll('tr.bp-alert').forEach((tr) => tr.classList.remove('bp-alert'));
  try { if (canSpeak()) window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
  tellShell([]);
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', prime, { capture: true, once: true });
}

return {
  WINDOW_MIN,
  LIMIT_PERCENT,
  REPEAT_MS,
  evaluate,
  message,
  detail,
  speech,
  speakableName,
  fmtPercent,
  createVoicePlanner,
  update,
  silence,
  test,
  clear,
  prime,
  active: () => currentAlerts().slice(),
};
}));
