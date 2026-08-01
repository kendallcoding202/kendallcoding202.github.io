"""Turn whatever the patient has into a :class:`Bill`.

People send three things: a CSV they typed out, a JSON payload from the web
form, or a PDF the hospital mailed them. The PDF path is deliberately
best-effort — hospital statements have no standard layout, so we extract what
we can confidently and let the caller correct it, rather than silently guessing.
"""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from .models import Bill, LineItem, NetworkStatus, PlaceOfService

CODE_RE = re.compile(r"\b(?:[0-9]{5}|[A-HJ-Z][0-9]{4})\b")
MONEY_RE = re.compile(r"\(?\$?\s*-?[0-9][0-9,]*\.[0-9]{2}\)?")
DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%d %b %Y", "%b %d, %Y")

_COLUMN_ALIASES = {
    "description": {"description", "service", "item", "servicedescription", "procedure", "detail"},
    "charge": {"charge", "amount", "charges", "billed", "totalcharge", "price", "cost"},
    "code": {"code", "cpt", "cptcode", "hcpcs", "procedurecode", "cpthcpcs"},
    "date_of_service": {"date", "dateofservice", "dos", "servicedate"},
    "units": {"units", "qty", "quantity", "unit"},
    "modifiers": {"modifier", "modifiers", "mod"},
    "revenue_code": {"revcode", "revenuecode", "rev"},
}


class ParseError(ValueError):
    """Raised when input cannot be read as a bill at all."""


