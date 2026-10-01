"""Store one secret per name without ever writing it in the clear.

The alert mailbox password is the only secret this app holds besides the
vault passphrase, and unlike the passphrase it has to survive restarts
unattended — so it goes to the operating system's own keystore rather
than into config.json.

  * macOS — the login keychain, via the `security` tool.
  * Windows — DPAPI, which encrypts to the current user account on the
    current machine. The ciphertext is useless if the file is copied off
    the machine or read by another user.

Anywhere else, storing is refused outright. A plaintext fallback would
quietly undo the whole point, and a mail password sitting in a readable
file on a machine that is being monitored for compromise is exactly the
thing this product tells people not to do.
"""

from __future__ import annotations

import base64
import ctypes
import subprocess
import sys
from pathlib import Path

SERVICE = "Kovyr Vault"


class SecretError(Exception):
    """A secret could not be stored or retrieved."""


def available(platform: str | None = None) -> bool:
    return (platform or sys.platform) in ("darwin", "win32")


def _run(cmd: list[str], timeout: int = 15) -> tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)


# ---------- macOS: the login keychain ----------

def _set_macos(name: str, value: str, run) -> None:
    # -U updates in place; without it a second save fails as a duplicate.
    code, out = run(["security", "add-generic-password", "-U",
                     "-s", SERVICE, "-a", name, "-w", value])
    if code != 0:
        raise SecretError(f"could not save to the keychain: {out.strip()}")


def _get_macos(name: str, run) -> str | None:
    code, out = run(["security", "find-generic-password",
                     "-s", SERVICE, "-a", name, "-w"])
    return out.strip() if code == 0 else None


def _delete_macos(name: str, run) -> None:
    run(["security", "delete-generic-password", "-s", SERVICE, "-a", name])


# ---------- Windows: DPAPI, scoped to this user on this machine ----------

class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong),
                ("pbData", ctypes.POINTER(ctypes.c_char))]


def _in_blob(data: bytes) -> tuple[_Blob, object]:
    """A DATA_BLOB plus the buffer backing it.

    The buffer must be returned and held by the caller: if it is only a
    local here it can be collected while Windows still holds the pointer.
    """
    buf = ctypes.create_string_buffer(data, len(data))
    blob = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    return blob, buf


def _dpapi(func_name: str, data: bytes) -> bytes:
    """Call CryptProtectData / CryptUnprotectData.

    Both take the same seven arguments, so one wrapper covers them:
      pDataIn, szDataDescr, pOptionalEntropy, pvReserved,
      pPromptStruct, dwFlags, pDataOut
    """
    crypt32 = ctypes.windll.crypt32            # noqa: F821 — Windows only
    source, _keepalive = _in_blob(data)
    out = _Blob()
    ok = getattr(crypt32, func_name)(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        raise SecretError("Windows refused to encrypt or decrypt the "
                          "stored secret")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)   # noqa: F821


def _store_path(name: str, base: Path | None = None) -> Path:
    from .gui import DEFAULT_BASE
    root = base or DEFAULT_BASE
    safe = "".join(c for c in name if c.isalnum() or c in "-_")
    return root / "secrets" / f"{safe}.bin"


def _set_windows(name: str, value: str, base) -> None:
    path = _store_path(name, base)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64encode(
            _dpapi("CryptProtectData", value.encode())))
    except OSError as exc:
        raise SecretError(f"could not save the secret: {exc}") from exc


def _get_windows(name: str, base) -> str | None:
    path = _store_path(name, base)
    try:
        raw = base64.b64decode(path.read_bytes())
    except (OSError, ValueError):
        return None
    try:
        return _dpapi("CryptUnprotectData", raw).decode()
    except SecretError:
        return None            # another user or machine — not ours to read


def _delete_windows(name: str, base) -> None:
    _store_path(name, base).unlink(missing_ok=True)


# ---------- the platform-agnostic surface ----------

def set_secret(name: str, value: str, run=None,
               platform: str | None = None, base: Path | None = None) -> None:
    system = platform or sys.platform
    if system == "darwin":
        _set_macos(name, value, run or _run)
    elif system == "win32":
        _set_windows(name, value, base)
    else:
        raise SecretError(
            "storing a password securely needs macOS or Windows — refusing "
            "to write it in plain text")


def get_secret(name: str, run=None, platform: str | None = None,
               base: Path | None = None) -> str | None:
    system = platform or sys.platform
    if system == "darwin":
        return _get_macos(name, run or _run)
    if system == "win32":
        return _get_windows(name, base)
    return None


def delete_secret(name: str, run=None, platform: str | None = None,
                  base: Path | None = None) -> None:
    system = platform or sys.platform
    if system == "darwin":
        _delete_macos(name, run or _run)
    elif system == "win32":
        _delete_windows(name, base)
