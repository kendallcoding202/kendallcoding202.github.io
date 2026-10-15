// Offline tests for Test C, the maker paper test (rule C2). No network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAKER, RULE_VERSION, mil, bandOf, kickoffOf, ineligible, readOf, quote, sharesFor, pickoffMil, evidenceAt, crossSize, applyRead, closeAtKickoff, moveKickoff, refreshGame,
  newMakerState, tradesOf, classify, replayGame, settleFill, freshMark, calibrationTable, markoutBoot, makerSummary, verdictOf, freezeMaker,
  eachLine, openMakerStore, liveRound, enroll, fetchTrades, replayDue, settleFills, settleCal, pruneMarkets, makerDashboard, makerExportLines,
  readPrices, refreshGames, isSystemic, calGroupsOf } from '../src/polymaker.js'
import { openStore, makeStopCheck, httpError, curlError } from '../src/polysports.js'

let passed = 0
const tests = []
const t = (name, fn) => tests.push([name, fn])
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)
const MIN = 60_000
const T0 = Date.parse('2026-10-15T12:00:00Z')

t('prices in whole thousandths; calibration bands on the same grid (0.15 is band 3, 0.35 band 7)', () => {
  assert.equal(mil(0.06) + 10, mil(0.07)); assert.equal(1000 - mil(0.42), mil(0.58))
  assert.equal(bandOf(0.15), 3); assert.equal(bandOf(1 - 0.85), 3); assert.equal(bandOf(0.35), 7); assert.equal(bandOf(1 - 0.65), 7)
  assert.equal(bandOf(0.999), 19); assert.equal(bandOf(0), 0)
})

t('kickoff comes from gameStartTime; tournaments and fine-tick books are not enrolled', () => {
  assert.equal(kickoffOf({ gameStartTime: '2026-10-16 00:15:00+00' }), Date.parse('2026-10-16T00:15:00Z'))
  const base = { feeType: 'sports_fees_v2', enableOrderBook: true, outcomes: '["Over","Under"]', orderPriceMinTickSize: 0.01 }
  const k = T0 + 24 * 3600_000, at = (ms) => new Date(ms).toISOString()
  assert.equal(ineligible({ ...base, gameStartTime: at(k).replace('T', ' ').replace('.000Z', '+00'), endDate: at(k) }, T0), null)
  assert.equal(ineligible({ ...base, gameStartTime: at(k - 3 * 86400_000), endDate: at(k) }, T0), 'not a single game')
  assert.equal(ineligible({ ...base, gameStartTime: at(k), endDate: at(k), orderPriceMinTickSize: 0.001 }, T0), 'not a 1¢-tick book')
  assert.equal(ineligible({ ...base, gameStartTime: at(T0 + 3600_000), endDate: at(T0 + 3600_000) }, T0), 'outside the window')
})

t('quotes: each outcome\'s best bid + 1¢, only on 1¢-grid books with a 3–10¢ spread', () => {
  assert.deepEqual(readOf({ BUY: '0.04', SELL: '0.09' }), { bm: 40, am: 90 }); assert.deepEqual(readOf({ BUY: '0', SELL: '0.001' }), { bm: null, am: 1 })
  assert.deepEqual(quote(40, 90), { pm: [50, 920], spread: 50 })
  assert.equal(quote(40, 60).reason, 'tight'); assert.ok(quote(40, 70).pm); assert.equal(quote(20, 130).reason, 'wide'); assert.ok(quote(20, 120).pm)
  assert.equal(quote(null, 90).reason, 'one-sided'); assert.equal(quote(45, 95).reason, 'finer tick')
  assert.equal(sharesFor(50), 40); assert.equal(sharesFor(920), 5); assert.equal(sharesFor(300), 6.67)
})

t('evidence: a crossing is a sell at or below us; a pick-off is our bids gone or our midpoint below us by 1¢ plus the fee; a widening on the other side is not', () => {
  assert.equal(pickoffMil(50, 0.05), 12)
  assert.deepEqual(evidenceAt(0, 50, 40, 90, 0.05), { cross: false, touch: null })
  assert.deepEqual(evidenceAt(0, 50, 30, 50, 0.05), { cross: true, touch: 'cross' })
  assert.deepEqual(evidenceAt(0, 50, null, 90, 0.05), { cross: false, touch: 'bid gone' })
  assert.deepEqual(evidenceAt(0, 50, 30, 70, 0.05), { cross: false, touch: null })        // mid at our price: no profit for a seller
  assert.deepEqual(evidenceAt(0, 50, 20, 60, 0.05), { cross: false, touch: null })        // mid 4¢: not below 5¢ − 1.2¢
  assert.deepEqual(evidenceAt(0, 50, 10, 60, 0.05), { cross: false, touch: 'price fell' }) // mid 3.5¢ < 3.8¢
  assert.deepEqual(evidenceAt(0, 50, 40, 160, 0.05), { cross: false, touch: null })       // the ask rose: not a pick-off
  assert.deepEqual(evidenceAt(1, 920, 80, 120, 0.05), { cross: true, touch: 'cross' })
  assert.deepEqual(evidenceAt(1, 920, 40, null, 0.05), { cross: false, touch: 'bid gone' })
  assert.deepEqual(evidenceAt(1, 920, 70, 120, 0.05), { cross: false, touch: 'price fell' })   // outcome 1 mid 90.5¢ < 92 − 1.4
  assert.deepEqual(evidenceAt(1, 920, 20, 90, 0.05), { cross: false, touch: null })        // outcome 0's bid fell: outcome 1's ask rose
})

t('crossing size reads the full book on the right side of the mirror', () => {
  const b = { bids: [{ price: '0.93', size: '4' }, { price: '0.90', size: '9' }], asks: [{ price: '0.06', size: '8' }, { price: '0.05', size: '3' }] }
  assert.equal(crossSize(b, 0, 50), 3); assert.equal(crossSize(b, 1, 80), 4); assert.equal(crossSize(b, 1, 100), 13)
})

