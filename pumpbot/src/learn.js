import { config } from './config.js'
import { readAll, readRecent, JOURNAL_VERSION } from './journal.js'
import { strategyRecord } from './store.js'
import { WalletIndex, loadWallets } from './wallets.js'

import { wilson, criticalZ } from './stats.js'

/**
 * Analysis over the decision journal.
 *
 * This is deliberately statistics, not a model. With the trade volume this bot runs at,
 * a fitted classifier would be memorising noise long before it found signal. What
 * actually compounds is: (a) measuring what our filter threw away, and (b) checking
 * whether any threshold separates winners from losers by more than sampling error.
 *
 * Every rate reported carries a Wilson confidence interval, and nothing is called an
 * edge unless its interval clears the base rate.
 */

/**
 * Re-exported so this module's surface is unchanged by the move to stats.js. They live
 * there now because wallets.js needs the same correction, and importing learn.js from
 * it would be a cycle — learn.js reads the wallet index.
 */
export { wilson, criticalZ } from './stats.js'

/**
 * The persisted wallet prior. Null ONLY when the feature is off.
 *
 * It used to return null while the index was still empty, which hid the panel
 * completely — so the "this fills from live observation, give it a day" message never
 * had anywhere to appear, and the feature looked missing rather than waiting. An empty
 * index is a state worth showing; a disabled one is the only thing worth hiding.
 */
function walletSnapshot() {
  if (!config.learning.walletPrior) return null
  const idx = new WalletIndex()
  idx.restore(loadWallets())
  return { ...idx.summary(), top: idx.topWallets() }
}

/**
 * Everything one round trip actually costs, as a fraction of the stake.
 *
 * The old model charged a flat fee x2 and nothing else, which understated the real cost
 * by 2.7 to 3.8 percentage points — enough to print a losing configuration as a winner.
 * Two of the three costs it ignored matter structurally:
 *
 *  - PRIORITY FEES ARE FIXED PER TRANSACTION, so they scale INVERSELY with position size
 *    and multiply with the number of rungs. Four rungs plus a buy is five transactions:
 *    1.67% of a 0.15 SOL position, 3.33% of a 0.075 SOL one. This is also why a sweep
 *    over exit plans must charge them — otherwise every extra rung looks free and the
 *    recommendation drifts toward selling in more and more pieces.
 *  - PRICE IMPACT, because a bonding curve moves against you on the way in and again on
 *    the way out.
 *
 * Costed at the LIVE position size by default, since the question this report exists to
 * answer is whether to fund a live wallet — not how paper did at a paper size.
 */
function tradingCost({ sells, positionSol }) {
  const sideFee = config.exec.feePct / 100
  const impact = (config.exec.priceImpactPct / 100) * (positionSol / config.exec.impactReferenceSol)
  const sides = 1 + sells // one buy, plus however many times we sold
  const priority = (config.exec.priorityFeeSol * sides) / positionSol
  return {
    proportional: (sideFee + impact) * sides,
    priority,
    total: (sideFee + impact) * sides + priority,
  }
}

/**
 * Replays the configured exit rules against a row's realised price path and returns the
 * multiple of stake we would have ended with. 1.00 is break-even.
 *
 * Remaining caveats, both of which push this OPTIMISTIC:
 *  1. A rung that was touched is assumed filled. A spike can cross a rung and retrace
 *     before our sell actually lands.
 *  2. Stop-loss and trailing-stop fills are assumed to happen exactly at their trigger
 *     price. In a fast rug they land far worse, or not at all.
 *
 * Ordering used to be a third caveat, and it was the one that made "upper bound" untrue:
 * without knowing whether the dip came before or after the peak, the stop-loss could
 * never knock us out of an eventual winner (optimistic) while ANY low counted as a
 * trailing exit (pessimistic, and on the modal dip-then-run path large enough to turn a
 * profitable configuration negative). Rows now carry peak/trough timestamps and both
 * branches consult them. Rows recorded before that keep the old behaviour, so on a mixed
 * dataset this is a bound in neither direction — exitSweep reports the split.
 *
 * Terminal value is the price at the end of the outcome window, not at liquidation —
 * a bag still open at the 15-minute mark is valued at its 15-minute price.
 */
/**
 * The position size at which total cost is lowest.
 *
 * Cost is U-shaped: the priority fee is fixed per transaction so it punishes small
 * positions, price impact is proportional so it punishes large ones. Setting the
 * derivative of one against the other to zero gives sqrt(priorityFee x reference /
 * impactAtReference). Worth knowing because it is one of the few levers here that is
 * arithmetic rather than a hypothesis about the market.
 */
export function cheapestPositionSol() {
  const impactAtRef = config.exec.priceImpactPct / 100
  if (!(impactAtRef > 0) || !(config.exec.priorityFeeSol > 0)) return null
  return Math.sqrt((config.exec.priorityFeeSol * config.exec.impactReferenceSol) / impactAtRef)
}

/**
 * The size a LIVE account actually trades: the floor tier.
 *
 * Not tiers[0] — those are sorted highest-first so tier lookup can be a find(), so
 * tiers[0] is the TOP tier. Costing at 0.15 instead of 0.075 halves the apparent
 * priority-fee drag, which is exactly the error this cost model exists to stop making.
 */
export function livePositionSol() {
  return config.sizing.tiers.find((t) => t.minEquitySol === 0)?.buySol ?? 0.075
}

/** Round-trip cost as a fraction of stake, for a plan that sells `sells` times. */
export function roundTripCost({ sells = 1, positionSol = livePositionSol() } = {}) {
  return tradingCost({ sells, positionSol })
}

/**
 * The multiple this row was trading at `seconds` after the decision.
 *
 * Reads the coarse path, falling back to the value recorded at the live time stop and
 * then to `end`. The fallback matters: 150,000 rows predate the path, and a sweep over
 * the time stop simply cannot say anything about them — it must not quietly price them
 * at minute fifteen and call that an answer.
 */
function multipleAt(row, seconds) {
  const points = row.pathCheckpoints
  const values = row.pathMultiples
  if (Array.isArray(points) && Array.isArray(values)) {
    // The last checkpoint at or before the moment asked about.
    let best = null
    for (let i = 0; i < points.length; i++) {
      if (points[i] <= seconds && values[i] !== null && values[i] > 0) best = values[i]
    }
    if (best !== null) return best
  }
  if (Number.isFinite(row.timeStopMultiple) && seconds >= config.exit.timeStopSeconds) {
    return row.timeStopMultiple
  }
  return null
}

