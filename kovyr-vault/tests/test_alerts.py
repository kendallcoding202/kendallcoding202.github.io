"""Tests for failed-unlock logging and the mass-change/tamper canary."""

from pathlib import Path

import pytest

from kovyr_vault import crypto, monitor, scanner
from kovyr_vault.vault import ACCESS_LOG_NAME, BLOB_DIR, Vault

PASS = "test-passphrase"


def make_files(root: Path, count: int, prefix: str = "f") -> None:
    root.mkdir(parents=True, exist_ok=True)
    for i in range(count):
        (root / f"{prefix}{i}.txt").write_bytes(f"content {i}".encode())


# ---------- failed-unlock logging ----------

def test_unlock_attempts_are_logged(tmp_path):
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    with pytest.raises(crypto.WrongPassphrase):
        Vault.open(vault_dir, "wrong")
    with pytest.raises(crypto.WrongPassphrase):
        Vault.open(vault_dir, "still wrong")
    Vault.open(vault_dir, PASS)

    log = (vault_dir / ACCESS_LOG_NAME).read_text()
    assert log.count("FAILED_UNLOCK") == 2
    assert log.count("UNLOCK_OK") == 1
    assert monitor.count_failed_unlocks(vault_dir) == 2


def test_monitor_reports_new_failed_unlocks(tmp_path):
    data = tmp_path / "data"
    make_files(data, 3)
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    state = tmp_path / "state.json"

    snap, _, _ = monitor.record_run(
        state, scanner.scan([data]), "t1", vault=vault_dir)
    assert snap["failed_unlocks"] == 0

    for _ in range(3):
        with pytest.raises(crypto.WrongPassphrase):
            Vault.open(vault_dir, "guess")

    snap, _, _ = monitor.record_run(
        state, scanner.scan([data]), "t2", vault=vault_dir)
    assert snap["failed_unlocks"] == 3
    assert snap["new_failed_unlocks"] == 3

    snap, _, _ = monitor.record_run(
        state, scanner.scan([data]), "t3", vault=vault_dir)
    assert snap["new_failed_unlocks"] == 0


# ---------- mass-change canary ----------

def test_canary_fires_on_mass_rename(tmp_path):
    data = tmp_path / "data"
    make_files(data, 30)
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    # Simulate ransomware: every file renamed/re-encrypted.
    for f in list(data.iterdir()):
        f.rename(f.with_suffix(".locked"))
    snap, _, _ = monitor.record_run(state, scanner.scan([data]), "t2")
    assert snap["canary_alerts"]
    assert "mass file activity" in snap["canary_alerts"][0]


def test_canary_quiet_on_normal_change(tmp_path):
    data = tmp_path / "data"
    make_files(data, 30)
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    # Normal week: a few files added, one removed, one edited.
    (data / "f0.txt").unlink()
    (data / "new-report.txt").write_bytes(b"new")
    (data / "f1.txt").write_bytes(b"edited")
    snap, _, _ = monitor.record_run(state, scanner.scan([data]), "t2")
    assert snap["canary_alerts"] == []


def test_canary_quiet_on_small_estates(tmp_path):
    data = tmp_path / "data"
    make_files(data, 5)  # below CANARY_MIN_FILES
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    for f in list(data.iterdir()):
        f.rename(f.with_suffix(".locked"))
    snap, _, _ = monitor.record_run(state, scanner.scan([data]), "t2")
    assert snap["canary_alerts"] == []


# ---------- vault tamper canary ----------

def test_canary_fires_on_blob_tamper(tmp_path):
    data = tmp_path / "data"
    make_files(data, 3)
    vault_dir = tmp_path / "vault"
    vault = Vault.create(vault_dir, PASS)
    vault.add_file(data / "f0.txt", "f0.txt")
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1", vault=vault_dir)
    blob = next((vault_dir / BLOB_DIR).rglob("*.kvb"))
    blob.write_bytes(blob.read_bytes() + b"tampered")
    snap, _, _ = monitor.record_run(
        state, scanner.scan([data]), "t2", vault=vault_dir)
    assert any("vault integrity" in a for a in snap["canary_alerts"])


def test_canary_quiet_when_vault_untouched(tmp_path):
    data = tmp_path / "data"
    make_files(data, 3)
    vault_dir = tmp_path / "vault"
    vault = Vault.create(vault_dir, PASS)
    vault.add_file(data / "f0.txt", "f0.txt")
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1", vault=vault_dir)
    vault.add_file(data / "f1.txt", "f1.txt")  # legit growth is fine
    snap, _, _ = monitor.record_run(
        state, scanner.scan([data]), "t2", vault=vault_dir)
    assert snap["canary_alerts"] == []


# ---------- report banner ----------

def test_monitor_report_shows_alert_banner():
    from kovyr_vault import report
    ctx = {
        "client": "Acme",
        "generated": "t",
        "version": "0.2.0",
        "history": [{
            "timestamp": "t", "files_scanned": 30, "bytes_scanned": 100,
            "duplicate_files": 0, "wasted_bytes": 0, "groups": [],
            "canary_alerts": ["unusual mass file activity: 25 of 30 …"],
            "failed_unlocks": 4, "new_failed_unlocks": 4,
        }],
        "new_groups": [],
        "resolved_groups": [],
    }
    html = report.render_monitor_report(ctx)
    assert "Attention needed" in html
    assert "mass file activity" in html
    assert "4 failed vault unlock" in html
