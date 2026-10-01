# Pre-registration: does Jev know something Polymarket's price doesn't?

Written 2026-10-01, before any Polymarket outcome has been joined to any Jev answer.

## The idea

Jev is a probability forecaster. A Polymarket price *is* a probability. So the question
is direct: **does Jev's forecast add information to the market price, enough to bet on
after costs?** This is not the arbitrage idea rejected earlier (`PREREG-VENUE.md`); it
asks whether Jev can tell when a market is wrong.

**Why it might work:** Polymarket lists thousands of small markets (about 2,100 with
$1,000+ volume closed in the 12 hours before this was written: weather, stock and crypto
levels, AI rankings, speech counts). Thin markets can carry stale prices.
**Why it might not:** prices are usually well calibrated, and language-model forecasters
generally land near the crowd, not above it. **Expected result: NO**, but this is the
place Jev's design fits best, and the test costs well under a dollar.

## Population — fixed now

- Polymarket markets with outcomes exactly `["Yes","No"]`, `volumeNum >= 1000`,
  `endDate` from **2026-08-01 to 2026-09-30**, resolved (one outcome price 1, the other 0).
- **Sample:** up to 3,000 markets, seed 20261001, drawn uniformly from the population.
- **Decision time:** 24 hours before `endDate`. The market must have a price-history
  point within the 6 hours before that, or it is dropped and counted.
- **Market price at decision:** the last `prices-history` point at or before decision
  time (hourly fidelity). Markets whose decision price is below 0.02 or above 0.98 are
  dropped and counted: there is nothing to win there after costs.

## What Jev sees

The question, the market's description (resolution rules), and "Today is {decision
date}". **Not the market price** — Jev forecasts independently, and the price enters
only in the combination below. Nothing dated after the decision is sent.

Question (Noul): **"This question will resolve Yes."** with the market text as `state`.

## Instrument checks — run first; any failure voids the result

1. **Hindsight.** The window is recent, but Jev must be shown not to know the outcomes.
   Two market types cannot be forecast a day ahead from the question text alone: exact
   temperature buckets ("highest temperature in X be 31°C") and exact sports scores. On
   every such market in the sample, Jev's Brier must **not** beat the market price's
   (one-sided, block bootstrap by end date, 5%). If it does, Jev is remembering, not
   forecasting, and the backtest is void; only the forward test below can then decide.
2. **Reads its input.** Swapping the question for its negation must move the answer the
   other way on at least 90% of 50 sampled markets.
3. **Noise.** sd 0.007 measured in `PREREG-JEV.md`; one call per market.

## The models (60/40 split by end date; every fit in-sample only)

| model | what it is |
|---|---|
| **market** | the decision-time price |
| **Jev** | Jev's answer, isotonic-recalibrated in-sample |
| **market + Jev** | logistic regression on logit(price) and logit(Jev) |

## Costs

Taker entry at the decision price plus **1 cent of half-spread**, plus the fee from the
market's `feeSchedule`: `fee per share = rate × p × (p × (1 − p))^exponent`. That
formula is checked against Polymarket's documentation and recorded in an amendment
before scoring. **Also reported** at the harsher older bound,
`rate × min(p, 1 − p)` per share. Held to resolution, so there is no exit cost.

## Strategy

For each market: if market + Jev puts YES more than the full cost above the price, buy
YES; if it puts NO more than the cost above (1 − price), buy NO; otherwise skip. $1 per
bet. Report profit per dollar staked, number of bets, and hit rate.

## What decides it

**YES only if both hold out of sample**, Bonferroni over two (the 1.25th percentile must
be above zero; block bootstrap by end date):

1. **Information:** market + Jev has a lower Brier than the market alone.
2. **Money:** the strategy's profit per dollar, after the primary cost, is above zero.

**Reported, not deciding:** the same under the harsher fee bound; results by category
(weather, crypto/stocks levels, politics and other); Jev alone vs the market.

## If YES — before any money moves

1. **Forward test, 14 days, paper.** Live markets, real best-ask prices read at decision
   time, settled on resolution. This also removes any doubt about hindsight. It must be
   net positive after real costs.
2. Then live with **$50 of the $200**, $1–2 per bet, no market over 5% of the bankroll,
   stopped at a 20% drawdown.

Polymarket's terms limit who may trade there; check eligibility for your location before
any live step. Kalshi is the regulated US alternative and would need its own run.

## Budget

About 3,000 Jev calls at well under 1k input tokens each: roughly **$0.10**. Hard cap $5.
