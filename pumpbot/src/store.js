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
  /**
   * The explore book's DENOMINATOR — the same matched set the strategy book keeps.
   *
   * Explore is by far the largest sample this bot produces: tens of thousands of real
   * closed trades against the strategy's few hundred, and the only direct measurement of
   * what the REJECTED arm actually returns. It is therefore the one place the replay can
   * be scored against reality — but only with a stake to divide by.
   *
   * Without it the panel could only report SOL per trade, and turning that into a
   * multiple meant assuming a position size. That assumption is wrong by construction
   * here: explore is sized by buySolForCurve, so it varies with the wallet's tier AND is
   * capped at a share of each curve's depth. Assuming 0.15 where the real average is
   * 0.09 turns 0.80x into 0.67x, which is the difference between "the replay is a little
   * optimistic" and "the replay is not describing this book at all".
   */
  exploreStakedSol: 0,
  exploreRealizedOnStakedSol: 0,
  exploreStakedTrades: 0,
  // Drawdown circuit breaker state. Persisted so a restart cannot silently reset the
  // ratchet and hand the bot a fresh allowance. baseEquitySol anchors the account size
  // once; peakRealizedSol is the high-water mark realized P&L has ever reached.
  baseEquitySol: 0,
  peakRealizedSol: 0,
  blockedCreators: {}, // creator -> { at, reason }
  halted: null, // { at, reason } — set by a circuit breaker
  activity: [], // rolling event feed for the dashboard, newest last
  /**
   * When the process last came up, and how many times it has. Persisted for one reason:
   * a startup alert that cannot say WHY it is starting is unreadable. A deploy and a
   * crash loop produce the identical message, so the only way to tell them apart is to
   * remember the previous start and report the gap.
   */
  lastStartedAt: 0,
  startCount: 0,
  /**
   * Notional money added to the PAPER book, kept apart from realized P&L so a refill can
   * never be mistaken for a profit. See topUpPaper.
   */
  paperTopUpSol: 0,
  paperTopUps: 0,
  /** Which build is running, and when it first did — see recordStart. */
  buildVersion: '',
  buildFirstSeenAt: 0,
  /**
   * THE FILL PROBE'S LEDGER, persisted so a restart cannot hand it a fresh allowance.
   *
   * The probe spends real money to answer the one question paper structurally cannot —
   * whether orders actually execute. Keeping its counters only in memory would mean
   * every redeploy silently restarted the run, which is how a 50-trade measurement
   * becomes an open-ended live strategy nobody decided to start.
   *
   * `attempts` counts orders SENT, `trades` counts positions actually opened, and the
   * gap between them is the answer we are paying for.
   */
  probe: { attempts: 0, trades: 0, failures: 0, committedSol: 0, reasons: {}, fillRatios: [] },
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

/**
 * Stamp this start and report what the PREVIOUS one looked like.
 *
 * Returns the gap to the last start, which is the only thing that distinguishes a
 * deploy from a crash loop — the two are otherwise the same event from inside the
 * process. Reads before it writes, so the value returned describes the run that just
 * ended rather than this one.
 */
export function recordStart(now = Date.now()) {
  const s = getState()
  const previousAt = s.lastStartedAt || 0
  const sinceSeconds = previousAt ? Math.round((now - previousAt) / 1000) : null
  s.lastStartedAt = now
  s.startCount = (s.startCount ?? 0) + 1
  /**
   * WHEN THIS BUILD FIRST RAN, stamped once per version.
   *
   * Cumulative P&L answers "how has this bot done", which stops being the useful
   * question the moment the strategy changes: a book carrying days of losses from rules
   * that no longer exist will bury whatever the new ones do, and the only way to read it
   * is to remember when the change landed and do arithmetic by eye. Recording the moment
   * makes "how are the CURRENT rules doing" answerable without discarding the history
   * that makes the old rules judgeable.
   *
   * Keyed on version rather than on every start, so a restart does not reset the
   * measurement and lose an afternoon of evidence.
   */
  if (s.buildVersion !== config.version) {
    s.buildVersion = config.version
    s.buildFirstSeenAt = now
  }
  save()
  return {
    previousAt,
    sinceSeconds,
    startCount: s.startCount,
    buildFirstSeenAt: s.buildFirstSeenAt,
    buildChanged: s.buildFirstSeenAt === now,
  }
}