const TOK = ['11', '22']
function stateWith(kick = T0 + 10 * 3600_000) {
  const mk = newMakerState()
  mk.markets.M = { id: 'M', cid: '0xm', tokens: TOK, outcomes: ['Over', 'Under'], question: 'Total 2.5', kickoff: new Date(kick).toISOString(), endDate: new Date(kick).toISOString(),
    game: 'a vs b|2026-10-16', event: 'E', sport: 'Soccer', type: 'Over/under', minShares: 5, feeRate: 0.05 }
  mk.enrolled.add('M'); mk.firstEnrolledAt = new Date(T0).toISOString()
  return mk
}
const every = (mk, from, to, bm, am, ended) => { for (let ms = from; ms < to; ms += MIN) applyRead(mk, 'M', bm, am, ms, (o) => ended.push(o)) }

t('re-pricing: an unchanged price keeps resting; a new price ends the order and starts another', () => {
  const mk = stateWith(), ended = []
  applyRead(mk, 'M', 40, 90, T0, (o) => ended.push(o))
  applyRead(mk, 'M', 40, 90, T0 + MIN, (o) => ended.push(o))
  assert.equal(ended.length, 0); assert.equal(mk.open['M:0'].from, T0)
  applyRead(mk, 'M', 50, 90, T0 + 2 * MIN, (o) => ended.push(o))
  assert.equal(ended.length, 1); assert.equal(ended[0].to, T0 + 2 * MIN); assert.equal(mk.open['M:0'].pm, 60)
  applyRead(mk, 'M', 50, 70, T0 + 3 * MIN, (o) => ended.push(o))
  assert.equal(Object.keys(mk.open).length, 0)
  assert.equal(mk.markets.M.quoted, true); assert.ok(mk.events.some((e) => e.quoted))
})

t('a crossing ends the order and retires the outcome; a pick-off is noted and the order rests on', () => {
  const mk = stateWith(), ended = []
  applyRead(mk, 'M', 40, 90, T0, (o) => ended.push(o))
  applyRead(mk, 'M', 10, 60, T0 + MIN, (o) => ended.push(o))      // outcome 0 mid 3.5¢: picked off; re-priced to 2¢
  assert.deepEqual(ended[0].touch, { at: T0 + MIN, why: 'price fell' })
  applyRead(mk, 'M', 10, 20, T0 + 2 * MIN, (o) => ended.push(o))      // ask 2¢ crosses the 2¢ order
  assert.equal(mk.retired['M:0'], true); assert.equal(mk.needSize.length, 1); assert.equal(mk.open['M:0'], undefined)
  applyRead(mk, 'M', 40, 90, T0 + 3 * MIN, (o) => ended.push(o))
  assert.equal(mk.open['M:0'], undefined); assert.ok(mk.open['M:1'])
})

t('the outage rule applies on every path: a later read, kickoff, a cleared book and a Gamma stop', () => {
  let mk = stateWith(), e = []
  applyRead(mk, 'M', 40, 90, T0, (o) => e.push(o)); applyRead(mk, 'M', 40, 90, T0 + 10 * MIN, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => o.late && o.to === T0 + MIN)); assert.equal(mk.open['M:0'].from, T0 + 10 * MIN)
  const kick = T0 + 30 * MIN
  mk = stateWith(kick); e = []
  every(mk, T0, kick - 10 * MIN + 1, 40, 90, e)
  closeAtKickoff(mk, kick + MIN, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => o.late && o.to === kick - 10 * MIN + MIN))
  mk = stateWith(kick); e = []
  every(mk, T0, kick, 40, 90, e); closeAtKickoff(mk, kick, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => !o.late && o.to === kick && o.from === T0))
  mk = stateWith(); e = []
  applyRead(mk, 'M', 40, 90, T0, (o) => e.push(o)); applyRead(mk, 'M', null, null, T0 + 20 * MIN, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => o.late && o.to === T0 + MIN))
  mk = stateWith(); e = []
  applyRead(mk, 'M', 40, 90, T0, (o) => e.push(o)); applyRead(mk, 'M', null, null, T0 + MIN, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => !o.late && o.touch.why === 'bid gone' && o.to === T0 + MIN)); assert.equal(mk.markets.M.stopped.why, 'book cleared')
  applyRead(mk, 'M', 40, 90, T0 + 2 * MIN, (o) => e.push(o)); assert.equal(Object.keys(mk.open).length, 0)
  mk = stateWith(); e = []
  applyRead(mk, 'M', 40, 90, T0, (o) => e.push(o))
  refreshGame(mk, mk.markets.M, { closed: true, gameStartTime: mk.markets.M.kickoff }, T0 + 20 * MIN, (o) => e.push(o))
  assert.ok(e.length === 2 && e.every((o) => o.late && o.to === T0 + MIN)); assert.equal(mk.markets.M.stopped.why, 'closed')
})

t('an earlier kickoff applies retroactively; an earlier endDate alone, or a later kickoff, changes nothing', () => {
  const k0 = T0 + 60 * MIN, k1 = T0 + 20 * MIN
  const mk = stateWith(k0), e = []
  every(mk, T0, T0 + 10 * MIN, 40, 90, e)
  refreshGame(mk, mk.markets.M, { gameStartTime: new Date(T0 + 90 * MIN).toISOString(), endDate: new Date(T0 + 50 * MIN).toISOString() }, T0 + 10 * MIN, (o) => e.push(o))
  assert.equal(mk.markets.M.kickoff, new Date(k0).toISOString())
  const mk2 = stateWith(k0), e2 = []
  every(mk2, T0, T0 + 25 * MIN, 40, 90, e2)
  applyRead(mk2, 'M', 40, 50, T0 + 25 * MIN, (o) => e2.push(o))     // an in-play crossing at minute 25
  assert.equal(mk2.retired['M:0'], true)
  refreshGame(mk2, mk2.markets.M, { gameStartTime: new Date(k1).toISOString(), endDate: new Date(k0).toISOString() }, T0 + 26 * MIN, (o) => e2.push(o))
  assert.equal(mk2.markets.M.kickoff, new Date(k1).toISOString()); assert.ok(mk2.markets.M.kickoffMoved)
  assert.ok((mk2.closed.M ?? []).every((o) => o.to <= k1 && o.from < k1 && (!o.cross || o.cross.at < k1)))
  assert.equal(mk2.retired['M:0'], undefined); assert.equal(Object.keys(mk2.open).length, 0)
  assert.ok(mk2.markets.M.marks.every(([tt]) => tt < k1))
  moveKickoff(mk2, mk2.markets.M, k0, () => {})                    // later: no change
  assert.equal(mk2.markets.M.kickoff, new Date(k1).toISOString())
})

