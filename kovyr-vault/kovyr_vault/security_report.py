"""The client-facing encryption & access summary.

Turns the audit log + version state into a plain-English section showing
vault access activity, log-chain verification, and retention status — the
encryption evidence that supports a firm's compliance program. (The WISP
or HIPAA compliance documentation itself is produced by the Kovyr platform,
not here.) No jargon, no decrypted content — file references resolve to
names only when the vault is unlocked to build the report.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from . import audit

# Human labels for the event vocabulary.
EVENT_LABELS = {
    audit.EV_UNLOCK_OK: "Vault unlocked",
    audit.EV_UNLOCK_FAIL: "Failed unlock attempt",
    audit.EV_LOCK: "Vault locked",
    audit.EV_LOCK_AUTO: "Vault auto-locked",
    audit.EV_FILE_ADD: "File encrypted into vault",
    audit.EV_FILE_EXPORT: "File exported (decrypted out)",
    audit.EV_FILE_DELETE: "File deleted (recoverable)",
    audit.EV_FILE_PURGE: "Old versions purged",
    audit.EV_FILE_VERSION_RESTORE: "Previous version restored",
    audit.EV_BACKUP: "Vault backed up",
    audit.EV_REPORT: "Report generated",
}


def summarize(vault_root, since: str | None = None) -> dict:
    """Build the security-summary data. `since` (ISO prefix, e.g.
    '2026-07') filters to that period for the monthly artifact."""
    entries = audit.read_all(vault_root)
    if since:
        entries = [e for e in entries if str(e.get("ts", "")) >= since]

    counts = Counter(e.get("event") for e in entries)
    verify = audit.verify_log(vault_root)

    return {
        "entries": len(entries),
        "counts": {EVENT_LABELS.get(ev, ev): n
                   for ev, n in counts.most_common()},
        "unlocks": counts.get(audit.EV_UNLOCK_OK, 0),
        "failed_unlocks": counts.get(audit.EV_UNLOCK_FAIL, 0),
        "files_added": counts.get(audit.EV_FILE_ADD, 0),
        "files_exported": counts.get(audit.EV_FILE_EXPORT, 0),
        "files_deleted": counts.get(audit.EV_FILE_DELETE, 0),
        "log_verified": verify["ok"],
        "log_broken_at": verify["broken_seq"],
        "log_entries_total": verify["entries"],
    }


def render_security_section(summary: dict) -> str:
    """HTML fragment for the report's Security section (client-facing)."""
    from html import escape

    def _esc(v):
        return escape(str(v))

    if summary["log_verified"]:
        chain = ('<span class="status-good">&#10003; Audit log verified '
                 'intact</span> — the complete, tamper-evident record of '
                 f'every vault action ({summary["log_entries_total"]} '
                 'entries) is unbroken.')
    else:
        chain = ('<span class="status-bad">&#9888; Audit log integrity '
                 f'FAILED at entry #{summary["log_broken_at"]}</span> — the '
                 'record may have been altered; investigate immediately.')

    rows = "".join(
        f'<tr><td>{_esc(label)}</td><td class="num">{_esc(n)}</td></tr>'
        for label, n in summary["counts"].items())

    return (
        "<h2>Security &amp; access activity</h2>"
        f"<p>{chain}</p>"
        '<div class="tiles">'
        + _sec_tile("Vault unlocks", summary["unlocks"])
        + _sec_tile("Failed unlocks", summary["failed_unlocks"],
                    bad=summary["failed_unlocks"] > 0)
        + _sec_tile("Files encrypted", summary["files_added"])
        + _sec_tile("Files exported", summary["files_exported"])
        + "</div>"
        + ("<table><tr><th>Activity</th><th class=\"num\">Count</th></tr>"
           f"{rows}</table>" if rows else "")
        + '<p class="note">Deleted and overwritten files are kept '
        "recoverable for the retention window (default 30 days) before "
        "they can be permanently purged — so an accidental deletion or a "
        "ransomware overwrite can be rolled back. File contents are never "
        "recorded in this log; only actions, counts, and timestamps.</p>"
    )


def _sec_tile(label: str, value, bad: bool = False) -> str:
    cls = "status-bad" if bad else ""
    return (f'<div class="tile"><div class="label">{label}</div>'
            f'<div class="value {cls}">{value}</div></div>')
