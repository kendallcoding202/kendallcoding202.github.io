/**
 * Forward paper test of cheap Polymarket sports contracts — PREREG-POLY-SPORTS.md.
 *
 *   node src/polysports.js run       scanner + settlement + status page (PORT)
 *   node src/polysports.js summary   print the result from DATA_DIR
 *
 * No orders are ever placed. Every "bet" is a record of what a $2 taker order would have
 * paid against the real book at that moment, settled later on the real resolution.
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- the registered rule
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
const SCAN_MS = 15 * 60_000
const SETTLE_MS = 60 * 60_000

// ---------------------------------------------------------------- pure functions (tested)
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x))

/** Asks sorted cheapest first, as numbers. The CLOB returns them in no order we rely on. */
export function sortedAsks(book) {
  return (book?.asks ?? []).map((a) => ({ price: +a.price, size: +a.size })).filter((a) => a.price > 0 && a.size > 0).sort((a, b) => a.price - b.price)
}
export function bestBid(book) {
  const b = (book?.bids ?? []).map((x) => +x.price).filter((p) => p > 0)
  return b.length ? Math.max(...b) : null
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

/** Polymarket's documented taker fee: shares × p × rate × (p(1 − p))^exponent. */
export function takerFee(feeSchedule, price, shares) {
  if (!feeSchedule || !(price > 0)) return 0
  const rate = Number(feeSchedule.rate ?? 0), exp = Number(feeSchedule.exponent ?? 1)
  return shares * price * rate * (price * (1 - price)) ** exp
}

export function isCandidate(m, nowMs) {
  if (m.outcomes !== '["Yes", "No"]') return false
  if (!String(m.feeType ?? '').startsWith('sports')) return false
  if (m.enableOrderBook === false || m.closed) return false
  const h = (Date.parse(m.endDate) - nowMs) / 3600_000
  return h >= RULE.windowMinH && h < RULE.windowMaxH
}

/** The registered decision for one market, from its YES book. */
export function decide(m, book, nowMs) {
  const asks = sortedAsks(book)
  const fill = walkAsks(asks, RULE.stakeUsd)
  const fee = fill.avgPrice ? takerFee(m.feeSchedule, fill.avgPrice, fill.shares) : 0
  const rule = fill.filled && fill.avgPrice >= RULE.minPrice && fill.avgPrice <= RULE.maxPrice
  return {
    id: String(m.id), event: String(m.events?.[0]?.id ?? m.id), question: m.question, endDate: m.endDate, recordedAt: new Date(nowMs).toISOString(),
    token: JSON.parse(m.clobTokenIds)[0], bestAsk: asks[0]?.price ?? null, bestBid: bestBid(book),
    askDepthUsd: asks.reduce((s, a) => s + a.price * a.size, 0),
    lastTrade: num(m.lastTradePrice), volumeAtDecision: num(m.volumeNum) ?? 0,
    fill, fee, rule,
  }
}

/** Settle from Gamma's market object. null while unresolved. */
export function settle(rec, m) {
  if (!m?.closed) return null
  const op = JSON.parse(m.outcomePrices ?? '[]').map(Number)
  if (op.length !== 2 || op.some((x) => !Number.isFinite(x))) return null
  if (op[0] + op[1] < 0.99) return null           // not resolved yet
  const payout = rec.fill.shares * op[0]
  const cost = rec.fill.spent + rec.fee
  return { yesPrice: op[0], payout, cost, pnl: payout - cost, finalVolume: num(m.volumeNum) ?? 0, settledAt: new Date().toISOString() }
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
    return { cluster: b.event ?? b.id, pnl: b.settle.pnl - extra, cost: b.settle.cost + extra }
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

export function summarise(state, nowMs = Date.now(), { reveal = false, withhold = false } = {}) {
  const recs = Object.values(state.records)
  const rule = recs.filter((r) => r.rule)
  const settled = rule.filter((r) => r.settle)
  const first = firstRecordMs(recs)
  const days = first ? (nowMs - first) / 86400_000 : 0
  const stale = rule.filter((r) => !r.settle && nowMs - Date.parse(r.endDate) > RULE.unsettledAfterDays * 86400_000).length
  const done = (settled.length >= RULE.stopBets && days >= RULE.minDays) || days >= RULE.stopDays
  const s = {
    recorded: recs.length, ruleBets: rule.length, settled: settled.length, unsettledStale: stale,
    days: +days.toFixed(1), stop: `${RULE.stopBets} settled bets and ${RULE.minDays} days, or ${RULE.stopDays} days`, done,
    lastScanAt: state.lastScanAt ?? null, lastSettleAt: state.lastSettleAt ?? null, errors: state.errors ?? 0,
  }
  if (withhold || !(done || reveal)) return s   // withhold: counts only, whatever the stop says
  const gap = rule.filter((r) => r.lastTrade !== null && r.bestAsk !== null).map((r) => r.bestAsk - r.lastTrade)
  s.result = profitPerDollar(settled)
  s.withSlip1c = profitPerDollar(settled, { slip: 0.01 })
  s.hitRate = settled.length ? settled.filter((r) => r.settle.yesPrice === 1).length / settled.length : null
  s.avgFill = settled.length ? settled.reduce((a, r) => a + r.fill.avgPrice, 0) / settled.length : null
  s.askMinusLastTrade = gap.length ? gap.reduce((a, b) => a + b, 0) / gap.length : null
  s.finalVolume1k = profitPerDollar(settled.filter((r) => r.settle.finalVolume >= 1000))
  s.verdict = s.result && s.result.lo > 0 ? 'YES — profitable at real asks' : 'NO — not profitable at real asks'
  s.calibration = calibration(recs)
  return s
}

/**
 * The registered stop, made permanent. The result is computed once, from the bets settled
 * at that moment, and stored: bets that settle afterwards cannot move it, and scanning
 * stops. Idempotent — a second call keeps the first result.
 */
export function freeze(state, nowMs = Date.now()) {
  if (state.final) return state.final
  const at = new Date(nowMs).toISOString()
  const full = summarise(state, nowMs, { reveal: true })
  const settledIds = Object.values(state.records).filter((r) => r.rule && r.settle).map((r) => r.id)
  state.final = { ...full, done: true, frozenAt: at, settledIds }
  return state.final
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

const DAY_MS = 86400_000
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
const isStale = (r, nowMs) => nowMs - Date.parse(r.endDate) > RULE.unsettledAfterDays * DAY_MS

/**
 * Everything the dashboard shows. Before the registered stop it carries counts, prices and
 * timings only: no outcome of any bet (won, lost, payout, profit) leaves this function,
 * so the page cannot tempt anyone into stopping on a lucky run. After the stop, the full
 * result and each bet's outcome are included.
 */
export function dashboardData(state, nowMs = Date.now()) {
  const live = summarise(state, nowMs, { withhold: true })
  // Outcomes are shown only from the frozen result. Between the stop being reached and the
  // tracker freezing it (at most one scan interval) the page says "finishing" instead.
  const { settledIds, ...frozen } = state.final ?? {}
  const s = state.final ? frozen : { ...live, done: false, finishing: live.done }
  const counted = new Set(settledIds ?? [])
  const recs = Object.values(state.records)
  const rule = recs.filter((r) => r.rule)
  const first = firstRecordMs(recs)

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

  let waiting = 0, upcoming = 0, oldestWaitingMs = null
  for (const r of rule) {
    if (r.settle || isStale(r, nowMs)) continue
    const end = Date.parse(r.endDate)
    if (end > nowMs) upcoming++
    else { waiting++; if (oldestWaitingMs === null || end < oldestWaitingMs) oldestWaitingMs = end }
  }

  const settledBets = rule.filter((r) => r.settle).length
  let eta = null
  if (first) {
    // The 400th bet settles about a day after it is recorded (games are 22–26h out).
    const sorted = rule.map((r) => Date.parse(r.recordedAt)).sort((a, b) => a - b)
    const ratePerMs = rule.length / Math.max(nowMs - first, 3600_000)
    const t400 = settledBets >= RULE.stopBets ? nowMs
      : sorted.length >= RULE.stopBets ? sorted[RULE.stopBets - 1] + 30 * 3600_000
      : ratePerMs > 0 ? nowMs + (RULE.stopBets - sorted.length) / ratePerMs + 30 * 3600_000 : Infinity
    eta = new Date(Math.min(first + RULE.stopDays * DAY_MS, Math.max(first + RULE.minDays * DAY_MS, t400))).toISOString()
  }

  const latest = [...rule].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 40).map((r) => {
    const row = {
      question: r.question, price: r.fill.avgPrice, shares: r.fill.shares, cost: r.fill.spent + r.fee,
      endDate: r.endDate, recordedAt: r.recordedAt,
      status: r.settle ? 'settled' : isStale(r, nowMs) ? 'stale' : Date.parse(r.endDate) > nowMs ? 'open' : 'waiting',
    }
    if (s.done && counted.has(r.id)) { row.won = r.settle.yesPrice === 1; row.pnl = r.settle.pnl; row.counted = true }
    return row
  })
  // After the stop, the list shows the bets the verdict was computed from, newest first.
  const listed = s.done ? latestCounted(rule, counted, s, nowMs) : latest

  return {
    ...s, generatedAt: new Date(nowMs).toISOString(), firstRecordAt: first ? new Date(first).toISOString() : null,
    rule: { stakeUsd: RULE.stakeUsd, minPrice: RULE.minPrice, maxPrice: RULE.maxPrice, stopBets: RULE.stopBets, minDays: RULE.minDays, stopDays: RULE.stopDays },
    scanEveryMin: SCAN_MS / 60_000, games: new Set(rule.map((r) => r.event)).size,
    waiting, upcoming, oldestWaitingAt: oldestWaitingMs ? new Date(oldestWaitingMs).toISOString() : null,
    settledAll: recs.filter((r) => r.settle).length, eta,
    perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-35), priceBins, latest: listed,
  }
}

function latestCounted(rule, counted, s, nowMs) {
  return rule.filter((r) => counted.has(r.id)).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 40).map((r) => ({
    question: r.question, price: r.fill.avgPrice, shares: r.fill.shares, cost: r.fill.spent + r.fee,
    endDate: r.endDate, recordedAt: r.recordedAt, status: 'settled', won: r.settle.yesPrice === 1, pnl: r.settle.pnl, counted: true,
  }))
}