t('trades: v2 and older shapes read the same; classification against a buy order', () => {
  const v2 = { data: [{ token_id: '11', condition_id: '0xA', price: '0.05', size: '20', side: 'SELL', timestamp: 1792066000, transaction_hash: '0x1' }], pagination: { has_more: false } }
  const v1 = [{ asset: '11', conditionId: '0xA', price: 0.05, size: 20, side: 'SELL', timestamp: 1792066000, transactionHash: '0x1' }]
  assert.deepEqual(tradesOf(v2), tradesOf(v1)); assert.equal(tradesOf(v2)[0].ms, 1792066000000)
  const c = (token, price, side) => ({ token, pmil: mil(price), side })
  assert.equal(classify(c('11', 0.05, 'SELL'), TOK, 0, 50), 'seller'); assert.equal(classify(c('11', 0.06, 'SELL'), TOK, 0, 50), null)
  assert.equal(classify(c('22', 0.95, 'BUY'), TOK, 0, 50), 'seller'); assert.equal(classify(c('11', 0.05, 'BUY'), TOK, 0, 50), 'cross')
  assert.equal(classify(c('22', 0.96, 'SELL'), TOK, 0, 50), 'cross'); assert.equal(classify(c('22', 0.58, 'SELL'), TOK, 1, mil(0.58)), 'seller')
})

const tr = (token, price, size, ms, side = 'SELL', tx = 'x' + ms + token + price) => ({ token, pmil: mil(price), size, side, ms, tx, cid: '0xm' })
const M = stateWith(T0 + 3600_000).markets.M
const order = (side, pm, from, to, extra = {}) => ({ id: 'M', side, pm, price: pm / 1000, shares: sharesFor(pm), from, to, seen: to, bid: (pm - 10) / 1000, ask: (pm + 40) / 1000, spread: 50, cross: null, touch: null, ...extra })

t('replay: the first order with a seller at or through its price fills at its own price; later orders never existed', () => {
  const orders = [order(0, 50, T0, T0 + 5 * MIN), order(0, 40, T0 + 5 * MIN, T0 + 10 * MIN)]
  const r = replayGame(M, orders, [tr('11', 0.06, 99, T0 + MIN), tr('11', 0.04, 15, T0 + 3 * MIN), tr('11', 0.03, 50, T0 + 7 * MIN)], 0)
  assert.equal(r.trade.length, 1); assert.equal(r.trade[0].price, 0.05); assert.equal(r.trade[0].shares, 15)
})

t('replay: a sweep through our price fills it; identical records in one reply both count; nothing at or after kickoff', () => {
  assert.equal(replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.09, 400, T0 + MIN, 'SELL', 'a'), tr('11', 0.04, 100, T0 + MIN, 'SELL', 'a')], 0).trade[0].shares, sharesFor(60))
  const twin = tr('11', 0.05, 5, T0 + MIN, 'SELL', 'z')
  assert.equal(replayGame(M, [order(0, 50, T0, T0 + 5 * MIN)], [twin, { ...twin }], 0).trade[0].shares, 10)
  const kick = Date.parse(M.kickoff)
  assert.equal(replayGame(M, [order(0, 50, kick - 5 * MIN, kick)], [tr('11', 0.04, 10, kick + 10_000)], MIN).trade.length, 0)
})

t('replay: a seller print goes to the dearest order its window overlaps, even two orders on', () => {
  const orders = [order(0, 400, T0, T0 + 120_000), order(0, 300, T0 + 120_000, T0 + 178_000), order(0, 600, T0 + 178_000, T0 + 400_000)]
  assert.equal(replayGame(M, orders, [tr('11', 0.25, 50, T0 + 179_000)], MIN).trade[0].price, 0.6)
  assert.equal(replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.05, 50, T0 + 30_000, 'BUY')], MIN).trade.length, 0)
  assert.equal(replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.05, 50, T0 + 2 * MIN, 'BUY')], MIN).trade.length, 1)
})

t('replay: under the touch rule a pick-off anywhere in the order\'s life fills all of it, even after a small trade', () => {
  const o = order(0, 50, T0, T0 + 10 * MIN, { touch: { at: T0 + 6 * MIN, why: 'price fell' } })
  const r = replayGame(M, [o], [tr('11', 0.05, 1, T0 + 2 * MIN)], 0)
  assert.equal(r.trade[0].shares, 1); assert.equal(r.touch[0].shares, sharesFor(50)); assert.equal(r.touch[0].filledAt, new Date(T0 + 2 * MIN).toISOString())
  const crossed = order(0, 50, T0, T0 + 2 * MIN, { cross: { at: T0 + 2 * MIN, size: 7 }, touch: { at: T0 + 2 * MIN, why: 'cross' } })
  const r2 = replayGame(M, [crossed], [], 0)
  assert.equal(r2.trade[0].shares, 7); assert.equal(r2.touch[0].shares, sharesFor(50))
  assert.equal(replayGame(M, [order(0, 50, T0, T0 + MIN, { touch: { at: T0 + 5 * MIN, why: 'bid gone' } })], [], 0).touch.length, 0)
})

