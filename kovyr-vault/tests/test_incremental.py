"""Tests for incremental scanning: unchanged files reuse cached
fingerprints; new/edited files are re-read; the cache self-prunes."""

import os
from pathlib import Path

import pytest

from kovyr_vault import monitor, scanner


def make_dupes(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "a.txt").write_bytes(b"same content")
    (root / "b.txt").write_bytes(b"same content")
    (root / "c.txt").write_bytes(b"other stuff!")  # same size, distinct


def test_cache_populates_and_is_reused(tmp_path, monkeypatch):
    data = tmp_path / "data"
    make_dupes(data)
    cache: dict = {}
    first = scanner.scan([data], cache=cache)
    assert len(first.groups) == 1
    assert len(cache) == 3  # all same-size candidates hashed

    # Second scan must not read any file: hashing now would be a bug.
    def boom(_path):
        raise AssertionError("hash_file called despite valid cache")
    monkeypatch.setattr(scanner, "hash_file", boom)
    second = scanner.scan([data], cache=cache)
    assert len(second.groups) == 1
    assert sorted(p.name for p in second.groups[0].paths) == \
        ["a.txt", "b.txt"]


def test_edited_file_is_rehashed(tmp_path):
    data = tmp_path / "data"
    make_dupes(data)
    cache: dict = {}
    scanner.scan([data], cache=cache)

    # c.txt becomes a copy of the others (same size, new content).
    (data / "c.txt").write_bytes(b"same content")
    os.utime(data / "c.txt", (9999999999, 9999999999))
    result = scanner.scan([data], cache=cache)
    assert len(result.groups[0].paths) == 3
    assert cache[str(data / "c.txt")]["sha256"] == \
        cache[str(data / "a.txt")]["sha256"]


def test_stale_mtime_invalidates_entry(tmp_path):
    data = tmp_path / "data"
    make_dupes(data)
    cache: dict = {}
    scanner.scan([data], cache=cache)
    # Poison a cache entry; a matching mtime would wrongly keep it.
    key = str(data / "a.txt")
    cache[key]["sha256"] = "bogus"
    cache[key]["mtime"] = -1.0
    result = scanner.scan([data], cache=cache)
    assert cache[key]["sha256"] != "bogus"
    assert len(result.groups[0].paths) == 2


def test_record_run_persists_and_prunes_cache(tmp_path):
    data = tmp_path / "data"
    make_dupes(data)
    state = tmp_path / "state.json"

    cache = monitor.load_hash_cache(state)
    assert cache == {}
    result = scanner.scan([data], cache=cache)
    monitor.record_run(state, result, "t1", hash_cache=cache)
    assert len(monitor.load_hash_cache(state)) == 3

    (data / "b.txt").unlink()
    cache = monitor.load_hash_cache(state)
    result = scanner.scan([data], cache=cache)
    monitor.record_run(state, result, "t2", hash_cache=cache)
    persisted = monitor.load_hash_cache(state)
    assert str(data / "b.txt") not in persisted
