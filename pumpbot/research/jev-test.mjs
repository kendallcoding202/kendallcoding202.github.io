/**
 * The Jev test, exactly as PREREG-JEV.md and its amendment register it.
 *
 *   JEV_API_KEY=... node research/jev-test.mjs <journal.csv> <outDir>
 *
 * Responses are cached in <outDir> so a rerun never re-asks (and never re-pays for) a
 * question already answered. Phase 1 is instrument check 4 and runs alone; if it fails,
 * the main result is void and is not computed.
 */
import fs from 'node:fs'
import path from 'node:path'

const [csvPath, outDir] = process.argv.slice(2)
const KEY = process.env.JEV_API_KEY
if (!KEY || !csvPath || !outDir) { console.error('usage: JEV_API_KEY=... node research/jev-test.mjs <csv> <outDir>'); process.exit(1) }
fs.mkdirSync(outDir, { recursive: true })

const MODEL = 'jev-latest'          // amendment 1
const SEED = 20261001               // registered
const N = 5000                      // registered
const SPLIT = 0.6                   // registered, by finalizedAt
const PRICE_PER_TOKEN = 0.042 / 1e6 // registered pricing
const HARD_CAP_USD = 5              // registered
const CONCURRENCY = 10
const BLOCK = 50                    // bootstrap block, consecutive rows in time order

// ---------------------------------------------------------------- data
const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
const head = lines[0].split(',')
const idx = Object.fromEntries(head.map((h, i) => [h, i]))
/**
 * ALLOWLIST, never a denylist. Only decision-time features reach the model. f_mayhem is
 * dropped because the mayhem exclusion makes it constant; creatorId is not an f_ column
 * and so never gets in. f_peakMarketCapSol is the running max DURING observation,
 * snapshotted at the decision -- checked before registration.
 */
const FEATURES = head.filter((h) => h.startsWith('f_') && h !== 'f_mayhem')
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null }

const rows = []
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',')
  const pm = num(c[idx.peakMultiple])
  const hit = c[idx.hitFirstRung]
  const fin = num(c[idx.finalizedAt])
  if (!(pm > 0) || pm > 16) continue                 // physically unreachable
  if (num(c[idx.f_mayhem]) === 1) continue           // deflated denominator
  if (hit !== '1' && hit !== '0') continue
  if (fin === null) continue
  rows.push({ label: hit === '1' ? 1 : 0, fin, f: FEATURES.map((k) => num(c[idx[k]])) })
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const rnd = mulberry32(SEED)
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]] }
const sample = rows.slice(0, N).sort((a, b) => a.fin - b.fin)
sample.forEach((r, i) => { r.id = i })
const cut = Math.floor(sample.length * SPLIT)
const IN = sample.slice(0, cut), OUT = sample.slice(cut)

