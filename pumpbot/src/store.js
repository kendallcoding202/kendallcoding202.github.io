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
  blockedCreators: {}, // creator -> { at, reason }
  halted: null, // { at, reason } — set by a circuit breaker
}

let state = null
let file = null

export function initStore() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  file = path.join(config.dataDir, config.paper ? 'paper-state.json' : 'live-state.json')
  try {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
    state = loaded?.version === 1 ? { ...structuredClone(EMPTY), ...loaded } : structuredClone(EMPTY)
  } catch {
    state = structuredClone(EMPTY)
    log.info(`fresh ${config.paper ? 'paper' : 'live'} state at ${file}`)
  }
  return state
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

export const deployedSol = () =>
  openPositions().reduce((sum, p) => sum + Math.max(0, p.solSpent - p.solRecovered), 0)

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
  const day = utcDay()
  s.daily[day] ??= { realizedSol: 0, wins: 0, losses: 0 }
  s.daily[day].realizedSol += realized
  s.totalRealizedSol += realized

  if (realized > 0) {
    s.daily[day].wins++
    s.consecutiveLosses = 0
  } else if (realized < 0) {
    s.daily[day].losses++
    s.consecutiveLosses++
  }

  p.state = 'closed'
  p.closedAt = Date.now()
  p.closeReason = reason
  p.realizedSol = realized

  s.closed.push(p)
  if (s.closed.length > 500) s.closed = s.closed.slice(-500)
  delete s.positions[mint]

  save()
  return p
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

export function halt(reason) {
  const s = getState()
  if (s.halted) return s.halted
  s.halted = { at: Date.now(), reason }
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
