/**
 * Test C — PREREG-POLY-MAKER.md: does a paper buy order resting one tick above the best bid
 * (a maker order) on Polymarket sports markets earn the spread?
 *
 * Nothing is ever placed. Live, every minute, each enrolled game's best bid and ask are read
 * and its paper orders re-priced (best bid + 1¢, both outcomes, when the spread is 3–10¢);
 * what the book did while each order rested (a sell offered at or below it, its bids gone,
 * or the price falling far enough below it that a seller would pick it off) is recorded as
 * it happens. Two hours after kickoff the game's public trades are read and every order is
 * replayed under two fill rules:
 *   trade rule — filled only when a real seller reached its price (or a sell crossed it);
 *   touch rule — also filled whenever it was picked off as above.
 *
 * Run by the sports tracker (src/polysports.js). Pure functions first (tested), then I/O.
 */
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { profitPerDollar, armOf, tagsOf, matchKeyOf } from './polysports.js'

// ---------------------------------------------------------------- the registered rule
export const MAKER = {
  enrollMinH: 22, enrollMaxH: 26,      // enrolled when kickoff is this far away (as Tests A/B)
  kickoffSlackMs: 15 * 60_000,         // gameStartTime must lie this close to endDate (games, not tournaments)
  readMs: 60_000,                      // every enrolled game's best bid/ask, every minute
  enrollMs: 15 * 60_000,               // enrolment and kickoff refresh
  minSpread: 30, maxSpread: 100,       // in thousandths: 3¢ to 10¢ (1¢-tick books only)
  stakeUsd: 2, minShares: 5,
  lateMs: 3 * 60_000,                  // reads further apart than this end an order 1 minute after the last one
  lagMs: 60_000,                       // a trade's feed time may trail its match by up to this
  tradesAfterMs: 2 * 3600_000,         // a game's trades are read this long after kickoff
  giveUpMs: 24 * 3600_000,             // a game whose trades cannot be read by then is void
  freshAfterFillMs: 5 * 60_000,        // the kickoff price must be read at least this long after the fill…
  freshBeforeKickoffMs: 10 * 60_000,   // …and no longer than this before kickoff, or the fill is scored on its result
  stopMatches: 300, minDays: 7, stopDays: 28, unsettledAfterDays: 14,
  futilityFromDays: 3, futilityMatches: 150,
  minSettledFills: 100, maxVoidShare: 0.10, maxDowntimeShare: 0.10,
  calBandMil: 50, calMin: 30,          // calibration correction per 5¢ band of the kickoff midpoint
  stopIters: 4000,
}
export const RULE_VERSION = 'C2'
export const MAKER_INFO = {
  name: 'Test C · Maker',
  blurb: 'Rests paper buy orders 1¢ above the best bid on both sides of sports games, re-priced every minute. A fill counts only when a real seller reaches the price. Makers pay no fee.',
  prereg: 'PREREG-POLY-MAKER.md',
}
export const WORLDS = ['trade', 'touch']
export const SIDES = ['cheaper', 'dearer']
const DAY_MS = 86400_000
const BANDS = 1000 / MAKER.calBandMil
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x))
const isoOf = (ms) => new Date(ms).toISOString()
/** Prices are compared in whole thousandths, so 0.06 + 0.01 is exactly 0.07. */
export const mil = (x) => Math.round(Number(x) * 1000)
/** The 5¢ calibration band of a price, on whole thousandths (0.15 is band 3, not 2). */
export const bandOf = (p) => Math.min(BANDS - 1, Math.max(0, Math.floor(mil(p) / MAKER.calBandMil)))

// ---------------------------------------------------------------- enrolment
/** Kickoff from gameStartTime ("2026-10-16 00:15:00+00"), in ms, or null. */
export function kickoffOf(m) {
  const s = String(m.gameStartTime ?? '').trim()
  if (!s) return null
  const t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
  return Number.isFinite(t) ? t : null
}

/** Why a listed market is not enrolled, or null if it is. */
export function ineligible(m, nowMs) {
  if (!armOf(m)) return 'not a two-outcome sports market'
  if (m.acceptingOrders === false) return 'not accepting orders'
  const k = kickoffOf(m)
  if (k === null) return 'no kickoff time'
  if (Math.abs(k - Date.parse(m.endDate)) > MAKER.kickoffSlackMs) return 'not a single game'
  const h = (k - nowMs) / 3600_000
  if (!(h >= MAKER.enrollMinH && h < MAKER.enrollMaxH)) return 'outside the window'
  if (num(m.orderPriceMinTickSize) !== 0.01) return 'not a 1¢-tick book'
  return null
}

export function enrollRecord(m, nowMs, tags, game) {
  let tokens, outcomes
  try { tokens = JSON.parse(m.clobTokenIds); outcomes = JSON.parse(m.outcomes) } catch { return null }
  if (!Array.isArray(tokens) || tokens.length !== 2 || !Array.isArray(outcomes) || outcomes.length !== 2) return null
  return {
    id: String(m.id), cid: m.conditionId, tokens: tokens.map(String), outcomes: outcomes.map(String), question: m.question,
    kickoff: isoOf(kickoffOf(m)), endDate: m.endDate, enrolledAt: isoOf(nowMs),
    event: String(m.events?.[0]?.id ?? m.id), game, minShares: Math.max(MAKER.minShares, num(m.orderMinSize) ?? 0),
    rebateRate: num(m.feeSchedule?.rebateRate), feeRate: num(m.feeSchedule?.rate), rewardsMinSize: num(m.rewardsMinSize), rewardsMaxSpread: num(m.rewardsMaxSpread),
    ...tags,
  }
}

// ---------------------------------------------------------------- quotes and evidence (thousandths)
/** Best bid and ask of outcome 0 from the /prices reply (BUY = best bid, SELL = best ask; "0" = none). */
export function readOf(x) {
  const b = num(x?.BUY), a = num(x?.SELL)
  return { bm: b > 0 ? mil(b) : null, am: a > 0 && a < 1 ? mil(a) : null }
}

/**
 * The paper order prices for a market given outcome 0's best bid and ask: each outcome's
 * best bid + 1¢ (outcome 1's bid is 1 − outcome 0's ask). Only 1¢-grid books with a 3–10¢
 * spread are quoted. Returns { pm: [p0, p1] } or { reason }.
 */
export function quote(bm, am) {
  if (bm === null || am === null) return { reason: 'one-sided' }
  if (bm % 10 || am % 10) return { reason: 'finer tick' }
  const spread = am - bm
  if (spread < MAKER.minSpread) return { reason: 'tight', spread }
  if (spread > MAKER.maxSpread) return { reason: 'wide', spread }
  const pm = [bm + 10, 1000 - am + 10]
  if (pm.some((x) => x < 20 || x > 980)) return { reason: 'out of band', spread }
  return { pm, spread }
}
export const sharesFor = (pm, minShares = MAKER.minShares) => Math.ceil(Math.max(minShares, MAKER.stakeUsd / (pm / 1000)) * 100 - 1e-6) / 100

/** How far below an order's price the market must fall before selling to it pays a taker: 1¢ plus the taker fee. */
export const pickoffMil = (pm, feeRate) => 10 + Math.round(1000 * (feeRate ?? 0.05) * (pm / 1000) * (1 - pm / 1000))

/**
 * What a read says about an order to buy outcome `side` at pm (thousandths):
 *   cross — a sell of its outcome is offered at or below pm (it would have traded with us);
 *   touch — a pick-off: the crossing, its outcome's bids are all gone, or its outcome's
 *           midpoint is below pm by more than 1¢ plus the taker fee (a seller would profit).
 * A spread that widens only on the other side is not a touch.
 */
export function evidenceAt(side, pm, bm, am, feeRate) {
  const ownBid = side === 0 ? bm : am === null ? null : 1000 - am
  const ownAsk = side === 0 ? am : bm === null ? null : 1000 - bm
  const cross = ownAsk !== null && ownAsk <= pm
  const touch = cross ? 'cross' : ownBid === null ? 'bid gone'
    : ownAsk !== null && (ownBid + ownAsk) / 2 < pm - pickoffMil(pm, feeRate) ? 'price fell' : null
  return { cross, touch }
}

/** Shares offered at or below an order's price in outcome 0's full book (outcome 1's sells are its bids, mirrored). */
export function crossSize(book, side, pm) {
  let s = 0
  if (side === 0) for (const a of book?.asks ?? []) { if (mil(a.price) > 0 && mil(a.price) <= pm) s += +a.size }
  else for (const b of book?.bids ?? []) { if (mil(b.price) > 0 && mil(b.price) >= 1000 - pm) s += +b.size }
  return s
}

// ---------------------------------------------------------------- live state
export function newMakerState() {
  return {
    markets: {},      // id → enrolled game
    open: {},         // `${id}:${side}` → the order resting now
    closed: {},       // id → orders that have ended, kept until the game is replayed (and audited)
    retired: {},      // `${id}:${side}` → true once a crossing filled it (no more orders)
    needSize: [],     // crossings whose size still has to be read from the full book
    fills: {},        // `${world}|${id}:${side}` → fill
    replayed: {},     // id → { at, trades, status, auditAt?, audited? }
    cal: {},          // id → { mid, at, kickoff, game, quoted, fresh, r0 } for every enrolled game
    enrolled: new Set(),  // every id ever enrolled: a market is enrolled once
    events: [],       // per-game state changes waiting to be written (two-sided, quoted, stopped, kickoff moved)
    stats: { reads: 0, readFails: 0, unread: 0, orders: 0, crossings: 0, touches: 0, late: 0, tradeCalls: 0, tradeFails: 0, tradesRead: 0, voidGames: 0,
      lastReadAt: null, lastTradesOkAt: null, lastTradesError: null, restarts: 0, downMs: 0, byDay: {} },
    firstEnrolledAt: null,
    final: null,
  }
}
const day = (ms) => new Date(ms).toISOString().slice(0, 10)
function bumpDay(mk, ms, k, by = 1) { const d = day(ms); mk.stats.byDay[d] ??= { orders: 0, fills: 0, settled: 0 }; mk.stats.byDay[d][k] = (mk.stats.byDay[d][k] ?? 0) + by }
function gameEvent(mk, m, change) { Object.assign(m, change); mk.events.push({ id: m.id, ...change }) }

/**
 * Ends an order at `cutoff`. If its game was not read for longer than lateMs before then
 * (an outage), it ends instead one minute after the last read that saw it, as "late".
 */
