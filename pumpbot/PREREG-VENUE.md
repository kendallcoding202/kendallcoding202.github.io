# Pre-registration: qualifying a venue, before building anything on it

Written before a candidate venue has been touched. It is deliberately venue-agnostic:
Hyperliquid, a Base launchpad, or anything else gets the same two measurements in the
same order, and the order is the point.

---

## Why this exists

Six hypotheses died on pump.fun and they all died the same way:

| | |
|---|---|
| cost floor | **~5.6pp (560bp)** |
| median 30-second move being traded | **0.0%** |

Nothing about that is fixable with a better filter, a longer hold, or a wallet list. We
were paying 560bp to harvest a distribution centred on zero, and every "edge" that
appeared large enough to matter turned out to be an artifact: a deflated mayhem
denominator, a peak-tuned trail handed its own peak, a 50pp wallet signal that vanished
once the stop-loss was applied, and a graduation curve built from one price observation
per token carried into nine checkpoints.

**So volume is the wrong way to choose a venue.** pump.fun has enormous volume. What
matters is whether the opportunity is larger than the toll.

## Stage 0: qualify the venue BEFORE any signal work

Both numbers are measurable without a strategy, and the first one is measurable without
even a hypothesis. No feature engineering, no backtest, no filter happens until both are
in hand.

### 0a. The toll — what a round trip costs

One small round trip, in and straight back out, holding for no time. The value that does
not come back is the toll: fees, slippage, impact, priority and rent together, with no
model in between. Exactly the method used for the on-curve probe, because a modelled cost
is how a 4pp slip guess sat unexamined in the cost model for weeks.

**Reported as basis points, with the size it was measured at**, since impact is a function
of size and a toll quoted without one is not a number.

### 0b. The opportunity — what the distribution looks like

Over a representative sample of the instruments actually tradeable there, at several
horizons on a FIXED population:

- median absolute move
- share of observations exceeding the measured toll
- whether the distribution has any dispersion at all

Buy-and-hold on raw data, deliberately. No strategy, no stops, no ladder — this measures
the raw material, not a strategy's treatment of it.

### The gate

> **A venue qualifies only if the median absolute move at some horizon exceeds the
> measured toll by at least 3x.**

Three, not one. A venue where the typical move merely equals the toll needs a perfect
signal to break even, and we do not have a perfect signal anywhere. pump.fun scores
0.0% against 560bp, which is zero times the toll.

**Fails the gate → the venue is rejected and nothing else is built on it.** That decision
costs a day. Discovering it after building a strategy costs a month, which is the actual
price already paid once.

## Order matters, and it is fixed

Toll first, opportunity second, signal last. Reversing it is how this project spent weeks
tuning exits on a book that was under water before costs. A signal is only worth looking
for once the arithmetic allows one to pay.

## What does NOT transfer

**The filter does not transfer.** Its +5.2pp of out-of-sample sorting is real and it is
built from dev holdings, buyer concentration, launch velocity and creator priors. None of
those exist on a perps book. A venue that is not a launchpad means starting the signal
search from zero, and that cost belongs in the decision rather than being discovered
later.

**The harness does transfer**, and it is the asset: pre-registration, fixed populations,
out-of-sample splits by time, bootstrap intervals that assert they contain their own mean,
instrument validation before interpretation, and a bias toward assuming a large clean
result is an artifact until it survives being attacked.

## Traps, carried forward because each one has already produced a wrong answer here

1. **Population mismatch.** Coverage decays with horizon; every figure comes from rows
   present at ALL checkpoints up to the one reported, with `n` printed beside it.
2. **Survivorship.** An instrument still quoted at the last horizon is a survivor. What
   stops being quoted is an outcome, not a missing value.
3. **The instrument before the result.** Validate that a recorded price is physically
   reachable, and that a path was actually OBSERVED rather than carried forward from one
   reading. 175 of 175 graduation rows were flat because nothing checked that.
4. **A number with no referent.** A toll quoted without a size, or a bar carried over from
   another venue, decides nothing. The graduation bar was set from a bonding-curve round
   trip and had to be amended before any data was read.
5. **Deciding after looking.** Thresholds are fixed in advance. If one turns out to be the
   wrong threshold, that gets written down as a dated amendment, not quietly moved.

## What running this needs

- **Network access from the analysis environment.** Outbound is currently denied (403 on
  CONNECT to the exchange API, as to Dexscreener and the Solana RPC), so the data has to
  be fetched by the bot or supplied as an export, exactly as the journal is today.
- **A small funded account on the candidate venue**, for 0a. The toll cannot be modelled;
  that is the entire lesson.
- **Nothing else.** No strategy, no features, no backtest until the gate is passed.

---

# Result: Kalshi and Polymarket, measured 2026-09-28

Stage 0 run against both live venues. Both REJECTED, and neither needed a funded account
or a single order.

