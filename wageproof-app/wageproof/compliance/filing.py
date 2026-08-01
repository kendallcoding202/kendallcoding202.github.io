"""Checks on the filing itself: completeness and the seven-day deadline."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from ..models import FILING_DEADLINE_DAYS, ZERO, PayrollWeek
from ..payroll import PayComputation
from . import Finding, Severity, rule


@rule
def missing_required_fields(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """The WH-347 header fields that agencies reject submissions over."""
    missing: list[str] = []
    if not week.contractor.name:
        missing.append("contractor or subcontractor name")
    if not week.contractor.address:
        missing.append("contractor address")
    if not week.project.name:
        missing.append("project name")
    if not week.project.location:
        missing.append("project location")
    if not week.project.contract_number:
        missing.append("contract number")
    if not week.payroll_number:
        missing.append("payroll number")

    if missing:
        yield Finding(
            rule_id="FORM_MISSING_HEADER",
            severity=Severity.BLOCKER,
            title="The form header is incomplete",
            detail=(
                "These fields are required on every WH-347 and are the most common reason an "
                f"agency bounces a submission: {', '.join(missing)}."
            ),
            action="Fill in the missing fields on the project or contractor record.",
            citation="Form WH-347 instructions",
        )

    if not week.contractor.signatory_name:
        yield Finding(
            rule_id="FORM_NO_SIGNATORY",
            severity=Severity.BLOCKER,
            title="No one is named to sign the statement of compliance",
            detail=(
                "Page 2 is a certification signed under penalty of prosecution. It needs the name "
                "and title of the person signing it."
            ),
            action="Add the signatory's name and title to the contractor record.",
            citation="18 U.S.C. 1001; 31 U.S.C. 3729",
        )


@rule
def worker_identification(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Since 2009 the form takes an identifying number, not a full SSN."""
    for name, comp in computations.items():
        worker = comp.worker
        if not worker.identifier:
            yield Finding(
                rule_id="FORM_NO_WORKER_ID",
                severity=Severity.WARNING,
                title=f"{name} has no identifying number",
                detail=(
                    "The WH-347 asks for an individually identifying number — normally the last "
                    "four digits of the social security number. Full social security numbers must "
                    "not be submitted."
                ),
                action="Add the last four digits of the worker's SSN to their record.",
                citation="29 CFR 5.5(a)(3)(ii)(A)",
                worker_name=name,
            )
        elif len(worker.identifier.strip()) > 4 and worker.identifier.strip().isdigit():
            yield Finding(
                rule_id="FORM_FULL_SSN",
                severity=Severity.BLOCKER,
                title=f"{name}'s identifier looks like a full social security number",
                detail=(
                    "Submitting a full social security number on a certified payroll exposes the "
                    "worker unnecessarily and is contrary to the current form instructions."
                ),
                action="Replace it with the last four digits only.",
                citation="29 CFR 5.5(a)(3)(ii)(A)",
                worker_name=name,
            )


@rule
def no_hours_recorded(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    for name, comp in computations.items():
        if comp.total_hours > ZERO:
            continue
        yield Finding(
            rule_id="FORM_NO_HOURS",
            severity=Severity.WARNING,
            title=f"{name} has no hours this week",
            detail=(
                "A worker with zero hours on the project does not belong on this payroll. If they "
                "did no covered work this week, leave them off."
            ),
            action="Remove the worker from this week, or enter their hours.",
            worker_name=name,
        )


@rule
def hours_outside_week(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    valid = set(week.week_dates)
    for name, comp in computations.items():
        stray = sorted(day for day in comp.worker.daily_hours if day not in valid)
        if not stray:
            continue
        listed = ", ".join(f"{day:%b %d}" for day in stray)
        yield Finding(
            rule_id="FORM_HOURS_OUTSIDE_WEEK",
            severity=Severity.BLOCKER,
            title=f"{name} has hours outside the payroll week",
            detail=(
                f"This payroll covers {week.week_start:%b %d} through {week.week_ending:%b %d}, "
                f"but {name} has hours recorded on {listed}. Those hours belong on a different "
                "weekly payroll."
            ),
            action="Move the stray hours to the correct week's payroll.",
            worker_name=name,
        )


@rule
def filing_deadline(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Weekly payrolls are due within seven days of the pay date."""
    due = week.filing_due_date
    if due is None:
        return

    reference = week.filed_date or date.today()
    days_remaining = (due - reference).days

    if week.pay_date is None:
        yield Finding(
            rule_id="FILE_NO_PAY_DATE",
            severity=Severity.WARNING,
            title="No pay date recorded",
            detail=(
                f"The {FILING_DEADLINE_DAYS}-day filing clock runs from the date wages were paid, "
                f"not the week ending date. Without it we are measuring from "
                f"{week.week_ending:%b %d} instead, which may be optimistic."
            ),
            action="Record the date the workers were actually paid.",
            citation="29 CFR 5.5(a)(3)(ii)(A)",
        )

    if days_remaining < 0:
        yield Finding(
            rule_id="FILE_OVERDUE",
            severity=Severity.WARNING,
            title=f"This payroll is {abs(days_remaining)} days overdue",
            detail=(
                f"It was due {due:%b %d}, seven days after the pay date. Late certified payrolls "
                "are grounds for withholding contract payments."
            ),
            action="File today, and expect to explain the delay to the contracting officer.",
            citation="29 CFR 5.5(a)(3)(ii)(A); 29 CFR 5.5(a)(2)",
        )
    elif days_remaining <= 2:
        yield Finding(
            rule_id="FILE_DUE_SOON",
            severity=Severity.NOTICE,
            title=f"Due in {days_remaining} day{'s' if days_remaining != 1 else ''}",
            detail=f"This payroll must reach the contracting agency by {due:%b %d}.",
            action="File once the findings above are cleared.",
            citation="29 CFR 5.5(a)(3)(ii)(A)",
        )