function endOrder(mk, o, cutoff, onClosed) {
  const seen = o.seen ?? o.from
  if (cutoff - seen > MAKER.lateMs) { o.late = true; mk.stats.late++; o.to = Math.max(o.from, seen + MAKER.readMs) }
  else o.to = Math.max(o.from, cutoff)
  delete mk.open[`${o.id}:${o.side}`]
  if (mk.replayed[o.id]) { mk.stats.lostOrders = (mk.stats.lostOrders ?? 0) + 1; return }   // its game was already replayed
  ;(mk.closed[o.id] ??= []).push(o)
  onClosed?.(o)
}
function stopGame(mk, m, at, why, onClosed) {
  if (m.stopped) return
  gameEvent(mk, m, { stopped: { at, why } })
  for (const side of [0, 1]) { const o = mk.open[`${m.id}:${side}`]; if (o) endOrder(mk, o, at, onClosed) }
}
function pushMark(m, tau, mid) {
  m.marks ??= []
  m.marks.push([tau, mid])
  if (m.marks.length > 90) m.marks.splice(0, m.marks.length - 90)
}
/** The last two-sided midpoint read strictly before `t`, or null. */
export function markBefore(m, t) {
  for (let i = (m.marks ?? []).length - 1; i >= 0; i--) if (m.marks[i][0] < t) return { mid: m.marks[i][1], at: m.marks[i][0] }
  return null
}

/**
 * One read of one game at time tau: ends orders after an outage, records evidence against
 * resting orders, then re-prices them. An order whose price is unchanged keeps resting; a
 * new price ends it and starts another. A crossing fills the order under both rules, so that
 * outcome is never quoted again. A book emptied on both sides after being two-sided has been
 * cleared (the game started or was pulled): its orders are touched and quoting stops.
 */
export function applyRead(mk, id, bm, am, tau, onClosed) {
  const m = mk.markets[id]
  if (!m || m.stopped || tau >= Date.parse(m.kickoff)) return
  m.lastRead = tau
  for (const side of [0, 1]) { const o = mk.open[`${id}:${side}`]; if (o && tau - (o.seen ?? o.from) > MAKER.lateMs) endOrder(mk, o, tau, onClosed) }
  if (bm === null && am === null && m.twoSided) {
    for (const side of [0, 1]) { const o = mk.open[`${id}:${side}`]; if (o && !o.touch) { o.touch = { at: tau, why: 'bid gone' }; mk.stats.touches++ } }
    stopGame(mk, m, tau, 'book cleared', onClosed)
    return
  }
  m.book = [bm, am]
  if (bm !== null && am !== null) { pushMark(m, tau, (bm + am) / 2000); if (!m.twoSided) gameEvent(mk, m, { twoSided: true }) }
  for (const side of [0, 1]) {
    const key = `${id}:${side}`, o = mk.open[key]
    if (!o) continue
    o.seen = tau
    const ev = evidenceAt(side, o.pm, bm, am, m.feeRate)
    if (ev.touch && !o.touch) { o.touch = { at: tau, why: ev.touch }; mk.stats.touches++ }
    if (ev.cross) {
      o.cross = { at: tau, size: null }
      mk.retired[key] = true; mk.stats.crossings++
      mk.needSize.push({ id, side, pm: o.pm, at: tau })
      endOrder(mk, o, tau, onClosed)
    }
  }
  const q = quote(bm, am)
  for (const side of [0, 1]) {
    const key = `${id}:${side}`
    if (mk.retired[key]) continue
    const o = mk.open[key], pm = q.pm ? q.pm[side] : null
    if (o && o.pm === pm) continue
    if (o) endOrder(mk, o, tau, onClosed)
    if (pm === null) continue
    const own = side === 0 ? [bm, am] : [1000 - am, 1000 - bm]
    mk.open[key] = { id, side, pm, price: pm / 1000, shares: sharesFor(pm, m.minShares), from: tau, seen: tau, to: null, bid: own[0] / 1000, ask: own[1] / 1000, spread: q.spread, cross: null, touch: null }
    mk.stats.orders++; bumpDay(mk, tau, 'orders')
    if (!m.quoted) gameEvent(mk, m, { quoted: true })
  }
}

/** Orders still resting at kickoff (or at a stop) end there; Polymarket clears sports books at the start. */
export function closeAtKickoff(mk, nowMs, onClosed) {
  for (const o of Object.values(mk.open)) {
    const m = mk.markets[o.id]
    if (!m) { delete mk.open[`${o.id}:${o.side}`]; continue }
    const k = Date.parse(m.kickoff)
    if (k <= nowMs) endOrder(mk, o, k, onClosed)
    else if (m.stopped) endOrder(mk, o, m.stopped.at, onClosed)
  }
}

/** At the stop every resting order ends: Test C stops quoting. */
export function closeAll(mk, nowMs, onClosed) {
  for (const o of Object.values(mk.open)) endOrder(mk, o, nowMs, onClosed)
}

/**
 * Brings a game's kickoff forward to k, retroactively: orders and evidence at or after k
 * are cut or dropped (a crossing after k no longer retires its outcome), and the reference
 * midpoint becomes the last read before k. A later kickoff never extends quoting.
 */
export function moveKickoff(mk, m, k, onClosed) {
  if (!(k < Date.parse(m.kickoff))) return
  gameEvent(mk, m, { kickoff: isoOf(k), kickoffMoved: m.kickoffMoved ?? m.kickoff })
  for (const side of [0, 1]) { const o = mk.open[`${m.id}:${side}`]; if (o) { if (o.from >= k) delete mk.open[`${m.id}:${side}`]; else endOrder(mk, o, k, onClosed) } }
  trimAfter(mk, m, k)
}

/**
 * Cuts a game's ended orders and evidence back to before k: orders that started at or
 * after k go, lives end at k, crossings and touches at or after k are dropped (so a crossing
 * after k no longer retires its outcome), and so are midpoints read at or after k. Runs
 * when a kickoff moves earlier, and again on load, since the order log keeps the original lines.
 */
export function trimAfter(mk, m, k) {
  if (mk.closed[m.id]) {
    mk.closed[m.id] = mk.closed[m.id].filter((o) => o.from < k)
    for (const o of mk.closed[m.id]) {
      if (o.to === null || o.to > k) o.to = k
      if (o.cross && o.cross.at >= k) o.cross = null
      if (o.touch && o.touch.at >= k) o.touch = null
    }
  }
  for (const side of [0, 1]) if (!(mk.closed[m.id] ?? []).some((o) => o.side === side && o.cross)) delete mk.retired[`${m.id}:${side}`]
  mk.needSize = mk.needSize.filter((x) => x.id !== m.id || x.at < k)
  m.marks = (m.marks ?? []).filter(([t]) => t < k)
}

/** Applies a fresh Gamma record: an earlier gameStartTime moves kickoff; a closed market, or one not accepting orders, stops quoting. */
export function refreshGame(mk, m, g, nowMs, onClosed) {
  if (!g) return
  const k = kickoffOf(g)
  if (k !== null && k < Date.parse(m.kickoff)) moveKickoff(mk, m, k, onClosed)
  if (!m.stopped && (g.closed || g.acceptingOrders === false)) stopGame(mk, m, nowMs, g.closed ? 'closed' : 'not accepting orders', onClosed)
}

// ---------------------------------------------------------------- replay
/** One trade from the data API (v2 snake_case in a `data` envelope, or the older camelCase). Seconds → ms. */
export function normTrade(t) {
  const ts = num(t.timestamp)
  const token = String(t.token_id ?? t.asset ?? t.tokenId ?? t.assetId ?? '')
  const price = num(t.price), size = num(t.size)
  if (!token || !(price > 0) || !(size > 0) || !(ts > 0)) return null
  return { token, pmil: mil(price), size, side: t.side === 'BUY' || t.side === 'SELL' ? t.side : null, cid: String(t.condition_id ?? t.conditionId ?? '').toLowerCase(), ms: ts < 1e12 ? ts * 1000 : ts, tx: t.transaction_hash ?? t.transactionHash ?? null }
}
export const tradesOf = (body) => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []).map(normTrade).filter(Boolean)

/**
 * What a taker trade says about a buy order of outcome `side` at pm:
 *   'seller' — a seller reached our price: a sale of our outcome at ≤ pm, or a purchase of
 *              the other outcome at ≥ 1 − pm (the same match seen from the other book);
 *   'cross'  — a sell was resting at ≤ pm: a purchase of our outcome at ≤ pm, or a sale of
 *              the other outcome at ≥ 1 − pm.
 * A record without a side is read as a seller.
 */
export function classify(t, tokens, side, pm) {
  if (t.token === tokens[side] && t.pmil <= pm) return t.side === 'BUY' ? 'cross' : 'seller'
  if (t.token === tokens[1 - side] && t.pmil >= 1000 - pm) return t.side === 'SELL' ? 'cross' : 'seller'
  return null
}

/**
 * Replays one game's orders against its trades and returns its fills under each rule.
 * No trade at or after kickoff counts. Per outcome, orders are taken in time order and the
 * first with any evidence fills; later orders of that outcome never existed. A trade's feed
 * time may trail its match by up to L, so a seller print counts for an order whose life
 * overlaps [time − L, time], and goes to the dearest such order it qualifies for. A crossing
 * print counts only when the whole of [time − L, time] lies inside the order's life. Under the
 * touch rule a pick-off anywhere in the order's life fills the whole order.
 */
