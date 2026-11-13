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
        self._pdfium = None
        self._level = 1
        self._mode = None  # "module" | "cli"
        self._cmd = None
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
        if self._pdfium is not None:
            try:
                self._pdfium.close()
            except Exception:
                pass
            self._pdfium = None
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

    def _enhanced(self, pages, name):
        """
        The pages as clean pictures, ready for OCR. A photograph of a printed page (or a copier's
        grey scan) reads far better once its contrast is stretched: on a photo the page-wide OCR
        garbled a whole header row that was perfectly legible after autocontrast. The pages are
        rendered at up to 300 dpi, longest side at most 2800 px, so memory stays flat on a big book.
        Returns the path of a small PDF made of them, or None when the tools are not there.
        """
        try:
            import pypdfium2 as pdfium
            import img2pdf
            from PIL import Image, ImageFilter, ImageOps
        except Exception:
            return None
        try:
            if self._pdfium is None:
                self._pdfium = pdfium.PdfDocument(self.pdf_path)
            paths = []
            dpi = 200
            for p in pages:
                page = self._pdfium[p - 1]
                w, h = page.get_size()
                scale = min(300.0 / 72.0, 2800.0 / max(w, h, 1))
                # Never blow a picture up past its own pixels: stretching a photograph makes the
                # reader see blur where there were digits.
                try:
                    from pypdfium2 import raw as _raw
                    sizes = [o.get_px_size() for o in page.get_objects(filter=[_raw.FPDF_PAGEOBJ_IMAGE])]
                    if len(sizes) == 1:
                        px = max(sizes[0])
                        scale = min(scale, px / max(w, h, 1) * 1.0)
                except Exception:
                    pass
                dpi = max(100, int(round(scale * 72)))
                pil = page.render(scale=scale).to_pil().convert("L")
                pil = self._upright(pil)
                if self._level >= 2:
                    # a photograph of a screen is covered in fine stripes (moire) that the reader takes
                    # for ink; a light blur removes them and leaves the figures
                    pil = pil.filter(ImageFilter.GaussianBlur(1.0))
                pil = ImageOps.autocontrast(pil, cutoff=2)
                path = os.path.join(self.workdir, f"{name}-{p}.png")
                pil.save(path, dpi=(dpi, dpi))
                paths.append(path)
            out = os.path.join(self.workdir, name)
            with open(out, "wb") as fh:
                fh.write(img2pdf.convert(paths, layout_fun=img2pdf.get_fixed_dpi_layout_fun((dpi, dpi))))
            for path in paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            return out
        except Exception:
            return None

    def _legible(self, pil):
        """How much of a picture reads as proper words and figures (a quick look, small picture)."""
        import re
        small = pil.copy()
        small.thumbnail((1600, 1600))
        path = os.path.join(self.workdir, "look.png")
        small.save(path)
        r = subprocess.run(["tesseract", path, "-", "--psm", "6"], capture_output=True, timeout=120)
        txt = (r.stdout or b"").decode("utf-8", "replace")
        return sum(len(t) for t in re.findall(r"[A-Za-z]{3,}|\d+\.\d+|\d{3,}", txt))

    def _upright(self, pil):
        """
        Turn a picture that lies on its side. Tesseract's orientation reading is judged on the raw
        picture (contrast stretching confuses it), and a photo taken sideways scores about 12 where
        ocrmypdf only acts above 14, so this uses a lower bar of its own.
        """
        if not shutil.which("tesseract"):
            return pil
        path = os.path.join(self.workdir, "osd.png")
        try:
            pil.save(path)
            r = subprocess.run(["tesseract", path, "-", "--psm", "0"], capture_output=True, timeout=60)
            txt = (r.stdout or b"").decode("utf-8", "replace")
            rot = conf = None
            for line in txt.splitlines():
                if line.startswith("Rotate:"):
                    rot = int(line.split(":")[1])
                elif line.startswith("Orientation confidence:"):
                    conf = float(line.split(":")[1])
            if rot in (90, 180, 270) and conf is not None:
                if conf >= 8:
                    return pil.rotate(-rot, expand=True)
                if conf >= 1.5:
                    # unsure: let the text decide - whichever way up reads more real words
                    turned = pil.rotate(-rot, expand=True)
                    if self._legible(turned) > 1.3 * self._legible(pil):
                        return turned
        except Exception:
            pass
        return pil

    def _cut(self, pages, name, enhance=False):
        """A small PDF holding just these pages of the book."""
        if enhance:
            enhanced = self._enhanced(pages, name)
            if enhanced:
                return enhanced
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

    def _args(self, src, dst, psm, timeout_s, oversample=True, upright=False):
        cmd = list(self._cmd) + [
            "--force-ocr",
            # a picture already turned upright by _enhanced must not be turned again
            "--deskew",
            "--output-type", "pdf",
            "--optimize", "0",
            "--image-dpi", "200",
            "--tesseract-pagesegmode", str(psm),
            "--tesseract-config", self.cfg,
            "--tesseract-timeout", str(max(30, timeout_s // 2)),
            "--jobs", str(self.cpu),
            "--quiet",
        ]
        if not upright:
            cmd.append("--rotate-pages")
        if oversample:
            # Resampling to 300 dpi helps small print; on a photograph it sometimes blurs digits,
            # which is why a page can also be read with oversample=False.
            cmd += ["--oversample", "300"]
        # No --clean: it needs unpaper, which not every machine has, so the same page
        # would read differently from one computer to the next - and on test scans it
        # lost rows rather than saving them.
        cmd += [src, dst]
        return cmd

    def _run(self, src, dst, psm, pages, oversample=True, upright=False):
        budget = 120 + 60 * len(pages)
        if self.deadline is not None:
            budget = max(30, min(budget, int(self.deadline - time.monotonic())))
        r = subprocess.run(self._args(src, dst, psm, budget, oversample, upright), capture_output=True, timeout=budget)
        if r.returncode != 0 and not os.path.exists(dst):
            raise RuntimeError((r.stderr or b"").decode("utf-8", "replace").strip()[-300:] or f"ocrmypdf exit {r.returncode}")
        return dst

    def _page_image(self, p):
        """Page p as an upright, contrast-stretched (and, at level 2, descreened) grey picture."""
        import pypdfium2 as pdfium
        from PIL import ImageFilter, ImageOps
        if self._pdfium is None:
            self._pdfium = pdfium.PdfDocument(self.pdf_path)
        page = self._pdfium[p - 1]
        w, h = page.get_size()
        scale = min(300.0 / 72.0, 2800.0 / max(w, h, 1))
        try:
            from pypdfium2 import raw as _raw
            sizes = [o.get_px_size() for o in page.get_objects(filter=[_raw.FPDF_PAGEOBJ_IMAGE])]
            if len(sizes) == 1:
                scale = min(scale, max(sizes[0]) / max(w, h, 1))   # never past the picture's own pixels
        except Exception:
            pass
        pil = page.render(scale=scale).to_pil().convert("L")
        pil = self._upright(pil)
        if self._level >= 2:
            # a photograph of a screen is covered in fine stripes (moire) that the reader takes for
            # ink; a light blur removes them and leaves the figures
            pil = pil.filter(ImageFilter.GaussianBlur(1.0))
        return ImageOps.autocontrast(pil, cutoff=2)

    def _read_direct(self, pages, psm, upscale):
        """
        Photographs go straight to tesseract: ocrmypdf re-rasterises the picture and, on a photo,
        read nothing from a page that tesseract itself reads well. One searchable PDF per page.
        """
        from PIL import Image
        got = {}
        for p in pages:
            try:
                pil = self._page_image(p)
                if upscale and max(pil.size) < 2800:
                    k = min(2.0, 2800.0 / max(pil.size))
                    pil = pil.resize((int(pil.width * k), int(pil.height * k)), Image.LANCZOS)
                png = os.path.join(self.workdir, f"d{p}.png")
                pil.save(png, dpi=(200, 200))
                base = os.path.join(self.workdir, f"d{p}-{psm}-{int(bool(upscale))}-{self._level}")
                cmd = ["tesseract", png, base, "--psm", str(psm), "--dpi", "200",
                       "-c", "preserve_interword_spaces=1", "-c", "load_system_dawg=0",
                       "-c", "load_freq_dawg=0", "-c", "tessedit_char_blacklist=|\u00a6_~`", "pdf"]
                budget = 120
                if self.deadline is not None:
                    budget = max(30, min(budget, int(self.deadline - time.monotonic())))
                subprocess.run(cmd, capture_output=True, timeout=budget, check=True)
                got[p] = (base + ".pdf", 0)
                self.pages_done += 1
            except Exception as exc:
                self.failed_pages.append(p)
                self.emit("ocr", None, f"OCR could not read page {p}: {str(exc)[:120]}")
        return got

    def read_pages(self, pages, psm=6, oversample=True, enhance=False):
        # enhance: False, True (contrast) or 2 (contrast + descreen)
        self._level = 2 if enhance == 2 else 1
        if enhance:
            return self._read_direct(list(pages), psm, oversample)
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
                    src = self._cut(batch, f"{tag}-in.pdf", enhance)
                    dst = os.path.join(self.workdir, f"{tag}-out.pdf")
                    self._run(src, dst, psm, batch, oversample, enhance)
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
                    sub = self.read_pages([p], psm, oversample, enhance)
                    got.update(sub)
            self.pages_done += len(batch)
        return got
