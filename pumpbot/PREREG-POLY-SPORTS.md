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

## Amendment 2 — 2026-10-09, before any Test A bet settled

The tracker went live on Railway on 2026-10-09 at about 10:21 UTC. Its first bets end
around 2026-10-10 08:00 UTC, so no outcome existed when this was written. Nothing here
changes the rule, the stop or the verdict.

1. **Every record is tagged** with its sport, league and bet type (definitions in
   `PREREG-POLY-SPORTS-B.md`). Records from before tagging are tagged after the fact,
   from Polymarket's own market data.
2. **Breakdowns by sport and by bet type are reported, not deciding.** Before the stop
   they show counts only; at the stop, each slice's record and profit per dollar is shown
   from the frozen set of counted bets. They are exploratory: a slice that looks good is a
   new hypothesis to test forward, not a result.
3. **What Test A actually covers.** A scan on 2026-10-09 found every Yes/No sports market
   on offer was soccer: roughly 70% exact score, then win/draw, half results, first to
   score and both teams to score. Over/unders, spreads and all NFL/NHL markets are
   two-outcome markets and are outside Test A. They are covered by **Test B**
   (`PREREG-POLY-SPORTS-B.md`), registered separately with its own stop and verdict.
4. **Storage is now append-only** (`records.jsonl`, `settles.jsonl`, `tags.jsonl`,
   `meta.json`), migrated once from the first version's `state.json`. At ~20,000 markets a
   day across both tests, rewriting one JSON file every 15 minutes would have reached
   hundreds of MB. Records that are not bets keep only what calibration needs.
5. **The bootstrap unit was coded wrong, and is fixed before any settlement.** Amendment 1
   made the match the unit, but the code grouped by Polymarket's `event` id. Polymarket
   splits one match into up to six events (result, halftime, exact score, corners, …), so
   linked contracts on one match were resampled as if independent, which would have made
   the interval too narrow. The code now groups by a **match key**: the event title before
   " - " plus the event date. Checked on a live window, every `gameId` mapped to exactly
   one key and no key to two `gameId`s, including the events (such as corners) that carry
   no `gameId`. Found by independent review on 2026-10-09.
6. **`endDate` is kickoff, not the end of the game** (on every candidate checked, `endDate`
   equals `gameStartTime`). The rule is unchanged — bets are still decided 22–26 hours
   before `endDate`, i.e. about a day before kickoff — but the dashboard now says
   "kickoff" where it said "game ends".
7. **Each record keeps its market's fee schedule** (`feeRate`, `feeExp`), so fees can be
   recomputed exactly if the fee formula is ever shown to be wrong. Schedules differ by
   market: most sports markets carry rate 0.05, but American football markets carry 0.03
   (both exponent 1), so the fee is always taken from the market's own schedule.
8. **The fee formula was wrong, and is corrected before any outcome exists.** The
   registration copied `fee = shares × p × rate × (p(1 − p))^exponent` from a search of the
   docs (the docs site is blocked from this environment). Polymarket's own clients
   (`@polymarket/clob-client-v2` 1.2.0, published 2026-09-25 by Polymarket; and
   `py_clob_client_v2` 1.2.0, `fees.py`) compute **`fee = shares × rate × (p(1 − p))^exponent`**,
   fed by the market's `fd.r`/`fd.e`, which equal Gamma's `feeSchedule`. The docs' own table
   agrees (100 shares at 10¢, rate 0.07 → $0.63), and so do 26 real fills measured by a
   separate project. The leading `× p` was Polymarket's original early-2026 form, since
   dropped. With rate 0.05, exponent 1, the real fee on a $2 bet is **4.0–4.85% of the
   stake** across 2–20¢, not 0.15–0.8% — about the size of the edge this test exists to
   detect, so the wrong formula could have turned a losing rule into a YES. Every record
   already on disk is corrected exactly on load (the old fee was the true fee × p).
   Found by independent review on 2026-10-09 and confirmed by a second reviewer.
