/**
 * The vessel database.
 *
 * The implementation lives in public/js/store-core.js so the phone application
 * can load the same file rather than carry a second copy of it — the same
 * arrangement the calculation cores already use. This is here so the rest of
 * the server can go on requiring './store'.
 */
module.exports = require('../public/js/store-core.js');
