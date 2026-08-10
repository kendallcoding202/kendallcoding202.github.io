"""Tests for local sensitive-data discovery (SSN + payment-card)."""

from kovyr_vault import sensitive


# ---------- Luhn ----------

def test_luhn_valid_and_invalid():
    assert sensitive.luhn_valid("4111111111111111")   # test Visa
    assert sensitive.luhn_valid("5500005555555559")   # test Mastercard
    assert not sensitive.luhn_valid("4111111111111112")
    assert not sensitive.luhn_valid("1234")            # too short


# ---------- SSN ----------

def test_ssn_detection_and_validation():
    assert sensitive.count_ssns("client SSN 123-45-6789 on file") == 1
    # invalid ranges are not counted
    assert sensitive.count_ssns("000-12-3456") == 0
    assert sensitive.count_ssns("666-12-3456") == 0
    assert sensitive.count_ssns("900-12-3456") == 0
    assert sensitive.count_ssns("123-00-4567") == 0
    # bare 9-digit runs are deliberately not flagged
    assert sensitive.count_ssns("123456789") == 0


def test_ssn_not_matched_inside_longer_number():
    assert sensitive.count_ssns("9999123-45-6789") == 0


# ---------- cards ----------

def test_card_detection_spaced_and_dashed():
    assert sensitive.count_cards("4111 1111 1111 1111") == 1
    assert sensitive.count_cards("4111-1111-1111-1111") == 1
    assert sensitive.count_cards("pay 4111111111111111 now") == 1


def test_card_rejects_non_luhn():
    assert sensitive.count_cards("1234 5678 9012 3456") == 0


# ---------- file scanning ----------

def test_scan_file_reports_counts_not_values(tmp_path):
    f = tmp_path / "records.csv"
    f.write_text("name,ssn\nAlice,123-45-6789\nBob,234-56-7890\n")
    finding = sensitive.scan_file(f)
    assert finding is not None
    assert finding.ssn == 2
    # the finding must never carry the raw values
    assert "123-45-6789" not in str(finding.as_dict())


