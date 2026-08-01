"""Classification and apprentice checks.

Misclassification is the violation contractors least expect, because the
payroll arithmetic is perfectly consistent — it is just consistently applied to
the wrong rate.
"""

from __future__ import annotations

import difflib
from collections.abc import Iterable

from ..models import ZERO, PayrollWeek, WorkerType, money
from ..payroll import PayComputation
from . import Finding, Severity, rule


@rule
def missing_wage_determination(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    if week.project.wage_determination is not None:
        return
    yield Finding(
        rule_id="WD_MISSING",
        severity=Severity.BLOCKER,
        title="No wage determination attached to this project",
        detail=(
            "Without the determination there is nothing to check the payroll against, and the "
            "statement of compliance on page 2 cannot honestly be signed."
        ),
        action=(
            "Attach the wage determination named in the contract. It is on the solicitation, or "
            "searchable by contract number at SAM.gov."
        ),
        citation="29 CFR 5.5(a)(1)(i)",
    )


@rule
def unknown_classification(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """A classification not on the determination has no lawful rate."""
    determination = week.project.wage_determination
    if determination is None:
        return
    for name, comp in computations.items():
        if comp.required is not None:
            continue
        close = difflib.get_close_matches(
            comp.worker.classification, determination.classification_names, n=3, cutoff=0.6
        )
        suggestion = f" Did you mean {', '.join(close)}?" if close else ""
        source = (
            f"determination {determination.number}"
            if determination.number
            else "your wage determination"
        )
        yield Finding(
            rule_id="CLASS_NOT_ON_DETERMINATION",
            severity=Severity.BLOCKER,
            title=f"'{comp.worker.classification}' is not on the wage determination",
            detail=(
                f"{name} is recorded under '{comp.worker.classification}', which does not "
                f"appear on {source}. There is no published rate "
                f"for it, so the payroll cannot be verified.{suggestion}"
            ),
            action=(
                "Use a classification from the determination, or request an additional "
                "classification from the contracting officer on form SF-1444 before this work is "
                "billed."
            ),
            citation="29 CFR 5.5(a)(1)(ii)",
            worker_name=name,
        )


@rule
def unregistered_apprentice(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Apprentice rates are only lawful with an approved program registration."""
    for name, comp in computations.items():
        worker = comp.worker
        if worker.worker_type is WorkerType.JOURNEYWORKER:
            continue
        if worker.apprentice_program_registered:
            continue
        if comp.required is None:
            continue
        gap = money((comp.required.base_rate - worker.cash_hourly_rate) * comp.total_hours)
        yield Finding(
            rule_id="APPRENTICE_NOT_REGISTERED",
            severity=Severity.BLOCKER,
            title=f"{name} is paid an apprentice rate without a registered program",
            detail=(
                f"{name} is recorded as {worker.worker_type.value} but no registration with a "
                "recognized apprenticeship program is on file. Without it, the full journeyworker "
                f"rate of ${comp.required.base_rate} applies for the work actually performed"
                + (f", leaving ${gap} owed." if gap > ZERO else ".")
            ),
            action=(
                "Record the program registration and the applicable wage percentage, or pay the "
                "full journeyworker rate for these hours."
            ),
            citation="29 CFR 5.5(a)(4)(i)",
            worker_name=name,
            amount_at_risk=gap if gap > ZERO else None,
        )


@rule
def apprentice_ratio_exceeded(
    week: PayrollWeek, computations: dict[str, PayComputation]
) -> Iterable[Finding]:
    """Too many apprentices on site means the excess owe journeyworker rates."""
    determination = week.project.wage_determination
    if determination is None:
        return
    seen: set[str] = set()
    for comp in computations.values():
        classification_name = comp.worker.classification
        if classification_name in seen:
            continue
        seen.add(classification_name)

        classification = determination.get(classification_name)
        if classification is None:
            continue
        allowed_per = classification.max_apprentices_per_journeyworker
        if allowed_per is None:
            continue

        apprentice_hours = week.apprentice_hours(classification_name)
        journey_hours = week.journeyworker_hours(classification_name)
        if apprentice_hours <= ZERO:
            continue
        permitted = money(journey_hours * allowed_per)
        if apprentice_hours <= permitted:
            continue
        excess = money(apprentice_hours - permitted)
        yield Finding(
            rule_id="APPRENTICE_RATIO_EXCEEDED",
            severity=Severity.WARNING,
            title=f"Apprentice ratio exceeded for {classification_name}",
            detail=(
                f"The determination allows a {classification.apprentice_ratio} apprentice to "
                f"journeyworker ratio. This week shows {apprentice_hours} apprentice hours against "
                f"{journey_hours} journeyworker hours, which permits {permitted}. The excess "
                f"{excess} hours must be paid at the full journeyworker rate."
            ),
            action=(
                f"Either pay the excess {excess} hours at the journeyworker rate of "
                f"${classification.base_rate}, or adjust crew composition on site."
            ),
            citation="29 CFR 5.5(a)(4)(i)",
            amount_at_risk=None,
        )
