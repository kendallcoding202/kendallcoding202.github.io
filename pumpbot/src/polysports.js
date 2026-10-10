/**
 * Forward paper tests of cheap Polymarket sports contracts.
 *
 *   Test A — PREREG-POLY-SPORTS.md: buy YES at 2–20¢ on Yes/No sports markets.
 *   Test B — PREREG-POLY-SPORTS-B.md: buy the cheap side, 2–20¢, of two-outcome sports
 *            markets (over/under, spread, team vs team).
 *
 *   node src/polysports.js run       scanner + settlement + dashboard (PORT)
 *   node src/polysports.js summary   print each test's state from DATA_DIR
 *
 * No orders are ever placed. Every "bet" is a record of what a $2 taker order would have
 * paid against the real book at that moment, settled later on the real resolution.
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- the registered rules
export const RULE = {
  stakeUsd: 2,
  minPrice: 0.02,
  maxPrice: 0.20,
  windowMinH: 22,
  windowMaxH: 26,
  stopBets: 400,
  minDays: 7,       // amendment 1: at least a full week of fixtures, whatever the count
  stopDays: 28,
  unsettledAfterDays: 14,
}
export const ARMS = ['A', 'B']             // the registered tests: each has a stop and a verdict
export const ALL_ARMS = ['A', 'B', 'W']    // plus the watch list, which has neither
/** Sports the watch list follows. Change with POLY_WATCH_SPORTS="Hockey,College football". */
export const WATCH_SPORTS = (process.env.POLY_WATCH_SPORTS ?? 'Hockey,College football').split(',').map((x) => x.trim()).filter(Boolean)
export const WATCH_WINDOW_H = [0.25, 22]   // kickoff too soon for the tests' 22–26h window
export const ARM_INFO = {
  A: { name: 'Test A · Yes/No', blurb: 'Always bets YES, at 2–20¢, on Yes/No sports markets — mostly soccer (exact scores, who wins), plus baseball, golf and others.', prereg: 'PREREG-POLY-SPORTS.md' },
  B: { name: 'Test B · Two-way', blurb: 'Bets the cheaper side, at 2–20¢, of two-way markets: Over or Under a line, a team to cover a spread, or a team to win.', prereg: 'PREREG-POLY-SPORTS-B.md' },
  W: { name: 'Watch · soon', blurb: 'Games kicking off too soon for the tests (hockey and college football): the same 2–20¢ rule at the same real prices and fees, with wins and losses shown as they come in. Not part of either test.', prereg: 'PREREG-POLY-SPORTS-B.md, Watch list' },
}
const SCAN_MS = 15 * 60_000
const SETTLE_MS = 60 * 60_000
const INDEX_MS = 24 * 3600_000
const DAY_MS = 86400_000

// ---------------------------------------------------------------- pure functions (tested)
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x))

/** Asks sorted cheapest first, as numbers. The CLOB returns them in no order we rely on. */
export function sortedAsks(book) {
  return (book?.asks ?? []).map((a) => ({ price: +a.price, size: +a.size })).filter((a) => a.price > 0 && a.size > 0).sort((a, b) => a.price - b.price)
}
export function bestBid(book) {
  let best = null
  for (const x of book?.bids ?? []) { const p = +x.price; if (p > 0 && (best === null || p > best)) best = p }
  return best
}

/** Walk `dollars` through the asks. Returns shares bought, dollars spent, average price. */
export function walkAsks(asks, dollars) {
  let left = dollars, shares = 0
  for (const a of asks) {
    if (left <= 1e-9) break
    const take = Math.min(a.size, left / a.price)
    shares += take
    left -= take * a.price
  }
  const spent = dollars - left
  return { shares, spent, avgPrice: shares > 0 ? spent / shares : null, filled: left <= 1e-6 }
}

/**
 * Polymarket's taker fee: shares × rate × (p(1 − p))^exponent, in USDC, on top of the cost.
 *
 * This is the function in Polymarket's own clients (@polymarket/clob-client-v2 1.2.0,
 * src/fees: platformFee = amount/price × feeRate × (p(1−p))^feeExponent; py_clob_client_v2
 * fees.py the same), fed by the market's fd.r / fd.e — which equal Gamma's feeSchedule.
 * The docs' table agrees: 100 shares at 10¢, rate 0.07 → $0.63. The first version had an
 * extra leading × p (an older crypto-only form), which understated sports fees 5–33× in
 * the 2–20¢ band: the real fee there is about 4–5% of the stake, not 0.2–0.7%.
 */
export const FEE_VERSION = 2
export function takerFee(feeSchedule, price, shares) {
  if (!feeSchedule || !(price > 0)) return 0
  const rate = Number(feeSchedule.rate ?? 0), exp = Number(feeSchedule.exponent ?? 1)
  return shares * rate * (price * (1 - price)) ** exp
}

/**
 * Brings a record recorded under the first fee formula onto the corrected one. That
 * formula was exactly the correct fee × p, so dividing by the fill price recovers it for
 * any rate or exponent, without needing the schedule. A settled record's cost and profit
 * are recomputed from the corrected fee. Idempotent: records carry feeVersion once fixed.
 */
export function correctFee(r) {
  if (r.feeVersion === FEE_VERSION) return r
  const p = r.fill?.avgPrice
  if (p > 0 && Number.isFinite(r.fee)) r.fee = r.fee / p
  r.feeVersion = FEE_VERSION
  if (r.settle) { r.settle.cost = r.fill.spent + r.fee; r.settle.pnl = r.settle.payout - r.settle.cost }
  return r
}

export function outcomesOf(m) {
  try { const o = JSON.parse(m.outcomes ?? '[]'); return Array.isArray(o) ? o.map(String) : [] } catch { return [] }
}

/** Which test a market belongs to: A for Yes/No, B for any other two-outcome market. */
export function armOf(m) {
  if (!String(m.feeType ?? '').startsWith('sports')) return null
  if (m.enableOrderBook === false || m.closed) return null
  const o = outcomesOf(m)
  if (o.length !== 2) return null
  return o[0] === 'Yes' && o[1] === 'No' ? 'A' : 'B'
}

