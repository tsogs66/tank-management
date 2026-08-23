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
- **Runs offline** — the whole app, its data and its printouts work with no server in reach; changes queue in a local database and merge back when the server returns
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

Each report screen offers the same three: **PRINT & SAVE**, **Save only**, and **Print only** — print with
nothing written, for a copy someone wants to see without filing it as a record.

**PRINT & SAVE** saves the form, writes the soundings back as tank readings, appends a snapshot to
*Saved reports*, and prints a **single A4 sheet**: the TANK CONDITION face — both tank blocks with every
column, totals, log-book comparison, lube / received / consumption, signature and stamp.

The annex that used to print as a second sheet — entry fields not shown on the face, the calculation sheet
(raw reading → table scale → trim/heel correction → observed volume → α 54B, ΔT, VCF → GSV → WCF → weight)
and ASTM 54B VCF across temperature with Table 56 WCF for each density used — is **on screen only**, under
**Show on screen** next to *Calculation sheet & reference tables*. It is still built from the same markup, so
nothing was lost; it simply is not sent to the printer.

Printed table cells sit on the middle of their row. That shows wherever a row is taller than one line — the
header, where some headings run to two lines and single-word ones would otherwise hang at the top, and any
row where a long tank name wraps. Cells carrying words (tank name, fuel grade, sounding method, and the
category column of the summary cards) are centred both ways; cells carrying figures keep their right edge, so
decimal points line up down a column.

A tank can be sounded without a density — the volume is known, the weight is not. Such a tank has no weight
to add, and adding it as nothing would leave the block TOTAL and the log-book comparison looking complete
while being short by whatever that tank holds. The block total is labelled with how many tanks it covers
(`TOTAL (9 of 10 tanks)`), the tanks are named under the block, and the affected grade is daggered in the
survey summary with a line saying the difference is not a real discrepancy until the densities are entered.
Nothing appears when the data is complete.

Constants taken from the workbook: 100% capacity in MT = 100% m³ × 0.96, filling limit 85%, lube oil
litres × 0.882 ÷ 1000.

## Graphical tank view

**Dashboard → Graphical tanks** draws each tank as a tank, four across, with the liquid filling the tank's
actual cavity rather than a bar. Each card carries the fill percentage, volume, temperature and weight in air,
and the dashed line across fuel tanks is the 85% filling limit.

**Purpose is drawn, not captioned.** No card says "settling" anywhere; the silhouette says it:

| tank | what is drawn | why |
|------|---------------|-----|
| Storage | plain box, bottom suction | nothing else to say about it |
| Settling | floor falling to a sump, drain cock at the low corner, heating coil along the slope | water and heavy particles drop out and are drained off |
| Service | as settling, plus a suction standing clear above the sump | clean oil is drawn from above whatever has settled — the reason the pair exists |
| Overflow | weir and downcomer entering the top | it catches what the other tanks cannot hold |

The liquid is clipped to the cavity, so a sloped floor makes the oil slope with it and a nearly-empty settling
tank looks like one. Tanks that settle also show the drop-out layer along the floor.

**Colours.** Residual fuel (HFO, LSFO) is brown; distillate (MDO, MGO, LSMGO) is orange; lube brown, fresh
water blue, waste and bilge black — the ISO 14726 family colours, except that the distillates are given their
own orange rather than sharing the residuals' brown, which is how they are read aboard.

On top of the family colour, the shade follows the oil through the system. Storage is darkest and lightens as
the fuel is drawn off to settle, and again as it goes to the service tank, so the chain reads as a chain and
you can see where a parcel has got to without reading a word. Overflow sits outside that run and keeps the
plain family colour.

That is one rule rather than a hand-kept matrix — `ROLE_SHADE` applied to `CONTENT` in
`public/js/tank-graphics.js` — so adding a grade cannot forget to add its shades. Both tables are the single
place to change if your fleet uses a different convention.

**Floating group tab.** The picker rides on the right edge rather than in the flow, so switching between fuel,
settling, service, lube or water does not cost a scroll back to the top on a screen showing forty tanks. It
collapses to a spine, and the grid takes the width back when it does. The view, the chosen group and whether
the tab is open are all remembered.

