/**
 * The Jev-vs-Polymarket test, exactly as PREREG-JEV-POLYMARKET.md registers it.
 *
 *   JEV_API_KEY=... node research/polymarket-jev.mjs <outDir>
 *
 * Stages are cached in <outDir>: population, sample, prices, Jev answers. A rerun resumes.
 * The hindsight check prints and stops the run before the main result if it fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const outDir = process.argv[2]
const KEY = process.env.JEV_API_KEY
if (!outDir || !KEY) { console.error('usage: JEV_API_KEY=... node research/polymarket-jev.mjs <outDir>'); process.exit(1) }
fs.mkdirSync(outDir, { recursive: true })
const file = (n) => path.join(outDir, n)
const SEED = 20261001, N = 3000, HALF_SPREAD = 0.01, BLOCK_DAYS = 3
const PRICE_PER_TOKEN = 0.042 / 1e6, HARD_CAP_USD = 5

// curl, not fetch: Node's fetch is refused by this environment's proxy for some hosts.
function get(url) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { return JSON.parse(execFileSync('curl', ['-sS', '--fail', '--max-time', '60', url], { encoding: 'utf8', maxBuffer: 256 << 20 })) }
    catch (e) { if (attempt === 5) throw e; execFileSync('sleep', [String(2 * attempt)]) }
  }
}

// ---------------------------------------------------------------- population
let pop
if (fs.existsSync(file('population.json'))) pop = JSON.parse(fs.readFileSync(file('population.json'), 'utf8'))
else {
  pop = []
  for (let d = Date.UTC(2026, 7, 1); d < Date.UTC(2026, 9, 1); d += 86400_000) {
    const day = (t) => new Date(t).toISOString().slice(0, 19) + 'Z'
    let cursor = null, n = 0, lastFirst = null
    do {
      const q = new URLSearchParams({ closed: 'true', limit: '100', volume_num_min: '1000', end_date_min: day(d), end_date_max: day(d + 86400_000 - 1000) })
      if (cursor) q.set('after_cursor', cursor)   // the response calls it next_cursor; the request param is after_cursor
      const page = get('https://gamma-api.polymarket.com/markets/keyset?' + q)
      const first = page.markets?.[0]?.id
      if (first && first === lastFirst) throw new Error('keyset cursor did not advance')
      lastFirst = first
      for (const m of page.markets ?? []) {
        n++
        if (m.outcomes !== '["Yes", "No"]') continue
        const op = JSON.parse(m.outcomePrices ?? '[]').map(Number)
        if (!((op[0] === 1 && op[1] === 0) || (op[0] === 0 && op[1] === 1))) continue   // resolved cleanly
        pop.push({ id: m.id, q: m.question, desc: (m.description ?? '').slice(0, 1500), end: m.endDate,
          yes: op[0], token: JSON.parse(m.clobTokenIds)[0], vol: m.volumeNum, fee: m.feeSchedule ?? null, feeType: m.feeType ?? null })
      }
      cursor = page.next_cursor
    } while (cursor)
    console.error(`  ${new Date(d).toISOString().slice(0, 10)}: ${n} markets seen, population ${pop.length}`)
  }
  fs.writeFileSync(file('population.json'), JSON.stringify(pop))
}
console.log(`population (Yes/No, vol >= $1k, ended Aug–Sep, cleanly resolved): ${pop.length}`)

// ---------------------------------------------------------------- sample + decision prices
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const order = pop.map((_, i) => i).sort((a, b) => pop[a].id.localeCompare(pop[b].id))   // stable before shuffling
const rnd = mulberry32(SEED)
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
const sample = order.slice(0, N).map((i) => pop[i])

const pricesFile = file('prices.jsonl'), priced = new Map()
if (fs.existsSync(pricesFile)) for (const l of fs.readFileSync(pricesFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); priced.set(r.id, r) }
let done = 0
for (const m of sample) {
  if (priced.has(m.id)) continue
  const decision = Date.parse(m.end) / 1000 - 86400
  const h = get(`https://clob.polymarket.com/prices-history?market=${m.token}&startTs=${decision - 6 * 3600}&endTs=${decision}&fidelity=60`).history ?? []
  const pt = h.filter((x) => x.t <= decision).at(-1)
  const r = { id: m.id, price: pt ? pt.p : null, at: pt ? pt.t : null }
  priced.set(m.id, r); fs.appendFileSync(pricesFile, JSON.stringify(r) + '\n')
  if (++done % 250 === 0) console.error(`  prices ${priced.size}/${sample.length}`)
}
const noPrice = sample.filter((m) => priced.get(m.id).price === null).length
const extreme = sample.filter((m) => { const p = priced.get(m.id).price; return p !== null && (p < 0.02 || p > 0.98) }).length
const rows = sample.filter((m) => { const p = priced.get(m.id).price; return p !== null && p >= 0.02 && p <= 0.98 })
  .map((m) => ({ ...m, price: priced.get(m.id).price, decision: Date.parse(m.end) - 86400_000 }))
console.log(`sample ${sample.length} · dropped: no price in 6h before decision ${noPrice}, price outside 0.02–0.98 ${extreme} · kept ${rows.length}`)
if (process.env.STOP_BEFORE_JEV) process.exit(0)

// ---------------------------------------------------------------- Jev
const cacheFile = file('jev.jsonl'), cache = new Map(); let tokens = 0
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); cache.set(r.key, r.p); tokens += r.tokens }
const spent = () => tokens * PRICE_PER_TOKEN
async function ask(key, state, instruction) {
  if (cache.has(key)) return cache.get(key)
  if (spent() > HARD_CAP_USD) throw new Error(`hard cap reached $${spent().toFixed(2)}`)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state, questions: { q: { type: 'noul', instructions: instruction } } }) })
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`)
      const j = await res.json(); if (!j.answers) throw new Error(JSON.stringify(j).slice(0, 200))
      const p = j.answers.q.noul, t = j.usage?.input_tokens ?? 0
      tokens += t; cache.set(key, p); fs.appendFileSync(cacheFile, JSON.stringify({ key, p, tokens: t }) + '\n'); return p
    } catch (e) { if (attempt === 5) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)) }
  }
}
async function pool(items, fn, conc = 10) { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) await fn(items[i++]) })) }
const day = (t) => new Date(t).toISOString().slice(0, 10)
const stateOf = (m, question = m.q) => `Today is ${day(m.decision)}. A prediction market asks:\n${question}\n\nResolution rules:\n${m.desc}`
await pool(rows, async (m) => { m.jev = await ask(`blind:${m.id}`, stateOf(m), 'This question will resolve Yes.') })
console.log(`Jev answered ${rows.length} markets · spent $${spent().toFixed(3)}`)

// ---------------------------------------------------------------- statistics
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)) }
/** Block bootstrap by end date: markets ending on the same days move together. */
function blockCI(vals, dates, lo, hi, iters = 4000) {
  const byBlock = new Map()
  vals.forEach((v, i) => { const b = Math.floor(Date.parse(dates[i]) / (BLOCK_DAYS * 86400_000)); if (!byBlock.has(b)) byBlock.set(b, []); byBlock.get(b).push(v) })
  const blocks = [...byBlock.values()], r = mulberry32(777), out = []
  for (let k = 0; k < iters; k++) { let s = 0, n = 0; for (let j = 0; j < blocks.length; j++) { const b = blocks[Math.floor(r() * blocks.length)]; for (const v of b) { s += v; n++ } } out.push(s / n) }
  out.sort((a, b) => a - b); return [out[Math.floor(iters * lo)], out[Math.floor(iters * hi)]]
}
function fitLogistic(X, y, { iters = 5000, lr = 0.2 } = {}) {
  const d = X[0].length, w = new Array(d + 1).fill(0)
  for (let it = 0; it < iters; it++) { const g = new Array(d + 1).fill(0)
    for (let i = 0; i < X.length; i++) { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * X[i][j]; const e = 1 / (1 + Math.exp(-z)) - y[i]; for (let j = 0; j < d; j++) g[j] += e * X[i][j]; g[d] += e }
    for (let j = 0; j <= d; j++) w[j] -= lr * g[j] / X.length }
  return (x) => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)) }
}
function isotonic(p, y) {
  const pts = p.map((x, i) => ({ x, y: y[i] })).sort((a, b) => a.x - b.x), bl = []
  for (const q of pts) { bl.push({ hi: q.x, s: q.y, w: 1 }); while (bl.length > 1 && bl.at(-2).s / bl.at(-2).w > bl.at(-1).s / bl.at(-1).w) { const b = bl.pop(), a = bl.at(-1); a.hi = b.hi; a.s += b.s; a.w += b.w } }
  return (x) => { for (const b of bl) if (x <= b.hi) return b.s / b.w; return bl.at(-1).s / bl.at(-1).w }
}
const brier = (p, y) => p.map((x, i) => (x - y[i]) ** 2)

