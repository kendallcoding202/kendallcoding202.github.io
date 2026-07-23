"""The quarantine: a reversible holding pen for removed duplicate copies.

Files moved here are NOT deleted — they sit, restorable to their exact
original location, until they have aged past the retention window and
someone explicitly empties the quarantine. Two one-way doors, both
gated: watched folder -> quarantine (reversible), quarantine -> gone
(only after RETENTION_DAYS, only on explicit purge).
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from .util import mirror_path

MANIFEST_NAME = "manifest.json"
RETENTION_DAYS = 30


@dataclass
class Item:
    original: str          # absolute path the file came from
    stored: str            # path relative to the quarantine root
    quarantined_at: float  # unix epoch

    def age_days(self, now: float | None = None) -> float:
        now = time.time() if now is None else now
        return (now - self.quarantined_at) / 86400


def _load(qdir: Path) -> list[Item]:
    manifest = qdir / MANIFEST_NAME
    if not manifest.exists():
        return []
    data = json.loads(manifest.read_text())
    return [Item(**entry) for entry in data.get("items", [])]


def _save(qdir: Path, entries: list[Item]) -> None:
    qdir.mkdir(parents=True, exist_ok=True)
    payload = {"items": [vars(entry) for entry in entries]}
    (qdir / MANIFEST_NAME).write_text(json.dumps(payload, indent=2))


def items(qdir: Path) -> list[Item]:
    return _load(qdir)


def add_many(qdir: Path, paths: list[Path], now: float | None = None,
             on_progress=None,
             checkpoint: int = 500) -> tuple[list[Item], list[str]]:
    """Move files into quarantine (reversible; nothing is deleted).

    The manifest is loaded once and written per batch — per-file
    rewrites are O(n²) and froze the UI at four-digit selections. The
    ledger is checkpointed so an interruption loses at most one batch
    of *entries* (the files themselves are already safely moved and
    recoverable by path).
    """
    now = time.time() if now is None else now
    entries = _load(qdir)
    added: list[Item] = []
    errors: list[str] = []
    total = len(paths)
    for index, path in enumerate(paths, 1):
        try:
            stored_abs = mirror_path(qdir, str(path))
            stored_abs.parent.mkdir(parents=True, exist_ok=True)
            base = stored_abs
            counter = 1
            while stored_abs.exists():  # same original quarantined again
                stored_abs = base.with_name(f"{base.name}.{counter}")
                counter += 1
            shutil.move(str(path), str(stored_abs))
            item = Item(original=str(path),
                        stored=str(stored_abs.relative_to(qdir)),
                        quarantined_at=now)
            entries.append(item)
            added.append(item)
        except OSError as exc:
            errors.append(f"{path}: {exc}")
        if index % checkpoint == 0:
            _save(qdir, entries)
        if on_progress and (index % 100 == 0 or index == total):
            on_progress(index, total)
    _save(qdir, entries)
    return added, errors


def add(qdir: Path, path: Path, now: float | None = None) -> Item:
    """Move one file into quarantine (reversible; nothing is deleted)."""
    added, errors = add_many(qdir, [path], now=now)
    if errors:
        raise OSError(errors[0])
    return added[0]


def restore_many(qdir: Path, to_restore: list[Item],
                 on_progress=None,
                 checkpoint: int = 500) -> tuple[int, list[str]]:
    """Put quarantined files back exactly where they came from.
    Batched like add_many; conflicts (a new file now at the original
    location) are reported, never overwritten."""
    entries = _load(qdir)
    by_stored = {e.stored: e for e in entries}
    restored = 0
    errors: list[str] = []
    total = len(to_restore)
    for index, item in enumerate(to_restore, 1):
        entry = by_stored.get(item.stored)
        if entry is None:
            errors.append(f"{item.original}: not in quarantine")
            continue
        source = qdir / entry.stored
        dest = Path(entry.original)
        try:
            if dest.exists():
                raise FileExistsError(f"{dest} already exists")
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(dest))
            entries.remove(entry)
            del by_stored[entry.stored]
            restored += 1
        except (OSError, FileExistsError) as exc:
            errors.append(f"{entry.original}: {exc}")
        if index % checkpoint == 0:
            _save(qdir, entries)
        if on_progress and (index % 100 == 0 or index == total):
            on_progress(index, total)
    _save(qdir, entries)
    return restored, errors


def restore(qdir: Path, item: Item) -> Path:
    """Put one quarantined file back where it came from."""
    restored, errors = restore_many(qdir, [item])
    if errors:
        message = errors[0]
        if "already exists" in message:
            raise FileExistsError(message)
        raise OSError(message)
    return Path(item.original)


def eligible_for_purge(entries: list[Item], now: float | None = None,
                       retention_days: int = RETENTION_DAYS) -> list[Item]:
    return [e for e in entries if e.age_days(now) >= retention_days]


def purge_eligible(qdir: Path, now: float | None = None,
                   retention_days: int = RETENTION_DAYS) -> list[Item]:
    """Permanently delete entries past the retention window. The only
    destructive operation in the module."""
    now = time.time() if now is None else now
    kept: list[Item] = []
    removed: list[Item] = []
    for entry in _load(qdir):
        if entry.age_days(now) >= retention_days:
            try:
                (qdir / entry.stored).unlink(missing_ok=True)
                removed.append(entry)
            except OSError:
                kept.append(entry)
        else:
            kept.append(entry)
    _save(qdir, kept)
    return removed
