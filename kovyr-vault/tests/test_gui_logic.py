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


def test_build_default_config_derives_paths():
    base = gui.Path("/base")
    config = gui.build_default_config("Acme", ["/data"], base=base)
    assert config["client"] == "Acme"
    assert config["paths"] == ["/data"]
    # Compare via Path so separators match on every platform.
    assert config["state"] == str(base / "state.json")
    assert config["vault"] == str(base / "vault")
    assert config["html"] == str(base / "latest-report.html")


def test_save_config_roundtrip(tmp_path):
    config = gui.build_default_config("Acme", ["/data"], base=tmp_path)
    target = tmp_path / "nested" / "config.json"
    gui.save_config(target, config)
    assert gui.load_config(target) == config


def test_config_falls_back_to_app_support(tmp_path, monkeypatch):
    support = tmp_path / "support" / "config.json"
    support.parent.mkdir(parents=True)
    write_config(support)
    monkeypatch.setattr(gui, "app_support_config_path", lambda: support)
    monkeypatch.chdir(tmp_path)  # no config.json in cwd
    assert gui.default_config_path() == support


def test_config_prefers_cwd_when_present(tmp_path, monkeypatch):
    support = tmp_path / "support" / "config.json"
    monkeypatch.setattr(gui, "app_support_config_path", lambda: support)
    monkeypatch.chdir(tmp_path)
    # Neither exists: default stays the first candidate (app support here,
    # since we're not frozen and it comes before cwd in the search).
    assert gui.default_config_path() == support
    write_config(tmp_path / "config.json")
    assert gui.default_config_path() == tmp_path / "config.json"


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


def test_restore_single_file_lands_flat(tmp_path):
    targets = gui.plan_restore_targets(["/data/reports/customers.csv"],
                                       tmp_path)
    assert targets == {"/data/reports/customers.csv":
                       tmp_path / "customers.csv"}


def test_restore_single_file_collision_mirrors(tmp_path):
    (tmp_path / "customers.csv").write_text("already here")
    targets = gui.plan_restore_targets(["/data/reports/customers.csv"],
                                       tmp_path)
    assert targets["/data/reports/customers.csv"] == \
        tmp_path / "data" / "reports" / "customers.csv"


def test_restore_multiple_files_mirror_paths(tmp_path):
    names = ["/a/invoice.pdf", "/b/invoice.pdf"]
    targets = gui.plan_restore_targets(names, tmp_path)
    assert targets["/a/invoice.pdf"] == tmp_path / "a" / "invoice.pdf"
    assert targets["/b/invoice.pdf"] == tmp_path / "b" / "invoice.pdf"
    assert len(set(targets.values())) == 2  # never collide


def test_status_existing_dupes_not_drift():
    g = {"sha256": "ab" * 32, "size": 100, "count": 2, "paths": ["/a", "/b"]}
    history = [snapshot(dupes=1, wasted=100, groups=[g]),
               snapshot(dupes=1, wasted=100, groups=[g])]
    summary = gui.status_summary(history)
    assert summary["clean"] is False
    assert summary["new_groups"] == 0
