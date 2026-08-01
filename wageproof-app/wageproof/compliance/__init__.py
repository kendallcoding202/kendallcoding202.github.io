"""Pre-filing checks.

Filing a wrong WH-347 is worse than filing late: the certification on page two
is signed under penalty of prosecution under 18 U.S.C. 1001. So every rule here
runs *before* anything is generated, and a BLOCKER stops the form from being
produced at all unless the caller explicitly overrides.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum

from ..models import ZERO, PayrollWeek
from ..payroll import PayComputation, compute_week


class Severity(StrEnum):
    BLOCKER = "blocker"
    WARNING = "warning"
    NOTICE = "notice"


_SEVERITY_ORDER = {Severity.BLOCKER: 0, Severity.WARNING: 1, Severity.NOTICE: 2}


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: Severity
    title: str
    detail: str
    action: str
    citation: str | None = None
    worker_name: str | None = None
    amount_at_risk: Decimal | None = None

    def sort_key(self) -> tuple[int, Decimal, str]:
        return (
            _SEVERITY_ORDER[self.severity],
            -(self.amount_at_risk or ZERO),
            self.worker_name or "",
        )


Rule = Callable[[PayrollWeek, dict[str, PayComputation]], Iterable[Finding]]
_REGISTRY: list[Rule] = []


def rule(func: Rule) -> Rule:
    """Register a check. Import order determines nothing — findings are sorted."""
    _REGISTRY.append(func)
    return func


@dataclass
class ComplianceResult:
    week: PayrollWeek
    computations: dict[str, PayComputation]
    findings: list[Finding] = field(default_factory=list)

    @property
    def sorted_findings(self) -> list[Finding]:
        return sorted(self.findings, key=lambda f: f.sort_key())

    @property
    def blockers(self) -> list[Finding]:
        return [f for f in self.sorted_findings if f.severity is Severity.BLOCKER]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.sorted_findings if f.severity is Severity.WARNING]

    @property
    def is_filable(self) -> bool:
        return not self.blockers

    @property
    def total_at_risk(self) -> Decimal:
        return sum((f.amount_at_risk for f in self.findings if f.amount_at_risk), ZERO)


def check_week(week: PayrollWeek) -> ComplianceResult:
    """Run every registered rule against a payroll week."""
    from . import classification, deductions, filing, wages  # noqa: F401  (registers rules)

    computations = compute_week(week)
    findings: list[Finding] = []
    for check in _REGISTRY:
        findings.extend(check(week, computations))
    return ComplianceResult(week=week, computations=computations, findings=findings)
