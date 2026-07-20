"""The autonomous paper-trading loop and a matching backtester.

Both share the same strategy, portfolio, and risk code, so a backtest and a
live paper run behave identically bar-for-bar.
"""

from __future__ import annotations

import logging
import signal
import time
from datetime import datetime, timezone
from typing import List, Sequence

from .config import Config
from .exchange import Candle, CoinbaseClient
from .portfolio import PaperPortfolio
from .risk import DailyLossGuard, ExitReason, RiskManager
from .strategy import MACrossoverStrategy, Signal


def _setup_logger(log_file: str) -> logging.Logger:
    logger = logging.getLogger("crypto-bot")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    fh = logging.FileHandler(log_file)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    return logger


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class TradingEngine:
    """Runs the strategy on a schedule against live market data (paper only)."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = CoinbaseClient(cfg.exchange.base_url, cfg.exchange.timeout)
        self.strategy = MACrossoverStrategy(cfg.strategy)
        self.risk = RiskManager(cfg.risk)
        self.guard = DailyLossGuard(cfg.risk.max_daily_loss_pct)
        self.logger = _setup_logger(cfg.state.log_file)

        self.portfolio = PaperPortfolio.load(cfg.state.file) or PaperPortfolio.new(
            cfg.portfolio.starting_cash,
            cfg.portfolio.fee_rate,
            cfg.portfolio.slippage,
        )
        self._running = False

    # -- one iteration -----------------------------------------------------
    def step(self) -> None:
        candles = self.client.get_candles(
            self.cfg.trading.product_id, self.cfg.trading.granularity
        )
        if len(candles) < self.strategy.min_bars:
            self.logger.info(
                "warming up: %d/%d bars", len(candles), self.strategy.min_bars
            )
            return

        closes = [c.close for c in candles]
        price = self.client.get_price(self.cfg.trading.product_id)
        ts = _utc_now_iso()

        equity = self.portfolio.equity(price)
        self.guard.update_day(_utc_date(), equity)

        # 1) Protective exits take priority over any strategy signal.
        if self.portfolio.has_position:
            exit_reason = self.risk.protective_exit(self.portfolio.entry_price, price)
            if exit_reason is not ExitReason.NONE:
                trade = self.portfolio.close_position(price, ts, exit_reason.value)
                self.logger.info(
                    "EXIT (%s) @ %.2f | equity=%.2f realized=%.2f",
                    exit_reason.value, trade.price, self.portfolio.equity(price),
                    self.portfolio.realized_pnl,
                )
                self._persist()
                return

        # 2) Strategy signal.
        reading = self.strategy.evaluate(closes)
        halted = self.guard.is_halted(equity)

        if reading.signal is Signal.BUY and not self.portfolio.has_position:
            if halted:
                self.logger.warning("BUY signal ignored: daily-loss halt active")
            else:
                usd = self.risk.position_size(equity)
                trade = self.portfolio.open_position(price, usd, ts, "signal")
                if trade:
                    self.logger.info(
                        "BUY @ %.2f | size=%.6f cost=%.2f fast=%.2f slow=%.2f",
                        trade.price, trade.base_amount, trade.usd_value,
                        reading.fast, reading.slow,
                    )
        elif reading.signal is Signal.SELL and self.portfolio.has_position:
            trade = self.portfolio.close_position(price, ts, "signal")
            self.logger.info(
                "SELL @ %.2f | equity=%.2f realized=%.2f",
                trade.price, self.portfolio.equity(price), self.portfolio.realized_pnl,
            )
        else:
            self.logger.info(
                "HOLD | price=%.2f equity=%.2f position=%s%s",
                price, equity, "yes" if self.portfolio.has_position else "flat",
                " [HALTED]" if halted else "",
            )

        self._persist()

    def _persist(self) -> None:
        self.portfolio.save(self.cfg.state.file)

    # -- loop --------------------------------------------------------------
    def run(self) -> None:
        self._running = True

        def _stop(signum, frame):  # noqa: ANN001
            self.logger.info("shutdown requested, finishing cleanly...")
            self._running = False

        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

        self.logger.info(
            "PAPER trading started | product=%s granularity=%ds strategy=%s(%d/%d) "
            "cash=%.2f",
            self.cfg.trading.product_id, self.cfg.trading.granularity,
            self.cfg.strategy.ma_type, self.cfg.strategy.fast_period,
            self.cfg.strategy.slow_period, self.portfolio.cash,
        )
        while self._running:
            try:
                self.step()
            except Exception as exc:  # keep the loop alive through transient errors
                self.logger.error("iteration failed: %s", exc)
            # Sleep in short slices so shutdown is responsive.
            for _ in range(self.cfg.trading.poll_interval):
                if not self._running:
                    break
                time.sleep(1)

        self.logger.info("stopped. final cash=%.2f realized_pnl=%.2f trades=%d",
                         self.portfolio.cash, self.portfolio.realized_pnl,
                         len(self.portfolio.trades))


# -- backtest ---------------------------------------------------------------
def run_backtest(cfg: Config, candles: Sequence[Candle]) -> dict:
    """Replay the same strategy + risk logic over historical candles.

    Steps the strategy bar-by-bar using each bar's close as the fill price, so
    the result is directly comparable to a live paper run.
    """
    strategy = MACrossoverStrategy(cfg.strategy)
    risk = RiskManager(cfg.risk)
    pf = PaperPortfolio.new(
        cfg.portfolio.starting_cash, cfg.portfolio.fee_rate, cfg.portfolio.slippage
    )

    closes: List[float] = []
    equity_curve: List[float] = []

    for c in candles:
        closes.append(c.close)
        price = c.close
        ts = datetime.fromtimestamp(c.time, tz=timezone.utc).isoformat()

        if pf.has_position:
            reason = risk.protective_exit(pf.entry_price, price)
            if reason is not ExitReason.NONE:
                pf.close_position(price, ts, reason.value)

        if len(closes) >= strategy.min_bars:
            reading = strategy.evaluate(closes)
            equity = pf.equity(price)
            if reading.signal is Signal.BUY and not pf.has_position:
                pf.open_position(price, risk.position_size(equity), ts, "signal")
            elif reading.signal is Signal.SELL and pf.has_position:
                pf.close_position(price, ts, "signal")

        equity_curve.append(pf.equity(price))

    # Close any still-open position at the last price for a clean final number.
    if pf.has_position and candles:
        pf.close_position(candles[-1].close, ts, "backtest_end")
        equity_curve[-1] = pf.cash

    return _summarize(cfg, pf, equity_curve)


def _summarize(cfg: Config, pf: PaperPortfolio, equity_curve: List[float]) -> dict:
    start = cfg.portfolio.starting_cash
    final = equity_curve[-1] if equity_curve else start
    total_return = (final - start) / start if start else 0.0

    # Max drawdown over the equity curve.
    peak = start
    max_dd = 0.0
    for e in equity_curve:
        peak = max(peak, e)
        if peak > 0:
            max_dd = max(max_dd, (peak - e) / peak)

    # Win rate over completed round-trips (each SELL closes a BUY).
    sells = [t for t in pf.trades if t.side == "SELL"]
    wins = 0
    buy_cost = None
    for t in pf.trades:
        if t.side == "BUY":
            buy_cost = t.usd_value
        elif t.side == "SELL" and buy_cost is not None:
            proceeds = t.usd_value - t.fee
            if proceeds > buy_cost:
                wins += 1
            buy_cost = None
    win_rate = wins / len(sells) if sells else 0.0

    # Per-trade log with round-trip P&L attached to each closing SELL.
    trade_log = []
    open_buy = None
    for t in pf.trades:
        row = {
            "time": t.timestamp,
            "side": t.side,
            "price": round(t.price, 2),
            "usd": round(t.usd_value, 2),
            "fee": round(t.fee, 2),
            "reason": t.reason,
            "pnl": None,
        }
        if t.side == "BUY":
            open_buy = t
        elif open_buy is not None:
            row["pnl"] = round((t.usd_value - t.fee) - open_buy.usd_value, 2)
            open_buy = None
        trade_log.append(row)

    return {
        "starting_cash": round(start, 2),
        "final_equity": round(final, 2),
        "total_return_pct": round(total_return * 100, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "num_trades": len(pf.trades),
        "round_trips": len(sells),
        "win_rate_pct": round(win_rate * 100, 2),
        "realized_pnl": round(pf.realized_pnl, 2),
        "trades": trade_log,
    }
