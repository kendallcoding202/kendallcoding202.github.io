"""Local sensitive-data discovery.

Scans files for high-risk personal data — U.S. Social Security numbers and
payment-card numbers — so a client can see what sensitive data is sitting
UNENCRYPTED outside the vault, and move it in before an attacker finds it.

Strictly local and privacy-preserving:
  * Files are read and matched entirely on the machine. Nothing is
    transmitted (Kovyr Vault has no network egress of client data).
  * The actual values found are NEVER stored or reported — only counts,
    types, and file paths. The report can't leak the very data it flags.

Scope: text-decodable files (txt, csv, logs, json, html, source), plus
Word, Excel, PowerPoint and PDF via `extract`. Legacy binary formats
(.doc/.xls/.ppt), images, and PDFs that are scans of paper carry no
readable text and are reported as unread — a stated limitation, never a
silent gap. Scanned PDFs are counted separately because a dental or legal
office keeps its intake forms exactly there, and "we could not read it"
must never be mistaken for "we read it and it was clean".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import extract as extract_mod

# SSN with dashes only — high precision. Bare 9-digit runs are too
# false-positive-prone to flag responsibly.
_SSN_RE = re.compile(r"(?<!\d)(\d{3})-(\d{2})-(\d{4})(?!\d)")
# 13–19 digits, optionally separated by single spaces or dashes, not butting
# up against another digit. Luhn then removes almost all false positives.
_CARD_RE = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")

MAX_BYTES = 5 * 1024 * 1024  # read at most 5 MB per file
_BINARY_SNIFF = 4096


def luhn_valid(digits: str) -> bool:
    if not digits.isdigit() or not (13 <= len(digits) <= 19):
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _valid_ssn(area: str, group: str, serial: str) -> bool:
    a = int(area)
    if a == 0 or a == 666 or a >= 900:  # never-issued ranges
        return False
    return int(group) != 0 and int(serial) != 0


def count_ssns(text: str) -> int:
    return sum(1 for m in _SSN_RE.finditer(text)
               if _valid_ssn(m.group(1), m.group(2), m.group(3)))


def count_cards(text: str) -> int:
    count = 0
    for m in _CARD_RE.finditer(text):
        digits = m.group().replace(" ", "").replace("-", "")
        if luhn_valid(digits):
            count += 1
    return count


@dataclass
class Finding:
    path: str
    ssn: int
    card: int

    @property
    def total(self) -> int:
        return self.ssn + self.card

    def as_dict(self) -> dict:
        return {"path": self.path, "ssn": self.ssn, "card": self.card,
                "total": self.total}


def _read_text(path: Path) -> str | None:
    """Text to search, or None when we could not look inside. Kept for
    callers that don't need to know why."""
    return extract_mod.extract(path)[0]


def _scan_one(path: Path) -> tuple[bool, "Finding | None", str]:
    """(readable, finding, reason). `readable` is False when we could not
    look inside the file at all — a legacy binary format, an image, an
    encrypted or scanned PDF — which is NOT the same as 'we looked and it
    was clean'. `reason` is an extract.* constant."""
    text, reason = extract_mod.extract(Path(path))
    if text is None:
        return False, None, reason
    ssn, card = count_ssns(text), count_cards(text)
    if ssn or card:
        return True, Finding(str(path), ssn, card), reason
    return True, None, reason


def scan_file(path: Path) -> Finding | None:
    """Return a Finding if the file contains SSNs or card numbers, else None.
    Never includes the matched values — only counts."""
    return _scan_one(path)[1]


@dataclass
class ScanReport:
    """Findings plus how much of the estate we could actually look inside.
    `skipped` is the honest counterpart to `findings`: a clean result over
    400 readable files means much less when 1,200 were unreadable."""
    findings: list[Finding] = field(default_factory=list)
    read: int = 0        # files we could decode and search
    skipped: int = 0     # files we could not look inside at all
    # Of the skipped, those that are PDFs with no text layer — i.e. scans
    # of paper. Called out separately because they are both the likeliest
    # place a client's SSNs are sitting and the one category a person can
    # go and check by eye.
    image_pdfs: int = 0

    @property
    def total(self) -> int:
        return self.read + self.skipped


def scan_paths(paths, on_progress=None, exclude=None) -> ScanReport:
    """Scan every regular file under the given paths. `exclude` is an
    optional set of directory Paths to skip (e.g. the vault itself).
    Returns a ScanReport carrying both the findings and the coverage."""
    exclude = {Path(e).resolve() for e in (exclude or [])}
    files: list[Path] = []
    for root in paths:
        root = Path(root)
        if root.is_file():
            files.append(root)
        else:
            files.extend(p for p in root.rglob("*") if p.is_file())
    report = ScanReport()
    total = len(files)
    for i, path in enumerate(files, 1):
        try:
            if any(anc in exclude for anc in path.resolve().parents):
                continue
        except OSError:
            pass
        readable, finding, reason = _scan_one(path)
        if readable:
            report.read += 1
        else:
            report.skipped += 1
            if (reason == extract_mod.NO_TEXT_LAYER
                    and path.suffix.lower() in extract_mod.PDF_SUFFIXES):
                report.image_pdfs += 1
        if finding:
            report.findings.append(finding)
        if on_progress:
            on_progress(i, total)
    report.findings.sort(key=lambda f: f.total, reverse=True)
    return report


def summarize(report: "ScanReport | list[Finding]") -> dict:
    """Accepts a ScanReport (preferred) or a bare findings list."""
    if isinstance(report, ScanReport):
        findings, read, skipped = report.findings, report.read, report.skipped
        image_pdfs = report.image_pdfs
    else:
        findings, read, skipped, image_pdfs = list(report), 0, 0, 0
    return {
        "files": len(findings),
        "ssns": sum(f.ssn for f in findings),
        "cards": sum(f.card for f in findings),
        "read": read,
        "skipped": skipped,
        "image_pdfs": image_pdfs,
    }


def coverage_note(read: int, skipped: int, image_pdfs: int = 0) -> str:
    """One plain sentence stating what was and wasn't examined.

    Scanned PDFs get their own clause: they are the likeliest hiding place
    for the data being hunted, and unlike an image or a database they are
    something the client can go and check by eye.
    """
    base = f"Looked inside {read:,} file{'' if read == 1 else 's'}"
    if not skipped:
        return base + "."
    note = (f"{base}; {skipped:,} could not be read inside "
            "(scanned PDFs, images, legacy .doc/.xls files and other "
            "non-text formats). Sensitive data in those would not be "
            "found.")
    if image_pdfs:
        one = image_pdfs == 1
        note += (f" {image_pdfs:,} of them "
                 f"{'is a PDF that is' if one else 'are PDFs that are'}"
                 " a scan of paper with no text to search — worth checking "
                 "by hand, since intake and signature forms usually live "
                 "there.")
    return note
