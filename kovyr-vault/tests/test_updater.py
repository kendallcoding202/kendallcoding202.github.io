"""Tests for the in-app updater.

An updater is a code-execution channel, so the refusal paths matter more
than the happy path. Every check is exercised with an injected command
runner — no real Mac required.
"""

from pathlib import Path

import pytest

from kovyr_vault import updater
from kovyr_vault.updater import UpdateError

GOOD_URL = updater.ALLOWED_ASSET_PREFIX + "kovyr-vault-v9.9.9/KovyrVault.dmg"


def runner(mapping, default=(1, "")):
    """Fake command runner keyed on the executable name."""
    def run(cmd, timeout=120):
        return mapping.get(cmd[0], default)
    return run


# ---------- asset selection treats the API as untrusted ----------

def test_pick_asset_accepts_project_release_url():
    assets = [{"name": "KovyrVault.dmg", "browser_download_url": GOOD_URL}]
    assert updater.pick_asset(assets) == GOOD_URL


def test_pick_asset_refuses_foreign_host():
    """A compromised or spoofed API response must not be able to point
    the updater at someone else's server."""
    for bad in ("https://evil.example/KovyrVault.dmg",
                "http://github.com/kendallcoding202/x/releases/download/a/b",
                "https://github.com/someoneelse/repo/releases/download/a/b",
                "file:///tmp/evil.dmg", ""):
        assets = [{"name": "KovyrVault.dmg", "browser_download_url": bad}]
        assert updater.pick_asset(assets) is None, bad


def test_pick_asset_missing_or_malformed():
    assert updater.pick_asset([]) is None
    assert updater.pick_asset(None) is None
    assert updater.pick_asset([{"name": "other.zip",
                                "browser_download_url": GOOD_URL}]) is None
    assert updater.pick_asset(["not a dict"]) is None


def test_download_refuses_disallowed_url(tmp_path):
    with pytest.raises(UpdateError):
        updater.download("https://evil.example/x.dmg", tmp_path / "x.dmg")


# ---------- signing identity ----------

CODESIGN_OUT = ("Executable=/Applications/Kovyr Vault.app\n"
                "Identifier=com.kovyr.vault\n"
                "Authority=Developer ID Application: Kendall Sorenson (AB12CD34EF)\n"
                "TeamIdentifier=AB12CD34EF\n")


def test_team_identifier_parsed():
    run = runner({"codesign": (0, CODESIGN_OUT)})
    assert updater.team_identifier("/x.app", run=run) == "AB12CD34EF"


def test_team_identifier_none_when_unsigned():
    assert updater.team_identifier("/x.app",
                                   run=runner({"codesign": (1, "code object is not signed at all")})) is None
    # ad-hoc signatures report "not set" — not an identity we can trust
    assert updater.team_identifier(
        "/x.app",
        run=runner({"codesign": (0, "TeamIdentifier=not set\n")})) is None


def test_signature_intact_and_gatekeeper():
    ok = runner({"codesign": (0, ""), "spctl": (0, "accepted")})
    bad = runner({"codesign": (1, "invalid signature"), "spctl": (1, "rejected")})
    assert updater.signature_intact("/x.app", run=ok)
    assert not updater.signature_intact("/x.app", run=bad)
    assert updater.gatekeeper_accepts("/x.app", run=ok)
    assert not updater.gatekeeper_accepts("/x.app", run=bad)


# ---------- the gate: verify_update ----------

def _verify_runner(*, verify_rc=0, spctl_rc=0, team_out=CODESIGN_OUT):
    """codesign is called both to --verify and to -dv; distinguish by the
    presence of the --verify flag."""
    def run(cmd, timeout=120):
        if cmd[0] == "codesign":
            return (verify_rc, "") if "--verify" in cmd else (0, team_out)
        if cmd[0] == "spctl":
            return (spctl_rc, "")
        return (1, "")
    return run


def test_verify_update_accepts_matching_identity():
    updater.verify_update("/new.app", "/cur.app", run=_verify_runner())


def test_verify_update_refuses_broken_signature():
    with pytest.raises(UpdateError, match="not intact"):
        updater.verify_update("/new.app", "/cur.app",
                              run=_verify_runner(verify_rc=1))