export function replayGame(m, orders, trades, L = MAKER.lagMs, cal = null) {
  const out = { trade: [], touch: [] }
  const kick = Date.parse(m.kickoff)
  const pre = trades.filter((t) => t.ms < kick)
  // The kickoff price: the last two-sided read before kickoff, or (after a restart) the one kept on disk.
  const mark = markBefore(m, kick) ?? (cal && cal.mid !== null && cal.mid !== undefined && cal.at && cal.kickoff === m.kickoff ? { mid: cal.mid, at: Date.parse(cal.at) } : null)
  for (const side of [0, 1]) {
    // Nothing at or after kickoff counts, wherever the orders came from.
    const list = orders.filter((o) => o.side === side && o.from < kick)
      .map((o) => ({ ...o, to: Math.min(o.to, kick), cross: o.cross && o.cross.at < kick ? o.cross : null, touch: o.touch && o.touch.at < kick ? o.touch : null }))
      .filter((o) => o.to > o.from).sort((a, b) => a.from - b.from)
    // Each seller print belongs to the dearest order it overlaps and qualifies for.
    const owner = pre.map((t) => {
      let best = -1
      for (let i = 0; i < list.length; i++) {
        const o = list[i]
        if (t.ms - L < o.to && t.ms >= o.from && classify(t, m.tokens, side, o.pm) === 'seller' && (best < 0 || o.pm > list[best].pm)) best = i
      }
      return best
    })
    for (const world of WORLDS) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i]
        let shares = 0, at = Infinity, prints = 0
        const sources = new Set()
        pre.forEach((t, j) => {
          if (owner[j] === i) { shares += t.size; prints++; sources.add('trade'); at = Math.min(at, Math.max(o.from, t.ms - L)); return }
          if (classify(t, m.tokens, side, o.pm) === 'cross' && t.ms - L >= o.from && t.ms < o.to) { shares += t.size; prints++; sources.add('crossprint'); at = Math.min(at, t.ms) }
        })
        if (o.cross && o.cross.at <= o.to) { shares += o.cross.size ?? o.shares; sources.add('cross'); at = Math.min(at, o.cross.at) }
        const touch = world === 'touch' && o.touch && o.touch.at >= o.from && o.touch.at <= o.to ? o.touch : null
        if (!(shares > 0) && !touch) continue
        if (touch) { sources.add('touch'); at = Math.min(at, touch.at) }
        const got = touch ? o.shares : Math.min(o.shares, shares)
        out[world].push({
          world, id: `${m.id}:${side}`, marketId: m.id, side, outcome: m.outcomes[side], question: m.question, token: m.tokens[side],
          price: o.pm / 1000, shares: +got.toFixed(4), cost: +(got * o.pm / 1000).toFixed(6), source: [...sources].sort().join('+'), touchWhy: touch?.why ?? null, prints,
          orderShares: o.shares, evidence: +shares.toFixed(4), feeRate: m.feeRate ?? null, late: Boolean(o.late),
          orderFrom: isoOf(o.from), orderTo: isoOf(o.to), filledAt: isoOf(at), bid: o.bid, ask: o.ask, spread: o.spread,
          kickoff: m.kickoff, endDate: m.endDate, game: m.game, event: m.event, sport: m.sport ?? null, league: m.league ?? null, type: m.type ?? null,
          mark: mark ? (side === 0 ? mark.mid : +(1 - mark.mid).toFixed(4)) : null, markAt: mark ? isoOf(mark.at) : null, rebateRate: m.rebateRate ?? null,
          fill: { shares: +got.toFixed(4), spent: +(got * o.pm / 1000).toFixed(6), avgPrice: o.pm / 1000, filled: true }, fee: 0,
        })
        break
      }
    }
  }
  return out
}

/** Settle a fill from Gamma's market object; null while unresolved. */
export function settleFill(f, m) {
  if (!m?.closed) return null
  let op
  try { op = JSON.parse(m.outcomePrices ?? '[]').map(Number) } catch { return null }
  if (op.length !== 2 || op.some((x) => !Number.isFinite(x)) || op[0] + op[1] < 0.99) return null
  const r = op[f.side]
  const payout = f.shares * r, cost = f.shares * f.price
  return { yesPrice: r, payout, cost, pnl: payout - cost, settledAt: new Date().toISOString() }
}

// ---------------------------------------------------------------- results
const isStale = (f, nowMs) => !f.settle && nowMs - Date.parse(f.kickoff) > MAKER.unsettledAfterDays * DAY_MS
export const fillsOf = (mk, world) => Object.values(mk.fills).filter((f) => f.world === world)
export const sideOf = (f) => (f.price < 0.5 ? 'cheaper' : 'dearer')
/** A fill is scored on its kickoff price only if that price was read after the fill had settled in and close to kickoff. */
export const freshMark = (f) => f.mark !== null && f.mark !== undefined && f.markAt
  && Date.parse(f.markAt) >= Date.parse(f.filledAt) + MAKER.freshAfterFillMs && Date.parse(f.markAt) >= Date.parse(f.kickoff) - MAKER.freshBeforeKickoffMs

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]

/** Σvalue / Σcost with a bootstrap over matches; lo/hi at the given two-sided level. */
export function ratioBoot(rows, { iters = 2000, level = 0.95 } = {}) {
  if (!rows.length) return null
  const by = new Map()
  for (const r of rows) { if (!by.has(r.cluster)) by.set(r.cluster, [0, 0]); const g = by.get(r.cluster); g[0] += r.value; g[1] += r.cost }
  const groups = [...by.values()], rnd = mulberry32(777), out = []
  for (let k = 0; k < iters; k++) { let v = 0, c = 0; for (let j = 0; j < groups.length; j++) { const g = groups[Math.floor(rnd() * groups.length)]; v += g[0]; c += g[1] } out.push(c > 0 ? v / c : 0) }
  out.sort((x, y) => x - y)
  const v = rows.reduce((a, r) => a + r.value, 0), c = rows.reduce((a, r) => a + r.cost, 0), tail = (1 - level) / 2
  return { n: rows.length, matches: groups.length, value: v, cost: c, perDollar: c > 0 ? v / c : 0, lo: quant(out, tail), hi: quant(out, 1 - tail) }
}

/** The games the calibration correction is estimated from: quoted, resolved, with a fresh two-sided read before kickoff. */
export const calGames = (cal) => cal.filter((x) => x.quoted && x.fresh && x.mid !== null && x.mid !== undefined && x.r0 !== null && x.r0 !== undefined)

/** Per-band totals of (result − kickoff midpoint) over both outcomes of each game. */
function calTotals(list) {
  const n = new Float64Array(BANDS), sum = new Float64Array(BANDS)
  for (const x of list) for (const [mid, r] of [[x.mid, x.r0], [1 - x.mid, 1 - x.r0]]) { const b = bandOf(mid); n[b]++; sum[b] += r - mid }
  return { n, sum }
}
const cFrom = (n, sum) => Array.from(n, (k, b) => (k >= MAKER.calMin ? sum[b] / k : 0))

/** The calibration table: c(mid) = average (result − midpoint) in mid's 5¢ band, 0 below 30 outcomes. */
export function calibrationTable(cal) {
  const { n, sum } = calTotals(calGames(cal))
  const c = cFrom(n, sum)
  return { table: c.map((v, b) => ({ lo: (b * MAKER.calBandMil) / 1000, n: n[b], c: v })), c: (mid) => c[bandOf(mid)] }
}

/** The calibration games grouped by match, as flat per-match band totals (outcomes, Σ(result − mid)). */
export function calGroupsOf(calList) {
  const cg = new Map()
  for (const x of calGames(calList)) { const k = x.game ?? x.id; if (!cg.has(k)) cg.set(k, []); cg.get(k).push(x) }
  const lists = [...cg.values()], G = lists.length, n = new Float64Array(G * BANDS), sum = new Float64Array(G * BANDS)
  lists.forEach((list, g) => { const t = calTotals(list); n.set(t.n, g * BANDS); sum.set(t.sum, g * BANDS) })
  return { G, n, sum }
}

/**
 * The primary statistic and its interval. Markout-scored fills (fresh kickoff price)
 * contribute shares × (m − p + c(m)); the others, once settled, shares × (result − p).
 * Each bootstrap replicate resamples matches of the fills AND of the calibration games, and
 * re-estimates the c table from the latter, so its error is in the interval.
 * `calGroups` (from calGroupsOf) can be passed in to save regrouping; the draws are the same.
 */
export function markoutBoot(fills, calList, { iters = 1000, level = 0.95, calGroups = null } = {}) {
  const groups = new Map()
  let byMark = 0, byResult = 0
  for (const f of fills) {
    const key = f.game ?? f.marketId
    if (!groups.has(key)) groups.set(key, { v0: 0, cost: 0, S: new Float64Array(BANDS) })
    const g = groups.get(key)
    if (freshMark(f)) { g.v0 += f.shares * (f.mark - f.price); g.S[bandOf(f.mark)] += f.shares; g.cost += f.shares * f.price; byMark++ }
    else if (f.settle) { g.v0 += f.settle.pnl; g.cost += f.settle.cost; byResult++ }
  }
  const fg = [...groups.values()].filter((g) => g.cost > 0)
  if (!fg.length) return null
  const { G, n: cn, sum: cs } = calGroups ?? calGroupsOf(calList)
  const F = fg.length, fv = Float64Array.from(fg, (g) => g.v0), fc = Float64Array.from(fg, (g) => g.cost), fS = new Float64Array(F * BANDS)
  fg.forEach((g, i) => fS.set(g.S, i * BANDS))
  const n = new Float64Array(BANDS), sum = new Float64Array(BANDS), S = new Float64Array(BANDS), pick = new Int32Array(F)
  // One replicate: fills by `pick`, calibration matches by calAt(j). Draw order and addition order are those of the registered code.
  const stat = (calAt) => {
    n.fill(0); sum.fill(0); S.fill(0)
    for (let j = 0; j < G; j++) { const o = calAt(j) * BANDS; for (let b = 0; b < BANDS; b++) { n[b] += cn[o + b]; sum[b] += cs[o + b] } }
    const c = cFrom(n, sum)
    let v = 0, cost = 0
    for (let i = 0; i < F; i++) { const g = pick[i], o = g * BANDS; v += fv[g]; cost += fc[g]; for (let b = 0; b < BANDS; b++) S[b] += fS[o + b] }
    for (let b = 0; b < BANDS; b++) v += c[b] * S[b]
    return { v, cost }
  }
  for (let i = 0; i < F; i++) pick[i] = i
  const full = stat((j) => j)
  const rnd = mulberry32(4242), out = []
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < F; i++) pick[i] = Math.floor(rnd() * F)
    const s = stat(() => Math.floor(rnd() * G)); out.push(s.cost > 0 ? s.v / s.cost : 0)
  }
  out.sort((a, b) => a - b)
  const tail = (1 - level) / 2
  return { n: byMark + byResult, byMark, byResult, matches: F, value: full.v, cost: full.cost, perDollar: full.v / full.cost, lo: quant(out, tail), hi: quant(out, 1 - tail) }
}

