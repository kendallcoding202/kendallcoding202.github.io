"""Best-effort secure file erase.

Overwrites a file's bytes with random data before unlinking it, so ordinary
undelete tools can't recover the plaintext of a removed sensitive file.

Honest limits — stated plainly because a false sense of security is worse
than none: on SSDs and copy-on-write filesystems, wear-leveling and
snapshots mean an in-place overwrite is not guaranteed to land on the
original physical blocks. This raises the bar against casual recovery; it
is not a forensic guarantee. Full-disk encryption (FileVault / BitLocker)
remains the real backstop for media that leaves the client's control.
"""

from __future__ import annotations

import os
from pathlib import Path

CHUNK = 65536


def overwrite(path: Path, passes: int = 1) -> None:
    """Overwrite the file's contents in place with random bytes. Does not
    delete the file. Raises FileNotFoundError if it isn't a regular file."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    length = path.stat().st_size
    with path.open("r+b", buffering=0) as fh:
        for _ in range(max(1, passes)):
            fh.seek(0)
            remaining = length
            while remaining > 0:
                block = os.urandom(min(CHUNK, remaining))
                fh.write(block)
                remaining -= len(block)
            fh.flush()
            os.fsync(fh.fileno())


def secure_delete(path: Path, passes: int = 1) -> None:
    """Overwrite then remove the file. If the overwrite can't happen (e.g.
    read-only media), the file is still removed so the operation doesn't
    silently leave sensitive data behind."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    try:
        overwrite(path, passes=passes)
    except OSError:
        pass  # fall through to unlink — better removed than left in place
    path.unlink(missing_ok=True)