def test_verify_update_refuses_different_developer():
    """The decisive check: an update signed by anyone other than the
    identity already running must be refused."""
    def run(cmd, timeout=120):
        if cmd[0] == "codesign":
            if "--verify" in cmd:
                return 0, ""
            # the candidate reports a different team than the current app
            if "/new.app" in cmd:
                return 0, "TeamIdentifier=ZZ99ZZ99ZZ\n"
            return 0, CODESIGN_OUT
        return (0, "") if cmd[0] == "spctl" else (1, "")
    with pytest.raises(UpdateError, match="different developer"):
        updater.verify_update("/new.app", "/cur.app", run=run)


def test_verify_update_refuses_when_current_app_unsigned():
    """Without a trust anchor there is nothing to verify against."""
    def run(cmd, timeout=120):
        if cmd[0] == "codesign":
            return (0, "") if "--verify" in cmd else (1, "not signed")
        return (0, "") if cmd[0] == "spctl" else (1, "")
    with pytest.raises(UpdateError, match="not signed"):
        updater.verify_update("/new.app", "/cur.app", run=run)


def test_verify_update_refuses_when_gatekeeper_rejects():
    with pytest.raises(UpdateError, match="Gatekeeper"):
        updater.verify_update("/new.app", "/cur.app",
                              run=_verify_runner(spctl_rc=1))


# ---------- platform gate ----------

def test_supported_macos_only():
    assert updater.supported("darwin")
    assert not updater.supported("win32")   # needs Authenticode first
    assert not updater.supported("linux")


# ---------- dmg plumbing ----------

def test_attach_dmg_parses_mount_point():
    out = ("/dev/disk4          GUID_partition_scheme\n"
           "/dev/disk4s1        Apple_HFS                "
           "/Volumes/Kovyr Vault\n")
    mount = updater.attach_dmg("/tmp/x.dmg",
                               run=runner({"hdiutil": (0, out)}))
    # Compare via Path: the test suite also runs on Windows, where a
    # POSIX string round-trips through Path with backslashes.
    assert mount == Path("/Volumes/Kovyr Vault")


def test_attach_dmg_errors():
    with pytest.raises(UpdateError):
        updater.attach_dmg("/tmp/x.dmg", run=runner({"hdiutil": (1, "no")}))
    with pytest.raises(UpdateError, match="where the disk image mounted"):
        updater.attach_dmg("/tmp/x.dmg",
                           run=runner({"hdiutil": (0, "no mount here")}))


def test_app_in_mount(tmp_path):
    assert updater.app_in_mount(tmp_path) is None
    (tmp_path / "Kovyr Vault.app").mkdir()
    assert updater.app_in_mount(tmp_path).name == "Kovyr Vault.app"


def test_current_app_bundle_finds_enclosing_bundle():
    exe = "/Applications/Kovyr Vault.app/Contents/MacOS/Kovyr Vault"
    # Compare via Path, not str: this suite also runs on Windows.
    assert updater.current_app_bundle(exe) == \
        Path("/Applications/Kovyr Vault.app")
    # running from source: no bundle
    assert updater.current_app_bundle("/usr/bin/python3") is None


# ---------- install ----------

def test_replace_bundle_swaps_and_clears_backup(tmp_path):
    target = tmp_path / "Kovyr Vault.app"
    target.mkdir()
    (target / "old").write_text("v1")
    new = tmp_path / "new.app"
    new.mkdir()

    def run(cmd, timeout=120):
        if cmd[0] == "ditto":
            dst = Path(cmd[2])
            dst.mkdir(parents=True, exist_ok=True)
            (dst / "new").write_text("v2")
            return 0, ""
        return 1, ""

    updater.replace_bundle(new, target, run=run)
    assert (target / "new").exists()
    assert not (target / "old").exists()
    assert not target.with_name(target.name + ".old").exists()


def test_replace_bundle_restores_original_on_failure(tmp_path):
    """A failed install must never leave the client with no app."""
    target = tmp_path / "Kovyr Vault.app"
    target.mkdir()
    (target / "original").write_text("v1")
    new = tmp_path / "new.app"
    new.mkdir()
    with pytest.raises(UpdateError):
        updater.replace_bundle(new, target,
                               run=runner({"ditto": (1, "disk full")}))
    assert (target / "original").exists()   # rolled back
