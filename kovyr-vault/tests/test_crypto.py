import pytest

from kovyr_vault import crypto


def test_encrypt_decrypt_roundtrip():
    key = crypto.new_master_key()
    blob = crypto.encrypt(key, b"secret client data", b"aad")
    assert crypto.decrypt(key, blob, b"aad") == b"secret client data"


def test_ciphertext_is_not_plaintext():
    key = crypto.new_master_key()
    blob = crypto.encrypt(key, b"secret client data")
    assert b"secret client data" not in blob


def test_unique_nonces():
    key = crypto.new_master_key()
    a = crypto.encrypt(key, b"same")
    b = crypto.encrypt(key, b"same")
    assert a != b  # fresh nonce every time


def test_tamper_detection():
    key = crypto.new_master_key()
    blob = bytearray(crypto.encrypt(key, b"payload"))
    blob[-1] ^= 0xFF
    with pytest.raises(crypto.IntegrityError):
        crypto.decrypt(key, bytes(blob))


def test_wrong_aad_rejected():
    key = crypto.new_master_key()
    blob = crypto.encrypt(key, b"payload", b"context-a")
    with pytest.raises(crypto.IntegrityError):
        crypto.decrypt(key, blob, b"context-b")


def test_master_key_wrap_roundtrip():
    master = crypto.new_master_key()
    salt = crypto.new_salt()
    wrapped = crypto.wrap_master_key("correct horse", master, salt)
    assert crypto.unwrap_master_key("correct horse", wrapped, salt) == master


def test_wrong_passphrase_raises():
    master = crypto.new_master_key()
    salt = crypto.new_salt()
    wrapped = crypto.wrap_master_key("right", master, salt)
    with pytest.raises(crypto.WrongPassphrase):
        crypto.unwrap_master_key("wrong", wrapped, salt)
