# What the next export is being used to settle

Written **before** the data arrives, on purpose.

Every question below names the columns that answer it, the number that decides it, and
what happens for each outcome — fixed in advance. This project has already been bitten
twice by deciding what a result meant after seeing it: a streak breaker that was doing
uncorrected multiple comparisons, and a trailing-stop sweep that improved monotonically
down to an absurd 2% trail because the replay was handed the peak and then asked to trail
it. Pre-committing is the cheap defence. If a rule below turns out to be the wrong rule,
that is worth saying out loud and changing — but it gets said out loud.

Nine questions are tested here. **The 5% threshold is Bonferroni-corrected to 0.0056**
(0.05/9), so a result that clears an uncorrected bar and not this one counts as "keep
watching", not "act".

---

## The blocker: the export had to be fixed first

`trailExits` and `pathPrices` were being journalled correctly and **silently dropped on
the way out** — the outcome allowlist carries scalars, feature discovery takes only finite
numbers and booleans, and an array matched neither. The export would have arrived looking
complete, missing precisely the two columns questions 1 and 3 depend on.

Fixed: they now flatten to `trailExit10 … trailExit50` and `priceAt2s … priceAt900s`,
named by level and second rather than by index. **The export must be taken from a build
at or after `c71f229`** — check the header contains `trailExit50` before doing anything
else. An older file cannot answer questions 1 or 3 and should not be used to try.

---

## 1. Where does a trailing stop actually fill? — THE BLOCKING QUESTION

Everything about exits is downstream of this, including question 2.

**Columns:** `trailExit10, trailExit15, trailExit20, trailExit25, trailExit35, trailExit50`
— each is the multiple a trail at that level *actually exited at*, stamped at tick time as
the path happened.

⚠️ **Filter on `hasTrailData == 1` first.** An empty `trailExit50` means either "that level
never triggered" or "this row predates the feature", and both render as an empty cell.
The recording started **2026-09-22 ~21:47 UTC** (checkpoints at ~22:15), and
`JOURNAL_VERSION` was deliberately NOT bumped — doing so would have made the analyser
discard all ~193k rows already on disk. So the version cannot separate them and
`hasTrailData` / `hasPathData` exist to. Skipping that filter counts every pre-feature row
as "the trail never fired", which makes the stop look rarer and shallower than it is —
biasing the exact number this question turns on. Roughly 1,200 rows/hour are being
labelled, so an export taken a full day later should hold ~25,000 usable rows; the gap
measurement does not require a row to pass the entry filter, since it is a property of the
price path, so it is well powered.

**Why it could not be answered before:** a trail cannot be evaluated from peak/trough/end.
The replay hands the simulator the peak and then applies the trail to it, which is
look-ahead bias — that axis was removed from `exitSweep` rather than left to mislead.
These columns are the only honest measurement.

**The number:** the **fill gap** — `trailExit50` against `0.50 × peakMultiple`. The live
tape says this gap is real: the `aaaa` notification reported a 60% giveback on a stop set
at 50%, because on a bonding curve the price only moves when someone trades, so the trail
never fires at its trigger — it fires at the next print, which has already jumped past.

**Decided in advance:**
- **Gap under 5%** (trail fills near its trigger) → the replay's remainder term is roughly
  honest, so question 2's answer stands and the first rung drops to 10%.
- **Gap 5–20%** → re-run the sell-fraction sweep with the measured fill substituted for
  `peak × 0.5`, and take whatever it says. No prior.
- **Gap over 20%** → the remainder is worth far less than the replay thinks. Fix the trail
  before touching the ladder; a wider moon bag would be loading more of the position onto
  the worst-measured number in the model.

**Then, separately:** which level maximises realized return. **Red flag stated in
advance — if the answer is monotone all the way to the tightest level (10%), do not ship
it.** That is the identical signature to the biased sweep, and it means something in the
measurement is wrong, not that a 10% trail is optimal. Expect an interior optimum.

---

## 2. How much should the first rung sell?

**Columns:** `peakMultiple, troughMultiple, endMultiple, firstRungAtSeconds,
troughAtSeconds, hasExitTiming, hasOrdering, troughFirst` + question 1's answer.

