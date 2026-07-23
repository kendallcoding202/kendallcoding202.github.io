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


def add(qdir: Path, path: Path, now: float | None = None) -> Item:
    """Move a file into quarantine (reversible; nothing is deleted)."""
    now = time.time() if now is None else now
    stored_abs = mirror_path(qdir, str(path))
    stored_abs.parent.mkdir(parents=True, exist_ok=True)
    base = stored_abs
    counter = 1
    while stored_abs.exists():  # same original quarantined more than once
        stored_abs = base.with_name(f"{base.name}.{counter}")
        counter += 1
    shutil.move(str(path), str(stored_abs))
    item = Item(original=str(path),
                stored=str(stored_abs.relative_to(qdir)),
                quarantined_at=now)
    entries = _load(qdir)
    entries.append(item)
    _save(qdir, entries)
    return item


def restore(qdir: Path, item: Item) -> Path:
    """Put a quarantined file back exactly where it came from."""
    source = qdir / item.stored
    dest = Path(item.original)
    if dest.exists():
        raise FileExistsError(f"{dest} already exists")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(dest))
    _save(qdir, [e for e in _load(qdir) if e.stored != item.stored])
    return dest


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
