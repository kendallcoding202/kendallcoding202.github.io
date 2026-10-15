/**
 * Evaluates the Polymarket sports paper tests from the dashboard's "Download all data" file.
 *
 *   node research/polysports-eval.mjs <polysports-export.jsonl.gz> [--verify 40]
 *
 * Prints a markdown report: per test, the result after real fees and before them, whether
 * cheap contracts won more often than their price said, breakdowns by price, sport, bet type
 * and day, how much rests on a few matches, calibration, and data-quality checks. Intervals
 * resample whole matches (the registered unit). --verify N re-reads N settled bets from
 * Polymarket and checks the recorded outcome against Polymarket's.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { profitPerDollar, takerFee, ARM_INFO } from '../src/polysports.js'

const [file, ...rest] = process.argv.slice(2)
if (!file) { console.error('usage: node research/polysports-eval.mjs <export.jsonl.gz> [--verify N]'); process.exit(1) }
const verifyN = rest.includes('--verify') ? Number(rest[rest.indexOf('--verify') + 1] ?? 40) : 0

const raw = fs.readFileSync(file)
const text = file.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
const meta = lines.find((l) => l.kind === 'meta') ?? {}
const bets = lines.filter((l) => l.kind === 'bet')
const cal = lines.filter((l) => l.kind === 'cal')

const out = []
const say = (s = '') => out.push(s)
const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%')
const plain = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%')
const usd = (x) => (x >= 0 ? '+$' : '−$') + Math.abs(x).toFixed(2)
const c = (p) => (p * 100).toFixed(1) + '¢'
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const groupBy = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) } return m }

/** Pre-fee twin of a bet: same outcome, cost without the fee. */
const preFee = (b) => ({ ...b, settle: { ...b.settle, pnl: b.settle.pnl + b.fee, cost: b.settle.cost - b.fee } })
const res = (list, opts = {}) => (list.length ? profitPerDollar(list, { iters: 3000, ...opts }) : null)
const won = (b) => b.settle.yesPrice === 1
function line(label, list) {
  const r = res(list), pre = res(list.map(preFee))
  if (!r) return `| ${label} | 0 | | | | | |`
  return `| ${label} | ${list.length} | ${r.events} | ${plain(mean(list.map((b) => b.settle.yesPrice)))} vs ${c(mean(list.map((b) => b.fill.avgPrice)))} | ${pct(pre.perDollar)} | ${pct(r.perDollar)} [${pct(r.lo)}, ${pct(r.hi)}] | ${usd(r.pnl)} |`
}
const HEAD = '| slice | bets | matches | won vs paid | per $1 before fees | per $1 after fees [95% range] | net |\n|---|---|---|---|---|---|---|'

say(`# Polymarket sports paper tests — evaluation`)
say(`Export ${meta.exportedAt ?? '?'} · ${bets.length} bets · ${cal.length} other settled markets (calibration). Ranges resample whole matches.`)
say()

