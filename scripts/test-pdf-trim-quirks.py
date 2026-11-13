#!/usr/bin/env python3
"""
Trim/list column quirks the existing PDF import pipeline (pdf_headers.py's
word-based sign reading, OCR cleanup, etc.) does not yet cover, found while
studying the Nikolas D, Gangos, B-06 and FLAG EVI sounding-table samples:

- A table can print its trim/list columns out of value order (Nikolas D runs
  0, -0.5 .. -4, 0.5, 1 left to right) — interpolation must bracket a
  reading between the columns whose *values* are adjacent, not whichever
  columns happen to sit next to each other on the page.
- A side label that should sign an otherwise-unsigned header (e.g. "LIST TO
  STARBOARD") can itself be OCR-garbled past what word matching recognises
  ("STARE I D") — the data's own dominant sign per side is a safe fallback.
- A blank/omitted column's "-" can run into the next column's negative
  value with no gap ("--123.418" = blank, then -123.418), which the
  existing split_glued_cells (two real numbers glued together) does not
  recognise as that shape.
- A diagram/notes page with no real table can still look like a 2-column
  sounding/volume curve if a couple of numbers land in the same row.

Run directly: python3 scripts/test-pdf-trim-quirks.py
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ipt", ROOT / "scripts" / "import-pdf-tables.py")
ipt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ipt)

passed = 0


def ok(cond, msg):
    global passed
    assert cond, msg
    passed += 1


# ---- out-of-order trim columns (Nikolas D: 0, -0.5 .. -4, 0.5, 1) ----
vals, grid, order = ipt.sort_axis_columns(
    [0.0, -0.5, -1.0, -1.5, -2.0, -2.5, -3.0, -3.5, -4.0, 0.5, 1.0],
    [[33.28, 32.13, 31.01, 29.92, 28.87, 27.85, 26.87, 25.91, 24.99, 34.48, 35.70]],
)
ok(vals == sorted(vals), "columns are sorted into real trim order")
ok(
    grid[0] == [24.99, 25.91, 26.87, 27.85, 28.87, 29.92, 31.01, 32.13, 33.28, 34.48, 35.70],
    "row values follow their column to its new sorted position, not the old slot",
)
ok(order[0] == 8, "the permutation says column 0 (value -4.0) came from the original index 8")

# A clean, already-ascending header is left untouched (no needless rebuild).
same_vals, same_grid, same_order = ipt.sort_axis_columns([-1.0, 0.0, 1.0], [[1, 2, 3]])
ok(same_order == [0, 1, 2] and same_grid[0] == [1, 2, 3], "an already-sorted axis is returned as-is")

# A header that is already monotonic — just printed high to low, as B-06's
# own "TRIM BY STEM 1.0 / EVEN KEEL 0.0 / -0.5 .. -4.0" prints it — is left
# in that order: calc.js's bracket() already reads a descending axis fine,
# and the book's own direction is not a bug to fix.
desc_vals, desc_grid, desc_order = ipt.sort_axis_columns([1.0, 0.0, -0.5, -1.0, -2.0], [[5, 4, 3, 2, 1]])
ok(desc_order == [0, 1, 2, 3, 4], "a descending-but-monotonic header is not reordered")

# Missing the 0 (even keel) column itself is fixed in server/pdf-import.js's
# withZeroColumn() — see scripts/test-pdf-import.js — not here: whether a
# missing 0 should be exact zero (a correction table) or interpolated (a
# volume table, where 0 trim is not 0 volume) depends on parsed.gridKind,
# which only the JS layer currently resolves.

# ---- a duplicate-labelled header (B-06's LIST TO PORT/STARBOARD, OCR'd as
#      "STARE I D" so the word-based sign reader can't tell which side is
#      which) signed from the data's own dominant sign instead ----
dup_vals = [3.0, 2.0, 1.0, 1.0, 2.0, 3.0]
dup_grid = [
    [-12.0, -10.0, -5.0, 1.0, 3.0, 7.0],
    [-28.0, -18.0, -8.0, 3.0, 6.0, 7.0],
    [-37.0, -22.0, -10.0, 4.0, 10.0, 13.0],
    [-45.0, -28.0, -13.0, 5.0, 13.0, 19.0],
]
signed = ipt.infer_axis_sign_from_data(dup_vals, dup_grid)
ok(signed == [-3.0, -2.0, -1.0, 1.0, 2.0, 3.0], "the side whose data is mostly negative is signed negative")

# A header with no duplicates, or ambiguous (mixed-sign) data, is left alone.
ok(ipt.infer_axis_sign_from_data([-1.0, 0.0, 1.0], [[1, 2, 3]]) is None, "an already-signed header is not touched")
ok(ipt.infer_axis_sign_from_data([1.0, 2.0, 2.0, 1.0], [[1, 1, 1, 1]]) is None, "ambiguous data makes no call")

# ---- end to end: parse_as_grid puts all three together on a table shaped
#      like B-06's list correction table (no 0 column, duplicate 1.0/1.0
#      boundary, unsigned because the side word was unrecoverable) ----
rows = [
    ["M-CM", "3.0", "2.0", "1.0", "1.0", "2.0", "3.0"],
    ["0.00", "-12.0", "-10.0", "-5.0", "1.0", "3.0", "7.0"],
    ["0.20", "-28.0", "-18.0", "-8.0", "3.0", "6.0", "7.0"],
    ["0.40", "-37.0", "-22.0", "-10.0", "4.0", "10.0", "13.0"],
    ["0.60", "-45.0", "-28.0", "-13.0", "5.0", "13.0", "19.0"],
]
grid = ipt.finalize_grid_axes(ipt.parse_as_grid(rows))
ok(grid is not None, "a duplicate-boundary list table still parses as a grid")
ok(grid["trimVals"] == [-3.0, -2.0, -1.0, 1.0, 2.0, 3.0], "signed from its own data and sorted (0 is still missing)")
ok(
    grid["trimGrid"][0] == [-12.0, -10.0, -5.0, 1.0, 3.0, 7.0],
    "row values keep their printed sign and follow their column to its sorted position",
)

# ---- PDF text that mashes a blank column's "-" into the next, negative,
#      value with no space (FLAG EVI's heeling correction tables) ----
ok(
    ipt.split_mashed_blank_dash("--123.418") == ["-", "-123.418"],
    'a blank column\'s "-" glued onto a negative value splits into a blank (0) and the real value',
)
ok(
    ipt.split_mashed_blank_dash("--277.502-147.423") == ["-", "-277.502", "-147.423"],
    "one blank marker plus two further glued negative values all split out",
)
ok(ipt.split_mashed_blank_dash("84.996") is None, "a normal single value is left untouched")
ok(ipt.split_mashed_blank_dash("-") is None, "a lone blank dash (already handled by to_number) is left untouched")
ok(
    ipt.densify_row(["500", "--123.418", "84.996", "156.817"]) == ["500", "-", "-123.418", "84.996", "156.817"],
    "densify_row applies the split so parse_as_grid sees one blank cell plus the real value",
)

# ---- a diagram/notes page with no real table should not look like one ----
# B-06's own draught-correction page: formulas that each quote a couple of
# figures, good for only 2-3 (x, v) pairs over the whole page of prose.
prose_rows = [
    ["These", "correction", "value", "are", "obtained", "as", "follows"],
    ["A.", "P.", "Correction", "value", "=", "12.50", "/", "266.60", "x", "t"],
    ["F.", "P.", "Correction", "value", "=", "1.70", "/", "266.60", "x", "t"],
    ["(", "t", ":", "apparent", "trim", ")"],
    ["Notes", ";"],
    ["1)", "When", "trim", "by", "the", "stern", "value", "is", "plus"],
]
ok(ipt.parse_as_volume_curve(prose_rows) is None, "a prose/notes page with only a couple of incidental number pairs is rejected")

# A real curve is never refused for being noisy or short of rows — only for
# having too few usable data points to be worth calling a table at all.
ok(ipt.parse_as_volume_curve([["0", "0.0"], ["10", "1.2"], ["20", "2.5"]]) is None, "even 3 clean points is still too thin to call a curve")

# A genuine (if short) sounding/volume curve is unaffected by the new guard.
real_curve_rows = [
    ["SOUNDING", "VOLUME"],
    ["0", "0.0"],
    ["10", "1.2"],
    ["20", "2.5"],
    ["30", "3.9"],
]
curve = ipt.parse_as_volume_curve(real_curve_rows)
ok(curve is not None and curve["volumeCurve"]["x"] == [0.0, 10.0, 20.0, 30.0], "a real monotonic curve still parses")

print(f"pdf trim/list quirks: {passed} checks passed")
