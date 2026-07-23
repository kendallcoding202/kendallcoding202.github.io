"""Tests for the reversible quarantine and its retention gate."""

from pathlib import Path

import pytest

from kovyr_vault import quarantine
from kovyr_vault.gui import keeper_and_redundant

DAY = 86400


def make_file(root: Path, name: str, content: bytes = b"data") -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def test_add_moves_file_and_records_manifest(tmp_path):
    qdir = tmp_path / "q"
    victim = make_file(tmp_path / "data", "copy.txt")
    item = quarantine.add(qdir, victim, now=1000.0)
    assert not victim.exists()
    assert (qdir / item.stored).read_bytes() == b"data"
    assert quarantine.items(qdir)[0].original == str(victim)


def test_restore_puts_file_back(tmp_path):
    qdir = tmp_path / "q"
    victim = make_file(tmp_path / "data", "copy.txt", b"payload")
    item = quarantine.add(qdir, victim, now=1000.0)
    restored = quarantine.restore(qdir, item)
    assert restored == victim
    assert victim.read_bytes() == b"payload"
    assert quarantine.items(qdir) == []


def test_restore_refuses_to_overwrite(tmp_path):
    qdir = tmp_path / "q"
    victim = make_file(tmp_path / "data", "copy.txt")
    item = quarantine.add(qdir, victim, now=1000.0)
    make_file(tmp_path / "data", "copy.txt", b"newer content")
    with pytest.raises(FileExistsError):
        quarantine.restore(qdir, item)
    assert quarantine.items(qdir)  # still held, not lost


def test_same_original_quarantined_twice_keeps_both(tmp_path):
    qdir = tmp_path / "q"
    first = make_file(tmp_path / "data", "copy.txt", b"one")
    quarantine.add(qdir, first, now=1000.0)
    second = make_file(tmp_path / "data", "copy.txt", b"two")
    quarantine.add(qdir, second, now=2000.0)
    stored = {i.stored for i in quarantine.items(qdir)}
    assert len(stored) == 2


def test_purge_respects_retention_window(tmp_path):
    qdir = tmp_path / "q"
    old = make_file(tmp_path / "data", "old.txt")
    new = make_file(tmp_path / "data", "new.txt")
    quarantine.add(qdir, old, now=0.0)
    quarantine.add(qdir, new, now=29 * DAY)

    now = 31 * DAY  # old is 31 days held, new only 2
    entries = quarantine.items(qdir)
    assert len(quarantine.eligible_for_purge(entries, now=now)) == 1

    removed = quarantine.purge_eligible(qdir, now=now)
    assert [Path(r.original).name for r in removed] == ["old.txt"]
    remaining = quarantine.items(qdir)
    assert [Path(r.original).name for r in remaining] == ["new.txt"]
    assert (qdir / remaining[0].stored).exists()


def test_purge_before_window_deletes_nothing(tmp_path):
    qdir = tmp_path / "q"
    victim = make_file(tmp_path / "data", "copy.txt")
    quarantine.add(qdir, victim, now=0.0)
    assert quarantine.purge_eligible(qdir, now=10 * DAY) == []
    assert len(quarantine.items(qdir)) == 1


def test_keeper_is_shortest_path():
    keeper, redundant = keeper_and_redundant(
        ["/data/backup/report copy.pdf", "/data/report.pdf",
         "/archive/2024/report.pdf"])
    assert keeper == "/data/report.pdf"
    assert len(redundant) == 2
    assert keeper not in redundant


def test_add_many_batches_and_reports_progress(tmp_path):
    qdir = tmp_path / "q"
    paths = [make_file(tmp_path / "data", f"f{i}.txt", str(i).encode())
             for i in range(25)]
    seen = []
    added, errors = quarantine.add_many(
        qdir, paths, now=1000.0,
        on_progress=lambda d, t: seen.append((d, t)), checkpoint=10)
    assert len(added) == 25
    assert errors == []
    assert len(quarantine.items(qdir)) == 25
    assert seen[-1] == (25, 25)
    assert all(not p.exists() for p in paths)


def test_restore_many_roundtrip_with_conflict(tmp_path):
    qdir = tmp_path / "q"
    paths = [make_file(tmp_path / "data", f"f{i}.txt", str(i).encode())
             for i in range(5)]
    quarantine.add_many(qdir, paths, now=1000.0)
    # Recreate one original: restore must refuse to overwrite it.
    make_file(tmp_path / "data", "f2.txt", b"newer")
    entries = quarantine.items(qdir)
    restored, errors = quarantine.restore_many(qdir, entries)
    assert restored == 4
    assert len(errors) == 1 and "f2.txt" in errors[0]
    assert (tmp_path / "data" / "f2.txt").read_bytes() == b"newer"
    assert len(quarantine.items(qdir)) == 1  # the conflicted one stays held
