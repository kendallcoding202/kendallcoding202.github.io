# Pre-registration: Test C — does posting prices (making) on Polymarket sports earn the spread?

Written 2026-10-15, before Test C's first record. Revised the same day, still before any
record, after an independent five-lens design review (fill-model optimism, Polymarket
mechanics, statistics, failure modes, live relevance). The review's main changes are listed
at the end. Rule version **C1** (`RULE_VERSION` in `src/polymaker.js`).

## Why

Tests A and B (`PREREG-POLY-SPORTS.md`, `PREREG-POLY-SPORTS-B.md`) bought at the ask and
lost heavily. Their evaluation (`EVAL-POLY-SPORTS-2026-10-15.md`) found:

- **The market is right at its midpoint.** On 13,950 settled bets with a two-sided book, the
  long shot won 5.95% against a midpoint of 6.1¢ (A) and 9.35% against 9.6¢ (B).
- **A taker loses either way.** Buying the long shot at the ask: −40.6% / −32.3% per $1.
  Buying the other side at its ask: −1.8% / −3.0%. Whoever buys pays half the spread plus a fee.
- **The spread goes to whoever posts the prices.** Sports fees are charged to takers only
  (`feeSchedule.takerOnly: true` on every sports market checked 2026-10-15), and a share is
  returned to makers (`rebateRate` 0.15–0.25).

**The question:** does a paper order *resting* one cent above the best bid make money, once
it is filled only when someone actually sells to it?

