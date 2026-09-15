import { config } from './config.js'
import { readAll, JOURNAL_VERSION } from './journal.js'

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

/** Wilson score interval — behaves sanely at small n, unlike the normal approximation. */
export function wilson(successes, n, z = 1.96) {
  if (n <= 0) return { p: 0, lo: 0, hi: 1, n: 0 }
  const p = successes / n
  const denom = 1 + (z * z) / n
  const centre = p + (z * z) / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return { p, lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom), n }
}

/**
 * Replays the configured exit rules against a row's realised price path and returns the
 * multiple of stake we would have ended with. 1.00 is break-even.
 *
 * Three caveats, all of which push this OPTIMISTIC — treat it as an upper bound:
 *  1. Only peak/trough/end are recorded, not the order they happened in. When a token
 *     both spiked past a rung and dipped past the stop, this assumes the rung came
 *     first. Reality sometimes went the other way.
 *  2. A rung that was touched is assumed filled. A spike can cross a rung and retrace
 *     before our sell actually lands.
 *  3. Stop-loss and trailing-stop fills are assumed to happen exactly at their trigger
 *     price. In a fast rug they land far worse, or not at all.
 *
 * Terminal value is the price at the end of the outcome window, not at liquidation —
 * a bag still open at the 15-minute mark is valued at its 15-minute price.
 */
