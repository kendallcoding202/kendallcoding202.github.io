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
from .indicators import moving_average


class Signal(enum.Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


@dataclass
class StrategyReading:
    signal: Signal
    fast: float | None
    slow: float | None


class MACrossoverStrategy:
    def __init__(self, cfg: StrategyConfig):
        self.cfg = cfg

    @property
    def min_bars(self) -> int:
        # Need the slow MA plus one prior bar to detect a crossover.
        return self.cfg.slow_period + 1

    def evaluate(self, closes: Sequence[float]) -> StrategyReading:
        fast = moving_average(closes, self.cfg.fast_period, self.cfg.ma_type)
        slow = moving_average(closes, self.cfg.slow_period, self.cfg.ma_type)

        # Align the two series to a common tail (fast starts earlier because
        # it has a shorter warm-up).
        n = min(len(fast), len(slow))
        if n < 2:
            return StrategyReading(Signal.HOLD, None, None)
        fast = fast[-n:]
        slow = slow[-n:]

        prev_diff = fast[-2] - slow[-2]
        curr_diff = fast[-1] - slow[-1]

        if prev_diff <= 0 < curr_diff:
            signal = Signal.BUY
        elif prev_diff >= 0 > curr_diff:
            signal = Signal.SELL
        else:
            signal = Signal.HOLD

        return StrategyReading(signal, fast[-1], slow[-1])