/** The probe's counters, defaulted so an older state file reads cleanly. */
export function probeLedger() {
  const s = getState()
  const p = s.probe ?? {}
  return {
    attempts: p.attempts ?? 0,
    trades: p.trades ?? 0,
    failures: p.failures ?? 0,
    committedSol: p.committedSol ?? 0,
    reasons: p.reasons ?? {},
    fillRatios: p.fillRatios ?? [],
  }
}

/**
 * Record one probe order and what became of it.
 *
 * `fillRatio` is the price we actually got over the price we expected when we decided —
 * the number the whole exercise exists to produce. A failure records WHY, because "the
 * order did not land" and "it landed 30% worse" are different problems with different
 * fixes, and the reason string is the only thing that tells them apart.
 */
export function recordProbeOrder({ ok, solSpent = 0, fillRatio = null, reason = null }) {
  const s = getState()
  if (!s.probe) s.probe = { attempts: 0, trades: 0, failures: 0, committedSol: 0, reasons: {}, fillRatios: [] }
  const p = s.probe
  p.attempts = (p.attempts ?? 0) + 1
  if (ok) {
    p.trades = (p.trades ?? 0) + 1
    p.committedSol = (p.committedSol ?? 0) + solSpent
    if (Number.isFinite(fillRatio)) {
      p.fillRatios = [...(p.fillRatios ?? []), Number(fillRatio.toFixed(4))].slice(-200)
    }
  } else {
    p.failures = (p.failures ?? 0) + 1
    const key = String(reason ?? 'unknown').replace(/\d+/g, 'N').slice(0, 120)
    p.reasons = { ...(p.reasons ?? {}), [key]: ((p.reasons ?? {})[key] ?? 0) + 1 }
  }
  save()
  return probeLedger()
}

/**
 * Strategy P&L over the closed trades since `since`, so a config change can be judged on
 * what it did rather than on what the book was carrying before it.
 */
export function recordSince(since) {
  const s = getState()
  const rows = s.closed.filter((p) => !p.explore && (p.closedAt ?? 0) >= since)
  let wins = 0, realized = 0, staked = 0
  for (const p of rows) {
    realized += p.realizedSol ?? 0
    staked += p.solSpent ?? 0
    if ((p.realizedSol ?? 0) > 0) wins++
  }
  return {
    since,
    closed: rows.length,
    wins,
    losses: rows.length - wins,
    realizedSol: realized,
    stakedSol: staked,
    // Multiple of what was actually staked over this window — the two are a matched set,
    // which is the bug that produced a -5.7x calibration figure when they were not.
    multiple: staked > 0 ? (staked + realized) / staked : null,
  }
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
    // Stake, P&L on that stake, and count move together or not at all — the same three
    // fields the strategy book keeps, for the same reason. See exploreStakedSol.
    s.exploreStakedSol = (s.exploreStakedSol ?? 0) + Math.max(0, p.solSpent ?? 0)
    s.exploreRealizedOnStakedSol = (s.exploreRealizedOnStakedSol ?? 0) + realized
    s.exploreStakedTrades = (s.exploreStakedTrades ?? 0) + 1
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
    /**
     * Stake, P&L and COUNT accumulated together, as a matched set.
     *
     * Only stakedSol was added here, and totalRealizedSol was divided by it — a total
     * running since the account opened over a denominator that started days later. 174
     * historical trades had no recorded stake, so the ratio was ~5 trades of stake
     * against 179 trades of losses and the report printed "the account actually
     * returned -5.726x", which a long-only book cannot do.
     *
     * Three fields that only ever move together cannot drift apart.
     */
    s.daily[day].stakedSol = (s.daily[day].stakedSol ?? 0) + Math.max(0, p.solSpent ?? 0)
    s.daily[day].realizedOnStakedSol = (s.daily[day].realizedOnStakedSol ?? 0) + realized
    s.daily[day].stakedTrades = (s.daily[day].stakedTrades ?? 0) + 1
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
  /**
   * How well the exits actually filled, relative to what the position was marked at.
   * Kept on the closed record because a bag that could not be sold is the one failure
   * the paper book would otherwise report as a clean win — paperSell always quotes a
   * number, whether or not a real sale would have cleared.
   */
  if (Number.isFinite(p.worstExitRatio)) p.worstExitRatio = Number(p.worstExitRatio.toFixed(4))
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
  let realizedOnStaked = 0
  let stakedTrades = 0
  for (const day of Object.values(s.daily ?? {})) {
    wins += day.wins ?? 0
    losses += day.losses ?? 0
    stakedSol += day.stakedSol ?? 0
    realizedOnStaked += day.realizedOnStakedSol ?? 0
    stakedTrades += day.stakedTrades ?? 0
  }
  /**
   * What the account ACTUALLY returned per SOL risked — over the trades whose stake we
   * recorded, NOT over all time. totalRealizedSol covers trades from before this
   * counter existed, and dividing it by a denominator that started later is how the
   * report came to claim -5.726x on a long-only book.
   */
  const realizedMultiple = stakedSol > 0 ? 1 + realizedOnStaked / stakedSol : null
  // Trades that closed at exactly break-even increment neither counter, so this is the
  // count of DECIDED trades. It is the denominator a win rate actually wants.
  return { wins, losses, closed: wins + losses, stakedSol, stakedTrades, realizedOnStaked, realizedMultiple }
}