/**
 * Which list a market goes to now, or null. The tests take markets 22–26h before kickoff.
 * The watch list takes markets of its sports kicking off sooner than that — in practice the
 * day's games the tests never saw, since every later game passes through the tests' window
 * first (and a market is only ever recorded once).
 */
export function armFor(m, nowMs, arms = ARMS, index = null) {
  const kind = armOf(m)
  if (!kind) return null
  const h = (Date.parse(m.endDate) - nowMs) / 3600_000
  if (h >= RULE.windowMinH && h < RULE.windowMaxH) return arms.includes(kind) ? kind : null
  if (arms.includes('W') && h >= WATCH_WINDOW_H[0] && h < WATCH_WINDOW_H[1] && WATCH_SPORTS.includes(tagsOf(m, index).sport)) return 'W'
  return null
}
export function isCandidate(m, nowMs, arms = ARMS, index = null) { return armFor(m, nowMs, arms, index) !== null }

/** The first version filed college football and the NFL together; split them by league. */
export function refineSport(r) {
  if (r.sport === 'American football' && r.league === 'College Football') r.sport = 'College football'
  else if (r.sport === 'American football' && r.league === 'NFL') r.sport = 'NFL'
  return r
}

// ---------------------------------------------------------------- sport and bet type
/**
 * Polymarket has no single "sport" field. Each league in its /sports directory carries tag
 * ids, and these tags name the sport; the big US leagues carry none, so they are mapped by
 * league code. Markets reach a league through their event's series id.
 */
