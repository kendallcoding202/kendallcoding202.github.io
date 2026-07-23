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

from .protect_folder import waiting_files
from .scanner import ScanResult
from .vault import ACCESS_LOG_NAME, BLOB_DIR

STATE_VERSION = 1
MAX_HISTORY = 104  # two years of weekly runs

# Canary thresholds — deliberately conservative so a client reorganizing
# folders never trips them. Alert only when MOST previously-seen files
# vanished at once and a comparable wave of new files replaced them
# (the mass rename/re-encrypt footprint), or when the vault's immutable
# blobs changed, and only for estates big enough to be meaningful.
CANARY_MIN_FILES = 20
CANARY_DISAPPEARED_FRAC = 0.6
CANARY_REPLACED_FRAC = 0.5


@dataclass
class Drift:
    new_groups: list[dict] = field(default_factory=list)
    resolved_groups: list[dict] = field(default_factory=list)

    @property
    def has_new(self) -> bool:
        return bool(self.new_groups)


def count_failed_unlocks(vault_root: Path) -> int:
    """Total FAILED_UNLOCK events in the vault's access log."""
    log = vault_root / ACCESS_LOG_NAME
    if not log.exists():
        return 0
    try:
        return sum(1 for line in log.read_text(encoding="utf-8").splitlines()
                   if line.endswith("FAILED_UNLOCK"))
    except OSError:
        return 0


def blob_inventory(vault_root: Path) -> dict[str, int]:
    """Sizes of the vault's encrypted blobs, keyed by relative path.

    Blobs are content-addressed and write-once: once written they never
    legitimately change or disappear, so any difference between runs is
    tamper evidence — readable without the vault key.
    """
    blobs_dir = vault_root / BLOB_DIR
    if not blobs_dir.is_dir():
        return {}
    out: dict[str, int] = {}
    for path in blobs_dir.rglob("*.kvb"):
        try:
            out[str(path.relative_to(vault_root))] = path.stat().st_size
        except OSError:
            continue
    return out


def canary_check(prev_inventory: dict[str, int] | None,
                 curr_inventory: dict[str, int],
                 prev_blobs: dict[str, int] | None,
                 curr_blobs: dict[str, int] | None) -> list[str]:
    """Return alert reasons for mass-change / vault-tamper signatures."""
    alerts: list[str] = []

    if prev_inventory and len(prev_inventory) >= CANARY_MIN_FILES:
        disappeared = set(prev_inventory) - set(curr_inventory)
        appeared = set(curr_inventory) - set(prev_inventory)
        frac_gone = len(disappeared) / len(prev_inventory)
        if (frac_gone >= CANARY_DISAPPEARED_FRAC
                and len(appeared) >= CANARY_REPLACED_FRAC * len(disappeared)):
            alerts.append(
                f"unusual mass file activity: {len(disappeared)} of "
                f"{len(prev_inventory)} watched files disappeared and "
                f"{len(appeared)} new files appeared since the last check"
            )

    if prev_blobs and curr_blobs is not None:
        missing = set(prev_blobs) - set(curr_blobs)
        changed = [b for b in set(prev_blobs) & set(curr_blobs)
                   if prev_blobs[b] != curr_blobs[b]]
        if missing or changed:
            alerts.append(
                f"vault integrity concern: {len(missing)} encrypted blobs "
                f"missing and {len(changed)} changed size — vault files "
                f"never legitimately change after being written"
            )
    return alerts


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


def load_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {"version": STATE_VERSION, "history": []}
    data = json.loads(state_path.read_text())
    if data.get("version") != STATE_VERSION:
        raise ValueError(
            f"unsupported monitor state version in {state_path}"
        )
    data.setdefault("history", [])
    return data


def load_history(state_path: Path) -> list[dict]:
    return load_state(state_path)["history"]


def save_state(state_path: Path, state: dict) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state["version"] = STATE_VERSION
    state["history"] = state["history"][-MAX_HISTORY:]
    state_path.write_text(json.dumps(state, indent=2))


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


def record_run(state_path: Path, result: ScanResult, timestamp: str,
               vault: Path | None = None,
               protected: list[Path] | None = None,
               ) -> tuple[dict, Drift, list[dict]]:
    """Scan already done — compare, append, persist.

    With a vault path, also tracks failed unlock attempts and the
    vault's immutable blob set for tamper evidence. Returns
    (snapshot, drift, full history including this run); the snapshot
    carries `canary_alerts` and `new_failed_unlocks`.
    """
    state = load_state(state_path)
    history = state["history"]
    previous = history[-1] if history else None
    snapshot = snapshot_from_scan(result, timestamp)

    curr_blobs = blob_inventory(vault) if vault else None
    snapshot["canary_alerts"] = canary_check(
        state.get("inventory"), result.inventory,
        state.get("vault_blobs"), curr_blobs,
    )

    failed_total = count_failed_unlocks(vault) if vault else 0
    prev_failed = (previous or {}).get("failed_unlocks", 0) or 0
    snapshot["failed_unlocks"] = failed_total
    snapshot["new_failed_unlocks"] = max(failed_total - prev_failed, 0)

    if protected:
        snapshot["awaiting_encryption"] = len(
            waiting_files(protected, exclude=vault))

    drift = diff(previous, snapshot)
    history.append(snapshot)
    state["inventory"] = result.inventory
    if curr_blobs is not None:
        state["vault_blobs"] = curr_blobs
    save_state(state_path, state)
    return snapshot, drift, history