// ---------------------------------------------------------------- I/O
function getJson(url) {
  // POLY_HTTP=curl for environments whose proxy refuses Node's fetch.
  if (process.env.POLY_HTTP === 'curl') return new Promise((ok, fail) => execFile('curl', ['-sS', '--fail', '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out) => { if (e) return fail(e); try { ok(JSON.parse(out)) } catch (err) { fail(err) } }))
  return fetch(url, { signal: AbortSignal.timeout(30_000) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json() })
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z'

function stateFile() {
  const dir = path.join(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data'), 'polysports')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'state.json')
}
function load() { const f = stateFile(); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { records: {} } }
function save(state) { const f = stateFile(); fs.writeFileSync(f + '.tmp', JSON.stringify(state)); fs.renameSync(f + '.tmp', f) }

async function scan(state) {
  const now = Date.now()
  let cursor = null, added = 0, lastFirst = null
  const todo = []
  do {
    const q = new URLSearchParams({ active: 'true', closed: 'false', limit: '100',
      end_date_min: iso(now + RULE.windowMinH * 3600_000), end_date_max: iso(now + RULE.windowMaxH * 3600_000) })
    if (cursor) q.set('after_cursor', cursor)
    const page = await getJson('https://gamma-api.polymarket.com/markets/keyset?' + q)
    const first = page.markets?.[0]?.id
    if (first && first === lastFirst) throw new Error('keyset cursor did not advance')
    lastFirst = first
    for (const m of page.markets ?? []) if (!state.records[m.id] && isCandidate(m, now)) todo.push(m)
    cursor = page.next_cursor
  } while (cursor)
  // Books are read 8 at a time: one by one, a busy window takes longer than the scan interval.
  let next = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < todo.length) {
      const m = todo[next++]
      try {
        const book = await getJson('https://clob.polymarket.com/book?token_id=' + JSON.parse(m.clobTokenIds)[0])
        state.records[m.id] = decide(m, book, Date.now())
        added++
      } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('book', m.id, e.message) }
    }
  }))
  state.lastScanAt = new Date().toISOString()
  return added
}

