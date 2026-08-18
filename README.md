# Vessel Fuel Tank Management System

Multi-vessel web app for fuel tank sounding (double interpolation + ASTM 54B), editable calibration tables, voyage fuel planning, bunkering distribution, and offline-capable sync between a local machine and a Proxmox LXC (Debian).

## Features

- **Multi-vessel database** — each vessel stored under `data/vessels/<id>/`
- **Tank sounding calculator** — trim/list double interpolation, volume curves, ASTM Table 54B VCF + WCF
- **Editable calibration DB** — correct trim/list grids and volume curves manually
- **PDF table import** — extract sounding / trim tables from capacity-book PDFs into a tank’s calibration grid
- **Add tanks** — storage, settling, service (also overflow/other); CSV import template included
- **Fuel oil report (tank condition)** — the workbook report sheet: per-tank sounding, VCF 54B / WCF 56, weight in air, grade totals vs log book, lube / received / consumption, printed with its calculation sheet and reference tables
- **Bunkering plan + live monitoring** — loading sequence with target volume → target ullage per tank, auto-distribution over the tanks, delivery rate, pumping clock, live intake, quantity/time remaining
- **After-bunkering report** — re-sound the tanks; intake per grade against the ROB prior to bunkering
- **Bunkering report summary** — BDN paperwork, times, fuel/lubes onboard before and after, BDN vs measured difference
- **Voyage fuel calculation** — per-leg distance/speed/daily burn → arrival ROB
- **VCF / WCF calculator** — standalone ASTM 54B / WCF manual calc + reference tables
- **ISO 8217 specs** — distillate & residual marine fuel limit tables (ISO 8217:2017)
- **Vessel logo + Chief Engineer signature** — signed on screen with a finger or stylus, or uploaded as a photo with the paper lifted off; printed on every document
- **Progress bars** — signature/logo processing and CSV / Excel / PDF uploads report step, percentage and elapsed time
- **Offline + sync** — IndexedDB cache + mutation queue; push/pull peer sync when online
- **Backup / import** — full JSON backup of vessels + settings
- **Android** — responsive PWA (Add to Home Screen)
- **Debian / Proxmox LXC** — systemd install script included

## Quick start (local)

```bash
npm install
npm run seed          # loads MV CAPTAIN VENIAMIS (+ MV GIORGIS when seed/giorgis exists)
npm start             # http://0.0.0.0:3080
```

Optional — rebuild Giorgis seed from the FINAL workbook:

```bash
python scripts/build-giorgis-seed.py
npm run seed
```

Open the URL in a browser (desktop or Android). Select the seeded vessel or create a new one under **Vessel Setup**.

## Data layout

```
data/
  settings.json
  vessels-index.json
  vessels/
    captain-veniamis/
      vessel.json
      tanks.json          # includes calibration grids
      readings.json
      voyage.json
      bunkering.json
      bunker-ops.json
      transfers.json
      fuel-report.json    # tank condition report form
      report-history.json # saved report snapshots
      bunker-plan.json    # bunkering plan & monitoring
      bunker-after.json   # after-bunkering tank condition
      bunker-summary.json # bunkering report summary
      bunker-history.json # saved plans / after-reports / summaries
      assets.json         # vessel logo + signature per Chief Engineer
      meta.json           # revision for sync
```

## Fuel oil report (TANK CONDITION)

**Fuel Report** in the sidebar reproduces the workbook's report sheet — one row per fuel tank:

| Entered | Derived |
|---------|---------|
| fuel type (HFO / LSFO / MDO-MGO / LSMGO), sounding in mm, method (ullage / dip), temperature, petroleum unit standard + value, "tank in use" | 100% volume m³ and MT, measured volume m³, volume %, density @15 °C, VCF 54B, GSV @15 °C, WCF 56, weight in air MT |

Header carries voyage no., report type, port, date/time, drafts, heel and E/R + sea temperature. Mean
draft and trim are computed from the drafts (trim is shown fwd − aft as in the workbook; the calibration
tables are read at trim by the stern). A reading taken the opposite way to the tank's calibration scale is
converted through the sounding-pipe height before lookup.