export function simulateLadder(
  row,
  {
    ladder = config.exit.ladder,
    stopLossPct = config.exit.stopLossPct,
    trailingPct = config.exit.trailingDrawdownPct,
    timeStopSeconds = config.exit.timeStopSeconds,
    // The replay has to model the rule the bot actually runs. It is a switch rather than
    // a deletion so the sweep can price the old behaviour against the same coins.
    sellOnStalePrice = config.exit.sellOnStalePrice,
    positionSol = livePositionSol(),
  } = {},
) {
  const peak = row.peakMultiple
  const end = row.endMultiple
  const trough = row.troughMultiple
  if (!(peak > 0)) return null

  const firstTarget = 1 + (ladder[0]?.atPct ?? 50) / 100
  const stopMultiple = Math.max(0, 1 - stopLossPct / 100)
  const net = (gross, sells) => {
    const c = tradingCost({ sells, positionSol })
    return Math.max(0, gross * (1 - c.proportional) - c.priority)
  }

  /**
   * THE HOLDING WINDOW, which this replay used to ignore entirely.
   *
   * Outcomes are observed for OUTCOME_WINDOW_MINUTES (15) while the live bot exits at
   * TIME_STOP_SECONDS (10 minutes) or after STALE_PRICE_SECONDS without a price. So a
   * coin that ran at minute twelve was banked here as a win the strategy had already
   * sold out of, and the replay came out 16pp above what the account actually returned.
   *
   * Gated on rows that carry the timing. Older rows keep the idealised behaviour rather
   * than being silently dropped or silently guessed at, and the report states coverage.
   */
  if (row.hasExitTiming) {
    const stale = sellOnStalePrice && Number.isFinite(row.staleExitAtSeconds)
      ? row.staleExitAtSeconds
      : Infinity
    const deadline = Math.min(timeStopSeconds, stale)
    const rungAt = Number.isFinite(row.firstRungAtSeconds) ? row.firstRungAtSeconds : Infinity
    const stoppedAt =
      Number.isFinite(trough) && trough <= stopMultiple && Number.isFinite(row.troughAtSeconds)
        ? row.troughAtSeconds
        : Infinity

    // Whichever rule fires FIRST is the one that closed the position.
    if (stoppedAt < Math.min(rungAt, deadline)) return net(stopMultiple, 1)

    if (rungAt > deadline) {
      /**
       * Sold by the clock, not by the plan. Exit at the price actually held at that
       * moment — the stale rule sells at the last price seen before the silence, the
       * time stop at the price standing when it came due. Falling back to `end` would
       * be the old mistake in a smaller form: `end` is the price at minute fifteen, and
       * we were not there.
       */
      const exit = stale <= timeStopSeconds
        ? row.staleExitMultiple
        : multipleAt(row, timeStopSeconds)
      return net(Math.max(Number.isFinite(exit) ? exit : Math.max(end, 0), 0), 1)
    }
  }

  // Never reached the first rung: the stop-loss or the time stop got us out. One sell.
  if (peak < firstTarget) {
    const exit = Number.isFinite(trough) && trough <= stopMultiple ? stopMultiple : Math.max(end, 0)
    return net(exit, 1)
  }

  /**
   * The dip came BEFORE the run, and it was deep enough to stop us out. We were not in
   * the position for the run at all.
   *
   * Without the ordering this case is invisible: a coin that dipped then recovered and
   * one that spiked then died have identical peak/trough/end, and the simulator resolved
   * the ambiguity by assuming the rung came first — which means the stop-loss could
   * never knock it out of an eventual winner. Tighter stops therefore looked free, and a
   * sweep over stop-loss depth would have recommended tightening all the way down.
   * Rows recorded before the timestamps exist keep the old optimistic behaviour, which
   * is why the sweep reports how many rows actually carry ordering.
   */
  if (row.hasOrdering && row.troughFirst && Number.isFinite(trough) && trough <= stopMultiple) {
    return net(stopMultiple, 1)
  }

  let tokensLeft = 1 // fraction of the original bag
  let recovered = 0
  let sells = 0 // every one of these is another transaction, and another priority fee

  for (const rung of ladder) {
    const target = 1 + rung.atPct / 100
    if (peak < target) break
    const fraction = Math.min(rung.sellPct / 100, tokensLeft)
    recovered += fraction * target
    tokensLeft -= fraction
    sells++
    if (tokensLeft <= 0) break
  }

  if (tokensLeft > 0) {
    /**
     * The remainder is governed by the trailing stop, which measures giveback FROM THE
     * PEAK — so only a dip that came AFTER the peak can trigger it.
     *
     * Treating any low as a trailing exit was the one caveat that broke the header's
     * "optimistic, treat as an upper bound" promise, and it broke it in the direction
     * that matters: dip-then-run is the modal pump.fun path, so a profitable
     * configuration could print below 1.00x and draw a "NEGATIVE with statistical
     * support" verdict. With peak/trough ordering recorded we can just ask. Rows
     * without it fall back to the old assumption, which is why the sweep reports what
     * fraction carries ordering.
     */
    const trailExit = peak * (1 - trailingPct / 100)
    const troughCouldTrail = row.hasOrdering ? !row.troughFirst : true
    const drewDown = troughCouldTrail && Number.isFinite(trough) && trough <= trailExit
    recovered += tokensLeft * (drewDown ? trailExit : Math.max(end, 0))
    sells++ // closing the remainder is its own transaction
  }

  return net(recovered, sells)
}

/**
 * PAIRED comparison of two exit plans over the same price paths.
 *
 * Paired, not two independent means: every row is replayed under both plans, so the
 * per-coin variance — which is enormous, these are meme coins — cancels out. Comparing
 * unpaired averages on data this noisy would need orders of magnitude more samples to
 * see a difference that is plainly visible per-row.
 */
function pairedDelta(rows, variant, incumbent) {
  const diffs = []
  for (const r of rows) {
    const a = simulateLadder(r, variant)
    const b = simulateLadder(r, incumbent)
    if (a === null || b === null) continue
    diffs.push(a - b)
  }
  if (diffs.length < 2) return null
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length
  const variance = diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1)
  return { n: diffs.length, mean, stdErr: Math.sqrt(variance / diffs.length) }
}

const withFirstRung = (ladder, atPct) =>
  ladder.map((r, i) => (i === 0 ? { ...r, atPct } : r))
const withFirstSell = (ladder, sellPct) =>
  ladder.map((r, i) => (i === 0 ? { ...r, sellPct } : r))

/**
 * Replays alternative exit plans against the recorded price paths and reports where the
 * configured one sits.
 *
 * ONE-DIMENSIONAL SWEEPS, not a grid. A full grid over four axes is hundreds of
 * comparisons on a few hundred noisy rows, which reliably produces a "winner" that is
 * noise. Sweeping each axis around the current setting is a handful of comparisons, the
 * result reads as a response curve rather than a lucky cell, and — because every variant
 * on an axis keeps the same NUMBER of rungs — it avoids the simulator's other bias, that
 * a plan with more rungs collects more of the "a touched rung is assumed filled"
 * optimism than one with fewer.
 */