export const SPORT_TAGS = {
  100350: 'Soccer', 517: 'Cricket', 28: 'Basketball', 102883: 'Volleyball', 64: 'Esports',
  103767: 'Table tennis', 105715: 'Table tennis', 102193: 'Rugby', 100088: 'Hockey', 899: 'Hockey',
  678: 'Baseball', 102897: 'Handball', 864: 'Tennis', 101232: 'Tennis', 102123: 'Tennis', 100219: 'Golf',
  102393: 'Lacrosse', 102166: 'Motorsport', 434: 'Motorsport', 101437: 'Darts', 1186: 'American football',
  102471: 'Pickleball', 683: 'Combat sports',
}
export const SPORT_CODES = {
  nfl: 'NFL', cfb: 'College football', nba: 'Basketball', wnba: 'Basketball', nbasl: 'Basketball',
  ncaab: 'Basketball', cbb: 'Basketball', euroleague: 'Basketball', mlb: 'Baseball', wbc: 'Baseball',
  ufc: 'Combat sports', powerslap: 'Combat sports', f1: 'Motorsport', indycar: 'Motorsport', acn: 'Soccer',
  afl: 'Australian football', aflw: 'Australian football', chess: 'Chess', poker: 'Poker', rodeo: 'Rodeo', cycling: 'Cycling',
}
export function sportsIndex(list) {
  const ix = new Map()
  for (const x of Array.isArray(list) ? list : []) {
    const tags = String(x.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    const sport = tags.map((t) => SPORT_TAGS[t]).find(Boolean) ?? SPORT_CODES[x.sport] ?? 'Other'
    for (const sid of String(x.series ?? '').split(',').map((s) => s.trim()).filter(Boolean)) ix.set(sid, { sport, league: x.name ?? x.sport })
  }
  return ix
}

/** Bet types grouped the way a bettor reads them. Order matters: corners before totals. */
const BET_TYPES = [
  [/corner/, 'Corners'],
  [/team_total/, 'Team total O/U'],
  [/totals?$/, 'Over/under'],
  [/spread/, 'Spread'],
  [/^moneyline$/, 'Moneyline'],
  [/exact_score/, 'Exact score'],
  [/halftime_result|second_half_result/, 'Half result'],
  [/first_to_score/, 'First to score'],
  [/both_teams_to_score/, 'Both teams to score'],
  [/prop|player/, 'Player prop'],
]
export function betTypeOf(raw) {
  if (!raw) return 'Other'
  for (const [re, label] of BET_TYPES) if (re.test(raw)) return label
  return 'Other'
}

export function tagsOf(m, index) {
  const ev = m.events?.[0] ?? {}, series = ev.series?.[0] ?? {}
  const seriesId = series.id !== undefined && series.id !== null ? String(series.id) : null
  const hit = seriesId && index ? index.get(seriesId) : null
  return {
    seriesId,
    sport: hit?.sport ?? (index ? 'Other' : null),   // null = directory not read yet; tagged later
    league: hit?.league ?? series.title ?? ev.seriesSlug ?? null,
    type: betTypeOf(m.sportsMarketType),
    typeRaw: m.sportsMarketType ?? null,
  }
}

/**
 * The match a market belongs to — the unit the bootstrap resamples (amendment 1).
 * Polymarket splits one match into several events (result, halftime, exact score, total
 * corners, …), so the event id is NOT the match. Event titles share the match's name before
 * " - " ("Rizespor vs. Fenerbahçe SK - Total Corners"), and with the event date that names
 * the match exactly: checked on a live window, every gameId mapped to one such key and no
 * key to two gameIds, including events that carry no gameId at all.
 */
export function matchKeyOf(m) {
  const ev = m.events?.[0] ?? {}
  const title = String(ev.title ?? m.question ?? m.id).split(' - ')[0].trim().toLowerCase()
  const day = String(ev.eventDate ?? m.gameStartTime ?? m.endDate ?? '').slice(0, 10)
  return `${title}|${day}`
}

// ---------------------------------------------------------------- decide and settle
/**
 * The registered decision for one market. Test A reads the YES book and buys YES. Test B
 * reads both books and buys the side whose $2 fill is cheaper. `books` is one book (A) or
 * one per outcome (B). Records that are not bets keep only what calibration needs.
 */
export function decide(m, books, nowMs, index = null, arm = armOf(m) ?? 'A') {
  // Which side is bought depends on the market's shape, whichever list records it:
  // YES on a Yes/No market, the cheaper side of any other two-outcome market.
  const kind = armOf(m) ?? 'A'
  const list = Array.isArray(books) ? books : [books]
  const sides = list.map((book, i) => { const asks = sortedAsks(book); return { i, book, asks, fill: walkAsks(asks, RULE.stakeUsd) } })
  let pick = sides[0]
  if (kind === 'B' && sides.length > 1) {
    const priceOf = (s) => (s.fill.filled ? s.fill.avgPrice : Infinity)
    pick = sides.reduce((a, b) => (priceOf(b) < priceOf(a) ? b : a))
    if (!Number.isFinite(priceOf(pick))) pick = sides.reduce((a, b) => ((b.asks[0]?.price ?? Infinity) < (a.asks[0]?.price ?? Infinity) ? b : a))
  }
  const fill = pick.fill
  const fee = fill.avgPrice ? takerFee(m.feeSchedule, fill.avgPrice, fill.shares) : 0
  const rule = fill.filled && fill.avgPrice >= RULE.minPrice && fill.avgPrice <= RULE.maxPrice
  const outs = outcomesOf(m)
  const base = {
    id: String(m.id), arm, side: pick.i, outcome: outs[pick.i] ?? null, event: String(m.events?.[0]?.id ?? m.id), game: matchKeyOf(m),
    endDate: m.endDate, recordedAt: new Date(nowMs).toISOString(), ...tagsOf(m, index),
    fill: { shares: fill.shares, spent: fill.spent, avgPrice: fill.avgPrice, filled: fill.filled }, fee, rule,
    // The market's own schedule, kept so the fee can be recomputed if the formula is ever revised.
    feeRate: m.feeSchedule?.rate ?? null, feeExp: m.feeSchedule?.exponent ?? null, feeVersion: FEE_VERSION,
    bestAsk: pick.asks[0]?.price ?? null,
  }
  if (!rule) return base
  // Gamma's lastTradePrice is the first outcome's; the second side's is its complement.
  const lt = num(m.lastTradePrice)
  return {
    ...base, question: m.question, token: JSON.parse(m.clobTokenIds)[pick.i], bestBid: bestBid(pick.book),
    askDepthUsd: pick.asks.reduce((s, a) => s + a.price * a.size, 0),
    lastTrade: lt === null ? null : pick.i === 0 ? lt : 1 - lt, volumeAtDecision: num(m.volumeNum) ?? 0,
  }
}

/** Settle from Gamma's market object. null while unresolved. `yesPrice` is the resolution price of the side bought. */
export function settle(rec, m) {
  if (!m?.closed) return null
  let op
  try { op = JSON.parse(m.outcomePrices ?? '[]').map(Number) } catch { return null }
  if (op.length !== 2 || op.some((x) => !Number.isFinite(x))) return null
  if (op[0] + op[1] < 0.99) return null           // not resolved yet
  const p = op[rec.side ?? 0]
  const payout = rec.fill.shares * p
  const cost = rec.fill.spent + rec.fee
  return { yesPrice: p, payout, cost, pnl: payout - cost, finalVolume: num(m.volumeNum) ?? 0, settledAt: new Date().toISOString() }
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/**
 * Profit per dollar staked, with a bootstrap over EVENTS (amendment 1): contracts on the
 * same match are linked — the home win, away win and draw cannot all pay — so the match,
 * not the contract, is the unit that is resampled.
 */
export function profitPerDollar(bets, { slip = 0, iters = 4000 } = {}) {
  if (!bets.length) return null
  const rows = bets.map((b) => {
    const extra = slip * b.fill.shares   // optional slip: the same shares bought `slip` dearer
    return { cluster: b.game ?? b.event ?? b.id, pnl: b.settle.pnl - extra, cost: b.settle.cost + extra }
  })
  const by = new Map()
  for (const r of rows) { if (!by.has(r.cluster)) by.set(r.cluster, []); by.get(r.cluster).push(r) }
  const groups = [...by.values()], rnd = mulberry32(777), out = []
  for (let k = 0; k < iters; k++) {
    let p = 0, c = 0
    for (let j = 0; j < groups.length; j++) for (const r of groups[Math.floor(rnd() * groups.length)]) { p += r.pnl; c += r.cost }
    out.push(p / c)
  }
  out.sort((a, b) => a - b)
  const pnl = rows.reduce((s, r) => s + r.pnl, 0), cost = rows.reduce((s, r) => s + r.cost, 0)
  return { n: rows.length, events: groups.length, pnl, cost, perDollar: pnl / cost, lo: out[Math.floor(iters * 0.025)], hi: out[Math.floor(iters * 0.975)] }
}

/**
 * Earliest record time. A loop, not Math.min(...all): spreading ~120k records (about
 * 20 days of scanning) into one call exceeds V8's argument limit and throws.
 */
export function firstRecordMs(recs) {
  let first = Infinity
  for (const r of recs) { const t = Date.parse(r.recordedAt); if (t < first) first = t }
  return Number.isFinite(first) ? first : null
}

export const armRecords = (state, arm) => Object.values(state.records).filter((r) => (r.arm ?? 'A') === arm)
const isStale = (r, nowMs) => nowMs - Date.parse(r.endDate) > RULE.unsettledAfterDays * DAY_MS

export function summarise(state, nowMs = Date.now(), { arm = 'A', reveal = false, withhold = false } = {}) {
  const recs = armRecords(state, arm)
  const rule = recs.filter((r) => r.rule)
  const settled = rule.filter((r) => r.settle)
  const first = firstRecordMs(recs)
  const days = first ? (nowMs - first) / DAY_MS : 0
  const stale = rule.filter((r) => !r.settle && isStale(r, nowMs)).length
  const done = (settled.length >= RULE.stopBets && days >= RULE.minDays) || days >= RULE.stopDays
  const s = {
    arm, recorded: recs.length, ruleBets: rule.length, settled: settled.length, unsettledStale: stale,
    days: +days.toFixed(1), stop: `${RULE.stopBets} settled bets and ${RULE.minDays} days, or ${RULE.stopDays} days`, done,
    lastScanAt: state.lastScanAt ?? null, lastSettleAt: state.lastSettleAt ?? null, errors: state.errors ?? 0,
  }
  if (withhold || !(done || reveal)) return s   // withhold: counts only, whatever the stop says
  return { ...s, ...outcomeSummary(settled, recs) }
}

/** Everything that depends on outcomes, for a set of settled rule bets. */
function outcomeSummary(settled, recs, { iters = 4000 } = {}) {
  const gap = settled.filter((r) => r.lastTrade !== null && r.lastTrade !== undefined && r.bestAsk !== null).map((r) => r.bestAsk - r.lastTrade)
  const result = profitPerDollar(settled, { iters })
  return {
    result,
    withSlip1c: profitPerDollar(settled, { slip: 0.01, iters }),
    hitRate: settled.length ? settled.filter((r) => r.settle.yesPrice === 1).length / settled.length : null,
    avgFill: settled.length ? settled.reduce((a, r) => a + r.fill.avgPrice, 0) / settled.length : null,
    askMinusLastTrade: gap.length ? gap.reduce((a, b) => a + b, 0) / gap.length : null,
    finalVolume1k: profitPerDollar(settled.filter((r) => r.settle.finalVolume >= 1000), { iters }),
    verdict: result && result.lo > 0 ? 'YES — profitable at real asks' : 'NO — not profitable at real asks',
    calibration: recs ? calibration(recs) : undefined,
  }
}

/**
 * A test's registered stop, made permanent. Its result is computed once, from the bets
 * settled at that moment, and stored: bets that settle afterwards cannot move it, and that
 * test stops scanning. Idempotent — a second call keeps the first result.
 */
export function freeze(state, nowMs = Date.now(), arm = 'A') {
  state.finalByArm ??= {}
  if (state.finalByArm[arm]) return state.finalByArm[arm]
  const full = summarise(state, nowMs, { arm, reveal: true })
  const settledIds = armRecords(state, arm).filter((r) => r.rule && r.settle).map((r) => r.id)
  state.finalByArm[arm] = { ...full, done: true, frozenAt: new Date(nowMs).toISOString(), settledIds }
  return state.finalByArm[arm]
}

/** Reported, not deciding: how often each price level actually paid, at the real $2 fill. */
export const CAL_EDGES = [0.02, 0.05, 0.10, 0.20, 0.35, 0.50, 0.65, 0.80, 0.90, 0.98]
export function calibration(recs) {
  const bins = CAL_EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: CAL_EDGES[i + 1], n: 0, priceSum: 0, yes: 0 }))
  for (const r of recs) {
    const p = r.fill?.avgPrice
    if (!r.settle || !r.fill?.filled || !(p >= CAL_EDGES[0]) || p > CAL_EDGES.at(-1)) continue
    const b = bins.find((x) => p < x.hi) ?? bins.at(-1)
    b.n++; b.priceSum += p; b.yes += r.settle.yesPrice
  }
  return bins.filter((b) => b.n).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, avgPrice: b.priceSum / b.n, yesRate: b.yes / b.n }))
}

