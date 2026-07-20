#!/usr/bin/env python3
"""Command-line entry point for the paper-trading crypto bot.

Usage:
    python run.py run       [--config config.yaml]   # live paper-trading loop
    python run.py backtest  [--config config.yaml] [--bars 1000]
    python run.py status    [--config config.yaml]   # print portfolio state

This bot is PAPER-ONLY: it reads public market data and simulates every fill.
It has no code path that can place a real order or move real money.
"""

from __future__ import annotations

import argparse
import json
import sys

from bot.config import load_config
from bot.engine import TradingEngine, run_backtest
from bot.exchange import CoinbaseClient
from bot.portfolio import PaperPortfolio
from bot.strategy import MACrossoverStrategy


def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    TradingEngine(cfg).run()
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    client = CoinbaseClient(cfg.exchange.base_url, cfg.exchange.timeout)
    print(f"Fetching {args.bars} candles for {cfg.trading.product_id} "
          f"@ {cfg.trading.granularity}s ...")
    candles = client.get_candles_history(
        cfg.trading.product_id, cfg.trading.granularity, args.bars
    )
    if len(candles) < 2:
        print("Not enough historical data returned.", file=sys.stderr)
        return 1
    result = run_backtest(cfg, candles)
    trades = result.pop("trades", [])

    print(f"\nBacktest over {len(candles)} bars "
          f"({cfg.strategy.ma_type} {cfg.strategy.fast_period}/{cfg.strategy.slow_period}):")

    if trades:
        print("\n  when                            side  price        value       fee     P&L")
        print("  " + "-" * 76)
        for t in trades:
            when = t["time"][:19].replace("T", " ")
            pnl = "" if t["pnl"] is None else f"{t['pnl']:>+9.2f}"
            reason = "" if t["side"] == "BUY" else f"  ({t['reason']})"
            print(f"  {when}  {t['side']:<4}  {t['price']:>10.2f}  {t['usd']:>10.2f}  "
                  f"{t['fee']:>6.2f}  {pnl}{reason}")
        print("  " + "-" * 76)
    else:
        print("\n  (no trades were triggered over this window)")

    print("\nSummary:")
    print(json.dumps(result, indent=2))
    print("\nPast performance does not predict future results. Fees and slippage "
          "are simulated; real fills will differ.")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    client = CoinbaseClient(cfg.exchange.base_url, cfg.exchange.timeout)
    price = client.get_price(cfg.trading.product_id)

    # Live indicator snapshot (mirrors a dashboard view).
    strategy = MACrossoverStrategy(cfg.strategy)
    candles = client.get_candles(cfg.trading.product_id, cfg.trading.granularity)
    reading = strategy.evaluate([c.close for c in candles])

    pf = PaperPortfolio.load(cfg.state.file)
    if pf is None:
        pf = PaperPortfolio.new(
            cfg.portfolio.starting_cash, cfg.portfolio.fee_rate, cfg.portfolio.slippage
        )

    snapshot = {
        "product": cfg.trading.product_id,
        "signal": reading.signal.value,
        "price": round(price, 4),
        "ema_fast": None if reading.fast is None else round(reading.fast, 4),
        "ema_slow": None if reading.slow is None else round(reading.slow, 4),
        "rsi": None if reading.rsi is None else round(reading.rsi, 1),
        "rsi_blocked_buy": reading.rsi_blocked,
        "position_base": round(pf.base_amount, 8),
        "entry_price": round(pf.entry_price, 4),
        "cash": round(pf.cash, 2),
        "equity": round(pf.equity(price), 2),
        "unrealized_pnl": round(pf.unrealized_pnl(price), 2),
        "realized_pnl": round(pf.realized_pnl, 2),
        "num_trades": len(pf.trades),
    }
    print(json.dumps(snapshot, indent=2))
    if reading.rsi_blocked:
        print("\nNote: a BUY crossover is active but RSI is outside "
              f"[{cfg.strategy.rsi_buy_min:.0f}, {cfg.strategy.rsi_buy_max:.0f}], "
              "so no entry was taken.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Paper-trading crypto bot")
    parser.add_argument("--config", default="config.yaml",
                        help="path to config YAML (default: config.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run", help="run the live paper-trading loop")

    bt = sub.add_parser("backtest", help="backtest the strategy on recent history")
    bt.add_argument("--bars", type=int, default=1000,
                    help="number of historical candles to test on (default: 1000)")

    sub.add_parser("status", help="print current paper-portfolio state")

    args = parser.parse_args()
    dispatch = {"run": cmd_run, "backtest": cmd_backtest, "status": cmd_status}
    return dispatch[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