def _normalize_header(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _map_columns(fieldnames: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for raw in fieldnames:
        key = _normalize_header(raw)
        for field_name, aliases in _COLUMN_ALIASES.items():
            if key in aliases and field_name not in mapping:
                mapping[field_name] = raw
    return mapping


def parse_money(value: Any) -> Decimal | None:
    """Read a currency value. Parentheses mean negative, as on most statements."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value)).quantize(Decimal("0.01"))
    text = str(value).strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        amount = Decimal(cleaned).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    return -amount if negative else amount


def parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _parse_units(value: Any) -> int:
    if value in (None, ""):
        return 1
    try:
        units = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return 1
    return units if units > 0 else 1


def _parse_modifiers(value: Any) -> tuple[str, ...]:
    if not value:
        return ()
    if isinstance(value, (list, tuple)):
        parts = [str(v) for v in value]
    else:
        parts = re.split(r"[,\s/|]+", str(value))
    return tuple(p.strip().upper() for p in parts if p.strip())


def _clean_code(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip().upper()
    match = CODE_RE.search(text)
    return match.group(0) if match else (text or None)


def bill_from_rows(rows: list[dict[str, Any]], **context: Any) -> Bill:
    """Build a bill from already-normalized dict rows."""
    lines: list[LineItem] = []
    for row in rows:
        charge = parse_money(row.get("charge"))
        description = str(row.get("description") or "").strip()
        if charge is None and not description:
            continue
        if charge is None:
            continue
        lines.append(
            LineItem(
                index=len(lines) + 1,
                description=description or "(no description given)",
                charge=charge,
                code=_clean_code(row.get("code")),
                date_of_service=parse_date(row.get("date_of_service")),
                units=_parse_units(row.get("units")),
                modifiers=_parse_modifiers(row.get("modifiers")),
                revenue_code=(str(row["revenue_code"]).strip() or None)
                if row.get("revenue_code")
                else None,
            )
        )
    if not lines:
        raise ParseError("No charge lines found. Each line needs a description and an amount.")
    return _apply_context(Bill(lines=lines), context)


def _apply_context(bill: Bill, context: dict[str, Any]) -> Bill:
    """Attach the patient-supplied context that several rules depend on."""
    simple_text = (
        "patient_name",
        "provider_name",
        "account_number",
        "insurance_plan",
    )
    for key in simple_text:
        if context.get(key):
            setattr(bill, key, str(context[key]).strip())

    for key in ("statement_date", "admission_date", "discharge_date"):
        if context.get(key):
            setattr(bill, key, parse_date(context[key]))

    for key in ("total_charged", "patient_responsibility", "amount_paid"):
        if context.get(key) is not None:
            setattr(bill, key, parse_money(context[key]))

    if context.get("place_of_service"):
        try:
            bill.place_of_service = PlaceOfService(str(context["place_of_service"]).lower())
        except ValueError:
            bill.place_of_service = PlaceOfService.UNKNOWN

    for key, attr in (
        ("provider_network_status", "provider_network_status"),
        ("facility_network_status", "facility_network_status"),
    ):
        if context.get(key):
            try:
                setattr(bill, attr, NetworkStatus(str(context[key]).lower()))
            except ValueError:
                setattr(bill, attr, NetworkStatus.UNKNOWN)

    if "is_itemized" in context:
        bill.is_itemized = bool(context["is_itemized"])
    if "gave_written_consent_to_out_of_network" in context:
        bill.gave_written_consent_to_out_of_network = bool(
            context["gave_written_consent_to_out_of_network"]
        )
    return bill


def parse_csv(text: str, **context: Any) -> Bill:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ParseError("The CSV has no header row.")
    mapping = _map_columns(list(reader.fieldnames))
    if "charge" not in mapping:
        raise ParseError(
            "Could not find an amount column. Name it 'charge', 'amount', or 'billed'."
        )
    rows = [
        {field: row.get(source) for field, source in mapping.items()}
        for row in reader
        if any((value or "").strip() for value in row.values())
    ]
    return bill_from_rows(rows, **context)


def parse_json(text_or_obj: str | dict[str, Any], **context: Any) -> Bill:
    payload = json.loads(text_or_obj) if isinstance(text_or_obj, str) else text_or_obj
    if isinstance(payload, list):
        return bill_from_rows(payload, **context)
    if not isinstance(payload, dict):
        raise ParseError("Expected a JSON object or a list of charge lines.")
    rows = payload.get("lines") or payload.get("line_items") or []
    merged = {k: v for k, v in payload.items() if k not in {"lines", "line_items"}}
    merged.update(context)
    return bill_from_rows(list(rows), **merged)


def parse_pdf_text(text: str, **context: Any) -> Bill:
    """Pull charge lines out of raw statement text.

    We only accept a line when it ends in something that looks like money, and
    we take the *last* money-looking token as the charge, because statements
    routinely print unit price and total on the same row.
    """
    rows: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or len(line) < 6:
            continue
        amounts = MONEY_RE.findall(line)
        if not amounts:
            continue
        lowered = line.lower()
        if any(
            token in lowered
            for token in ("total", "balance due", "amount due", "subtotal", "payment", "insurance paid")
        ):
            continue
        charge = parse_money(amounts[-1])
        if charge is None or charge <= 0:
            continue
        remainder = line
        for amount in amounts:
            remainder = remainder.replace(amount, " ")
        code_match = CODE_RE.search(remainder)
        code = code_match.group(0) if code_match else None
        date_match = re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", remainder)
        if code:
            remainder = remainder.replace(code, " ", 1)
        if date_match:
            remainder = remainder.replace(date_match.group(0), " ", 1)
        description = re.sub(r"\s{2,}", " ", remainder).strip(" .-|")
        rows.append(
            {
                "description": description,
                "charge": charge,
                "code": code,
                "date_of_service": date_match.group(0) if date_match else None,
                "units": 1,
            }
        )
    if not rows:
        raise ParseError(
            "No charge lines could be read from this PDF. If it is a scanned image, "
            "the text has to be OCR'd first, or the lines entered by hand."
        )
    return bill_from_rows(rows, **context)


def parse_pdf(path: str | Path, **context: Any) -> Bill:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise ParseError("PDF support needs the 'pdf' extra: pip install 'billproof[pdf]'") from exc

    with pdfplumber.open(str(path)) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    return parse_pdf_text(text, **context)


def parse_file(path: str | Path, **context: Any) -> Bill:
    """Dispatch on file extension."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(path, **context)
    text = path.read_text()
    if suffix == ".json":
        return parse_json(text, **context)
    if suffix in {".csv", ".tsv", ".txt"}:
        return parse_csv(text, **context)
    raise ParseError(f"Unsupported file type: {suffix or path.name}")
