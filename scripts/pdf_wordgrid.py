"""
Reading a table from where the figures sit on the page.

A scan's text layer is a bag of words with positions. The usual ways of turning
that into a table (ruled-line finders, splitting on runs of spaces) both break
on a scan: a speckle becomes a column, a figure is cut in two, and a page with
three SOUNDING / VOLUME pairs side by side comes out as a mess. This looks at
the page the way a person does:

  - every word that is a number (allowing for the usual OCR slips) is a figure;
  - figures on one line are a row, figures that line up are a column;
  - words above the first row that name things ("SOUNDING", "VOLUME", "(cm)")
    are the header, placed over the column they sit above;
  - anything that is not a figure and not part of the header (a speckle, a
    stamp, "Patat") is left out, and a line that is the page's furniture ("Page
    3 of 40", the vessel's name) is not a row.

The result is the same list-of-rows the other readers give, so it competes
with them on the page's merits.
"""
from __future__ import annotations

import re
from statistics import median

import pdf_headers
from pdf_headers import BOILERPLATE_RE, numeric_token

LABEL_RE = re.compile(
    r"^(?:SOUNDING|SOUND\.?|ULLAGE|GAUGE|DEPTH|INNAGE|VOLUME|VOL\.?|CAPACITY|CAP\.?|TRIM|HEEL|LIST)\b|^\(?(?:CM|MM|M3|M³|M)\)?$",
    re.I,
)


def is_label_line(words):
    """A line that is mostly column labels ("SOUNDING VOLUME (cm) (m3)"), not a sentence that has one."""
    alpha = [w["text"] for w in words if re.search(r"[A-Za-z]", w["text"]) and len(w["text"].strip(" .,;:'\"[]()|")) >= 2]
    if not alpha:
        return False
    hits = sum(1 for t in alpha if LABEL_RE.match(t.strip(" .,;:'\"[]|")))
    return hits >= 1 and hits >= 0.5 * len(alpha)


def _cluster(values, tol):
    """1-D clusters: sorted values split wherever the gap exceeds tol."""
    pts = sorted(values)
    groups = []
    for v in pts:
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return groups


