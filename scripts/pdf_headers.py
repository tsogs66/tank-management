"""
Making a printed page's table into rows the parsers can read.

What comes off a page is not yet a table: the vessel's name and "Page 3 of 40"
ride along as rows, a pair of columns arrives as one cell reading "12 3.456",
three pairs printed side by side have to be read down as one long table, and
the header may say the volume is in litres. This is that clean-up, kept apart
from the parsers so each can be tested alone.
"""
from __future__ import annotations

import re

NUM_TOKEN = re.compile(r"^[+-]?(?:\d+(?:[.,]\d+)?|\d*[.,]\d+)$")

# Rows that belong to the page, not the table.
BOILERPLATE_RE = re.compile(
    r"\b(?:M\s*/\s*V|M\.\s*V\.|M/T|VESSEL|SHIP'?S?\s+NAME|YARD\s*(?:NO)?|HULL\s*NO|IMO\b|"
    r"PAGE\s*\d+(?:\s*(?:OF|/)\s*\d+)?|SHEET\s*\d+(?:\s*(?:OF|/)\s*\d+)?|"
    r"REV(?:ISION|\.)?\s*\w*|APPROVED|DRAWING\s*NO|PRINTED|DATED?\b|TANK\s+SOUNDING\s+TABLES?|"
    r"TANK\s+CAPACIT(?:Y|IES)\s+(?:TABLES?|PLAN)|CALIBRATION\s+BOOK)\b",
    re.I,
)

SOUNDING_LABEL = re.compile(r"^(?:SOUNDING|SOUND\.?|ULLAGE|GAUGE|DEPTH|INNAGE)\b", re.I)
VOLUME_LABEL = re.compile(r"^(?:VOLUME|VOL\.?|CAPACITY|CAP\.?|QUANTITY)\b", re.I)


def _num(cell):
    if cell is None:
        return None
    s = str(cell).strip().replace("−", "-").replace(" ", "")
    if not s or not NUM_TOKEN.match(s):
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def _cells(row):
    return [str(c).strip() if c is not None else "" for c in (row or [])]


_STRAY = re.compile(r"^[^\w+]+$")  # nothing but marks: no letter, no digit
_EDGE = "[^\\w.,+\\-]"
_TAIL = "[^\\w]"
_LOOKALIKE = {
    "O": "0", "o": "0", "D": "0", "Q": "0",
    "I": "1", "i": "1", "l": "1", "|": "1",
    "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2", "G": "6", "g": "9", "q": "9",
}


def clean_ocr_noise(rows):
    """
    What a speckled scan leaves in the cells: a lone ";" or ":" where there is
    no mark on the page, punctuation stuck to a number, and a digit read as a
    letter ("i5" for 15, "l0" for 10). Done only in rows that already hold
    figures, so a title or a header is never touched. Harmless on clean text.
    """
    out = []
    changed = 0
    for r in rows:
        cells = _cells(r)
        nums = sum(1 for c in cells if _num(c) is not None)
        if nums == 0 and not any(_STRAY.match(c) for c in cells if c):
            out.append(cells)
            continue
        new = []
        for c in cells:
            if c == "?":          # a figure the scan lost, marked so the columns after it stay put
                new.append(c)
                continue
            if c and _STRAY.match(c) and not NUM_TOKEN.match(c):
                changed += 1
                new.append("")
                continue
            t = c
            if t:
                t2 = _strip_marks(t)
                if re.match(r"^[.,]\d+[.,]\d+$", t2):
                    t2 = t2[1:]
                if (len(t2) >= 2 and len(t2) <= 12 and re.search(r"\d", t2) and not re.search(r"\d[PSC]$", t2)
                        and re.match(r"^[0-9A-Za-z.,|\-]+$", t2) and _num(t2) is None and nums >= 1):
                    mapped = "".join(_LOOKALIKE.get(ch, ch) for ch in t2)
                    digits = sum(ch.isdigit() for ch in mapped)
                    if _num(mapped) is not None and digits >= 0.6 * len(mapped):
                        t2 = mapped
                if t2 != t:
                    changed += 1
                t = t2
            new.append(t)
        out.append(new)
    return out, changed


def _strip_marks(t):
    """Take stray marks off both ends of a word: ".:12.720" -> "12.720", "34.933}" -> "34.933"."""
    t = (t or "").strip()
    m = re.match(r"^[^\w+\-]*", t)
    lead = m.group(0)
    core = t[len(lead):]
    core = re.sub(r"[^\w]+$", "", core)
    if lead == "." and re.match(r"^\d+$", core):
        return "0." + core  # ".5" is a half, not a five
    return core


