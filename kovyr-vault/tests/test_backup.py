"""Tests for incremental vault backup and staleness reporting."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from kovyr_vault import backup
from kovyr_vault.vault import BLOB_DIR, Vault

PASS = "test-passphrase"


def seeded_vault(tmp_path) -> Path:
    vault = Vault.create(tmp_path / "vault", PASS)
    for i in range(3):
        src = tmp_path / f"f{i}.txt"
        src.write_bytes(f"content {i}".encode())
        vault.add_file(src, f"f{i}.txt")
    return tmp_path / "vault"


def test_backup_copies_a_usable_vault(tmp_path):
    vault_root = seeded_vault(tmp_path)
    dest = tmp_path / "backup"
    result = backup.backup(vault_root, dest)
    assert result.copied > 0
    assert result.errors == []
    # The backup is itself a working vault.
    reopened = Vault.open(dest, PASS)
    assert reopened.read_file("f1.txt") == b"content 1"


def test_backup_is_incremental(tmp_path):
    vault_root = seeded_vault(tmp_path)
    dest = tmp_path / "backup"
    backup.backup(vault_root, dest)
    # Second run: blobs already present are skipped, not recopied.
    second = backup.backup(vault_root, dest)
    blob_count = len(list((vault_root / BLOB_DIR).rglob("*.kvb")))
    assert second.skipped == blob_count
    # Only header + index refresh.
    assert second.copied <= 2


def test_backup_refuses_self(tmp_path):
    vault_root = seeded_vault(tmp_path)
    with pytest.raises(ValueError):
        backup.backup(vault_root, vault_root)


def test_backup_marker_and_days_since(tmp_path):
    vault_root = seeded_vault(tmp_path)
    backup.backup(vault_root, tmp_path / "backup")
    info = backup.last_backup(vault_root)
    assert info and info["destination"].endswith("backup")
    assert backup.days_since_backup(vault_root) == 0

    future = datetime.now(timezone.utc) + timedelta(days=20)
    assert backup.days_since_backup(vault_root, now=future) == 20


def test_days_since_backup_none_when_never(tmp_path):
    vault_root = seeded_vault(tmp_path)
    assert backup.days_since_backup(vault_root) is None


def test_report_shows_backup_tile():
    from kovyr_vault import report
    base = {"timestamp": "t", "files_scanned": 5, "bytes_scanned": 100,
            "duplicate_files": 0, "wasted_bytes": 0, "groups": []}
    ctx = {"client": "Acme", "generated": "t", "version": "0.8.1",
           "history": [dict(base, days_since_backup=30)],
           "new_groups": [], "resolved_groups": []}
    html = report.render_monitor_report(ctx)
    assert "Vault backup" in html
    assert "30d ago" in html
