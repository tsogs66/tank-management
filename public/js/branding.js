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

  return { APP_NAME, AUTHORS, authorLine, creditLine, printCredit };
})();

window.Branding = Branding;
