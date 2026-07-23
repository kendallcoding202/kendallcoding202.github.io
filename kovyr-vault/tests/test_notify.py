"""Tests for alert notification composition (the send path is
platform-native and best-effort by design)."""

from kovyr_vault import notify


def snap(**kw):
    base = {"canary_alerts": [], "new_failed_unlocks": 0}
    base.update(kw)
    return base


def test_quiet_check_no_notification():
    assert notify.compose_alert(snap(), 0) is None


def test_canary_outranks_everything():
    message = notify.compose_alert(
        snap(canary_alerts=["mass change"], new_failed_unlocks=3), 5)
    assert "Attention needed" in message


def test_failed_unlocks_message():
    message = notify.compose_alert(snap(new_failed_unlocks=2), 0)
    assert "2 failed vault unlock attempts" in message
    single = notify.compose_alert(snap(new_failed_unlocks=1), 0)
    assert "1 failed vault unlock attempt " in single


def test_drift_message():
    message = notify.compose_alert(snap(), 3)
    assert "3 new duplicate groups" in message


def test_standing_conditions_do_not_nag():
    # Existing duplicates / awaiting encryption are standing state, not
    # new signals — no notification.
    quiet = snap(awaiting_encryption=7)
    quiet["duplicate_files"] = 40
    assert notify.compose_alert(quiet, 0) is None