/**
 * Counts per sport or per bet type. Results (record, profit) are added ONLY from a frozen
 * set of counted bets — before a test's stop there is no such set, so none leave here.
 */
const resultCache = new Map()
/**
 * Live readings are recomputed only when the data has changed (state.version moves each
 * round). One cache per state object, so two states can never share a reading.
 */
const liveCaches = new WeakMap()
function liveMemo(state, key, build) {
  let c = liveCaches.get(state)
  if (!c || c.version !== (state.version ?? 0)) { c = { version: state.version ?? 0, map: new Map() }; liveCaches.set(state, c) }
  if (!c.map.has(key)) c.map.set(key, build())
  return c.map.get(key)
}
export function breakdown(recs, key, nowMs, counted = null, cacheKey = null) {
  const rows = new Map()
  for (const r of recs) {
    const k = r[key] ?? 'Untagged'
    if (!rows.has(k)) rows.set(k, { name: k, scanned: 0, bets: 0, games: new Set(), settled: 0, waiting: 0, upcoming: 0, counted: [] })
    const row = rows.get(k)
    row.scanned++
    if (!r.rule) continue
    row.bets++; row.games.add(r.game ?? r.event)
    if (r.settle) row.settled++
    else if (!isStale(r, nowMs)) Date.parse(r.endDate) > nowMs ? row.upcoming++ : row.waiting++
    if (counted && counted.has(r.id)) row.counted.push(r)
  }
  return [...rows.values()].sort((a, b) => b.bets - a.bets || b.scanned - a.scanned).map((row) => {
    const out = { name: row.name, scanned: row.scanned, bets: row.bets, games: row.games.size, settled: row.settled, waiting: row.waiting, upcoming: row.upcoming }
    if (!counted) return out
    const ck = cacheKey ? `${cacheKey}|${key}|${row.name}` : null
    if (ck && resultCache.has(ck)) return { ...out, ...resultCache.get(ck) }
    const iters = cacheKey && cacheKey.startsWith('live') ? 1000 : 2000
    const n = row.counted.length, wins = row.counted.filter((r) => r.settle.yesPrice === 1).length
    const res = n ? profitPerDollar(row.counted, { iters }) : null
    const extra = {
      counted: n, wins, losses: n - wins, hitRate: n ? wins / n : null,
      avgPrice: n ? row.counted.reduce((a, r) => a + r.fill.avgPrice, 0) / n : null,
      perDollar: res?.perDollar ?? null, profitLo: res?.lo ?? null, profitHi: res?.hi ?? null,
    }
    if (ck && !ck.startsWith('live')) resultCache.set(ck, extra)
    return { ...out, ...extra }
  })
}

/**
 * Everything the dashboard shows, for one test and an optional sport / bet-type filter.
 * Before that test's stop it carries counts, prices and timings only: no outcome of any
 * bet (won, lost, payout, profit) leaves this function, so the page cannot tempt anyone
 * into stopping on a lucky run. After the stop, the frozen result and each counted bet's
 * outcome are included.
 */