t('settling pays shares × the resolution price of the outcome bought, no fee', () => {
  near(settleFill({ side: 1, shares: 5, price: 0.92 }, { closed: true, outcomePrices: '["0","1"]' }).pnl, 0.4)
  assert.equal(settleFill({ side: 1, shares: 5, price: 0.92 }, { closed: false }), null)
})

t('calibration: per 5¢ band over quoted games with a fresh kickoff read; too few is no correction', () => {
  const cal = Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, game: 'g' + i, mid: 0.12, r0: i < 4 ? 1 : 0, quoted: true, fresh: true }))
  const c = calibrationTable(cal)
  near(c.c(0.12), -0.02); near(c.c(0.88), 0.02); assert.equal(c.c(0.5), 0)
  assert.equal(calibrationTable(cal.map((x) => ({ ...x, fresh: false }))).c(0.12), 0)
  assert.equal(calibrationTable(cal.map((x) => ({ ...x, quoted: false }))).c(0.12), 0)
})

function fakeFill(world, i, won, price = 0.5, mark = price + 0.01, extra = {}) {
  const shares = 4, kick = T0 + 5 * 86400_000
  return { world, id: `F${i}:0`, marketId: `F${i}`, side: 0, price, shares, cost: shares * price, game: 'g' + i, source: 'trade', kickoff: new Date(kick).toISOString(),
    filledAt: new Date(kick - 3 * 3600_000).toISOString(), mark, markAt: new Date(kick - MIN).toISOString(), orderShares: shares, evidence: shares * 3,
    fill: { shares, spent: shares * price, avgPrice: price, filled: true }, fee: 0, settle: { yesPrice: won ? 1 : 0, payout: won ? shares : 0, cost: shares * price, pnl: (won ? shares : 0) - shares * price }, ...extra }
}

t('the markout uses a fresh kickoff price; a stale one falls back to the real result', () => {
  const fresh = fakeFill('trade', 1, false)
  const stale = fakeFill('trade', 2, false, 0.5, 0.6, { markAt: new Date(Date.parse(fresh.filledAt) + MIN).toISOString() })
  assert.equal(freshMark(fresh), true); assert.equal(freshMark(stale), false)
  const r = markoutBoot([fresh, stale], [], { iters: 50 })
  assert.equal(r.byMark, 1); assert.equal(r.byResult, 1)
  near(r.value, 4 * 0.01 - 2); near(r.cost, 4)
})

t('the markout interval carries the calibration\'s own error', () => {
  const fills = Array.from({ length: 30 }, (_, i) => fakeFill('trade', i, i % 2 === 0, 0.12, 0.13))
  const calTight = Array.from({ length: 4000 }, (_, i) => ({ id: 'c' + i, game: 'm' + i, mid: 0.12, r0: i % 100 < 12 ? 1 : 0, quoted: true, fresh: true }))
  const a = markoutBoot(fills, calTight, { iters: 400 }), b = markoutBoot(fills, calTight.slice(0, 80), { iters: 400 })
  assert.ok(b.hi - b.lo > a.hi - a.lo, `thin calibration should widen the interval: ${b.hi - b.lo} vs ${a.hi - a.lo}`)
})

t('the verdict: both rules clear zero, outcome not negative, guard holds, touch not kinder than trade; gates first', () => {
  const ok = (p) => ({ markout: { lo: 0.01, perDollar: p }, outcome: { perDollar: 0.02 }, guard: { hi: 0.1 } })
  const s = (cheaper, dearer = {}, gate = null) => verdictOf({ gate, sides: { cheaper, dearer } })
  assert.equal(s({ trade: ok(0.05), touch: ok(0.03) }), 'YES — cheaper side: resting orders made money under both fill rules')
  assert.ok(s({ trade: ok(0.05), touch: ok(0.08) }).startsWith('INCONCLUSIVE — the cautious rule'))
  assert.equal(s({ trade: ok(0.05), touch: { markout: { lo: -0.01, perDollar: 0.01 } } }), 'NO — the cheaper side made money only if stale orders are never picked off')
  assert.ok(s({ trade: { ...ok(0.05), guard: { hi: -0.01 } }, touch: ok(0.03) }).startsWith('NO'))
  assert.equal(s({ trade: ok(0.05), touch: ok(0.03) }, {}, 'only 12 settled fills (needs 100)'), 'INCONCLUSIVE — only 12 settled fills (needs 100)')
})

t('summary: no verdict before the stop; the stop is 300 matches and 7 days, or 28 days; futility from day 3; freeze only what is done', () => {
  const mk = stateWith()
  for (let i = 0; i < 10; i++) for (const w of ['trade', 'touch']) mk.fills[`${w}|F${i}:0`] = fakeFill(w, i, i % 2 === 0)
  let s = makerSummary(mk, T0 + 2 * 86400_000, { iters: 100 })
  assert.equal(s.done, false); assert.equal(s.verdict, null)
  assert.equal(freezeMaker(mk, T0 + 2 * 86400_000, s), null); assert.equal(mk.final, null)
  s = makerSummary(mk, T0 + 29 * 86400_000, { iters: 100 })
  assert.equal(s.reason, '28 days'); assert.equal(s.verdict, 'INCONCLUSIVE — only 10 settled fills (needs 100)')
  const bad = stateWith()
  for (let i = 0; i < 160; i++) for (const w of ['trade', 'touch']) bad.fills[`${w}|F${i}:0`] = fakeFill(w, i, false, 0.5, 0.45)
  const f = makerSummary(bad, T0 + 3.1 * 86400_000, { iters: 200 })
  assert.equal(f.reason, 'futility'); assert.equal(f.verdict, 'NO — stopped for futility')
  const fr = freezeMaker(bad, T0 + 3.1 * 86400_000, f)
  assert.equal(fr.verdict, 'NO — stopped for futility'); assert.equal(fr.settledIds.length, 320); assert.equal(freezeMaker(bad, T0 + 4 * 86400_000), fr)
})

