"""Cryptography for the vault: AES-256-GCM with a passphrase-wrapped master key.

Design:
- A random 32-byte master key encrypts all vault content.
- The master key is stored wrapped (encrypted) by a key derived from the
  user's passphrase via scrypt. Changing the passphrase only re-wraps the
  master key; nothing else needs re-encrypting.
- Every encryption uses a fresh random 96-bit nonce, stored alongside the
  ciphertext. GCM authenticates the data, so tampering or a wrong
  passphrase fails loudly instead of yielding garbage.
"""

from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

KEY_SIZE = 32
NONCE_SIZE = 12

# scrypt cost: ~32 MiB memory, comfortably slow for guessing, fast to unlock.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1

AAD_KEY_WRAP = b"kovyr-vault-key-v1"
AAD_INDEX = b"kovyr-vault-index-v1"


class WrongPassphrase(Exception):
    """The passphrase does not unlock this vault."""


class IntegrityError(Exception):
    """Stored ciphertext failed authentication — corrupted or tampered."""


def derive_key(passphrase: str, salt: bytes, *, n: int = SCRYPT_N,
               r: int = SCRYPT_R, p: int = SCRYPT_P) -> bytes:
    kdf = Scrypt(salt=salt, length=KEY_SIZE, n=n, r=r, p=p)
    return kdf.derive(passphrase.encode("utf-8"))


def new_master_key() -> bytes:
    return os.urandom(KEY_SIZE)


def new_salt() -> bytes:
    return os.urandom(16)


def encrypt(key: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    """Encrypt with AES-256-GCM; returns nonce || ciphertext+tag."""
    nonce = os.urandom(NONCE_SIZE)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def decrypt(key: bytes, blob: bytes, aad: bytes = b"") -> bytes:
    """Reverse of encrypt(). Raises IntegrityError on tamper/corruption."""
    nonce, ciphertext = blob[:NONCE_SIZE], blob[NONCE_SIZE:]
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, aad)
    except InvalidTag as exc:
        raise IntegrityError("authentication failed") from exc


def wrap_master_key(passphrase: str, master_key: bytes, salt: bytes) -> bytes:
    return encrypt(derive_key(passphrase, salt), master_key, AAD_KEY_WRAP)


def unwrap_master_key(passphrase: str, wrapped: bytes, salt: bytes) -> bytes:
    try:
        return decrypt(derive_key(passphrase, salt), wrapped, AAD_KEY_WRAP)
    except IntegrityError as exc:
        raise WrongPassphrase("incorrect passphrase for this vault") from exc
