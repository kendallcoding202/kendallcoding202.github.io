"""DSSE v1 envelopes. Mirrors engine/dsse."""

from __future__ import annotations

from dataclasses import dataclass, field

from . import canon
from .sigs import PublicKey, Signer, b64, decode_b64

PAYLOAD_TYPE_IN_TOTO = "application/vnd.in-toto+json"


def pae(payload_type: str, payload: bytes) -> bytes:
    """DSSEv1 pre-authentication encoding."""
    t = payload_type.encode("utf-8")
    return b"DSSEv1 %d %s %d %s" % (len(t), t, len(payload), payload)


@dataclass
class Envelope:
    payload_type: str
    payload: bytes
    signatures: list[tuple[str, bytes]] = field(default_factory=list)  # (keyid, sig)

    def verify_signature(self, i: int, key: PublicKey) -> None:
        """Raise ValueError unless signature i is key's valid signature."""
        if i >= len(self.signatures):
            raise ValueError(f"signature {i} missing")
        keyid, sig = self.signatures[i]
        if keyid != key.keyid():
            raise ValueError(f"signature {i} keyid does not match the expected key")
        key.verify(pae(self.payload_type, self.payload), sig)

    def value(self) -> dict:
        return {
            "payload": b64(self.payload),
            "payloadType": self.payload_type,
            "signatures": [{"keyid": k, "sig": b64(s)} for k, s in self.signatures],
        }

    def canonical(self) -> bytes:
        return canon.encode(self.value())


def sign(payload_type: str, payload: bytes, *signers: Signer) -> Envelope:
    if not signers:
        raise ValueError("dsse: no signers")
    msg = pae(payload_type, payload)
    return Envelope(payload_type, payload, [(s.public().keyid(), s.sign(msg)) for s in signers])


def _exact(o, keys, what):
    if not isinstance(o, dict) or set(o) != set(keys):
        raise ValueError(f"{what}: expected exactly the fields {sorted(keys)}")


def from_value(v) -> Envelope:
    _exact(v, ["payload", "payloadType", "signatures"], "envelope")
    pt = v["payloadType"]
    if not isinstance(pt, str):
        raise ValueError("envelope: payloadType must be a string")
    canon.check_string(pt)
    payload = decode_b64(v["payload"])
    sigs = v["signatures"]
    if not isinstance(sigs, list) or not sigs:
        raise ValueError("envelope: signatures must be a non-empty array")
    out = []
    for i, s in enumerate(sigs):
        _exact(s, ["keyid", "sig"], f"envelope signature {i}")
        if not isinstance(s["keyid"], str):
            raise ValueError(f"envelope signature {i}: keyid must be a string")
        canon.check_string(s["keyid"])
        out.append((s["keyid"], decode_b64(s["sig"])))
    return Envelope(pt, payload, out)


def parse(b: bytes) -> Envelope:
    return from_value(canon.parse(b))
