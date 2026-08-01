"""Load projects and payroll weeks from JSON, and time sheets from CSV.

Small subcontractors keep time in a spreadsheet, so the CSV reader accepts both
shapes people actually produce: one row per worker with a column per day, or one
row per worker per day.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

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
    hours,
    money,
)

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_WEEKDAY_ALIASES = {name[:3]: index for index, name in enumerate(WEEKDAYS)}
_WEEKDAY_ALIASES.update({name: index for index, name in enumerate(WEEKDAYS)})

DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%b %d, %Y", "%d %b %Y")


class ImportError_(ValueError):
    """Raised when input cannot be read."""


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None or value == "":
        return default
    try:
        return Decimal(str(value).replace("$", "").replace(",", "").strip())
    except InvalidOperation:
        return default


def load_wage_determination(payload: dict[str, Any]) -> WageDetermination:
    classifications: dict[str, Classification] = {}
    raw = payload.get("classifications", {})
    entries = raw.items() if isinstance(raw, dict) else ((c["name"], c) for c in raw)
    for name, data in entries:
        if isinstance(data, (int, float, str)):
            data = {"base_rate": data}
        classifications[name] = Classification(
            name=name,
            base_rate=money(_decimal(data.get("base_rate"))),
            fringe_rate=money(_decimal(data.get("fringe_rate"))),
            apprentice_ratio=data.get("apprentice_ratio"),
        )
    return WageDetermination(
        number=payload.get("number", "—"),
        classifications=classifications,
        effective_date=parse_date(payload.get("effective_date")),
        description=payload.get("description"),
    )


def load_project(payload: dict[str, Any]) -> Project:
    determination = payload.get("wage_determination")
    return Project(
        name=payload.get("name", "—"),
        contract_number=payload.get("contract_number"),
        location=payload.get("location"),
        contracting_agency=payload.get("contracting_agency"),
        is_federally_funded=bool(payload.get("is_federally_funded", True)),
        wage_determination=load_wage_determination(determination) if determination else None,
    )


def load_contractor(payload: dict[str, Any]) -> Contractor:
    return Contractor(
        name=payload.get("name", "—"),
        address=payload.get("address"),
        is_subcontractor=bool(payload.get("is_subcontractor", True)),
        signatory_name=payload.get("signatory_name"),
        signatory_title=payload.get("signatory_title"),
    )


def _load_worker(payload: dict[str, Any], week_ending: date) -> Worker:
    daily: dict[date, Decimal] = {}
    raw_hours = payload.get("daily_hours", {})
    week_start = week_ending - timedelta(days=6)

    if isinstance(raw_hours, dict):
        for key, value in raw_hours.items():
            parsed = parse_date(key)
            if parsed is None:
                index = _WEEKDAY_ALIASES.get(_norm(str(key)))
                if index is None:
                    continue
                parsed = week_start + timedelta(days=index)
            daily[parsed] = hours(_decimal(value))
    elif isinstance(raw_hours, list):
        for offset, value in enumerate(raw_hours[:7]):
            daily[week_start + timedelta(days=offset)] = hours(_decimal(value))

    worker_type = WorkerType.JOURNEYWORKER
    if payload.get("worker_type"):
        try:
            worker_type = WorkerType(str(payload["worker_type"]).lower())
        except ValueError:
            worker_type = WorkerType.JOURNEYWORKER

    return Worker(
        name=payload.get("name", "—"),
        classification=payload.get("classification", ""),
        daily_hours=daily,
        cash_hourly_rate=money(_decimal(payload.get("cash_hourly_rate", payload.get("rate")))),
        cash_fringe_in_lieu=money(_decimal(payload.get("cash_fringe_in_lieu"))),
        worker_type=worker_type,
        identifier=str(payload["identifier"]) if payload.get("identifier") else None,
        withholding_exemptions=payload.get("withholding_exemptions"),
        other_project_hours=hours(_decimal(payload.get("other_project_hours"))),
        apprentice_program_registered=bool(payload.get("apprentice_program_registered", False)),
        apprentice_wage_percentage=(
            _decimal(payload["apprentice_wage_percentage"])
            if payload.get("apprentice_wage_percentage") is not None
            else None
        ),
        gross_paid_all_projects=(
            money(_decimal(payload["gross_paid_all_projects"]))
            if payload.get("gross_paid_all_projects") is not None
            else None
        ),
        fringe_credits=[
            FringeCredit(
                plan_name=c.get("plan_name", "benefit plan"),
                hourly_rate=money(_decimal(c.get("hourly_rate"))),
                is_bona_fide_plan=bool(c.get("is_bona_fide_plan", True)),
            )
            for c in payload.get("fringe_credits", [])
        ],
        deductions=[
            Deduction(
                name=d.get("name", "deduction"),
                amount=money(_decimal(d.get("amount"))),
                kind=_deduction_type(d.get("kind")),
                has_written_authorization=bool(d.get("has_written_authorization", False)),
            )
            for d in payload.get("deductions", [])
        ],
    )


def _deduction_type(value: Any) -> DeductionType:
    if not value:
        return DeductionType.AUTHORIZED_OTHER
    try:
        return DeductionType(str(value).lower())
    except ValueError:
        return DeductionType.AUTHORIZED_OTHER


def load_week(payload: dict[str, Any]) -> PayrollWeek:
    week_ending = parse_date(payload.get("week_ending"))
    if week_ending is None:
        raise ImportError_("week_ending is required and must be a date.")

    project_payload = payload.get("project")
    if not project_payload:
        raise ImportError_("A project block is required.")

    return PayrollWeek(
        project=load_project(project_payload),
        contractor=load_contractor(payload.get("contractor", {})),
        week_ending=week_ending,
        payroll_number=(
            str(payload["payroll_number"]) if payload.get("payroll_number") is not None else None
        ),
        pay_date=parse_date(payload.get("pay_date")),
        filed_date=parse_date(payload.get("filed_date")),
        is_final=bool(payload.get("is_final", False)),
        workers=[_load_worker(w, week_ending) for w in payload.get("workers", [])],
    )


def load_week_file(path: str | Path) -> PayrollWeek:
    return load_week(json.loads(Path(path).read_text()))


def workers_from_csv(text: str, week_ending: date) -> list[dict[str, Any]]:
    """Read a time sheet into worker payloads.

    Wide: ``name,classification,rate,2026-03-02,2026-03-03,...`` or day names.
    Long: ``name,classification,rate,date,hours`` with one row per day worked.
    """
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ImportError_("The CSV has no header row.")

    fields = {_norm(f): f for f in reader.fieldnames}
    day_columns: dict[str, date] = {}
    week_start = week_ending - timedelta(days=6)
    for raw in reader.fieldnames:
        parsed = parse_date(raw)
        if parsed is not None:
            day_columns[raw] = parsed
            continue
        index = _WEEKDAY_ALIASES.get(_norm(raw))
        if index is not None:
            day_columns[raw] = week_start + timedelta(days=index)

    is_long = not day_columns and "date" in fields and "hours" in fields
    if not day_columns and not is_long:
        raise ImportError_(
            "Could not find day columns. Use one column per day (Mon..Sun or dates), "
            "or a 'date' and 'hours' column with one row per day."
        )

    by_name: dict[str, dict[str, Any]] = {}
    for row in reader:
        name = (row.get(fields.get("name", "name")) or "").strip()
        if not name:
            continue
        entry = by_name.setdefault(
            name,
            {
                "name": name,
                "classification": (row.get(fields.get("classification", "")) or "").strip(),
                "rate": row.get(fields.get("rate", "")) or row.get(fields.get("hourlyrate", "")),
                "cash_fringe_in_lieu": row.get(fields.get("cashfringeinlieu", ""))
                or row.get(fields.get("fringe", "")),
                "identifier": row.get(fields.get("id", ""))
                or row.get(fields.get("identifier", "")),
                "worker_type": row.get(fields.get("workertype", "")),
                "other_project_hours": row.get(fields.get("otherprojecthours", "")),
                "daily_hours": {},
            },
        )
        if is_long:
            day = parse_date(row.get(fields["date"]))
            if day is not None:
                worked = _decimal(row.get(fields["hours"]))
                existing = _decimal(entry["daily_hours"].get(day.isoformat(), 0))
                entry["daily_hours"][day.isoformat()] = str(existing + worked)
        else:
            for column, day in day_columns.items():
                worked = _decimal(row.get(column))
                if worked:
                    entry["daily_hours"][day.isoformat()] = str(worked)

    return list(by_name.values())


def week_from_csv(
    text: str,
    week_ending: date,
    project: dict[str, Any],
    contractor: dict[str, Any] | None = None,
    **extra: Any,
) -> PayrollWeek:
    payload: dict[str, Any] = {
        "week_ending": week_ending.isoformat(),
        "project": project,
        "contractor": contractor or {},
        "workers": workers_from_csv(text, week_ending),
    }
    payload.update(extra)
    return load_week(payload)
