"""Funnel measurement for the free checker.

The point of this file is to make one number answerable: **cost per completed
free check**. Without it a paid-search test has no denominator and cannot be
judged. See docs/ads.md.

What is stored, exactly:

* Anonymous funnel events — an opaque session id the browser generates, an
  event name, and the ad attribution parameters that arrived in the URL.
* A saved rate list, but only when someone explicitly asks us to keep it, and
  only their email plus the wage rates they typed.

What is never stored, anywhere, under any code path: **the time sheet**. It
carries worker names and partial social security numbers. There is no column
for it here and no function that accepts it. That is deliberate — the landing
page makes a promise about this and the schema is what keeps it.
"""

from __future__ import annotations

import os
import re
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DB_PATH_ENV = "WAGEPROOF_DB"
DEFAULT_DB = "wageproof.db"

# Deliberately permissive: this is a typo guard, not an identity check. The only
# thing worse than accepting a malformed address is rejecting a real one.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$")

# The funnel, in order. Anything else is rejected so a stray client cannot
# invent event names and quietly poison the denominator.
EVENTS = ("landed", "started_check", "completed_check", "save_shown", "save_clicked")

MAX_RATES_CHARS = 20_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    source      TEXT,
    medium      TEXT,
    campaign    TEXT,
    term        TEXT,
    gclid       TEXT
);
CREATE INDEX IF NOT EXISTS events_name_ts ON events (name, ts);
CREATE INDEX IF NOT EXISTS events_session ON events (session_id);

CREATE TABLE IF NOT EXISTS leads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    session_id   TEXT,
    email        TEXT NOT NULL,
    rates        TEXT,
    project_name TEXT,
    source       TEXT,
    medium       TEXT,
    campaign     TEXT,
    term         TEXT,
    gclid        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_email ON leads (email);
"""


class AnalyticsError(ValueError):
    """Raised when input is not something we will record."""


@dataclass(frozen=True)
class Attribution:
    """Where a visitor came from, as far as the URL told us."""

    source: str | None = None
    medium: str | None = None
    campaign: str | None = None
    term: str | None = None
    gclid: str | None = None

    def as_row(self) -> tuple[str | None, ...]:
        return (
            _trim(self.source),
            _trim(self.medium),
            _trim(self.campaign),
            _trim(self.term),
            _trim(self.gclid),
        )


def _trim(value: str | None, limit: int = 200) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()[:limit]
    return cleaned or None


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def db_path() -> Path:
    return Path(os.environ.get(DB_PATH_ENV, DEFAULT_DB))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """One connection per operation. Volume here is tiny; simplicity wins."""
    connection = sqlite3.connect(db_path(), timeout=5)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        yield connection
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with connect() as connection:
        connection.executescript(SCHEMA)


def new_session_id() -> str:
    return uuid.uuid4().hex


def record_event(session_id: str, name: str, attribution: Attribution | None = None) -> None:
    if name not in EVENTS:
        raise AnalyticsError(f"Unknown event {name!r}.")
    session = _trim(session_id, 64)
    if not session:
        raise AnalyticsError("A session id is required.")
    attribution = attribution or Attribution()
    with connect() as connection:
        connection.execute(
            "INSERT INTO events (ts, session_id, name, source, medium, campaign, term, gclid)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (_now(), session, name, *attribution.as_row()),
        )


def save_lead(
    email: str,
    rates: str | None = None,
    project_name: str | None = None,
    session_id: str | None = None,
    attribution: Attribution | None = None,
) -> None:
    """Store an email and the wage rates behind it. Never the time sheet."""
    address = (email or "").strip().lower()
    if not EMAIL_RE.match(address):
        raise AnalyticsError("That does not look like an email address.")
    if rates and len(rates) > MAX_RATES_CHARS:
        raise AnalyticsError("That is more wage rates than one determination holds.")

    attribution = attribution or Attribution()
    with connect() as connection:
        # Coming back to update your rates should not be an error.
        connection.execute(
            "INSERT INTO leads"
            " (ts, session_id, email, rates, project_name, source, medium, campaign, term, gclid)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(email) DO UPDATE SET"
            "  ts=excluded.ts, rates=excluded.rates, project_name=excluded.project_name",
            (
                _now(),
                _trim(session_id, 64),
                address,
                rates,
                _trim(project_name),
                *attribution.as_row(),
            ),
        )


def funnel(campaign: str | None = None) -> dict[str, object]:
    """The numbers the ad test is judged on.

    Counts are of distinct sessions, not raw events — one person reloading the
    page twice is one visitor, and counting otherwise would flatter the result.
    """
    clause = ""
    params: tuple[str, ...] = ()
    if campaign:
        clause = " WHERE campaign = ?"
        params = (campaign,)

    with connect() as connection:
        rows = connection.execute(
            f"SELECT name, COUNT(DISTINCT session_id) AS sessions FROM events{clause}"
            " GROUP BY name",
            params,
        ).fetchall()
        leads = connection.execute(
            "SELECT COUNT(*) AS n FROM leads"
            + (" WHERE campaign = ?" if campaign else ""),
            params,
        ).fetchone()["n"]

    counts = {name: 0 for name in EVENTS}
    counts.update({row["name"]: row["sessions"] for row in rows})

    landed = counts["landed"]
    started = counts["started_check"]
    completed = counts["completed_check"]

    def rate(numerator: int, denominator: int) -> float | None:
        return round(numerator / denominator, 4) if denominator else None

    return {
        "campaign": campaign,
        "counts": counts,
        "leads": leads,
        "rates": {
            "started_per_landed": rate(started, landed),
            "completed_per_landed": rate(completed, landed),
            "completed_per_started": rate(completed, started),
            "leads_per_completed": rate(leads, completed),
        },
        # Divide ad spend by this to get the number docs/ads.md judges the test
        # on. Under $25 is a pass, over $60 is a stop.
        "completed_checks": completed,
    }