t('reading a large file line by line, across chunk edges and multi-byte characters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-')), file = path.join(dir, 'x.jsonl')
  const lines = Array.from({ length: 30000 }, (_, i) => JSON.stringify({ i, s: '⚽'.repeat(i % 7) + 'é'.repeat(40) }))
  fs.writeFileSync(file, lines.join('\n') + '\n{"torn')
  const got = []
  assert.equal(eachLine(file, (x) => got.push(x)), 1)
  assert.equal(got.length, 30000); assert.equal(got[29999].i, 29999); assert.equal(got[6].s, '⚽'.repeat(6) + 'é'.repeat(40))
})

t('storage: open orders and per-game stops survive a restart; old-rule data without fills is archived', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-'))
  fs.writeFileSync(path.join(dir, 'maker-meta.json'), JSON.stringify({ stats: {} }))     // C1 wrote no version
  fs.writeFileSync(path.join(dir, 'maker-markets.jsonl'), JSON.stringify({ id: 'OLD', kickoff: new Date(T0).toISOString() }) + '\n')
  const st = openMakerStore(dir)
  let back = st.load(T0)
  assert.equal(back.markets.OLD, undefined); assert.equal(fs.readdirSync(path.join(dir, 'maker-archive')).length, 1)
  const mk = stateWith()
  mk.markets.N = { ...mk.markets.M, id: 'N' }
  st.addMarkets([mk.markets.M, mk.markets.N])
  applyRead(mk, 'M', 40, 90, T0, () => {})
  refreshGame(mk, mk.markets.N, { closed: true, gameStartTime: mk.markets.M.kickoff }, T0, () => {})
  st.addGameEvents(mk.events.splice(0)); st.saveOpen(mk); mk.stats.orders = 9; st.saveMeta(mk)
  back = st.load(T0 + MIN)
  assert.equal(back.open['M:0'].pm, 50); assert.equal(back.markets.M.twoSided, true); assert.equal(back.markets.M.quoted, true)
  assert.equal(back.markets.N.stopped.why, 'closed'); assert.equal(back.stats.orders, 9); assert.equal(back.stats.restarts, 1)
  assert.ok(back.enrolled.has('N'))
  assert.equal(fs.readdirSync(path.join(dir, 'maker-archive')).length, 1)   // a C2 restart archives nothing
})

t('a reply that could silently mean "no trades" is an error', async () => {
  const mk = newMakerState(), io = (body) => ({ getJson: async () => body })
  await assert.rejects(fetchTrades(io({ nope: 1 }), mk, ['0xa'], 0, 1), /without data/)
  await assert.rejects(fetchTrades(io({ data: [], pagination: { has_more: true } }), mk, ['0xa'], 0, 1), /without a cursor/)
  await assert.rejects(fetchTrades(io({ data: [{ token_id: '1', condition_id: '0xB', price: 0.5, size: 1, timestamp: 5 }] }), mk, ['0xa'], 0, 1), /not asked for/)
  const full = Array.from({ length: 1000 }, () => ({ token_id: '1', condition_id: '0xa', price: 0.5, size: 1, timestamp: 5 }))
  await assert.rejects(fetchTrades(io(full), mk, ['0xa'], 0, 1), /full page/)
  await assert.rejects(fetchTrades(io({ data: full }), mk, ['0xa'], 0, 1), /without has_more/)
  await assert.rejects(fetchTrades(io({ data: full, pagination: {} }), mk, ['0xa'], 0, 1), /without has_more/)
  const rec = { token_id: '1', condition_id: '0xA', price: 0.5, size: 1, side: 'SELL', timestamp: 5, transaction_hash: '0x9' }
  let n = 0
  const paged = { getJson: async () => (n++ === 0 ? { data: [rec, rec], pagination: { has_more: true, next_cursor: 'c' } } : { data: [rec], pagination: { has_more: false } }) }
  assert.equal((await fetchTrades(paged, mk, ['0xa'], 0, 1)).length, 2)
})

t('replay waits while the feed cannot show it has caught up, and voids a game still waiting a day after kickoff', async () => {
  const kick = T0 + 3600_000, mk = stateWith(kick)
  mk.closed.M = [order(0, 50, T0, kick)]
  const io = { store: { addTrades() {}, addFills() {}, addReplayed() {} }, getJson: async () => { throw new Error('down') } }
  let r = await replayDue(mk, io, kick + MAKER.tradesAfterMs + 1)
  assert.equal(r.waiting, 1); assert.equal(mk.replayed.M, undefined)
  r = await replayDue(mk, io, kick + MAKER.giveUpMs + 1)
  assert.equal(mk.replayed.M.status, 'void'); assert.equal(mk.stats.voidGames, 1)
})

t('the re-read audit keeps its game through pruning, and counts a skip', async () => {
  const mk = stateWith()
  mk.replayed.M = { id: 'M', status: 'ok', auditAt: T0 + 1 }
  mk.closed.M = [order(0, 50, T0 - 5 * MIN, T0 - MIN)]
  pruneMarkets(mk)
  assert.ok(mk.markets.M && mk.closed.M)
  const io = { store: { addReplayed() {} }, getJson: async () => ({ data: [], pagination: { has_more: false } }) }
  await replayDue(mk, io, T0 + 2)
  assert.equal(mk.replayed.M.audited, 'same'); assert.equal(mk.stats.audit.games, 1)
  const mk2 = stateWith(); mk2.replayed.X = { id: 'X', status: 'ok', auditAt: T0 + 1 }
  await replayDue(mk2, io, T0 + 2)
  assert.equal(mk2.stats.audit.skipped, 1)
})

