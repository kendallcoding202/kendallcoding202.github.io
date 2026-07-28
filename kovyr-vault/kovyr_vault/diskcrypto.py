"""Full-disk encryption status check (FileVault on macOS, BitLocker on
Windows).

The security assessment asks "is data encrypted at rest?" The vault
answers that at the file level; this answers it at the whole-disk level:
is FileVault / BitLocker turned on for the system drive. It is strictly
read-only — it runs the operating system's own status tool and parses the
result, and never changes a setting. When it can't tell (tool missing,
needs elevation, or an unsupported platform) it reports "unknown" rather
than guessing on/off.

The command runner is injectable so the platform parsing is testable
without a real macOS or Windows machine.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass

FEATURE_NAMES = {"macos": "FileVault", "windows": "BitLocker"}


@dataclass
class DiskStatus:
    platform: str            # "macos" | "windows" | "linux" | "unknown"
    tool: str                # the OS tool consulted, or "" when none
    encrypted: bool | None   # True = on, False = off, None = couldn't tell
    detail: str              # short, plain-English explanation

    @property
    def known(self) -> bool:
        return self.encrypted is not None

    @property
    def feature(self) -> str:
        return FEATURE_NAMES.get(self.platform, "Full-disk encryption")

    def as_dict(self) -> dict:
        return {
            "platform": self.platform,
            "tool": self.tool,
            "encrypted": self.encrypted,
            "detail": self.detail,
            "feature": self.feature,
        }


def _default_run(cmd: list[str]) -> tuple[int, str]:
    """Run a status command and return (returncode, combined_output).
    A failure to even launch the tool is reported as a non-zero code so
    callers fall back to 'unknown' instead of raising."""
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=15)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


def parse_fdesetup(text: str) -> bool | None:
    """`fdesetup status` prints 'FileVault is On.' / 'FileVault is Off.'
    (occasionally 'On, but decryption is paused')."""
    low = text.lower()
    if "filevault is on" in low:
        return True
    if "filevault is off" in low:
        return False
    return None


def parse_manage_bde(text: str) -> bool | None:
    """`manage-bde -status` prints a 'Protection Status: Protection On/Off'
    line for the drive."""
    low = text.lower()
    if "protection on" in low:
        return True
    if "protection off" in low:
        return False
    return None


def check(run=None, platform: str | None = None,
          system_drive: str | None = None) -> DiskStatus:
    """Assess whole-disk encryption on the current machine. `run`,
    `platform`, and `system_drive` are injectable for tests."""
    run = run or _default_run
    plat = platform or sys.platform

    if plat == "darwin":
        code, out = run(["fdesetup", "status"])
        enc = parse_fdesetup(out) if code == 0 else None
        if enc is True:
            detail = "FileVault is on — the whole disk is encrypted."
        elif enc is False:
            detail = ("FileVault is off — turn it on in System Settings "
                      "› Privacy & Security › FileVault.")
        else:
            detail = "Couldn't read FileVault status on this Mac."
        return DiskStatus("macos", "fdesetup", enc, detail)

    if plat.startswith("win") or plat == "cygwin":
        drive = system_drive or "C:"
        code, out = run(["manage-bde", "-status", drive])
        enc = parse_manage_bde(out) if code == 0 else None
        if enc is True:
            detail = (f"BitLocker is on for {drive} — the system drive is "
                      "encrypted.")
        elif enc is False:
            detail = (f"BitLocker is off for {drive} — turn it on in "
                      "Control Panel › BitLocker Drive Encryption.")
        else:
            detail = ("Couldn't read BitLocker status — it may need "
                      "administrator rights, or this edition of Windows "
                      "uses Device Encryption instead.")
        return DiskStatus("windows", "manage-bde", enc, detail)

    name = "linux" if plat.startswith("linux") else "unknown"
    return DiskStatus(name, "", None,
                      "Full-disk encryption status isn't checked on this "
                      "platform.")
