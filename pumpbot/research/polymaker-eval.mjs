/**
 * Evaluates Test C (PREREG-POLY-MAKER.md) from the dashboard's "Download data" file.
 *
 *   node research/polymaker-eval.mjs <polysports-export.jsonl.gz>
 *
 * Rebuilds the test's state from the export and runs the tracker's own makerSummary with the
 * registered 4,000 draws, so these numbers are computed exactly as the stop computes them
 * (as of the export's time). If the test has stopped, the frozen result is printed first: it
 * is the verdict, and the recomputation is only a check. Then the breakdowns (never a
 * verdict), prices after the fill, the rebate bound, data health and the startup feed check.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import { MAKER, SIDES, newMakerState, makerSummary, markoutBoot, calGroupsOf, ratioBoot, sideOf } from '../src/polymaker.js'

const file = process.argv[2]
if (!file) { console.error('usage: node research/polymaker-eval.mjs <export.jsonl.gz>'); process.exit(1) }
const raw = fs.readFileSync(file)
const lines = (file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const meta = lines.find((l) => l.kind === 'maker-meta') ?? {}
const fills = lines.filter((l) => l.kind === 'fill').map(({ kind: _k, ...f }) => f)
const replayed = lines.filter((l) => l.kind === 'replayed').map(({ kind: _k, ...r }) => r)
const cals = lines.filter((l) => l.kind === 'cal').map(({ kind: _k, ...c }) => c)

// The test's state as the tracker held it at export time (only what the summary reads).
const mk = newMakerState()
mk.firstEnrolledAt = meta.firstEnrolledAt ?? null
Object.assign(mk.stats, meta.stats ?? {})
for (const f of fills) { mk.fills[`${f.world}|${f.id}`] = f; mk.markets[f.marketId] ??= { id: f.marketId } }
for (const r of replayed) if (r.status) mk.replayed[r.id] = r
for (const c of cals) mk.cal[c.id] = c
const nowMs = meta.exportedAt ? Date.parse(meta.exportedAt) : Date.now()
const s = makerSummary(mk, nowMs, { iters: MAKER.stopIters })
const calList = Object.values(mk.cal), calGroups = calGroupsOf(calList)

const out = []
const say = (x = '') => out.push(x)
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%')
const range = (r) => (r ? `${pct(r.perDollar)} [${pct(r.lo)}, ${pct(r.hi)}] · ${r.n} fills${r.byMark !== undefined ? ` (${r.byMark} by kickoff price)` : ''}, ${r.matches} matches` : '—')
const outcomeRows = (list) => list.filter((f) => f.settle).map((f) => ({ cluster: f.game ?? f.marketId, value: f.settle.pnl, cost: f.settle.cost }))

const table = (sum, title) => {
  say(`## ${title}`)
  say('Corrected markout per $1 (98.75% over matches) under each fill rule; the real outcome and the guard at 95%.')
  say('| side | trade rule (sellers decide) | touch rule (picked off) | real outcome, trade rule | guard (fills vs their own kickoff price) |\n|---|---|---|---|---|')
  for (const side of SIDES) {
    const t = sum.sides?.[side]?.trade, h = sum.sides?.[side]?.touch
    say(`| ${side} | ${range(t?.markout)} | ${range(h?.markout)} | ${range(t?.outcome)} | ${range(t?.guard)} |`)
  }
  say()
  say('Sensitivities (live, a visible order can be jumped), trade rule, 98.75%:')
  say('| side | one tick dearer | second in line |\n|---|---|---|')
  for (const side of SIDES) { const t = sum.sides?.[side]?.trade; say(`| ${side} | ${range(t?.tickDearer)} | ${range(t?.secondInLine)} |`) }
  say()
  say(`- Days ${sum.days} · matches with a settled trade-rule fill ${sum.matches} · paired games ${sum.pairs ?? '—'} · stop reason ${sum.reason ?? 'not yet'}${sum.futile ? ' · futility met' : ''}`)
  say(`- Gates: ${sum.gate ?? 'all met'} (settled trade-rule fills ${sum.pooled?.trade?.settled ?? '—'} of ${MAKER.minSettledFills} needed · void games ${pct(sum.voidShare)} · downtime ${pct(sum.downShare)})`)
  say()
}

say('# Test C (maker) — evaluation')
say(`Export ${meta.exportedAt ?? '?'} · rule ${meta.ruleVersion ?? meta.final?.ruleVersion ?? '?'} · first enrolment ${meta.firstEnrolledAt ?? '?'} · ${fills.length} fill records · ${replayed.length} replay log lines · ${cals.length} calibration games`)
say()
if (meta.final) {
  say(`**Frozen verdict (${meta.final.frozenAt}, stop: ${meta.final.reason}): ${meta.final.verdict}**`)
  say()
  table(meta.final, 'The frozen result (this is the verdict)')
  say(`Recomputed from this export: ${s.verdict ?? 'not done'} — a check only; fills settled after the freeze do not count.`)
  say()
} else {
  say(`**Not stopped yet** — ${s.done ? `the stop is met (${s.reason}) and will freeze at the next daily check: ${s.verdict}` : 'no verdict can be given before the stop (YES only at the stop).'}`)
  say()
}
table(s, meta.final ? 'Recomputed as of the export (a check)' : 'As of the export (progress, not a verdict)')

say('## Calibration correction c(mid) (bands with 30+ outcomes)')
const bands = (s.calibration ?? []).filter((b) => b.n >= MAKER.calMin)
say(bands.length ? bands.map((b) => `${Math.round(b.lo * 100)}–${Math.round(b.lo * 100) + 5}¢: ${pct(b.c)} (${b.n})`).join(' · ') : '_No band has 30 outcomes yet: markouts are uncorrected._')
say()

const slice = (title, key) => {
  say(`## By ${title} (trade rule; a breakdown, never a verdict)`)
  say('| slice | corrected markout (95%) | real outcome (95%) |\n|---|---|---|')
  const g = new Map()
  for (const f of fills.filter((x) => x.world === 'trade')) { const k = key(f); if (!g.has(k)) g.set(k, []); g.get(k).push(f) }
  for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length)) say(`| ${k} | ${range(markoutBoot(v, calList, { iters: 1000, calGroups }))} | ${range(ratioBoot(outcomeRows(v)))} |`)
  say()
}
slice('side', sideOf)
slice('fill source', (f) => f.source)
slice('time to kickoff at the fill', (f) => { const h = (Date.parse(f.kickoff) - Date.parse(f.filledAt)) / 3600_000; return h > 6 ? 'over 6 h' : h > 1 ? '1–6 h' : 'under 1 h' })
slice('price', (f) => (f.price < 0.1 ? '2–10¢' : f.price < 0.3 ? '10–30¢' : f.price < 0.5 ? '30–50¢' : f.price < 0.7 ? '50–70¢' : f.price < 0.9 ? '70–90¢' : '90–98¢'))
slice('sport', (f) => f.sport ?? 'Untagged')
slice('bet type', (f) => f.type ?? 'Untagged')

say('## Prices after the fill (trade rule; Polymarket minute history, minus our price, per $1; before kickoff only)')
// The tracker reads these up to an hour after the fill with no kickoff cap; an in-play price is not a pre-game drift.
for (const k of ['m1', 'm15', 'm60']) {
  const before = (f) => Date.parse(f.filledAt) + (Number(k.slice(1)) + 1) * 60_000 <= Date.parse(f.kickoff)
  for (const side of SIDES) {
    const rows = fills.filter((f) => f.world === 'trade' && sideOf(f) === side && f.after && Number.isFinite(f.after[k]) && before(f)).map((f) => ({ cluster: f.game ?? f.marketId, value: f.shares * (f.after[k] - f.price), cost: f.shares * f.price }))
    say(`- ${side}, after ${k.slice(1)} min: ${range(ratioBoot(rows))}`)
  }
}
say()

const rebate = fills.filter((f) => f.world === 'trade' && f.feeRate && f.rebateRate !== null && f.rebateRate !== undefined)
const rb = rebate.reduce((a, f) => a + f.shares * f.feeRate * f.price * (1 - f.price) * f.rebateRate, 0), rc = rebate.reduce((a, f) => a + f.cost, 0)
say(`## Rebate bound\nIf the counterparty's whole fee × rebateRate came back to us: ${rc ? pct(rb / rc) : '—'} per $1 (an upper bound; rebates are shared among makers).`)
say()

const st = meta.stats ?? {}
say('## Data health')
say(`- Orders placed ${st.orders ?? '?'} · crossings ${st.crossings ?? 0} · touches ${st.touches ?? 0} · late ${st.late ?? 0} · lost to an early replay ${st.lostOrders ?? 0}`)
say(`- Price reads ${st.reads ?? 0} · failed requests ${st.readFails ?? 0} · unread ${st.unread ?? 0} · slow reads asked again ${st.slowReads ?? 0}`)
say(`- Trade requests ${st.tradeCalls ?? 0} · failed ${st.tradeFails ?? 0} · trades read ${st.tradesRead ?? 0} · bad records ${st.badRecords ?? 0} · storage errors ${st.storageErrors ?? 0} · last error ${st.lastTradesError ?? 'none'}`)
const statusN = (x) => replayed.filter((r) => r.status === x).length
say(`- Games replayed: ${statusN('ok')} ok · ${statusN('void')} void · ${statusN('no orders')} with no orders · re-read audit ${JSON.stringify(st.audit ?? null)}`)
say(`- Restarts ${st.restarts ?? 0} · downtime ${((st.downMs ?? 0) / 3600_000).toFixed(1)} h · loop errors ${st.loopErrors ?? 0} · last stop check ${JSON.stringify(st.lastStopCheck ?? null)}`)
say(`- Enrolled by sport ${JSON.stringify(st.enrolledBy?.sport ?? {})}`)
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

