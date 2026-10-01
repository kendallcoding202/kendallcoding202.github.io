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

export function summarise(state, nowMs = Date.now(), { reveal = false } = {}) {
  const recs = Object.values(state.records)
  const rule = recs.filter((r) => r.rule)
  const settled = rule.filter((r) => r.settle)
  const first = recs.length ? Math.min(...recs.map((r) => Date.parse(r.recordedAt))) : null
  const days = first ? (nowMs - first) / 86400_000 : 0
  const stale = rule.filter((r) => !r.settle && nowMs - Date.parse(r.endDate) > RULE.unsettledAfterDays * 86400_000).length
  const done = (settled.length >= RULE.stopBets && days >= RULE.minDays) || days >= RULE.stopDays
  const s = {
    recorded: recs.length, ruleBets: rule.length, settled: settled.length, unsettledStale: stale,
    days: +days.toFixed(1), stop: `${RULE.stopBets} settled bets and ${RULE.minDays} days, or ${RULE.stopDays} days`, done,
    lastScanAt: state.lastScanAt ?? null, lastSettleAt: state.lastSettleAt ?? null, errors: state.errors ?? 0,
  }
  if (!(done || reveal)) return s
  const gap = rule.filter((r) => r.lastTrade !== null && r.bestAsk !== null).map((r) => r.bestAsk - r.lastTrade)
  s.result = profitPerDollar(settled)
  s.withSlip1c = profitPerDollar(settled, { slip: 0.01 })
  s.hitRate = settled.length ? settled.filter((r) => r.settle.yesPrice === 1).length / settled.length : null
  s.avgFill = settled.length ? settled.reduce((a, r) => a + r.fill.avgPrice, 0) / settled.length : null
  s.askMinusLastTrade = gap.length ? gap.reduce((a, b) => a + b, 0) / gap.length : null
  s.finalVolume1k = profitPerDollar(settled.filter((r) => r.settle.finalVolume >= 1000))
  s.verdict = s.result && s.result.lo > 0 ? 'YES — profitable at real asks' : 'NO — not profitable at real asks'
  return s
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

async function settleAll(state) {
  let n = 0
  for (const r of Object.values(state.records)) {
    if (!r.rule || r.settle || Date.parse(r.endDate) > Date.now()) continue
    try {
      const m = await getJson(`https://gamma-api.polymarket.com/markets/${r.id}`)
      const s = settle(r, m)
      if (s) { r.settle = s; n++ }
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('settle', r.id, e.message) }
  }
  state.lastSettleAt = new Date().toISOString()
  return n
}

async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID
  if (!t || !c) return
  try { await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: c, text }) }) } catch {}
}

function page(s) {
  const rows = Object.entries(s).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
  const res = s.result ? `<pre>${JSON.stringify({ result: s.result, withSlip1c: s.withSlip1c, hitRate: s.hitRate, avgFill: s.avgFill, askMinusLastTrade: s.askMinusLastTrade, finalVolume1k: s.finalVolume1k, verdict: s.verdict }, null, 2)}</pre>`
    : '<p>Profit stays hidden until the registered stop, so nobody is tempted to stop early on a lucky run.</p>'
  return `<!doctype html><meta name=viewport content="width=device-width"><title>Sports paper test</title><body style="font:15px system-ui;margin:16px;max-width:640px"><h2>Polymarket sports paper test</h2><p>No real money. PREREG-POLY-SPORTS.md.</p><table>${rows}</table>${res}</body>`
}

export async function run() {
  const state = load()
  const port = Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 8080), token = process.env.DASHBOARD_TOKEN
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (token && u.searchParams.get('token') !== token) { res.writeHead(401); return res.end('token required') }
    const s = summarise(state)
    if (u.pathname === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(s)) }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(s))
  }).listen(port, () => console.log(`polysports status on :${port}`))
  await telegram('Sports paper test started (no real money). Profit is reported only at the registered stop.')
  let lastSettle = 0, announced = Boolean(state.announced)
  for (;;) {
    try {
      const added = await scan(state)
      if (Date.now() - lastSettle > SETTLE_MS) { const n = await settleAll(state); lastSettle = Date.now(); console.log(`settled ${n}`) }
      save(state)
      const s = summarise(state)
      console.log(`scan +${added} · recorded ${s.recorded} · rule bets ${s.ruleBets} · settled ${s.settled}`)
      if (s.done && !announced) {
        const full = summarise(state, Date.now(), { reveal: true })
        await telegram(`Sports paper test finished: ${full.verdict}\n${full.settled} bets, profit per $1 ${full.result?.perDollar.toFixed(3)} (95% ${full.result?.lo.toFixed(3)} to ${full.result?.hi.toFixed(3)})`)
        state.announced = announced = true; save(state)
      }
    } catch (e) { state.errors = (state.errors ?? 0) + 1; console.error('loop', e.message) }
    await new Promise((r) => setTimeout(r, SCAN_MS))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2] ?? 'run'
  if (cmd === 'run') run()
  else if (cmd === 'summary') console.log(JSON.stringify(summarise(load(), Date.now(), { reveal: process.argv.includes('--reveal') }), null, 2))
  else if (cmd === 'scan-once') { const s = load(); scan(s).then((n) => { save(s); console.log(`recorded ${n}`, JSON.stringify(summarise(s), null, 2)) }) }
  else { console.error('usage: node src/polysports.js run|summary|scan-once'); process.exit(1) }
}
