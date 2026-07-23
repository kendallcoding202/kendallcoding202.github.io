"""Native desktop notifications for alert-worthy check results.

Best-effort by design: a notification that can't be shown must never
break a check. Notifies only on NEW signals (canary alerts, fresh
failed-unlock attempts, new duplicate drift) — standing conditions like
existing duplicates stay in the app and report, so weekly checks don't
nag about old news.
"""

from __future__ import annotations

import subprocess
import sys

TITLE = "Kovyr Vault"


def compose_alert(snapshot: dict, new_groups: int) -> str | None:
    """The one-line notification for a check's outcome, or None when
    nothing new deserves a shoulder tap. Most-serious signal wins."""
    if snapshot.get("canary_alerts"):
        return ("Attention needed: unusual file activity detected — "
                "open Kovyr Vault.")
    failed = snapshot.get("new_failed_unlocks") or 0
    if failed:
        return (f"{failed} failed vault unlock attempt"
                f"{'' if failed == 1 else 's'} since the last check — "
                "open Kovyr Vault.")
    if new_groups:
        return (f"{new_groups} new duplicate group"
                f"{'' if new_groups == 1 else 's'} appeared — review "
                "in Kovyr Vault.")
    return None


def _sanitize(text: str, limit: int = 240) -> str:
    """Strip control/quote characters and cap length before the text
    reaches a shell interpreter. Defense in depth: alert text is
    app-generated today, but future callers could pass filenames, so
    the transport must not depend on the caller being trusted."""
    cleaned = "".join(c for c in text
                      if c.isprintable() and c not in '"\'`\\')
    return cleaned[:limit]


def send(message: str, title: str = TITLE) -> bool:
    """Show a native notification; returns False when it couldn't."""
    try:
        message = _sanitize(message)
        title = _sanitize(title)
        if sys.platform == "darwin":
            script = (f'display notification "{message}" '
                      f'with title "{title}"')
            subprocess.run(["osascript", "-e", script],
                           timeout=10, check=True,
                           capture_output=True)
            return True
        if sys.platform.startswith("win"):
            safe_msg = message
            safe_title = title
            ps = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "Add-Type -AssemblyName System.Drawing;"
                "$n = New-Object System.Windows.Forms.NotifyIcon;"
                "$n.Icon = [System.Drawing.SystemIcons]::Information;"
                "$n.Visible = $true;"
                f"$n.BalloonTipTitle = '{safe_title}';"
                f"$n.BalloonTipText = '{safe_msg}';"
                "$n.ShowBalloonTip(10000);"
                "Start-Sleep -Seconds 6;"
                "$n.Dispose()"
            )
            subprocess.Popen(
                ["powershell", "-NoProfile", "-WindowStyle", "Hidden",
                 "-Command", ps],
                creationflags=getattr(subprocess,
                                      "CREATE_NO_WINDOW", 0))
            return True
        # Linux and friends: notify-send when present.
        subprocess.run(["notify-send", title, message],
                       timeout=10, check=True, capture_output=True)
        return True
    except Exception:
        return False