**What the current data says** (1,388 rows the live filter would take, from the previous
export): monotone — selling less is better on mean, median day, and losing-day rate.
Sell 1% → 1.2600x; sell 20% (today) → 1.1859x; sell 100% → 0.9648x. Holding more is
**+0.0586x** per trade [+0.036, +0.079].

**Why it is not already shipped:** the entire advantage is the exit price of the *un-sold
remainder*, which is set by the trailing stop — question 1. Cutting the first rung is
exactly the change that puts more of the bag onto the quantity I cannot yet measure.

**The tail dependence, which is the real caveat:**

| population | advantage of holding more |
|---|---|
| whole book | +0.0586x |
| drop top 1% | +0.0229x |
| drop top 2% | +0.0155x |
| drop top 5% | +0.0012x — a wash |
| drop top 10% | −0.0093x |

One coin (peak 109x) supplies 17% of it. **Decided in advance: ship a smaller first rung
only if it survives dropping the top 2% of peaks on the NEW data.** If it needs the whole
tail, it is a bet on one coin per thousand, not a strategy — and it belongs in a separate
conversation about what Kendall is actually willing to ride, not in a config change.

---

## 3. Could these orders have been filled at all?

The question that decides whether any of this transfers to real money.

**Columns:** `priceAt2s, priceAt5s, priceAt10s` against `decisionPriceSol` and
`fillPriceSol`. Cross-checked against the **live fill probe** (`PROBE=1`, separate Railway
service, ~0.3 SOL, measurement only) once it has ~20 orders through it.

**The number:** how far the price has already moved by the time an order would realistically
land. `fillFeasibility(rows, {landingSeconds, tolerancePct})` in `learn.js` computes it.

**Decided in advance:** if the median 2-second move exceeds the modelled
`latencySlipPct` (2%), the cost model is understated **again** and every multiple in this
document is optimistic. That has now happened four times — 1.176 → 1.155 → 1.116 → 1.081,
each step from finding a cost that was being ignored — so the prior is that it will happen
a fifth time. The probe's fill ratios are the ground truth; the checkpoints say whether
the journal agrees with them.

---

## 4. Is the edge just detecting Mayhem Mode?

**Columns:** `f_mayhem, f_agentBuys, f_agentSells, f_agentNetSol, f_agentBuyShare,
f_organicTopBuyerShare`.

pump.fun's own docs say the Mayhem agent mints an extra billion tokens and trades them
"with equal probabilities in a random walk" for 24 hours. Equal probabilities means **zero
drift**. The two filters that carry the measured edge — buy acceleration and buyer
concentration — may simply be detecting that agent's footprint rather than anything about
the coin. Corroborating signal already in the data: coins peaking 10x+ end at a median
**1.054x**, right back where they started.

**Decided in advance:** split every headline number by `f_mayhem`.
- Edge present in **both** arms → it is about the coin. Nothing changes.
- Edge **only** in the Mayhem arm → the strategy is an agent detector. Say so plainly,
  and treat the 24-hour burn window as a hard constraint on holding, because the docs also
  warn holders may be unable to sell once the agent is a net seller.
- Edge only in the **non**-Mayhem arm → add `mayhem` as an entry filter.

⚠️ **`f_mayhem` DOES NOT MEAN "this is a Mayhem coin".** It means the published agent
wallet was seen trading during our 30-second observation window — `filter.js` only
accumulates `agentBuys/agentSells` while a candidate is being observed, and the candidate
is dropped once it is decided. A Mayhem coin whose agent happens to stay quiet for those
30 seconds is labelled `mayhem = false`. The dashboard's "nothing screened yet" counter is
narrower still: `mayhemScreened` increments only on strategy entries, never on explore.

Kendall reports buying Mayhem coins while that counter read zero, so the false-negative
rate is not hypothetical — it may be most of them. **The `mayhem = false` arm is therefore
contaminated, and a null result means nothing.** A clean split needs a structural label, so
test that first:

