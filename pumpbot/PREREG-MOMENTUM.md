# Pre-registration: does momentum predict return on liquid Solana tokens?

Written before the question is asked of the data, and the data is already on disk — 8
tokens, 2,089 hourly bars each. That is exactly the situation in which a pre-registration
is worth something and exactly the situation in which it is tempting to skip.

Stage 0 is passed: a 12–17bp quoted round trip on deep tokens against a median move of
88bp at 4h and 404bp at 72h. **That says the arithmetic permits an edge to pay. It says
nothing about whether momentum is one.** Six hypotheses have died here and every single
apparent edge along the way turned out to be an artifact.

---

## The claim, stated so it can fail

> Among liquid Solana tokens, the return over a lookback window L predicts the return over
> a following window H, by enough to beat buy-and-hold on the same universe after a 17bp
> round trip per trade.

## What is tested, fixed now

- **Lookbacks L:** 4h, 12h, 24h, 72h
- **Horizons H:** 4h, 12h, 24h, 72h
- **1h is excluded.** It already failed the Stage 0 toll gate at 2.6x, under the
  pre-registered 3x. Testing a horizon whose moves cannot pay for themselves would be
  looking for a number to report rather than a strategy to run.
- **Long-only.** Shorting spot memecoins is not practically available to this account, so
  a long/short result would not be tradeable and must not be quoted as if it were.
- **16 combinations**, so the threshold is Bonferroni-corrected to **0.05/16 = 0.003**.

## The benchmark is buy-and-hold, NOT zero

This is the single most important design choice here, and it is forced by a bias that
cannot be removed.

**The universe is survivorship-biased and there is no honest way around it.** The eight
tokens were selected from today's list of Solana memecoins above $20M cap. Tokens that
collapsed over the same 90 days are absent by construction. Any long-only strategy will
look good on a sample of survivors, because the sample was chosen by the outcome.

So the comparison is against **buy-and-hold on the identical universe**, which carries the
identical bias in the identical direction. Beating zero proves nothing. Beating
buy-and-hold is the only claim the data can support, and even that is an upper bound.

## The numbers, fixed in advance

| Question | Decides it | Acts if |
|---|---|---|
| Does momentum beat holding? | mean net return per trade, OUT of sample, minus buy-and-hold over the same bars | > 0 with the corrected interval excluding 0 |
| Is it the signal or the sample? | the same test on the WORST-performing half of the universe | the sign survives |
| Is it one lucky pair? | how many of the 16 (L,H) cells are positive out of sample | a majority, not one |

**Out-of-sample:** split each token's series 60/40 in time, earliest first. In-sample
figures are never quoted as the result.

**Costs:** 17bp deducted per round trip, the measured deep-token quote. Applied to every
entry and exit, including ones the strategy would hold through.

## What falsifies it

Any of these, stated now so none can be argued away later:

- out-of-sample mean does not beat buy-and-hold
- the corrected interval contains zero
- the sign flips between the in-sample and out-of-sample halves
- only one or two of the 16 cells are positive, which is what noise looks like across a
  grid

## Traps, each of which has already produced a wrong answer on this project

1. **Look-ahead.** The signal must be computed from bars STRICTLY before the entry bar.
   The trailing-stop sweep improved monotonically to an absurd 2% because the replay was
   handed its own peak.
2. **Overlapping windows.** Hourly bars with a 72h horizon overlap 71 times over, so
   observations are not independent and a naive interval is far too narrow. Intervals come
   from a block bootstrap, not a per-observation one.
3. **Population mismatch.** Every figure comes from the same bars for every (L,H) cell.
   Coverage that varies by cell measures selection, not returns.
4. **Survivorship**, above. Benchmarked against buy-and-hold rather than zero, and any
   positive result is reported as an upper bound.
5. **Deciding after looking.** The grid, the threshold, the split and the benchmark are
   fixed here. If one is wrong, it gets a dated amendment, not a quiet edit.

## What happens on each outcome

- **Beats buy-and-hold, out of sample, majority of cells:** build it, and probe it live at
  small size the way the fill probe was run. A quoted toll is still not a filled one.
- **Fails:** record it here with the numbers. That is six hypotheses and one venue
  qualified, and the next question is whether any signal works here — not whether this
  venue does, which is now settled.

---

# Result, 2026-09-29: REJECTED

Run exactly as registered. 8 tokens, 2,089 hourly bars, 60/40 split by time, 17bp per
round trip, long-only, benchmarked against buy-and-hold on the identical bars.

| | |
|---|---|
| cells with a positive out-of-sample edge | **1 of 16** |
| cells whose Bonferroni-corrected interval excludes zero | **0 of 16** |

The single positive cell is 12h/12h at **+0.06%**, with an interval of [−0.73%, +0.71%]
straddling zero. One cell in sixteen is what noise looks like across a grid, which is
exactly what the pre-registration said in advance it would be.

Every falsification condition fired:

- the out-of-sample mean does not beat buy-and-hold — it loses in **15 of 16** cells
- every corrected interval contains zero
- only one cell is positive

## The shape of the loss is the ordinary one

Buy-and-hold returns +0.90% over 72h on this universe; the momentum strategy returns
+0.54% to +0.72% on the same bars. **The signal is not adding anything and the trading is
subtracting.** That is what a strategy with no edge and real costs looks like, and it is
the same conclusion the pump.fun replay reached by a completely different route.

## The buy-and-hold number is not an opportunity

It is worth saying plainly, because +0.90% per 72h looks like something: **that figure is
the survivorship bias the pre-registration named.** The eight tokens were chosen from
today's list of survivors, so holding them over the window they survived is guaranteed to
look good. It is not tradeable and it is not a finding. It exists here only as the
benchmark momentum had to beat, and did not.

## What this does and does not kill

**Momentum, on this universe, at these horizons, long-only: dead.**

**The venue is not.** Stage 0 stands on its own: a 12–17bp round trip against a median
88bp move at 4h is still an order of magnitude better than anything on pump.fun, and it
was measured rather than assumed. What has been shown is that the most obvious signal does
not work there — which was always the likely outcome for the most heavily traded idea in
crypto, and is why it was tested first and cheaply rather than built first and discovered
later.

Seven hypotheses, one qualified venue, no edge yet.
