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


def sweep(vault: Vault, folders: list[Path]) -> tuple[int, list[str]]:
    """Encrypt every waiting file into the vault, replace it with a
    receipt, and remove the plaintext original. Returns
    (encrypted_count, errors)."""
    encrypted = 0
    errors: list[str] = []
    for path in waiting_files(folders, exclude=vault.root):
        try:
            vault.add_file(path, str(path))
            stamp = datetime.now(timezone.utc).strftime(
                "%Y-%m-%d %H:%M UTC")
            receipt_path(path).write_text(
                f"This file is encrypted in your Kovyr vault "
                f"(since {stamp}).\n"
                f"Open the Kovyr Vault app and unlock with your "
                f"passphrase to retrieve it.\n"
                f"Original name: {path.name}\n",
                encoding="utf-8")
            path.unlink()
            encrypted += 1
        except OSError as exc:
            errors.append(f"{path}: {exc}")
    return encrypted, errors
