"""The free checker endpoint."""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from web.app import app  # noqa: E402

client = TestClient(app)

RATES = "Electrician, 48.20, 31.15, 1:2\nLaborer Group 1, 32.75, 24.40"
CLEAN = (
    "name,id,classification,rate,fringe,mon,tue,wed,thu,fri,sat,sun\n"
    "Marcus Ellery,4417,Electrician,48.20,31.15,8,8,8,8,8,0,0\n"
)
UNDERPAID = (
    "name,id,classification,rate,fringe,mon,tue,wed,thu,fri,sat,sun\n"
    "Priya Raghunathan,8802,Electrician,44.00,31.15,8,8,8,8,8,6,0\n"
)


def post(timesheet: str, rates: str = RATES, **extra):
    body = {"timesheet": timesheet, "rates": rates, "week_ending": "2026-03-08"}
    body.update(extra)
    return client.post("/api/check", json=body)


def test_health() -> None:
    assert client.get("/api/health").json()["status"] == "ok"


def test_index_is_served() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "WH-347" in response.text


def test_a_clean_week_is_filable_and_returns_the_form() -> None:
    data = post(CLEAN, signatory_name="Dana Whitfield", signatory_title="Owner",
                contractor_name="Hollow Creek Electric LLC",
                contractor_address="18 Mill St", contract_number="X-1",
                project_name="Route 9", project_location="Kingston NY",
                payroll_number="12").json()
    assert data["filable"] is True
    assert data["total_at_risk"] == "0"
    assert data["form"] is not None
    assert "Form WH-347" in data["form"]


def test_underpayment_is_priced_and_blocks() -> None:
    data = post(UNDERPAID).json()
    assert data["filable"] is False
    assert float(data["total_at_risk"]) > 0
    rules = {f["rule_id"] for f in data["findings"]}
    assert "WAGE_BASE_UNDERPAID" in rules
    assert "WAGE_OVERTIME_SHORT" in rules


def test_no_form_is_offered_while_a_blocker_stands() -> None:
    """The whole point: a form should not exist for a payroll that is wrong."""
    assert post(UNDERPAID).json()["form"] is None


def test_worker_rows_carry_the_shortfall() -> None:
    worker = post(UNDERPAID).json()["workers"][0]
    assert worker["name"] == "Priya Raghunathan"
    assert worker["required_base"] == "48.20"
    assert float(worker["shortfall"]) > 0


def test_unknown_classification_reports_no_required_base() -> None:
    sheet = CLEAN.replace("Electrician", "Electricion")
    worker = post(sheet).json()["workers"][0]
    assert worker["required_base"] is None


def test_bad_date_is_rejected_with_a_readable_message() -> None:
    response = post(CLEAN, week_ending="last tuesday")
    assert response.status_code == 400
    assert "week ending date" in response.json()["detail"]


def test_empty_rates_are_rejected() -> None:
    response = post(CLEAN, rates="")
    assert response.status_code == 400
    assert "wage rates" in response.json()["detail"]


def test_unreadable_timesheet_is_rejected() -> None:
    response = post("name,classification\nA,Electrician\n")
    assert response.status_code == 400
    assert "day columns" in response.json()["detail"]


def test_oversized_input_is_refused() -> None:
    assert post("x" * 200_001).status_code == 413


def test_header_rules_are_suppressed_when_the_header_was_not_asked_for() -> None:
    """A free check must not cry wolf about fields the form never collected."""
    data = post(CLEAN).json()
    rules = {f["rule_id"] for f in data["findings"]}
    assert "FORM_MISSING_HEADER" not in rules
    assert "FORM_NO_SIGNATORY" not in rules
    assert data["checked_header"] is False
    assert data["filable"] is True


def test_header_rules_apply_once_the_header_is_supplied() -> None:
    data = post(CLEAN, contractor_name="Hollow Creek Electric LLC",
                signatory_name="Dana Whitfield").json()
    assert data["checked_header"] is True
    assert "FORM_MISSING_HEADER" in {f["rule_id"] for f in data["findings"]}
