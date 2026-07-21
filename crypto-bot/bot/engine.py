"""The autonomous paper-trading loop and a matching backtester.

Both share the same strategy, portfolio, and risk code, so a backtest and a
live paper run behave identically bar-for-bar.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from datetime import datetime, timezone
from typing import List, Optional, Sequence

from .config import Config
from .exchange import Candle, CoinbaseClient
from .indicators import moving_average, rsi
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

        # Latest state for the dashboard, published each step under a lock so
        # the HTTP server thread reads a consistent snapshot.
        self._snap_lock = threading.Lock()
        self._snapshot: Optional[dict] = None

    # -- one iteration -----------------------------------------------------
    def step(self) -> None:
        candles = self.client.get_candles(
            self.cfg.trading.product_id, self.cfg.trading.granularity
        )
        closes = [c.close for c in candles]
        price = self.client.get_price(self.cfg.trading.product_id)
        ts = _utc_now_iso()

        reading = self.strategy.evaluate(closes)
        equity = self.portfolio.equity(price)
        self.guard.update_day(_utc_date(), equity)
        halted = self.guard.is_halted(equity)
        rsi_txt = "n/a" if reading.rsi is None else f"{reading.rsi:.1f}"

        if len(candles) < self.strategy.min_bars:
            self.logger.info(
                "warming up: %d/%d bars", len(candles), self.strategy.min_bars
            )
        else:
            self._trade(reading, price, ts, equity, halted, rsi_txt)

        self._update_snapshot(candles, price, reading, halted)
        self._persist()

    def _trade(self, reading, price, ts, equity, halted, rsi_txt) -> None:
        # Protective exits take priority; if we stop/take out this bar, do not
        # also act on the strategy signal in the same bar.
        if self.portfolio.has_position:
            exit_reason = self.risk.protective_exit(self.portfolio.entry_price, price)
            if exit_reason is not ExitReason.NONE:
                trade = self.portfolio.close_position(price, ts, exit_reason.value)
                self.logger.info(
                    "EXIT (%s) @ %.2f | equity=%.2f realized=%.2f",
                    exit_reason.value, trade.price, self.portfolio.equity(price),
                    self.portfolio.realized_pnl,
                )
                return

        if reading.signal is Signal.BUY and not self.portfolio.has_position:
            if halted:
                self.logger.warning("BUY signal ignored: daily-loss halt active")
            else:
                usd = self.risk.position_size(equity)
                trade = self.portfolio.open_position(price, usd, ts, "signal")
                if trade:
                    self.logger.info(
                        "BUY @ %.2f | size=%.6f cost=%.2f fast=%.2f slow=%.2f rsi=%s",
                        trade.price, trade.base_amount, trade.usd_value,
                        reading.fast, reading.slow, rsi_txt,
                    )
        elif reading.signal is Signal.SELL and self.portfolio.has_position:
            trade = self.portfolio.close_position(price, ts, "signal")
            self.logger.info(
                "SELL @ %.2f | equity=%.2f realized=%.2f",
                trade.price, self.portfolio.equity(price), self.portfolio.realized_pnl,
            )
        elif reading.rsi_blocked:
            self.logger.info(
                "BUY cross skipped: RSI %s outside [%.0f, %.0f] | price=%.2f",
                rsi_txt, self.cfg.strategy.rsi_buy_min,
                self.cfg.strategy.rsi_buy_max, price,
            )
        else:
            self.logger.info(
                "HOLD | price=%.2f equity=%.2f rsi=%s position=%s%s",
                price, equity, rsi_txt,
                "yes" if self.portfolio.has_position else "flat",
                " [HALTED]" if halted else "",
            )

    def _persist(self) -> None:
        self.portfolio.save(self.cfg.state.file)

    # -- dashboard snapshot ------------------------------------------------
    def _update_snapshot(self, candles: Sequence[Candle], price: float,
                         reading, halted: bool, limit: int = 200) -> None:
        closes = [c.close for c in candles]
        s = self.cfg.strategy
        fast = moving_average(closes, s.fast_period, s.ma_type)
        slow = moving_average(closes, s.slow_period, s.ma_type)
        rsi_series = rsi(closes, s.rsi_period) if s.use_rsi_filter else []

        def pad(series):
            # Left-pad shorter indicator series with None so they align to closes.
            return [None] * (len(closes) - len(series)) + list(series)

        pf = self.portfolio
        snapshot = {
            "product": self.cfg.trading.product_id,
            "granularity": self.cfg.trading.granularity,
            "signal": reading.signal.value,
            "halted": halted,
            "warming_up": len(candles) < self.strategy.min_bars,
            "price": price,
            "ema_fast": reading.fast,
            "ema_slow": reading.slow,
            "rsi": reading.rsi,
            "rsi_blocked": reading.rsi_blocked,
            "rsi_buy_min": s.rsi_buy_min,
            "rsi_buy_max": s.rsi_buy_max,
            "starting_cash": self.cfg.portfolio.starting_cash,
            "cash": round(pf.cash, 2),
            "position_base": pf.base_amount,
            "entry_price": pf.entry_price,
            "equity": round(pf.equity(price), 2),
            "unrealized_pnl": round(pf.unrealized_pnl(price), 2),
            "realized_pnl": round(pf.realized_pnl, 2),
            "num_trades": len(pf.trades),
            "updated": _utc_now_iso(),
            "chart": {
                "t": [c.time for c in candles][-limit:],
                "price": closes[-limit:],
                "ema_fast": pad(fast)[-limit:],
                "ema_slow": pad(slow)[-limit:],
                "rsi": pad(rsi_series)[-limit:] if rsi_series else [],
            },
            "trades": [
                {"time": t.timestamp, "side": t.side, "price": round(t.price, 4),
                 "usd": round(t.usd_value, 2), "fee": round(t.fee, 2),
                 "reason": t.reason}
                for t in pf.trades[-50:]
            ],
        }
        with self._snap_lock:
            self._snapshot = snapshot

    def get_snapshot(self) -> Optional[dict]:
        with self._snap_lock:
            return self._snapshot

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
