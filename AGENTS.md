# AGENTS.md

## Cursor Cloud specific instructions

Tank Chief is a single product delivered as a Node.js **Express** web app (with optional Electron/Capacitor packaging of the same code). There is no database — vessel data is stored as JSON files under `data/vessels/<id>/`. The only service you need to run to exercise the product end-to-end is the Express server.

### Services

| Service | Command | Notes |
|---------|---------|-------|
| Web/API server (the product) | `npm start` (alias `npm run dev`) | `node server/index.js`, listens on `http://0.0.0.0:3080`. Serves the SPA in `public/` and the REST API under `/api`. |

Environment variables (all optional): `PORT` (default `3080`), `HOST` (default `0.0.0.0`), `TMS_DATA_DIR` (override data directory).

### First-run setup

Demo data and the offline bundle are generated, not committed:

- `npm run seed` — populates `data/` with demo vessels (`MV CAPTAIN VENIAMIS`, `MV GIORGIS`). The `data/` directory ships empty (git-ignored), so without this the app boots but has no vessels. Re-running overwrites tanks and readings for those vessels.
- `npm run embed` — copies `server/{calc.js,bunker-live.js,voyage-inventory.js,index.js}` and `seed/{conversion,iso8217}.json` into `public/embedded/`. **Non-obvious gotcha:** `public/embedded/` is git-ignored and generated. Without it, offline/PWA mode and the parity check fail with a browser error `SyntaxError: Unexpected token '<'` (the server returns the SPA HTML fallback for the missing `/embedded/*` files). Re-run `npm run embed` after changing those server files or the seed reference tables. It is a build-time copy, not a live link.

The shared ChEng Cloud Agent environment install already runs `npm ci`, `python3 -m pip install --user -r requirements.txt`, `npm run embed`, and `npm run seed` in this checkout, and the same install refreshes `cheng-pro` and `voyage-manager` when those sibling checkouts are present. Its start command serves ChEng AIO at `http://0.0.0.0:8080` (`/tanks/` and `/voyage/`). Local Voyage admin, sync, and license credentials are generated once into `~/.cheng-pro-dev.env` (mode `0600`): `SYNC_ADMIN_USER` / `SYNC_ADMIN_PASSWORD` / `SYNC_API_TOKEN`, plus `LICENSE_ADMIN_TOKEN`, `LICENSE_DEV_EMAIL` (`dev@cheng.local`), and `LICENSE_DEV_KEY` (a lifetime ChEng AIO key with Voyage Chief, Tank Chief, e-ORB, Consumption Plan, and Bunkering Plan). Tank Chief and Voyage Chief inside the shell stay on the license screen until that email and key are activated under **License**. This repo's own server is still `npm start` on port `3080` when Tank Chief is needed by itself.

### Lint / test / build

- **No lint script and no unit-test framework are configured** (no ESLint/Prettier).
- `npm test` runs the Node script checks listed in `package.json` (tank order, fuel grade, calc type, and the rest). They do not need the server.
- The browser/server parity check is `npm run parity` (`node scripts/parity-check.js`). It boots a headless Chromium, loads the shared route code in-browser, and diffs every computed API response against the live server to prove browser/offline math equals server math. Requirements: this repo's server must be running on `:3080`, `npm run embed` must have been run, and Playwright's Chromium must be installed (`npx playwright install chromium`). Expected result: `24/24 identical (reads)` and `13/13 identical (writes)`.
- **No build step for the web app** — the front end is plain static JS served directly. "Build" only applies to the optional Electron (`npm run dist:*`) and Android (`npm run android:apk`) packaging targets.

### Optional features

- Python 3 + `requirements.txt` (`openpyxl`, `pdfplumber`, `reportlab`) power PDF/Excel calibration import, spawned on demand by `server/python-run.js`. The Cloud Agent install installs them for the current user. Absent → only those import endpoints degrade; the rest of the app works. OCR of scanned PDFs additionally needs system `tesseract-ocr` + `ocrmypdf`, which that install does not add.