## Kalshi — rejected

800 events fetched. Two parser errors were caught before they became results:

- `yes_ask` in cents does not exist; the live field is `yes_ask_dollars`. The parser
  returned null rather than valuing an $0.11 leg at $11.
- `mutually_exclusive` was copied into `exhaustive`. It means AT MOST one leg resolves
  YES, not exactly one. That produced 21 "profitable" baskets which were every one a
  total loss: *What will be the 51st state?* lists 8 states for $0.156 and pays nothing
  if no state joins; *Who will the next Pope be?* lists 7 cardinals out of 250+.

With exhaustiveness required rather than inferred: **7 genuinely complete baskets out of
549 parsed events**, median gross edge **−22%**, and **not one costs less than $1** — with
fees set to zero. No fee schedule rescues a basket already above a dollar.

## Polymarket — rejected

600 events. `negRisk` is a stronger marker than Kalshi's flag, and the eligible baskets
are real: numeric ranges that tile the line rather than named candidates with a missing
"none".

- **205 negRisk events with 2+ legs, but only 22 fully quoted.** The other 183 have at
  least one leg with no ask, so the basket cannot be assembled at any price.
- Median sum of asks **$1.051** — baskets cost 5% more than they pay, which is what an
  efficient market looks like.
- **Two below $1**, and both are genuinely exhaustive.

Capital-time then decides it, which is the reason that model exists:

| basket | gross | days | annualised, at ZERO fees |
|---|---|---|---|
| GDP growth in 2026 | 2.80% | 123 | 8.83%/yr |
| Maduro Prison Time | 0.80% | 460 | 0.64%/yr |

And the fee closes it. Polymarket publishes `feeSchedule {rate: 0.05, takerOnly: true}`.
Against a 2.80% gross edge:

- 5% of notional → fee 4.86%, **net −2.06%**
- 5% × min(p, 1−p) per leg → fee 4.26%, **net −1.46%**

Every reading of a 5% taker rate exceeds the edge. The single best genuinely-exhaustive,
genuinely-underpriced basket across 600 events loses money.

## What this cost, and what it would have cost

Both venues qualified and rejected in under two hours, for the price of API calls. Under
the old approach this is a month of building a bot, funding an account, and discovering
the fee arithmetic afterwards.

The addressable universe is the quieter finding and the more damning one: 7 baskets on
Kalshi, 22 on Polymarket. Even a real dislocation would have almost nothing to trade.

---

# Result: liquid Solana tokens, measured 2026-09-28 — QUALIFIES

The first venue to pass Stage 0. Measured on 8 Solana memecoins above $20M cap and $2M
daily volume, 2,089 hourly bars each over 90 days, with the round trip QUOTED live through
Jupiter rather than modelled.

## The toll collapses

Quoted SOL → token → SOL at 1 SOL, live:

| token | round trip |
|---|---|
| fartcoin | **12.4 bp** |
| dogwifcoin | **17.0 bp** |
| popcat | **51.1 bp** |

Against pump.fun's measured **1,155 bp**. A 20–90x reduction, and it is the same chain,
the same wallet and the same infrastructure — the cost was never Solana, it was trading a
bonding curve with no depth.

## The opportunity is no longer zero

Median ABSOLUTE move, pooled across the eight tokens:

| horizon | median move | vs 17bp toll | vs 51bp toll |
|---|---|---|---|
| 1h | 44 bp | 2.6x — **fails** | 0.9x — **fails** |
| 4h | 88 bp | 5.2x | 1.7x — fails |
| 12h | 148 bp | 8.7x | 2.9x — fails |
| 24h | 221 bp | 13.0x | 4.3x |
| 72h | 404 bp | 23.8x | 7.9x |

pump.fun's median 30-second move was **0 bp** against 1,155 bp. That is the whole
difference between six dead hypotheses and a venue worth working on.

## The correction the measurement makes to the idea

The idea was pitched as DAY TRADING on momentum. **The intraday horizon is precisely the
one that fails.** At 1h the median move is 44bp against a 17bp toll — 2.6x, under the
pre-registered 3x — and against a 51bp toll it is 0.9x, which is paying more than the
typical move is worth.

The gate passes at **4h and beyond on deep tokens, 24h and beyond on thinner ones**. So
the venue qualifies and the holding period does not: this is a multi-hour-to-multi-day
strategy, not a day-trading one, and the difference is the entire result.

## What this does NOT say

It says the arithmetic now permits an edge to pay. It does not say momentum predicts
anything — that is the next question and it has never once gone our way here. Crypto
momentum is among the most heavily traded strategies in existence and we have no
informational advantage.

Also: the toll is QUOTED, not filled. Jupiter quotes carry price impact but not latency
slip, priority fees or a transaction that fails to land, so it is a lower bound exactly as
the code labels it. And none of the pump.fun features transfer — the signal search starts
from zero.