A row sits in the block its **fuel type** belongs to. Set an HFO tank to LSMGO or MDO/MGO and it moves to
DIESEL OIL / GAS OIL straight away (and back again if the type changes back), so the FUEL OIL and
DIESEL OIL / GAS OIL totals each count only what is really in them. A tank left on its own grade never
moves, because its grade and its fuel type agree.

If a tank should stay put anyway, the button beside its name pins it — `LSMGO ↩ F.O.` holds it in the fuel
block, and `pinned ↩` releases it to follow the fuel type again. Pins save with the report and are listed
on the printout; a row counted in the other block by fuel type is marked with an asterisk and a footnote.

Grade totals (HFO / LSFO / MDO-MGO / LSMGO) follow the fuel type regardless of which table the row sits in.

Below the grid: per-grade totals against the **log book ROB** (with the difference), lube oil quantities in
litres → MT, received quantities, daily consumption, and the preparer.

**PRINT & SAVE** saves the form, writes the soundings back as tank readings, appends a snapshot to
*Saved reports*, and prints a landscape A4 document of three pages:

1. **TANK CONDITION** — both tank blocks with every column, totals, log-book comparison, lube / received / consumption, signature
2. **CALCULATION SHEET** — the derivation the entry grid hides: raw reading → table scale → trim/heel correction → observed volume → α 54B, ΔT, VCF → GSV → WCF → weight
3. **FORMULAS & REFERENCE TABLES** — every formula with its workbook source, plus ASTM 54B VCF across temperature and Table 56 WCF for each density used in the report

The calculation sheet and reference tables are collapsed on screen (**Show on screen** under *Calculation
sheet & reference tables*) but are always included in the printout.

Constants taken from the workbook: 100% capacity in MT = 100% m³ × 0.96, filling limit 85%, lube oil
litres × 0.882 ÷ 1000.

## Printed document identity — logo & signature

**Vessel Setup → Printed document identity** takes two images:

| Image | Where it prints |
|-------|-----------------|
| Chief Engineer signature | in the space directly above the signature line, so it reads as signed over it |
| Vessel logo | 44 mm tall, standing off the end of the signature line by a third of the line's length |

The logo prints like a rubber stamp. It is allowed to overlap whatever is already on the paper — that is what
a stamp does — and it adds no height to the sheet, so changing `--fr-logo-height` resizes the mark without
moving anything else or costing a tank row. It carries no white fill of its own either: a stamp with a card
behind it would blank out the print it is meant to sit over. Upload the logo with background removal on to
get the real stamp effect; an untrimmed photo prints its own paper as an opaque rectangle.

Both appear on every printout — fuel report, bunker plan, after-bunkering report, bunkering summary, and the
calibration book cover.

### Signing on screen

**Sign on screen** opens a pad that takes a signature straight from the device — a finger on a phone, or a
stylus on a tablet. Nothing is photographed, so none of the background-removal work below runs: the strokes
are drawn as dark ink on a transparent canvas, which is already the form the printout wants. The image is
cropped to the ink before it is stored.

Strokes are kept as points rather than as pixels, which is what makes **Undo** work and what lets the pad
redraw itself if the tablet is rotated mid-signature. A stylus reporting pressure varies the nib width; a
finger gets a constant one, because the pressure a touchscreen reports for a finger is not a real
measurement. Once a pen has been used, plain touches are ignored for the rest of that signature, so a palm
resting on the glass does not draw.

### Signing from a photograph

A signature is normally a photo of ink on paper, so by default the paper is lifted off and the image
trimmed to the signature. The method is the one used in the companion voyage-manager app: paper brightness
*and* paper colour are estimated locally on a coarse grid, and each pixel is judged against the paper
beside it, so an uneven shadow does not survive as a grey slab and a cream or warm-lit page does not read
as ink. Alpha is ramped rather than switched so stroke edges stay smooth, and the crop keeps only the main
cluster of ink — a stray mark in the corner of the page does not stretch the crop and shrink the signature.
If nothing resembling ink is found the image is returned untouched rather than blanked. A logo that already
has a transparent background can be uploaded with the box unticked.

Signatures are filed under the **Chief Engineer** name on the vessel record, so after a crew change each
officer keeps their own and a sheet reprinted later still carries the signature of the officer named on it.
Both images live in the vessel's `assets.json` and ride along in backups and peer sync.

