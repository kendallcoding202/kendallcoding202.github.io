"""Tests for the alert email — the one thing that leaves the machine.

The load-bearing test is `test_body_never_carries_a_filename`. Everything
else is plumbing; that one is the privacy promise. A mailbox is a far
softer target than the machine being monitored, so the message has to be
worth nothing to whoever reads it next.
"""

import pytest

from kovyr_vault import mail
from kovyr_vault.mail import MailConfig, MailError

SETTINGS = {
    "client": "Bright Smile Dental",
    "alerts_email": {
        "enabled": True, "host": "smtp.example.com", "port": 587,
        "username": "alerts@example.com", "sender": "alerts@example.com",
        "recipient": "owner@example.com", "starttls": True,
    },
}


class FakeSMTP:
    """Records what would have been sent."""

    def __init__(self, host, port, fail_on=None):
        self.host, self.port, self.fail_on = host, port, fail_on
        self.sent, self.logged_in, self.tls = [], None, False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        if self.fail_on == "starttls":
            raise OSError("tls handshake failed")
        self.tls = True

    def login(self, user, password):
        if self.fail_on == "login":
            import smtplib
            raise smtplib.SMTPAuthenticationError(535, b"bad password")
        self.logged_in = (user, password)

    def send_message(self, message):
        if self.fail_on == "send":
            raise OSError("connection reset")
        self.sent.append(message)


def factory(**kwargs):
    made = []

    def make(host, port):
        server = FakeSMTP(host, port, **kwargs)
        made.append(server)
        return server

    make.made = made
    return make


# ---------- the privacy promise ----------

def test_body_never_carries_a_filename():
    """The alert line is counts-only by construction. compose() must add
    nothing of its own — no path, no file name, no matched value."""
    alert = ("Attention needed: unusual file activity detected — "
             "open Kovyr Vault.")
    message = mail.compose(alert, "FRONT-DESK-PC", "Bright Smile Dental")
    body = message.get_content()
    for leak in ("/Users/", "C:\\", ".pdf", ".docx", "Patients",
                 "Smith", "chart"):
        assert leak not in body, leak
    assert "unusual file activity" in body
    assert "FRONT-DESK-PC" in body          # which machine, not which file


def test_subject_names_the_machine_not_the_data():
    message = mail.compose("something happened", "FRONT-DESK-PC")
    assert message["Subject"] == \
        "Kovyr Vault: attention needed on FRONT-DESK-PC"


def test_unknown_machine_degrades_politely():
    assert "this computer" in mail.compose("x", "")["Subject"]


# ---------- configuration ----------

def test_disabled_or_incomplete_config_sends_nothing():
    for settings in (
        {},
        {"alerts_email": {"enabled": False, "host": "h", "recipient": "r"}},
        {"alerts_email": {"enabled": True, "recipient": "r"}},      # no host
        {"alerts_email": {"enabled": True, "host": "h"}},           # no to
    ):
        assert MailConfig.from_config(settings) is None


def test_sender_defaults_to_the_username():
    settings = {"alerts_email": {"enabled": True, "host": "h",
                                 "username": "me@example.com",
                                 "recipient": "you@example.com"}}
    assert MailConfig.from_config(settings).sender == "me@example.com"


def test_round_trips_through_as_dict():
    original = MailConfig.from_config(SETTINGS)
    assert MailConfig.from_config({"alerts_email": original.as_dict()}) == \
        original


# ---------- sending ----------

def test_sends_over_starttls_with_login():
    make = factory()
    mail.send(MailConfig.from_config(SETTINGS), "unusual activity",
              "FRONT-DESK-PC", password="app-password", smtp_factory=make)
    server = make.made[0]
    assert server.tls is True
    assert server.logged_in == ("alerts@example.com", "app-password")
    message = server.sent[0]
    assert message["To"] == "owner@example.com"
    assert message["From"] == "alerts@example.com"


def test_send_raises_on_failure():
    for stage in ("starttls", "login", "send"):
        with pytest.raises(MailError):
            mail.send(MailConfig.from_config(SETTINGS), "x", "PC",
                      password="p", smtp_factory=factory(fail_on=stage))


# ---------- best effort: never break the check ----------

def test_try_send_reports_failure_instead_of_raising():
    """A mail server that is down must not turn a successful protection
    check into a failed one."""
    problem = mail.try_send(SETTINGS, "unusual activity", "PC",
                            get_password=lambda: "p",
                            smtp_factory=factory(fail_on="send"))
    assert problem and "could not send" in problem


def test_try_send_is_silent_when_alerts_are_off():
    make = factory()
    assert mail.try_send({}, "unusual activity", "PC",
                         get_password=lambda: "p", smtp_factory=make) is None
    assert make.made == []


def test_try_send_survives_a_keystore_that_refuses():
    """No stored password should mean a clean failure, not a crash."""
    def boom():
        raise RuntimeError("keychain locked")

    problem = mail.try_send(SETTINGS, "x", "PC", get_password=boom,
                            smtp_factory=factory())
    assert problem and "keychain locked" in problem