export function exitSweep(rows, { minSamples = config.learning.minSamplesForSuggestion } = {}) {
  const usable = rows.filter((r) => r.peakMultiple > 0)
  const withOrdering = usable.filter((r) => r.hasOrdering).length
  // Rows on which the replay can apply the real holding window rather than an
  // idealised one. Reported for the same reason as withOrdering: a mixed sample is
  // fine, a mixed sample nobody mentions is not.
  const withExitTiming = usable.filter((r) => r.hasExitTiming).length

  const base = {
    ladder: config.exit.ladder,
    stopLossPct: config.exit.stopLossPct,
    trailingPct: config.exit.trailingDrawdownPct,
    timeStopSeconds: config.exit.timeStopSeconds,
    sellOnStalePrice: config.exit.sellOnStalePrice,
  }

  const firstAt = config.exit.ladder[0]?.atPct ?? 50
  const firstSell = config.exit.ladder[0]?.sellPct ?? 67

  const variants = []
  for (const atPct of [25, 35, 50, 75, 100]) {
    if (atPct !== firstAt) {
      variants.push({ axis: 'first rung trigger', label: `+${atPct}%`, plan: { ...base, ladder: withFirstRung(base.ladder, atPct) } })
    }
  }
  for (const sellPct of [40, 50, 67, 80, 100]) {
    if (sellPct !== firstSell) {
      variants.push({ axis: 'first rung size', label: `sell ${sellPct}%`, plan: { ...base, ladder: withFirstSell(base.ladder, sellPct) } })
    }
  }
  for (const stopLossPct of [15, 20, 30, 40, 60]) {
    if (stopLossPct !== base.stopLossPct) {
      variants.push({ axis: 'stop-loss', label: `−${stopLossPct}%`, plan: { ...base, stopLossPct } })
    }
  }
  for (const trailingPct of [25, 35, 50, 65]) {
    if (trailingPct !== base.trailingPct) {
      variants.push({ axis: 'trailing stop', label: `${trailingPct}% giveback`, plan: { ...base, trailingPct } })
    }
  }
  /**
   * SHOULD WE HOLD LONGER? The exit sweep could not ask until rows carried a price path
   * — every recorded exit price was pinned to the 600s the time stop happens to be, so
   * there was nothing to price a different boundary against.
   *
   * It matters because the journal watches for 15 minutes and the bot sells at 10, and
   * the gap between those two numbers is a large part of why the replay disagreed with
   * the account. Bounded by the observation window: beyond it there is no evidence, and
   * a variant nothing can price would just inherit the incumbent's numbers and look
   * like a tie.
   */
  /**
   * What the silence rule is worth, measured rather than argued.
   *
   * It was on until today, dumping positions because nobody had traded for three
   * minutes — which on a bonding curve means the price had not moved, not that it was
   * unknown. This prices both against the same coins, so the change can be checked
   * instead of believed.
   */
  variants.push({
    axis: 'sell on silence',
    label: base.sellOnStalePrice ? 'off' : 'on (the old rule)',
    plan: { ...base, sellOnStalePrice: !base.sellOnStalePrice },
  })

  const windowSeconds = config.learning.outcomeWindowMinutes * 60
  for (const timeStopSeconds of [300, 450, 600, 900, 1200]) {
    if (timeStopSeconds !== base.timeStopSeconds && timeStopSeconds <= windowSeconds) {
      variants.push({
        axis: 'time stop',
        label: `${Math.round(timeStopSeconds / 60)}m`,
        plan: { ...base, timeStopSeconds },
      })
    }
  }

  const z = criticalZ(variants.length)
  const incumbentSims = usable.map((r) => simulateLadder(r, base)).filter((x) => x !== null)
  const incumbentMean = incumbentSims.length
    ? incumbentSims.reduce((s, x) => s + x, 0) / incumbentSims.length
    : null

  const results = variants
    .map((v) => {
      const d = pairedDelta(usable, v.plan, base)
      if (!d) return null
      return {
        axis: v.axis,
        label: v.label,
        n: d.n,
        deltaMean: d.mean,
        deltaLo: d.mean - z * d.stdErr,
        deltaHi: d.mean + z * d.stdErr,
        // Better than the current plan with support, after correcting for how many
        // alternatives were tried.
        better: d.mean - z * d.stdErr > 0,
        worse: d.mean + z * d.stdErr < 0,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.deltaMean - a.deltaMean)

  return {
    n: incumbentSims.length,
    withOrdering,
    withExitTiming,
    enoughData: usable.length >= minSamples,
    comparisons: variants.length,
    criticalZ: z,
    incumbent: {
      ladder: config.exit.ladder,
      stopLossPct: base.stopLossPct,
      trailingPct: base.trailingPct,
      meanMultiple: incumbentMean,
    },
    results,
    better: results.filter((r) => r.better),
  }
}

function numericFeatures(rows) {
  const keys = new Set()
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.features ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) keys.add(k)
    }
  }
  return [...keys]
}

/**
 * Scans cut points on one feature and returns the split with the strongest supported
 * separation, or null when nothing clears the noise floor.
 */
export function bestThreshold(rows, feature, { minBucket = config.learning.minBucketSamples, maxCuts = 40 } = {}) {
  const values = rows
    .map((r) => ({ v: r.features?.[feature], hit: r.hitFirstRung }))
    .filter((x) => typeof x.v === 'number' && Number.isFinite(x.v))
  if (values.length < minBucket * 2) return null

  /**
   * Sort once and sweep with a prefix sum, instead of re-filtering the whole array at
   * every candidate cut.
   *
   * The old version was O(distinct x n) per feature. On continuous features almost every
   * value is distinct, so that is O(n^2) — and the permutation null runs the entire scan
   * dozens of times over. Measured on the real shape of this data: 10.4s at 4,000 rows,
   * SYNCHRONOUS, which blocks the dashboard and the trade feed alike, and the journal
   * grows by thousands of rows an hour. This is now O(n log n).
   *
   * Cuts are capped at `maxCuts` quantiles rather than every distinct value. Adjacent
   * cut points on a continuous feature produce near-identical splits, so the extra
   * thousands of hypotheses bought resolution nobody can act on while multiplying the
   * multiple-comparisons problem the null then has to correct for.
   */
  const sorted = [...values].sort((a, b) => a.v - b.v)
  const n = sorted.length
  const hitsBefore = new Array(n + 1)
  hitsBefore[0] = 0
  for (let i = 0; i < n; i++) hitsBefore[i + 1] = hitsBefore[i] + (sorted[i].hit ? 1 : 0)

  const distinct = new Set(values.map((x) => x.v))
  if (distinct.size < 3) return null

  const base = wilson(hitsBefore[n], n)
  let best = null

  // Candidate split indices, evenly spaced through the sorted array.
  const lo = minBucket
  const hi = n - minBucket
  if (hi <= lo) return null
  const step = Math.max(1, Math.floor((hi - lo) / maxCuts))

  for (let i = lo; i <= hi; i += step) {
    // Only split between different values, or the two sides are not separable.
    let split = i
    while (split < hi && sorted[split].v === sorted[split - 1].v) split++
    if (split >= hi || split <= lo) continue

    const belowN = split
    const aboveN = n - split
    if (belowN < minBucket || aboveN < minBucket) continue

    const belowHits = hitsBefore[split]
    const aboveHits = hitsBefore[n] - belowHits
    const b = wilson(belowHits, belowN)
    const a = wilson(aboveHits, aboveN)

    // Only interesting if the better side's lower bound clears the worse side's upper.
    const keepAbove = a.p > b.p
    const strong = keepAbove ? a.lo > b.hi : b.lo > a.hi
    if (!strong) continue

    const lift = Math.abs(a.p - b.p)
    if (!best || lift > best.lift) {
      best = { feature, cut: sorted[split].v, keep: keepAbove ? '>=' : '<', above: a, below: b, base, lift }
    }
  }

  return best
}

