import { config } from './config.js'

/**
 * Equity-tiered position sizing.
 *
 * Size steps up as the account grows and, just as importantly, steps back down if it
 * shrinks. Ratcheting up but not down is how a good run gets handed back at the new,
 * larger size.
 *
 * Tiers are evaluated against LIQUID wallet balance. Mark-to-market equity would count
 * open meme coin bags as if they were money, and on this asset class they frequently
 * are not.
 */
export function tierFor(walletSol) {
  const equity = Number.isFinite(walletSol) ? walletSol : 0
  return config.sizing.tiers.find((t) => equity >= t.minEquitySol) ?? config.sizing.tiers.at(-1)
}

export function buySolFor(walletSol) {
  /**
   * THE PROBE'S SIZE OVERRIDES THE TIER IN BOTH DIRECTIONS.
   *
   * A measurement run must not scale with the account — the whole point is that it stays
   * absurdly small while the real rules decide WHICH trades to place. Taking the minimum
   * of the two would let a tiny account quietly probe at its tier size; taking the
   * probe's figure outright means the cap is the cap.
   */
  if (config.probe.enabled) return config.probe.positionSol
  return tierFor(walletSol).buySol
}

/**
 * The same size, capped against the DEPTH OF THE CURVE we are buying into.
 *
 * Equity tiers answer "how much of the account should be at risk", which is only half
 * the question. A round trip on a constant product is price-neutral, so depth is not a
 * fee — what it costs is FILL DRAG: you pay the average price going in and receive the
 * average coming out, and both are worse than the mid by roughly the size over the
 * reserves. Flat sizing therefore means the same number is a 0.2% cost on a 150 SOL
 * curve and a 15% cost on a 2 SOL one.
 *
 * That stopped being hypothetical when the market-cap floor came off: 41% of the
 * launches the entry rules now accept sit below 20 SOL of depth, and the median is 28.
 * Charging the drag row by row, capping at 2% of depth returns 1.31 SOL per hundred
 * candidates against 1.17 flat — and, more to the point, it stops the bot putting a
 * seventh of a thin curve's entire reserves into one position.
 *
 * Below `minBuySol` the trade is not worth its priority fee, so it is skipped rather
 * than taken in a size that cannot pay for itself.
 */
export function buySolForCurve(walletSol, vSol) {
  const tier = buySolFor(walletSol)
  const share = config.sizing.maxCurveSharePct / 100
  if (!(share > 0) || !Number.isFinite(vSol) || !(vSol > 0)) return tier
  return Math.min(tier, vSol * share)
}

/**
 * Too small to be worth a priority fee — the caller should skip rather than shrink.
 *
 * THE PROBE IS EXEMPT, and without that exemption it cannot place a single order.
 * PROBE_POSITION_SOL defaults to 0.01 and MIN_BUY_SOL to 0.02, so buySolFor returns the
 * probe size, this floor rejects it, and #enter skips every candidate with "below the fee
 * floor". The facility that exists to answer the one question paper structurally cannot —
 * whether a real order fills at all — was dead on its own defaults, and it would have
 * failed silently: a log line per launch, no orders, no error, an empty ledger that looks
 * exactly like a quiet market.
 *
 * The exemption is not a special case, it is the rule applied correctly. This floor asks
 * whether a trade can EARN back its fee, which is the right question for a position taken
 * to make money and the wrong one for a position taken to measure something. The probe's
 * fee is not overhead to amortise; it is the price of the measurement, and it is bounded
 * by probe.maxTrades and probe.maxTotalSol rather than by this.
 */
export function tooSmallToTrade(buySol) {
  if (config.probe.enabled) return !(buySol > 0)
  return !(buySol >= config.sizing.minBuySol)
}

/** Deployment cap follows the active tier unless MAX_DEPLOYED_SOL pins it explicitly. */
export function maxDeployedFor(walletSol) {
  if (config.sizing.maxDeployedSol > 0) return config.sizing.maxDeployedSol
  return buySolFor(walletSol) * config.sizing.maxConcurrentPositions
}

/** The next step up, for display — so you can see what you are working toward. */
export function nextTier(walletSol) {
  const current = tierFor(walletSol)
  const higher = config.sizing.tiers
    .filter((t) => t.minEquitySol > current.minEquitySol)
    .sort((a, b) => a.minEquitySol - b.minEquitySol)
  return higher[0] ?? null
}

export function sizingSummary(walletSol) {
  const current = tierFor(walletSol)
  const next = nextTier(walletSol)
  return {
    walletSol,
    buySol: current.buySol,
    tierFloorSol: current.minEquitySol,
    maxDeployedSol: maxDeployedFor(walletSol),
    maxConcurrent: config.sizing.maxConcurrentPositions,
    nextTier: next
      ? { atSol: next.minEquitySol, buySol: next.buySol, remainingSol: Math.max(0, next.minEquitySol - (walletSol ?? 0)) }
      : null,
    allTiers: [...config.sizing.tiers].sort((a, b) => a.minEquitySol - b.minEquitySol),
  }
}
