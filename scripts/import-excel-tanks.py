#!/usr/bin/env python3
"""Parse Tank1..Tank4 calibration sheets from the CAPTAIN VENIAMIS workbook -> JSON."""
from __future__ import annotations
import json, sys, re
from openpyxl import load_workbook

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def read_number_row(ws, r, start_c, max_c=40):
    vals = []
    c = start_c
    while c <= max_c:
        v = ws.cell(r, c).value
        if not is_num(v):
            break
        vals.append(v)
        c += 1
    return vals

def guess_meta(name: str):
    n = name.upper()
    fuel_role = 'other'
    if re.search(r'SETT', n): fuel_role = 'settling'
    elif re.search(r'SERVICE', n): fuel_role = 'service'
    elif re.search(r'OVERFLOW', n): fuel_role = 'overflow'
    elif re.search(r'STORAGE|STOR\.|H\.?F\.?O\.?\s*TANK|MDO|MGO|NO\.\d', n): fuel_role = 'storage'

    side = 'center'
    if re.search(r'\(P\)|\.P\b|PORT|TK\.P', n): side = 'port'
    elif re.search(r'\(S\)|\.S\b|STBD|STARBOARD|TK\.S', n): side = 'starboard'

    tank_no = None
    m = re.search(r'NO\.?\s*(\d+)', n) or re.search(r'\((\d+)\)', n)
    if m: tank_no = int(m.group(1))

    fuel_grade = 'other'
    if re.search(r'LS\s*H\.?F\.?O|VLSFO|LSFO', n): fuel_grade = 'lsfo'
    elif re.search(r'H\.?F\.?O', n): fuel_grade = 'hfo'
    elif 'MDO' in n: fuel_grade = 'mdo'
    elif 'MGO' in n: fuel_grade = 'mgo'
    return dict(fuelRole=fuel_role, side=side, tankNo=tank_no, fuelGrade=fuel_grade)

def parse_correction(ws, title_row):
    name = str(ws.cell(title_row, 1).value or '').strip()
    header = title_row + 3
    trim_vals = read_number_row(ws, header, 2)
    if len(trim_vals) < 3:
        return None
    list_start = None
    for c in range(2 + len(trim_vals), 45):
        if is_num(ws.cell(header, c).value):
            list_start = c
            break
    list_vals = read_number_row(ws, header, list_start) if list_start else []

    trim_axis, trim_grid = [], []
    list_axis, list_grid = [], []
    vol_map = {}  # x -> v
    r = header + 1
    while True:
        sounding = ws.cell(r, 1).value
        if not is_num(sounding):
            break
        trim_axis.append(sounding)
        trim_grid.append([ws.cell(r, 2 + i).value if is_num(ws.cell(r, 2 + i).value) else 0 for i in range(len(trim_vals))])
        if list_start and list_vals:
            la = ws.cell(r, list_start - 1).value
            if is_num(la):
                list_axis.append(la)
                list_grid.append([ws.cell(r, list_start + i).value if is_num(ws.cell(r, list_start + i).value) else 0 for i in range(len(list_vals))])
        r += 1
        if r > header + 5000:
            break

    # volume curve L/M
    for rr in range(header + 1, header + 5000):
        vx, vv = ws.cell(rr, 12).value, ws.cell(rr, 13).value
        if is_num(vx) and is_num(vv):
            vol_map[vx] = vv
        elif rr > header + max(len(trim_axis), 50) and not is_num(vx) and not is_num(vv):
            # allow sparse continuation
            if rr > header + len(trim_axis) + 200 and not vol_map:
                break
            if rr > header + max(len(vol_map), len(trim_axis)) + 50:
                break

    if not trim_axis:
        return None
    xs = sorted(vol_map)
    vs = [vol_map[x] for x in xs]
    capacity = max(vs) if vs else 0
    meta = guess_meta(name)

    def detect_inc(axis):
        if len(axis) < 2:
            return 1
        diffs = [round(abs(axis[i] - axis[i - 1]) * 1000) / 1000 for i in range(1, len(axis)) if axis[i] != axis[i - 1]]
        if not diffs:
            return 1
        from collections import Counter
        best = Counter(diffs).most_common(1)[0][0]
        for p in (1, 2, 5, 10, 20, 25, 50):
            if abs(best - p) < 1e-6:
                return p
        return best

    return {
        'name': name,
        'category': 'fuel',
        'calcType': 'correction',
        'correctionDivisor': 10,
        'soundingMethod': 'ullage',
        'soundingIncrement': detect_inc(trim_axis),
        'heelIncrement': detect_inc(list_axis) if list_axis else detect_inc(trim_axis),
        'trimAxis': trim_axis,
        'trimVals': trim_vals,
        'trimGrid': trim_grid,
        'listAxis': list_axis,
        'listVals': list_vals,
        'listGrid': list_grid,
        'volumeCurve': {'x': xs, 'v': vs},
        'capacity': capacity,
        **meta,
    }

