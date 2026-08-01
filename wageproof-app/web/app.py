"""The free WH-347 checker.

Deliberately account-free and stateless. A contractor pastes a week of payroll,
sees what is wrong and what it would cost, and leaves. Nothing is written to
disk — the input contains worker names and partial social security numbers, and
the fastest way to never leak those is to never store them.

    uvicorn web.app:app --reload
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from wageproof import __version__
from wageproof.compliance import Severity, check_week
from wageproof.forms import render_text
from wageproof.importers import (
    ImportError_,
    parse_date,
    parse_rate_lines,
    week_from_csv,
)
from wageproof.models import ZERO

from . import analytics
from .analytics import AnalyticsError, Attribution

STATIC = Path(__file__).parent / "static"

# A pasted week from a small sub is a few kilobytes. Anything far past that is
# not a payroll week, so it gets refused before it reaches the parser.
MAX_INPUT_CHARS = 200_000

# The free checker asks for rates, hours, and classifications — not the form
# header. Raising blockers about fields we never asked for would mean every
# check came back "do not file", which teaches people to ignore the result.
# These are suppressed unless the caller actually supplied the header.
HEADER_RULES = {"FORM_MISSING_HEADER", "FORM_NO_SIGNATORY"}

METRICS_TOKEN_ENV = "WAGEPROOF_METRICS_TOKEN"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    analytics.init_db()
    yield


app = FastAPI(
    title="WageProof",
    description="Check a Davis-Bacon certified payroll before you file it.",
    version=__version__,
    lifespan=lifespan,
)


class Campaign(BaseModel):
    """Ad attribution as it arrived in the landing URL."""

    source: str | None = None
    medium: str | None = None
    campaign: str | None = None
    term: str | None = None
    gclid: str | None = None

    def to_attribution(self) -> Attribution:
        return Attribution(
            source=self.source,
            medium=self.medium,
            campaign=self.campaign,
            term=self.term,
            gclid=self.gclid,
        )


class EventRequest(BaseModel):
    session_id: str
    name: str
    campaign: Campaign | None = None


class SaveRequest(BaseModel):
    email: str
    rates: str | None = None
    project_name: str | None = None
    session_id: str | None = None
    campaign: Campaign | None = None


class CheckRequest(BaseModel):
    timesheet: str = Field(..., description="Time sheet CSV")
    rates: str = Field(..., description="Wage rates, one classification per line")
    week_ending: str = Field(..., description="Week ending date")
    pay_date: str | None = None
    payroll_number: str | None = None
    project_name: str | None = None
    project_location: str | None = None
    contract_number: str | None = None
    wage_determination: str | None = None
    contractor_name: str | None = None
    contractor_address: str | None = None
    signatory_name: str | None = None
    signatory_title: str | None = None


def _finding_json(finding: Any) -> dict[str, Any]:
    return {
        "rule_id": finding.rule_id,
        "severity": finding.severity.value,
        "title": finding.title,
        "detail": finding.detail,
        "action": finding.action,
        "citation": finding.citation,
        "worker": finding.worker_name,
        "amount_at_risk": str(finding.amount_at_risk) if finding.amount_at_risk else None,
    }


@app.post("/api/check")
def check(request: CheckRequest) -> JSONResponse:
    if len(request.timesheet) + len(request.rates) > MAX_INPUT_CHARS:
        raise HTTPException(status_code=413, detail="That is larger than one week of payroll.")

    week_ending = parse_date(request.week_ending)
    if week_ending is None:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read the week ending date {request.week_ending!r}. Try YYYY-MM-DD.",
        )

    try:
        classifications = parse_rate_lines(request.rates)
        week = week_from_csv(
            request.timesheet,
            week_ending=week_ending,
            project={
                "name": request.project_name or "Untitled project",
                "location": request.project_location,
                "contract_number": request.contract_number,
                "wage_determination": {
                    "number": request.wage_determination or "",
                    "classifications": classifications,
                },
            },
            contractor={
                "name": request.contractor_name or "",
                "address": request.contractor_address,
                "signatory_name": request.signatory_name,
                "signatory_title": request.signatory_title,
            },
            payroll_number=request.payroll_number,
            pay_date=request.pay_date,
            filed_date=date.today().isoformat(),
        )
    except ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = check_week(week)
    computations = result.computations

    gave_header = bool(request.contractor_name and request.signatory_name)
    findings = [
        f for f in result.sorted_findings if gave_header or f.rule_id not in HEADER_RULES
    ]
    blockers = [f for f in findings if f.severity is Severity.BLOCKER]
    warnings = [f for f in findings if f.severity is Severity.WARNING]
    filable = not blockers

    return JSONResponse(
        {
            "filable": filable,
            "checked_header": gave_header,
            "total_at_risk": str(result.total_at_risk),
            "counts": {
                "blockers": len(blockers),
                "warnings": len(warnings),
                "notices": len([f for f in findings if f.severity is Severity.NOTICE]),
                "workers": len(week.workers),
            },
            "week": {
                "ending": week.week_ending.isoformat(),
                "due": week.filing_due_date.isoformat() if week.filing_due_date else None,
                "total_hours": str(
                    sum((c.total_hours for c in computations.values()), ZERO)
                ),
                "total_gross": str(
                    sum((c.actual_cash for c in computations.values()), ZERO)
                ),
            },
            "workers": [
                {
                    "name": name,
                    "classification": comp.worker.classification,
                    "hours": str(comp.total_hours),
                    "overtime_hours": str(comp.overtime_hours),
                    "rate": str(comp.worker.cash_hourly_rate),
                    "required_base": str(comp.required.base_rate) if comp.required else None,
                    "required_fringe": str(comp.required.fringe_rate) if comp.required else None,
                    "gross": str(comp.actual_cash),
                    "shortfall": str(comp.cash_shortfall),
                }
                for name, comp in computations.items()
            ],
            "findings": [_finding_json(f) for f in findings],
            # Only offered when the payroll is clean *and* the header was given —
            # the whole point is that a form should not exist while a blocker
            # stands, and a form missing its header is not fileable either.
            "form": render_text(week) if result.is_filable else None,
        }
    )


@app.post("/api/event")
def event(request: EventRequest) -> dict[str, bool]:
    """Record one anonymous funnel step.

    Measurement must never be able to break the product, so a bad event is
    swallowed rather than surfaced — the visitor is mid-task and does not care.
    """
    try:
        analytics.record_event(
            request.session_id,
            request.name,
            request.campaign.to_attribution() if request.campaign else None,
        )
    except AnalyticsError:
        return {"recorded": False}
    return {"recorded": True}


@app.post("/api/save")
def save(request: SaveRequest) -> dict[str, str]:
    """Keep an email and a rate list so next week is not a retype.

    The time sheet is not accepted here and is not stored anywhere. That is the
    promise the landing page makes, and this endpoint is where it would break if
    it were going to.
    """
    try:
        analytics.save_lead(
            email=request.email,
            rates=request.rates,
            project_name=request.project_name,
            session_id=request.session_id,
            attribution=request.campaign.to_attribution() if request.campaign else None,
        )
    except AnalyticsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "saved"}


@app.get("/api/funnel")
def funnel(
    campaign: str | None = None,
    x_metrics_token: str | None = Header(default=None),
) -> dict[str, object]:
    """Internal metrics. Disabled unless a token is configured."""
    expected = os.environ.get(METRICS_TOKEN_ENV)
    if not expected:
        raise HTTPException(status_code=404, detail="Not found.")
    if x_metrics_token != expected:
        raise HTTPException(status_code=401, detail="Bad metrics token.")
    return analytics.funnel(campaign)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")
