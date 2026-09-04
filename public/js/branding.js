/**
 * The application's name and who wrote it, in one place.
 *
 * Every window title, masthead, About page and printed footer reads from here,
 * so renaming it is one edit rather than a hunt through eighteen string
 * literals — which is how the previous name ended up spelled three different
 * ways across the same application.
 */
const Branding = (() => {
  const APP_NAME = 'Tank Chief';
  const AUTHORS = ['ts0gs', 'Marvin C. Endozo'];

  /** "ts0gs · Marvin C. Endozo" */
  const authorLine = () => AUTHORS.join(' · ');

  /** The line that goes at the foot of anything printed. */
  const creditLine = () => `${APP_NAME} — ${authorLine()}`;

  /**
   * The printed footer.
   *
   * Dated as well as credited: a sounding sheet without a date on the page it
   * was printed from is hard to place once it is in a folder with six others.
   */
  function printCredit() {
    const when = new Date().toLocaleString([], {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    return `<div class="app-credit-print">
      <span class="app-credit-name">${APP_NAME}</span>
      <span class="app-credit-authors">${AUTHORS.join(' &middot; ')}</span>
      <span class="app-credit-when">${when}</span>
    </div>`;
  }

  function escPrint(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Voyage-style document header used on every Tank print sheet:
   * vessel + dept | badge + title + subtitle | right label/value.
   */
  function printDocHeader(opts = {}) {
    const vessel = opts.vessel || 'Vessel';
    const title = opts.title || '';
    const subtitle = opts.subtitle || '';
    const badge = opts.badge || '';
    const rightLabel = opts.rightLabel || 'Voyage No.';
    const rightValue = opts.rightValue != null && opts.rightValue !== '' ? opts.rightValue : '—';
    return `<header class="pr-doc-header">
      <div>
        <div class="pr-doc-vessel">${escPrint(vessel)}</div>
        <div class="pr-doc-dept">Engine Department — ${escPrint(APP_NAME)}</div>
      </div>
      <div class="pr-doc-title-wrap">
        ${badge ? `<div class="pr-doc-badge">${escPrint(badge)}</div>` : ''}
        <h1 class="pr-doc-title">${escPrint(title)}</h1>
        ${subtitle ? `<div class="pr-doc-subtitle">${escPrint(subtitle)}</div>` : ''}
      </div>
      <div class="pr-doc-voyage">
        <span class="pr-doc-voy-label">${escPrint(rightLabel)}</span>
        <span class="pr-doc-voy-num">${escPrint(rightValue)}</span>
      </div>
    </header>`;
  }

  /** Voyage-style meta grid: [{label, value}, …] */
  function printMetaGrid(cells, cols) {
    const list = Array.isArray(cells) ? cells : [];
    const cls = cols ? ` cols${cols}` : ' cols4';
    return `<div class="pr-meta${cls}">${list.map((c) => `
      <div class="pr-meta-cell"><span class="pr-meta-lbl">${escPrint(c.label || c[0] || '')}</span><span class="pr-meta-val">${c.value != null ? c.value : escPrint(c[1] ?? '—')}</span></div>
    `).join('')}</div>`;
  }

  function fontStylesheetHref() {
    try {
      const base = document.querySelector('base')?.href;
      if (base) return new URL('fonts/fonts.css', base).href;
      return new URL('fonts/fonts.css', location.href).href;
    } catch (_) {
      return 'fonts/fonts.css';
    }
  }

  /* Hold server upload / queue flush while the printer dialog is open. */
  let printHold = 0;
  const holdListeners = new Set();

  function beginPrintHold() {
    printHold += 1;
  }

  function endPrintHold() {
    printHold = Math.max(0, printHold - 1);
    if (printHold > 0) return;
    holdListeners.forEach((fn) => {
      try { fn(); } catch (_) { /* ignore */ }
    });
    holdListeners.clear();
    try {
      window.dispatchEvent(new CustomEvent('tank:print-hold-end'));
    } catch (_) { /* ignore */ }
  }

  function isPrintHold() {
    return printHold > 0;
  }

  /** Run fn after the print dialog closes (or immediately if not printing). */
  function afterPrintHold(fn) {
    if (!isPrintHold()) {
      try { fn(); } catch (_) { /* ignore */ }
      return;
    }
    holdListeners.add(fn);
  }

  function shouldBridgePrint() {
    try {
      if (window.__CHENG_ANDROID_PRINT__
        || (window.ChengAndroidPrint && typeof ChengAndroidPrint.printHtml === 'function')) {
        return true;
      }
      if (window.Capacitor && typeof Capacitor.isNativePlatform === 'function'
        && Capacitor.isNativePlatform()) {
        return true;
      }
      if (window.parent && window.parent !== window) {
        try {
          if (window.parent.ChengAioPrint || window.parent.ChengAndroidPrint
            || window.parent.__CHENG_ANDROID_PRINT__
            || window.parent.ChengPro || window.parent.ChengProShell) {
            return true;
          }
        } catch (_) {
          return true;
        }
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  function collectStylesCss() {
    const chunks = [];
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of rules) chunks.push(rule.cssText);
      } catch (_) {
        if (sheet.href) chunks.push(`@import url("${sheet.href}");`);
      }
    }
    return chunks.join('\n');
  }

  function buildPrintableHtml(bodyHtml, bodyClass, title) {
    const css = collectStylesCss();
    const fontsHref = fontStylesheetHref();
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title || APP_NAME}</title>
<link rel="stylesheet" href="${fontsHref}">
<style>
${css}
/* Last so Android / AIO print cannot keep the night-theme canvas. @page
   margin must stay 0 — PrintManager paints the canvas into page margins,
   which became the thick black frame around Tank + Bunker Plan sheets. */
@page { size: A4 portrait; margin: 0; }
@page landscape-sheet { size: A4 landscape; margin: 0; }
:root, html, body {
  color-scheme: only light !important;
  margin: 0 !important; padding: 0 !important;
  background: #fff !important; color: #0a1420 !important;
  border: none !important; outline: none !important; box-shadow: none !important;
  font-family: 'Inter', sans-serif !important;
}
.calib-print-doc, .fuel-report-print-doc, .report-print-doc, #bc-print-root,
.bc-pr-sheet, .fr-tc-page, .fr-tc-page-2, .calib-print-page {
  display: block !important;
  background: #fff !important;
  border: none !important; outline: none !important; box-shadow: none !important;
}
.fuel-report-print-doc, .report-print-doc, #bc-print-root {
  box-sizing: border-box !important; padding: 0 !important;
}
.report-print-doc, .bc-pr-sheet {
  box-sizing: border-box !important; padding: 4mm !important;
}
.calib-print-page {
  box-sizing: border-box !important; padding: 4mm !important;
  page-break-after: always; break-after: page;
}
.calib-print-page:last-of-type {
  page-break-after: auto !important; break-after: auto !important;
}
.app-shell, .sidebar, .bottom-nav, .bn-more-sheet, .theme-fab, .theme-toggle,
.menu-toggle, .sidebar-backdrop, .no-print, .toast, .calib-sticky-actions,
.pdf-import-panel, .pdf-progress { display: none !important; }
.app-credit-print {
  display: flex !important; gap: 10px; align-items: baseline;
  margin-top: 4px; padding-top: 1mm; border-top: 1px solid #d4dce8;
  color: #8a95a8; font-size: 8px; line-height: 1.4;
  page-break-before: avoid; break-before: avoid;
}
</style></head><body class="${bodyClass || ''}">${bodyHtml || ''}</body></html>`;
  }

  function deliverBridgedHtml(html, title, finish) {
    const onDone = (ev) => {
      if (ev && ev.data && ev.data.type === 'chengaio-print-done') finish();
    };
    try { window.addEventListener('message', onDone); } catch (_) { /* ignore */ }
    const clearDone = () => {
      try { window.removeEventListener('message', onDone); } catch (_) { /* ignore */ }
    };
    const wrappedFinish = () => {
      clearDone();
      finish();
    };
    try {
      const payload = { type: 'chengaio-print', html: String(html || ''), title: title || APP_NAME };
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      } else if (window.ChengAioPrint && typeof ChengAioPrint.printHtmlDocument === 'function') {
        ChengAioPrint.printHtmlDocument(payload.html, payload.title);
      } else if (window.ChengAndroidPrint && typeof ChengAndroidPrint.printHtml === 'function') {
        ChengAndroidPrint.printHtml(payload.html, payload.title);
        setTimeout(wrappedFinish, 1500);
        return;
      } else {
        throw new Error('No print bridge');
      }
      setTimeout(wrappedFinish, 180000);
    } catch (err) {
      clearDone();
      throw err;
    }
  }

  /**
   * Open the system printer dialog.
   *
   * Live-page window.print() works in desktop browsers. Inside ChEng AIO embeds
   * and on Android WebView it is a no-op, so we hand a self-contained HTML
   * document to the AIO shell / PrintManager bridge instead.
   */
  function printLiveDocument(prepare, cleanup, opts = {}) {
    let finished = false;
    const heldHere = !isPrintHold();
    if (heldHere) beginPrintHold();
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', finish);
      try { cleanup && cleanup(); } catch (_) { /* ignore */ }
      endPrintHold();
    };

    let bodyHtml = '';
    let bodyClass = opts.bodyClass || '';
    try {
      prepare && prepare();
      if (opts.bodyHtml) {
        bodyHtml = opts.bodyHtml;
        bodyClass = opts.bodyClass || bodyClass;
      } else {
        const root = document.getElementById(opts.rootId || '')
          || document.getElementById('fuel-report-print-root')
          || document.getElementById('calib-print-root');
        if (root) bodyHtml = root.outerHTML;
        bodyClass = document.body.className || bodyClass;
      }
    } catch (err) {
      finish();
      throw err;
    }

    if (shouldBridgePrint() && bodyHtml) {
      try {
        const html = buildPrintableHtml(bodyHtml, bodyClass, opts.title || APP_NAME);
        deliverBridgedHtml(html, opts.title || APP_NAME, finish);
        return;
      } catch (err) {
        console.warn('Tank print bridge failed, falling back to window.print', err);
      }
    }

    window.removeEventListener('afterprint', finish);
    window.addEventListener('afterprint', finish);
    window.setTimeout(() => {
      try {
        window.print();
      } catch (err) {
        finish();
        throw err;
      }
      window.setTimeout(finish, 120000);
    }, 50);
  }

  return {
    APP_NAME,
    AUTHORS,
    authorLine,
    creditLine,
    printCredit,
    printDocHeader,
    printMetaGrid,
    escPrint,
    printLiveDocument,
    beginPrintHold,
    endPrintHold,
    isPrintHold,
    afterPrintHold,
    buildPrintableHtml,
  };
})();

window.Branding = Branding;
