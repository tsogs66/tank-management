#!/usr/bin/env python3
"""
Parse FLAG EVI–style dual-sheet FO tank workbooks.

Expected sheets (names matched loosely):
  - "Trim Correction"   — tank capacity in m³ vs ullage/sounded depth × trim
  - "Heeling Correction"— heel volume correction (m³) vs ullage/sounded × heel °

Each sheet stacks tanks as:
  title row (name in col A, rest blank)
  data rows: Ullage depth (mm) | Sounded depth (mm) | value columns…

Shared header near the top:
  Trim:  TRIM BY STEM | EVEN KEEL | TRIM BY STERN  → numeric trim (m)
  Heel:  HEEL TO PORT | HEEL TO STBD               → numeric heel (°)

Output tanks are left for the app to classify: its detectCalcType reads what
the two sheets actually hold (capacities vs a correction in millimetres).
Trim columns are stored by-stern (the sheet's stem-positive headers are
negated), which is how every other importer here stores them, and the tank
says so with trimAxisSense so the app can turn the engineer's bow-positive
trim into the right column.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter

try:
    from openpyxl import load_workbook
except ImportError:
    print(json.dumps({"error": "openpyxl not installed. Run: pip install -r requirements.txt"}))
    sys.exit(1)


SKIP_TITLE_RE = re.compile(
    r"(ullage|sounded|sounding|trim\s+by|heel\s+to|correction\s+tables?|depth\s*\()",
    re.I,
)


def to_num(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    try:
        return float(str(value).strip().replace("\u2212", "-").replace(",", ""))
    except ValueError:
        return None


def clean_num(value):
    number = to_num(value)
    if number is None:
        return None
    return int(number) if float(number).is_integer() else number


def detect_increment(axis):
    diffs = [
        round(abs(axis[i] - axis[i - 1]), 6)
        for i in range(1, len(axis))
        if axis[i] != axis[i - 1]
    ]
    return Counter(diffs).most_common(1)[0][0] if diffs else 1


def sheet_kind(title: str) -> str | None:
    u = str(title or "").strip().upper()
    if "HEEL" in u and "TRIM" not in u:
        return "heel"
    if "TRIM" in u:
        return "trim"
    return None


def looks_like_flag_evi(workbook) -> bool:
    kinds = {sheet_kind(ws.title) for ws in workbook.worksheets}
    return "trim" in kinds and "heel" in kinds


def is_title_row(row) -> bool:
    if not row:
        return False
    first = row[0]
    if not isinstance(first, str) or not first.strip():
        return False
    if SKIP_TITLE_RE.search(first):
        return False
    rest = row[1:12]
    if any(v is not None and str(v).strip() != "" for v in rest):
        return False
    return True


def clean_title(value: str) -> str:
    title = str(value or "").strip()
    title = re.sub(r"\s+", " ", title)
    # NO.1 H.F.O.TK(P) → NO.1 H.F.O. TANK (P); keep grade dots.
    title = re.sub(r"\.\s*TK\s*(?=\()", ". TANK ", title, flags=re.I)
    title = re.sub(r"(?<![A-Z0-9])TK\s*(?=\()", "TANK ", title, flags=re.I)
    title = re.sub(r"\.\s*TK\s*$", ". TANK", title, flags=re.I)
    title = re.sub(r"(?<![A-Z0-9])TK\s*$", "TANK", title, flags=re.I)
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r"\s+\(", " (", title)
    return title


def tank_role(title: str) -> str:
    upper = title.upper()
    if re.search(r"SETT", upper):
        return "settling"
    if re.search(r"SERV", upper):
        return "service"
    if re.search(r"OVER", upper):
        return "overflow"
    return "storage"


def side_from_title(title: str) -> str:
    upper = title.upper()
    if re.search(r"\(\s*P\s*\)|\bPORT\b", upper):
        return "port"
    if re.search(r"\(\s*S\s*\)|\bSTBD\b|\bSTARBOARD\b", upper):
        return "starboard"
    return "center"


def tank_no_from_title(title: str):
    m = re.search(r"NO\.?\s*(\d+)", title, re.I)
    return int(m.group(1)) if m else None


def fuel_grade(title: str) -> str:
    upper = title.upper()
    if re.search(r"L\.?\s*S\.?|VLSFO|LSFO", upper) and re.search(r"H\.?\s*F\.?\s*O|FO", upper):
        return "lsfo"
    if re.search(r"H\.?\s*F\.?\s*O", upper):
        return "hfo"
    if "MDO" in upper or re.search(r"M\.?\s*D\.?\s*O", upper):
        return "mdo"
    if "MGO" in upper or re.search(r"M\.?\s*G\.?\s*O", upper):
        return "mgo"
    return "other"


def guess_category(title: str) -> str:
    upper = title.upper()
    if re.search(r"L\.?\s*O\.|LUBE|CYL|SUMP", upper) and not re.search(
        r"H\.?\s*F\.?\s*O|MDO|MGO|F\.?\s*O", upper
    ):
        return "lube"
    if re.search(r"F\.?\s*W\.|WATER|DISTILLED|DRINKING", upper):
        return "water"
    if re.search(r"H\.?\s*F\.?\s*O|MDO|MGO|F\.?\s*O|FUEL|NO\.\s*\d", upper):
        return "fuel"
    return "misc"


def find_header_row(rows):
    """Return (index, value_start_col) where value_start_col is 0-based index of first trim/heel number."""
    for index, row in enumerate(rows[:40]):
        if not row:
            continue
        first = str(row[0] or "").strip().upper()
        if "ULLAGE" not in first and "SOUND" not in first and "DEPTH" not in first:
            continue
        # Prefer a row that already has numeric trim/heel headers in cols C+
        nums = []
        start = None
        for c in range(1, min(len(row), 20)):
            n = clean_num(row[c])
            if n is not None:
                if start is None:
                    start = c
                nums.append(n)
            elif start is not None and nums:
                break
        if len(nums) >= 2 and start is not None:
            return index, start
    return None, None


def parse_axis_headers(rows, header_index, value_start):
    row = rows[header_index]
    vals = []
    for c in range(value_start, min(len(row), value_start + 24)):
        n = clean_num(row[c])
        if n is None:
            if vals:
                break
            continue
        vals.append(n)
    return vals


def block_ranges(rows):
    titles = []
    for i, row in enumerate(rows):
        if is_title_row(row):
            titles.append((i, clean_title(row[0])))
    ranges = []
    for idx, (start, name) in enumerate(titles):
        end = titles[idx + 1][0] if idx + 1 < len(titles) else len(rows)
        ranges.append((start, end, name))
    return ranges


def parse_block(rows, start, end, name, value_headers, value_start, *, negate_trim: bool):
    axis = []
    grid = []
    pipe_hint = None
    ullage_hits = 0
    sounding_hits = 0
    for r in range(start + 1, end):
        row = rows[r] if r < len(rows) else None
        if not row:
            continue
        ullage = clean_num(row[0] if len(row) > 0 else None)
        sounded = clean_num(row[1] if len(row) > 1 else None)
        # Prefer ullage when present; some FLAG EVI tanks only publish sounded depth.
        if ullage is not None:
            axis_val = ullage
            ullage_hits += 1
        elif sounded is not None:
            axis_val = sounded
            sounding_hits += 1
        else:
            continue
        values = []
        valid = 0
        for j in range(len(value_headers)):
            col = value_start + j
            number = clean_num(row[col] if col < len(row) else None)
            if number is not None:
                valid += 1
            values.append(0 if number is None else number)
        # Keep the depth row even when heel cells are blank (treat as 0).
        if not valid and ullage is None and sounded is None:
            continue
        axis.append(axis_val)
        grid.append(values)
        if pipe_hint is None and sounded is not None and (ullage == 0 or (ullage is None and sounded > 0)):
            if ullage == 0 or (ullage is None and not axis[:-1]):
                pipe_hint = sounded

    if len(axis) < 2:
        return None

    headers = list(value_headers)
    if negate_trim:
        headers = [-h for h in headers]
        # Keep ascending by-stern order for editors (matches Giorgis seed)
        order = sorted(range(len(headers)), key=lambda i: headers[i])
        headers = [headers[i] for i in order]
        grid = [[row[i] for i in order] for row in grid]

    # If the sheet mostly used sounded depths, store as sounding tables.
    method = "ullage" if ullage_hits >= sounding_hits else "sounding"

    return {
        "name": name,
        "axis": axis,
        "vals": headers,
        "grid": grid,
        "pipeHint": pipe_hint,
        "increment": detect_increment(axis),
        "soundingMethod": method,
    }


def robust_capacity(trim_vals, trim_grid):
    if not trim_grid:
        return 0
    try:
        col = trim_vals.index(0)
    except ValueError:
        col = min(range(len(trim_vals)), key=lambda i: abs(trim_vals[i]))
    values = [row[col] for row in trim_grid if col < len(row) and isinstance(row[col], (int, float))]
    return round(max(values), 6) if values else 0


def merge_tank(name, trim_block, heel_block):
    if not trim_block:
        return None
    trim_vals = trim_block["vals"]
    trim_grid = trim_block["grid"]
    trim_axis = trim_block["axis"]
    try:
        even_col = trim_vals.index(0)
    except ValueError:
        even_col = min(range(len(trim_vals)), key=lambda i: abs(trim_vals[i]))
    volume_curve = {
        "x": list(trim_axis),
        "v": [row[even_col] for row in trim_grid],
    }
    list_axis = heel_block["axis"] if heel_block else []
    list_vals = heel_block["vals"] if heel_block else []
    list_grid = heel_block["grid"] if heel_block else []
    has_list = any(abs(v) > 1e-12 for row in list_grid for v in row)

    pipe = trim_block.get("pipeHint")
    if pipe is None and heel_block:
        pipe = heel_block.get("pipeHint")

    method = trim_block.get("soundingMethod") or "ullage"
    if heel_block and heel_block.get("soundingMethod") == "sounding" and method != "sounding":
        # Prefer the denser axis convention when sheets disagree.
        if len(list_axis) >= len(trim_axis):
            method = "sounding"

    return {
        "name": name,
        "category": guess_category(name),
        "fuelRole": tank_role(name),
        "fuelGrade": fuel_grade(name),
        "side": side_from_title(name),
        "tankNo": tank_no_from_title(name),
        "calcType": "correction",
        "trimAxisSense": "stern",
        "capacity": robust_capacity(trim_vals, trim_grid),
        "pipeHeight": pipe if pipe is not None else 0,
        "soundingMethod": method,
        "correctionDivisor": 1,
        "soundingIncrement": trim_block["increment"],
        "heelIncrement": heel_block["increment"] if heel_block and has_list else trim_block["increment"],
        "trimAxis": trim_axis,
        "trimVals": trim_vals,
        "trimGrid": trim_grid,
        "listAxis": list_axis if has_list else [],
        "listVals": list_vals if has_list else [],
        "listGrid": list_grid if has_list else [],
        "volumeCurve": volume_curve,
        "importFormat": "flag-evi-xlsx",
        "pdfSource": name,
    }


def norm_key(name: str) -> str:
    s = str(name or "").upper()
    s = re.sub(r"TANK", "TK", s)
    return re.sub(r"[^A-Z0-9]", "", s)


def extract(path: str):
    workbook = load_workbook(path, data_only=True, read_only=True)
    if not looks_like_flag_evi(workbook):
        raise ValueError(
            "Not a FLAG EVI dual-sheet workbook (need Trim Correction + Heeling Correction sheets)"
        )

    trim_blocks = {}
    heel_blocks = {}
    sheets_meta = []
    warnings = []

    for ws in workbook.worksheets:
        kind = sheet_kind(ws.title)
        if not kind:
            continue
        rows = [list(row) for row in ws.iter_rows(values_only=True)]
        header_index, value_start = find_header_row(rows)
        if header_index is None:
            warnings.append(f"{ws.title}: no ullage/sounded header row with numeric columns")
            continue
        headers = parse_axis_headers(rows, header_index, value_start)
        if len(headers) < 2:
            warnings.append(f"{ws.title}: fewer than 2 trim/heel columns")
            continue
        count = 0
        for start, end, name in block_ranges(rows):
            block = parse_block(
                rows,
                start,
                end,
                name,
                headers,
                value_start,
                negate_trim=(kind == "trim"),
            )
            if not block:
                warnings.append(f"{ws.title}: {name} — no usable rows")
                continue
            key = norm_key(name)
            target = trim_blocks if kind == "trim" else heel_blocks
            if key in target:
                warnings.append(f"{ws.title}: duplicate tank name {name}")
            target[key] = block
            count += 1
        sheets_meta.append({"name": ws.title, "kind": kind, "tankCount": count})

    tanks = []
    all_keys = list(dict.fromkeys([*trim_blocks.keys(), *heel_blocks.keys()]))
    for key in all_keys:
        trim_b = trim_blocks.get(key)
        heel_b = heel_blocks.get(key)
        name = (trim_b or heel_b)["name"]
        if not trim_b:
            warnings.append(f"{name}: heel table only — skipped (need trim volumes)")
            continue
        if not heel_b:
            warnings.append(f"{name}: no matching heel table — imported trim only")
        tank = merge_tank(name, trim_b, heel_b)
        if tank:
            tanks.append(tank)

    if not tanks:
        raise ValueError("No tanks parsed from Trim / Heeling Correction sheets")

    return {
        "format": "flag-evi-xlsx",
        "calcType": "correction",
        "trimAxisSense": "stern",
        "tankCount": len(tanks),
        "sheets": sheets_meta,
        "warnings": warnings,
        "tanks": tanks,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook")
    args = parser.parse_args()
    try:
        json.dump(extract(args.workbook), sys.stdout)
    except Exception as exc:
        json.dump({"error": str(exc), "tanks": []}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