Both preview panes are white. Once the paper has been lifted off, a signature is dark ink on nothing — on the
dark app background it would be invisible, and white is also what it previews as on the printed page. The
printed logo box is white for the same reason.

Totals rows on the fuel-oil and diesel-oil tables print a pixel smaller than the rest of the sign-off, with
tighter side padding. At the old size a seven-character total cleared its column by 2 px, so a four-figure
total ran past it; the trim leaves 4 px of room. A five-figure total (over 9,999 MT) would still be about a
pixel wide — drop the row to 7pt if a vessel that size ever needs it.

The printed header and the facts strip under it are spaced tightly, because that space competes directly with
the signature: on a sheet with a few more tanks than usual the sign-off is what gets pushed onto a page of its
own. Trimming the padding there (no type was made smaller) reclaims about 10 mm on the TANK CONDITION face —
room for three more tank rows before the signature spills.

Images are stored as JPEG when nothing in them is transparent and PNG only when transparency has to be kept.
A photographed logo is around 11 KB as JPEG against 440 KB as PNG, which matters because both images travel
inside the vessel bundle on every page load.

## Progress bars

Anything that makes the screen wait now says so, using one shared bar (`public/js/progress.js`) that shows
the step, a percentage and elapsed seconds:

- **Signature and logo** — reading the file, measuring the paper, separating the ink, cropping, saving.
  Background removal is a per-pixel pass, so it runs in horizontal bands and yields to the browser between
  them; without that the page freezes and the bar never paints.
- **CSV / Excel / PDF imports** — real upload percentage while the bytes go up, then *reading the file on the
  server* while it is parsed.

Upload percentage comes from `XMLHttpRequest` (`Api.upload`), because `fetch` cannot report bytes sent. For
the same reason the service worker deliberately does **not** answer multipart POSTs: a request served from a
worker's `fetch` handler is re-issued by the worker and the page never sees its upload events, so those
requests are allowed straight through to the network.

## Bunkering chain

Three screens run one operation, each reading the stage before it:

```
Fuel Report  ->  Bunker Plan  ->  After Bunkering  ->  Bunker Summary
  ROB before     target ullage      re-sound tanks       BDN vs measured
```

### Bunker Plan & Monitoring

Header: date, voyage, port, drafts (mean draft and trim computed), heel, grade, delivery rate, bunker
quantity, time to bunker, bunker density/temperature.

**Fill sequence** spreads the bunker quantity over the tanks a mode selects — equal across storage, port
or starboard only, No.1 / No.2 / No.3 only, settling, or service — weighted by the space each tank has
below the 85% limit, never targeting a tank above it. It writes targets only; nothing reaches a tank until
it is sounded on the after-bunkering report.

Loading sequence of up to six tanks. Capacities, starting ullage and starting ROB come straight from the
fuel report; enter a **target volume** and the calibration table is read *backwards* to give the target
ullage, plus the tonnage that target adds:

| Column | Source |
|--------|--------|
| Free (m³) @85% cap | 85% capacity − starting ROB |
| Target ullage | bisection on the tank's own trim/heel calibration for the target volume |
| Plan add (MT) | (target volume − starting ROB) × VCF × WCF at the bunker density |
| Quantity add (MT) | (current volume − starting ROB) × VCF × WCF — the live intake |

During the transfer, type each tank's **current sounding**; received, quantity remaining, time remaining
and percent complete update as you go. The plan warns when the selected tanks cannot hold the ordered
quantity at the 85% limit, and when targets do not add up to the bunker quantity.

Each tank in the sequence has its own **valve state** — pending, filling, paused, done — with Start /
Pause / Resume / Close buttons on the row. Bunkering runs tank by tank, so each slot times itself: how
long it has been taking fuel, what share of the delivery rate it is getting (the rate splits between the
tanks open at that moment), how much is still to go to its target, and the **ETA** at which it reaches it.
Opening the first tank starts the overall pumping clock; closing a tank without a final sounding is
flagged on the row.

The **pumping clock** (start / pause / reset) shows elapsed pumping time and what the barge's stated rate
says should be aboard by now, against what the soundings actually show — the difference is the number to
question while the hose is still connected.

