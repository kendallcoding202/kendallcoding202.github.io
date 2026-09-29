# Pre-registration: is there ANY extractable signal in the price/volume series?

Momentum is rejected. This asks the broader question behind it — whether we have any
informational advantage on liquid Solana tokens — in the one form that can be answered
cheaply and decisively today.

## Where an edge could come from, and which of those this tests

Honestly enumerated, for a retail participant with RPC latency and no venue relationship:

| source | available to us? | tested here? |
|---|---|---|
| Latency / being first | **No.** MEV bots and colocated makers win this outright. | no |
| Cross-pool arbitrage | **No.** Jupiter's router already takes it; that is what it is for. | no |
| Orderbook microstructure | **No.** AMMs have no book. | no |
| Price/volume history | **Yes** — public, and we have it | **YES** |
| On-chain flow (wallets, LP moves, holders) | **Yes**, but needs indexing work | no — a separate question |
| Being right about the world | Not a systematic edge | no |

**So this settles exactly one thing: whether the freely available price/volume series is
predictable by us.** A negative does not rule out on-chain flow data, which is the one
remaining place a small participant could plausibly see something others ignore. It does
rule out everything that can be computed from a chart.

## What is tested, fixed now

Five STRUCTURALLY DISTINCT families — not variations of one idea, since testing momentum
five ways would only re-answer a question already answered:

1. **Mean reversion** — past return predicts the opposite sign
2. **Cross-sectional relative strength** — rank within the universe, top vs bottom
3. **Volume shock** — volume far above its own trailing average
4. **Volatility compression** — low realised vol preceding larger moves
5. **Price/volume divergence** — price falling on rising volume, and its inverse

Horizons: **4h, 12h, 24h, 72h**. 1h stays excluded; it failed the Stage 0 toll gate.

**20 cells. Bonferroni-corrected threshold: 0.05/20 = 0.0025.**

## The rules, unchanged from the momentum test

- **Long-only.** Shorting spot memecoins is not available to this account.
- **17bp per round trip**, the measured deep-token quote.
- **Benchmark is buy-and-hold on the identical bars**, never zero. The universe is
  survivorship-biased by construction — it is today's list of survivors — so a long-only
  strategy on it looks good for reasons that have nothing to do with skill.
- **60/40 split by time**, earliest first. In-sample figures are never the result.
- **Block bootstrap** sized to the horizon: hourly bars over 72h overlap 71 times, and a
  per-observation interval would be far too narrow to mean anything.
- **Signals use bars strictly before the entry bar.**

## What would make this a YES

> At least **3 of 20** cells positive out-of-sample with Bonferroni-corrected intervals
> excluding zero, and the sign holding between the in-sample and out-of-sample halves.

Three, not one. Momentum produced exactly one positive cell out of sixteen with an
interval straddling zero, which is what a grid of noise looks like — and saying so in
advance is the only thing that stops one lucky cell being written up as a finding.

## What would make it a NO

Fewer than 3 surviving cells. The conclusion then is specific and worth stating plainly:
**the chart contains nothing we can extract**, and the only remaining candidate is data
that is not in the chart.

## What happens on each outcome

- **YES:** the surviving family gets its own pre-registration and a live probe at small
  size, because a quoted toll is still not a filled one.
- **NO:** stop testing chart-derived signals on this venue. Either pursue on-chain flow
  data — which is real work and a genuinely different information source — or accept that
  seven hypotheses and one qualified venue have not produced an edge, and stop.

---

# Result, 2026-09-29: NO — with two families effectively untested

| | |
|---|---|
| cells that produced enough trades to test | **12 of 20** |
| positive out-of-sample | 3 |
| **surviving the full bar** (positive OOS **and** corrected interval excluding zero **and** sign held in-sample) | **0** |

Pre-registered bar was 3. The answer is **no**.

## The honest limitation: two families never fired

- **volume shock** (volume > 3x its 24h mean): **0 trades**. The threshold was too strict
  and the family was never exercised.
- **price down + volume up**: **15 trades**, below the 40-trade floor.

Those are **untested, not negative**, and counting them as evidence of absence would be
dishonest. Re-testing them means a dated amendment with a new threshold fixed *before*
looking — loosening a threshold until trades appear, on data already seen, is precisely
how a grid of noise becomes a finding.

So the real claim is narrower than the headline: **three families were properly tested —
mean reversion, volatility compression, cross-sectional relative strength — and none
survived.**

## The one that looked alive, and why it is not

Mean reversion was the only family with a positive out-of-sample edge:

| horizon | in-sample edge | out-of-sample edge | 99.75% CI |
|---|---|---|---|
| 24h | **−1.00%** | **+1.19%** | [−0.06%, +2.48%] |
| 72h | **−0.22%** | **+1.64%** | [−1.33%, +4.44%] |

**The sign flips between the halves** — negative in-sample, positive out-of-sample — which
is a pre-registered falsification condition, written down precisely because a result that
reverses across a time split is what noise does. Both intervals also contain zero, the 24h
one only barely.

It is the closest thing to a signal this project has produced, and it fails. Stating that
plainly is the point: a +1.19% out-of-sample edge quoted without the −1.00% in-sample
figure beside it would look like a strategy.

## What this settles, and what it does not

**Settled: the chart contains nothing we can extract.** Three structurally distinct
families, out of sample, against the right benchmark, with correct intervals — nothing.
Combined with momentum's rejection, that is four families and 28 cells.

**Not settled: on-chain flow.** Wallet accumulation, LP additions and withdrawals, holder
concentration, and pool creation are all public on Solana, none of them are in a price
series, and none of them were tested here. That remains the only place a participant in
our position could plausibly see something others ignore — and it is real indexing work
rather than an afternoon.
