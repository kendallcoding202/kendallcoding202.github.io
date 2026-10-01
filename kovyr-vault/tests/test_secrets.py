"""Tests for the OS-backed secret store.

The alert mailbox password is the only long-lived secret the app holds.
The important property is not that storing works — it is that when it
cannot work securely, nothing is written at all.
"""

import pytest

from kovyr_vault import secrets
from kovyr_vault.secrets import SecretError


def runner(result=(0, ""), out_for_get=None):
    calls = []

    def run(cmd, timeout=15):
        calls.append(cmd)
        if out_for_get is not None and "find-generic-password" in cmd:
            return out_for_get
        return result

    run.calls = calls
    return run


# ---------- the refusal that matters ----------

def test_refuses_to_store_where_there_is_no_keystore():
    """A plaintext fallback would undo the point entirely: a mail password
    readable on a machine being monitored for compromise."""
    with pytest.raises(SecretError, match="plain text"):
        secrets.set_secret("alert-smtp-password", "hunter2",
                           platform="linux")


def test_reading_where_unsupported_is_empty_not_an_error():
    assert secrets.get_secret("alert-smtp-password", platform="linux") is None


def test_available_platforms():
    assert secrets.available("darwin")
    assert secrets.available("win32")
    assert not secrets.available("linux")


# ---------- macOS keychain ----------

def test_macos_stores_with_update_so_a_resave_works():
    """Without -U a second save fails as a duplicate, which would look
    like 'saving your password silently stopped working'."""
    run = runner()
    secrets.set_secret("alert-smtp-password", "app-pw", run=run,
                       platform="darwin")
    cmd = run.calls[0]
    assert cmd[:3] == ["security", "add-generic-password", "-U"]
    assert "-s" in cmd and cmd[cmd.index("-s") + 1] == secrets.SERVICE
    assert cmd[cmd.index("-w") + 1] == "app-pw"


def test_macos_read_returns_the_password():
    run = runner(out_for_get=(0, "app-pw\n"))
    assert secrets.get_secret("alert-smtp-password", run=run,
                              platform="darwin") == "app-pw"


def test_macos_read_is_empty_when_absent():
    run = runner(out_for_get=(44, "The specified item could not be found"))
    assert secrets.get_secret("alert-smtp-password", run=run,
                              platform="darwin") is None


def test_macos_store_failure_is_reported():
    with pytest.raises(SecretError, match="keychain"):
        secrets.set_secret("alert-smtp-password", "pw",
                           run=runner((1, "User interaction is not allowed")),
                           platform="darwin")


def test_macos_delete_targets_the_right_entry():
    run = runner()
    secrets.delete_secret("alert-smtp-password", run=run, platform="darwin")
    assert run.calls[0][1] == "delete-generic-password"


# ---------- Windows store location ----------

def test_windows_store_path_is_namespaced_and_sanitised(tmp_path):
    """The name becomes a filename, so it must not be able to escape the
    directory it belongs in."""
    path = secrets._store_path("../../evil name", tmp_path)
    assert path.parent == tmp_path / "secrets"
    assert ".." not in path.name and "/" not in path.name


def test_windows_read_is_empty_when_nothing_stored(tmp_path):
    assert secrets.get_secret("alert-smtp-password", platform="win32",
                              base=tmp_path) is None