Four across is the wide layout; it steps down to three, two and one as the screen narrows, because four tanks
across a phone would be postage stamps.

## Running offline

Once the app has been opened against the server it keeps working with nothing in reach — no server, no
network. The service worker holds the app shell; a vessel's whole bundle lives in IndexedDB; the report,
bunkering and VCF maths run in the browser from the same modules the server uses, so the numbers are the
same either way. Soundings can be entered, reports saved and sheets printed with the server switched off.

Edits are written to the local database first and queued. Nothing is lost if the tablet is closed and
reopened — the queue outlives the page.

**Coming back.** `navigator.onLine` only reports whether the device has a network, which says nothing about
whether the server is up; aboard a ship the usual case is a tablet on the vessel's wifi with the server box
off. So the app asks the server itself, every 30 seconds when there is nothing waiting and every 5 seconds
while there is. When it answers, the queue is replayed in order and the bundle pulled back down so both
sides agree.

**Merging.** Saved reports and bunkering history only grow, so a write of them is treated as a contribution
rather than a replacement: the server unions by id and keeps the newer copy of any id it already had. Without
that, a tablet offline for a week would replay week-old history and delete everything the server gained in
the meantime. Deletions still work, because they travel as their own request rather than as a shorter list.
The remaining parts — the current voyage, the report form, vessel details — are current-state rather than
history, so the newer write wins.

**A change the server rejects** (a 4xx — a vessel that no longer exists, say) is dropped and reported rather
than retried forever, because retrying cannot change the answer and one bad item must not wedge everything
behind it. Anything merely undeliverable keeps its place in the queue, in order.

Two things to know if you are changing this. The scripts are requested with a `?v=NN` cache-buster but were
cached under their bare paths, so the worker has to look them up with `ignoreSearch` — without it every
script misses the cache and the app boots with nothing. And only a navigation may fall back to `index.html`:
answering a script request with HTML is what turns an offline load into `Unexpected token '<'`.

## Voyage report

A printable ROB summary per category, from the readings as they were last saved. Report types come from the
fuel report's own list rather than a second copy, because the fuel report reads `voyage.reportType` and prints
it as the sheet's condition — two lists meant this form offered "Weekly Monitoring" while the fuel report
understood "Monitoring". A stored value is always included in the dropdown, so saving cannot quietly change a
type this form did not offer.

A tank with no density has no weight. Those tanks are counted out of the MT subtotal and named underneath
rather than added in as zero, which would understate the total by whatever the tank holds while its own row
shows a dash. The bottom line is labelled **All categories**, since it adds fuel, lube, misc and fresh water
together.

## Sounding-pipe height

The pipe height is only needed to flip a reading between dip and ullage, and for these workbook tables it is
the top of the calibration axis — so that is where it comes from by default, read off the table rather than
typed. **Tank setup shows the table's figure as the placeholder and leaves the box empty**, because empty is
the normal state.

Enter a value only to override it. That is for the tanks where the table stops short of the sounding point:
the inferred height would then be too small and every flipped reading on that tank would be out by the
shortfall. Clearing the box goes back to the table.

The calibration book prints the height that was actually used and says which it was — `5,090 mm (from table)`
or `5,200 mm (set)` — so a sheet carries its own provenance.

## Bunkering summary — reconciling the BDN

The delivered figure is compared against what the tanks actually show, and only when both halves exist. A BDN
in hand with the after-bunkering soundings not yet taken is the normal sequence, not a shortfall: the sheet
shows an em dash and says it is waiting on the soundings for that grade. It does **not** compute a percentage
against a missing measurement.

That guard matters because the percentage drives advice. Past 0.5% — the tolerance a BDN is normally accepted
within — the difference box turns red and the sheet suggests a letter of protest, which is a commercial
dispute with the supplier. A genuine shortfall still raises it; a missing sounding no longer does.

Event times are read as entered, so a bunkering that runs past midnight is measured across the date change. A
gap that comes out negative means the times were entered the wrong way round; the duration is dropped and the
contradiction is said out loud rather than shown as a dash.

## Reprinting a saved record

