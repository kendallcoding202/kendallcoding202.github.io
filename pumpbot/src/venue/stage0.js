/**
 * STAGE 0: does a venue's opportunity exceed its toll?
 *
 * Venue-agnostic on purpose. Six hypotheses died on pump.fun for one reason -- a ~560bp
 * round trip against a median 30-second move of exactly 0.0% -- and no filter, holding
 * period or wallet list fixes that ratio. So a venue is qualified on the ratio BEFORE any
 * signal work, and the qualification is two measurements that need no strategy at all.
 *
 * See PREREG-VENUE.md. Nothing here picks a threshold after seeing a number.
 */

/** Pre-registered: the median move must beat the toll by this much, not merely match it. */
export const GATE_MULTIPLE = 3

const median = (v) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * What a round trip costs from PUBLIC data: half-spread on each side, fees both sides,
 * and the impact of walking the book at the intended size.
 *
 * A LOWER BOUND, and labelled as one. It cannot see latency slip, queue position or a
 * fill that never lands -- the pump.fun cost model carried a 4pp slip GUESS for weeks
 * precisely because nobody made it meet a real fill. A venue that fails the gate on the
 * lower bound fails, full stop; one that passes still owes a measured round trip.
 */
export function observableToll({ bids = [], asks = [], feeBps = 0, sizeUsd = 0 }) {
  /**
   * A size is mandatory. Crossing the spread is most of the cost at small size, and the
   * walk below is what captures it -- at size zero this would return the fee alone and
   * report a 5bp toll on a venue with a 200bp spread. A toll without a size is not a
   * number, which is the same rule the graduation bar had to be amended for.
   */
  if (!(sizeUsd > 0)) return null
  if (!bids.length || !asks.length) return null
  const bestBid = Number(bids[0].px)
  const bestAsk = Number(asks[0].px)
  if (!(bestBid > 0 && bestAsk > 0)) return null
  const mid = (bestBid + bestAsk) / 2
  const spreadBps = ((bestAsk - bestBid) / mid) * 10_000

  /** Average price paid walking one side for `sizeUsd`, or null if the book is too thin. */
  const walk = (levels, dir) => {
    let remaining = sizeUsd
    let cost = 0
    for (const lvl of levels) {
      const px = Number(lvl.px)
      const avail = px * Number(lvl.sz)
      if (!(px > 0 && avail > 0)) continue
      const take = Math.min(remaining, avail)
      cost += take * px
      remaining -= take
      if (remaining <= 0) break
    }
    if (remaining > 0) return null // book could not fill this size
    const avgPx = cost / sizeUsd
    return dir === 'buy' ? (avgPx / mid - 1) * 10_000 : (1 - avgPx / mid) * 10_000
  }

  const buyImpactBps = walk(asks, 'buy')
  const sellImpactBps = walk(bids, 'sell')
  if (buyImpactBps === null || sellImpactBps === null) {
    return { spreadBps, feeBps, tooThinAt: sizeUsd, totalBps: null, isLowerBound: true }
  }
  const totalBps = feeBps * 2 + buyImpactBps + sellImpactBps
  return {
    spreadBps,
    feeBps,
    buyImpactBps,
    sellImpactBps,
    sizeUsd,
    totalBps,
    /** Fees, spread and depth only. A measured round trip is still owed. */
    isLowerBound: true,
  }
}

/**
 * The move distribution, on raw buy-and-hold, at each horizon.
 *
 * ABSOLUTE moves, because on a venue that can be shorted a fall is as tradeable as a
 * rise. pump.fun was long-only, which is part of why a decaying curve there was fatal
 * rather than an opportunity.
 *
 * Every horizon is computed on a FIXED population -- the same start indices for all of
 * them -- because coverage that decays with horizon measures selection, not returns.
 * That mistake made the on-curve horizon curve unreadable until it was controlled.
 */
