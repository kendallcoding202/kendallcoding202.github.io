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

---

## AMENDMENT 1 — 2026-10-01, after instrument checks 1–3, before any outcome was scored

No journal row has been sent to the model. Everything below concerns the instrument.

**Model pinned: `jev-latest`.** The registered `jev-1.13` is rejected by the API as an
unknown model; `/v1/models` serves `jev-latest` and `jev-preview`. The stable one is used,
and the response reports itself as `jev-1.13.0`. Chosen before any outcome query.

### Instrument results

| check | result | verdict |
|---|---|---|
| 1 · fair coin | 0.42–0.44; **0.43 even when told "exactly 50%"** | pass (band 0.40–0.60) |
| 1 · six on a die | 0.17, 0.17 against a true 0.167 | pass |
| 2 · determinism | 20 repeats: mean 0.438, **sd 0.007**, range 0.43–0.45, 3 distinct values | **fails as written** |
| 3 · reads its input | outcome stated YES → 0.93–0.94; stated NO → 0.04 | pass |

The reported "0.92 on a fair coin" did **not** reproduce. What did appear is a consistent
lean of about six points below 0.5 at the midpoint — which is the reason the decision is
taken on recalibrated probabilities rather than raw ones.

### Check 2 — why the threshold, not the model, is wrong

The registered tolerance was 0.01. **The API answers in 0.01 steps**, so that tolerance
could only be met by a perfectly deterministic model: it tested for the absence of any
noise rather than for noise large enough to matter. Its stated purpose was to stop
"noise we have not measured" from contaminating downstream numbers. The noise is now
measured — sd 0.007, never more than one step either side — and it is roughly two orders
of magnitude below any Brier difference that could decide this test at n ≈ 2,000.

Replacement: **one call per row, with the measured sd reported alongside every result.**
Averaging repeated calls was considered and rejected; it would triple cost and time to
remove noise already shown to be negligible.

This amends a threshold that was demonstrably mis-specified, found before scoring. It
does not move any threshold on outcomes.

### Data

`j2.csv` — the 2026-09-23 export, 40,380 rows, as registered. Already on disk.

### Strategy check — a problem found before it could be run

The strategy check compares Jev's top selection with the shipped filter's "at the same
selection rate". The export caps rejected and explored rows at 20,000 each, so the share
of `bought` rows in the file (~0.9%) is an artifact of the caps, not the filter's real
pass rate, and a 5,000-row sample would hold only ~19 out-of-sample `bought` rows.

The check is only reached if Jev first beats logistic regression on Brier — both are
required for a YES. **If it is reached, its selection rate and comparison set will be
fixed in a further dated amendment before it runs.** If Brier fails, the result is NO and
the strategy check is moot.

## Results — 2026-10-01

**Verdict: NO.** Jev does not beat a free logistic regression on the same numbers. The
strategy check was not reached and is moot.

Run with `research/jev-test.mjs` (as registered plus amendment 1). Clean population
39,007 rows; sample 5,000; in-sample 3,000, out-of-sample 2,000; in-sample base rate
10.77%. 38 `f_*` features sent (`f_mayhem` dropped as constant after its exclusion).
Total spend **$0.23** of the $5 cap.

Leakage audit before any call: `f_subLaunchPrice` is set inside `Candidate.apply` from
events during observation, and `f_mayhemLikely` is `mayhem || subLaunchPrice`; both are
snapshotted by `featuresOf` inside `track()` at the decision. Both stayed in.

### Instrument check 4 — PASS

Features permuted across out-of-sample rows: Brier 0.12875 against climatology 0.09712,
improvement −0.0316 [−0.0385, −0.0252]. Shuffled features do worse than the base rate, so
nothing other than the features was carrying signal.

### The registered comparison (out-of-sample, n = 2,000; lower is better)

| model | Brier |
|---|---|
| climatology | 0.09712 |
| logistic regression | 0.08655 |
| Jev A, raw | 0.09806 |
| Jev A, recalibrated | 0.08400 |
| Jev B, decomposed | 0.08282 |

| Jev vs logistic regression | improvement | interval (Bonferroni 0.025) | |
|---|---|---|---|
| A, recalibrated | +0.00256 | [−0.00329, +0.00801] | does not beat |
| B, decomposed | +0.00373 | [−0.00323, +0.01160] | does not beat |

Instrument noise sd 0.007 (amendment 1), well below these differences. The point
estimates favour Jev by 3–4% of Brier; neither interval excludes zero.

### Raw calibration — the vendor's claim fails here

| Jev's raw probability (decile mean) | 6.5 | 9.1 | 11.7 | 14.8 | 18.7 | 22.7 | 26.8 | 32.2 | 38.2 | 46.6 |
|---|---|---|---|---|---|---|---|---|---|---|
| what actually happened, % | 0.0 | 1.0 | 1.0 | 2.5 | 4.0 | 7.0 | 13.5 | 17.5 | 25.5 | 37.0 |

Ordering is clean and monotone; the levels are not. Raw Jev is worse than predicting the
base rate for every row (0.09806 vs 0.09712). It is only useful after recalibrating on
our own labelled data — which is the step that makes it no better than fitting our own
model.

### Exploratory — not registered, does not change the verdict

Computed from the cached responses at no further cost, to check the baseline was not a
straw man:

| model | Brier | AUC | hit rate, top 10% by score |
|---|---|---|---|
| LR as registered | 0.08655 | 0.821 | — |
| LR, log-transformed features | 0.08773 | **0.854** | **42.5%** |
| Jev A, recalibrated | 0.08400 | 0.823 | 38.0% |
| Jev B | 0.08282 | 0.839 | 37.5% |
| LR + Jev answers together | 0.08671 | 0.860 | 43.5% |

- For **ranking** — which is what selection uses — a free regression with one obvious
  transform ranks better than Jev (AUC 0.854 vs 0.839) and picks a better top decile.
- **Adding Jev to the regression** gains 0.001 Brier, interval [−0.0005, +0.0027]: its
  answers carry no information the numbers do not already carry.

What this means: on structured numbers, Jev is a calibrated-looking wrapper around
information a free model extracts as well or better. That was the expected result. The
untested case is **phase 2**, unstructured inputs (text, social, news) that a regression
cannot read — and even there, a better probability of hitting +50% does not by itself
overcome the toll recorded in `FINDINGS.md`.
