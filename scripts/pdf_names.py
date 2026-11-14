"""
Telling which tank a page of a sounding book belongs to.

A calibration book is a few hundred pages, one or more per tank, and the only
thing that says whose page it is is a title: "NO.1 H.F.O. TANK (P) - SOUNDING
TABLE", "No 2 DB TK STBD", "FWT 3C (CONT'D)". Next to it sit the vessel's name,
the page number, the book's own title and, on a scan, whatever the OCR made of
the stamp in the corner. This module reads the lines of a page, scores each
as a tank title, strips the words that are not part of a name, and says how
sure it is.

It also reduces any title to a key (`name_key`) that is the same for every way
of writing one tank, so a page that spells it "NO. 1 HFO STOR. TK (P)" is
recognised as a continuation of "No.1 H.F.O. Storage Tank Port".
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------- vocabulary

GRADE = (
    r"H\.?\s*F\.?\s*O\.?|HFO|LS\s*HFO|LSFO|VLSFO|ULSFO|HSFO|"
    r"M\.?\s*D\.?\s*O\.?|MDO|M\.?\s*G\.?\s*O\.?|MGO|GAS\s*OIL|DIESEL|"
    r"D\.?\s*O\.?|F\.?\s*O\.?|FUEL\s*OIL|"
    r"L\.?\s*O\.?|LUB(?:E|RICATING)?\s*OIL|LUBE|CYL(?:INDER)?(?:\s*OIL)?|SYS(?:TEM)?\s*OIL|"
    r"HYD(?:RAULIC)?(?:\s*OIL)?|THERMAL\s*OIL|"
    r"F\.?\s*W\.?|FRESH\s*WATER|POTABLE|DRINKING(?:\s*WATER)?|DISTILLED(?:\s*WATER)?|"
    r"S\.?\s*W\.?|SEA\s*WATER|BALLAST|W\.?\s*B\.?|"
    r"SLUDGE|BILGE|SLOP|WASTE(?:\s*OIL)?|SEWAGE|GREY\s*WATER|GRAY\s*WATER|"
    r"UREA|ADBLUE|COOLING\s*WATER|C\.?\s*W\.?|EMULSION|LEAK(?:AGE)?\s*OIL"
)
ROLE = (
    r"STORAGE|STOR\.?|SETTLING|SETT?\.?|SERVICE|SERV\.?|DAILY|OVERFLOW|OVFL\.?|OVERFLOW|DRAIN(?:S)?|DRN\.?|"
    r"SUMP|EMERGENCY|EMERG\.?|FEED|DOUBLE\s*BOTTOM|D\.?\s*B\.?|DEEP|WING|TOP\s*SIDE|HOPPER|VOID|"
    r"FORE\s*PEAK|AFT\s*PEAK|FPT|APT|COFFERDAM|CARGO|HOLD"
)
# FWT, F.O.T., D.O.T., W.B.T. ... : the grade and the word "tank" in one.
CODE = (
    r"(?:H[.\s]*F[.\s]*O|M[.\s]*D[.\s]*O|M[.\s]*G[.\s]*O|F[.\s]*O|D[.\s]*O|L[.\s]*O|F[.\s]*W|"
    r"S[.\s]*W|W[.\s]*B|D[.\s]*B|C[.\s]*W|B[.\s]*W|F[.\s]*P|A[.\s]*P)[.\s]*T\.?"
)
TANKWORD = r"TANKS?|TANKE|TK\.?|TNK\.?|T\.?"
SIDE = r"[\(\[]\s*[PSC]\s*[\)\]]|(?<=[A-Z])\.[PSC]\b|\bPORT\b|\bSTBD\b|\bSTARBOARD\b|\bCENT(?:RE|ER)\b|\bP\s*&\s*S\b|\b\d+\s*[PSC]\b|\bP/S\b"
NUMID = r"(?:\bNO\.?|\bNR\.?|\b#)\s*\d+|\b\d+\b"

GRADE_RE = re.compile(rf"(?<![A-Z0-9])(?:{GRADE})(?![A-Z0-9])", re.I)
ROLE_RE = re.compile(rf"(?<![A-Z0-9])(?:{ROLE})(?![A-Z0-9])", re.I)
TANKWORD_RE = re.compile(rf"(?<![A-Z0-9])(?:{TANKWORD}|{CODE})(?![A-Z0-9])", re.I)
CODE_RE = re.compile(rf"(?<![A-Z0-9])(?:{CODE})(?![A-Z0-9])", re.I)
SIDE_RE = re.compile(SIDE, re.I)
NUMID_RE = re.compile(NUMID, re.I)

# Things that are on the page but are not a tank.
NOISE_RE = re.compile(
    r"\b(?:M\s*/\s*V|M\.\s*V\.|M/T|MT\s+[A-Z]{3,}|VESSEL|SHIP'?S?\s+NAME|YARD|HULL\s+NO|BUILDER|IMO|"
    r"PAGE\s*\d+|PAGE\s+\w+\s+OF|\d+\s*/\s*\d+\s*$|CAPACITY\s+PLAN|TANK\s+CAPACITIES|TANK\s+CAPACITY\s+TABLES?|"
    r"SOUNDING\s+TABLES?\s*$|CALIBRATION\s+(?:BOOK|TABLES?)\s*$|TRIM\s+AND\s+STABILITY|STABILITY|"
    r"APPROVED|DRAWING|SCALE|REV(?:ISION)?|DATE|DATED|PRINTED|SHEET\s+\d+|INDEX|CONTENTS?|NOTES?:|REMARKS?)\b",
    re.I,
)
# A column header, not a title.
HEADER_ONLY_RE = re.compile(
    r"^\s*(?:SOUNDING|ULLAGE|GAUGE|DEPTH|INNAGE|VOLUME|VOL\.?|CAPACITY|TRIM|HEEL|LIST|EVEN\s*KEEL|"
    r"L\.?C\.?G|T\.?C\.?G|V\.?C\.?G|FSM|IMOM|CM|MM|M3|M³|%)\b",
    re.I,
)

# What gets stripped off the end (or front) of a title to leave the name.
TRAILER_RES = [
    # "NO.1 H.F.O.STOR.TK.P - Volume in m3" (SDARI): the table's own heading, however a scan spaces it
    re.compile(r"\s*[-–—:|,]?\s*V\s*O\s*L\s*U\s*M\s*E\s*(?:I\s*N\s*)?(?:M\s*\^?\s*[3³]|C\s*U\s*\.?\s*M)?\s*$", re.I),
    re.compile(r"\s*[-–—:|,/]?\s*\(?\s*(?:SOUNDING|ULLAGE|CALIBRATION|CAPACITY|VOLUME|GAUGING)\s*"
               r"(?:TABLES?|CHART|DATA|TABULATION|BOOK|SCALE)?\s*\)?\s*$", re.I),
    re.compile(r"\s*[-–—:|,]?\s*\(?\s*(?:CONT(?:'D|’D|INUED|\.|D)?|CONTINUATION|CONT\s*D)\s*\)?\s*$", re.I),
    re.compile(r"\s*[-–—:|,]?\s*\(?\s*SHEET\s*\d+\s*(?:OF\s*\d+)?\s*\)?\s*$", re.I),
    re.compile(r"\s*[-–—:|,]?\s*\(?\s*PAGE\s*\d+\s*(?:OF\s*\d+)?\s*\)?\s*$", re.I),
    re.compile(r"\s*[-–—:|,]?\s*\(?\s*(?:100\s*%|FULL|CAP(?:ACITY)?)\s*[:=]?\s*[\d.,]+\s*(?:M3|M³|CU\.?\s*M|KL|M\^3)?\s*\)?\s*$", re.I),
]
LEADER_RE = re.compile(r"^\s*(?:\d{1,2}[.-]\d{1,3}\s+|\d{1,3}\s*COMPART(?:MENT)?\s*[:=-]\s*|COMPARTMENT\s+DESCR(?:IPTION)?\s*[:=-]\s*|TABLE\s+OF|SOUNDING\s+TABLE\s+(?:FOR|OF)|CALIBRATION\s+(?:TABLE\s+)?(?:FOR|OF)|TANK\s*(?:NAME)?\s*[:=-]|NAME\s*[:=-])\s*", re.I)

CAPACITY_RE = re.compile(
    r"(?:CAPACITY|CAP\.?|100\s*%|FULL|VOLUME)\s*[:=]?\s*([\d]{1,3}(?:[ ,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(M3|M³|CU\.?\s*M|KL|M\^3)",
    re.I,
)
PERCENT_CAP_RE = re.compile(
    r"(?P<pct>\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:FULL|FILL(?:ED)?|CAPACITY|CAP\.?|VOLUME|=|:)?\s*[:=]?\s*"
    r"([\d]{1,3}(?:[ ,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(?:M3|M\u00b3|CU\.?\s*M|KL|M\^3)",
    re.I,
)
CONT_RE = re.compile(r"\bCONT(?:'D|’D|INUED|\.|D)?\b|\bCONTINUATION\b", re.I)

# ---------------------------------------------------------------- scoring


def _letters(text):
    return sum(1 for ch in text if ch.isalpha())


_FIG = re.compile(r"^[\W_]*[+-]?\d+(?:[.,]\d+)?[\W_]*$")


def looks_like_data_row(text):
    """Two figures to start with ("59 18.855 LO"): a row of a table, whatever else the scan put in it."""
    toks = (text or "").split()
    return len(toks) >= 2 and bool(_FIG.match(toks[0])) and bool(_FIG.match(toks[1]))


def score_name(text, rel_top=0.5, size_ratio=1.0):
    """
    How much a line looks like a tank's title. Roughly 0 (not at all) to 14.
    `rel_top` is 0 at the top of the page, 1 at the foot; `size_ratio` is the
    line's font size against the page's body text.
    """
    t = (text or "").strip()
    if not t or len(t) > 110 or _letters(t) < 2 or looks_like_data_row(t):
        return 0.0
    t, _info = clean_name(t)  # "SOUNDING TABLE" etc. are not part of the name
    if not t or _letters(t) < 2:
        return 0.0
    score = 0.0
    has_grade = bool(GRADE_RE.search(t) or CODE_RE.search(t))
    has_role = bool(ROLE_RE.search(t))
    has_tank = bool(TANKWORD_RE.search(t))
    has_side = bool(SIDE_RE.search(t))
    has_num = bool(NUMID_RE.search(t))
    if has_grade:
        score += 3
    if has_role:
        score += 2
    if has_tank:
        score += 2.5
    if has_side:
        score += 1.5
    if has_num and (has_grade or has_role or has_tank):
        score += 1.5
    if rel_top < 0.30:
        score += 2
    elif rel_top < 0.5:
        score += 1
    if size_ratio >= 1.25:
        score += 1.5
    elif size_ratio >= 1.1:
        score += 0.5
    if not (has_grade or has_role or has_tank):
        return 0.0  # a number and a side are not a name
    if NOISE_RE.search(t):
        score -= 4.5
    if HEADER_ONLY_RE.match(t) and not has_tank:
        score -= 6
    digits = sum(ch.isdigit() for ch in t)
    if digits > 0.45 * max(1, len(t)):
        score -= 4
    if len(t) > 80:
        score -= 2
    return max(0.0, score)


_KNOWN_CODES = {"FWT", "FOT", "DOT", "WBT", "DBT", "SWT", "LOT", "CWT", "FPT", "APT", "HFO", "MDO", "MGO", "HFOT", "MDOT", "MGOT"}


def join_split_codes(t):
    """OCR puts a gap inside a code ("F WT 3 C"): rejoin when the result is a known one."""
    toks = t.split(" ")
    out = []
    i = 0
    while i < len(toks):
        done = False
        for span in (3, 2):
            chunk = toks[i:i + span]
            if len(chunk) == span and all(c.isalpha() and len(c) <= 3 for c in chunk):
                joined = "".join(chunk).upper()
                if joined in _KNOWN_CODES:
                    out.append(joined)
                    i += span
                    done = True
                    break
        if not done:
            out.append(toks[i])
            i += 1
    return " ".join(out)


def clean_name(text):
    """
    Reduce a title line to the tank's name; also report what was in it.
    Returns (name, info) with info = {method, continued, capacity}.
    """
    t = re.sub(r"\s+", " ", (text or "").replace("–", "-").replace("—", "-")).strip(" -:|,;")
    info = {"method": None, "continued": bool(CONT_RE.search(t)), "capacity": None}
    # "98% FULL 512.9 m3" is not the tank's capacity: 512.9 is 98% of it.
    pct = PERCENT_CAP_RE.search(t)
    cap = pct or CAPACITY_RE.search(t)
    if cap:
        num = (cap.group(2) if pct else cap.group(1)).replace(" ", "")
        if "," in num and "." in num:
            num = num.replace(",", "")
        elif "," in num:
            num = num.replace(",", ".") if re.search(r",\d{1,2}$", num) else num.replace(",", "")
        try:
            info["capacity"] = float(num)
            if pct:
                share = float(pct.group("pct").replace(",", "."))
                if 0 < share < 100:
                    info["capacity"] = round(info["capacity"] * 100.0 / share, 3)
        except ValueError:
            pass
    if re.search(r"\bULLAGE\b", t, re.I) and not re.search(r"\bSOUNDING\b", t, re.I):
        info["method"] = "ullage"
    elif re.search(r"\bSOUNDING\b|\bINNAGE\b", t, re.I):
        info["method"] = "sounding"
    t = LEADER_RE.sub("", t)
    # "CAPACITY 96.2 M3" that OCR has run together ("CAPAC96I.2T MY3"): cut it off.
    t = re.sub(r"\s+C\s*A\s*P\s*A\s*C.*$", "", t, flags=re.I)
    t = join_split_codes(t)
    for _ in range(3):
        before = t
        for rx in TRAILER_RES:
            t = rx.sub("", t)
        t = t.strip(" -:|,;")
        if t == before:
            break
    # A scan runs words together ("NO.1H.F.O.", "FWT3 C"): put the space back between a number and a code.
    if re.match(r"^\s*(?:NO\.?\s*)?\d?[A-Za-z.]*\d", t, re.I):
        t = re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", t)
    t = re.sub(r"(?<=\s[A-Z])\.$", "", re.sub(r"\s+", " ", t).strip())  # "FWT 3 C." -> "FWT 3 C"
    # What a scan leaves around a name: marks in front, a side written twice, mush after the side.
    t = re.sub(r"^[^A-Za-z0-9(]+", "", t)
    t = re.sub(r"\(\s*([PSCpsc])\1+\s*\)", lambda m: "(" + m.group(1).upper() + ")", t)
    t = re.sub(r"^(.*?\(\s*[PSC]\s*\))\s+\S.*$", r"\1", t) if re.search(r"\([PSC]\)\s+\S", t) and not re.search(r"\([PSC]\)\s+(?:TANK|TK)", t, re.I) else t
    t = re.sub(r"(?:\s+[^A-Za-z0-9(]{1,3})+$", "", t)
    t = t.strip()
    return t, info


# ---------------------------------------------------------------- identity

_SIDE_WORDS = {"PORT": "P", "STBD": "S", "STARBOARD": "S", "CENTRE": "C", "CENTER": "C", "STB": "S"}


def name_key(name):
    """
    One spelling for every way of writing a tank:
    "NO. 1 HFO STOR. TK (P)" and "No.1 H.F.O. Storage Tank Port" both give
    "HFO STORAGE TANK 1 P".
    """
    s = clean_name(name or "")[0].upper()
    for pat, rep in (
        (r"(?<![A-Z])H[.\s]*F[.\s]*O[.\s]*T\b\.?", " HFO TANK "),
        (r"(?<![A-Z])M[.\s]*D[.\s]*O[.\s]*T\b\.?", " MDO TANK "),
        (r"(?<![A-Z])M[.\s]*G[.\s]*O[.\s]*T\b\.?", " MGO TANK "),
        (r"(?<![A-Z])D[.\s]*O[.\s]*T\b\.?", " MDO TANK "),
        (r"(?<![A-Z])F[.\s]*O[.\s]*T\b\.?", " FO TANK "),
        (r"(?<![A-Z])L[.\s]*O[.\s]*T\b\.?", " LO TANK "),
        (r"(?<![A-Z])F[.\s]*W[.\s]*T\b\.?", " FW TANK "),
        (r"(?<![A-Z])S[.\s]*W[.\s]*T\b\.?", " SW TANK "),
        (r"(?<![A-Z])W[.\s]*B[.\s]*T\b\.?", " BALLAST TANK "),
        (r"(?<![A-Z])D[.\s]*B[.\s]*T\b\.?", " DB TANK "),
        (r"(?<![A-Z])F[.\s]*P[.\s]*T\b\.?", " FORE PEAK TANK "),
        (r"(?<![A-Z])A[.\s]*P[.\s]*T\b\.?", " AFT PEAK TANK "),
    ):
        s = re.sub(pat, rep, s)
    s = re.sub(r"H\.?\s*F\.?\s*O\.?(?![A-Z])", " HFO ", s)
    s = re.sub(r"M\.?\s*D\.?\s*O\.?(?![A-Z])", " MDO ", s)
    s = re.sub(r"M\.?\s*G\.?\s*O\.?(?![A-Z])", " MGO ", s)
    s = re.sub(r"(?<![A-Z])L\.?\s*O\.?(?![A-Z])", " LO ", s)
    s = re.sub(r"(?<![A-Z])F\.?\s*W\.?(?![A-Z])", " FW ", s)
    s = re.sub(r"(?<![A-Z])S\.?\s*W\.?(?![A-Z])", " SW ", s)
    s = re.sub(r"(?<![A-Z])D\.?\s*O\.?(?![A-Z])", " MDO ", s)
    s = re.sub(r"(?<![A-Z])F\.?\s*O\.?(?![A-Z])", " FO ", s)
    s = re.sub(r"\bDIESEL\s+OIL\b", " MDO ", s)
    s = re.sub(r"\bFRESH\s+WATER\b", " FW ", s)
    s = re.sub(r"(?<![A-Z])D\.?\s*B\.?(?![A-Z])", " DB ", s)
    s = re.sub(r"\b(?:TNK|TK|TANKS?)\b\.?", " TANK ", s)
    s = re.sub(r"\bSTOR\b\.?", " STORAGE ", s)
    s = re.sub(r"\bSETT?\b\.?", " SETTLING ", s)
    s = re.sub(r"\bSERV\b\.?", " SERVICE ", s)
    s = re.sub(r"\bOVFL\b\.?", " OVERFLOW ", s)
    s = re.sub(r"\bDRN\b\.?", " DRAIN ", s)
    s = re.sub(r"\b(?:NO|NR)\b\.?|#", " ", s)
    # "3P" / "3 S" next to a number -> number and side
    s = re.sub(r"\b(\d+)\s*([PSC])\b", r" \1 \2 ", s)
    for word, letter in _SIDE_WORDS.items():
        s = re.sub(rf"\b{word}\b", f" {letter} ", s)
    s = re.sub(r"[\(\[]\s*([PSC])\s*[\)\]]", r" \1 ", s)
    s = re.sub(r"(?<=[A-Z])\.([PSC])\b", r" \1 ", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    toks = s.split()
    # Drop filler; keep order of the rest but put the tank word out of the way.
    toks = [t for t in toks if t not in {"THE", "OF", "AND", "TABLE", "TABLES"}]
    return " ".join(toks)


def _parts(key):
    toks = key.split()
    sides = {t for t in toks if t in {"P", "S", "C"}}
    nums = {t for t in toks if t.isdigit()}
    words = [t for t in toks if t not in {"P", "S", "C", "TANK"} and not t.isdigit()]
    return sides, nums, "".join(words)


def same_tank(a, b):
    """
    Are these two titles the same tank? Different spellings, a title cut short
    by the page layout, or a letter lost to OCR still count; a different
    number or side never does.
    """
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    sa, na, wa = _parts(ka)
    sb, nb, wb = _parts(kb)
    if sa and sb and sa != sb:
        return False
    if na and nb and na != nb:
        return False
    if not wa or not wb:
        return False
    if wa == wb:
        return True
    short, long_ = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if len(short) >= 6 and short in long_:
        return True
    from difflib import SequenceMatcher
    return SequenceMatcher(None, wa, wb).ratio() >= 0.88


# ---------------------------------------------------------------- page level


def find_title(lines, page_height=None, body_size=None):
    """
    Choose the line of a page that names its tank.

    `lines` are dicts with text and, when the PDF gives geometry, top and size.
    Returns None or {name, raw, score, confidence, method, continued, capacity, line}.
    """
    best = None
    scored = []
    for idx, ln in enumerate(lines or []):
        text = (ln.get("text") or "").strip()
        if not text:
            continue
        top = ln.get("top")
        rel = (top / page_height) if (top is not None and page_height) else min(0.9, idx / max(len(lines), 1))
        size_ratio = (ln.get("size") / body_size) if (ln.get("size") and body_size) else 1.0
        s = score_name(text, rel, size_ratio)
        if s >= 4.5:
            scored.append((s, -idx, idx, text))
    if not scored:
        # A title the scan has pulled apart ("F WT 3 C" or "NO.1H.F.O.STOR AGE"): with every
        # space and mark taken out it still starts like a tank's name.
        for idx, ln in enumerate((lines or [])[:12]):
            text = (ln.get("text") or "").strip()
            cond = re.sub(r"[^A-Z0-9]", "", text.upper())
            if not looks_like_data_row(text) and 3 <= len(cond) <= 40 and re.match(
                r"^(?:NO\d*|NR\d*)?\d*(?:HFO|MDO|MGO|FWT|FOT|DOT|LOT|SWT|WBT|DBT|FPT|APT|FO|DO|LO|FW|SW)T?\d*[PSC]?", cond
            ) and not NOISE_RE.search(text) and not HEADER_ONLY_RE.match(text):
                scored.append((5.0, -idx, idx, text))
                break
    if not scored:
        return None
    scored.sort(reverse=True)
    for s, _neg, idx, text in scored[:1]:
        name, info = clean_name(text)
        if len(name) < 3:
            continue
        # A title is sometimes broken over two lines: "NO.1 HFO STORAGE" / "TANK (P)".
        if idx + 1 < len(lines):
            nxt = (lines[idx + 1].get("text") or "").strip()
            is_tail = bool(nxt) and len(nxt) < 30 and not re.search(r"\d{2,}", nxt) and (
                re.match(r"^\(\s*[PSC]\s*\)$", nxt)
                or (re.match(r"^(?:TANK|TK|PORT|STBD|STARBOARD)\b", nxt, re.I) and not TANKWORD_RE.search(name))
            )
            if is_tail:
                name2, info2 = clean_name(f"{text} {nxt}")
                name = name2 or name
                info["continued"] = info["continued"] or info2["continued"]
        best = {
            "name": name[:120],
            "raw": text[:160],
            "score": round(s, 2),
            "confidence": round(min(1.0, s / 10.0), 2),
            "method": info["method"],
            "continued": info["continued"],
            "capacity": info["capacity"],
            "line": idx,
        }
        break
    # A capacity can sit on a different line: "CAPACITY 523.4 M3".
    if best and best["capacity"] is None:
        for ln in lines[:25]:
            m = CAPACITY_RE.search(ln.get("text") or "")
            if m:
                _n, info = clean_name(ln["text"])
                if info["capacity"]:
                    best["capacity"] = info["capacity"]
                    break
    return best


class NameTracker:
    """
    Follows the tank through the pages of a book.

    A page with a title starts (or continues) a tank. A page without one
    belongs to the tank before it, and is flagged as carried so the splice can
    decide whether it really is the same table.
    """

    def __init__(self):
        self.current = ""
        self.current_raw = ""
        self.capacity = None
        self.method = None
        self.history = []

    def page(self, page_no, lines, page_height=None, body_size=None):
        found = find_title(lines, page_height, body_size)
        if found:
            same = same_tank(found["name"], self.current)
            result = {
                "name": self.current if same and self.current else found["name"],
                "source": "continued" if same else "title",
                "confidence": found["confidence"],
                "capacity": found["capacity"] or (self.capacity if same else None),
                "method": found["method"] or (self.method if same else None),
                "continuedMark": found["continued"],
                "raw": found["raw"],
                "newTank": not same,
            }
            self.current = result["name"]
            self.current_raw = found["raw"]
            self.capacity = result["capacity"]
            self.method = result["method"]
        else:
            result = {
                "name": self.current,
                "source": "carried" if self.current else "none",
                "confidence": 0.35 if self.current else 0.0,
                "capacity": self.capacity,
                "method": self.method,
                "continuedMark": False,
                "raw": self.current_raw,
                "newTank": False,
            }
        self.history.append((page_no, result["name"], result["source"]))
        return result
