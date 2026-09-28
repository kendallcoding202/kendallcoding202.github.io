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
    /**
     * THE PAYOUT MUST BE $1, or the identity the whole strategy rests on is a different
     * identity. Checked per leg rather than assumed: a basket of contracts that do not
     * each pay $1 does not pay $1 in total, and "buy everything below a dollar" becomes
     * an arbitrary bet. Every live market carries notional_value_dollars = "1.0000", and
     * the day one does not is the day this must refuse rather than quietly rescale.
     */
    if (Number(m?.notional_value_dollars) !== 1) return null
    /**
     * Dollars, not cents. An earlier version of this parser read a `yes_ask` field in
     * cents -- a shape the live API does not have -- and would have valued a $0.11 leg at
     * $11. It returned null instead of guessing, which is the only reason that 100x error
     * is a comment here rather than a result.
     */
    const ask = Number(m?.yes_ask_dollars)
    // A leg with no ask cannot be bought, so the basket cannot be assembled at all.
    return Number.isFinite(ask) && ask > 0 && ask < 1 ? { ask } : null
  })
  if (outcomes.some((o) => o === null)) return null
  const d = days(raw?.close_time ?? markets[0]?.close_time, now)
  if (d === null) return null
  return {
    id: raw?.event_ticker ?? null,
    exclusive: raw?.mutually_exclusive === true,
    /**
     * EXCLUSIVE IS NOT EXHAUSTIVE, and conflating them is a guaranteed loss.
     *
     * Kalshi's `mutually_exclusive` means AT MOST one leg resolves YES. It does not mean
     * exactly one does. This field previously copied that flag, and the result was 21
     * "profitable" baskets in a live sample that were every one of them a total loss:
     * "What will be the 51st state?" lists 8 candidate states for $0.156 and pays nothing
     * at all if no state joins, which is overwhelmingly the likely outcome. "Who will the
     * next Pope be?" lists 7 cardinals out of more than 250.
     *
     * A set is only exhaustive if it carries a leg that catches everything else, so that
     * is what is looked for. The test is a conservative heuristic over the venue's own
     * sub-titles: it will miss baskets that are exhaustive by construction and say so
     * rather than wave through ones that are not. Under-counting costs opportunities;
     * over-counting costs the stake.
     */
    exhaustive: raw?.mutually_exclusive === true && hasCatchAll(markets),
    daysToResolution: d,
    outcomes,
  }
}

/** A leg meaning "none of the above", which is what makes a set complete. */
// \b matters: without it "Nonesuch Corp" matches `none` and a named company is read as
// the leg that completes the set -- which turns an ordinary bet into a phantom basket.
const CATCH_ALL = /^(other|others|none|no one|nobody|neither|any other|someone else|all other|none of)\b/i
export function hasCatchAll(markets) {
  return (markets ?? []).some((m) => CATCH_ALL.test(String(m?.yes_sub_title ?? '').trim()))
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
