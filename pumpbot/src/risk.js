import { config } from './config.js'
import { getState, strategyPositions, deployedSol, todayPnl, isCreatorBlocked, halt } from './store.js'
import { buySolFor, maxDeployedFor, sizingSummary } from './sizing.js'
import { sol } from './log.js'

/**
 * Every buy passes through here. Each rule returns a reason string to block, or null.
 * The checks are ordered cheapest-first, and the hard limits come before anything
 * discretionary — a circuit breaker must not be reachable only after a network call.
 */
export function canOpen({ mint, creator, walletSol }) {
  const s = getState()
  const { sizing, risk } = config

  if (s.halted) return `halted: ${s.halted.reason}`

  // --- Permanent capital limits ---
  if (s.totalRealizedSol <= -risk.totalLossLimitSol) {
    halt(`total realized loss hit ${sol(s.totalRealizedSol)} (limit ${sol(-risk.totalLossLimitSol)})`)
    return 'total loss limit reached'
  }

  // --- Daily circuit breakers ---
  const today = todayPnl()
  if (today.realizedSol <= -risk.dailyLossLimitSol) {
    return `daily loss limit hit (${sol(today.realizedSol)} today)`
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
