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
  return tierFor(walletSol).buySol
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