// ---------------------------------------------------------------- the questions
const LABEL = {
  f_agentBuyShare: 'share of buys made by the platform agent', f_agentBuys: 'buys by the platform agent',
  f_agentNetSol: 'platform agent net SOL', f_agentSells: 'sells by the platform agent',
  f_buyAcceleration: 'buy acceleration (later window vs earlier)', f_buySellRatio: 'buy/sell ratio',
  f_buyVolumeSol: 'buy volume (SOL)', f_buys: 'number of buys', f_buysPerBuyer: 'buys per buyer',
  f_creatorLaunchesSeen: "creator's previous launches seen", f_creatorPriorHitRate: "creator's prior share of launches reaching +50%",
  f_creatorTier: 'creator tier', f_devBuySol: "developer's initial buy (SOL)", f_devHoldPct: 'developer holding (% of supply)',
  f_devSold: 'developer has sold (1 = yes)', f_devSoldPct: "share of developer's tokens sold", f_flipRate: 'share of buyers who flipped quickly',
  f_knownBuyers: 'buyers with a track record', f_launchHourUtc: 'launch hour (UTC)', f_launchVSol: 'curve SOL reserve at launch',
  f_launchVTokens: 'curve token reserve at launch', f_marketCapSol: 'market cap at decision (SOL)',
  f_mayhemLikely: 'flagged as possibly non-conserved supply (1 = yes)', f_nameLength: 'name length', f_netVolumeSol: 'net buy volume (SOL)',
  f_observeSeconds: 'seconds observed before the decision', f_organicBuyers: 'organic buyers', f_organicTopBuyerShare: "largest organic buyer's share",
  f_peakMarketCapSol: 'peak market cap during observation (SOL)', f_secondsToFirstBuy: 'seconds to first buy',
  f_sellVolumeSol: 'sell volume (SOL)', f_sells: 'number of sells', f_smartBuyerShare: 'share of buyers with a strong track record',
  f_smartBuyers: 'buyers with a strong track record', f_subLaunchPrice: 'price fell below the launch price (1 = yes)',
  f_symbolLength: 'symbol length', f_top3BuyerShare: 'top 3 buyers’ share', f_topBuyerShare: 'largest buyer’s share',
}
const fmt = (v) => (v === null ? 'unknown' : Math.abs(v) >= 100 ? v.toFixed(0) : +v.toPrecision(3))
const state = (fv) =>
  'A new pump.fun token launch on Solana, observed for its first moments before a buy decision. ' +
  'Measurements at the moment of the decision:\n' + FEATURES.map((k, i) => `- ${LABEL[k] ?? k}: ${fmt(fv[i])}`).join('\n')

const Q_A = { A: { type: 'noul', instructions: 'This launch will reach +50% within its observation window.' } }
const Q_B = {
  B1: { type: 'noul', instructions: 'Buying is driven by many independent wallets rather than a few.' },
  B2: { type: 'noul', instructions: 'The developer still holds a significant share.' },
  B3: { type: 'noul', instructions: 'Buy pressure is accelerating rather than fading.' },
  B4: { type: 'noul', instructions: 'Holdings are concentrated in a small number of wallets.' },
  B5: { type: 'noul', instructions: 'This looks like an organic launch rather than a coordinated one.' },
}

// ---------------------------------------------------------------- the API, cached and capped
const cacheFile = path.join(outDir, 'responses.jsonl')
const cache = new Map()
let tokens = 0
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l); cache.set(r.key, r.answers); tokens += r.tokens ?? 0
}
const spent = () => tokens * PRICE_PER_TOKEN