t('a full day against fake Polymarket endpoints: enrol, quote, end at kickoff, replay, settle, calibrate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-'))
  const store = openMakerStore(dir)
  const mk = newMakerState()
  let now = T0
  const kick = T0 + 24 * 3600_000
  const market = { id: '77', conditionId: '0xC', clobTokenIds: JSON.stringify(TOK), outcomes: '["Over","Under"]', question: 'O/U 2.5', feeType: 'sports_fees_v2', enableOrderBook: true,
    orderPriceMinTickSize: 0.01, orderMinSize: 5, gameStartTime: new Date(kick).toISOString().replace('T', ' ').replace('.000Z', '+00'), endDate: new Date(kick).toISOString(),
    feeSchedule: { rate: 0.03, exponent: 1, takerOnly: true, rebateRate: 0.15 },
    events: [{ id: '5', title: 'A vs. B - Totals', eventDate: '2026-10-16', series: [{ id: '9' }] }], sportsMarketType: 'totals' }
  let posts = 0
  const io = {
    store, log: () => {}, clock: () => now,
    getJson: async (url) => {
      if (url.includes('/markets/keyset')) return { markets: [market], next_cursor: null }
      if (url.includes('/v2/trades')) {
        const q = new URL(url).searchParams
        if (!q.get('condition_id')) return { data: [{ token_id: '99', condition_id: '0xz', price: '0.5', size: '1', side: 'BUY', timestamp: Math.floor(now / 1000) }], pagination: { has_more: false } }
        assert.equal(q.get('condition_id'), '0xc'); assert.equal(q.get('taker_only'), 'true')
        return { data: [{ token_id: '11', condition_id: '0xC', price: '0.05', size: '25', side: 'SELL', timestamp: Math.floor((kick - 3 * 3600_000) / 1000), transaction_hash: '0xt' }], pagination: { has_more: false } }
      }
      if (url.includes('gamma-api.polymarket.com/markets?')) return url.includes('closed=true') ? [{ id: '77', closed: true, outcomePrices: '["1","0"]' }] : []
      throw new Error('unexpected ' + url)
    },
    postJson: async (url, body) => { posts++; return Object.fromEntries(body.filter((b) => b.side === 'BUY').map((b) => [b.token_id, { BUY: '0.04', SELL: '0.09' }])) },
  }
  assert.equal((await enroll(mk, io, now, null)).added, 1)
  assert.equal((await enroll(mk, io, now + MIN, null)).added, 0)
  for (now = T0; now < kick - 15 * MIN; now += 30 * MIN) await liveRound(mk, io, now)
  for (now = kick - 15 * MIN; now < kick; now += MIN) await liveRound(mk, io, now)
  now = kick + 1
  assert.equal((await liveRound(mk, io, now)).resting, 0); assert.ok(posts > 50)
  assert.equal(mk.cal['77'].fresh, true); assert.equal(mk.cal['77'].quoted, true); assert.equal(mk.cal['77'].mid, 0.065)
  now = kick + MAKER.tradesAfterMs
  assert.equal((await replayDue(mk, io, now)).fills, 2)
  assert.equal(mk.fills['trade|77:0'].shares, 25); assert.equal(mk.fills['trade|77:0'].price, 0.05); assert.equal(mk.fills['trade|77:1'], undefined)
  assert.equal(await settleFills(mk, io, now), 2); near(mk.fills['trade|77:0'].settle.pnl, 25 - 1.25)
  assert.equal(await settleCal(mk, io, now), 1); assert.equal(mk.cal['77'].r0, 1)
  const d = makerDashboard(mk, now)
  assert.equal(d.kind, 'maker'); assert.equal(d.view.fills, 1); assert.equal(d.results.length, 1); assert.equal(d.verdict, null)
  assert.ok(makerExportLines(mk, now).some((l) => l.kind === 'cal'))
  const back = openMakerStore(dir).load(now)
  assert.equal(back.fills['trade|77:0'].settle.yesPrice, 1); assert.equal(back.cal['77'].r0, 1); assert.ok(back.enrolled.has('77'))
  assert.equal(RULE_VERSION, 'C2')
})

const isoAt = (ms) => new Date(ms).toISOString()
const gammaTime = (ms) => isoAt(ms).replace('T', ' ').replace('.000Z', '+00')
const sell = (cid, ms, price = '0.05', size = '25') => ({ token_id: '11', condition_id: cid, price, size, side: 'SELL', timestamp: Math.floor(ms / 1000), transaction_hash: '0x' + ms })
// A trade feed: the newest trade (the watermark) is `water`; each game's trades by condition id.
const feed = (water, byCid) => async (url) => {
  const cid = new URL(url).searchParams.get('condition_id')
  if (!cid) return { data: [sell('0xz', water)], pagination: { has_more: false } }
  return { data: cid.split(',').flatMap((c) => byCid[c] ?? []), pagination: { has_more: false } }
}

t('kickoff prices survive a restart, before kickoff (kept midpoints) and after it (the calibration record)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-')), st = openMakerStore(dir)
  const kick = T0 + 3600_000, mk = stateWith(kick), ended = []
  st.addMarkets([{ ...mk.markets.M, enrolledAt: isoAt(T0) }]); st.saveMeta(mk)
  every(mk, kick - 30 * MIN, kick - 2 * MIN, 40, 90, ended)                 // last read 3 minutes before kickoff
  st.addOrders(ended.splice(0)); st.saveOpen(mk, kick - 3 * MIN)
  // Down across kickoff: the first round after the restart records the kickoff price from the kept midpoints.
  let back = st.load(kick + 20 * MIN)
  assert.equal(back.markets.M.marks.at(-1)[0], kick - 3 * MIN)
  const io = { store: st, clock: () => kick + 20 * MIN, postJson: async () => { throw new Error('no reads after kickoff') }, getJson: async () => { throw new Error('none') } }
  await liveRound(back, io, kick + 20 * MIN)
  assert.equal(back.cal.M.fresh, true); assert.equal(back.cal.M.mid, 0.065); assert.equal(back.cal.M.at, isoAt(kick - 3 * MIN))
  // Down again before the replay: the midpoints are gone, the calibration record still gives the fill its kickoff price.
  back = st.load(kick + 60 * MIN)
  assert.equal(back.markets.M.marks, undefined); assert.equal(back.closed.M.length, 2)
  const now = kick + MAKER.tradesAfterMs
  await replayDue(back, { store: st, log() {}, clock: () => now, getJson: feed(now, { '0xm': [sell('0xm', kick - 20 * MIN)] }) }, now)
  const f = back.fills['trade|M:0']
  assert.equal(f.mark, 0.065); assert.equal(f.markAt, isoAt(kick - 3 * MIN)); assert.ok(freshMark(f))
})

