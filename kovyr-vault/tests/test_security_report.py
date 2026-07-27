"""Tests for the client-facing security report (Guard phase 5)."""

from pathlib import Path

from kovyr_vault import report, security_report
from kovyr_vault.vault import Vault

PASS = "test-passphrase"


def active_vault(tmp_path) -> Path:
    vault = Vault.create(tmp_path / "v", PASS)
    for i in range(3):
        f = tmp_path / f"f{i}.txt"
        f.write_bytes(f"data {i}".encode())
        vault.add_file(f, f"f{i}.txt")
    vault.restore_file("f0.txt", tmp_path / "out" / "f0.txt")  # an export
    vault.delete_file("f1.txt")
    return tmp_path / "v"


def test_summary_counts_activity(tmp_path):
    root = active_vault(tmp_path)
    s = security_report.summarize(root)
    assert s["files_added"] == 3
    assert s["files_exported"] == 1
    assert s["files_deleted"] == 1
    assert s["log_verified"] is True


def test_summary_since_filters(tmp_path):
    root = active_vault(tmp_path)
    # Far-future 'since' filters everything out.
    s = security_report.summarize(root, since="2999-01")
    assert s["entries"] == 0


def test_security_section_renders_intact_chain(tmp_path):
    root = active_vault(tmp_path)
    s = security_report.summarize(root)
    html = security_report.render_security_section(s)
    assert "Audit log verified intact" in html
    assert "Security &amp; access activity" in html
    assert "recoverable" in html  # retention messaging present


def test_security_section_flags_broken_chain(tmp_path):
    root = active_vault(tmp_path)
    # Corrupt the log: edit a past entry's byte count.
    import json
    log = root / "audit.jsonl"
    lines = log.read_text().splitlines()
    e = json.loads(lines[1])
    e["bytes"] = (e.get("bytes") or 0) + 1
    lines[1] = json.dumps(e)
    log.write_text("\n".join(lines) + "\n")
    s = security_report.summarize(root)
    html = security_report.render_security_section(s)
    assert "FAILED" in html


def test_full_report_includes_security_section(tmp_path):
    root = active_vault(tmp_path)
    s = security_report.summarize(root)
    ctx = {"client": "Acme Dental", "generated": "t", "version": "0.9.1",
           "before": None, "after": None,
           "vault": {"files": 2, "total_bytes": 20, "unique_blobs": 2,
                     "verify_problems": []},
           "security": s}
    html = report.render_report(ctx)
    assert "Security &amp; access activity" in html
    assert "Acme Dental" in html
