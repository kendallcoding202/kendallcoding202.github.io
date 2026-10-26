"""The transparency log and the ingest server in front of it. Mirrors
engine/tlog.

The public log stores commitments only: each leaf is the 32-byte entry
digest SHA-256(canonical DSSE envelope). Statements carry a 256-bit salt, so
a digest reveals nothing. The log publishes the digests as C2SP tlog-tiles.
Full envelopes and their timestamp tokens are private evidence, shared only
inside Proof Packs.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import pathlib
import secrets
import struct
from dataclasses import dataclass, field
from typing import Callable

from cryptography.hazmat.primitives.asymmetric import ed25519

from . import canon, merkle, note, posture
from .dsse import PAYLOAD_TYPE_IN_TOTO, Envelope, from_value as envelope_from_value
from .sigs import parse_public_key_b64
from .tsa import Authority

NONCE_LIFETIME = dt.timedelta(minutes=10)
MAX_CLOCK_SKEW = dt.timedelta(minutes=5)


def entry_digest(env: Envelope) -> bytes:
    """The commitment a leaf holds, and the imprint TSAs sign."""
    return hashlib.sha256(env.canonical()).digest()


def leaf_hash(digest: bytes) -> bytes:
    return merkle.leaf_hash(digest)


@dataclass
class Evidence:
    index: int
    envelope: Envelope
    timestamps: list[dict]
    statement: posture.Statement | None = None

    def value(self) -> dict:
        return {"index": self.index, "envelope": self.envelope.value(), "timestamps": list(self.timestamps)}


def evidence_from_value(v) -> Evidence:
    if not isinstance(v, dict) or set(v) != {"index", "envelope", "timestamps"}:
        raise ValueError("evidence must have exactly index, envelope and timestamps")
    idx = v["index"]
    if isinstance(idx, bool) or not isinstance(idx, int) or idx < 0:
        raise ValueError("evidence index must be a non-negative integer")
    ts = v["timestamps"]
    if not isinstance(ts, list) or not all(isinstance(t, dict) for t in ts):
        raise ValueError("evidence timestamps must be an array of objects")
    for t in ts:
        canon.encode(t)  # must be canonical JSON data
    return Evidence(idx, envelope_from_value(v["envelope"]), ts)


class Log:
    """An append-only Merkle log of entry digests with signed checkpoints."""

    def __init__(self, origin: str, key: ed25519.Ed25519PrivateKey | None, vkey: str | None = None):
        if not note.valid_name(origin):
            raise ValueError(f"invalid log origin {origin!r}")
        self.origin, self._key = origin, key
        self._vkey = vkey
        self.tree = merkle.Tree()
        self.digests: list[bytes] = []
        self.latest: note.Note | None = None
        self.history: dict[int, str] = {}

    def vkey(self) -> str:
        if self._key is None:
            return self._vkey or ""
        return note.format_vkey(self.origin, note.TYPE_ED25519, self._key.public_key().public_bytes_raw())

    def append(self, digest: bytes) -> int:
        self.digests.append(digest)
        return self.tree.append(leaf_hash(digest))

    @property
    def size(self) -> int:
        return self.tree.size

    def sign_checkpoint(self) -> str:
        if self._key is None:
            raise ValueError("this copy of the log is read-only (no log key)")
        body = note.Checkpoint(self.origin, self.size, self.tree.root(self.size)).body()
        signed = note.sign(body, self.origin, self._key)
        self.latest = note.parse(signed)
        self.history[self.size] = signed
        return signed

    def latest_text(self) -> str:
        return str(self.latest) if self.latest else ""

    def add_cosignature(self, line: note.SigLine) -> None:
        self.latest.add_sig_line(line)
        self.history[self.size] = str(self.latest)

    def inclusion_proof(self, i: int, size: int) -> list[bytes]:
        return self.tree.inclusion_proof(i, size)

    def consistency_proof(self, m: int, n: int) -> list[bytes]:
        return self.tree.consistency_proof(m, n)

    def write_tiles(self, directory: str | pathlib.Path) -> None:
        """Publish the latest checkpoint and C2SP tlog-tiles (digests only)."""
        root = pathlib.Path(directory)
        size = note.parse_checkpoint(self.latest.text).size

        def write(rel: str, b: bytes) -> None:
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b)

        for start in range(0, size, 256):
            end = min(start + 256, size)
            write(_tile("entries", start // 256, end - start), b"".join(struct.pack(">H", 32) + d for d in self.digests[start:end]))
        level, span = 0, 1
        while span <= size:
            count = size // span
            for start in range(0, count, 256):
                end = min(start + 256, count)
                hs = [self.tree.leaf_hash_at(k) if span == 1 else self.tree.subtree_root(k * span, (k + 1) * span) for k in range(start, end)]
                write(_tile(str(level), start // 256, end - start), b"".join(hs))
            level, span = level + 1, span * 256
        write("checkpoint", str(self.latest).encode("utf-8"))


def tile_path(n: int) -> str:
    s = f"{n % 1000:03d}"
    n //= 1000
    while n > 0:
        s = f"x{n % 1000:03d}/" + s
        n //= 1000
    return s


def _tile(level: str, n: int, width: int) -> str:
    p = f"tile/{level}/{tile_path(n)}"
    return p + (f".p/{width}" if width < 256 else "")


@dataclass
class Attester:
    id: str
    tenant: str
    kind: str
    key: object
    enrolled_at: dt.datetime
    last_seq: int = 0
    last_payload: bytes = b""


@dataclass
class _Nonce:
    subject: str
    at: dt.datetime
    used: bool = False


class IngestError(ValueError):
    pass


class Server:
    """Validates submissions, timestamps them, logs their commitments and
    keeps the evidence. Not safe for concurrent use; serialize calls (for
    example one worker per log, or a database lock)."""

    def __init__(self, log: Log, tsas: list[Authority], clock: Callable[[], dt.datetime],
                 nonce_source: Callable[[str, dt.datetime], bytes] | None = None):
        self.log, self._tsas, self._clock = log, tsas, clock
        self._nonce_source = nonce_source or (lambda subject, at: secrets.token_bytes(16))
        self.tenants: dict[str, object] = {}
        self.attesters: dict[str, Attester] = {}  # by tenant + "/" + attester ID
        self._nonces: dict[str, _Nonce] = {}
        self.evidence: list[Evidence] = []

    def issue_nonce(self, subject: str) -> bytes:
        n = self._nonce_source(subject, self._clock())
        if len(n) != 16 or n.hex() in self._nonces:
            raise IngestError("nonce source returned a bad or repeated nonce")
        self._nonces[n.hex()] = _Nonce(subject, self._clock())
        return n

    def submit(self, env: Envelope) -> Evidence:
        st = self._check(env)
        return self._commit(env, st)

    def append_without_checks(self, env: Envelope) -> Evidence:
        """Log while skipping ingest checks. Simulates a bypassed server so
        tests can show verifiers still catch it. Never use in production."""
        return self._commit(env, posture.validate(env.payload))

    def _check(self, env: Envelope) -> posture.Statement:
        if env.payload_type != PAYLOAD_TYPE_IN_TOTO:
            raise IngestError(f"payload type {env.payload_type!r} is not accepted")
        try:
            st = posture.validate(env.payload)
        except posture.ContentError as e:
            raise IngestError(f"statement rejected: {e}") from None
        now = self._clock()

        def sig_ok(i, key):
            try:
                env.verify_signature(i, key)
                return True
            except ValueError:
                return False

        if not st.is_posture and st.str("kind") == "tenant_genesis":
            key = parse_public_key_b64(st.str("tenant_key"))
            subject, when = posture.tenant_id(key), st.time("enrolled_at")
            if st.str("tenant") != subject:
                raise IngestError("tenant ID does not match the tenant key")
            if subject in self.tenants:
                raise IngestError("tenant already exists")
            if len(env.signatures) != 1 or not sig_ok(0, key):
                raise IngestError("tenant genesis must carry one valid signature by the tenant key")
        elif not st.is_posture:
            tkey = self.tenants.get(st.str("tenant"))
            if tkey is None:
                raise IngestError("enrollment for an unknown tenant")
            key = parse_public_key_b64(st.str("attester_key"))
            subject, when = st.str("attester"), st.time("enrolled_at")
            if posture.attester_id(posture.AttesterKind(st.str("attester_kind")), key) != subject:
                raise IngestError("attester ID does not match the attester key")
            if st.str("tenant") + "/" + subject in self.attesters:
                raise IngestError("attester already enrolled in this tenant")
            if len(env.signatures) != 2 or not sig_ok(0, tkey) or not sig_ok(1, key):
                raise IngestError("enrollment needs a valid tenant signature followed by the attester's proof-of-possession signature")
        else:
            a = self.attesters.get(st.str("tenant") + "/" + st.str("attester"))
            if a is None:
                raise IngestError("statement from an attester that is not enrolled")
            subject, when = a.id, st.time("observed_at")
            if st.str("attester_kind") != a.kind:
                raise IngestError("statement does not match the attester's enrollment")
            if len(env.signatures) != 1 or not sig_ok(0, a.key):
                raise IngestError("statement signature is not valid for the enrolled key")
            if st.int("seq") != a.last_seq + 1:
                raise IngestError(f"sequence {st.int('seq')} rejected: expected {a.last_seq + 1} (replay or gap)")
            if st.str("prev") != a.last_payload.hex():
                raise IngestError("prev does not match the attester's previous statement")

        n = self._nonces.get(st.str("nonce"))
        if n is None:
            raise IngestError("nonce was not issued by this server")
        if n.used:
            raise IngestError("nonce already used (replay)")
        if n.subject != subject:
            raise IngestError("nonce was issued to a different subject")
        if now - n.at > NONCE_LIFETIME:
            raise IngestError("nonce expired")
        if abs(now - when) > MAX_CLOCK_SKEW:
            raise IngestError(f"statement time is {now - when} away from the server clock (backdated or clock wrong)")
        return st

    def _commit(self, env: Envelope, st: posture.Statement) -> Evidence:
        if len(self._tsas) < 2:
            raise IngestError("at least two timestamp authorities are required")
        digest = entry_digest(env)
        tokens = [a.timestamp(digest) for a in self._tsas]
        n = self._nonces.get(st.str("nonce"))
        if n:
            n.used = True
        ev = Evidence(self.log.append(digest), env, tokens, st)
        self.evidence.append(ev)
        self._index(ev)
        return ev

    def import_evidence(self, ev: Evidence) -> Evidence:
        """Append existing evidence verbatim (mirrors, forked-log simulations)."""
        cp = Evidence(self.log.size, ev.envelope, ev.timestamps, posture.validate(ev.envelope.payload))
        self.log.append(entry_digest(cp.envelope))
        self.evidence.append(cp)
        self._index(cp)
        return cp

    def _index(self, ev: Evidence) -> None:
        st = ev.statement
        key = st.str("tenant") + "/" + st.str("attester")
        if not st.is_posture and st.str("kind") == "tenant_genesis":
            self.tenants[st.str("tenant")] = parse_public_key_b64(st.str("tenant_key"))
        elif not st.is_posture:
            self.attesters[key] = Attester(st.str("attester"), st.str("tenant"), st.str("attester_kind"),
                                           parse_public_key_b64(st.str("attester_key")), st.time("enrolled_at"),
                                           0, posture.payload_digest(ev.envelope.payload))
        else:
            a = self.attesters.get(key)
            if a and st.int("seq") > a.last_seq:
                a.last_seq, a.last_payload = st.int("seq"), posture.payload_digest(ev.envelope.payload)
