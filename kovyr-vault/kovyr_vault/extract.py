"""Pull readable text out of the document formats clients actually use.

The sensitive-data scan used to read only text-decodable files, which in a
dental or legal office is a small minority — patient intake, tax returns
and signed agreements are PDFs and Word documents. Everything else was
honestly reported as "could not be read inside", but that meant the scan
was blind to most of the places an SSN actually lives.

Everything here parses locally. No format is fetched, uploaded, or sent
anywhere, so the zero-egress property is unchanged.

The important distinction this module preserves is between *nothing found*
and *nothing readable*. A scanned intake form is a PDF whose pages are
images: there is no text layer, so an extractor that returned "" would let
the scan record it as read-and-clean. That is a false assurance about the
single most likely place a client's SSNs are sitting. Every failure is
therefore reported with a reason, and the caller counts image-only PDFs
separately so the client can be told to look at them by hand.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

# Caps. These are client documents, not adversarial input, but a corrupt
# or hostile file must not be able to hang or exhaust the scan.
MAX_TEXT = 5 * 1024 * 1024      # stop accumulating text past this
MAX_MEMBER_BYTES = 64 * 1024 * 1024   # skip absurd zip members (zip bombs)
MAX_PDF_PAGES = 300
_BINARY_SNIFF = 4096

# Reasons returned alongside the text.
OK = "ok"
NO_TEXT_LAYER = "no-text-layer"   # a PDF of page images — scanned paper
ENCRYPTED = "encrypted"           # password-protected; we won't guess
UNSUPPORTED = "unsupported"       # legacy binary .doc/.xls, images, etc.
ERROR = "error"                   # unreadable or malformed

OOXML_SUFFIXES = {".docx", ".docm", ".xlsx", ".xlsm", ".pptx", ".pptm"}
PDF_SUFFIXES = {".pdf"}

# Which parts of each package hold user-visible text, and which elements
# inside them. Local names only — OOXML namespaces every tag (w:t, a:t).
_OOXML_PARTS = {
    ".docx": (("word/document.xml", "word/header", "word/footer",
               "word/footnotes.xml", "word/endnotes.xml"), {"t"}),
    ".pptx": (("ppt/slides/slide", "ppt/notesSlides/"), {"t"}),
    # Spreadsheet strings live in the shared table; `v` picks up values
    # typed into cells directly.
    ".xlsx": (("xl/sharedStrings.xml", "xl/worksheets/"), {"t", "v"}),
}
_OOXML_PARTS[".docm"] = _OOXML_PARTS[".docx"]
_OOXML_PARTS[".pptm"] = _OOXML_PARTS[".pptx"]
_OOXML_PARTS[".xlsm"] = _OOXML_PARTS[".xlsx"]


def _local(tag: str) -> str:
    """Strip the {namespace} an OOXML parser prepends to every tag."""
    return tag.rsplit("}", 1)[-1]


def _ooxml_text(path: Path, suffix: str) -> tuple[str | None, str]:
    prefixes, wanted = _OOXML_PARTS[suffix]
    chunks: list[str] = []
    size = 0
    try:
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                if not info.filename.startswith(prefixes):
                    continue
                if info.file_size > MAX_MEMBER_BYTES:
                    continue
                try:
                    raw = zf.read(info)
                except (KeyError, OSError, zipfile.BadZipFile,
                        RuntimeError, NotImplementedError):
                    continue
                try:
                    root = ElementTree.fromstring(raw)
                except ElementTree.ParseError:
                    continue
                for el in root.iter():
                    if _local(el.tag) in wanted and el.text:
                        chunks.append(el.text)
                        size += len(el.text)
                        if size >= MAX_TEXT:
                            break
                if size >= MAX_TEXT:
                    break
    except (zipfile.BadZipFile, OSError, RuntimeError):
        return None, ERROR
    if not chunks:
        return None, NO_TEXT_LAYER
    # Newline-joined on purpose: concatenating adjacent cells or runs could
    # fuse two harmless numbers into one string that looks like a card.
    return "\n".join(chunks), OK


def _pdf_text(path: Path) -> tuple[str | None, str]:
    try:
        from pypdf import PdfReader
    except ImportError:
        return None, UNSUPPORTED
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            # An empty-password PDF is common and safe to open; anything
            # else we leave alone rather than attempting to break.
            try:
                if not reader.decrypt(""):
                    return None, ENCRYPTED
            except Exception:            # noqa: BLE001
                return None, ENCRYPTED
        chunks: list[str] = []
        size = 0
        for page in reader.pages[:MAX_PDF_PAGES]:
            try:
                text = page.extract_text() or ""
            except Exception:            # noqa: BLE001 — one bad page
                continue                 # shouldn't lose the whole document
            if text:
                chunks.append(text)
                size += len(text)
                if size >= MAX_TEXT:
                    break
    except Exception:                    # noqa: BLE001 — malformed PDF
        return None, ERROR
    if not any(c.strip() for c in chunks):
        # Pages exist but carry no text: a scan of paper. Emphatically not
        # the same as "we read it and it was clean".
        return None, NO_TEXT_LAYER
    return "\n".join(chunks), OK


def _plain_text(path: Path) -> tuple[str | None, str]:
    try:
        with path.open("rb") as fh:
            data = fh.read(MAX_TEXT)
    except OSError:
        return None, ERROR
    if b"\x00" in data[:_BINARY_SNIFF]:
        return None, UNSUPPORTED        # binary: image, archive, database
    for encoding in ("utf-8", "latin-1"):
        try:
            return data.decode(encoding), OK
        except UnicodeDecodeError:
            continue
    return None, UNSUPPORTED


def extract(path) -> tuple[str | None, str]:
    """Return (text, reason) for a file.

    text is None whenever we could not look inside, and `reason` says why:
    NO_TEXT_LAYER (a scan of paper), ENCRYPTED, UNSUPPORTED or ERROR. A
    caller must never treat None as "clean".
    """
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in OOXML_SUFFIXES:
        return _ooxml_text(path, suffix)
    if suffix in PDF_SUFFIXES:
        return _pdf_text(path)
    return _plain_text(path)


def text_from(path) -> str | None:
    """Just the text, for callers that don't need the reason."""
    return extract(path)[0]
