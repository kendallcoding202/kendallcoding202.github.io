# Pre-registration: does Jev add anything we cannot get for free?

Written before an API key exists, so no answer from the model has been seen. Every
threshold below is fixed now.

## What is being tested, and what is not

Jev (TypeSafe AI, launched 2026-09-15) is a non-LLM classifier: a typed question in, a
probability out, in 70–500ms, at $0.042 per million input tokens. Its central claim is
that those probabilities are **calibrated**. That claim is unverified — TypeSafe's own
benchmarks score agreement with other frontier models rather than real outcomes, an
independent test found it over- and under-confident by question type, and one analysis
reports it assigns 0.92 to a fair coin landing heads.

**This tests one narrow thing: given only the numeric features we already journal,
does Jev sort launches better than a free model fitted on the same numbers?**

It is expected to fail, and saying so in advance matters. Those same features were
already searched thoroughly: the shipped filter reaches 0.9637x gross on the trades it
took, and four signal families across 28 cells found nothing on liquid tokens. A faster
judge of the same inputs should reach the same answer. The test is worth running
anyway because it costs under a dollar, and because a negative here is what licenses
Phase 2 — giving Jev inputs we do NOT have as numbers.

**Not tested here:** unstructured inputs (a project's X account, dev wallet history, LP
behaviour). That is Phase 2, sketched at the end and NOT committed to until Phase 1 is in.

## Instrument checks — run first, and any failure stops the test

The pipeline has produced an artifact at every stage of this project, so the instrument
is checked before a single outcome is scored.

1. **Fair coin.** Noul: "A fair coin is flipped. It lands heads." Must return 0.40–0.60.
   A model that cannot get this right has no claim to calibration, and its probabilities
   cannot be used as probabilities — only, at best, as rankings.
2. **Determinism.** The same row asked twice must return the same probability within
   0.01. If it does not, every downstream number carries noise we have not measured.
3. **Reads its input.** A row with the outcome stated in plain text must score above 0.9.
   If not, the model is not using the context, and any result is coincidence.
4. **Shuffled-feature control.** Features permuted across rows, so each row carries
   another row's numbers. Out-of-sample performance must fall to the base rate. If it
   does not, something other than the features is carrying the signal — almost always
   leakage — and the main result is void.

Checks 1 and 2 are reported as findings about the vendor's claims whatever happens next.

## Data

- **Source:** the 2026-09-23 journal export (40,380 rows, mint and wallet addresses
  already stripped by the export).
- **Exclusions, applied before sampling:** `peakMultiple > 16`, and `f_mayhem = 1`. The
  first are physically unreachable on a curve; the second are measured against a
  deflated denominator, so their outcomes are fiction either way.
- **Label:** `hitFirstRung` — did the launch reach +50%. Binary, which is what a Noul
  question answers.
- **Sample:** 5,000 rows drawn with seed 20261001 from the clean population, then split
  **60/40 by `finalizedAt`**, earliest first. In-sample figures are never the result.

## Leakage — the trap that would make this look like it works

**Only `f_*` columns are sent to Jev. Every outcome column is excluded by allowlist, not
denylist:** no `peakMultiple`, `endMultiple`, `troughMultiple`, `multAt*`, `trailExit*`,
`hitFirstRung`, `timeStopMultiple`, `staleExitMultiple`, or anything finalised after the
decision.

`f_peakMarketCapSol` was checked before writing this, because "peak" reads like a
post-decision quantity. It is not: `Candidate.apply` takes a running max over events
seen DURING the observation window, and `featuresOf` snapshots it inside `track()` at the
moment of the decision. It is the peak before entry, and it stays in.

Instrument check 4 is the backstop if this reasoning is wrong.

## Two ways of asking, both registered

The one independent evaluation found 62.6% when asked a single broad question and 95%
when split into narrow questions with weights fitted on labelled data. Both are tested:

- **A — single question:** "This launch will reach +50% within its observation window."
- **B — decomposed:** five narrow questions, combined by logistic weights fitted on the
  in-sample half only:
  1. Buying is driven by many independent wallets rather than a few.
  2. The developer still holds a significant share.
  3. Buy pressure is accelerating rather than fading.
  4. Holdings are concentrated in a small number of wallets.
  5. This looks like an organic launch rather than a coordinated one.

## The comparisons that decide it

Jev is not compared to zero or to nothing. It is compared to what we could do for free:

| baseline | what it is |
|---|---|
| **climatology** | predict the in-sample base rate for every row |
| **logistic regression** | fitted in-sample on the same `f_*` columns Jev sees |

**Primary metric:** out-of-sample **Brier score**, with a block-bootstrap interval.
Raw Jev probabilities and probabilities recalibrated in-sample (isotonic) are both
reported; the decision is taken on the recalibrated ones, since production would
recalibrate anyway, while the raw ones are reported as a test of the vendor's claim.

**Strategy check:** rank the out-of-sample rows by each model's probability and take
the top rows at the SAME selection rate the shipped filter uses. Score them with
`simulateLadder`, net of the measured round trip. Equal selection rate is what makes
the comparison fair — any model looks better by being pickier.

## What would make it a YES

> Jev (A or B) beats logistic regression on out-of-sample Brier, with the
> Bonferroni-corrected interval (0.05 / 2 = 0.025) excluding zero, **and** its top
> selection beats the filter's selection at equal rate after costs.

Both are required. Better probabilities that do not change which trades get taken are
an academic result, not a trading one.

## What would make it a NO

Jev does not beat a free logistic regression on the same numbers. Conclusion, stated
now: **on numeric features, Jev adds nothing we cannot fit ourselves for free**, and the
only question left is whether it adds anything on inputs that are not numbers.

## Budget

Expected cost: ~5,000 rows x 6 questions x ~600 tokens ≈ 18M tokens ≈ **$0.76**.
**Hard cap: $5.** Exceeding it means the token estimate was wrong, and the run stops
until it is understood rather than continuing to find out.

## Phase 2 — sketched, NOT committed

If Phase 1 is a NO, which is expected, the value of Jev is in judging things that are
not already numbers. That needs new collection — a project's X account, the dev wallet's
history, LP movements — none of which the journal stores. It gets its own
pre-registration, with the same instrument checks, before any of it is built.

If Phase 1 is a YES, which would be surprising, the first thing to suspect is leakage,
and the result is re-run on a fresh export before anything else is done with it.
