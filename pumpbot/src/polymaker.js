/**
 * Test C — PREREG-POLY-MAKER.md: does a paper buy order resting one tick above the best bid
 * (a maker order) on Polymarket sports markets earn the spread?
 *
 * Nothing is ever placed. Live, every minute, each enrolled game's best bid and ask are read
 * and its paper orders re-priced (best bid + 1¢, both outcomes, when the spread is 3–10¢);
 * what the book did while each order rested (a sell offered at or below it, or the midpoint
 * reaching it) is recorded as it happens. Two hours after kickoff the game's public trades
 * are read and every order is replayed under two fill rules:
 *   trade rule — filled only when a real seller reached its price (or a sell crossed it);
 *   touch rule — also filled whenever the market's midpoint came down to its price.
 * The first is what a paper test can see; the second assumes every stale order is picked off.
 *
 * Run by the sports tracker (src/polysports.js). Pure functions first (tested), then I/O.
 */
import fs from 'node:fs'
import path from 'node:path'
import { profitPerDollar, armOf, tagsOf, matchKeyOf } from './polysports.js'

// ---------------------------------------------------------------- the registered rule
export const MAKER = {
  enrollMinH: 22, enrollMaxH: 26,      // enrolled when kickoff is this far away (as Tests A/B)
  kickoffSlackMs: 15 * 60_000,         // gameStartTime must lie this close to endDate (games, not tournaments)
  readMs: 60_000,                      // best bid/ask read every minute for markets with orders
  idleReadMs: 5 * 60_000,              // and every 5 minutes for the rest
  enrollMs: 15 * 60_000,
  minSpread: 30, maxSpread: 100,       // in thousandths: 3¢ to 10¢ (1¢-tick books only)
  stakeUsd: 2, minShares: 5,
  lagMs: 60_000,                       // a trade's feed time may trail its match by up to this
  tradesAfterMs: 2 * 3600_000,         // a game's trades are read this long after kickoff
  giveUpMs: 24 * 3600_000,             // a game whose trades cannot be read by then is void
  lateMs: 3 * 60_000,                  // reads further apart than this end the order 1 minute after the last one
  stopMatches: 300, minDays: 7, stopDays: 28, unsettledAfterDays: 14,
  futilityFromDays: 3, futilityMatches: 150,
  minSettledFills: 100, maxVoidShare: 0.10, maxDowntimeShare: 0.10,
  calBand: 0.05, calMin: 30,           // calibration correction per 5¢ band of the kickoff midpoint
}
export const RULE_VERSION = 'C1'
export const MAKER_INFO = {
  name: 'Test C · Maker',
  blurb: 'Rests paper buy orders 1¢ above the best bid on both sides of sports games, re-priced every minute. A fill counts only when a real seller reaches the price. Makers pay no fee.',
  prereg: 'PREREG-POLY-MAKER.md',
}
export const WORLDS = ['trade', 'touch']
const DAY_MS = 86400_000
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x))
/** Prices are compared in whole thousandths, so 0.06 + 0.01 is exactly 0.07. */
export const mil = (x) => Math.round(Number(x) * 1000)

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
    kickoff: new Date(kickoffOf(m)).toISOString(), endDate: m.endDate, enrolledAt: new Date(nowMs).toISOString(),
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

/**
 * What a read says about an order resting at pm (thousandths):
 *   cross — a sell was offered at or below its price (it would have traded with us);
 *   touch — the midpoint came down to its price, its outcome's bid vanished, or the spread
 *           blew out past 10¢ (the market moved or thinned; a stale order gets picked off).
 */
export function evidenceAt(side, pm, bm, am) {
  if (side === 0) {
    const cross = am !== null && am <= pm
    const touch = cross || bm === null || (am !== null && (bm + am) / 2 <= pm) || (am !== null && am - bm > MAKER.maxSpread)
    return { cross, touch }
  }
  const cross = bm !== null && bm >= 1000 - pm
  const touch = cross || am === null || (bm !== null && 1000 - (bm + am) / 2 <= pm) || (bm !== null && am - bm > MAKER.maxSpread)
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
    closed: {},       // id → orders that have ended, kept until the game is replayed
    retired: {},      // `${id}:${side}` → true once a crossing filled it (no more orders)
    needSize: [],     // crossings whose size still has to be read from the full book
    fills: {},        // `${world}|${id}:${side}` → fill
    replayed: {},     // id → { at, trades, status }
    cal: {},          // id → { mid, at, kickoff, r0 } for every enrolled game: the calibration correction
    enrolled: new Set(),  // every id ever enrolled: a market is enrolled once
    stats: { reads: 0, readFails: 0, orders: 0, crossings: 0, touches: 0, tradeCalls: 0, tradeFails: 0, tradesRead: 0, voidGames: 0, lastReadAt: null, lastTradesOkAt: null, lastTradesError: null, restarts: 0, byDay: {} },
    firstEnrolledAt: null,
    final: null,
  }
}
const day = (ms) => new Date(ms).toISOString().slice(0, 10)
function bumpDay(mk, ms, k, by = 1) { const d = day(ms); mk.stats.byDay[d] ??= { orders: 0, fills: 0, settled: 0 }; mk.stats.byDay[d][k] = (mk.stats.byDay[d][k] ?? 0) + by }

function closeOrder(mk, o, to, onClosed) {
  o.to = Math.max(o.from, to)
  delete mk.open[`${o.id}:${o.side}`]
  if (mk.replayed[o.id]) { mk.stats.lostOrders = (mk.stats.lostOrders ?? 0) + 1; return }   // its game was already replayed
  ;(mk.closed[o.id] ??= []).push(o)
  onClosed?.(o)
}

/**
 * One read of one game at time tau: records evidence against its resting orders, then
 * re-prices them. An order whose price is unchanged keeps resting (its life continues);
 * a new price ends it and starts another. A crossing fills the order under both rules, so
 * that outcome is never quoted again.
 */
