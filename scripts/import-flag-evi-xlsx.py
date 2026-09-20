#!/usr/bin/env python3
"""
Parse FLAG EVI–style dual-sheet FO tank workbooks.

Expected sheets (names matched loosely):
  - "Trim Correction"   — tank capacity in m³ vs ullage/sounded depth × trim
  - "Heeling Correction"— heel volume correction (m³) vs ullage/sounded × heel °

Each sheet stacks tanks as:
  title row (name in col A, rest blank)
  data rows: Ullage depth (mm) | Sounded depth (mm) | value columns…

Not every yard writes it that way. A JEWEL book says the same things with
the labels on one row and the trim/heel numbers on the next, the depth
columns the other way round, and the depths in centimetres. Only the split
header shows up as an error; the other two would import silently and be
wrong on the sounding board. So the layout is read from the labels — which
column says SOUNDING, and what unit is written beside it — rather than
assumed, and a book in the original arrangement reads exactly as before.

Shared header near the top:
  Trim:  TRIM BY STEM | EVEN KEEL | TRIM BY STERN  → numeric trim (m)
  Heel:  HEEL TO PORT | HEEL TO STBD               → numeric heel (°)

Output tanks are left for the app to classify: its detectCalcType reads what
the two sheets actually hold (capacities vs a correction in millimetres).
Trim column +/− signs are kept exactly as printed. FLAG EVI books are
stem/bow-positive, so tanks are tagged trimAxisSense=bow. Calibration UI
can flip headers or change sense later if a book needs correction.
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
    upper = re.sub(r"\s+", " ", re.sub(r"\.", "", title.upper())).strip()
    if re.search(r"\bLSMGO\b|LS\s*MGO", upper):
        return "lsmgo"
    if re.search(r"\bMGO\b|GAS OIL", upper):
        return "mgo"
    if re.search(r"\bMDO\b|\bDIESEL\b", upper):
        return "mdo"
    if re.search(r"VLSFO|ULSFO|\bLSFO\b|LS HFO|LS FO", upper):
        return "lsfo"
    raw = title.upper()
    if re.search(r"L\.?\s*S\.?|VLSFO|LSFO", raw) and re.search(r"H\.?\s*F\.?\s*O|FO", raw):
        return "lsfo"
    if re.search(r"\bHFO\b", upper) or re.search(r"H\.?\s*F\.?\s*O", raw):
        return "hfo"
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


DEPTH_LABEL_RE = re.compile(r"\b(SOUNDING|SOUNDED|ULLAGE)\b", re.I)
UNIT_RE = re.compile(r"\b(MM|CM|M)\b", re.I)
UNIT_TO_MM = {"MM": 1, "CM": 10, "M": 1000}

DEFAULT_LAYOUT = {"ullage": (0, 1), "sounding": (1, 1)}


def read_depth_layout(row):
    """Which column holds which depth, and what it is written in.

    Returns {"ullage": (col, scale), "sounding": (col, scale)} where scale
    takes the book's unit to millimetres. An empty dict means this row does
    not name the depth columns.
    """
    found = {}
    for c, value in enumerate(row[:12] if row else []):
        if not isinstance(value, str):
            continue
        m = DEPTH_LABEL_RE.search(value)
        if not m:
            continue
        which = "ullage" if m.group(1).upper() == "ULLAGE" else "sounding"
        if which in found:
            continue
        rest = value.upper().replace(m.group(1).upper(), "")
        unit = UNIT_RE.search(rest)
        scale = UNIT_TO_MM.get(unit.group(1).upper(), 1) if unit else 1
        found[which] = (c, scale)
    return found


def numeric_run(row, first_col=1, last_col=20):
    """The first run of numbers on a row: (values, start column)."""
    values, start = [], None
    for c in range(first_col, min(len(row), last_col)):
        n = clean_num(row[c])
        if n is not None:
            if start is None:
                start = c
            values.append(n)
        elif start is not None and values:
            break
    return values, start


def find_header_row(rows):
    """Where the trim/heel numbers are, and how the depth columns are laid out.

    Returns (index, value_start_col, layout). The numbers are normally on the
    same row as the depth labels; a JEWEL book puts them on the row below, so
    the two rows under the labels are tried before giving up.
    """
    for index, row in enumerate(rows[:40]):
        if not row:
            continue
        first = str(row[0] or "").strip().upper()
        if "ULLAGE" not in first and "SOUND" not in first and "DEPTH" not in first:
            continue
        layout = read_depth_layout(row) or dict(DEFAULT_LAYOUT)

        # The labels' own row first, then the rows under it.
        for probe in range(index, min(index + 3, len(rows))):
            candidate = rows[probe]
            if not candidate:
                continue
            first_col = 1 if probe == index else 0
            nums, start = numeric_run(candidate, first_col=first_col)
            if len(nums) >= 2 and start is not None:
                return probe, start, layout
    return None, None, None


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


def parse_block(rows, start, end, name, value_headers, value_start, *, negate_trim: bool,
                layout=None):
    """Parse one tank block.

    Default column layout (FLAG EVI and similar books):
      col 0 = ullage depth, col 1 = sounded depth, then heel/trim/volume values.
    When both depth columns are present they are kept in parallel so runtime
    can switch sounding↔ullage without subtracting from pipe height. Blank
    sibling cells are filled via pipe − other when a pipe height is known.
    """
    layout = layout or DEFAULT_LAYOUT
    ullage_col, ullage_scale = layout.get("ullage", (None, 1))
    sounded_col, sounded_scale = layout.get("sounding", (None, 1))

    def depth(row, col, scale):
        if col is None or col >= len(row):
            return None
        n = clean_num(row[col])
        if n is None or scale == 1:
            return n
        return clean_num(n * scale)

    axis = []
    ullage_axis = []
    sounding_axis = []
    grid = []
    pipe_hint = None
    ullage_hits = 0
    sounding_hits = 0
    for r in range(start + 1, end):
        row = rows[r] if r < len(rows) else None
        if not row:
            continue
        ullage = depth(row, ullage_col, ullage_scale)
        sounded = depth(row, sounded_col, sounded_scale)
        if ullage is not None:
            ullage_hits += 1
        if sounded is not None:
            sounding_hits += 1
        # Prefer ullage as the primary axis when present; else sounded depth.
        if ullage is not None:
            axis_val = ullage
        elif sounded is not None:
            axis_val = sounded
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
        ullage_axis.append(ullage)
        sounding_axis.append(sounded)
        grid.append(values)
        if pipe_hint is None and sounded is not None and ullage is not None:
            s = sounded + ullage
            if s > 0:
                pipe_hint = s
        elif pipe_hint is None and sounded is not None and (ullage == 0 or ullage is None):
            if ullage == 0 or (ullage is None and not axis[:-1]):
                pipe_hint = sounded

    if len(axis) < 2:
        return None

    # Fill blank sibling depths via pipe − other when possible.
    pipe = pipe_hint
    if pipe is None:
        for u, s in zip(ullage_axis, sounding_axis):
            if u is not None and s is not None and (u + s) > 0:
                pipe = u + s
                break
    if pipe is not None and pipe > 0:
        for i in range(len(axis)):
            u, s = ullage_axis[i], sounding_axis[i]
            if u is None and s is not None:
                ullage_axis[i] = round(pipe - s, 6)
            elif s is None and u is not None:
                sounding_axis[i] = round(pipe - u, 6)

    dual = (
        sum(1 for u, s in zip(ullage_axis, sounding_axis)
            if u is not None and s is not None) >= 2
    )

    headers = list(value_headers)
    if negate_trim:
        headers = [-h for h in headers]
        # Keep ascending by-stern order for editors (matches Giorgis seed)
        order = sorted(range(len(headers)), key=lambda i: headers[i])
        headers = [headers[i] for i in order]
        grid = [[row[i] for i in order] for row in grid]

    # If the sheet mostly used sounded depths, store as sounding tables.
    method = "ullage" if ullage_hits >= sounding_hits else "sounding"

    out = {
        "name": name,
        "axis": axis,
        "vals": headers,
        "grid": grid,
        "pipeHint": pipe if pipe is not None else pipe_hint,
        "increment": detect_increment(axis),
        "soundingMethod": method,
        "dualDepth": dual,
    }
    if dual:
        # Replace None with axis primary so arrays stay numeric for JSON/JS.
        out["ullageAxis"] = [
            float(u) if u is not None else float(axis[i]) for i, u in enumerate(ullage_axis)
        ]
        out["soundingAxis"] = [
            float(s) if s is not None else float(axis[i]) for i, s in enumerate(sounding_axis)
        ]
    return out


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

    # Prefer dual-depth axes from trim; fall back to heel when trim is single-axis.
    ullage_axis = trim_block.get("ullageAxis")
    sounding_axis = trim_block.get("soundingAxis")
    if not ullage_axis and heel_block:
        ullage_axis = heel_block.get("ullageAxis")
        sounding_axis = heel_block.get("soundingAxis")
    # Align heel list axis with dual depths when heel also published both.
    list_ullage = heel_block.get("ullageAxis") if heel_block else None
    list_sounding = heel_block.get("soundingAxis") if heel_block else None

    tank = {
        "name": name,
        "category": guess_category(name),
        "fuelRole": tank_role(name),
        "fuelGrade": fuel_grade(name),
        "side": side_from_title(name),
        "tankNo": tank_no_from_title(name),
        "calcType": "correction",
        "trimAxisSense": "bow",
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
    if ullage_axis and sounding_axis and len(ullage_axis) >= 2 and len(sounding_axis) >= 2:
        tank["ullageAxis"] = list(ullage_axis)
        tank["soundingAxis"] = list(sounding_axis)
        tank["depthPairMode"] = "dual"
    if has_list and list_ullage and list_sounding and len(list_ullage) >= 2:
        tank["listUllageAxis"] = list(list_ullage)
        tank["listSoundingAxis"] = list(list_sounding)
    return tank


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
        header_index, value_start, layout = find_header_row(rows)
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
                # Keep printed +/−; calib UI / trimAxisSense handle sense.
                negate_trim=False,
                layout=layout,
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
        "trimAxisSense": "bow",
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
