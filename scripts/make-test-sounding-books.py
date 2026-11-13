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


def build_labels_pdf(path):
    """
    Headings written the way other books write them: GAUGE and ULLAGE for the depth, units
    under the heading or bare, a partial fill instead of the capacity, heel as H1P / H3S and
    trim as Tr=-2.
    """
    c = canvas.Canvas(path, pagesize=A4)

    def page(title, lines, n, total):
        page_frame(c, n, total, title)
        mono(c, 25 * mm, H - 40 * mm, lines)
        c.showPage()

    total = 4
    # Fresh water: GAUGE in cm over VOLUME in m3; the title gives 98% full, not the capacity.
    fw = ["  GAUGE (cm)        VOLUME (m3)"] + [f"{s:>10}{round(s * 0.8167, 3):>16.3f}" for s in range(0, 61)]
    page("NO.5 FRESH WATER TANK (S)  98% FULL 48.0 m3", fw[:52], 1, total)
    # Ullage book: the unit is a bare word on the row under the heading.
    ul = ["    ULLAGE          VOLUME", "      mm              m3"] + [f"{s:>10}{round(30.0 - s * 0.05, 3):>16.3f}" for s in range(0, 500, 10)]
    page("NO.6 D.B. TANK (P)  100% = 30.0 m3", ul[:52], 2, total)
    # Heel: H3P ... H3S, port negative.
    heels = ["H3P", "H2P", "H1P", "H1S", "H2S", "H3S"]
    hl = ["GAUGE  " + "".join(f"{h:>8}" for h in heels)]
    for s in range(0, 61, 10):
        hl.append(f"{s:<7}" + "".join(f"{round(-0.01 * s * (3 - i) if i < 3 else 0.01 * s * (i - 2), 2):>8.2f}" for i in range(6)))
    page("NO.5 FRESH WATER TANK (S) - HEEL CORRECTION", hl, 3, total)
    # Trim: Tr=-2 ... Tr=2.
    trims = [-2, -1, 0, 1, 2]
    tl = ["SOUNDING" + "".join(f"{('Tr=' + str(t)):>9}" for t in trims)]
    for s in range(0, 61, 10):
        tl.append(f"{s:<8}" + "".join(f"{round(s * 0.5 + t * 0.2, 2):>9.2f}" for t in trims))
    page("NO.5 FRESH WATER TANK (S) - TRIM CORRECTION", tl, 4, total)
    c.save()


