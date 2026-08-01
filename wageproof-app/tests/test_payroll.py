"""The pay arithmetic, especially the fringe-and-overtime interaction."""

from __future__ import annotations

from decimal import Decimal

from wageproof.models import Classification, FringeCredit, Worker, WorkerType
from wageproof.payroll import compute_pay, required_rates

from .conftest import weekdays

ELECTRICIAN = Classification(
    name="Electrician",
    base_rate=Decimal("48.20"),
    fringe_rate=Decimal("31.15"),
    apprentice_ratio="1:2",
)


def test_straight_time_only(compliant_worker: Worker) -> None:
    comp = compute_pay(compliant_worker, ELECTRICIAN)
    assert comp.straight_hours == Decimal("40.00")
    assert comp.overtime_hours == Decimal("0")
    assert comp.actual_cash == Decimal("1928.00")  # 40 x 48.20
    assert comp.cash_shortfall == Decimal("0")


def test_overtime_premium_applies_past_forty() -> None:
    worker = Worker(
        name="Priya",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(8, 8, 8, 8, 8, 6),
        fringe_credits=[FringeCredit(plan_name="H&W", hourly_rate=Decimal("31.15"))],
    )
    comp = compute_pay(worker, ELECTRICIAN)
    assert comp.straight_hours == Decimal("40.00")
    assert comp.overtime_hours == Decimal("6.00")
    # 40 x 48.20 + 6 x 72.30
    assert comp.actual_cash == Decimal("2361.80")
    assert comp.cash_shortfall == Decimal("0")


def test_fringe_paid_in_cash_is_excluded_from_the_overtime_premium() -> None:
    """The rule that hand-built spreadsheets get wrong.

    Base 48.20 with 31.15 cash in lieu. An overtime hour is worth
    (48.20 x 1.5) + 31.15 = 103.45, not (79.35 x 1.5) = 119.03.
    """
    worker = Worker(
        name="Cash Fringe",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        cash_fringe_in_lieu=Decimal("31.15"),
        daily_hours=weekdays(8, 8, 8, 8, 8, 2),
    )
    comp = compute_pay(worker, ELECTRICIAN)
    assert comp.overtime_hours == Decimal("2.00")
    assert comp.actual_overtime_pay == Decimal("206.90")  # 2 x 103.45
    assert comp.cash_shortfall == Decimal("0")


def test_hours_on_other_projects_push_this_project_into_overtime() -> None:
    """Overtime belongs to the week, not to one contract."""
    worker = Worker(
        name="Split Week",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(8, 8, 8),  # 24 here
        other_project_hours=Decimal("24"),  # 48 total
        fringe_credits=[FringeCredit(plan_name="H&W", hourly_rate=Decimal("31.15"))],
    )
    comp = compute_pay(worker, ELECTRICIAN)
    assert worker.total_week_hours == Decimal("48.00")
    assert comp.overtime_hours == Decimal("8.00")
    assert comp.straight_hours == Decimal("16.00")


def test_overtime_claimed_never_exceeds_hours_actually_worked_here() -> None:
    worker = Worker(
        name="Mostly Elsewhere",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(4),
        other_project_hours=Decimal("50"),
    )
    comp = compute_pay(worker, ELECTRICIAN)
    assert comp.overtime_hours == Decimal("4.00")
    assert comp.straight_hours == Decimal("0.00")


def test_fringe_shortfall_shows_up_as_required_cash() -> None:
    """Missing fringe has to arrive as cash, so it raises the cash floor."""
    worker = Worker(
        name="No Benefits",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(8, 8, 8, 8, 8),
    )
    comp = compute_pay(worker, ELECTRICIAN)
    # 40 x (48.20 + 31.15) = 3174.00 required, only 1928.00 paid
    assert comp.required_cash == Decimal("3174.00")
    assert comp.cash_shortfall == Decimal("1246.00")


def test_non_bona_fide_plans_earn_no_fringe_credit() -> None:
    worker = Worker(
        name="Sham Plan",
        classification="Electrician",
        cash_hourly_rate=Decimal("48.20"),
        daily_hours=weekdays(8),
        fringe_credits=[
            FringeCredit(plan_name="Unfunded promise", hourly_rate=Decimal("31.15"),
                         is_bona_fide_plan=False)
        ],
    )
    assert worker.fringe_credit_rate == Decimal("0.00")
    comp = compute_pay(worker, ELECTRICIAN)
    assert comp.cash_shortfall == Decimal("249.20")  # 8 x 31.15


def test_registered_apprentice_earns_a_percentage_of_the_base() -> None:
    worker = Worker(
        name="Jo",
        classification="Electrician",
        worker_type=WorkerType.APPRENTICE,
        apprentice_program_registered=True,
        apprentice_wage_percentage=Decimal("65"),
        cash_hourly_rate=Decimal("31.33"),
        daily_hours=weekdays(8),
    )
    rates = required_rates(worker, ELECTRICIAN)
    assert rates is not None
    assert rates.is_discounted_apprentice_rate
    assert rates.base_rate == Decimal("31.33")  # 48.20 x 0.65


def test_apprentice_percentage_accepts_a_fraction_too() -> None:
    worker = Worker(
        name="Jo",
        classification="Electrician",
        worker_type=WorkerType.APPRENTICE,
        apprentice_program_registered=True,
        apprentice_wage_percentage=Decimal("0.65"),
        cash_hourly_rate=Decimal("31.33"),
    )
    rates = required_rates(worker, ELECTRICIAN)
    assert rates is not None and rates.base_rate == Decimal("31.33")


def test_unregistered_apprentice_owes_the_full_journeyworker_rate() -> None:
    worker = Worker(
        name="Jo",
        classification="Electrician",
        worker_type=WorkerType.APPRENTICE,
        apprentice_program_registered=False,
        apprentice_wage_percentage=Decimal("65"),
        cash_hourly_rate=Decimal("28.00"),
    )
    rates = required_rates(worker, ELECTRICIAN)
    assert rates is not None
    assert not rates.is_discounted_apprentice_rate
    assert rates.base_rate == Decimal("48.20")


def test_unknown_classification_yields_no_required_rates() -> None:
    worker = Worker(name="Sam", classification="Electricion")
    assert required_rates(worker, None) is None
    comp = compute_pay(worker, None)
    assert comp.required is None
    assert comp.required_cash == Decimal("0")
