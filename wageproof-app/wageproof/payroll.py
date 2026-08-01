"""What a worker must legally be paid, and what they actually were.

The subtlety that trips up hand-built spreadsheets: fringe benefits are excluded
from the regular rate when computing the overtime premium. A contractor paying
$30 base plus $10 cash in lieu of fringes owes $45 + $10 for an overtime hour,
not $60. Overpaying is merely expensive; the far more common error is treating
the $40 as the base and *underpaying* straight time, which is a violation.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .models import (
    OVERTIME_MULTIPLIER,
    ZERO,
    Classification,
    PayrollWeek,
    Worker,
    WorkerType,
    money,
)


@dataclass(frozen=True)
class RequiredRates:
    """The rates this specific worker must be paid, after apprentice discounts."""

    base_rate: Decimal
    fringe_rate: Decimal
    is_discounted_apprentice_rate: bool = False

    @property
    def total_rate(self) -> Decimal:
        return money(self.base_rate + self.fringe_rate)


@dataclass(frozen=True)
class PayComputation:
    """Required versus actual, for one worker in one week on one project."""

    worker: Worker
    required: RequiredRates | None
    straight_hours: Decimal
    overtime_hours: Decimal
    actual_straight_pay: Decimal
    actual_overtime_pay: Decimal
    actual_fringe_credit: Decimal
    required_cash: Decimal

    @property
    def total_hours(self) -> Decimal:
        return money(self.straight_hours + self.overtime_hours)

    @property
    def actual_cash(self) -> Decimal:
        """Gross cash wages for this project — box (7) territory on the WH-347."""
        return money(self.actual_straight_pay + self.actual_overtime_pay)

    @property
    def total_compensation(self) -> Decimal:
        return money(self.actual_cash + self.actual_fringe_credit)

    @property
    def cash_shortfall(self) -> Decimal:
        """How much cash is missing. Zero when compliant."""
        gap = self.required_cash - self.actual_cash
        return money(gap) if gap > ZERO else ZERO

    @property
    def net_pay(self) -> Decimal:
        return money(self.actual_cash - self.worker.total_deductions)

    @property
    def effective_hourly(self) -> Decimal:
        if self.total_hours <= ZERO:
            return ZERO
        return money(self.total_compensation / self.total_hours)


def required_rates(worker: Worker, classification: Classification | None) -> RequiredRates | None:
    """Resolve the rates owed to this worker.

    An apprentice earns a reduced rate only when registered in an approved
    program. Unregistered, they are owed the full journeyworker rate for the
    classification of work actually performed — so we return the full rate here
    and let the compliance rules explain why.
    """
    if classification is None:
        return None

    discounted = False
    base = classification.base_rate

    if (
        worker.worker_type is not WorkerType.JOURNEYWORKER
        and worker.apprentice_program_registered
        and worker.apprentice_wage_percentage is not None
    ):
        pct = worker.apprentice_wage_percentage
        # Accept either 65 or 0.65 for "65 percent".
        fraction = pct / Decimal("100") if pct > Decimal("1") else pct
        base = money(classification.base_rate * fraction)
        discounted = True

    return RequiredRates(
        base_rate=money(base),
        fringe_rate=money(classification.fringe_rate),
        is_discounted_apprentice_rate=discounted,
    )


def compute_pay(worker: Worker, classification: Classification | None) -> PayComputation:
    straight = worker.straight_time_hours
    overtime = worker.overtime_hours
    total = straight + overtime

    cash_rate = worker.cash_hourly_rate
    cash_fringe = worker.cash_fringe_in_lieu

    # Cash in lieu of fringes rides along at face value on overtime hours; only
    # the base rate gets the 1.5 multiplier.
    actual_straight = money(straight * (cash_rate + cash_fringe))
    actual_overtime = money(overtime * (cash_rate * OVERTIME_MULTIPLIER + cash_fringe))
    actual_fringe_credit = money(total * worker.fringe_credit_rate)

    rates = required_rates(worker, classification)
    if rates is None:
        required_cash = ZERO
    else:
        # Fringe may be satisfied by plan contributions; whatever is left over
        # has to arrive as cash.
        fringe_cash_needed = rates.fringe_rate - worker.fringe_credit_rate
        if fringe_cash_needed < ZERO:
            fringe_cash_needed = ZERO
        required_cash = money(
            straight * rates.base_rate
            + overtime * rates.base_rate * OVERTIME_MULTIPLIER
            + total * fringe_cash_needed
        )

    return PayComputation(
        worker=worker,
        required=rates,
        straight_hours=straight,
        overtime_hours=overtime,
        actual_straight_pay=actual_straight,
        actual_overtime_pay=actual_overtime,
        actual_fringe_credit=actual_fringe_credit,
        required_cash=required_cash,
    )


def compute_week(week: PayrollWeek) -> dict[str, PayComputation]:
    """Compute every worker on a payroll week, keyed by worker name."""
    determination = week.project.wage_determination
    results: dict[str, PayComputation] = {}
    for worker in week.workers:
        classification = determination.get(worker.classification) if determination else None
        results[worker.name] = compute_pay(worker, classification)
    return results