/**
 * Settles every recorded market whose game has ended — rule bets decide the result, the
 * rest give calibration at real asks (registered as reported, not deciding). Gamma returns
 * up to 50 markets per request when asked for closed ones by id; markets still open are
 * simply absent from the reply and tried again next hour, until they go stale.
 */
export async function settleAll(state, fetchJson = getJson, now = Date.now()) {
  const due = Object.values(state.records).filter((r) => !r.settle && Date.parse(r.endDate) <= now && !isStale(r, now))
  let n = 0
  for (let i = 0; i < due.length; i += 50) {
    const chunk = due.slice(i, i + 50)
    try {
      const q = new URLSearchParams({ closed: 'true', limit: '100' })
      for (const r of chunk) q.append('id', r.id)
      const markets = await fetchJson('https://gamma-api.polymarket.com/markets?' + q)
      const byId = new Map((Array.isArray(markets) ? markets : []).map((m) => [String(m.id), m]))
      for (const r of chunk) { const s = settle(r, byId.get(r.id)); if (s) { r.settle = s; n++ } }
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('settle', e.message) }
  }
  state.lastSettleAt = new Date().toISOString()
  return n
}

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID
  if (!t || !c) return
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c, text }) }) } catch {}
}

const DASHBOARD_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'polysports-dashboard.html')

