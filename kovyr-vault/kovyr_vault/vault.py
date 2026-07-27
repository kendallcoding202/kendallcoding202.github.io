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
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import audit, crypto
from .hashing import hash_bytes
from .util import now_iso


def _version_ts(v) -> datetime:
    """Parse a Version.ts back to an aware datetime; unparseable or
    'current' sorts as 'now' so it's never purged."""
    try:
        return datetime.strptime(v.ts, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)

HEADER_NAME = "vault.json"
INDEX_NAME = "index.kvi"
BLOB_DIR = "blobs"
ACCESS_LOG_NAME = "access.log"  # legacy; migrated into audit.jsonl
FORMAT_VERSION = 1


def _read_keyfile(path: Path) -> bytes:
    data = Path(path).read_bytes()
    if not data:
        raise VaultError(f"keyfile {path} is empty")
    return data


def generate_keyfile(path: Path) -> Path:
    """Write a fresh random keyfile; refuses to clobber an existing one."""
    path = Path(path)
    if path.exists():
        raise VaultError(f"{path} already exists — refusing to overwrite "
                         f"a keyfile")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(crypto.new_keyfile_bytes())
    try:
        path.chmod(0o600)  # owner-only where the OS honors it
    except OSError:
        pass
    return path


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


DEFAULT_RETENTION_DAYS = 30


@dataclass
class FileEntry:
    sha256: str
    size: int
    mtime: float


@dataclass
class Version:
    """A historical or deleted revision of a vault file, retained until
    it ages past the retention window and is explicitly purged."""
    sha256: str
    size: int
    mtime: float
    ts: str            # when this revision left 'current' (ISO-8601 UTC)
    deleted: bool = False  # True = the file was soft-deleted (tombstone)


class VaultError(Exception):
    pass