export function dashboardData(state, nowMs = Date.now(), { arm = 'A', sport = null, type = null } = {}) {
  if (!ALL_ARMS.includes(arm)) arm = 'A'
  const watch = arm === 'W'
  const final = watch ? null : state.finalByArm?.[arm] ?? null
  const live = summarise(state, nowMs, { arm, withhold: true })
  // A test's outcomes are shown only from its frozen result. Between the stop being reached
  // and the tracker freezing it (at most one scan interval) the page says "finishing".
  // The watch list is no test: its results are shown as they come in.
  // Amendment 3 (A) / 2 (B): at the user's request the running result is shown before the
  // stop. The verdict is still taken once, at the stop, from the frozen set of bets.
  const { settledIds, ...frozen } = final ?? {}
  const v = state.version ?? 0
  const settledBets = () => armRecords(state, arm).filter((r) => r.rule && r.settle)
  const running = () => liveMemo(state, `${arm}|main`, () => { const { verdict: _v, ...o } = outcomeSummary(settledBets(), armRecords(state, arm), { iters: 1000 }); return o })
  const s = watch ? { ...summarise(state, nowMs, { arm, withhold: true }), ...running(), done: true, watch: true }
    : final ? frozen : { ...live, ...running(), done: false, finishing: live.done, running: true }
  const counted = final ? new Set(settledIds ?? []) : new Set(settledBets().map((r) => r.id))
  const armRecs = armRecords(state, arm)
  const sportOk = (r) => !sport || (r.sport ?? 'Untagged') === sport
  const typeOk = (r) => !type || (r.type ?? 'Untagged') === type
  const recs = armRecs.filter((r) => sportOk(r) && typeOk(r))
  const rule = recs.filter((r) => r.rule)
  const first = firstRecordMs(armRecs)
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)

  const perDay = new Map()
  const bump = (day, k) => { if (!perDay.has(day)) perDay.set(day, { day, scanned: 0, bets: 0, settled: 0 }); perDay.get(day)[k]++ }
  for (const r of recs) {
    bump(dayOf(Date.parse(r.recordedAt)), 'scanned')
    if (r.rule) bump(dayOf(Date.parse(r.recordedAt)), 'bets')
    if (r.rule && r.settle) bump(r.settle.settledAt.slice(0, 10), 'settled')
  }
  if (first) for (let t = first; t <= nowMs; t += DAY_MS) if (!perDay.has(dayOf(t))) perDay.set(dayOf(t), { day: dayOf(t), scanned: 0, bets: 0, settled: 0 })

  const priceBins = Array.from({ length: 9 }, (_, i) => ({ lo: 0.02 + i * 0.02, hi: 0.04 + i * 0.02, n: 0 }))
  for (const r of rule) priceBins[Math.min(8, Math.max(0, Math.floor((r.fill.avgPrice - 0.02) / 0.02 + 1e-9)))].n++

  let waiting = 0, upcoming = 0, stale = 0, oldestWaitingMs = null
  for (const r of rule) {
    if (r.settle) continue
    if (isStale(r, nowMs)) { stale++; continue }
    const end = Date.parse(r.endDate)
    if (end > nowMs) upcoming++
    else { waiting++; if (oldestWaitingMs === null || end < oldestWaitingMs) oldestWaitingMs = end }
  }

  // Verdict date for the whole test, whatever the filter: the stop is defined on the test.
  const armRule = armRecs.filter((r) => r.rule), armSettled = armRule.filter((r) => r.settle).length
  let eta = null
  if (first) {
    // The 400th bet settles about a day after it is recorded (games are 22–26h out).
    const sorted = armRule.map((r) => Date.parse(r.recordedAt)).sort((a, b) => a - b)
    const ratePerMs = armRule.length / Math.max(nowMs - first, 3600_000)
    const t400 = armSettled >= RULE.stopBets ? nowMs
      : sorted.length >= RULE.stopBets ? sorted[RULE.stopBets - 1] + 30 * 3600_000
      : ratePerMs > 0 ? nowMs + (RULE.stopBets - sorted.length) / ratePerMs + 30 * 3600_000 : Infinity
    eta = new Date(Math.min(first + RULE.stopDays * DAY_MS, Math.max(first + RULE.minDays * DAY_MS, t400))).toISOString()
  }

  const row = (r) => {
    const out = {
      arm: r.arm ?? 'A', question: r.question ?? null, outcome: r.outcome ?? (r.side ? null : 'Yes'), sport: r.sport ?? null, league: r.league ?? null, type: r.type ?? null,
      price: r.fill.avgPrice, shares: r.fill.shares, cost: r.fill.spent + r.fee, endDate: r.endDate, recordedAt: r.recordedAt,
      status: r.settle ? 'settled' : isStale(r, nowMs) ? 'stale' : Date.parse(r.endDate) > nowMs ? 'open' : 'waiting',
    }
    if (counted && counted.has(r.id)) { out.won = r.settle.yesPrice === 1; out.resolved = r.settle.yesPrice; out.pnl = r.settle.pnl; out.counted = true }
    return out
  }
  const newest = (list) => [...list].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 40).map(row)
  // After the stop, the list shows the bets the verdict was computed from, newest first.
  // After a test's stop the list shows the bets its verdict was computed from; before it,
  // and on the watch list, every bet with its result as it comes in.
  const latest = final ? newest(rule.filter((r) => counted.has(r.id))) : newest(rule)
  // Bets still to be decided, soonest kickoff first: games under way or about to start lead,
  // whenever the bet was placed (most are placed a day ahead, so "newest" buries today's games).
  const upcomingList = rule.filter((r) => !r.settle && !isStale(r, nowMs)).sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate)).slice(0, 40).map(row)
  // The latest results: settled bets that count, the most recently settled first.
  const results = rule.filter((r) => r.settle && counted.has(r.id)).sort((a, b) => Date.parse(b.settle.settledAt) - Date.parse(a.settle.settledAt)).slice(0, 40).map(row)

  const ck = final ? `${arm}|${final.frozenAt}` : `live|${arm}|v${v}`
  const table = (list, key, k) => (final ? breakdown(list, key, nowMs, counted, k) : liveMemo(state, k, () => breakdown(list, key, nowMs, counted, k)))
  const bySport = table(armRecs.filter(typeOk), 'sport', `${ck}|t=${type}|sport`)
  const byType = table(armRecs.filter(sportOk), 'type', `${ck}|s=${sport}|type`)
  let viewResult
  if (sport || type) {
    const build = () => outcomeSummary(rule.filter((r) => counted.has(r.id)), null, { iters: final ? 4000 : 1000 })
    const k = `${ck}|view|${sport}|${type}`
    if (!final) viewResult = liveMemo(state, k, build)
    else { if (!resultCache.has(k)) resultCache.set(k, build()); viewResult = resultCache.get(k) }
  }

  return {
    ...s, armInfo: ARM_INFO[arm], filter: { sport, type },
    arms: ALL_ARMS.map((a) => {
      const f = a === 'W' ? null : state.finalByArm?.[a], l = f ?? summarise(state, nowMs, { arm: a, withhold: true })
      return { key: a, name: ARM_INFO[a].name, ruleBets: l.ruleBets, settled: l.settled, recorded: l.recorded, done: Boolean(f), watch: a === 'W' }
    }).filter((a) => !a.watch || a.recorded > 0 || arm === 'W'),
    sports: breakdown(armRecs, 'sport', nowMs).map((x) => ({ name: x.name, bets: x.bets })),
    types: breakdown(armRecs, 'type', nowMs).map((x) => ({ name: x.name, bets: x.bets })),
    generatedAt: new Date(nowMs).toISOString(), firstRecordAt: first ? new Date(first).toISOString() : null,
    rule: { stakeUsd: RULE.stakeUsd, minPrice: RULE.minPrice, maxPrice: RULE.maxPrice, stopBets: RULE.stopBets, minDays: RULE.minDays, stopDays: RULE.stopDays },
    scanEveryMin: SCAN_MS / 60_000, eta: watch ? null : eta, watchSports: WATCH_SPORTS,
    view: {
      scanned: recs.length, bets: rule.length, games: new Set(rule.map((r) => r.game ?? r.event)).size,
      settled: rule.filter((r) => r.settle).length, waiting, upcoming, stale,
    },
    oldestWaitingAt: oldestWaitingMs ? new Date(oldestWaitingMs).toISOString() : null,
    untagged: armRecs.filter((r) => !r.sport).length,
    perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-35), priceBins, latest, results, upcoming: upcomingList,
    bySport, byType, viewResult,
  }
}

