from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from wageproof.models import (
    Classification,
    Contractor,
    PayrollWeek,
    Project,
    WageDetermination,
    Worker,
)

WEEK_ENDING = date(2026, 3, 8)
WEEK_START = WEEK_ENDING - timedelta(days=6)


def day(offset: int) -> date:
    """Monday is offset 0."""
    return WEEK_START + timedelta(days=offset)


def weekdays(*hours_per_day: float) -> dict[date, Decimal]:
    return {day(i): Decimal(str(h)) for i, h in enumerate(hours_per_day)}


@pytest.fixture
def determination() -> WageDetermination:
    return WageDetermination(
        number="NY20260012",
        classifications={
            "Electrician": Classification(
                name="Electrician",
                base_rate=Decimal("48.20"),
                fringe_rate=Decimal("31.15"),
                apprentice_ratio="1:2",
            ),
            "Laborer Group 1": Classification(
                name="Laborer Group 1",
                base_rate=Decimal("32.75"),
                fringe_rate=Decimal("24.40"),
                apprentice_ratio="1:4",
            ),
        },
    )


@pytest.fixture
def project(determination: WageDetermination) -> Project:
    return Project(
        name="Route 9 Bridge Rehabilitation",
        contract_number="DOT-FHWA-2026-0417",
        location="Kingston, NY",
        wage_determination=determination,
    )


@pytest.fixture
def contractor() -> Contractor:
    return Contractor(
        name="Hollow Creek Electric LLC",
        address="18 Mill Street, Kingston, NY 12401",
        signatory_name="Dana Whitfield",
        signatory_title="Owner",
    )


@pytest.fixture
def compliant_worker() -> Worker:
    """40 hours, exact base rate, fringe fully covered by plans."""
    from wageproof.models import FringeCredit

    return Worker(
        name="Marcus Ellery",
        identifier="4417",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(8, 8, 8, 8, 8),
        fringe_credits=[FringeCredit(plan_name="Local 363 H&W", hourly_rate=Decimal("31.15"))],
    )


@pytest.fixture
def week(project: Project, contractor: Contractor, compliant_worker: Worker) -> PayrollWeek:
    return PayrollWeek(
        project=project,
        contractor=contractor,
        week_ending=WEEK_ENDING,
        payroll_number="12",
        pay_date=date(2026, 3, 13),
        filed_date=date(2026, 3, 16),
        workers=[compliant_worker],
    )