export function simulateLadder(
  row,
  {
    ladder = config.exit.ladder,
    stopLossPct = config.exit.stopLossPct,
    trailingPct = config.exit.trailingDrawdownPct,
  } = {},
) {
  const peak = row.peakMultiple
  const end = row.endMultiple
  const trough = row.troughMultiple
  if (!(peak > 0)) return null

  const fees = (config.exec.feePct / 100) * 2
  const firstTarget = 1 + (ladder[0]?.atPct ?? 50) / 100
  const stopMultiple = Math.max(0, 1 - stopLossPct / 100)

  // Never reached the first rung: the stop-loss or the time stop got us out.
  if (peak < firstTarget) {
    const exit = Number.isFinite(trough) && trough <= stopMultiple ? stopMultiple : Math.max(end, 0)
    return exit * (1 - fees)
  }

  let tokensLeft = 1 // fraction of the original bag
  let recovered = 0

  for (const rung of ladder) {
    const target = 1 + rung.atPct / 100
    if (peak < target) break
    const fraction = Math.min(rung.sellPct / 100, tokensLeft)
    recovered += fraction * target
    tokensLeft -= fraction
    if (tokensLeft <= 0) break
  }

  if (tokensLeft > 0) {
    // The remainder is governed by the trailing stop off the peak, otherwise it is
    // still held at the end of the window.
    const trailExit = peak * (1 - trailingPct / 100)
    const drewDown = Number.isFinite(trough) && trough <= trailExit
    recovered += tokensLeft * (drewDown ? trailExit : Math.max(end, 0))
  }

  return recovered * (1 - fees)
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
export function bestThreshold(rows, feature, { minBucket = config.learning.minBucketSamples } = {}) {
  const values = rows
    .map((r) => ({ v: r.features?.[feature], hit: r.hitFirstRung }))
    .filter((x) => typeof x.v === 'number' && Number.isFinite(x.v))
  if (values.length < minBucket * 2) return null

  const sorted = [...new Set(values.map((x) => x.v))].sort((a, b) => a - b)
  if (sorted.length < 3) return null

  const base = wilson(values.filter((x) => x.hit).length, values.length)
  let best = null

  for (const cut of sorted.slice(1, -1)) {
    const above = values.filter((x) => x.v >= cut)
    const below = values.filter((x) => x.v < cut)
    if (above.length < minBucket || below.length < minBucket) continue

    const a = wilson(above.filter((x) => x.hit).length, above.length)
    const b = wilson(below.filter((x) => x.hit).length, below.length)

    // Only interesting if the better side's lower bound clears the worse side's upper.
    const keepAbove = a.p > b.p
    const strong = keepAbove ? a.lo > b.hi : b.lo > a.hi
    if (!strong) continue

    const lift = Math.abs(a.p - b.p)
    if (!best || lift > best.lift) {
      best = { feature, cut, keep: keepAbove ? '>=' : '<', above: a, below: b, base, lift }
    }
  }

  return best
}

export function analyze(rows = readAll()) {
  /**
   * Rows from an older schema are dropped, not averaged in. v1 rows were all recorded
   * while shadow-tracked tokens received no price updates at all, so every one of them
   * reads as "went nowhere" regardless of what the token actually did. Including them
   * would bias the rejected arm toward break-even and manufacture an edge for the
   * filter out of nothing but missing data.
   */
  const stale = rows.filter((r) => (r.v ?? 1) < JOURNAL_VERSION).length
  const current = rows.filter((r) => (r.v ?? 1) >= JOURNAL_VERSION)
  const labelled = current.filter((r) => typeof r.hitFirstRung === 'boolean' && r.decisionPriceSol > 0)
  const bought = labelled.filter((r) => r.action === 'bought')
  const explored = labelled.filter((r) => r.action === 'explored')
  // Everything the filter declined — whether we shadow-tracked it or bought it anyway
  // to find out. Both are evidence about the filter's false negatives.
  const rejected = labelled.filter((r) => r.action === 'rejected' || r.action === 'explored')

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
  const suggestions = enoughData
    ? numericFeatures(labelled)
        .map((f) => bestThreshold(labelled, f))
        .filter(Boolean)
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 6)
    : []

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

  return {
    generatedAt: Date.now(),
    totals: {
      journalled: rows.length,
      stale,
      labelled: labelled.length,
      bought: bought.length,
      explored: explored.length,
      rejected: rejected.length,
      pending: current.length - labelled.length,
      truncated,
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
    falseNegatives,
    suggestions,
    repeatCreators,
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
      L.push('  The filter is rejecting everything, so there is nothing to compare its')
      L.push('  picks against. Loosen entry thresholds until this arm has samples —')
      L.push('  until then the report cannot tell you whether the filter is worth having.')
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
      f.meanMultiple - 1.96 * f.stdErr > x.meanMultiple + 1.96 * x.stdErr
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
    L.push(`  mean ${e.meanMultiple.toFixed(3)}x ± ${(e.stdErr * 1.96).toFixed(3)} (95% CI) · median ${e.medianMultiple.toFixed(3)}x · ${(e.profitableShare * 100).toFixed(0)}% profitable · n=${e.n}`)
    const lo = e.meanMultiple - 1.96 * e.stdErr
    const hi = e.meanMultiple + 1.96 * e.stdErr
    L.push(
      lo > 1
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

  if (a.repeatCreators.length) {
    L.push('Repeat deployers seen 3+ times:')
    for (const c of a.repeatCreators) {
      L.push(`  ${c.creator.slice(0, 8)}… ${String(c.launches).padStart(3)} launches · ${(c.rate * 100).toFixed(0)}% hit rate`)
    }
    L.push('')
  }

  if (!a.enoughData) {
    L.push(`No threshold suggestions yet: ${a.totals.labelled}/${a.minSamples} labelled samples.`)
    L.push('Below that, apparent edges are sampling noise. Let it keep collecting.')
  } else if (!a.suggestions.length) {
    L.push('No threshold separated winners from losers beyond sampling error.')
    L.push('That is a real result: it means these features are not predictive here.')
  } else {
    L.push('Thresholds with statistically supported separation:')
    for (const s of a.suggestions) {
      L.push(`  ${s.feature} ${s.keep} ${s.cut}`)
      L.push(`    keep side ${p(s.keep === '>=' ? s.above : s.below)} vs other ${p(s.keep === '>=' ? s.below : s.above)}`)
    }
    L.push('')
    L.push('These are PROPOSALS. Auto-apply is off by default and should stay off —')
    L.push('tuning a live strategy on its own recent results is how you overfit into a hole.')
  }

  L.push('')
  return L.join('\n')
}