// ---------------------------------------------------------------- storage
/**
 * Append-only files, so a 28-day run never rewrites hundreds of MB every 15 minutes:
 *   records.jsonl  one line per market decided (never rewritten)
 *   settles.jsonl  one line per settlement
 *   tags.jsonl     sport / league / bet type filled in after the fact
 *   meta.json      small: timestamps, error count, each test's frozen result
 * A torn last line (a crash mid-write) is skipped on load. A state.json from the first
 * version is migrated once and kept as state.json.migrated.
 */
export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const f = (n) => path.join(dir, n)
  const lines = (name, fn) => {
    if (!fs.existsSync(f(name))) return 0
    let bad = 0
    for (const l of fs.readFileSync(f(name), 'utf8').split('\n')) { if (!l.trim()) continue; try { fn(JSON.parse(l)) } catch { bad++ } }
    return bad
  }
  const append = (name, objs) => { if (objs.length) fs.appendFileSync(f(name), objs.map((o) => JSON.stringify(o)).join('\n') + '\n') }
  const metaOf = (state) => ({ lastScanAt: state.lastScanAt ?? null, lastSettleAt: state.lastSettleAt ?? null, errors: state.errors ?? 0, finalByArm: state.finalByArm ?? {} })
  const store = {
    load() {
      if (fs.existsSync(f('state.json')) && !fs.existsSync(f('records.jsonl'))) {
        const old = JSON.parse(fs.readFileSync(f('state.json'), 'utf8'))
        const recs = Object.values(old.records ?? {})
        fs.writeFileSync(f('records.jsonl.tmp'), recs.map(({ settle: _s, ...r }) => JSON.stringify({ arm: 'A', side: 0, ...r })).join('\n') + (recs.length ? '\n' : ''))
        fs.writeFileSync(f('settles.jsonl'), recs.filter((r) => r.settle).map((r) => JSON.stringify({ id: r.id, settle: r.settle })).join('\n') + (recs.some((r) => r.settle) ? '\n' : ''))
        const finalByArm = old.finalByArm ?? (old.final ? { A: old.final } : {})
        fs.writeFileSync(f('meta.json'), JSON.stringify(metaOf({ ...old, finalByArm })))
        fs.renameSync(f('records.jsonl.tmp'), f('records.jsonl'))
        fs.renameSync(f('state.json'), f('state.json.migrated'))
      }
      const state = { records: {} }
      const bad = lines('records.jsonl', (r) => { state.records[r.id] = { arm: 'A', side: 0, ...r } })
        + lines('tags.jsonl', (t) => { const r = state.records[t.id]; if (r) { const { id: _i, ...tags } = t; Object.assign(r, tags) } })
        + lines('settles.jsonl', (x) => { const r = state.records[x.id]; if (r) r.settle = x.settle })
      for (const r of Object.values(state.records)) refineSport(correctFee(r))   // records from before the fee correction / sport split
      if (fs.existsSync(f('meta.json'))) Object.assign(state, JSON.parse(fs.readFileSync(f('meta.json'), 'utf8')))
      if (state.final) { state.finalByArm = { A: state.final, ...(state.finalByArm ?? {}) }; delete state.final }
      state.finalByArm ??= {}
      if (bad) console.error(`storage: skipped ${bad} unreadable line(s)`)
      return state
    },
    addRecords: (recs) => append('records.jsonl', recs),
    addSettles: (recs) => append('settles.jsonl', recs.map((r) => ({ id: r.id, settle: r.settle }))),
    addTags: (list) => append('tags.jsonl', list),
    saveMeta(state) { fs.writeFileSync(f('meta.json.tmp'), JSON.stringify(metaOf(state))); fs.renameSync(f('meta.json.tmp'), f('meta.json')) },
  }
  return store
}

