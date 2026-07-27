"""Tamper-evident audit log for the vault (Phase 1).

An append-only JSONL log at <vault>/audit.jsonl. Every vault operation
records one entry, and each entry carries a SHA-256 hash chaining it to
the previous one — so removing, reordering, or editing any past entry
breaks the chain and `verify_log` pinpoints where.

Entries reference file names/ids and byte counts only — never decrypted
content. Actor context (OS user, host, pid) is best-effort and derived
from the standard library; a failure to gather it never blocks the log.
"""

from __future__ import annotations

import hashlib
import json
import os
import socket
from pathlib import Path

from .util import now_iso

AUDIT_LOG_NAME = "audit.jsonl"
LEGACY_ACCESS_LOG = "access.log"
LEGACY_MIGRATED = "access.log.migrated"
GENESIS = "0" * 64

# Controlled event vocabulary (dotted so rules can match on prefixes).
EV_UNLOCK_OK = "vault.unlock.ok"
EV_UNLOCK_FAIL = "vault.unlock.failed"
EV_LOCK = "vault.lock"
EV_LOCK_AUTO = "vault.lock.auto"
EV_FILE_ADD = "file.add"
EV_FILE_EXPORT = "file.export"      # explicit restore-to-disk only
EV_FILE_DELETE = "file.delete"
EV_FILE_PURGE = "file.purge"
EV_FILE_VERSION_RESTORE = "file.version.restore"
EV_QUARANTINE_ADD = "quarantine.add"
EV_QUARANTINE_RESTORE = "quarantine.restore"
EV_QUARANTINE_PURGE = "quarantine.purge"
EV_CONFIG_CHANGE = "config.change"
EV_REPORT = "report.generate"
EV_BACKUP = "backup.run"


def file_id(name: str) -> str:
    """A stable, non-reversible id for a vault filename. The audit log
    records this instead of the cleartext name, so the log preserves the
    vault's 'filenames are encrypted at rest' property. The Phase 5
    report resolves ids back to names while the vault is unlocked."""
    return hashlib.sha256(str(name).encode("utf-8")).hexdigest()[:16]


def _canonical(entry: dict) -> str:
    """Deterministic serialization of an entry EXCLUDING its own hash."""
    body = {k: v for k, v in entry.items() if k != "hash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def _chain_hash(entry: dict) -> str:
    return hashlib.sha256(_canonical(entry).encode("utf-8")).hexdigest()


def _actor() -> dict:
    try:
        user = os.environ.get("USER") or os.environ.get("USERNAME") or "?"
    except Exception:
        user = "?"
    try:
        host = socket.gethostname()
    except Exception:
        host = "?"
    return {"os_user": user, "host": host, "pid": os.getpid()}


def _read_last_entry(path: Path) -> dict | None:
    """Last JSON entry without loading the whole file (tail read)."""
    if not path.exists() or path.stat().st_size == 0:
        return None
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        end = f.tell()
        block = min(8192, end)
        f.seek(end - block)
        tail = f.read().decode("utf-8", errors="replace")
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    if not lines:
        return None
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return None


def _append(path: Path, event: str, target, result: str,
            nbytes: int | None, detail: dict | None) -> dict:
    last = _read_last_entry(path)
    prev = last["hash"] if last else GENESIS
    seq = (last["seq"] + 1) if last else 1
    entry: dict = {
        "seq": seq,
        "ts": now_iso(),
        "event": event,
        "actor": _actor(),
        "result": result,
    }
    if target is not None:
        entry["target"] = str(target)
    if nbytes is not None:
        entry["bytes"] = int(nbytes)
    if detail:
        entry["detail"] = detail
    entry["prev"] = prev
    entry["hash"] = _chain_hash(entry)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def _migrate_legacy(root: Path) -> None:
    """Fold a pre-existing plain-text access.log into the chain's start,
    once. Runs before the first modern append so unlock history survives."""
    legacy = root / LEGACY_ACCESS_LOG
    audit = root / AUDIT_LOG_NAME
    if not legacy.exists() or audit.exists():
        return
    mapping = {"UNLOCK_OK": EV_UNLOCK_OK, "FAILED_UNLOCK": EV_UNLOCK_FAIL}
    try:
        lines = legacy.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        ts, raw = parts
        event = mapping.get(raw.strip())
        if not event:
            continue
        last = _read_last_entry(audit)
        prev = last["hash"] if last else GENESIS
        seq = (last["seq"] + 1) if last else 1
        entry = {"seq": seq, "ts": ts, "event": event,
                 "actor": {"os_user": "?", "host": "?", "pid": 0},
                 "result": "ok" if event == EV_UNLOCK_OK else "fail",
                 "detail": {"migrated": True}, "prev": prev}
        entry["hash"] = _chain_hash(entry)
        with open(audit, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    try:
        legacy.rename(root / LEGACY_MIGRATED)  # keep, don't destroy
    except OSError:
        pass


def record(root, event: str, *, target=None, result: str = "ok",
           nbytes: int | None = None, detail: dict | None = None) -> dict | None:
    """Append one audit entry. Best-effort: logging must never break the
    operation it records."""
    try:
        root = Path(root)
        _migrate_legacy(root)
        return _append(root / AUDIT_LOG_NAME, event, target, result,
                       nbytes, detail)
    except OSError:
        return None


def read_all(root) -> list[dict]:
    path = Path(root) / AUDIT_LOG_NAME
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def verify_log(root) -> dict:
    """Walk the whole chain. Returns {ok, entries, broken_seq, reason}."""
    entries = read_all(root)
    prev = GENESIS
    for entry in entries:
        if entry.get("prev") != prev:
            return {"ok": False, "entries": len(entries),
                    "broken_seq": entry.get("seq"),
                    "reason": "prev-hash does not match preceding entry"}
        if _chain_hash(entry) != entry.get("hash"):
            return {"ok": False, "entries": len(entries),
                    "broken_seq": entry.get("seq"),
                    "reason": "entry hash does not match its contents"}
        prev = entry["hash"]
    return {"ok": True, "entries": len(entries), "broken_seq": None,
            "reason": ""}


def count_events(root, event_prefix: str) -> int:
    return sum(1 for e in read_all(root)
               if str(e.get("event", "")).startswith(event_prefix))
