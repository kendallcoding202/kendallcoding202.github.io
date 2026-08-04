"""One-click in-app update for the signed macOS build.

An updater is a remote code-execution channel into every client machine,
so this one is deliberately paranoid. Three checks stand between a
download and running code, and none of them is optional:

1. **The download URL must be a release asset of this project.** The
   GitHub API response is treated as untrusted input — an asset URL that
   doesn't start with ALLOWED_ASSET_PREFIX is refused outright.
2. **HTTPS with real certificate verification**, using certifi so the
   frozen app (which ships without the OS trust store) still validates.
3. **The downloaded app must carry the same signing identity as the app
   that is currently running.** The running bundle is the trust anchor,
   so there is no hard-coded Team ID to drift out of date, and a renewed
   Developer ID certificate keeps working (the Team ID is the account,
   not the certificate). A tampered or differently-signed build is
   rejected even if everything upstream were compromised.

Gatekeeper's own assessment (`spctl`) runs too, which additionally
requires the build to be notarized.

Only macOS is wired up. Windows needs Authenticode signing first —
without a signature there is nothing to verify, so `supported()` returns
False there rather than offering a check this module cannot make.

The command runner is injectable, so every parser and every refusal path
is unit-tested without a real Mac.
"""

from __future__ import annotations

import os
import re
import shutil
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path, PurePosixPath

# Release assets for this project, and nothing else.
ALLOWED_ASSET_PREFIX = ("https://github.com/kendallcoding202/"
                        "kendallcoding202.github.io/releases/download/")
MAC_ASSET = "KovyrVault.dmg"
DOWNLOAD_TIMEOUT = 120
MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024  # a DMG is ~18 MB; refuse absurdity


class UpdateError(Exception):
    """Anything that makes an update unsafe or impossible."""


def _run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


def supported(platform: str | None = None) -> bool:
    """Whether in-app update is available here. macOS only for now —
    Windows needs code signing before an update could be verified."""
    return (platform or sys.platform) == "darwin"


# ---------- untrusted input from the release API ----------

def pick_asset(assets, name: str = MAC_ASSET) -> str | None:
    """The download URL for `name`, but only if it is a release asset of
    this project. Anything else — including a valid-looking URL on
    another host — is refused."""
    for asset in assets or []:
        if not isinstance(asset, dict) or asset.get("name") != name:
            continue
        url = str(asset.get("browser_download_url") or "")
        return url if url.startswith(ALLOWED_ASSET_PREFIX) else None
    return None


# ---------- signing identity ----------

# Capture to end of line, not just the first word: an ad-hoc signature
# reports "TeamIdentifier=not set", and a word-only match would yield
# "not" — an identity two ad-hoc builds would appear to share, letting an
# unsigned update pass the "same developer" gate.
_TEAM_RE = re.compile(r"TeamIdentifier=(.+)")


def team_identifier(app_path, run=None) -> str | None:
    """The Team ID a bundle is signed with, or None if unsigned/ad-hoc/
    unreadable. Only a real alphanumeric Team ID counts as an identity."""
    run = run or _run
    code, out = run(["codesign", "-dv", "--verbose=4", str(app_path)])
    if code != 0:
        return None
    match = _TEAM_RE.search(out)
    if not match:
        return None
    team = match.group(1).strip()
    if not team or not team.isalnum():   # "not set" and friends
        return None
    return team


def signature_intact(app_path, run=None) -> bool:
    """Whether the bundle's signature verifies — i.e. nothing inside it
    has been altered since it was signed."""
    run = run or _run
    code, _out = run(["codesign", "--verify", "--deep", "--strict",
                      str(app_path)])
    return code == 0


def gatekeeper_accepts(app_path, run=None) -> bool:
    """Whether Gatekeeper would let this run — which additionally
    requires Apple notarization."""
    run = run or _run
    code, _out = run(["spctl", "--assess", "--type", "execute",
                      str(app_path)])
    return code == 0


def verify_update(candidate, current, run=None) -> None:
    """Raise UpdateError unless `candidate` is safe to install over
    `current`. The running app is the trust anchor: the update must carry
    the same Team ID."""
    if not signature_intact(candidate, run=run):
        raise UpdateError(
            "the downloaded app's signature is not intact — it may have "
            "been altered in transit. Update cancelled.")
    expected = team_identifier(current, run=run)
    if not expected:
        raise UpdateError(
            "this copy of Kovyr Vault is not signed, so an update can't be "
            "verified against it. Install the new version manually.")
    got = team_identifier(candidate, run=run)
    if got != expected:
        raise UpdateError(
            "the downloaded app is signed by a different developer "
            f"({got or 'unsigned'}) than this one ({expected}). "
            "Update refused.")
    if not gatekeeper_accepts(candidate, run=run):
        raise UpdateError(
            "the downloaded app was rejected by macOS Gatekeeper — it may "
            "not be notarized. Update cancelled.")


# ---------- locating the running bundle ----------

def current_app_bundle(executable: str | None = None) -> Path | None:
    """The .app bundle this process is running from, or None when running
    from source rather than a frozen bundle."""
    exe = Path(executable or sys.executable)
    for ancestor in exe.parents:
        if ancestor.suffix == ".app":
            return ancestor
    return None