/** Per side and rule: the corrected markout (deciding), real outcome, the guard and the sensitivities. */
export function sideResult(fills, calList, cal, { iters = 1000, level = 0.95, calGroups = calGroupsOf(calList) } = {}) {
  const markout = markoutBoot(fills, calList, { iters, level, calGroups })
  const settled = fills.filter((f) => f.settle)
  const outcome = ratioBoot(settled.map((f) => ({ cluster: f.game ?? f.marketId, value: f.settle.pnl, cost: f.settle.cost })), { iters, level: 0.95 })
  // Guard: markout-scored fills must not reliably lose against their own kickoff price.
  const guard = ratioBoot(settled.filter(freshMark).map((f) => ({ cluster: f.game ?? f.marketId, value: f.shares * (f.settle.yesPrice - f.mark - cal.c(f.mark)), cost: f.shares * f.price })), { iters: Math.min(iters, 1000), level: 0.95 })
  // Live, a visible order can be jumped: what if every fill cost a tick more, or we were second in line?
  const tickDearer = markoutBoot(fills.map((f) => ({ ...f, price: f.price + 0.01, settle: f.settle ? { ...f.settle, pnl: f.settle.pnl - 0.01 * f.shares, cost: f.settle.cost + 0.01 * f.shares } : f.settle })), calList, { iters: 200, level, calGroups })
  const secondInLine = markoutBoot(fills.map((f) => {
    if (f.source.includes('touch')) return f
    const sh = Math.min(f.orderShares ?? f.shares, Math.max(0, (f.evidence ?? f.shares) - (f.orderShares ?? f.shares)))
    const k = f.shares > 0 ? sh / f.shares : 0
    return { ...f, shares: sh, settle: f.settle ? { ...f.settle, pnl: f.settle.pnl * k, cost: f.settle.cost * k } : f.settle }
  }).filter((f) => f.shares > 0), calList, { iters: 200, level, calGroups })
  const wins = settled.filter((f) => f.settle.yesPrice === 1).length
  return {
    fills: fills.length, settled: settled.length, wins, losses: settled.filter((f) => f.settle.yesPrice === 0).length,
    matches: new Set(settled.map((f) => f.game ?? f.marketId)).size, markout, outcome, guard, tickDearer, secondInLine,
    hitRate: settled.length ? wins / settled.length : null, avgPrice: settled.length ? settled.reduce((a, f) => a + f.price, 0) / settled.length : null,
  }
}

/**
 * The verdict at the stop, per side (98.75% intervals: two sides). A side is YES only if,
 * under BOTH fill rules, its corrected markout's lower end is above zero; its real outcome
 * under the trade rule is not negative; its fills do not reliably lose against their own
 * kickoff price (the guard); and the touch rule is not kinder than the trade rule (if it is,
 * the touch rule is mis-specified and the result is INCONCLUSIVE). Data gates come first.
 */
export function verdictOf(s) {
  if (s.gate) return `INCONCLUSIVE — ${s.gate}`
  const bad = SIDES.filter((side) => { const t = s.sides[side]?.trade?.markout, h = s.sides[side]?.touch?.markout; return t && h && h.perDollar > t.perDollar + 1e-9 })
  if (bad.length) return `INCONCLUSIVE — the cautious rule scored the ${bad.join(' and ')} side better than the main rule, so it is mis-specified`
  const passed = SIDES.filter((side) => {
    const t = s.sides[side]?.trade, h = s.sides[side]?.touch
    return t?.markout && h?.markout && t.markout.lo > 0 && h.markout.lo > 0 && t.outcome && t.outcome.perDollar >= 0 && !(t.guard && t.guard.hi < 0)
  })
  if (passed.length) return `YES — ${passed.join(' and ')} side${passed.length > 1 ? 's' : ''}: resting orders made money under both fill rules`
  const tradeOnly = SIDES.filter((side) => s.sides[side]?.trade?.markout?.lo > 0)
  if (tradeOnly.length) return `NO — the ${tradeOnly.join(' and ')} side made money only if stale orders are never picked off`
  return 'NO — resting orders did not reliably make money'
}

/**
 * Everything the verdict needs. `done` and the stop's reason are decided here; the verdict
 * is filled in only when the test is done (YES can only be given at the stop).
 */
export function makerSummary(mk, nowMs, { iters = 1000 } = {}) {
  const calList = Object.values(mk.cal ?? {})
  const cal = calibrationTable(calList), calGroups = calGroupsOf(calList)
  const live = (w) => fillsOf(mk, w).filter((f) => !isStale(f, nowMs))
  const sides = {}
  for (const side of SIDES) {
    sides[side] = {}
    for (const w of WORLDS) sides[side][w] = sideResult(live(w).filter((f) => sideOf(f) === side), calList, cal, { iters, level: 0.9875, calGroups })
  }
  const pooled = Object.fromEntries(WORLDS.map((w) => [w, sideResult(live(w), calList, cal, { iters: Math.min(iters, 1000), level: 0.95, calGroups })]))
  const first = mk.firstEnrolledAt ? Date.parse(mk.firstEnrolledAt) : null
  const days = first !== null ? (nowMs - first) / DAY_MS : 0
  const matches = pooled.trade.matches
  const games = Object.values(mk.replayed ?? {}).filter((r) => r.status !== 'no orders')
  const voidShare = games.length ? games.filter((r) => r.status === 'void').length / games.length : 0
  const downShare = first !== null && nowMs > first ? (mk.stats.downMs ?? 0) / (nowMs - first) : 0
  const gate = pooled.trade.settled < MAKER.minSettledFills ? `only ${pooled.trade.settled} settled fills (needs ${MAKER.minSettledFills})`
    : voidShare > MAKER.maxVoidShare ? `${Math.round(voidShare * 100)}% of games had unreadable trades`
    : downShare > MAKER.maxDowntimeShare ? `the tracker was down ${Math.round(downShare * 100)}% of the time` : null
  const futile = days >= MAKER.futilityFromDays && matches >= MAKER.futilityMatches && SIDES.every((side) => { const m = sides[side].trade.markout; return !m || m.hi < 0 })
  const reason = days >= MAKER.stopDays ? '28 days' : days >= MAKER.minDays && matches >= MAKER.stopMatches ? 'registered stop' : futile ? 'futility' : null
  const out = { sides, pooled, matches, days: +days.toFixed(1), done: Boolean(reason), reason, futile, gate, voidShare, downShare,
    calibration: cal.table, pairs: Object.keys(mk.markets).filter((id) => mk.fills[`trade|${id}:0`] && mk.fills[`trade|${id}:1`]).length,
    firstEnrolledAt: mk.firstEnrolledAt, stats: mk.stats, ruleVersion: RULE_VERSION }
  out.verdict = !reason ? null : gate ? `INCONCLUSIVE — ${gate}` : reason === 'futility' ? 'NO — stopped for futility' : verdictOf(out)
  return out
}

/** The stop, made permanent, from exactly the summary that decided it. */
export function freezeMaker(mk, nowMs, summary = null) {
  if (mk.final) return mk.final
  const { stats: _s, ...s } = summary ?? makerSummary(mk, nowMs, { iters: MAKER.stopIters })
  if (!s.done) return null
  mk.final = { ...s, frozenAt: isoOf(nowMs), commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null, settledIds: Object.values(mk.fills).filter((f) => f.settle).map((f) => `${f.world}|${f.id}`) }
  mk.statsVersion = (mk.statsVersion ?? 0) + 1
  return mk.final
}

// ---------------------------------------------------------------- storage
/**
 * Appends JSON lines. A torn last line (a crash or a full disk mid-append, before or within
 * this run) is closed with a newline first, so the new record starts on its own line instead
 * of joining the fragment and being lost with it.
 */
export function appendLines(file, objs) {
  if (!objs.length) return
  let lead = ''
  try {
    const { size } = fs.statSync(file)
    if (size > 0) { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(1); try { fs.readSync(fd, b, 0, 1, size - 1) } finally { fs.closeSync(fd) } if (b[0] !== 0x0a) lead = '\n' }
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  fs.appendFileSync(file, lead + objs.map((o) => JSON.stringify(o)).join('\n') + '\n')
}

/** Calls fn on each line of a file, reading it in 1 MiB pieces (a whole-file string can exceed Node's limit). */
export function eachLine(file, fn) {
  if (!fs.existsSync(file)) return 0
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20), dec = new StringDecoder('utf8')
  let rest = '', bad = 0, n
  const line = (l) => { if (!l.trim()) return; try { fn(JSON.parse(l)) } catch { bad++ } }
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const parts = (rest + dec.write(buf.subarray(0, n))).split('\n')
      rest = parts.pop()
      parts.forEach(line)
    }
    line(rest + dec.end())
  } finally { fs.closeSync(fd) }
  return bad
}

/**
 * Append-only, beside Tests A/B's files:
 *   maker-markets.jsonl   one line per enrolled game
 *   maker-games.jsonl     per-game state changes (two-sided, quoted, stopped, kickoff moved)
 *   maker-orders.jsonl    one line per order when it ends (its life and what the book did)
 *   maker-open.json       orders resting now, rewritten each round, so they rest through a restart
 *   maker-trades.jsonl    each replayed game's trades (compact), for audit
 *   maker-replayed.jsonl  one line per game replayed (or void, or audited)
 *   maker-fills.jsonl     one line per fill, per rule
 *   maker-settles.jsonl   one line per settled fill
 *   maker-cal.jsonl       each game's midpoint at kickoff, then its result (the calibration correction)
 *   maker-after.jsonl     prices 1, 15 and 60 minutes after each fill
 *   maker-meta.json       counters, the rule version and the frozen result
 * Data of an earlier rule version with no fill yet is moved to maker-archive/ on load.
 */
