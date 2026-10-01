# Pre-registration: do cheap Polymarket sports contracts pay more often than they cost?

Written 2026-10-01, before the first live record.

## The lead, and why it may be fake

In the exploratory calibration check (`OPTIONS-2026-10-01.md`), 497 Yes/No sports
contracts priced at 2–20¢ a day before close averaged 8.3¢ and resolved Yes 12.9% of the
time. Buying them showed +27% per dollar, but the interval included zero and it was one of
eight rules tried. Two artifacts could explain it entirely:

1. **Stale price.** The backtest used the last hourly *trade*, not an ask anyone could buy
   at. In a thin, cheap market the ask can sit well above the last trade.
2. **Look-ahead in the population.** The backtest kept only markets whose *final* volume
   reached $1,000. A long shot that comes alive attracts volume, so filtering on final
   volume selects for winners. A live bot cannot filter on volume it has not seen yet.

This test removes both: it pays the real ask, walked through the real book, and it
filters only on what is known at the moment of the decision.

**Expected result: probably NO.** It is run because it is free, fast (sports settle within
days) and fully forward, so there is no backtest to fool us.

## Decision rule — fixed now

A scanner runs every 15 minutes on live Polymarket markets:

- outcomes exactly `["Yes","No"]`, `feeType` starting with `sports`, order book enabled;
- `endDate` between 22 and 26 hours from now; each market is recorded **once**, the first
  time it is seen in that window;
- the YES token's book is read. A **$2 order** is walked through the asks, giving the
  average fill price. Taker fee from the market's own `feeSchedule`:
  `fee = shares × p × rate × (p(1 − p))^exponent`.

**The rule:** a paper bet of $2 on YES when the book can fill the whole $2 and the
average fill price is between **0.02 and 0.20**.

Every market in the window is recorded, whatever its price, with best bid, best ask,
depth, last trade price and volume. Only the rule's subset decides the result; the rest
measures calibration at real asks.

## Settlement

When Gamma reports the market closed with outcome prices `[1,0]` or `[0,1]`, the bet
settles: payout = shares if YES won, else 0. Markets resolved any other way (refund or
50/50) pay their resolution price per share. Markets still open 14 days after their
`endDate` are reported as unsettled and excluded, and counted.

## What decides it

**Stop:** at **400 settled rule bets**, or **28 days** after the first record, whichever
comes first. No early peeking at the verdict: the status page shows counts and
settlement health, not profit, until the stop.

**YES only if** profit per dollar staked (after fills and fees) is above zero with the
2.5th percentile of a bootstrap over settlement dates above zero.

**Reported, not deciding:** the same at fill price + 1¢ (latency slip); the gap between
the ask and the last trade (the size of artifact 1); results on the subset whose final
volume reached $1,000 (the size of artifact 2); calibration across all price bins at
real asks.

**Power:** at 400 bets with a ~10% hit rate, the hit rate is known to about ±1.5
percentage points. The backtest's claimed gap (8.3¢ priced vs 12.9% hit) would show
clearly; a gap of 1–2 points would not.

## If YES

A further dated amendment fixes live sizing. Then live with $50 of the $200 at $1–2 per
bet, stopping at a 20% drawdown, after confirming Polymarket's eligibility rules for
your location.

## Code

`src/polysports.js`: `npm run polysports` runs the scanner and status page;
`npm run polysports:summary` prints the result. Data in `DATA_DIR/polysports/`.

## Amendment 1 — 2026-10-01, after the first live scan, before any bet settled

The first scan recorded 983 markets and 257 rule bets in one 4-hour window, roughly
**1,500 rule bets a day**, far more than planned for. Two parts of the registration
break at that rate and are fixed now, before any outcome exists:

1. **The bootstrap unit becomes the event (match), not the settlement date.** 400 bets
   would settle within about two days, so the result would rest on two date blocks.
   Contracts on the same match are also linked (home win, away win and draw cannot all
   pay), so the match is the honest unit to resample.
2. **The stop becomes: 400 settled rule bets *and* at least 7 days**, or 28 days, whichever
   comes first. One weekend of fixtures is not a sample of sports.

Facts from the first scan, recorded because they bear on the artifacts. They are about
prices only; no outcome is known:
- For the 47 rule bets that had traded at all, the best ask was a median **1¢** above the
  last trade. Artifact 1 (stale price) looks small.
- The median volume at decision was **$0**; only 2.7% of rule bets had $1k of volume a day
  out. The live population is mostly untraded contracts, unlike the backtest's.
- A $2 order filled entirely at the best ask in every rule bet. The mean bid–ask spread
  was 2.4¢.
