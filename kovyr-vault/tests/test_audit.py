"""Tests for the tamper-evident audit log (Phase 1)."""

import json
from pathlib import Path

from kovyr_vault import audit
from kovyr_vault.vault import Vault

PASS = "test-passphrase"


def test_record_builds_a_valid_chain(tmp_path):
    root = tmp_path / "v"
    root.mkdir()
    audit.record(root, audit.EV_UNLOCK_OK)
    audit.record(root, audit.EV_FILE_ADD, target="a.txt", nbytes=10)
    audit.record(root, audit.EV_FILE_EXPORT, target="a.txt", nbytes=10)
    result = audit.verify_log(root)
    assert result["ok"] is True
    assert result["entries"] == 3
    entries = audit.read_all(root)
    assert [e["seq"] for e in entries] == [1, 2, 3]
    assert entries[0]["prev"] == audit.GENESIS
    assert entries[1]["prev"] == entries[0]["hash"]


def test_filenames_are_ids_not_cleartext(tmp_path):
    root = tmp_path / "v"
    root.mkdir()
    audit.record(root, audit.EV_FILE_ADD,
                 target=audit.file_id("/Clients/ssn.txt"), nbytes=42)
    line = (root / audit.AUDIT_LOG_NAME).read_text()
    assert "ssn.txt" not in line   # cleartext names never at rest
    assert audit.file_id("/Clients/ssn.txt") in line
    entry = json.loads(line.splitlines()[0])
    assert set(entry) <= {"seq", "ts", "event", "actor", "result",
                          "target", "bytes", "detail", "prev", "hash"}


def test_editing_an_entry_breaks_the_chain(tmp_path):
    root = tmp_path / "v"
    root.mkdir()
    for i in range(5):
        audit.record(root, audit.EV_FILE_ADD, target=f"f{i}", nbytes=i)
    path = root / audit.AUDIT_LOG_NAME
    lines = path.read_text().splitlines()
    tampered = json.loads(lines[2])
    tampered["bytes"] = 9999          # change a past entry's content
    lines[2] = json.dumps(tampered)
    path.write_text("\n".join(lines) + "\n")
    result = audit.verify_log(root)
    assert result["ok"] is False
    assert result["broken_seq"] == 3


def test_deleting_an_entry_breaks_the_chain(tmp_path):
    root = tmp_path / "v"
    root.mkdir()
    for i in range(5):
        audit.record(root, audit.EV_UNLOCK_OK)
    path = root / audit.AUDIT_LOG_NAME
    lines = path.read_text().splitlines()
    del lines[2]                       # remove an entry
    path.write_text("\n".join(lines) + "\n")
    result = audit.verify_log(root)
    assert result["ok"] is False


def test_legacy_access_log_is_migrated(tmp_path):
    root = tmp_path / "v"
    root.mkdir()
    (root / "access.log").write_text(
        "2026-07-01T10:00:00Z\tUNLOCK_OK\n"
        "2026-07-01T10:05:00Z\tFAILED_UNLOCK\n")
    # First modern record triggers migration ahead of itself.
    audit.record(root, audit.EV_FILE_ADD, target="new.txt")
    entries = audit.read_all(root)
    assert entries[0]["event"] == audit.EV_UNLOCK_OK
    assert entries[0]["detail"]["migrated"] is True
    assert entries[1]["event"] == audit.EV_UNLOCK_FAIL
    assert entries[2]["event"] == audit.EV_FILE_ADD
    assert audit.verify_log(root)["ok"] is True
    assert (root / "access.log.migrated").exists()
    assert not (root / "access.log").exists()


def test_vault_operations_are_audited(tmp_path):
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    src = tmp_path / "secret.txt"
    src.write_bytes(b"client data")
    v = Vault.open(vault_dir, PASS)
    v.add_file(src, "secret.txt")
    v.restore_file("secret.txt", tmp_path / "out" / "secret.txt")
    v.log_lock()

    events = [e["event"] for e in audit.read_all(vault_dir)]
    assert audit.EV_UNLOCK_OK in events
    assert audit.EV_FILE_ADD in events
    assert audit.EV_FILE_EXPORT in events
    assert audit.EV_LOCK in events
    assert audit.verify_log(vault_dir)["ok"] is True


def test_verify_reads_do_not_log_exports(tmp_path):
    vault_dir = tmp_path / "vault"
    v = Vault.create(vault_dir, PASS)
    src = tmp_path / "f.txt"
    src.write_bytes(b"data")
    v.add_file(src, "f.txt")
    before = audit.count_events(vault_dir, audit.EV_FILE_EXPORT)
    v.verify()  # reads every file internally
    after = audit.count_events(vault_dir, audit.EV_FILE_EXPORT)
    assert before == after == 0  # internal reads never count as exports


def test_failed_unlock_logged_and_counted(tmp_path):
    import pytest
    from kovyr_vault import crypto, monitor
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    for _ in range(3):
        with pytest.raises(crypto.WrongPassphrase):
            Vault.open(vault_dir, "wrong")
    assert monitor.count_failed_unlocks(vault_dir) == 3