def build_yard_layouts_pdf(path):
    """
    Three layouts from real ship books, rebuilt as text:
      1. a heeling correction table (STX): ullage in mm, heel to port -4..-1 and to
         starboard 1..4 in one row, "-" where there is no figure, negative figures run into
         the one before ("84.996-123.418"), and a second depth column (sounded depth) at the
         right edge that is the ullage taken from 5071;
      2. a trim correction table: "SOUNDED DEPTH mm", trims headed "TRIM BY STEM 1.0m",
         "EVEN KEEL 0.0m", "-0.5m" ... "TRIM BY STERN -1.5m" ..., volumes in "(M^3)", title
         "F.W.TK[S]";
      3. a combined sounding table (SDARI): GAUGE cm, FILL %, ULLAGE cm, Tr=-4 ... Tr=1 in m3,
         H1P ... H3S heel corrections, then L.C.G / T.C.G / V.C.G / IMOM to be left out, and
         the tank named on a "Compartment descr:" line.
    """
    c = canvas.Canvas(path, pagesize=A4)
    TOTAL = 3

    # --- 1. heeling correction, depth in millimetres
    page_frame(c, 1, TOTAL, None)
    c.setFont("Courier-Bold", 11)
    c.drawString(20 * mm, H - 24 * mm, "6.18 NO.1 H.F.O.TK(P)")
    lines = [
        "                HEELING CORRECTION TABLE",
        "            CORRECTION DEPTH IN MILLIMETERS (mm)",
        "",
        "ULLAGE       HEEL TO PORT (deg.)            HEEL TO STBD (deg.)        SOUNDED",
        "DEPTH     -4.0    -3.0    -2.0    -1.0     1.0   2.0   3.0   4.0       DEPTH",
        "  mm                                                                      mm",
    ]
    for u in range(0, 1001, 50):
        port = [round(430.67 - u * 0.27 - k * 7.1, 3) for k in range(4)]
        port = [v if v > 0 else None for v in port]
        stbd = [round(-123.4 - u * 0.05 * (k + 1) - k * 40, 3) if u >= 250 else None for k in range(4)]
        cells = []
        for v in port + stbd:
            cells.append(None if v is None else v)
        text = f"{u:>4}"
        for v in cells:
            if v is None:
                text += "      -"
            elif v < 0:
                text += f"{v:.3f}"          # the minus sign takes the gap: "84.996-123.418"
            else:
                text += f" {v:>8.3f}"
        text += f"{5071 - u:>9}"
        lines.append(text)
    mono(c, 12 * mm, H - 38 * mm, lines, size=7.5, lead=3.2 * mm)
    c.showPage()

    # --- 2. trim correction, capacities in cubic metres
    page_frame(c, 2, TOTAL, None)
    c.setFont("Courier-Bold", 11)
    c.drawString(20 * mm, H - 24 * mm, "F.W.TK[S]")
    trims = [1.0, 0.0, -0.5, -1.0, -1.5, -2.0, -3.0, -4.0]
    lines = [
        "              TRIM CORRECTION TABLE",
        "          CAPACITIES IN CUBIC METERS (M^3)",
        "",
        "              TRIM BY    EVEN                   TRIM BY",
        "SOUNDED        STEM      KEEL                    STERN",
        "DEPTH          1.0m      0.0m    -0.5m   -1.0m   -1.5m    -2.0m   -3.0m   -4.0m",
        "  mm",
    ]
    for d in range(4100, 4801, 50):
        row = [round(137.2 + (d - 4100) * 0.0243 - k * 0.2, 3) for k in range(8)]
        lines.append(f"{d:>5}  " + " ".join(f"{v:>8.3f}" for v in row))
    mono(c, 12 * mm, H - 38 * mm, lines, size=7.5, lead=3.2 * mm)
    c.showPage()

    # --- 3. combined sounding table
    page_frame(c, 3, TOTAL, None)
    head = [
        "SDARI                      SOUNDING TABLE",
        "BC57000                    MANUAL SOUNDING",
        "",
        "Compartment ident:    R3.03S",
        "Compartment descr:    NO.3 H.F.O.TK.S",
        "Contents          :   Heavy Fuel Oil (HFO, RHO = 0.98)",
        "",
    ]
    tr = [-4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1]
    hd = ["H1P", "H2P", "H3P", "H1S", "H2S", "H3S"]
    hydro = ["L.C.G", "T.C.G", "V.C.G", "IMOM"]
    h1 = "GAUGE  FILL ULLAGE " + "".join(f"{('Tr=' + (str(int(t)) if t == int(t) else str(t))):>9}" for t in tr) + "".join(f"{h:>6}" for h in hd[:0]) + "".join(f"{h:>6}" for h in hd) + "".join(f"{h:>8}" for h in hydro)
    h2 = "  cm     %    cm " + "".join(f"{'m3':>9}" for _ in tr) + "".join(f"{'m3':>6}" for _ in hd) + "".join(f"{u:>8}" for u in ("m", "m", "m", "m4"))
    rows = []
    for g in range(0, 76, 5):
        base = [round(0.44 + g * 0.8 + (t + 4) * 0.17, 2) for t in tr]
        heel = [round(0.5 + g * 0.002, 1), round(1.0 + g * 0.003, 1), round(1.5 + g * 0.004, 1),
                -0.5, round(-0.7 - g * 0.004, 1), round(-0.8 - g * 0.008, 1)]
        rows.append(f"{g:>4}{round(g * 0.0727, 1):>7.1f}{1080 - g:>7}" + "".join(f"{v:>9.2f}" for v in base)
                    + "".join(f"{v:>6.1f}" for v in heel) + f"{15.12:>8.2f}{-9.19 - g * 0.002:>8.2f}{9.03 + g * 0.002:>8.2f}{41.3 + g * 0.2:>8.1f}")
    mono(c, 6 * mm, H - 30 * mm, head + [h1, h2, ""] + rows, size=5.2, lead=2.6 * mm)
    c.showPage()
    c.save()