def numeric_token(text):
    """The number a word on a scanned page stands for, or None. Same tolerance as clean_ocr_noise."""
    t = _strip_marks(text)
    if re.match(r"^[.,]\d+[.,]\d+$", t):
        t = t[1:]
    n = _num(t)
    if n is not None:
        return n, t
    if 2 <= len(t) <= 12 and re.search(r"\d", t) and re.match(r"^[0-9A-Za-z.,|\-]+$", t) and not re.search(r"\d[PSC]$", t):
        mapped = "".join(_LOOKALIKE.get(ch, ch) for ch in t)
        if _num(mapped) is not None and sum(ch.isdigit() for ch in mapped) >= 0.6 * len(mapped):
            return _num(mapped), mapped
    return None


def drop_boilerplate_rows(rows):
    """Remove the vessel / page / revision rows that sit above and below a table."""
    out = []
    dropped = 0
    for r in rows:
        cells = [c for c in _cells(r) if c]
        if not cells:
            out.append(r)
            continue
        joined = " ".join(cells)
        if BOILERPLATE_RE.search(joined) and len(cells) <= 14:
            # What is left once the page furniture is taken out: a table row has numbers left.
            rest = BOILERPLATE_RE.sub(" ", joined).split()
            if sum(1 for t in rest if _num(t) is not None) <= 1:
                dropped += 1
                continue
        out.append(r)
    return out, dropped


def explode_numeric_cells(rows):
    """
    "12 3.456" in one cell is two cells. Done only where the whole column does
    it, so a cell of text that happens to hold digits is never split.
    """
    rows = [_cells(r) for r in rows]
    if not rows:
        return rows, False
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    factor = [1] * width
    for c in range(width):
        counts = {}
        total = 0
        for r in rows:
            cell = r[c]
            if not cell:
                continue
            toks = cell.split()
            if len(toks) >= 2 and all(_num(t) is not None for t in toks):
                counts[len(toks)] = counts.get(len(toks), 0) + 1
            if _num(cell) is not None or (len(toks) >= 2 and all(_num(t) is not None for t in toks)):
                total += 1
        if counts and total:
            k, n = max(counts.items(), key=lambda kv: kv[1])
            if n >= max(3, 0.6 * total):
                factor[c] = k
    if all(f == 1 for f in factor):
        return rows, False
    out = []
    for r in rows:
        new = []
        for c, cell in enumerate(r):
            k = factor[c]
            if k == 1:
                new.append(cell)
                continue
            toks = cell.split()
            if len(toks) == k and all(_num(t) is not None for t in toks):
                new.extend(toks)
            elif len(toks) == k and not any(_num(t) is not None for t in toks):
                new.extend(toks)  # a header: "SOUNDING VOLUME"
            else:
                new.extend([cell] + [""] * (k - 1))
        out.append(new)
    return out, True


def _label_kind(cell):
    c = (cell or "").strip()
    if SOUNDING_LABEL.match(c):
        return "x"
    if VOLUME_LABEL.match(c):
        return "v"
    return None


