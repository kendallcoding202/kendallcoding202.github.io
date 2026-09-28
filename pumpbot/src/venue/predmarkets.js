/**
 * Kalshi and Polymarket adapters.
 *
 * UNVERIFIED SHAPES. Outbound is denied from the analysis environment, so nothing here
 * has met a real response. A parser that is quietly wrong does not fail loudly -- it
 * invents a number -- so each one returns null on a shape it does not recognise, and the
 * runner reports that as a failure to READ the venue rather than as a venue with no
 * opportunity. Those are opposite conclusions and only one of them is ours.
 *
 * The normalised shape every adapter must produce is the contract, and it is deliberately
 * small:
 *
 *   { id, exclusive, exhaustive, daysToResolution, outcomes: [{ ask }] }
 *
 * `exclusive` and `exhaustive` are NOT inferred from prices. The whole strategy is the
 * identity "exactly one of these pays $1", and a set of prices summing near one is
 * exactly what a mispriced non-exhaustive market looks like.
 */

const days = (iso, now = Date.now()) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, (t - now) / 86_400_000)
}

/**
 * Kalshi groups mutually exclusive contracts under an EVENT, and the grouping is stated
 * by the venue rather than guessed: `mutually_exclusive` on the event is the flag the
 * whole basket depends on.
 */
export function parseKalshiEvent(raw, now = Date.now()) {
  const markets = raw?.markets
  if (!Array.isArray(markets) || markets.length < 2) return null
  const outcomes = markets.map((m) => {
    // Kalshi quotes cents; a basket priced in cents against a $1 payout is a 100x error.
    const cents = Number(m?.yes_ask)
    return Number.isFinite(cents) && cents > 0 && cents < 100 ? { ask: cents / 100 } : null
  })
  if (outcomes.some((o) => o === null)) return null
  const d = days(raw?.close_time ?? markets[0]?.close_time, now)
  if (d === null) return null
  return {
    id: raw?.event_ticker ?? null,
    exclusive: raw?.mutually_exclusive === true,
    // Kalshi's exclusive events are exhaustive by construction; anything else is not
    // eligible, and that is decided by the flag rather than by the prices.
    exhaustive: raw?.mutually_exclusive === true,
    daysToResolution: d,
    outcomes,
  }
}

/**
 * Polymarket prices come as decimal strings in [0,1] already. A market with a `negRisk`
 * group is the multi-outcome case; a plain binary market is its own two-leg basket.
 */
export function parsePolymarketGroup(raw, now = Date.now()) {
  const list = raw?.markets ?? raw?.tokens
  if (!Array.isArray(list) || list.length < 2) return null
  const outcomes = list.map((m) => {
    const p = Number(m?.bestAsk ?? m?.best_ask ?? m?.price)
    return Number.isFinite(p) && p > 0 && p < 1 ? { ask: p } : null
  })
  if (outcomes.some((o) => o === null)) return null
  const d = days(raw?.endDate ?? raw?.end_date_iso, now)
  if (d === null) return null
  return {
    id: raw?.id ?? raw?.conditionId ?? null,
    /**
     * negRisk is Polymarket's own marker that the legs are mutually exclusive and
     * complete. Without it the sum-to-one identity does not hold and the basket is not a
     * basket -- so absence means ineligible, never "probably fine".
     */
    exclusive: raw?.negRisk === true,
    exhaustive: raw?.negRisk === true,
    daysToResolution: d,
    outcomes,
  }
}

/** Normalised markets from a local JSON file, for running before network access exists. */
export function fromFile(json, venue, now = Date.now()) {
  const arr = Array.isArray(json) ? json : json?.data
  if (!Array.isArray(arr)) return null
  const parse = venue === 'kalshi' ? parseKalshiEvent : venue === 'polymarket' ? parsePolymarketGroup : null
  if (!parse) return null
  const out = arr.map((r) => parse(r, now)).filter(Boolean)
  return out.length ? out : null
}
