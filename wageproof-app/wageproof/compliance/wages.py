"""Rate and overtime checks — where the money actually goes missing."""

from __future__ import annotations

from collections.abc import Iterable

from ..models import OVERTIME_MULTIPLIER, OVERTIME_THRESHOLD_HOURS, ZERO, PayrollWeek, money
from ..payroll import PayComputation
from . import Finding, Severity, rule


@rule
def underpaid_base_rate(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """The cash rate must reach the determination's basic hourly rate on its own.

    Fringe contributions cannot be borrowed to top up the base — that direction
    only works the other way around.
    """
    for name, comp in computations.items():
        if comp.required is None:
            continue
        paid = comp.worker.cash_hourly_rate
        owed = comp.required.base_rate
        if paid >= owed:
            continue
        gap = money((owed - paid) * comp.total_hours)
        determination = week.project.wage_determination
        # The determination number is optional — the free checker never asks for
        # it — so name it only when we actually have one.
        source = (
            f"wage determination {determination.number}"
            if determination and determination.number
            else "your wage determination"
        )
        yield Finding(
            rule_id="WAGE_BASE_UNDERPAID",
            severity=Severity.BLOCKER,
            title=f"{name} is paid below the basic hourly rate",
            detail=(
                f"{name} is classified as {comp.worker.classification}, which carries a basic "
                f"hourly rate of ${owed} on {source}. "
                f"The payroll shows ${paid} per hour. Across {comp.total_hours} hours that is "
                f"${gap} of underpayment."
            ),
            action=(
                f"Raise the cash rate to at least ${owed} per hour and pay ${gap} in back wages "
                "before filing. Fringe contributions do not count toward the basic rate."
            ),
            citation="29 CFR 5.5(a)(1)(i)",
            worker_name=name,
            amount_at_risk=gap,
        )


@rule
def fringe_shortfall(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Fringe may be paid as benefits, cash, or a mix — but it must be paid."""
    for name, comp in computations.items():
        if comp.required is None or comp.required.fringe_rate <= ZERO:
            continue
        satisfied = comp.worker.fringe_satisfied_rate
        owed = comp.required.fringe_rate
        if satisfied >= owed:
            continue
        gap = money((owed - satisfied) * comp.total_hours)
        not_bona_fide = [c.plan_name for c in comp.worker.fringe_credits if not c.is_bona_fide_plan]
        extra = (
            f" Contributions to {', '.join(not_bona_fide)} were excluded because they are not "
            "marked as bona fide plans."
            if not_bona_fide
            else ""
        )
        yield Finding(
            rule_id="WAGE_FRINGE_SHORTFALL",
            severity=Severity.BLOCKER,
            title=f"{name} is short on fringe benefits",
            detail=(
                f"The determination requires ${owed} per hour in fringes for "
                f"{comp.worker.classification}. This payroll satisfies ${satisfied} "
                f"(${comp.worker.fringe_credit_rate} in plan contributions, "
                f"${comp.worker.cash_fringe_in_lieu} in cash). Across {comp.total_hours} hours "
                f"that leaves ${gap} unpaid.{extra}"
            ),
            action=(
                f"Pay the remaining ${gap} as cash in lieu of fringes, or document additional "
                "bona fide plan contributions covering it."
            ),
            citation="29 CFR 5.5(a)(1)(i); 29 CFR 5.28",
            worker_name=name,
            amount_at_risk=gap,
        )


@rule
def overtime_premium_missing(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Hours past 40 in the week need the half-time premium on the base rate."""
    for name, comp in computations.items():
        if comp.overtime_hours <= ZERO or comp.required is None:
            continue
        required_ot_rate = money(comp.required.base_rate * OVERTIME_MULTIPLIER)
        paid_ot_rate = money(comp.worker.cash_hourly_rate * OVERTIME_MULTIPLIER)
        if paid_ot_rate >= required_ot_rate:
            continue
        gap = money((required_ot_rate - paid_ot_rate) * comp.overtime_hours)
        yield Finding(
            rule_id="WAGE_OVERTIME_SHORT",
            severity=Severity.BLOCKER,
            title=f"{name}'s overtime is computed on too low a base",
            detail=(
                f"{name} worked {comp.overtime_hours} overtime hours "
                f"({comp.worker.total_week_hours} total for the week, including "
                f"{comp.worker.other_project_hours} on other projects). Overtime must be paid at "
                f"1.5 times the ${comp.required.base_rate} basic rate, or ${required_ot_rate} per "
                f"hour. This payroll pays ${paid_ot_rate}, leaving ${gap} owed."
            ),
            action=f"Pay ${gap} in overtime back wages before filing.",
            citation="40 U.S.C. 3702 (Contract Work Hours and Safety Standards Act)",
            worker_name=name,
            amount_at_risk=gap,
        )


@rule
def fringe_inflating_overtime_base(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Catch the reverse error: fringes folded into the rate the premium sits on.

    This one costs the contractor money rather than the worker, so it is a
    warning. It usually means the payroll's "hourly rate" column is really base
    plus fringe, which frequently means straight time is *also* wrong.
    """
    for name, comp in computations.items():
        if comp.required is None or comp.overtime_hours <= ZERO:
            continue
        if comp.required.fringe_rate <= ZERO:
            continue
        combined = money(comp.required.base_rate + comp.required.fringe_rate)
        if comp.worker.cash_hourly_rate < combined:
            continue
        if comp.worker.cash_fringe_in_lieu > ZERO or comp.worker.fringe_credit_rate > ZERO:
            continue
        overpay = money(
            (comp.worker.cash_hourly_rate - comp.required.base_rate)
            * (OVERTIME_MULTIPLIER - 1)
            * comp.overtime_hours
        )
        yield Finding(
            rule_id="WAGE_FRINGE_IN_OT_BASE",
            severity=Severity.WARNING,
            title=f"{name}'s hourly rate looks like base and fringe combined",
            detail=(
                f"{name} is paid ${comp.worker.cash_hourly_rate} per hour with no fringe recorded "
                f"separately, while the determination splits the same total into "
                f"${comp.required.base_rate} base plus ${comp.required.fringe_rate} fringe. If the "
                f"cash rate really is base-plus-fringe, the overtime premium is being computed on "
                f"the fringe portion too — roughly ${overpay} of unnecessary overtime this week — "
                "and the fringe column on the WH-347 will be wrong."
            ),
            action=(
                "Split the rate into its base and fringe components on the worker record. If the "
                "cash rate genuinely is all base wages, no change is needed."
            ),
            citation="29 CFR 5.32(a)",
            worker_name=name,
            amount_at_risk=None,
        )


@rule
def excessive_hours(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Implausible hours are nearly always a keying error, and they get audited."""
    for name, comp in computations.items():
        for day, worked in sorted(comp.worker.daily_hours.items()):
            if worked <= 16:
                continue
            yield Finding(
                rule_id="HOURS_IMPLAUSIBLE",
                severity=Severity.WARNING,
                title=f"{name} shows {worked} hours on {day:%b %d}",
                detail=(
                    "A single day over 16 hours is unusual enough that it draws attention on "
                    "audit. It is far more often a typing error than a real shift."
                ),
                action="Confirm the daily hours against the time sheet before filing.",
                worker_name=name,
            )
        if comp.worker.total_week_hours > OVERTIME_THRESHOLD_HOURS * 2:
            yield Finding(
                rule_id="HOURS_WEEK_HIGH",
                severity=Severity.NOTICE,
                title=f"{name} worked {comp.worker.total_week_hours} hours this week",
                detail=(
                    f"{comp.overtime_hours} of those are overtime on this project. Worth a second "
                    "look if that was not expected."
                ),
                action="No action needed if the hours are accurate.",
                worker_name=name,
            )
