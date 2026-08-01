"""The rules. Each test names the mistake it is guarding against."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from wageproof.compliance import Severity, check_week
from wageproof.models import (
    Deduction,
    DeductionType,
    FringeCredit,
    PayrollWeek,
    Worker,
    WorkerType,
)

from .conftest import weekdays


def rule_ids(week: PayrollWeek) -> set[str]:
    return {f.rule_id for f in check_week(week).findings}


def finding(week: PayrollWeek, rule_id: str):
    return next(f for f in check_week(week).findings if f.rule_id == rule_id)


def test_a_correct_payroll_raises_nothing_blocking(week: PayrollWeek) -> None:
    result = check_week(week)
    assert result.is_filable
    assert result.blockers == []


def test_underpaid_base_rate_blocks_and_prices_the_gap(week: PayrollWeek) -> None:
    week.workers[0].cash_hourly_rate = Decimal("44.00")
    found = finding(week, "WAGE_BASE_UNDERPAID")
    assert found.severity is Severity.BLOCKER
    assert found.amount_at_risk == Decimal("168.00")  # 4.20 x 40
    assert "48.20" in found.detail


def test_fringe_may_not_be_borrowed_to_cover_the_base_rate(week: PayrollWeek) -> None:
    """Generous benefits do not excuse a low cash rate."""
    worker = week.workers[0]
    worker.cash_hourly_rate = Decimal("40.00")
    worker.fringe_credits = [FringeCredit(plan_name="H&W", hourly_rate=Decimal("60.00"))]
    assert "WAGE_BASE_UNDERPAID" in rule_ids(week)


def test_missing_fringe_blocks(week: PayrollWeek) -> None:
    week.workers[0].fringe_credits = []
    found = finding(week, "WAGE_FRINGE_SHORTFALL")
    assert found.severity is Severity.BLOCKER
    assert found.amount_at_risk == Decimal("1246.00")  # 31.15 x 40


def test_cash_in_lieu_satisfies_the_fringe_requirement(week: PayrollWeek) -> None:
    worker = week.workers[0]
    worker.fringe_credits = []
    worker.cash_fringe_in_lieu = Decimal("31.15")
    assert "WAGE_FRINGE_SHORTFALL" not in rule_ids(week)


def test_a_mix_of_plan_and_cash_fringe_is_fine(week: PayrollWeek) -> None:
    worker = week.workers[0]
    worker.fringe_credits = [FringeCredit(plan_name="H&W", hourly_rate=Decimal("20.00"))]
    worker.cash_fringe_in_lieu = Decimal("11.15")
    assert "WAGE_FRINGE_SHORTFALL" not in rule_ids(week)


def test_non_bona_fide_plan_is_named_in_the_finding(week: PayrollWeek) -> None:
    week.workers[0].fringe_credits = [
        FringeCredit(plan_name="Unfunded promise", hourly_rate=Decimal("31.15"),
                     is_bona_fide_plan=False)
    ]
    assert "Unfunded promise" in finding(week, "WAGE_FRINGE_SHORTFALL").detail


def test_overtime_shortfall_is_priced_separately(week: PayrollWeek) -> None:
    worker = week.workers[0]
    worker.cash_hourly_rate = Decimal("44.00")
    worker.daily_hours = weekdays(8, 8, 8, 8, 8, 6)
    found = finding(week, "WAGE_OVERTIME_SHORT")
    assert found.severity is Severity.BLOCKER
    # (72.30 - 66.00) x 6
    assert found.amount_at_risk == Decimal("37.80")


def test_combined_base_and_fringe_rate_is_flagged(week: PayrollWeek) -> None:
    """The 'one hourly rate' spreadsheet habit."""
    worker = week.workers[0]
    worker.cash_hourly_rate = Decimal("79.35")  # 48.20 + 31.15
    worker.fringe_credits = []
    worker.daily_hours = weekdays(8, 8, 8, 8, 8, 4)
    ids = rule_ids(week)
    assert "WAGE_FRINGE_IN_OT_BASE" in ids
    assert finding(week, "WAGE_FRINGE_IN_OT_BASE").severity is Severity.WARNING


def test_unknown_classification_blocks_and_suggests_a_correction(week: PayrollWeek) -> None:
    week.workers[0].classification = "Electricion"
    found = finding(week, "CLASS_NOT_ON_DETERMINATION")
    assert found.severity is Severity.BLOCKER
    assert "Electrician" in found.detail


def test_missing_wage_determination_blocks(week: PayrollWeek) -> None:
    week.project.wage_determination = None
    assert "WD_MISSING" in rule_ids(week)


def test_unregistered_apprentice_blocks(week: PayrollWeek) -> None:
    worker = week.workers[0]
    worker.worker_type = WorkerType.APPRENTICE
    worker.cash_hourly_rate = Decimal("28.00")
    found = finding(week, "APPRENTICE_NOT_REGISTERED")
    assert found.severity is Severity.BLOCKER
    assert found.amount_at_risk == Decimal("808.00")  # (48.20 - 28.00) x 40


def test_registered_apprentice_at_the_right_percentage_passes(week: PayrollWeek) -> None:
    worker = week.workers[0]
    worker.worker_type = WorkerType.APPRENTICE
    worker.apprentice_program_registered = True
    worker.apprentice_wage_percentage = Decimal("65")
    worker.cash_hourly_rate = Decimal("31.33")
    ids = rule_ids(week)
    assert "APPRENTICE_NOT_REGISTERED" not in ids
    assert "WAGE_BASE_UNDERPAID" not in ids


def test_apprentice_ratio_is_enforced_against_journeyworker_hours(
    week: PayrollWeek, compliant_worker: Worker
) -> None:
    """Electrician allows 1:2 — one apprentice hour per two journeyworker hours."""
    apprentice = Worker(
        name="Jo Castellanos",
        classification="Electrician",
        worker_type=WorkerType.APPRENTICE,
        apprentice_program_registered=True,
        apprentice_wage_percentage=Decimal("65"),
        cash_hourly_rate=Decimal("31.33"),
        cash_fringe_in_lieu=Decimal("31.15"),
        daily_hours=weekdays(8, 8, 8, 8, 8),  # 40 against 40 journeyworker hours
    )
    week.workers.append(apprentice)
    found = finding(week, "APPRENTICE_RATIO_EXCEEDED")
    assert found.severity is Severity.WARNING
    assert "20.00" in found.detail  # 40 journeyworker hours permit 20 apprentice hours


def test_unauthorized_deduction_blocks(week: PayrollWeek) -> None:
    week.workers[0].deductions = [
        Deduction(name="Tool rental", amount=Decimal("75.00"), kind=DeductionType.UNAUTHORIZED)
    ]
    found = finding(week, "DEDUCT_NOT_PERMITTED")
    assert found.severity is Severity.BLOCKER
    assert found.amount_at_risk == Decimal("75.00")


def test_taxes_need_no_written_authorization(week: PayrollWeek) -> None:
    week.workers[0].deductions = [
        Deduction(name="Federal withholding", amount=Decimal("241.00"),
                  kind=DeductionType.PAYROLL_TAX)
    ]
    assert "DEDUCT_NO_WRITTEN_CONSENT" not in rule_ids(week)


def test_other_deductions_need_written_consent(week: PayrollWeek) -> None:
    week.workers[0].deductions = [
        Deduction(name="Advance repayment", amount=Decimal("100.00"),
                  kind=DeductionType.AUTHORIZED_OTHER, has_written_authorization=False)
    ]
    assert "DEDUCT_NO_WRITTEN_CONSENT" in rule_ids(week)

    week.workers[0].deductions[0].has_written_authorization = True
    assert "DEDUCT_NO_WRITTEN_CONSENT" not in rule_ids(week)


def test_deductions_exceeding_gross_block(week: PayrollWeek) -> None:
    week.workers[0].deductions = [
        Deduction(name="Garnishment", amount=Decimal("9000.00"), kind=DeductionType.COURT_ORDERED)
    ]
    assert "DEDUCT_EXCEEDS_GROSS" in rule_ids(week)


def test_incomplete_header_blocks(week: PayrollWeek) -> None:
    week.project.contract_number = None
    week.payroll_number = None
    found = finding(week, "FORM_MISSING_HEADER")
    assert "contract number" in found.detail
    assert "payroll number" in found.detail


def test_missing_signatory_blocks(week: PayrollWeek) -> None:
    week.contractor.signatory_name = None
    assert "FORM_NO_SIGNATORY" in rule_ids(week)


def test_full_social_security_number_blocks(week: PayrollWeek) -> None:
    week.workers[0].identifier = "123456789"
    assert "FORM_FULL_SSN" in rule_ids(week)


def test_missing_worker_identifier_warns(week: PayrollWeek) -> None:
    week.workers[0].identifier = None
    assert finding(week, "FORM_NO_WORKER_ID").severity is Severity.WARNING


def test_hours_outside_the_payroll_week_block(week: PayrollWeek) -> None:
    week.workers[0].daily_hours[date(2026, 2, 20)] = Decimal("8")
    assert "FORM_HOURS_OUTSIDE_WEEK" in rule_ids(week)


def test_zero_hours_warns(week: PayrollWeek) -> None:
    week.workers[0].daily_hours = {}
    assert "FORM_NO_HOURS" in rule_ids(week)


def test_implausible_daily_hours_warn(week: PayrollWeek) -> None:
    week.workers[0].daily_hours = weekdays(20, 8, 8)
    assert "HOURS_IMPLAUSIBLE" in rule_ids(week)


def test_late_filing_warns(week: PayrollWeek) -> None:
    week.pay_date = date(2026, 3, 13)
    week.filed_date = date(2026, 3, 30)
    found = finding(week, "FILE_OVERDUE")
    assert "10 days overdue" in found.title


def test_filing_on_time_raises_no_deadline_finding(week: PayrollWeek) -> None:
    week.filed_date = date(2026, 3, 14)
    ids = rule_ids(week)
    assert "FILE_OVERDUE" not in ids


def test_missing_pay_date_warns(week: PayrollWeek) -> None:
    week.pay_date = None
    assert "FILE_NO_PAY_DATE" in rule_ids(week)


def test_total_at_risk_sums_the_priced_findings(week: PayrollWeek) -> None:
    week.workers[0].cash_hourly_rate = Decimal("44.00")
    week.workers[0].fringe_credits = []
    result = check_week(week)
    # 168.00 base gap + 1246.00 fringe gap
    assert result.total_at_risk == Decimal("1414.00")
    assert not result.is_filable
