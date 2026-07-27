"""Incremental, verify-on-write backup of a vault.

The vault is content-addressed and already encrypted, so backing it up
is a safe, dumb copy: blobs are immutable and named by content hash, so
only blobs missing at the destination are copied (incremental), and each
copy is re-read and size-checked before the source is trusted. The
backup is itself a fully-formed vault directory — restore is just
pointing the app at it.

No passphrase is needed: everything copied is already ciphertext.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .vault import BLOB_DIR, HEADER_NAME, INDEX_NAME

BACKUP_MARKER = "backup.json"


@dataclass
class BackupResult:
    copied: int = 0
    skipped: int = 0
    bytes_copied: int = 0
    errors: list[str] = field(default_factory=list)


def _copy_verified(src: Path, dst: Path) -> int:
    """Copy one file and confirm it landed at the right size."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    shutil.copy2(src, tmp)
    if tmp.stat().st_size != src.stat().st_size:
        tmp.unlink(missing_ok=True)
        raise OSError("size mismatch after copy")
    tmp.replace(dst)
    return dst.stat().st_size


def backup(vault_root: Path, dest_root: Path,
           on_progress=None) -> BackupResult:
    """Mirror the vault into dest_root, copying only what's missing.

    Header and index are always refreshed (small, and they change); each
    blob is copied only if absent or a different size at the destination.
    """
    vault_root = Path(vault_root).resolve()
    dest_root = Path(dest_root).resolve()
    if not (vault_root / HEADER_NAME).exists():
        raise FileNotFoundError(f"no vault at {vault_root}")
    if dest_root == vault_root:
        raise ValueError("backup destination must differ from the vault")
    dest_root.mkdir(parents=True, exist_ok=True)

    result = BackupResult()

    # Header + index: always refresh.
    for name in (HEADER_NAME, INDEX_NAME):
        src = vault_root / name
        if src.exists():
            try:
                result.bytes_copied += _copy_verified(src, dest_root / name)
                result.copied += 1
            except OSError as exc:
                result.errors.append(f"{name}: {exc}")

    blobs = sorted((vault_root / BLOB_DIR).rglob("*.kvb"))
    total = len(blobs)
    for index, blob in enumerate(blobs, 1):
        rel = blob.relative_to(vault_root)
        dst = dest_root / rel
        try:
            if dst.exists() and dst.stat().st_size == blob.stat().st_size:
                result.skipped += 1  # content-addressed: same name = same data
            else:
                result.bytes_copied += _copy_verified(blob, dst)
                result.copied += 1
        except OSError as exc:
            result.errors.append(f"{rel}: {exc}")
        if on_progress and (index % 50 == 0 or index == total):
            on_progress(index, total)

    _write_marker(vault_root, dest_root, result)
    return result


def _write_marker(vault_root: Path, dest_root: Path,
                  result: BackupResult) -> None:
    """Record the backup in the vault so staleness can be reported."""
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    marker = {
        "last_backup": stamp,
        "destination": str(dest_root),
        "copied": result.copied,
        "skipped": result.skipped,
        "errors": len(result.errors),
    }
    try:
        (vault_root / BACKUP_MARKER).write_text(json.dumps(marker, indent=2))
    except OSError:
        pass


def last_backup(vault_root: Path) -> dict | None:
    marker = Path(vault_root) / BACKUP_MARKER
    if not marker.exists():
        return None
    try:
        return json.loads(marker.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def days_since_backup(vault_root: Path, now: datetime | None = None) -> int | None:
    info = last_backup(vault_root)
    if not info or "last_backup" not in info:
        return None
    try:
        when = datetime.fromisoformat(info["last_backup"])
    except ValueError:
        return None
    now = now or datetime.now(timezone.utc)
    return max((now - when).days, 0)
