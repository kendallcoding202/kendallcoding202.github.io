#!/usr/bin/env python3
"""Turn a filled-in Keyword Planner worksheet into a go/no-go verdict.

    python3 scripts/score_keywords.py docs/keyword-worksheet.csv

Two independent tests, both of which must pass. See docs/keyword-check.md.

1. **Is there a market?** Tier 2 combined monthly volume, because those are the
   only terms Keyword Planner measures reliably.
2. **Can we afford the door?** Rather than inventing a conversion rate nobody
   has yet, this inverts the question: given Tier 1 click costs, what share of
   clicks would have to finish a free check to hit $25 per completed check?
"""

from __future__ import annotations

import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# From docs/ads.md: the pass mark for the $1,000 test.
TARGET_COST_PER_COMPLETED_CHECK = 25.0

# Judgment, not measurement. A paste-your-payroll tool asks more of a visitor
# than an email box does, so beating 30% would be a good day.
COMPLETION_ACHIEVABLE = 0.25
COMPLETION_IMPLAUSIBLE = 0.40

VOLUME_FLOOR = 1_000
VOLUME_HEALTHY = 5_000

SUFFIXES = {"k": 1_000, "m": 1_000_000}


@dataclass
class Row:
    tier: int
    keyword: str
    volume: float | None
    competition: str
    bid_low: float | None
    bid_high: float | None

    @property
    def has_volume(self) -> bool:
        return self.volume is not None and self.volume > 0


def parse_volume(raw: str) -> float | None:
    """Read Keyword Planner's ranges: '100-1K', '1K - 10K', '10', ''.

    A range is represented by its geometric mean rather than its midpoint.
    '100-1K' spans an order of magnitude; the arithmetic midpoint of 550 implies
    far more precision than Google is giving us, and consistently flatters the
    low end. The geometric mean (316) is the honest centre of a log-scale bucket.
    """
    text = (raw or "").strip().lower().replace(",", "").replace(" ", "")
    if not text or text in {"-", "n/a", "none", "nodata"}:
        return None

    def one(token: str) -> float | None:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)([km]?)", token)
        if not match:
            return None
        return float(match.group(1)) * SUFFIXES.get(match.group(2), 1)

    if "-" in text:
        low_text, _, high_text = text.partition("-")
        low, high = one(low_text), one(high_text)
        if low is None or high is None:
            return None
        if low <= 0:
            return high / 2
        return (low * high) ** 0.5

    return one(text)


def parse_money(raw: str) -> float | None:
    text = (raw or "").strip().replace("$", "").replace(",", "")
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def load(path: Path) -> list[Row]:
    rows: list[Row] = []
    with path.open() as handle:
        for record in csv.DictReader(handle):
            # A row with no tier is skipped rather than defaulted. Defaulting
            # would quietly add it to the "filled in" count while contributing
            # to no test, which reads as progress that is not there.
            raw_tier = (record.get("tier") or "").strip()
            if not raw_tier:
                continue
            try:
                tier = int(raw_tier)
            except ValueError:
                continue
            keyword = (record.get("keyword") or "").strip()
            if not keyword:
                continue
            rows.append(
                Row(
                    tier=tier,
                    keyword=keyword,
                    volume=parse_volume(record.get("avg_monthly_searches", "")),
                    competition=(record.get("competition") or "").strip() or "—",
                    bid_low=parse_money(record.get("bid_low", "")),
                    bid_high=parse_money(record.get("bid_high", "")),
                )
            )
    return rows


def blended_cpc(rows: list[Row]) -> float | None:
    """Volume-weighted cost per click, using the midpoint of each bid range.

    Weighting by volume matters: one expensive term nobody searches should not
    drag the estimate around. Terms with a bid but no reported volume still
    count, at weight 1, so a thin-but-priced Tier 1 is not silently ignored.
    """
    total_weight = 0.0
    total_cost = 0.0
    for row in rows:
        bids = [b for b in (row.bid_low, row.bid_high) if b is not None]
        if not bids:
            continue
        cpc = sum(bids) / len(bids)
        weight = row.volume if row.has_volume else 1.0
        total_cost += cpc * weight
        total_weight += weight
    return total_cost / total_weight if total_weight else None