async function ask(key, st, questions) {
  if (cache.has(key)) return cache.get(key)
  if (spent() > HARD_CAP_USD) throw new Error(`hard cap reached: $${spent().toFixed(2)} — stopping until understood`)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state: st, questions }),
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`)
      const j = await res.json()
      if (!j.answers) throw new Error(JSON.stringify(j).slice(0, 200))
      const answers = Object.fromEntries(Object.entries(j.answers).map(([k, v]) => [k, v.noul]))
      const t = j.usage?.input_tokens ?? 0
      tokens += t
      cache.set(key, answers)
      fs.appendFileSync(cacheFile, JSON.stringify({ key, answers, tokens: t }) + '\n')
      return answers
    } catch (err) {
      if (attempt === 5) throw err
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}
async function pool(items, fn) {
  let next = 0, done = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]); if (++done % 500 === 0) console.error(`  ${done}/${items.length} · $${spent().toFixed(3)}`) }
  }))
}

// ---------------------------------------------------------------- statistics
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const brierRows = (p, y) => p.map((x, i) => (x - y[i]) ** 2)
function blockCI(v, lo = 0.0125, hi = 0.9875, iters = 4000) {
  const r = mulberry32(777), nb = Math.ceil(v.length / BLOCK), out = []
  for (let i = 0; i < iters; i++) { let s = 0, n = 0
    for (let b = 0; b < nb; b++) { const st = Math.floor(r() * (v.length - BLOCK)); for (let k = 0; k < BLOCK; k++) { s += v[st + k]; n++ } }
    out.push(s / n) }
  out.sort((a, b) => a - b)
  const ci = [out[Math.floor(iters * lo)], out[Math.floor(iters * hi)]]
  const m = mean(v)
  if (!(ci[0] <= m && m <= ci[1])) throw new Error(`interval [${ci}] excludes its own mean ${m}`)
  return ci
}
function fitLogistic(X, y, { lambda = 1e-3, iters = 3000, lr = 0.1 } = {}) {
  const d = X[0].length, w = new Array(d + 1).fill(0)
  for (let it = 0; it < iters; it++) {
    const g = new Array(d + 1).fill(0)
    for (let i = 0; i < X.length; i++) {
      let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * X[i][j]
      const e = 1 / (1 + Math.exp(-z)) - y[i]
      for (let j = 0; j < d; j++) g[j] += e * X[i][j]
      g[d] += e
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (g[j] / X.length + lambda * w[j])
    w[d] -= lr * (g[d] / X.length)
  }
  return (x) => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)) }
}
/** Fitted on in-sample only; medians and scales never see the out-of-sample half. */
function standardiser(M) {
  const d = M[0].length, med = [], mu = [], sd = []
  for (let j = 0; j < d; j++) {
    const v = M.map((r) => r[j]).filter((x) => x !== null).sort((a, b) => a - b)
    med[j] = v.length ? v[v.length >> 1] : 0
    const filled = M.map((r) => (r[j] === null ? med[j] : r[j]))
    mu[j] = mean(filled); sd[j] = Math.sqrt(mean(filled.map((x) => (x - mu[j]) ** 2))) || 1
  }
  return (r) => r.map((x, j) => ((x === null ? med[j] : x) - mu[j]) / sd[j])
}
/** Isotonic recalibration (pool-adjacent-violators), fitted in-sample only. */
function isotonic(p, y) {
  const pts = p.map((x, i) => ({ x, y: y[i], w: 1 })).sort((a, b) => a.x - b.x)
  const blocks = []
  for (const q of pts) {
    blocks.push({ lo: q.x, hi: q.x, s: q.y, w: 1 })
    while (blocks.length > 1 && blocks.at(-2).s / blocks.at(-2).w > blocks.at(-1).s / blocks.at(-1).w) {
      const b = blocks.pop(), a = blocks.at(-1); a.hi = b.hi; a.s += b.s; a.w += b.w
    }
  }
  return (x) => { for (const b of blocks) if (x <= b.hi) return b.s / b.w; return blocks.at(-1).s / blocks.at(-1).w }
}
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)) }

// ---------------------------------------------------------------- run
const yIn = IN.map((r) => r.label), yOut = OUT.map((r) => r.label)
const base = mean(yIn)
console.log(`clean rows ${rows.length} · sample ${sample.length} · in ${IN.length} · out ${OUT.length} · base rate (in-sample) ${(base * 100).toFixed(2)}%`)
console.log(`features sent: ${FEATURES.length}`)

if (process.env.DRY) { console.log('\n' + state(OUT[0].f)); process.exit(0) }

// Phase 1 — instrument check 4: features permuted across out-of-sample rows.
console.log('\nPHASE 1 — instrument check 4 (shuffled features)')
const perm = OUT.map((_, i) => i); const r2 = mulberry32(SEED + 4)
for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]] }
await pool(OUT.map((r, i) => i), async (i) => { await ask(`shuf:${OUT[i].id}`, state(OUT[perm[i]].f), Q_A) })
const shufP = OUT.map((r) => cache.get(`shuf:${r.id}`).A)
const climOut = OUT.map(() => base)
const shufGain = brierRows(climOut, yOut).map((c, i) => c - brierRows(shufP, yOut)[i])  // >0 means shuffled BEATS climatology
const shufCI = blockCI(shufGain)
const check4 = !(shufCI[0] > 0)
console.log(`  shuffled Brier ${mean(brierRows(shufP, yOut)).toFixed(5)} vs climatology ${mean(brierRows(climOut, yOut)).toFixed(5)}`)
console.log(`  improvement over climatology ${mean(shufGain).toFixed(5)}  CI [${shufCI[0].toFixed(5)}, ${shufCI[1].toFixed(5)}]`)
console.log(`  check 4: ${check4 ? 'PASS — shuffled features do not beat the base rate' : 'FAIL — something other than the features carries signal; main result VOID'}`)
console.log(`  spent so far $${spent().toFixed(3)}`)
if (!check4) process.exit(2)

// Phase 2 — the registered test.
console.log('\nPHASE 2 — the registered test')
await pool(sample, async (r) => { await ask(`real:${r.id}`, state(r.f), { ...Q_A, ...Q_B }) })
const ans = (r) => cache.get(`real:${r.id}`)

const S = standardiser(IN.map((r) => r.f))
const lrModel = fitLogistic(IN.map((r) => S(r.f)), yIn)
const pLR = OUT.map((r) => lrModel(S(r.f)))

const rawA_in = IN.map((r) => ans(r).A), rawA_out = OUT.map((r) => ans(r).A)
const iso = isotonic(rawA_in, yIn)
const pA = rawA_out.map(iso)

const bKeys = ['B1', 'B2', 'B3', 'B4', 'B5']
const bModel = fitLogistic(IN.map((r) => bKeys.map((k) => logit(ans(r)[k]))), yIn)
const pB = OUT.map((r) => bModel(bKeys.map((k) => logit(ans(r)[k]))))

const B = (p) => mean(brierRows(p, yOut))
console.log(`\n  out-of-sample Brier (lower is better), n=${OUT.length}`)
console.log(`    climatology           ${B(climOut).toFixed(5)}`)
console.log(`    logistic regression   ${B(pLR).toFixed(5)}`)
console.log(`    Jev A raw             ${B(rawA_out).toFixed(5)}   (the vendor's calibration claim)`)
console.log(`    Jev A recalibrated    ${B(pA).toFixed(5)}`)
console.log(`    Jev B decomposed      ${B(pB).toFixed(5)}`)

const verdict = []
for (const [name, p] of [['A', pA], ['B', pB]]) {
  const gain = brierRows(pLR, yOut).map((x, i) => x - brierRows(p, yOut)[i])   // >0 means Jev beats LR
  const ci = blockCI(gain)
  const beats = ci[0] > 0
  verdict.push(beats)
  console.log(`\n  Jev ${name} vs logistic regression: improvement ${mean(gain).toFixed(5)}  CI(0.025) [${ci[0].toFixed(5)}, ${ci[1].toFixed(5)}]  -> ${beats ? 'BEATS' : 'does not beat'}`)
}

console.log('\n  raw Jev A reliability (deciles of the raw probability)')
const ord = rawA_out.map((p, i) => [p, yOut[i]]).sort((a, b) => a[0] - b[0])
for (let d = 0; d < 10; d++) {
  const s = ord.slice(Math.floor(d * ord.length / 10), Math.floor((d + 1) * ord.length / 10))
  console.log(`    predicted ${(mean(s.map((x) => x[0])) * 100).toFixed(1).padStart(5)}%   observed ${(mean(s.map((x) => x[1])) * 100).toFixed(1).padStart(5)}%   n=${s.length}`)
}
console.log(`\n  spent $${spent().toFixed(3)} of the $${HARD_CAP_USD} cap · instrument noise sd 0.007 (amendment 1)`)
console.log(`\n  VERDICT: ${verdict.some(Boolean) ? 'Brier bar MET — strategy check must be fixed by amendment before it runs' : 'NO — Jev does not beat a free logistic regression on the same numbers'}`)
