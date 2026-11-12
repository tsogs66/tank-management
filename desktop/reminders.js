/**
 * Note alarms and calendar hand-off for the Windows desktop app.
 *
 * Kept free of Electron imports so it can be tested: the pieces that touch the
 * system (a notification, opening a file) are passed in by main.js.
 *
 * The alarm list is kept in memory and replaced whole by each sync from the
 * Notes page, so an edited or deleted note leaves nothing behind. Alarms ring
 * only while the program is running; the calendar file is what carries an
 * alert while it is closed.
 */
'use strict';

const path = require('path');

const GRACE_MS = 10 * 60 * 1000;

function createReminders(deps) {
  const now = deps.now || Date.now;
  const setInt = deps.setInterval || setInterval;
  const clearInt = deps.clearInterval || clearInterval;
  const intervalMs = deps.intervalMs || 5000;
  let list = [];
  let timer = null;

  function clean(items) {
    return (Array.isArray(items) ? items : [])
      .filter((a) => a && a.id && Number.isFinite(Number(a.fireAt)))
      .map((a) => ({
        id: String(a.id),
        title: String(a.title || 'Note'),
        body: String(a.body || ''),
        fireAt: Number(a.fireAt),
        deadlineAt: Number(a.deadlineAt) || 0,
      }));
  }

  function tick() {
    const t = now();
    const due = list.filter((a) => a.fireAt <= t);
    if (!due.length) return 0;
    list = list.filter((a) => a.fireAt > t);
    for (const a of due) {
      /* One missed by more than the grace is dropped, not sprung later. */
      if (t - a.fireAt > GRACE_MS) continue;
      try { deps.notify(a); } catch (_) { /* a failed toast must not stop the others */ }
    }
    return due.length;
  }

  function stop() {
    if (timer) { clearInt(timer); timer = null; }
  }

  function sync(items) {
    list = clean(items);
    stop();
    if (list.length) timer = setInt(tick, intervalMs);
    return list.length;
  }

  function safeName(name) {
    const base = String(name || 'cheng-aio-notes.ics').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80);
    return /\.ics$/i.test(base) ? base : base + '.ics';
  }

  /** Writes the calendar file and opens it in the default calendar program. */
  async function openCalendar(filename, text) {
    const dir = path.join(deps.tmpDir, 'cheng-aio-calendar');
    await deps.mkdir(dir);
    const file = path.join(dir, safeName(filename));
    await deps.writeFile(file, String(text == null ? '' : text));
    const err = await deps.openFile(file);
    return err ? '' : file;
  }

  return { sync, tick, stop, openCalendar, pending: () => list.slice(), safeName };
}

module.exports = { createReminders, GRACE_MS };
