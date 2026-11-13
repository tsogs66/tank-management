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

SOUNDING_LABEL = re.compile(r"^(?:SOUNDING|SOUNDED|SOUND\.?|ULLAGE|GAUGE|DEPTH|INNAGE)\b", re.I)
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


_GLUED = re.compile(r"^(?=.*\d[.,]\d)[+-]?\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)+$")  # needs a decimal: "0-00" is metre-cm, not a minus


def split_glued_cells(rows):
    """
    Printed tables pack their columns tight, and a minus sign takes the gap: "84.996-123.418" is
    two figures, 84.996 and -123.418. Split where every part is a figure; a cell like "10-20" in
    prose is left alone because it is only touched in a row that is mostly figures.
    """
    out = []
    changed = 0
    for r in rows:
        cells = _cells(r)
        figs = sum(1 for c in cells if _num(c) is not None or _GLUED.match(c.replace(" ", "")))
        if figs < 3:
            out.append(cells)
            continue
        new = []
        i = 0
        while i < len(cells):
            c = cells[i]
            if _GLUED.match(c.replace(" ", "")) and _num(c) is None:
                parts = re.findall(r"[+-]?\d+(?:[.,]\d+)?", c.replace(" ", ""))
                # "-" separates, and is also the sign of what follows
                parts = [p if k == 0 else ("-" + p.lstrip("+-")) for k, p in enumerate(parts)]
                new.extend(parts)
                changed += len(parts) - 1
                # a scan leaves a hole where the second figure sat: it is not a column of its own
                j = i + 1
                taken = 0
                while taken < len(parts) - 1 and j < len(cells) and cells[j] in ("", "?"):
                    j += 1
                    taken += 1
                i = j
                continue
            new.append(c)
            i += 1
        out.append(new)
    return out, changed


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
            if c in ("?", "%"):   # a lost figure (kept as a hole), or the unit of a fill column
                new.append(c)
                continue
            if c in ("-", "\u2013", "\u2014") and nums >= 3:
                # A dash where a figure belongs: the book has nothing there (a tank cannot heel that far
                # empty). Kept as a hole so the columns after it stay in place.
                new.append("?")
                changed += 1
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


_NUM = r"[+-]?\d+(?:[.,]\d+)?"
# Trim as a heading: "Tr=-4", "T = -4", "Trim: -4.0 m", "TRIM -4" (stern +, head -, as the book prints it)
TRIM_LABEL = re.compile(rf"^\s*(?:TRIM|TR|T)\s*[=:]?\s*({_NUM})\s*(?:M|METRES?|METERS?)?\s*$", re.I)
# Heel as a heading: "H1P", "H 3 S", "Heel 3 Starboard", "1P", "1 Port", "List 2P", "HEEL 3\u00b0 STBD".
# Port is negative, starboard positive.
HEEL_LABEL = re.compile(
    rf"^\s*(?:HEEL(?:ING)?|LIST|H|L)?\s*[=:]?\s*(\d+(?:[.,]\d+)?)\s*(?:\u00b0|DEG(?:REES?)?)?\s*"
    r"(PORT|PT|P|STARBOARD|STBD|STB|SB|S)\s*$",
    re.I,
)


def label_value(cell):
    """The signed number a trim or heel heading stands for, and which it is: (value, 'trim'|'heel') or None."""
    c = (cell or "").strip()
    if not c:
        return None
    m = TRIM_LABEL.match(c)
    if m:
        return float(m.group(1).replace(",", ".")), "trim"
    m = HEEL_LABEL.match(c)
    if m:
        v = float(m.group(1).replace(",", "."))
        return (-v if m.group(2).upper() in ("P", "PT", "PORT") else v), "heel"
    return None


_SIDE_WORD = {
    # trim by the head is positive, by the stern negative (the ship's own convention, as in
    # "1.0m" under TRIM BY STEM and "-1.0m" under TRIM BY STERN)
    "HEAD": ("trim", 1), "FWD": ("trim", 1), "FORE": ("trim", 1), "BOW": ("trim", 1),
    "STERN": ("trim", -1), "AFT": ("trim", -1),
    "PORT": ("heel", -1), "STARB": ("heel", 1), "STBD": ("heel", 1), "STARBOARD": ("heel", 1),
}
_PLAIN_FIG = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(?:M|\u00b0)?\s*$", re.I)


