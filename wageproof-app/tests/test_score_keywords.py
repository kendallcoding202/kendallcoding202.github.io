"""The scoring script — the maths behind the go/no-go call."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("score", ROOT / "scripts" / "score_keywords.py")
assert SPEC and SPEC.loader
score = importlib.util.module_from_spec(SPEC)
# Registered before exec because @dataclass resolves annotations through
# sys.modules, and the script is loaded by path rather than imported normally.
sys.modules["score"] = score
SPEC.loader.exec_module(score)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("10", 10),
        ("1K", 1000),
        ("1k", 1000),
        ("10,000", 10000),
        ("1M", 1_000_000),
        ("", None),
        ("  ", None),
        ("n/a", None),
        ("nonsense", None),
    ],
)
def test_volume_parsing(raw: str, expected: float | None) -> None:
    assert score.parse_volume(raw) == expected


def test_ranges_use_the_geometric_mean() -> None:
    """'100-1K' spans an order of magnitude; its honest centre is 316, not 550."""
    assert score.parse_volume("100-1K") == pytest.approx(316.2, rel=0.01)
    assert score.parse_volume("1K - 10K") == pytest.approx(3162.3, rel=0.01)


def test_range_starting_at_zero_does_not_collapse() -> None:
    assert score.parse_volume("0-100") == 50


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("$4.50", 4.5), ("12", 12.0), ("1,200", 1200.0), ("", None), ("0", None), ("x", None)],
)
def test_money_parsing(raw: str, expected: float | None) -> None:
    assert score.parse_money(raw) == expected


def write(tmp_path: Path, rows: str) -> Path:
    path = tmp_path / "w.csv"
    path.write_text("tier,keyword,avg_monthly_searches,competition,bid_low,bid_high\n" + rows)
    return path


def test_blended_cpc_is_weighted_by_volume(tmp_path: Path) -> None:
    """A pricey term nobody searches must not drag the average."""
    rows = write(
        tmp_path,
        "1,cheap and popular,10K,Low,2,4\n1,dear and obscure,10,High,40,60\n",
    )
    cpc = score.blended_cpc(score.load(rows))
    assert cpc == pytest.approx(3.0, abs=0.15)


def test_terms_with_a_bid_but_no_volume_still_count(tmp_path: Path) -> None:
    rows = write(tmp_path, "1,long tail,,Low,3,5\n")
    assert score.blended_cpc(score.load(rows)) == pytest.approx(4.0)


def test_rows_without_bids_are_skipped(tmp_path: Path) -> None:
    rows = write(tmp_path, "1,no bid,1K,Low,,\n1,priced,1K,Low,6,8\n")
    assert score.blended_cpc(score.load(rows)) == pytest.approx(7.0)


def test_blank_and_malformed_rows_are_ignored(tmp_path: Path) -> None:
    rows = write(
        tmp_path,
        "1,,,,,\n,no tier,1K,Low,2,3\nx,bad tier,1K,Low,2,3\n1,good,1K,Low,4,6\n",
    )
    loaded = score.load(rows)
    assert [r.keyword for r in loaded] == ["good"]


def run(path: Path, capsys) -> tuple[int, str]:
    code = score.main(["score_keywords.py", str(path)])
    return code, capsys.readouterr().out


def test_healthy_market_and_cheap_clicks_proceeds(tmp_path: Path, capsys) -> None:
    rows = write(
        tmp_path,
        "2,category a,10K,High,20,30\n2,category b,10K,High,20,30\n1,trigger,1K,Low,3,5\n",
    )
    code, out = run(rows, capsys)
    assert code == 0
    assert "PROCEED" in out


def test_thin_market_stops_even_when_clicks_are_cheap(tmp_path: Path, capsys) -> None:
    rows = write(tmp_path, "2,category,100,Low,1,2\n1,trigger,10,Low,1,2\n")
    code, out = run(rows, capsys)
    assert code == 1
    assert "STOP" in out
    assert "do not search" in out


def test_expensive_clicks_redirect_to_the_channel_not_the_product(
    tmp_path: Path, capsys
) -> None:
    rows = write(tmp_path, "2,category,10K,High,40,60\n1,trigger,1K,High,40,60\n")
    code, out = run(rows, capsys)
    assert code == 1
    assert "RECONSIDER THE CHANNEL" in out
    assert "product is not the problem" in out


def test_required_completion_rate_is_reported(tmp_path: Path, capsys) -> None:
    """$5 clicks against a $25 target means one click in five must complete."""
    rows = write(tmp_path, "2,category,10K,High,5,5\n1,trigger,1K,Low,5,5\n")
    _, out = run(rows, capsys)
    assert "20% of clicks" in out


def test_sparse_tier_1_prints_the_long_tail_caveat(tmp_path: Path, capsys) -> None:
    rows = write(
        tmp_path,
        "2,category,10K,High,20,30\n"
        "1,a,,Low,3,5\n1,b,,Low,3,5\n1,c,,Low,3,5\n1,d,,Low,3,5\n",
    )
    _, out = run(rows, capsys)
    assert "suppresses long-tail" in out


def test_empty_worksheet_asks_for_input(tmp_path: Path, capsys) -> None:
    rows = write(tmp_path, "1,unfilled,,,,\n")
    code, out = run(rows, capsys)
    assert code == 2
    assert "Nothing recorded yet" in out


def test_missing_bids_cannot_be_scored(tmp_path: Path, capsys) -> None:
    rows = write(tmp_path, "2,category,10K,High,,\n")
    code, out = run(rows, capsys)
    assert code == 2
    assert "without bid ranges" in out


def test_missing_file_is_reported(capsys) -> None:
    code = score.main(["score_keywords.py", "/nope/missing.csv"])
    assert code == 2
    assert "No worksheet" in capsys.readouterr().out


def test_the_shipped_worksheet_parses_and_is_empty(capsys) -> None:
    """The blank worksheet should load cleanly and ask to be filled in."""
    code, out = run(ROOT / "docs" / "keyword-worksheet.csv", capsys)
    assert code == 2
    assert "Nothing recorded yet" in out
