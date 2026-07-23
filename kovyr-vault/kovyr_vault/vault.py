"""The encrypted, content-addressed vault.

Layout on disk:
    <vault>/vault.json   public header: version, KDF params, wrapped master key
    <vault>/index.kvi    encrypted JSON index: original path -> content hash
    <vault>/blobs/ab/<sha256>.kvb   encrypted content, one blob per unique hash

Because blobs are addressed by the SHA-256 of their plaintext, adding the
same content twice stores it once — deduplication and encryption come from
the same mechanism.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import crypto
from .hashing import hash_bytes

HEADER_NAME = "vault.json"
INDEX_NAME = "index.kvi"
BLOB_DIR = "blobs"
ACCESS_LOG_NAME = "access.log"
FORMAT_VERSION = 1


def _log_access(root: Path, event: str) -> None:
    """Append an access event (best-effort tripwire, never fatal).

    The log is plaintext metadata — timestamps and outcomes only, no
    content — and feeds the monitoring report's failed-unlock count.
    """
    try:
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(root / ACCESS_LOG_NAME, "a", encoding="utf-8") as f:
            f.write(f"{stamp}\t{event}\n")
    except OSError:
        pass


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


@dataclass
class FileEntry:
    sha256: str
    size: int
    mtime: float


class VaultError(Exception):
    pass


class Vault:
    def __init__(self, root: Path, master_key: bytes):
        self.root = root
        self._key = master_key
        self._index: dict[str, FileEntry] = {}
        self._load_index()

    # ---------- creation / opening ----------

    @classmethod
    def create(cls, root: Path, passphrase: str) -> "Vault":
        root = root.resolve()
        if (root / HEADER_NAME).exists():
            raise VaultError(f"a vault already exists at {root}")
        root.mkdir(parents=True, exist_ok=True)
        if any(root.iterdir()):
            raise VaultError(f"refusing to create a vault in non-empty {root}")

        master_key = crypto.new_master_key()
        salt = crypto.new_salt()
        header = {
            "format": "kovyr-vault",
            "version": FORMAT_VERSION,
            "kdf": {
                "name": "scrypt",
                "salt": _b64(salt),
                "n": crypto.SCRYPT_N,
                "r": crypto.SCRYPT_R,
                "p": crypto.SCRYPT_P,
            },
            "wrapped_key": _b64(
                crypto.wrap_master_key(passphrase, master_key, salt)
            ),
        }
        (root / HEADER_NAME).write_text(json.dumps(header, indent=2))
        (root / BLOB_DIR).mkdir(exist_ok=True)
        vault = cls(root, master_key)
        vault._save_index()
        return vault

    @classmethod
    def open(cls, root: Path, passphrase: str) -> "Vault":
        root = root.resolve()
        header_path = root / HEADER_NAME
        if not header_path.exists():
            raise VaultError(f"no vault found at {root}")
        header = json.loads(header_path.read_text())
        if header.get("format") != "kovyr-vault":
            raise VaultError(f"{header_path} is not a Kovyr vault header")
        if header.get("version") != FORMAT_VERSION:
            raise VaultError(
                f"unsupported vault version {header.get('version')}"
            )
        kdf = header["kdf"]
        derived = crypto.derive_key(
            passphrase, _unb64(kdf["salt"]),
            n=kdf["n"], r=kdf["r"], p=kdf["p"],
        )
        try:
            master_key = crypto.decrypt(
                derived, _unb64(header["wrapped_key"]), crypto.AAD_KEY_WRAP
            )
        except crypto.IntegrityError as exc:
            _log_access(root, "FAILED_UNLOCK")
            raise crypto.WrongPassphrase(
                "incorrect passphrase for this vault"
            ) from exc
        _log_access(root, "UNLOCK_OK")
        return cls(root, master_key)

    # ---------- index ----------

    def _index_path(self) -> Path:
        return self.root / INDEX_NAME

    def _load_index(self) -> None:
        path = self._index_path()
        if not path.exists():
            return
        raw = crypto.decrypt(self._key, path.read_bytes(), crypto.AAD_INDEX)
        data = json.loads(raw)
        self._index = {
            name: FileEntry(**entry) for name, entry in data["files"].items()
        }

    def _save_index(self) -> None:
        data = {
            "files": {
                name: vars(entry) for name, entry in self._index.items()
            }
        }
        blob = crypto.encrypt(
            self._key, json.dumps(data).encode("utf-8"), crypto.AAD_INDEX
        )
        self._index_path().write_bytes(blob)

    # ---------- content ----------

    def _blob_path(self, sha256: str) -> Path:
        return self.root / BLOB_DIR / sha256[:2] / f"{sha256}.kvb"

    def add_file(self, source: Path, name: str,
                 save_index: bool = True) -> tuple[FileEntry, bool]:
        """Encrypt a file into the vault under the given logical name.

        Returns (entry, stored) where stored is False when identical
        content was already in the vault (deduplicated). Bulk callers
        pass save_index=False and call flush_index() at checkpoints —
        rewriting the encrypted index per file is O(n²) over big sweeps.
        """
        plaintext = source.read_bytes()
        sha256 = hash_bytes(plaintext)
        stat = source.stat()
        entry = FileEntry(sha256=sha256, size=stat.st_size,
                          mtime=stat.st_mtime)

        blob_path = self._blob_path(sha256)
        stored = False
        if not blob_path.exists():
            blob_path.parent.mkdir(parents=True, exist_ok=True)
            blob = crypto.encrypt(self._key, plaintext, sha256.encode())
            blob_path.write_bytes(blob)
            stored = True

        self._index[name] = entry
        if save_index:
            self._save_index()
        return entry, stored

    def flush_index(self) -> None:
        """Persist the index now (pairs with add_file(save_index=False))."""
        self._save_index()

    def read_file(self, name: str) -> bytes:
        entry = self._index.get(name)
        if entry is None:
            raise VaultError(f"no such file in vault: {name}")
        blob_path = self._blob_path(entry.sha256)
        if not blob_path.exists():
            raise VaultError(f"missing blob for {name} ({entry.sha256})")
        plaintext = crypto.decrypt(
            self._key, blob_path.read_bytes(), entry.sha256.encode()
        )
        if hash_bytes(plaintext) != entry.sha256:
            raise crypto.IntegrityError(f"content mismatch for {name}")
        return plaintext

    def restore_file(self, name: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.read_file(name))

    def list_files(self) -> dict[str, FileEntry]:
        return dict(self._index)

    def verify(self) -> list[str]:
        """Decrypt and re-hash every entry; return a list of problems."""
        problems: list[str] = []
        for name in self._index:
            try:
                self.read_file(name)
            except (VaultError, crypto.IntegrityError) as exc:
                problems.append(f"{name}: {exc}")
        return problems

    def unique_blobs(self) -> int:
        return len({e.sha256 for e in self._index.values()})