// ---------------------------------------------------------------- check 1: hindsight
const UNFORECASTABLE = /(highest|lowest) temperature in .+ be (between )?-?\d+|exact score/i
const hs = rows.filter((m) => UNFORECASTABLE.test(m.q))
const hsGain = brier(hs.map((m) => m.price), hs.map((m) => m.yes)).map((x, i) => x - brier(hs.map((m) => m.jev), hs.map((m) => m.yes))[i])
const hsCI = blockCI(hsGain, hs.map((m) => m.end), 0.05, 0.95)
const hindsightPass = !(hsCI[0] > 0)
console.log(`\nCHECK 1 — hindsight, on ${hs.length} unforecastable markets (exact temperature buckets, exact scores)`)
console.log(`  market Brier ${mean(brier(hs.map((m) => m.price), hs.map((m) => m.yes))).toFixed(4)} · Jev Brier ${mean(brier(hs.map((m) => m.jev), hs.map((m) => m.yes))).toFixed(4)} · Jev better by ${mean(hsGain).toFixed(4)} [5%: ${hsCI[0].toFixed(4)}]`)
console.log(`  ${hindsightPass ? 'PASS — Jev does not beat the market where only memory could' : 'FAIL — Jev beats the market on unforecastable questions: it remembers. Backtest VOID.'}`)

