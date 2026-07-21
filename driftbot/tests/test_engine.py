"""Offline tests for the engine's bar-gated trading logic."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config import (  # noqa: E402
    Config, ExchangeConfig, PortfolioConfig, RiskConfig, StateConfig,
    StrategyConfig, TradingConfig,
)
from bot.engine import TradingEngine  # noqa: E402
from bot.exchange import Candle  # noqa: E402


def _engine():
    tmp = tempfile.mkdtemp()
    cfg = Config(
        exchange=ExchangeConfig(),
        trading=TradingConfig(product_id="SOL-USD", granularity=900),
        portfolio=PortfolioConfig(starting_cash=1000.0),
        strategy=StrategyConfig(),
        risk=RiskConfig(),
        state=StateConfig(file=os.path.join(tmp, "state.json"),
                          log_file=os.path.join(tmp, "bot.log")),
    )
    return TradingEngine(cfg)


def _candles(n, last_t):
    base = last_t - (n - 1) * 900
    return [Candle(base + i * 900, 10.0, 10.0, 10.0, 10.0, 5.0) for i in range(n)]


def test_trades_only_once_per_new_bar():
    eng = _engine()
    calls = []
    eng._trade = lambda *a, **k: calls.append(a)  # spy on trade decisions

    t = 1_700_000_000
    a = _candles(40, t)
    eng._maybe_trade(a, "ts", 1000.0, False, 10.0)   # first call = baseline only
    assert calls == []

    eng._maybe_trade(a, "ts", 1000.0, False, 10.0)   # same bar -> no decision
    assert calls == []

    b = _candles(40, t + 900)                        # a new bar has closed
    eng._maybe_trade(b, "ts", 1000.0, False, 10.0)
    assert len(calls) == 1                           # decided exactly once

    eng._maybe_trade(b, "ts", 1000.0, False, 10.0)   # still same latest bar
    assert len(calls) == 1                           # no extra decision
