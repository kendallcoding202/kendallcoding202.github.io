/**
 * Evaluates Test C (PREREG-POLY-MAKER.md) from the dashboard's "Download data" file.
 *
 *   node research/polymaker-eval.mjs <polysports-export.jsonl.gz>
 *
 * Prints a markdown report: the deciding numbers (calibration-corrected markout per $1, per
 * side and fill rule, with the registered 98.75% intervals over matches), real outcome
 * profit, the "one tick dearer" and "second in line" sensitivities, results by fill source,
 * time to kickoff and price, prices after the fill, the rebate bound, data health and the
 * startup feed check. Calibration results come from the export's meta line.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import { ratioBoot, SIDES, WORLDS } from '../src/polymaker.js'

const file = process.argv[2]
if (!file) { console.error('usage: node research/polymaker-eval.mjs <export.jsonl.gz>'); process.exit(1) }
const raw = fs.readFileSync(file)
const lines = (file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const meta = lines.find((l) => l.kind === 'maker-meta') ?? {}
const fills = lines.filter((l) => l.kind === 'fill')
const replayed = lines.filter((l) => l.kind === 'replayed')
const calRows = meta.calibration ?? meta.final?.calibration ?? null

const out = []
const say = (s = '') => out.push(s)
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%')
const c = (p) => (p === null || p === undefined ? '—' : (p * 100).toFixed(1) + '¢')
const range = (r) => (r ? `${pct(r.perDollar)} [${pct(r.lo)}, ${pct(r.hi)}] · ${r.n} fills, ${r.matches} matches` : '—')
const cOf = (mid) => {
  if (!calRows) return 0
  const b = calRows.find((x) => mid >= x.lo && mid < x.lo + 0.05 - 1e-12) ?? calRows.at(-1)
  return b?.c ?? 0
}
const markRows = (list, adj = (f) => ({ sh: f.shares, p: f.price })) => list.filter((f) => f.mark !== null && f.mark !== undefined).map((f) => {
  const { sh, p } = adj(f)
  return { cluster: f.game ?? f.marketId, value: sh * (f.mark - p + cOf(f.mark)), cost: sh * p }
}).filter((r) => r.cost > 0)
const outcomeRows = (list) => list.filter((f) => f.settle).map((f) => ({ cluster: f.game ?? f.marketId, value: f.settle.pnl, cost: f.settle.cost }))
const sideOf = (f) => (f.price < 0.5 ? 'cheaper' : 'dearer')
const L = 0.9875

say('# Test C (maker) — evaluation')
say(`Export ${meta.exportedAt ?? '?'} · rule ${meta.rule ? 'C1' : '?'} · first enrolment ${meta.firstEnrolledAt ?? '?'} · ${fills.length} fill records · ${replayed.length} games replayed`)
if (meta.final) say(`**Frozen verdict (${meta.final.frozenAt}): ${meta.final.verdict}**`)
say()

say('## The deciding numbers — corrected markout per $1 (98.75% over matches)')
say('| side | trade rule (sellers decide) | touch rule (picked off) | real outcome, trade rule (95%) |\n|---|---|---|---|')
for (const side of SIDES) {
  const t = fills.filter((f) => f.world === 'trade' && sideOf(f) === side), h = fills.filter((f) => f.world === 'touch' && sideOf(f) === side)
  say(`| ${side} | ${range(ratioBoot(markRows(t), { level: L }))} | ${range(ratioBoot(markRows(h), { level: L }))} | ${range(ratioBoot(outcomeRows(t)))} |`)
}
say(calRows ? '' : '\n_No calibration table in this export: markouts are uncorrected._')
say()

say('## Sensitivities (a live order is visible and can be jumped)')
say('| side | one tick dearer | second in line |\n|---|---|---|')
for (const side of SIDES) {
  const t = fills.filter((f) => f.world === 'trade' && sideOf(f) === side)
  const dear = ratioBoot(markRows(t, (f) => ({ sh: f.shares, p: f.price + 0.01 })), { level: L })
  const second = ratioBoot(markRows(t, (f) => ({ sh: Math.min(f.orderShares ?? f.shares, Math.max(0, (f.evidence ?? f.shares) - (f.orderShares ?? f.shares))), p: f.price })), { level: L })
  say(`| ${side} | ${range(dear)} | ${range(second)} |`)
}
say()

const slice = (title, key) => {
  say(`## By ${title} (trade rule; a breakdown, never a verdict)`)
  say('| slice | corrected markout (95%) | real outcome (95%) |\n|---|---|---|')
  const g = new Map()
  for (const f of fills.filter((x) => x.world === 'trade')) { const k = key(f); if (!g.has(k)) g.set(k, []); g.get(k).push(f) }
  for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length)) say(`| ${k} | ${range(ratioBoot(markRows(v)))} | ${range(ratioBoot(outcomeRows(v)))} |`)
  say()
}
slice('fill source', (f) => f.source)
slice('time to kickoff at the fill', (f) => { const h = (Date.parse(f.kickoff) - Date.parse(f.filledAt)) / 3600_000; return h > 6 ? 'over 6 h' : h > 1 ? '1–6 h' : 'under 1 h' })
slice('price', (f) => (f.price < 0.1 ? '2–10¢' : f.price < 0.3 ? '10–30¢' : f.price < 0.5 ? '30–50¢' : f.price < 0.7 ? '50–70¢' : f.price < 0.9 ? '70–90¢' : '90–98¢'))
slice('sport', (f) => f.sport ?? 'Untagged')
slice('bet type', (f) => f.type ?? 'Untagged')

say('## Prices after the fill (trade rule; Polymarket minute history, minus our price, per $1)')
for (const k of ['m1', 'm15', 'm60']) {
  const rows = fills.filter((f) => f.world === 'trade' && f.after && Number.isFinite(f.after[k])).map((f) => ({ cluster: f.game ?? f.marketId, value: f.shares * (f.after[k] - f.price), cost: f.shares * f.price }))
  say(`- after ${k.slice(1)} min: ${range(ratioBoot(rows))}`)
}
say()

const rebate = fills.filter((f) => f.world === 'trade' && f.feeRate && f.rebateRate !== null && f.rebateRate !== undefined)
const rb = rebate.reduce((a, f) => a + f.shares * f.feeRate * f.price * (1 - f.price) * f.rebateRate, 0), rc = rebate.reduce((a, f) => a + f.cost, 0)
say(`## Rebate bound\nIf the counterparty's whole fee × rebateRate came back to us: ${rc ? pct(rb / rc) : '—'} per $1 (an upper bound; rebates are shared among makers).`)
say()

const st = meta.stats ?? {}
say('## Data health')
say(`- Orders placed ${st.orders ?? '?'} · crossings ${st.crossings ?? 0} · touches ${st.touches ?? 0} · late ${st.late ?? 0} · lost to an early replay ${st.lostOrders ?? 0}`)
say(`- Price reads ${st.reads ?? 0} · failed requests ${st.readFails ?? 0} · unread ${st.unread ?? 0}`)
say(`- Trade requests ${st.tradeCalls ?? 0} · failed ${st.tradeFails ?? 0} · trades read ${st.tradesRead ?? 0} · bad records ${st.badRecords ?? 0} · last error ${st.lastTradesError ?? 'none'}`)
const statusN = (s) => replayed.filter((r) => r.status === s).length
say(`- Games replayed: ${statusN('ok')} ok · ${statusN('void')} void · ${statusN('no orders')} with no orders · re-read audit ${JSON.stringify(st.audit ?? null)}`)
say(`- Restarts ${st.restarts ?? 0} · downtime ${((st.downMs ?? 0) / 3600_000).toFixed(1)} h · not enrolled ${JSON.stringify(st.skipped ?? {})}`)
say()

say('## Feed check (what the trade feed returned on the server)')
const fc = st.feedCheck
if (!fc) say('- none recorded')
else {
  say(`- at ${fc.at}${fc.error ? ' · error: ' + fc.error : ''} · geoblock: ${JSON.stringify(fc.geoblock ?? null)}`)
  for (const m of fc.markets ?? []) {
    const a = m.takerOnly_true ?? {}, b = m.takerOnly_false ?? {}
    say(`- ${String(m.question ?? m.id).slice(0, 60)}: taker_only=true ${a.error ?? `${a.n} records, ${a.multiTx} multi-record txs, newest ${a.newestAgeS}s old`} · false ${b.error ?? `${b.n} records, ${b.multiTx} multi-record txs`} · window ${JSON.stringify(m.window ?? null)}`)
    for (const tx of a.sampleMultiTx ?? []) say(`  - taker_only=true tx: ${JSON.stringify(tx)}`)
  }
  if (fc.v1) say(`- old endpoint: ${JSON.stringify(fc.v1).slice(0, 300)}`)
}

console.log(out.join('\n'))
