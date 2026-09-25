/**
 * Signed decimals on phones/tablets: Android's decimal numpad (inputmode=decimal)
 * has no minus key. Heel, trim, and calibration grids need −.
 *
 * Touch/coarse: keep inputmode=decimal for the numeric pad + show a small − / .
 * accessory above the keyboard. Desktop: inputmode=text (full keyboard, pen-friendly).
 */
(function (global) {
  'use strict';

  const SIGNED_SELECTOR = [
    '[data-head="heel"]',
    '#in-trim',
    '#in-list',
    '#v-trim',
    '#v-heel',
    '#dim-target-trim',
    '#dim-target-heel',
    '.dim-axis',
    '[data-dim-cell]',
    '[data-excel="trimVal"]',
    '[data-excel="listVal"]',
    '[data-excel="rowAxis"]',
    '[data-excel="soundAxis"]',
    '[data-excel="listAxis"]',
    '[data-excel="trimGrid"]',
    '[data-excel="listGrid"]',
    '[data-survey-corr]',
  ].join(',');

  let accessoryEl = null;
  let accessoryTarget = null;

  function touchLike() {
    try {
      if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
      if ((navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(max-width: 1180px)').matches) {
        return true;
      }
    } catch (_e) { /* ignore */ }
    return false;
  }

  function isSignedField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (el.readOnly || el.disabled) return false;
    if (el.dataset.signed === '1') return true;
    try {
      if (el.matches(SIGNED_SELECTOR)) return true;
    } catch (_e) { /* ignore */ }
    return false;
  }

  function prepareSigned(el) {
    if (!el || el.tagName !== 'INPUT' || el.dataset.signedReady === '1') return;
    if (!isSignedField(el) && el.dataset.signed !== '1') return;
    if (String(el.type || '').toLowerCase() === 'number') el.type = 'text';
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('inputmode', touchLike() ? 'decimal' : 'text');
    el.dataset.signed = '1';
    el.dataset.signedReady = '1';
  }

  /** Optional leading +/−, digits, one decimal separator while typing. */
  function coerceSignedNumericInput(el) {
    if (!el || el.dataset.signed !== '1') return;
    /* Voyage log entry runs its own coerceSurveyCorrectionInput (+/− semantics). */
    if (el.dataset.surveyCorr != null) return;
    const raw = String(el.value ?? '');
    let out = '';
    let i = 0;
    const first = raw.charAt(0);
    if (first === '+' || first === '-') out = first, i = 1;
    else if (first === '\u2212') { out = '-'; i = 1; }
    let seenDot = false;
    for (; i < raw.length; i++) {
      const c = raw.charAt(i);
      if (c >= '0' && c <= '9') out += c;
      else if ((c === '.' || c === ',') && !seenDot) { out += '.'; seenDot = true; }
    }
    if (out === raw) return;
    let start = null;
    try { start = el.selectionStart; } catch (_e) { /* ignore */ }
    el.value = out;
    try {
      const pos = Math.min(out.length, start != null ? start : out.length);
      el.setSelectionRange(pos, pos);
    } catch (_e) { /* ignore */ }
  }

  function insertAtCaret(el, text) {
    if (!el || el.readOnly || el.disabled) return;
    const val = String(el.value ?? '');
    let start = val.length;
    let end = val.length;
    try {
      start = el.selectionStart != null ? el.selectionStart : val.length;
      end = el.selectionEnd != null ? el.selectionEnd : start;
    } catch (_e) { /* ignore */ }
    const next = val.slice(0, start) + text + val.slice(end);
    el.value = next;
    coerceSignedNumericInput(el);
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (_e) { /* ignore */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function ensureAccessoryCss() {
    if (document.getElementById('tms-signed-accessory-css')) return;
    const s = document.createElement('style');
    s.id = 'tms-signed-accessory-css';
    s.textContent = `
.tms-signed-accessory{
  position:fixed;left:0;right:0;z-index:13050;display:none;gap:8px;justify-content:center;
  padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));
  background:linear-gradient(180deg,rgba(10,18,28,.94),rgba(6,12,20,.98));
  border-top:1px solid rgba(201,154,83,.35);
  box-shadow:0 -8px 24px rgba(0,0,0,.35);
}
html.bright .tms-signed-accessory{background:linear-gradient(180deg,#f4f1ea,#ebe6dc);border-color:rgba(18,34,56,.12);}
.tms-signed-accessory.open{display:flex;}
.tms-signed-accessory button{
  min-width:72px;min-height:48px;padding:10px 16px;border-radius:12px;
  border:1px solid rgba(201,154,83,.45);background:rgba(0,0,0,.28);color:inherit;
  font-size:22px;font-weight:700;cursor:pointer;letter-spacing:normal;text-transform:none;
}
html.bright .tms-signed-accessory button{background:#fff;color:#122238;}
.tms-signed-accessory button:active{transform:scale(.97);}
.tms-signed-accessory .tms-sa-label{font-size:11px;align-self:center;opacity:.65;text-transform:uppercase;letter-spacing:.08em;margin-right:4px;}
`;
    document.head.appendChild(s);
  }

  function ensureAccessory() {
    ensureAccessoryCss();
    if (accessoryEl) return accessoryEl;
    const bar = document.createElement('div');
    bar.className = 'tms-signed-accessory';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Signed number keys');
    bar.innerHTML = `<span class="tms-sa-label">Insert</span>
      <button type="button" data-tms-ins="+" aria-label="Plus">+</button>
      <button type="button" data-tms-ins="−" aria-label="Minus">−</button>
      <button type="button" data-tms-ins="." aria-label="Decimal point">.</button>`;
    bar.addEventListener('mousedown', (e) => { e.preventDefault(); });
    bar.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tms-ins]');
      if (!btn || !accessoryTarget) return;
      const ch = btn.getAttribute('data-tms-ins');
      insertAtCaret(accessoryTarget, ch === '−' ? '-' : ch);
      accessoryTarget.focus();
    });
    document.body.appendChild(bar);
    accessoryEl = bar;
    return bar;
  }

  function positionAccessory() {
    if (!accessoryEl || !accessoryEl.classList.contains('open')) return;
    let bottom = 0;
    try {
      const vv = window.visualViewport;
      if (vv) {
        bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      }
    } catch (_e) { /* ignore */ }
    accessoryEl.style.bottom = `${bottom}px`;
  }

  function showAccessory(el) {
    if (!touchLike() || !el) return;
    accessoryTarget = el;
    const bar = ensureAccessory();
    bar.classList.add('open');
    document.documentElement.classList.add('keyboard-open');
    positionAccessory();
  }

  function hideAccessory() {
    if (accessoryEl) accessoryEl.classList.remove('open');
    accessoryTarget = null;
    if (!document.querySelector('input:focus, textarea:focus')) {
      document.documentElement.classList.remove('keyboard-open');
    }
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    try {
      scope.querySelectorAll(SIGNED_SELECTOR).forEach(prepareSigned);
      scope.querySelectorAll('[data-signed="1"]').forEach(prepareSigned);
    } catch (_e) { /* ignore */ }
    if (typeof Element !== 'undefined' && root instanceof Element
      && root.matches?.('input') && isSignedField(root)) {
      prepareSigned(root);
    }
  }

  function bind() {
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!isSignedField(el)) return;
      prepareSigned(el);
      showAccessory(el);
    }, true);
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (isSignedField(active)) {
          accessoryTarget = active;
          return;
        }
        hideAccessory();
      }, 80);
    }, true);
    document.addEventListener('input', (e) => {
      if (e.target?.dataset?.signed === '1') coerceSignedNumericInput(e.target);
    }, true);
    try {
      window.visualViewport?.addEventListener('resize', positionAccessory);
      window.visualViewport?.addEventListener('scroll', positionAccessory);
    } catch (_e) { /* ignore */ }
    if (typeof MutationObserver !== 'undefined') {
      let queued = false;
      const obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; scan(document); }, 0);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scan(document));
    } else {
      scan(document);
    }
  }

  bind();

  global.TmsSignedNumeric = {
    touchLike,
    prepareSigned,
    coerceSignedNumericInput,
    scan,
    isSignedField,
  };
}(typeof window !== 'undefined' ? window : globalThis));