export function applyRead(mk, id, bm, am, tau, onClosed) {
  const m = mk.markets[id]
  if (!m || m.stopped || tau >= Date.parse(m.kickoff)) return
  m.lastRead = tau
  // A book emptied on both sides after being two-sided has been cleared (the game started,
  // or was pulled): quoting stops for good.
  if (bm === null && am === null && m.twoSided) {
    m.stopped = { at: tau, why: 'book cleared' }
    for (const side of [0, 1]) { const o = mk.open[`${id}:${side}`]; if (o) closeOrder(mk, o, tau, onClosed) }
    return
  }
  if (bm !== null && am !== null) { m.mark = { mid: (bm + am) / 2000, at: tau }; m.twoSided = true }   // the markout's reference
  for (const side of [0, 1]) {
    const key = `${id}:${side}`
    let o = mk.open[key]
    // Reads too far apart (an outage): the order is judged only up to a minute after the last read that saw it.
    if (o && tau - (o.seen ?? o.from) > MAKER.lateMs) { o.late = true; mk.stats.late = (mk.stats.late ?? 0) + 1; closeOrder(mk, o, (o.seen ?? o.from) + MAKER.readMs, onClosed); o = null }
    if (!o) continue
    o.seen = tau
    const ev = evidenceAt(side, o.pm, bm, am)
    if (ev.touch && o.touch === null) { o.touch = tau; mk.stats.touches++ }
    if (ev.cross) {
      o.cross = { at: tau, size: null }
      mk.retired[key] = true; mk.stats.crossings++
      mk.needSize.push({ id, side, pm: o.pm, at: tau })
      closeOrder(mk, o, tau, onClosed)
    }
  }
  const q = quote(bm, am)
  for (const side of [0, 1]) {
    const key = `${id}:${side}`
    if (mk.retired[key]) continue
    const o = mk.open[key], pm = q.pm ? q.pm[side] : null
    if (o && o.pm === pm) { o.seen = tau; continue }
    if (o) closeOrder(mk, o, tau, onClosed)
    if (pm === null) continue
    const own = side === 0 ? [bm, am] : [1000 - am, 1000 - bm]
    mk.open[key] = { id, side, pm, price: pm / 1000, shares: sharesFor(pm, m.minShares), from: tau, seen: tau, to: null, bid: own[0] / 1000, ask: own[1] / 1000, spread: q.spread, cross: null, touch: null }
    mk.stats.orders++; bumpDay(mk, tau, 'orders')
  }
  m.active = Boolean(q.pm) || Boolean(mk.open[`${id}:0`] || mk.open[`${id}:1`])
}

/** Orders still resting at kickoff end there: Polymarket clears sports books at the start. */
export function closeAtKickoff(mk, nowMs, onClosed) {
  for (const o of Object.values(mk.open)) {
    const m = mk.markets[o.id]
    const k = Date.parse(m?.kickoff ?? 0)
    if (k <= nowMs) closeOrder(mk, o, Math.min(k, (o.seen ?? o.from) + MAKER.lateMs), onClosed)
    else if (m?.stopped) closeOrder(mk, o, m.stopped.at, onClosed)
  }
}

/**
 * Applies a fresh Gamma record of an enrolled game: an earlier kickoff ends quoting then
 * (a later one does not extend it); a closed market, or one not accepting orders, stops it.
 */
