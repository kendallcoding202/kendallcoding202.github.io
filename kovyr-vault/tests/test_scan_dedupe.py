from pathlib import Path

from kovyr_vault import dedupe, scanner


def make_tree(root: Path) -> None:
    (root / "a").mkdir()
    (root / "b").mkdir()
    (root / "a" / "report.pdf").write_bytes(b"CONFIDENTIAL" * 100)
    (root / "b" / "report copy.pdf").write_bytes(b"CONFIDENTIAL" * 100)
    (root / "b" / "renamed.dat").write_bytes(b"CONFIDENTIAL" * 100)
    (root / "a" / "unique.txt").write_bytes(b"one of a kind")
    (root / "b" / "same-size.txt").write_bytes(b"x" * 13)  # same size as unique


def test_scan_finds_content_duplicates(tmp_path):
    make_tree(tmp_path)
    result = scanner.scan([tmp_path])
    assert result.files_scanned == 5
    assert len(result.groups) == 1
    group = result.groups[0]
    assert len(group.paths) == 3
    assert result.duplicate_files == 2
    assert result.wasted_bytes == 2 * 1200


def test_scan_ignores_same_size_different_content(tmp_path):
    make_tree(tmp_path)
    result = scanner.scan([tmp_path])
    flagged = {p.name for g in result.groups for p in g.paths}
    assert "unique.txt" not in flagged
    assert "same-size.txt" not in flagged


def test_dedupe_dry_run_touches_nothing(tmp_path):
    make_tree(tmp_path)
    result = scanner.scan([tmp_path])
    outcome = dedupe.dedupe(result.groups, apply=False)
    assert len(outcome.removed) == 2
    assert all(p.exists() for g in result.groups for p in g.paths)


def test_dedupe_apply_removes_redundant_copies(tmp_path):
    make_tree(tmp_path)
    result = scanner.scan([tmp_path])
    outcome = dedupe.dedupe(result.groups, apply=True)
    assert len(outcome.removed) == 2
    assert outcome.bytes_reclaimed == 2 * 1200
    survivors = [p for g in result.groups for p in g.paths if p.exists()]
    assert len(survivors) == 1
    # Rescan confirms clean.
    assert scanner.scan([tmp_path]).groups == []


def test_dedupe_quarantine_moves_instead_of_deleting(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    make_tree(data)
    quarantine = tmp_path / "quarantine"
    result = scanner.scan([data])
    outcome = dedupe.dedupe(result.groups, apply=True, quarantine=quarantine)
    assert len(outcome.removed) == 2
    moved = list(quarantine.rglob("*.*"))
    assert len([p for p in moved if p.is_file()]) == 2


def test_keep_policies(tmp_path):
    import os
    old = tmp_path / "old.bin"
    new = tmp_path / "new.bin"
    old.write_bytes(b"payload")
    new.write_bytes(b"payload")
    os.utime(old, (1000, 1000))
    os.utime(new, (2000, 2000))
    group = scanner.scan([tmp_path]).groups[0]
    assert dedupe.choose_keeper(group, "oldest") == old
    assert dedupe.choose_keeper(group, "newest") == new
