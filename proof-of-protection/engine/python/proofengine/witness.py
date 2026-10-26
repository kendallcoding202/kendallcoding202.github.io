"""An independent checkpoint witness (c2sp.org/tlog-cosignature). Mirrors
engine/witness. A witness cosigns a checkpoint only if the log proves the new
tree extends the one it cosigned before."""

from __future__ import annotations

import base64
import datetime as dt
import json
import pathlib
from typing import Callable

from cryptography.hazmat.primitives.asymmetric import ed25519

from . import merkle, note


class ForkError(ValueError):
    pass


class Witness:
    def __init__(self, name: str, key: ed25519.Ed25519PrivateKey, clock: Callable[[], dt.datetime]):
        if not note.valid_name(name):
            raise ValueError(f"invalid witness name {name!r}")
        self.name, self._key, self._clock = name, key, clock
        self.seen: dict[str, dict] = {}  # origin -> {"size": n, "root": base64}

    def vkey(self) -> str:
        return note.format_vkey(self.name, note.TYPE_COSIGNATURE, self._key.public_key().public_bytes_raw())

    def cosign(self, signed_checkpoint: str, log_vkey: str, proof: list[bytes]) -> note.SigLine:
        vk = note.parse_vkey(log_vkey)
        n = note.parse(signed_checkpoint)
        n.verify_signed_by(vk)
        cp = note.parse_checkpoint(n.text)
        if cp.origin != vk.name:
            raise ValueError("checkpoint origin does not match the log key")
        old = self.seen.get(cp.origin)
        if old is not None:
            old_root = base64.b64decode(old["root"])
            if cp.size < old["size"] or not merkle.verify_consistency(old["size"], cp.size, proof, old_root, cp.root):
                raise ForkError("checkpoint is not consistent with the tree this witness already cosigned; refusing to cosign")
        self.seen[cp.origin] = {"size": cp.size, "root": base64.b64encode(cp.root).decode("ascii")}
        return note.cosign(n.text, self.name, self._key, int(self._clock().timestamp()))

    def save_state(self, path: str | pathlib.Path) -> None:
        pathlib.Path(path).write_text(json.dumps(self.seen, indent=2) + "\n", encoding="utf-8")

    def load_state(self, path: str | pathlib.Path) -> None:
        p = pathlib.Path(path)
        if p.exists():
            self.seen = json.loads(p.read_text(encoding="utf-8"))