// ---------------------------------------------------------------- check 2: reads its input
const neg = mulberry32(SEED + 2), probe = [...rows].sort(() => neg() - 0.5).slice(0, 50)
// Amendment 2: the first probe negated the question but not the rules beneath it, contradicting itself.
await pool(probe, async (m) => { m.jevNeg = await ask(`no:${m.id}`, stateOf(m), 'This question will resolve No.') })
const moved = probe.filter((m) => (m.jevNeg - 0.5) * (m.jev - 0.5) < 0 || Math.abs(m.jevNeg - (1 - m.jev)) < Math.abs(m.jevNeg - m.jev)).length
console.log(`\nCHECK 2 — reads its input: negation moved the answer the other way on ${moved}/50 (need >= 45) → ${moved >= 45 ? 'PASS' : 'FAIL'}`)
if (!hindsightPass || moved < 45) { console.log('\nInstrument failed — main result not computed.'); process.exit(2) }

// ---------------------------------------------------------------- the registered comparison
rows.sort((a, b) => Date.parse(a.end) - Date.parse(b.end))
const cut = Math.floor(rows.length * 0.6), IN = rows.slice(0, cut), OUT = rows.slice(cut)
const yIn = IN.map((m) => m.yes), yOut = OUT.map((m) => m.yes)
const iso = isotonic(IN.map((m) => m.jev), yIn)
const comb = fitLogistic(IN.map((m) => [logit(m.price), logit(iso(m.jev))]), yIn)
const pMkt = OUT.map((m) => m.price), pJev = OUT.map((m) => iso(m.jev)), pComb = OUT.map((m) => comb([logit(m.price), logit(iso(m.jev))]))
console.log(`\nout-of-sample: ${OUT.length} markets ending ${day(Date.parse(OUT[0].end))} → ${day(Date.parse(OUT.at(-1).end))}`)
for (const [n, p] of [['market', pMkt], ['Jev (recalibrated)', pJev], ['Jev (raw)', OUT.map((m) => m.jev)], ['market + Jev', pComb]])
  console.log(`  ${n.padEnd(20)} Brier ${mean(brier(p, yOut)).toFixed(5)}`)
const infoGain = brier(pMkt, yOut).map((x, i) => x - brier(pComb, yOut)[i])
const infoCI = blockCI(infoGain, OUT.map((m) => m.end), 0.0125, 0.9875)
console.log(`  1. information: market + Jev beats market by ${mean(infoGain).toFixed(5)} [${infoCI.map((x) => x.toFixed(5)).join(', ')}] → ${infoCI[0] > 0 ? 'YES' : 'no'}`)

const feeNew = (m, p) => (m.fee ? m.fee.rate * p * (p * (1 - p)) ** (m.fee.exponent ?? 1) : 0)
const feeOld = (m, p) => (m.fee ? m.fee.rate * Math.min(p, 1 - p) : 0)
function strategy(feeFn) {
  const bets = []
  OUT.forEach((m, i) => {
    const p = pComb[i]
    const yesCost = m.price + HALF_SPREAD, noCost = 1 - m.price + HALF_SPREAD
    const yesAll = yesCost + feeFn(m, yesCost), noAll = noCost + feeFn(m, noCost)
    if (p > yesAll) bets.push({ end: m.end, pnl: (m.yes - yesAll) / yesAll, win: m.yes })
    else if (1 - p > noAll) bets.push({ end: m.end, pnl: (1 - m.yes - noAll) / noAll, win: 1 - m.yes })
  })
  return bets
}
for (const [name, fn, decides] of [['primary fee', feeNew, true], ['harsher fee bound', feeOld, false]]) {
  const b = strategy(fn)
  if (!b.length) { console.log(`  2. money (${name}): no bets cleared the cost`); continue }
  const ci = blockCI(b.map((x) => x.pnl), b.map((x) => x.end), 0.0125, 0.9875)
  console.log(`  ${decides ? '2.' : '  '} money (${name}): ${b.length} bets, win rate ${(mean(b.map((x) => x.win)) * 100).toFixed(1)}%, profit per $1 ${mean(b.map((x) => x.pnl)).toFixed(4)} [${ci.map((x) => x.toFixed(4)).join(', ')}]${decides ? (ci[0] > 0 ? ' → YES' : ' → no') : ' (reported only)'}`)
}
console.log(`\nspent $${spent().toFixed(3)} of $${HARD_CAP_USD}`)