export function exploreRecord() {
  const s = getState()
  const wins = s.exploreWins ?? 0
  const losses = s.exploreLosses ?? 0
  const stakedSol = s.exploreStakedSol ?? 0
  const stakedTrades = s.exploreStakedTrades ?? 0
  const realizedOnStaked = s.exploreRealizedOnStakedSol ?? 0
  return {
    wins,
    losses,
    closed: wins + losses,
    realizedSol: s.exploreRealizedSol ?? 0,
    stakedSol,
    stakedTrades,
    realizedOnStaked,
    /**
     * Scored over the trades whose stake was recorded, NOT over all time — the counters
     * above start when they were added, while exploreRealizedSol has been running since
     * the book opened. Dividing the older total by the newer denominator is exactly the
     * mistake that once had the strategy report claiming -5.726x on a long-only book.
     */
    realizedMultiple: stakedSol > 0 ? 1 + realizedOnStaked / stakedSol : null,
  }
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
  return startSol + (s.paperTopUpSol ?? 0) + (s.totalRealizedSol ?? 0) - deployedSol()
}

/**
 * Refill the notional paper book so an experiment cannot end by running out of pretend
 * money. Returns the amount added, or null when nothing was needed.
 *
 * REFUSES OUTRIGHT IN LIVE. Topping up a real account is a decision about real money
 * that a program must never take on someone's behalf, and there is deliberately no flag
 * that changes that.
 *
 * Top-ups are accumulated SEPARATELY from realized P&L. Folding them into
 * totalRealizedSol would be the one thing that must never happen here: every statistic
 * in the report — the calibration line, the multiple on staked capital, the daily
 * figures — is built on that number meaning "what trading produced", and a bot that
 * credits itself with its own deposits reports a profit it did not make.
 */
export function topUpPaper(startSol, { below = config.paperTopUpBelowSol } = {}) {
  if (!config.paper) return null
  const s = getState()
  const balance = paperWalletSol(startSol)
  if (!(balance < below)) return null

  const amount = startSol - balance
  s.paperTopUpSol = (s.paperTopUpSol ?? 0) + amount
  s.paperTopUps = (s.paperTopUps ?? 0) + 1
  /**
   * Restart the loss ratchet, because the breakers measure drawdown from PEAK realized
   * P&L. Without this the book is refilled and then halted again on the next check by a
   * limit still describing the losses the refill exists to move past — a top-up that
   * buys nothing. Choosing to continue is what a top-up means, so the drawdown clock
   * starts again from here.
   */
  s.peakRealizedSol = s.totalRealizedSol ?? 0
  if (s.halted && s.halted.kind !== 'manual') {
    log.warn(`clearing "${s.halted.reason}" — the paper book was topped up`)
    s.halted = null
  }
  save()
  log.warn(`paper book topped up by ${amount.toFixed(4)} SOL (top-up #${s.paperTopUps}) — ` +
    `realized P&L is untouched at ${(s.totalRealizedSol ?? 0).toFixed(4)}`)
  return amount
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