export function refreshGame(m, g, nowMs) {
  if (!g) return
  const k = kickoffOf(g), end = Date.parse(g.endDate)
  const earliest = Math.min(...[k, end].filter((x) => Number.isFinite(x)), Date.parse(m.kickoff))
  if (earliest < Date.parse(m.kickoff)) { m.kickoffMoved = m.kickoffMoved ?? m.kickoff; m.kickoff = new Date(earliest).toISOString() }
  if (!m.stopped && (g.closed || g.acceptingOrders === false)) m.stopped = { at: nowMs, why: g.closed ? 'closed' : 'not accepting orders' }
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
 * Per outcome, orders are taken in time order and the first with any evidence fills;
 * later orders of that outcome never existed. A trade's feed time may trail its match by
 * up to L, so a seller print counts for an order whose life overlaps [time − L, time]; if
 * it qualifies for two neighbouring orders, it goes to the dearer one. Crossing prints
 * count only when the whole of [time − L, time] lies inside the order's life.
 */
export function replayGame(m, orders, trades, L = MAKER.lagMs) {
  const out = { trade: [], touch: [] }
  const seen = new Set(), uniq = []
  for (const t of trades) { const k = `${t.tx}|${t.token}|${t.pmil}|${t.size}|${t.ms}|${t.side}`; if (t.tx && seen.has(k)) continue; seen.add(k); uniq.push(t) }
  for (const side of [0, 1]) {
    const list = orders.filter((o) => o.side === side).sort((a, b) => a.from - b.from)
    for (const world of WORLDS) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i], next = list[i + 1]
        let shares = 0, at = Infinity, sources = new Set(), prints = 0
        for (const t of uniq) {
          const c = classify(t, m.tokens, side, o.pm)
          if (!c) continue
          if (c === 'seller') {
            if (!(t.ms - L < o.to && t.ms >= o.from)) continue
            // Also within the next order's life and qualifying there at a higher price: it is the next one's.
            if (next && next.pm > o.pm && t.ms - L < next.to && t.ms >= next.from && classify(t, m.tokens, side, next.pm) === 'seller') continue
          } else if (!(t.ms - L >= o.from && t.ms < o.to)) continue
          shares += t.size; prints++; sources.add(c === 'seller' ? 'trade' : 'crossprint')
          at = Math.min(at, Math.max(o.from, t.ms - L))
        }
        if (o.cross) { shares += o.cross.size ?? o.shares; sources.add('cross'); at = Math.min(at, o.cross.at) }
        let touched = false
        if (world === 'touch' && o.touch !== null && o.touch !== undefined && (!Number.isFinite(at) || o.touch <= at)) { touched = true; at = o.touch }
        if (!(shares > 0) && !touched) continue
        const got = touched ? o.shares : Math.min(o.shares, shares)
        out[world].push({
          world, id: `${m.id}:${side}`, marketId: m.id, side, outcome: m.outcomes[side], question: m.question, token: m.tokens[side],
          price: o.pm / 1000, shares: +got.toFixed(4), cost: +(got * o.pm / 1000).toFixed(6), source: touched ? 'touch' : [...sources].sort().join('+'), prints,
          orderShares: o.shares, evidence: +shares.toFixed(4), feeRate: m.feeRate ?? null,
          orderFrom: new Date(o.from).toISOString(), filledAt: new Date(at).toISOString(), bid: o.bid, ask: o.ask, spread: o.spread,
          kickoff: m.kickoff, endDate: m.endDate, game: m.game, event: m.event, sport: m.sport ?? null, league: m.league ?? null, type: m.type ?? null,
          mark: m.mark ? (side === 0 ? m.mark.mid : 1 - m.mark.mid) : null, rebateRate: m.rebateRate ?? null,
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
export const SIDES = ['cheaper', 'dearer']

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
/** Σvalue / Σcost with a bootstrap over matches; lo/hi at the given two-sided level. */
export function ratioBoot(rows, { iters = 2000, level = 0.95 } = {}) {
  if (!rows.length) return null
  const by = new Map()
  for (const r of rows) { if (!by.has(r.cluster)) by.set(r.cluster, [0, 0]); const g = by.get(r.cluster); g[0] += r.value; g[1] += r.cost }
  const groups = [...by.values()], rnd = mulberry32(777), out = []
  for (let k = 0; k < iters; k++) { let v = 0, c = 0; for (let j = 0; j < groups.length; j++) { const g = groups[Math.floor(rnd() * groups.length)]; v += g[0]; c += g[1] } out.push(c > 0 ? v / c : 0) }
  out.sort((x, y) => x - y)
  const v = rows.reduce((a, r) => a + r.value, 0), c = rows.reduce((a, r) => a + r.cost, 0), tail = (1 - level) / 2
  return { n: rows.length, matches: groups.length, value: v, cost: c, perDollar: v / c, lo: out[Math.floor(iters * tail)], hi: out[Math.min(iters - 1, Math.floor(iters * (1 - tail)))] }
}

/**
 * The calibration correction: for every enrolled game whose result is known, each outcome's
 * midpoint just before kickoff against how it resolved, by 5¢ band. c(mid) is the average
 * (result − midpoint) in that band, or 0 where the band has fewer than 30 outcomes.
 */
export function calibrationTable(cal) {
  const n = Math.round(1 / MAKER.calBand), bins = Array.from({ length: n }, () => ({ n: 0, sum: 0 }))
  for (const x of cal) {
    if (x.r0 === null || x.r0 === undefined || x.mid === null || x.mid === undefined) continue
    for (const [mid, r] of [[x.mid, x.r0], [1 - x.mid, 1 - x.r0]]) { const b = bins[Math.min(n - 1, Math.floor(mid / MAKER.calBand))]; b.n++; b.sum += r - mid }
  }
  const table = bins.map((b, i) => ({ lo: i * MAKER.calBand, n: b.n, c: b.n >= MAKER.calMin ? b.sum / b.n : 0 }))
  return { table, c: (mid) => table[Math.min(n - 1, Math.max(0, Math.floor(mid / MAKER.calBand)))].c }
}

/**
 * The primary statistic: calibration-corrected markout per $1 — Σ shares × (kickoff
 * midpoint − price + c(midpoint)) ÷ Σ shares × price — resampling matches. The outcome
 * profit per $1 is its sanity check.
 */
export function sideResult(fills, cal, { iters = 2000, level = 0.95 } = {}) {
  const marked = fills.filter((f) => f.mark !== null && f.mark !== undefined)
  const markout = ratioBoot(marked.map((f) => ({ cluster: f.game ?? f.marketId, value: f.shares * (f.mark - f.price + cal.c(f.mark)), cost: f.shares * f.price })), { iters, level })
  // Live, a visible order can be jumped: what if every fill cost a tick more, or we were second in line?
  const tickDearer = ratioBoot(marked.map((f) => ({ cluster: f.game ?? f.marketId, value: f.shares * (f.mark - f.price - 0.01 + cal.c(f.mark)), cost: f.shares * (f.price + 0.01) })), { iters: 200, level })
  const second = marked.map((f) => ({ f, sh: f.source === 'touch' ? f.shares : Math.min(f.orderShares ?? f.shares, Math.max(0, (f.evidence ?? f.shares) - (f.orderShares ?? f.shares))) })).filter((x) => x.sh > 0)
  const secondInLine = ratioBoot(second.map(({ f, sh }) => ({ cluster: f.game ?? f.marketId, value: sh * (f.mark - f.price + cal.c(f.mark)), cost: sh * f.price })), { iters: 200, level })
  const settled = fills.filter((f) => f.settle)
  const outcome = ratioBoot(settled.map((f) => ({ cluster: f.game ?? f.marketId, value: f.settle.pnl, cost: f.settle.cost })), { iters, level: 0.95 })
  const wins = settled.filter((f) => f.settle.yesPrice === 1).length
  return {
    fills: fills.length, settled: settled.length, wins, losses: settled.filter((f) => f.settle.yesPrice === 0).length,
    matches: new Set(settled.map((f) => f.game ?? f.marketId)).size, markout, outcome, tickDearer, secondInLine,
    hitRate: settled.length ? wins / settled.length : null, avgPrice: settled.length ? settled.reduce((a, f) => a + f.price, 0) / settled.length : null,
  }
}

/**
 * The verdict, per side (Bonferroni over the two sides: 98.75% intervals). A side is YES
 * only if its corrected markout's lower end is above zero under BOTH fill rules and its
 * outcome profit under the trade rule is not negative. The data gates come first.
 */
export function verdictOf(s) {
  if (s.gate) return `INCONCLUSIVE — ${s.gate}`
  const passed = SIDES.filter((side) => {
    const t = s.sides[side]?.trade, h = s.sides[side]?.touch
    return t?.markout && h?.markout && t.markout.lo > 0 && h.markout.lo > 0 && t.outcome && t.outcome.perDollar >= 0
  })
  if (passed.length) return `YES — ${passed.join(' and ')} side${passed.length > 1 ? 's' : ''}: resting orders made money under both fill rules`
  const tradeOnly = SIDES.filter((side) => s.sides[side]?.trade?.markout?.lo > 0)
  if (tradeOnly.length) return `NO — the ${tradeOnly.join(' and ')} side made money only if stale orders are never picked off`
  return 'NO — resting orders did not reliably make money'
}

export function makerSummary(mk, nowMs, { iters = 1000 } = {}) {
  const cal = calibrationTable(Object.values(mk.cal ?? {}))
  const sides = {}
  for (const side of SIDES) {
    sides[side] = {}
    for (const w of WORLDS) sides[side][w] = sideResult(fillsOf(mk, w).filter((f) => sideOf(f) === side), cal, { iters, level: 0.9875 })
  }
  const pooled = Object.fromEntries(WORLDS.map((w) => [w, sideResult(fillsOf(mk, w), cal, { iters, level: 0.95 })]))
  const first = mk.firstEnrolledAt ? Date.parse(mk.firstEnrolledAt) : null
  const days = first !== null ? (nowMs - first) / DAY_MS : 0
  const matches = pooled.trade.matches
  const games = Object.values(mk.replayed ?? {}).filter((r) => r.status !== 'no orders')
  const voidShare = games.length ? games.filter((r) => r.status === 'void').length / games.length : 0
  const downShare = first !== null && nowMs > first ? (mk.stats.downMs ?? 0) / (nowMs - first) : 0
  const gate = pooled.trade.settled < MAKER.minSettledFills ? `only ${pooled.trade.settled} settled fills (needs ${MAKER.minSettledFills})`
    : voidShare > MAKER.maxVoidShare ? `${Math.round(voidShare * 100)}% of games had unreadable trades`
    : downShare > MAKER.maxDowntimeShare ? `the tracker was down ${Math.round(downShare * 100)}% of the time` : null
  // Futility, from day 3: neither side can plausibly be ahead even under the trade rule.
  const futile = days >= MAKER.futilityFromDays && matches >= MAKER.futilityMatches
    && SIDES.every((side) => { const m = sides[side].trade.markout; return !m || m.hi < 0 })
  const done = (days >= MAKER.minDays && matches >= MAKER.stopMatches) || days >= MAKER.stopDays || futile
  const out = { sides, pooled, matches, days: +days.toFixed(1), done, futile, gate: done ? gate : null, voidShare, downShare,
    calibration: cal.table, pairs: Object.keys(mk.markets).filter((id) => mk.fills[`trade|${id}:0`] && mk.fills[`trade|${id}:1`]).length,
    firstEnrolledAt: mk.firstEnrolledAt, stats: mk.stats, ruleVersion: RULE_VERSION }
  out.verdict = futile && !gate ? 'NO — stopped for futility' : verdictOf({ ...out, gate })
  return out
}

/** The stop, made permanent: everything from the fills settled at that moment. */
export function freezeMaker(mk, nowMs) {
  if (mk.final) return mk.final
  const { stats: _s, ...s } = makerSummary(mk, nowMs, { iters: 4000 })
  mk.final = { ...s, done: true, frozenAt: new Date(nowMs).toISOString(), commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null, settledIds: Object.values(mk.fills).filter((f) => f.settle).map((f) => `${f.world}|${f.id}`) }
  return mk.final
}

// ---------------------------------------------------------------- storage
/**
 * Append-only, beside Tests A/B's files:
 *   maker-markets.jsonl   one line per enrolled game
 *   maker-orders.jsonl    one line per order when it ends (its life and what the book did)
 *   maker-open.json       orders resting now, rewritten each round, so they rest through a restart
 *   maker-trades.jsonl    each replayed game's trades (compact), for audit
 *   maker-replayed.jsonl  one line per game replayed (or void)
 *   maker-fills.jsonl     one line per fill, per rule
 *   maker-settles.jsonl   one line per settled fill
 *   maker-cal.jsonl       each game's midpoint at kickoff, then its result (the calibration correction)
 *   maker-meta.json       counters and the frozen result
 * Games already replayed are not loaded back into memory, except for their fills.
 */
export function openMakerStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const f = (n) => path.join(dir, n)
  const each = (name, fn) => {
    if (!fs.existsSync(f(name))) return 0
    let bad = 0
    for (const l of fs.readFileSync(f(name), 'utf8').split('\n')) { if (!l.trim()) continue; try { fn(JSON.parse(l)) } catch { bad++ } }
    return bad
  }
  const append = (name, objs) => { if (objs.length) fs.appendFileSync(f(name), objs.map((o) => JSON.stringify(o)).join('\n') + '\n') }
  const writeAtomic = (name, obj) => { fs.writeFileSync(f(name + '.tmp'), JSON.stringify(obj)); fs.renameSync(f(name + '.tmp'), f(name)) }
  return {
    load(nowMs = Date.now()) {
      const mk = newMakerState()
      let bad = each('maker-replayed.jsonl', (x) => { mk.replayed[x.id] = x })
      bad += each('maker-markets.jsonl', (m) => { mk.markets[m.id] = m; mk.enrolled.add(m.id); if (!mk.firstEnrolledAt || m.enrolledAt < mk.firstEnrolledAt) mk.firstEnrolledAt = m.enrolledAt })
      bad += each('maker-cal.jsonl', (x) => { mk.cal[x.id] = { ...(mk.cal[x.id] ?? {}), ...x } })
      bad += each('maker-orders.jsonl', (o) => { if (!mk.replayed[o.id]) (mk.closed[o.id] ??= []).push(o); if (o.cross) mk.retired[`${o.id}:${o.side}`] = true })
      bad += each('maker-fills.jsonl', (x) => { mk.fills[`${x.world}|${x.id}`] = x })
      bad += each('maker-settles.jsonl', (x) => { if (mk.fills[x.key]) mk.fills[x.key].settle = x.settle })
      bad += each('maker-after.jsonl', (x) => { if (mk.fills[x.key]) mk.fills[x.key].after = x.after })
      if (fs.existsSync(f('maker-open.json'))) {
        const o = JSON.parse(fs.readFileSync(f('maker-open.json'), 'utf8'))
        mk.open = o.open ?? {}
        for (const [id, mark] of Object.entries(o.marks ?? {})) if (mk.markets[id]) mk.markets[id].mark = mark
        for (const x of o.needSize ?? []) mk.needSize.push(x)
      }
      if (fs.existsSync(f('maker-meta.json'))) {
        const meta = JSON.parse(fs.readFileSync(f('maker-meta.json'), 'utf8'))
        Object.assign(mk.stats, meta.stats ?? {}); mk.final = meta.final ?? null
        mk.stats.restarts = (mk.stats.restarts ?? 0) + 1
        // Downtime: from the last live round before the restart to now.
        if (mk.stats.lastReadAt && !mk.final) mk.stats.downMs = (mk.stats.downMs ?? 0) + Math.max(0, nowMs - Date.parse(mk.stats.lastReadAt) - MAKER.readMs)
      }
      // Replayed games with no fill are only counts now.
      for (const id of Object.keys(mk.markets)) if (mk.replayed[id] && !mk.fills[`trade|${id}:0`] && !mk.fills[`trade|${id}:1`] && !mk.fills[`touch|${id}:0`] && !mk.fills[`touch|${id}:1`]) delete mk.markets[id]
      if (bad) console.error(`maker storage: skipped ${bad} unreadable line(s)`)
      return mk
    },
    addMarkets: (list) => append('maker-markets.jsonl', list),
    addCal: (list) => append('maker-cal.jsonl', list),
    addAfter: (x) => append('maker-after.jsonl', [x]),
    addOrders: (list) => append('maker-orders.jsonl', list),
    addTrades: (id, trades) => append('maker-trades.jsonl', [{ id, trades: trades.map((t) => [t.ms, t.token, t.side, t.pmil, t.size, t.tx]) }]),
    addReplayed: (list) => append('maker-replayed.jsonl', list),
    addFills: (list) => append('maker-fills.jsonl', list.map(({ settle: _s, ...r }) => r)),
    addSettles: (list) => append('maker-settles.jsonl', list.map((r) => ({ key: `${r.world}|${r.id}`, settle: r.settle }))),
    saveOpen(mk) {
      const marks = {}
      for (const [id, m] of Object.entries(mk.markets)) if (m.mark && !mk.replayed[id]) marks[id] = m.mark
      writeAtomic('maker-open.json', { open: mk.open, marks, needSize: mk.needSize })
    },
    saveMeta(mk) { writeAtomic('maker-meta.json', { stats: mk.stats, final: mk.final }) },
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

/** Enrols every eligible game first seen 22–26h before kickoff. Returns what was listed, for the feed check. */
export async function enroll(mk, io, nowMs, index) {
  const list = await listWindow(io.getJson, nowMs, MAKER.enrollMinH, MAKER.enrollMaxH)
  const added = []
  mk.stats.skipped ??= {}
  mk.seen ??= new Set()   // counts each skipped market once per run
  for (const m of list) {
    if (mk.enrolled.has(String(m.id)) || mk.markets[m.id] || mk.replayed[m.id]) continue
    const why = ineligible(m, nowMs)
    if (why) {
      if (why !== 'outside the window' && armOf(m) && !mk.seen.has(m.id)) { mk.seen.add(m.id); mk.stats.skipped[why] = (mk.stats.skipped[why] ?? 0) + 1 }
      continue
    }
    const r = enrollRecord(m, nowMs, tagsOf(m, index), matchKeyOf(m))
    if (r) added.push(r)
  }
  io.store.addMarkets(added)   // written first: a market in memory is always on disk
  for (const r of added) { mk.markets[r.id] = r; mk.enrolled.add(r.id); if (!mk.firstEnrolledAt) mk.firstEnrolledAt = r.enrolledAt }
  return { added: added.length, list }
}

/**
 * Best bid and ask of outcome 0 for each game, 250 per request, in shuffled batches. A failed
 * batch is retried in halves down to single games; a game still unread is counted, and its
 * order simply rests on until the next read. Returns id → { bm, am, tau }.
 */
export async function readPrices(mk, io, ids) {
  const out = new Map(), byToken = new Map()
  for (const id of ids) byToken.set(mk.markets[id].tokens[0], id)
  const tokens = [...byToken.keys()]
  for (let i = tokens.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tokens[i], tokens[j]] = [tokens[j], tokens[i]] }
  const clock = io.clock ?? Date.now
  const read = async (chunk) => {
    const sent = clock()
    try {
      const res = await io.postJson('https://clob.polymarket.com/prices', chunk.flatMap((t) => [{ token_id: t, side: 'BUY' }, { token_id: t, side: 'SELL' }]))
      const tau = Math.round((sent + clock()) / 2)   // the book as of the middle of the request
      for (const t of chunk) {
        if (res?.[t]) out.set(byToken.get(t), { ...readOf(res[t]), tau })
        else mk.stats.unread = (mk.stats.unread ?? 0) + 1
      }
      mk.stats.reads += chunk.length
    } catch (e) {
      mk.stats.readFails++
      if (chunk.length > 1) { const h = Math.ceil(chunk.length / 2); await read(chunk.slice(0, h)); await read(chunk.slice(h)) }
      else { mk.stats.unread = (mk.stats.unread ?? 0) + 1; io.log?.('maker prices', e.message) }
    }
  }
  for (let i = 0; i < tokens.length; i += 250) await read(tokens.slice(i, i + 250))
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
 * One live round (every minute): enrol (every 15 minutes), read prices for games with
 * orders (every round) and the rest (every 5 minutes), record evidence, re-price, end
 * orders at kickoff. Orders that end are written to disk at once.
 */
export async function liveRound(mk, io, nowMs, { index = null, enrollNow = false } = {}) {
  if (mk.final) return { done: true }
  let enrolled = 0
  if (enrollNow) {
    try { enrolled = (await enroll(mk, io, nowMs, index)).added } catch (e) { mk.stats.enrollFails = (mk.stats.enrollFails ?? 0) + 1; io.log?.('maker enrol', e.message) }
  }
  const ended = []
  closeAtKickoff(mk, nowMs, (o) => ended.push(o))
  // Each game's last midpoint before kickoff, kept for the markout and the calibration correction.
  const marks = []
  for (const [id, m] of Object.entries(mk.markets)) {
    if (mk.cal[id] || Date.parse(m.kickoff) > nowMs) continue
    mk.cal[id] = { id, mid: m.mark?.mid ?? null, at: m.mark ? new Date(m.mark.at).toISOString() : null, kickoff: m.kickoff }
    marks.push(mk.cal[id])
  }
  io.store.addCal(marks)
  const ids = Object.entries(mk.markets).filter(([id, m]) => Date.parse(m.kickoff) > nowMs && !mk.replayed[id]
    && (m.active || mk.open[`${id}:0`] || mk.open[`${id}:1`] || !m.lastRead || nowMs - m.lastRead >= MAKER.idleReadMs - 5000)).map(([id]) => id)
  const reads = await readPrices(mk, io, ids)
  for (const [id, r] of reads) applyRead(mk, id, r.bm, r.am, r.tau, (o) => ended.push(o))
  await sizeCrossings(mk, io)
  io.store.addOrders(ended)
  io.store.saveOpen(mk)
  mk.stats.lastReadAt = new Date(nowMs).toISOString()
  return { enrolled, read: reads.size, of: ids.length, resting: Object.keys(mk.open).length, ended: ended.length }
}

/**
 * Every taker trade of the given games in [start, end], paged to the end. Anything that
 * could silently mean "no trades" is an error instead: a reply without data, has_more
 * without a cursor, a full page with no way to page on, a trade from a game not asked for.
 * Identical records are dropped only when they repeat across pages.
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
    else if (body.pagination?.has_more) { if (!body.pagination.next_cursor) throw new Error('has_more without a cursor'); cursor = body.pagination.next_cursor }
    else cursor = null
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
 * Reads the trades of every game whose kickoff was at least two hours ago and replays its
 * orders. 20 games per request; a failing request is split in halves down to single games;
 * a game is tried again next time, and is void if still unreadable a day after kickoff.
 * 5% of replayed games are read again a day later, and any difference is counted.
 */
export async function replayDue(mk, io, nowMs) {
  const due = Object.values(mk.markets).filter((m) => !mk.replayed[m.id] && Date.parse(m.kickoff) + MAKER.tradesAfterMs <= nowMs)
  const fills = [], done = []
  for (const m of due.filter((x) => !(mk.closed[x.id] ?? []).length)) { mk.replayed[m.id] = { id: m.id, at: new Date(nowMs).toISOString(), status: 'no orders' }; done.push(mk.replayed[m.id]) }
  const todo = due.filter((x) => (mk.closed[x.id] ?? []).length)
  const water = todo.length ? await feedWatermark(io) : null
  const ready = todo.filter((m) => water === null || water >= Date.parse(m.kickoff) + 30 * 60_000)
  if (water !== null) mk.stats.feedWatermark = new Date(water).toISOString()
  const replay = (m, trades) => {
    const r = replayGame(m, mk.closed[m.id], trades)
    const add = []
    for (const w of WORLDS) for (const f of r[w]) add.push({ ...f, ruleVersion: RULE_VERSION, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null })
    io.store.addTrades(m.id, trades)
    io.store.addFills(add)   // written first: a fill in memory is always on disk
    for (const f of add) { mk.fills[`${f.world}|${f.id}`] = f; fills.push(f); if (f.world === 'trade') bumpDay(mk, Date.parse(f.filledAt), 'fills') }
    mk.replayed[m.id] = { id: m.id, at: new Date(nowMs).toISOString(), status: 'ok', trades: trades.length, orders: mk.closed[m.id].length }
    if (Math.random() < 0.05) mk.replayed[m.id].auditAt = nowMs + DAY_MS
    done.push(mk.replayed[m.id])
    if (!mk.replayed[m.id].auditAt) delete mk.closed[m.id]
  }
  const attempt = async (group) => {
    const start = Math.min(...group.map((m) => Math.min(...mk.closed[m.id].map((o) => o.from)))) - MAKER.lagMs
    const end = Math.max(...group.map((m) => Date.parse(m.kickoff))) + MAKER.lagMs
    try {
      const got = await fetchTrades(io, mk, group.map((m) => m.cid), start, end)
      mk.stats.tradesRead += got.length; mk.stats.lastTradesOkAt = new Date().toISOString()
      for (const m of group) replay(m, got.filter((t) => t.cid === String(m.cid).toLowerCase()))
    } catch (e) {
      mk.stats.tradeFails++; mk.stats.lastTradesError = `${new Date().toISOString()} ${e.message}`.slice(0, 200); io.log?.('maker trades', e.message)
      if (group.length > 1) { const h = Math.ceil(group.length / 2); await attempt(group.slice(0, h)); await attempt(group.slice(h)); return }
      const m = group[0]
      if (nowMs - Date.parse(m.kickoff) > MAKER.giveUpMs) {
        mk.replayed[m.id] = { id: m.id, at: new Date(nowMs).toISOString(), status: 'void', orders: mk.closed[m.id].length }
        done.push(mk.replayed[m.id]); mk.stats.voidGames++; delete mk.closed[m.id]
      }
    }
  }
  for (let i = 0; i < ready.length; i += 20) await attempt(ready.slice(i, i + 20))
  // The re-read audit: the same game, a day later. Fills are not changed; differences are counted.
  for (const r of Object.values(mk.replayed)) {
    if (!r.auditAt || r.auditAt > nowMs || r.audited) continue
    const m = mk.markets[r.id]
    if (!m || !mk.closed[r.id]) { r.audited = 'skipped'; continue }
    try {
      const got = await fetchTrades(io, mk, [m.cid], Math.min(...mk.closed[r.id].map((o) => o.from)) - MAKER.lagMs, Date.parse(m.kickoff) + MAKER.lagMs)
      const again = replayGame(m, mk.closed[r.id], got)
      const before = WORLDS.flatMap((w) => [0, 1].map((side) => mk.fills[`${w}|${r.id}:${side}`]?.shares ?? 0)).join(',')
      const after = WORLDS.flatMap((w) => [0, 1].map((side) => again[w].find((f) => f.side === side)?.shares ?? 0)).join(',')
      mk.stats.audit ??= { games: 0, changed: 0, tradesBefore: 0, tradesAfter: 0 }
      mk.stats.audit.games++; mk.stats.audit.tradesBefore += r.trades ?? 0; mk.stats.audit.tradesAfter += got.length
      if (before !== after) mk.stats.audit.changed++
      r.audited = before === after ? 'same' : 'changed'
      done.push({ ...r })
    } catch { continue }
    delete mk.closed[r.id]
  }
  io.store.addReplayed(done)
  return { replayed: done.length, fills: fills.length, waiting: todo.length - ready.length }
}

/** Refreshes kickoff and status of games still before kickoff (Gamma, 50 per request). */
export async function refreshGames(mk, io, nowMs) {
  const ids = Object.values(mk.markets).filter((m) => !m.stopped && Date.parse(m.kickoff) > nowMs && (m.active || mk.open[`${m.id}:0`] || mk.open[`${m.id}:1`])).map((m) => m.id)
  let n = 0
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      for (const closed of ['false', 'true']) {
        const q = new URLSearchParams({ closed, limit: '100' })
        for (const id of chunk) q.append('id', id)
        const list = await io.getJson('https://gamma-api.polymarket.com/markets?' + q)
        for (const g of Array.isArray(list) ? list : []) { const m = mk.markets[String(g.id)]; if (m) { refreshGame(m, g, nowMs); n++ } }
      }
    } catch (e) { mk.stats.refreshFails = (mk.stats.refreshFails ?? 0) + 1; io.log?.('maker refresh', e.message) }
  }
  return n
}

/** Results for the calibration correction: every enrolled game that had a two-sided book. */
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
        if (s) { c.r0 = s.yesPrice; done.push({ id: c.id, r0: c.r0 }) }
      }
    } catch (e) { mk.stats.calFails = (mk.stats.calFails ?? 0) + 1; io.log?.('maker cal', e.message) }
  }
  io.store.addCal(done)
  return done.length
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
  return done.length
}

