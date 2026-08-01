"""Render Form WH-347 — the payroll page and the statement of compliance.

Two outputs, deliberately:

* ``build_payload`` returns structured data. Every state portal wants the same
  facts in a different shape, so adapters consume this rather than scraping text.
* ``render_text`` produces a printable payroll the contractor can read and check
  before anything is transmitted.

Producing the government's fillable PDF is a separate concern — that needs the
official form as an overlay target, and it is tracked in docs/roadmap.md.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..models import ZERO, PayrollWeek, money
from ..payroll import PayComputation, compute_week

# 26 (name) + 22 (classification) + 7x7 (days) + 7 (total) + 9 (rate) + 11 (gross)
FORM_WIDTH = 124

STATEMENT_OF_COMPLIANCE = """\
STATEMENT OF COMPLIANCE

Date: {date}

I, {signatory}, {title}, do hereby state:

(1) That I pay or supervise the payment of the persons employed by {contractor}
    on the {project}; that during the payroll period commencing on the {start}
    day of {start_month}, {start_year}, and ending the {end} day of {end_month},
    {end_year}, all persons employed on said project have been paid the full
    weekly wages earned, that no rebates have been or will be made either
    directly or indirectly to or on behalf of said {contractor} from the full
    weekly wages earned by any person, and that no deductions have been made
    either directly or indirectly from the full wages earned by any person,
    other than permissible deductions as defined in Regulations, Part 3 (29 CFR
    Subtitle A), issued by the Secretary of Labor under the Copeland Act, as
    amended.

(2) That any payrolls otherwise under this contract required to be submitted for
    the above period are correct and complete; that the wage rates for laborers
    or mechanics contained therein are not less than the applicable wage rates
    contained in any wage determination incorporated into the contract; that the
    classifications set forth therein for each laborer or mechanic conform with
    the work he performed.

(3) That any apprentices employed in the above period are duly registered in a
    bona fide apprenticeship program registered with a State apprenticeship
    agency recognized by the Bureau of Apprenticeship and Training, United States
    Department of Labor, or if no such recognized agency exists in a State, are
    registered with the Bureau of Apprenticeship and Training, United States
    Department of Labor.

(4) That fringe benefits are paid as noted in the payroll above.

REMARKS: {remarks}

NAME AND TITLE: {signatory}, {title}

SIGNATURE: ______________________________________

