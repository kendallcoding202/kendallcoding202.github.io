"""WageProof — check a Davis-Bacon certified payroll before you file it.

    from wageproof import check_week, load_week_file, render_text

    week = load_week_file("week-12.json")
    result = check_week(week)
    if result.is_filable:
        print(render_text(week))
"""

from .compliance import ComplianceResult, Finding, Severity, check_week
from .forms import build_payload, render_statement_of_compliance, render_text
from .importers import load_week, load_week_file, week_from_csv
from .models import (
    Classification,
    Contractor,
    Deduction,
    DeductionType,
    FringeCredit,
    PayrollWeek,
    Project,
    WageDetermination,
    Worker,
    WorkerType,
)
from .payroll import PayComputation, compute_pay, compute_week

__version__ = "0.1.0"

__all__ = [
    "Classification",
    "ComplianceResult",
    "Contractor",
    "Deduction",
    "DeductionType",
    "Finding",
    "FringeCredit",
    "PayComputation",
    "PayrollWeek",
    "Project",
    "Severity",
    "WageDetermination",
    "Worker",
    "WorkerType",
    "__version__",
    "build_payload",
    "check_week",
    "compute_pay",
    "compute_week",
    "load_week",
    "load_week_file",
    "render_statement_of_compliance",
    "render_text",
    "week_from_csv",
]
