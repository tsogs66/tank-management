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

  /**
   * Open the system printer dialog from a hidden iframe.
   *
   * Live-page window.print() fails in Android WebViews and when Tank Chief is
   * nested inside ChEng AIO's embed iframe. Writing a self-contained document
   * and calling print() on that frame matches Voyage Chief and keeps navigation
   * on the live app (no print-preview trap).
   */
  function printViaIframe(bodyHtml, opts = {}) {
    const bodyClass = opts.bodyClass || '';
    const title = opts.title || 'Print';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((l) => `<link rel="stylesheet" href="${l.href}">`)
      .join('\n');
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
${cssLinks}
<style>
  html, body { margin: 0; background: #fff; color: #111; }
  /* Visible even when a host mishandles @media print un-hide rules. */
  .calib-print-doc, .fuel-report-print-doc, .report-print-doc { display: block !important; }
  .app-shell, .sidebar, .bottom-nav, .bn-more-sheet, .theme-fab, .theme-toggle,
  .menu-toggle, .sidebar-backdrop, .no-print, .toast, .calib-sticky-actions,
  .pdf-import-panel, .pdf-progress { display: none !important; }
  .app-credit-print {
    display: flex !important; gap: 10px; align-items: baseline;
    margin-top: 8px; padding-top: 1mm; border-top: .4pt solid #999;
    color: #444; font-size: 7pt; line-height: 1.4;
  }
  .app-credit-name { font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .app-credit-authors { flex: 1; }
  .app-credit-when { color: #777; white-space: nowrap; }
</style>
</head><body class="${bodyClass}">${bodyHtml}</body></html>`);
    doc.close();

    const win = iframe.contentWindow;
    const cleanup = () => {
      try { iframe.remove(); } catch (_) { /* ignore */ }
    };
    const doPrint = () => {
      try {
        win.focus();
        win.print();
      } catch (err) {
        cleanup();
        throw err;
      }
      setTimeout(cleanup, 1500);
    };

    const kick = () => {
      if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(() => setTimeout(doPrint, 40)).catch(() => setTimeout(doPrint, 120));
      } else {
        setTimeout(doPrint, 120);
      }
    };

    const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
    if (!links.length) {
      kick();
      return;
    }
    let pending = links.length;
    let done = false;
    const one = () => {
      pending -= 1;
      if (pending <= 0 && !done) {
        done = true;
        kick();
      }
    };
    links.forEach((l) => {
      l.addEventListener('load', one);
      l.addEventListener('error', one);
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        kick();
      }
    }, 800);
  }

  return { APP_NAME, AUTHORS, authorLine, creditLine, printCredit, printViaIframe };
})();

window.Branding = Branding;