// ---------------------------------------------------------------- I/O
function getJson(url) {
  // POLY_HTTP=curl for environments whose proxy refuses Node's fetch.
  if (process.env.POLY_HTTP === 'curl') return new Promise((ok, fail) => execFile('curl', ['-sS', '--fail', '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out) => { if (e) return fail(e); try { ok(JSON.parse(out)) } catch (err) { fail(err) } }))
  return fetch(url, { signal: AbortSignal.timeout(30_000) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() })
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z'

function dataDir() {
  return path.join(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data'), 'polysports')
}

async function scan(state, index, arms, onRecords) {
  const now = Date.now()
  let cursor = null, lastFirst = null
  const todo = []
  do {
    const q = new URLSearchParams({ active: 'true', closed: 'false', limit: '100',
      end_date_min: iso(now + RULE.windowMinH * 3600_000), end_date_max: iso(now + RULE.windowMaxH * 3600_000) })
    if (cursor) q.set('after_cursor', cursor)
    const page = await getJson('https://gamma-api.polymarket.com/markets/keyset?' + q)
    const first = page.markets?.[0]?.id
    if (first && first === lastFirst) throw new Error('keyset cursor did not advance')
    lastFirst = first
    for (const m of page.markets ?? []) if (!state.records[m.id] && isCandidate(m, now, arms, index)) todo.push(m)
    cursor = page.next_cursor
  } while (cursor)
  const added = await decideAll(state, todo, arms, index)
  onRecords(added)
  state.lastScanAt = new Date().toISOString()
  return added
}

/** Reads the books for each market and records the decision. 8 at a time. */
async function decideAll(state, todo, arms, index) {
  const added = []
  let next = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const m = todo[next++]
      // A long pass can take many minutes: the window is re-checked at the moment of the
      // decision, not only when the market was listed.
      const arm = armFor(m, Date.now(), arms, index)
      if (!arm || state.records[m.id]) continue
      try {
        const tokens = JSON.parse(m.clobTokenIds)
        const twoWay = armOf(m) === 'B'
        const books = []
        for (const t of twoWay ? tokens : tokens.slice(0, 1)) books.push(await getJson('https://clob.polymarket.com/book?token_id=' + t))
        const r = decide(m, twoWay ? books : books[0], Date.now(), index, arm)
        state.records[r.id] = r
        added.push(r)
      } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('book', m.id, e.message) }
    }
  }))
  return added
}

/**
 * The watch list's own listing: the watch sports' leagues, games kicking off in the next
 * 15 minutes to 22 hours. Read per league from /events, whose markets come without their
 * event, so the event (title, date, league) is attached to each market before deciding.
 */
async function scanWatch(state, index, onRecords) {
  if (!index) return []
  const series = [...index.entries()].filter(([, v]) => WATCH_SPORTS.includes(v.sport)).map(([id]) => id)
  const now = Date.now(), todo = []
  for (const sid of series) {
    for (let offset = 0; offset < 2000; offset += 100) {
      const q = new URLSearchParams({ series_id: sid, closed: 'false', limit: '100', offset: String(offset),
        end_date_min: iso(now + WATCH_WINDOW_H[0] * 3600_000), end_date_max: iso(now + WATCH_WINDOW_H[1] * 3600_000) })
      let events
      try { events = await getJson('https://gamma-api.polymarket.com/events?' + q) } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('watch', sid, e.message); break }
      if (!Array.isArray(events) || !events.length) break
      for (const ev of events) for (const m of ev.markets ?? []) {
        const full = { ...m, events: [{ id: ev.id, title: ev.title, eventDate: ev.eventDate, gameId: ev.gameId, series: ev.series ?? [{ id: sid }] }] }
        if (!state.records[full.id] && full.active !== false && armFor(full, now, ['W'], index) === 'W') todo.push(full)
      }
      if (events.length < 100) break
    }
  }
  const added = await decideAll(state, todo, ['W'], index)
  onRecords(added)
  return added
}

/**
 * Settles every recorded market of the given tests whose game has ended — rule bets decide
 * the result, the rest give calibration at real asks (reported, not deciding). Gamma returns
 * up to 50 markets per request when asked for closed ones by id; markets still open are
 * simply absent from the reply and tried again next hour, until they go stale.
 */
export async function settleAll(state, fetchJson = getJson, now = Date.now(), onSettled = () => {}, arms = ARMS) {
  const due = Object.values(state.records).filter((r) => !r.settle && arms.includes(r.arm ?? 'A') && Date.parse(r.endDate) <= now && !isStale(r, now))
  const done = []
  for (let i = 0; i < due.length; i += 50) {
    const chunk = due.slice(i, i + 50)
    try {
      const q = new URLSearchParams({ closed: 'true', limit: '100' })
      for (const r of chunk) q.append('id', r.id)
      const markets = await fetchJson('https://gamma-api.polymarket.com/markets?' + q)
      const byId = new Map((Array.isArray(markets) ? markets : []).map((m) => [String(m.id), m]))
      for (const r of chunk) { const s = settle(r, byId.get(r.id)); if (s) { r.settle = s; done.push(r) } }
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('settle', e.message) }
  }
  onSettled(done)
  state.lastSettleAt = new Date().toISOString()
  return done.length
}

/**
 * Fills in sport / league / bet type for records that lack them: the first day's records
 * (recorded before tagging existed), and any recorded while the sports directory could not
 * be read. A record that already knows its series is tagged from the directory alone;
 * otherwise its market is read again, open or closed, 50 at a time.
 */
export async function tagMissing(state, index, fetchJson = getJson, onTags = () => {}) {
  if (!index) return 0
  // Untagged records, plus any filed under 'Other' whose league the directory now knows.
  // Each record is looked up at most 3 times, so a market Gamma no longer returns is not
  // asked about every hour for the rest of the test.
  const need = Object.values(state.records).filter((r) => ((!r.sport || !r.type || !r.game) && (r._tagTries ?? 0) < 3)
    || (r.sport === 'Other' && r.seriesId && index.has(r.seriesId) && index.get(r.seriesId).sport !== 'Other'))
  const out = []
  const apply = (r, t, game = r.game) => {
    const tags = { sport: t.sport, league: t.league, type: t.type, typeRaw: t.typeRaw, seriesId: t.seriesId, ...(game ? { game } : {}) }
    Object.assign(r, tags); out.push({ id: r.id, ...tags })
  }
  const fetchFor = []
  for (const r of need) {
    if (r.seriesId && r.type && r.game && index.has(r.seriesId)) apply(r, { ...index.get(r.seriesId), type: r.type, typeRaw: r.typeRaw, seriesId: r.seriesId })
    else fetchFor.push(r)
  }
  for (const r of fetchFor) r._tagTries = (r._tagTries ?? 0) + 1   // in memory only: resets on restart
  for (let i = 0; i < fetchFor.length; i += 50) {
    const chunk = fetchFor.slice(i, i + 50)
    for (const closed of ['false', 'true']) {
      const left = chunk.filter((r) => !r.sport || !r.game)
      if (!left.length) break
      try {
        const q = new URLSearchParams({ closed, limit: '100' })
        for (const r of left) q.append('id', r.id)
        const markets = await fetchJson('https://gamma-api.polymarket.com/markets?' + q)
        const byId = new Map((Array.isArray(markets) ? markets : []).map((m) => [String(m.id), m]))
        for (const r of left) { const m = byId.get(r.id); if (m) { const t = tagsOf(m, index); if (t.sport) apply(r, t, matchKeyOf(m)) } }
      } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('tags', e.message) }
    }
  }
  onTags(out)
  return out.length
}

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID
  if (!t || !c) return
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c, text }) }) } catch {}
}

