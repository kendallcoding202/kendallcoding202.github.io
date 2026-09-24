import { readGraduations, baseSanity, GRAD_CHECKPOINTS } from './graduation.js'

/**
 * THE PRE-REGISTERED ANALYSIS, WRITTEN BEFORE THE DATA.
 *
 * Pre-committed code is a stronger commitment than pre-committed prose: when n=300
 * arrives this is RUN, not written. Every number it prints was specified in
 * PREREG-GRADUATION.md before a single row was looked at, and every guard here exists
 * because its absence already produced a wrong answer on the on-curve side.
 */

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1]

/** Deterministic, and NOT an LCG: s*1103515245 exceeds 2^53 in float64 and the resulting
 *  interval failed to contain its own sample mean. mulberry32 via Math.imul does not. */
function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bootstrapCI(values, { iterations = 4000, seed = 20260924, alpha = 0.05 } = {}) {
  if (values.length < 2) return [null, null]
  const r = rng(seed)
  const means = []
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < values.length; j++) sum += values[(r() * values.length) | 0]
    means.push(sum / values.length)
  }
  means.sort((a, b) => a - b)
  const lo = means[Math.floor(iterations * (alpha / 2))]
  const hi = means[Math.floor(iterations * (1 - alpha / 2))]
  const m = mean(values)
  // The interval must contain the sample mean. When the RNG was broken, it did not.
  if (!(lo <= m && m <= hi)) throw new Error(`bootstrap interval [${lo}, ${hi}] excludes its own mean ${m}`)
  return [lo, hi]
}

/**
 * Rows usable at a given horizon, on a FIXED population.
 *
 * Coverage decays with horizon -- on the on-curve side 6,723 rows reached 2s and 13
 * reached 900s -- so a curve built from whatever is present at each checkpoint measures
 * selection, not returns. Every figure comes from rows present at ALL checkpoints up to
 * the one being reported.
 */
export function fixedPopulation(rows, uptoMinutes) {
  const need = GRAD_CHECKPOINTS.filter((m) => m <= uptoMinutes)
  return rows.filter((r) =>
    need.every((m) => Number.isFinite(r.mult?.[GRAD_CHECKPOINTS.indexOf(m)])))
}

/** Rows whose recorded base price could belong to a completed curve. */
export function usable(rows) {
  return rows.filter((r) => (r.baseSanity ? r.baseSanity.ok : baseSanity(r.basePriceSol).ok))
}

export function analyseGraduations({ rows = readGraduations(200_000), toll = null, minN = 300 } = {}) {
  const all = rows
  const clean = usable(all)
  const idx240 = GRAD_CHECKPOINTS.indexOf(240)
  const pop = fixedPopulation(clean, 240)

  const out = {
    rows: all.length,
    dropped: all.length - clean.length,
    fixedPopulation: pop.length,
    minN,
    powered: pop.length >= minN,
    /**
     * Derived, not fixed at 1.06. That number came from a pump.fun BONDING CURVE round
     * trip; this trades on PumpSwap. See the 2026-09-24 amendment.
     */
    toll,
    bar: toll === null ? null : 1 + toll,
    curve: null,
    verdict: null,
  }
  if (!out.powered) {
    out.verdict = `not powered: ${pop.length} of ${minN} — nothing is decided`
    return out
  }

  out.curve = GRAD_CHECKPOINTS.map((min, i) => {
    const v = pop.map((r) => r.mult?.[i]).filter(Number.isFinite)
    return v.length
      ? { min, n: v.length, mean: mean(v), median: median(v), ci: bootstrapCI(v) }
      : { min, n: 0, mean: null, median: null, ci: [null, null] }
  })

  const at240 = out.curve[idx240]
  const shareAbove120 = pop.filter((r) => r.mult?.[idx240] > 1.2).length / pop.length

  // Out-of-sample by graduation time, earliest first. In-sample is never the result.
  const ordered = [...pop].sort((a, b) => (a.graduatedAt ?? 0) - (b.graduatedAt ?? 0))
  const cut = Math.floor(ordered.length * 0.6)
  const outSample = ordered.slice(cut).map((r) => r.mult?.[idx240]).filter(Number.isFinite)

  /**
   * A DECAYING CURVE IS DEAD REGARDLESS OF THE TOLL. The on-curve horizon curve fell
   * monotonically from 0.9816x to 0.9430x, and no round trip makes that profitable --
   * so this is checked before anything involving the bar.
   */
  const means = out.curve.filter((c) => c.mean !== null).map((c) => c.mean)
  const monotoneDecay = means.length > 2 && means.every((m, i) => i === 0 || m <= means[i - 1])

  out.at240 = at240
  out.outOfSample = { n: outSample.length, mean: outSample.length ? mean(outSample) : null }
  out.shareAbove120 = shareAbove120
  out.monotoneDecay = monotoneDecay
  out.quietShare = all.length ? all.filter((r) => r.quoteWentQuiet).length / all.length : null

  if (monotoneDecay) out.verdict = 'DEAD: the curve decays monotonically, as the on-curve one did'
  else if (toll === null) out.verdict = 'BLOCKED: the PumpSwap toll has not been measured, so the bar is unknown'
  else if (out.outOfSample.mean > 1 + toll) out.verdict = `CLEARS: out-of-sample ${out.outOfSample.mean.toFixed(4)}x > ${(1 + toll).toFixed(4)}x`
  else out.verdict = `FAILS: out-of-sample ${out.outOfSample.mean.toFixed(4)}x <= ${(1 + toll).toFixed(4)}x`
  return out
}

export function formatGraduationReport(a) {
  const L = []
  L.push(`rows ${a.rows} · dropped for an unreachable base price ${a.dropped} · fixed population to 240m ${a.fixedPopulation}`)
  if (!a.powered) {
    L.push(a.verdict)
    return L.join('\n')
  }
  L.push('')
  L.push(' horizon      n      mean    median   95% CI')
  for (const c of a.curve) {
    if (!c.n) continue
    const h = c.min < 60 ? `${c.min}m` : `${c.min / 60}h`
    L.push(`${h.padStart(7)}  ${String(c.n).padStart(5)}  ${c.mean.toFixed(4)}  ${c.median.toFixed(4)}   [${c.ci[0].toFixed(3)}, ${c.ci[1].toFixed(3)}]`)
  }
  L.push('')
  L.push(`share above 1.20x at 240m: ${(a.shareAbove120 * 100).toFixed(1)}%`)
  L.push(`stopped being quoted:      ${a.quietShare === null ? '—' : (a.quietShare * 100).toFixed(1) + '%'}  (an outcome, not a gap)`)
  L.push(`out-of-sample at 240m:     ${a.outOfSample.mean === null ? '—' : a.outOfSample.mean.toFixed(4) + 'x'}  (n=${a.outOfSample.n})`)
  L.push(`bar (1 + measured toll):   ${a.bar === null ? 'UNMEASURED' : a.bar.toFixed(4) + 'x'}`)
  L.push('')
  L.push(a.verdict)
  return L.join('\n')
}
