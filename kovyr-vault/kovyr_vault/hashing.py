"""Content hashing for duplicate detection and vault addressing."""

from __future__ import annotations

import hashlib
from pathlib import Path

# 1 MiB reads keep memory flat no matter how large the client's files are.
_CHUNK_SIZE = 1024 * 1024


def hash_file(path: Path) -> str:
    """Return the SHA-256 hex digest of a file's contents."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def hash_bytes(data: bytes) -> str:
    """Return the SHA-256 hex digest of a byte string."""
    return hashlib.sha256(data).hexdigest()
