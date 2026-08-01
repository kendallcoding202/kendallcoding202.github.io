"""Deduction checks.

A deduction that is not permitted has the same effect as underpaying the rate:
the worker did not receive the prevailing wage. Contractors routinely deduct for
tools, uniforms, or damage without realising this.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from ..models import ZERO, DeductionType, PayrollWeek, money
from ..payroll import PayComputation
from . import Finding, Severity, rule

# Above this share of gross, even authorized deductions are worth a second look.
DEDUCTION_REVIEW_THRESHOLD = Decimal("0.25")


@rule
def unauthorized_deductions(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    for name, comp in computations.items():
        for deduction in comp.worker.deductions:
            if deduction.kind is DeductionType.UNAUTHORIZED:
                yield Finding(
                    rule_id="DEDUCT_NOT_PERMITTED",
                    severity=Severity.BLOCKER,
                    title=f"'{deduction.name}' is not a permitted deduction",
                    detail=(
                        f"${deduction.amount} was deducted from {name} for '{deduction.name}'. "
                        "Deductions outside taxes, court orders, and bona fide benefit "
                        "contributions require the worker's written authorization and may not be "
                        "for the contractor's own benefit. Taking one anyway means the prevailing "
                        "wage was not actually paid."
                    ),
                    action=(
                        f"Reimburse the ${deduction.amount} and remove it from this payroll, or "
                        "obtain a Secretary of Labor approval under 29 CFR 3.6 before deducting."
                    ),
                    citation="29 CFR 3.5, 29 CFR 3.6",
                    worker_name=name,
                    amount_at_risk=money(deduction.amount),
                )
                continue

            if deduction.needs_authorization and not deduction.has_written_authorization:
                yield Finding(
                    rule_id="DEDUCT_NO_WRITTEN_CONSENT",
                    severity=Severity.WARNING,
                    title=f"'{deduction.name}' has no written authorization on file",
                    detail=(
                        f"${deduction.amount} was deducted from {name}. This category is only "
                        "permitted with the worker's written consent, given freely before the "
                        "deduction was made."
                    ),
                    action=(
                        "Attach the signed authorization to the worker record, or reverse the "
                        "deduction."
                    ),
                    citation="29 CFR 3.5(d)",
                    worker_name=name,
                    amount_at_risk=money(deduction.amount),
                )


@rule
def deductions_exceed_gross(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    for name, comp in computations.items():
        if comp.actual_cash <= ZERO:
            continue
        total = comp.worker.total_deductions
        if total > comp.actual_cash:
            yield Finding(
                rule_id="DEDUCT_EXCEEDS_GROSS",
                severity=Severity.BLOCKER,
                title=f"{name}'s deductions exceed gross pay",
                detail=(
                    f"Deductions total ${total} against ${comp.actual_cash} of gross wages, which "
                    f"leaves net pay of ${comp.net_pay}. This cannot be filed as written."
                ),
                action="Correct the deduction amounts or the hours and rates behind the gross.",
                worker_name=name,
                amount_at_risk=money(total - comp.actual_cash),
            )
        elif total > comp.actual_cash * DEDUCTION_REVIEW_THRESHOLD:
            share = (total / comp.actual_cash * 100).quantize(Decimal("1"))
            yield Finding(
                rule_id="DEDUCT_HIGH_SHARE",
                severity=Severity.NOTICE,
                title=f"Deductions are {share}% of {name}'s gross pay",
                detail=(
                    f"${total} deducted from ${comp.actual_cash}. Nothing here is necessarily "
                    "wrong, but a share this size is the kind of thing an investigator asks about."
                ),
                action="Make sure each deduction has its supporting documentation filed.",
                worker_name=name,
            )
