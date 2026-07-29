"""Baseline device-security posture checks.

Extends the full-disk encryption check (diskcrypto) into a small set of
read-only "is this protection turned on?" checks a client machine can
report on: disk encryption, the firewall, automatic screen lock, and
(on Windows) antivirus. Each is strictly read-only — it runs the OS's own
status tool and parses the result, never changing a setting — and reports
on / off / unknown, defaulting to "unknown" rather than guessing when a
tool is missing, needs elevation, or the output is ambiguous.

These cover the *technical, machine-level* controls only. Policy and human
controls (MFA, activity logging, individual accounts, vendor agreements,
training, insurance) cannot be reliably detected from software and stay
manual items on the assessment — this module never pretends to verify
them.

The command runner is injectable, so every parser is unit-tested without a
real macOS or Windows machine.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass

from . import diskcrypto


@dataclass
class Check:
    key: str                 # "disk" | "firewall" | "screenlock" | "antivirus"
    name: str                # human label, e.g. "Firewall"
    status: bool | None      # True = on, False = off, None = couldn't tell
    detail: str              # plain-English result + how to fix when off

    @property
    def known(self) -> bool:
        return self.status is not None

    def as_dict(self) -> dict:
        return {"key": self.key, "name": self.name,
                "status": self.status, "detail": self.detail}


def _default_run(cmd: list[str]) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=15)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


# ---------- disk encryption (wraps diskcrypto) ----------

def disk_check(run=None, platform: str | None = None) -> Check:
    ds = diskcrypto.check(run=run, platform=platform)
    return Check("disk", "Disk encryption", ds.encrypted, ds.detail)


# ---------- firewall ----------

def parse_socketfilterfw(text: str) -> bool | None:
    low = text.lower()
    if "enabled" in low:
        return True
    if "disabled" in low:
        return False
    return None


def parse_netsh_firewall(text: str) -> bool | None:
    """`netsh advfirewall show allprofiles state` prints a 'State ON/OFF'
    line per profile. On only if every profile is on."""
    states = []
    for line in text.splitlines():
        s = line.strip()
        if s.lower().startswith("state"):
            val = s.split()[-1].upper()
            if val in ("ON", "OFF"):
                states.append(val)
    if not states:
        return None
    return all(v == "ON" for v in states)


def firewall_check(run=None, platform: str | None = None) -> Check:
    run = run or _default_run
    plat = platform or sys.platform
    if plat == "darwin":
        code, out = run(["/usr/libexec/ApplicationFirewall/socketfilterfw",
                         "--getglobalstate"])
        on = parse_socketfilterfw(out) if code == 0 else None
        fix = ("Turn it on in System Settings › Network › Firewall.")
    elif plat.startswith("win") or plat == "cygwin":
        code, out = run(["netsh", "advfirewall", "show", "allprofiles",
                         "state"])
        on = parse_netsh_firewall(out) if code == 0 else None
        fix = ("Turn it on in Windows Security › Firewall & network "
               "protection.")
    else:
        return Check("firewall", "Firewall", None,
                     "Firewall status isn't checked on this platform.")
    if on is True:
        detail = "The firewall is on."
    elif on is False:
        detail = "The firewall is off — " + fix
    else:
        detail = "Couldn't determine firewall status."
    return Check("firewall", "Firewall", on, detail)


# ---------- automatic screen lock ----------

def parse_mac_screenlock(text: str) -> bool | None:
    s = text.strip()
    if s == "1":
        return True
    if s == "0":
        return False
    return None


def parse_win_screenlock(text: str) -> bool | None:
    """From a dump of HKCU\\Control Panel\\Desktop: locks on idle only if
    the screensaver is active, secure (asks for password), and times out
    within 15 minutes. Missing values → unknown rather than a guess."""
    vals: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[1].upper().startswith("REG_"):
            vals[parts[0].lower()] = parts[-1]
    active = vals.get("screensaveactive")
    secure = vals.get("screensaverissecure")
    timeout = vals.get("screensavetimeout")
    if secure is None or active is None:
        return None
    if active != "1" or secure != "1":
        return False
    if timeout is not None and timeout.isdigit():
        return int(timeout) <= 900
    return True


def screenlock_check(run=None, platform: str | None = None) -> Check:
    run = run or _default_run
    plat = platform or sys.platform
    if plat == "darwin":
        code, out = run(["defaults", "read", "com.apple.screensaver",
                         "askForPassword"])
        on = parse_mac_screenlock(out) if code == 0 else None
        fix = ("Turn on 'Require password after sleep or screen saver' in "
               "System Settings › Lock Screen.")
    elif plat.startswith("win") or plat == "cygwin":
        code, out = run(["reg", "query",
                         "HKCU\\Control Panel\\Desktop"])
        on = parse_win_screenlock(out) if code == 0 else None
        fix = ("Set a screen saver with 'On resume, display logon screen' "
               "and a short wait in Screen Saver Settings.")
    else:
        return Check("screenlock", "Automatic screen lock", None,
                     "Screen-lock status isn't checked on this platform.")
    if on is True:
        detail = "The screen locks automatically when idle."
    elif on is False:
        detail = "The screen doesn't auto-lock — " + fix
    else:
        detail = ("Couldn't determine the screen-lock setting — check it "
                  "manually.")
    return Check("screenlock", "Automatic screen lock", on, detail)


# ---------- antivirus (Windows) ----------

def parse_secautivirus(text: str) -> tuple[bool | None, str | None]:
    """Parse SecurityCenter2 AntiVirusProduct JSON. Returns
    (enabled, product_name). productState bit 0x1000 = real-time on."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None, None
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list) or not data:
        return False, None  # no AV product registered
    best_name = None
    for prod in data:
        name = prod.get("displayName")
        state = prod.get("productState")
        try:
            enabled = bool(int(state) & 0x1000)
        except (TypeError, ValueError):
            enabled = False
        if enabled:
            return True, name
        best_name = best_name or name
    return False, best_name


def antivirus_check(run=None, platform: str | None = None) -> Check:
    run = run or _default_run
    plat = platform or sys.platform
    if not (plat.startswith("win") or plat == "cygwin"):
        return Check("antivirus", "Antivirus", None,
                     "Antivirus status isn't checked on this platform.")
    code, out = run([
        "powershell", "-NoProfile", "-Command",
        "Get-CimInstance -Namespace root/SecurityCenter2 "
        "-ClassName AntiVirusProduct | "
        "Select-Object displayName,productState | ConvertTo-Json"])
    enabled, name = parse_secautivirus(out) if code == 0 else (None, None)
    if enabled is True:
        detail = f"Antivirus is active{f' ({name})' if name else ''}."
    elif enabled is False:
        detail = ("No active antivirus detected — turn on Microsoft "
                  "Defender or install an antivirus product.")
    else:
        detail = "Couldn't determine antivirus status."
    return Check("antivirus", "Antivirus", enabled, detail)


# ---------- aggregate ----------

def check_all(run=None, platform: str | None = None) -> list[Check]:
    """Every baseline check that applies to this platform, in display
    order. Antivirus is Windows-only; the rest run on macOS and Windows."""
    plat = platform or sys.platform
    checks = [disk_check(run=run, platform=platform),
              firewall_check(run=run, platform=platform),
              screenlock_check(run=run, platform=platform)]
    if plat.startswith("win") or plat == "cygwin":
        checks.append(antivirus_check(run=run, platform=platform))
    return checks
