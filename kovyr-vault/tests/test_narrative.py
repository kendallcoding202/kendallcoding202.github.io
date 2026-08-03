"""Tests for the narrative draft lint.

No model is involved. These pin the three ways a generated paragraph can
be wrong without looking wrong: an invented number, a leaked path, and a
leaked client name.
"""

from kovyr_vault import briefing, narrative
from kovyr_vault.sensitive import Finding, ScanReport


def sample_briefing():
    return briefing.build(
        period="2026-07",
        scan_summary={"files_scanned": 40, "bytes_scanned": 1000,
                      "duplicate_files": 2, "wasted_bytes": 300,
                      "groups": []},
        sensitive_report=ScanReport(
            findings=[Finding("/Users/x/Desktop/a.txt", 3, 0)],
            read=412, skipped=1203))


# ---------- fabricated numbers ----------

def test_rejects_a_number_the_briefing_does_not_support():
    """The failure this exists for: a fluent sentence with a wrong count
    reads exactly like a true one."""
    obj = sample_briefing()          # files_scanned is 40
    problems = narrative.check_draft(
        "We reviewed 45 files during the period.", obj)
    assert any("45" in p for p in problems)


def test_accepts_numbers_that_come_from_the_briefing():
    obj = sample_briefing()
    text = ("We looked inside 412 files and could not read 1,203 of them. "
            "3 unencrypted SSNs were found across 1 file.")
    assert narrative.check_draft(text, obj) == []


def test_thousands_separators_are_read_as_one_number():
    obj = sample_briefing()
    assert narrative.check_draft("1,203 files were skipped.", obj) == []
    # the components of a separated number are not silently permitted
    assert narrative.check_draft("We skipped 203 files.", obj) != []


def test_period_digits_are_permitted():
    obj = sample_briefing()
    assert narrative.check_draft("This covers 2026-07.", obj) == []


def test_booleans_do_not_authorise_zero_and_one():
    """True is an int in Python; letting it through would quietly permit
    the numbers 0 and 1 in any draft."""
    obj = {"canary_alert": True, "vault_present": True}
    assert 1 not in narrative.allowed_numbers(obj)
    assert 0 not in narrative.allowed_numbers(obj)


def test_prose_without_numbers_passes():
    obj = sample_briefing()
    assert narrative.check_draft(
        "Disk encryption is on and the firewall is enabled.", obj) == []


# ---------- leaked paths ----------

def test_rejects_a_leaked_path():
    obj = sample_briefing()
    for text in (r"Sensitive data was found in C:\Clients\Smith_John.",
                 "See /Users/kendall/Desktop/taxes.csv for details.",
                 r"The file \\fileserver\share\payroll.xlsx is exposed."):
        problems = narrative.check_draft(text, obj)
        assert any("path-like" in p for p in problems), text


# ---------- leaked client name ----------

def test_rejects_the_real_client_name():
    obj = sample_briefing()
    problems = narrative.check_draft(
        "Kimball and Roberts should encrypt these files.", obj,
        client_name="Kimball and Roberts")
    assert any("client name" in p for p in problems)


def test_client_name_match_is_case_insensitive():
    obj = sample_briefing()
    problems = narrative.check_draft(
        "kimball AND roberts remains exposed.", obj,
        client_name="Kimball and Roberts")
    assert any("client name" in p for p in problems)


def test_placeholder_is_acceptable():
    obj = sample_briefing()
    assert narrative.check_draft(
        "{{CLIENT}} should encrypt the remaining files.", obj,
        client_name="Kimball and Roberts") == []


# ---------- combined ----------

def test_reports_every_problem_at_once():
    obj = sample_briefing()
    problems = narrative.check_draft(
        r"Acme Dental has 99 files in C:\Clients\Acme.", obj,
        client_name="Acme Dental")
    assert any("99" in p for p in problems)
    assert any("path-like" in p for p in problems)
    assert any("client name" in p for p in problems)


def test_empty_draft_is_not_an_error():
    """Empty means nothing provably wrong — the caller decides whether an
    empty paragraph is acceptable."""
    assert narrative.check_draft("", sample_briefing()) == []