for (const arm of ['A', 'B', 'W']) {
  const all = bets.filter((b) => (b.arm ?? 'A') === arm)
  if (!all.length) continue
  const settled = all.filter((b) => b.settle)
  const info = ARM_INFO[arm]
  const final = meta.finalByArm?.[arm]
  say(`## ${info.name}${arm === 'W' ? ' (watch list — not a test)' : ''}`)
  const first = meta.firstRecordAt?.[arm]
  const days = first ? (Date.parse(meta.exportedAt) - Date.parse(first)) / 86400_000 : null
  say(`${info.blurb}`)
  say()
  say(`- Running since ${first ?? '?'} (${days === null ? '?' : days.toFixed(1)} days) · markets scanned ${meta.scanned?.[arm] ?? '?'} · bets ${all.length} · settled ${settled.length} · still open ${all.length - settled.length}`)
  if (final) say(`- **Frozen verdict (${final.frozenAt}): ${final.verdict}** — ${final.settled} bets, ${pct(final.result?.perDollar)} [${pct(final.result?.lo)}, ${pct(final.result?.hi)}]`)
  if (!settled.length) { say('- No settled bets yet.'); say(); continue }

  const r = res(settled), pre = res(settled.map(preFee)), slip = res(settled, { slip: 0.01 })
  const fees = settled.reduce((a, b) => a + b.fee, 0), staked = settled.reduce((a, b) => a + b.settle.cost, 0)
  const hit = mean(settled.map((b) => b.settle.yesPrice)), paid = mean(settled.map((b) => b.fill.avgPrice))
  const wins = settled.filter(won).length, voids = settled.filter((b) => b.settle.yesPrice > 0 && b.settle.yesPrice < 1).length
  say()
  say(`### Headline`)
  say(`| | |\n|---|---|`)
  say(`| Record | ${wins} won · ${settled.length - wins - voids} lost${voids ? ` · ${voids} void` : ''} on ${r.events} matches |`)
  say(`| Net (paper) | ${usd(r.pnl)} on $${staked.toFixed(2)} staked |`)
  say(`| **Profit per $1, after fees** | **${pct(r.perDollar)}** — plausible range ${pct(r.lo)} to ${pct(r.hi)} |`)
  say(`| Profit per $1, before fees | ${pct(pre.perDollar)} [${pct(pre.lo)}, ${pct(pre.hi)}] |`)
  say(`| Fees | $${fees.toFixed(2)} = ${plain(fees / staked)} of the money staked |`)
  say(`| Won vs paid | won ${plain(hit, 2)} of the time, at an average price of ${c(paid)} → ${hit > paid ? 'above' : 'below'} the price by ${((hit - paid) * 100).toFixed(2)} points |`)
  say(`| If every fill were 1¢ worse | ${pct(slip.perDollar)} [${pct(slip.lo)}, ${pct(slip.hi)}] |`)
  say(`| If the market's prices were exactly right | ${pct(-fees / staked)} (you lose the fee) |`)
  say()
  const verdictNow = r.lo > 0 ? 'would be YES' : 'would be NO'
  say(`**Read:** ${r.perDollar >= 0 ? 'ahead' : 'behind'} so far; the registered test ${verdictNow} if it stopped on these bets (YES needs the whole range above zero).` +
    ` Before fees the rule is ${pre.lo > 0 ? 'clearly ahead' : pre.hi < 0 ? 'clearly behind' : 'indistinguishable from break-even'} — i.e. cheap contracts ${pre.lo > 0 ? 'did' : pre.hi < 0 ? 'did not' : 'may or may not'} win more often than their price said.`)
  say()

  say(`### By price paid`)
  say(HEAD)
  for (const [lo, hi] of [[0.02, 0.05], [0.05, 0.10], [0.10, 0.15], [0.15, 0.2001]]) say(line(`${Math.round(lo * 100)}–${Math.round(Math.min(hi, 0.2) * 100)}¢`, settled.filter((b) => b.fill.avgPrice >= lo && b.fill.avgPrice < hi)))
  say()
  for (const [title, key] of [['By sport', 'sport'], ['By bet type', 'type']]) {
    say(`### ${title}`)
    say(HEAD)
    const g = [...groupBy(settled, (b) => b[key] ?? 'Untagged')].sort((a, b) => b[1].length - a[1].length)
    for (const [k, list] of g) say(line(k, list))
    say()
  }
  say(`### By kickoff day (UTC)`)
  say(HEAD)
  for (const [k, list] of [...groupBy(settled, (b) => b.endDate.slice(0, 10))].sort()) say(line(k, list))
  say()

  // How much rests on a few matches?
  const byGame = [...groupBy(settled, (b) => b.game ?? b.event)].map(([g, list]) => ({ g, n: list.length, pnl: list.reduce((a, b) => a + b.settle.pnl, 0), list }))
  byGame.sort((a, b) => b.pnl - a.pnl)
  const top = byGame.slice(0, 5)
  say(`### Concentration`)
  say(`- ${byGame.length} matches; the 5 best contributed ${usd(top.reduce((a, x) => a + x.pnl, 0))} of the ${usd(r.pnl)} total.`)
  for (const x of top) say(`  - ${x.g} — ${x.n} bets, ${usd(x.pnl)}`)
  const withoutTop = settled.filter((b) => !top.slice(0, 5).some((x) => x.g === (b.game ?? b.event)))
  const rw = res(withoutTop)
  say(`- Without those 5 matches: ${pct(rw?.perDollar)} per $1 [${pct(rw?.lo)}, ${pct(rw?.hi)}].`)
  const worst = byGame.slice(-3).reverse()
  say(`- Worst matches: ${worst.map((x) => `${x.g.split('|')[0]} (${x.n} bets, ${usd(x.pnl)})`).join('; ')}.`)
  say()

  // Calibration across all prices (bets + other settled markets of this list).
  const pts = [...settled.map((b) => ({ p: b.fill.avgPrice, y: b.settle.yesPrice })), ...cal.filter((x) => x.arm === arm && x.filled && x.price > 0).map((x) => ({ p: x.price, y: x.resolved }))]
  say(`### Calibration — did prices match reality? (${pts.length} settled markets, real $2 fills)`)
  say(`| price | markets | avg price | came true |\n|---|---|---|---|`)
  for (const [lo, hi] of [[0.02, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 0.35], [0.35, 0.50], [0.50, 0.65], [0.65, 0.80], [0.80, 0.90], [0.90, 0.99]]) {
    const s = pts.filter((x) => x.p >= lo && x.p < hi)
    if (s.length >= 10) say(`| ${Math.round(lo * 100)}–${Math.round(hi * 100)}¢ | ${s.length} | ${c(mean(s.map((x) => x.p)))} | ${plain(mean(s.map((x) => x.y)))} |`)
  }
  say()

  // Data quality.
  const resolvedVals = groupBy(settled, (b) => String(b.settle.yesPrice))
  const feeOff = settled.filter((b) => {
    const rate = b.feeRate ?? b.fee / (b.fill.shares * b.fill.avgPrice * (1 - b.fill.avgPrice))
    return Math.abs(b.fee - takerFee({ rate, exponent: b.feeExp ?? 1 }, b.fill.avgPrice, b.fill.shares)) > 1e-6 || !(rate > 0.0299 && rate < 0.0701)
  })
  const ids = new Set(); let dup = 0
  for (const b of all) { if (ids.has(b.id)) dup++; ids.add(b.id) }
  say(`### Data checks`)
  say(`- Resolution prices seen: ${[...resolvedVals].map(([k, v]) => `${k} ×${v.length}`).join(', ')}.`)
  say(`- Fills: ${all.filter((b) => !b.fill.filled).length} not fully filled (should be 0); prices outside 2–20¢: ${all.filter((b) => b.fill.avgPrice < 0.02 || b.fill.avgPrice > 0.2).length} (should be 0).`)
  say(`- Fees: ${feeOff.length} bets whose fee does not match the formula at a 3–7% rate (should be 0).`)
  say(`- Duplicate bet ids: ${dup} (should be 0). Untagged: ${all.filter((b) => !b.sport).length}.`)
  say()
}

