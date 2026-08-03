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


def test_original_from_receipt():
    receipt = Path("/data/Smith/w2.pdf.kovyr")
    assert protect_folder.original_from_receipt(receipt) == \
        Path("/data/Smith/w2.pdf")
    plain = Path("/data/Smith/w2.pdf")
    assert protect_folder.original_from_receipt(plain) == plain


# ---------- encrypt_paths: the "Encrypt selected" action ----------

def test_encrypt_paths_encrypts_only_what_was_picked(tmp_path):
    """The sensitive scan flags specific files; only those get encrypted,
    and the rest of the folder is left untouched."""
    watched = tmp_path / "watched"
    watched.mkdir()
    picked = watched / "intake.pdf"
    picked.write_bytes(b"ssn lives here")
    untouched = watched / "notes.txt"
    untouched.write_bytes(b"nothing sensitive")
    vault = Vault.create(tmp_path / "vault", PASS)

    encrypted, errors = protect_folder.encrypt_paths(vault, [picked])
    assert (encrypted, errors) == (1, [])

    # Picked file: plaintext replaced by a receipt, content in the vault.
    assert not picked.exists()
    assert "encrypted in your Kovyr vault" in \
        (watched / "intake.pdf.kovyr").read_text()
    assert vault.read_file(str(picked)) == b"ssn lives here"

    # Everything else in the folder is exactly as it was.
    assert untouched.read_bytes() == b"nothing sensitive"
    assert str(untouched) not in vault.list_files()


def test_encrypt_paths_reports_progress(tmp_path):
    watched = tmp_path / "watched"
    watched.mkdir()
    paths = []
    for i in range(3):
        path = watched / f"f{i}.txt"
        path.write_bytes(f"file {i}".encode())
        paths.append(path)
    vault = Vault.create(tmp_path / "vault", PASS)

    seen = []
    encrypted, errors = protect_folder.encrypt_paths(
        vault, paths, on_progress=lambda done, total: seen.append((done, total)))
    assert (encrypted, errors) == (3, [])
    assert seen == [(1, 3), (2, 3), (3, 3)]


def test_encrypt_paths_skips_receipts_missing_and_the_vault(tmp_path):
    """Stale selections and self-ingestion are skipped, not errors — the
    list comes from a scan that may be minutes old."""
    watched = tmp_path / "watched"
    watched.mkdir()
    vault = Vault.create(tmp_path / "vault", PASS)
    receipt = watched / "already.pdf.kovyr"
    receipt.write_text("receipt")
    gone = watched / "deleted-since-the-scan.txt"
    folder = watched / "subfolder"
    folder.mkdir()
    in_vault = vault.root / "blob.kvb"
    in_vault.write_bytes(b"ciphertext")

    encrypted, errors = protect_folder.encrypt_paths(
        vault, [receipt, gone, folder, in_vault])
    assert (encrypted, errors) == (0, [])
    assert receipt.exists() and in_vault.exists()
    assert vault.list_files() == {}


def test_encrypt_paths_persists_index_before_removing_plaintext(tmp_path):
    """The crash-safety guarantee: if the process dies after the index is
    written, the file is retrievable from a freshly-opened vault. It must
    never be removed while only in memory."""
    watched = tmp_path / "watched"
    watched.mkdir()
    path = watched / "w2.pdf"
    path.write_bytes(b"payroll")
    vault = Vault.create(tmp_path / "vault", PASS)

    protect_folder.encrypt_paths(vault, [path])

    reopened = Vault.open(tmp_path / "vault", PASS)
    assert reopened.read_file(str(path)) == b"payroll"


def test_encrypt_paths_keeps_plaintext_when_encryption_fails(tmp_path):
    """A file that cannot be added to the vault keeps its plaintext — the
    failure is reported, never silently traded for data loss."""
    watched = tmp_path / "watched"
    watched.mkdir()
    good = watched / "good.txt"
    good.write_bytes(b"fine")
    bad = watched / "bad.txt"
    bad.write_bytes(b"unreadable")
    vault = Vault.create(tmp_path / "vault", PASS)

    real_add = vault.add_file

    def add_file(path, name, save_index=True):
        if Path(path).name == "bad.txt":
            raise OSError("permission denied")
        return real_add(path, name, save_index=save_index)

    vault.add_file = add_file
    encrypted, errors = protect_folder.encrypt_paths(vault, [good, bad])

    assert encrypted == 1
    assert len(errors) == 1 and "bad.txt" in errors[0]
    assert bad.read_bytes() == b"unreadable"       # plaintext preserved
    assert not (watched / "bad.txt.kovyr").exists()
    assert not good.exists()                       # the good one still went
