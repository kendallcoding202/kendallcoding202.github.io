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
import json
import sys
from pathlib import Path
from typing import List, Optional, Sequence

from .config import Config
from .exchange import Candle, CoinbaseClient
from .indicators import moving_average, rsi
from .portfolio import PaperPortfolio
from .risk import DailyLossGuard, ExitReason, RiskManager
from .strategy import MACrossoverStrategy, Signal


def _setup_logger(log_file: str) -> logging.Logger:
    logger = logging.getLogger("driftbot")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    fh = logging.FileHandler(log_file)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    # Log to stdout so hosts like Railway don't render normal INFO lines as
    # red "error" output (the default StreamHandler writes to stderr).
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    return logger


def _downsample(points: List[list], target: int) -> List[list]:
    """Reduce a long series to at most ``target`` points, evenly spaced, always
    keeping the final point so the latest value is exact."""
    n = len(points)
    if n <= target:
        return points
    step = n / target
    out = [points[int(i * step)] for i in range(target)]
    if out[-1] is not points[-1]:
        out.append(points[-1])
    return out


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
        # Equity curve: [bar_time, equity, price]. Persisted next to the state
        # file so a restart/redeploy doesn't wipe the account's history.
        self._equity_file = str(Path(cfg.state.file).with_name("equity.json"))
        self._equity_curve: List[list] = self._load_equity()
        # Buy-and-hold benchmark anchor (price when tracking first started),
        # persisted separately so it stays fixed across restarts and history
        # rolloff — the honest yardstick over long runs.
        self._bench_file = str(Path(cfg.state.file).with_name("benchmark.json"))
        self._bench: dict = self._load_bench()
        # Start time of the most recent bar we evaluated for a trade, so trade
        # decisions happen once per completed candle even if we refresh faster.
        self._last_bar: Optional[int] = None

    # -- one iteration -----------------------------------------------------
    def step(self) -> None:
        candles = self.client.get_candles(
            self.cfg.trading.product_id, self.cfg.trading.granularity
        )
        closes = [c.close for c in candles]
        price = self.client.get_price(self.cfg.trading.product_id)
        ts = _utc_now_iso()

        # Live reading (includes the still-forming bar) for the dashboard.
        reading = self.strategy.evaluate(closes)
        equity = self.portfolio.equity(price)
        self.guard.update_day(_utc_date(), equity)
        halted = self.guard.is_halted(equity)

        if len(candles) < self.strategy.min_bars:
            self.logger.info(
                "warming up: %d/%d bars", len(candles), self.strategy.min_bars
            )
        else:
            self._maybe_trade(candles, ts, equity, halted, price)

        # Always refresh the view/equity, however often we poll.
        self._update_snapshot(candles, price, reading, halted)
        self._persist()

    def _maybe_trade(self, candles, ts, equity, halted, live_price) -> None:
        """Evaluate a trade at most once per completed candle.

        The last candle is still forming, so we act only when a *new* bar has
        appeared, and we decide on the bar that just closed (candles[-2]).
        """
        current_bar = candles[-1].time
        if self._last_bar is None:
            self._last_bar = current_bar   # baseline; don't trade mid-bar
            return
        if current_bar == self._last_bar:
            return                         # same bar as last check — no new decision
        self._last_bar = current_bar

        completed = [c.close for c in candles[:-1]]
        closed_price = candles[-2].close
        reading = self.strategy.evaluate(completed)
        rsi_txt = "n/a" if reading.rsi is None else f"{reading.rsi:.1f}"
        self._trade(reading, closed_price, ts, equity, halted, rsi_txt)

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
        self._save_equity()

    # -- equity curve + benchmark persistence -----------------------------
    def _load_equity(self) -> List[list]:
        try:
            data = json.loads(Path(self._equity_file).read_text())
            if isinstance(data, list):
                return data
        except (OSError, ValueError):
            pass
        return []

    def _save_equity(self) -> None:
        try:
            Path(self._equity_file).write_text(json.dumps(self._equity_curve))
        except OSError:
            pass

    def _load_bench(self) -> dict:
        try:
            data = json.loads(Path(self._bench_file).read_text())
            if isinstance(data, dict):
                return data
        except (OSError, ValueError):
            pass
        return {}

    def _save_bench(self) -> None:
        try:
            Path(self._bench_file).write_text(json.dumps(self._bench))
        except OSError:
            pass

    def _benchmark_value(self, price: float):
        """Value of a buy-and-hold: starting cash put into the asset at the
        tracking-start price (paying one entry fee), marked at ``price``."""
        entry = self._bench.get("entry_price")
        if not entry or price is None:
            return None
        start = self.cfg.portfolio.starting_cash
        units = start * (1 - self.cfg.portfolio.fee_rate) / entry
        return round(units * price, 2)

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

        bar_t = candles[-1].time if len(candles) else 0

        # Anchor the buy-and-hold benchmark the first time we see a price.
        if not self._bench.get("entry_price") and price and price > 0:
            self._bench = {"entry_price": price, "entry_time": bar_t}
            self._save_bench()

        # Append this bar's marked-to-market equity (and price, for the
        # benchmark overlay) to the curve. Retain a long rolling history (about
        # two weeks at a 60s refresh) and downsample for the browser, so an
        # always-on run shows its whole recent trajectory.
        self._equity_curve.append([bar_t, round(pf.equity(price), 2), round(price, 6)])
        if len(self._equity_curve) > 20000:
            self._equity_curve = self._equity_curve[-20000:]
        eq_curve = _downsample(self._equity_curve, 400)

        def _bench_at(point):
            return self._benchmark_value(point[2] if len(point) > 2 else None)

        bench_now = self._benchmark_value(price)
        start_cash = self.cfg.portfolio.starting_cash

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
            "fees_paid": round(sum(t.fee for t in pf.trades), 2),
            "num_trades": len(pf.trades),
            "benchmark_value": bench_now,
            "benchmark_pct": (None if not bench_now else
                              round((bench_now / start_cash - 1) * 100, 2)),
            "vs_benchmark": (None if bench_now is None else
                             round(pf.equity(price) - bench_now, 2)),
            "updated": _utc_now_iso(),
            "equity_curve": {
                "t": [p[0] for p in eq_curve],
                "equity": [p[1] for p in eq_curve],
                "benchmark": [_bench_at(p) for p in eq_curve],
            },
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
            "PAPER trading started | product=%s trade-every=%ds refresh-every=%ds "
            "strategy=%s(%d/%d) cash=%.2f",
            self.cfg.trading.product_id, self.cfg.trading.granularity,
            self.cfg.trading.refresh_interval, self.cfg.strategy.ma_type,
            self.cfg.strategy.fast_period, self.cfg.strategy.slow_period,
            self.portfolio.cash,
        )
        while self._running:
            try:
                self.step()
            except Exception as exc:  # keep the loop alive through transient errors
                self.logger.error("iteration failed: %s", exc)
            # Sleep in short slices so shutdown is responsive.
            for _ in range(self.cfg.trading.refresh_interval):
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