/**
 * The best lift the scan can extract from data where the label is pure noise.
 *
 * Shuffling the outcomes destroys any real relationship while preserving the feature
 * marginals, the sample size and the correlation structure between cut points — so the
 * resulting distribution is what "nothing is there" actually looks like for THIS
 * dataset, rather than an analytic approximation that assumes independent tests.
 */
export function permutationNull(rows, { trials = config.learning.nullTrials, seed = 1 } = {}) {
  const features = numericFeatures(rows)
  const labels = rows.map((r) => r.hitFirstRung)
  // Deterministic PRNG: a report that changes its conclusions when re-run is not a
  // report. Math.random would make suggestions flicker between invocations.
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }

  const lifts = []
  for (let t = 0; t < trials; t++) {
    const shuffled = [...labels]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const permuted = rows.map((r, i) => ({ ...r, hitFirstRung: shuffled[i] }))
    let best = 0
    for (const f of features) {
      const hit = bestThreshold(permuted, f)
      if (hit && hit.lift > best) best = hit.lift
    }
    lifts.push(best)
  }
  lifts.sort((a, b) => a - b)
  return {
    trials,
    p95: lifts[Math.floor(lifts.length * 0.95)] ?? 0,
    median: lifts[Math.floor(lifts.length / 2)] ?? 0,
    // How often the scan finds ANY "supported" split in data with no signal at all.
    falsePositiveRate: lifts.filter((x) => x > 0).length / lifts.length,
  }
}

/**
 * `rows` is left injectable for tests. Left to itself, this reads only the analysis
 * window through a ring buffer rather than materialising the journal: the cap now bounds
 * MEMORY as well as work, which it never did while readAll() parsed the whole file and
 * the slice happened afterwards.
 *
 * `onDisk` is the true row count, which a capped read cannot recover from `rows` — the
 * dashboard reports it and the truncation notice is derived from it.
 */
export function analyze(rows = null, onDisk = null) {
  if (rows === null) {
    const recent = readRecent(config.learning.maxRowsAnalyzed)
    rows = recent.rows
    onDisk = recent.total
  }
  return analyzeRows(rows, onDisk ?? rows.length)
}

