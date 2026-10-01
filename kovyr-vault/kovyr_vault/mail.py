"""Email the owner when a check finds something that needs attention.

This is the one place Kovyr Vault sends anything off the machine, and it
only happens when it has been switched on and configured. Everything else
— scanning, encryption, reporting — stays local, so the honest wording is
"nothing leaves this machine unless you turn on email alerts", not
"nothing leaves".

What goes in the message is deliberately thin. The body is built from the
same one-line summary the desktop notification uses, which carries counts
and nothing else: no filenames, no paths, no matched values. Someone
reading the mailbox learns that forty files changed at once on a named
computer — not what any of them were called. That holds even if the
mailbox is later breached, which is the scenario worth designing for.

Delivery is best effort. A mail server that is down, slow or misconfigured
must never turn a successful protection check into a failed one.
"""

from __future__ import annotations

import smtplib
import socket
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

SECRET_NAME = "alert-smtp-password"
TIMEOUT = 20


class MailError(Exception):
    """The alert could not be sent."""


@dataclass
class MailConfig:
    """Everything needed to send, except the password — that lives in the
    OS keystore and is fetched separately."""
    host: str
    port: int = 587
    username: str = ""
    sender: str = ""
    recipient: str = ""
    starttls: bool = True

    @classmethod
    def from_config(cls, config: dict) -> "MailConfig | None":
        raw = (config or {}).get("alerts_email") or {}
        if not raw.get("enabled"):
            return None
        host = (raw.get("host") or "").strip()
        recipient = (raw.get("recipient") or "").strip()
        if not host or not recipient:
            return None
        username = (raw.get("username") or "").strip()
        return cls(
            host=host,
            port=int(raw.get("port") or 587),
            username=username,
            sender=(raw.get("sender") or username).strip(),
            recipient=recipient,
            starttls=bool(raw.get("starttls", True)),
        )

    def as_dict(self, enabled: bool = True) -> dict:
        return {"enabled": enabled, "host": self.host, "port": self.port,
                "username": self.username, "sender": self.sender,
                "recipient": self.recipient, "starttls": self.starttls}


def compose(alert: str, machine: str, client: str = "") -> EmailMessage:
    """Build the alert message.

    `alert` is the notification summary, which is counts-only by
    construction — this function must never be handed a path, and adds
    none of its own.
    """
    where = machine or "this computer"
    message = EmailMessage()
    message["Subject"] = f"Kovyr Vault: attention needed on {where}"
    message["To"] = ""      # filled in by send(); keeps compose() pure
    message.set_content(
        f"{alert}\n\n"
        f"Computer: {where}\n"
        + (f"Name on reports: {client}\n" if client else "")
        + "\n"
        "Open Kovyr Vault on that computer and run a check to see the "
        "detail. This message deliberately carries no file names — only "
        "what was counted.\n"
    )
    return message


def send(config: MailConfig, alert: str, machine: str, client: str = "",
         password: str | None = None, smtp_factory=None) -> None:
    """Send one alert. Raises MailError on any failure."""
    message = compose(alert, machine, client)
    message["From"] = config.sender or config.username
    del message["To"]
    message["To"] = config.recipient

    def default_factory(host, port):
        return smtplib.SMTP(host, port, timeout=TIMEOUT)

    factory = smtp_factory or default_factory
    try:
        with factory(config.host, config.port) as server:
            if config.starttls:
                server.starttls(context=ssl.create_default_context())
            if config.username and password:
                server.login(config.username, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError, socket.timeout, ssl.SSLError) \
            as exc:
        raise MailError(f"could not send the alert email: {exc}") from exc


def try_send(config: dict, alert: str, machine: str,
             get_password=None, smtp_factory=None) -> str | None:
    """Send if alerts are configured. Returns an error string rather than
    raising: a mail problem must never fail the protection check that
    produced the alert."""
    settings = MailConfig.from_config(config)
    if settings is None:
        return None
    try:
        if get_password is None:
            from . import secrets as secrets_mod

            def get_password():
                return secrets_mod.get_secret(SECRET_NAME)
        send(settings, alert, machine, (config or {}).get("client", ""),
             password=get_password(), smtp_factory=smtp_factory)
    except Exception as exc:                   # noqa: BLE001
        return str(exc)
    return None