def bar(label: str, value: str) -> str:
    return f"  {label:<34}{value}"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2

    path = Path(argv[1])
    if not path.is_file():
        print(f"No worksheet at {path}")
        return 2

    rows = load(path)
    if not rows:
        print(f"{path} has no keyword rows.")
        return 2

    tier1 = [r for r in rows if r.tier == 1]
    tier2 = [r for r in rows if r.tier == 2]
    filled = [r for r in rows if r.has_volume or r.bid_low or r.bid_high]

    print(f"\nWorksheet: {path}")
    print(f"{len(filled)} of {len(rows)} rows filled in.\n")

    if not filled:
        print("Nothing recorded yet. Fill the worksheet in first — see")
        print("docs/keyword-check.md.")
        return 2

    # --- Test 1: is there a market? -------------------------------------
    tier2_volume = sum(r.volume for r in tier2 if r.has_volume)
    print("TEST 1 — is there a market?")
    print(bar("Tier 2 combined volume/month", f"{tier2_volume:,.0f}"))

    if tier2_volume < VOLUME_FLOOR:
        volume_verdict, volume_pass = "TOO THIN — ads cannot carry this", False
    elif tier2_volume < VOLUME_HEALTHY:
        volume_verdict, volume_pass = "TIGHT — real, but ads alone is a stretch", True
    else:
        volume_verdict, volume_pass = "HEALTHY", True
    print(bar("Verdict", volume_verdict))

    # --- Test 2: can we afford the door? --------------------------------
    print("\nTEST 2 — can we afford the door?")
    cpc = blended_cpc(tier1) or blended_cpc(rows)
    if cpc is None:
        print(bar("Blended Tier 1 cost per click", "no bid data recorded"))
        print("\nCannot score the cost test without bid ranges. Record")
        print("'Top of page bid' for at least a few Tier 1 terms.")
        return 2

    required = cpc / TARGET_COST_PER_COMPLETED_CHECK
    print(bar("Blended Tier 1 cost per click", f"${cpc:,.2f}"))
    print(
        bar(
            "Completion rate needed for $25",
            f"{required * 100:.0f}% of clicks must finish a check",
        )
    )

    if required <= COMPLETION_ACHIEVABLE:
        cost_verdict, cost_pass = "ACHIEVABLE", True
    elif required <= COMPLETION_IMPLAUSIBLE:
        cost_verdict, cost_pass = "DEMANDING — one careful test only", True
    else:
        cost_verdict, cost_pass = "NOT REALISTIC — clicks cost too much", False
    print(bar("Verdict", cost_verdict))

    tier1_measured = sum(1 for r in tier1 if r.has_volume)
    if tier1 and tier1_measured <= len(tier1) // 3:
        print(
            "\n  Note: most Tier 1 terms show little or no volume. That is "
            "expected —\n  Keyword Planner suppresses long-tail queries. Judge "
            "the market on\n  Tier 2 (Test 1), not on this."
        )

    # --- Overall ---------------------------------------------------------
    print("\n" + "=" * 62)
    if volume_pass and cost_pass:
        print("PROCEED — run the $1,000 Tier 1 campaign in docs/ads.md.")
        print("The product and the funnel instrumentation are already built.")
        result = 0
    elif not volume_pass:
        print("STOP — these contractors do not search in the numbers needed.")
        print("The afternoon just saved you a month. Record it and move on.")
        result = 1
    else:
        print("RECONSIDER THE CHANNEL — the market is real but paid search is")
        print("too expensive to be the way in. The product is not the problem.")
        result = 1
    print("=" * 62 + "\n")
    return result


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
