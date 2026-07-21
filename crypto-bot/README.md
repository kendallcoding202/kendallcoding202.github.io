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
  - **Buy** when the fast MA crosses above the slow MA **and** RSI confirms
    (RSI inside a configurable band — bullish, but not already overbought).
  - **Sell** when it crosses back below.
- Optional **RSI filter** (on by default) that suppresses buy crossovers firing
  into an overbought move, to cut down on chasing tops in choppy markets.
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

# 1) Backtest the strategy on recent history (default ~1 week of 15m candles):
python run.py backtest --bars 672

# 2) See how much of the result is eaten by fees, across platforms:
python run.py feescan --bars 672

# 3) If you like what you see, run the live paper loop (Ctrl-C to stop):
python run.py run

# 4) Check the simulated portfolio / live signal at any time:
python run.py status
```

At 15-minute candles (`granularity: 900`), **672 bars ≈ one week** of history.

### The `feescan` command

`feescan` replays the *same* week of history at several fee rates and prints
them side by side, so you can see fee drag directly:

```
  fee / platform          trades   return %   final $    win %   maxDD %
  --------------------------------------------------------------------
  none (gross edge)          10     10.36     1103.6   100.0     0.61
  Binance ~0.10%             10     10.07    1100.68   100.0     0.64
  Kraken Pro ~0.26%          10       9.6    1096.03   100.0     0.68
  Coinbase Adv ~0.60%        10      8.62    1086.23   100.0     0.76
  --------------------------------------------------------------------
```

The gap between the `none` row and the others is the pure cost of fees — what
the strategy must overcome before it earns anything. (Numbers above are from
idealized sample data; run it on live history for the real picture.)

The bot logs to stdout and to `bot.log`, and saves state to `state.json`.
Delete `state.json` to reset the paper account.

## Configuration

All behavior is driven by `config.yaml` (see `config.example.yaml` for the full,
commented list). The knobs you'll touch most:

| Setting | Meaning |
| --- | --- |
| `trading.product_id` | Market to trade, e.g. `SOL-USD`, `BTC-USD`, `ETH-USD` |
| `trading.granularity` | Candle size in seconds (60 / 300 / 900 / 3600 / 21600 / 86400) |
| `strategy.fast_period` / `slow_period` | The two moving-average lengths |
| `strategy.ma_type` | `ema` or `sma` |
| `strategy.use_rsi_filter` | Require RSI to confirm a buy crossover (default `true`) |
| `strategy.rsi_period` | RSI lookback (default 14) |
| `strategy.rsi_buy_min` / `rsi_buy_max` | RSI band a buy must fall inside (default 50–70) |
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