- **`f_launchVTokens` / `f_launchVSol`** are read straight off the create event. The docs
  say Mayhem mints 1,000,000,000 *additional* tokens (2B total) while "starting market cap
  and the initial amount of liquidity is exactly the same", so if that extra supply touches
  the curve's virtual reserves at all, launch reserves should come out **bimodal** — and
  the mode a coin sits in is a label that does not depend on catching the agent live.
- If it is bimodal, label by that and use `f_mayhem` only to check the two agree.
- If it is unimodal, the extra supply is held off-curve, there is no structural tell, and
  **Q4 cannot be answered from this data at all.** Say so rather than splitting on a
  label known to be wrong.

**If n < 30 in either arm, report that and do not split anything on it** — an underpowered
split that happens to look clean is how a spurious rule ships.

---

## 5. Does the replay match reality now?

The calibration that has been missing all along.

**Measured:** the explore book's `realizedMultiple` — capital-weighted, from the
`exploreStakedSol / exploreRealizedOnStakedSol / exploreStakedTrades` counters added in
`1ba2626`. Explore buys filter-*rejected* candidates, so it is a direct measurement of the
rejected arm, over tens of thousands of real closed trades.

**Predicted:** `simulateLadder` over the export's `action == 'rejected'` rows.

**The number:** predicted minus measured. Correct for it wherever it lands, and state the
gap next to every other figure in the report.

⚠️ **The counters started on 2026-09-22 and back-fill nothing**, so this only covers trades
closed since then. Do not divide the all-time `exploreRealizedSol` by the new stake — that
is the exact mistake that once produced "−5.726x on a long-only book". If the counters
have under ~200 trades in them, say the sample is thin rather than quoting a number.

---

## 6. Does the buyer-concentration filter hold out of sample?

`minTopBuyerShare 0.5 / maxTopBuyerShare 0.9` shipped on an inverted-U found in the
previous export: 0–30% share → 0.942x, **50–70% → 1.318x**, 90–100% → 0.949x. It was
fitted on that data and has never been judged on data it did not see.

**Columns:** `f_topBuyerShare, f_organicTopBuyerShare` (the second excludes the Mayhem
agent's volume; the first keeps its historical definition, because the live threshold was
fitted against it — do not silently swap them).

**Decided in advance:** fit nothing. Take the shipped bands and score them on rows
finalized **after** the previous export's last `finalizedAt`. If the U flattens out of
sample, it was overfitting and the filter comes off.

---

## 7. Is the tail concentration still this extreme?

The single most important fact for deciding about real money, and it is not a tuning
question.

On the previous export: **the top 25 coins of 1,388 are 100% of the profit.** Everything
past 25 is net-negative and is paid for by those 25. Two coins are 30% of it.

**Decided in advance:** recompute on the new data. If it replicates, then "1.19x" is the
average of a lottery, and the honest description of the strategy is *small frequent losses
punctuated by rare large wins* — which cannot deliver $25–100/day steady, and that
conflict needs saying rather than averaging away.

---

## 8. Does the wallet prior separate yet?

1.179x against 0.954x within the filter, n=468, intervals still overlapping. 67 of 3,401
qualifying wallets beat the market. **Nothing in the entry path reads this yet.**

**Decided in advance:** wire it into entries only if the gap clears the corrected
threshold (0.0056) on the new data. Overlapping intervals at n=468 is not a signal, it is
a hypothesis.

---

## 9. Has the off-curve oracle earned trust?

`oracleHealth()` — needs ≥8 agreements against known curve prices **and** ≥70% agreement
before it may price anything. Last read: "no checks yet."

Not a question for the export; read it off the dashboard. Recorded here so it is not
forgotten — until it passes, every graduated position is still dumped at the final curve
price, which truncates exactly the tail question 7 says carries the return.

---

## Order of work when the file lands

1. Check the header for `trailExit50`. If missing, the export is from an old build — stop.
2. **Q1** (trail fill) — blocks Q2 and gates the biggest pending change.
3. **Q5** (calibration) — gates how much to believe every other number.
4. **Q3** (fills) — gates whether any of it transfers to real money.
5. **Q4, Q6, Q7, Q8** — splits and out-of-sample checks, at the corrected threshold.
6. Ship only what survives, and report what did not, including anything above that the
   data turned out unable to answer.
