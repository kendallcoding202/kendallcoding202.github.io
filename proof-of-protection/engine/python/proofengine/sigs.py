"""Keys and signatures. Mirrors engine/sigs (see SPEC.md, "Keys and signatures").

* ecdsa-p256-sha256 (ES256): devices, the firm, staff. Signatures are IEEE
  P1363 r||s (64 bytes) with low S (s <= n/2). DER from a library or KMS
  must be converted with ecdsa_from_der.
* ed25519: the vendor's service keys, the log, witnesses, simulated TSAs.

Public keys travel as DER SubjectPublicKeyInfo; only the canonical
encodings are accepted (re-encoding must reproduce the input).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
from typing import Protocol

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

ES256 = "ecdsa-p256-sha256"
ED25519 = "ed25519"

P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
P256_HALF_N = P256_N >> 1

_B64 = re.compile(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")


class SignatureError(ValueError):
    """A signature is malformed or does not verify."""


def decode_b64(s: str) -> bytes:
    """Decode standard padded base64, rejecting any non-canonical form."""
    if not isinstance(s, str) or not _B64.match(s):
        raise ValueError("invalid base64")
    b = base64.b64decode(s, validate=True)
    if base64.b64encode(b).decode("ascii") != s:
        raise ValueError("non-canonical base64")
    return b


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _spki(key) -> bytes:
    return key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


class PublicKey:
    """A parsed, canonical public key."""

    def __init__(self, key):
        if isinstance(key, ed25519.Ed25519PublicKey):
            self.alg = ED25519
        elif isinstance(key, ec.EllipticCurvePublicKey) and isinstance(key.curve, ec.SECP256R1):
            self.alg = ES256
        else:
            raise ValueError("public key: only P-256 and Ed25519 keys are accepted")
        self._key = key
        self.spki = _spki(key)

    def keyid(self) -> str:
        """Lowercase hex SHA-256 of the SPKI; the DSSE keyid."""
        return hashlib.sha256(self.spki).hexdigest()

    def b64(self) -> str:
        return b64(self.spki)

    def ed25519_raw(self) -> bytes:
        if self.alg != ED25519:
            raise ValueError("not an Ed25519 key")
        return self._key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    def verify(self, msg: bytes, sig: bytes) -> None:
        """Raise SignatureError unless sig is valid over msg."""
        if len(sig) != 64:
            raise SignatureError("signature is not a 64-byte raw signature (ES256 must be IEEE P1363 r||s, not DER)")
        try:
            if self.alg == ED25519:
                self._key.verify(sig, msg)
                return
            r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
            if not (0 < r < P256_N and 0 < s < P256_N):
                raise SignatureError("signature does not verify")
            if s > P256_HALF_N:
                raise SignatureError("ECDSA signature has high S; only low-S (s <= n/2) is accepted")
            self._key.verify(encode_dss_signature(r, s), msg, ec.ECDSA(hashes.SHA256()))
        except InvalidSignature:
            raise SignatureError("signature does not verify") from None


def parse_public_key(spki: bytes) -> PublicKey:
    try:
        k = serialization.load_der_public_key(spki)
    except (ValueError, TypeError) as e:
        raise ValueError(f"public key: {e}") from None
    pk = PublicKey(k)
    if pk.spki != spki:
        raise ValueError("public key: non-canonical SPKI encoding")
    return pk


def parse_public_key_b64(s: str) -> PublicKey:
    return parse_public_key(decode_b64(s))


def ecdsa_from_der(der: bytes) -> bytes:
    """Convert a DER ECDSA signature to 64-byte low-S P1363."""
    try:
        r, s = decode_dss_signature(der)
    except ValueError:
        raise SignatureError("malformed DER ECDSA signature") from None
    if encode_dss_signature(r, s) != der or not (0 < r < P256_N and 0 < s < P256_N):
        raise SignatureError("malformed DER ECDSA signature")
    if s > P256_HALF_N:
        s = P256_N - s
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def ecdsa_to_der(p1363: bytes) -> bytes:
    if len(p1363) != 64:
        raise SignatureError("not a 64-byte signature")
    return encode_dss_signature(int.from_bytes(p1363[:32], "big"), int.from_bytes(p1363[32:], "big"))


def high_s(p1363: bytes) -> bytes:
    """The malleated twin (r, n-s); exists so tests can show it is rejected."""
    s = int.from_bytes(p1363[32:], "big")
    return p1363[:32] + (P256_N - s).to_bytes(32, "big")


class Signer(Protocol):
    """Anything that signs in this module's wire encoding. A KMS or HSM
    backed signer only needs these two methods."""

    def public(self) -> PublicKey: ...

    def sign(self, msg: bytes) -> bytes: ...


class SoftwareSigner:
    """A signer backed by an in-memory private key."""

    def __init__(self, private_key):
        self._key = private_key
        self._pub = PublicKey(private_key.public_key())

    def public(self) -> PublicKey:
        return self._pub

    def sign(self, msg: bytes) -> bytes:
        if self._pub.alg == ED25519:
            return self._key.sign(msg)
        return ecdsa_from_der(self._key.sign(msg, ec.ECDSA(hashes.SHA256())))

    def pkcs8(self) -> bytes:
        return self._key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def generate(alg: str) -> SoftwareSigner:
    if alg == ES256:
        return SoftwareSigner(ec.generate_private_key(ec.SECP256R1()))
    if alg == ED25519:
        return SoftwareSigner(ed25519.Ed25519PrivateKey.generate())
    raise ValueError(f"unsupported algorithm {alg!r}")


def load_pkcs8(der: bytes) -> SoftwareSigner:
    return SoftwareSigner(serialization.load_der_private_key(der, password=None))


def ed25519_from_seed(seed: bytes) -> SoftwareSigner:
    return SoftwareSigner(ed25519.Ed25519PrivateKey.from_private_bytes(seed))


def hexdigest(b: bytes) -> str:
    return binascii.hexlify(hashlib.sha256(b).digest()).decode("ascii")