const DASHBOARD_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'polysports-dashboard.html')

/** Each test's public summary: the frozen result once stopped, counts only before. */
function publicSummary(state, arm) {
  const f = state.finalByArm?.[arm]
  if (!f) return summarise(state, Date.now(), { arm, withhold: true })
  const { settledIds: _ids, ...rest } = f
  return rest
}

export async function run() {
  const store = openStore(dataDir())
  const state = store.load()
  const port = Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 8080), token = process.env.DASHBOARD_TOKEN
  const html = fs.readFileSync(DASHBOARD_HTML, 'utf8')
  if (!token) console.warn('DASHBOARD_TOKEN is not set: the dashboard is open to anyone with the address (it shows no money and places no orders).')
  // The feed is rebuilt at most once a minute per view, and after each round of work:
  // computing it walks every record, so on demand it would cost ~1 s per refresh at a week's scale.
  const cache = new Map()
  const cached = (key, build) => {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 60_000) return hit.body
    const body = JSON.stringify(build())
    if (cache.size > 200) cache.clear()
    cache.set(key, { at: Date.now(), body })
    return body
  }
  http.createServer((req, res) => {
    try { handle(req, res) } catch (e) {
      // A request must never take the tracker down: a malformed path used to throw here and
      // end the process, stopping the scanning with it.
      console.error('request', e.message)
      if (!res.headersSent) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('bad request') }
    }
  }).listen(port, () => console.log(`polysports dashboard on :${port}`))
  function handle(req, res) {
    const u = new URL(req.url, 'http://x')
    if (token && u.searchParams.get('token') !== token) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('This dashboard needs its token: add ?token=YOUR_DASHBOARD_TOKEN to the address.')
    }
    const send = (body) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(body) }
    if (u.pathname === '/api/status') {
      const arm = ALL_ARMS.includes(u.searchParams.get('arm')) ? u.searchParams.get('arm') : 'A'
      const sport = u.searchParams.get('sport') || null, type = u.searchParams.get('type') || null
      return send(cached(`${arm}|${sport}|${type}`, () => dashboardData(state, Date.now(), { arm, sport, type })))
    }
    if (u.pathname === '/json') return send(cached('json', () => ({ ...Object.fromEntries(ARMS.map((a) => [a, publicSummary(state, a)])), W: summarise(state, Date.now(), { arm: 'W', reveal: true }) })))
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html) }
    res.writeHead(404); res.end('not found')
  }
  if (ARMS.some((a) => !state.finalByArm[a])) await telegram('Sports paper tests running (no real money). Results are reported only at each registered stop.')
  let lastSettle = 0, index = null, indexAt = 0
  for (;;) {
    try {
      // Each test's stop is checked FIRST each round, so its result is frozen on exactly the
      // bets that were settled when it was reached, before this round could settle any more.
      for (const arm of ARMS) {
        if (state.finalByArm[arm] || !summarise(state, Date.now(), { arm, withhold: true }).done) continue
        const f = freeze(state, Date.now(), arm); store.saveMeta(state); cache.clear()
        console.log(`STOP reached, test ${arm} — ${f.verdict} · ${f.settled} settled bets, profit per $1 ${f.result?.perDollar.toFixed(4)} [${f.result?.lo.toFixed(4)}, ${f.result?.hi.toFixed(4)}]`)
        await telegram(`Sports paper test ${arm} finished: ${f.verdict}\n${f.settled} bets, profit per $1 ${f.result?.perDollar.toFixed(3)} (95% ${f.result?.lo.toFixed(3)} to ${f.result?.hi.toFixed(3)})`)
      }
      const active = ARMS.filter((a) => !state.finalByArm[a])
      if (!index || Date.now() - indexAt > INDEX_MS) {
        try { index = sportsIndex(await getJson('https://gamma-api.polymarket.com/sports')); indexAt = Date.now() }
        catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('sports index', e.message) }
      }
      {
        const added = active.length ? await scan(state, index, active, store.addRecords) : []
        added.push(...await scanWatch(state, index, store.addRecords))
        if (Date.now() - lastSettle > SETTLE_MS) {
          const n = await settleAll(state, getJson, Date.now(), store.addSettles, [...active, 'W'])
          const t = await tagMissing(state, index, getJson, store.addTags)
          lastSettle = Date.now(); console.log(`settled ${n} · tagged ${t}`)
        }
        store.saveMeta(state)
        state.version = (state.version ?? 0) + 1
        cache.clear()
        console.log([...active, 'W'].map((a) => { const s = summarise(state, Date.now(), { arm: a, withhold: true }); return `${a === 'W' ? 'watch' : 'test ' + a}: +${added.filter((r) => r.arm === a).length} · recorded ${s.recorded} · bets ${s.ruleBets} · settled ${s.settled}` }).join(' | '))
      }
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('loop', e.message) }
    await new Promise((r) => setTimeout(r, SCAN_MS))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] ?? 'run'
  if (cmd === 'run') run()
  else if (cmd === 'summary') {
    const st = openStore(dataDir()).load()
    console.log(JSON.stringify(Object.fromEntries(ARMS.map((a) => [a, publicSummary(st, a)])), null, 2))
  } else { console.error('usage: node src/polysports.js run|summary'); process.exit(1) }
}