A **blend calculator** mixes the ROB already aboard with the incoming parcel (ASTM WCF volume @15 °C) and
can drop the blended density straight into the plan, which is what every quantity on the sheet converts
with.

Prints the plan sheet with the monitoring figures, a capacity check and the method used, followed by the
before-bunkering tank condition.

### After Bunkering

The fuel-report grid again, plus per grade: **ROB prior bunkering** → **total added** → **total present**.
**GET DATA** refills the prior-ROB column (and optionally the soundings) from the saved fuel report — the
delivery is simply `present − prior`, so a negative figure is consumption rather than intake. Saving writes
the soundings back as the vessel's current tank readings.

### Bunkering Report Summary

BDN paperwork: alongside / connect / pump start / pump stop / disconnect / cast off times, barge, supplier,
grade, BDN number, ship's condition, letter of protest, samples, remarks, lubes onboard, and fuel onboard
previous → received → present. Compares the **BDN quantity** against what the tanks actually show and
flags a difference beyond the 0.5% normally accepted; pumping duration and average rate come from the
times. Prints the summary and the tanks-after-bunkering table.

## Excel workbook (calibration reference)

The repo includes vessel workbooks used as calibration references:

| Workbook | Vessel |
|----------|--------|
| `TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm` | MV CAPTAIN VENIAMIS |
| `TANK MANAGEMENT GIORGIS FINAL 1.xlsm` | MV GIORGIS |

Sheets **Tank1–Tank4** are the calibration table reference:

| Block | Layout |
|-------|--------|
| Correction (Tank1 HFO/MDO style) | `SOUNDING ullage` rows × trim (m) columns → correction; `SOUNDING CM` / `sounding VOLUME`; list/heel table |
| Direct (Tank2–4 style) | `Depth` rows × trim columns → volume m³; second `Depth` × heel table |

In the app: **Calibration DB → open a tank** shows this Excel-style grid. Use **Import repo workbook** (or upload) to refresh tables from the `.xlsm`.

Also used from the workbook: **Setup** (pipe height / 100% & 85% capacity), **Conversion** (API → density @15°C), **ASTM Tables** (VCF 54B).

## PDF sounding-table import

Requires Python deps (`pip3 install -r requirements.txt` — includes `pdfplumber`).

1. Open **Add Tank → Upload PDF** to create tanks (with calibration) from a sounding book, or open **Calibration DB →** a tank → **Import PDF** to apply a table to an existing tank
2. Choose a capacity / sounding table PDF (text layer preferred)
3. Preview tables **grouped by tank**; hydrostatic **L.C.G / T.C.G / V.C.G / IMOM** blocks are skipped automatically
4. On Add Tank: select tanks → **Create selected tanks**. On Calibration: pick target (**trim**, **list/heel**, **volume curve**, or **full**), then **Apply to tank**

Supported layouts (comparison samples in `templates/`):

| Layout | Sample | What is extracted |
|--------|--------|-------------------|
| Trim / depth grid (Veniamis-style) | `sample-sounding-book-veniamis.pdf` | SOUNDING/Depth × trim (m) → volume grid per tank |
| Sounding × volume + hydro (Gangos-style) | `sample-sounding-book-gangos.pdf` | SOUNDING + VOLUME only; LCG/TCG/VCG/IMOM columns stripped; pure hydro tables disregarded |
| Sectioned trim / ullage | `sample-sounding-book-giorgis.pdf` | EVEN KEEL + TRIM BY STERN/HEAD (or ULLAGE\|CAPACITY) sections → merged sounding × trim grid |

**M/V GIORGIS capacity books** (real PDFs under `templates/ships/giorgis/`) are scanned **ullage/sounding × STEM / EVEN KEEL / STERN** volume grids plus separate **heeling correction** pages — closer to the Veniamis trim-grid family than the sectioned sample. Prefer `TANK MANAGEMENT GIORGIS FINAL 1.xlsm` + `scripts/build-giorgis-seed.py` for accurate calibration; OCR on dense scans is noisy.

Exterior inspect (folder or file — no full matrices):

```bash
python3 scripts/inspect-pdf-sounding.py templates/ships/giorgis
python3 scripts/import-pdf-tables.py path/to/book.pdf --inspect
```

