#!/usr/bin/env python3
"""
Exterior (lightweight) inspection of sounding-table PDFs or a folder of PDFs.

Does NOT dump full calibration matrices — reports pages, text vs scanned,
tank-title hints, and layout-family clues so OCR/import can be tuned.

Usage:
  python3 scripts/inspect-pdf-sounding.py path/to/file.pdf
  python3 scripts/inspect-pdf-sounding.py path/to/folder
  python3 scripts/inspect-pdf-sounding.py "C:/Users/.../GIORGIS" --ocr-probe
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed"}))
    sys.exit(1)

# Reuse heuristics from the importer when available
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "ipt", ROOT / "scripts" / "import-pdf-tables.py"
    )
    ipt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ipt)
except Exception:
    ipt = None


LAYOUT_CLUES = [
    ("trimGrid", re.compile(r"\bSOUNDING\b.+\b(?:TRIM|-?\d+\.\d+)\b|\bDEPTH\b.+\b-?\d+\.\d+", re.I | re.S)),
    ("sectionedTrim", re.compile(r"\bEVEN\s*KEEL\b|\bTRIM\b.+\bBY\s+(?:STERN|HEAD|AFT|FWD)\b", re.I)),
    ("soundingVolume", re.compile(r"\bSOUNDING\b.+\b(?:VOLUME|CAPACITY|CAP\.)\b|\bULLAGE\b.+\bVOLUME\b", re.I | re.S)),
    ("ullage", re.compile(r"\bULLAGE\b", re.I)),
    ("hydrostatic", re.compile(r"\bL\.?\s*C\.?\s*G\.?\b.+\bT\.?\s*C\.?\s*G\.?\b|\bIMOM\b", re.I | re.S)),
    ("heelList", re.compile(r"\bHEEL\b|\bLIST\b|\bANGLE\s+OF\s+HEEL\b", re.I)),
]


def clue_layouts(text: str):
    hits = []
    for name, rx in LAYOUT_CLUES:
        if text and rx.search(text):
            hits.append(name)
    return hits


def inspect_one(pdf_path: Path, max_pages: int = 4, ocr_probe: bool = False):
    info = {
        "file": str(pdf_path),
        "name": pdf_path.name,
        "sizeBytes": pdf_path.stat().st_size if pdf_path.exists() else 0,
        "pages": 0,
        "likelyScanned": False,
        "wordsSampled": 0,
        "tankHints": [],
        "layoutHints": [],
        "pageSummaries": [],
        "warnings": [],
    }
    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            info["pages"] = len(pdf.pages)
            sample_n = min(max_pages, len(pdf.pages))
            all_text = []
            total_words = 0
            for i in range(sample_n):
                page = pdf.pages[i]
                try:
                    text = page.extract_text() or ""
                except Exception:
                    text = ""
                words = len(re.findall(r"\w+", text))
                total_words += words
                all_text.append(text)
                tank = ""
                if ipt:
                    tank = ipt.guess_tank_from_text(text) or ""
                else:
                    m = re.search(r".{0,40}TANK.{0,20}", text, re.I)
                    tank = (m.group(0).strip() if m else "")[:80]
                layouts = clue_layouts(text)
                info["pageSummaries"].append({
                    "page": i + 1,
                    "words": words,
                    "tankHint": tank,
                    "layoutHints": layouts,
                    "preview": " | ".join(
                        ln.strip() for ln in text.splitlines() if ln.strip()
                    )[:180],
                })
                if tank and tank not in info["tankHints"]:
                    info["tankHints"].append(tank)
                for L in layouts:
                    if L not in info["layoutHints"]:
                        info["layoutHints"].append(L)
            info["wordsSampled"] = total_words
            # Heuristic: few words across first pages → scanned / image PDF
            info["likelyScanned"] = (sample_n > 0 and total_words / sample_n < 12)
            if info["likelyScanned"]:
                info["warnings"].append(
                    "Little extractable text — treat as scanned; use --ocr on import"
                )
    except Exception as e:
        info["warnings"].append(str(e))
        return info

    if ocr_probe and info["likelyScanned"] and ipt:
        path, used, warn = ipt.maybe_ocr_pdf(str(pdf_path), force=True)
        info["ocrProbe"] = {"ocrUsed": used, "warning": warn}
        if path != str(pdf_path):
            try:
                os.unlink(path)
            except OSError:
                pass

    return info


def collect_pdfs(target: Path):
    if target.is_file() and target.suffix.lower() == ".pdf":
        return [target]
    if target.is_dir():
        return sorted(target.rglob("*.pdf")) + sorted(target.rglob("*.PDF"))
    return []


def main():
    ap = argparse.ArgumentParser(description="Exterior inspect sounding PDFs / folder")
    ap.add_argument("path", help="PDF file or folder (e.g. GIORGIS ship folder)")
    ap.add_argument("--max-pages", type=int, default=4, help="Pages to sample per PDF")
    ap.add_argument("--ocr-probe", action="store_true", help="Try OCR on scanned-looking PDFs")
    args = ap.parse_args()
    target = Path(args.path)
    if not target.exists():
        print(json.dumps({
            "error": f"Path not found: {args.path}",
            "hint": (
                "This cloud environment cannot read Windows desktop paths. "
                "Copy the GIORGIS PDF folder into the repo (e.g. templates/ships/giorgis/) "
                "or upload the files, then re-run."
            ),
            "files": [],
        }, indent=2))
        sys.exit(2)

    pdfs = collect_pdfs(target)
    # de-dupe case on case-insensitive FS
    seen = set()
    uniq = []
    for p in pdfs:
        k = str(p.resolve()).lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)

    out = {
        "path": str(target),
        "pdfCount": len(uniq),
        "files": [
            inspect_one(p, max_pages=args.max_pages, ocr_probe=args.ocr_probe)
            for p in uniq
        ],
    }
    # Folder-level layout summary
    layouts = {}
    for f in out["files"]:
        for L in f.get("layoutHints") or []:
            layouts[L] = layouts.get(L, 0) + 1
    out["layoutSummary"] = layouts
    out["scannedCount"] = sum(1 for f in out["files"] if f.get("likelyScanned"))
    json.dump(out, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
