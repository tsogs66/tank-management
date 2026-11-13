# Importing a calibration book from a PDF

Tank Chief reads sounding / calibration tables out of a PDF: **Tanks → Add Tank
→ Import tanks from sounding PDF**, or the PDF button on a tank's own table.
It works on Windows and on the server; a phone cannot run it (the reading is
Python and OCR) — import on Windows and sync.

## What it reads

- A book with a **text layer** is read as it is. OCR is never run over a page
  that already has text; it only loses detail.
- A **scan** is read by OCR, page by page: only the pages with no text are
  sent to it, a few at a time, with settings made for tables (columns kept
  apart, no dictionary guessing digits into words, ruled lines not read as
  letters). A batch that fails is retried page by page, and a page that gives
  no table is read again in a different layout mode.
- Tables are found from where the figures sit on the page, so a speckle or a
  stamp is not mistaken for a column, a figure is not cut in two, and soundings
  printed in blocks side by side (`SOUNDING VOLUME | SOUNDING VOLUME | …`) are
  read down as one table.
- Hydrostatic blocks (L.C.G / T.C.G / V.C.G / IMOM, or headed "do not use for
  sounding") are set aside.

## Headings, units and signs

Books write the same things in many ways; these are all read:

- **The depth:** `SOUNDING`, `SOUNDED DEPTH`, `GAUGE`, `DEPTH` (a sounding) and `ULLAGE` (an ullage
  table). Its unit comes from its own heading or the cell under it: `(cm)`, `mm`, `m`, `M-CM`,
  "metres". The `(m)` over a trim column is never taken for it. Volumes: `m3`, `(M3)`, `M^3`, `m³`,
  `CU.M`, "cubic meters", litres (converted to m³).
- **Trim as a word:** `Tr=-4`, `T = -4`, `Trim: -4.0 m`, and trims printed with their unit
  (`1.0m`, `-0.5m`). Where the figures carry no sign and the heading gives it - `BY THE HEAD 2.0M
  1.0M | BY THE STERN 1.0M … 7.0M` - head is negative and stern positive, as in the sectioned books.
  A book that prints its own signs (`TRIM BY STEM 1.0m … TRIM BY STERN -1.5m`) is kept as printed.
- **Heel as a word:** `H1P`, `H3S`, `H 3 S`, `1P`, `1 Port`, `Heel 3 Starboard`, `List 2P`, and
  `LIST TO PORT 3.0 … 0.5 | LIST TO STARB'D 0.5 … 3.0`. **Port is negative, starboard positive.**
- **The tank's 100% volume:** from the page heading (`100% = 523.4 m3`, `Cap. 523.4 m3`); a
  partial fill (`98% FULL 512.9 m3`) is scaled up to 100%.
- **Figures packed together** (`341.870-135.900`) are split; a dash is a hole kept in its column
  (stored as 0, and counted in the review).
- **A second depth column** (ullage at the left, `SOUNDED DEPTH` at the right, always adding up to
  the same figure) is recognised as the same depth, not as another heel.
- **One table holding everything** (`GAUGE | FILL % | ULLAGE | Tr=-4 … Tr=1 | H1P … H3S | L.C.G
  T.C.G V.C.G IMOM`): each column is put where it belongs; hydrostatic columns are left out.
- **Capacity blocks with extra columns** (`GAUGE CAPACITY KG LCG IT`, twice across, the gauge written
  metre-centimetre `0-00, 01 … 09, 0-10`) are read down as one curve in cm; KG, LCG and IT are left out.
- **Corrections or capacities?** The unit decides, not the word CORRECTION (`UNIT : MM`,
  "correction depth in millimeters" are corrections; "capacities in cubic meters" are capacities). A table of
  corrections is not held to the rules of a volume and is not compared with the capacity table.
- **A tank's three tables** (trim, list, capacity) are one tank: they are put together into one
  calibration, with the real heel table in place of the stand-in, and the capacity taken from the capacity curve.

## Which tank a page belongs to

Every line of a page is scored as a tank title (grade, role, number, side,
where it sits, how big it is), the page furniture is ignored (vessel name,
"Page 3 of 40", revision, the book's own title) and what is left is cleaned
("— SOUNDING TABLE", "(CONT'D)", "100% = 12.5 m³" are not part of the name;
the capacity is kept). F.O.T., FWT, W.B.T., "No 2 DB TK STBD" and the like are
understood. Different spellings of one tank are matched, a different number or
side never is.

A page with no title belongs to the tank before it; a page that repeats the
title with "(CONT'D)" continues it; a header that is repeated, or missing, does
not matter. Tables of the same tank are spliced when their soundings carry on.

## What is checked (and what is done about it)

Every table goes through the same checks, whatever it was read from
(`server/table-check.js`; the figures it works from are the ones a tank must
obey: volume only grows with sounding, a step is the same size all the way
down, and the book's own pages agree):

| Found | Done |
|---|---|
| A decimal point moved, read as a digit, or a minus that is not there | Put back, only where the result lands on the line the rows either side draw |
| A figure that is wrong but plausible (the curve runs backwards for a step) | The rows either side say which of the pair is wrong |
| A sounding that is nonsense (`1324`, `-65`) | The row is left out |
| One or two rows lost from a long table | Filled by interpolation, and flagged |
| More than that missing | Reported, never invented |
| Volumes far over (or well under) the tank's capacity | The table fails |
| A run of bad rows, or a page that needed many corrections | The table fails |
| Two sources that disagree (grid and curve of one tank, the capacity, the tank as stored now) | Warned, or failed if far apart |

A table that **fails is not stored** unless the user ticks *Import it anyway*.
A table that differs from the tank's **stored table** is not allowed to replace
it until the user confirms. Everything that was corrected is listed under *What
was checked*, so nothing is changed without being shown.

## Large books

A book can be 300 MB. The upload goes straight to disk (never into memory),
the pages are read a few at a time, the reading is kept on the server so
creating the tanks does not send the file again, and the temporary file is
removed afterwards. Limits (environment variables):

- `TMS_PDF_MAX_MB` — largest upload, default 400.
- `TMS_PDF_MAX_SECONDS` — stop reading after this long and keep what was read
  (the rest can be imported as a page range), default 4 hours.

## What it needs

Python 3.11+ with `requirements.txt` (pdfplumber, ocrmypdf, pikepdf, …) and, for
scans, Tesseract. The Windows installer carries both. Ghostscript is not needed.

## Tests

`node scripts/test-table-check.js` (the checks) and
`node scripts/test-pdf-import.js` (a long generated book, as text and as a
skewed, speckled scan; the fail-safe; the server with a 90 MB upload). CI runs
both, the second with the real OCR.
