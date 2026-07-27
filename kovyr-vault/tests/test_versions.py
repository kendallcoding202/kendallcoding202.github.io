"""Tests for versioning + soft delete (Guard phase 2)."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from kovyr_vault import audit
from kovyr_vault.vault import BLOB_DIR, Vault, VaultError

PASS = "test-passphrase"


def write(root: Path, name: str, content: bytes) -> Path:
    p = root / name
    p.write_bytes(content)
    return p


def test_overwrite_keeps_prior_version(tmp_path):
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"version one")
    vault.add_file(f, "doc.txt")
    f.write_bytes(b"version two")
    vault.add_file(f, "doc.txt")

    versions = vault.list_versions("doc.txt")
    assert len(versions) == 2               # one history + current
    assert versions[-1].ts == "current"
    # Current reads back as v2; v1's blob still on disk.
    assert vault.read_file("doc.txt") == b"version two"
    old_sha = versions[0].sha256
    assert vault._blob_path(old_sha).exists()


def test_restore_previous_version(tmp_path):
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"original")
    vault.add_file(f, "doc.txt")
    f.write_bytes(b"changed")
    vault.add_file(f, "doc.txt")

    original_sha = vault.list_versions("doc.txt")[0].sha256
    vault.restore_version("doc.txt", original_sha)
    assert vault.read_file("doc.txt") == b"original"


def test_soft_delete_is_recoverable(tmp_path):
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"keep me")
    vault.add_file(f, "doc.txt")
    sha = vault.list_files()["doc.txt"].sha256

    vault.delete_file("doc.txt")
    assert "doc.txt" not in vault.list_files()        # gone from live view
    versions = vault.list_versions("doc.txt")
    assert versions and versions[-1].deleted          # tombstone retained
    assert vault._blob_path(sha).exists()             # blob still present
    vault.restore_version("doc.txt", sha)             # brought back
    assert vault.read_file("doc.txt") == b"keep me"


def test_purge_removes_only_aged_out_versions(tmp_path):
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"v1")
    vault.add_file(f, "doc.txt")
    f.write_bytes(b"v2")
    vault.add_file(f, "doc.txt")                      # v1 now in history

    old_sha = vault.list_versions("doc.txt")[0].sha256
    cur_sha = vault.list_files()["doc.txt"].sha256

    # Nothing aged out yet.
    assert vault.purge_versions(retention_days=30) == 0
    assert vault._blob_path(old_sha).exists()

    # 40 days later, the history version is past a 30-day window.
    future = datetime.now(timezone.utc) + timedelta(days=40)
    removed = vault.purge_versions(retention_days=30, now=future)
    assert removed == 1
    assert not vault._blob_path(old_sha).exists()     # old blob gone
    assert vault._blob_path(cur_sha).exists()         # current untouched
    assert vault.read_file("doc.txt") == b"v2"


def test_version_ops_are_audited(tmp_path):
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"a")
    vault.add_file(f, "doc.txt")
    vault.delete_file("doc.txt")
    events = [e["event"] for e in audit.read_all(tmp_path / "v")]
    assert audit.EV_FILE_DELETE in events
    assert audit.verify_log(tmp_path / "v")["ok"] is True


def test_v1_index_still_loads(tmp_path):
    # A version-1 index (no history key) must open and gain empty history.
    vault = Vault.create(tmp_path / "v", PASS)
    f = write(tmp_path, "doc.txt", b"x")
    vault.add_file(f, "doc.txt")
    reopened = Vault.open(tmp_path / "v", PASS)
    assert reopened.list_versions("doc.txt")[-1].ts == "current"


def test_ransomware_pattern_versions_survive(tmp_path):
    """Bulk-overwrite everything (encryptor behavior); every prior
    version must remain recoverable."""
    vault = Vault.create(tmp_path / "v", PASS)
    originals = {}
    for i in range(20):
        f = write(tmp_path, f"f{i}.txt", f"good-{i}".encode())
        vault.add_file(f, f"f{i}.txt")
        originals[f"f{i}.txt"] = vault.list_files()[f"f{i}.txt"].sha256
    # "Ransomware" overwrites all with encrypted junk.
    for i in range(20):
        f = write(tmp_path, f"f{i}.txt", f"ENCRYPTED-{i}".encode())
        vault.add_file(f, f"f{i}.txt")
    # Every original is still restorable.
    for name, sha in originals.items():
        vault.restore_version(name, sha)
        assert vault.read_file(name) == f"good-{name[1:-4]}".encode()
