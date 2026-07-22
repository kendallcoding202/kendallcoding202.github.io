"""Tests for the GUI's non-graphical logic (config + status derivation).

The widget layer itself is exercised by --selftest in the Windows build
workflow, where a display is available.
"""

import json

import pytest

from kovyr_vault import gui


def write_config(path, **overrides):
    config = {
        "client": "Acme Dental",
        "paths": ["/data"],
        "state": "/kovyr/state.json",
        "html": "/kovyr/latest.html",
        "vault": "/kovyr/vault",
    }
    config.update(overrides)
    path.write_text(json.dumps(config))
    return config


def test_load_config_roundtrip(tmp_path):
    expected = write_config(tmp_path / "config.json")
    assert gui.load_config(tmp_path / "config.json") == expected


def test_load_config_requires_paths(tmp_path):
    write_config(tmp_path / "config.json", paths=[])
    with pytest.raises(ValueError):
        gui.load_config(tmp_path / "config.json")


def test_load_config_requires_state(tmp_path):
    write_config(tmp_path / "config.json", state="")
    with pytest.raises(ValueError):
        gui.load_config(tmp_path / "config.json")


def snapshot(dupes=0, wasted=0, groups=(), ts="2026-07-22 00:00 UTC"):
    return {
        "timestamp": ts,
        "files_scanned": 10,
        "bytes_scanned": 1000,
        "duplicate_files": dupes,
        "wasted_bytes": wasted,
        "groups": list(groups),
    }


def test_status_empty_history():
    assert gui.status_summary([]) == {"configured": False}


def test_status_clean():
    summary = gui.status_summary([snapshot()])
    assert summary["clean"] is True
    assert summary["duplicates"] == 0


def test_status_flags_drift():
    g = {"sha256": "ab" * 32, "size": 100, "count": 2, "paths": ["/a", "/b"]}
    history = [snapshot(), snapshot(dupes=1, wasted=100, groups=[g])]
    summary = gui.status_summary(history)
    assert summary["clean"] is False
    assert summary["new_groups"] == 1


def test_status_existing_dupes_not_drift():
    g = {"sha256": "ab" * 32, "size": 100, "count": 2, "paths": ["/a", "/b"]}
    history = [snapshot(dupes=1, wasted=100, groups=[g]),
               snapshot(dupes=1, wasted=100, groups=[g])]
    summary = gui.status_summary(history)
    assert summary["clean"] is False
    assert summary["new_groups"] == 0
