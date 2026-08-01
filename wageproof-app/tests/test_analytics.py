"""Funnel measurement, and the guarantee that payroll data is never stored."""

from __future__ import annotations

import sqlite3

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from web import analytics  # noqa: E402
from web.analytics import AnalyticsError, Attribution  # noqa: E402
from web.app import METRICS_TOKEN_ENV, app  # noqa: E402

RATES = "Electrician, 48.20, 31.15"
SHEET = (
    "name,id,classification,rate,fringe,mon,tue,wed,thu,fri,sat,sun\n"
    "Marcus Ellery,4417,Electrician,48.20,31.15,8,8,8,8,8,0,0\n"
)


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Every test gets its own database."""
    monkeypatch.setenv(analytics.DB_PATH_ENV, str(tmp_path / "test.db"))
    analytics.init_db()
    yield tmp_path / "test.db"


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_events_are_recorded_and_counted() -> None:
    analytics.record_event("s1", "landed")
    analytics.record_event("s1", "started_check")
    analytics.record_event("s2", "landed")
    counts = analytics.funnel()["counts"]
    assert counts["landed"] == 2
    assert counts["started_check"] == 1


def test_sessions_are_counted_once_however_often_they_fire() -> None:
    """A reload is not a second visitor."""
    for _ in range(5):
        analytics.record_event("s1", "landed")
    assert analytics.funnel()["counts"]["landed"] == 1


def test_unknown_event_names_are_refused() -> None:
    with pytest.raises(AnalyticsError):
        analytics.record_event("s1", "bought_a_yacht")


def test_empty_session_is_refused() -> None:
    with pytest.raises(AnalyticsError):
        analytics.record_event("   ", "landed")


def test_funnel_rates_are_computed() -> None:
    for session in ("a", "b", "c", "d"):
        analytics.record_event(session, "landed")
    analytics.record_event("a", "started_check")
    analytics.record_event("b", "started_check")
    analytics.record_event("a", "completed_check")
    rates = analytics.funnel()["rates"]
    assert rates["started_per_landed"] == 0.5
    assert rates["completed_per_landed"] == 0.25
    assert rates["completed_per_started"] == 0.5


def test_funnel_handles_an_empty_database() -> None:
    result = analytics.funnel()
    assert result["completed_checks"] == 0
    assert result["rates"]["started_per_landed"] is None


def test_funnel_filters_by_campaign() -> None:
    analytics.record_event("a", "landed", Attribution(campaign="trigger-terms"))
    analytics.record_event("b", "landed", Attribution(campaign="category-terms"))
    assert analytics.funnel("trigger-terms")["counts"]["landed"] == 1


def test_leads_are_saved_with_rates() -> None:
    analytics.save_lead("Dana@Example.com ", rates=RATES, project_name="Route 9")
    with analytics.connect() as connection:
        row = connection.execute("SELECT * FROM leads").fetchone()
    assert row["email"] == "dana@example.com"  # normalised
    assert row["rates"] == RATES


def test_saving_the_same_email_twice_updates_rather_than_fails() -> None:
    analytics.save_lead("dana@example.com", rates="old")
    analytics.save_lead("dana@example.com", rates="new")
    with analytics.connect() as connection:
        rows = connection.execute("SELECT rates FROM leads").fetchall()
    assert len(rows) == 1
    assert rows[0]["rates"] == "new"


@pytest.mark.parametrize("bad", ["", "   ", "not-an-email", "a@b", "@example.com", "a b@c.com"])
def test_malformed_emails_are_refused(bad: str) -> None:
    with pytest.raises(AnalyticsError):
        analytics.save_lead(bad)


def test_oversized_rates_are_refused() -> None:
    with pytest.raises(AnalyticsError):
        analytics.save_lead("dana@example.com", rates="x" * 20_001)


def test_the_leads_table_has_no_column_for_a_timesheet() -> None:
    """Structural guarantee, not a promise: there is nowhere to put it."""
    with analytics.connect() as connection:
        columns = {r["name"] for r in connection.execute("PRAGMA table_info(leads)")}
    assert "timesheet" not in columns
    assert columns == {
        "id", "ts", "session_id", "email", "rates", "project_name",
        "source", "medium", "campaign", "term", "gclid",
    }


def test_running_a_check_writes_no_worker_data_anywhere(client, temp_db) -> None:
    """The promise on the landing page, enforced end to end."""
    response = client.post(
        "/api/check",
        json={"timesheet": SHEET, "rates": RATES, "week_ending": "2026-03-08"},
    )
    assert response.status_code == 200

    connection = sqlite3.connect(temp_db)
    tables = [r[0] for r in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )]
    haystack = ""
    for table in tables:
        for row in connection.execute(f"SELECT * FROM {table}"):  # noqa: S608 - test-only
            haystack += " ".join(str(v) for v in row)
    connection.close()

    assert "Marcus Ellery" not in haystack
    assert "4417" not in haystack


def test_event_endpoint_records(client) -> None:
    body = {"session_id": "abc", "name": "landed", "campaign": {"gclid": "xyz"}}
    assert client.post("/api/event", json=body).json() == {"recorded": True}
    assert analytics.funnel()["counts"]["landed"] == 1


def test_event_endpoint_swallows_bad_input_rather_than_erroring(client) -> None:
    """A broken metric must never surface to someone mid-task."""
    response = client.post("/api/event", json={"session_id": "abc", "name": "nonsense"})
    assert response.status_code == 200
    assert response.json() == {"recorded": False}


def test_save_endpoint_stores_and_reports_errors(client) -> None:
    ok = client.post("/api/save", json={"email": "dana@example.com", "rates": RATES})
    assert ok.json() == {"status": "saved"}

    bad = client.post("/api/save", json={"email": "nope"})
    assert bad.status_code == 400
    assert "email address" in bad.json()["detail"]


def test_funnel_endpoint_is_disabled_without_a_token(client, monkeypatch) -> None:
    monkeypatch.delenv(METRICS_TOKEN_ENV, raising=False)
    assert client.get("/api/funnel").status_code == 404


def test_funnel_endpoint_rejects_a_wrong_token(client, monkeypatch) -> None:
    monkeypatch.setenv(METRICS_TOKEN_ENV, "secret")
    assert client.get("/api/funnel", headers={"X-Metrics-Token": "guess"}).status_code == 401


def test_funnel_endpoint_returns_the_numbers_with_the_right_token(client, monkeypatch) -> None:
    monkeypatch.setenv(METRICS_TOKEN_ENV, "secret")
    analytics.record_event("a", "completed_check")
    data = client.get("/api/funnel", headers={"X-Metrics-Token": "secret"}).json()
    assert data["completed_checks"] == 1
