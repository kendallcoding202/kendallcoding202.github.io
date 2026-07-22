"""Safe removal of duplicate files found by the scanner."""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .scanner import DuplicateGroup

KEEP_POLICIES = ("first", "oldest", "newest")


def choose_keeper(group: DuplicateGroup, policy: str) -> Path:
    """Pick which copy in a duplicate group survives."""
    if policy == "first":
        # Deterministic: shortest path wins, alphabetical as tie-break.
        return min(group.paths, key=lambda p: (len(str(p)), str(p)))
    if policy == "oldest":
        return min(group.paths, key=lambda p: p.stat().st_mtime)
    if policy == "newest":
        return max(group.paths, key=lambda p: p.stat().st_mtime)
    raise ValueError(f"unknown keep policy: {policy!r}")


@dataclass
class DedupeResult:
    kept: list[Path] = field(default_factory=list)
    removed: list[Path] = field(default_factory=list)
    bytes_reclaimed: int = 0
    errors: list[str] = field(default_factory=list)


def dedupe(
    groups: list[DuplicateGroup],
    *,
    apply: bool = False,
    keep: str = "first",
    quarantine: Path | None = None,
) -> DedupeResult:
    """Remove redundant copies from each duplicate group.

    With apply=False (the default) nothing is touched — the result just
    reports what would happen. With a quarantine directory, redundant
    copies are moved there (recoverable) instead of deleted.
    """
    result = DedupeResult()
    for group in groups:
        keeper = choose_keeper(group, keep)
        result.kept.append(keeper)
        for path in group.paths:
            if path == keeper:
                continue
            if apply:
                try:
                    if quarantine is not None:
                        dest = _quarantine_dest(quarantine, path)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(path), str(dest))
                    else:
                        path.unlink()
                except OSError as exc:
                    result.errors.append(f"{path}: {exc}")
                    continue
            result.removed.append(path)
            result.bytes_reclaimed += group.size
    return result


def _quarantine_dest(quarantine: Path, path: Path) -> Path:
    """Mirror the file's absolute path under the quarantine directory."""
    # Drive letters (Windows) and leading separators can't nest directly.
    parts = [p.replace(":", "") for p in path.parts if p not in ("/", "\\")]
    return quarantine.joinpath(*parts)
