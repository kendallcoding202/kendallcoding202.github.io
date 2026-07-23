"""Directory scanning and duplicate-group detection."""

from __future__ import annotations

import os
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .hashing import hash_file


@dataclass
class DuplicateGroup:
    """A set of files whose contents are byte-for-byte identical."""

    sha256: str
    size: int
    paths: list[Path] = field(default_factory=list)

    @property
    def wasted_bytes(self) -> int:
        """Bytes consumed by the redundant copies (all but one)."""
        return self.size * (len(self.paths) - 1)


@dataclass
class ScanResult:
    files_scanned: int
    bytes_scanned: int
    groups: list[DuplicateGroup]
    errors: list[str] = field(default_factory=list)
    inventory: dict[str, int] = field(default_factory=dict)  # path -> size

    @property
    def duplicate_files(self) -> int:
        return sum(len(g.paths) - 1 for g in self.groups)

    @property
    def wasted_bytes(self) -> int:
        return sum(g.wasted_bytes for g in self.groups)


def iter_files(roots: list[Path]) -> list[Path]:
    """Collect regular files under the given roots, skipping symlinks."""
    seen: set[Path] = set()
    files: list[Path] = []
    for root in roots:
        root = root.resolve()
        if root.is_file():
            if root not in seen:
                seen.add(root)
                files.append(root)
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                path = Path(dirpath) / name
                if path.is_symlink():
                    continue
                resolved = path.resolve()
                if resolved not in seen and resolved.is_file():
                    seen.add(resolved)
                    files.append(resolved)
    return files


def scan(roots: list[Path]) -> ScanResult:
    """Find duplicate files under the given roots by content hash.

    Files are first grouped by size (cheap) and only same-size files are
    hashed, so unique-size files never need a full read.
    """
    files = iter_files(roots)
    errors: list[str] = []

    by_size: dict[int, list[Path]] = defaultdict(list)
    inventory: dict[str, int] = {}
    total_bytes = 0
    for path in files:
        try:
            size = path.stat().st_size
        except OSError as exc:
            errors.append(f"{path}: {exc}")
            continue
        total_bytes += size
        inventory[str(path)] = size
        by_size[size].append(path)

    groups: list[DuplicateGroup] = []
    for size, candidates in by_size.items():
        if len(candidates) < 2:
            continue
        by_hash: dict[str, list[Path]] = defaultdict(list)
        for path in candidates:
            try:
                by_hash[hash_file(path)].append(path)
            except OSError as exc:
                errors.append(f"{path}: {exc}")
        for sha, paths in by_hash.items():
            if len(paths) > 1:
                groups.append(
                    DuplicateGroup(sha256=sha, size=size, paths=sorted(paths))
                )

    groups.sort(key=lambda g: g.wasted_bytes, reverse=True)
    return ScanResult(
        files_scanned=len(files),
        bytes_scanned=total_bytes,
        groups=groups,
        errors=errors,
        inventory=inventory,
    )
