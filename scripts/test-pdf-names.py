#!/usr/bin/env python3
"""Which tank a page of a sounding book is about, in the many ways a title is written."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_names as n  # noqa: E402

failed = 0
total = 0


def check(name, cond, detail=""):
    global failed, total
    total += 1
    if cond:
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


# --- what is a title and what is not
TITLES = [
    "NO.1 H.F.O. TANK (P) - SOUNDING TABLE",
    "No 2 DB TK STBD",
    "FWT 3C (CONT'D)",
    "F.O.T. NO.1 (P) SOUNDING TABLE",
    "HFO SETTLING TANK NO.2 (S)",
    "NO.3 W.B.T. (P)  CAPACITY 523.4 M3",
    "3 P  HFO STOR. TK",
    "DIESEL OIL SERVICE TANK",
    "FRESH WATER TANK 1 PORT - ULLAGE TABLE",
    "SLUDGE TANK",
    "L.O. SUMP TANK",
    "No.1 LUB OIL STORAGE TK (S) - 100% = 12.5 m3",
]
NOT_TITLES = [
    "M/V GANGOS TANK SOUNDING TABLES",
    "Page 12 of 140",
    "SOUNDING   VOLUME",
    "TRIM 1.0 M BY STERN",
    "VESSEL: GANGOS YARD NO 2301",
    "TANK CAPACITY PLAN",
    "0.000   12.345",
]
for t in TITLES:
    check(f"is a title: {t}", n.score_name(t, 0.1) >= 5.0, f"score {n.score_name(t, 0.1)}")
for t in NOT_TITLES:
    check(f"is not a title: {t}", n.score_name(t, 0.1) < 5.0, f"score {n.score_name(t, 0.1)}")

# --- the name that is left
def name(t):
    return n.clean_name(t)[0]

check("strips SOUNDING TABLE", name("NO.1 H.F.O. TANK (P) — SOUNDING TABLE") == "NO.1 H.F.O. TANK (P)")
check("strips (CONT'D)", name("NO.1 H.F.O. STORAGE TANK (P) (CONT'D)") == "NO.1 H.F.O. STORAGE TANK (P)")
check("strips a capacity", name("No.1 LUB OIL STORAGE TK (S) - 100% = 12.5 m3") == "No.1 LUB OIL STORAGE TK (S)")
check("reads the capacity", n.clean_name("NO.3 W.B.T. (P)  CAPACITY 523.4 M3")[1]["capacity"] == 523.4)
check("reads an ullage book", n.clean_name("FRESH WATER TANK 1 PORT - ULLAGE TABLE")[1]["method"] == "ullage")
check("a capacity scrambled by OCR does not stay in the name", name("FWT 3 C CAPAC96I.2T MY3") == "FWT 3 C")
check("notices a continuation", n.clean_name("FWT 3C (CONT'D)")[1]["continued"] is True)

# --- same tank / different tank
SAME = [
    ("NO. 1 HFO STOR. TK (P)", "No.1 H.F.O. Storage Tank Port"),
    ("NO.1 H.F.O. TANK (P) - SOUNDING TABLE", "NO.1 H.F.O. TANK (P) (CONT'D)"),
    ("FWT 3 C", "F.W.T. NO.3 C"),
    ("NO.1 H.F.O. STO RAGE", "NO.1 H.F.O. STORAGE TANK (P)"),   # a title the layout cut up
    (".4 W .B. T. (P)", "NO.4 W.B.T. (P)"),                        # one the scan mangled
    ("DIESEL OIL SERVICE TANK", "D.O. SERV. TK"),
]
DIFFERENT = [
    ("NO.1 H.F.O. TANK (P)", "NO.1 H.F.O. TANK (S)"),
    ("NO.1 H.F.O. TANK (P)", "NO.2 H.F.O. TANK (P)"),
    ("NO.1 H.F.O. STORAGE TANK (P)", "NO.1 M.D.O. STORAGE TANK (P)"),
    ("NO.1 H.F.O. SETTLING TANK (P)", "NO.1 H.F.O. SERVICE TANK (P)"),
]
for a, b in SAME:
    check(f"same tank: {a!r} = {b!r}", n.same_tank(a, b))
for a, b in DIFFERENT:
    check(f"different tanks: {a!r} / {b!r}", not n.same_tank(a, b))

# --- following a tank through pages
tr = n.NameTracker()
p1 = tr.page(1, [{"text": "M/V TEST TANK SOUNDING TABLES"}, {"text": "NO.1 H.F.O. STORAGE TANK (P) - SOUNDING TABLE"}, {"text": "SOUNDING VOLUME"}])
p2 = tr.page(2, [{"text": "NO.1 H.F.O. STORAGE TANK (P) (CONT'D)"}, {"text": "SOUNDING VOLUME"}])
p3 = tr.page(3, [{"text": "Page 3 of 9"}, {"text": "52  36.0"}])
p4 = tr.page(4, [{"text": "NO.2 M.D.O. SERVICE TANK (S)"}, {"text": "SOUNDING VOLUME"}])
check("page with a title names the tank", p1["name"] == "NO.1 H.F.O. STORAGE TANK (P)" and p1["source"] == "title")
check("the vessel's heading is not taken for a tank", "TEST" not in p1["name"])
check("a continued page is the same tank", p2["name"] == p1["name"] and p2["source"] == "continued" and not p2["newTank"])
check("a page with no title carries the tank", p3["name"] == p1["name"] and p3["source"] == "carried")
check("a new title starts a new tank", p4["name"] == "NO.2 M.D.O. SERVICE TANK (S)" and p4["newTank"])

print(f"\n{total - failed}/{total} passed")
sys.exit(1 if failed else 0)