// Optional: re-check recorded outcomes against Polymarket.
if (verifyN > 0) {
  const settledAll = bets.filter((b) => b.settle)
  const pick = []
  const step = Math.max(1, Math.floor(settledAll.length / verifyN))
  for (let i = 0; i < settledAll.length && pick.length < verifyN; i += step) pick.push(settledAll[i])
  let mismatch = 0, missing = 0
  for (let i = 0; i < pick.length; i += 50) {
    const chunk = pick.slice(i, i + 50)
    const q = new URLSearchParams({ closed: 'true', limit: '100' }); for (const b of chunk) q.append('id', b.id)
    const ms = JSON.parse(execFileSync('curl', ['-sS', '--max-time', '60', 'https://gamma-api.polymarket.com/markets?' + q], { encoding: 'utf8', maxBuffer: 64 << 20 }))
    const byId = new Map(ms.map((m) => [String(m.id), m]))
    for (const b of chunk) {
      const m = byId.get(b.id)
      if (!m) { missing++; continue }
      const op = JSON.parse(m.outcomePrices).map(Number)
      if (op[b.side ?? 0] !== b.settle.yesPrice) { mismatch++; say(`- MISMATCH ${b.id} ${b.question}: recorded ${b.settle.yesPrice}, Polymarket ${op[b.side ?? 0]}`) }
    }
  }
  say(`## Outcome check against Polymarket`)
  say(`- Re-read ${pick.length} settled bets: ${pick.length - mismatch - missing} agree, ${mismatch} disagree, ${missing} not returned.`)
}

console.log(out.join('\n'))
