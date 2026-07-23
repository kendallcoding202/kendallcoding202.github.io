"""Protected Folders: keep-in-place folders whose contents get swept
into the encrypted vault, leaving visible receipts behind.

The client's habit stays the same — save sensitive files into the
folder (any subfolder depth). Whenever the vault is unlocked, a sweep
encrypts every waiting file and replaces it with a small `.kovyr`
receipt naming when it was encrypted and where to retrieve it. The
monitor counts files still waiting, so nothing lingers unnoticed.

Sweeping requires an unlocked vault by design: only the client's
passphrase can open the vault, so encryption can never run silently in
the background — that's the key-custody promise, not a limitation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .vault import Vault

RECEIPT_SUFFIX = ".kovyr"
JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


def is_receipt(path: Path) -> bool:
    return path.name.endswith(RECEIPT_SUFFIX)


def receipt_path(path: Path) -> Path:
    return path.with_name(path.name + RECEIPT_SUFFIX)


def original_from_receipt(receipt: Path) -> Path:
    """The vault name a receipt stands in for (its own path minus the
    .kovyr suffix)."""
    name = receipt.name
    if name.endswith(RECEIPT_SUFFIX):
        name = name[: -len(RECEIPT_SUFFIX)]
    return receipt.with_name(name)


def waiting_files(folders: list[Path],
                 exclude: Path | None = None) -> list[Path]:
    """Files (any depth) not yet encrypted: everything except receipts,
    OS junk, and anything inside `exclude` (the vault itself, should it
    live within a protected folder)."""
    waiting: list[Path] = []
    for folder in folders:
        folder = Path(folder)
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            if is_receipt(path) or path.name in JUNK_NAMES:
                continue
            if exclude is not None and exclude in path.parents:
                continue
            waiting.append(path)
    return waiting


def sweep(vault: Vault, folders: list[Path],
          on_progress=None, checkpoint: int = 200) -> tuple[int, list[str]]:
    """Encrypt every waiting file into the vault, replace it with a
    receipt, and remove the plaintext original. Returns
    (encrypted_count, errors).

    Batched for crash safety and speed: originals are only removed
    AFTER the batch's index entries are persisted, so an interruption
    at any point leaves every file either safely retrievable from the
    vault or still present in plaintext — never neither. The encrypted
    index is written once per batch instead of once per file (O(n²)
    otherwise). on_progress(done, total) is called periodically.
    """
    encrypted = 0
    errors: list[str] = []
    waiting = waiting_files(folders, exclude=vault.root)
    total = len(waiting)
    pending: list[Path] = []

    def commit_batch() -> None:
        nonlocal encrypted
        if not pending:
            return
        vault.flush_index()  # entries persisted BEFORE originals go
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        for done_path in pending:
            try:
                receipt_path(done_path).write_text(
                    f"This file is encrypted in your Kovyr vault "
                    f"(since {stamp}).\n"
                    f"Open the Kovyr Vault app and unlock with your "
                    f"passphrase to retrieve it.\n"
                    f"Original name: {done_path.name}\n",
                    encoding="utf-8")
                done_path.unlink()
                encrypted += 1
            except OSError as exc:
                errors.append(f"{done_path}: {exc}")
        pending.clear()

    for index, path in enumerate(waiting, 1):
        try:
            vault.add_file(path, str(path), save_index=False)
            pending.append(path)
        except OSError as exc:
            errors.append(f"{path}: {exc}")
        if len(pending) >= checkpoint:
            commit_batch()
        if on_progress and (index % 25 == 0 or index == total):
            on_progress(index, total)
    commit_batch()
    return encrypted, errors