def sign_grouped_headings(rows):
    """
    "BY THE HEAD  2.0M 1.0M | BY THE STERN  1.0M 2.0M ... 7.0M" and "LIST TO PORT (DEG) 3.0 ... 0.5 |
    LIST TO STARB'D (DEG) 0.5 ... 3.0" print the figures without a sign and let the group name give
    it. The run of figures goes down and then up (2 1 | 1 2 3 ...): the first group is the side
    named first, the second the side named second. Stern and starboard are positive, head and port
    negative (the same convention as the sectioned books). Returns (rows, role) or (rows, None).
    """
    out = [list(_cells(r)) for r in rows]
    for i, r in enumerate(out[:8]):
        idx = [(j, _PLAIN_FIG.match(c)) for j, c in enumerate(r)]
        idx = [(j, m) for j, m in idx if m]
        if len(idx) < 4 or any(c.strip().startswith("-") for c in r):
            continue
        # side words in this row and the rows above it, in the order they appear
        words = []
        for rr in out[max(0, i - 3):i + 1]:
            # a heading printed with letters spaced out ("B Y  T H E  S T E R N") is still the word,
            # whether the scan kept it in one cell or one letter to a cell: join the row, drop the gaps
            cond = re.sub(r"[^A-Z]", "", " ".join(rr).upper())
            for m in re.finditer(r"HEAD|FWD|FORE|BOW|STERN|AFT|STARB|STBD|PORT", cond):
                words.append(m.group(0))
        kinds = {_SIDE_WORD[w][0] for w in words}
        if len(words) < 2 or len(kinds) != 1:
            continue
        left, right = _SIDE_WORD[words[0]][1], _SIDE_WORD[words[-1]][1]
        if left == right:
            continue
        vals = [float(m.group(1).replace(",", ".")) for _j, m in idx]
        k = 1
        while k < len(vals) and vals[k] < vals[k - 1]:
            k += 1
        if k >= len(vals):
            continue          # no turn: not two groups
        for n, (j, _m) in enumerate(idx):
            v = vals[n] * (left if n < k else right)
            out[i][j] = "%g" % v
        return out, kinds.pop()
    return out, None


def normalize_axis_labels(rows):
    """
    Headings written as words become the numbers they mean, so the grid parsers see a row of
    figures: Tr=-4 -> -4 (trim), H1P / Heel 1 Port -> -1 and H3S / Heel 3 Starboard -> 3 (heel;
    port is negative). Only a header row with two or more such headings is touched, so a title
    like "NO.1 (P)" is never taken for a heel column. Returns (rows, role) with role
    'trim', 'heel' or None.
    """
    out, role = sign_grouped_headings(rows)
    if role:
        return out, role
    role = None
    # Trims printed with their unit ("1.0m", "-0.5m", "-1.5 m"), over the words TRIM BY STEM /
    # EVEN KEEL / TRIM BY STERN: the figures are the trims.
    for i, r in enumerate(out[:8]):
        metres = [(j, re.match(rf"^\s*({_NUM})\s*m\s*$", c, re.I)) for j, c in enumerate(r)]
        metres = [(j, m) for j, m in metres if m]
        if len(metres) >= 3 and sum(1 for c in r if _num(c) is not None) == 0:
            for j, m in metres:
                out[i][j] = "%g" % float(m.group(1).replace(",", "."))
            return out, "trim"
    for i, r in enumerate(out[:4]):
        found = [(j, label_value(c)) for j, c in enumerate(r) if label_value(c)]
        if len(found) < 2:
            continue
        kinds = {k for _j, (_v, k) in found}
        if len(kinds) != 1:
            continue
        for j, (v, _k) in found:
            out[i][j] = ("%g" % v)
        role = kinds.pop()
        # the row's first cell is the sounding label ("GAUGE", "ULLAGE") and stays
        break
    return out, role


