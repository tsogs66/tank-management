"""Build seed/giorgis tanks.json + vessel.json from FINAL workbook import."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "TANK MANAGEMENT GIORGIS FINAL 1.xlsm"
OUT = ROOT / "seed" / "giorgis"


def main():
    if not WORKBOOK.exists():
        print("Missing workbook:", WORKBOOK, file=sys.stderr)
        sys.exit(1)
    raw = subprocess.check_output(
        [sys.executable, str(ROOT / "scripts" / "import-excel-tanks.py"), str(WORKBOOK)],
        cwd=str(ROOT),
    )
    data = json.loads(raw.decode("utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)

    # Strip importer-only fields from tanks
    tanks = {}
    for cat, arr in (data.get("tanks") or {}).items():
        clean = []
        for t in arr:
            t = dict(t)
            t.pop("setupMatch", None)
            clean.append(t)
        tanks[cat] = clean

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    vessel = {
        "id": "mv-giorgis",
        "name": "MV GIORGIS",
        "imo": "",
        "callSign": "",
        "flag": "Panama",
        "type": "Bulk Carrier",
        "owner": "",
        "notes": "Seeded from TANK MANAGEMENT GIORGIS FINAL 1.xlsm calibration tables.",
        "createdAt": now,
        "updatedAt": now,
    }
    readings = {
        "fuel": [],
        "lube": [],
        "misc": [],
        "water": [],
    }

    (OUT / "vessel.json").write_text(json.dumps(vessel, indent=2), encoding="utf-8")
    (OUT / "tanks.json").write_text(json.dumps(tanks, indent=2), encoding="utf-8")
    (OUT / "readings.json").write_text(json.dumps(readings, indent=2), encoding="utf-8")
    (OUT / "import-meta.json").write_text(
        json.dumps(
            {
                "workbook": WORKBOOK.name,
                "found": data.get("found"),
                "setup": data.get("setup"),
                "counts": {k: len(v) for k, v in tanks.items()},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    total = sum(len(v) for v in tanks.values())
    print(f"Wrote {total} tanks to {OUT} ({ {k: len(v) for k, v in tanks.items()} })")


if __name__ == "__main__":
    main()