def unstack_blocks(rows):
    """
    SOUNDING VOLUME | SOUNDING VOLUME | SOUNDING VOLUME, read down as one table.
    Only done when the header repeats and the soundings continue block to block.
    Columns are found from where the header labels sit, so a row with a figure
    missing (a hole) loses that one pair and not the alignment of the rest.
    Returns (rows, blocks) where blocks is 1 when nothing was changed.
    """
    rows = [_cells(r) for r in rows]
    hi = None
    pos = []
    for i, r in enumerate(rows[:8]):
        labeled = [(j, _label_kind(c)) for j, c in enumerate(r) if c != "" and _label_kind(c)]
        kinds = [k for _j, k in labeled]
        if len(kinds) >= 4 and kinds == ["x", "v"] * (len(kinds) // 2):
            hi, pos = i, [j for j, _k in labeled]
            break
    if hi is None:
        return _unstack_by_structure(rows)
    k = len(pos) // 2
    blocks = [[] for _ in range(k)]
    for r in rows[hi + 1:]:
        if any(_label_kind(c) for c in r if c):
            continue  # a repeated header row
        for b in range(k):
            xj, vj = pos[2 * b], pos[2 * b + 1]
            x = _num(r[xj]) if xj < len(r) else None
            v = _num(r[vj]) if vj < len(r) else None
            if x is not None and v is not None:
                blocks[b].append((x, v))
    blocks = [b for b in blocks if b]
    if len(blocks) < 2:
        return rows, 1
    # The soundings have to carry on from one block to the next.
    flat = _stack(blocks)
    if flat is None:
        return rows, 1
    labels = [rows[hi][pos[0]], rows[hi][pos[1]]]
    out = [labels]
    out.extend([[repr_num(x), repr_num(v)] for x, v in flat])
    return out, len(blocks)


def _rising(pairs):
    """The pairs that keep the soundings rising (a speckle read as a sounding falls out)."""
    import bisect
    tails, idx, prev = [], [], [-1] * len(pairs)
    for i, (x, _v) in enumerate(pairs):
        j = bisect.bisect_left(tails, x)
        if j == len(tails):
            tails.append(x)
            idx.append(i)
        else:
            tails[j] = x
            idx[j] = i
        prev[i] = idx[j - 1] if j else -1
    keep, k = [], idx[-1] if idx else -1
    while k >= 0:
        keep.append(k)
        k = prev[k]
    return [pairs[i] for i in reversed(keep)]


def _stack(blocks):
    """
    Blocks of (sounding, volume) read down as one table, or None when they are not blocks of
    one table: each must be mostly rising, and each must pick up where the one before stopped
    (judged from the middle of each end, so one misread figure cannot move it).
    """
    kept = []
    for b in blocks:
        r = _rising(b)
        if len(r) < 0.85 * len(b):
            return None
        kept.append(r)

    def med(v):
        v = sorted(v)
        return v[len(v) // 2]

    for a, b in zip(kept, kept[1:]):
        last = med([x for x, _v in a[-3:]])
        first = med([x for x, _v in b[:3]])
        step = (a[-1][0] - a[0][0]) / max(len(a) - 1, 1)
        if not (last - 1e-9 <= first <= last + 4 * max(step, 1e-9)):
            return None
    return [pair for b in kept for pair in b]


def _unstack_by_structure(rows):
    """
    The same, when the labels cannot be read (a scan has turned "VOLUME" into "VOLUMF"):
    an even number of columns, each pair a sounding then a volume, and each block's
    soundings carrying on exactly where the block before it stopped. A sounding x trim
    grid never does that - its second column starts again near the bottom.
    """
    width = max((len(r) for r in rows), default=0)
    if width < 4 or width % 2:
        return rows, 1
    body = [r for r in rows if sum(1 for c in r if _num(c) is not None) >= 2]
    if len(body) < 8:
        return rows, 1
    k = width // 2
    blocks = [[] for _ in range(k)]
    for r in body:
        r = r + [""] * (width - len(r))
        for b in range(k):
            x, v = _num(r[2 * b]), _num(r[2 * b + 1])
            if x is not None and v is not None:
                blocks[b].append((x, v))
    if any(len(b) < 0.6 * len(body) for b in blocks):
        return rows, 1
    flat = _stack(blocks)
    if flat is None:
        return rows, 1
    out = [["SOUNDING", "VOLUME"]]
    out.extend([[repr_num(x), repr_num(v)] for x, v in flat])
    return out, k


def repr_num(x):
    s = repr(float(x))
    return s[:-2] if s.endswith(".0") else s


def header_units(rows):
    """What the header says the columns are measured in."""
    text = " ".join(" ".join(_cells(r)) for r in rows[:4]).upper()
    units = {"axis": None, "volume": None}
    if re.search(r"\(\s*MM\s*\)|\bMILLIMET", text):
        units["axis"] = "mm"
    elif re.search(r"\(\s*CM\s*\)|\bCENTIMET|\bSOUNDING\s+CM\b", text):
        units["axis"] = "cm"
    elif re.search(r"\((?:\s*M\s*)\)|\bMETRES?\b|\bMETERS?\b", text):
        units["axis"] = "m"
    if re.search(r"\bLITRES?\b|\bLITERS?\b|\bLTRS?\b|\(\s*L\s*\)|\(\s*LTR\s*\)", text):
        units["volume"] = "l"
    elif re.search(r"M\s*3|M³|CU\.?\s*M|\bKL\b|CUBIC\s+MET", text):
        units["volume"] = "m3"
    return units