def fix_trim_header(matrix, data):
    """
    A row of trims (2 1 0 -1 -2) printed over a sounding column. OCR drops the
    odd one ("it" for 1, ")" for 0), and the label "SOUNDING" may sit on the
    same line. Trims are evenly spaced, so a hole between figures that agree on
    their spacing is filled; and the first cell, empty because the label was
    not a figure, is named.
    """
    if not matrix:
        return matrix
    first = matrix[0]
    ncols = len(first)
    nums = [(i, numeric_token(c)[0]) for i, c in enumerate(first) if c and numeric_token(c)]
    body_axis = sum(1 for r in matrix[1:] if r and r[0] and numeric_token(r[0]))
    if first and first[0] == "" and len(nums) >= 2 and body_axis >= max(3, len(matrix[1:]) // 2):
        # Trims are evenly spaced. Find the progression most of the figures that were
        # read agree with (a figure misread as another, or lost, is outvoted) and
        # write it over the whole row - only when at least three columns, and 60% of
        # them, agree, so a header is never invented from one or two figures.
        best = None
        for ia in range(len(nums)):
            for ib in range(ia + 1, len(nums)):
                (i, vi), (j, vj) = nums[ia], nums[ib]
                step = (vj - vi) / (j - i)
                if step == 0:
                    continue
                agree = sum(1 for (k, vk) in nums if abs(vi + step * (k - i) - vk) < 1e-6)
                if best is None or agree > best[0]:
                    best = (agree, vi - step * i, step)
        # Two figures can still say what the rest are when they sit side by side, or when they
        # are a whole number apart (the usual 1 m trim step); anything vaguer is left alone.
        two = best and best[0] == 2 and len(nums) == 2 and (
            abs(nums[0][0] - nums[1][0]) == 1 or abs(best[2]) == 1.0) and ncols - 1 >= 3
        if best and ((best[0] >= 3 and best[0] >= 0.6 * (ncols - 1)) or two):
            _agree, base, step = best
            fixed = list(first)
            for k in range(1, ncols):
                fixed[k] = "%g" % round(base + step * k, 6)
            first = fixed
        first = list(first)
        first[0] = "SOUNDING"
        matrix = [first] + matrix[1:]
    return matrix


def build(page, min_rows=6):
    try:
        words = page.extract_words(x_tolerance=3, y_tolerance=3, keep_blank_chars=False, use_text_flow=False) or []
    except Exception:
        return None
    if len(words) < 12:
        return None
    heights = [w["bottom"] - w["top"] for w in words if w["bottom"] > w["top"]]
    if not heights:
        return None
    mh = median(heights)

    # Row bands from every word, so a line's furniture can be recognised as a whole.
    ordered = sorted(words, key=lambda w: (w["top"] + w["bottom"]) / 2)
    lines = []
    for w in ordered:
        cy = (w["top"] + w["bottom"]) / 2
        if lines and cy - lines[-1]["cy"] <= 0.6 * mh:
            ln = lines[-1]
            ln["words"].append(w)
            ln["cy"] = sum((x["top"] + x["bottom"]) / 2 for x in ln["words"]) / len(ln["words"])
        else:
            lines.append({"cy": cy, "words": [w]})

    # Where the header labels are: figures above them are not table data.
    label_tops = [
        min(w["top"] for w in ln["words"])
        for ln in lines
        if is_label_line(ln["words"])
    ]
    first_label_top = min(label_tops) if label_tops else None

    # A table ends where another begins: a second row of column labels, or a
    # heading such as "HYDROSTATIC DATA (DO NOT USE ...)", cuts the page here.
    cut_at = None
    seen_figures = 0
    for ln in lines:
        text_all = " ".join(w["text"] for w in ln["words"])
        figs_here = sum(1 for w in ln["words"] if numeric_token(w["text"]))
        if seen_figures >= 3 and (is_label_line(ln["words"]) or re.search(r"HYDROSTATIC|DONOTUSE", re.sub(r"\s+", "", text_all), re.I)):
            cut_at = min(w["top"] for w in ln["words"])
            break
        if figs_here >= 2:
            seen_figures += 1

    data = []  # (line, [(word, value, text)])
    for ln in lines:
        if cut_at is not None and min(w["top"] for w in ln["words"]) >= cut_at - 1:
            continue
        text_all = " ".join(w["text"] for w in sorted(ln["words"], key=lambda w: w["x0"]))
        figs = []
        for w in ln["words"]:
            tok = numeric_token(w["text"])
            if tok is not None:
                figs.append((w, tok[0], tok[1]))
        if not figs:
            continue
        if first_label_top is not None and max(w["bottom"] for w in ln["words"]) < first_label_top:
            continue
        # The page's own furniture is not a row.
        if BOILERPLATE_RE.search(text_all):
            rest = BOILERPLATE_RE.sub(" ", text_all).split()
            if sum(1 for t in rest if numeric_token(t)) <= 1:
                continue
        data.append((ln, figs))
    if len(data) < min_rows:
        return None

    # Columns: figures that line up. Numbers are normally right-aligned, but a
    # book can left-align them, so use whichever edge gives fewer columns.
    tol = max(2.0, 0.9 * mh)
    allfigs = [f for _ln, figs in data for f in figs]
    support = max(2, int(0.25 * len(data)))

    def columns(edge):
        groups = _cluster([f[0][edge] for f in allfigs], tol)
        return [g for g in groups if len(g) >= support]

    right, left = columns("x1"), columns("x0")
    edge, cols = ("x1", right) if (right and (not left or len(right) <= len(left))) else ("x0", left)
    if len(cols) < 2:
        return None
    centers = [sum(g) / len(g) for g in cols]

    matrix = []
    for ln, figs in data:
        cells = [None] * len(centers)
        for w, val, txt in sorted(figs, key=lambda f: f[0]["x0"]):
            x = w[edge]
            ci = min(range(len(centers)), key=lambda i: abs(centers[i] - x))
            if abs(centers[ci] - x) > 2.5 * tol:
                continue  # not in any column: a speckle that read as a digit
            if cells[ci] is None or abs(centers[ci] - x) < abs(centers[ci] - cells[ci][0]):
                cells[ci] = (x, txt)
        if sum(1 for c in cells if c) >= 1:
            matrix.append([c[1] if c else "" for c in cells])
    if len(matrix) < min_rows:
        return None

    matrix = fix_trim_header(matrix, data)

    # Header: the words that name the columns, over the first row.
    first_top = min(w["top"] for w in data[0][0]["words"])
    header_lines = []
    for ln in lines:
        top = min(w["top"] for w in ln["words"])
        if top >= first_top - 0.5 * mh:
            continue
        if first_top - top > 6 * mh:
            continue
        texts = [w for w in ln["words"] if numeric_token(w["text"]) is None and re.search(r"\w", w["text"])]
        if texts and is_label_line(ln["words"]):
            header_lines.append(texts)
    # Each column's span, to place labels over.
    spans = []
    for g, c in zip(cols, centers):
        members = [f for f in allfigs if f[0][edge] in g]
        spans.append((min(m[0]["x0"] for m in members), max(m[0]["x1"] for m in members)))

    def place(texts):
        row = [""] * len(centers)
        for w in sorted(texts, key=lambda w: w["x0"]):
            cx = (w["x0"] + w["x1"]) / 2
            ci = min(range(len(centers)), key=lambda i: abs((spans[i][0] + spans[i][1]) / 2 - cx))
            row[ci] = (row[ci] + " " + w["text"]).strip() if row[ci] else w["text"]
        return row

    header_rows = [place(t) for t in header_lines[-2:]]
    # A figure the scan lost leaves a hole in its row. Mark it, so that the figures after it
    # keep their columns instead of sliding left into the hole (a grid row read as if its
    # trims were one off is a wrong table that looks right).
    body = []
    for k, r in enumerate(matrix):
        if k == 0 and r and r[0] in ("SOUNDING",):
            body.append(r)
            continue
        last = max((i for i, c in enumerate(r) if c), default=-1)
        body.append([c if c else ("?" if i <= last else "") for i, c in enumerate(r)])
    return header_rows + body
