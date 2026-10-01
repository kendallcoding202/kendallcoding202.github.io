# Pre-registration: can Jev, reading the news, time swings in liquid Solana coins?

Written 2026-10-01, before any news has been fetched or any outcome scored.

## Why this and not the chart

- The venue qualifies: liquid Solana coins cost 12–51bp per round trip and move enough at
  4h+ (`data/stage0-solana.json`).
- The chart is exhausted: momentum and the signal sweep tested 28 cells on these coins
  and none survived (`PREREG-MOMENTUM.md`, `PREREG-SIGNAL-SWEEP.md`).
- Jev reading numbers is no better than a free regression (`PREREG-JEV.md`, results).

So the only version with a reason to work is Jev reading what a regression cannot:
**text**. This tests that, and only that.

**Expected result: NO.** Liquid coins absorb news within minutes, and a daily decision is
late to it. This is run because it is cheap and it is the last untested Jev idea, not
because it is expected to work.

## Universe and prices

The ten coins already used: bonk, book-of-meme, cat-in-a-dogs-world, dogwifcoin,
fartcoin, moo-deng, official-trump, peanut-the-squirrel, popcat, pudgy-penguins.
Prices from CoinGecko (`/coins/{id}/market_chart`).

**Window:** the 365 days before the fetch date if the news source covers them, otherwise
the 90 days before it. Hourly prices for 90 days, daily closes for 365; the decision
needs only daily granularity either way.

## The news source — picked by coverage, before any outcome is seen

Candidates, all reachable only once the environment's network allowlist includes them:

1. **CoinDesk Data news API** (`data-api.coindesk.com`, formerly CryptoCompare):
   crypto-specific, timestamped, tagged by coin, long history.
2. **GDELT DOC 2.0** (`api.gdeltproject.org`): free, no key, timestamped, but only a
   rolling 3 months and mostly mainstream outlets.
3. **Reddit search** (`www.reddit.com`): community chatter, weak date filtering.
4. **CryptoPanic** (`cryptopanic.com`): an aggregator; the free tier may not reach back far.

**Selection rule:** for each source, count the (coin, day) decisions with at least one
item timestamped in the prior 24 hours. The source (or union of sources) with the highest
coverage is used, **provided coverage is at least 50%**. If no source reaches 50%, the
test is not run and that is recorded. The counts and the choice go in a dated amendment
**before** any price outcome is joined to any text. Counting items does not look at
outcomes, so this choice cannot be tuned toward a result.

## The decision

- One decision per coin per day at 00:00 UTC (time `t`).
- **Jev sees:** the coin's name and symbol, the date, and the headlines plus first
  sentences of every item timestamped in `(t − 24h, t]`, newest first, capped at 40
  items. **Nothing timestamped after `t` is ever sent.** Rows with no items are scored
  as "no news" and stay in the population: no-news days are part of trading too.
- **The question (Noul):** "{NAME} ({SYMBOL}) will be more than 0.5% higher in 24 hours
  than it is now."
- **Label:** `close(t + 24h) / close(t) − 1 > 0.005`.
- **Cost:** 50bp per round trip for every coin. That is the thinnest measured quote and
  about 3x the deep ones, which covers some of the slippage and failed transactions a
  quote leaves out. It is charged on every entry and exit actually made.

## Instrument checks — run first; any failure voids the result

1. **Hindsight.** Jev must not already know how these coins moved. For every month in
   the window, ask about each coin's direction over each week of that month, with no
   news ("{NAME} was higher at the end of the week of {date} than at its start").
   A month where Jev is right more often than chance (one-sided binomial p < 0.05) is
   **removed from the window** as contaminated. If more than half the months are removed,
   the test is void.
2. **Reads its input.** A made-up strongly good headline ("Coinbase lists {SYMBOL}") must
   raise the probability over a neutral one, and a made-up bad one ("{NAME} liquidity
   pool drained in exploit") must lower it.
3. **Shuffled news.** Out-of-sample rows answered with news from the same coin on a
   randomly chosen different day must **not** beat climatology on Brier (interval must
   include or fall below zero).
4. **Noise.** Measured at sd 0.007 in amendment 1 of `PREREG-JEV.md`; one call per row.

## Split, models, and the strategy

**60/40 by date**, the same dates for every coin. Every fit — recalibration,
regressions — uses the in-sample 60% only.

| model | what it is |
|---|---|
| climatology | in-sample up rate for every row |
| buy-and-hold | hold the equal-weight basket every day |
| chart LR | logistic regression on past 1d, 3d, 7d returns and the 1d/7d volume ratio |
| **Jev** | the Noul answer, isotonic-recalibrated in-sample |
| LR + Jev | chart features plus Jev's answer in one regression |

**Strategy, for every model that gives a probability:** each day, hold each coin whose
recalibrated probability is above 0.5, equal-weighted across the coins held, in cash
otherwise. Daily net return after the 50bp cost on entries and exits.

## What decides it

**Primary:** out-of-sample mean daily net return of the Jev strategy minus
(a) buy-and-hold and (b) the chart-LR strategy. Block bootstrap over days, blocks of
5 days. Two comparisons, Bonferroni: the 1.25th percentile must be above zero.

**YES only if all three hold:**
1. Jev's strategy beats buy-and-hold, interval above zero;
2. Jev's strategy beats the chart-LR strategy, interval above zero;
3. Jev's strategy's out-of-sample net return is above zero in absolute terms. Beating a
   falling market while still losing money is not a result.

**Secondary, reported, not deciding:** Brier for every model; how much LR + Jev improves
on chart LR; how the result splits between news days and no-news days.

**Power, stated now:** with a 90-day window, the out-of-sample period is about 36 days,
and only an edge of more than about 1.5% a day could be detected. With 365 days, about
146 days, and roughly 0.7% a day. **A NO therefore means "no large edge", not "no edge".**
That is still the question that matters here: with $200, only a large edge would earn
anything worth having.

## If YES — what happens before any money moves

1. A dated amendment fixes the live rules exactly as tested.
2. **14 days of paper trading** forward, live news, no money. It must be net positive
   after cost.
3. Only then live, starting with **$50 of the $200**, no leverage, the same 50bp cost
   checked against real fills. A live drawdown of 20% stops it.

## Budget

About 1–2k input tokens per call at $0.042 per million: roughly 4,000 calls including
the checks comes to about **$0.30**. Hard cap **$5**. Outputs are free.

## What this does not test

- Faster decisions (hourly, or reacting to a headline within minutes). Being faster is a
  race against professional bots this setup cannot win, so it is left out on purpose.
- On-chain flow data (wallets, liquidity moves). Still untested, and a separate question.

## Amendment 1 — 2026-10-01, before any news was joined to any price

- **Sources actually available:** CryptoPanic has no free tier left; Reddit refuses this
  environment's address; CoinDesk's news API needs a (free) key the user would have to
  create. **GDELT works without a key**, so it is used first. Its 3-month limit means the
  **90-day window** applies (2026-07-05 to 2026-10-01).
- **GDELT returns headlines only**, not first sentences, so Jev sees headlines with their
  outlet and timestamp. Fetching article bodies would mean reaching hundreds of outlets
  this environment does not allow.
- **Search terms per coin**, fixed before any count was seen, are in
  `research/gdelt-fetch.mjs` (`QUERIES`). Ambiguous names ("bonk", "Moo Deng", which is
  also a real hippo) require a crypto term alongside them.
- The coverage count and the go/no-go on the 50% rule follow in amendment 2.