Every saved record — reports, bunker plans, after-bunkering reports and summaries — has a **Print** button
beside Load and Delete. It prints that record directly: unlike Load, it does not put the old record into the
sheet on screen, so reprinting last month's summary costs you nothing you are in the middle of.

Each record keeps the form it was saved from, and the sheet is rebuilt from that form against the vessel's
current tanks and calibration — the only thing a form can be turned into numbers with. If a tank has been
re-measured since, the reprint is no longer the sheet that was signed, so the app says which figures moved
and prints anyway rather than quietly handing over a different document under the same date. The comparison
runs over whatever the snapshot kept, so it stays honest without a separate list of fields that matter.

Reprinting works with no server, like everything else on these screens.

## Printed document identity — logo & signature

**Vessel Setup → Printed document identity** takes two images:

| Image | Where it prints |
|-------|-----------------|
| Chief Engineer signature | in the space directly above the signature line, so it reads as signed over it |
| Vessel logo | 44 mm tall, struck over the right-hand end of the signature line — centred on the line, covering its last third, running off to the right |

The logo prints like a rubber stamp struck across the end of the signature line: its centre sits on the line,
it covers the line's last third, and the rest of it runs off to the right. It is allowed to overlap whatever
is already on the paper — that is what a stamp does — and it adds no height where the sheet has room, so
changing `--fr-logo-height` resizes the mark without moving anything else or costing a tank row.

Being centred on the line means half the stamp hangs below it. The signer's name, their role and the page
footer absorb most of that (`--fr-sign-foot`, 15 mm); the page reserves whatever is left over as bottom
padding, so a sheet that reaches the foot of the paper cannot print the stamp cut in half. A stamp small
enough to clear on its own reserves nothing. It carries no white fill of its own either: a stamp with a card
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

Totals rows on the fuel-oil and diesel-oil tables are sized against the widest total a large vessel prints —
five figures and three decimals, e.g. `12999.747`. Two things make that fit: the row is 7pt with 1px side
padding, and the tank-name column is 32mm rather than 36mm, which hands the 4mm to the twelve numeric
columns. 32mm is the floor — at 30mm the longest tank names wrap, and the extra row height costs more than
the width is worth.

Row padding through the sheet is 1px vertical rather than 1.5px, and the blocks, cards and capacity line are
spaced tighter. Together that is about 11mm, which is what keeps a large vessel on one sheet: with
five-figure totals the face fits up to roughly 25 fuel tanks. Beyond that it spills to a second page.

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

**Pumping time** on the live monitoring panel runs in `h m s` and retimes every second, because a clock that
only moves once a minute looks stopped — the one thing a monitoring screen must not look like while fuel is
going aboard. The per-tank running times do the same. Everything else on the panel (quantities, rates, ETAs)
comes from a full recompute over every tank and keeps a slower beat; those figures move on the scale of
minutes anyway.

Elapsed time is **floored, never rounded**: a clock reads 1h 59m until it is 2h 00m. Rounding made the panel
show `0h 01m` after thirty seconds — claiming time that had not passed, on a figure the engineer copies into
the paperwork and which multiplies the rate into an expected quantity.

Pausing the transfer shuts the valves. Every tank that was filling is paused with the operation, and each is
marked so that resuming reopens exactly those — a tank the engineer had already shut by hand stays shut, and
one they reopened by hand is not touched twice. Without that, the overall clock stopped while every tank still
read FILLING, which said the pumps had stopped and the tanks were still taking fuel at the same time.

Resetting the overall clock is different: it clears the stopwatch and leaves the tanks alone, since a tank may
legitimately still be taking fuel.

Every tank in the sequence keeps its own timer alongside the overall one. Pausing a tank holds its duration
where it stopped — that figure is the record of how long the valve was open, so a live count would be a lie
about a shut valve — and resuming continues from there rather than starting again. Closing a tank freezes its
final duration. Only running clocks are retimed, so a paused or closed tank keeps what it earned. The overall
clock and the tank clocks are independent: pausing one tank does not stop the operation, and resetting the
overall clock does not stop a tank still taking fuel.

Printouts and saved history keep the minute form; seconds are noise there.



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