export function openMakerStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const f = (n) => path.join(dir, n)
  const append = (name, objs) => appendLines(f(name), objs)
  const writeAtomic = (name, obj) => { fs.writeFileSync(f(name + '.tmp'), JSON.stringify(obj)); fs.renameSync(f(name + '.tmp'), f(name)) }
  return {
    load(nowMs = Date.now()) {
      // A new rule version starts clean, unless the old one already has fills (then it is kept, and flagged).
      if (fs.existsSync(f('maker-meta.json'))) {
        const meta = JSON.parse(fs.readFileSync(f('maker-meta.json'), 'utf8'))
        const hasFills = fs.existsSync(f('maker-fills.jsonl')) && fs.statSync(f('maker-fills.jsonl')).size > 0
        if ((meta.ruleVersion ?? 'C1') !== RULE_VERSION && !hasFills) {
          const to = path.join(dir, 'maker-archive', `${meta.ruleVersion ?? 'C1'}-${new Date(nowMs).toISOString().replace(/[:.]/g, '-')}`)
          fs.mkdirSync(to, { recursive: true })
          for (const name of fs.readdirSync(dir)) if (name.startsWith('maker-') && name !== 'maker-archive') fs.renameSync(f(name), path.join(to, name))
          console.log(`maker: rule ${meta.ruleVersion ?? 'C1'} data (no fills) archived to ${to}; ${RULE_VERSION} starts clean`)
        }
      }
      const mk = newMakerState()
      let bad = eachLine(f('maker-replayed.jsonl'), (x) => { mk.replayed[x.id] = { ...(mk.replayed[x.id] ?? {}), ...x } })
      bad += eachLine(f('maker-markets.jsonl'), (m) => { mk.markets[m.id] = m; mk.enrolled.add(m.id); if (!mk.firstEnrolledAt || m.enrolledAt < mk.firstEnrolledAt) mk.firstEnrolledAt = m.enrolledAt })
      bad += eachLine(f('maker-games.jsonl'), ({ id, ...change }) => { if (mk.markets[id]) Object.assign(mk.markets[id], change) })
      bad += eachLine(f('maker-cal.jsonl'), (x) => { mk.cal[x.id] = { ...(mk.cal[x.id] ?? {}), ...x } })
      const pendingAudit = (id) => mk.replayed[id]?.auditAt && !mk.replayed[id]?.audited
      bad += eachLine(f('maker-orders.jsonl'), (o) => { if (!mk.replayed[o.id] || pendingAudit(o.id)) (mk.closed[o.id] ??= []).push(o); if (o.cross) mk.retired[`${o.id}:${o.side}`] = true })
      bad += eachLine(f('maker-fills.jsonl'), (x) => { mk.fills[`${x.world}|${x.id}`] = x })
      bad += eachLine(f('maker-settles.jsonl'), (x) => { if (mk.fills[x.key]) mk.fills[x.key].settle = x.settle })
      bad += eachLine(f('maker-after.jsonl'), (x) => { if (mk.fills[x.key]) mk.fills[x.key].after = x.after })
      if (fs.existsSync(f('maker-open.json'))) {
        const o = JSON.parse(fs.readFileSync(f('maker-open.json'), 'utf8'))
        // An order already in the order log (written by a refresh before the next round rewrote this file) is not reloaded twice.
        for (const [k, x] of Object.entries(o.open ?? {})) if (mk.markets[x.id] && !mk.replayed[x.id] && !(mk.closed[x.id] ?? []).some((c) => c.side === x.side && c.from === x.from)) mk.open[k] = x
        for (const x of o.needSize ?? []) mk.needSize.push(x)
        for (const [id, ms] of Object.entries(o.marks ?? {})) if (mk.markets[id] && !mk.cal[id]) mk.markets[id].marks = ms
      }
      // Kickoffs moved earlier: the order log keeps the original lines, so the cut is made again.
      for (const m of Object.values(mk.markets)) {
        if (!m.kickoffMoved) continue
        const k = Date.parse(m.kickoff)
        for (const side of [0, 1]) { const o = mk.open[`${m.id}:${side}`]; if (o && o.from >= k) delete mk.open[`${m.id}:${side}`]; else if (o && o.touch && o.touch.at >= k) o.touch = null }
        trimAfter(mk, m, k)
      }
      if (fs.existsSync(f('maker-meta.json'))) {
        const meta = JSON.parse(fs.readFileSync(f('maker-meta.json'), 'utf8'))
        Object.assign(mk.stats, meta.stats ?? {}); mk.final = meta.final ?? null
        mk.stats.restarts = (mk.stats.restarts ?? 0) + 1   // the downtime is booked by the first round that reads
      }
      // Replayed games with no fill and no audit pending are only counts now.
      for (const id of Object.keys(mk.markets)) if (mk.replayed[id] && !pendingAudit(id) && !WORLDS.some((w) => mk.fills[`${w}|${id}:0`] || mk.fills[`${w}|${id}:1`])) delete mk.markets[id]
      if (bad) console.error(`maker storage: skipped ${bad} unreadable line(s)`)
      return mk
    },
    addMarkets: (list) => append('maker-markets.jsonl', list),
    addGameEvents: (list) => append('maker-games.jsonl', list),
    addCal: (list) => append('maker-cal.jsonl', list),
    addAfter: (x) => append('maker-after.jsonl', [x]),
    addOrders: (list) => append('maker-orders.jsonl', list),
    addTrades: (id, trades) => append('maker-trades.jsonl', [{ id, trades: trades.map((t) => [t.ms, t.token, t.side, t.pmil, t.size, t.tx]) }]),
    addReplayed: (list) => append('maker-replayed.jsonl', list),
    addFills: (list) => append('maker-fills.jsonl', list.map(({ settle: _s, after: _a, ...r }) => r)),
    addSettles: (list) => append('maker-settles.jsonl', list.map((r) => ({ key: `${r.world}|${r.id}`, settle: r.settle }))),
    // Also the recent midpoints of games within two hours of kickoff with no kickoff price recorded yet,
    // so a restart across kickoff still has the last read before it.
    saveOpen(mk, nowMs = Date.now()) {
      const marks = {}
      for (const m of Object.values(mk.markets)) if (m.marks?.length && !mk.cal[m.id] && !mk.replayed[m.id] && Date.parse(m.kickoff) - nowMs <= 2 * 3600_000) marks[m.id] = m.marks.slice(-15)
      writeAtomic('maker-open.json', { open: mk.open, needSize: mk.needSize, marks })
    },
    saveMeta(mk) { writeAtomic('maker-meta.json', { ruleVersion: RULE_VERSION, stats: mk.stats, final: mk.final }) },
  }
}

// ---------------------------------------------------------------- I/O
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Markets kicking off between `minH` and `maxH` hours from now, through Gamma's keyset listing. */
export async function listWindow(getJson, nowMs, minH, maxH) {
  const out = []
  let cursor = null, lastFirst = null
  do {
    const q = new URLSearchParams({ active: 'true', closed: 'false', limit: '100', end_date_min: iso(nowMs + (minH - 1) * 3600_000), end_date_max: iso(nowMs + (maxH + 1) * 3600_000) })
    if (cursor) q.set('after_cursor', cursor)
    const page = await getJson('https://gamma-api.polymarket.com/markets/keyset?' + q)
    const first = page.markets?.[0]?.id
    if (first && first === lastFirst) throw new Error('keyset cursor did not advance')
    lastFirst = first
    out.push(...(page.markets ?? []))
    cursor = page.next_cursor
  } while (cursor)
  return out
}

/** Enrols every eligible game first seen 22–26h before kickoff; each market once, ever. */
export async function enroll(mk, io, nowMs, index) {
  const list = await listWindow(io.getJson, nowMs, MAKER.enrollMinH, MAKER.enrollMaxH)
  const added = []
  mk.skipped ??= {}       // per run: each skipped market counted once since the last start
  mk.seen ??= new Set()
  for (const m of list) {
    if (mk.enrolled.has(String(m.id))) continue
    const why = ineligible(m, nowMs)
    if (why) {
      if (why !== 'outside the window' && armOf(m) && !mk.seen.has(m.id)) { mk.seen.add(m.id); mk.skipped[why] = (mk.skipped[why] ?? 0) + 1 }
      continue
    }
    const r = enrollRecord(m, nowMs, tagsOf(m, index), matchKeyOf(m))
    if (r) added.push(r)
  }
  io.store.addMarkets(added)   // written first: a market in memory is always on disk
  mk.stats.enrolledBy ??= { sport: {}, type: {} }
  for (const r of added) {
    mk.markets[r.id] = r; mk.enrolled.add(r.id); if (!mk.firstEnrolledAt) mk.firstEnrolledAt = r.enrolledAt
    for (const k of ['sport', 'type']) { const v = r[k] ?? 'Untagged'; mk.stats.enrolledBy[k][v] = (mk.stats.enrolledBy[k][v] ?? 0) + 1 }
  }
  return { added: added.length, list }
}

/** A failure of the service rather than of one request (rate limit, server error, timeout, network): retrying smaller will not help. */
export function isSystemic(e) {
  const code = e?.code ?? e?.cause?.code
  return e?.status === 429 || e?.status >= 500 || Boolean(e?.timeout) || e?.name === 'TimeoutError' || e?.name === 'AbortError'
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
}

/**
 * Best bid and ask of outcome 0 for each game, 250 per request, 4 requests at a time, in
 * shuffled batches, within 45 seconds a round. A batch rejected on its own is retried in
 * halves down to single games; a service failure (rate limit, server error, timeout) is not
 * split, and a rate limit pauses reading for as long as the service asks (a minute by
 * default). A read whose round trip took over 10 s is not trusted for timing and is asked
 * again once. Games left unread keep their orders resting until the next read.
 * Returns id → { bm, am, tau }.
 */
export async function readPrices(mk, io, ids) {
  const out = new Map(), byToken = new Map()
  for (const id of ids) byToken.set(mk.markets[id].tokens[0], id)
  const tokens = [...byToken.keys()]
  for (let i = tokens.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tokens[i], tokens[j]] = [tokens[j], tokens[i]] }
  const clock = io.clock ?? Date.now
  const start = clock()
  let halt = false
  const read = async (chunk, retried = false) => {
    const sent = clock()
    try {
      const res = await io.postJson('https://clob.polymarket.com/prices', chunk.flatMap((t) => [{ token_id: t, side: 'BUY' }, { token_id: t, side: 'SELL' }]))
      if (clock() - sent > 10_000 && !retried) { mk.stats.slowReads = (mk.stats.slowReads ?? 0) + 1; return read(chunk, true) }
      const tau = Math.round((sent + clock()) / 2)   // the book as of the middle of the request
      for (const t of chunk) {
        if (res?.[t]) out.set(byToken.get(t), { ...readOf(res[t]), tau })
        else mk.stats.unread++
      }
      mk.stats.reads += chunk.length
    } catch (e) {
      mk.stats.readFails++
      if (isSystemic(e)) {
        mk.stats.unread += chunk.length
        if (e.status === 429) { halt = true; mk.backoffUntil = clock() + Math.min(e.retryAfterMs ?? 60_000, 10 * 60_000) }
        io.log?.('maker prices', e.message)
      } else if (chunk.length > 1) { const h = Math.ceil(chunk.length / 2); await read(chunk.slice(0, h)); await read(chunk.slice(h)) }
      else { mk.stats.unread++; io.log?.('maker prices', e.message) }
    }
  }
  const chunks = []
  for (let i = 0; i < tokens.length; i += 250) chunks.push(tokens.slice(i, i + 250))
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
    while (next < chunks.length && !halt && clock() - start < 45_000) await read(chunks[next++])
  }))
  for (; next < chunks.length; next++) mk.stats.unread += chunks[next].length
  return out
}

