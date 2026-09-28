/**
 * Stage 0 for prediction markets, where the edge is arithmetic rather than a forecast.
 *
 * Mutually exclusive, exhaustive outcomes must sum to $1. If every outcome's YES can be
 * bought for a combined total below $1, the basket pays exactly $1 at resolution and the
 * difference is profit, whoever wins. Nothing here predicts anything -- which is the
 * point, since six hypotheses died on this project trying to predict.
 *
 * See PREREG-VENUE.md. Two things make this venue different from the others and both are
 * encoded below rather than discovered later: capital is LOCKED until resolution, and the
 * sum-to-one identity only holds if the outcomes really are exclusive and exhaustive.
 */

/**
 * EXHAUSTIVE AND EXCLUSIVE, OR NOT ELIGIBLE.
 *
 * The whole strategy is the identity "exactly one of these pays $1". Applied to a market
 * where that is false -- overlapping outcomes, or a set missing an "any other" leg -- the
 * basket does not pay $1 and a guaranteed profit becomes an uncapped directional loss.
 * It is never inferred from the prices, because a set of prices that happens to sum near
 * one is exactly what a mispriced non-exhaustive market looks like.
 */
export function eligible(market) {
  return Boolean(market?.exclusive && market?.exhaustive && Array.isArray(market.outcomes) && market.outcomes.length >= 2)
}

/**
 * What the basket costs and what it returns.
 *
 * `feeFraction` is charged on notional and SUPPLIED, never assumed: it is the number the
 * whole strategy is a race against, it differs per venue and tier, and this codebase
 * already carried a 4pp slip guess unexamined for weeks.
 */
export function basket(market, { feeFraction } = {}) {
  if (!(feeFraction >= 0)) throw new Error('a fee fraction is required — it is not assumed')
  if (!eligible(market)) return null
  const asks = market.outcomes.map((o) => Number(o.ask))
  if (!asks.every((a) => Number.isFinite(a) && a > 0 && a < 1)) return null

  const cost = asks.reduce((s, a) => s + a, 0)
  const fees = cost * feeFraction
  const grossEdge = 1 - cost
  const netEdge = grossEdge - fees
  return {
    outcomes: asks.length,
    cost,
    fees,
    grossEdge,
    netEdge,
    /** Return on the capital actually tied up, which is `cost`, not $1. */
    returnOnCapital: cost > 0 ? netEdge / cost : null,
  }
}

/**
 * CAPITAL IS LOCKED UNTIL RESOLUTION, so a per-trade return is not comparable across
 * markets and is not what anyone is paid.
 *
 * Two percent in a day and two percent in ninety days are the same number and wildly
 * different businesses. Every other venue this project has looked at let capital turn
 * over in seconds, so the distinction never came up; here it decides everything, and
 * ranking on per-trade return would systematically favour the slowest markets.
 */
export function annualise(returnOnCapital, daysToResolution) {
  if (returnOnCapital === null || !(daysToResolution > 0)) return null
  // Bounded below at total loss so a pathological input cannot produce a complex number.
  const base = Math.max(-0.999999, returnOnCapital)
  return (1 + base) ** (365 / daysToResolution) - 1
}

/**
 * The gate, adapted for arbitrage.
 *
 * On the other venues the rule was "the move must beat the toll by 3x". Here the edge is
 * already net of the toll, so the analogue is that the GROSS edge must beat the fees by
 * the same multiple: an edge only fractionally larger than its fees is flipped negative
 * by a small fee misestimate, one adverse fill, or a single leg filling at the next tick.
 *
 * The annual hurdle is a business decision, not a measurement, so it is supplied.
 */
export function qualifyPrediction({ markets, feeFraction, hurdleAnnual, gateMultiple = 3 }) {
  if (!(hurdleAnnual >= 0)) throw new Error('an annual hurdle rate is required — it is a decision, not a measurement')
  const considered = []
  let ineligible = 0
  let unreadable = 0
  for (const m of markets ?? []) {
    if (!eligible(m)) { ineligible++; continue }
    const b = basket(m, { feeFraction })
    if (!b) { unreadable++; continue }
    const annual = annualise(b.returnOnCapital, m.daysToResolution)
    considered.push({ market: m.id ?? null, ...b, daysToResolution: m.daysToResolution, annual })
  }
  const profitable = considered.filter((c) => c.netEdge > 0)
  // Beats its fees by the gate multiple, so a small misestimate cannot flip it.
  const robust = profitable.filter((c) => c.grossEdge > c.fees * gateMultiple)
  const clears = robust.filter((c) => c.annual !== null && c.annual >= hurdleAnnual)

  const med = (v) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : null)
  return {
    markets: (markets ?? []).length,
    ineligible,
    unreadable,
    considered: considered.length,
    profitableBeforeRobustness: profitable.length,
    robust: robust.length,
    clearsHurdle: clears.length,
    medianGrossEdge: med(considered.map((c) => c.grossEdge)),
    medianAnnualOfClearing: med(clears.map((c) => c.annual)),
    hurdleAnnual,
    gateMultiple,
    qualifies: clears.length > 0,
    opportunities: clears.sort((a, b) => b.annual - a.annual).slice(0, 20),
  }
}

export function formatPrediction(r) {
  const pct = (x) => (x === null ? '—' : (x * 100).toFixed(2) + '%')
  const L = []
  L.push(`markets ${r.markets} · ${r.ineligible} not exclusive+exhaustive · ${r.unreadable} unreadable · ${r.considered} considered`)
  L.push(`median gross edge: ${pct(r.medianGrossEdge)}   (negative means the basket costs more than it pays)`)
  L.push('')
  L.push(`  baskets cheaper than $1 after fees: ${r.profitableBeforeRobustness}`)
  L.push(`  of those, edge > ${r.gateMultiple}x fees:      ${r.robust}`)
  L.push(`  of those, clearing ${pct(r.hurdleAnnual)}/yr:    ${r.clearsHurdle}`)
  if (r.clearsHurdle) L.push(`  median annualised of those:      ${pct(r.medianAnnualOfClearing)}`)
  L.push('')
  L.push(r.qualifies ? 'QUALIFIES — and every figure here is arithmetic, not a forecast' : 'REJECTED — no basket clears fees by the gate and the hurdle')
  return L.join('\n')
}
