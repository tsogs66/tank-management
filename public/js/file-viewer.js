/*
 * File viewer with zoom — one copy per program (Tank Chief, Voyage Chief, ChEng AIO shell).
 *
 * Anything the user uploads or captures (BDN photos, voyage photos, stamp and signature
 * images, requisition and BDN documents) opens here instead of a new browser tab. A new
 * tab does not exist inside the Android app or the AIO frame, and a 220px thumbnail is not
 * a way to read a BDN. The viewer is an in-page full-screen layer, so it behaves the same
 * on Windows (mouse, wheel, keyboard) and on a phone or tablet (pinch, drag, double tap).
 *
 *   ChengFileViewer.open({ src, mime, filename, title })   image or PDF by data:/blob: URL
 *   ChengFileViewer.openHtml(html, { title, onPrint })      a document preview (reports, cards)
 *   ChengFileViewer.close()
 *
 * Any <img data-viewer> on the page opens in the viewer when it is clicked or tapped.
 */
(function (root) {
  'use strict';
  if (root.ChengFileViewer) return;

  var MIN = 0.02, MAX = 8;
  var ui = null;
  var state = null;

  var CSS = [
    '.cfv-layer{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#060a12;color:#eef2f8;font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}',
    '.cfv-layer[hidden]{display:none;}',
    '.cfv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;background:#101826;border-bottom:1px solid #2a3550;padding-top:max(8px,env(safe-area-inset-top));}',
    '.cfv-title{flex:1 1 140px;min-width:0;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.cfv-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 12px;border:1px solid #3a4a6a;border-radius:8px;background:#1b2740;color:#eef2f8;font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;text-transform:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
    '.cfv-btn::before,.cfv-btn::after{content:none !important;display:none !important;}',
    '.cfv-btn:hover{background:#26365a;}',
    '.cfv-btn:focus-visible{outline:2px solid #f0b94a;outline-offset:1px;}',
    '.cfv-layer .cfv-btn.cfv-close{background:#5a2330;border-color:#8a3a4a;}',
    '.cfv-pct{min-width:56px;text-align:center;font-size:13px;color:#b8c4d8;}',
    '.cfv-stage{flex:1 1 auto;min-height:0;overflow:auto;display:flex;touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none;outline:none;overscroll-behavior:contain;}',
    '.cfv-stage.cfv-drag{cursor:grabbing;}',
    '.cfv-holder{margin:auto;flex:0 0 auto;position:relative;}',
    '.cfv-holder img{display:block;max-width:none;box-shadow:0 2px 18px rgba(0,0,0,.6);background:#fff;-webkit-user-drag:none;}',
    '.cfv-holder iframe{position:absolute;left:0;top:0;border:0;background:#fff;transform-origin:0 0;pointer-events:none;box-shadow:0 2px 18px rgba(0,0,0,.6);}',
    '.cfv-note{margin:auto;max-width:420px;padding:20px;text-align:center;font-size:14px;line-height:1.5;color:#cfd8e8;}',
    '.cfv-pdf{flex:1 1 auto;min-height:0;border:0;background:#fff;width:100%;}',
    'img[data-viewer]{cursor:zoom-in;}',
    '@media (max-width:520px){.cfv-btn{padding:0 10px;}.cfv-pct{min-width:46px;}}',
    '@media (max-width:420px){.cfv-layer .cfv-one{display:none;}.cfv-bar{gap:4px;}.cfv-btn{padding:0 8px;}}'
  ].join('\n');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(label, title, cls, fn) {
    var b = el('button', 'cfv-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    return b;
  }

  function build() {
    if (ui) return ui;
    var style = document.createElement('style');
    style.id = 'cfv-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var layer = el('div', 'cfv-layer');
    layer.hidden = true;
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'File viewer');
    var bar = el('div', 'cfv-bar');
    var title = el('div', 'cfv-title');
    var out = button('−', 'Zoom out (-)', '', function () { zoomBy(1 / 1.25); });
    var pct = el('span', 'cfv-pct', '100%');
    var inn = button('+', 'Zoom in (+)', '', function () { zoomBy(1.25); });
    var fit = button('Fit', 'Fit to screen (0)', '', function () { fitToStage(); });
    var one = button('1:1', 'Actual size', 'cfv-one', function () { setScale(1); });
    var save = button('Save', 'Save or open the original file', '', function () { saveOriginal(); });
    var print = button('Print', 'Print this document', '', function () { if (state && state.onPrint) state.onPrint(); });
    var close = button('✕', 'Close (Esc)', 'cfv-close', function () { close_(); });
    [title, out, pct, inn, fit, one, save, print, close].forEach(function (n) { bar.appendChild(n); });
    var stage = el('div', 'cfv-stage');
    stage.tabIndex = 0;
    layer.appendChild(bar);
    layer.appendChild(stage);
    document.body.appendChild(layer);
    ui = { layer: layer, title: title, pct: pct, stage: stage, save: save, print: print, one: one, fit: fit, out: out, inn: inn };
    wireGestures(stage);
    layer.addEventListener('keydown', onKey);
    return ui;
  }

  /* ---- zoom ---- */

  function applyScale(focalX, focalY) {
    if (!state || !state.holder) return;
    var w = Math.round(state.w0 * state.scale), h = Math.round(state.h0 * state.scale);
    state.holder.style.width = w + 'px';
    state.holder.style.height = h + 'px';
    if (state.kind === 'image') {
      state.node.style.width = w + 'px';
      state.node.style.height = h + 'px';
    } else {
      state.node.style.transform = 'scale(' + state.scale + ')';
    }
    ui.pct.textContent = Math.round(state.scale * 100) + '%';
  }

  function setScale(next, clientX, clientY) {
    if (!state || !state.holder) return;
    next = Math.max(MIN, Math.min(MAX, next));
    var stage = ui.stage;
    var rect = stage.getBoundingClientRect();
    var fx = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
    var fy = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
    /* The point under the finger / cursor stays under it. */
    var hr = state.holder.getBoundingClientRect();
    var relX = (rect.left + fx - hr.left) / (hr.width || 1);
    var relY = (rect.top + fy - hr.top) / (hr.height || 1);
    state.scale = next;
    applyScale();
    var nr = state.holder.getBoundingClientRect();
    stage.scrollLeft += (nr.left + relX * nr.width) - (rect.left + fx);
    stage.scrollTop += (nr.top + relY * nr.height) - (rect.top + fy);
  }

  function zoomBy(factor, x, y) {
    if (!state) return;
    setScale(state.scale * factor, x, y);
  }

  function fitScale() {
    var stage = ui.stage;
    var aw = Math.max(50, stage.clientWidth - 24), ah = Math.max(50, stage.clientHeight - 24);
    var s = state.kind === 'html' ? aw / state.w0 : Math.min(aw / state.w0, ah / state.h0);
    return Math.max(MIN, Math.min(4, s));
  }

  function fitToStage() {
    if (!state || !state.holder) return;
    state.scale = fitScale();
    state.fit = state.scale;
    applyScale();
    ui.stage.scrollLeft = 0;
    ui.stage.scrollTop = 0;
  }

  function wireGestures(stage) {
    var pointers = {};
    var pinch = null, pan = null, lastTap = 0;
    function count() { return Object.keys(pointers).length; }
    function dist() {
      var k = Object.keys(pointers);
      var a = pointers[k[0]], b = pointers[k[1]];
      return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
    }
    function mid() {
      var k = Object.keys(pointers);
      var a = pointers[k[0]], b = pointers[k[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    stage.addEventListener('pointerdown', function (e) {
      if (!state || !state.holder) return;
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() === 2) {
        pinch = { d: dist(), s: state.scale };
        pan = null;
      } else if (count() === 1) {
        pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false };
        stage.classList.add('cfv-drag');
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && count() >= 2) {
        var m = mid();
        setScale(pinch.s * (dist() / pinch.d), m.x, m.y);
      } else if (pan && count() === 1) {
        var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
        stage.scrollLeft = pan.sl - dx;
        stage.scrollTop = pan.st - dy;
      }
    });
    function end(e) {
      if (!pointers[e.pointerId]) return;
      var wasPan = pan;
      delete pointers[e.pointerId];
      try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      if (count() < 2) pinch = null;
      if (count() === 0) {
        stage.classList.remove('cfv-drag');
        /* A tap that did not move: second one inside 350ms toggles fit / 2.5x. */
        if (e.type === 'pointerup' && wasPan && !wasPan.moved) {
          var now = Date.now();
          if (now - lastTap < 350) {
            lastTap = 0;
            if (state && state.holder) {
              if (state.scale > (state.fit || 1) * 1.2) fitToStage();
              else setScale((state.fit || 1) * 2.5, e.clientX, e.clientY);
            }
          } else lastTap = now;
        }
        pan = null;
      } else if (count() === 1) {
        var k = Object.keys(pointers)[0];
        pan = { x: pointers[k].x, y: pointers[k].y, sl: stage.scrollLeft, st: stage.scrollTop, moved: true };
      }
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', function (e) {
      if (!state || !state.holder) return;
      e.preventDefault();
      /* Ctrl+wheel (and a trackpad pinch) zoom; a plain wheel scrolls the picture. */
      if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
      else { stage.scrollTop += e.deltaY; stage.scrollLeft += e.deltaX; }
    }, { passive: false });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close_(); return; }
    if (!state || !state.holder) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.25); }
    else if (e.key === '0') { e.preventDefault(); fitToStage(); }
    else if (e.key === 'ArrowLeft') ui.stage.scrollLeft -= 60;
    else if (e.key === 'ArrowRight') ui.stage.scrollLeft += 60;
    else if (e.key === 'ArrowUp') ui.stage.scrollTop -= 60;
    else if (e.key === 'ArrowDown') ui.stage.scrollTop += 60;
  }

  /* ---- opening ---- */

  function reset(titleText) {
    build();
    release();
    ui.stage.textContent = '';
    ui.title.textContent = titleText || 'Viewer';
    state = { kind: null, scale: 1, fit: 1, w0: 1, h0: 1, holder: null, node: null, src: null, filename: '', onPrint: null, opener: document.activeElement };
    ui.save.style.display = 'none';
    ui.print.style.display = 'none';
    [ui.out, ui.inn, ui.fit, ui.one, ui.pct].forEach(function (n) { n.style.display = ''; });
    ui.layer.hidden = false;
    try { ui.stage.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  function release() {
    if (state && state.objectUrl) { try { URL.revokeObjectURL(state.objectUrl); } catch (_) { /* ignore */ } }
  }

  function isPdf(src, mime, filename) {
    if (mime) return /pdf/i.test(mime);
    if (/^data:application\/pdf/i.test(src || '')) return true;
    return /\.pdf$/i.test(filename || '');
  }

  function note(text) {
    ui.stage.textContent = '';
    ui.stage.style.cursor = 'default';
    var n = el('div', 'cfv-note', text);
    ui.stage.appendChild(n);
    [ui.out, ui.inn, ui.fit, ui.one, ui.pct].forEach(function (b) { b.style.display = 'none'; });
  }

  function dataUrlToBlob(src) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(src);
    if (!m) return null;
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  }

  function open(opts) {
    opts = opts || {};
    var src = opts.src || opts.dataUrl;
    if (!src) return;
    reset(opts.title || opts.filename || 'Photo');
    state.src = src;
    state.filename = opts.filename || '';
    ui.save.style.display = '';
    if (isPdf(src, opts.mime, opts.filename)) { openPdf(src); return; }
    state.kind = 'image';
    var img = new Image();
    img.alt = opts.title || opts.filename || 'Photo';
    img.draggable = false;
    img.onload = function () {
      state.w0 = img.naturalWidth || 1;
      state.h0 = img.naturalHeight || 1;
      var holder = el('div', 'cfv-holder');
      holder.appendChild(img);
      ui.stage.textContent = '';
      ui.stage.style.cursor = '';
      ui.stage.appendChild(holder);
      state.holder = holder;
      state.node = img;
      [ui.out, ui.inn, ui.fit, ui.one, ui.pct].forEach(function (n) { n.style.display = ''; });
      fitToStage();
    };
    img.onerror = function () { note('This file could not be shown. Use Save to open it with another app.'); };
    note('Loading…');
    ui.save.style.display = '';
    img.src = src;
  }

  function openPdf(src) {
    state.kind = 'pdf';
    var blob = dataUrlToBlob(src);
    var url = blob ? URL.createObjectURL(blob) : src;
    if (blob) state.objectUrl = url;
    state.blobUrl = url;
    /* Desktop Chromium / Electron render PDFs inline with their own zoom. Android's WebView does
       not, so there the file is handed to Save, which opens it in the device's PDF app. */
    var inline = !!(navigator.pdfViewerEnabled || (navigator.mimeTypes && navigator.mimeTypes['application/pdf']));
    if (inline) {
      ui.stage.textContent = '';
      ui.stage.style.cursor = 'default';
      ui.stage.style.touchAction = 'auto';
      var f = el('iframe', 'cfv-pdf');
      f.src = url;
      f.title = 'PDF';
      ui.stage.appendChild(f);
      [ui.one, ui.fit, ui.out, ui.inn, ui.pct].forEach(function (b) { b.style.display = 'none'; });
    } else {
      note('This device cannot show a PDF inside the app. Press Save to open it in your PDF viewer, where you can zoom.');
    }
  }

  function openHtml(html, opts) {
    opts = opts || {};
    reset(opts.title || 'Preview');
    state.kind = 'html';
    state.onPrint = typeof opts.onPrint === 'function' ? opts.onPrint : null;
    ui.print.style.display = state.onPrint ? '' : 'none';
    var holder = el('div', 'cfv-holder');
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.title = opts.title || 'Preview';
    f.style.width = '800px';
    f.style.height = '600px';
    holder.appendChild(f);
    ui.stage.appendChild(holder);
    state.holder = holder;
    state.node = f;
    var measured = false;
    function measure() {
      try {
        var d = f.contentDocument;
        if (!d || !d.documentElement) return;
        var w = Math.max(d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0, 300);
        var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0, 200);
        f.style.width = w + 'px';
        f.style.height = h + 'px';
        state.w0 = w;
        state.h0 = h;
        if (!measured) { measured = true; fitToStage(); } else applyScale();
      } catch (_) { /* ignore */ }
    }
    f.addEventListener('load', function () {
      /* A caller that has to lay the document out itself (the log-entry card fits its own page) does it here. */
      try { if (typeof opts.onDocument === 'function') opts.onDocument(f.contentDocument, f.contentWindow); } catch (_) { /* ignore */ }
      measure();
      /* Webfonts and images settle after load; re-measure once they do, keeping the zoom. */
      setTimeout(measure, 250);
      try { if (f.contentDocument.fonts && f.contentDocument.fonts.ready) f.contentDocument.fonts.ready.then(measure); } catch (_) { /* ignore */ }
    });
    f.srcdoc = html;
  }

  function saveOriginal() {
    if (!state || !state.src) return;
    var name = state.filename || (state.kind === 'pdf' ? 'document.pdf' : 'photo.jpg');
    var blob = dataUrlToBlob(state.src);
    var href = blob ? URL.createObjectURL(blob) : state.src;
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); if (blob) URL.revokeObjectURL(href); }, 4000);
  }

  function close_() {
    if (!ui || ui.layer.hidden) return;
    release();
    var opener = state && state.opener;
    ui.layer.hidden = true;
    ui.stage.textContent = '';
    ui.stage.style.touchAction = '';
    ui.stage.style.cursor = '';
    state = null;
    try { if (opener && opener.focus) opener.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
  }

  /* Tap or click on any <img data-viewer> opens it. */
  document.addEventListener('click', function (e) {
    var img = e.target && e.target.closest ? e.target.closest('img[data-viewer]') : null;
    if (!img || !img.src) return;
    e.preventDefault();
    open({ src: img.currentSrc || img.src, title: img.getAttribute('data-viewer-title') || img.alt || 'Photo', filename: img.getAttribute('data-viewer-name') || '' });
  });

  root.ChengFileViewer = { open: open, openHtml: openHtml, close: close_, isOpen: function () { return !!(ui && !ui.layer.hidden); } };
})(typeof window !== 'undefined' ? window : this);
