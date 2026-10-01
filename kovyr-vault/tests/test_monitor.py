from pathlib import Path

from kovyr_vault import monitor, scanner


def write_dupes(root: Path, name: str, content: bytes, copies: int) -> None:
    for i in range(copies):
        (root / f"{name}-{i}").write_bytes(content)


def test_first_run_is_baseline(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    write_dupes(data, "a", b"copy me", 2)
    state = tmp_path / "state.json"

    result = scanner.scan([data])
    snapshot, drift, history = monitor.record_run(state, result, "t1")
    assert snapshot["duplicate_files"] == 1
    assert not drift.has_new
    assert len(history) == 1
    assert state.exists()


def test_new_duplicates_detected_as_drift(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    write_dupes(data, "a", b"copy me", 2)
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    write_dupes(data, "b", b"new leak", 3)
    _snap, drift, history = monitor.record_run(state, scanner.scan([data]), "t2")

    assert drift.has_new
    assert len(drift.new_groups) == 1
    assert drift.new_groups[0]["count"] == 3
    assert len(history) == 2


def test_cleanup_detected_as_resolved(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    write_dupes(data, "a", b"copy me", 2)
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    (data / "a-1").unlink()
    _snap, drift, _ = monitor.record_run(state, scanner.scan([data]), "t2")

    assert not drift.has_new
    assert len(drift.resolved_groups) == 1


def test_unchanged_state_no_drift(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    write_dupes(data, "a", b"copy me", 2)
    state = tmp_path / "state.json"

    monitor.record_run(state, scanner.scan([data]), "t1")
    _snap, drift, _ = monitor.record_run(state, scanner.scan([data]), "t2")
    assert not drift.has_new
    assert not drift.resolved_groups


def test_history_is_capped(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    state = tmp_path / "state.json"
    result = scanner.scan([data])
    for i in range(monitor.MAX_HISTORY + 5):
        monitor.record_run(state, result, f"t{i}")
    assert len(monitor.load_history(state)) == monitor.MAX_HISTORY


# ---------- in-place encryption: the canary's old blind spot ----------

def _inventory(count, size=10_000, prefix="/data/file"):
    return {f"{prefix}{i}.pdf": size for i in range(count)}


def test_canary_catches_encryption_that_keeps_filenames():
    """The original canary compared file NAMES, so a strain that encrypts
    in place — same names, different contents — left the path set
    identical and slipped straight past it."""
    before = _inventory(40)
    after = {name: 10_000 + 2048 for name in before}   # same names, rewritten

    alerts = monitor.canary_check(before, after, None, None)
    assert alerts
    assert any("changed size at once" in a for a in alerts)


def test_canary_ignores_an_ordinary_working_day():
    """A few files edited between checks must never read as ransomware."""
    before = _inventory(40)
    after = dict(before)
    for i in range(6):                      # 15% of the folder edited
        after[f"/data/file{i}.pdf"] = 11_500
    assert monitor.canary_check(before, after, None, None) == []


def test_canary_ignores_tiny_size_drift():
    """Timestamps and metadata nudge sizes by a few bytes. If that counted,
    every check on a busy folder would cry wolf."""
    before = _inventory(40)
    after = {name: size + 4 for name, size in before.items()}
    assert monitor.canary_check(before, after, None, None) == []


def test_canary_needs_enough_files_to_judge():
    """Three files all changing is a person working, not an incident."""
    before = _inventory(3)
    after = {name: 99_000 for name in before}
    assert monitor.canary_check(before, after, None, None) == []


def test_rename_and_in_place_signatures_are_both_reported():
    """A strain that renames some files and rewrites others should trip
    both halves rather than hiding in between them."""
    before = _inventory(40)
    after = {f"/data/file{i}.pdf.locked": 12_500 for i in range(30)}
    after.update({f"/data/file{i}.pdf": 12_500 for i in range(30, 40)})
    alerts = monitor.canary_check(before, after, None, None)
    assert any("disappeared" in a for a in alerts)
