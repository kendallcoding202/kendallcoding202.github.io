"""Core data model for a medical bill and the findings raised against it."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum


class Severity(str, Enum):
    """How confident we are that the patient should push back on a line.

    HIGH is reserved for things that are either arithmetically certain (the same
    charge appears twice) or that a statute forbids outright. Everything that
    depends on clinical context the bill does not contain is MEDIUM or QUESTION,
    because we cannot see the medical record and must not pretend otherwise.
    """

    HIGH = "high"
    MEDIUM = "medium"
    QUESTION = "question"


SEVERITY_ORDER = {Severity.HIGH: 0, Severity.MEDIUM: 1, Severity.QUESTION: 2}


class PlaceOfService(str, Enum):
    EMERGENCY = "emergency"
    INPATIENT = "inpatient"
    OUTPATIENT = "outpatient"
    OFFICE = "office"
    UNKNOWN = "unknown"


class NetworkStatus(str, Enum):
    IN_NETWORK = "in"
    OUT_OF_NETWORK = "out"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class LineItem:
    """One charge line on an itemized statement."""

    index: int
    description: str
    charge: Decimal
    code: str | None = None
    code_type: str = "CPT"
    date_of_service: date | None = None
    units: int = 1
    modifiers: tuple[str, ...] = ()
    revenue_code: str | None = None

    @property
    def unit_charge(self) -> Decimal:
        if self.units <= 0:
            return self.charge
        return (self.charge / self.units).quantize(Decimal("0.01"))

    @property
    def label(self) -> str:
        return f"line {self.index}" + (f" ({self.code})" if self.code else "")


@dataclass
class Bill:
    """A parsed statement plus the context the patient can tell us about it."""

    lines: list[LineItem] = field(default_factory=list)
    patient_name: str | None = None
    provider_name: str | None = None
    account_number: str | None = None
    statement_date: date | None = None
    admission_date: date | None = None
    discharge_date: date | None = None
    total_charged: Decimal | None = None
    patient_responsibility: Decimal | None = None
    amount_paid: Decimal | None = None
    place_of_service: PlaceOfService = PlaceOfService.UNKNOWN
    provider_network_status: NetworkStatus = NetworkStatus.UNKNOWN
    facility_network_status: NetworkStatus = NetworkStatus.UNKNOWN
    is_itemized: bool = True
    gave_written_consent_to_out_of_network: bool = False
    insurance_plan: str | None = None

    @property
    def computed_total(self) -> Decimal:
        return sum((line.charge for line in self.lines), Decimal("0"))

    def line(self, index: int) -> LineItem | None:
        return next((ln for ln in self.lines if ln.index == index), None)


@dataclass(frozen=True)
class Finding:
    """One thing worth disputing, written so a patient can read it out loud."""

    rule_id: str
    severity: Severity
    title: str
    detail: str
    action: str
    line_indexes: tuple[int, ...] = ()
    citation: str | None = None
    estimated_recovery: Decimal | None = None

    def sort_key(self) -> tuple[int, Decimal]:
        recovery = self.estimated_recovery or Decimal("0")
        return (SEVERITY_ORDER[self.severity], -recovery)


@dataclass
class Report:
    """The result of running every rule against one bill."""

    bill: Bill
    findings: list[Finding] = field(default_factory=list)
    used_sample_reference_data: bool = False

    @property
    def sorted_findings(self) -> list[Finding]:
        return sorted(self.findings, key=lambda f: f.sort_key())

    @property
    def estimated_recovery(self) -> Decimal:
        """Total of the recoveries we could actually quantify.

        Findings we cannot price (a missing itemization, an unanswered question)
        contribute nothing here, so this is deliberately a floor rather than a
        promise.
        """
        return sum(
            (f.estimated_recovery for f in self.findings if f.estimated_recovery), Decimal("0")
        )

    @property
    def disputable_lines(self) -> set[int]:
        return {idx for f in self.findings for idx in f.line_indexes}

    def by_severity(self, severity: Severity) -> list[Finding]:
        return [f for f in self.sorted_findings if f.severity == severity]