def is_axis_header(v):
    if not isinstance(v, str):
        return False
    s = re.sub(r'\s+', ' ', v.strip().lower())
    return s in ('depth', 'gauge', 'gauge ull', 'gauge ullage', 'ullage', 'sounding')

def parse_direct(ws, title_row):
    raw = str(ws.cell(title_row, 1).value or '').strip()
    name = re.sub(r'\s*-\s*Volume in m3\s*$', '', raw, flags=re.I).strip()
    header = title_row + 1
    depth = ws.cell(header, 1).value
    if not is_axis_header(depth):
        return None
    trim_vals = read_number_row(ws, header, 2)
    if len(trim_vals) < 2:
        return None

    heel_depth_col = heel_start = None
    for c in range(2 + len(trim_vals), 45):
        v = ws.cell(header, c).value
        if is_axis_header(v) or (isinstance(v, str) and v.strip().lower() == 'ullage'):
            # heel/list table may start at next numeric col (Ullage label then Depth then values)
            heel_depth_col = c
            for cc in range(c, c + 20):
                if is_num(ws.cell(header, cc).value):
                    heel_start = cc
                    # if label itself wasn't depth axis, axis values are in column c when numeric rows use col c
                    if not is_num(ws.cell(header + 1, c).value):
                        heel_depth_col = cc - 1 if cc > c else c
                    break
            break
    # Tank2 style: "Ullage" then "Depth" then heel headers
    if heel_start is None:
        for c in range(2 + len(trim_vals), 45):
            v = ws.cell(header, c).value
            if isinstance(v, str) and 'ullage' in v.strip().lower():
                for cc in range(c + 1, c + 15):
                    if is_axis_header(ws.cell(header, cc).value):
                        heel_depth_col = cc
                    if is_num(ws.cell(header, cc).value):
                        heel_start = cc
                        if heel_depth_col is None:
                            heel_depth_col = cc - 1
                        break
                break
    list_vals = read_number_row(ws, header, heel_start) if heel_start else []

    trim_axis, trim_grid = [], []
    list_axis, list_grid = [], []
    r = header + 1
    while True:
        d = ws.cell(r, 1).value
        if not is_num(d):
            break
        trim_axis.append(d)
        trim_grid.append([ws.cell(r, 2 + i).value if is_num(ws.cell(r, 2 + i).value) else 0 for i in range(len(trim_vals))])
        if heel_depth_col and heel_start and list_vals:
            la = ws.cell(r, heel_depth_col).value
            if is_num(la):
                list_axis.append(la)
                list_grid.append([ws.cell(r, heel_start + i).value if is_num(ws.cell(r, heel_start + i).value) else 0 for i in range(len(list_vals))])
        r += 1
        if r > header + 5000:
            break
    if not trim_axis:
        return None

    nu = name.upper()
    if re.search(r'L\.?O\.|LUBE|CYL', nu): category = 'lube'
    elif re.search(r'F\.?W\.|WATER|DISTILLED|DRINKING', nu): category = 'water'
    elif re.search(r'BILGE|SLUDGE|SEWAGE|DRAIN|STERN', nu): category = 'misc'
    else: category = 'fuel'

    capacity = max(max(row) for row in trim_grid) if trim_grid else 0
    return {
        'name': name,
        'category': category,
        'calcType': 'direct',
        'correctionDivisor': 1,
        'soundingMethod': 'sounding',
        'trimAxis': trim_axis,
        'trimVals': trim_vals,
        'trimGrid': trim_grid,
        'listAxis': list_axis,
        'listVals': list_vals,
        'listGrid': list_grid,
        'volumeCurve': {'x': [], 'v': []},
        'capacity': capacity,
        **guess_meta(name),
    }

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm'
    wb = load_workbook(path, data_only=False, keep_vba=False)
    tanks = {'fuel': [], 'lube': [], 'misc': [], 'water': []}
    found = []

    for sheet_name in wb.sheetnames:
        if not re.match(r'Tank\d+', sheet_name, re.I):
            continue
        ws = wb[sheet_name]
        # limit scan using max_row but Tank1 is huge — scan col A only
        max_r = min(ws.max_row or 0, 12000)
        for r in range(1, max_r + 1):
            a = ws.cell(r, 1).value
            if not isinstance(a, str):
                continue
            s = a.strip()
            if not s or s == '`' or re.match(r'(?i)sounding|depth$', s):
                continue
            tank = None
            next_a = ws.cell(r + 1, 1).value
            if is_axis_header(next_a):
                tank = parse_direct(ws, r)
            elif re.search(r'TANK|TK\.|H\.?F\.?O|MDO|MGO|WATER|BILGE|SLUDGE|SEWAGE|DRAIN|STERN', s, re.I):
                # Prefer direct when row+1 looks like a gauge header row with numeric trim vals
                if is_num(ws.cell(r + 1, 2).value) and isinstance(next_a, str):
                    tank = parse_direct(ws, r)
                if not tank:
                    hdr = read_number_row(ws, r + 3, 2)
                    if len(hdr) >= 3:
                        tank = parse_correction(ws, r)
            if not tank:
                continue
            cat = tank['category']
            if any(t['name'] == tank['name'] for t in tanks[cat]):
                continue
            tank['id'] = f"{cat}{len(tanks[cat]) + 1}"
            tanks[cat].append(tank)
            found.append({'sheet': sheet_name, 'row': r, 'name': tank['name'], 'calcType': tank['calcType'], 'rows': len(tank['trimAxis'])})

    # Setup pipe / capacity overlay
    setup = []
    if 'Setup' in wb.sheetnames:
        ws = wb['Setup']
        for r in range(2, 31):
            name = ws.cell(r, 1).value
            if not isinstance(name, str) or not name.strip():
                continue
            setup.append({
                'name': name.strip(),
                'pipeHeight': ws.cell(r, 3).value if is_num(ws.cell(r, 3).value) else ws.cell(r, 2).value,
                'capacity100': ws.cell(r, 9).value,
            })
        def norm(s): return re.sub(r'[^A-Z0-9]', '', str(s).upper())
        for cat, arr in tanks.items():
            for t in arr:
                hit = next((s for s in setup if norm(s['name']) == norm(t['name']) or norm(t['name']) in norm(s['name']) or norm(s['name']) in norm(t['name'])), None)
                if not hit:
                    continue
                if is_num(hit.get('pipeHeight')):
                    t['pipeHeight'] = hit['pipeHeight']
                # keep calibration-derived capacity unless setup is present and tank has no volume curve
                if is_num(hit.get('capacity100')) and (not t.get('capacity') or t.get('calcType') == 'direct'):
                    t['capacity'] = hit['capacity100']

    json.dump({'tanks': tanks, 'found': found, 'setup': setup}, sys.stdout)

if __name__ == '__main__':
    main()
