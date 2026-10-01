/**
 * The weather test, exactly as PREREG-WEATHER.md registers it.
 *
 *   node research/weather-test.mjs <polymarketDir> <airports.csv> <outDir>
 *
 * <polymarketDir> holds population.json and prices.jsonl from research/polymarket-jev.mjs;
 * prices fetched here are appended to the same cache. STOP_BEFORE_FORECAST=1 stops after
 * the prices, before any forecast is fetched or any outcome is used.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const [pmDir, airportsCsv, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const SEED = 20261001, N = 5000, BLOCK_DAYS = 3
const HALF_SPREADS = [0.02, 0.01, 0.04]          // first is primary
function get(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return JSON.parse(execFileSync('curl', ['-sS', '--fail', '--max-time', '90', url], { encoding: 'utf8', maxBuffer: 256 << 20 })) }
    catch (e) { if (attempt === 6) throw e; execFileSync('sleep', [String(5 * attempt)]) }
  }
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// ---------------------------------------------------------------- markets, stations, buckets
const airports = new Map()
{
  const lines = fs.readFileSync(airportsCsv, 'utf8').split('\n'), head = lines[0].split(',').map((h) => h.replace(/"/g, ''))
  const iI = head.indexOf('ident'), iLat = head.indexOf('latitude_deg'), iLon = head.indexOf('longitude_deg')
  for (const l of lines.slice(1)) { const c = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '')); if (c && c[iI]) airports.set(c[iI].toUpperCase(), [+c[iLat], +c[iLon]]) }
}
const HKO = [22.302, 114.174]
function stationOf(desc) {
  if (/Hong Kong Observatory/i.test(desc)) return { id: 'HKO', ll: HKO }
  const m = desc.match(/wunderground\.com\/history\/daily\/\S*?\/([A-Za-z0-9]{4})\b/) ?? desc.match(/timeseries\?site=([A-Za-z0-9]{4})\b/)
  if (!m) return null
  const id = m[1].toUpperCase(), ll = airports.get(id)
  return ll ? { id, ll } : null
}
function bucketOf(q) {
  const unit = /°F/.test(q) ? 'F' : /°C/.test(q) ? 'C' : null
  let m
  if ((m = q.match(/between (-?\d+)\s*-\s*(-?\d+)°/))) return { unit, lo: +m[1], hi: +m[2] }
  if ((m = q.match(/be (-?\d+)°[CF] or (higher|above)/))) return { unit, lo: +m[1], hi: Infinity }
  if ((m = q.match(/be (-?\d+)°[CF] or (below|lower)/))) return { unit, lo: -Infinity, hi: +m[1] }
  if ((m = q.match(/be (-?\d+)°[CF]/))) return { unit, lo: +m[1], hi: +m[1] }
  return null
}
const pop = JSON.parse(fs.readFileSync(path.join(pmDir, 'population.json'), 'utf8'))
const all = [], dropped = { station: 0, bucket: 0 }
for (const m of pop) {
  const k = m.q.match(/^Will the (highest|lowest) temperature in /i); if (!k) continue
  const st = stationOf(m.desc); if (!st) { dropped.station++; continue }
  const b = bucketOf(m.q); if (!b || !b.unit) { dropped.bucket++; continue }
  const date = m.end.slice(0, 10), kind = k[1].toLowerCase()
  all.push({ ...m, st: st.id, ll: st.ll, kind, date, ...b, event: `${st.id}|${date}|${kind}` })
}
console.log(`temperature markets ${all.length} · dropped: station unparsed ${dropped.station}, bucket unparsed ${dropped.bucket} · stations ${new Set(all.map((m) => m.st)).size}`)

// Truth per event, from every market in it (not only sampled ones): the bucket that resolved Yes.
const truth = new Map()
for (const m of all) if (m.yes === 1) truth.set(m.event, truth.has(m.event) ? null : { lo: m.lo, hi: m.hi, unit: m.unit })

// ---------------------------------------------------------------- sample + prices
const order = all.map((_, i) => i).sort((a, b) => all[a].id.localeCompare(all[b].id)), rnd = mulberry32(SEED)
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
const sample = order.slice(0, N).map((i) => all[i])
const pricesFile = path.join(pmDir, 'prices.jsonl'), priced = new Map()
if (fs.existsSync(pricesFile)) for (const l of fs.readFileSync(pricesFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); priced.set(r.id, r) }
let n = 0
for (const m of sample) {
  if (priced.has(m.id)) continue
  const decision = Date.parse(m.end) / 1000 - 86400
  const h = get(`https://clob.polymarket.com/prices-history?market=${m.token}&startTs=${decision - 6 * 3600}&endTs=${decision}&fidelity=60`).history ?? []
  const pt = h.filter((x) => x.t <= decision).at(-1)
  const r = { id: m.id, price: pt ? pt.p : null, at: pt ? pt.t : null }
  priced.set(m.id, r); fs.appendFileSync(pricesFile, JSON.stringify(r) + '\n')
  if (++n % 250 === 0) console.error(`  prices fetched ${n}`)
}
const noPrice = sample.filter((m) => priced.get(m.id).price === null).length
const extreme = sample.filter((m) => { const p = priced.get(m.id).price; return p !== null && (p < 0.02 || p > 0.98) }).length
const rows = sample.filter((m) => { const p = priced.get(m.id).price; return p !== null && p >= 0.02 && p <= 0.98 }).map((m) => ({ ...m, price: priced.get(m.id).price }))
console.log(`sample ${sample.length} · dropped: no price ${noPrice}, outside 0.02–0.98 ${extreme} · kept ${rows.length}`)
if (process.env.STOP_BEFORE_FORECAST) process.exit(0)

// ---------------------------------------------------------------- forecasts (previous_day2 only)
const fcFile = path.join(outDir, 'forecasts.json')
const fc = fs.existsSync(fcFile) ? JSON.parse(fs.readFileSync(fcFile, 'utf8')) : {}
const stations = new Map(all.map((m) => [m.st, m.ll]))
for (const [id, [lat, lon]] of stations) {
  if (fc[id]) continue
  const j = get(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m_previous_day2&timezone=auto&start_date=2026-07-30&end_date=2026-10-01`)
  const days = {}
  j.hourly.time.forEach((t, i) => { const v = j.hourly.temperature_2m_previous_day2[i]; if (v === null) return; const d = t.slice(0, 10); (days[d] ??= []).push(v) })
  fc[id] = Object.fromEntries(Object.entries(days).filter(([, v]) => v.length === 24).map(([d, v]) => [d, { hi: Math.max(...v), lo: Math.min(...v) }]))
  fs.writeFileSync(fcFile, JSON.stringify(fc))
  execFileSync('sleep', ['1'])
}
const toUnit = (c, unit) => (unit === 'F' ? c * 9 / 5 + 32 : c)
const forecastFor = (m, date = m.date) => { const d = fc[m.st]?.[date]; return d ? toUnit(m.kind === 'highest' ? d.hi : d.lo, m.unit) : null }

// ---------------------------------------------------------------- check 2: is previous_day2 really an earlier run?
{
  const ids = [...stations.keys()].sort().slice(0, 20), diffs = []
  for (const id of ids) {
    const [lat, lon] = stations.get(id)
    const j = get(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&timezone=auto&start_date=2026-08-20&end_date=2026-08-20`)
    const v = j.hourly.temperature_2m.filter((x) => x !== null)
    if (v.length === 24 && fc[id]?.['2026-08-20']) diffs.push(Math.abs(Math.max(...v) - fc[id]['2026-08-20'].hi))
    execFileSync('sleep', ['1'])
  }
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length
  console.log(`\nCHECK 2 — previous_day2 vs stitched latest forecast, ${diffs.length} station-days: mean |diff| of daily high ${mean.toFixed(2)}°C, identical on ${diffs.filter((d) => d === 0).length} → ${diffs.length >= 10 && diffs.filter((d) => d === 0).length < diffs.length / 2 ? 'PASS' : 'FAIL'}`)
  if (!(diffs.length >= 10 && diffs.filter((d) => d === 0).length < diffs.length / 2)) process.exit(2)
}

// ---------------------------------------------------------------- split by date, fit in-sample
const dates = [...new Set(all.map((m) => m.date))].sort(), cutDate = dates[Math.floor(dates.length * 0.6)]
const isIn = (d) => d < cutDate
const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p }
const pBucket = (f, b, s, lo, hi) => Math.min(1 - 1e-4, Math.max(1e-4, (hi === Infinity ? 1 : Phi((hi + 0.5 - f - b) / s)) - (lo === -Infinity ? 0 : Phi((lo - 0.5 - f - b) / s))))
function fit(evs) {
  let best = null
  for (let b = -6; b <= 6.001; b += 0.1) for (let s = 0.4; s <= 7; s += 0.05) {
    let ll = 0; for (const e of evs) ll += Math.log(pBucket(e.f, b, s, e.lo, e.hi))
    if (!best || ll > best.ll) best = { b, s, ll }
  }
  return best
}
const evIn = new Map()
for (const m of all) {
  if (!isIn(m.date) || evIn.has(m.event)) continue
  const t = truth.get(m.event), f = forecastFor(m)
  if (t && f !== null) evIn.set(m.event, { st: m.st, kind: m.kind, unit: m.unit, f, lo: t.lo, hi: t.hi })
}
const groups = new Map()
for (const e of evIn.values()) for (const k of [`${e.st}|${e.kind}`, `pool|${e.kind}|${e.unit}`]) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e) }
const params = new Map()
for (const [k, evs] of groups) if (k.startsWith('pool') || evs.length >= 15) params.set(k, fit(evs))
const paramFor = (m) => params.get(`${m.st}|${m.kind}`) ?? params.get(`pool|${m.kind}|${m.unit}`)
const poolHiC = params.get('pool|highest|C')
console.log(`\nin-sample: ${evIn.size} events with a forecast and a known winning bucket, dates before ${cutDate}`)
for (const k of [...params.keys()].filter((k) => k.startsWith('pool'))) console.log(`  ${k}: bias ${params.get(k).b.toFixed(1)}, σ ${params.get(k).s.toFixed(2)} (n=${groups.get(k).length})`)
console.log(`CHECK 1 — pooled σ for highs (°C) ${poolHiC.s.toFixed(2)} < 3 → ${poolHiC.s < 3 ? 'PASS' : 'FAIL'}`)
if (!(poolHiC.s < 3)) process.exit(2)

const modelP = (m, date) => { const f = forecastFor(m, date), p = paramFor(m); return f === null || !p ? null : pBucket(f, p.b, p.s, m.lo, m.hi) }
const scored = rows.map((m) => ({ ...m, model: modelP(m) })).filter((m) => m.model !== null)
console.log(`priced rows with a forecast: ${scored.length} of ${rows.length}`)
const IN = scored.filter((m) => isIn(m.date)), OUT = scored.filter((m) => !isIn(m.date))
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)) }
function fitLogistic(X, y, { iters = 6000, lr = 0.2 } = {}) {
  const d = X[0].length, w = new Array(d + 1).fill(0)
  for (let it = 0; it < iters; it++) { const g = new Array(d + 1).fill(0)
    for (let i = 0; i < X.length; i++) { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * X[i][j]; const e = 1 / (1 + Math.exp(-z)) - y[i]; for (let j = 0; j < d; j++) g[j] += e * X[i][j]; g[d] += e }
    for (let j = 0; j <= d; j++) w[j] -= lr * g[j] / X.length }
  return { w, f: (x) => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)) } }
}
const comb = fitLogistic(IN.map((m) => [logit(m.price), logit(m.model)]), IN.map((m) => m.yes))
console.log(`combiner weights: market ${comb.w[0].toFixed(2)}, model ${comb.w[1].toFixed(2)}, intercept ${comb.w[2].toFixed(2)} (in-sample n=${IN.length})`)

// ---------------------------------------------------------------- scoring
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const brier = (p, y) => p.map((x, i) => (x - y[i]) ** 2)
function blockCI(vals, ds, lo = 0.0125, hi = 0.9875, iters = 4000) {
  const by = new Map(); vals.forEach((v, i) => { const b = Math.floor(Date.parse(ds[i]) / (BLOCK_DAYS * 86400_000)); if (!by.has(b)) by.set(b, []); by.get(b).push(v) })
  const blocks = [...by.values()], r = mulberry32(777), out = []
  for (let k = 0; k < iters; k++) { let s = 0, c = 0; for (let j = 0; j < blocks.length; j++) { for (const v of blocks[Math.floor(r() * blocks.length)]) { s += v; c++ } } out.push(s / c) }
  out.sort((a, b) => a - b); return [out[Math.floor(iters * lo)], out[Math.floor(iters * hi)]]
}
const y = OUT.map((m) => m.yes), ds = OUT.map((m) => m.date)
const pMkt = OUT.map((m) => m.price), pModel = OUT.map((m) => m.model), pComb = OUT.map((m) => comb.f([logit(m.price), logit(m.model)]))

// CHECK 3 — shuffled forecasts (another date, same station) must not beat the market.
const r3 = mulberry32(20261004), stDates = new Map()
for (const id of stations.keys()) stDates.set(id, Object.keys(fc[id] ?? {}).filter((d) => d >= '2026-08-01' && d <= '2026-09-30'))
const pShuf = OUT.map((m) => { const ds2 = stDates.get(m.st).filter((d) => d !== m.date); const d = ds2[Math.floor(r3() * ds2.length)]; const p = modelP(m, d) ?? m.price; return comb.f([logit(m.price), logit(p)]) })
const shufGain = brier(pMkt, y).map((x, i) => x - brier(pShuf, y)[i]), shufCI = blockCI(shufGain, ds)
console.log(`\nCHECK 3 — shuffled forecasts: beat market by ${mean(shufGain).toFixed(5)} [${shufCI.map((x) => x.toFixed(5)).join(', ')}] → ${shufCI[0] > 0 ? 'FAIL — VOID' : 'PASS'}`)
if (shufCI[0] > 0) process.exit(2)

console.log(`\nout-of-sample: ${OUT.length} markets, ${new Set(ds).size} dates from ${cutDate}`)
for (const [k, p] of [['market', pMkt], ['model alone', pModel], ['market + model', pComb]]) console.log(`  ${k.padEnd(16)} Brier ${mean(brier(p, y)).toFixed(5)}`)
const info = brier(pMkt, y).map((x, i) => x - brier(pComb, y)[i]), infoCI = blockCI(info, ds)
console.log(`  1. information: combined beats market by ${mean(info).toFixed(5)} [${infoCI.map((x) => x.toFixed(5)).join(', ')}] → ${infoCI[0] > 0 ? 'YES' : 'no'}`)

const fee = (m, p) => (m.fee ? m.fee.rate * p * (p * (1 - p)) ** (m.fee.exponent ?? 1) : 0)
function bets(probs, hs) {
  const out = []
  OUT.forEach((m, i) => {
    const p = probs[i], yc = m.price + hs, nc = 1 - m.price + hs
    const ya = yc + fee(m, yc), na = nc + fee(m, nc)
    if (yc < 1 && p > ya) out.push({ m, side: 'YES', pnl: (m.yes - ya) / ya, win: m.yes })
    else if (nc < 1 && 1 - p > na) out.push({ m, side: 'NO', pnl: (1 - m.yes - na) / na, win: 1 - m.yes })
  })
  return out
}
for (const [k, probs] of [['market + model', pComb], ['model alone', pModel]]) for (const hs of HALF_SPREADS) {
  const b = bets(probs, hs), primary = k === 'market + model' && hs === HALF_SPREADS[0]
  if (!b.length) { console.log(`  ${primary ? '2.' : '  '} ${k}, half-spread ${hs}: no bets`); continue }
  const ci = blockCI(b.map((x) => x.pnl), b.map((x) => x.m.date))
  console.log(`  ${primary ? '2.' : '  '} ${k}, half-spread ${hs}: ${b.length} bets (${b.filter((x) => x.side === 'YES').length} YES), win ${(mean(b.map((x) => x.win)) * 100).toFixed(1)}%, profit/$ ${mean(b.map((x) => x.pnl)).toFixed(4)} [${ci.map((x) => x.toFixed(4)).join(', ')}]${primary ? (ci[0] > 0 ? ' → YES' : ' → no') : ''}`)
}
const prim = bets(pComb, HALF_SPREADS[0])
if (prim.length) {
  console.log('\n  primary bets by kind / unit:')
  for (const [k, f] of [['highs', (x) => x.m.kind === 'highest'], ['lows', (x) => x.m.kind === 'lowest'], ['°C', (x) => x.m.unit === 'C'], ['°F', (x) => x.m.unit === 'F']]) { const s = prim.filter(f); if (s.length) console.log(`    ${k.padEnd(6)} ${String(s.length).padStart(4)} bets, profit/$ ${mean(s.map((x) => x.pnl)).toFixed(4)}`) }
  console.log(`  bets per out-of-sample day: ${(prim.length / new Set(ds).size).toFixed(1)} (from a ${N}-market sample of ${all.length})`)
}