/** Sizes for crossings seen this round, from the full book (if it cannot be read, the order counts as fully filled). */
async function sizeCrossings(mk, io) {
  const todo = mk.needSize.splice(0)
  for (const x of todo) {
    const o = (mk.closed[x.id] ?? []).find((c) => c.side === x.side && c.cross && c.cross.at === x.at)
    if (!o) continue
    try { o.cross.size = crossSize(await io.getJson('https://clob.polymarket.com/book?token_id=' + mk.markets[x.id].tokens[0]), x.side, x.pm) || o.shares }
    catch { o.cross.size = o.shares }
  }
  return todo.length
}

/**
 * One live round (every minute): end orders at kickoff or a stop, record each game's
 * midpoint at kickoff, read every enrolled game before kickoff, record evidence, re-price.
 * Orders that end and per-game changes are written to disk at once.
 */
export async function liveRound(mk, io, nowMs) {
  if (mk.final) return { done: true }
  const ended = []
  closeAtKickoff(mk, nowMs, (o) => ended.push(o))
  const marks = []
  for (const [id, m] of Object.entries(mk.markets)) {
    if (mk.cal[id] || Date.parse(m.kickoff) > nowMs) continue
    const k = Date.parse(m.kickoff), mark = markBefore(m, k)
    mk.cal[id] = { id, game: m.game, mid: mark?.mid ?? null, at: mark ? isoOf(mark.at) : null, kickoff: m.kickoff, quoted: Boolean(m.quoted), fresh: Boolean(mark && mark.at >= k - MAKER.freshBeforeKickoffMs) }
    marks.push(mk.cal[id])
    m.marks = mark ? [[mark.at, mark.mid]] : []; delete m.book   // only the kickoff price is needed from here on
  }
  io.store.addCal(marks)
  const ids = Object.entries(mk.markets).filter(([id, m]) => !m.stopped && Date.parse(m.kickoff) > nowMs && !mk.replayed[id]).map(([id]) => id)
  const reads = (io.clock ?? Date.now)() < (mk.backoffUntil ?? 0) ? new Map() : await readPrices(mk, io, ids)
  // The stop can land while the reads are in flight (the background loop freezes and ends every order): place no more.
  if (!mk.final) for (const [id, r] of reads) applyRead(mk, id, r.bm, r.am, r.tau, (o) => ended.push(o))
  await sizeCrossings(mk, io)
  io.store.addOrders(ended)
  io.store.addGameEvents(mk.events.splice(0))
  io.store.saveOpen(mk, nowMs)
  // Downtime is the gap between rounds that read something (or had nothing to read), beyond the
  // normal minute: it covers restarts, outages and stalls alike.
  if (reads.size || !ids.length) {
    const last = mk.stats.lastReadAt ? Date.parse(mk.stats.lastReadAt) : null
    if (last !== null && nowMs - last > 2 * MAKER.readMs) mk.stats.downMs = (mk.stats.downMs ?? 0) + (nowMs - last - MAKER.readMs)
    mk.stats.lastReadAt = isoOf(nowMs)
  }
  return { read: reads.size, of: ids.length, resting: Object.keys(mk.open).length, ended: ended.length }
}

/** Refreshes kickoff and status of every enrolled game still before kickoff (Gamma, 50 per request). */
export async function refreshGames(mk, io, nowMs) {
  // Stopped games too: a book cleared by an unannounced early start must still have its kickoff moved back.
  const ids = Object.values(mk.markets).filter((m) => Date.parse(m.kickoff) > nowMs && !mk.replayed[m.id]).map((m) => m.id)
  const ended = []
  let n = 0
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const seen = new Set()
      for (const closed of ['false', 'true']) {
        const left = closed === 'false' ? chunk : chunk.filter((id) => !seen.has(id))
        if (!left.length) break
        const q = new URLSearchParams({ closed, limit: '100' })
        for (const id of left) q.append('id', id)
        const list = await io.getJson('https://gamma-api.polymarket.com/markets?' + q)
        for (const g of Array.isArray(list) ? list : []) { const m = mk.markets[String(g.id)]; if (m) { seen.add(m.id); refreshGame(mk, m, g, nowMs, (o) => ended.push(o)); n++ } }
        // Written before the next request: the live loop may rewrite the open-order file meanwhile.
        io.store.addOrders(ended.splice(0)); io.store.addGameEvents(mk.events.splice(0))
      }
    } catch (e) { mk.stats.refreshFails = (mk.stats.refreshFails ?? 0) + 1; io.log?.('maker refresh', e.message) }
  }
  io.store.addOrders(ended)
  io.store.addGameEvents(mk.events.splice(0))
  return n
}

/**
 * Every taker trade of the given games in [start, end], paged to the end. Anything that
 * could silently mean "no trades" is an error instead: a reply without data, a page
 * without a clear has_more, has_more without a cursor, a full page with no way to page on,
 * a trade from a game not asked for. Identical records are dropped only when they repeat
 * across pages (within a page they can be separate matches).
 */
export async function fetchTrades(io, mk, cids, start, end) {
  const want = new Set(cids.map((c) => String(c).toLowerCase()))
  const got = [], seen = new Set()
  let cursor = null, pages = 0
  do {
    const q = new URLSearchParams({ condition_id: [...want].join(','), taker_only: 'true', start: String(Math.floor(start / 1000)), end: String(Math.ceil(end / 1000)), limit: '1000' })
    if (cursor) q.set('cursor', cursor)
    mk.stats.tradeCalls++
    const body = await io.getJson('https://data-api.polymarket.com/v2/trades?' + q)
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null
    if (!raw) throw new Error('reply without data')
    const page = tradesOf(raw)
    if (page.length < raw.length) mk.stats.badRecords = (mk.stats.badRecords ?? 0) + raw.length - page.length
    const keys = new Set()
    for (const t of page) {
      if (!want.has(t.cid)) throw new Error('a trade from a game not asked for')
      const k = `${t.tx}|${t.token}|${t.side}|${t.pmil}|${t.size}|${t.ms}`
      if (seen.has(k)) continue
      keys.add(k); got.push(t)
    }
    for (const k of keys) seen.add(k)
    if (Array.isArray(body)) { if (raw.length >= 1000) throw new Error('a full page with no way to page on'); cursor = null }
    else {
      const more = body.pagination?.has_more
      if (typeof more !== 'boolean') { if (raw.length >= 1000) throw new Error('a full page without has_more'); cursor = null }
      else if (more) { if (!body.pagination.next_cursor) throw new Error('has_more without a cursor'); cursor = body.pagination.next_cursor }
      else cursor = null
    }
    if (++pages > 200) throw new Error('more than 200 pages of trades')
  } while (cursor)
  return got
}

/** How far the public feed has caught up: the newest trade anywhere (null if the feed will not say). */
async function feedWatermark(io) {
  try {
    const body = await io.getJson('https://data-api.polymarket.com/v2/trades?' + new URLSearchParams({ limit: '1', taker_only: 'true' }))
    const t = tradesOf(body)[0]
    return t ? t.ms : null
  } catch { return null }
}

/**
 * Reads the trades of every game whose kickoff was at least two hours ago, once the feed
 * shows trades from 30 minutes after that kickoff, and replays its orders, oldest kickoff
 * first. 20 games per request; a request the feed rejects is split in halves down to single
 * games. Each pass makes at most 200 requests in 5 minutes, and stops early on a rate limit
 * or five service failures in a row (backing off before the next pass). A game still
 * unreadable, or the feed still behind, a day after kickoff is void. Every write for a game
 * happens before memory changes, its "replayed" line last, so a crash cannot replay it twice.
 * 5% of replayed games are read again a day later, and any difference is counted.
 */
