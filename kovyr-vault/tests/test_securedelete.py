"""Tests for best-effort secure file erase."""

import pytest

from kovyr_vault import securedelete


def test_overwrite_changes_bytes_but_keeps_file(tmp_path):
    f = tmp_path / "secret.txt"
    original = b"SSN 123-45-6789 " * 100
    f.write_bytes(original)
    securedelete.overwrite(f)
    assert f.exists()                      # overwrite does not delete
    assert f.stat().st_size == len(original)  # same length
    assert f.read_bytes() != original      # contents scrambled


def test_secure_delete_removes_file(tmp_path):
    f = tmp_path / "secret.txt"
    f.write_bytes(b"card 4111111111111111")
    securedelete.secure_delete(f)
    assert not f.exists()


def test_overwrite_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        securedelete.overwrite(tmp_path / "nope.txt")


def test_secure_delete_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        securedelete.secure_delete(tmp_path / "nope.txt")


def test_secure_delete_empty_file(tmp_path):
    f = tmp_path / "empty.txt"
    f.write_bytes(b"")
    securedelete.secure_delete(f)   # zero-length must not error
    assert not f.exists()
