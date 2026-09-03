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
   * Open the browser's system printer dialog on the live page.
   *
   * Uses window.print() so the user gets the normal printer picker (including
   * Save as PDF). Do not tear the print document down until afterprint — removing
   * it while Chrome/Android print UI is open freezes the app on a dead preview.
   */
  function printLiveDocument(prepare, cleanup) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', finish);
      try { cleanup && cleanup(); } catch (_) { /* ignore */ }
    };
    try { prepare && prepare(); } catch (err) {
      finish();
      throw err;
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
      /* Some WebViews never fire afterprint — only then clear, and never while
         the dialog is typically still open. */
      window.setTimeout(finish, 120000);
    }, 50);
  }

  return { APP_NAME, AUTHORS, authorLine, creditLine, printCredit, printLiveDocument };
})();

window.Branding = Branding;