_AXIS_WORDS = {
    "MM": "mm", "MILLIMETRE": "mm", "MILLIMETRES": "mm", "MILLIMETER": "mm", "MILLIMETERS": "mm",
    "CM": "cm", "CENTIMETRE": "cm", "CENTIMETRES": "cm", "CENTIMETER": "cm", "CENTIMETERS": "cm",
    "M": "m", "MTR": "m", "MTRS": "m", "METRE": "m", "METRES": "m", "METER": "m", "METERS": "m",
}


def _axis_unit_in(cell):
    for w in re.split(r"[^A-Z0-9\u00b3]+", (cell or "").upper()):
        if w in _AXIS_WORDS:
            return _AXIS_WORDS[w]
    return None


def header_units(rows):
    """
    What the header says the columns are measured in. The unit of the sounding is taken from
    the sounding column's own heading, or from the cell under it ("ULLAGE" over "mm"), so the
    "(m)" on a TRIM column is never taken for it.
    """
    text = " ".join(" ".join(_cells(r)) for r in rows[:4]).upper()
    units = {"axis": None, "volume": None}
    hdr = [[c for c in _cells(r) if c.strip()] for r in rows[:10]]
    for ri, row in enumerate(hdr):
        for ci, c in enumerate(row):
            if SOUNDING_LABEL.match(c.strip()):
                under = [hdr[rj][ci] for rj in range(ri + 1, len(hdr)) if ci < len(hdr[rj])]
                for cand in [c] + under:
                    u = _axis_unit_in(cand)
                    if u:
                        units["axis"] = u
                        break
    if units["axis"] is None and not re.search(r"\bTRIM\b|\bHEEL|\bLIST\b", text):
        # nothing under a sounding label: words anywhere in a plain header (never on a trim or
        # heel table, whose "(m)" belongs to the trim)
        plain = re.sub(r"CUBIC\s+MET\w*", " ", text)      # "cubic metres" is the volume's unit, not the sounding's
        if re.search(r"\(\s*MM\s*\)|\bMILLIMET", plain):
            units["axis"] = "mm"
        elif re.search(r"\(\s*CM\s*\)|\bCENTIMET|\bSOUNDING\s+CM\b", plain):
            units["axis"] = "cm"
        elif re.search(r"\((?:\s*M\s*)\)|\bMETRES?\b|\bMETERS?\b", plain):
            units["axis"] = "m"
    if re.search(r"\bLITRES?\b|\bLITERS?\b|\bLTRS?\b|\(\s*L\s*\)|\(\s*LTR\s*\)", text):
        units["volume"] = "l"
    elif re.search(r"\bM\^?3\b|M³|\bCU\.?\s*M\b|\bKL\b|CUBIC\s+MET", text):
        units["volume"] = "m3"
    return units


# ---------------------------------------------------------------- one table, several kinds of column

_HYDRO_COL = re.compile(r"^(?:L\.?C\.?G|T\.?C\.?G|V\.?C\.?G|I\.?MOM|FSM|LCF|LCB|KB|KM|KG|IT|IX|IY|TCG|VCG|LCG)\.?$", re.I)
_UNIT_WORDS = {"cm", "mm", "m", "m3", "m4", "%", "deg", "deg.", "ltr", "l", "t", "mt", "kg"}


def _column_role(tok):
    """What a column heading is: ('axis', 'sounding'|'ullage'), ('fill', None), ('trim', value),
    ('heel', value), ('hydro', None) or (None, None)."""
    t = (tok or "").strip()
    u = t.upper()
    if re.match(r"^(?:GAUGE|SOUNDING|SOUNDED|SOUND\.?|DEPTH|INNAGE)$", u):
        return "axis", "sounding"
    if u == "ULLAGE":
        return "axis", "ullage"
    if re.match(r"^FILL(?:ED)?$|^FILL%$|^%$", u):
        return "fill", None
    lv = label_value(t)
    if lv:
        return lv[1], lv[0]
    if _HYDRO_COL.match(t):
        return "hydro", None
    return None, None