**Upper bound, from the same data (exploratory).** If every order of this rule had filled
(1¢-tick books, 3–10¢ spread, on Test A/B's markets), the cheap side would have earned about
+27% per $1 (1.6¢ a share) and the dear side about +1.0% per $1 (0.9¢ a share). A resting
order is not filled at random: it is filled when a seller comes, and sellers often know
something (lineups, injuries, a sharper price elsewhere), or when the market moves through
it. This **adverse selection** is the whole question, and it can turn either figure negative.

**Expected result: probably NO.** Professional market makers already quote these books.

**Who can trade this.** The test reads Polymarket's international exchange. It is closed to
the US and some other countries, where a different venue (Polymarket US) has its own books,
fees and rebates, which this test does not read. **The user's country has not been confirmed
(asked 2026-10-15).** If the user cannot legally use the international exchange, a YES here
does not license trading anywhere; the test still runs as research. The tracker also records,
on each start, whether Polymarket would accept orders from the server it runs on
(`polymarket.com/api/geoblock`), since a live bot would run there. Using a VPN to get around
a restriction is against Polymarket's terms and is ruled out.

## Universe

Polymarket markets with `feeType` starting `sports`, exactly two outcomes, order book
enabled, accepting orders, **a `gameStartTime` within 15 minutes of `endDate`** (single
games; tournament-long markets are left out and counted), and a **1¢ tick**
(`orderPriceMinTickSize` 0.01). Kickoff = `gameStartTime`. A market is **enrolled** the first
time it is seen with kickoff **22–26 hours** away, the same window as Tests A and B, and is
enrolled only once, ever.

## The rule (paper orders; nothing is ever placed)

From enrolment until kickoff, **every minute**, for each enrolled game:

1. Read outcome 0's best bid and best ask (`POST clob.polymarket.com/prices`). The two outcome
   books mirror each other: outcome 1's bid = 1 − outcome 0's ask, its ask = 1 − outcome 0's bid.
2. If both exist, lie on the 1¢ grid, and the spread is **3¢ to 10¢**, each outcome not yet
   filled gets a **paper buy order at its best bid + 1¢** (so between 2¢ and 98¢), for
   **max(5 shares or the market's minimum, $2 ÷ price) shares**. Otherwise it has no order.
3. If the price is unchanged the order **keeps resting**; if it changes, the order ends and a
   new one starts at that read. An order's life runs from the read that placed it to the read
   that ended it. If two reads of a game are more than 3 minutes apart (an outage), the
   order ends 1 minute after the last read that saw it, and is counted as "late".
4. Quoting stops for good at **kickoff** (refreshed from Gamma every 15 minutes: an earlier
   kickoff ends it then, a later one does not extend it), when Gamma shows the market
   **closed or not accepting orders**, or when the book is **cleared** (empty on both sides
   after having been two-sided). Polymarket clears sports books at kickoff
   (`clearBookOnStart`).
5. **Each outcome is bought at most once.** Both outcomes of a game may be bought.

Why best bid + 1¢: the order is then **alone at the best price**, so anyone selling at that
price or lower must trade with it first. Its fills can be read from public trades without
guessing its place in a queue.

## What is recorded live

At every read, for each resting order at price p:

- **crossing** — a sell is offered at or below p (outcome 0's ask ≤ p; for outcome 1, outcome
  0's bid ≥ 1 − p). Someone posted a sell that would have traded with us: the order is
  **filled** under both rules below, for the size offered at or below p (read from the full
  book), and that outcome is never quoted again;
- **touch** — the outcome's midpoint reaches p, its best bid vanishes, or the spread blows
  out past 10¢: the market moved to or past the order, or thinned out.

Each game's **midpoint at the last read before kickoff** is also kept, for every enrolled
game (the markout and the calibration correction below).

## When a paper order counts as filled — two rules

Two hours after kickoff, the game's taker trades are read from Polymarket's public trade feed
(`data-api.polymarket.com/v2/trades`, `taker_only=true`), from the first order to kickoff, and
the game's orders are **replayed in time order, per outcome**. The first order with any
evidence is filled; that outcome's later orders never existed.

- **Trade rule** (what a paper test can see). An order at p is filled by:
  - a **seller** reaching p: a taker sale of its outcome at ≤ p, or a taker purchase of the
    other outcome at ≥ 1 − p (the same match seen from the other book);
  - a **crossing print**: a taker purchase of its outcome at ≤ p, or a taker sale of the
    other outcome at ≥ 1 − p (a sell was resting at or below p);
  - a **crossing** seen live.
  Size = min(order size, the total shown); price = p (a maker gets its own price).
- **Touch rule** (assumes every stale order is picked off): the trade rule, plus any
  **touch**, which fills the whole order at p.

**Timing.** A trade's feed time can trail its match by a few seconds. With L = 60 s, a seller
print counts for an order whose life overlaps [feed time − L, feed time]; if it qualifies for
two neighbouring orders, it goes to the **dearer** one. A crossing print counts only if the
whole of [feed time − L, feed time] lies inside the order's life.

**Data failures.** A trade read that could silently mean "no trades" is an error, not an
empty answer: a reply without data, `has_more` without a cursor, a full page with no way to
page on, a trade from a game not asked for. Failing requests of 20 games are split down to
single games and retried; a game still unreadable a day after kickoff is **void** (excluded
and counted). The trade reader waits until the feed shows trades from at least 30 minutes
after the game's kickoff. 5% of games are re-read a day later and any difference is counted.
Open orders and ended orders are written to disk at once, so they rest through a restart,
as live orders would. Downtime is counted.

**Feed validation, before the first replay.** The tracker records what the feed returns on
its first start (raw records with `taker_only` true and false, records per transaction,
whether start/end bound the timestamps). Before the first game is replayed (about 26 hours
after the first enrolment, when no fill exists yet), this check must show: per-level records
(a taker order that swept several prices appears at each price, not one average), one
record per match with `taker_only=true`, and start/end honoured. If not, a dated amendment
fixes the fill reading **before any fill exists**. After that, the rule does not change.

## Settlement

A fill pays shares × the resolution price of the outcome bought; it cost shares × p. No fee
(makers pay none); the maker rebate is **not** counted. Unresolved 14 days after kickoff:
excluded and counted.

## What decides it

**The primary statistic is the calibration-corrected markout per $1**, by side:

  Σ shares × (m − p + c(m)) ÷ Σ shares × p

where m is the outcome's midpoint at the last read before kickoff and c(m) the calibration
correction: the average (result − m) in m's 5¢ band, over **every enrolled game's** two
outcomes once resolved (0 where a band has fewer than 30). Profit = markout + (result − m);
the second part averages c(m) and is mostly luck, so the corrected markout estimates the
same expected profit with far less noise (about 11× less variance per fill on A/B's data).

- **By side, decided separately:** the **cheap side** (orders under 50¢) and the **dear
  side** (50¢ and up). They behave differently (long shots carry nearly all the variance;
  favourites carry most of the dollars), so pooling would let one hide the other.
- **A side is YES only if**, at the stop: under **both** fill rules its corrected markout
  per $1 has the lower end of its **98.75%** bootstrap interval over **matches** above zero
  (95% split over two sides), **and** its real outcome profit per $1 under the trade rule is
  not negative. A match is the event title before " - " plus the date, as in Test A.
- **The stop:** at least **7 days** and at least **300 matches** with a settled fill, or **28
  days**. At the stop the result is computed once and frozen; Test C stops quoting.
- **Futility:** from day 3, with at least 150 matches, if neither side's corrected markout
  under the trade rule can plausibly be above zero (the top of its interval is below zero),
  the test stops and records **NO (stopped for futility)**.
- **INCONCLUSIVE, not NO,** if at the stop there are fewer than 100 settled fills, more than
  10% of games with orders are void, or the tracker was down more than 10% of the time.
- **YES can be given only at the registered stop.** Any other early stop, for any reason,
  records INCONCLUSIVE. Neither INCONCLUSIVE nor a voided test opens the live step.
- The running result is shown on the dashboard (as for Tests A and B, at the user's request).
  Nothing seen before the stop changes the rule, the stop or the verdict.

**Power (from simulation on A/B's data, rough).** With the markout as the statistic, an edge
of about 1¢ per share should be detected with high probability by the stop, and about 0.5¢
a share perhaps two times in three. A NO therefore means **no edge of about 1¢ a share or
more was found**, not that making can never pay.

## Reported, not deciding

- Real outcome profit per $1 with its range, overall and per side and rule.
- Results by **fill source** (seller / crossing print / crossing / touch), by price band, by
  spread at the order, by sport and by bet type. With about 30 slices, about one will clear
  zero by chance. **No slice can turn a NO into a YES**; a slice that looks good is a new
  hypothesis that needs its own registered forward test before any money.
- Raw markout (uncorrected) and the calibration table.
- Fill rate (fills per order placed), orders per day, crossings and touches, late orders,
  void games, the re-read audit, downtime and restarts.
- Games where both outcomes filled (their share counts differ, so this is not a hedge).
- **A live order is visible and can be jumped.** Two sensitivities, the maker's version of
  Tests A/B's "1¢ worse": every fill **one tick dearer**, and **second in line** (fill size =
  min(order, qualifying size − our order size), as if one maker our size had stepped in
  front). If the verdict is YES but either is at or below zero, the live step measures fills
  only (below) and no money is scaled up on the paper result.
- **The $200 ledger:** what a $200 account would have done with the same orders. An order is
  admitted only if its cost fits in the free balance ($200 − the cost of its admitted resting
  orders − the cost of filled positions not yet resolved); a game where both outcomes filled
  returns $1 per matched share at once. Priority: soonest kickoff first, ties by enrolment
  time. Reported: profit, profit per day, capital in use (mean and peak), fills per day,
  largest drawdown, by side. Computed offline from the order log.
- Prices 1, 15 and 60 minutes after each fill (Polymarket's minute history): how fast the
  market moved with or against our fills. Results by time to kickoff at the fill (over 6 h,
  1–6 h, under 1 h) and by minutes since the order was priced.
- The rebate a fill might have earned (counterparty fee × `rebateRate`) as an upper bound.
  Live sizing may not count on the rebate until its payout has been checked on a real account.

## Known limits

- **Our order would change the market.** Other bots might step in front of it, or trade with
  it because it is there. The touch rule bounds the second; the first is not measured.
- **Reads are a minute apart.** A sell offered at or below our price and withdrawn within the
  minute without trading is missed (an adverse fill missed). The touch rule covers most such
  moves, since the midpoint usually follows.
- **Capital.** A live resting order ties up its cost while it rests.

## If YES

The live step is fixed **now**, for the side(s) that passed and nothing else, and it is a
check of the fill model before it is a source of profit:

1. **The bot uses this rule exactly:** best bid + 1¢, 3–10¢ spread, re-priced every minute,
   cancelled at kickoff, on the passing side only, admitted by the $200-ledger rule above
   but with **$50** committed at most, orders of about $2 (5-share minimum). It prices from
   the book **with its own orders removed** (or it would chase itself up a tick each read),
   posts post-only orders, and never crosses the spread.
2. **Every live order has a paper twin:** the tracker keeps quoting the same games, with the
   bot's orders removed from the books it reads.
3. **Go or no-go after 100 live fills or 14 days**, whichever comes first. Go needs live
   fills per order at least half the twins', and a mean 60-minute markout of live fills no
   worse than the twins' by more than 1 tick. No-go returns to paper.
4. **Drawdown stop:** the 1st percentile of the paper ledger's drawdowns over the same number
   of fills (bootstrapped), scaled to the live stake — not a flat 20%, which five ordinary
   losing long shots would trigger.
5. Before any of this: the user's eligibility for the venue is confirmed (above), and the
   server's location passes Polymarket's geoblock check.

## Rule changes

Every fill carries the rule version and the deployed commit. After registration, deploys may
change the display and export only; a change to how orders, fills, voids or settlement work
needs a dated amendment here, and results are reported by rule version.

## Code

`src/polymaker.js` (rule, live reads, replay, statistics), run by the sports tracker
(`src/polysports.js`, `APP=polysports`): a live loop every minute and a background loop for
enrolment, kickoff refresh, replay, settlement and the stop. Dashboard tab "Test C · Maker".
Data in `DATA_DIR/polysports/maker-*`.

## What the design review changed (2026-10-15, before any record)

- **1¢-tick books only** (no 0.1¢ lottery-ticket orders: one 0.2¢ hit would have moved the
  result by 76 points), and single games only (`gameStartTime` near `endDate`).
- **Re-priced every minute, evidence recorded live, trades read after kickoff**, instead of
  5-minute orders judged on trades read 5 minutes late (late-indexed trades, the adverse
  ones, would have been lost).
- **The touch rule** as a second, pessimistic reading, and **YES only if both pass**: a
  stale order can be picked off with no public trade at all.
- **Timing by read, with an overlap rule for feed delays**, instead of the round's clock
  (trades near a boundary were being credited to the order priced after them).
- **The corrected markout as the statistic, decided per side, stop on matches**: at 400
  fills the outcome-based verdict could not have detected a realistic edge.
- **Futility stop, INCONCLUSIVE gates, YES only at the stop, live rule fixed now.**
- **Orders survive restarts; failures split and retried; replies that could mean "no
  trades" are errors; enrolled once ever; kickoff refreshed.**
