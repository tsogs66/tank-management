/* Page zoom for every page of the app (Voyage Chief, Tank Chief, ChEng AIO).
 * A small magnifier button in the lower-left corner opens − / % / + (the % button goes back to 100 %). Ctrl/Cmd + + / − / 0 and Ctrl + mouse wheel do the same,
 * on the phone a two-finger pinch zooms as usual. The level is remembered for this page on this device.
 * Text boxes whose text is longer than the box show the whole text as a tooltip on hover or focus. Not printed. */
(function () {
  'use strict';
  if (window.__chengUiZoom) return;
  window.__chengUiZoom = true;
  var STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  var embedded = false;
  try { embedded = window.parent !== window; } catch (e) { embedded = true; }
  var seg = (location.pathname.split('/').filter(Boolean)[0] || 'root').replace(/[^\w.-]/g, '');
  var KEY = 'cheng-ui-zoom:' + (embedded ? 'frame:' : 'page:') + seg;
  var level = 1;
  function read() { try { var v = Number(localStorage.getItem(KEY)); return v >= 0.5 && v <= 3 ? v : 1; } catch (e) { return 1; } }
  function save() { try { if (level === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(level)); } catch (e) { /* private mode */ } }
  var label = null, box = null;
  function apply() {
    document.documentElement.style.zoom = level === 1 ? '' : String(level);
    if (label) label.textContent = Math.round(level * 100) + '%';
    if (box) box.classList.toggle('on', level !== 1);
    save();
  }
  function setLevel(v) { level = Math.max(0.5, Math.min(3, Math.round(v * 100) / 100)); apply(); }
  function step(dir) {
    var i = 0, best = 1e9;
    STEPS.forEach(function (s, k) { var d = Math.abs(s - level); if (d < best) { best = d; i = k; } });
    var j = Math.max(0, Math.min(STEPS.length - 1, i + dir));
    if (dir > 0 && STEPS[i] <= level + 0.001 && j === i && i < STEPS.length - 1) j = i + 1;
    setLevel(STEPS[j]);
  }

  function css() {
    var st = document.createElement('style');
    st.textContent = '#cheng-zoom{position:fixed;left:8px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:2147483000;font:600 13px/1 system-ui,Segoe UI,sans-serif;display:flex;align-items:center;gap:2px;'
      + 'background:rgba(20,32,46,.86);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:20px;padding:2px;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.55;transition:opacity .15s;touch-action:manipulation}'
      + '#cheng-zoom:hover,#cheng-zoom:focus-within,#cheng-zoom.open,#cheng-zoom.on{opacity:1}'
      + '#cheng-zoom button{all:unset;box-sizing:border-box;min-width:34px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:15px;cursor:pointer;padding:0 6px;color:#fff;font-size:16px}'
      + '#cheng-zoom button:hover,#cheng-zoom button:focus-visible{background:rgba(255,255,255,.2)}'
      + '#cheng-zoom .cz-more{display:none}#cheng-zoom.open .cz-more{display:inline-flex}'
      + '#cheng-zoom .cz-pct{font-size:12px;min-width:46px}'
      + '@media print{#cheng-zoom{display:none!important}html{zoom:1!important}}';
    document.head.appendChild(st);
  }
  function build() {
    if (!document.body || document.getElementById('cheng-zoom')) return;
    css();
    box = document.createElement('div'); box.id = 'cheng-zoom'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Page zoom'); box.setAttribute('data-no-print', '');
    box.innerHTML = '<button type="button" class="cz-toggle" title="Zoom the page (Ctrl + / Ctrl − / Ctrl 0, or Ctrl + mouse wheel)" aria-label="Zoom">&#128269;</button>'
      + '<button type="button" class="cz-more cz-out" title="Smaller" aria-label="Zoom out">&minus;</button>'
      + '<button type="button" class="cz-more cz-pct" title="Back to 100 %" aria-label="Zoom level, press for 100 percent">100%</button>'
      + '<button type="button" class="cz-more cz-in" title="Larger" aria-label="Zoom in">+</button>';
    label = box.querySelector('.cz-pct');
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b) return;
      if (b.classList.contains('cz-toggle')) box.classList.toggle('open');
      else if (b.classList.contains('cz-out')) step(-1);
      else if (b.classList.contains('cz-in')) step(1);
      else if (b.classList.contains('cz-pct')) setLevel(1);
    });
    document.body.appendChild(box);
    apply();
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key;
    if (k === '+' || k === '=') { e.preventDefault(); step(1); }
    else if (k === '-' || k === '_') { e.preventDefault(); step(-1); }
    else if (k === '0') { e.preventDefault(); setLevel(1); }
  }, true);
  document.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false, capture: true });

  /* A text box that cuts its text off shows the whole text as a tooltip. */
  function tip(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var t = el.tagName;
    if (t !== 'INPUT' && t !== 'SELECT' && t !== 'TEXTAREA') return;
    if (t === 'INPUT' && !/^(text|search|number|email|tel|url|date|time|datetime-local)?$/i.test(el.type || '')) return;
    var text = t === 'SELECT' ? ((el.options[el.selectedIndex] || {}).text || '') : (el.value || '');
    var auto = el.getAttribute('data-cz-tip') === '1';
    if (el.title && !auto) return;
    var clipped = el.scrollWidth > el.clientWidth + 1 || (t === 'SELECT' && text.length * 7 > el.clientWidth);
    if (clipped && text) { el.title = text; el.setAttribute('data-cz-tip', '1'); }
    else if (auto) { el.removeAttribute('title'); el.removeAttribute('data-cz-tip'); }
  }
  document.addEventListener('mouseover', tip, true);
  document.addEventListener('focusin', tip, true);

  level = read();
  if (level !== 1) document.documentElement.style.zoom = String(level);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  window.ChengUiZoom = { set: setLevel, get: function () { return level; }, step: step };
})();