def on_mounted_volume(bundle) -> bool:
    """Whether the bundle lives under /Volumes — i.e. on a mounted disk
    image or external drive rather than the startup disk.

    Parsed as POSIX explicitly rather than with Path(). `/Volumes` only
    means anything on macOS, but this test suite also runs on Windows,
    where Path() splits the same string on backslashes, yields a leading
    part of "\\", and never matches. PurePosixPath gives one answer on
    every host, so the behavior under test is the behavior that ships.
    """
    parts = PurePosixPath(str(bundle)).parts
    return len(parts) > 2 and parts[0] == "/" and parts[1] == "Volumes"


def _is_writable(path) -> bool:
    return os.access(path, os.W_OK)


def install_location_problem(bundle, writable=None) -> str | None:
    """Why this copy can't update itself in place, or None if it can.

    Checked BEFORE downloading. Without it, a client runs the app straight
    from the installer disk image, waits through an 18 MB download and a
    signature check, and only then hits "Read-only file system" — an error
    that names the true cause nowhere in it. macOS mounts a DMG read-only,
    so this is the single most likely way to end up with an app that
    cannot update itself: the client simply never dragged it to
    Applications.
    """
    writable = writable or _is_writable
    # Keep the caller's own text for the /Volumes test. Path() must not do
    # it: on a Windows runner Path("/Volumes/x") is "\\Volumes\\x", so
    # routing the check through Path would destroy the separators before
    # on_mounted_volume ever sees them.
    raw = str(bundle)
    bundle = Path(bundle)
    if writable(bundle.parent):
        return None
    if on_mounted_volume(raw):
        return ("Kovyr Vault is running from the installer disk image, "
                "which macOS keeps read-only, so it can't update itself "
                "there.\n\n"
                "Drag Kovyr Vault into your Applications folder, eject "
                "“Kovyr Vault” in the Finder sidebar, then open it from "
                "Applications. Updates will work from then on.")
    return (f"Kovyr Vault can't modify itself where it's installed "
            f"({bundle.parent}) — the folder is read-only for this user "
            f"account.\n\n"
            f"Move Kovyr Vault into your Applications folder, or ask "
            f"whoever administers this Mac to install the update.")


# ---------- download ----------

def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def download(url: str, dest: Path, on_progress=None, opener=None) -> Path:
    """Fetch a release asset over verified HTTPS. Refuses any URL that
    isn't a release asset of this project."""
    if not url.startswith(ALLOWED_ASSET_PREFIX):
        raise UpdateError("refusing to download from an unexpected "
                          "location")
    dest = Path(dest)
    open_url = opener or (
        lambda u: urllib.request.urlopen(  # noqa: S310 (prefix-checked https)
            urllib.request.Request(u), timeout=DOWNLOAD_TIMEOUT,
            context=_ssl_context()))
    try:
        with open_url(url) as resp, dest.open("wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            got = 0
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                got += len(chunk)
                if got > MAX_DOWNLOAD_BYTES:
                    raise UpdateError("download is implausibly large — "
                                      "cancelled")
                fh.write(chunk)
                if on_progress:
                    on_progress(got, total)
    except UpdateError:
        dest.unlink(missing_ok=True)
        raise
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise UpdateError(f"download failed: {exc}") from exc
    return dest


# ---------- DMG handling ----------

_MOUNT_RE = re.compile(r"(/Volumes/[^\n\t]+)")


def attach_dmg(dmg: Path, run=None) -> Path:
    run = run or _run
    code, out = run(["hdiutil", "attach", "-nobrowse", "-readonly",
                     "-noverify", str(dmg)])
    if code != 0:
        raise UpdateError("could not open the downloaded disk image")
    match = _MOUNT_RE.search(out)
    if not match:
        raise UpdateError("could not find where the disk image mounted")
    return Path(match.group(1).rstrip())


def detach_dmg(mount: Path, run=None) -> None:
    run = run or _run
    run(["hdiutil", "detach", str(mount), "-quiet"])


def app_in_mount(mount: Path) -> Path | None:
    apps = sorted(Path(mount).glob("*.app"))
    return apps[0] if apps else None


def replace_bundle(new_app: Path, target: Path, run=None) -> None:
    """Swap the installed bundle for the verified new one. `ditto`
    preserves the signature and extended attributes; `cp -r` does not."""
    run = run or _run
    target = Path(target)
    # Re-checked here, not just before the download: this is the last
    # point where refusing still costs the client nothing.
    problem = install_location_problem(target)
    if problem:
        raise UpdateError(problem)
    backup = target.with_name(target.name + ".old")
    shutil.rmtree(backup, ignore_errors=True)
    try:
        if target.exists():
            target.rename(backup)
    except OSError as exc:
        raise UpdateError(
            f"could not replace the installed app at {target} — you may "
            f"not have permission to modify it ({exc}). Install manually.")
    code, out = run(["ditto", str(new_app), str(target)])
    if code != 0:
        # put the original back rather than leaving nothing installed
        if backup.exists() and not target.exists():
            backup.rename(target)
        raise UpdateError(f"could not install the new version: {out.strip()}")
    shutil.rmtree(backup, ignore_errors=True)


def relaunch(app: Path, run=None) -> None:
    run = run or _run
    run(["open", "-n", str(app)])
