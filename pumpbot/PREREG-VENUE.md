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