/**
 * Polymarket's own minute price 1, 15 and 60 minutes after each fill (reported, not deciding):
 * how fast the market moved against or with our fills. Up to 200 fills per call of this.
 */
export async function markFills(mk, io, nowMs) {
  const due = Object.values(mk.fills).filter((f) => f.world === 'trade' && !f.after && (f._afterTries ?? 0) < 3 && Date.parse(f.filledAt) + 61 * 60_000 <= nowMs).slice(0, 200)
  const done = []
  for (const f of due) {
    f._afterTries = (f._afterTries ?? 0) + 1
    const t = Math.floor(Date.parse(f.filledAt) / 1000)
    try {
      const body = await io.getJson(`https://clob.polymarket.com/prices-history?market=${f.token}&startTs=${t - 60}&endTs=${t + 3660}&fidelity=1`)
      const pts = (body?.history ?? []).map((x) => ({ t: +x.t, p: +x.p })).filter((x) => Number.isFinite(x.p)).sort((a, b) => a.t - b.t)
      const at = (s) => { let v = null; for (const x of pts) if (x.t <= t + s) v = x.p; return v }
      const after = { m1: at(60), m15: at(900), m60: at(3600) }
      io.store.addAfter({ key: `${f.world}|${f.id}`, after })
      f.after = after; done.push(f)
    } catch (e) { io.log?.('maker after', e.message) }
  }
  return done.length
}

