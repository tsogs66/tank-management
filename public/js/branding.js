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
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title || APP_NAME}</title>
<style>
${css}
html, body { margin: 0; background: #fff !important; color: #111 !important; }
.calib-print-doc, .fuel-report-print-doc, .report-print-doc { display: block !important; }
.app-shell, .sidebar, .bottom-nav, .bn-more-sheet, .theme-fab, .theme-toggle,
.menu-toggle, .sidebar-backdrop, .no-print, .toast, .calib-sticky-actions,
.pdf-import-panel, .pdf-progress { display: none !important; }
.app-credit-print {
  display: flex !important; gap: 10px; align-items: baseline;
  margin-top: 8px; padding-top: 1mm; border-top: .4pt solid #999;
  color: #444; font-size: 7pt; line-height: 1.4;
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
    printLiveDocument,
    beginPrintHold,
    endPrintHold,
    isPrintHold,
    afterPrintHold,
    buildPrintableHtml,
  };
})();

window.Branding = Branding;
