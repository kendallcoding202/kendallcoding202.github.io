import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log, utcDay } from './log.js'

const EMPTY = {
  version: 1,
  positions: {}, // mint -> position
  closed: [], // completed trades, newest last
  daily: {}, // utc day -> { realizedSol, wins, losses }
  totalRealizedSol: 0,
  consecutiveLosses: 0,
  // Exploration is an experiment, not the strategy. Its P&L is booked separately so it
  // cannot trip the strategy's circuit breakers or distort the headline numbers.
  exploreRealizedSol: 0,
  exploreWins: 0,
  exploreLosses: 0,
  // Drawdown circuit breaker state. Persisted so a restart cannot silently reset the
  // ratchet and hand the bot a fresh allowance. baseEquitySol anchors the account size
  // once; peakRealizedSol is the high-water mark realized P&L has ever reached.
  baseEquitySol: 0,
  peakRealizedSol: 0,
  blockedCreators: {}, // creator -> { at, reason }
  halted: null, // { at, reason } — set by a circuit breaker
  activity: [], // rolling event feed for the dashboard, newest last
}

let state = null
let file = null

export function initStore() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  file = path.join(config.dataDir, config.paper ? 'paper-state.json' : 'live-state.json')
  try {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
    state = loaded?.version === 1 ? { ...structuredClone(EMPTY), ...loaded } : structuredClone(EMPTY)
    migrateHalt(state)
  } catch {
    state = structuredClone(EMPTY)
    log.info(`fresh ${config.paper ? 'paper' : 'live'} state at ${file}`)
  }
  return state
}

/**
 * A halt written before `kind` existed has none, and an untagged halt is treated as
 * manual — which means it can never be cleared automatically and the bot stays halted
 * forever. That is exactly what happened: a halt from the 0.5 SOL era survived the raise
 * to 50 SOL, and with entry blocked the bot screened 314 launches and took none.
 *
 * Infer it from the reason instead of defaulting, so a limit-raised halt can go stale the
 * way it should while anything a human asked for stays put.
 */
function migrateHalt(s) {
  if (!s?.halted || s.halted.kind) return
  const reason = String(s.halted.reason ?? '').toLowerCase()
  const fromALimit = /loss|drawdown|limit/.test(reason)
  s.halted.kind = fromALimit ? 'drawdown' : 'manual'
  log.warn(`tagged a legacy halt as '${s.halted.kind}': ${s.halted.reason}`)
}

export function getState() {
  if (!state) initStore()
  return state
}