function analyzeRows(rows, onDisk) {
  /**
   * Rows from an older schema are dropped, not averaged in. v1 rows were all recorded
   * while shadow-tracked tokens received no price updates at all, so every one of them
   * reads as "went nowhere" regardless of what the token actually did. Including them
   * would bias the rejected arm toward break-even and manufacture an edge for the
   * filter out of nothing but missing data.
   */
  const stale = rows.filter((r) => (r.v ?? 1) < JOURNAL_VERSION).length
  // Newest first, bounded — see learning.maxRowsAnalyzed.
  const cap = config.learning.maxRowsAnalyzed
  const all = rows.filter((r) => (r.v ?? 1) >= JOURNAL_VERSION)
  const current = cap > 0 && all.length > cap ? all.slice(-cap) : all
  // Rows on disk that these numbers do not describe. With a capped read the excluded
  // rows were never materialised, so this comes from the on-disk count rather than from
  // the difference between two arrays we happen to be holding.
  const olderThanCap = Math.max(0, onDisk - rows.length) + (all.length - current.length)
  const labelled = current.filter((r) => typeof r.hitFirstRung === 'boolean' && r.decisionPriceSol > 0)
  const bought = labelled.filter((r) => r.action === 'bought')
  const explored = labelled.filter((r) => r.action === 'explored')
  // Everything the filter declined — whether we shadow-tracked it or bought it anyway
  // to find out. Both are evidence about the filter's false negatives.
  const rejected = labelled.filter((r) => r.action === 'rejected' || r.action === 'explored')
  /**
   * Launches the FILTER approved but the capital gate refused — position cap full, daily
   * loss limit, blocklisted creator. They belong to neither arm: counting them as
   * rejects put the filter's own picks into the column measuring what it turned down.
   */
  const blocked = labelled.filter((r) => r.action === 'blocked')

  /**
   * WHY the capital gate refused the launches the filter approved.
   *
   * These rows carry blockedBy and nothing printed it, so a report could say "bought 0"
   * and "the filter is rejecting everything" while the filter was in fact approving
   * launches that were then refused downstream — a completely different problem with a
   * completely different fix. The distinction is invisible without this.
   */
  const blockedReasons = Object.entries(
    blocked.reduce((acc, r) => {
      // Collapse the variable parts so "already holding 4 positions (max 4)" and
      // "wallet 0.31 below 0.38 needed" group instead of each being unique.
      const why = String(r.blockedBy ?? 'unknown')
        .replace(/[\d.]+/g, 'N')
        .slice(0, 80)
      acc[why] = (acc[why] ?? 0) + 1
      return acc
    }, {}),
  )
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n)

  const base = wilson(labelled.filter((r) => r.hitFirstRung).length, labelled.length)
  const boughtRate = wilson(bought.filter((r) => r.hitFirstRung).length, bought.length)
  const rejectedRate = wilson(rejected.filter((r) => r.hitFirstRung).length, rejected.length)
  const exploredRate = wilson(explored.filter((r) => r.hitFirstRung).length, explored.length)

  // Which specific checks are throwing away winners.
  const missesByCheck = {}
  for (const r of rejected) {
    for (const id of r.rejectedFor ?? []) {
      missesByCheck[id] ??= { total: 0, wouldHaveHit: 0 }
      missesByCheck[id].total++
      if (r.hitFirstRung) missesByCheck[id].wouldHaveHit++
    }
  }
  const falseNegatives = Object.entries(missesByCheck)
    .map(([id, s]) => ({ check: id, ...s, rate: wilson(s.wouldHaveHit, s.total) }))
    .sort((a, b) => b.wouldHaveHit - a.wouldHaveHit)

  /**
   * How far the replay is from the account's own result.
   *
   * Deliberately compares against the LEDGER, not against another simulation. The two
   * disagree for reasons a replay cannot see — unfilled rungs, exits on a stale feed,
   * the time stop, slippage — and the size of the disagreement is the only honest
   * measure of how much weight the exit proposals below can carry.
   */
  const calibrationOf = (sim) => {
    const record = strategyRecord()
    /**
     * Counted over the trades whose STAKE we have, not over every trade ever closed.
     * Those are different sets — the stake counter started later — and mixing them
     * produced "-5.726x over 179 closed trades, 0.75 SOL staked", which is 5 trades of
     * stake against 179 trades of losses.
     *
     * A long-only book cannot return less than zero, so that result is refused outright
     * rather than printed. An impossible number reaching the page means the inputs
     * disagree, and saying so is worth more than rendering it.
     */
    const impossible = record.realizedMultiple !== null && record.realizedMultiple < 0
    if (!sim || record.realizedMultiple === null || record.stakedTrades === 0 || impossible) {
      return {
        comparable: false,
        trades: record.stakedTrades,
        stakedSol: record.stakedSol,
        inconsistent: impossible,
      }
    }
    const gap = sim.meanMultiple - record.realizedMultiple
    return {
      comparable: true,
      simulatedMultiple: sim.meanMultiple,
      realizedMultiple: record.realizedMultiple,
      gap,
      trades: record.stakedTrades,
      stakedSol: record.stakedSol,
      // A replay wrong by more than a few points cannot be used to choose between exit
      // plans that differ by fractions of one.
      trustworthy: Math.abs(gap) < 0.03,
    }
  }

  // Simulated ladder EV, on what we bought and on everything we saw.
  const evOf = (set) => {
    const sims = set.map((r) => simulateLadder(r)).filter((x) => x !== null)
    if (!sims.length) return null
    const mean = sims.reduce((s, x) => s + x, 0) / sims.length
    const sortedSims = [...sims].sort((a, b) => a - b)
    return {
      n: sims.length,
      meanMultiple: mean,
      medianMultiple: sortedSims[Math.floor(sortedSims.length / 2)],
      profitableShare: sims.filter((x) => x > 1).length / sims.length,
      // Standard error on the mean — the number that says whether meanMultiple means anything.
      stdErr: Math.sqrt(sims.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, sims.length - 1)) / Math.sqrt(sims.length),
      /**
       * Whether a confidence verdict may be drawn from this at all.
       *
       * At n=1 the Math.max(1, n-1) guard above turns an undefined variance into 0, so
       * stdErr is exactly 0 and every interval collapses to a point — a single trade
       * printed "positive with statistical support". Identical rows do the same at any
       * n. This is the worst failure the report has: maximum confidence from minimum
       * measurement, on the exact line that answers "should I fund this?". It is also
       * the imminent case, because the filter currently accepts almost nothing, so the
       * first accepted launch lands precisely here.
       */
      testable: sims.length >= config.learning.minBucketSamples &&
        sims.some((x) => x !== sims[0]),
    }
  }

  /**
   * Rows that were evicted before their outcome window elapsed were labelled on a
   * shorter window than the report claims, which biases peakMultiple — and therefore
   * hitFirstRung — downward. Silently averaging them in makes every arm look worse than
   * it was, so the count is reported rather than hidden.
   */
  const truncated = labelled.filter((r) => r.windowTruncated).length
  const observed = labelled.map((r) => r.observedSeconds).filter((s) => Number.isFinite(s))
  const medianObservedSeconds = observed.length
    ? [...observed].sort((a, b) => a - b)[Math.floor(observed.length / 2)]
    : null

  const enoughData = labelled.length >= config.learning.minSamplesForSuggestion
  const raw = enoughData
    ? numericFeatures(labelled)
        .map((f) => bestThreshold(labelled, f))
        .filter(Boolean)
        .sort((a, b) => b.lift - a.lift)
    : []
  /**
   * Every suggestion must beat a PERMUTATION NULL before it is reported.
   *
   * The scan tests every interior cut point of every numeric feature — roughly 2000
   * hypotheses at a few hundred rows — and keeps whichever separates best. Against pure
   * noise that produced a "statistically supported" threshold the majority of the time,
   * so the old output inverted the truth: finding nothing was the informative event, and
   * finding something was the default. Bonferroni would be far too harsh here because
   * the cuts are nested and heavily correlated, so instead the labels are shuffled and
   * the whole scan re-run, building the distribution of the best lift obtainable from
   * noise alone on this exact dataset. A real result has to clear that.
   */
  const nullDist = enoughData ? permutationNull(labelled) : null
  const suggestions = raw
    .filter((s) => !nullDist || s.lift > nullDist.p95)
    .slice(0, 6)
    .map((s) => ({ ...s, nullP95: nullDist?.p95 ?? null }))

  // Creators we have seen more than once.
  const byCreator = {}
  for (const r of labelled) {
    if (!r.creator) continue
    byCreator[r.creator] ??= { launches: 0, hits: 0 }
    byCreator[r.creator].launches++
    if (r.hitFirstRung) byCreator[r.creator].hits++
  }
  const repeatCreators = Object.entries(byCreator)
    .filter(([, s]) => s.launches >= 3)
    .map(([creator, s]) => ({ creator, ...s, rate: s.hits / s.launches }))
    .sort((a, b) => b.launches - a.launches)
    .slice(0, 10)

  /**
   * Hit rate by deployer standing, crossed with whether the crowd showed up.
   *
   * The scan found `creatorPriorHitRate >= 0.40` at 39.4% and `buyAcceleration >= 1.0`
   * at 45.7%, but a list of thresholds cannot say whether those are two signals or one
   * — and the whole question is whether the deployer's record tells you anything you
   * did not already learn from watching the first thirty seconds. If the lift survives
   * WITHIN each acceleration bucket, they are independent and worth combining. If it
   * collapses, proven deployers simply attract faster crowds and there is one signal
   * here, not two.
   *
   * Measured, not acted on. Nothing in the entry path reads this.
   */
  const accelerationOf = (r) => r.features?.buyAcceleration
  const crowdBuckets = [
    { id: 'quiet', label: 'acceleration < 1.0', test: (v) => v < 1 },
    { id: 'fast', label: 'acceleration >= 1.0', test: (v) => v >= 1 },
  ]
  const creatorTiers = ['poor', 'unknown', 'ordinary', 'proven'].map((name, value) => {
    const inTier = labelled.filter((r) => r.features?.creatorTier === value)
    const crowd = crowdBuckets.map((b) => {
      const rows = inTier.filter((r) => {
        const v = accelerationOf(r)
        return typeof v === 'number' && Number.isFinite(v) && b.test(v)
      })
      return { id: b.id, label: b.label, n: rows.length, rate: wilson(rows.filter((r) => r.hitFirstRung).length, rows.length) }
    })
    return {
      name,
      value,
      n: inTier.length,
      rate: wilson(inTier.filter((r) => r.hitFirstRung).length, inTier.length),
      crowd,
    }
  })
  const tiersMeasured = creatorTiers.some((t) => t.n > 0)

  return {
    generatedAt: Date.now(),
    totals: {
      journalled: onDisk,
      /**
       * Rows finalized in the last hour, from the ROWS' OWN timestamps.
       *
       * The dashboard used to derive this as labelled / process-uptime, which is a
       * cumulative numerator over a since-restart denominator. Twenty-five minutes after
       * a redeploy that read "about 339,985/hr" against a true rate in the low thousands
       * — the whole history divided by the time since the last deploy. The mismatch is
       * invisible on a long-running process and absurd on a fresh one, which is exactly
       * when someone is looking at it to check the deploy worked.
       *
       * Measured from finalizedAt, so it means the same thing whatever the process has
       * been doing, and reads 0 when collection has genuinely stopped.
       */
      labelledLastHour: labelled.filter((r) => (r.finalizedAt ?? 0) > Date.now() - 3_600_000).length,
      stale,
      labelled: labelled.length,
      bought: bought.length,
      explored: explored.length,
      rejected: rejected.length,
      blocked: blocked.length,
      blockedReasons,
      pending: current.length - labelled.length,
      truncated,
      olderThanCap,
      medianObservedSeconds,
      intendedWindowSeconds: config.learning.outcomeWindowMinutes * 60,
    },
    rates: { base, bought: boughtRate, rejected: rejectedRate, explored: exploredRate },
    // Does our filter actually select better-than-random launches?
    filterEdge:
      bought.length >= config.learning.minBucketSamples && rejected.length >= config.learning.minBucketSamples
        ? boughtRate.lo > rejectedRate.hi
          ? 'filter selects better than what it rejects'
          : boughtRate.hi < rejectedRate.lo
            ? 'WARNING: rejected launches outperformed the ones we bought'
            : 'no statistically supported difference yet'
        : 'not enough data on both sides yet',
    ev: { bought: evOf(bought), explored: evOf(explored), all: evOf(labelled) },
    /**
     * Score the replay against the account. Nothing here was checking whether the
     * simulation resembles what the bot actually did.
     *
     * It does not: the replay reported 0.976x on the launches we bought while the
     * ledger showed 174 closed trades, 26.19 SOL staked and -4.92 SOL realized, which
     * is 0.812x. Sixteen points apart, and every exit-plan proposal in this report is
     * produced by the optimistic side of that gap.
     *
     * The likely cause is in the windows: outcomes are observed for 15 minutes while
     * the bot's time stop is 10 and its stale-price rule exits after 3 minutes of
     * silence, so the replay banks peaks the strategy had already sold before.
     */
    calibration: calibrationOf(evOf(bought)),
    falseNegatives,
    suggestions,
    repeatCreators,
    /**
     * The wallet prior, read from ITS OWN FILE rather than from the journal.
     *
     * It is built from buyer lists that are deliberately never journalled, so the
     * analysis — which runs in a worker with no access to the bot's memory — reaches it
     * the same way a restart does: through the checkpoint. Up to thirty seconds stale,
     * which is nothing against a number that moves over days.
     */
    wallets: walletSnapshot(),
    creatorTiers,
    tiersMeasured,
    nullDist,
    // Would a different exit have done better on these same coins? The entry filter is
    // only half the strategy, and this is the half nothing was testing.
    exitSweep: exitSweep(labelled),
    enoughData,
    minSamples: config.learning.minSamplesForSuggestion,
  }
}