t('an earlier kickoff found by a refresh is still applied after a restart: in-play evidence never fills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-')), st = openMakerStore(dir)
  const K = T0 + 3600_000, early = K - 20 * MIN, mk = stateWith(K), ended = []
  st.addMarkets([{ ...mk.markets.M, enrolledAt: isoAt(T0) }])
  every(mk, early - 30 * MIN, early + 10 * MIN, 40, 90, ended)               // still quoting after the true (unannounced) start
  applyRead(mk, 'M', 30, 50, early + 10 * MIN, (o) => ended.push(o))      // an in-play crossing
  assert.ok(mk.retired['M:0'])
  st.addOrders(ended.splice(0)); st.saveOpen(mk, early + 10 * MIN)
  refreshGame(mk, mk.markets.M, { gameStartTime: gammaTime(early) }, early + 11 * MIN, (o) => ended.push(o))
  st.addOrders(ended.splice(0)); st.addGameEvents(mk.events.splice(0)); st.saveOpen(mk, early + 11 * MIN)
  const back = st.load(early + 12 * MIN)
  assert.equal(back.markets.M.kickoff, isoAt(early)); assert.equal(back.retired['M:0'], undefined); assert.equal(Object.keys(back.open).length, 0)
  assert.ok(back.closed.M.length > 0 && back.closed.M.every((o) => o.from < early && o.to <= early && !o.cross))
  assert.ok(back.needSize.every((x) => x.at < early))
  const r = replayGame(back.markets.M, back.closed.M, [], MAKER.lagMs, null)
  assert.equal(r.trade.length + r.touch.length, 0)
})

t('a refresh still reaches a stopped game, so an unannounced early start moves its kickoff back', async () => {
  const K = T0 + 3600_000, early = K - 30 * MIN, mk = stateWith(K)
  applyRead(mk, 'M', 40, 90, T0, () => {}); applyRead(mk, 'M', null, null, T0 + MIN, () => {})
  assert.equal(mk.markets.M.stopped.why, 'book cleared')
  const writes = []
  const io = { store: { addOrders: (l) => writes.push(...l), addGameEvents: (l) => writes.push(...l) }, getJson: async (url) => (url.includes('closed=false') ? [{ id: 'M', gameStartTime: gammaTime(early) }] : []) }
  assert.equal(await refreshGames(mk, io, T0 + 2 * MIN), 1)
  assert.equal(mk.markets.M.kickoff, isoAt(early)); assert.ok(writes.some((e) => e.kickoffMoved))
})

t('an append after a torn last line starts on its own line, so the new record is kept (both tests\' stores)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-')), st = openMakerStore(dir)
  fs.writeFileSync(path.join(dir, 'maker-fills.jsonl'), '{"world":"trade","id":"A:0"}\n{"world":"tra')
  st.addFills([{ world: 'trade', id: 'B:0', price: 0.05 }])
  st.addFills([{ world: 'trade', id: 'C:0', price: 0.05 }])
  const back = st.load(T0)
  assert.ok(back.fills['trade|A:0'] && back.fills['trade|B:0'] && back.fills['trade|C:0'])
  const old = openStore(dir)
  fs.writeFileSync(path.join(dir, 'records.jsonl'), JSON.stringify({ id: 'r1', arm: 'A', fill: { avgPrice: 0.5, spent: 1 }, fee: 0.02, feeVersion: 2 }) + '\n')
  fs.writeFileSync(path.join(dir, 'settles.jsonl'), '{"id":"r0","sett')
  old.addSettles([{ id: 'r1', settle: { payout: 2, cost: 1.02, pnl: 0.98 } }])
  assert.equal(old.load().records.r1.settle.payout, 2)
})

t('a stop landing while prices are being read places no new order', async () => {
  const mk = stateWith(T0 + 3600_000)
  const io = { store: { addCal() {}, addOrders() {}, addGameEvents() {}, saveOpen() {} }, clock: () => T0,
    postJson: async () => { mk.final = { verdict: 'stopped' }; return { 11: { BUY: '0.04', SELL: '0.09' } } } }
  await liveRound(mk, io, T0)
  assert.equal(Object.keys(mk.open).length, 0); assert.equal(mk.stats.orders, 0)
})

t('a rate limit or outage is not split into more requests; a rate limit pauses reading for as long as asked', async () => {
  const mk = newMakerState()
  for (let i = 0; i < 300; i++) mk.markets[`G${i}`] = { id: `G${i}`, tokens: [`t${i}`, `u${i}`] }
  const ids = Object.keys(mk.markets)
  let posts = 0
  const fail = (status, extra = {}) => ({ clock: () => T0, log() {}, postJson: async () => { posts++; throw Object.assign(new Error(String(status)), { status, ...extra }) } })
  await readPrices(mk, fail(429, { retryAfterMs: 2 * MIN }), ids)
  assert.equal(posts, 2); assert.equal(mk.stats.unread, 300); assert.equal(mk.backoffUntil, T0 + 2 * MIN)
  posts = 0; await readPrices(mk, fail(503), ids); assert.equal(posts, 2)
  posts = 0; await readPrices(mk, fail(400), ids.slice(0, 4)); assert.equal(posts, 7)   // rejected on its own: halves down to single games
  assert.ok(isSystemic({ status: 502 }) && isSystemic({ timeout: true }) && isSystemic({ code: 'ECONNRESET' }) && !isSystemic({ status: 400 }))
  // liveRound reads nothing while the pause lasts.
  const one = stateWith(T0 + 3600_000)
  one.backoffUntil = T0 + MIN; posts = 0
  await liveRound(one, { store: { addCal() {}, addOrders() {}, addGameEvents() {}, saveOpen() {} }, clock: () => T0 + 30_000, postJson: async () => { posts++; return {} } }, T0 + 30_000)
  assert.equal(posts, 0)
  // The HTTP helpers carry what the callers need.
  const e = httpError({ status: 429, headers: { get: (h) => (h === 'retry-after' ? '30' : null) } }, 'https://x')
  assert.equal(e.status, 429); assert.equal(e.retryAfterMs, 30_000)
  assert.equal(curlError({ code: 22 }, 'curl: (22) The requested URL returned error: 503').status, 503)
  assert.ok(curlError({ code: 28 }, 'curl: (28) Operation timed out').timeout); assert.equal(curlError({ code: 7 }, '').code, 'ECONNREFUSED')
})

