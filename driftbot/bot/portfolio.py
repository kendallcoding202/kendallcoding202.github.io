"""Simulated (paper) portfolio.

Models a single long position at a time (the MA-crossover strategy is fully
in-or-out). Every fill pays a fee and suffers slippage so the simulation is
pessimistic rather than optimistic — better to under-promise here.

Nothing in this module talks to an exchange or moves real money.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional


@dataclass
class Trade:
    side: str          # "BUY" or "SELL"
    price: float       # effective fill price (after slippage)
    base_amount: float  # units of the base asset (e.g. BTC)
    usd_value: float   # gross USD value of the fill
    fee: float
    timestamp: str
    reason: str = ""   # what triggered it (signal / stop / take / halt)


@dataclass
class PaperPortfolio:
    starting_cash: float
    fee_rate: float
    slippage: float

    cash: float = 0.0
    base_amount: float = 0.0     # size of the open position (0 == flat)
    entry_price: float = 0.0     # effective entry price of the open position
    cost_basis: float = 0.0      # USD (incl. fees) spent to open the position
    realized_pnl: float = 0.0
    trades: List[Trade] = field(default_factory=list)

    @classmethod
    def new(cls, starting_cash: float, fee_rate: float, slippage: float) -> "PaperPortfolio":
        """Create a fresh portfolio with all cash and no position."""
        return cls(
            starting_cash=starting_cash,
            fee_rate=fee_rate,
            slippage=slippage,
            cash=starting_cash,
        )

    # -- queries -----------------------------------------------------------
    @property
    def has_position(self) -> bool:
        return self.base_amount > 0

    def equity(self, price: float) -> float:
        """Mark-to-market total account value at ``price``."""
        return self.cash + self.base_amount * price

    def unrealized_pnl(self, price: float) -> float:
        if not self.has_position:
            return 0.0
        # Value if we closed now (net of exit fee/slippage) minus what we paid.
        exit_price = price * (1 - self.slippage)
        gross = self.base_amount * exit_price
        fee = gross * self.fee_rate
        return (gross - fee) - self.cost_basis

    # -- mutations ---------------------------------------------------------
    def open_position(self, price: float, usd_to_deploy: float, timestamp: str,
                      reason: str = "signal") -> Optional[Trade]:
        """Open a long position by deploying ``usd_to_deploy`` of cash."""
        if self.has_position:
            return None
        usd_to_deploy = min(usd_to_deploy, self.cash)
        if usd_to_deploy <= 0:
            return None

        eff_price = price * (1 + self.slippage)
        fee = usd_to_deploy * self.fee_rate
        net_usd = usd_to_deploy - fee
        base = net_usd / eff_price

        self.cash -= usd_to_deploy
        self.base_amount = base
        self.entry_price = eff_price
        self.cost_basis = usd_to_deploy  # cash actually spent, fee included

        trade = Trade("BUY", eff_price, base, usd_to_deploy, fee, timestamp, reason)
        self.trades.append(trade)
        return trade

    def close_position(self, price: float, timestamp: str,
                       reason: str = "signal") -> Optional[Trade]:
        """Close the whole open position at ``price``."""
        if not self.has_position:
            return None

        eff_price = price * (1 - self.slippage)
        gross = self.base_amount * eff_price
        fee = gross * self.fee_rate
        proceeds = gross - fee

        self.realized_pnl += proceeds - self.cost_basis
        self.cash += proceeds

        trade = Trade("SELL", eff_price, self.base_amount, gross, fee, timestamp, reason)
        self.trades.append(trade)

        self.base_amount = 0.0
        self.entry_price = 0.0
        self.cost_basis = 0.0
        return trade

    # -- persistence -------------------------------------------------------
    def to_dict(self) -> dict:
        d = asdict(self)
        d["trades"] = [asdict(t) for t in self.trades]
        return d

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> Optional["PaperPortfolio"]:
        path = Path(path)
        if not path.exists():
            return None
        raw = json.loads(path.read_text())
        trades = [Trade(**t) for t in raw.pop("trades", [])]
        pf = cls(**raw)
        pf.trades = trades
        return pf
