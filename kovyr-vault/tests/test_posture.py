"""Tests for the baseline device-security posture checks.

The OS command runner is injected, so these exercise real platform
dispatch and output parsing without a Mac or Windows box."""

from kovyr_vault import posture


def _runner(mapping):
    """Fake run() returning canned (code, output) keyed by cmd[0]."""
    def run(cmd):
        return mapping[cmd[0]]
    return run


# ---------- firewall parsing ----------

def test_parse_socketfilterfw():
    assert posture.parse_socketfilterfw("Firewall is enabled. (State = 1)") is True
    assert posture.parse_socketfilterfw("Firewall is disabled. (State = 0)") is False
    assert posture.parse_socketfilterfw("???") is None


def test_parse_netsh_firewall_all_on():
    text = ("Domain Profile Settings:\nState                 ON\n"
            "Private Profile Settings:\nState                 ON\n"
            "Public Profile Settings:\nState                 ON\n")
    assert posture.parse_netsh_firewall(text) is True


def test_parse_netsh_firewall_one_off():
    text = ("Domain Profile Settings:\nState                 ON\n"
            "Public Profile Settings:\nState                 OFF\n")
    assert posture.parse_netsh_firewall(text) is False


def test_parse_netsh_firewall_empty_unknown():
    assert posture.parse_netsh_firewall("garbage") is None


# ---------- screen lock parsing ----------

def test_parse_mac_screenlock():
    on, delay = posture.parse_mac_screenlock(
        "2026-07-28 23:56:40.819 sysadminctl[34462:33888409] "
        "screenLock delay is 300 seconds")
    assert on is True and delay == 300
    off, _ = posture.parse_mac_screenlock(
        "sysadminctl[1] screenLock is off")
    assert off is False
    unk, _ = posture.parse_mac_screenlock("unrelated output")
    assert unk is None


def test_screenlock_macos_on_shows_delay():
    run = _runner({"sysadminctl":
                   (0, "sysadminctl[1] screenLock delay is 300 seconds")})
    c = posture.screenlock_check(run=run, platform="darwin")
    assert c.status is True
    assert "5 minutes" in c.detail


def test_screenlock_macos_off():
    run = _runner({"sysadminctl": (0, "sysadminctl[1] screenLock is off")})
    c = posture.screenlock_check(run=run, platform="darwin")
    assert c.status is False
    assert "doesn't auto-lock" in c.detail


def test_parse_win_screenlock_secure_and_short():
    text = ("    ScreenSaveActive    REG_SZ    1\n"
            "    ScreenSaverIsSecure    REG_SZ    1\n"
            "    ScreenSaveTimeOut    REG_SZ    600\n")
    assert posture.parse_win_screenlock(text) is True


def test_parse_win_screenlock_too_long_is_off():
    text = ("    ScreenSaveActive    REG_SZ    1\n"
            "    ScreenSaverIsSecure    REG_SZ    1\n"
            "    ScreenSaveTimeOut    REG_SZ    3600\n")
    assert posture.parse_win_screenlock(text) is False


def test_parse_win_screenlock_not_secure_is_off():
    text = ("    ScreenSaveActive    REG_SZ    1\n"
            "    ScreenSaverIsSecure    REG_SZ    0\n")
    assert posture.parse_win_screenlock(text) is False


def test_parse_win_screenlock_missing_is_unknown():
    assert posture.parse_win_screenlock("    NightLight  REG_SZ  1\n") is None


# ---------- antivirus parsing ----------

def test_parse_av_enabled_defender():
    text = '{"displayName":"Windows Defender","productState":397568}'
    enabled, name = posture.parse_secautivirus(text)
    assert enabled is True and name == "Windows Defender"


def test_parse_av_disabled():
    text = '{"displayName":"Windows Defender","productState":393472}'
    enabled, name = posture.parse_secautivirus(text)
    assert enabled is False


def test_parse_av_none_registered():
    enabled, name = posture.parse_secautivirus("[]")
    assert enabled is False and name is None


def test_parse_av_picks_enabled_from_list():
    text = ('[{"displayName":"OldAV","productState":393472},'
            '{"displayName":"Norton","productState":397568}]')
    enabled, name = posture.parse_secautivirus(text)
    assert enabled is True and name == "Norton"


def test_parse_av_garbage_is_unknown():
    enabled, name = posture.parse_secautivirus("not json")
    assert enabled is None


# ---------- dispatch / check_all ----------

def test_firewall_check_macos_on():
    run = _runner({"/usr/libexec/ApplicationFirewall/socketfilterfw":
                   (0, "Firewall is enabled. (State = 1)")})
    c = posture.firewall_check(run=run, platform="darwin")
    assert c.key == "firewall" and c.status is True


def test_firewall_check_tool_fail_unknown():
    run = _runner({"netsh": (1, "error")})
    c = posture.firewall_check(run=run, platform="win32")
    assert c.status is None and not c.known


def test_check_all_key_set_is_identical_on_every_platform():
    """A report or aggregator must see one stable shape — a control that
    doesn't apply here is reported as not-applicable, never omitted."""
    expected = list(posture.CONTROL_KEYS)
    for plat in ("darwin", "win32", "linux"):
        checks = posture.check_all(run=lambda cmd: (1, ""), platform=plat)
        assert [c.key for c in checks] == expected, plat


def test_antivirus_not_applicable_on_macos_not_unknown():
    """'Doesn't apply on a Mac' must be distinguishable from 'we tried and
    couldn't tell' — otherwise a Mac looks like it failed a check."""
    mac = posture.check_all(run=lambda cmd: (1, ""), platform="darwin")
    av = next(c for c in mac if c.key == "antivirus")
    assert av.status is None
    assert av.applicable is False
    assert "macos" in av.detail.lower()

    win = posture.check_all(run=lambda cmd: (1, ""), platform="win32")
    av_win = next(c for c in win if c.key == "antivirus")
    assert av_win.applicable is True   # applies; this run just couldn't tell
    assert av_win.status is None


def test_applicable_flag_serialized():
    mac = posture.check_all(run=lambda cmd: (1, ""), platform="darwin")
    assert all("applicable" in c.as_dict() for c in mac)


def test_not_applicable_never_counts_as_a_failure():
    """Exit-code / alerting logic keys off `status is False`; a control
    that doesn't apply must never look like a control that is off."""
    for plat in ("darwin", "win32", "linux"):
        checks = posture.check_all(run=lambda cmd: (1, ""), platform=plat)
        for c in checks:
            if not c.applicable:
                assert c.status is not False, (plat, c.key)


def test_check_all_returns_check_objects():
    def run(cmd):
        if cmd[0] == "fdesetup":
            return 0, "FileVault is On."
        if cmd[0].endswith("socketfilterfw"):
            return 0, "Firewall is enabled. (State = 1)"
        return 1, ""
    checks = posture.check_all(run=run, platform="darwin")
    disk = next(c for c in checks if c.key == "disk")
    fw = next(c for c in checks if c.key == "firewall")
    assert disk.status is True
    assert fw.status is True
    # everything serializes for the report/packet
    assert all("status" in c.as_dict() for c in checks)
