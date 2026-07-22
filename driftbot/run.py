#!/usr/bin/env python3
"""Command-line entry point for driftbot, a paper-trading crypto bot.

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
import os
import sys
import threading

from bot.config import load_config
from bot.dashboard import serve as serve_dashboard
from bot.engine import TradingEngine, run_backtest
from bot.exchange import CoinbaseClient
from bot.portfolio import PaperPortfolio
from bot.strategy import MACrossoverStrategy


def _lan_ip():
    """Best-effort local network IP for building a phone-reachable URL."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no packets sent; just picks the route's iface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    TradingEngine(cfg).run()
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    engine = TradingEngine(cfg)
    server = serve_dashboard(engine, args.host, args.port)

    # HTTP server in a daemon thread; the engine loop owns the main thread so
    # its Ctrl-C / SIGTERM handlers work.
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print("\n  Dashboard live (paper trading — Ctrl-C to stop):")
    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        print(f"    public URL:  https://{railway_domain}")
    else:
        print(f"    on this computer:  http://127.0.0.1:{args.port}")
        if args.host not in ("127.0.0.1", "localhost"):
            lan_ip = _lan_ip()
            if lan_ip:
                print(f"    on your phone*:    http://{lan_ip}:{args.port}")
                print("    * phone must be on the same Wi-Fi network")
    print()
    try:
        engine.run()
    finally:
        server.shutdown()
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


# Representative base taker fees by platform (fraction per fill).
FEE_PRESETS = [
    (0.0000, "none (gross edge)"),
    (0.0010, "Binance ~0.10%"),
    (0.0026, "Kraken Pro ~0.26%"),
    (0.0060, "Coinbase Adv ~0.60%"),
]


def cmd_feescan(args: argparse.Namespace) -> int:
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

    presets = FEE_PRESETS
    if args.rates:
        presets = [(r, f"{r * 100:.3g}%") for r in args.rates]

    days = len(candles) * cfg.trading.granularity / 86400
    print(f"\nFee sensitivity over {len(candles)} bars (~{days:.1f} days), "
          f"start ${cfg.portfolio.starting_cash:,.0f}, {cfg.trading.product_id}:")
    print("\n  fee / platform          trades   return %   final $    win %   maxDD %")
    print("  " + "-" * 68)
    for rate, label in presets:
        cfg.portfolio.fee_rate = rate
        res = run_backtest(cfg, candles)
        res.pop("trades", None)
        print(f"  {label:<22}  {res['num_trades']:>5}   {res['total_return_pct']:>7}   "
              f"{res['final_equity']:>8}   {res['win_rate_pct']:>5}   "
              f"{res['max_drawdown_pct']:>6}")
    print("  " + "-" * 68)
    print("\nThe gap between the 'none' row and the rest is pure fee drag — the "
          "cost the strategy has to overcome before it earns anything.")
    print("Past performance does not predict future results.")
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
    parser = argparse.ArgumentParser(description="driftbot — paper-trading crypto bot")
    parser.add_argument("--config", default="config.yaml",
                        help="path to config YAML (default: config.yaml)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run", help="run the live paper-trading loop")

    db = sub.add_parser("dashboard",
                        help="run the paper loop with a live web dashboard")
    # On a host like Railway, PORT is injected and the app must bind 0.0.0.0.
    default_host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    db.add_argument("--host", default=default_host,
                    help="bind host (default: 127.0.0.1 locally, 0.0.0.0 when $PORT is set)")
    db.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8787)),
                    help="bind port (default: $PORT or 8787)")

    bt = sub.add_parser("backtest", help="backtest the strategy on recent history")
    bt.add_argument("--bars", type=int, default=672,
                    help="historical candles to test on (default: 672 candles)")

    fs = sub.add_parser("feescan",
                        help="backtest the same history at several fee rates side-by-side")
    fs.add_argument("--bars", type=int, default=672,
                    help="historical candles to test on (default: 672 candles)")
    fs.add_argument("--rates", type=float, nargs="+", default=None,
                    help="custom fee rates as fractions, e.g. --rates 0 0.001 0.0026 0.006")

    sub.add_parser("status", help="print current paper-portfolio state")

    args = parser.parse_args()
    dispatch = {"run": cmd_run, "dashboard": cmd_dashboard, "backtest": cmd_backtest,
                "feescan": cmd_feescan, "status": cmd_status}
    return dispatch[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