export function opportunity(closes, { horizons, tollBps = null } = {}) {
  const usable = closes.filter((c) => Number.isFinite(c) && c > 0)
  const longest = Math.max(...horizons)
  const starts = []
  for (let i = 0; i + longest < usable.length; i++) starts.push(i)
  if (!starts.length) return { n: 0, horizons: horizons.map((h) => ({ h, n: 0 })) }

  return {
    n: starts.length,
    horizons: horizons.map((h) => {
      const moves = starts.map((i) => Math.abs(usable[i + h] / usable[i] - 1) * 10_000)
      const signed = starts.map((i) => (usable[i + h] / usable[i] - 1) * 10_000)
      return {
        h,
        n: moves.length,
        medianAbsBps: median(moves),
        p90AbsBps: median(moves.filter((m) => m > median(moves))),
        medianSignedBps: median(signed),
        shareAboveTollPct:
          tollBps === null ? null : (moves.filter((m) => m > tollBps).length / moves.length) * 100,
      }
    }),
  }
}

/**
 * The gate, applied exactly as pre-registered.
 *
 * A venue where the typical move merely EQUALS the toll needs a perfect signal to break
 * even, and this project has never had one anywhere. Hence three, fixed in advance.
 */
export function qualify({ toll, opportunity: opp, gateMultiple = GATE_MULTIPLE }) {
  if (!toll || toll.totalBps === null) {
    return { qualifies: null, reason: 'toll not measurable at this size — the book could not fill it' }
  }
  if (!opp?.horizons?.length) return { qualifies: null, reason: 'no price history to measure' }
  const bar = toll.totalBps * gateMultiple
  const best = opp.horizons
    .filter((h) => h.medianAbsBps !== null)
    .reduce((a, b) => (b.medianAbsBps > (a?.medianAbsBps ?? -1) ? b : a), null)
  if (!best) return { qualifies: null, reason: 'no horizon produced a median' }
  return {
    qualifies: best.medianAbsBps > bar,
    bar,
    tollBps: toll.totalBps,
    bestHorizon: best.h,
    bestMedianAbsBps: best.medianAbsBps,
    ratio: best.medianAbsBps / toll.totalBps,
    reason:
      best.medianAbsBps > bar
        ? `median ${best.medianAbsBps.toFixed(1)}bp at h=${best.h} is ${(best.medianAbsBps / toll.totalBps).toFixed(1)}x the ${toll.totalBps.toFixed(1)}bp toll`
        : `median ${best.medianAbsBps.toFixed(1)}bp at h=${best.h} is only ${(best.medianAbsBps / toll.totalBps).toFixed(1)}x the ${toll.totalBps.toFixed(1)}bp toll, and ${gateMultiple}x is required`,
  }
}

export function formatStage0(name, toll, opp, gate) {
  const L = []
  L.push(`venue: ${name}`)
  if (toll) {
    L.push(
      `  toll (lower bound): ${toll.totalBps === null ? 'book too thin at $' + toll.tooThinAt : toll.totalBps.toFixed(2) + 'bp'}` +
        `  [spread ${toll.spreadBps?.toFixed(2)}bp · fee ${toll.feeBps}bp x2` +
        (toll.buyImpactBps !== undefined
          ? ` · impact ${(toll.buyImpactBps + toll.sellImpactBps).toFixed(2)}bp at $${toll.sizeUsd}`
          : '') +
        ']',
    )
    L.push('  NOT a measured round trip — fees, spread and depth only.')
  }
  if (opp?.horizons?.length) {
    L.push('')
    L.push('  horizon       n   median |move|   share > toll')
    for (const h of opp.horizons) {
      if (!h.n) continue
      L.push(
        `  ${String(h.h).padStart(7)}  ${String(h.n).padStart(6)}   ${h.medianAbsBps.toFixed(1).padStart(8)}bp   ` +
          (h.shareAboveTollPct === null ? '—' : h.shareAboveTollPct.toFixed(1) + '%'),
      )
    }
  }
  L.push('')
  L.push(gate?.qualifies === null ? `INCONCLUSIVE: ${gate.reason}` : gate?.qualifies ? `QUALIFIES: ${gate.reason}` : `REJECTED: ${gate.reason}`)
  return L.join('\n')
}
