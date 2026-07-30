#!/usr/bin/env python3
"""
Build multi-layout sample sounding-book PDFs for OCR / import testing.

Layouts modelled after common ship manuals:
  1) Veniamis-style: per-tank SOUNDING × trim (m) volume grids
  2) Gangos-style: SOUNDING | VOLUME plus L.C.G / T.C.G / V.C.G / IMOM
     (hydrostatic columns must be auto-disregarded by the importer)
  3) Giorgis-style (bulk carrier): EVEN KEEL / TRIM BY STERN / TRIM BY HEAD
     as separate SOUNDING|VOLUME (or ULLAGE|CAPACITY) sections → merged grid

Writes:
  templates/sample-sounding-book-veniamis.pdf
  templates/sample-sounding-book-gangos.pdf
  templates/sample-sounding-book-giorgis.pdf
  templates/sample-sounding-table.pdf  (single-tank trim grid, backward compatible)
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "templates"


def _draw_title(c, text, y):
    c.setFont("Courier-Bold", 11)
    c.drawString(20 * mm, y, text)
    return y - 8 * mm


def _draw_mono_table(c, x, y, rows, col_w=None):
    c.setFont("Courier", 8)
    if not rows:
        return y
    n = max(len(r) for r in rows)
    if col_w is None:
        col_w = [22 * mm] * n
        col_w[0] = 28 * mm
    for ri, row in enumerate(rows):
        xx = x
        # dashed separators like ship printouts
        if ri in (0, 1) or (ri == len(rows) - 1):
            c.setDash(1, 2)
            c.line(x, y + 3 * mm, x + sum(col_w[:n]), y + 3 * mm)
            c.setDash()
        for ci in range(n):
            cell = row[ci] if ci < len(row) else ""
            c.drawString(xx, y, str(cell))
            xx += col_w[ci] if ci < len(col_w) else 20 * mm
        y -= 4.2 * mm
        if y < 25 * mm:
            c.showPage()
            y = A4[1] - 20 * mm
            c.setFont("Courier", 8)
    return y


def write_veniamis(path: Path):
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    # Page 1 — No.1 HFO (P) trim grid
    y = h - 20 * mm
    y = _draw_title(c, "CAPTAIN VENIAMIS — B-06 SOUNDING TABLE (F.O.T., D.O.T. ETC.)", y)
    y = _draw_title(c, "NO.1 H.F.O. TANK (P) — SOUNDING TABLE", y)
    rows = [
        ["SOUNDING", "2.0", "1.0", "0.0", "-1.0", "-2.0"],
        ["0", "0", "0", "0", "0", "0"],
        ["50", "12.1", "12.5", "13.0", "12.4", "11.9"],
        ["100", "25.0", "25.8", "26.5", "25.6", "24.8"],
        ["150", "38.2", "39.1", "40.0", "38.9", "37.8"],
        ["200", "52.0", "53.2", "54.5", "53.0", "51.5"],
        ["250", "66.5", "68.0", "69.5", "67.8", "65.9"],
        ["300", "81.0", "83.0", "85.0", "82.5", "80.0"],
    ]
    y = _draw_mono_table(c, 20 * mm, y, rows)

    y -= 8 * mm
    y = _draw_title(c, "NO.1 H.F.O. TANK (S) — SOUNDING TABLE", y)
    rows_s = [
        ["SOUNDING", "2.0", "1.0", "0.0", "-1.0", "-2.0"],
        ["0", "0", "0", "0", "0", "0"],
        ["50", "11.8", "12.2", "12.7", "12.1", "11.6"],
        ["100", "24.5", "25.3", "26.0", "25.1", "24.3"],
        ["150", "37.5", "38.4", "39.2", "38.1", "37.0"],
        ["200", "51.0", "52.2", "53.5", "52.0", "50.5"],
    ]
    _draw_mono_table(c, 20 * mm, y, rows_s)
    c.showPage()

    # Page 2 — MDO tank
    y = h - 20 * mm
    y = _draw_title(c, "NO.1 M.D.O. TANK (P) — SOUNDING TABLE", y)
    rows_m = [
        ["Depth", "1.5", "0.5", "0.0", "-0.5", "-1.5"],
        ["0", "0", "0", "0", "0", "0"],
        ["20", "4.2", "4.4", "4.5", "4.3", "4.1"],
        ["40", "8.5", "8.8", "9.0", "8.7", "8.3"],
        ["60", "13.0", "13.4", "13.8", "13.2", "12.7"],
        ["80", "17.6", "18.1", "18.6", "17.9", "17.2"],
        ["100", "22.4", "23.0", "23.6", "22.7", "21.8"],
    ]
    _draw_mono_table(c, 20 * mm, y, rows_m)
    c.save()


def write_gangos(path: Path):
    """Gangos-style: volume curve + separate hydrostatic LCG/TCG/VCG/IMOM block to skip."""
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    y = h - 20 * mm
    y = _draw_title(c, "FLAG GANGOS — MANUAL SOUNDING GZN361F-050-07-01JS", y)
    y = _draw_title(c, "F.O.T. NO.1 (P) SOUNDING TABLE", y)

    # Mixed table: sounding + volume + hydro columns (importer strips hydro)
    mixed = [
        ["SOUNDING", "VOLUME", "L.C.G", "T.C.G", "V.C.G", "IMOM"],
        ["cm", "m3", "m", "m", "m", "m4"],
        ["0", "0.0", "197.82", "4.62", "0.01", "1671.0"],
        ["20", "8.5", "197.90", "4.80", "0.08", "2100.0"],
        ["40", "17.2", "197.98", "5.00", "0.15", "2600.0"],
        ["60", "26.1", "198.02", "5.15", "0.22", "3100.0"],
        ["80", "35.4", "198.05", "5.28", "0.32", "3500.0"],
        ["100", "45.0", "198.07", "5.38", "0.43", "3897.0"],
        ["120", "54.8", "198.10", "5.45", "0.55", "4200.0"],
        ["140", "64.9", "198.12", "5.50", "0.68", "4500.0"],
    ]
    y = _draw_mono_table(
        c, 15 * mm, y, mixed,
        col_w=[28 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm],
    )

    y -= 10 * mm
    y = _draw_title(c, "HYDROSTATIC DATA (DO NOT USE FOR SOUNDING)", y)
    # Pure hydrostatic block — must be fully disregarded
    hydro = [
        ["L.C.G", "T.C.G", "V.C.G", "IMOM"],
        ["m", "m", "m", "m4"],
        ["197.82", "4.62", "0.01", "1671.0"],
        ["197.90", "4.80", "0.08", "2100.0"],
        ["198.07", "5.38", "0.43", "3897.0"],
        ["198.12", "5.50", "0.68", "4500.0"],
    ]
    y = _draw_mono_table(
        c, 20 * mm, y, hydro,
        col_w=[28 * mm, 28 * mm, 28 * mm, 28 * mm],
    )

    c.showPage()
    y = h - 20 * mm
    y = _draw_title(c, "D.O.T. NO.1 (S) SOUNDING TABLE", y)
    mixed2 = [
        ["SOUNDING", "VOLUME", "L.C.G", "T.C.G", "V.C.G", "IMOM"],
        ["cm", "m3", "m", "m", "m", "m4"],
        ["0", "0.0", "185.10", "-3.20", "0.02", "900.0"],
        ["25", "5.2", "185.15", "-3.10", "0.10", "1100.0"],
        ["50", "10.8", "185.20", "-3.00", "0.20", "1350.0"],
        ["75", "16.6", "185.22", "-2.95", "0.32", "1600.0"],
        ["100", "22.5", "185.25", "-2.90", "0.45", "1850.0"],
    ]
    _draw_mono_table(
        c, 15 * mm, y, mixed2,
        col_w=[28 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm],
    )
    c.save()


def write_giorgis(path: Path):
    """
    Giorgis-style bulk-carrier book: one tank with EVEN KEEL / TRIM BY STERN /
    TRIM BY HEAD as separate SOUNDING|VOLUME sections (importer merges to grid).
    Second tank uses ULLAGE|CAPACITY.
    """
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4

    y = h - 18 * mm
    y = _draw_title(c, "M/V GIORGIS — SOUNDING / ULLAGE TABLE (CAPACITY BOOK)", y)
    y = _draw_title(c, "NO.1 H.F.O. TANK (P)", y)

    y = _draw_title(c, "EVEN KEEL", y)
    y = _draw_mono_table(c, 20 * mm, y, [
        ["SOUNDING", "VOLUME"],
        ["cm", "m3"],
        ["0", "0.0"],
        ["50", "14.0"],
        ["100", "28.5"],
        ["150", "43.5"],
        ["200", "59.0"],
        ["250", "75.0"],
    ], col_w=[30 * mm, 30 * mm])

    y -= 4 * mm
    y = _draw_title(c, "TRIM 1.00 M BY STERN", y)
    y = _draw_mono_table(c, 20 * mm, y, [
        ["SOUNDING", "VOLUME"],
        ["cm", "m3"],
        ["0", "0.0"],
        ["50", "13.2"],
        ["100", "27.0"],
        ["150", "41.5"],
        ["200", "56.5"],
        ["250", "72.0"],
    ], col_w=[30 * mm, 30 * mm])

    y -= 4 * mm
    y = _draw_title(c, "TRIM 1.00 M BY HEAD", y)
    y = _draw_mono_table(c, 20 * mm, y, [
        ["SOUNDING", "VOLUME"],
        ["cm", "m3"],
        ["0", "0.0"],
        ["50", "14.8"],
        ["100", "30.0"],
        ["150", "45.5"],
        ["200", "61.5"],
        ["250", "78.0"],
    ], col_w=[30 * mm, 30 * mm])

    c.showPage()
    y = h - 18 * mm
    y = _draw_title(c, "NO.1 M.D.O. TANK (S) — ULLAGE TABLE", y)
    y = _draw_title(c, "EVEN KEEL", y)
    y = _draw_mono_table(c, 20 * mm, y, [
        ["ULLAGE", "CAPACITY"],
        ["cm", "m3"],
        ["200", "0.0"],
        ["150", "6.5"],
        ["100", "13.5"],
        ["50", "21.0"],
        ["0", "29.0"],
    ], col_w=[30 * mm, 30 * mm])
    y -= 4 * mm
    y = _draw_title(c, "TRIM 0.50 M BY STERN", y)
    y = _draw_mono_table(c, 20 * mm, y, [
        ["ULLAGE", "CAPACITY"],
        ["cm", "m3"],
        ["200", "0.0"],
        ["150", "6.1"],
        ["100", "12.8"],
        ["50", "20.0"],
        ["0", "27.5"],
    ], col_w=[30 * mm, 30 * mm])
    y -= 4 * mm
    y = _draw_title(c, "TRIM 0.50 M BY HEAD", y)
    _draw_mono_table(c, 20 * mm, y, [
        ["ULLAGE", "CAPACITY"],
        ["cm", "m3"],
        ["200", "0.0"],
        ["150", "6.9"],
        ["100", "14.2"],
        ["50", "22.0"],
        ["0", "30.5"],
    ], col_w=[30 * mm, 30 * mm])
    c.save()


def write_legacy_sample(path: Path):
    c = canvas.Canvas(str(path), pagesize=A4)
    y = A4[1] - 20 * mm
    y = _draw_title(c, "NO.1 H.F.O. TANK (P) — SOUNDING TABLE", y)
    rows = [
        ["SOUNDING", "2.0", "1.0", "0.0", "-1.0", "-2.0"],
        ["0", "0", "0", "0", "0", "0"],
        ["50", "12.1", "12.5", "13.0", "12.4", "11.9"],
        ["100", "25.0", "25.8", "26.5", "25.6", "24.8"],
        ["150", "38.2", "39.1", "40.0", "38.9", "37.8"],
        ["200", "52.0", "53.2", "54.5", "53.0", "51.5"],
        ["250", "66.5", "68.0", "69.5", "67.8", "65.9"],
    ]
    _draw_mono_table(c, 20 * mm, y, rows)
    c.save()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ships = OUT / "ships" / "giorgis"
    ships.mkdir(parents=True, exist_ok=True)
    write_veniamis(OUT / "sample-sounding-book-veniamis.pdf")
    write_gangos(OUT / "sample-sounding-book-gangos.pdf")
    write_giorgis(OUT / "sample-sounding-book-giorgis.pdf")
    write_legacy_sample(OUT / "sample-sounding-table.pdf")
    readme = ships / "README.txt"
    readme.write_text(
        "Drop real M/V GIORGIS capacity / sounding PDFs here for exterior inspect + OCR.\n"
        "Cloud agents cannot read C:\\Users\\...\\SHIPS FILE\\GIORGIS — copy PDFs into this folder.\n"
        "Then run:\n"
        "  python3 scripts/inspect-pdf-sounding.py templates/ships/giorgis\n"
        "  python3 scripts/import-pdf-tables.py templates/ships/giorgis/<file>.pdf --ocr\n",
        encoding="utf-8",
    )
    print("Wrote:")
    for name in (
        "sample-sounding-book-veniamis.pdf",
        "sample-sounding-book-gangos.pdf",
        "sample-sounding-book-giorgis.pdf",
        "sample-sounding-table.pdf",
    ):
        p = OUT / name
        print(f"  {p} ({p.stat().st_size} bytes)")
    print(f"  {readme}")


if __name__ == "__main__":
    main()
