"""Timestamp authorities. Mirrors engine/tsa.

Production uses RFC 3161 TSAs (for example Sigstore's timestamp-authority).
This prototype ships SimulatedAuthority: a local Ed25519 key signing a small
JSON token whose kind says "simulated". Swapping in RFC 3161 means one new
Authority (an HTTP client) and one new branch in verify().
"""

from __future__ import annotations

import datetime as dt
import re
import threading
from dataclasses import dataclass
from typing import Callable, Protocol

from . import canon
from .sigs import ED25519, PublicKey, Signer, b64, decode_b64

KIND_SIMULATED = "simulated-tsa/v1"
KIND_RFC3161 = "rfc3161"
TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def parse_time(s) -> dt.datetime:
    if not isinstance(s, str) or not _TIME.fullmatch(s):
        raise ValueError(f"bad timestamp {s!r}")
    t = dt.datetime.strptime(s, TIME_FORMAT).replace(tzinfo=dt.timezone.utc)
    if t.strftime(TIME_FORMAT) != s:
        raise ValueError(f"bad timestamp {s!r}")
    return t


def format_time(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).strftime(TIME_FORMAT)


class Authority(Protocol):
    def name(self) -> str: ...

    def timestamp(self, imprint: bytes) -> dict: ...


@dataclass(frozen=True)
class Trusted:
    name: str
    kind: str
    public_key: PublicKey


def simulated_message(tst: dict) -> bytes:
    return (KIND_SIMULATED + "\n").encode("ascii") + canon.encode(tst)


class SimulatedAuthority:
    def __init__(self, name: str, signer: Signer, clock: Callable[[], dt.datetime]):
        if signer.public().alg != ED25519:
            raise ValueError("simulated TSA keys are Ed25519")
        self._name, self._signer, self._clock = name, signer, clock
        self._serial = 0
        self._lock = threading.Lock()

    def name(self) -> str:
        return self._name

    def timestamp(self, imprint: bytes) -> dict:
        now = self._clock().astimezone(dt.timezone.utc)
        with self._lock:
            serial = max(int(now.timestamp() * 1000), self._serial + 1)
            self._serial = serial
        tst = {"gen_time": format_time(now), "imprint": imprint.hex(), "serial": serial, "tsa": self._name}
        return {"kind": KIND_SIMULATED, "sig": b64(self._signer.sign(simulated_message(tst))), "tst": tst}


@dataclass(frozen=True)
class Verified:
    tsa: str
    gen_time: dt.datetime


def verify(token: dict, imprint: bytes, trusted: list[Trusted]) -> Verified:
    kind = token.get("kind") if isinstance(token, dict) else None
    if kind == KIND_RFC3161:
        raise ValueError("RFC 3161 tokens are specified but not verified by this prototype")
    if kind != KIND_SIMULATED:
        raise ValueError(f"unknown timestamp token kind {kind!r}")
    if set(token) != {"kind", "sig", "tst"}:
        raise ValueError("timestamp token must have exactly kind, sig and tst")
    tst = token["tst"]
    if not isinstance(tst, dict) or set(tst) != {"gen_time", "imprint", "serial", "tsa"}:
        raise ValueError("timestamp token tst must have exactly gen_time, imprint, serial and tsa")
    t = next((x for x in trusted if x.name == tst["tsa"] and x.kind == KIND_SIMULATED), None)
    if t is None:
        raise ValueError(f"timestamp from untrusted authority {tst['tsa']!r}")
    try:
        t.public_key.verify(simulated_message(tst), decode_b64(token["sig"]))
    except ValueError as e:
        raise ValueError(f"timestamp from {t.name}: {e}") from None
    if tst["imprint"] != imprint.hex():
        raise ValueError(f"timestamp from {t.name} is for a different document")
    if isinstance(tst["serial"], bool) or not isinstance(tst["serial"], int):
        raise ValueError("timestamp serial is not an integer")
    return Verified(t.name, parse_time(tst["gen_time"]))