/** Write via a temp file + rename so a crash mid-write cannot corrupt the ledger. */
export function save() {
  if (!state || !file) return
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export const openPositions = () => Object.values(getState().positions).filter((p) => p.state !== 'closed')

/** Real strategy positions. Explore trades must not consume the live exposure budget. */
export const strategyPositions = () => openPositions().filter((p) => !p.explore)
export const explorePositions = () => openPositions().filter((p) => p.explore)

const tiedUpIn = (positions) =>
  positions.reduce((sum, p) => sum + Math.max(0, p.solSpent - p.solRecovered), 0)

export const deployedSol = () => tiedUpIn(strategyPositions())
export const exploreDeployedSol = () => tiedUpIn(explorePositions())

export function addPosition(position) {
  getState().positions[position.mint] = position
  save()
}

export function updatePosition(mint, patch) {
  const s = getState()
  if (!s.positions[mint]) return null
  Object.assign(s.positions[mint], patch)
  save()
  return s.positions[mint]
}

/**
 * Books a finished trade. Realized PnL is everything we got back minus everything we
 * put in, so a position that recovered initials and rode a moon bag to zero still
 * books flat rather than a loss.
 */
export function closePosition(mint, reason) {
  const s = getState()
  const p = s.positions[mint]
  if (!p) return null

  const realized = p.solRecovered - p.solSpent

  if (p.explore) {
    // Booked apart from the strategy: an experiment that loses money on purpose must
    // not halt the thing it is trying to measure.
    s.exploreRealizedSol += realized
    if (realized > 0) s.exploreWins++
    else if (realized < 0) s.exploreLosses++
  } else {
    const day = utcDay()
    s.daily[day] ??= { realizedSol: 0, wins: 0, losses: 0, stakedSol: 0 }
    s.daily[day].realizedSol += realized
    /**
     * Capital actually put at risk, accumulated as a counter.
     *
     * Without it there is no denominator for "what multiple did this account actually
     * return", and so no way to check the replay against reality — the report could
     * claim 0.976x while the account was doing 0.812x and nothing would notice. A
     * backtest nobody scores is a story.
     */
    s.daily[day].stakedSol = (s.daily[day].stakedSol ?? 0) + Math.max(0, p.solSpent ?? 0)
    s.totalRealizedSol += realized

    if (realized > 0) {
      s.daily[day].wins++
      s.consecutiveLosses = 0
    } else if (realized < 0) {
      s.daily[day].losses++
      s.consecutiveLosses++
    }
  }

  p.state = 'closed'
  p.closedAt = Date.now()
  p.closeReason = reason
  p.realizedSol = realized

  s.closed.push(p)
  trimClosed(s)
  delete s.positions[mint]

  save()
  return p
}

/**
 * Retained closed trades, PER BOOK.
 *
 * This was one shared list capped at 500, and the experiment ate the strategy alive.
 * Explore closed 25,922 trades against the strategy's ~143, so the last 500 entries
 * were 100% explore and every strategy trade had been evicted. The dashboard then
 * showed "0W / 0L · 0 closed" and "no closed trades yet" on an account whose realized
 * P&L was -4.92 SOL, because that figure is a counter and the trade list is not.
 *
 * The strategy's own trades are the scarcest evidence this bot produces — a few hundred
 * against six figures of shadow rows. They must never be crowded out by the thing that
 * exists to be compared against them.
 */
const KEEP_CLOSED = { strategy: 300, explore: 300 }

function trimClosed(s) {
  const strategy = []
  const explore = []
  for (const p of s.closed) (p.explore ? explore : strategy).push(p)
  /**
   * Checked per book rather than on the combined length. A total under the sum of the
   * two caps does not mean both are under their own — 0 strategy trades beside 500
   * explore ones is exactly the state this exists to prevent, and it clears any check
   * on the total.
   */
  if (strategy.length <= KEEP_CLOSED.strategy && explore.length <= KEEP_CLOSED.explore) return
  s.closed = [...strategy.slice(-KEEP_CLOSED.strategy), ...explore.slice(-KEEP_CLOSED.explore)].sort(
    (a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0),
  )
}

/**
 * Trade counts from the COUNTERS, not from the retained list.
 *
 * Same lesson as the balance: anything derived from a bounded array silently starts
 * describing the bound instead of the account. The explore panel divided realized P&L
 * by the retained length and reported -1.7659 SOL average on a 0.1505 SOL position —
 * a loss twelve times the stake, on a long-only paper trade, which is not a number that
 * can exist. These are the totals for all time.
 */
export function strategyRecord() {
  const s = getState()
  let wins = 0
  let losses = 0
  let stakedSol = 0
  for (const day of Object.values(s.daily ?? {})) {
    wins += day.wins ?? 0
    losses += day.losses ?? 0
    stakedSol += day.stakedSol ?? 0
  }
  /**
   * What the account ACTUALLY returned per SOL risked. This is the number every replay
   * in the learning report is claiming to predict, and until now nothing compared them.
   */
  const realizedMultiple = stakedSol > 0 ? 1 + (s.totalRealizedSol ?? 0) / stakedSol : null
  // Trades that closed at exactly break-even increment neither counter, so this is the
  // count of DECIDED trades. It is the denominator a win rate actually wants.
  return { wins, losses, closed: wins + losses, stakedSol, realizedMultiple }
}

export function exploreRecord() {
  const s = getState()
  const wins = s.exploreWins ?? 0
  const losses = s.exploreLosses ?? 0
  return { wins, losses, closed: wins + losses, realizedSol: s.exploreRealizedSol ?? 0 }
}

/**
 * Rolling activity feed. Bounded hard — this is display state, and an unbounded array
 * in a file the bot rewrites on every fill would grow without limit.
 */
export function logActivity(kind, text, extra = {}) {
  const s = getState()
  s.activity.push({ at: Date.now(), kind, text, ...extra })
  if (s.activity.length > 300) s.activity = s.activity.slice(-300)
}

/**
 * Paper balance, DERIVED from the ledger rather than tracked as a running counter.
 *
 * A counter drifts: it resets to the starting balance on restart, but positions opened
 * before the restart still credit their sells with no matching debit, so every restart
 * inflates it. Live mode self-corrects by reading the chain; paper had nothing to
 * correct against, and an inflated balance silently bumps the size tier.
 *
 * Double-entry: start + everything realized - capital still tied up in open positions.
 *
 * STRATEGY ONLY. Explore is a simulation running alongside on separate notional money,
 * and folding it in here broke two things at once: 15 concurrent explores at 0.075 tie
 * up 1.1 SOL against a 0.5 SOL book, so the balance went negative and TOTAL VALUE read
 * -0.650; and because the size tier reads this balance, the experiment was steering the
 * strategy's position sizing. The paper strategy wallet has to mirror what live would
 * do, and live never places an explore trade.
 */
export function paperWalletSol(startSol) {
  const s = getState()
  return startSol + (s.totalRealizedSol ?? 0) - deployedSol()
}

/** The experiment's own notional bankroll, tracked the same way and kept apart. */
export function paperExploreWalletSol(startSol) {
  const s = getState()
  return startSol + (s.exploreRealizedSol ?? 0) - exploreDeployedSol()
}

export function todayPnl() {
  return getState().daily[utcDay()] ?? { realizedSol: 0, wins: 0, losses: 0 }
}

export function blockCreator(creator, reason) {
  if (!creator) return
  getState().blockedCreators[creator] = { at: Date.now(), reason }
  save()
}

export const isCreatorBlocked = (creator) => Boolean(creator && getState().blockedCreators[creator])

export function halt(reason, kind = 'manual') {
  const s = getState()
  if (s.halted) return s.halted
  // `kind` lets a halt raised by a limit that no longer applies be distinguished from
  // one a human asked for. Only the former is ever cleared automatically.
  s.halted = { at: Date.now(), reason, kind }
  save()
  log.error(`HALTED: ${reason}`)
  return s.halted
}

export function clearHalt() {
  const s = getState()
  s.halted = null
  s.consecutiveLosses = 0
  save()
}
