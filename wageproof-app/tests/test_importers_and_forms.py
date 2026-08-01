"""Importing time sheets and rendering the form."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from wageproof.compliance import check_week
from wageproof.forms import build_payload, render_statement_of_compliance, render_text
from wageproof.importers import ImportError_, load_week, week_from_csv, workers_from_csv
from wageproof.models import PayrollWeek

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
WEEK_ENDING = date(2026, 3, 8)

WIDE_CSV = """name,id,classification,rate,mon,tue,wed,thu,fri,sat,sun
Marcus Ellery,4417,Electrician,48.20,8,8,8,8,8,0,0
Priya Raghunathan,8802,Electrician,48.20,8,8,8,8,8,6,0
"""

LONG_CSV = """name,id,classification,rate,date,hours
Marcus Ellery,4417,Electrician,48.20,2026-03-02,8
Marcus Ellery,4417,Electrician,48.20,2026-03-03,8
Marcus Ellery,4417,Electrician,48.20,2026-03-04,4
"""

PROJECT = {
    "name": "Route 9 Bridge Rehabilitation",
    "contract_number": "DOT-FHWA-2026-0417",
    "location": "Kingston, NY",
    "wage_determination": {
        "number": "NY20260012",
        "classifications": {
            "Electrician": {"base_rate": "48.20", "fringe_rate": "31.15"},
        },
    },
}


def test_wide_csv_maps_weekday_columns_to_dates() -> None:
    workers = workers_from_csv(WIDE_CSV, WEEK_ENDING)
    assert len(workers) == 2
    marcus = workers[0]
    assert marcus["daily_hours"]["2026-03-02"] == "8"  # Monday of that week
    assert "2026-03-07" not in marcus["daily_hours"]  # Saturday was zero, so omitted


def test_long_csv_accumulates_rows_per_worker() -> None:
    workers = workers_from_csv(LONG_CSV, WEEK_ENDING)
    assert len(workers) == 1
    assert workers[0]["daily_hours"] == {
        "2026-03-02": "8",
        "2026-03-03": "8",
        "2026-03-04": "4",
    }


def test_long_csv_sums_duplicate_days() -> None:
    doubled = LONG_CSV + "Marcus Ellery,4417,Electrician,48.20,2026-03-04,3\n"
    workers = workers_from_csv(doubled, WEEK_ENDING)
    assert workers[0]["daily_hours"]["2026-03-04"] == "7"


def test_csv_without_recognisable_day_columns_is_rejected() -> None:
    with pytest.raises(ImportError_, match="day columns"):
        workers_from_csv("name,classification,rate\nA,Electrician,40\n", WEEK_ENDING)


def test_week_from_csv_produces_a_checkable_week() -> None:
    week = week_from_csv(
        WIDE_CSV,
        week_ending=WEEK_ENDING,
        project=PROJECT,
        contractor={"name": "Hollow Creek Electric LLC", "address": "18 Mill St",
                    "signatory_name": "Dana Whitfield", "signatory_title": "Owner"},
        payroll_number="12",
        pay_date="2026-03-13",
    )
    assert len(week.workers) == 2
    assert week.workers[1].overtime_hours == Decimal("6.00")
    result = check_week(week)
    # No fringe recorded anywhere in this sheet, so both workers are short.
    assert {f.rule_id for f in result.blockers} == {"WAGE_FRINGE_SHORTFALL"}


def test_week_requires_a_date_and_a_project() -> None:
    with pytest.raises(ImportError_, match="week_ending"):
        load_week({"project": PROJECT})
    with pytest.raises(ImportError_, match="project"):
        load_week({"week_ending": "2026-03-08"})


def test_daily_hours_accept_weekday_names_and_dates() -> None:
    week = load_week(
        {
            "week_ending": "2026-03-08",
            "project": PROJECT,
            "workers": [
                {"name": "A", "classification": "Electrician", "rate": "48.20",
                 "daily_hours": {"monday": 8, "2026-03-03": 6}},
            ],
        }
    )
    hours = week.workers[0].daily_hours
    assert hours[date(2026, 3, 2)] == Decimal("8.00")
    assert hours[date(2026, 3, 3)] == Decimal("6.00")


def test_example_files_load_and_report_the_expected_problems() -> None:
    week = load_week(json.loads((EXAMPLES / "week-12-problems.json").read_text()))
    result = check_week(week)
    ids = {f.rule_id for f in result.findings}
    assert "WAGE_BASE_UNDERPAID" in ids
    assert "WAGE_FRINGE_SHORTFALL" in ids
    assert "APPRENTICE_NOT_REGISTERED" in ids
    assert "DEDUCT_NOT_PERMITTED" in ids
    assert "CLASS_NOT_ON_DETERMINATION" in ids
    assert not result.is_filable
    assert result.total_at_risk > Decimal("2000")


def test_payload_carries_every_worker_and_the_week_dates(week: PayrollWeek) -> None:
    payload = build_payload(week)
    assert payload["form"] == "WH-347"
    assert len(payload["week_dates"]) == 7
    assert payload["workers"][0]["name"] == "Marcus Ellery"
    assert payload["workers"][0]["gross_this_project"] == "1928.00"
    assert payload["totals"]["workers"] == 1
    assert payload["filing_due_date"] == "2026-03-20"  # pay date + 7


def test_payload_is_json_serialisable(week: PayrollWeek) -> None:
    json.dumps(build_payload(week))


def test_rendered_form_shows_the_header_and_the_worker(week: PayrollWeek) -> None:
    text = render_text(week)
    assert "Form WH-347" in text
    assert "Hollow Creek Electric LLC" in text
    assert "Marcus Ellery" in text
    assert "DOT-FHWA-2026-0417" in text
    assert "STATEMENT OF COMPLIANCE" in text


def test_statement_names_the_signatory_and_the_period(week: PayrollWeek) -> None:
    statement = render_statement_of_compliance(week, remarks="Final payroll.")
    # The period wording wraps across lines in the rendered form, so compare
    # against a whitespace-normalised copy rather than pinning the layout.
    flat = " ".join(statement.split())
    assert "Dana Whitfield" in statement
    assert "Owner" in statement
    assert "2nd day of March, 2026" in flat
    assert "8th day of March, 2026" in flat
    assert "Final payroll." in statement
    assert "18 AND SECTION 3729" in flat


def test_overtime_appears_as_its_own_line(week: PayrollWeek) -> None:
    from .conftest import weekdays

    week.workers[0].daily_hours = weekdays(8, 8, 8, 8, 8, 6)
    assert "overtime" in render_text(week)
