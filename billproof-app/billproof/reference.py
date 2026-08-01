"""Loads the reference tables the rules consult.

Everything shipped in ``billproof/data`` is sample data. Real deployments point
``BILLPROOF_DATA_DIR`` at a directory holding the published CMS files, and the
loader prefers those. When we fall back to the samples we say so, all the way
through to the report, so nobody quotes a placeholder number at a hospital.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

BUILTIN_DATA_DIR = Path(__file__).parent / "data"
DATA_DIR_ENV = "BILLPROOF_DATA_DIR"

_FILES = {
    "bundling": "bundling.json",
    "unit_limits": "unit_limits.json",
    "coding": "coding.json",
}
_PRICE_FILES = ("reference_prices.json", "reference_prices.sample.json")


def _override_dir() -> Path | None:
    raw = os.environ.get(DATA_DIR_ENV)
    if not raw:
        return None
    path = Path(raw).expanduser()
    return path if path.is_dir() else None


def _load(filename: str) -> dict[str, Any]:
    override = _override_dir()
    if override and (override / filename).is_file():
        return json.loads((override / filename).read_text())
    return json.loads((BUILTIN_DATA_DIR / filename).read_text())


@dataclass(frozen=True)
class Panel:
    comprehensive: str
    name: str
    components: frozenset[str]


@dataclass(frozen=True)
class ExclusivePair:
    codes: frozenset[str]
    reason: str


@dataclass(frozen=True)
class IncidentalRule:
    primary: str
    incidental_to: frozenset[str]
    reason: str
    max_per_day: int


@dataclass(frozen=True)
class EMLadder:
    setting: str
    levels: tuple[str, ...]
    top_level_note: str

    @property
    def top_level(self) -> str:
        return self.levels[-1]


@dataclass
class ReferenceData:
    panels: list[Panel] = field(default_factory=list)
    mutually_exclusive: list[ExclusivePair] = field(default_factory=list)
    incidental: list[IncidentalRule] = field(default_factory=list)
    unit_limits: dict[str, int] = field(default_factory=dict)
    em_ladders: list[EMLadder] = field(default_factory=list)
    preventive_services: dict[str, str] = field(default_factory=dict)
    emergency_codes: frozenset[str] = frozenset()
    ancillary_codes: frozenset[str] = frozenset()
    ancillary_keywords: tuple[str, ...] = ()
    prices: dict[str, Decimal] = field(default_factory=dict)
    prices_are_sample: bool = True
    price_basis: str = "illustrative"

    def unit_limit(self, code: str | None) -> int | None:
        return self.unit_limits.get(code) if code else None

    def price(self, code: str | None) -> Decimal | None:
        return self.prices.get(code) if code else None

    def ladder_for(self, code: str | None) -> EMLadder | None:
        if not code:
            return None
        return next((ladder for ladder in self.em_ladders if code in ladder.levels), None)

    def is_preventive(self, code: str | None) -> bool:
        return bool(code) and code in self.preventive_services

    def is_ancillary(self, code: str | None, description: str) -> bool:
        if code and code in self.ancillary_codes:
            return True
        lowered = description.lower()
        return any(keyword in lowered for keyword in self.ancillary_keywords)


def _load_prices() -> tuple[dict[str, Decimal], bool, str]:
    override = _override_dir()
    search_dirs = [override, BUILTIN_DATA_DIR] if override else [BUILTIN_DATA_DIR]
    for directory in search_dirs:
        for filename in _PRICE_FILES:
            path = directory / filename
            if not path.is_file():
                continue
            raw = json.loads(path.read_text())
            meta = raw.get("_meta", {})
            basis = meta.get("basis", "unknown")
            is_sample = basis == "illustrative" or filename.endswith(".sample.json")
            prices = {
                code: Decimal(str(value)) for code, value in raw.get("prices", {}).items()
            }
            return prices, is_sample, basis
    return {}, True, "missing"


@lru_cache(maxsize=1)
def load_reference_data() -> ReferenceData:
    bundling = _load(_FILES["bundling"])
    unit_limits_raw = _load(_FILES["unit_limits"])
    coding = _load(_FILES["coding"])
    prices, prices_are_sample, basis = _load_prices()

    ancillary = coding.get("ancillary_specialties", {})

    return ReferenceData(
        panels=[
            Panel(
                comprehensive=p["comprehensive"],
                name=p["name"],
                components=frozenset(p["components"]),
            )
            for p in bundling.get("panels", [])
        ],
        mutually_exclusive=[
            ExclusivePair(codes=frozenset(pair["codes"]), reason=pair["reason"])
            for pair in bundling.get("mutually_exclusive", [])
        ],
        incidental=[
            IncidentalRule(
                primary=rule["primary"],
                incidental_to=frozenset(rule["incidental_to_any_of"]),
                reason=rule["reason"],
                max_per_day=int(rule.get("max_per_day", 1)),
            )
            for rule in bundling.get("incidental", [])
        ],
        unit_limits={code: int(limit) for code, limit in unit_limits_raw.get("limits", {}).items()},
        em_ladders=[
            EMLadder(
                setting=ladder["setting"],
                levels=tuple(ladder["levels"]),
                top_level_note=ladder["top_level_note"],
            )
            for ladder in coding.get("em_ladders", [])
        ],
        preventive_services=coding.get("preventive_services", {}),
        emergency_codes=frozenset(coding.get("emergency_codes", [])),
        ancillary_codes=frozenset(ancillary.get("codes", [])),
        ancillary_keywords=tuple(ancillary.get("keywords", [])),
        prices=prices,
        prices_are_sample=prices_are_sample,
        price_basis=basis,
    )
