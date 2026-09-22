import { config } from './config.js'
import { log } from './log.js'

/**
 * Pricing a token AFTER its bonding curve closes.
 *
 * Graduation is our best outcome by construction — filling the curve is what graduation
 * IS — and it is also the moment we go blind. The curve account is gone, the log feed
 * only decodes pump.fun trades, and the bag gets dumped at the final curve price. Given
 * the edge lives almost entirely in the top 1% of outcomes, that is the one place we
 * systematically truncate exactly the tail we are being paid for.
 *
 * THE SHAPE OF THIS FILE IS DICTATED BY WHAT COULD NOT BE VERIFIED. Nothing here could
 * be tested against the real endpoint while writing it, and a price parser that is
 * quietly wrong does not fail loudly — it invents a number, and that number closes
 * positions. So the source is not trusted on assertion. It has to EARN trust against
 * ground truth we already hold:
 *
 *   While a token is still on its curve we know its price exactly, from reserves. So
 *   every time we read a curve we can also ask the oracle, and compare. An oracle that
 *   agrees with the curve repeatedly is parsing the right field of the right object for
 *   the right token; one that does not never gets to price anything.
 *
 * That check runs continuously in production against live data, which is the only place
 * it can run at all. Until it passes, a graduated position exits the way it does today.
 */

const state = {
  checks: 0,
  agreements: 0,
  lastError: null,
  lastPriceAt: 0,
  disagreements: [],
}

/**
 * Two INDEPENDENT readings of the same price, required to agree.
 *
 * `priceNative` is the pair's SOL-denominated price; `priceUsd / solUsd` derives the
 * same quantity through a different field. The codebase already depends on `pairs[]`,
 * `priceUsd` and `liquidity.usd` for the dashboard's dollar figures, so those three are
 * confirmed by something that works in production. `priceNative` is not, which is
 * precisely why it is cross-checked rather than believed.
 */
function priceFromPairs(data, mint, solUsd) {
  const pairs = Array.isArray(data?.pairs) ? data.pairs : []
  const candidates = pairs
    .filter((p) => String(p?.baseToken?.address ?? '') === mint)
    .filter((p) => Number(p?.liquidity?.usd) > 0)
    .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))
  const best = candidates[0]
  if (!best) return null

  const native = Number(best.priceNative)
  const viaUsd = solUsd > 0 ? Number(best.priceUsd) / solUsd : NaN

  const usable = (v) => Number.isFinite(v) && v > 0
  if (!usable(native) && !usable(viaUsd)) return null
  // Only one of the two is readable: take it, but say so — a single reading has not been
  // cross-checked and the caller's trust gate is what stops it acting alone.
  if (!usable(native) || !usable(viaUsd)) {
    return { priceSol: usable(native) ? native : viaUsd, crossChecked: false, venue: String(best.dexId ?? 'unknown') }
  }
  // Both readable and they disagree: something is being parsed wrong, so return nothing
  // rather than picking a winner.
  const ratio = native / viaUsd
  if (ratio < 0.8 || ratio > 1.25) {
    log.warn(`off-curve price for ${mint} disagrees with itself (${native} vs ${viaUsd}) — ignoring`)
    return null
  }
  return { priceSol: native, crossChecked: true, venue: String(best.dexId ?? 'unknown') }
}

/**
 * Current off-curve price in SOL, or null. Never throws and never blocks for long: a
 * price we cannot get is the situation we are already in, and the exit rules handle it.
 */
export async function offCurvePrice(mint, solUsd = 0) {
  if (!config.exit.offCurvePricing) return null
  try {
    const res = await fetch(`${config.exit.priceApiUrl}/${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(config.exit.priceApiTimeoutMs),
    })
    if (!res.ok) {
      state.lastError = `HTTP ${res.status}`
      return null
    }
    const found = priceFromPairs(await res.json(), mint, solUsd)
    if (found) state.lastPriceAt = Date.now()
    return found
  } catch (err) {
    state.lastError = err?.message ?? String(err)
    return null
  }
}

/**
 * Score one oracle reading against the CURVE price, which we know exactly.
 *
 * This is the whole trust mechanism. A token still on its curve has an unambiguous
 * price, so agreement means the oracle is reading the right field of the right object
 * for the right token — the three ways a blind parser goes wrong.
 */
export function noteOracleCheck(mint, curvePriceSol, oraclePriceSol) {
  if (!(curvePriceSol > 0) || !(oraclePriceSol > 0)) return
  state.checks++
  const ratio = oraclePriceSol / curvePriceSol
  const tol = config.exit.oracleTolerancePct / 100
  if (ratio >= 1 - tol && ratio <= 1 + tol) {
    state.agreements++
  } else {
    // Kept, bounded, because "it is wrong" is far less useful than "it is wrong by 1000x",
    // which names the bug — wrong decimals, wrong quote asset, wrong pair.
    state.disagreements.push({ mint, ratio: Number(ratio.toFixed(4)), at: Date.now() })
    if (state.disagreements.length > 20) state.disagreements.shift()
  }
}

/**
 * May the oracle price a position we cannot otherwise see?
 *
 * Requires a minimum number of agreements AND a majority of checks agreeing, so a source
 * that is right occasionally by luck does not qualify on volume alone.
 */
export function oracleTrusted() {
  if (!config.exit.offCurvePricing) return false
  if (state.agreements < config.exit.oracleMinAgreements) return false
  return state.agreements / Math.max(1, state.checks) >= 0.7
}

export function oracleHealth() {
  return {
    enabled: config.exit.offCurvePricing,
    checks: state.checks,
    agreements: state.agreements,
    agreementRate: state.checks > 0 ? state.agreements / state.checks : null,
    trusted: oracleTrusted(),
    needed: config.exit.oracleMinAgreements,
    lastError: state.lastError,
    lastPriceAt: state.lastPriceAt,
    recentDisagreements: state.disagreements.slice(-5),
  }
}

/** Tests drive this from a known state rather than whatever a previous case left. */
export function __resetOracleForTests() {
  state.checks = 0
  state.agreements = 0
  state.lastError = null
  state.lastPriceAt = 0
  state.disagreements = []
}
