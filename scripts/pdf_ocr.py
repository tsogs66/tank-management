"""
OCR for scanned calibration books, a few pages at a time.

A sounding book scanned on a ship's copier is a few hundred pages and can be
300 MB. Running OCR over the whole file at once means holding the lot, waiting
an hour for the first answer, and losing everything when one page defeats the
reader. This works the other way round:

  - only pages with no text layer are sent to OCR (a page the PDF already has
    text for is read as it is);
  - they go in small batches, cut out of the book with pikepdf, so memory stays
    flat however big the file is;
  - each batch is OCR'd with settings made for tables (columns kept apart,
    no dictionary guessing digits into words, ruled lines not read as letters);
  - a batch that fails is retried page by page, so one bad page costs one page;
  - a page that gives no table is read again with a different layout mode.

The result of a batch is a small PDF whose pages carry a text layer, which the
caller reads with pdfplumber exactly as it reads an ordinary PDF.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time

try:  # pikepdf comes with ocrmypdf
    import pikepdf
except Exception:  # pragma: no cover - environment dependent
    pikepdf = None

# Tesseract settings for a page of figures: keep the gaps between columns,
# do not try to turn digits into dictionary words, never read a ruled line as
# a letter.
TESSERACT_CONFIG = """\
preserve_interword_spaces 1
load_system_dawg 0
load_freq_dawg 0
tessedit_char_blacklist |¦_~`
"""

# Page segmentation modes, in the order they are tried for a page that gave
# no table: 6 = one uniform block (best for a ruled table), 4 = a single
# column of variable-size text, 11 = sparse text anywhere.
PSM_ORDER = (6, 4, 11)


def _extend_path_for_windows():
    if os.name != "nt":
        return
    extra = [
        r"C:\Program Files\Tesseract-OCR",
        r"C:\Program Files (x86)\Tesseract-OCR",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR"),
        os.path.expandvars(r"%APPDATA%\Python\Python311\Scripts"),
        os.path.expandvars(r"%APPDATA%\Python\Python312\Scripts"),
        os.path.expandvars(r"%APPDATA%\Python\Python313\Scripts"),
    ]
    os.environ["PATH"] = os.pathsep.join([p for p in extra if p] + [os.environ.get("PATH", "")])


class OcrUnavailable(Exception):
    pass


class OcrEngine:
    def __init__(self, pdf_path, emit=None, deadline=None, batch_pages=8):
        self.pdf_path = pdf_path
        self.emit = emit or (lambda *a, **k: None)
        self.deadline = deadline  # monotonic seconds, or None
        self.batch_pages = max(1, int(batch_pages))
        self.workdir = tempfile.mkdtemp(prefix="tms-ocr-")
        self.cfg = os.path.join(self.workdir, "tess.cfg")
        with open(self.cfg, "w", encoding="utf-8") as fh:
            fh.write(TESSERACT_CONFIG)
        self.cpu = max(1, min(8, os.cpu_count() or 1))
        self.failed_pages = []
        self.pages_done = 0
        self._src = None
        self._mode = None  # "module" | "cli"
        self._cmd = None
        self._has_unpaper = bool(shutil.which("unpaper"))
        self._probe()

    # ---------------------------------------------------------------- setup

    def _probe(self):
        _extend_path_for_windows()
        try:
            subprocess.run([sys.executable, "-m", "ocrmypdf", "--version"],
                           check=True, capture_output=True, timeout=60)
            self._mode = "module"
            self._cmd = [sys.executable, "-m", "ocrmypdf"]
            return
        except Exception:
            pass
        exe = shutil.which("ocrmypdf")
        if exe:
            self._mode = "cli"
            self._cmd = [exe]
            return
        if shutil.which("tesseract"):
            raise OcrUnavailable(
                "tesseract found but ocrmypdf is missing. "
                f'Run: "{sys.executable}" -m pip install ocrmypdf'
            )
        raise OcrUnavailable(
            "This PDF is scanned (no text layer) and no OCR is installed. "
            "Install ocrmypdf + tesseract, or OCR the file first. "
            f"(Python: {sys.executable})"
        )

    def close(self):
        if self._src is not None:
            try:
                self._src.close()
            except Exception:
                pass
            self._src = None
        shutil.rmtree(self.workdir, ignore_errors=True)

    # ---------------------------------------------------------------- batches

    def out_of_time(self):
        return self.deadline is not None and time.monotonic() > self.deadline

    def _cut(self, pages, name):
        """A small PDF holding just these pages of the book."""
        out = os.path.join(self.workdir, name)
        if pikepdf is None:
            return None
        if self._src is None:
            self._src = pikepdf.open(self.pdf_path)
        dst = pikepdf.new()
        for p in pages:
            dst.pages.append(self._src.pages[p - 1])
        dst.save(out)
        dst.close()
        return out

    def _args(self, src, dst, psm, timeout_s):
        cmd = list(self._cmd) + [
            "--force-ocr",
            "--rotate-pages",
            "--deskew",
            "--output-type", "pdf",
            "--optimize", "0",
            "--oversample", "300",
            "--image-dpi", "200",
            "--tesseract-pagesegmode", str(psm),
            "--tesseract-config", self.cfg,
            "--tesseract-timeout", str(max(30, timeout_s // 2)),
            "--jobs", str(self.cpu),
            "--quiet",
        ]
        if self._has_unpaper:
            cmd.append("--clean")
        cmd += [src, dst]
        return cmd

    def _run(self, src, dst, psm, pages):
        budget = 120 + 60 * len(pages)
        if self.deadline is not None:
            budget = max(30, min(budget, int(self.deadline - time.monotonic())))
        r = subprocess.run(self._args(src, dst, psm, budget), capture_output=True, timeout=budget)
        if r.returncode != 0 and not os.path.exists(dst):
            raise RuntimeError((r.stderr or b"").decode("utf-8", "replace").strip()[-300:] or f"ocrmypdf exit {r.returncode}")
        return dst

    def read_pages(self, pages, psm=6):
        """
        OCR these 1-based pages of the book.
        Returns {page_no: (pdf_path, index_in_that_pdf)}; a page that could not
        be read is missing from the result and listed in `failed_pages`.
        """
        pages = list(pages)
        got = {}
        if not pages:
            return got
        for start in range(0, len(pages), self.batch_pages):
            batch = pages[start:start + self.batch_pages]
            if self.out_of_time():
                self.failed_pages.extend(batch)
                continue
            tag = f"b{int(time.time() * 1000) % 10**9}-{batch[0]}"
            try:
                if pikepdf is not None:
                    src = self._cut(batch, f"{tag}-in.pdf")
                    dst = os.path.join(self.workdir, f"{tag}-out.pdf")
                    self._run(src, dst, psm, batch)
                    for i, p in enumerate(batch):
                        got[p] = (dst, i)
                else:
                    # No way to cut pages out: OCR them in place, page by page.
                    dst = os.path.join(self.workdir, f"{tag}-out.pdf")
                    cmd = self._args(self.pdf_path, dst, psm, batch)
                    cmd[-2:-2] = ["--pages", ",".join(str(p) for p in batch)]
                    subprocess.run(cmd, capture_output=True, timeout=120 + 60 * len(batch), check=True)
                    for p in batch:
                        got[p] = (dst, p - 1)
            except Exception as exc:
                # One bad page must not cost its neighbours: go page by page.
                if len(batch) == 1:
                    self.failed_pages.append(batch[0])
                    self.emit("ocr", None, f"OCR could not read page {batch[0]}: {str(exc)[:120]}")
                    continue
                for p in batch:
                    sub = self.read_pages([p], psm)
                    got.update(sub)
            self.pages_done += len(batch)
        return got
