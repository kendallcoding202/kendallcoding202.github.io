"""Unit tests for indicators, strategy, and the paper portfolio."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import PortfolioConfig, StrategyConfig  # noqa: E402
from bot.indicators import ema, sma  # noqa: E402
from bot.portfolio import PaperPortfolio  # noqa: E402
from bot.strategy import MACrossoverStrategy, Signal  # noqa: E402


# -- indicators -------------------------------------------------------------
def test_sma_basic():
    assert sma([1, 2, 3, 4, 5], 3) == [2.0, 3.0, 4.0]


def test_sma_too_short():
    assert sma([1, 2], 3) == []


def test_ema_length_and_seed():
    out = ema([1, 2, 3, 4, 5], 3)
    # length = len - period + 1; first value is SMA of the first window.
    assert len(out) == 3
    assert out[0] == 2.0


# -- strategy ---------------------------------------------------------------
def _strategy():
    return MACrossoverStrategy(StrategyConfig(ma_type="sma", fast_period=2, slow_period=4))


def test_hold_when_warming_up():
    assert _strategy().evaluate([1, 2, 3]).signal is Signal.HOLD


def test_buy_on_upward_cross():
    # Flat, then a jump on the final bar pulls the fast SMA above the slow SMA.
    closes = [10, 10, 10, 10, 10, 10, 30]
    assert _strategy().evaluate(closes).signal is Signal.BUY


def test_sell_on_downward_cross():
    # Flat, then a drop on the final bar pushes the fast SMA below the slow SMA.
    closes = [10, 10, 10, 10, 10, 10, 2]
    assert _strategy().evaluate(closes).signal is Signal.SELL


def test_hold_after_cross_already_happened():
    # Once crossed and holding above, subsequent bars are HOLD, not repeated BUYs.
    closes = [10, 10, 10, 10, 10, 10, 30, 31, 32]
    assert _strategy().evaluate(closes).signal is Signal.HOLD


# -- portfolio --------------------------------------------------------------
def test_open_and_close_roundtrip_profit():
    pf = PaperPortfolio.new(1000.0, fee_rate=0.0, slippage=0.0)
    pf.open_position(100.0, 500.0, "t0")
    assert pf.has_position
    assert pf.cash == 500.0
    assert pf.base_amount == 5.0  # 500 / 100

    pf.close_position(120.0, "t1")
    assert not pf.has_position
    # 5 units sold at 120 = 600 proceeds; cost basis was 500 -> +100 realized.
    assert round(pf.realized_pnl, 6) == 100.0
    assert round(pf.cash, 6) == 1100.0


def test_fees_and_slippage_reduce_returns():
    pf = PaperPortfolio.new(1000.0, fee_rate=0.006, slippage=0.0005)
    pf.open_position(100.0, 500.0, "t0")
    pf.close_position(100.0, "t1")  # flat price -> should lose to costs
    assert pf.realized_pnl < 0


def test_no_double_open():
    pf = PaperPortfolio.new(1000.0, fee_rate=0.0, slippage=0.0)
    pf.open_position(100.0, 500.0, "t0")
    assert pf.open_position(100.0, 500.0, "t1") is None
    assert pf.cash == 500.0


def test_config_defaults_align():
    # Sanity: default portfolio config is usable to build a portfolio.
    pc = PortfolioConfig()
    pf = PaperPortfolio.new(pc.starting_cash, pc.fee_rate, pc.slippage)
    assert pf.cash == pc.starting_cash
