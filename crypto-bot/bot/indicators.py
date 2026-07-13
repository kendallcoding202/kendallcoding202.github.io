"""Moving-average indicators.

Both functions return a list that is SHORTER than the input: the first
``period - 1`` bars don't have enough history to produce a value, so the
returned series is aligned to the *end* of the input (the last element of the
output corresponds to the last element of the input).
"""

from __future__ import annotations

from typing import List, Sequence


def sma(values: Sequence[float], period: int) -> List[float]:
    """Simple moving average with a rolling window of ``period``."""
    if period < 1:
        raise ValueError("period must be >= 1")
    if len(values) < period:
        return []
    out: List[float] = []
    window_sum = sum(values[:period])
    out.append(window_sum / period)
    for i in range(period, len(values)):
        window_sum += values[i] - values[i - period]
        out.append(window_sum / period)
    return out


def ema(values: Sequence[float], period: int) -> List[float]:
    """Exponential moving average, seeded with the SMA of the first window."""
    if period < 1:
        raise ValueError("period must be >= 1")
    if len(values) < period:
        return []
    k = 2.0 / (period + 1)
    seed = sum(values[:period]) / period
    out: List[float] = [seed]
    for price in values[period:]:
        out.append(price * k + out[-1] * (1 - k))
    return out


def moving_average(values: Sequence[float], period: int, kind: str) -> List[float]:
    """Dispatch to ``sma`` or ``ema`` by name."""
    if kind == "sma":
        return sma(values, period)
    if kind == "ema":
        return ema(values, period)
    raise ValueError(f"unknown moving-average type: {kind!r}")