t('replay: a write that fails leaves the game unreplayed, then it is replayed once; a rate limit stops the pass, unsplit', async () => {
  const kick = T0 + 3600_000, now = kick + MAKER.tradesAfterMs
  const mk = stateWith(kick)
  mk.closed.M = [order(0, 50, T0, kick)]
  const written = { fills: [], replayed: [] }
  let full = true
  const store = { addTrades() {}, addFills(l) { if (full) throw new Error('no space left'); written.fills.push(...l) }, addReplayed(l) { written.replayed.push(...l) } }
  const getJson = feed(now, { '0xm': [sell('0xm', kick - 30 * MIN)] })
  await replayDue(mk, { store, getJson, log() {}, clock: () => now }, now)
  assert.equal(mk.replayed.M, undefined); assert.equal(Object.keys(mk.fills).length, 0); assert.equal(written.replayed.length, 0); assert.equal(mk.stats.storageErrors, 1)
  full = false
  await replayDue(mk, { store, getJson, log() {}, clock: () => now + 15 * MIN }, now + 15 * MIN)
  assert.equal(mk.replayed.M.status, 'ok'); assert.equal(written.fills.length, 2); assert.equal(written.replayed.length, 1)
  await replayDue(mk, { store, getJson, log() {}, clock: () => now + 30 * MIN }, now + 30 * MIN)
  assert.equal(written.replayed.length, 1)
  // Two games in one request, rate-limited: one request, no halves, and the next pass waits.
  const mk2 = stateWith(kick)
  mk2.markets.N = { ...mk2.markets.M, id: 'N', cid: '0xn' }
  mk2.closed.M = [order(0, 50, T0, kick)]; mk2.closed.N = [{ ...order(0, 50, T0, kick), id: 'N' }]
  let asked = 0
  const limited = async (url) => { if (!new URL(url).searchParams.get('condition_id')) return getJson(url); asked++; throw Object.assign(new Error('429'), { status: 429, retryAfterMs: 20 * MIN }) }
  await replayDue(mk2, { store, getJson: limited, log() {}, clock: () => now }, now)
  assert.equal(asked, 1); assert.equal(mk2.replayBackoffUntil, now + 20 * MIN)
  await replayDue(mk2, { store, getJson: limited, log() {}, clock: () => now + 10 * MIN }, now + 10 * MIN)
  assert.equal(asked, 1); assert.equal(mk2.replayed.M, undefined)
})

t('the daily stop check runs once a UTC day, also across a restart; at the stop it freezes and ends every order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-')), st = openMakerStore(dir)
  const mk = stateWith(T0 + 3600_000)
  st.addMarkets([{ ...mk.markets.M, enrolledAt: isoAt(T0) }])
  let check = makeStopCheck(mk, st)
  assert.equal(check(T0).done, false); assert.equal(mk.stats.lastStopCheck.day, '2026-10-15')
  assert.equal(check(T0 + 3600_000), null)
  const back = st.load(T0 + 2 * 3600_000)
  check = makeStopCheck(back, st)
  assert.equal(check(T0 + 2 * 3600_000), null)                       // the day's check is not repeated after a restart
  const old = { ...back.stats.lastStopCheck }; delete old.day        // a check saved before "day" was recorded
  assert.equal(makeStopCheck({ ...back, stats: { ...back.stats, lastStopCheck: old } }, st)(T0 + 3 * 3600_000), null)
  // Day 28: the stop. Every resting order ends, and the frozen result is saved.
  applyRead(back, 'M', 40, 90, T0 + 28 * 86400_000 - 3600_000, () => {})
  back.markets.M.kickoff = isoAt(T0 + 29 * 86400_000)
  applyRead(back, 'M', 40, 90, T0 + 28 * 86400_000, () => {})
  assert.ok(Object.keys(back.open).length)
  let stopped = null
  const s = makeStopCheck(back, st, (f) => { stopped = f })(T0 + 28 * 86400_000 + MIN)
  assert.equal(s.reason, '28 days'); assert.ok(stopped && back.final); assert.equal(Object.keys(back.open).length, 0)
  const again = st.load(T0 + 28 * 86400_000 + 2 * MIN)
  assert.ok(again.final); assert.equal(Object.keys(again.open).length, 0)
})

t('the bootstrap\'s calibration groups give the same draws when passed in', () => {
  const cal = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, game: `g${i % 70}`, quoted: true, fresh: true, mid: ((i * 37) % 90 + 5) / 100, r0: i % 3 === 0 ? 1 : 0 }))
  const fills = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}:0`, game: `g${i % 15}`, price: 0.3, shares: 10, filledAt: isoAt(T0), kickoff: isoAt(T0 + 3600_000),
    mark: 0.32, markAt: isoAt(T0 + 3600_000 - MIN), settle: { pnl: i % 3 ? -3 : 7, cost: 3 } }))
  assert.deepEqual(markoutBoot(fills, cal, { iters: 300 }), markoutBoot(fills, cal, { iters: 300, calGroups: calGroupsOf(cal) }))
  assert.equal(calGroupsOf(cal).G, 70)
})

for (const [name, fn] of tests) {
  try { await fn(); passed++ } catch (e) { console.error('FAIL', name); throw e }
}
console.log(`polymaker: ${passed} passed`)
