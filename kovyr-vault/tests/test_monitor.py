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
