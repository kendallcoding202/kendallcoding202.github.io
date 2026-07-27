"""Tests for keyfile two-factor unlocking."""

from pathlib import Path

import pytest

from kovyr_vault import crypto
from kovyr_vault.vault import Vault, VaultError, generate_keyfile

PASS = "test-passphrase"


def test_keyfile_vault_roundtrip(tmp_path):
    kf = generate_keyfile(tmp_path / "key.kovyrkey")
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS, keyfile=kf)
    assert Vault.requires_keyfile(vault_dir)

    src = tmp_path / "secret.txt"
    src.write_bytes(b"two-factor secret")
    Vault.open(vault_dir, PASS, keyfile=kf).add_file(src, "secret.txt")
    reopened = Vault.open(vault_dir, PASS, keyfile=kf)
    assert reopened.read_file("secret.txt") == b"two-factor secret"


def test_right_passphrase_wrong_keyfile_fails(tmp_path):
    kf = generate_keyfile(tmp_path / "key.kovyrkey")
    other = generate_keyfile(tmp_path / "other.kovyrkey")
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS, keyfile=kf)
    with pytest.raises(crypto.WrongPassphrase):
        Vault.open(vault_dir, PASS, keyfile=other)


def test_missing_keyfile_is_rejected(tmp_path):
    kf = generate_keyfile(tmp_path / "key.kovyrkey")
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS, keyfile=kf)
    with pytest.raises(VaultError):
        Vault.open(vault_dir, PASS)  # no keyfile supplied


def test_keyfile_not_needed_for_single_factor_vault(tmp_path):
    vault_dir = tmp_path / "vault"
    Vault.create(vault_dir, PASS)
    assert not Vault.requires_keyfile(vault_dir)
    Vault.open(vault_dir, PASS)  # opens fine, no keyfile


def test_generate_keyfile_refuses_overwrite(tmp_path):
    path = generate_keyfile(tmp_path / "key.kovyrkey")
    with pytest.raises(VaultError):
        generate_keyfile(path)


def test_wrapping_key_differs_with_keyfile(tmp_path):
    salt = crypto.new_salt()
    derived = crypto.derive_key(PASS, salt)
    plain = crypto.combine_wrapping_key(derived, salt, None)
    keyed = crypto.combine_wrapping_key(derived, salt, b"x" * 64)
    assert plain != keyed
    assert plain == derived  # no keyfile = passphrase key unchanged