class Vault:
    def __init__(self, root: Path, master_key: bytes):
        self.root = root
        self._key = master_key
        self._index: dict[str, FileEntry] = {}
        # Prior/deleted revisions per name, oldest first. Blobs behind
        # them stay on disk until purge() removes aged-out versions.
        self._history: dict[str, list[Version]] = {}
        self._load_index()

    # ---------- creation / opening ----------

    @classmethod
    def create(cls, root: Path, passphrase: str,
               keyfile: Path | None = None) -> "Vault":
        root = root.resolve()
        if (root / HEADER_NAME).exists():
            raise VaultError(f"a vault already exists at {root}")
        root.mkdir(parents=True, exist_ok=True)
        if any(root.iterdir()):
            raise VaultError(f"refusing to create a vault in non-empty {root}")

        keyfile_bytes = _read_keyfile(keyfile) if keyfile else None
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
            "keyfile": keyfile_bytes is not None,
            "wrapped_key": _b64(
                crypto.wrap_master_key(passphrase, master_key, salt,
                                       keyfile_bytes)
            ),
        }
        (root / HEADER_NAME).write_text(json.dumps(header, indent=2))
        (root / BLOB_DIR).mkdir(exist_ok=True)
        vault = cls(root, master_key)
        vault._save_index()
        return vault

    @staticmethod
    def requires_keyfile(root: Path) -> bool:
        header_path = Path(root).resolve() / HEADER_NAME
        if not header_path.exists():
            return False
        try:
            return bool(json.loads(header_path.read_text()).get("keyfile"))
        except (OSError, json.JSONDecodeError):
            return False

    @classmethod
    def open(cls, root: Path, passphrase: str,
             keyfile: Path | None = None) -> "Vault":
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
        if header.get("keyfile") and keyfile is None:
            raise VaultError("this vault requires a keyfile to unlock")
        keyfile_bytes = _read_keyfile(keyfile) if keyfile else None
        kdf = header["kdf"]
        salt = _unb64(kdf["salt"])
        derived = crypto.derive_key(
            passphrase, salt, n=kdf["n"], r=kdf["r"], p=kdf["p"],
        )
        wrapping = crypto.combine_wrapping_key(derived, salt, keyfile_bytes)
        try:
            master_key = crypto.decrypt(
                wrapping, _unb64(header["wrapped_key"]), crypto.AAD_KEY_WRAP
            )
        except crypto.IntegrityError as exc:
            audit.record(root, audit.EV_UNLOCK_FAIL, result="fail")
            raise crypto.WrongPassphrase(
                "incorrect passphrase or keyfile for this vault"
            ) from exc
        audit.record(root, audit.EV_UNLOCK_OK)
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
        # index_version 2 adds history; version-1 indexes load with none
        # (migration is transparent — old vaults just gain empty history).
        self._history = {
            name: [Version(**v) for v in versions]
            for name, versions in data.get("history", {}).items()
        }

    def _save_index(self) -> None:
        data = {
            "index_version": 2,
            "files": {
                name: vars(entry) for name, entry in self._index.items()
            },
            "history": {
                name: [vars(v) for v in versions]
                for name, versions in self._history.items() if versions
            },
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

        prior = self._index.get(name)
        overwrite = prior is not None and prior.sha256 != sha256
        if overwrite:
            # Preserve the superseded revision — never destroy on overwrite.
            self._history.setdefault(name, []).append(
                Version(prior.sha256, prior.size, prior.mtime, now_iso()))
        self._index[name] = entry
        if save_index:
            self._save_index()
        audit.record(self.root, audit.EV_FILE_ADD,
                     target=audit.file_id(name), nbytes=entry.size,
                     detail={"overwrite": True} if overwrite else None)
        return entry, stored

    def delete_file(self, name: str) -> None:
        """Soft-delete: the current revision becomes a tombstone; the
        blob stays until purge() removes it after the retention window."""
        entry = self._index.get(name)
        if entry is None:
            raise VaultError(f"no such file in vault: {name}")
        self._history.setdefault(name, []).append(
            Version(entry.sha256, entry.size, entry.mtime, now_iso(),
                    deleted=True))
        del self._index[name]
        self._save_index()
        audit.record(self.root, audit.EV_FILE_DELETE,
                     target=audit.file_id(name))

    def list_versions(self, name: str) -> list[Version]:
        """All retained revisions for a name, oldest first, plus the
        current live one last (if it exists)."""
        versions = list(self._history.get(name, []))
        current = self._index.get(name)
        if current is not None:
            versions.append(Version(current.sha256, current.size,
                                    current.mtime, "current"))
        return versions

    def restore_version(self, name: str, sha256: str) -> None:
        """Make a retained revision the current one again (its blob is
        still present). The displaced current is itself kept in history."""
        match = next((v for v in self._history.get(name, [])
                      if v.sha256 == sha256), None)
        if match is None:
            raise VaultError(f"no retained version {sha256[:12]} for {name}")
        if not self._blob_path(sha256).exists():
            raise VaultError(f"blob for that version is gone (purged)")
        current = self._index.get(name)
        if current is not None:
            self._history.setdefault(name, []).append(
                Version(current.sha256, current.size, current.mtime,
                        now_iso()))
        self._index[name] = FileEntry(match.sha256, match.size, match.mtime)
        self._history[name] = [v for v in self._history[name]
                               if v is not match]
        self._save_index()
        audit.record(self.root, audit.EV_FILE_VERSION_RESTORE,
                     target=audit.file_id(name))

    def purge_versions(self, retention_days: int = DEFAULT_RETENTION_DAYS,
                       now: datetime | None = None) -> int:
        """Permanently drop retained versions older than the window and
        delete any blob no longer referenced by anything. Returns blobs
        removed. The only destructive version operation — logged."""
        now = now or datetime.now(timezone.utc)
        cutoff = now - timedelta(days=retention_days)
        for name, versions in list(self._history.items()):
            kept = [v for v in versions if _version_ts(v) >= cutoff]
            if kept:
                self._history[name] = kept
            else:
                self._history.pop(name, None)
        self._save_index()

        referenced = {e.sha256 for e in self._index.values()}
        for versions in self._history.values():
            referenced.update(v.sha256 for v in versions)
        removed = 0
        for blob in (self.root / BLOB_DIR).rglob("*.kvb"):
            sha = blob.stem
            if sha not in referenced:
                try:
                    blob.unlink()
                    removed += 1
                except OSError:
                    pass
        audit.record(self.root, audit.EV_FILE_PURGE,
                     detail={"retention_days": retention_days,
                             "blobs_removed": removed})
        return removed

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
        # Explicit restore-to-disk is the loggable "export"; internal
        # reads (verify, integrity) go through read_file and are NOT
        # logged, so they never trip mass-export detection.
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = self.read_file(name)
        dest.write_bytes(data)
        audit.record(self.root, audit.EV_FILE_EXPORT,
                     target=audit.file_id(name), nbytes=len(data))

    def log_lock(self, auto: bool = False) -> None:
        """Record that the vault was locked (key dropped from memory)."""
        audit.record(self.root,
                     audit.EV_LOCK_AUTO if auto else audit.EV_LOCK)

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
