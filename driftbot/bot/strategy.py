"""MA-crossover trading strategy.

Signal logic:
  * BUY  when the fast MA crosses from at-or-below to above the slow MA.
  * SELL when the fast MA crosses from at-or-above to below the slow MA.
  * HOLD otherwise (including while there isn't enough history yet).

The strategy is stateless: it looks only at the current window of closes and
the crossover that occurred on the most recent bar.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Sequence

from .config import StrategyConfig
from .indicators import moving_average, rsi


class Signal(enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class StrategyReading:
    signal: Signal
    fast: float | None
    slow: float | None
    rsi: float | None = None
    rsi_blocked: bool = False  # True when a BUY cross was filtered out by RSI


class MACrossoverStrategy:
    def __init__(self, cfg: StrategyConfig):
        self.cfg = cfg

    @property
    def min_bars(self) -> int:
        # Need the slow MA plus one prior bar to detect a crossover, and enough
        # history for RSI if the filter is on.
        bars = self.cfg.slow_period + 1
        if self.cfg.use_rsi_filter:
            bars = max(bars, self.cfg.rsi_period + 1)
        return bars

    def evaluate(self, closes: Sequence[float]) -> StrategyReading:
        fast = moving_average(closes, self.cfg.fast_period, self.cfg.ma_type)
        slow = moving_average(closes, self.cfg.slow_period, self.cfg.ma_type)

        current_rsi = None
        if self.cfg.use_rsi_filter:
            rsi_series = rsi(closes, self.cfg.rsi_period)
            if rsi_series:
                current_rsi = rsi_series[-1]

        # Align the two MA series to a common tail (fast starts earlier because
        # it has a shorter warm-up).
        n = min(len(fast), len(slow))
        if n < 2:
            return StrategyReading(Signal.HOLD, None, None, current_rsi)
        fast = fast[-n:]
        slow = slow[-n:]

        prev_diff = fast[-2] - slow[-2]
        curr_diff = fast[-1] - slow[-1]

        rsi_blocked = False
        if prev_diff <= 0 < curr_diff:
            signal = Signal.BUY
            # RSI must confirm: bullish momentum, but not already overbought.
            if self.cfg.use_rsi_filter:
                confirmed = (
                    current_rsi is not None
                    and self.cfg.rsi_buy_min <= current_rsi <= self.cfg.rsi_buy_max
                )
                if not confirmed:
                    signal = Signal.HOLD
                    rsi_blocked = True
        elif prev_diff >= 0 > curr_diff:
            signal = Signal.SELL
        else:
            signal = Signal.HOLD

        return StrategyReading(signal, fast[-1], slow[-1], current_rsi, rsi_blocked)
