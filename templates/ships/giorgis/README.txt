Drop real M/V GIORGIS capacity / sounding PDFs here for exterior inspect + OCR.

All real GIORGIS PDFs from SHIPS FILE\GIORGIS are **scanned image-only** (no text
layer). Prefer seeding from the workbook:

  python scripts/build-giorgis-seed.py
  npm run seed

Inspect / OCR locally:

  python scripts/inspect-pdf-sounding.py templates/ships/giorgis
  python scripts/import-pdf-tables.py templates/ships/giorgis/<file>.pdf --ocr

Real capacity-book layout (not the simplified sample):
  ULLAGE/SOUNDING DEPTH (mm) × TRIM BY STEM / EVEN KEEL / TRIM BY STERN → m³
  plus separate HEELING CORRECTION tables (depth correction in mm).

The synthetic templates/sample-sounding-book-giorgis.pdf still covers the
sectioned EVEN KEEL / TRIM BY STERN|HEAD family used on some books.
