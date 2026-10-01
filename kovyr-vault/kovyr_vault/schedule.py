"""Register a daily protection check with the operating system.

Monitoring that only runs when somebody remembers to click is not
monitoring. The canary compares each scan against the *previous* one, so
if a practice opens the app once a month, a ransomware event is noticed up
to a month late — which is to say, not noticed.

This registers a per-user scheduled job with the OS so the check happens
on its own: a LaunchAgent on macOS, a Scheduled Task on Windows. Per-user
on purpose — the job needs the same file access and the same home
directory as the person whose data is being protected, so it runs as them
and never as SYSTEM or root.

What gets scheduled is the app's own `--check` mode, not the CLI tool. The
Windows installer lays down both binaries, but the macOS disk image ships
only the .app, so the CLI cannot be assumed present on a client Mac. The
app is the one thing guaranteed to be there on both.

Every OS call goes through an injectable runner, so the plist contents,
the schtasks arguments and all four refusal paths are unit-tested without
a real Mac or PC.
"""

from __future__ import annotations

import plistlib
import subprocess
import sys
from pathlib import Path

LABEL = "com.kovyr.vault.check"
TASK_NAME = "Kovyr Vault Daily Check"

# Not on the hour or the half hour: those minutes are crowded with other
# software's scheduled work, and a check that contends for the disk during
# a backup window just looks like the app is slow.
DEFAULT_HOUR = 12
DEFAULT_MINUTE = 40


class ScheduleError(Exception):
    """The scheduled job could not be created or removed."""


def _run(cmd: list[str], timeout: int = 30) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


def supported(platform: str | None = None) -> bool:
    """Whether a daily check can be registered here."""
    return (platform or sys.platform) in ("darwin", "win32")


# ---------- macOS: a per-user LaunchAgent ----------

def agent_path(home: Path | None = None) -> Path:
    return ((home or Path.home()) / "Library" / "LaunchAgents"
            / f"{LABEL}.plist")


def agent_plist(command: list[str], hour: int, minute: int) -> bytes:
    """The LaunchAgent definition.

    RunAtLoad is deliberately False: logging in should not trigger a scan
    that competes with everything else starting up. StartCalendarInterval
    alone also means launchd runs a missed job once the Mac wakes, so a
    laptop that was closed at the scheduled time still gets checked.
    """
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": list(command),
        "StartCalendarInterval": {"Hour": hour, "Minute": minute},
        "RunAtLoad": False,
        "ProcessType": "Background",
    })


def _install_macos(command, hour, minute, run, home) -> None:
    path = agent_path(home)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(agent_plist(command, hour, minute))
    except OSError as exc:
        raise ScheduleError(
            f"could not write the scheduled job to {path}: {exc}") from exc
    # Unload first so a changed schedule replaces the old one rather than
    # erroring with "service already loaded".
    run(["launchctl", "unload", str(path)])
    code, out = run(["launchctl", "load", str(path)])
    if code != 0:
        path.unlink(missing_ok=True)
        raise ScheduleError(
            f"macOS refused to register the daily check: {out.strip()}")


def _uninstall_macos(run, home) -> None:
    path = agent_path(home)
    run(["launchctl", "unload", str(path)])
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        raise ScheduleError(f"could not remove {path}: {exc}") from exc


def _installed_macos(run, home) -> bool:
    return agent_path(home).exists()


# ---------- Windows: a per-user Scheduled Task ----------

def _task_command(command: list[str]) -> str:
    """schtasks takes the whole command as one string, so quote the
    executable — "C:\\Program Files\\..." splits on the space otherwise."""
    exe, *rest = command
    return " ".join([f'"{exe}"', *rest])


def _install_windows(command, hour, minute, run) -> None:
    code, out = run([
        "schtasks", "/Create", "/TN", TASK_NAME,
        "/TR", _task_command(command),
        "/SC", "DAILY", "/ST", f"{hour:02d}:{minute:02d}",
        "/F",                      # replace an existing task of this name
    ])
    if code != 0:
        raise ScheduleError(
            f"Windows refused to register the daily check: {out.strip()}")


def _uninstall_windows(run) -> None:
    code, out = run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    # Deleting a task that was never there is success, not failure.
    if code != 0 and "cannot find" not in out.lower():
        raise ScheduleError(
            f"could not remove the daily check: {out.strip()}")


def _installed_windows(run) -> bool:
    code, _out = run(["schtasks", "/Query", "/TN", TASK_NAME])
    return code == 0


# ---------- the platform-agnostic surface ----------

def install(command: list[str], hour: int = DEFAULT_HOUR,
            minute: int = DEFAULT_MINUTE, run=None,
            platform: str | None = None, home: Path | None = None) -> None:
    """Register `command` to run once a day. Replaces any existing job."""
    run = run or _run
    system = platform or sys.platform
    if not command:
        raise ScheduleError("no command to schedule")
    if system == "darwin":
        _install_macos(command, hour, minute, run, home)
    elif system == "win32":
        _install_windows(command, hour, minute, run)
    else:
        raise ScheduleError(
            "automatic daily checks are available on macOS and Windows only")


def uninstall(run=None, platform: str | None = None,
              home: Path | None = None) -> None:
    run = run or _run
    system = platform or sys.platform
    if system == "darwin":
        _uninstall_macos(run, home)
    elif system == "win32":
        _uninstall_windows(run)


def installed(run=None, platform: str | None = None,
              home: Path | None = None) -> bool:
    run = run or _run
    system = platform or sys.platform
    if system == "darwin":
        return _installed_macos(run, home)
    if system == "win32":
        return _installed_windows(run)
    return False


def describe(hour: int = DEFAULT_HOUR, minute: int = DEFAULT_MINUTE) -> str:
    """Plain-English schedule, for the Settings tab."""
    suffix = "am" if hour < 12 else "pm"
    display = hour if 1 <= hour <= 12 else abs(hour - 12) or 12
    return ("Checks run automatically every day at "
            f"{display}:{minute:02d}{suffix}.")