def parse_combined(rows):
    """
    A sounding table that holds everything in one grid: GAUGE, FILL %, ULLAGE, then a column per
    trim (Tr=-4 ... Tr=1), then a column per heel (H1P ... H3S), then the hydrostatic columns
    (L.C.G, T.C.G, V.C.G, IMOM). Each column is told by its heading and put where it belongs:
    the trims make the trim grid, the heels make the heel grid (in order, port negative), the
    hydrostatic columns are left out, and the gauge is the sounding the rows are keyed by.
    Returns a dict (rows, parsed, removed) or None when the table is not of this kind.
    """
    rows = [_cells(r) for r in rows]
    hi = roles = toks = None
    for i, r in enumerate(rows[:10]):
        t = " ".join(c for c in r if c).split()
        rl = [_column_role(x) for x in t]
        kinds = [k for k, _v in rl]
        if len(t) >= 6 and "axis" in kinds and (kinds.count("trim") >= 2 or kinds.count("heel") >= 2) \
                and (kinds.count("trim") + kinds.count("heel")) >= 4:
            hi, roles, toks = i, rl, t
            break
    if hi is None:
        return None
    n = len(toks)
    units = None
    data = []
    for r in rows[hi + 1:]:
        t = " ".join(c for c in r if c).split()
        if not t:
            continue
        if len(t) == n and all(x.lower().strip("()") in _UNIT_WORDS for x in t):
            units = [x.lower().strip("()") for x in t]
            continue
        if len(t) == n:
            vals = []
            for x in t:
                if x == "?":
                    vals.append(None)
                else:
                    v = _num(x)
                    if v is None:
                        break
                    vals.append(v)
            else:
                data.append(vals)
    if len(data) < 5:
        return None

    kinds = [k for k, _v in roles]
    ax_idx = [i for i, (k, v) in enumerate(roles) if k == "axis"]
    sound = [i for i in ax_idx if roles[i][1] == "sounding"]
    ull = [i for i in ax_idx if roles[i][1] == "ullage"]
    axis_col = (sound or ull)[0]
    method = "sounding" if sound else "ullage"
    trims = sorted([(roles[i][1], i) for i, k in enumerate(kinds) if k == "trim"], key=lambda p: -p[0])
    heels = sorted([(roles[i][1], i) for i, k in enumerate(kinds) if k == "heel"])
    hydro = [toks[i] for i, k in enumerate(kinds) if k == "hydro"]
    # the printed order of trims is kept (the book's own), the heels are put in order port to starboard
    trims = [(v, i) for v, i in sorted([(roles[i][1], i) for i, k in enumerate(kinds) if k == "trim"], key=lambda p: p[1])]

    axis = [row[axis_col] for row in data]
    blanks = []

    def grid_for(cols, tag):
        g = []
        for ri, row in enumerate(data):
            line = []
            for ci, (_v, i) in enumerate(cols):
                x = row[i]
                if x is None:
                    blanks.append([tag, ri, ci])
                    x = 0.0
                line.append(x)
            g.append(line)
        return g

    trim_grid = grid_for(trims, "trim") if trims else []
    heel_grid = grid_for(heels, "heel") if heels else []
    parsed = {
        "kind": "grid",
        "trimAxis": axis,
        "trimVals": [v for v, _i in trims],
        "trimGrid": trim_grid,
        "listAxis": axis if heels else [],
        "listVals": [v for v, _i in heels],
        "listGrid": heel_grid,
        "volumeCurve": {"x": [], "v": []},
        "heelIncrement": 1,
        "soundingMethod": method,
        "capacity": max((max(r) for r in trim_grid if r), default=0),
        "combined": True,
    }
    if units:
        if units[axis_col] in ("cm", "mm", "m"):
            parsed["axisUnit"] = units[axis_col]
        if trims and units[trims[0][1]] in ("m3", "l", "t"):
            parsed["volumeUnit"] = units[trims[0][1]]
    # The same depth measured the other way (gauge and ullage add up to the sounding pipe's length).
    if sound and ull:
        sums = {round(row[sound[0]] + row[ull[0]], 6) for row in data if row[ull[0]] is not None}
        if len(sums) == 1:
            parsed["axisPair"] = {"label": "ullage", "constant": sums.pop()}
    fill = [i for i, k in enumerate(kinds) if k == "fill"]
    if fill:
        parsed["fillPercent"] = [row[fill[0]] for row in data]
    if blanks:
        parsed["blankCells"] = [[r, c] for t, r, c in blanks if t == "trim"]
    role = "trim" if trims else "heel"
    if heels and not trims:
        # Only heel columns: this is a heel table like any other, held the way the others are.
        parsed.update({"trimAxis": axis, "trimVals": [v for v, _i in heels], "trimGrid": heel_grid,
                       "listAxis": [], "listVals": [], "listGrid": []})
        parsed.pop("combined", None)
    preview = [toks] + ([units] if units else []) + [[("" if v is None else repr_num(v)) for v in row] for row in data]
    return {"rows": preview, "parsed": parsed, "removed": hydro, "role": role}


