/**
 * Analog-style clock time picker — hours, then minutes (0–59), then AM/PM.
 * HH:MM readout accepts typing, click, and scroll. Values stay 24-hour.
 */
(function (global) {
  'use strict';

  const STYLE_ID = 'cheng-clock-picker-css';
  /* Phone default face 220px (r=110). Desktop CSS caps the dial, then
     applyFaceSize() fits a square into the viewport that is actually on
     screen. placeNums/placeMinuteTicks read clientWidth so radii stay
     proportional after a monitor or DPI change. */
  let active = null;

  function faceRadii(face) {
    const w = (face && face.clientWidth) || 220;
    const half = Math.max(70, w / 2);
    let numBox = 28;
    try {
      const raw = face && getComputedStyle(face).getPropertyValue('--ccp-num');
      const parsed = parseFloat(raw);
      if (parsed > 0) numBox = parsed;
    } catch (_) { /* ignore */ }
    const numR = Math.min(Math.round(half * 0.745), Math.round(half - numBox / 2 - 4));
    const tickR = Math.min(Math.round(half * 0.891), Math.round(half - 8));
    return {
      numR: Math.max(36, numR),
      tickR: Math.max(44, tickR),
    };
  }

  function viewBox() {
    const vv = window.visualViewport;
    const iw = window.innerWidth || 0;
    const ih = window.innerHeight || 0;
    const vw = vv && vv.width ? vv.width : iw;
    const vh = vv && vv.height ? vv.height : ih;
    return {
      w: Math.round(Math.min(iw || vw, vw || iw) || 0),
      h: Math.round(Math.min(ih || vh, vh || ih) || 0),
    };
  }

  function desktopPointer() {
    try {
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return false;
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (_) {
      return false;
    }
  }

  function ensureCss() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    s.textContent = `
.ccp-overlay{position:fixed;inset:0;z-index:12000;background:rgba(4,10,18,.62);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;backdrop-filter:blur(3px);overflow:auto;-webkit-overflow-scrolling:touch}
html.keyboard-open .ccp-overlay{align-items:flex-start;padding-top:max(8px,env(safe-area-inset-top,0px))}
.ccp-dialog{width:min(340px,100%);max-width:100%;max-height:100%;background:linear-gradient(160deg,rgba(18,34,56,.98),rgba(10,20,32,.98));border:1px solid rgba(201,154,83,.4);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1);padding:16px 16px 14px;color:#e9e4d6;font-family:Segoe UI,Helvetica Neue,sans-serif;overflow:auto;box-sizing:border-box}
html.bright .ccp-dialog{background:linear-gradient(160deg,#fff,#f4f1ea);color:#122238;border-color:rgba(110,72,20,.35)}
.ccp-title{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;margin-bottom:8px}
.ccp-time-panel{min-width:0}
.ccp-face{position:relative;box-sizing:border-box;width:min(220px,100%,calc(100dvh - 280px),calc(100vh - 280px));aspect-ratio:1;height:auto;margin:8px auto 12px;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 35% 30%,rgba(87,179,171,.18),transparent 45%),radial-gradient(circle at 50% 50%,rgba(18,34,56,.9),rgba(8,14,22,1));border:2px solid rgba(201,154,83,.45);box-shadow:inset 0 0 30px rgba(0,0,0,.45),0 0 24px rgba(87,179,171,.15);touch-action:none;cursor:crosshair;flex-shrink:1;min-width:0;--ccp-hand-h:70px;--ccp-hand-m:90px}
html.bright .ccp-face{background:radial-gradient(circle at 35% 30%,rgba(23,102,95,.1),transparent 45%),#f7f5ef}
.ccp-center{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#c99a53;z-index:3;pointer-events:none}
.ccp-hand{position:absolute;left:50%;top:50%;width:2px;height:var(--ccp-hand-h);margin-top:calc(-1 * var(--ccp-hand-h));margin-left:-1px;background:#57b3ab;transform-origin:bottom center;border-radius:2px;z-index:2;transition:transform .12s ease,opacity .12s ease;pointer-events:none}
.ccp-hand.min{height:var(--ccp-hand-m);margin-top:calc(-1 * var(--ccp-hand-m));background:#c99a53;width:1.5px}
.ccp-hand.dragging{transition:none}
.ccp-hand.dim{opacity:.22}
.ccp-num{position:absolute;left:50%;top:50%;width:var(--ccp-num,28px);height:var(--ccp-num,28px);margin:calc(var(--ccp-num, 28px) / -2) 0 0 calc(var(--ccp-num, 28px) / -2);padding:0 !important;min-width:0 !important;min-height:0 !important;max-width:none;border:none !important;background:transparent;color:inherit;font:inherit;letter-spacing:normal;text-transform:none;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;font-size:var(--ccp-num-font,12px) !important;line-height:1;cursor:pointer;user-select:none;opacity:.9;z-index:4;-webkit-tap-highlight-color:transparent;box-sizing:border-box;box-shadow:none}
.ccp-num:hover,.ccp-num.active{background:rgba(201,154,83,.28);opacity:1;box-shadow:0 0 0 1px rgba(201,154,83,.5);border:none !important;color:inherit}
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
.ccp-ampm button{min-width:72px;padding:8px 12px;border-radius:10px;border:1px solid rgba(201,154,83,.35);background:rgba(0,0,0,.2);color:inherit;font-weight:700;cursor:pointer;letter-spacing:normal;text-transform:none}
.ccp-ampm button.active{background:rgba(87,179,171,.25);border-color:#57b3ab}
.ccp-actions{display:flex;gap:8px;justify-content:flex-end}
.ccp-actions button{padding:8px 14px;border-radius:10px;border:1px solid rgba(233,228,214,.2);background:rgba(0,0,0,.25);color:inherit;cursor:pointer;font-weight:600;letter-spacing:normal;text-transform:none}
.ccp-actions .ccp-ok{background:linear-gradient(180deg,rgba(87,179,171,.45),rgba(87,179,171,.2));border-color:#57b3ab}
.ccp-tabs{display:flex;gap:8px;margin-bottom:12px}
.ccp-tabs button{flex:1;min-height:40px;padding:8px 10px;border-radius:10px;border:1px solid rgba(201,154,83,.35);background:rgba(0,0,0,.2);color:inherit;font-weight:700;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;font-size:11px}
.ccp-tabs button.active{background:rgba(87,179,171,.25);border-color:#57b3ab}
.ccp-date-readout{text-align:center;font-variant-numeric:tabular-nums;font-size:1.15rem;font-weight:700;letter-spacing:.04em;margin-bottom:10px}
.ccp-date-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.ccp-date-nav button{min-width:44px;min-height:40px;border-radius:10px;border:1px solid rgba(201,154,83,.35);background:rgba(0,0,0,.2);color:inherit;font-weight:700;cursor:pointer;font-size:18px;line-height:1}
.ccp-date-nav span{flex:1;text-align:center;font-weight:700;font-size:13px;letter-spacing:.04em}
.ccp-date-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px}
.ccp-day-head{text-align:center;font-size:10px;font-weight:700;opacity:.55;padding:2px 0}
.ccp-day{min-height:36px;padding:0;border-radius:8px;border:1px solid transparent;background:rgba(0,0,0,.15);color:inherit;font-weight:600;font-size:12px;cursor:pointer;letter-spacing:normal;text-transform:none}
.ccp-day:hover{background:rgba(201,154,83,.18)}
.ccp-day.other{opacity:.35}
.ccp-day.today{box-shadow:0 0 0 1px rgba(87,179,171,.55)}
.ccp-day.selected{background:rgba(87,179,171,.32);border-color:#57b3ab}
html.bright .ccp-day{background:rgba(18,34,56,.06)}
input.ccp-bound{cursor:pointer}
/* Tablet + Windows / desktop: larger type. The dial stays a square that
   fits the shorter side, so a 1366×768 or 150%-scaled 1080p screen does
   not clip a fixed 400px face. */
@media (min-width:721px) and (min-height:480px), (min-width:900px) and (hover:hover) and (pointer:fine){
  .ccp-dialog{width:min(520px,100%);padding:22px 24px 20px;border-radius:22px}
  .ccp-title{font-size:14px;margin-bottom:12px}
  .ccp-face{width:min(360px,100%,calc(100dvh - 300px),calc(100vh - 300px));height:auto;margin:14px auto 18px}
  .ccp-center{width:14px;height:14px;margin:-7px 0 0 -7px}
  .ccp-tick{height:10px;margin-top:-5px}
  .ccp-tick.major{height:15px;margin-top:-7.5px}
  .ccp-readout{font-size:2.4rem;margin-bottom:14px}
  .ccp-readout .ccp-part{padding:8px 10px;border-radius:10px}
  .ccp-step{font-size:14px;margin-bottom:10px}
  .ccp-hint{font-size:13px;margin:-2px 0 12px}
  .ccp-ampm button{min-width:96px;min-height:48px;padding:12px 18px;font-size:16px;border-radius:12px}
  .ccp-actions button{min-height:48px;padding:12px 20px;font-size:16px;border-radius:12px}
}
@media (min-width:1100px) and (min-height:640px){
  .ccp-dialog{width:min(600px,100%);padding:24px 28px 22px}
  .ccp-face{width:min(420px,100%,calc(100dvh - 320px),calc(100vh - 320px));height:auto;margin:16px auto 20px}
  .ccp-readout{font-size:2.7rem}
  .ccp-title{font-size:15px}
}
`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function parseDateParts(datePart) {
    const m = String(datePart || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
    }
    const now = new Date();
    return { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
  }

  function formatDatePart(y, mo, d) {
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  function daysInMonth(y, mo) {
    return new Date(y, mo, 0).getDate();
  }

  function clampDay(y, mo, d) {
    const dim = daysInMonth(y, mo);
    let day = Math.round(Number(d));
    if (!Number.isFinite(day)) day = 1;
    if (day < 1) day = 1;
    if (day > dim) day = dim;
    return day;
  }

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
      if (L.onViewport) {
        window.removeEventListener('resize', L.onViewport);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', L.onViewport);
          window.visualViewport.removeEventListener('scroll', L.onViewport);
        }
      }
      if (L.dprMq && L.onDpr) L.dprMq.removeEventListener('change', L.onDpr);
    } catch (_) { /* ignore */ }
    active.listeners = null;
  }

  function close() {
    if (active && active.faceObserver) {
      try { active.faceObserver.disconnect(); } catch (_) {}
    }
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
    const parsed = parseValue(el);
    const dp = parseDateParts(parsed.datePart);
    const state = Object.assign({
      step: 'hour',
      tab: 'time',
      y: dp.y,
      mo: dp.mo,
      d: dp.d,
      viewY: dp.y,
      viewMo: dp.mo,
      datePart: parsed.datePart || formatDatePart(dp.y, dp.mo, dp.d),
    }, parsed);
    const isDateTime = el.type === 'datetime-local';
    const overlay = document.createElement('div');
    overlay.className = 'ccp-overlay';
    overlay.innerHTML = `
      <div class="ccp-dialog" role="dialog" aria-modal="true" aria-label="${isDateTime ? 'Date and time picker' : 'Time picker'}">
        <div class="ccp-title">${isDateTime ? "Ship's date &amp; time" : 'Ship clock'}</div>
        <div class="ccp-tabs" data-ccp-tabs ${isDateTime ? '' : 'hidden'}>
          <button type="button" data-ccp-tab="date">Date</button>
          <button type="button" data-ccp-tab="time">Time</button>
        </div>
        <div class="ccp-date-panel" data-ccp-date hidden>
          <div class="ccp-date-readout" data-ccp-date-readout></div>
          <div class="ccp-date-nav">
            <button type="button" data-ccp-prev-month aria-label="Previous month">‹</button>
            <span data-ccp-month-label></span>
            <button type="button" data-ccp-next-month aria-label="Next month">›</button>
          </div>
          <div class="ccp-date-grid" data-ccp-date-grid></div>
          <div class="ccp-hint">Pick the report date, then switch to Time for the ship's clock.</div>
        </div>
        <div class="ccp-time-panel" data-ccp-time-panel>
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
        </div>
        <div class="ccp-actions">
          <button type="button" data-ccp-cancel>Cancel</button>
          <button type="button" class="ccp-ok" data-ccp-ok>Set</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const tabsRow = overlay.querySelector('[data-ccp-tabs]');
    const datePanel = overlay.querySelector('[data-ccp-date]');
    const timePanel = overlay.querySelector('[data-ccp-time-panel]');
    const dateReadout = overlay.querySelector('[data-ccp-date-readout]');
    const monthLabel = overlay.querySelector('[data-ccp-month-label]');
    const dateGrid = overlay.querySelector('[data-ccp-date-grid]');
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
    let facePx = 0;
    let faceObserver = null;
    let inRefresh = false;
    let layoutQueued = false;

    /* Fit a square dial into the viewport that is on screen now. vw/vh and a
       fixed 340/400px face stay at the previous monitor's size for a frame
       after a resolution or DPI change, which clips the numerals. */
    function pinOverlay() {
      if (!desktopPointer()) {
        overlay.style.top = '';
        overlay.style.left = '';
        overlay.style.width = '';
        overlay.style.height = '';
        return;
      }
      const box = viewBox();
      if (!box.w || !box.h) return;
      overlay.style.top = '0px';
      overlay.style.left = '0px';
      overlay.style.width = box.w + 'px';
      overlay.style.height = box.h + 'px';
    }

    function applyFaceSize() {
      pinOverlay();
      if (isDateTime && state.tab === 'date') return;
      const box = viewBox();
      const dialog = overlay.querySelector('.ccp-dialog');
      if (!dialog || !box.w || !box.h) return;
      const cs = getComputedStyle(dialog);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const overlayCs = getComputedStyle(overlay);
      const overlayPad = (parseFloat(overlayCs.paddingTop) || 0) + (parseFloat(overlayCs.paddingBottom) || 0);
      let chrome = padY + overlayPad;
      overlay.querySelectorAll('.ccp-title,.ccp-tabs,.ccp-readout,.ccp-step,.ccp-hint,.ccp-ampm,.ccp-actions').forEach((el) => {
        if (!el || el.hidden) return;
        const r = el.getBoundingClientRect();
        if (!(r.height > 0)) return;
        const ecs = getComputedStyle(el);
        chrome += r.height + (parseFloat(ecs.marginTop) || 0) + (parseFloat(ecs.marginBottom) || 0);
      });
      const faceCs = getComputedStyle(face);
      chrome += (parseFloat(faceCs.marginTop) || 0) + (parseFloat(faceCs.marginBottom) || 0);
      if (chrome < 80) {
        chrome = box.w >= 721 ? 280 : 200;
        if (isDateTime) chrome += 52;
        if (state.step === 'ampm') chrome += 56;
      }
      const innerW = Math.max(0, (dialog.clientWidth || box.w) - padX);
      const cap = box.w >= 1100 && box.h >= 640 ? 420 : (box.w >= 721 ? 360 : 240);
      const size = Math.floor(Math.max(148, Math.min(cap, innerW, box.h - chrome - 8)));
      face.style.width = size + 'px';
      face.style.height = size + 'px';
      face.style.maxWidth = '100%';
      face.style.maxHeight = size + 'px';
    }

    function queueLayout() {
      if (layoutQueued) return;
      layoutQueued = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          layoutQueued = false;
          if (!active || active.overlay !== overlay) return;
          refresh({ keepNums: true });
          requestAnimationFrame(() => {
            if (!active || active.overlay !== overlay) return;
            refresh({ keepNums: true });
          });
        });
      });
    }

    /* Numeral box and type size follow the face that is actually on screen.
       A viewport shrink/grow changes the dial after the numbers were placed;
       measuring again keeps the digits the same scale as the dial. */
    function scaleFace() {
      const w = Math.round(face.clientWidth || 0);
      if (!w) return false;
      const num = Math.max(28, Math.round(w * 0.115));
      face.style.setProperty('--ccp-num', num + 'px');
      face.style.setProperty('--ccp-num-font', Math.max(12, Math.round(w * 0.045)) + 'px');
      face.style.setProperty('--ccp-hand-h', Math.round(w * 0.32) + 'px');
      face.style.setProperty('--ccp-hand-m', Math.round(w * 0.415) + 'px');
      if (w === facePx) return false;
      facePx = w;
      return true;
    }

    function syncDatePart() {
      state.d = clampDay(state.y, state.mo, state.d);
      state.datePart = formatDatePart(state.y, state.mo, state.d);
    }

    function setTab(tab) {
      state.tab = tab === 'date' ? 'date' : 'time';
      if (tabsRow) {
        tabsRow.querySelectorAll('[data-ccp-tab]').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-ccp-tab') === state.tab);
        });
      }
      if (datePanel) datePanel.hidden = state.tab !== 'date';
      if (timePanel) timePanel.hidden = state.tab !== 'time';
      refresh();
    }

    function renderDateGrid() {
      if (!dateGrid) return;
      dateGrid.innerHTML = '';
      DOW_LABELS.forEach((label) => {
        const head = document.createElement('div');
        head.className = 'ccp-day-head';
        head.textContent = label;
        dateGrid.appendChild(head);
      });
      const y = state.viewY;
      const mo = state.viewMo;
      const firstDow = new Date(y, mo - 1, 1).getDay();
      const dim = daysInMonth(y, mo);
      const prevDim = daysInMonth(y, mo - 1 < 1 ? 12 : mo - 1);
      const cells = [];
      for (let i = 0; i < firstDow; i++) {
        cells.push({ day: prevDim - firstDow + i + 1, other: true, moOff: -1 });
      }
      for (let day = 1; day <= dim; day++) cells.push({ day, other: false, moOff: 0 });
      let tailDay = 1;
      while (cells.length % 7 !== 0) {
        cells.push({ day: tailDay++, other: true, moOff: 1 });
      }
      const today = new Date();
      cells.forEach((cell) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ccp-day' + (cell.other ? ' other' : '');
        btn.textContent = String(cell.day);
        let cy = y;
        let cm = mo + cell.moOff;
        if (cm < 1) { cm = 12; cy -= 1; }
        if (cm > 12) { cm = 1; cy += 1; }
        if (
          cy === today.getFullYear() && cm === today.getMonth() + 1 && cell.day === today.getDate()
        ) btn.classList.add('today');
        if (cy === state.y && cm === state.mo && cell.day === state.d) btn.classList.add('selected');
        btn.onclick = (ev) => {
          ev.stopPropagation();
          state.y = cy;
          state.mo = cm;
          state.d = cell.day;
          state.viewY = cy;
          state.viewMo = cm;
          syncDatePart();
          refresh();
        };
        dateGrid.appendChild(btn);
      });
      if (monthLabel) {
        monthLabel.textContent = `${MONTH_LABELS[mo - 1]} ${y}`;
      }
      if (dateReadout) dateReadout.textContent = formatDatePart(state.y, state.mo, state.d);
    }

    function clearDecor() {
      face.querySelectorAll('.ccp-num, .ccp-tick').forEach((n) => n.remove());
    }

    function placeMinuteTicks() {
      const { tickR } = faceRadii(face);
      for (let i = 0; i < 60; i++) {
        const tick = document.createElement('div');
        tick.className = 'ccp-tick' + (i % 5 === 0 ? ' major' : '');
        tick.style.transform = `rotate(${i * 6}deg) translateY(-${tickR}px)`;
        face.appendChild(tick);
      }
    }

    function placeNums(count, mapLabel, mapVal) {
      const { numR } = faceRadii(face);
      for (let i = 0; i < count; i++) {
        const label = mapLabel(i);
        const val = mapVal ? mapVal(i) : label;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ccp-num';
        btn.textContent = label;
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        btn.style.transform = `translate(${Math.cos(angle) * numR}px, ${Math.sin(angle) * numR}px)`;
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
      if (inRefresh) return;
      inRefresh = true;
      try { refreshBody(opts); }
      finally { inRefresh = false; }
    }

    function refreshBody(opts) {
      pinOverlay();
      if (isDateTime && state.tab === 'date') {
        renderDateGrid();
        return;
      }
      const keepNums = opts && opts.keepNums;
      const { h, m } = to24(state.h12, state.m, state.isPm);
      suppressReadout = true;
      if (document.activeElement !== partH) partH.value = pad(h);
      if (document.activeElement !== partM) partM.value = pad(m);
      suppressReadout = false;
      partH.classList.toggle('active', state.step === 'hour' || state.step === 'ampm');
      partM.classList.toggle('active', state.step === 'minute');
      /* The hour hand sits on the highlighted numeral. Folding the minutes in
         would walk 11:59 onto the 12 while 11 stays lit. Minutes only ease the
         hour hand off its mark once the minute hand is the one being set. */
      const hAngle = ((state.h12 % 12) / 12) * 360
        + (state.step === 'minute' ? (state.m / 60) * 30 : 0);
      const mAngle = state.m * 6;
      handH.style.transform = `rotate(${hAngle}deg)`;
      handM.style.transform = `rotate(${mAngle}deg)`;
      handH.classList.toggle('dragging', dragging && (state.step === 'hour' || state.step === 'ampm'));
      handM.classList.toggle('dragging', dragging && state.step === 'minute');
      handH.classList.toggle('dim', state.step === 'minute');
      handM.classList.toggle('dim', state.step === 'hour' || state.step === 'ampm');

      if (state.step === 'ampm') {
        ampmRow.hidden = false;
        ampmRow.style.display = '';
      } else {
        ampmRow.hidden = true;
        ampmRow.style.display = 'none';
      }
      applyFaceSize();
      if (scaleFace()) lastStep = null;
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
      if (commit) {
        if (isDateTime) syncDatePart();
        writeValue(el, state);
      }
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
    if (tabsRow) {
      tabsRow.querySelectorAll('[data-ccp-tab]').forEach((btn) => {
        btn.onclick = () => setTab(btn.getAttribute('data-ccp-tab'));
      });
    }
    const prevMo = overlay.querySelector('[data-ccp-prev-month]');
    const nextMo = overlay.querySelector('[data-ccp-next-month]');
    if (prevMo) {
      prevMo.onclick = () => {
        state.viewMo -= 1;
        if (state.viewMo < 1) { state.viewMo = 12; state.viewY -= 1; }
        refresh();
      };
    }
    if (nextMo) {
      nextMo.onclick = () => {
        state.viewMo += 1;
        if (state.viewMo > 12) { state.viewMo = 1; state.viewY += 1; }
        refresh();
      };
    }

    overlay.querySelector('[data-ccp-cancel]').onclick = () => finish(false);
    overlay.querySelector('[data-ccp-ok]').onclick = () => {
      if (isDateTime && state.tab === 'date') {
        syncDatePart();
        finish(true);
        return;
      }
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

    if (typeof ResizeObserver !== 'undefined') {
      faceObserver = new ResizeObserver(() => {
        if (inRefresh) return;
        if (!scaleFace()) return;
        lastStep = null;
        refresh({ keepNums: true });
      });
      faceObserver.observe(face);
    }
    function onViewport() { queueLayout(); }
    let dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    function onDpr() {
      try { dprMq.removeEventListener('change', onDpr); } catch (_) {}
      dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprMq.addEventListener('change', onDpr);
      if (active && active.listeners) active.listeners.dprMq = dprMq;
      queueLayout();
    }
    window.addEventListener('resize', onViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewport);
      window.visualViewport.addEventListener('scroll', onViewport);
    }
    dprMq.addEventListener('change', onDpr);
    active = {
      overlay,
      el,
      faceObserver,
      listeners: { pointerMove, pointerUp, onKey, onViewport, onDpr, dprMq },
    };
    if (isDateTime) setTab('time');
    else refresh();
    requestAnimationFrame(() => {
      if (!active || active.overlay !== overlay) return;
      refresh({ keepNums: true });
    });
    try {
      if (state.tab === 'time') { partH.focus(); partH.select(); }
    } catch (_) {}
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
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      open(el);
    });
    /* Opening on every focus painted a full-screen overlay the first time a
       page with a time field loaded, and nothing on the sheet could be typed. */
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
