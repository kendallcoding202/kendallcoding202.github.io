import { config } from './config.js'
import {
  getState,
  strategyPositions,
  deployedSol,
  todayPnl,
  isCreatorBlocked,
  strategyRecord,
  halt,
  clearHalt,
} from './store.js'
import { buySolFor, maxDeployedFor, sizingSummary } from './sizing.js'
import { log, sol } from './log.js'

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
/**
 * Keeps the drawdown anchor current, independently of whether anything trades.
 *
 * This used to live only inside canOpen, which is reached exactly once — from the
 * non-explore branch of #enter, and only for a candidate that PASSED the filter. With
 * the filter passing 0 of 314, canOpen was never called, so the anchor was never
 * refreshed and a stale halt could never clear: the only code that could un-stick the
 * bot required the bot to already be unstuck. The balance refresh runs on a timer
 * regardless, so it belongs there too.
 */
export function syncEquityBasis(walletSol) {
  return equityBasis(walletSol)
}

function equityBasis(walletSol) {
  const s = getState()

  /**
   * `observed` is what the account started with, backed out of where it is now. Trading
   * cannot move it: a loss reduces the wallet and increases |totalRealized| by the same
   * amount, so the two cancel. Only money coming IN or OUT changes it.
   *
   * That makes it a deposit detector, and it has to be one. Anchoring once and never
   * revisiting meant a stale anchor outlived the account it described: raising the paper
   * book from 0.5 to 50 SOL left the limits denominated in the old account, so the bot
   * halted permanently after 0.36 SOL of losses — 0.7% of its balance — and the whole
   * point of the raise was lost. The same thing happens in live the first time you top up
   * a wallet.
   */
  const observed = (Number.isFinite(walletSol) ? walletSol : 0) + deployedSol() - s.totalRealizedSol
  const stored = s.baseEquitySol ?? 0
  if (observed > 0 && (!(stored > 0) || Math.abs(observed - stored) > Math.max(0.02, stored * 0.05))) {
    if (stored > 0) {
      log.warn(
        `account size changed ${sol(stored)} → ${sol(observed)} — re-anchoring the drawdown ` +
          'limits to the new balance',
      )
    }
    s.baseEquitySol = observed
    /**
     * A drawdown halt raised against the OLD account size is no longer a true statement
     * about this one — "0.36 SOL from a 0.5 SOL peak" says nothing about a 50 SOL book.
     * Topping an account up is a decision to continue, so the stale halt is cleared and
     * the rule below immediately re-decides against the new base. If the breach is real
     * at the new size it halts again in this same call, so this can only ever un-stick a
     * limit that has genuinely stopped applying. A halt someone asked for is never
     * touched.
     */
    // Only a genuine TOP-UP clears a halt, never a shrink. In live the wallet drifts
    // down as fees are paid that realized P&L does not capture, and that slow leak must
    // never accumulate into permission to trade again.
    if (observed > stored * 1.25 && s.halted?.kind === 'drawdown') {
      log.warn(`clearing a halt raised against the old account size: ${s.halted.reason}`)
      clearHalt()
    }
  }
  const base = s.baseEquitySol ?? 0
  if (!(base > 0)) return null // nothing trustworthy to measure against yet

  if (!(s.peakRealizedSol > s.totalRealizedSol)) s.peakRealizedSol = s.totalRealizedSol
  const peak = base + (s.peakRealizedSol ?? 0)
  const now = base + s.totalRealizedSol
  return peak > 0 ? { peak, now, drawdownPct: ((peak - now) / peak) * 100 } : null
}

/**
 * How long a losing run has to be before it means anything.
 *
 * A fixed threshold encodes an assumed win rate, and gets this badly wrong when the
 * real one is different. At the 20.1% this strategy runs, six losses in a row is a 26%
 * event and arrives after about fourteen trades — so a limit of six paused the bot a
 * few trades into every UTC day and left it paused until the next one. It was not
 * catching a broken strategy; it was switching off a working one for behaving normally.
 *
 * So ask the question that actually matters: is this run unlikely UNDER THIS
 * STRATEGY'S OWN win rate? P(k losses) = (1-w)^k, so the run length that happens less
 * than `streakAlpha` of the time is ln(alpha)/ln(1-w). At w=0.20 that is 21; at a
 * coin-flip 0.50 it is 7, near the old fixed value — which is the assumption the old
 * number was carrying all along.
 *
 * Never tighter than the configured floor, and only used once there are enough trades
 * to estimate a win rate at all.
 */
export function consecutiveLossLimit() {
  const { wins, closed } = strategyRecord()
  const floor = config.risk.maxConsecutiveLosses
  if (closed < config.risk.minTradesForAdaptiveStreak) return floor
  const winRate = wins / closed
  // A strategy that has never won gives no rate to reason from; fall back to the floor.
  if (!(winRate > 0) || winRate >= 1) return floor
  const k = Math.ceil(Math.log(config.risk.streakAlpha) / Math.log(1 - winRate))
  return Math.max(floor, k)
}

/**
 * Every buy passes through here. Each rule returns a reason string to block, or null.
 * The checks are ordered cheapest-first, and the hard limits come before anything
 * discretionary — a circuit breaker must not be reachable only after a network call.
 */
export function canOpen({ mint, creator, walletSol }) {
  const s = getState()
  const { sizing, risk } = config

  /**
   * Equity FIRST, before the halt check — because re-anchoring can clear a halt that was
   * raised against an account size which no longer exists. Checking `halted` first
   * returned early and left the stale halt in place forever, which is the state a
   * topped-up account would have been stuck in.
   */
  const equity = equityBasis(walletSol)

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
  const lossFromPeak = Math.max(0, (equity ? (s.peakRealizedSol ?? 0) : 0) - s.totalRealizedSol)
  const totalLimit = Math.max(
    risk.totalLossLimitSol,
    equity && risk.maxDrawdownPct > 0 ? (risk.maxDrawdownPct / 100) * equity.peak : 0,
  )
  if (totalLimit > 0 && lossFromPeak >= totalLimit) {
    halt(
      `realized drawdown ${sol(lossFromPeak)}${equity ? ` from peak equity ${sol(equity.peak)}` : ''} ` +
        `(limit ${sol(totalLimit)})`,
      'drawdown',
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
  const streakLimit = consecutiveLossLimit()
  if (s.consecutiveLosses >= streakLimit) {
    return `${s.consecutiveLosses} consecutive losses (limit ${streakLimit}) — paused for the day`
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
    /**
     * The gate's own state, so a bot that is silently refusing every entry says so.
     * Nothing on the page reported this, and the only trace of it was a 'blocked' count
     * nobody was printing — 15 approved launches refused with no indication anywhere.
     */
    streakLimit: consecutiveLossLimit(),
    pausedByStreak: s.consecutiveLosses >= consecutiveLossLimit(),
    blockedCreators: Object.keys(s.blockedCreators ?? {}).length,
  }
}
