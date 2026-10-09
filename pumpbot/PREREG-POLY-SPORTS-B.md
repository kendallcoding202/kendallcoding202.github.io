# Pre-registration: Test B — does the cheap side of two-way sports markets pay more often than it costs?

Written 2026-10-09, before Test B's first record. A sibling of `PREREG-POLY-SPORTS.md`
(Test A), run by the same tracker, with its own stop and its own verdict.

## Why

Test A buys YES on Polymarket's Yes/No sports markets. A live scan on 2026-10-09 showed
that **every** Yes/No sports market then on offer was soccer (exact score, win/draw,
half results, first to score, both teams to score). Over/unders, spreads, team totals,
corners and team-vs-team moneylines — including all NFL and NHL markets — are listed as
two-outcome markets (`["Over","Under"]`, `["Flyers","Bruins"]`), which Test A never
touches.

Test A's lead came from Yes/No markets only. **Test B has no backtest behind it.** It asks
the same question of the other half of the board: do cheap contracts pay off more often
than their price says, once the real ask and fee are paid? It exists so the user can see
how over/unders, spreads and moneylines do, under the same discipline as Test A.

**Expected result: NO.** Two-way markets on major leagues are the most heavily traded
and most efficiently priced sports markets there are.

## Decision rule — fixed now

Every 15 minutes, on live Polymarket markets:

- `feeType` starting with `sports`, exactly two outcomes, and the outcomes are **not**
  `["Yes","No"]`; order book enabled;
- `endDate` (which is kickoff) between 22 and 26 hours from now; each market is recorded **once**, the first
  time it is seen in that window;
- **both** outcomes' books are read, and a **$2 order** is walked through each side's asks.
  The side whose $2 fill is cheaper (among sides that fill completely) is the candidate.
  Taker fee from the market's own `feeSchedule`: **`fee = shares × rate × (p(1 − p))^exponent`**,
  the formula in Polymarket's own clients (Test A, Amendment 2 item 8).

**The rule:** a paper bet of $2 on the candidate side when its $2 fill is complete and
its average price is between **0.02 and 0.20**.

Every market in the window is recorded, whatever its price, for calibration (reported,
not deciding).

## Settlement

When Gamma reports the market closed with outcome prices `[1,0]` or `[0,1]`, the bet pays
shares × the resolution price of the side bought. Other resolutions pay their resolution
price per share. Markets still open 14 days after their `endDate` are excluded and counted.

## What decides it

Identical to Test A after its Amendment 1, measured on Test B's own records and clock:

- **Stop:** 400 settled rule bets **and** at least 7 days since Test B's first record, or
  28 days, whichever comes first. At the stop the result is computed once and frozen;
  later settlements cannot move it, and Test B stops scanning.
- **YES only if** profit per dollar staked (after fills and fees) is above zero and the
  2.5th percentile of a bootstrap over **matches** is above zero. A match is identified
  by its event title before " - " plus the event date, because Polymarket splits one
  match into several events (Test A, Amendment 2 item 5).
- Before the stop the dashboard shows counts only; no outcome of any bet is shown.

**Reported, not deciding:** the same with fills 1¢ worse; calibration across price bins;
results by sport and by bet type (see below).

## Breakdowns by sport and bet type

Each record is tagged with its sport (from Polymarket's sports directory: the league's
sport tag, or its league code for the big US leagues that carry none), its league, and its
bet type (grouped from `sportsMarketType`: Moneyline, Over/under, Team total O/U, Spread,
Corners, …). The same breakdowns apply to Test A (its Amendment 2).

They are **exploratory**. With a dozen or more slices, one will look profitable by luck.
No slice can turn a NO into a YES, and a slice that looks good becomes a **new** hypothesis
to be registered and tested forward on bets not yet seen.

## Code

`src/polysports.js` (arm `B`), dashboard tab "Test B · Two-way". Data in
`DATA_DIR/polysports/` (append-only files shared with Test A).

## Watch list — not a test (added 2026-10-09, the evening Test B went live)

The user wanted to see the rule at work on that night's hockey and college football. The
tests cannot take those games: they decide 22–26 hours before kickoff, and the games were
hours away. So the tracker also keeps a **watch list** (`W` in the code, "Watch" on the
dashboard):

- **What:** markets of the watch sports (`POLY_WATCH_SPORTS`, default Hockey and College
  football) whose kickoff is **15 minutes to 22 hours** away and that no test has recorded.
  Because every later game passes through the tests' 22–26h window first, and a market is
  recorded only once, in practice these are the games the tests never saw.
- **How:** the same rule, the same real asks, the same fees — YES on a Yes/No market, the
  cheaper side of any other two-outcome market, at 2–20¢ for a full $2 fill.
- **Shown live:** its wins, losses and profit are on the dashboard as they settle, because
  it decides nothing. It has **no stop and no verdict**, and its bets never enter Test A or
  Test B, nor their counts. Read it as a window onto the rule, not as evidence: a handful of
  games is luck.

## Amendment 1 — 2026-10-09, before any Test B bet settled

- **College football and the NFL are separate sports** in the breakdowns (they were both
  "American football"; Polymarket's directory tags neither). Records filed before the
  split are re-labelled from their league on load. Reporting only; the rule is unchanged.
- The first pass on live data recorded 8,123 two-way markets and 795 bets in one window,
  mostly soccer and **college football** (the NFL games, on Sunday, were outside the window).

## Amendment 2 — 2026-10-09 ~20:00 UTC, before any Test B bet settled

Test B's running result is shown before the stop, exactly as Test A's Amendment 3 sets out:
the rule, the stop and the verdict test are unchanged; the verdict is taken once, at the
stop, and frozen; nothing seen before then changes them.