Drop real ship PDFs into `templates/ships/giorgis/` (large PDFs are gitignored).

Regenerate samples: `python3 scripts/make-sample-sounding-pdfs.py`

CLI:

```bash
python3 scripts/import-pdf-tables.py path/to/tables.pdf > tables.json
python3 scripts/import-pdf-tables.py path/to/scanned.pdf --ocr   # needs ocrmypdf + tesseract
python3 scripts/import-pdf-tables.py path/to/tables.pdf --inspect
```

Scanned (image-only) PDFs: install `ocrmypdf` and `tesseract-ocr` (deploy scripts / apt), or pre-OCR the file. The importer auto-OCRs when little text is found and warns otherwise.

API:

- `POST /api/vessels/:id/import-pdf` — multipart `file` → `{ tanks, tables, usableTables, skippedHydrostatic, … }`
  - Pass `createTanks=true` (optional `tankNames` JSON array, `updateExisting`) to create/update tanks with calibration from the PDF — used by **Add Tank → Upload PDF**
- `POST /api/vessels/:id/tanks/:tankId/import-pdf` — upload PDF or POST `{ table, target, apply:true }` to write calibration
- Optional form field `ocr=true` to force OCR when tools are installed

## CSV / Excel tank tables

### Tank list (metadata)

Download the template from the app (**Add Tank** page) or use `templates/tank-import.csv`.

Columns: `id,name,category,fuelRole,side,tankNo,fuelGrade,calcType,capacity,pipeHeight,soundingMethod,correctionDivisor`

- **Export** current list: `GET /api/vessels/:id/tanks.csv`
- **Import / edit**: same CSV — matching `id` updates the tank and keeps calibration grids; new rows are created

### Calibration table (sounding × trim)

Per tank in **Calibration DB**:

| Action | How |
|--------|-----|
| Edit in app | Open tank → edit grid → Save |
| Export CSV | `…/tanks/:tankId/calibration.csv` |
| Export Excel | `…/tanks/:tankId/calibration.xlsx` (sheets META, TRIM, VOLUME, LIST, TABLE) |
| Import CSV/Excel | Upload on the tank page, or `POST …/import-table` |

CSV uses `META` / `TRIM` / `VOLUME` / `LIST` section rows (see `/api/templates/calibration.csv`). A plain sounding×trim grid CSV is also accepted.

After import, open **Calibration DB** to review and save further edits.

## Proxmox LXC (Debian)

### Create LXC + install (run on Proxmox **host** as root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/create-lxc.sh)"
```

Creates a Debian CT (auto CTID from 130), installs Fuel TMS, starts systemd on port **3080**.

Useful overrides:

```bash
CTID=140 HOSTNAME=fuel-tms PASSWORD='YourStrongPass' MEMORY=2048 DISK=16 \
  IP=static STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/create-lxc.sh)"
```

### Update existing LXC (host)

```bash
CTID=130 bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update-lxc.sh)"
```

### Install / update inside an existing CT

```bash
# install
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/proxmox.sh)"