const p = (w) => `${(w.p * 100).toFixed(1)}% [${(w.lo * 100).toFixed(1)}–${(w.hi * 100).toFixed(1)}] n=${w.n}`

export function formatReport(a) {
  const L = []
  L.push('')
  L.push('═══ pumpbot learning report ═══')
  L.push('')
  L.push(`Journalled ${a.totals.journalled} decisions · ${a.totals.labelled} labelled · ${a.totals.pending} still in their outcome window`)
  L.push(`  bought ${a.totals.bought} · rejected (shadow-tracked) ${a.totals.rejected}`)
  if (a.totals.olderThanCap) {
    L.push(`  Analysing the most recent ${config.learning.maxRowsAnalyzed} rows; ` +
      `${a.totals.olderThanCap} older ones are on disk but not in these numbers.`)
    L.push('  (Raise MAX_ROWS_ANALYZED to widen it — an unbounded scan gets slower forever')
    L.push('   and ends up describing a week of different market conditions at once.)')
  }
  if (a.totals.stale) {
    L.push(`  ${a.totals.stale} older rows EXCLUDED — recorded before shadow tokens received prices,`)
    L.push('  so every one of them reads as "went nowhere" whatever the token actually did.')
  }
  if (a.totals.truncated) {
    const pct = ((a.totals.truncated / Math.max(1, a.totals.labelled)) * 100).toFixed(0)
    L.push(
      `  WARNING: ${a.totals.truncated} rows (${pct}%) were evicted before their ` +
        `${a.totals.intendedWindowSeconds}s window closed — median observed ${a.totals.medianObservedSeconds}s.`,
    )
    L.push('  Those rows understate peaks. Raise MAX_SHADOW_TRACKED.')
  }
  L.push('')
  L.push(`Base rate of reaching +${config.exit.ladder[0]?.atPct ?? 50}%:`)
  L.push(`  all launches seen : ${p(a.rates.base)}`)
  L.push(`  ones we bought    : ${p(a.rates.bought)}`)
  L.push(`  ones we rejected  : ${p(a.rates.rejected)}`)
  if (a.rates.explored.n) L.push(`  explore trades    : ${p(a.rates.explored)}`)
  L.push(`  verdict: ${a.filterEdge}`)
  L.push('')

  /**
   * When one arm is empty this block used to just not print, which reads as "nothing to
   * report" when it actually means "the headline comparison could not be computed at
   * all". Say which side is missing and why.
   */
  if (!a.ev.bought || !a.ev.explored) {
    L.push('Filtered vs explored: NOT AVAILABLE.')
    if (!a.ev.bought) {
      L.push(`  No labelled positions the filter ACCEPTED (bought n=${a.totals.bought}).`)
      /**
       * "The filter rejects everything" and "the filter approves launches that are then
       * refused downstream" are different problems with different fixes, and this used
       * to assert the first without checking. The blocked count is the difference.
       */
      if (a.totals.blocked > 0) {
        L.push(`  But the filter DID approve ${a.totals.blocked} — every one was refused at the`)
        L.push('  capital gate, so this is not an entry-threshold problem:')
        for (const b of a.totals.blockedReasons.slice(0, 5)) {
          L.push(`    ${String(b.n).padStart(5)} ×  ${b.reason}`)
        }
        L.push('  (N stands in for numbers that varied.) Fix the gate before touching the filter.')
      } else {
        L.push('  The filter is rejecting everything and nothing reached the capital gate,')
        L.push('  so this IS an entry-threshold problem. Loosen until this arm has samples —')
        L.push('  until then the report cannot say whether the filter is worth having.')
      }
    }
    if (!a.ev.explored) {
      L.push(`  No labelled explore trades (explored n=${a.totals.explored}).`)
      L.push('  Explore is what samples the other side of every threshold. Check that')
      L.push('  PAPER=1 and EXPLORE=1, and that the explore bankroll is not exhausted.')
    }
    L.push('')
  }

  if (a.ev.bought && a.ev.explored) {
    const f = a.ev.bought
    const x = a.ev.explored
    L.push('Filtered vs explored, simulated ladder return:')
    L.push(`  filter said YES : ${f.meanMultiple.toFixed(3)}x  n=${f.n}`)
    L.push(`  filter said NO  : ${x.meanMultiple.toFixed(3)}x  n=${x.n}`)
    L.push(
      !f.testable || !x.testable
        ? `  → NO VERDICT: needs ${config.learning.minBucketSamples}+ varying samples per arm ` +
          `(have ${f.n} and ${x.n}). The means above are descriptive only.`
        : f.meanMultiple - 1.96 * f.stdErr > x.meanMultiple + 1.96 * x.stdErr
          ? '  → the filter is adding value at this sample size.'
          : x.meanMultiple - 1.96 * x.stdErr > f.meanMultiple + 1.96 * f.stdErr
            ? '  → the coins the filter REJECTS are outperforming. The filter is hurting you.'
            : '  → cannot separate them yet. Keep exploring.',
    )
    L.push('')
  }

  if (a.ev.bought) {
    const e = a.ev.bought
    L.push('Simulated ladder outcome on positions taken (1.00 = break even):')
    L.push(`  mean ${e.meanMultiple.toFixed(3)}x${e.testable ? ` ± ${(e.stdErr * 1.96).toFixed(3)} (95% CI)` : ''} · median ${e.medianMultiple.toFixed(3)}x · ${(e.profitableShare * 100).toFixed(0)}% profitable · n=${e.n}`)
    const lo = e.meanMultiple - 1.96 * e.stdErr
    const hi = e.meanMultiple + 1.96 * e.stdErr
    L.push(
      !e.testable
        ? `  → NO VERDICT from n=${e.n}. A confidence interval needs at least ` +
          `${config.learning.minBucketSamples} samples that actually differ; below that the ` +
          'interval collapses to a point and would read as certainty.'
        : lo > 1
          ? '  → positive with statistical support at this sample size.'
          : hi < 1
            ? '  → NEGATIVE with statistical support. The strategy is losing money as configured.'
            : '  → indistinguishable from break-even. Not enough evidence either way yet.',
    )
    L.push('  (optimistic: assumes a rung that was touched was also filled)')
    L.push('')
  }

  if (a.falseNegatives.length) {
    L.push('What our filter threw away (winners rejected, by check):')
    for (const f of a.falseNegatives.slice(0, 8)) {
      L.push(`  ${f.check.padEnd(18)} rejected ${String(f.total).padStart(4)} · ${String(f.wouldHaveHit).padStart(4)} would have hit · ${p(f.rate)}`)
    }
    L.push('  A check rejecting many winners is a candidate to loosen.')
    L.push('')
  }

  /**
   * What it costs to be in this game at all. Printed before any verdict, because a
   * strategy has to clear this before its edge means anything — and because the number
   * is arithmetic, not a hypothesis, so it is true before a single row is collected.
   */
  {
    const size = livePositionSol()
    const one = roundTripCost({ sells: 1, positionSol: size })
    const full = roundTripCost({ sells: config.exit.ladder.length + 1, positionSol: size })
    const best = cheapestPositionSol()
    L.push(`Cost of a round trip at ${size} SOL/position:`)
    L.push(`  losing trade (1 sell)      ${(one.total * 100).toFixed(1)}%`)
    L.push(`  full ladder (${config.exit.ladder.length + 1} sells)      ${(full.total * 100).toFixed(1)}%  ← charged against your winners`)
    if (best) {
      L.push(`  cheapest size would be     ${best.toFixed(4)} SOL` +
        (Math.abs(best - size) / size > 0.15 ? '  ← worth moving toward' : '  (you are close to it)'))
    }
    L.push('  Every rung is a transaction — but cheaper is not the same as better.')
    L.push('  The sweep below prices the extra sell against what holding a bag earns.')
    L.push('')
  }

  if (a.calibration && !a.calibration.comparable && a.calibration.inconsistent) {
    L.push('Does the replay match what actually happened?')
    L.push('  CANNOT SAY — the ledger figures disagree with each other.')
    L.push('  Realized P&L and recorded stake cover different sets of trades, which makes')
    L.push('  the ratio meaningless (a long-only book cannot return below zero). This')
    L.push('  corrects itself as trades close with both recorded together.')
    L.push('')
  }

  if (a.calibration?.comparable) {
    const c = a.calibration
    L.push('Does the replay match what actually happened?')
    L.push(`  replay says, on the launches we bought : ${c.simulatedMultiple.toFixed(3)}x`)
    L.push(`  the account actually returned          : ${c.realizedMultiple.toFixed(3)}x` +
      `  (${c.trades} closed trades, ${c.stakedSol.toFixed(2)} SOL staked)`)
    if (c.trustworthy) {
      L.push(`  → within ${Math.abs(c.gap * 100).toFixed(1)}pp. The exit numbers below can be taken at face value.`)
    } else {
      L.push(`  → ${(Math.abs(c.gap) * 100).toFixed(1)}pp apart. The replay is ` +
        `${c.gap > 0 ? 'OPTIMISTIC' : 'PESSIMISTIC'}, and everything below inherits that.`)
      L.push('  Exit proposals separated by less than that gap are not decidable from this data.')
      L.push('  Most likely cause: outcomes are watched for ' +
        `${config.learning.outcomeWindowMinutes}m while the bot's time stop is ` +
        `${Math.round(config.exit.timeStopSeconds / 60)}m and it exits after ` +
        `${config.exit.stalePriceSeconds}s without a price — so the replay banks peaks`)
      L.push('  the strategy had already sold before, and assumes every rung it touched filled.')
    }
    L.push('')
  }

  if (a.exitSweep?.n) {
    const x = a.exitSweep
    L.push('Exit plan, replayed against the same coins:')
    L.push(`  current: ladder ${x.incumbent.ladder.map((r) => `+${r.atPct}%→${r.sellPct}%`).join(' ')} · ` +
      `stop −${x.incumbent.stopLossPct}% · trail ${x.incumbent.trailingPct}%`)
    L.push(`  → ${x.incumbent.meanMultiple.toFixed(3)}x over n=${x.n}`)
    L.push('')

    if (!x.enoughData) {
      L.push(`  Not enough data to rank alternatives (${x.n}/${a.minSamples}).`)
    } else if (!x.better.length) {
      L.push(`  No alternative beat it across ${x.comparisons} tried.`)
      L.push('  That is a real result: the exit plan is not the thing holding returns back.')
    } else {
      L.push(`  Alternatives that beat it (paired, corrected for ${x.comparisons} comparisons):`)
      for (const r of x.better) {
        L.push(`    ${r.axis.padEnd(20)} ${r.label.padEnd(16)} ${r.deltaMean >= 0 ? '+' : ''}${r.deltaMean.toFixed(3)}x ` +
          `[${r.deltaLo.toFixed(3)} to ${r.deltaHi.toFixed(3)}]`)
      }
      L.push('  PROPOSALS, not changes. Nothing here is applied automatically.')
    }

    // The three worst, so the shape of the curve is visible rather than just its top.
    const worst = x.results.filter((r) => r.worse).slice(-3).reverse()
    if (worst.length) {
      L.push('')
      L.push('  Clearly worse than current, for contrast:')
      for (const r of worst) {
        L.push(`    ${r.axis.padEnd(20)} ${r.label.padEnd(16)} ${r.deltaMean.toFixed(3)}x`)
      }
    }

    /**
     * The caveat that decides whether any of the above is trustworthy. Rows without
     * peak/trough ordering cannot tell "dipped then ran" from "ran then died", and the
     * simulator resolves that in the strategy's favour — so on those rows the stop-loss
     * can never knock you out of a winner and tighter stops look free.
     */
    const pct = x.n ? Math.round((x.withOrdering / x.n) * 100) : 0
    L.push('')
    if (pct < 90) {
      L.push(`  ⚠ Only ${x.withOrdering}/${x.n} rows (${pct}%) record whether the dip came before the run.`)
      L.push('  On the rest the stop-loss can never knock you out of an eventual winner, so')
      L.push('  TIGHTER STOPS LOOK BETTER THAN THEY ARE. Treat the stop-loss row with suspicion')
      L.push('  until this reaches ~100%, which it will as older rows age out.')
    } else {
      L.push(`  ${pct}% of rows carry dip-before-run ordering, so the stop-loss comparison is sound.`)
    }

    /**
     * Separate coverage line, because it governs a different failure. Ordering decides
     * whether the stop-loss is judged fairly; this decides whether the replay is
     * replaying the bot's actual holding window or a fifteen-minute fantasy.
     */
    const tPct = x.n ? Math.round(((x.withExitTiming ?? 0) / x.n) * 100) : 0
    if (tPct < 90) {
      L.push(`  ⚠ Only ${x.withExitTiming ?? 0}/${x.n} rows (${tPct}%) can be replayed against the real`)
      L.push(`  holding window — the ${Math.round(config.exit.timeStopSeconds / 60)}m time stop and the ` +
        `${config.exit.stalePriceSeconds}s stale-price exit. On the rest the replay`)
      L.push(`  still banks peaks from the full ${config.learning.outcomeWindowMinutes}m window, which the ` +
        'strategy would have sold before.')
      L.push('  This is the gap the calibration line above is measuring. It closes as rows age in.')
    } else {
      L.push(`  ${tPct}% of rows replay against the real time stop and stale-price exit.`)
    }
    L.push('')
  }

  if (a.repeatCreators.length) {
    L.push('Repeat deployers seen 3+ times:')
    for (const c of a.repeatCreators) {
      L.push(`  ${c.creator.slice(0, 8)}… ${String(c.launches).padStart(3)} launches · ${(c.rate * 100).toFixed(0)}% hit rate`)
    }
    L.push('')
  }

  if (a.wallets) {
    const w = a.wallets
    const base = w.baseRate === null ? 'n/a' : (w.baseRate * 100).toFixed(1) + '%'
    L.push('Wallets we are tracking — who buys the launches that run:')
    L.push(`  ${w.observations} early buys seen across ${w.wallets} wallets · ` +
      `${w.eligible} have ${w.minLaunches}+ · ${w.smart} beat the market (base ${base})`)
    if (w.top.length) {
      L.push('  Strongest records, ranked by the LOWER bound so a short streak cannot top the list:')
      for (const t of w.top) {
        L.push(
          `    ${t.wallet.slice(0, 8)}…  ${String(t.hits).padStart(4)}/${String(t.launches).padEnd(5)} ` +
            `${(t.hitRate * 100).toFixed(0).padStart(3)}% · at least ${(t.lowerBound * 100).toFixed(1)}%` +
            (t.betterThanMarket ? '  ← beats the market' : ''),
        )
      }
    } else {
      L.push(`  No wallet has ${w.minLaunches}+ observed buys yet. This index cannot be rebuilt`)
      L.push('  from the journal — buyer lists are never written there — so it fills only from')
      L.push('  live observation and needs a day or two before anyone qualifies.')
    }
    L.push('  A "hit" means a launch this wallet bought early went on to reach the first rung.')
    L.push('  It measures PICK QUALITY, not profit: it does not know when they sold.')
    L.push('  Nothing in the entry path reads this yet.')
    L.push('')
  }

  if (a.tiersMeasured) {
    const band = (w) => (w.n ? `${(w.p * 100).toFixed(1)}% [${(w.lo * 100).toFixed(1)}-${(w.hi * 100).toFixed(1)}]` : '—')
    L.push('Deployer standing vs the crowd — are these two signals or one?')
    L.push('  tier       overall                n         quiet crowd      fast crowd')
    for (const t of a.creatorTiers) {
      const quiet = t.crowd.find((c) => c.id === 'quiet')
      const fast = t.crowd.find((c) => c.id === 'fast')
      L.push(
        `  ${t.name.padEnd(9)} ${band(t.rate).padEnd(22)} ${String(t.n).padStart(7)}   ` +
          `${band(quiet.rate).padEnd(16)} ${band(fast.rate)}`,
      )
    }
    L.push('  Read DOWN the last two columns, not across the first.')
    L.push('  If proven still beats unknown WITHIN the same crowd column, the deployer\'s')
    L.push('  record knows something the first 30 seconds does not, and the two combine.')
    L.push('  If the gap vanishes there, proven deployers just draw faster crowds and')
    L.push('  there is only one signal — in which case use the crowd, it has more samples.')
    L.push('  Nothing in the entry path reads this yet. It is here to be measured.')
    L.push('')
  }

  if (!a.enoughData) {
    L.push(`No threshold suggestions yet: ${a.totals.labelled}/${a.minSamples} labelled samples.`)
    L.push('Below that, apparent edges are sampling noise. Let it keep collecting.')
  } else if (!a.suggestions.length) {
    L.push('No threshold beat what this scan extracts from pure noise.')
    if (a.nullDist) {
      L.push(`  (shuffling the outcomes ${a.nullDist.trials} times, the scan still finds an ` +
        `apparently "significant" split ${(a.nullDist.falsePositiveRate * 100).toFixed(0)}% of the time —`)
      L.push('  that is the bar a real finding has to clear, and nothing here did.)')
    }
    L.push('That is a real result: these features are not predictive at this sample size.')
  } else {
    L.push('Thresholds that beat the noise floor:')
    for (const s of a.suggestions) {
      L.push(`  ${s.feature} ${s.keep} ${s.cut}`)
      L.push(`    keep side ${p(s.keep === '>=' ? s.above : s.below)} vs other ${p(s.keep === '>=' ? s.below : s.above)}`)
      if (s.nullP95 !== null) {
        L.push(`    lift ${(s.lift * 100).toFixed(1)}pp vs ${(s.nullP95 * 100).toFixed(1)}pp reachable by chance`)
      }
    }
    L.push('')
    L.push('These are PROPOSALS. Auto-apply is off by default and should stay off —')
    L.push('tuning a live strategy on its own recent results is how you overfit into a hole.')
    L.push('The lift shown is measured on the same data that selected the cut, so expect')
    L.push('it to shrink on fresh data even when the finding is real.')
  }

  L.push('')
  return L.join('\n')
}