def build_fot_pdf(path):
    """
    A book that gives each tank three tables: TAB. 1 TRIM CORRECTION and TAB. 2 LIST CORRECTION
    (corrections in mm, soundings in metres to the centimetre), and TAB. 3 CAPACITY (gauge written
    metre-centimetre, two blocks side by side, with KG / LCG / IT columns that are not kept). The
    trim and list figures carry no sign: "BY THE HEAD" and "LIST TO PORT" give it.
    """
    c = canvas.Canvas(path, pagesize=A4)
    TOTAL = 3

    def head(title, n):
        page_frame(c, n, TOTAL, None)
        c.setFont("Courier-Bold", 11)
        c.drawString(20 * mm, H - 24 * mm, "TANK NAME : NO.1 F.O.T. PORT")
        c.setFont("Courier-Bold", 10)
        c.drawString(30 * mm, H - 32 * mm, title)

    # TAB. 1 trim: by the head 2.0M 1.0M, by the stern 1.0M ... 7.0M
    head("TAB. 1  TRIM CORRECTION TABLE", 1)
    lines = ["UNIT : MM", "",
             "SOUNDING     BY THE HEAD            B Y   T H E   S T E R N",
             "M-CM         2.0M   1.0M    1.0M   2.0M   3.0M   4.0M   5.0M   6.0M   7.0M"]
    for i in range(0, 40):
        d = i * 0.2
        head_c = [-(3 + min(i, 5) * 2), -(2 + min(i, 5))]
        stern_c = [2 + k * 7 + (i % 3) for k in range(7)]
        lines.append(f"{d:>5.2f}   " + "".join(f"{v:>7}" for v in head_c + stern_c))
    mono(c, 15 * mm, H - 42 * mm, lines, size=8)
    c.showPage()

    # TAB. 2 list: to port 3.0 ... 0.5, to starboard 0.5 ... 3.0
    head("TAB. 2  LIST CORRECTION TABLE", 2)
    lines = ["UNIT : MM", "",
             "SOUNDING      LIST TO PORT (DEG)                     LIST TO STARB'D (DEG)",
             "M-CM        3.0   2.5   2.0   1.5   1.0   0.5    0.5   1.0   1.5   2.0   2.5   3.0"]
    for i in range(0, 40):
        d = i * 0.2
        port = [-(i * k + 6 * k) for k in (6, 5, 4, 3, 2, 1)]
        stbd = [i * k + k for k in (1, 2, 3, 4, 5, 6)]
        lines.append(f"{d:>5.2f}   " + "".join(f"{v:>6}" for v in port + stbd))
    mono(c, 12 * mm, H - 42 * mm, lines, size=8)
    c.showPage()

    # TAB. 3 capacity: gauge M-CM, two blocks of five columns
    head("TAB. 3  CAPACITY TABLE", 3)
    lines = ["SOUNDING : 0.00M - 0.99M                         GAUGING HEIGHT : 7.771 M", "",
             "GAUGE   CAPACITY   KG     LCG      IT    GAUGE   CAPACITY   KG     LCG      IT",
             "M-CM     (M3)      (M)    (M)     (M4)   M-CM     (M3)      (M)    (M)     (M4)"]
    def g(cm):
        return f"{cm // 100}-{cm % 100:02d}" if cm % 10 == 0 else f"{cm % 100:02d}"
    for i in range(50):
        left, right = i, i + 50
        cap = lambda cm: round(0.79 + cm * 0.1131, 2)
        lines.append(f"{g(left):>5}{cap(left):>9.2f}{17.68:>8.2f}{86.14:>9.2f}{0.2 + i * 0.01:>8.1f}"
                     f"{g(right):>8}{cap(right):>9.2f}{18.01:>8.2f}{87.57:>9.2f}{3.0 + i * 0.02:>8.1f}")
    mono(c, 12 * mm, H - 42 * mm, lines, size=7.5)
    c.showPage()
    c.save()


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
    ap.add_argument("--seed", type=int, default=7, help="speckle pattern of the scan")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    text_pdf = os.path.join(args.outdir, "book-long.pdf")
    total = build_pdf(text_pdf)
    build_labels_pdf(os.path.join(args.outdir, "book-labels.pdf"))
    build_yard_layouts_pdf(os.path.join(args.outdir, "book-yards.pdf"))
    build_fot_pdf(os.path.join(args.outdir, "book-fot.pdf"))
    exp = expected()
    exp["pages"] = total
    with open(os.path.join(args.outdir, "expected.json"), "w") as fh:
        json.dump(exp, fh)
    if not args.no_scan:
        scan(text_pdf, os.path.join(args.outdir, "book-scanned.pdf"), seed=args.seed)
    print(f"wrote {total} pages to {args.outdir}")


if __name__ == "__main__":
    main()