# ---------------------------------------------------------------- blocks with columns the app does not keep

_VOL_LABEL = re.compile(r"^(?:CAPACITY|CAP\.?|VOLUME|VOL\.?)$", re.I)


def _gauge_cm(tok, state, metre_cm):
    """A gauge in "metre-centimetre" form: 0-00, 01, 02 ... 09, 0-10, 11 ... is 0, 1, 2 ... 9, 10, 11 cm."""
    m = re.match(r"^(\d+)-(\d{2})$", tok)
    if m:
        state["m"] = int(m.group(1))
        return state["m"] * 100 + int(m.group(2))
    if metre_cm and state.get("m") is not None and re.match(r"^\d{1,2}$", tok):
        return state["m"] * 100 + int(tok)
    return _num(tok)


def unstack_extras(rows):
    """
    Capacity tables printed as blocks side by side, each block GAUGE CAPACITY KG LCG IT, the
    gauge written metre-centimetre. The capacity is the table; KG, LCG and IT are not kept. The
    blocks are read down as one curve in centimetres.
    Returns (rows, info) with info None when the table is not of this kind.
    """
    rows = [_cells(r) for r in rows]
    metre_cm = any(re.search(r"M\s*-\s*CM", c, re.I) for r in rows[:8] for c in r)
    for hi, r in enumerate(rows[:10]):
        toks = " ".join(c for c in r if c).split()
        roles = [("x" if _column_role(t) == ("axis", "sounding") else ("v" if _VOL_LABEL.match(t) else None)) for t in toks]
        if roles.count("x") < 2 or roles.count("v") != roles.count("x") or len(toks) < 6:
            continue
        starts = [i for i, k in enumerate(roles) if k == "x"]
        size = starts[1] - starts[0]
        if any(b - a != size for a, b in zip(starts, starts[1:])) or len(toks) != size * len(starts) or size < 3:
            continue
        voff = roles[starts[0]:starts[0] + size].index("v")
        extras = [toks[starts[0] + k] for k in range(size) if k not in (0, voff)]
        blocks = [[] for _ in starts]
        states = [{} for _ in starts]
        for rr in rows[hi + 1:]:
            t = " ".join(c for c in rr if c).split()
            if len(t) != len(toks):
                continue
            for b, st in enumerate(starts):
                x = _gauge_cm(t[st], states[b], metre_cm)
                v = _num(t[st + voff])
                if x is not None and v is not None:
                    blocks[b].append((x, v))
        blocks = [b for b in blocks if b]
        if len(blocks) < 2:
            continue
        flat = _stack(blocks)
        if flat is None:
            continue
        out = [["GAUGE", "CAPACITY"]] + [[repr_num(x), repr_num(v)] for x, v in flat]
        info = {"removed": extras, "axis": "cm" if metre_cm else None, "volume": None}
        return out, info
    return rows, None