THE WILLFUL FALSIFICATION OF ANY OF THE ABOVE STATEMENTS MAY SUBJECT THE
CONTRACTOR OR SUBCONTRACTOR TO CIVIL OR CRIMINAL PROSECUTION. SEE SECTION 1001
OF TITLE 18 AND SECTION 3729 OF TITLE 31 OF THE UNITED STATES CODE.
"""


def _worker_payload(comp: PayComputation, week: PayrollWeek) -> dict[str, Any]:
    worker = comp.worker
    return {
        "name": worker.name,
        "identifier": worker.identifier,
        "withholding_exemptions": worker.withholding_exemptions,
        "classification": worker.classification,
        "worker_type": worker.worker_type.value,
        "daily_hours": {
            day.isoformat(): str(worker.daily_hours.get(day, ZERO)) for day in week.week_dates
        },
        "total_hours": str(comp.total_hours),
        "straight_hours": str(comp.straight_hours),
        "overtime_hours": str(comp.overtime_hours),
        "hourly_rate": str(worker.cash_hourly_rate),
        "cash_fringe_in_lieu": str(worker.cash_fringe_in_lieu),
        "fringe_credit_rate": str(worker.fringe_credit_rate),
        "gross_this_project": str(comp.actual_cash),
        "gross_all_projects": str(worker.gross_paid_all_projects or comp.actual_cash),
        "deductions": [
            {"name": d.name, "amount": str(d.amount), "type": d.kind.value}
            for d in worker.deductions
        ],
        "total_deductions": str(worker.total_deductions),
        "net_pay": str(comp.net_pay),
        "fringe_plans": [
            {"plan": c.plan_name, "hourly_rate": str(c.hourly_rate)} for c in worker.fringe_credits
        ],
    }


def build_payload(week: PayrollWeek) -> dict[str, Any]:
    """Structured WH-347 content, ready for a portal adapter or a PDF filler."""
    computations = compute_week(week)
    determination = week.project.wage_determination
    return {
        "form": "WH-347",
        "contractor": {
            "name": week.contractor.name,
            "address": week.contractor.address,
            "is_subcontractor": week.contractor.is_subcontractor,
        },
        "payroll_number": week.payroll_number,
        "is_final": week.is_final,
        "week_ending": week.week_ending.isoformat(),
        "week_start": week.week_start.isoformat(),
        "pay_date": week.pay_date.isoformat() if week.pay_date else None,
        "filing_due_date": week.filing_due_date.isoformat() if week.filing_due_date else None,
        "project": {
            "name": week.project.name,
            "location": week.project.location,
            "contract_number": week.project.contract_number,
            "contracting_agency": week.project.contracting_agency,
            "wage_determination": determination.number if determination else None,
        },
        "week_dates": [day.isoformat() for day in week.week_dates],
        "workers": [_worker_payload(computations[w.name], week) for w in week.workers],
        "totals": {
            "gross": str(money(sum((c.actual_cash for c in computations.values()), ZERO))),
            "hours": str(sum((c.total_hours for c in computations.values()), ZERO)),
            "workers": len(week.workers),
        },
    }


def _ordinal(value: int) -> str:
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def render_statement_of_compliance(week: PayrollWeek, remarks: str = "") -> str:
    contractor = week.contractor
    return STATEMENT_OF_COMPLIANCE.format(
        date=week.week_ending.strftime("%B %d, %Y"),
        signatory=contractor.signatory_name or "________________",
        title=contractor.signatory_title or "________________",
        contractor=contractor.name,
        project=week.project.name,
        start=_ordinal(week.week_start.day),
        start_month=week.week_start.strftime("%B"),
        start_year=week.week_start.year,
        end=_ordinal(week.week_ending.day),
        end_month=week.week_ending.strftime("%B"),
        end_year=week.week_ending.year,
        remarks=remarks or "None",
    )


def render_text(week: PayrollWeek, remarks: str = "") -> str:
    """A printable payroll page. Wide, but so is the real form."""
    computations = compute_week(week)
    determination = week.project.wage_determination

    lines: list[str] = []
    add = lines.append

    add("U.S. DEPARTMENT OF LABOR — PAYROLL (Form WH-347)")
    add("=" * FORM_WIDTH)
    role = "SUBCONTRACTOR" if week.contractor.is_subcontractor else "CONTRACTOR"
    add(f"NAME OF {role}: {week.contractor.name}")
    add(f"ADDRESS: {week.contractor.address or '—'}")
    add("")
    add(f"PAYROLL NO.: {week.payroll_number or '—'}" + ("  (FINAL)" if week.is_final else ""))
    add(f"FOR WEEK ENDING: {week.week_ending:%B %d, %Y}")
    add(f"PROJECT AND LOCATION: {week.project.name} — {week.project.location or '—'}")
    add(f"PROJECT OR CONTRACT NO.: {week.project.contract_number or '—'}")
    if determination:
        add(f"WAGE DETERMINATION: {determination.number}")
    if week.pay_date:
        add(f"PAY DATE: {week.pay_date:%B %d, %Y}    DUE: {week.filing_due_date:%B %d, %Y}")
    add("=" * FORM_WIDTH)
    add("")

    day_header = "".join(f"{day:%a}".rjust(7) for day in week.week_dates)
    add(f"{'NAME / ID':<26}{'CLASSIFICATION':<22}{day_header}{'TOT':>7}{'RATE':>9}{'GROSS':>11}")
    add("-" * FORM_WIDTH)

    for worker in week.workers:
        comp = computations[worker.name]
        identity = f"{worker.name} ({worker.identifier})" if worker.identifier else worker.name
        daily = "".join(
            f"{worker.daily_hours.get(day, ZERO):g}".rjust(7) for day in week.week_dates
        )
        add(
            f"{identity[:25]:<26}"
            f"{worker.classification[:21]:<22}"
            f"{daily}"
            f"{comp.total_hours:>7g}"
            f"{worker.cash_hourly_rate:>9}"
            f"{comp.actual_cash:>11}"
        )

        if comp.overtime_hours > ZERO:
            add(
                f"{'':<26}{'  overtime':<22}"
                f"{'':>{7 * 7}}{comp.overtime_hours:>7g}"
                f"{money(worker.cash_hourly_rate * Decimal('1.5')):>9}"
                f"{comp.actual_overtime_pay:>11}"
            )

        fringe_note = []
        if worker.fringe_credit_rate > ZERO:
            plans = ", ".join(f"{c.plan_name} ${c.hourly_rate}/hr" for c in worker.fringe_credits)
            fringe_note.append(f"fringe plans: {plans}")
        if worker.cash_fringe_in_lieu > ZERO:
            fringe_note.append(f"cash in lieu ${worker.cash_fringe_in_lieu}/hr")
        if fringe_note:
            add(f"{'':<26}  {'; '.join(fringe_note)}")

        for deduction in worker.deductions:
            add(f"{'':<26}  deduction — {deduction.name}: ${deduction.amount}")
        add(
            f"{'':<26}  gross (all projects) ${worker.gross_paid_all_projects or comp.actual_cash}"
            f"   deductions ${worker.total_deductions}   net ${comp.net_pay}"
        )
        add("")

    total_gross = money(sum((c.actual_cash for c in computations.values()), ZERO))
    total_hours = sum((c.total_hours for c in computations.values()), ZERO)
    add("-" * FORM_WIDTH)
    add(f"{'TOTALS':<48}{total_hours:>25g}{total_gross:>23}")
    add("")
    add("")
    add(render_statement_of_compliance(week, remarks))

    return "\n".join(lines)
