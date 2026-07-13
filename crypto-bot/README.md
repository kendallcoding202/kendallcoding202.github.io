# Paper-Trading Crypto Bot

An autonomous crypto trading bot that runs a **momentum / moving-average-crossover**
strategy against **live Coinbase market data** — and executes every trade in a
**local simulation**. It reads public prices; it never places a real order or
touches real money.

> ⚠️ **Read this first.** No trading bot reliably "maximizes profits." After
> fees and slippage, the large majority of retail automated day-trading
> strategies lose money over time. This project exists to let you **build,
> test, and measure** a strategy honestly — not because a moving-average bot is
> a money machine. Treat the numbers it produces as data, not promises. This is
> not financial advice.

---

## Why paper-only?

Every fill is simulated by `bot/portfolio.py` against the live price, with a fee
and slippage applied *against* you so the results are pessimistic rather than
rosy. There is deliberately **no code path that can authenticate to an exchange
or submit an order.** That's the safety model: you can run it for weeks, watch
how it behaves, and lose nothing real while you learn whether the strategy is
worth anything.

If you later decide to wire up live trading, that's a serious step you should
take deliberately, with your own risk capital, small size, and eyes open — it is
intentionally not included here.

## What it does

- Polls Coinbase public candles + ticker on an interval (no API key needed).
- Computes a fast and slow moving average (EMA or SMA) and trades the crossover:
  - **Buy** when the fast MA crosses above the slow MA.
  - **Sell** when it crosses back below.
- Applies risk controls on every iteration:
  - **Position sizing** — deploy a fixed fraction of equity per entry.
  - **Stop-loss / take-profit** — hard exits that override the strategy.
  - **Daily-loss circuit breaker** — stop opening new positions after the day's
    drawdown crosses a threshold.
- Persists the simulated portfolio to `state.json` so restarts resume cleanly.
- Backtests the *same* strategy + risk code over recent history so a backtest
  and a live paper run behave identically.

## Project layout

```
crypto-bot/
├── run.py              # CLI: run / backtest / status
├── config.example.yaml # copy to config.yaml and tune
├── bot/
│   ├── config.py       # typed, validated config
│   ├── exchange.py     # Coinbase public market-data client (read-only)
│   ├── indicators.py   # SMA / EMA
│   ├── strategy.py     # MA-crossover signal logic
│   ├── portfolio.py    # paper fills, fees, slippage, PnL, persistence
│   ├── risk.py         # sizing, stop/take, daily-loss halt
│   └── engine.py       # autonomous loop + backtester
└── tests/              # unit tests
```

## Quick start

```bash
cd crypto-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp config.example.yaml config.yaml    # then edit to taste

# 1) Backtest the strategy on recent history first:
python run.py backtest --bars 1000

# 2) If you like what you see, run the live paper loop (Ctrl-C to stop):
python run.py run

# 3) Check the simulated portfolio at any time:
python run.py status
```

The bot logs to stdout and to `bot.log`, and saves state to `state.json`.
Delete `state.json` to reset the paper account.

## Configuration

All behavior is driven by `config.yaml` (see `config.example.yaml` for the full,
commented list). The knobs you'll touch most:

| Setting | Meaning |
| --- | --- |
| `trading.product_id` | Market to trade, e.g. `BTC-USD`, `ETH-USD` |
| `trading.granularity` | Candle size in seconds (60 / 300 / 900 / 3600 / 21600 / 86400) |
| `strategy.fast_period` / `slow_period` | The two moving-average lengths |
| `strategy.ma_type` | `ema` or `sma` |
| `risk.position_pct` | Fraction of equity per entry |
| `risk.stop_loss_pct` / `take_profit_pct` | Protective exits |
| `risk.max_daily_loss_pct` | Daily-loss circuit breaker |
| `portfolio.fee_rate` / `slippage` | Simulated trading costs |

## Running the tests

```bash
python -m pytest -q
```

## Honest limitations

- **Backtest ≠ future.** A strategy that looks great on past candles routinely
  falls apart live. Overfitting parameters to history is the classic trap.
- **Costs dominate at high frequency.** Small granularities mean more trades and
  more fees; the simulated `fee_rate`/`slippage` are estimates, and real fills
  can be worse.
- **One position, one market, one strategy.** This is a clean foundation, not a
  hedge fund. No portfolio of pairs, no shorting, no leverage.
- **Public data only.** The bot depends on Coinbase's public endpoints being
  reachable and rate-limits permitting.

## Ideas for going further

- Add more strategies behind the existing interface (RSI/Bollinger mean
  reversion, MACD) and compare them via backtest.
- Walk-forward testing instead of a single backtest window.
- Trade a basket of products with per-market risk budgets.
- Alerting (email/Slack) on entries, exits, and the daily-loss halt.
