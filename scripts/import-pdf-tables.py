#!/usr/bin/env python3
"""
Extract sounding / calibration tables from a PDF and return JSON.

Usage:
  python3 scripts/import-pdf-tables.py path/to/tables.pdf
  python3 scripts/import-pdf-tables.py path/to/tables.pdf --page 1

Output JSON:
  {
    "pages": N,
    "tables": [
      {
        "id": "p1-t0",
        "page": 1,
        "index": 0,
        "rows": R,
        "cols": C,
        "preview": [[...], ...],
        "raw": [[...], ...],
        "parsed": {
          "kind": "grid" | "volumeCurve" | "unknown",
          "trimAxis": [...],
          "trimVals": [...],
          "trimGrid": [[...], ...],
          "volumeCurve": {"x":[...], "v":[...]},
          "soundingIncrement": 1
        }
      }
    ]
  }
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed. Run: pip3 install pdfplumber"}))
    sys.exit(1)


NUM_RE = re.compile(
    r"^[+-]?(?:\d+(?:[.,]\d+)?|\d*[.,]\d+)(?:[eE][+-]?\d+)?$"
)


def to_number(cell):
    if cell is None:
        return None
    if isinstance(cell, (int, float)) and not isinstance(cell, bool):
        return float(cell)
    s = str(cell).strip().replace("\u2212", "-").replace(" ", "")
    if not s or s in {"-", "—", "–", "."}:
        return None
    s = s.replace(",", ".")  # European decimal
    if not NUM_RE.match(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_row(row):
    return [None if c is None else str(c).strip() for c in (row or [])]


def normalize_table(raw_rows):
    """Trim empty border rows/cols; return matrix of original string cells."""
    rows = [clean_row(r) for r in raw_rows if r and any(str(c or "").strip() for c in r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    # drop empty trailing/leading columns
    def col_empty(ci):
        return all(not (rows[ri][ci] or "").strip() for ri in range(len(rows)))

    while rows and width and col_empty(0):
        rows = [r[1:] for r in rows]
        width -= 1
    while rows and width and col_empty(width - 1):
        rows = [r[:-1] for r in rows]
        width -= 1
    return rows


def detect_inc(axis):
    if len(axis) < 2:
        return 1
    diffs = [
        round(abs(axis[i] - axis[i - 1]) * 1000) / 1000
        for i in range(1, len(axis))
        if axis[i] != axis[i - 1]
    ]
    if not diffs:
        return 1
    best = Counter(diffs).most_common(1)[0][0]
    for p in (1, 2, 5, 10, 20, 25, 50):
        if abs(best - p) < 1e-6:
            return p
    return best


def parse_as_grid(rows):
    """
    Parse Excel-like calibration grid:
      [blank/label] | trim1 | trim2 | ...
      sounding1     | v11   | v12   | ...
      sounding2     | v21   | v22   | ...
    Also accepts first header cell being text (SOUNDING / Depth / GAUGE).
    """
    if len(rows) < 2 or len(rows[0]) < 2:
        return None

    header = rows[0]
    # Column headers (trim/heel values) start at col 1
    trim_vals = []
    for c in range(1, len(header)):
        n = to_number(header[c])
        if n is None:
            # allow a single non-numeric gap then stop
            if trim_vals:
                break
            continue
        trim_vals.append(n)
    if len(trim_vals) < 2:
        return None

    trim_axis = []
    trim_grid = []
    for r in rows[1:]:
        axis = to_number(r[0])
        if axis is None:
            # skip non-numeric row labels (section titles)
            continue
        row_vals = []
        ok = 0
        for c in range(1, 1 + len(trim_vals)):
            n = to_number(r[c] if c < len(r) else None)
            if n is None:
                row_vals.append(0.0)
            else:
                row_vals.append(n)
                ok += 1
        if ok == 0:
            continue
        trim_axis.append(axis)
        trim_grid.append(row_vals)

    if len(trim_axis) < 2:
        return None

    return {
        "kind": "grid",
        "trimAxis": trim_axis,
        "trimVals": trim_vals,
        "trimGrid": trim_grid,
        "listAxis": [],
        "listVals": [],
        "listGrid": [],
        "volumeCurve": {"x": [], "v": []},
        "soundingIncrement": detect_inc(trim_axis),
        "heelIncrement": 1,
        "capacity": max(max(row) for row in trim_grid) if trim_grid else 0,
    }


def parse_as_volume_curve(rows):
    """
    Two-column table: sounding/ullage | volume
    or three-column with an ignored middle label.
    """
    if len(rows) < 2:
        return None

    # find two numeric columns
    xs, vs = [], []
    start = 0
    # skip header if non-numeric
    if to_number(rows[0][0]) is None and to_number(rows[0][1] if len(rows[0]) > 1 else None) is None:
        start = 1

    for r in rows[start:]:
        nums = [to_number(c) for c in r]
        nums = [n for n in nums if n is not None]
        if len(nums) >= 2:
            xs.append(nums[0])
            vs.append(nums[1])
        elif len(nums) == 1:
            continue
    if len(xs) < 2:
        return None

    return {
        "kind": "volumeCurve",
        "trimAxis": [],
        "trimVals": [],
        "trimGrid": [],
        "listAxis": [],
        "listVals": [],
        "listGrid": [],
        "volumeCurve": {"x": xs, "v": vs},
        "soundingIncrement": detect_inc(xs),
        "heelIncrement": 1,
        "capacity": max(vs) if vs else 0,
    }


def _grid_score(grid):
    """Prefer longer axes and headers with distinct trim/list values."""
    vals = grid.get("trimVals") or []
    distinct = len(set(vals))
    return (distinct > 1, len(grid.get("trimAxis") or []), distinct, len(vals))


def parse_table(rows):
    # Try from several start rows — capacity PDFs often have a title line above the header
    best_grid = None
    for start in range(0, min(6, max(0, len(rows) - 2))):
        grid = parse_as_grid(rows[start:])
        if grid and (best_grid is None or _grid_score(grid) > _grid_score(best_grid)):
            best_grid = grid
    if best_grid:
        return best_grid

    best_curve = None
    for start in range(0, min(6, max(0, len(rows) - 2))):
        curve = parse_as_volume_curve(rows[start:])
        if curve and (best_curve is None or len(curve["volumeCurve"]["x"]) > len(best_curve["volumeCurve"]["x"])):
            best_curve = curve
    if best_curve:
        return best_curve

    return {
        "kind": "unknown",
        "trimAxis": [],
        "trimVals": [],
        "trimGrid": [],
        "listAxis": [],
        "listVals": [],
        "listGrid": [],
        "volumeCurve": {"x": [], "v": []},
        "soundingIncrement": 1,
        "heelIncrement": 1,
        "capacity": 0,
    }


def extract_tables(pdf_path, page_filter=None):
    tables_out = []
    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        for pi, page in enumerate(pdf.pages, start=1):
            if page_filter is not None and pi not in page_filter:
                continue
            # Try multiple extraction strategies
            strategies = [
                dict(vertical_strategy="lines", horizontal_strategy="lines"),
                dict(vertical_strategy="text", horizontal_strategy="text"),
                dict(vertical_strategy="lines_strict", horizontal_strategy="lines_strict"),
            ]
            seen = set()
            page_tables = []
            for settings in strategies:
                try:
                    found = page.extract_tables(table_settings=settings) or []
                except Exception:
                    found = []
                for raw in found:
                    norm = normalize_table(raw)
                    if len(norm) < 2 or len(norm[0]) < 2:
                        continue
                    key = json.dumps(norm[:5])  # fingerprint
                    if key in seen:
                        continue
                    seen.add(key)
                    page_tables.append(norm)

            # Fallback: rebuild a table from words by y-clustering if nothing found
            if not page_tables:
                rebuilt = rebuild_from_words(page)
                if rebuilt:
                    page_tables.append(rebuilt)

            for ti, norm in enumerate(page_tables):
                parsed = parse_table(norm)
                preview = [row[:12] for row in norm[:12]]
                tables_out.append({
                    "id": f"p{pi}-t{ti}",
                    "page": pi,
                    "index": ti,
                    "rows": len(norm),
                    "cols": len(norm[0]) if norm else 0,
                    "preview": preview,
                    "raw": norm,
                    "parsed": parsed,
                    "titleHint": guess_title(page, norm),
                })
    return {"pages": page_count if 'page_count' in dir() else None, "tables": tables_out}


def guess_title(page, norm):
    """Use nearby text above the table as a tank name hint."""
    try:
        text = page.extract_text() or ""
    except Exception:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:8]:
        u = ln.upper()
        if any(k in u for k in ("TANK", "HFO", "MDO", "MGO", "ULLAGE", "SOUNDING", "GAUGE")):
            return ln[:120]
    return lines[0][:120] if lines else ""


def rebuild_from_words(page):
    """Cluster words into rows/cols when ruled tables are missing."""
    words = page.extract_words() or []
    if len(words) < 8:
        return None
    # cluster by top (y)
    words = sorted(words, key=lambda w: (round(w["top"], 1), w["x0"]))
    rows = []
    current = []
    current_y = None
    for w in words:
        y = round(w["top"] / 3) * 3  # ~3pt buckets
        if current_y is None or abs(y - current_y) <= 3:
            current.append(w)
            current_y = y if current_y is None else current_y
        else:
            rows.append(current)
            current = [w]
            current_y = y
    if current:
        rows.append(current)

    if len(rows) < 3:
        return None

    # Build column bins from first numeric-heavy row
    xs = sorted({round(w["x0"] / 8) * 8 for row in rows for w in row})
    if len(xs) < 2:
        return None

    matrix = []
    for row in rows:
        cells = [""] * len(xs)
        for w in row:
            # nearest column
            x = round(w["x0"] / 8) * 8
            ci = min(range(len(xs)), key=lambda i: abs(xs[i] - x))
            cells[ci] = (cells[ci] + " " + w["text"]).strip() if cells[ci] else w["text"]
        if any(cells):
            matrix.append(cells)

    # Keep only rows with at least 2 numeric cells or a header-like first row
    filtered = []
    for r in matrix:
        nums = sum(1 for c in r if to_number(c) is not None)
        if nums >= 2 or (filtered == [] and len(r) >= 2):
            filtered.append(r)
    return normalize_table(filtered) if len(filtered) >= 2 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, action="append", help="1-based page number (repeatable)")
    args = ap.parse_args()
    page_filter = set(args.page) if args.page else None
    try:
        with pdfplumber.open(args.pdf) as pdf:
            page_count = len(pdf.pages)
        result = extract_tables(args.pdf, page_filter=page_filter)
        result["pages"] = page_count
        result["file"] = args.pdf
        json.dump(result, sys.stdout)
    except Exception as e:
        json.dump({"error": str(e), "tables": []}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
