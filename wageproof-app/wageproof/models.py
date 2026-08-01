"""Domain model for Davis-Bacon certified payroll.

The vocabulary here is the Department of Labor's, not ours: a *wage
determination* lists a *classification* (electrician, laborer group 2) with a
*basic hourly rate* and a *fringe rate*. A contractor satisfies the fringe
portion with bona fide benefit plans, cash in lieu, or a mix — but the basic
hourly rate itself must be paid in cash.

Keeping those two components separate all the way through is the whole game.
Collapsing them into one "hourly rate" is the single most common way a small
subcontractor files a WH-347 that looks fine and is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from enum import StrEnum

MONEY = Decimal("0.01")
HOURS = Decimal("0.01")
ZERO = Decimal("0")

# Contract Work Hours and Safety Standards Act: time and a half past 40 in a week.
OVERTIME_THRESHOLD_HOURS = Decimal("40")
OVERTIME_MULTIPLIER = Decimal("1.5")

# 29 CFR 5.5(a)(3)(ii)(A): payrolls are due within seven days of the pay date.
FILING_DEADLINE_DAYS = 7


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(MONEY)


def hours(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(HOURS)


class WorkerType(StrEnum):
    JOURNEYWORKER = "journeyworker"
    APPRENTICE = "apprentice"
    TRAINEE = "trainee"


class DeductionType(StrEnum):
    """Whether a deduction is permitted without the worker's written consent.

    29 CFR 3.5 lists deductions a contractor may make freely (taxes, court
    orders, bona fide benefit contributions). 29 CFR 3.6 covers everything else,
    which needs the worker's written authorization and may not be for the
    contractor's benefit.
    """

    PAYROLL_TAX = "payroll_tax"
    COURT_ORDERED = "court_ordered"
    BENEFIT_CONTRIBUTION = "benefit_contribution"
    UNION_DUES = "union_dues"
    AUTHORIZED_OTHER = "authorized_other"
    UNAUTHORIZED = "unauthorized"


PERMITTED_WITHOUT_CONSENT = {
    DeductionType.PAYROLL_TAX,
    DeductionType.COURT_ORDERED,
    DeductionType.BENEFIT_CONTRIBUTION,
}


@dataclass(frozen=True)
class Classification:
    """One labor classification on a wage determination."""

    name: str
    base_rate: Decimal
    fringe_rate: Decimal = ZERO
    apprentice_ratio: str | None = None

    @property
    def total_rate(self) -> Decimal:
        """What one hour must be worth in total, cash plus fringe."""
        return money(self.base_rate + self.fringe_rate)

    @property
    def max_apprentices_per_journeyworker(self) -> Decimal | None:
        """Parse a ratio like '1:4' into apprentices allowed per journeyworker."""
        if not self.apprentice_ratio or ":" not in self.apprentice_ratio:
            return None
        apprentices, _, journeyworkers = self.apprentice_ratio.partition(":")
        try:
            allowed = Decimal(apprentices.strip())
            per = Decimal(journeyworkers.strip())
        except (ArithmeticError, ValueError):
            return None
        return allowed / per if per else None


@dataclass
class WageDetermination:
    """The published rate schedule a contract is locked to."""

    number: str
    classifications: dict[str, Classification] = field(default_factory=dict)
    effective_date: date | None = None
    description: str | None = None

    def get(self, name: str) -> Classification | None:
        if name in self.classifications:
            return self.classifications[name]
        lowered = name.strip().lower()
        return next(
            (c for key, c in self.classifications.items() if key.strip().lower() == lowered),
            None,
        )

    @property
    def classification_names(self) -> list[str]:
        return sorted(self.classifications)


@dataclass
class Project:
    """A covered contract. Everything filed is scoped to one of these."""

    name: str
    contract_number: str | None = None
    location: str | None = None
    wage_determination: WageDetermination | None = None
    contracting_agency: str | None = None
    is_federally_funded: bool = True


@dataclass
class Contractor:
    """Whoever signs the statement of compliance."""

    name: str
    address: str | None = None
    is_subcontractor: bool = True
    signatory_name: str | None = None
    signatory_title: str | None = None


@dataclass
class Deduction:
    name: str
    amount: Decimal
    kind: DeductionType = DeductionType.AUTHORIZED_OTHER
    has_written_authorization: bool = False

    @property
    def needs_authorization(self) -> bool:
        return self.kind not in PERMITTED_WITHOUT_CONSENT


@dataclass
class FringeCredit:
    """A bona fide benefit contribution creditable against the fringe rate."""

    plan_name: str
    hourly_rate: Decimal
    is_bona_fide_plan: bool = True


@dataclass
class Worker:
    """One person on one classification for one week.

    ``daily_hours`` maps a date to hours worked on *this* project. Hours worked
    elsewhere in the same week matter for overtime, so they are tracked
    separately rather than being silently folded in.
    """

    name: str
    classification: str
    daily_hours: dict[date, Decimal] = field(default_factory=dict)
    cash_hourly_rate: Decimal = ZERO
    cash_fringe_in_lieu: Decimal = ZERO
    worker_type: WorkerType = WorkerType.JOURNEYWORKER
    identifier: str | None = None
    withholding_exemptions: str | None = None
    fringe_credits: list[FringeCredit] = field(default_factory=list)
    deductions: list[Deduction] = field(default_factory=list)
    other_project_hours: Decimal = ZERO
    apprentice_program_registered: bool = False
    apprentice_wage_percentage: Decimal | None = None
    gross_paid_all_projects: Decimal | None = None

    @property
    def project_hours(self) -> Decimal:
        return hours(sum(self.daily_hours.values(), ZERO))

    @property
    def total_week_hours(self) -> Decimal:
        return hours(self.project_hours + self.other_project_hours)

    @property
    def overtime_hours(self) -> Decimal:
        """Overtime attributable to this project.

        Overtime is a property of the week, not of a project, so hours worked
        elsewhere fill the first 40 alongside these. We only claim the excess
        that this project's hours actually account for.
        """
        excess = self.total_week_hours - OVERTIME_THRESHOLD_HOURS
        if excess <= ZERO:
            return ZERO
        return hours(min(excess, self.project_hours))

    @property
    def straight_time_hours(self) -> Decimal:
        return hours(self.project_hours - self.overtime_hours)

    @property
    def fringe_credit_rate(self) -> Decimal:
        """Hourly fringe satisfied by bona fide plans only.

        A contribution flagged as not bona fide earns no credit — that is the
        point of the flag — so it is excluded here rather than quietly counted.
        """
        return money(
            sum((c.hourly_rate for c in self.fringe_credits if c.is_bona_fide_plan), ZERO)
        )

    @property
    def fringe_satisfied_rate(self) -> Decimal:
        """Total hourly fringe satisfied, whether by plan or by cash in lieu."""
        return money(self.fringe_credit_rate + self.cash_fringe_in_lieu)

    @property
    def total_deductions(self) -> Decimal:
        return money(sum((d.amount for d in self.deductions), ZERO))


@dataclass
class PayrollWeek:
    """One weekly certified payroll: the unit that gets filed."""

    project: Project
    contractor: Contractor
    week_ending: date
    workers: list[Worker] = field(default_factory=list)
    payroll_number: str | None = None
    pay_date: date | None = None
    filed_date: date | None = None
    is_final: bool = False

    @property
    def week_start(self) -> date:
        return self.week_ending - timedelta(days=6)

    @property
    def week_dates(self) -> list[date]:
        return [self.week_start + timedelta(days=offset) for offset in range(7)]

    @property
    def filing_due_date(self) -> date | None:
        base = self.pay_date or self.week_ending
        return base + timedelta(days=FILING_DEADLINE_DAYS)

    def journeyworker_hours(self, classification: str) -> Decimal:
        return hours(
            sum(
                (
                    w.project_hours
                    for w in self.workers
                    if w.classification == classification
                    and w.worker_type is WorkerType.JOURNEYWORKER
                ),
                ZERO,
            )
        )

    def apprentice_hours(self, classification: str) -> Decimal:
        return hours(
            sum(
                (
                    w.project_hours
                    for w in self.workers
                    if w.classification == classification
                    and w.worker_type is not WorkerType.JOURNEYWORKER
                ),
                ZERO,
            )
        )