export async function replayDue(mk, io, nowMs) {
  const clock = io.clock ?? Date.now
  const fills = [], logged = []
  let replayedNow = 0, requests = 0, failsInRow = 0, broken = false
  const passStart = clock()
  const budgetLeft = () => !broken && requests < 200 && clock() - passStart < 5 * 60_000 && clock() >= (mk.replayBackoffUntil ?? 0)
  const finish = (m, rec) => { const r = { id: m.id, at: isoOf(nowMs), ...rec }; io.store.addReplayed([r]); mk.replayed[m.id] = r; logged.push(r) }
  const due = Object.values(mk.markets).filter((m) => !mk.replayed[m.id] && Date.parse(m.kickoff) + MAKER.tradesAfterMs <= nowMs).sort((x, y) => Date.parse(x.kickoff) - Date.parse(y.kickoff))
  for (const m of due.filter((x) => !(mk.closed[x.id] ?? []).length)) finish(m, { status: 'no orders' })
  const todo = due.filter((x) => (mk.closed[x.id] ?? []).length)
  const water = todo.length ? await feedWatermark(io) : null
  if (water !== null) mk.stats.feedWatermark = isoOf(water)
  const ready = todo.filter((m) => water !== null && water >= Date.parse(m.kickoff) + 30 * 60_000)
  const replay = (m, trades) => {
    const r = replayGame(m, mk.closed[m.id], trades, MAKER.lagMs, mk.cal[m.id])
    const add = []
    for (const w of WORLDS) for (const f of r[w]) add.push({ ...f, ruleVersion: RULE_VERSION, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null })
    const audit = Math.random() < 0.05
    const rec = { id: m.id, at: isoOf(nowMs), status: 'ok', trades: trades.length, orders: mk.closed[m.id].length, ...(audit ? { auditAt: nowMs + DAY_MS } : {}) }
    io.store.addTrades(m.id, trades); io.store.addFills(add); io.store.addReplayed([rec])   // every write first, the replayed line last
    for (const f of add) { mk.fills[`${f.world}|${f.id}`] = f; fills.push(f); if (f.world === 'trade') bumpDay(mk, Date.parse(f.filledAt), 'fills') }
    mk.replayed[m.id] = rec; replayedNow++
    if (!audit) delete mk.closed[m.id]
    mk.statsVersion = (mk.statsVersion ?? 0) + 1
  }
  const attempt = async (group) => {
    group = group.filter((m) => !mk.replayed[m.id] && (mk.closed[m.id] ?? []).length)
    if (!group.length || !budgetLeft()) return
    const start = Math.min(...group.map((m) => Math.min(...mk.closed[m.id].map((o) => o.from)))) - MAKER.lagMs
    const end = Math.max(...group.map((m) => Date.parse(m.kickoff)))
    let got
    try { requests++; got = await fetchTrades(io, mk, group.map((m) => m.cid), start, end); failsInRow = 0 }
    catch (e) {
      mk.stats.tradeFails++; mk.stats.lastTradesError = `${new Date().toISOString()} ${e.message}`.slice(0, 200); io.log?.('maker trades', e.message)
      if (isSystemic(e)) {
        failsInRow++
        if (e.status === 429 || failsInRow >= 5) { broken = true; mk.replayBackoffUntil = clock() + Math.min(e.retryAfterMs ?? 15 * 60_000, 60 * 60_000) }
        return
      }
      if (group.length > 1) { const h = Math.ceil(group.length / 2); await attempt(group.slice(0, h)); await attempt(group.slice(h)) }
      return
    }
    mk.stats.tradesRead += got.length; mk.stats.lastTradesOkAt = new Date().toISOString()
    for (const m of group) {
      try { replay(m, got.filter((t) => t.cid === String(m.cid).toLowerCase())) }
      catch (e) { mk.stats.storageErrors = (mk.stats.storageErrors ?? 0) + 1; io.log?.('maker replay write', e.message); broken = true; return }
    }
  }
  for (let i = 0; i < ready.length && budgetLeft(); i += 20) await attempt(ready.slice(i, i + 20))
  // Games past the registered day, whatever stopped them (unreadable, feed behind, a pass cut short), are void.
  for (const m of todo) {
    if (mk.replayed[m.id] || nowMs - Date.parse(m.kickoff) <= MAKER.giveUpMs) continue
    finish(m, { status: 'void', why: ready.includes(m) ? 'unreadable' : 'feed behind', orders: mk.closed[m.id].length })
    mk.stats.voidGames++; delete mk.closed[m.id]
  }
  // The re-read audit: the same game, a day later. Fills are not changed; differences are counted.
  for (const r of Object.values(mk.replayed)) {
    if (!r.auditAt || r.auditAt > nowMs || r.audited || !budgetLeft()) continue
    const m = mk.markets[r.id]
    mk.stats.audit ??= { games: 0, changed: 0, skipped: 0, tradesBefore: 0, tradesAfter: 0 }
    if (!m || !mk.closed[r.id]) { r.audited = 'skipped'; mk.stats.audit.skipped++; io.store.addReplayed([{ id: r.id, audited: 'skipped' }]); continue }
    try {
      requests++
      const got = await fetchTrades(io, mk, [m.cid], Math.min(...mk.closed[r.id].map((o) => o.from)) - MAKER.lagMs, Date.parse(m.kickoff))
      const again = replayGame(m, mk.closed[r.id], got, MAKER.lagMs, mk.cal[r.id])
      const before = WORLDS.flatMap((w) => [0, 1].map((side) => mk.fills[`${w}|${r.id}:${side}`]?.shares ?? 0)).join(',')
      const after = WORLDS.flatMap((w) => [0, 1].map((side) => again[w].find((f) => f.side === side)?.shares ?? 0)).join(',')
      const audited = before === after ? 'same' : 'changed'
      io.store.addReplayed([{ id: r.id, audited }])
      mk.stats.audit.games++; mk.stats.audit.tradesBefore += r.trades ?? 0; mk.stats.audit.tradesAfter += got.length
      if (audited === 'changed') mk.stats.audit.changed++
      r.audited = audited
    } catch { continue }
    delete mk.closed[r.id]
  }
  return { replayed: logged.length + replayedNow, fills: fills.length, waiting: todo.filter((m) => !mk.replayed[m.id]).length }
}

/** Settles fills whose game has been decided (Gamma, 50 games per request). */
export async function settleFills(mk, io, nowMs) {
  const due = Object.values(mk.fills).filter((f) => !f.settle && !isStale(f, nowMs))
  const byMarket = new Map()
  for (const f of due) { if (!byMarket.has(f.marketId)) byMarket.set(f.marketId, []); byMarket.get(f.marketId).push(f) }
  const ids = [...byMarket.keys()], done = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const q = new URLSearchParams({ closed: 'true', limit: '100' })
      for (const id of chunk) q.append('id', id)
      const ms = await io.getJson('https://gamma-api.polymarket.com/markets?' + q)
      const by = new Map((Array.isArray(ms) ? ms : []).map((m) => [String(m.id), m]))
      for (const id of chunk) for (const f of byMarket.get(id)) { const s = settleFill(f, by.get(id)); if (s) done.push([f, s]) }
    } catch (e) { mk.stats.settleFails = (mk.stats.settleFails ?? 0) + 1; io.log?.('maker settle', e.message) }
  }
  io.store.addSettles(done.map(([f, s]) => ({ ...f, settle: s })))   // written first
  for (const [f, s] of done) { f.settle = s; if (f.world === 'trade') bumpDay(mk, nowMs, 'settled') }
  if (done.length) mk.statsVersion = (mk.statsVersion ?? 0) + 1
  return done.length
}

/** Results for the calibration correction: every enrolled game with a kickoff midpoint. */
export async function settleCal(mk, io, nowMs) {
  const due = Object.values(mk.cal).filter((c) => c.mid !== null && c.r0 === undefined && Date.parse(c.kickoff) + MAKER.tradesAfterMs <= nowMs && nowMs - Date.parse(c.kickoff) < MAKER.unsettledAfterDays * DAY_MS)
  const done = []
  for (let i = 0; i < due.length; i += 50) {
    const chunk = due.slice(i, i + 50)
    try {
      const q = new URLSearchParams({ closed: 'true', limit: '100' })
      for (const c of chunk) q.append('id', c.id)
      const list = await io.getJson('https://gamma-api.polymarket.com/markets?' + q)
      for (const g of Array.isArray(list) ? list : []) {
        const c = mk.cal[String(g.id)]
        const s = c && settleFill({ side: 0, shares: 1, price: 0 }, g)
        if (s) done.push([c, s.yesPrice])
      }
    } catch (e) { mk.stats.calFails = (mk.stats.calFails ?? 0) + 1; io.log?.('maker cal', e.message) }
  }
  io.store.addCal(done.map(([c, r0]) => ({ id: c.id, r0 })))
  for (const [c, r0] of done) c.r0 = r0
  if (done.length) mk.statsVersion = (mk.statsVersion ?? 0) + 1
  return done.length
}

/** Polymarket's own minute price 1, 15 and 60 minutes after each fill (reported, not deciding). */
export async function markFills(mk, io, nowMs) {
  const due = Object.values(mk.fills).filter((f) => f.world === 'trade' && !f.after && (f._afterTries ?? 0) < 3 && Date.parse(f.filledAt) + 61 * 60_000 <= nowMs).slice(0, 200)
  let n = 0
  for (const f of due) {
    f._afterTries = (f._afterTries ?? 0) + 1
    const t = Math.floor(Date.parse(f.filledAt) / 1000)
    try {
      const body = await io.getJson(`https://clob.polymarket.com/prices-history?market=${f.token}&startTs=${t - 60}&endTs=${t + 3660}&fidelity=1`)
      const pts = (body?.history ?? []).map((x) => ({ t: +x.t, p: +x.p })).filter((x) => Number.isFinite(x.p)).sort((a, b) => a.t - b.t)
      const at = (s) => { let v = null; for (const x of pts) if (x.t <= t + s) v = x.p; return v }
      const after = { m1: at(60), m15: at(900), m60: at(3600) }
      io.store.addAfter({ key: `${f.world}|${f.id}`, after })
      f.after = after; n++
    } catch (e) { io.log?.('maker after', e.message) }
    await sleep(50)
  }
  return n
}

/** Drops games that are replayed, filled nothing, and have no audit pending. */
export function pruneMarkets(mk) {
  for (const id of Object.keys(mk.markets)) {
    const r = mk.replayed[id]
    if (r && !(r.auditAt && !r.audited) && !WORLDS.some((w) => mk.fills[`${w}|${id}:0`] || mk.fills[`${w}|${id}:1`])) { delete mk.markets[id]; delete mk.closed[id] }
  }
}

// ---------------------------------------------------------------- dashboard
function sliceTable(fills, key, counted) {
  const rows = new Map()
  for (const f of fills) {
    const k = f[key] ?? 'Untagged'
    if (!rows.has(k)) rows.set(k, { name: k, fills: 0, settled: 0, list: [] })
    const r = rows.get(k)
    r.fills++
    if (f.settle) r.settled++
    if (f.settle && counted.has(`${f.world}|${f.id}`)) r.list.push(f)
  }
  return [...rows.values()].sort((a, b) => b.fills - a.fills).map(({ list, ...r }) => {
    const res = list.length ? profitPerDollar(list, { iters: 400 }) : null
    return { ...r, counted: list.length, wins: list.filter((f) => f.settle.yesPrice === 1).length, losses: list.filter((f) => f.settle.yesPrice === 0).length,
      perDollar: res?.perDollar ?? null, lo: res?.lo ?? null, hi: res?.hi ?? null, avgPrice: list.length ? list.reduce((a, f) => a + f.price, 0) / list.length : null }
  })
}

