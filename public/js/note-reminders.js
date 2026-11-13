/*
 * Note reminders: put a note's deadline in the device calendar and sound an
 * alarm at the set date and time.
 *
 * Three layers, each doing what only it can:
 *  - The rules (below, no DOM): when a note rings, what the calendar entry
 *    looks like. Tested under Node.
 *  - A scheduler that runs while the program is open on any device: it shows
 *    the alarm on screen and sounds a tone until it is dismissed.
 *  - Native hooks, used when the program is running inside the Android app
 *    (ChengAndroidReminders) or the Windows desktop app (ChengDesktopReminders):
 *    the Android one hands the alarm to the system clock so it still rings
 *    with the app closed; the Windows one raises a system notification and
 *    opens the calendar entry in the default calendar program.
 *
 * A note's deadline is the wall-clock time typed into a datetime-local field,
 * so it means "that time on this device", which is what a calendar entry and
 * an alarm clock both want.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChengReminders = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Minutes before the deadline a note may ring; 0 is "at the time". */
  const LEADS = [
    { min: 0, label: 'At the time' },
    { min: 5, label: '5 minutes before' },
    { min: 15, label: '15 minutes before' },
    { min: 30, label: '30 minutes before' },
    { min: 60, label: '1 hour before' },
    { min: 120, label: '2 hours before' },
    { min: 1440, label: '1 day before' },
  ];
  const EVENT_MIN = 30;
  const FIRED_KEY = 'chengAioRemindersFired:v1';
  const TICK_MS = 15000;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** The deadline as a time in ms, or null when it is blank or not a date. */
  function deadlineMs(note) {
    const raw = note && note.deadline;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  }

  function leadMin(note) {
    const n = num(note && note.leadMin);
    return n != null && LEADS.some((l) => l.min === n) ? n : 0;
  }

  /** What the note asks for. Without a deadline there is nothing to schedule. */
  function wants(note) {
    const has = deadlineMs(note) != null;
    return {
      calendar: !!(note && note.calendar) && has,
      alarm: !!(note && note.alarm) && has,
    };
  }

  /** When the alarm goes off: the deadline, less the lead the note asked for. */
  function fireMs(note) {
    const d = deadlineMs(note);
    return d == null ? null : d - leadMin(note) * 60000;
  }

  /** Alarms still ahead, soonest first. */
  function upcomingAlarms(notes, now) {
    const t = now == null ? Date.now() : now;
    return (notes || [])
      .filter((n) => n && n.id && wants(n).alarm)
      .map((n) => ({
        id: String(n.id),
        title: String(n.title || 'Note'),
        body: String(n.body || ''),
        fireAt: fireMs(n),
        deadlineAt: deadlineMs(n),
        leadMin: leadMin(n),
      }))
      .filter((a) => a.fireAt > t)
      .sort((a, b) => a.fireAt - b.fireAt);
  }

  function leadWords(min) {
    const l = LEADS.find((x) => x.min === min);
    return l ? l.label : '';
  }

  /* ---------- iCalendar (RFC 5545) ---------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  function utcStamp(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  function icsText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function utf8Len(ch) {
    const c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  /** Content lines are at most 75 octets; a longer one continues on the next, after a space. */
  function fold(line) {
    const out = [];
    let cur = '';
    let bytes = 0;
    let limit = 75;
    for (const ch of line) {
      const n = utf8Len(ch);
      if (bytes + n > limit) {
        out.push(cur);
        cur = ' ';
        bytes = 1;
        limit = 75;
      }
      cur += ch;
      bytes += n;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  /**
   * One calendar file holding an event for each note that has a deadline.
   * The UID is the note's own id, so adding the same note again updates the
   * entry in a calendar program instead of duplicating it. Each event carries
   * its own alert, at the lead the note asked for.
   */
  function buildIcs(notes, opts) {
    const o = opts || {};
    const stamp = utcStamp(o.now == null ? Date.now() : o.now);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ChEng AIO//Notes//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    let count = 0;
    for (const n of notes || []) {
      const start = deadlineMs(n);
      if (!n || !n.id || start == null) continue;
      const lead = leadMin(n);
      const title = String(n.title || 'Note');
      const body = String(n.body || '');
      const ship = o.vesselName ? 'Ship: ' + o.vesselName : '';
      lines.push(
        'BEGIN:VEVENT',
        'UID:' + icsText(n.id) + '@cheng-aio',
        'DTSTAMP:' + stamp,
        /* Same UID and a higher revision: a calendar program updates this entry
           instead of keeping the old one beside the new. */
        'SEQUENCE:' + revisionOf(n),
        'LAST-MODIFIED:' + utcStamp(Date.parse(n.updatedAt) || (o.now == null ? Date.now() : o.now)),
        'DTSTART:' + utcStamp(start),
        'DTEND:' + utcStamp(start + EVENT_MIN * 60000),
        'SUMMARY:' + icsText(title),
        'DESCRIPTION:' + icsText([body, ship].filter(Boolean).join('\n')),
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:' + icsText(title),
        'TRIGGER:' + (lead ? '-PT' + lead + 'M' : 'PT0S'),
        'END:VALARM',
        'END:VEVENT'
      );
      count += 1;
    }
    lines.push('END:VCALENDAR');
    return { text: lines.map(fold).join('\r\n') + '\r\n', count: count };
  }

  /** A number that rises every time the note is saved. */
  function revisionOf(note) {
    const t = Date.parse(note && note.updatedAt);
    return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
  }

  function icsFilename(notes) {
    const list = (notes || []).filter((n) => n && deadlineMs(n) != null);
    const base = list.length === 1
      ? String(list[0].title || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      : 'notes';
    return 'cheng-aio-' + (base || 'note') + '.ics';
  }

  /* ---------- already rung ---------- */

  function firedKey(a) { return a.id + '@' + a.fireAt; }

  /** The alarms that are due now and have not rung, given what has. */
  function dueAlarms(notes, now, fired) {
    const t = now == null ? Date.now() : now;
    const done = fired || {};
    /* A grace period: an alarm missed by a few minutes still rings when the
       program is next open; one from last week is not sprung on the chief. */
    const GRACE = 10 * 60000;
    return (notes || [])
      .filter((n) => n && n.id && wants(n).alarm)
      .map((n) => ({
        id: String(n.id),
        title: String(n.title || 'Note'),
        body: String(n.body || ''),
        fireAt: fireMs(n),
        deadlineAt: deadlineMs(n),
        leadMin: leadMin(n),
      }))
      .filter((a) => a.fireAt <= t && t - a.fireAt <= GRACE && !done[firedKey(a)])
      .sort((a, b) => a.fireAt - b.fireAt);
  }

  /* ---------- the device ---------- */

  const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';

  function platform() {
    if (!hasWindow) return 'none';
    if (window.ChengAndroidReminders) return 'android';
    if (window.ChengDesktopReminders) return 'desktop';
    return 'web';
  }

  function readFired() {
    try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function writeFired(map) {
    try {
      /* Keep it from growing for ever: only the recent ones matter. */
      const keys = Object.keys(map);
      if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => { delete map[k]; });
      localStorage.setItem(FIRED_KEY, JSON.stringify(map));
    } catch (_) { /* storage can be unavailable */ }
  }

  let ringCtx = null;
  let ringTimer = null;

  function stopRinging() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
    try { if (ringCtx && ringCtx.close) ringCtx.close(); } catch (_) { /* ignore */ }
    ringCtx = null;
  }

  function startRinging() {
    stopRinging();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ringCtx = new AC();
      const beep = () => {
        if (!ringCtx) return;
        const o = ringCtx.createOscillator();
        const g = ringCtx.createGain();
        o.type = 'square';
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ringCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25, ringCtx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ringCtx.currentTime + 0.35);
        o.connect(g);
        g.connect(ringCtx.destination);
        o.start();
        o.stop(ringCtx.currentTime + 0.4);
      };
      beep();
      ringTimer = setInterval(beep, 900);
    } catch (_) { /* no audio: the screen still shows it */ }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The alarm on screen. Appended to the body so it shows whatever page is open. */
  function showAlarm(alarms) {
    if (!hasWindow || !alarms.length) return null;
    let pop = document.getElementById('cheng-alarm');
    if (pop) pop.remove();
    pop = document.createElement('div');
    pop.id = 'cheng-alarm';
    pop.setAttribute('role', 'alertdialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Alarm');
    pop.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(40,0,0,.7);';
    pop.innerHTML =
      '<div style="width:min(520px,100%);max-height:80vh;overflow:auto;background:#1b0f0f;color:#fff;border:2px solid #ff4d3d;border-radius:14px;padding:18px;box-shadow:0 0 40px rgba(255,60,40,.55);">' +
      '<h2 style="margin:0 0 8px;font-size:20px;letter-spacing:.04em;">ALARM</h2>' +
      alarms.map((a) =>
        '<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.2);">' +
        '<strong style="display:block;font-size:17px;">' + esc(a.title) + '</strong>' +
        (a.body ? '<p style="margin:4px 0 0;white-space:pre-wrap;">' + esc(a.body) + '</p>' : '') +
        '<div style="margin-top:6px;font-size:13px;opacity:.85;">' +
        esc(new Date(a.deadlineAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })) +
        (a.leadMin ? ' · ' + esc(leadWords(a.leadMin).toLowerCase()) : '') + '</div></div>').join('') +
      '<div style="margin-top:12px;display:flex;gap:8px;"><button type="button" id="cheng-alarm-ok" style="min-height:44px;padding:0 18px;font-size:16px;font-weight:700;border-radius:10px;border:0;background:#ff4d3d;color:#fff;">Dismiss</button></div>' +
      '</div>';
    document.body.appendChild(pop);
    const ok = pop.querySelector('#cheng-alarm-ok');
    ok.addEventListener('click', () => { stopRinging(); pop.remove(); });
    try { ok.focus(); } catch (_) { /* ignore */ }
    /* The Android and Windows apps already sound the alarm themselves. */
    if (platform() === 'web') startRinging();
    return pop;
  }

  function webNotify(a) {
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      new Notification(a.title, { body: a.body || 'Reminder', tag: a.id, requireInteraction: true });
    } catch (_) { /* ignore */ }
  }

  let getNotes = null;
  let tickTimer = null;

  function tick() {
    if (!getNotes) return;
    let notes = [];
    try { notes = getNotes() || []; } catch (_) { return; }
    const fired = readFired();
    const due = dueAlarms(notes, Date.now(), fired);
    if (!due.length) return;
    due.forEach((a) => { fired[firedKey(a)] = true; });
    writeFired(fired);
    if (platform() === 'web') due.forEach(webNotify);
    showAlarm(due);
  }

  /**
   * Begin watching. `provider` returns every note of every ship, so an alarm
   * set on one ship still rings while another is open. Safe to call again.
   */
  function start(provider) {
    getNotes = provider;
    if (!hasWindow) return;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
    tick();
  }

  /** Ask a browser's permission for system notifications; the apps do not need it. */
  function askPermission() {
    try {
      if (platform() === 'web' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        return Notification.requestPermission();
      }
    } catch (_) { /* ignore */ }
    return Promise.resolve();
  }

  /**
   * Tell the device which alarms to keep. The whole set is replaced each time,
   * so an edited or deleted note leaves nothing stale behind.
   */
  function syncAlarms(notes) {
    const list = upcomingAlarms(notes, Date.now());
    if (!hasWindow) return list;
    try {
      if (window.ChengAndroidReminders && window.ChengAndroidReminders.sync) {
        window.ChengAndroidReminders.sync(JSON.stringify(list));
      } else if (window.ChengDesktopReminders && window.ChengDesktopReminders.sync) {
        window.ChengDesktopReminders.sync(list);
      }
    } catch (_) { /* the on-screen scheduler still covers an open program */ }
    return list;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  /**
   * Put the notes' deadlines in the device calendar.
   * Android opens the calendar's own "new event" screen, filled in, one note at
   * a time; Windows opens the calendar file in the default calendar program;
   * a browser downloads it.
   * Resolves to { ok, how, count, detail }.
   */
  async function addToCalendar(notes, opts) {
    const o = opts || {};
    const withDate = (notes || []).filter((n) => n && deadlineMs(n) != null);
    if (!withDate.length) return { ok: false, how: 'none', count: 0, detail: 'Give the note a deadline first.' };
    const ics = buildIcs(withDate, o);
    const how = platform();
    try {
      if (how === 'android' && window.ChengAndroidReminders.addToCalendar) {
        const n = withDate[0];
        const lead = leadMin(n);
        const res = window.ChengAndroidReminders.addToCalendar(
          String(n.title || 'Note'), String(n.body || ''), deadlineMs(n), EVENT_MIN, lead);
        return { ok: res !== false && res !== 'false', how: how, count: 1, detail: 'Opened the calendar to save the event.' };
      }
      if (how === 'desktop' && window.ChengDesktopReminders.openCalendar) {
        const path = await window.ChengDesktopReminders.openCalendar(icsFilename(withDate), ics.text);
        return { ok: !!path, how: how, count: ics.count, detail: path ? 'Opened in your calendar program.' : 'Could not open a calendar program.' };
      }
      if (hasWindow) {
        download(icsFilename(withDate), ics.text);
        return { ok: true, how: 'web', count: ics.count, detail: 'Downloaded a calendar file — open it to add the event.' };
      }
    } catch (e) {
      return { ok: false, how: how, count: 0, detail: String((e && e.message) || e) };
    }
    return { ok: false, how: how, count: 0, detail: 'No calendar is available here.' };
  }

  function waitFor(test, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const look = () => {
        let ok = false;
        try { ok = !!test(); } catch (_) { /* keep waiting */ }
        if (ok) return resolve(true);
        if (Date.now() - t0 >= ms) return resolve(false);
        setTimeout(look, 400);
      };
      look();
    });
  }

  /**
   * Put the note in the calendar. On the Android app that is done for the user:
   * the event is written straight in and remembered against the note, so saving
   * the note again brings that same event up to date. Elsewhere it is the
   * calendar file (same entry id each time, so a calendar program updates it).
   */
  async function placeInCalendar(note, opts) {
    if (!note || deadlineMs(note) == null) return { ok: false, how: 'none', count: 0, detail: 'Give the note a deadline first.' };
    const b = hasWindow && window.ChengAndroidReminders;
    if (!(b && typeof b.upsertCalendarEvent === 'function')) return addToCalendar([note], opts);
    try {
      let allowed = typeof b.calendarPermission !== 'function' || b.calendarPermission() === 'granted';
      if (!allowed && typeof b.requestCalendarPermission === 'function') {
        b.requestCalendarPermission();
        allowed = await waitFor(() => b.calendarPermission() === 'granted', (opts && opts.permissionWaitMs) || 60000);
      }
      if (!allowed) {
        /* Refused: the old way, with the calendar's own screen. */
        const shown = await addToCalendar([note], opts);
        return Object.assign({}, shown, { detail: 'Calendar access was not allowed, so the calendar was opened to save it yourself.' });
      }
      const res = String(b.upsertCalendarEvent(String(note.id), String(note.title || 'Note'), String(note.body || ''),
        deadlineMs(note), EVENT_MIN, leadMin(note)));
      if (res === 'ok:updated') return { ok: true, how: 'android', count: 1, detail: 'Calendar entry updated.' };
      if (res === 'ok:inserted') return { ok: true, how: 'android', count: 1, detail: 'Added to the calendar.' };
      if (res === 'nocalendar') return { ok: false, how: 'android', count: 0, detail: 'There is no calendar on this device to add it to.' };
      if (res === 'denied') return { ok: false, how: 'android', count: 0, detail: 'Calendar access was not allowed.' };
      return { ok: false, how: 'android', count: 0, detail: res.replace(/^error:/, '') || 'The calendar did not take it.' };
    } catch (e) {
      return { ok: false, how: 'android', count: 0, detail: String((e && e.message) || e) };
    }
  }

  /** Take a note's event out of the calendar, where the app can. */
  async function removeFromCalendar(noteId) {
    const b = hasWindow && window.ChengAndroidReminders;
    if (b && typeof b.removeCalendarEvent === 'function') {
      try {
        const res = String(b.removeCalendarEvent(String(noteId)));
        if (res === 'ok') return { ok: true, how: 'android', count: 1, detail: 'Removed from the calendar.' };
        if (res === 'none') return { ok: true, how: 'android', count: 0, detail: '' };
        return { ok: false, how: 'android', count: 0, detail: 'Could not remove it from the calendar.' };
      } catch (e) {
        return { ok: false, how: 'android', count: 0, detail: String((e && e.message) || e) };
      }
    }
    return { ok: true, how: platform(), count: 0, detail: 'A calendar file you added earlier is not removed automatically.' };
  }

  return {
    LEADS, EVENT_MIN, TICK_MS,
    deadlineMs, leadMin, wants, fireMs, upcomingAlarms, dueAlarms, firedKey,
    buildIcs, icsFilename, icsText, fold, leadWords,
    platform, start, tick, syncAlarms, addToCalendar, placeInCalendar, removeFromCalendar, revisionOf, askPermission, showAlarm, stopRinging,
  };
}));