/** Drops games that are replayed and filled nothing. */
export function pruneMarkets(mk) {
  for (const id of Object.keys(mk.markets)) if (mk.replayed[id] && !WORLDS.some((w) => mk.fills[`${w}|${id}:0`] || mk.fills[`${w}|${id}:1`])) delete mk.markets[id]
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
export function makerDashboard(mk, nowMs, { sport = null, type = null } = {}) {
  const final = mk.final
  const live = makerSummary(mk, nowMs)
  const { settledIds, ...frozen } = final ?? {}
  const s = final ? { ...frozen, stats: mk.stats } : live
  const counted = new Set(final ? settledIds : Object.values(mk.fills).filter((f) => f.settle).map((f) => `${f.world}|${f.id}`))
  const okTags = (x) => (!sport || (x.sport ?? 'Untagged') === sport) && (!type || (x.type ?? 'Untagged') === type)
  const trade = fillsOf(mk, 'trade'), tradeView = trade.filter(okTags)
  const touchKeys = new Set(fillsOf(mk, 'touch').map((f) => f.id))
  const row = (f) => ({
    id: f.id, question: f.question, outcome: f.outcome, sport: f.sport, league: f.league, type: f.type, price: f.price, shares: f.shares, cost: f.cost,
    bid: f.bid, ask: f.ask, source: f.source, filledAt: f.filledAt, endDate: f.kickoff, mark: f.mark,
    status: f.settle ? 'settled' : isStale(f, nowMs) ? 'stale' : 'waiting',
    ...(f.settle && counted.has(`${f.world}|${f.id}`) ? { resolved: f.settle.yesPrice, pnl: f.settle.pnl, counted: true } : {}),
  })
  const resting = []
  for (const o of Object.values(mk.open)) {
    const m = mk.markets[o.id]
    if (!m || !okTags(m)) continue
    resting.push({ question: m.question, outcome: m.outcomes[o.side], sport: m.sport, league: m.league, type: m.type, price: o.price, shares: o.shares, bid: o.bid, ask: o.ask, endDate: m.kickoff, since: new Date(o.from).toISOString(), touched: o.touch !== null })
  }
  resting.sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate))
  const games = Object.values(mk.markets).filter(okTags)
  const perDay = Object.entries(mk.stats.byDay).map(([d, v]) => ({ day: d, orders: v.orders ?? 0, fills: v.fills ?? 0, settled: v.settled ?? 0 })).sort((a, b) => a.day.localeCompare(b.day)).slice(-35)
  const priceBins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0 }))
  for (const f of tradeView) priceBins[Math.min(9, Math.floor(f.price * 10))].n++
  let viewResult = null
  if (sport || type) {
    const list = tradeView.filter((f) => f.settle && counted.has(`trade|${f.id}`))
    const r = list.length ? profitPerDollar(list, { iters: 1000 }) : null
    viewResult = r ? { result: r, hitRate: list.filter((f) => f.settle.yesPrice === 1).length / list.length, avgPrice: list.reduce((a, f) => a + f.price, 0) / list.length } : null
  }
  const first = mk.firstEnrolledAt ? Date.parse(mk.firstEnrolledAt) : null
  let eta = null
  if (first !== null) {
    // Matches with a settled fill arrive about a day after orders start; the rate so far estimates the rest.
    const n = s.matches ?? 0, rate = n / Math.max(nowMs - first - DAY_MS, 3600_000)
    const tN = n >= MAKER.stopMatches ? nowMs : rate > 0 ? nowMs + (MAKER.stopMatches - n) / rate : Infinity
    eta = new Date(Math.min(first + MAKER.stopDays * DAY_MS, Math.max(first + MAKER.minDays * DAY_MS, tN))).toISOString()
  }
  const kinds = (key) => { const c = new Map(); for (const m of Object.values(mk.markets)) c.set(m[key] ?? 'Untagged', (c.get(m[key] ?? 'Untagged') ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, bets: n })) }
  return {
    kind: 'maker', arm: 'C', armInfo: MAKER_INFO, filter: { sport, type }, ...s, done: Boolean(final), running: !final, finishing: !final && live.done,
    rule: { stakeUsd: MAKER.stakeUsd, readMin: MAKER.readMs / 60_000, stopMatches: MAKER.stopMatches, minDays: MAKER.minDays, stopDays: MAKER.stopDays, tradesAfterH: MAKER.tradesAfterMs / 3600_000, ruleVersion: RULE_VERSION },
    view: {
      upcomingGames: games.filter((m) => Date.parse(m.kickoff) > nowMs).length,
      quotingGames: new Set(Object.values(mk.open).filter((o) => mk.markets[o.id] && okTags(mk.markets[o.id])).map((o) => o.id)).size,
      ordersNow: resting.length,
      checking: games.filter((m) => Date.parse(m.kickoff) <= nowMs && !mk.replayed[m.id]).length,
      fills: tradeView.length, touchFills: fillsOf(mk, 'touch').filter(okTags).length,
      settled: tradeView.filter((f) => f.settle).length, waiting: tradeView.filter((f) => !f.settle && !isStale(f, nowMs)).length,
      replayed: Object.keys(mk.replayed).length,
    },
    sports: kinds('sport'), types: kinds('type'),
    resting: resting.slice(0, 40), restingTotal: resting.length,
    latest: [...tradeView].sort((a, b) => Date.parse(b.filledAt) - Date.parse(a.filledAt)).slice(0, 40).map((f) => ({ ...row(f), touchToo: touchKeys.has(f.id) })),
    upcoming: tradeView.filter((f) => !f.settle && !isStale(f, nowMs)).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).slice(0, 40).map(row),
    results: tradeView.filter((f) => f.settle && counted.has(`trade|${f.id}`)).sort((a, b) => Date.parse(b.settle.settledAt) - Date.parse(a.settle.settledAt)).slice(0, 40).map(row),
    bySport: sliceTable(trade.filter((f) => !type || (f.type ?? 'Untagged') === type), 'sport', counted),
    byType: sliceTable(trade.filter((f) => !sport || (f.sport ?? 'Untagged') === sport), 'type', counted),
    perDay, priceBins, viewResult, eta, generatedAt: new Date(nowMs).toISOString(),
    firstRecordAt: mk.firstEnrolledAt, lastScanAt: mk.stats.lastReadAt, scanEveryMin: MAKER.readMs / 60_000,
  }
}

/** Every fill (both rules, with settlement), the replay log and the counters, for offline evaluation. */
export function makerExportLines(mk, nowMs) {
  return [
    { kind: 'maker-meta', exportedAt: new Date(nowMs).toISOString(), rule: MAKER, ruleVersion: RULE_VERSION, firstEnrolledAt: mk.firstEnrolledAt, stats: mk.stats, final: mk.final,
      calibration: calibrationTable(Object.values(mk.cal ?? {})).table },
    ...Object.values(mk.fills).map(({ _afterTries, ...f }) => ({ kind: 'fill', ...f })),
    ...Object.values(mk.replayed).map((r) => ({ kind: 'replayed', ...r })),
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
