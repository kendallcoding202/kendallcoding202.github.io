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
    findings = sensitive.scan_paths([tmp_path])
    assert len(findings) == 2
    assert findings[0].total >= findings[1].total   # sorted most-exposed first
    summary = sensitive.summarize(findings)
    assert summary["files"] == 2
    assert summary["ssns"] == 3


def test_scan_paths_excludes_vault(tmp_path):
    data = tmp_path / "data"; data.mkdir()
    vault = tmp_path / "vault"; vault.mkdir()
    (data / "x.txt").write_text("123-45-6789")
    (vault / "blob.txt").write_text("123-45-6789")  # inside vault: ignore
    findings = sensitive.scan_paths([tmp_path], exclude=[vault])
    assert len(findings) == 1
    assert "data" in findings[0].path
