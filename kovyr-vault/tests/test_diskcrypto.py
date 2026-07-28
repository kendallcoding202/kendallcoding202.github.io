"""Tests for the full-disk encryption status check (FileVault/BitLocker).

The OS command runner is injected, so these exercise the real platform
dispatch and output parsing without a Mac or Windows box."""

from kovyr_vault import diskcrypto


def _runner(mapping):
    """Build a fake run() that returns canned (code, output) by the tool
    named in cmd[0]."""
    def run(cmd):
        return mapping[cmd[0]]
    return run


# ---------- parsing ----------

def test_parse_fdesetup():
    assert diskcrypto.parse_fdesetup("FileVault is On.") is True
    assert diskcrypto.parse_fdesetup(
        "FileVault is On, but decryption is paused.") is True
    assert diskcrypto.parse_fdesetup("FileVault is Off.") is False
    assert diskcrypto.parse_fdesetup("something unexpected") is None


def test_parse_manage_bde():
    on = ("Volume C: [OSDisk]\n    Conversion Status: Fully Encrypted\n"
          "    Protection Status: Protection On")
    off = ("Volume C: []\n    Conversion Status: Fully Decrypted\n"
           "    Protection Status: Protection Off")
    assert diskcrypto.parse_manage_bde(on) is True
    assert diskcrypto.parse_manage_bde(off) is False
    assert diskcrypto.parse_manage_bde("access denied") is None


# ---------- macOS ----------

def test_macos_filevault_on():
    run = _runner({"fdesetup": (0, "FileVault is On.")})
    st = diskcrypto.check(run=run, platform="darwin")
    assert st.platform == "macos" and st.feature == "FileVault"
    assert st.encrypted is True and st.known
    assert "on" in st.detail.lower()


def test_macos_filevault_off():
    run = _runner({"fdesetup": (0, "FileVault is Off.")})
    st = diskcrypto.check(run=run, platform="darwin")
    assert st.encrypted is False and st.known
    assert "system settings" in st.detail.lower()


def test_macos_tool_fails_is_unknown():
    run = _runner({"fdesetup": (127, "command not found")})
    st = diskcrypto.check(run=run, platform="darwin")
    assert st.encrypted is None and not st.known


# ---------- Windows ----------

def test_windows_bitlocker_on_default_drive():
    seen = {}

    def run(cmd):
        seen["cmd"] = cmd
        return 0, "Protection Status: Protection On"

    st = diskcrypto.check(run=run, platform="win32")
    assert st.platform == "windows" and st.feature == "BitLocker"
    assert st.encrypted is True
    assert seen["cmd"] == ["manage-bde", "-status", "C:"]


def test_windows_bitlocker_off_custom_drive():
    run = _runner({"manage-bde": (0, "Protection Status: Protection Off")})
    st = diskcrypto.check(run=run, platform="win32", system_drive="D:")
    assert st.encrypted is False
    assert "D:" in st.detail


def test_windows_needs_admin_is_unknown():
    run = _runner({"manage-bde": (1, "ERROR: Access is denied.")})
    st = diskcrypto.check(run=run, platform="win32")
    assert st.encrypted is None
    assert "administrator" in st.detail.lower()


# ---------- other platforms ----------

def test_linux_not_assessed():
    st = diskcrypto.check(run=lambda cmd: (0, ""), platform="linux")
    assert st.platform == "linux" and st.encrypted is None
    assert st.tool == ""


def test_as_dict_round_trips_fields():
    st = diskcrypto.check(
        run=_runner({"fdesetup": (0, "FileVault is On.")}),
        platform="darwin")
    d = st.as_dict()
    assert d["encrypted"] is True
    assert d["feature"] == "FileVault"
    assert d["platform"] == "macos"
