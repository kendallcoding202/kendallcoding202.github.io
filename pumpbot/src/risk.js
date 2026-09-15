import { config } from './config.js'
import { getState, strategyPositions, deployedSol, todayPnl, isCreatorBlocked, halt } from './store.js'
import { buySolFor, maxDeployedFor, sizingSummary } from './sizing.js'
import { sol } from './log.js'

/**
 * Equity used by the drawdown breaker, derived from OUR LEDGER rather than from a live
 * balance read.
 *
 * The obvious implementation — compare the current wallet balance to its high-water mark
 * — is unsafe, and the test suite caught it doing exactly the unsafe thing: one bad or
 * transient balance reading (an RPC hiccup returning 0, a fetch that failed, a read
 * taken mid-buy before the position is booked) looks like a catastrophic drawdown and
 * trips a PERMANENT halt. An external number you cannot verify must never be the sole
 * input to an irreversible action.
 *
 * `totalRealizedSol` is our own double-entry figure, so this measures the only drawdown
 * we can actually vouch for: realized losses against the best the account has ever been.
 * Open positions are excluded — an unrealized dip is not a drawdown yet, and the
 * stop-loss already governs those.
 */
function equityBasis(walletSol) {
  const s = getState()
  // Anchor the account size once, from the first trustworthy reading we ever see.
  if (!(s.baseEquitySol > 0)) {
    const observed = (Number.isFinite(walletSol) ? walletSol : 0) + deployedSol() - s.totalRealizedSol
    if (observed > 0) s.baseEquitySol = observed
  }
  const base = s.baseEquitySol ?? 0
  if (!(base > 0)) return null // nothing trustworthy to measure against yet

  if (!(s.peakRealizedSol > s.totalRealizedSol)) s.peakRealizedSol = s.totalRealizedSol
  const peak = base + (s.peakRealizedSol ?? 0)
  const now = base + s.totalRealizedSol
  return peak > 0 ? { peak, now, drawdownPct: ((peak - now) / peak) * 100 } : null
}

/**
 * Every buy passes through here. Each rule returns a reason string to block, or null.
 * The checks are ordered cheapest-first, and the hard limits come before anything
 * discretionary — a circuit breaker must not be reachable only after a network call.
 */
export function canOpen({ mint, creator, walletSol }) {
  const s = getState()
  const { sizing, risk } = config

  if (s.halted) return `halted: ${s.halted.reason}`

  /**
   * Permanent capital limit, measured as a drawdown from the account's best realized
   * equity.
   *
   * The absolute and percentage limits combine as a MAX, not a race. Taking whichever
   * fires first would make the percentage rule dead code: a flat 0.35 SOL cap still
   * triggers at 0.35 SOL of losses however large the account has grown, so an account
   * that reached the 5 SOL benchmark would halt permanently on a 7% dip. Taking the
   * larger lets the absolute number act as a floor while the account is small — at a
   * 0.5 SOL start the two are equal by construction, so today's behaviour is unchanged —
   * and lets the percentage take over as the account grows.
   */
  const equity = equityBasis(walletSol)
  const lossFromPeak = Math.max(0, (equity ? (s.peakRealizedSol ?? 0) : 0) - s.totalRealizedSol)
  const totalLimit = Math.max(
    risk.totalLossLimitSol,
    equity && risk.maxDrawdownPct > 0 ? (risk.maxDrawdownPct / 100) * equity.peak : 0,
  )
  if (totalLimit > 0 && lossFromPeak >= totalLimit) {
    halt(
      `realized drawdown ${sol(lossFromPeak)}${equity ? ` from peak equity ${sol(equity.peak)}` : ''} ` +
        `(limit ${sol(totalLimit)})`,
    )
    return 'total loss limit reached'
  }

  // --- Daily circuit breakers, scaled the same way ---
  const today = todayPnl()
  const dailyLimit = Math.max(
    risk.dailyLossLimitSol,
    equity && risk.dailyLossLimitPct > 0 ? (risk.dailyLossLimitPct / 100) * equity.peak : 0,
  )
  if (dailyLimit > 0 && today.realizedSol <= -dailyLimit) {
    return `daily loss limit hit (${sol(today.realizedSol)} today, limit ${sol(dailyLimit)})`
  }
  if (s.consecutiveLosses >= risk.maxConsecutiveLosses) {
    return `${s.consecutiveLosses} consecutive losses — paused for the day`
  }

  // --- Exposure limits, sized to the tier the account is currently in ---
  const buySol = buySolFor(walletSol)
  const maxDeployed = maxDeployedFor(walletSol)

  const open = strategyPositions()
  if (open.length >= sizing.maxConcurrentPositions) {
    return `already holding ${open.length} positions (max ${sizing.maxConcurrentPositions})`
  }
  const deployed = deployedSol()
  if (deployed + buySol > maxDeployed) {
    return `deploying ${sol(deployed + buySol)} would exceed the ${sol(maxDeployed)} cap`
  }

  // --- Wallet must keep enough SOL to pay its way out of every open position ---
  const needed = buySol + config.exec.priorityFeeSol + sizing.reserveSol
  if (Number.isFinite(walletSol) && walletSol < needed) {
    return `wallet ${sol(walletSol)} below ${sol(needed)} needed (buy + fee + reserve)`
  }

  // --- Per-token ---
  if (s.positions[mint]) return 'already holding this mint'
  if (isCreatorBlocked(creator)) return 'creator is blocklisted'

  return null
}

/**
 * Resets that happen on a day boundary. The consecutive-loss pause is a cool-off, not
 * a permanent stop, so it clears with the new UTC day; the total-loss halt does not.
 */
export function rolloverDaily(lastDay, today) {
  if (lastDay === today) return false
  getState().consecutiveLosses = 0
  return true
}

export function riskSummary(walletSol) {
  const s = getState()
  const today = todayPnl()
  return {
    halted: s.halted,
    sizing: sizingSummary(walletSol),
    openPositions: strategyPositions().length,
    deployedSol: deployedSol(),
    todayRealizedSol: today.realizedSol,
    todayWins: today.wins,
    todayLosses: today.losses,
    totalRealizedSol: s.totalRealizedSol,
    consecutiveLosses: s.consecutiveLosses,
  }
}
