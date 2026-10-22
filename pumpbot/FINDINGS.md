# What this project found

A record of seven hypotheses, one qualified venue, and no edge. Written at the point the
work was stopped, so that anyone returning — including us — starts from the results rather
than from the optimism.

---

## The one number that explains everything

> **Cost floor ~560bp. Median 30-second move: 0.0%.**

Every pump.fun hypothesis died on that ratio. We paid a 5.6% toll to harvest a
distribution centred on exactly zero — the median `multAt30s` over 3,593 clean rows was
`1.0000`, because most launches never trade again. No entry filter, holding period or
wallet list changes that arithmetic, which is why six different ideas failed the same way.

## What was tested, and what happened

| # | hypothesis | outcome |
|---|---|---|
| 1 | pump.fun launch sniping | **0.9637x gross** — under water before any cost |
| 2 | better entry filter | best of 29 out-of-sample splits: **0.9156x** vs 1.06 needed |
| 3 | longer holding periods | **monotone decay**, 0.9816x at 2s → 0.9430x at 60s |
| 4 | copy trading "smart" wallets | **strongly negative** — clean dose-response the wrong way |
| 5 | graduated tokens | **zero usable rows** in four days, three pricing architectures |
| 6 | Kalshi / Polymarket arbitrage | rejected in two hours, no capital risked |
| 7 | momentum on liquid Solana | 1 of 16 cells positive, **0 significant** |
| 7b | broad signal sweep | 3 families properly tested, **0 survived** |
| 8 | Jev (TypeSafe AI) on launch features | does **not** beat a free regression; raw calibration fails; adds nothing on top — `PREREG-JEV.md` |
| 9 | Jev forecasting Polymarket (blind to price) | **void**: incoherent Yes/No answers; worse than the market where it was scored — `PREREG-JEV-POLYMARKET.md` |
| 10 | weather forecast vs Polymarket temperature markets | **no**: the market already prices the forecast (model weight 0.08); bets not significant — `PREREG-WEATHER.md` |
| 11 | buying cheap (2–20¢) Polymarket sports contracts at the ask (Test A, Yes/No) | **no** (stopped early, day 5.9): −40.6% per $1 [−44%, −37%] on 10,650 bets; long shots won at the midpoint, so the buyer pays half the spread plus a 4% fee — `PREREG-POLY-SPORTS.md` |
| 12 | the same on two-way markets (Test B: over/unders, spreads) | **no** (stopped early): −32.3% per $1 [−43%, −21%]; betting the other side loses too (−1.8% / −3.0%) — `PREREG-POLY-SPORTS-B.md`, `EVAL-POLY-SPORTS-2026-10-15.md` |
| 13 | resting orders 1¢ above the best bid (Test C, the maker side) | **no** in substance (registered label INCONCLUSIVE: the cautious fill rule was mis-specified): real outcome −2.6% per $1 [−4.2%, −1.0%] on 12,463 paper fills; favourites were sold to us just before the price fell (about 2.6× the spread), long shots looked positive only against stub 50¢ kickoff prices — `PREREG-POLY-MAKER.md`, `EVAL-POLY-MAKER-2026-10-22.md` |

## The finding that reframed the rest

Wallets we labelled "smart" — those whose picks reached our +50% rung more often than
average — turned out to predict **collapse**, with a clean dose-response:

| | mean at 60s |
|---|---|
| baseline | 0.9430 |
| a smart wallet bought | 0.7370 |
| 2+ smart wallets | 0.6593 |
| smart share > 20% | **0.4409** |

They were not money to follow. They were the counterparty: buying pre-pump and selling
into us. **We were the exit liquidity**, which is why every entry rule failed — it was
never a bad filter, it was the wrong side of the trade.

## The one venue that qualified

Liquid Solana tokens (>$20M cap, >$2M volume) via Jupiter:

- round trip **12–17bp** measured live, against pump.fun's **1,155bp**
- median move **88bp at 4h**, **404bp at 72h**, against pump.fun's **0bp**
- passes the 3x gate at 4h+ on deep tokens

**The cost was never Solana.** It was trading something with no depth, minutes after it
existed. The venue is real and the arithmetic permits an edge to pay — we simply never
found one to pay it with.

## What was never tested

**On-chain flow.** Wallet accumulation, LP additions and withdrawals, holder
concentration, pool creation — public on Solana, absent from any price series, and the
only place a participant with retail latency and no venue relationship could plausibly see
what others ignore. It is weeks of indexing work, not an afternoon.

## The part that has value beyond this project

The harness, and the habit. Every apparent edge here was an artifact, and each was caught
by a specific guard that is now written down:

- **a deflated denominator** — mayhem mints off-curve, so entry price collapses to a third
  of launch and every multiple measured from it is fiction. Found as the root cause of the
  46x and 228x that carried the whole measured edge.
- **a replay handed its own peak** — a trailing stop that improved monotonically to an
  absurd 2%.
- **a 50pp signal that vanished** once the stop-loss was applied, because the stop already
  handled what it was detecting.
- **175 of 175 flat paths** built from one price observation each, carried across nine
  checkpoints.
- **a dashboard showing a 3.87x edge** that the analysis on the same data scored at zero,
  because the count was written twice.
- **21 "profitable" Kalshi baskets** that were guaranteed total losses, because
  `mutually_exclusive` means *at most* one, not *exactly* one.

Pre-registration, fixed populations, out-of-sample splits by time, intervals that assert
they contain their own mean, instrument validation before interpretation, and a standing
assumption that a large clean result is an artifact until it survives attack.

**That is what let two prediction-market venues be rejected in under two hours with no
capital at risk, where the first approach spent a month to reach a worse answer.**

## Honest closing position

Seven hypotheses. One venue that qualifies on arithmetic. No edge.

The negative results are the output, and they are specific enough to build on: we know
*why* launch sniping fails, we know the chart is exhausted on liquid tokens, and we know
exactly which stone is left unturned.
