# Pre-registration: do graduated tokens clear the toll?

Written **before** the collector exists and before any data arrives, on purpose. Five
hypotheses died this week and three of them died only because the analysis was
pre-committed — the trailing-stop sweep improved monotonically to an absurd 2% because
the replay was handed the peak, the wallet signal looked enormous on raw paths and
vanished at the strategy level, and the horizon curve read as break-even until a 15%
contaminated slice was excluded. Deciding what a number means after seeing it is how all
three nearly survived.

---

## Why this hypothesis is different from the five that failed

Every previous idea kept two terms fixed:

> **Cost floor ~5.6pp. Median move being traded: 0.0%.**

Median `multAt30s` is exactly 1.0000 on 3,593 clean rows. We were paying a 5.6% toll to
harvest a distribution centred on zero. No entry filter, holding period or wallet list
changes that arithmetic, which is why all five failed the same way.

This hypothesis changes the first term. A graduated token has filled its curve (~115 SOL),
trades on a real AMM with genuine price discovery, and is drawn from the ~1-2% of launches
that got there. Daily moves in that population are plausibly 10-100% against the same
~5.6pp toll. **The opportunity may finally be larger than the toll.** That is the only
structural reason to expect a different answer, and if it turns out to be false the
hypothesis deserves to die as quickly as the others.

## The claim, stated so it can fail

> Among tokens that graduate, something observable **at or shortly after graduation**
> predicts the subsequent multi-hour return, by enough to clear a ~5.6pp round trip.

## What gets collected

On every `migrate` event — not only the ones we hold, which is all `#onMigrate` keeps
today — open an observation and record a price path at 1, 5, 15, 30, 60, 120, 240, 480 and
1440 minutes past graduation, plus:

- graduation timestamp, mint, destination pool
- market cap and reserves at graduation
- the pre-graduation features we already compute, so the launch-time filter can be tested
  against a post-graduation outcome
- how long the token took to graduate from launch

No trading. Observation only, exactly as the shadow tracker works today.

## The numbers, fixed in advance

**Powered at n >= 300 graduations with a complete path to 240 minutes.** Below that
nothing is decided — the wallet result had n=191 and I reported an uninformative interval
as a negative, which is a mistake this line exists to prevent.

| Question | Decides it | Acts if |
|---|---|---|
| Is the population worth trading at all? | mean multiple at 240m, fixed population | > 1.06 |
| Is there dispersion to sort? | share of graduations above 1.20 at 240m | > 15% |
| Does our existing filter sort here? | top vs bottom half by filter score, out-of-sample | gap > 5pp |
| Which horizon? | the checkpoint curve on ONE fixed population | reported, never selected post hoc |

**Bonferroni:** four questions, so the threshold is 0.0125 rather than 0.05.

**Out-of-sample:** split by `graduatedAt`, 60/40, earliest first. In-sample numbers are
never quoted as the result.

## What would falsify it

Any of these and the hypothesis is dead, stated now so it cannot be argued away later:

- mean at 240m <= 1.06 on the fixed population
- the checkpoint curve decays monotonically, as the on-curve one did
- the filter's top and bottom halves are within 5pp out-of-sample

## Traps this analysis must not fall into

Each one has already cost this project a wrong answer:

1. **Population mismatch.** Coverage will decay with horizon — 13 of 6,723 rows reached
   900s last time. Every curve is computed on rows present at ALL listed checkpoints, and
   `n` is printed beside every figure.
2. **Survivorship.** A token still quoted at 1440m is a survivor. Report the share that
   stop being priced, and treat "no quote" as an outcome rather than a missing value.
3. **Buy-and-hold is not the strategy.** The wallet signal was 50pp on raw paths and
   exactly zero once the stop-loss was applied. Every headline is scored through
   `simulateLadder`, not through a path multiple.
4. **Contamination.** Mayhem and impossible multiples are excluded before anything is
   computed, on `features.mayhem` rather than a multiple ceiling.
5. **Deciding after looking.** The thresholds above are the thresholds. If one turns out
   to be the wrong question, that gets said out loud and written down, not quietly moved.

## What happens on each outcome

- **Clears the bar:** build the entry path for graduated tokens and probe it live at
  0.01 SOL, the same way the fill probe was run.
- **Fails:** record it here with the numbers, stop work on pump.fun entirely, and move the
  sorting methodology to a venue where the toll is 10-30bp — the only remaining idea.

---

## AMENDMENT — 2026-09-24, before any row was analysed

Recorded as an amendment rather than an edit, because a pre-registration quietly rewritten
is not one. No outcome data has been looked at: 0 rows finalised, and the collector had
been running a few hours.

**The 1.06x bar was derived from the wrong venue.** It came from the ~5.6pp best-case
round trip on a pump.fun BONDING CURVE — `feePct` 1.5 and `priceImpactPct` 0.25, which is
a single set of numbers with no venue distinction anywhere in the cost model. This
hypothesis trades graduated tokens on **PumpSwap**, which is a different venue: an AMM
holding roughly 85 SOL of real reserves at graduation, where impact for a 0.01-0.1 SOL
order is far smaller than on a young curve, and where the fee schedule is not pump.fun's.

Carrying a bonding-curve toll into a PumpSwap decision could fail in either direction — a
bar set too high rejects a viable strategy, one set too low accepts a losing one. Both are
worse than admitting the number is not yet known.

**So the bar is now derived, not fixed:**

> act only if the mean at 240m exceeds **1 + toll**, where `toll` is the MEASURED
> PumpSwap round trip, not the bonding-curve figure.

`toll` has to be measured the same way the bonding-curve one was — from real fills, by the
probe, on graduated tokens — before any verdict is read. Until it exists, the dashboard
keeps showing 1.06 as a placeholder and that number carries no authority.

Everything else stands unchanged: n >= 300 complete to 240m, the 60/40 split by
`graduatedAt`, the Bonferroni threshold of 0.0125, the four questions, and the five named
traps.

**What this does not change:** if the curve decays monotonically the way the on-curve one
did, the hypothesis is dead regardless of where the toll lands, because no toll makes a
decaying curve profitable.
