"""Tests for registering the daily protection check with the OS.

Monitoring that only runs when someone clicks is not monitoring, so this
machinery is the difference between a real control and a demo. Every OS
call is injected, so both platforms and all four refusal paths are
exercised without a Mac or a PC.
"""

import plistlib

import pytest

from kovyr_vault import schedule
from kovyr_vault.schedule import ScheduleError

APP = "/Applications/Kovyr Vault.app/Contents/MacOS/Kovyr Vault"
COMMAND = [APP, "--check"]


def runner(mapping, default=(0, "")):
    """Fake OS runner keyed on the executable, recording every call."""
    calls = []

    def run(cmd, timeout=30):
        calls.append(cmd)
        return mapping.get(cmd[0], default)

    run.calls = calls
    return run


# ---------- platform gate ----------

def test_supported_platforms():
    assert schedule.supported("darwin")
    assert schedule.supported("win32")
    assert not schedule.supported("linux")


def test_unsupported_platform_is_refused_clearly():
    with pytest.raises(ScheduleError, match="macOS and Windows"):
        schedule.install(COMMAND, run=runner({}), platform="linux")


def test_empty_command_is_refused():
    with pytest.raises(ScheduleError, match="no command"):
        schedule.install([], run=runner({}), platform="darwin")


# ---------- macOS ----------

def test_macos_writes_a_loadable_launch_agent(tmp_path):
    run = runner({"launchctl": (0, "")})
    schedule.install(COMMAND, hour=12, minute=40, run=run,
                     platform="darwin", home=tmp_path)

    path = schedule.agent_path(tmp_path)
    assert path.exists()
    agent = plistlib.loads(path.read_bytes())
    assert agent["Label"] == schedule.LABEL
    assert agent["ProgramArguments"] == COMMAND
    assert agent["StartCalendarInterval"] == {"Hour": 12, "Minute": 40}
    # Logging in should not kick off a scan that fights the login rush.
    assert agent["RunAtLoad"] is False

    # Unload-then-load, so changing the schedule replaces the old job
    # instead of failing with "service already loaded".
    assert [c[1] for c in run.calls if c[0] == "launchctl"] == \
        ["unload", "load"]


def test_macos_rolls_back_when_launchctl_refuses(tmp_path):
    """A plist on disk that launchd never accepted would show as 'on' in
    Settings while nothing ever ran — worse than being off."""
    run = runner({"launchctl": (1, "Load failed: 5: Input/output error")})
    with pytest.raises(ScheduleError, match="refused"):
        schedule.install(COMMAND, run=run, platform="darwin", home=tmp_path)
    assert not schedule.agent_path(tmp_path).exists()


def test_macos_uninstall_unloads_and_removes(tmp_path):
    run = runner({"launchctl": (0, "")})
    schedule.install(COMMAND, run=run, platform="darwin", home=tmp_path)
    assert schedule.installed(run=run, platform="darwin", home=tmp_path)

    schedule.uninstall(run=run, platform="darwin", home=tmp_path)
    assert not schedule.agent_path(tmp_path).exists()
    assert not schedule.installed(run=run, platform="darwin", home=tmp_path)


def test_macos_uninstall_is_safe_when_nothing_is_installed(tmp_path):
    run = runner({"launchctl": (1, "Could not find specified service")})
    schedule.uninstall(run=run, platform="darwin", home=tmp_path)   # no raise


# ---------- Windows ----------

def test_windows_creates_a_daily_task():
    run = runner({"schtasks": (0, "SUCCESS")})
    schedule.install([r"C:\Program Files\Kovyr\kovyr-vault-app.exe",
                      "--check"],
                     hour=12, minute=40, run=run, platform="win32")
    cmd = run.calls[0]
    assert cmd[:4] == ["schtasks", "/Create", "/TN", schedule.TASK_NAME]
    assert "/SC" in cmd and cmd[cmd.index("/SC") + 1] == "DAILY"
    assert cmd[cmd.index("/ST") + 1] == "12:40"
    assert "/F" in cmd              # replace, don't error on re-enable


def test_windows_quotes_a_path_containing_spaces():
    """Unquoted, schtasks splits "C:\\Program Files\\..." at the space and
    silently schedules the wrong thing."""
    run = runner({"schtasks": (0, "")})
    schedule.install([r"C:\Program Files\Kovyr\kovyr-vault-app.exe",
                      "--check"], run=run, platform="win32")
    target = run.calls[0][run.calls[0].index("/TR") + 1]
    assert target.startswith('"C:\\Program Files\\')
    assert target.endswith('" --check')


def test_windows_install_failure_is_reported():
    run = runner({"schtasks": (1, "ERROR: Access is denied.")})
    with pytest.raises(ScheduleError, match="Access is denied"):
        schedule.install(COMMAND, run=run, platform="win32")


def test_windows_uninstall_tolerates_a_missing_task():
    run = runner({"schtasks": (1, "ERROR: The system cannot find the "
                                  "file specified.")})
    schedule.uninstall(run=run, platform="win32")        # no raise


def test_windows_uninstall_reports_a_real_failure():
    run = runner({"schtasks": (1, "ERROR: Access is denied.")})
    with pytest.raises(ScheduleError):
        schedule.uninstall(run=run, platform="win32")


def test_windows_installed_reflects_query_result():
    assert schedule.installed(run=runner({"schtasks": (0, "")}),
                              platform="win32")
    assert not schedule.installed(
        run=runner({"schtasks": (1, "cannot find")}), platform="win32")


# ---------- what the client reads ----------

def test_describe_is_plain_english():
    assert schedule.describe(12, 40) == \
        "Checks run automatically every day at 12:40pm."
    assert schedule.describe(9, 5) == \
        "Checks run automatically every day at 9:05am."
