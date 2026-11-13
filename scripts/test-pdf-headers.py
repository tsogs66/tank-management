#!/usr/bin/env python3
"""How column headings, units and signs are read, in the many ways books write them."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_headers as h  # noqa: E402
import pdf_names as n  # noqa: E402

failed = total = 0


def check(name, cond, detail=""):
    global failed, total
    total += 1
    if cond:
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {detail}")


# trim written as a word
for t, v in [("Tr=-4", -4), ("T = -4", -4), ("Trim: -4.0 m", -4), ("TRIM -4", -4), ("Tr=0.5", 0.5)]:
    check(f"trim {t!r} = {v}", h.label_value(t) == (v, "trim"), str(h.label_value(t)))
# heel as a word: port is negative
for t, v in [("H1P", -1), ("H3S", 3), ("H 3 S", 3), ("Heel 3 Starboard", 3), ("Heel 1 Port", -1), ("1P", -1),
             ("1 Port", -1), ("List 2P", -2), ("HEEL 3° STBD", 3), ("H2.5P", -2.5)]:
    check(f"heel {t!r} = {v}", h.label_value(t) == (v, "heel"), str(h.label_value(t)))
check("a tank's side is not a heel column", h.label_value("NO.1 (P)") is None and h.label_value("TK 3P") is None)

# the unit of the sounding, from its own heading or the cell under it
UNITS = [
    ([["SOUNDING", "VOLUME"], ["(cm)", "(m3)"]], "cm", "m3"),
    ([["GAUGE (cm)", "VOLUME (m3)"]], "cm", "m3"),
    ([["ULLAGE", "VOLUME"], ["mm", "m3"]], "mm", "m3"),
    ([["ULLAGE m", "VOLUME m3"]], "m", "m3"),
    ([["Gauge", "Vol."], ["m", "m3"]], "m", "m3"),
    ([["SOUNDING (mm)", "CAPACITY (m3)"]], "mm", "m3"),
    ([["DEPTH (m)", "VOLUME (m3)"]], "m", "m3"),
    ([["Depth in metres"]], "m", None),
    ([["SOUNDING", "CAPACITIES IN CUBIC METERS (M^3)"]], None, "m3"),
    ([["SOUNDING", "TRIM 2.0M 3.0M"]], None, None),     # "3.0M" is not "M3", and the (m) of a trim is not the sounding's
    ([["TRIM (m)", "SOUNDING"]], None, None),
    ([["SOUNDING", "VOLUME"], ["(litres)", ""]], None, "l"),
]
for rows, axis, vol in UNITS:
    u = h.header_units(rows)
    check(f"units {rows}", (u["axis"], u["volume"]) == (axis, vol), str(u))

# a partial fill is not the capacity
for t, cap in [("NO.1 HFO TANK (P) 100% = 523.4 m3", 523.4), ("NO.1 HFO TANK 98% FULL 512.9 m3", 523.367),
               ("NO.1 HFO TANK  Cap. 523.4 m3", 523.4), ("TANK 95 % = 497.2 m3", 523.368)]:
    got = n.clean_name(t)[1]["capacity"]
    check(f"capacity from {t!r}", got is not None and abs(got - cap) < 0.01, str(got))

# headings that give the sign: HEAD / STERN, PORT / STARB'D, with the figures unsigned
rows = [["SOUNDING", "BY THE HEAD", "BY THE STERN"], ["M-CM", "2.0M", "1.0M", "1.0M", "2.0M", "3.0M", "4.0M"]]
out, role = h.sign_grouped_headings(rows)
check("BY THE HEAD 2 1 | BY THE STERN 1 2 3 4 -> 2 1 | -1 -2 -3 -4", role == "trim" and out[1][1:] == ["2", "1", "-1", "-2", "-3", "-4"], str(out))
rows = [["SOUNDING", "LIST TO PORT (DEG)", "LIST TO STARB'D (DEG)"], ["M-CM"] + ["3.0", "2.0", "1.0", "0.5", "0.5", "1.0", "2.0", "3.0"]]
out, role = h.sign_grouped_headings(rows)
check("LIST TO PORT 3 2 1 .5 | STARB'D .5 1 2 3 -> port negative", role == "heel" and out[1][1:] == ["-3", "-2", "-1", "-0.5", "0.5", "1", "2", "3"], str(out))
rows = [["B Y", "T H E", "H E A D", "S T E R N"], ["2.0M", "1.0M", "1.0M", "2.0M", "3.0M"]]
check("a heading with its letters spaced out is still the word", h.sign_grouped_headings(rows)[1] == "trim")
rows = [["HEEL TO PORT (deg.)", "HEEL TO STBD (deg.)"], ["DEPTH", "-4.0", "-3.0", "-2.0", "-1.0", "1.0", "2.0", "3.0", "4.0"]]
check("figures that already carry their sign are left alone", h.sign_grouped_headings(rows)[1] is None)

# figures run together, and a dash
out, n_ = h.split_glued_cells([["250", "363.170", "341.870-135.900-188.400", "4821"]])
check("341.870-135.900-188.400 is three figures", out[0][2:5] == ["341.870", "-135.900", "-188.400"], str(out))
out, _ = h.split_glued_cells([["0", "0-00", "01", "02"]])
check("0-00 (metre-centimetre) is not a minus", out[0] == ["0", "0-00", "01", "02"], str(out))

print(f"\n{total - failed}/{total} passed")
sys.exit(1 if failed else 0)
