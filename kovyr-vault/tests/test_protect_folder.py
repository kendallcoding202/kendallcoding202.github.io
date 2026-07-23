"""Tests for Protected Folders: recursive sweep, receipts, and the
awaiting-encryption counter."""

from pathlib import Path

from kovyr_vault import monitor, protect_folder, scanner
from kovyr_vault.vault import Vault

PASS = "test-passphrase"


def make_tree(root: Path) -> None:
    (root / "Smith" / "2024").mkdir(parents=True)
    (root / "intake.pdf").write_bytes(b"top-level file")
    (root / "Smith" / "w2.pdf").write_bytes(b"nested one deep")
    (root / "Smith" / "2024" / "return.pdf").write_bytes(b"nested two deep")
    (root / ".DS_Store").write_bytes(b"junk")


def test_waiting_files_recursive_and_filtered(tmp_path):
    make_tree(tmp_path / "prot")
    waiting = protect_folder.waiting_files([tmp_path / "prot"])
    names = sorted(p.name for p in waiting)
    assert names == ["intake.pdf", "return.pdf", "w2.pdf"]


def test_waiting_files_skips_receipts_and_excluded(tmp_path):
    prot = tmp_path / "prot"
    make_tree(prot)
    (prot / "done.txt.kovyr").write_text("receipt")
    nested_vault = prot / "vault"
    nested_vault.mkdir()
    (nested_vault / "blob.kvb").write_bytes(b"ciphertext")
    waiting = protect_folder.waiting_files([prot], exclude=nested_vault)
    assert all("vault" not in str(p) for p in waiting)
    assert all(not p.name.endswith(".kovyr") for p in waiting)


def test_sweep_encrypts_recursively_and_leaves_receipts(tmp_path):
    prot = tmp_path / "prot"
    make_tree(prot)
    vault = Vault.create(tmp_path / "vault", PASS)

    encrypted, errors = protect_folder.sweep(vault, [prot])
    assert encrypted == 3
    assert errors == []

    # Originals gone, receipts in their place — at every depth.
    assert not (prot / "Smith" / "2024" / "return.pdf").exists()
    receipt = prot / "Smith" / "2024" / "return.pdf.kovyr"
    assert "encrypted in your Kovyr vault" in receipt.read_text()

    # Content retrievable from the vault, structure remembered.
    stored = vault.list_files()
    assert str(prot / "Smith" / "2024" / "return.pdf") in stored
    assert vault.read_file(
        str(prot / "Smith" / "w2.pdf")) == b"nested one deep"

    # Second sweep: nothing left to do.
    assert protect_folder.waiting_files([prot], exclude=vault.root) == []
    encrypted, _ = protect_folder.sweep(vault, [prot])
    assert encrypted == 0


def test_monitor_counts_awaiting_encryption(tmp_path):
    prot = tmp_path / "prot"
    make_tree(prot)
    watched = tmp_path / "watched"
    watched.mkdir()
    vault = Vault.create(tmp_path / "vault", PASS)
    state = tmp_path / "state.json"

    snap, _, _ = monitor.record_run(
        state, scanner.scan([watched]), "t1",
        vault=tmp_path / "vault", protected=[prot])
    assert snap["awaiting_encryption"] == 3

    protect_folder.sweep(vault, [prot])
    snap, _, _ = monitor.record_run(
        state, scanner.scan([watched]), "t2",
        vault=tmp_path / "vault", protected=[prot])
    assert snap["awaiting_encryption"] == 0


def test_report_shows_awaiting_tile():
    from kovyr_vault import report
    base = {"timestamp": "t", "files_scanned": 5, "bytes_scanned": 100,
            "duplicate_files": 0, "wasted_bytes": 0, "groups": []}
    ctx = {"client": "Acme", "generated": "t", "version": "0.5.0",
           "history": [dict(base, awaiting_encryption=4)],
           "new_groups": [], "resolved_groups": []}
    html = report.render_monitor_report(ctx)
    assert "Awaiting encryption" in html
    assert "4" in html

    ctx["history"] = [dict(base, awaiting_encryption=0)]
    html = report.render_monitor_report(ctx)
    assert "fully encrypted" in html
