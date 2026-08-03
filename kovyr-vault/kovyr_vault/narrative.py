"""Lint for a candidate narrative paragraph.

No model runs here. This is the check that would sit between any future
generation step and a human reviewer, and it exists because the two ways
a generated paragraph can be wrong are both silent:

* **Invented numbers.** A fluent sentence claiming 45 files when the
  briefing says 40 reads exactly as well as a true one. Every integer in
  a draft must correspond to a number the briefing actually contains.
* **Leaked identifiers.** A path or a client name reaching a report the
  client hands to an auditor is the failure the briefing boundary exists
  to prevent; checking again here means a leak needs two independent
  mistakes, not one.

`check_draft` returns reasons to reject. Empty means the draft may go to
a human — never that it is correct, only that it is not provably wrong.
"""

from __future__ import annotations

import re

from .briefing import looks_like_path

# Digit runs, tolerating thousands separators so "1,203" is read as 1203
# rather than as 1 and 203.
_NUMBER_RE = re.compile(r"\d[\d,]*")


def numbers_in(text: str) -> list[int]:
    """Every integer a reader would see in this text."""
    out: list[int] = []
    for raw in _NUMBER_RE.findall(text or ""):
        try:
            out.append(int(raw.replace(",", "")))
        except ValueError:
            continue
    return out


def allowed_numbers(briefing: dict) -> set[int]:
    """Every integer the briefing supports.

    Includes digit runs found inside string values, so a period like
    "2026-07" legitimises writing 2026 and 7. Booleans are excluded:
    True is an int in Python, and letting it through would silently
    authorise the numbers 0 and 1 everywhere.
    """
    found: set[int] = set()

    def walk(value) -> None:
        if isinstance(value, bool):
            return
        if isinstance(value, int):
            found.add(value)
        elif isinstance(value, float):
            if value.is_integer():
                found.add(int(value))
        elif isinstance(value, str):
            found.update(numbers_in(value))
        elif isinstance(value, dict):
            for key, item in value.items():
                if isinstance(key, str):
                    found.update(numbers_in(key))
                walk(item)
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                walk(item)

    walk(briefing or {})
    return found


def check_draft(text: str, briefing: dict,
                client_name: str | None = None) -> list[str]:
    """Problems with a candidate paragraph. Empty means it may proceed to
    human review."""
    problems: list[str] = []
    text = text or ""

    permitted = allowed_numbers(briefing)
    for number in sorted(set(numbers_in(text))):
        if number not in permitted:
            problems.append(
                f"number {number:,} does not appear in the briefing")

    if looks_like_path(text):
        problems.append("draft contains a path-like string")

    needle = (client_name or "").strip()
    if needle and needle.lower() in text.lower():
        problems.append("draft contains the real client name")

    return problems