/** Everything the dashboard shows for Test C, for an optional sport / bet-type filter. */
export function makerDashboard(mk, nowMs, { sport = null, type = null, iters = 200, summary = null } = {}) {
  const final = mk.final
  const { settledIds, ...frozen } = final ?? {}
  const s = final ? { ...frozen, stats: mk.stats } : summary ?? makerSummary(mk, nowMs, { iters })
  const counted = new Set(final ? settledIds : Object.values(mk.fills).filter((f) => f.settle).map((f) => `${f.world}|${f.id}`))
  const okTags = (x) => (!sport || (x.sport ?? 'Untagged') === sport) && (!type || (x.type ?? 'Untagged') === type)
  const trade = fillsOf(mk, 'trade'), tradeView = trade.filter(okTags)
  const row = (f) => ({
    id: f.id, question: f.question, outcome: f.outcome, sport: f.sport, league: f.league, type: f.type, price: f.price, shares: f.shares, cost: f.cost,
    bid: f.bid, ask: f.ask, source: f.source, filledAt: f.filledAt, endDate: f.kickoff, mark: f.mark,
    status: f.settle ? 'settled' : isStale(f, nowMs) ? 'stale' : 'waiting',
    ...(f.settle && counted.has(`${f.world}|${f.id}`) ? { resolved: f.settle.yesPrice, pnl: f.settle.pnl, counted: true } : {}),
  })
  const resting = []
  for (const o of final ? [] : Object.values(mk.open)) {
    const m = mk.markets[o.id]
    if (!m || !okTags(m)) continue
    const [bm, am] = m.book ?? [null, null]
    const own = o.side === 0 ? [bm, am] : [am === null ? null : 1000 - am, bm === null ? null : 1000 - bm]
    resting.push({ question: m.question, outcome: m.outcomes[o.side], sport: m.sport, league: m.league, type: m.type, price: o.price, shares: o.shares,
      bid: own[0] === null ? null : own[0] / 1000, ask: own[1] === null ? null : own[1] / 1000, endDate: m.kickoff, since: isoOf(o.from), touched: Boolean(o.touch) })
  }
  resting.sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))
  const games = Object.values(mk.markets).filter(okTags)
  // Orders per day are counted for all games; fills and settlements follow the filter.
  const days = new Map(Object.entries(mk.stats.byDay).map(([d, v]) => [d, { day: d, orders: v.orders ?? 0, fills: 0, settled: 0 }]))
  const dayRow = (d) => { if (!days.has(d)) days.set(d, { day: d, orders: 0, fills: 0, settled: 0 }); return days.get(d) }
  for (const f of tradeView) { dayRow(f.filledAt.slice(0, 10)).fills++; if (f.settle) dayRow(f.settle.settledAt.slice(0, 10)).settled++ }
  const perDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-35)
  const priceBins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0 }))
  for (const f of tradeView) priceBins[Math.min(9, Math.floor(f.price * 10))].n++
  let viewResult = null
  if (sport || type) {
    const list = tradeView.filter((f) => f.settle && counted.has(`trade|${f.id}`))
    const r = list.length ? profitPerDollar(list, { iters: 400 }) : null
    viewResult = r ? { result: r, hitRate: list.filter((f) => f.settle.yesPrice === 1).length / list.length, avgPrice: list.reduce((a, f) => a + f.price, 0) / list.length } : null
  }
  const first = mk.firstEnrolledAt ? Date.parse(mk.firstEnrolledAt) : null
  let eta = null
  if (first !== null) {
    // Matches with a settled fill arrive about a day after orders start; the rate so far estimates the rest.
    const n = s.matches ?? 0, rate = n / Math.max(nowMs - first - DAY_MS, 3600_000)
    const tN = n >= MAKER.stopMatches ? nowMs : rate > 0 ? nowMs + (MAKER.stopMatches - n) / rate : Infinity
    eta = isoOf(Math.min(first + MAKER.stopDays * DAY_MS, Math.max(first + MAKER.minDays * DAY_MS, tN)))
  }
  // Filter options: games enrolled per sport / bet type since the start.
  const kinds = (key) => Object.entries(mk.stats.enrolledBy?.[key] ?? {}).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, bets: n }))
  return {
    kind: 'maker', arm: 'C', armInfo: MAKER_INFO, filter: { sport, type }, ...s, done: Boolean(final), running: !final, skipped: mk.skipped ?? {},
    rule: { stakeUsd: MAKER.stakeUsd, readMin: MAKER.readMs / 60_000, stopMatches: MAKER.stopMatches, minDays: MAKER.minDays, stopDays: MAKER.stopDays, tradesAfterH: MAKER.tradesAfterMs / 3600_000, ruleVersion: RULE_VERSION },
    view: {
      upcomingGames: final ? 0 : games.filter((m) => Date.parse(m.kickoff) > nowMs && !m.stopped).length,
      quotingGames: new Set(Object.values(mk.open).filter((o) => mk.markets[o.id] && okTags(mk.markets[o.id])).map((o) => o.id)).size,
      ordersNow: resting.length,
      checking: games.filter((m) => Date.parse(m.kickoff) <= nowMs && !mk.replayed[m.id]).length,
      fills: tradeView.length, touchFills: fillsOf(mk, 'touch').filter(okTags).length,
      settled: tradeView.filter((f) => f.settle).length, waiting: tradeView.filter((f) => !f.settle && !isStale(f, nowMs)).length,
      counted: tradeView.filter((f) => f.settle && counted.has(`trade|${f.id}`)).length,
      replayed: Object.values(mk.replayed).filter((r) => r.status === 'ok').length,
    },
    sports: kinds('sport'), types: kinds('type'),
    resting: resting.slice(0, 40), restingTotal: resting.length,
    latest: [...tradeView].sort((a, b) => Date.parse(b.filledAt) - Date.parse(a.filledAt)).slice(0, 40).map(row),
    upcoming: tradeView.filter((f) => !f.settle && !isStale(f, nowMs)).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, 40).map(row),
    results: tradeView.filter((f) => f.settle && counted.has(`trade|${f.id}`)).sort((a, b) => Date.parse(b.settle.settledAt) - Date.parse(a.settle.settledAt)).slice(0, 40).map(row),
    bySport: sliceTable(trade.filter((f) => !type || (f.type ?? 'Untagged') === type), 'sport', counted),
    byType: sliceTable(trade.filter((f) => !sport || (f.sport ?? 'Untagged') === sport), 'type', counted),
    perDay, priceBins, viewResult, eta, generatedAt: isoOf(nowMs),
    firstRecordAt: mk.firstEnrolledAt, lastScanAt: mk.stats.lastReadAt, scanEveryMin: MAKER.readMs / 60_000,
  }
}

/** Every fill (both rules, with settlement), the replay log, the calibration table and the counters, for offline evaluation. */
export function makerExportLines(mk, nowMs) {
  return [
    { kind: 'maker-meta', exportedAt: isoOf(nowMs), rule: MAKER, ruleVersion: RULE_VERSION, firstEnrolledAt: mk.firstEnrolledAt, stats: mk.stats, final: mk.final,
      calibration: calibrationTable(Object.values(mk.cal ?? {})).table },
    ...Object.values(mk.fills).map(({ _afterTries, ...f }) => ({ kind: 'fill', ...f })),
    ...Object.values(mk.replayed).map((r) => ({ kind: 'replayed', ...r })),
    ...Object.values(mk.cal).map((c) => ({ kind: 'cal', ...c })),
  ]
}

export async function feedCheck(io, markets, nowMs = Date.now()) {
  const out = { at: new Date(nowMs).toISOString(), markets: [] }
  for (const m of markets.slice(0, 5)) {
    const row = { id: String(m.id), cid: m.conditionId, question: m.question, tokens: (() => { try { return JSON.parse(m.clobTokenIds) } catch { return null } })() }
    for (const takerOnly of ['true', 'false']) {
      try {
        const q = new URLSearchParams({ condition_id: m.conditionId, taker_only: takerOnly, limit: '200' })
        const body = await io.getJson('https://data-api.polymarket.com/v2/trades?' + q)
        const raw = Array.isArray(body) ? body : body?.data ?? []
        const byTx = new Map()
        for (const t of raw) { const k = t.transaction_hash ?? t.transactionHash; if (!byTx.has(k)) byTx.set(k, []); byTx.get(k).push(t) }
        row['takerOnly_' + takerOnly] = {
          n: raw.length, keys: raw[0] ? Object.keys(raw[0]) : [], pagination: body?.pagination ?? null,
          newestAgeS: raw.length ? Math.round(nowMs / 1000 - Math.max(...raw.map((t) => +t.timestamp))) : null,
          multiTx: [...byTx.values()].filter((v) => v.length > 1).length,
          sample: raw.slice(0, 12).map(({ profile_image: _a, profile_image_optimized: _b, bio: _c, icon: _d, name: _e, pseudonym: _f, profileImage: _g, profileImageOptimized: _h, ...t }) => t),
          sampleMultiTx: [...byTx.values()].filter((v) => v.length > 1).slice(0, 4).map((v) => v.map((t) => ({ side: t.side, token: String(t.token_id ?? t.asset).slice(-6), price: t.price, size: t.size, ts: t.timestamp, wallet: String(t.proxy_wallet ?? t.proxyWallet).slice(0, 8) }))),
        }
      } catch (e) { row['takerOnly_' + takerOnly] = { error: e.message.slice(0, 200) } }
    }
    // Does start/end bound the timestamps?
    try {
      const end = Math.floor(nowMs / 1000) - 3600, start = end - 3600
      const body = await io.getJson('https://data-api.polymarket.com/v2/trades?' + new URLSearchParams({ condition_id: m.conditionId, taker_only: 'false', start: String(start), end: String(end), limit: '500' }))
      const raw = Array.isArray(body) ? body : body?.data ?? []
      row.window = { start, end, n: raw.length, outside: raw.filter((t) => +t.timestamp < start || +t.timestamp > end).length, min: raw.length ? Math.min(...raw.map((t) => +t.timestamp)) : null, max: raw.length ? Math.max(...raw.map((t) => +t.timestamp)) : null }
    } catch (e) { row.window = { error: e.message.slice(0, 200) } }
    out.markets.push(row)
  }
  // Whether Polymarket would accept orders from this host's location (where a live bot would run).
  try { out.geoblock = await io.getJson('https://polymarket.com/api/geoblock') } catch (e) { out.geoblock = { error: e.message.slice(0, 200) } }
  // The older endpoint, for comparison.
  try {
    const m = markets[0]
    const body = await io.getJson('https://data-api.polymarket.com/trades?' + new URLSearchParams({ market: m.conditionId, limit: '20', takerOnly: 'false' }))
    out.v1 = { n: Array.isArray(body) ? body.length : null, keys: Array.isArray(body) && body[0] ? Object.keys(body[0]) : null, sample: Array.isArray(body) ? body.slice(0, 6).map((t) => ({ side: t.side, asset: String(t.asset).slice(-6), price: t.price, size: t.size, ts: t.timestamp, tx: String(t.transactionHash).slice(0, 12) })) : body }
  } catch (e) { out.v1 = { error: e.message.slice(0, 200) } }
  return out
}
