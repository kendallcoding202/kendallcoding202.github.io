"""Recurring monitoring: snapshot scans over time and detect drift.

Each run scans the watched paths, compares against the previous snapshot
in the state file, and records the result. New duplicate content appearing
between runs is "drift" — the signal that copies are creeping back and the
client needs another cleanup pass.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .scanner import ScanResult

STATE_VERSION = 1
MAX_HISTORY = 104  # two years of weekly runs


@dataclass
class Drift:
    new_groups: list[dict] = field(default_factory=list)
    resolved_groups: list[dict] = field(default_factory=list)

    @property
    def has_new(self) -> bool:
        return bool(self.new_groups)


def snapshot_from_scan(result: ScanResult, timestamp: str) -> dict:
    return {
        "timestamp": timestamp,
        "files_scanned": result.files_scanned,
        "bytes_scanned": result.bytes_scanned,
        "duplicate_files": result.duplicate_files,
        "wasted_bytes": result.wasted_bytes,
        "groups": [
            {
                "sha256": g.sha256,
                "size": g.size,
                "count": len(g.paths),
                "paths": [str(p) for p in g.paths],
            }
            for g in result.groups
        ],
    }


def load_history(state_path: Path) -> list[dict]:
    if not state_path.exists():
        return []
    data = json.loads(state_path.read_text())
    if data.get("version") != STATE_VERSION:
        raise ValueError(
            f"unsupported monitor state version in {state_path}"
        )
    return data["history"]


def save_history(state_path: Path, history: list[dict]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": STATE_VERSION, "history": history[-MAX_HISTORY:]}
    state_path.write_text(json.dumps(payload, indent=2))


def diff(previous: dict | None, current: dict) -> Drift:
    """Compare two snapshots by duplicate-group content hash."""
    if previous is None:
        return Drift()
    prev_shas = {g["sha256"] for g in previous["groups"]}
    curr_shas = {g["sha256"] for g in current["groups"]}
    return Drift(
        new_groups=[g for g in current["groups"]
                    if g["sha256"] not in prev_shas],
        resolved_groups=[g for g in previous["groups"]
                         if g["sha256"] not in curr_shas],
    )


def record_run(state_path: Path, result: ScanResult,
               timestamp: str) -> tuple[dict, Drift, list[dict]]:
    """Scan already done — compare, append, persist.

    Returns (snapshot, drift, full history including this run).
    """
    history = load_history(state_path)
    snapshot = snapshot_from_scan(result, timestamp)
    drift = diff(history[-1] if history else None, snapshot)
    history.append(snapshot)
    save_history(state_path, history)
    return snapshot, drift, history
