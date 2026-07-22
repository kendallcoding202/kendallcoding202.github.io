import json

import pytest

from kovyr_vault import crypto
from kovyr_vault.vault import Vault, VaultError, BLOB_DIR


PASS = "test-passphrase"


def test_create_open_roundtrip(tmp_path):
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    src = tmp_path / "secret.txt"
    src.write_bytes(b"client ssn list")

    vault = Vault.open(vault_dir, PASS)
    vault.add_file(src, "secret.txt")

    reopened = Vault.open(vault_dir, PASS)
    assert reopened.read_file("secret.txt") == b"client ssn list"


def test_wrong_passphrase_rejected(tmp_path):
    Vault.create(tmp_path / "vault", PASS)
    with pytest.raises(crypto.WrongPassphrase):
        Vault.open(tmp_path / "vault", "not-it")


def test_no_plaintext_at_rest(tmp_path):
    vault_dir = tmp_path / "vault"
    vault = Vault.create(vault_dir, PASS)
    src = tmp_path / "secret.txt"
    src.write_bytes(b"UNIQUE-PLAINTEXT-MARKER")
    vault.add_file(src, str(src))

    for path in vault_dir.rglob("*"):
        if path.is_file():
            content = path.read_bytes()
            assert b"UNIQUE-PLAINTEXT-MARKER" not in content
            # File names/paths are sensitive too — index is encrypted.
            assert b"secret.txt" not in content


def test_duplicate_content_stored_once(tmp_path):
    vault = Vault.create(tmp_path / "vault", PASS)
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"identical bytes")
    b.write_bytes(b"identical bytes")

    _, stored_a = vault.add_file(a, "a.bin")
    _, stored_b = vault.add_file(b, "b.bin")
    assert stored_a is True
    assert stored_b is False  # deduplicated

    blobs = [p for p in (tmp_path / "vault" / BLOB_DIR).rglob("*.kvb")]
    assert len(blobs) == 1
    assert len(vault.list_files()) == 2
    assert vault.read_file("b.bin") == b"identical bytes"


def test_restore_file(tmp_path):
    vault = Vault.create(tmp_path / "vault", PASS)
    src = tmp_path / "doc.txt"
    src.write_bytes(b"contents")
    vault.add_file(src, "doc.txt")
    dest = tmp_path / "restored" / "doc.txt"
    vault.restore_file("doc.txt", dest)
    assert dest.read_bytes() == b"contents"


def test_verify_detects_corruption(tmp_path):
    vault = Vault.create(tmp_path / "vault", PASS)
    src = tmp_path / "doc.txt"
    src.write_bytes(b"contents")
    vault.add_file(src, "doc.txt")
    assert vault.verify() == []

    blob = next((tmp_path / "vault" / BLOB_DIR).rglob("*.kvb"))
    data = bytearray(blob.read_bytes())
    data[-1] ^= 0xFF
    blob.write_bytes(bytes(data))
    problems = vault.verify()
    assert len(problems) == 1
    assert "doc.txt" in problems[0]


def test_refuses_double_create(tmp_path):
    Vault.create(tmp_path / "vault", PASS)
    with pytest.raises(VaultError):
        Vault.create(tmp_path / "vault", PASS)


def test_header_is_valid_json_without_secrets(tmp_path):
    Vault.create(tmp_path / "vault", PASS)
    header = json.loads((tmp_path / "vault" / "vault.json").read_text())
    assert header["format"] == "kovyr-vault"
    assert PASS not in json.dumps(header)
