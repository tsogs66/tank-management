/**
 * Analog-style clock time picker — hours, then minutes (0–59), then AM/PM.
 * HH:MM readout accepts typing, click, and scroll. Values stay 24-hour.
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'cheng-clock-picker-css';
  const NUM_R = 78;
  const TICK_R = 98;
  let active = null;

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.ccp-overlay{position:fixed;inset:0;z-index:12000;background:rgba(4,10,18,.62);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(3px)}
.ccp-dialog{width:min(340px,96vw);background:linear-gradient(160deg,rgba(18,34,56,.98),rgba(10,20,32,.98));border:1px solid rgba(201,154,83,.4);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1);padding:16px 16px 14px;color:#e9e4d6;font-family:Segoe UI,Helvetica Neue,sans-serif;overflow:hidden}
html.bright .ccp-dialog{background:linear-gradient(160deg,#fff,#f4f1ea);color:#122238;border-color:rgba(110,72,20,.35)}
.ccp-title{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:8px}
.ccp-face{position:relative;width:220px;height:220px;margin:8px auto 12px;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 35% 30%,rgba(87,179,171,.18),transparent 45%),radial-gradient(circle at 50% 50%,rgba(18,34,56,.9),rgba(8,14,22,1));border:2px solid rgba(201,154,83,.45);box-shadow:inset 0 0 30px rgba(0,0,0,.45),0 0 24px rgba(87,179,171,.15);touch-action:none;cursor:crosshair}
html.bright .ccp-face{background:radial-gradient(circle at 35% 30%,rgba(23,102,95,.1),transparent 45%),#f7f5ef}
.ccp-center{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#c99a53;z-index:3;pointer-events:none}
.ccp-hand{position:absolute;left:50%;top:50%;width:2px;height:70px;margin-top:-70px;margin-left:-1px;background:#57b3ab;transform-origin:bottom center;border-radius:2px;z-index:2;transition:transform .12s ease,opacity .12s ease;pointer-events:none}
.ccp-hand.min{height:90px;margin-top:-90px;background:#c99a53;width:1.5px}
.ccp-hand.dragging{transition:none}
.ccp-hand.dim{opacity:.22}
.ccp-num{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;font-size:11px;cursor:pointer;user-select:none;color:inherit;opacity:.9;z-index:4;-webkit-tap-highlight-color:transparent}
.ccp-num:hover,.ccp-num.active{background:rgba(201,154,83,.28);opacity:1;box-shadow:0 0 0 1px rgba(201,154,83,.5)}
.ccp-tick{position:absolute;left:50%;top:50%;width:2px;height:7px;margin:-3.5px 0 0 -1px;background:rgba(233,228,214,.35);transform-origin:center center;pointer-events:none;z-index:1}
.ccp-tick.major{height:11px;margin-top:-5.5px;background:rgba(201,154,83,.65)}
.ccp-readout{text-align:center;font-variant-numeric:tabular-nums;font-size:1.6rem;font-weight:700;letter-spacing:.06em;margin-bottom:10px}
.ccp-readout .ccp-part{display:inline-block;width:2.2em;min-width:2.2em;padding:4px 6px;border-radius:8px;cursor:text;border:1px solid transparent;background:rgba(0,0,0,.18);color:inherit;font:inherit;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;box-sizing:border-box;-moz-appearance:textfield}
.ccp-readout .ccp-part::-webkit-outer-spin-button,.ccp-readout .ccp-part::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.ccp-readout .ccp-part:hover{background:rgba(201,154,83,.15)}
.ccp-readout .ccp-part.active{background:rgba(87,179,171,.28);border-color:rgba(87,179,171,.55);box-shadow:0 0 0 1px rgba(87,179,171,.25)}
.ccp-readout .ccp-colon{opacity:.55;padding:0 2px}
.ccp-step{text-align:center;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;margin-bottom:8px}
.ccp-hint{text-align:center;font-size:10px;opacity:.5;margin:-4px 0 8px}
.ccp-ampm{display:flex;gap:8px;justify-content:center;margin-bottom:12px}
.ccp-ampm button{min-width:72px;padding:8px 12px;border-radius:10px;border:1px solid rgba(201,154,83,.35);background:rgba(0,0,0,.2);color:inherit;font-weight:700;cursor:pointer}
.ccp-ampm button.active{background:rgba(87,179,171,.25);border-color:#57b3ab}
.ccp-actions{display:flex;gap:8px;justify-content:flex-end}
.ccp-actions button{padding:8px 14px;border-radius:10px;border:1px solid rgba(233,228,214,.2);background:rgba(0,0,0,.25);color:inherit;cursor:pointer;font-weight:600}
.ccp-actions .ccp-ok{background:linear-gradient(180deg,rgba(87,179,171,.45),rgba(87,179,171,.2));border-color:#57b3ab}
input.ccp-bound{cursor:pointer}
`;
    document.head.appendChild(s);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function clampMinute(m) {
    let v = Math.round(Number(m));
    if (!Number.isFinite(v)) return 0;
    v %= 60;
    if (v < 0) v += 60;
    return v;
  }

  function clampHour12(h) {
    let v = Math.round(Number(h));
    if (!Number.isFinite(v)) return 12;
    while (v < 1) v += 12;
    while (v > 12) v -= 12;
    return v;
  }

  function parseValue(el) {
    const raw = String(el.value || '').trim();
    let h = 12, m = 0, datePart = '';
    if (el.type === 'datetime-local' || raw.includes('T')) {
      const mact = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
      if (mact) {
        datePart = mact[1];
        h = Number(mact[2]);
        m = Number(mact[3]);
      }
    } else {
      const mact = raw.match(/^(\d{1,2}):(\d{2})/);
      if (mact) {
        h = Number(mact[1]);
        m = Number(mact[2]);
      }
    }
    if (!Number.isFinite(h)) h = 12;
    if (!Number.isFinite(m)) m = 0;
    m = clampMinute(m);
    const isPm = h >= 12;
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return { h24: h, h12, m, isPm, datePart };
  }

  function to24(h12, m, isPm) {
    let h = Number(h12) % 12;
    if (isPm) h += 12;
    if (!isPm && Number(h12) === 12) h = 0;
    if (isPm && Number(h12) === 12) h = 12;
    return { h, m: clampMinute(m) };
  }

  function writeValue(el, state) {
    const { h, m } = to24(state.h12, state.m, state.isPm);
    if (el.type === 'datetime-local') {
      let datePart = state.datePart;
      if (!datePart) {
        const d = new Date();
        datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
      el.value = `${datePart}T${pad(h)}:${pad(m)}`;
    } else if (el.type === 'time') {
      el.value = `${pad(h)}:${pad(m)}`;
    } else {
      el.value = `${pad(h)}:${pad(m)}`;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function detachActiveListeners() {
    if (!active || !active.listeners) return;
    const L = active.listeners;
    try {
      if (L.pointerMove) {
        window.removeEventListener('mousemove', L.pointerMove);
        window.removeEventListener('touchmove', L.pointerMove);
      }
      if (L.pointerUp) {
        window.removeEventListener('mouseup', L.pointerUp);
        window.removeEventListener('touchend', L.pointerUp);
      }
      if (L.onKey) window.removeEventListener('keydown', L.onKey, true);
    } catch (_) { /* ignore */ }
    active.listeners = null;
  }

  function close() {
    detachActiveListeners();
    if (active && active.overlay && active.overlay.parentNode) {
      active.overlay.parentNode.removeChild(active.overlay);
    }
    /* Orphans from a failed close / remount must not keep blocking the page. */
    try {
      document.querySelectorAll('.ccp-overlay').forEach((n) => n.remove());
    } catch (_) { /* ignore */ }
    active = null;
  }

  /** Angle from face center: 0° at 12 o'clock, clockwise, degrees. */
  function angleFromEvent(face, ev) {
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    const dx = pt.clientX - cx;
    const dy = pt.clientY - cy;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    return deg;
  }

  function open(el) {
    ensureCss();
    close();
    const state = Object.assign({ step: 'hour' }, parseValue(el));
    const overlay = document.createElement('div');
    overlay.className = 'ccp-overlay';
    overlay.innerHTML = `
      <div class="ccp-dialog" role="dialog" aria-modal="true" aria-label="Time picker">
        <div class="ccp-title">Ship clock</div>
        <div class="ccp-readout" data-ccp-readout>
          <input class="ccp-part" data-ccp-part="hour" type="text" inputmode="numeric" maxlength="2" aria-label="Hour" title="Type hour or scroll">
          <span class="ccp-colon">:</span>
          <input class="ccp-part" data-ccp-part="minute" type="text" inputmode="numeric" maxlength="2" aria-label="Minutes" title="Type minutes or scroll">
        </div>
        <div class="ccp-step" data-ccp-step></div>
        <div class="ccp-hint" data-ccp-hint></div>
        <div class="ccp-face" data-ccp-face>
          <div class="ccp-hand" data-ccp-hand-h></div>
          <div class="ccp-hand min" data-ccp-hand-m></div>
          <div class="ccp-center"></div>
        </div>
        <div class="ccp-ampm" data-ccp-ampm hidden>
          <button type="button" data-ampm="am">AM</button>
          <button type="button" data-ampm="pm">PM</button>
        </div>
        <div class="ccp-actions">
          <button type="button" data-ccp-cancel>Cancel</button>
          <button type="button" class="ccp-ok" data-ccp-ok>Set</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const face = overlay.querySelector('[data-ccp-face]');
    const readout = overlay.querySelector('[data-ccp-readout]');
    const partH = overlay.querySelector('[data-ccp-part="hour"]');
    const partM = overlay.querySelector('[data-ccp-part="minute"]');
    const stepEl = overlay.querySelector('[data-ccp-step]');
    const hintEl = overlay.querySelector('[data-ccp-hint]');
    const ampmRow = overlay.querySelector('[data-ccp-ampm]');
    const handH = overlay.querySelector('[data-ccp-hand-h]');
    const handM = overlay.querySelector('[data-ccp-hand-m]');

    let dragging = false;
    let lastStep = null;
    let suppressReadout = false;

    function clearDecor() {
      face.querySelectorAll('.ccp-num, .ccp-tick').forEach((n) => n.remove());
    }

    function placeMinuteTicks() {
      for (let i = 0; i < 60; i++) {
        const tick = document.createElement('div');
        tick.className = 'ccp-tick' + (i % 5 === 0 ? ' major' : '');
        tick.style.transform = `rotate(${i * 6}deg) translateY(-${TICK_R}px)`;
        face.appendChild(tick);
      }
    }

    function placeNums(count, mapLabel, mapVal) {
      for (let i = 0; i < count; i++) {
        const label = mapLabel(i);
        const val = mapVal ? mapVal(i) : label;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ccp-num';
        btn.textContent = label;
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        btn.style.transform = `translate(${Math.cos(angle) * NUM_R}px, ${Math.sin(angle) * NUM_R}px)`;
        btn.dataset.val = String(val);
        face.appendChild(btn);
      }
    }

    function setFromAngle(deg, { advance } = {}) {
      if (state.step === 'hour' || state.step === 'ampm') {
        let h = Math.round(deg / 30) % 12;
        if (h === 0) h = 12;
        state.h12 = h;
        if (advance && state.step === 'hour') state.step = 'minute';
      } else if (state.step === 'minute') {
        state.m = clampMinute(Math.round(deg / 6) % 60);
      }
      refresh({ keepNums: true });
    }

    function refresh(opts) {
      const keepNums = opts && opts.keepNums;
      const { h, m } = to24(state.h12, state.m, state.isPm);
      suppressReadout = true;
      if (document.activeElement !== partH) partH.value = pad(h);
      if (document.activeElement !== partM) partM.value = pad(m);
      suppressReadout = false;
      partH.classList.toggle('active', state.step === 'hour' || state.step === 'ampm');
      partM.classList.toggle('active', state.step === 'minute');
      const hAngle = ((state.h12 % 12) / 12) * 360 + (state.m / 60) * 30;
      const mAngle = state.m * 6;
      handH.style.transform = `rotate(${hAngle}deg)`;
      handM.style.transform = `rotate(${mAngle}deg)`;
      handH.classList.toggle('dragging', dragging && (state.step === 'hour' || state.step === 'ampm'));
      handM.classList.toggle('dragging', dragging && state.step === 'minute');
      handH.classList.toggle('dim', state.step === 'minute');
      handM.classList.toggle('dim', state.step === 'hour' || state.step === 'ampm');

      if (!keepNums || lastStep !== state.step) {
        lastStep = state.step;
        clearDecor();
        if (state.step === 'hour') {
          stepEl.textContent = 'Select hour';
          hintEl.textContent = 'Type HH above, tap a number, drag the hand, or scroll';
          ampmRow.hidden = true;
          ampmRow.style.display = 'none';
          placeNums(12, (i) => (i === 0 ? 12 : i));
          face.querySelectorAll('.ccp-num').forEach((n) => {
            n.classList.toggle('active', Number(n.dataset.val) === state.h12);
            n.onclick = (ev) => {
              ev.stopPropagation();
              state.h12 = Number(n.dataset.val);
              state.step = 'minute';
              refresh();
            };
          });
        } else if (state.step === 'minute') {
          stepEl.textContent = 'Select minutes (0–59)';
          hintEl.textContent = 'Type MM above, or tap / drag the face for any minute';
          ampmRow.hidden = true;
          ampmRow.style.display = 'none';
          placeMinuteTicks();
          placeNums(12, (i) => pad(i * 5), (i) => i * 5);
          face.querySelectorAll('.ccp-num').forEach((n) => {
            const v = Number(n.dataset.val);
            n.classList.toggle('active', v === state.m);
            n.onclick = (ev) => {
              ev.stopPropagation();
              state.m = v;
              state.step = 'ampm';
              refresh();
            };
          });
        } else {
          stepEl.textContent = 'AM or PM';
          hintEl.textContent = 'Confirm morning or afternoon, then Set';
          ampmRow.hidden = false;
          ampmRow.style.display = '';
          placeNums(12, (i) => (i === 0 ? 12 : i));
          face.querySelectorAll('.ccp-num').forEach((n) => {
            n.classList.toggle('active', Number(n.dataset.val) === state.h12);
            n.onclick = (ev) => {
              ev.stopPropagation();
              state.h12 = Number(n.dataset.val);
              refresh({ keepNums: true });
            };
          });
        }
      } else if (state.step === 'minute' || state.step === 'hour') {
        face.querySelectorAll('.ccp-num').forEach((n) => {
          const v = Number(n.dataset.val);
          n.classList.toggle('active', state.step === 'minute' ? v === state.m : v === state.h12);
        });
      }

      ampmRow.querySelectorAll('button').forEach((b) => {
        const pm = b.getAttribute('data-ampm') === 'pm';
        b.classList.toggle('active', pm === state.isPm);
        b.onclick = () => {
          state.isPm = pm;
          refresh({ keepNums: true });
        };
      });
    }

    function nudge(part, delta) {
      if (part === 'minute') {
        state.m = clampMinute(state.m + delta);
        if (state.step !== 'minute') state.step = 'minute';
      } else {
        const cur = to24(state.h12, state.m, state.isPm);
        let next = (cur.h + delta) % 24;
        if (next < 0) next += 24;
        state.isPm = next >= 12;
        let h12 = next % 12;
        if (h12 === 0) h12 = 12;
        state.h12 = h12;
        if (state.step === 'minute') state.step = 'hour';
      }
      refresh();
    }

    function applyHourTyped() {
      const raw = String(partH.value || '').replace(/\D/g, '');
      if (!raw) return;
      let h = Number(raw);
      if (!Number.isFinite(h)) return;
      if (h >= 0 && h <= 23) {
        state.isPm = h >= 12;
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        state.h12 = h12;
      } else {
        state.h12 = clampHour12(h);
      }
      refresh({ keepNums: true });
    }

    function applyMinuteTyped() {
      const raw = String(partM.value || '').replace(/\D/g, '');
      if (raw === '') return;
      state.m = clampMinute(Number(raw));
      refresh({ keepNums: true });
    }

    partH.addEventListener('focus', () => {
      state.step = 'hour';
      refresh({ keepNums: true });
      try { partH.select(); } catch (_) {}
    });
    partM.addEventListener('focus', () => {
      state.step = 'minute';
      refresh({ keepNums: true });
      try { partM.select(); } catch (_) {}
    });
    partH.addEventListener('input', () => {
      if (suppressReadout) return;
      applyHourTyped();
    });
    partM.addEventListener('input', () => {
      if (suppressReadout) return;
      applyMinuteTyped();
    });
    partH.addEventListener('change', applyHourTyped);
    partM.addEventListener('change', applyMinuteTyped);
    partH.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge('hour', -1); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge('hour', 1); }
      if (ev.key === 'Enter') { ev.preventDefault(); partM.focus(); }
    });
    partM.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp') { ev.preventDefault(); nudge('minute', -1); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); nudge('minute', 1); }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (state.step === 'minute') { state.step = 'ampm'; refresh(); }
      }
    });

    function onWheel(ev, part) {
      ev.preventDefault();
      ev.stopPropagation();
      const delta = ev.deltaY > 0 || ev.deltaX > 0 ? 1 : -1;
      nudge(part, delta);
    }
    partH.addEventListener('wheel', (ev) => onWheel(ev, 'hour'), { passive: false });
    partM.addEventListener('wheel', (ev) => onWheel(ev, 'minute'), { passive: false });
    readout.addEventListener('wheel', (ev) => {
      const part = state.step === 'minute' ? 'minute' : 'hour';
      onWheel(ev, part);
    }, { passive: false });
    face.addEventListener('wheel', (ev) => {
      const part = state.step === 'minute' ? 'minute' : 'hour';
      onWheel(ev, part);
    }, { passive: false });

    function pointerDown(ev) {
      if (ev.target.closest && ev.target.closest('.ccp-num')) return;
      dragging = true;
      handH.classList.add('dragging');
      handM.classList.add('dragging');
      setFromAngle(angleFromEvent(face, ev));
      ev.preventDefault();
    }
    function pointerMove(ev) {
      if (!dragging) return;
      setFromAngle(angleFromEvent(face, ev));
      ev.preventDefault();
    }
    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      handH.classList.remove('dragging');
      handM.classList.remove('dragging');
      if (state.step === 'hour') {
        state.step = 'minute';
        refresh();
      } else {
        refresh();
      }
    }
    face.addEventListener('mousedown', pointerDown);
    face.addEventListener('touchstart', pointerDown, { passive: false });
    window.addEventListener('mousemove', pointerMove);
    window.addEventListener('touchmove', pointerMove, { passive: false });
    window.addEventListener('mouseup', pointerUp);
    window.addEventListener('touchend', pointerUp);

    function finish(commit) {
      if (commit) writeValue(el, state);
      close();
      try { el.blur(); } catch (_) {}
    }

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    }
    window.addEventListener('keydown', onKey, true);

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) finish(false);
    });
    overlay.querySelector('[data-ccp-cancel]').onclick = () => finish(false);
    overlay.querySelector('[data-ccp-ok]').onclick = () => {
      applyHourTyped();
      applyMinuteTyped();
      if (state.step === 'hour') {
        state.step = 'minute';
        refresh();
        try { partM.focus(); } catch (_) {}
        return;
      }
      if (state.step === 'minute') {
        state.step = 'ampm';
        refresh();
        return;
      }
      finish(true);
    };

    active = {
      overlay,
      el,
      listeners: { pointerMove, pointerUp, onKey },
    };
    refresh();
    try { partH.focus(); partH.select(); } catch (_) {}
  }

  function bindInput(el) {
    if (!el || el.dataset.ccpBound === '1') return;
    el.dataset.ccpBound = '1';
    el.classList.add('ccp-bound');
    /* Keep native field read-only so the OS time popup does not fight the ship clock.
       Typing happens in the dialog HH:MM boxes. */
    el.setAttribute('readonly', 'readonly');
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      open(el);
    });
    el.addEventListener('focus', (ev) => {
      ev.preventDefault();
      try { el.blur(); } catch (_) {}
      open(el);
    });
  }

  function enhance(root) {
    const scope = root || document;
    scope.querySelectorAll('input[type="time"], input[type="datetime-local"]').forEach(bindInput);
  }

  function install() {
    ensureCss();
    enhance(document);
    if (!document.documentElement._ccpEscBound) {
      document.documentElement._ccpEscBound = true;
      /* Safety net: Escape always clears a stuck overlay even if active was lost. */
      window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        if (!document.querySelector('.ccp-overlay')) return;
        close();
      }, true);
    }
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && (n.matches('input[type="time"]') || n.matches('input[type="datetime-local"]'))) {
            bindInput(n);
          } else if (n.querySelectorAll) enhance(n);
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  global.ChengClockPicker = { install, enhance, open, close, bindInput };
})(typeof window !== 'undefined' ? window : globalThis);