def test_scan_file_clean_returns_none(tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("just an ordinary memo, nothing sensitive here")
    assert sensitive.scan_file(f) is None


def test_scan_skips_binary(tmp_path):
    f = tmp_path / "blob.bin"
    f.write_bytes(b"\x00\x01\x02 123-45-6789 \x00")
    assert sensitive.scan_file(f) is None


def test_scan_paths_finds_and_sorts(tmp_path):
    (tmp_path / "a.txt").write_text("123-45-6789")
    (tmp_path / "b.txt").write_text("123-45-6789 and 234-56-7890")
    (tmp_path / "clean.txt").write_text("nothing")
    report = sensitive.scan_paths([tmp_path])
    assert len(report.findings) == 2
    # sorted most-exposed first
    assert report.findings[0].total >= report.findings[1].total
    summary = sensitive.summarize(report)
    assert summary["files"] == 2
    assert summary["ssns"] == 3


def test_scan_paths_excludes_vault(tmp_path):
    data = tmp_path / "data"; data.mkdir()
    vault = tmp_path / "vault"; vault.mkdir()
    (data / "x.txt").write_text("123-45-6789")
    (vault / "blob.txt").write_text("123-45-6789")  # inside vault: ignore
    report = sensitive.scan_paths([tmp_path], exclude=[vault])
    assert len(report.findings) == 1
    assert "data" in report.findings[0].path


# ---------- coverage honesty ----------

def test_report_counts_unreadable_files_separately(tmp_path):
    """A clean result means little if most files couldn't be opened —
    'looked and found nothing' must be distinguishable from 'never looked'."""
    (tmp_path / "readable.txt").write_text("nothing sensitive")
    (tmp_path / "hit.txt").write_text("123-45-6789")
    (tmp_path / "blob.bin").write_bytes(b"\x00\x01\x02binary")
    (tmp_path / "doc.docx").write_bytes(b"PK\x03\x04\x00\x00fake office")
    report = sensitive.scan_paths([tmp_path])
    assert report.read == 2          # the two text files
    assert report.skipped == 2       # binary + office
    assert report.total == 4
    assert len(report.findings) == 1


def test_summarize_carries_coverage(tmp_path):
    (tmp_path / "a.txt").write_text("123-45-6789")
    (tmp_path / "b.bin").write_bytes(b"\x00\x00\x00")
    summary = sensitive.summarize(sensitive.scan_paths([tmp_path]))
    assert summary["read"] == 1
    assert summary["skipped"] == 1


def test_coverage_note_states_the_gap():
    note = sensitive.coverage_note(read=412, skipped=1203)
    assert "412" in note and "1,203" in note
    assert "would not be found" in note   # states the consequence plainly
    clean = sensitive.coverage_note(read=5, skipped=0)
    assert "5" in clean and "could not be read" not in clean


def test_summarize_still_accepts_a_bare_findings_list(tmp_path):
    (tmp_path / "a.txt").write_text("123-45-6789")
    findings = sensitive.scan_paths([tmp_path]).findings
    summary = sensitive.summarize(findings)
    assert summary["files"] == 1 and summary["read"] == 0


# ---------- issuer prefixes: precision over a bare Luhn check ----------

def luhn_complete(prefix: str) -> str:
    """Append the check digit that makes `prefix` Luhn-valid.

    Used to build test data that WOULD have matched before this check
    existed — otherwise the test proves nothing.
    """
    total = 0
    for i, ch in enumerate(reversed(prefix + "0")):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return prefix + str((10 - total % 10) % 10)


REAL_CARDS = [
    "4111111111111111",   # Visa, 16
    "4012888888881881",   # Visa, 16
    "4222222222222",      # Visa, 13
    "5555555555554444",   # Mastercard, 51-55
    "5105105105105100",   # Mastercard
    "2223003122003222",   # Mastercard, 2-series
    "378282246310005",    # American Express, 15
    "371449635398431",    # American Express
    "6011111111111117",   # Discover
    "6011000990139424",   # Discover
]


def test_every_real_brand_still_matches():
    for number in REAL_CARDS:
        assert sensitive.luhn_valid(number), number
        assert sensitive.looks_like_card(number), number
        assert sensitive.count_cards(f"on file: {number}") == 1, number


def test_equipment_part_numbers_are_not_cards():
    """The real-world miss: a folder of Canon copier service manuals
    reported 30 card numbers, none of them real. Parts lists are full of
    long digit runs and about one in ten passes Luhn by chance."""
    part_numbers = [luhn_complete(p) for p in
                    ("870112233445566",    # 8-prefix, no issuer uses it
                     "993001122334455",    # 9-prefix
                     "100200300400500",    # 1-prefix
                     "722100045500123",    # 7-prefix
                     "015566778899001")]   # leading zero
    for number in part_numbers:
        assert sensitive.luhn_valid(number), f"{number} should pass Luhn"
        assert not sensitive.looks_like_card(number), number
        assert sensitive.count_cards(f"Part No. {number}") == 0, number


def test_right_prefix_wrong_length_is_rejected():
    """A Visa prefix on a 15-digit run is not a Visa — length is part of
    the brand, and this is where serial numbers sneak through."""
    for prefix, length in (("4", 15), ("4", 17), ("34", 16), ("55", 15)):
        number = luhn_complete(prefix + "1" * (length - len(prefix) - 1))
        # Setup must be genuinely tempting, or the assertion below is free.
        assert len(number) == length and sensitive.luhn_valid(number), number
        assert not sensitive.looks_like_card(number), number


def test_a_service_manual_page_stays_quiet():
    """The scan that started this: a folder of Canon copier manuals.

    Every number below is Luhn-valid on purpose — before the issuer-prefix
    check each one counted as a payment card, and a page like this is why
    four service manuals were reported as holding 30 of them.
    """
    drum = luhn_complete("870112233445566")
    fuser = luhn_complete("993001122334455")
    counter = luhn_complete("355001284001")
    for number in (drum, fuser, counter):
        assert sensitive.luhn_valid(number), number

    page = f"""
    imageRUNNER ADVANCE DX C5700 Series Service Manual
    Parts list: FM1-2345-000  FC5-1234-020  WT2-5810-000
    Firmware 12.07.0001  Serial QRT04821  Counter {counter}
    Drum unit {drum}  Fuser assembly {fuser}
    """
    assert sensitive.count_cards(page) == 0
    # ...but a real card on the same page is still caught.
    assert sensitive.count_cards(page + "\nRefund to 4111111111111111") == 1
