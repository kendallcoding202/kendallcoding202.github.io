"""C2SP signed notes, tlog-checkpoint bodies and tlog-cosignature/v1.
Mirrors engine/note."""

from __future__ import annotations

import base64
import hashlib
import re
import struct
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519

TYPE_ED25519 = 0x01
TYPE_COSIGNATURE = 0x04
DASH = "— "  # em dash and space


def valid_name(name: str) -> bool:
    return bool(name) and "+" not in name and not re.search(r"[\s\x00-\x1f]", name)


def key_id(name: str, typ: int, pub: bytes) -> int:
    h = hashlib.sha256(name.encode("utf-8") + bytes([0x0A, typ]) + pub).digest()
    return struct.unpack(">I", h[:4])[0]


def format_vkey(name: str, typ: int, pub: bytes) -> str:
    return f"{name}+{key_id(name, typ, pub):08x}+" + base64.b64encode(bytes([typ]) + pub).decode("ascii")


@dataclass(frozen=True)
class VerifierKey:
    name: str
    id: int
    type: int
    key: bytes
    vkey: str


def parse_vkey(s: str) -> VerifierKey:
    parts = s.split("+", 2)  # base64 may itself contain "+"
    if len(parts) != 3 or not valid_name(parts[0]) or not re.fullmatch(r"[0-9a-f]{8}", parts[1]):
        raise ValueError("malformed verifier key")
    raw = base64.b64decode(parts[2], validate=True)
    if len(raw) != 33 or raw[0] not in (TYPE_ED25519, TYPE_COSIGNATURE):
        raise ValueError("unsupported verifier key")
    kid = int(parts[1], 16)
    if kid != key_id(parts[0], raw[0], raw[1:]):
        raise ValueError("verifier key id does not match the key")
    return VerifierKey(parts[0], kid, raw[0], raw[1:], s)


@dataclass
class SigLine:
    name: str
    id: int
    sig: bytes  # bytes after the key ID
    line: str


@dataclass
class Note:
    text: str
    sigs: list[SigLine] = field(default_factory=list)

    def __str__(self) -> str:
        return self.text + "\n" + "".join(s.line + "\n" for s in self.sigs)

    def add_sig_line(self, s: SigLine) -> None:
        for i, e in enumerate(self.sigs):
            if e.name == s.name and e.id == s.id:
                self.sigs[i] = s
                return
        self.sigs.append(s)

    def verify_signed_by(self, vk: VerifierKey) -> None:
        if vk.type != TYPE_ED25519:
            raise ValueError("verifier key is not an Ed25519 note key")
        for s in self.sigs:
            if s.name == vk.name and s.id == vk.id:
                try:
                    ed25519.Ed25519PublicKey.from_public_bytes(vk.key).verify(s.sig, self.text.encode("utf-8"))
                    return
                except (InvalidSignature, ValueError):
                    raise ValueError(f"signature by {vk.name} does not verify") from None
        raise ValueError(f"no signature by {vk.name}")

    def verify_cosignature(self, vk: VerifierKey) -> int:
        """Return the cosignature time, or raise ValueError."""
        if vk.type != TYPE_COSIGNATURE:
            raise ValueError("verifier key is not a cosignature key")
        for s in self.sigs:
            if s.name == vk.name and s.id == vk.id:
                if len(s.sig) != 8 + 64:
                    raise ValueError(f"malformed cosignature from {vk.name}")
                t = struct.unpack(">Q", s.sig[:8])[0]
                try:
                    ed25519.Ed25519PublicKey.from_public_bytes(vk.key).verify(s.sig[8:], cosignature_message(self.text, t))
                except InvalidSignature:
                    raise ValueError(f"cosignature from {vk.name} does not verify for this checkpoint") from None
                return t
        raise ValueError(f"no cosignature from {vk.name}")


def parse(s: str) -> Note:
    if not s.endswith("\n"):
        raise ValueError("note does not end with a newline")
    if any(ord(c) < 0x20 and c != "\n" for c in s):
        raise ValueError("note contains a control character")
    sep = s.rfind("\n\n")
    if sep < 0:
        raise ValueError("note has no signature block")
    n = Note(s[: sep + 1])
    for line in s[sep + 2 : -1].split("\n"):
        if not line.startswith(DASH):
            raise ValueError("malformed signature line")
        f = line[len(DASH) :].split(" ")
        if len(f) != 2 or not valid_name(f[0]):
            raise ValueError("malformed signature line")
        raw = base64.b64decode(f[1], validate=True)
        if len(raw) < 5:
            raise ValueError("malformed signature")
        n.sigs.append(SigLine(f[0], struct.unpack(">I", raw[:4])[0], raw[4:], line))
    if not n.sigs:
        raise ValueError("note has no signatures")
    return n


def _line(name: str, raw: bytes) -> str:
    return DASH + name + " " + base64.b64encode(raw).decode("ascii")


def sign(text: str, name: str, priv: ed25519.Ed25519PrivateKey) -> str:
    if not text.endswith("\n") or not valid_name(name):
        raise ValueError("note text must end with a newline and the key name must be valid")
    pub = priv.public_key().public_bytes_raw()
    kid = key_id(name, TYPE_ED25519, pub)
    sig = priv.sign(text.encode("utf-8"))
    return str(Note(text, [SigLine(name, kid, sig, _line(name, struct.pack(">I", kid) + sig))]))


@dataclass(frozen=True)
class Checkpoint:
    origin: str
    size: int
    root: bytes

    def body(self) -> str:
        return f"{self.origin}\n{self.size}\n{base64.b64encode(self.root).decode('ascii')}\n"


def parse_checkpoint(text: str) -> Checkpoint:
    lines = text[:-1].split("\n")
    if not text.endswith("\n") or len(lines) != 3:
        raise ValueError("checkpoint must be exactly origin, size and root hash lines")
    if not lines[0]:
        raise ValueError("checkpoint origin is empty")
    if not re.fullmatch(r"0|[1-9][0-9]*", lines[1]):
        raise ValueError("checkpoint size is not a canonical decimal")
    root = base64.b64decode(lines[2], validate=True)
    if len(root) != 32 or base64.b64encode(root).decode("ascii") != lines[2]:
        raise ValueError("checkpoint root hash is not canonical base64 of 32 bytes")
    return Checkpoint(lines[0], int(lines[1]), root)


def cosignature_message(body: str, t: int) -> bytes:
    return f"cosignature/v1\ntime {t}\n{body}".encode("utf-8")


def cosign(body: str, name: str, priv: ed25519.Ed25519PrivateKey, t: int) -> SigLine:
    pub = priv.public_key().public_bytes_raw()
    kid = key_id(name, TYPE_COSIGNATURE, pub)
    sig = priv.sign(cosignature_message(body, t))
    raw = struct.pack(">I", kid) + struct.pack(">Q", t) + sig
    return SigLine(name, kid, raw[4:], _line(name, raw))
