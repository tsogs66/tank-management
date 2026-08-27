# AGENTS.md

## Cursor Cloud specific instructions

Tank Chief is a single product delivered as a Node.js **Express** web app (with optional Electron/Capacitor packaging of the same code). There is no database — vessel data is stored as JSON files under `data/vessels/<id>/`. The only service you need to run to exercise the product end-to-end is the Express server.

### Services

| Service | Command | Notes |
|---------|---------|-------|
| Web/API server (the product) | `npm start` (alias `npm run dev`) | `node server/index.js`, listens on `http://0.0.0.0:3080`. Serves the SPA in `public/` and the REST API under `/api`. |

Environment variables (all optional): `PORT` (default `3080`), `HOST` (default `0.0.0.0`), `TMS_DATA_DIR` (override data directory).

### First-run setup (not handled by the startup update script)

The update script only refreshes dependencies (`npm install`, `pip install`). These project setup steps are **required for a usable dev instance** and must be run manually after dependencies are installed:

- `npm run seed` — populates `data/` with demo vessels (`MV CAPTAIN VENIAMIS`, `MV GIORGIS`). The `data/` directory ships empty (git-ignored), so without this the app boots but has no vessels. Re-running overwrites the seeded vessels.
- `npm run embed` — copies `server/{calc.js,bunker-live.js,index.js}` and `seed/*.json` into `public/embedded/`. **Non-obvious gotcha:** `public/embedded/` is git-ignored and generated. Without it, offline/PWA mode and the parity check fail with a browser error `SyntaxError: Unexpected token '<'` (the server returns the SPA HTML fallback for the missing `/embedded/*` files). Re-run `npm run embed` any time `server/calc.js`, `server/bunker-live.js`, or `server/index.js` change, since it is a build-time copy, not a live link.

### Lint / test / build

- **No lint script and no unit-test framework are configured** (no ESLint/Prettier, no `test` npm script).
- The only automated test is the parity check: `npm run parity` (`node scripts/parity-check.js`). It boots a headless Chromium, loads the shared route code in-browser, and diffs every computed API response against the live server to prove browser/offline math equals server math. Requirements: the server must be running on `:3080`, `npm run embed` must have been run, and Playwright's Chromium must be installed (`npx playwright install chromium`, not part of the update script). Expected result: `24/24 identical (reads)` and `13/13 identical (writes)`.
- **No build step for the web app** — the front end is plain static JS served directly. "Build" only applies to the optional Electron (`npm run dist:*`) and Android (`npm run android:apk`) packaging targets.

### Optional features

- Python 3 + `requirements.txt` (`openpyxl`, `pdfplumber`, `reportlab`) power PDF/Excel calibration import, spawned on demand by `server/python-run.js`. Absent → only those import endpoints degrade; the rest of the app works. OCR of scanned PDFs additionally needs system `tesseract-ocr` + `ocrmypdf`.
