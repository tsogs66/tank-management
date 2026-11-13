#!/usr/bin/env python3
"""
Build the books the PDF importer is tested against.

make-sample-sounding-pdfs.py writes the small sample books under templates/.
These are the awkward ones - what a real book is like once it is long:

  book-long.pdf     4 tanks, 11 pages. A table that runs over several pages with
                    "(CONT'D)" on some and no title at all on others, a header
                    repeated or missing on the continuation, the vessel's name
                    and "Page n of N" on every page, a hydrostatic block that
                    must be ignored, soundings printed in blocks side by side,
                    and a sounding x trim grid.
  book-scanned.pdf  the same pages as pictures with no text layer, slightly
                    skewed and speckled the way a photocopy is.
  expected.json     what the importer has to find.

Usage: make-test-sounding-books.py OUTDIR [--no-scan]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import sys
import tempfile

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

W, H = A4
VESSEL = "M/V TEST CARRIER"


def curve_hfo(s):
    """No.1 HFO storage (P): 0..250 cm."""
    f = s / 250.0
    return round(212.4 * (0.82 * f + 0.18 * f * f), 3)


def curve_mdo(s):
    f = s / 140.0
    return round(48.75 * (0.9 * f + 0.1 * f * f * f), 3)


def curve_fw(s):
    f = s / 179.0
    return round(96.2 * f, 3)


def grid_wbt(s, trim):
    return round(max(0.0, s * 1.9 + trim * min(s, 60) * 0.35), 2)


def page_frame(c, n, total, tank_title):
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, H - 12 * mm, f"{VESSEL} - TANK SOUNDING TABLES")
    c.drawRightString(W - 20 * mm, H - 12 * mm, "IMO 9999999")
    c.drawString(20 * mm, 12 * mm, f"Page {n} of {total}")
    c.drawRightString(W - 20 * mm, 12 * mm, "Rev. 2  Approved")
    c.setFont("Courier-Bold", 12)
    if tank_title:
        c.drawString(20 * mm, H - 28 * mm, tank_title)


def mono(c, x, y, lines, size=8.5, lead=3.4 * mm):
    c.setFont("Courier", size)
    for ln in lines:
        c.drawString(x, y, ln)
        y -= lead
    return y


def two_col(s, v, w=10):
    return f"{s:>{w}}{v:>16.3f}"


def build_pdf(path):
    c = canvas.Canvas(path, pagesize=A4)
    pages = []  # callables so the total is known

    # --- Tank 1: 251 rows over 5 pages, title on every page, header repeated.
    rows1 = [(s, curve_hfo(s)) for s in range(0, 251)]
    chunks = [rows1[i:i + 52] for i in range(0, len(rows1), 52)]
    for i, chunk in enumerate(chunks):
        def draw(c, n, total, chunk=chunk, i=i):
            title = "NO.1 H.F.O. STORAGE TANK (P) - SOUNDING TABLE" if i == 0 else "NO.1 H.F.O. STORAGE TANK (P) (CONT'D)"
            page_frame(c, n, total, title)
            lines = ["     SOUNDING          VOLUME", "        (cm)            (m3)"]
            lines += [two_col(s, v) for s, v in chunk]
            mono(c, 25 * mm, H - 40 * mm, lines)
        pages.append(draw)

    # --- Tank 2: 3 pages; the second has no title and no header at all, the
    # third carries only "(CONT'D)" and no header.
    rows2 = [(s, curve_mdo(s)) for s in range(0, 141)]
    def draw2a(c, n, total):
        page_frame(c, n, total, "NO.2 M.D.O. SERVICE TANK (S) - SOUNDING TABLE")
        mono(c, 25 * mm, H - 40 * mm, ["     SOUNDING          VOLUME", "        (cm)            (m3)"] + [two_col(s, v) for s, v in rows2[:52]])
    def draw2b(c, n, total):
        page_frame(c, n, total, None)
        mono(c, 25 * mm, H - 40 * mm, [two_col(s, v) for s, v in rows2[52:104]])
    def draw2c(c, n, total):
        page_frame(c, n, total, "NO.2 M.D.O. SERVICE TANK (S) (CONT'D)")
        mono(c, 25 * mm, H - 40 * mm, [two_col(s, v) for s, v in rows2[104:]])
    pages += [draw2a, draw2b, draw2c]

    # --- Tank 3: soundings printed in three blocks side by side.
    rows3 = [(s, curve_fw(s)) for s in range(0, 180)]
    def draw3(c, n, total):
        page_frame(c, n, total, "FWT 3 C  CAPACITY 96.2 M3")
        hdr = "  SOUNDING   VOLUME   |  SOUNDING   VOLUME   |  SOUNDING   VOLUME"
        lines = [hdr]
        for i in range(60):
            cells = []
            for b in range(3):
                s, v = rows3[b * 60 + i]
                cells.append(f"{s:>9}{v:>10.3f}  ")
            lines.append("|".join(cells))
        mono(c, 12 * mm, H - 40 * mm, lines, size=8)
    pages.append(draw3)

    # --- Tank 4: sounding x trim grid with a hydrostatic block on the same page.
    trims = [2, 1, 0, -1, -2]
    def draw4(c, n, total):
        page_frame(c, n, total, "NO.4 W.B.T. (P)")
        lines = ["SOUNDING " + "".join(f"{t:>9}" for t in trims)]
        for s in range(0, 121, 10):
            lines.append(f"{s:<9}" + "".join(f"{grid_wbt(s, t):>9.2f}" for t in trims))
        y = mono(c, 25 * mm, H - 40 * mm, lines)
        mono(c, 25 * mm, y - 12 * mm, [
            "HYDROSTATIC DATA (DO NOT USE FOR SOUNDING)",
            "SOUNDING   VOLUME    L.C.G.   T.C.G.   V.C.G.   IMOM",
            "      10    21.000    -3.100    4.200    0.310   120.0",
            "      20    41.000    -3.000    4.100    0.620   231.0",
            "      30    62.000    -2.900    4.000    0.930   342.0",
        ])
    pages.append(draw4)

    total = len(pages)
    for i, fn in enumerate(pages, start=1):
        fn(c, i, total)
        c.showPage()
    c.save()
    return total


def expected():
    return {
        "pages": 9,
        "tanks": {
            "NO.1 H.F.O. STORAGE TANK (P)": {"x": list(range(0, 251)), "v": [curve_hfo(s) for s in range(0, 251)], "pages": [1, 5]},
            "NO.2 M.D.O. SERVICE TANK (S)": {"x": list(range(0, 141)), "v": [curve_mdo(s) for s in range(0, 141)], "pages": [6, 8]},
            "FWT 3 C": {"x": list(range(0, 180)), "v": [curve_fw(s) for s in range(0, 180)], "capacity": 96.2, "pages": [9, 9]},
            "NO.4 W.B.T. (P)": {
                "axis": list(range(0, 121, 10)), "vals": [2, 1, 0, -1, -2],
                "grid": [[grid_wbt(s, t) for t in [2, 1, 0, -1, -2]] for s in range(0, 121, 10)],
                "pages": [10, 10],
            },
        },
    }


def scan(src, dst, seed=7, dpi=200):
    """Pages as pictures with no text: a little skew, speckle and fading."""
    from PIL import Image, ImageFilter
    rnd = random.Random(seed)
    tmp = tempfile.mkdtemp(prefix="scan-")
    subprocess.run(["pdftoppm", "-r", str(dpi), "-gray", "-png", src, os.path.join(tmp, "p")], check=True)
    imgs = []
    for name in sorted(os.listdir(tmp)):
        im = Image.open(os.path.join(tmp, name)).convert("L")
        im = im.rotate(rnd.uniform(-0.8, 0.8), expand=False, fillcolor=255, resample=Image.BICUBIC)
        px = im.load()
        w, h = im.size
        for _ in range(w * h // 700):
            x, y = rnd.randrange(w), rnd.randrange(h)
            px[x, y] = rnd.choice((0, 90, 160))
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        im = im.point(lambda p: min(255, int(p * 0.92 + 14)))
        out = os.path.join(tmp, name.replace(".png", ".jpg"))
        im.save(out, quality=72, dpi=(dpi, dpi))
        imgs.append(out)
    import img2pdf
    with open(dst, "wb") as fh:
        fh.write(img2pdf.convert(imgs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--no-scan", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    text_pdf = os.path.join(args.outdir, "book-long.pdf")
    total = build_pdf(text_pdf)
    exp = expected()
    exp["pages"] = total
    with open(os.path.join(args.outdir, "expected.json"), "w") as fh:
        json.dump(exp, fh)
    if not args.no_scan:
        scan(text_pdf, os.path.join(args.outdir, "book-scanned.pdf"))
    print(f"wrote {total} pages to {args.outdir}")


if __name__ == "__main__":
    main()
