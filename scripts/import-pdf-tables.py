#!/usr/bin/env python3
"""
Extract sounding / calibration tables from a PDF and return JSON.

Usage:
  python3 scripts/import-pdf-tables.py path/to/tables.pdf
  python3 scripts/import-pdf-tables.py path/to/tables.pdf --page 1
  python3 scripts/import-pdf-tables.py path/to/tables.pdf --ocr   # optional, needs ocrmypdf/tesseract

Output JSON:
  {
    "pages": N,
    "ocrUsed": false,
    "skippedHydrostatic": N,
    "tanks": [ { "name": "...", "tables": [ids...] } ],
    "tables": [
      {
        "id": "p1-t0",
        "page": 1,
        "tankName": "...",
        "layoutHint": "trimGrid" | "soundingVolume" | "unknown",
        "skipped": false,
        "skipReason": null,
        "parsed": { "kind": "grid" | "volumeCurve" | "unknown" | "hydrostatic", ... }
      }
    ]
  }

Automatically disregards hydrostatic blocks with headers L.C.G / T.C.G / V.C.G / IMOM
(and related FSM / inertia columns). Mixed SOUNDING|VOLUME|LCG… tables keep only
sounding / volume columns.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed. Run: pip3 install pdfplumber"}))
    sys.exit(1)


NUM_RE = re.compile(
    r"^[+-]?(?:\d+(?:[.,]\d+)?|\d*[.,]\d+)(?:[eE][+-]?\d+)?$"
)

# Hydrostatic / stability columns — never import as sounding calibration
HYDRO_HEADER_RE = re.compile(
    r"\b(?:"
    r"L\.?\s*C\.?\s*G\.?"
    r"|T\.?\s*C\.?\s*G\.?"
    r"|V\.?\s*C\.?\s*G\.?"
    r"|I\.?\s*MOM\.?"
    r"|IMOM"
    r"|FSM"
    r"|F\.?\s*S\.?\s*M\.?"
    r"|INERTIA"
    r"|MOMENT\s+OF\s+INERTIA"
    r"|LONG\.?\s*C\.?\s*G\.?"
    r"|TRANS\.?\s*C\.?\s*G\.?"
    r"|VERT\.?\s*C\.?\s*G\.?"
    r")\b",
    re.IGNORECASE,
)

# Useful sounding / volume column labels
SOUNDING_HEADER_RE = re.compile(
    r"\b(?:"
    r"SOUNDING|ULLAGE|GAUGE|DEPTH|SOUND\.?"
    r"|VOLUME|VOL\.?|CAP(?:ACITY)?"
    r"|TRIM|HEEL|LIST"
    r"|m3|M³|CUB\.?"
    r")\b",
    re.IGNORECASE,
)

TANK_NAME_RE = re.compile(
    r"(?:"
    r"(?:NO\.?\s*)?\d+\s*(?:H\.?\s*F\.?\s*O\.?|M\.?\s*D\.?\s*O\.?|M\.?\s*G\.?\s*O\.?|"
    r"D\.?\s*O\.?|F\.?\s*O\.?|L\.?\s*O\.?|FW|F\.?\s*W\.?|SW|S\.?\s*W\.?|"
    r"HFO|MDO|MGO|DO|FO|LO)\s*"
    r"(?:TANK|TK\.?)?"
    r"(?:\s*[\(\[]\s*[PSC]\s*[\)\]])?"
    r"|"
    r"(?:F\.?\s*O\.?\s*T\.?|D\.?\s*O\.?\s*T\.?|H\.?\s*F\.?\s*O\.?\s*T\.?|"
    r"M\.?\s*D\.?\s*O\.?\s*T\.?|M\.?\s*G\.?\s*O\.?\s*T\.?|L\.?\s*O\.?\s*T\.?|"
    r"F\.?\s*W\.?\s*T\.?|S\.?\s*W\.?\s*T\.?)\s*"
    r"(?:NO\.?\s*)?\d*"
    r"(?:\s*[\(\[]\s*[PSC]\s*[\)\]])?"
    r"|"
    r"[A-Z0-9][A-Z0-9 ./()-]{2,40}\s+TANK(?:\s*[\(\[]\s*[PSC]\s*[\)\]])?"
    r")",
    re.IGNORECASE,
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


def densify_row(row):
    """Drop empty cells left by word-gap column bins (monospaced PDFs)."""
    return [c for c in row if str(c or "").strip()]


def normalize_table(raw_rows, densify=False):
    """Trim empty border rows/cols; return matrix of original string cells."""
    rows = [clean_row(r) for r in raw_rows if r and any(str(c or "").strip() for c in r)]
    if densify:
        rows = [densify_row(r) for r in rows]
        rows = [r for r in rows if r]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    def col_empty(ci):
        return all(not (rows[ri][ci] or "").strip() for ri in range(len(rows)))

    while rows and width and col_empty(0):
        rows = [r[1:] for r in rows]
        width -= 1
    while rows and width and col_empty(width - 1):
        rows = [r[:-1] for r in rows]
        width -= 1

    # If many columns are sparse empties (word clustering), densify
    if width >= 6:
        empty_cols = sum(1 for ci in range(width) if col_empty(ci))
        if empty_cols >= width // 3:
            return normalize_table(rows, densify=True)
    return rows


def is_tank_title_row(row):
    joined = " ".join(str(c or "") for c in row).strip()
    if not joined or len(joined) > 120:
        return False
    if TANK_NAME_RE.search(joined) and not all(to_number(c) is not None or not str(c or "").strip() for c in row):
        # Title-like if few numbers
        nums = sum(1 for c in row if to_number(c) is not None)
        return nums <= 1
    return False


def is_data_header_row(row):
    """SOUNDING/Depth + trim numbers, or SOUNDING|VOLUME|LCG…"""
    cells = densify_row(clean_row(row))
    if len(cells) < 2:
        return False
    joined = " ".join(cells)
    if HYDRO_HEADER_RE.search(joined) and SOUNDING_HEADER_RE.search(joined):
        return True
    if re.search(r"^(SOUNDING|ULLAGE|GAUGE|DEPTH)\b", cells[0], re.I):
        nums = sum(1 for c in cells[1:] if to_number(c) is not None)
        return nums >= 2 or any(SOUNDING_HEADER_RE.search(c) for c in cells[1:])
    if all(cell_is_hydro_header(c) or re.fullmatch(r"m4?|m³|m3|cm", str(c), re.I) for c in cells if str(c).strip()):
        return True
    return False


def split_matrix_into_sections(rows):
    """
    Split a page-wide matrix into per-tank / per-block tables when a new
    title or header row appears (common in sounding books with multiple tanks).
    """
    if not rows:
        return []
    sections = []
    current = []
    current_title = ""

    def flush():
        nonlocal current, current_title
        if current and len(current) >= 2:
            sections.append({"title": current_title, "rows": normalize_table(current)})
        current = []

    for row in rows:
        dens = densify_row(clean_row(row))
        if not dens:
            continue
        joined = " ".join(dens)
        # Pure section break markers
        if re.search(r"HYDROSTATIC|DO NOT USE|STABILITY DATA", joined, re.I):
            flush()
            current_title = joined[:120]
            current = [dens]
            continue
        if is_tank_title_row(dens) and current and any(
            to_number(c) is not None for r in current for c in r
        ):
            flush()
            current_title = joined[:120]
            current = []
            continue
        # New data header after we already have numeric body → new table
        if is_data_header_row(dens) and current:
            body_nums = sum(1 for r in current for c in densify_row(r) if to_number(c) is not None)
            if body_nums >= 4:
                flush()
                current = [dens]
                continue
        if is_tank_title_row(dens) and not current:
            current_title = joined[:120]
            continue
        current.append(dens)
    flush()
    return [s for s in sections if s["rows"]]


def tables_from_page_text(text):
    """
    Parse monospaced sounding-book text into table matrices.
    Handles Veniamis-style trim grids and Gangos-style SOUNDING|VOLUME|LCG…
    """
    if not text:
        return []
    lines = [ln.rstrip() for ln in text.splitlines()]
    # Tokenize on whitespace
    raw_rows = []
    for ln in lines:
        if not ln.strip():
            raw_rows.append([])
            continue
        # Keep dashed separators as markers
        if re.fullmatch(r"[-–—_=]{5,}", ln.strip()):
            raw_rows.append(["---"])
            continue
        parts = re.split(r"\s{2,}|\t+| \| ", ln.strip())
        if len(parts) == 1:
            parts = ln.split()
        raw_rows.append(parts)

    # Drop pure separator rows but use them as soft breaks
    cleaned = []
    for r in raw_rows:
        if r == ["---"]:
            if cleaned and cleaned[-1] != []:
                cleaned.append([])
            continue
        cleaned.append(r)

    sections = split_matrix_into_sections(cleaned)
    # If splitter found nothing useful, try whole page as one densified matrix
    if not sections:
        norm = normalize_table([r for r in cleaned if r], densify=True)
        if norm:
            sections = [{"title": guess_tank_from_text(text), "rows": norm}]
    return sections


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


def cell_is_hydro_header(cell):
    s = str(cell or "").strip()
    if not s:
        return False
    return bool(HYDRO_HEADER_RE.search(s))


def row_hydro_score(row):
    texts = [str(c or "").strip() for c in row if str(c or "").strip()]
    if not texts:
        return 0, 0
    hydro = sum(1 for t in texts if HYDRO_HEADER_RE.search(t))
    return hydro, len(texts)


def find_header_row(rows, max_scan=8):
    """Prefer a row that looks like column headers (text + optional numbers)."""
    best_i, best_score = 0, -1
    for i, row in enumerate(rows[:max_scan]):
        texts = [str(c or "").strip() for c in row]
        non_empty = [t for t in texts if t]
        if not non_empty:
            continue
        hydro, n = row_hydro_score(row)
        sounding = sum(1 for t in non_empty if SOUNDING_HEADER_RE.search(t))
        nums = sum(1 for t in non_empty if to_number(t) is not None)
        # Header-like: has labels, not mostly pure numbers
        score = hydro * 3 + sounding * 2 + (1 if nums and nums < len(non_empty) else 0)
        if hydro or sounding:
            score += 2
        if score > best_score:
            best_score = score
            best_i = i
    return best_i if best_score > 0 else 0


def looks_like_hydro_values(rows):
    """
    Heuristic for dashed LCG/TCG/VCG/IMOM blocks when headers OCR poorly:
    four numeric columns ~ (large LCG, small TCG, tiny VCG, large IMOM).
    """
    samples = []
    for r in rows[:12]:
        dens = densify_row(r)
        nums = [to_number(c) for c in dens]
        nums = [n for n in nums if n is not None]
        if len(nums) >= 4:
            samples.append(nums[:4])
    if len(samples) < 2:
        return False
    ok = 0
    for a, b, c, d in samples:
        if abs(a) >= 20 and abs(b) < 30 and abs(c) < 10 and abs(d) >= 50:
            ok += 1
    return ok >= max(2, len(samples) // 2)


def is_pure_hydrostatic_table(rows):
    """
    True when the table is (or is dominated by) LCG/TCG/VCG/IMOM blocks
    like the dashed monospaced hydrostatic tables in ship stability books.
    """
    if not rows:
        return False
    hi = find_header_row(rows)
    header = densify_row(rows[hi])
    hydro_cols = [i for i, c in enumerate(header) if cell_is_hydro_header(c)]
    useful_cols = [
        i for i, c in enumerate(header)
        if str(c or "").strip() and not cell_is_hydro_header(c)
        and (SOUNDING_HEADER_RE.search(str(c)) or to_number(c) is not None)
    ]
    non_empty = [c for c in header if str(c or "").strip()]
    if non_empty and all(cell_is_hydro_header(c) for c in non_empty):
        return True
    # Unit-only header under hydro (m, m, m, m4)
    if non_empty and all(re.fullmatch(r"m4?|m³|m3|cm|mm|m", str(c), re.I) for c in non_empty):
        if looks_like_hydro_values(rows[hi + 1 :] or rows):
            return True
    if len(hydro_cols) >= 3 and len(useful_cols) == 0:
        return True
    if len(hydro_cols) >= 2 and len(hydro_cols) >= len(non_empty) - 1 and not useful_cols:
        return True
    for row in rows[: min(4, len(rows))]:
        hydro, n = row_hydro_score(row)
        if n >= 3 and hydro >= 3 and hydro >= n - 1:
            joined = " ".join(str(c or "") for r in rows[:6] for c in r)
            if hydro >= 3 and not re.search(r"\bSOUNDING\b|\bVOLUME\b|\bULLAGE\b|\bDEPTH\b", joined, re.I):
                return True
    joined = " ".join(str(c or "") for r in rows[:8] for c in densify_row(r))
    if re.search(r"HYDROSTATIC|DO NOT USE FOR SOUNDING", joined, re.I):
        if looks_like_hydro_values(rows) or HYDRO_HEADER_RE.search(joined):
            return True
    if not SOUNDING_HEADER_RE.search(joined) and looks_like_hydro_values(rows):
        return True
    return False


def strip_hydrostatic_columns(rows):
    """Remove LCG/TCG/VCG/IMOM (etc.) columns from a mixed sounding table."""
    if not rows:
        return rows, []
    hi = find_header_row(rows)
    header = rows[hi]
    drop = {i for i, c in enumerate(header) if cell_is_hydro_header(c)}
    if not drop:
        for ri in range(min(3, len(rows))):
            for ci, c in enumerate(rows[ri]):
                if cell_is_hydro_header(c):
                    drop.add(ci)

    # If SOUNDING+VOLUME present, drop trailing columns that look like LCG/TCG/VCG/IMOM values
    header_join = " ".join(str(c or "") for c in densify_row(header))
    has_sv = bool(re.search(r"SOUNDING|ULLAGE|DEPTH", header_join, re.I)) and bool(
        re.search(r"VOLUME|VOL\.?\b", header_join, re.I)
    )
    if has_sv and len(header) >= 4:
        body = rows[hi + 1 : hi + 10]
        for ci in range(len(header)):
            if ci in drop:
                continue
            label = str(header[ci] or "")
            if SOUNDING_HEADER_RE.search(label) and not cell_is_hydro_header(label):
                continue
            vals = []
            for r in body:
                if ci < len(r):
                    n = to_number(r[ci])
                    if n is not None:
                        vals.append(n)
            if len(vals) < 2:
                continue
            # LCG-like large, or IMOM-like large, with no sounding label
            med = sorted(vals)[len(vals) // 2]
            if abs(med) >= 50 and not re.search(r"SOUNDING|VOLUME|TRIM|HEEL|LIST|DEPTH", label, re.I):
                drop.add(ci)
            elif re.fullmatch(r"m4?|m", label.strip(), re.I) and abs(med) >= 20:
                drop.add(ci)

    if not drop:
        return rows, []

    kept = []
    removed_headers = [str(header[i]).strip() for i in sorted(drop) if i < len(header) and str(header[i] or "").strip()]
    if not removed_headers:
        removed_headers = [f"col{i}" for i in sorted(drop)]
    for r in rows:
        kept.append([c for i, c in enumerate(r) if i not in drop])
    return normalize_table(kept, densify=True), removed_headers


def parse_as_grid(rows):
    """
    Parse Excel-like calibration grid:
      [blank/label] | trim1 | trim2 | ...
      sounding1     | v11   | v12   | ...
    """
    if len(rows) < 2 or len(rows[0]) < 2:
        return None

    header = densify_row(rows[0]) if rows else []
    # Reject all-numeric "headers" (data row mistaken for header → false grids)
    header_nums = [to_number(c) for c in header]
    if header and all(n is not None for n in header_nums):
        return None
    # Prefer an explicit sounding/depth label in col 0 when present
    if header and to_number(header[0]) is not None:
        return None

    trim_vals = []
    for c in range(1, len(header)):
        n = to_number(header[c])
        if n is None:
            if trim_vals:
                break
            continue
        trim_vals.append(n)
    if len(trim_vals) < 2:
        return None
    # Trim/list headers are typically small meters (e.g. -5..+5), not LCG/volumes
    if not any(abs(v) <= 15 for v in trim_vals):
        return None
    if max(abs(v) for v in trim_vals) > 30:
        return None

    trim_axis = []
    trim_grid = []
    for r in rows[1:]:
        dens = densify_row(r)
        if dens and all(re.fullmatch(r"m4?|m³|m3|cm|mm|m", str(c), re.I) for c in dens):
            continue
        axis = to_number(dens[0] if dens else None)
        if axis is None:
            continue
        row_vals = []
        ok = 0
        for c in range(1, 1 + len(trim_vals)):
            n = to_number(dens[c] if c < len(dens) else None)
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
    """Two-column (or multi-col after hydro strip): sounding/ullage | volume."""
    if len(rows) < 2:
        return None

    xs, vs = [], []
    start = 0
    if to_number(rows[0][0]) is None and to_number(rows[0][1] if len(rows[0]) > 1 else None) is None:
        start = 1

    # Prefer columns labeled SOUNDING / VOLUME when present
    header = rows[start - 1] if start else rows[0]
    sounding_col = None
    volume_col = None
    for i, c in enumerate(header):
        u = str(c or "").upper()
        if sounding_col is None and re.search(r"SOUNDING|ULLAGE|GAUGE|DEPTH", u):
            sounding_col = i
        if volume_col is None and re.search(r"VOLUME|VOL\.?\b|CAP", u):
            volume_col = i

    for r in rows[start:]:
        # Skip unit-only rows (cm, m3, m, m4)
        dens = densify_row(r)
        if dens and all(re.fullmatch(r"m4?|m³|m3|cm|mm|m", str(c), re.I) for c in dens):
            continue
        if sounding_col is not None and volume_col is not None:
            x = to_number(r[sounding_col] if sounding_col < len(r) else None)
            v = to_number(r[volume_col] if volume_col < len(r) else None)
            if x is not None and v is not None:
                xs.append(x)
                vs.append(v)
            continue
        nums = [to_number(c) for c in r]
        nums = [n for n in nums if n is not None]
        if len(nums) >= 2:
            xs.append(nums[0])
            vs.append(nums[1])
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
    vals = grid.get("trimVals") or []
    distinct = len(set(vals))
    return (distinct > 1, len(grid.get("trimAxis") or []), distinct, len(vals))


def empty_parsed(kind="unknown"):
    return {
        "kind": kind,
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


def parse_table(rows):
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
        if curve and (
            best_curve is None
            or len(curve["volumeCurve"]["x"]) > len(best_curve["volumeCurve"]["x"])
        ):
            best_curve = curve
    if best_curve:
        return best_curve

    return empty_parsed("unknown")


def layout_hint(parsed, removed_hydro):
    kind = parsed.get("kind")
    if kind == "grid":
        return "trimGrid"
    if kind == "volumeCurve":
        return "soundingVolume" if removed_hydro else "soundingVolume"
    if kind == "hydrostatic":
        return "hydrostatic"
    return "unknown"


def guess_tank_from_text(text):
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:20]:
        u = ln.upper()
        # Skip data headers and hydro headers
        if re.match(r"^(SOUNDING|ULLAGE|GAUGE|DEPTH|VOLUME|L\.?\s*C\.?\s*G)\b", u):
            if not re.search(r"TANK|T\.|F\.O\.T|D\.O\.T|H\.F\.O|M\.D\.O", u):
                continue
        if "L.C.G" in u and "T.C.G" in u:
            continue
        m = TANK_NAME_RE.search(ln)
        if m:
            if len(ln) <= 90 and re.search(
                r"TANK|T\.|HFO|MDO|MGO|F\.O|D\.O|F\.O\.T|D\.O\.T", ln, re.I
            ):
                return ln[:120]
            return m.group(0)[:120]
    for ln in lines[:8]:
        u = ln.upper()
        if any(k in u for k in ("TANK", "HFO", "MDO", "MGO", "F.O.T", "D.O.T", "F.O", "D.O")):
            if HYDRO_HEADER_RE.search(ln) and not re.search(r"TANK|F\.O\.T|D\.O\.T", u):
                continue
            if re.match(r"^(SOUNDING|VOLUME)\b", u):
                continue
            return ln[:120]
    return ""


def guess_title(page, norm):
    try:
        text = page.extract_text() or ""
    except Exception:
        return ""
    return guess_tank_from_text(text)


def rebuild_from_words(page):
    """Cluster words into rows/cols when ruled tables are missing."""
    words = page.extract_words() or []
    if len(words) < 8:
        return None
    words = sorted(words, key=lambda w: (round(w["top"], 1), w["x0"]))
    rows = []
    current = []
    current_y = None
    for w in words:
        y = round(w["top"] / 3) * 3
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

    xs = sorted({round(w["x0"] / 8) * 8 for row in rows for w in row})
    if len(xs) < 2:
        return None

    matrix = []
    for row in rows:
        cells = [""] * len(xs)
        for w in row:
            x = round(w["x0"] / 8) * 8
            ci = min(range(len(xs)), key=lambda i: abs(xs[i] - x))
            cells[ci] = (cells[ci] + " " + w["text"]).strip() if cells[ci] else w["text"]
        if any(cells):
            matrix.append(cells)

    filtered = []
    for r in matrix:
        nums = sum(1 for c in r if to_number(c) is not None)
        if nums >= 2 or (filtered == [] and len(r) >= 2):
            filtered.append(r)
    return normalize_table(filtered) if len(filtered) >= 2 else None


def page_text_density(page):
    try:
        text = page.extract_text() or ""
    except Exception:
        return 0, ""
    return len(re.findall(r"\w+", text)), text


def maybe_ocr_pdf(pdf_path, force=False):
    """
    If pages look image-only (or --ocr), run ocrmypdf when available.
    Returns (path_to_use, ocr_used, warning).
    """
    if not force:
        try:
            with pdfplumber.open(pdf_path) as pdf:
                total_words = 0
                for page in pdf.pages[: min(5, len(pdf.pages))]:
                    n, _ = page_text_density(page)
                    total_words += n
                if total_words >= 30:
                    return pdf_path, False, None
        except Exception:
            pass

    ocrmypdf = shutil.which("ocrmypdf")
    tesseract = shutil.which("tesseract")
    if not ocrmypdf and not tesseract:
        return pdf_path, False, (
            "PDF has little extractable text (likely scanned). "
            "Install ocrmypdf + tesseract for OCR, or pre-OCR the file."
        )

    out = tempfile.NamedTemporaryFile(suffix="-ocr.pdf", delete=False)
    out.close()
    try:
        if ocrmypdf:
            cmd = [
                ocrmypdf, "--force-ocr", "--skip-text", "--quiet",
                pdf_path, out.name,
            ]
            # Prefer skip-text only when forcing; allow redo-ocr
            cmd = [ocrmypdf, "--force-ocr", "--quiet", pdf_path, out.name]
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
            return out.name, True, None
    except Exception as e:
        try:
            os.unlink(out.name)
        except OSError:
            pass
        return pdf_path, False, f"OCR failed: {e}"

    return pdf_path, False, "OCR tools present but ocrmypdf could not process this file"


def process_raw_table(rows):
    """
    Filter hydrostatic tables/columns and parse calibration data.
    Returns dict with keys: rows, parsed, skipped, skipReason, removedHydroHeaders.
    """
    norm = normalize_table(rows, densify=True)
    if is_pure_hydrostatic_table(norm):
        return {
            "rows": norm,
            "parsed": empty_parsed("hydrostatic"),
            "skipped": True,
            "skipReason": "hydrostatic L.C.G/T.C.G/V.C.G/IMOM table disregarded",
            "removedHydroHeaders": [
                str(c).strip()
                for c in densify_row(norm[find_header_row(norm)])
                if cell_is_hydro_header(c)
            ],
        }

    stripped, removed = strip_hydrostatic_columns(norm)
    work = normalize_table(stripped if stripped else norm, densify=True)
    if not work or len(work) < 2:
        return {
            "rows": norm,
            "parsed": empty_parsed("unknown"),
            "skipped": True,
            "skipReason": "no usable columns after removing hydrostatic headers",
            "removedHydroHeaders": removed,
        }

    if is_pure_hydrostatic_table(work):
        return {
            "rows": work,
            "parsed": empty_parsed("hydrostatic"),
            "skipped": True,
            "skipReason": "hydrostatic L.C.G/T.C.G/V.C.G/IMOM table disregarded",
            "removedHydroHeaders": removed,
        }

    parsed = parse_table(work)
    return {
        "rows": work,
        "parsed": parsed,
        "skipped": False,
        "skipReason": None,
        "removedHydroHeaders": removed,
    }


def group_tanks(tables):
    """Group table ids under tank names (order of first appearance)."""
    order = []
    buckets = {}
    for t in tables:
        if t.get("skipped"):
            continue
        name = (t.get("tankName") or "").strip() or f"Page {t['page']} (unnamed)"
        if name not in buckets:
            buckets[name] = []
            order.append(name)
        buckets[name].append(t["id"])
    return [{"name": n, "tableIds": buckets[n], "tableCount": len(buckets[n])} for n in order]


def extract_tables(pdf_path, page_filter=None):
    tables_out = []
    skipped_hydro = 0
    page_count = 0
    warnings = []

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        current_tank = ""
        for pi, page in enumerate(pdf.pages, start=1):
            if page_filter is not None and pi not in page_filter:
                continue

            words, text = page_text_density(page)
            tank_hint = guess_tank_from_text(text)
            if tank_hint:
                current_tank = tank_hint

            strategies = [
                dict(vertical_strategy="lines", horizontal_strategy="lines"),
                dict(vertical_strategy="text", horizontal_strategy="text"),
                dict(vertical_strategy="lines_strict", horizontal_strategy="lines_strict"),
            ]
            seen = set()
            page_tables = []  # list of {title, rows}

            def add_candidate(norm, title=""):
                if len(norm) < 2 or len(norm[0]) < 2:
                    return
                # Prefer densified form for fingerprint when sparse
                key = json.dumps(normalize_table(norm, densify=True)[:6])
                if key in seen:
                    return
                seen.add(key)
                page_tables.append({"title": title, "rows": norm})

            for settings in strategies:
                try:
                    found = page.extract_tables(table_settings=settings) or []
                except Exception:
                    found = []
                for raw in found:
                    norm = normalize_table(raw)
                    # Split multi-tank / hydro sections out of a page-wide grab
                    sections = split_matrix_into_sections(norm)
                    if len(sections) > 1:
                        for sec in sections:
                            add_candidate(sec["rows"], sec.get("title") or "")
                    else:
                        add_candidate(norm)

            # Monospaced text path — best for ship sounding books without ruled lines
            text_sections = tables_from_page_text(text)
            for sec in text_sections:
                add_candidate(sec["rows"], sec.get("title") or "")

            if not page_tables:
                rebuilt = rebuild_from_words(page)
                if rebuilt:
                    for sec in split_matrix_into_sections(rebuilt) or [{"title": "", "rows": rebuilt}]:
                        add_candidate(sec["rows"], sec.get("title") or "")

            if words < 5 and not page_tables:
                warnings.append(f"Page {pi}: little text — may need OCR")

            # Prefer candidates that parse to grid/volume over unknown/hydro
            scored = []
            for cand in page_tables:
                processed = process_raw_table(cand["rows"])
                kind = processed["parsed"].get("kind")
                removed = processed.get("removedHydroHeaders") or []
                score = 0
                ncols = len(processed["rows"][0]) if processed["rows"] else 0
                if not processed["skipped"] and kind == "grid":
                    score = 100 + len(processed["parsed"].get("trimAxis") or [])
                elif not processed["skipped"] and kind == "volumeCurve":
                    # Prefer volume curves when hydro cols were stripped (Gangos-style)
                    score = 90 + len(processed["parsed"].get("volumeCurve", {}).get("x") or [])
                    if removed:
                        score += 40
                    if ncols <= 3:
                        score += 20
                elif processed["skipped"]:
                    score = 10
                # Prefer candidates that already carry a tank title from text split
                if cand.get("title") and re.search(r"TANK|F\.O\.T|D\.O\.T|H\.F\.O|M\.D\.O", cand["title"], re.I):
                    score += 15
                scored.append((score, cand, processed))
            scored.sort(key=lambda x: -x[0])

            # Deduplicate by parsed fingerprint of usable tables; keep skipped hydro once
            keep = []
            seen_parse = set()
            seen_tank_kind = set()
            for score, cand, processed in scored:
                if processed["skipped"]:
                    fp = ("skip", json.dumps(processed["rows"][:4]))
                else:
                    p = processed["parsed"]
                    fp = (
                        p.get("kind"),
                        json.dumps(p.get("trimAxis") or p.get("volumeCurve", {}).get("x") or [])[:200],
                        json.dumps(p.get("trimVals") or p.get("volumeCurve", {}).get("v") or [])[:200],
                    )
                if fp in seen_parse:
                    continue
                # One usable table kind per tank name on a page (avoid mangled duplicates)
                tank_key = (cand.get("title") or tank_hint or "", processed["parsed"].get("kind"))
                if not processed["skipped"] and tank_key[0] and tank_key in seen_tank_kind:
                    continue
                seen_parse.add(fp)
                if not processed["skipped"] and tank_key[0]:
                    seen_tank_kind.add(tank_key)
                keep.append((cand, processed))

            for ti, (cand, processed) in enumerate(keep):
                work = processed["rows"]
                parsed = processed["parsed"]
                skipped = processed["skipped"]
                if skipped:
                    skipped_hydro += 1

                local_title = cand.get("title") or ""
                if not local_title:
                    for r in cand["rows"][:3]:
                        joined = " ".join(str(c or "") for c in densify_row(r))
                        local_title = guess_tank_from_text(joined) or local_title
                tank_name = local_title or tank_hint or current_tank or guess_title(page, cand["rows"])
                if re.match(r"^(SOUNDING|DEPTH|VOLUME)\b", (tank_name or ""), re.I):
                    tank_name = tank_hint or current_tank or guess_title(page, cand["rows"])
                if tank_name:
                    current_tank = tank_name

                preview = [row[:12] for row in work[:12]]
                removed = processed.get("removedHydroHeaders") or []
                tables_out.append({
                    "id": f"p{pi}-t{ti}",
                    "page": pi,
                    "index": ti,
                    "rows": len(work),
                    "cols": len(work[0]) if work else 0,
                    "preview": preview,
                    "raw": work,
                    "parsed": parsed,
                    "titleHint": tank_name,
                    "tankName": tank_name,
                    "layoutHint": layout_hint(parsed, removed),
                    "skipped": skipped,
                    "skipReason": processed.get("skipReason"),
                    "removedHydroHeaders": removed,
                })

    tanks = group_tanks(tables_out)
    return {
        "pages": page_count,
        "tables": tables_out,
        "tanks": tanks,
        "skippedHydrostatic": skipped_hydro,
        "warnings": warnings,
    }


def main():
    ap = argparse.ArgumentParser(description="Extract tank sounding tables from PDF")
    ap.add_argument("pdf")
    ap.add_argument("--page", type=int, action="append", help="1-based page number (repeatable)")
    ap.add_argument("--ocr", action="store_true", help="Force OCR via ocrmypdf when available")
    ap.add_argument(
        "--include-skipped",
        action="store_true",
        help="Keep hydrostatic skipped tables in output (default: keep them marked skipped)",
    )
    args = ap.parse_args()
    page_filter = set(args.page) if args.page else None
    ocr_tmp = None
    try:
        path, ocr_used, ocr_warn = maybe_ocr_pdf(args.pdf, force=args.ocr)
        if path != args.pdf:
            ocr_tmp = path
        result = extract_tables(path, page_filter=page_filter)
        result["pages"] = result.get("pages")
        result["file"] = args.pdf
        result["ocrUsed"] = ocr_used
        if ocr_warn:
            result.setdefault("warnings", []).append(ocr_warn)
        if not args.include_skipped:
            # Keep skipped entries so UI can explain, but usable list is clear via skipped flag
            pass
        json.dump(result, sys.stdout)
    except Exception as e:
        json.dump({"error": str(e), "tables": [], "tanks": []}, sys.stdout)
        sys.exit(1)
    finally:
        if ocr_tmp:
            try:
                os.unlink(ocr_tmp)
            except OSError:
                pass


if __name__ == "__main__":
    main()