export async function run() {
  const state = load()
  const port = Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 8080), token = process.env.DASHBOARD_TOKEN
  const html = fs.readFileSync(DASHBOARD_HTML, 'utf8')
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (token && u.searchParams.get('token') !== token) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('This dashboard needs its token: add ?token=YOUR_DASHBOARD_TOKEN to the address.')
    }
    const json = (body) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    if (u.pathname === '/api/status') return json(dashboardData(state))
    if (u.pathname === '/json') { const { settledIds, ...f } = state.final ?? {}; return json(state.final ? f : summarise(state, Date.now(), { withhold: true })) }
    if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html) }
    res.writeHead(404); res.end('not found')
  }).listen(port, () => console.log(`polysports dashboard on :${port}`))
  if (!state.final) await telegram('Sports paper test started (no real money). Profit is reported only at the registered stop.')
  let lastSettle = 0
  for (;;) {
    try {
      // The stop is checked FIRST each round, so the result is frozen on exactly the bets
      // that were settled when it was reached, before this round could settle any more.
      if (!state.final && summarise(state, Date.now(), { withhold: true }).done) {
        const f = freeze(state); save(state)
        console.log(`STOP reached — ${f.verdict} · ${f.settled} settled bets, profit per $1 ${f.result?.perDollar.toFixed(4)} [${f.result?.lo.toFixed(4)}, ${f.result?.hi.toFixed(4)}]`)
        await telegram(`Sports paper test finished: ${f.verdict}\n${f.settled} bets, profit per $1 ${f.result?.perDollar.toFixed(3)} (95% ${f.result?.lo.toFixed(3)} to ${f.result?.hi.toFixed(3)})`)
      }
      if (state.final) { await new Promise((r) => setTimeout(r, SCAN_MS)); continue }   // finished: serve the page only
      const added = await scan(state)
      if (Date.now() - lastSettle > SETTLE_MS) { const n = await settleAll(state); lastSettle = Date.now(); console.log(`settled ${n}`) }
      save(state)
      const s = summarise(state, Date.now(), { withhold: true })
      console.log(`scan +${added} · recorded ${s.recorded} · rule bets ${s.ruleBets} · settled ${s.settled}`)
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('loop', e.message) }
    await new Promise((r) => setTimeout(r, SCAN_MS))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] ?? 'run'
  if (cmd === 'run') run()
  else if (cmd === 'summary') {
    const st = load(), { settledIds, ...f } = st.final ?? {}
    console.log(JSON.stringify(st.final ? f : summarise(st, Date.now(), { reveal: process.argv.includes('--reveal') }), null, 2))
  }
  else if (cmd === 'scan-once') { const s = load(); scan(s).then((n) => { save(s); console.log(`recorded ${n}`, JSON.stringify(summarise(s), null, 2)) }) }
  else { console.error('usage: node src/polysports.js run|summary|scan-once'); process.exit(1) }
}
