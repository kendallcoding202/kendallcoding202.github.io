"""Risk management: position sizing, protective exits, and a daily-loss halt.

These controls run on *every* iteration and can override the strategy. In
particular, the stop-loss / take-profit and the daily-loss circuit breaker are
what keep a single bad run from quietly draining the (simulated) account.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

from .config import RiskConfig


class ExitReason(enum.Enum):
    NONE = "none"
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"


@dataclass
class RiskManager:
    cfg: RiskConfig

    def position_size(self, equity: float) -> float:
        """USD to deploy on a new entry, sized as a fraction of equity."""
        return equity * self.cfg.position_pct

    def protective_exit(self, entry_price: float, current_price: float) -> ExitReason:
        """Check stop-loss / take-profit against a long position's entry."""
        if entry_price <= 0:
            return ExitReason.NONE
        change = (current_price - entry_price) / entry_price
        if change <= -self.cfg.stop_loss_pct:
            return ExitReason.STOP_LOSS
        if change >= self.cfg.take_profit_pct:
            return ExitReason.TAKE_PROFIT
        return ExitReason.NONE


class DailyLossGuard:
    """Circuit breaker that halts new entries after too large a daily drawdown.

    The reference equity resets when the calendar day (UTC) rolls over.
    """

    def __init__(self, max_daily_loss_pct: float):
        self.max_daily_loss_pct = max_daily_loss_pct
        self.day: str | None = None
        self.day_start_equity: float | None = None

    def update_day(self, utc_date: str, equity: float) -> None:
        if self.day != utc_date:
            self.day = utc_date
            self.day_start_equity = equity

    def is_halted(self, equity: float) -> bool:
        if self.day_start_equity is None or self.day_start_equity <= 0:
            return False
        drawdown = (self.day_start_equity - equity) / self.day_start_equity
        return drawdown >= self.max_daily_loss_pct