# update (preserves data/vessels)
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update.sh)"
```

Optional: `PORT=3080 APP_DIR=/opt/tank-management BRANCH=main STORAGE=local-lvm BRIDGE=vmbr0`.

Point a second instance (ship laptop / office) at the LXC URL under **Backup / Sync → Peer sync URL**, then **Push** or **Pull**.

## Original workbook UI

`tank-management.html` remains as the standalone single-vessel calculator extracted from the CAPTAIN VENIAMIS workbook. The new app reuses the same formulas via `server/calc.js` / `public/js/calc.js`.

## API (selected)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/vessels` | List vessels |
| POST | `/api/vessels` | Create vessel |
| GET | `/api/vessels/:id` | Full vessel bundle |
| PUT | `/api/vessels/:id/tanks/:tankId/calibration` | Edit calibration |
| POST | `/api/vessels/:id/calculate` | Sounding calc + save |
| GET | `/api/vessels/:id/fuel-report` | Saved report form + computed report + history |
| POST | `/api/vessels/:id/fuel-report/compute` | Recompute a posted form without saving |
| PUT | `/api/vessels/:id/fuel-report` | Save form (`snapshot`, `syncReadings`) |
| GET | `/api/vessels/:id/fuel-report/history` | Saved report snapshots |
| DELETE | `/api/vessels/:id/fuel-report/history/:snapshotId` | Delete a snapshot |
| GET | `/api/reference/fuel-report-options` | Selectors / labels / constants for the report form |
| GET | `/api/vessels/:id/bunkering-chain` | Plan + after-report + summary + histories in one call |
| GET/PUT | `/api/vessels/:id/bunker-plan` | Bunkering plan & monitoring (`snapshot` to keep a copy) |
| POST | `/api/vessels/:id/bunker-plan/compute` | Recompute a plan without saving |
| GET/PUT | `/api/vessels/:id/bunker-after` | After-bunkering tank condition (`syncReadings`, `snapshot`) |
| POST | `/api/vessels/:id/bunker-after/get-data` | Reseed prior ROB (and soundings) from the fuel report |
| GET/PUT | `/api/vessels/:id/bunker-summary` | Bunkering report summary |
| DELETE | `/api/vessels/:id/bunker-history/:list/:entryId` | Delete a saved plan / after-report / summary |
| GET | `/api/reference/bunkering-options` | Selectors / labels for the bunkering screens |
| POST | `/api/vessels/:id/bunker-distribute` | Bunker distribution (preview / instant apply) — API only since the plan screen distributes locally |
| POST | `/api/vessels/:id/bunker-ops/start` | Start live bunkering (rate + MT to receive) — API only, see note below |
| GET | `/api/vessels/:id/bunker-ops/active` | Active live op + progress / tank projections |
| PATCH | `/api/vessels/:id/bunker-ops/:opId` | Pause/resume, rate, intake, sounding updates |
| POST | `/api/vessels/:id/bunker-ops/:opId/complete` | Finalize tanks + voyage received |
| POST | `/api/vessels/:id/bunker-blend` | Mix fuels of different density → blended ρ / MT |
| POST | `/api/reference/vcf-wcf` | Manual VCF/WCF calc (density, temp, vol or MT) |
| GET | `/api/reference/vcf-wcf-tables` | VCF × temp and WCF reference tables |
| GET | `/api/reference/iso8217` | ISO 8217:2017 marine fuel specification limits |
| GET | `/api/backup` | Full backup |
| POST | `/api/sync/pull` | Pull from peer |
| POST | `/api/sync/push` | Push to peer |

### Retired: the standalone Bunkering page

Its parts now live where they belong: distribution modes and the blend calculator on **Bunker Plan**, BDN
number and supplier on **Bunker Summary**, and monitoring by real soundings instead of a rate estimate
(with the rate kept as the expected-vs-measured check). The `bunker-distribute` and `bunker-ops/*`
endpoints stay for API compatibility and are no longer driven by any screen; the one behaviour deliberately
dropped is "apply instantly", which wrote tank ROB from an assumed distribution rather than a measurement.
A link to `bunkering` now opens the plan.

## Formulas (reference)

1. **Trim correction** — bilinear interp on sounding × trim grid ÷ divisor  
2. **List correction** — bilinear interp on corrected sounding × list grid ÷ divisor  
3. **Volume** — linear interp on volume curve (correction tanks) or bilinear volume grid (direct tanks)  
4. **VCF (ASTM 54B)** — density-banded α, `exp(−α·ΔT·(1+0.8·α·ΔT))`  
5. **Weight** — `volume@15°C × (density15 − 0.0011)`  
6. **SG ↔ density** — workbook Conversion sheet `rdToDensity15` (relative density / SG ↔ density @15°C kg/L); also API gravity → density

7. **Target ullage** — bisection on the tank's calibration (the inverse of 1–3) for a wanted volume
8. **Intake** — `(volume after − volume before) × VCF × WCF`; negative means consumption, not delivery

The fuel report and the bunkering screens compute with `public/js/fuel-report-core.js` and
`public/js/bunkering-core.js`, which the browser loads as scripts and the server `require()`s, so the same
numbers come out online, offline and server-side.

Tank detail and Bunkering pages include **SG→ρ** / **ρ→SG** converters. API: `POST /api/reference/convert-density` with `{ from: "sg"|"density"|"api", value }`.
