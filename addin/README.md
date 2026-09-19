# Tank Chief Excel add-in

A task pane that gets a calibration book into the shape the importer expects,
then hands the workbook to the same endpoint the web app's **Add tanks** panel
posts to. Nothing about the import changes — a book sent from Excel lands the
way one dragged into the browser does.

## What it does to a sheet

Calibration books are typed by hand, and the importer
(`scripts/import-excel-tanks.py`) needs one value per cell and rows that run
unbroken under their header. The tidy pass, in
[`public/js/sheet-tidy.js`](../public/js/sheet-tidy.js), makes that true:

- **Merged cells are unmerged.** Where a merge was N columns wide and its
  value holds N numbers — a trim header typed across the merge — each column
  gets its own number back. Anything else stays on the anchor cell.
- **Crowded cells are split into the cells beside them.** `2 1 0 -1 -2` in one
  cell becomes five cells; the columns to its right move right rather than
  being written over.
- **A minus sign is read the way the books use it.** Pressed against the digit
  before it, it separates (`-4-1` is −4 and 1, `1000-1050` is 1000 and 1050).
  Anywhere else it signs (`12 -34` is 12 and −34).
- **Tank names survive.** Digits pressed against letters mean a name, not a
  crowded cell, so `NO.1 H.F.O. TK (P)` is left alone.
- **Each block is squared off to its own header.** A sheet holds a tank per
  block — title, header, rows, next tank. A five-column trim header does not
  stretch the four-column block under it: blocks are found first (blank row,
  or a new header once the current block has data), and each is aligned to
  the column count of *its* header. Short rows are padded; a row that
  overruns its header is kept and flagged, because that is a book someone
  needs to look at.
- **Blank rows are dropped** (tick *keep one blank row between blocks* to
  leave a spacer).

**Preview** reports all of this without writing. **Tidy sheet** writes it
back, and Excel's own undo puts it back.

## Running it

```sh
npm start                      # serves /addin alongside the web app
```

Office requires **https** for a sideloaded manifest anywhere but localhost.
For local work, point `manifest.xml` at your dev host and sideload:

- **Windows** — share a folder, add it under *File ▸ Options ▸ Trust Center ▸
  Trusted Add-in Catalogs*, then *Insert ▸ My Add-ins ▸ Shared Folder*.
- **Mac** — drop `manifest.xml` in
  `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef`.
- **Excel on the web** — *Insert ▸ Add-ins ▸ Upload My Add-in*.

Replace the `<Id>` GUID in `manifest.xml` before sideloading on more than one
machine, and point the URLs at wherever the server actually runs.

## Layout

| File | |
|---|---|
| `manifest.xml` | ribbon button and task pane registration |
| `taskpane.html` / `.css` / `.js` | the pane, its report tables and wiring |
| `src/sheet-clean.js` | the Office.js half: unmerge, read, write back |
| `src/tankchief-api.js` | settings, vessel list, workbook upload |
| `../public/js/sheet-tidy.js` | the rules, pure and shared with the browser importer |
| `../scripts/test-sheet-tidy.js` | `npm test` covers the rules above |

The rules live outside the add-in on purpose: `sheet-tidy.js` has no Office
and no SheetJS in it, so the browser importer and the node tests run the same
code the task pane does.

## Not done yet

- `assets/icon-{16,32,80}.png` are referenced by the manifest and still need
  drawing.
- The pane posts the *whole workbook*; there is no per-sheet send.
- Tidying a sheet clears and rewrites its used range, so cell formatting and
  formulas in that range do not survive. Tidy a copy of the book.
