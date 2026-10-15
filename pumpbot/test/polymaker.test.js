// Offline tests for Test C, the maker paper test. No network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAKER, mil, kickoffOf, ineligible, readOf, quote, sharesFor, evidenceAt, crossSize, applyRead, closeAtKickoff, newMakerState, normTrade, tradesOf,
  classify, replayGame, settleFill, makerSummary, verdictOf, freezeMaker, openMakerStore, liveRound, enroll, replayDue, settleFills, settleCal, makerDashboard, makerExportLines,
  calibrationTable, ratioBoot, fetchTrades, refreshGame } from '../src/polymaker.js'

let passed = 0
const tests = []
const t = (name, fn) => tests.push([name, fn])
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)
const MIN = 60_000
const T0 = Date.parse('2026-10-15T12:00:00Z')

t('prices are compared in whole thousandths: 0.06 + 0.01 is 0.07, 1 − 0.42 is 0.58', () => {
  assert.equal(mil(0.06) + 10, mil(0.07))
  assert.equal(1000 - mil(0.42), mil(0.58))
  assert.equal(mil('0.035'), 35)
})

t('kickoff comes from gameStartTime in Polymarket\'s format; tournaments and fine-tick books are not enrolled', () => {
  assert.equal(kickoffOf({ gameStartTime: '2026-10-16 00:15:00+00' }), Date.parse('2026-10-16T00:15:00Z'))
  assert.equal(kickoffOf({}), null)
  const base = { feeType: 'sports_fees_v2', enableOrderBook: true, outcomes: '["Over","Under"]', orderPriceMinTickSize: 0.01 }
  const k = T0 + 24 * 3600_000, at = (ms) => new Date(ms).toISOString()
  assert.equal(ineligible({ ...base, gameStartTime: at(k).replace('T', ' ').replace('.000Z', '+00'), endDate: at(k) }, T0), null)
  assert.equal(ineligible({ ...base, gameStartTime: at(k - 3 * 86400_000), endDate: at(k) }, T0), 'not a single game')   // a golf event
  assert.equal(ineligible({ ...base, gameStartTime: at(k), endDate: at(k), orderPriceMinTickSize: 0.001 }, T0), 'not a 1¢-tick book')
  assert.equal(ineligible({ ...base, gameStartTime: at(T0 + 3600_000), endDate: at(T0 + 3600_000) }, T0), 'outside the window')
  assert.equal(ineligible({ ...base, feeType: null, gameStartTime: at(k), endDate: at(k) }, T0), 'not a two-outcome sports market')
})

t('the /prices reply: BUY is the best bid, SELL the best ask, "0" means none', () => {
  assert.deepEqual(readOf({ BUY: '0.04', SELL: '0.09' }), { bm: 40, am: 90 })
  assert.deepEqual(readOf({ BUY: '0', SELL: '0.001' }), { bm: null, am: 1 })
  assert.deepEqual(readOf(undefined), { bm: null, am: null })
})

t('quotes: each outcome\'s best bid + 1¢, only on 1¢-grid books with a 3–10¢ spread', () => {
  assert.deepEqual(quote(40, 90), { pm: [50, 920], spread: 50 })     // outcome 1: bid 91¢ → 92¢
  assert.equal(quote(40, 60).reason, 'tight'); assert.ok(quote(40, 70).pm)
  assert.equal(quote(20, 130).reason, 'wide'); assert.ok(quote(20, 120).pm)
  assert.equal(quote(null, 90).reason, 'one-sided')
  assert.equal(quote(45, 95).reason, 'finer tick')
  assert.equal(sharesFor(50), 40); assert.equal(sharesFor(920), 5); assert.equal(sharesFor(300), 6.67)
})

t('evidence: a crossing is a sell offered at or below the order; a touch is the midpoint reaching it or its bid vanishing', () => {
  // outcome 0 bid at 5¢ (book 4/9): crossed when the ask comes to 5¢; touched when the mid reaches 5¢
  assert.deepEqual(evidenceAt(0, 50, 40, 90), { cross: false, touch: false })
  assert.deepEqual(evidenceAt(0, 50, 30, 70), { cross: false, touch: true })     // mid 5¢
  assert.deepEqual(evidenceAt(0, 50, 30, 50), { cross: true, touch: true })
  assert.deepEqual(evidenceAt(0, 50, null, 90), { cross: false, touch: true })   // our outcome's bids gone
  assert.deepEqual(evidenceAt(0, 50, 40, 160), { cross: false, touch: true })    // spread blew out
  // outcome 1 at 92¢: crossed when outcome 0's bid reaches 8¢ (outcome 1 offered at 92¢)
  assert.deepEqual(evidenceAt(1, 920, 40, 90), { cross: false, touch: false })
  assert.deepEqual(evidenceAt(1, 920, 80, 120), { cross: true, touch: true })
  assert.deepEqual(evidenceAt(1, 920, 60, 100), { cross: false, touch: true })   // outcome 1 mid 92¢
  assert.deepEqual(evidenceAt(1, 920, 40, null), { cross: false, touch: true })
})

t('crossing size reads the full book on the right side of the mirror', () => {
  const b = { bids: [{ price: '0.93', size: '4' }, { price: '0.90', size: '9' }], asks: [{ price: '0.06', size: '8' }, { price: '0.05', size: '3' }] }
  assert.equal(crossSize(b, 0, 50), 3); assert.equal(crossSize(b, 0, 40), 0)
  assert.equal(crossSize(b, 1, 80), 4); assert.equal(crossSize(b, 1, 100), 13)
})

const TOK = ['11', '22']
function stateWith(kick = T0 + 10 * 3600_000) {
  const mk = newMakerState()
  mk.markets.M = { id: 'M', cid: '0xm', tokens: TOK, outcomes: ['Over', 'Under'], question: 'Total 2.5', kickoff: new Date(kick).toISOString(), endDate: new Date(kick).toISOString(),
    game: 'a vs b|2026-10-16', event: 'E', sport: 'Soccer', type: 'Over/under', minShares: 5 }
  mk.firstEnrolledAt = new Date(T0).toISOString()
  return mk
}

t('re-pricing: an unchanged price keeps the order resting; a new price ends it and starts another', () => {
  const mk = stateWith(), ended = []
  applyRead(mk, 'M', 40, 90, T0, (o) => ended.push(o))
  assert.equal(mk.open['M:0'].pm, 50); assert.equal(mk.open['M:1'].pm, 920)
  applyRead(mk, 'M', 40, 90, T0 + MIN, (o) => ended.push(o))
  assert.equal(ended.length, 0); assert.equal(mk.open['M:0'].from, T0)
  applyRead(mk, 'M', 50, 90, T0 + 2 * MIN, (o) => ended.push(o))      // bid moves up: outcome 0 re-priced to 6¢, outcome 1 unchanged
  assert.equal(ended.length, 1); assert.equal(ended[0].to, T0 + 2 * MIN); assert.equal(mk.open['M:0'].pm, 60); assert.equal(mk.open['M:1'].from, T0)
  applyRead(mk, 'M', 50, 70, T0 + 3 * MIN, (o) => ended.push(o))      // spread 2¢: no orders
  assert.equal(Object.keys(mk.open).length, 0); assert.equal(ended.length, 3)
})

t('a crossing ends the order, retires that outcome and asks for its size; a touch is noted and the order rests on', () => {
  const mk = stateWith(), ended = []
  applyRead(mk, 'M', 40, 90, T0, (o) => ended.push(o))
  applyRead(mk, 'M', 30, 70, T0 + MIN, (o) => ended.push(o))          // mid 5¢: touch for outcome 0; re-priced to 4¢
  assert.equal(ended[0].touch, T0 + MIN); assert.equal(mk.open['M:0'].pm, 40)
  applyRead(mk, 'M', 30, 40, T0 + 2 * MIN, (o) => ended.push(o))      // ask 4¢: crosses the 4¢ order
  assert.equal(mk.retired['M:0'], true); assert.equal(mk.needSize.length, 1)
  assert.equal(mk.open['M:0'], undefined)
  applyRead(mk, 'M', 40, 90, T0 + 3 * MIN, (o) => ended.push(o))
  assert.equal(mk.open['M:0'], undefined)                             // never quoted again
  assert.ok(mk.open['M:1'])
})

t('orders end at kickoff; reads at or after kickoff are ignored', () => {
  const kick = T0 + 30 * MIN, mk = stateWith(kick), ended = []
  for (let ms = T0; ms < kick; ms += MIN) applyRead(mk, 'M', 40, 90, ms, (o) => ended.push(o))
  closeAtKickoff(mk, kick + MIN, (o) => ended.push(o))
  assert.equal(ended.length, 2); assert.ok(ended.every((o) => o.to === kick && o.from === T0))
  // An order not read for longer than 3 minutes (an outage) ends a minute after it was last seen.
  const mk2 = stateWith(kick), e2 = []
  applyRead(mk2, 'M', 40, 90, T0, (o) => e2.push(o))
  applyRead(mk2, 'M', 40, 90, T0 + 10 * MIN, (o) => e2.push(o))
  assert.equal(e2.length, 2); assert.ok(e2.every((o) => o.late && o.to === T0 + MIN))
  assert.equal(mk2.open['M:0'].from, T0 + 10 * MIN)
  // A book emptied on both sides after being two-sided stops the game for good.
  applyRead(mk2, 'M', null, null, T0 + 11 * MIN, (o) => e2.push(o))
  assert.equal(mk2.markets.M.stopped.why, 'book cleared'); assert.equal(Object.keys(mk2.open).length, 0)
  applyRead(mk2, 'M', 40, 90, T0 + 12 * MIN, (o) => e2.push(o))
  assert.equal(Object.keys(mk2.open).length, 0)
  applyRead(mk, 'M', 40, 90, kick, (o) => ended.push(o))
  assert.equal(Object.keys(mk.open).length, 0)
})

t('trades from the v2 feed and the older one read the same; seconds become ms', () => {
  const v2 = { data: [{ token_id: '11', condition_id: '0xA', price: '0.05', size: '20', side: 'SELL', timestamp: 1792066000, transaction_hash: '0x1' }], pagination: { has_more: false } }
  const v1 = [{ asset: '11', conditionId: '0xA', price: 0.05, size: 20, side: 'SELL', timestamp: 1792066000, transactionHash: '0x1' }]
  assert.deepEqual(tradesOf(v2), tradesOf(v1))
  assert.equal(tradesOf(v2)[0].ms, 1792066000000); assert.equal(tradesOf(v2)[0].pmil, 50)
  assert.equal(normTrade({ token_id: '1', price: 0, size: 1, timestamp: 5 }), null)
})

const tr = (token, price, size, ms, side = 'SELL', tx = 'x' + ms + token + price) => ({ token, pmil: mil(price), size, side, ms, tx, cid: '0xm' })
t('classifying a taker trade against a buy order', () => {
  assert.equal(classify(tr('11', 0.05, 1, 0, 'SELL'), TOK, 0, 50), 'seller')   // sold our outcome at our price
  assert.equal(classify(tr('11', 0.04, 1, 0, 'SELL'), TOK, 0, 50), 'seller')   // below: passed through us
  assert.equal(classify(tr('11', 0.06, 1, 0, 'SELL'), TOK, 0, 50), null)
  assert.equal(classify(tr('22', 0.95, 1, 0, 'BUY'), TOK, 0, 50), 'seller')    // bought the other outcome at 95¢ = a mint against a 5¢ bid
  assert.equal(classify(tr('22', 0.94, 1, 0, 'BUY'), TOK, 0, 50), null)
  assert.equal(classify(tr('11', 0.05, 1, 0, 'BUY'), TOK, 0, 50), 'cross')     // someone bought from a 5¢ sell: it would have crossed us
  assert.equal(classify(tr('22', 0.96, 1, 0, 'SELL'), TOK, 0, 50), 'cross')
  assert.equal(classify({ ...tr('11', 0.05, 1, 0), side: null }, TOK, 0, 50), 'seller')
  // outcome 1 at 92¢, the same in mirror: bid 0.41 / 0.58 edge cases land exactly
  assert.equal(classify(tr('11', 0.08, 1, 0, 'BUY'), TOK, 1, 920), 'seller')
  assert.equal(classify(tr('22', 0.92, 1, 0, 'SELL'), TOK, 1, 920), 'seller')
  assert.equal(classify(tr('22', 0.58, 1, 0, 'SELL'), TOK, 1, mil(0.58)), 'seller')
})

const M = stateWith().markets.M
const order = (side, pm, from, to, extra = {}) => ({ id: 'M', side, pm, price: pm / 1000, shares: sharesFor(pm), from, to, bid: (pm - 10) / 1000, ask: (pm + 40) / 1000, spread: 50, cross: null, touch: null, ...extra })

t('replay: the first order with a seller at or through its price fills, at its own price; later orders never existed', () => {
  const orders = [order(0, 50, T0, T0 + 5 * MIN), order(0, 40, T0 + 5 * MIN, T0 + 10 * MIN)]
  const r = replayGame(M, orders, [tr('11', 0.06, 99, T0 + MIN), tr('11', 0.04, 15, T0 + 3 * MIN), tr('11', 0.03, 50, T0 + 7 * MIN)], 0)
  assert.equal(r.trade.length, 1)
  const f = r.trade[0]
  assert.equal(f.price, 0.05); assert.equal(f.shares, 15); assert.equal(f.source, 'trade'); assert.equal(f.orderFrom, new Date(T0).toISOString())
  near(f.cost, 0.75)
  assert.equal(replayGame(M, orders, [tr('11', 0.06, 99, T0 + MIN)], 0).trade.length, 0)
})

t('replay: the sweep that passes through our price fills it even when another maker sat above us', () => {
  // our bid 6¢; a seller takes 400 at 9¢ (a competitor) then 100 at 4¢ — per-level prints
  const r = replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.09, 400, T0 + MIN, 'SELL', 'tx1'), tr('11', 0.04, 100, T0 + MIN, 'SELL', 'tx1')], 0)
  assert.equal(r.trade.length, 1); assert.equal(r.trade[0].shares, sharesFor(60))
})

t('replay: a print near a boundary that qualifies for both neighbours goes to the dearer one', () => {
  const L = MIN
  const orders = [order(0, 40, T0, T0 + 5 * MIN), order(0, 60, T0 + 5 * MIN, T0 + 10 * MIN)]
  // stamped 30 s after the switch: could have matched against either order; both qualify (3¢)
  const r = replayGame(M, orders, [tr('11', 0.03, 50, T0 + 5 * MIN + 30_000)], L)
  assert.equal(r.trade[0].price, 0.06)
  // stamped 2 min into the second order: only the second
  assert.equal(replayGame(M, orders, [tr('11', 0.05, 50, T0 + 7 * MIN)], L).trade[0].price, 0.06)
  // a crossing print counts only if its whole uncertainty window lies inside the order
  assert.equal(replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.05, 50, T0 + 30_000, 'BUY')], L).trade.length, 0)
  assert.equal(replayGame(M, [order(0, 60, T0, T0 + 5 * MIN)], [tr('11', 0.05, 50, T0 + 2 * MIN, 'BUY')], L).trade.length, 1)
})

t('replay: a crossing seen live fills under both rules; a touch fills only under the touch rule, at full size', () => {
  const crossed = order(0, 50, T0, T0 + 2 * MIN, { cross: { at: T0 + 2 * MIN, size: 7 }, touch: T0 + 2 * MIN })
  const r = replayGame(M, [crossed], [], 0)
  assert.equal(r.trade[0].shares, 7); assert.equal(r.trade[0].source, 'cross')
  assert.equal(r.touch[0].shares, sharesFor(50)); assert.equal(r.touch[0].source, 'touch')
  const touched = [order(0, 50, T0, T0 + 5 * MIN, { touch: T0 + 3 * MIN }), order(0, 40, T0 + 5 * MIN, T0 + 9 * MIN)]
  const r2 = replayGame(M, touched, [tr('11', 0.04, 10, T0 + 6 * MIN)], 0)
  assert.equal(r2.trade[0].price, 0.04)                 // trade rule: the later order, by a real seller
  assert.equal(r2.touch[0].price, 0.05)                 // touch rule: picked off at 5¢ first
  assert.equal(r2.touch[0].filledAt, new Date(T0 + 3 * MIN).toISOString())
})

t('replay: the same fill listed twice counts once; both outcomes can fill', () => {
  const dup = tr('11', 0.05, 10, T0 + MIN, 'SELL', '0xdup')
  const r = replayGame(M, [order(0, 50, T0, T0 + 5 * MIN), order(1, 920, T0, T0 + 5 * MIN)], [dup, { ...dup }, tr('11', 0.08, 3, T0 + 2 * MIN, 'BUY')], 0)
  assert.equal(r.trade.find((f) => f.side === 0).shares, 10)
  assert.equal(r.trade.find((f) => f.side === 1).shares, 3)
})

t('settling pays shares × the resolution price of the outcome bought, no fee', () => {
  const s = settleFill({ side: 1, shares: 5, price: 0.92 }, { closed: true, outcomePrices: '["0","1"]' })
  near(s.payout, 5); near(s.cost, 4.6); near(s.pnl, 0.4)
  assert.equal(settleFill({ side: 1, shares: 5, price: 0.92 }, { closed: false, outcomePrices: '["0","1"]' }), null)
  assert.equal(settleFill({ side: 1, shares: 5, price: 0.92 }, { closed: true, outcomePrices: '["0.5","0.4"]' }), null)
})

function fakeFill(world, i, won, price = 0.5, mark = price + 0.01) {
  const shares = 4
  return { world, id: `F${i}:0`, marketId: `F${i}`, side: 0, price, shares, cost: shares * price, game: 'g' + i, source: 'trade', kickoff: new Date(T0).toISOString(), mark,
    fill: { shares, spent: shares * price, avgPrice: price, filled: true }, fee: 0, settle: { yesPrice: won ? 1 : 0, payout: won ? shares : 0, cost: shares * price, pnl: (won ? shares : 0) - shares * price } }
}

t('the calibration correction is the average (result − kickoff midpoint) per 5¢ band, both outcomes, 0 below 30 outcomes', () => {
  const cal = []
  for (let i = 0; i < 40; i++) cal.push({ mid: 0.12, r0: i < 4 ? 1 : 0 })        // 12¢ outcomes came true 10%: −2¢; their 88¢ mirrors +2¢
  const c = calibrationTable(cal)
  near(c.c(0.12), -0.02); near(c.c(0.88), 0.02)
  assert.equal(c.c(0.5), 0)
  assert.equal(calibrationTable(cal.slice(0, 10)).c(0.12), 0)                      // too few to correct
})

t('ratio bootstrap resamples whole matches', () => {
  const r = ratioBoot([{ cluster: 'a', value: 1, cost: 10 }, { cluster: 'a', value: 1, cost: 10 }, { cluster: 'b', value: -1, cost: 10 }], { iters: 500 })
  near(r.perDollar, 1 / 30); assert.equal(r.matches, 2); assert.ok(r.lo <= r.perDollar && r.hi >= r.perDollar)
})

t('the verdict: per side, the corrected markout must clear zero under both rules and the outcome must not be negative; data gates come first', () => {
  const ok = { markout: { lo: 0.01 }, outcome: { perDollar: 0.02 } }
  const s = (cheaper, dearer, gate = null) => verdictOf({ gate, sides: { cheaper, dearer } })
  assert.equal(s({ trade: ok, touch: ok }, { trade: null, touch: null }), 'YES — cheaper side: resting orders made money under both fill rules')
  assert.equal(s({ trade: ok, touch: { markout: { lo: -0.01 } } }, {}), 'NO — the cheaper side made money only if stale orders are never picked off')
  assert.equal(s({ trade: { markout: { lo: 0.01 }, outcome: { perDollar: -0.1 } }, touch: ok }, {}).startsWith('NO'), true)
  assert.equal(s({ trade: ok, touch: ok }, { trade: ok, touch: ok }, 'only 12 settled fills (needs 100)'), 'INCONCLUSIVE — only 12 settled fills (needs 100)')
})

t('summary and stop: 300 matches and 7 days, or 28 days; futility from day 3; fewer than 100 settled fills is inconclusive', () => {
  const mk = stateWith()
  for (let i = 0; i < 10; i++) for (const w of ['trade', 'touch']) mk.fills[`${w}|F${i}:0`] = fakeFill(w, i, i % 2 === 0)
  let s = makerSummary(mk, T0 + 2 * 86400_000)
  assert.equal(s.matches, 10); assert.equal(s.done, false)
  near(s.pooled.trade.outcome.perDollar, 0); near(s.pooled.trade.markout.perDollar, 0.02)
  assert.equal(s.sides.dearer.trade.fills, 10); assert.equal(s.sides.cheaper.trade.fills, 0)
  s = makerSummary(mk, T0 + 29 * 86400_000)
  assert.equal(s.done, true); assert.equal(s.verdict, 'INCONCLUSIVE — only 10 settled fills (needs 100)')
  // 160 matches of fills bought 5¢ above where the price stood at kickoff: futile from day 3.
  const bad = stateWith()
  for (let i = 0; i < 160; i++) for (const w of ['trade', 'touch']) bad.fills[`${w}|F${i}:0`] = fakeFill(w, i, false, 0.5, 0.45)
  assert.equal(makerSummary(bad, T0 + 2 * 86400_000).done, false)
  const f = makerSummary(bad, T0 + 3.1 * 86400_000)
  assert.equal(f.futile, true); assert.equal(f.verdict, 'NO — stopped for futility')
  const fr = freezeMaker(bad, T0 + 3.1 * 86400_000)
  assert.equal(fr.settledIds.length, 320); assert.equal(freezeMaker(bad, T0 + 4 * 86400_000), fr)
})

t('a fresh Gamma record: an earlier kickoff ends quoting then, a later one does not extend it, a closed market stops', () => {
  const m = { kickoff: new Date(T0 + 10 * 3600_000).toISOString() }
  refreshGame(m, { gameStartTime: new Date(T0 + 12 * 3600_000).toISOString(), endDate: new Date(T0 + 12 * 3600_000).toISOString() }, T0)
  assert.equal(m.kickoff, new Date(T0 + 10 * 3600_000).toISOString())
  refreshGame(m, { gameStartTime: new Date(T0 + 9 * 3600_000).toISOString(), endDate: new Date(T0 + 12 * 3600_000).toISOString() }, T0)
  assert.equal(m.kickoff, new Date(T0 + 9 * 3600_000).toISOString())
  refreshGame(m, { closed: true, endDate: m.kickoff }, T0)
  assert.equal(m.stopped.why, 'closed')
})

t('a trade reply that could silently mean "no trades" is an error instead', async () => {
  const mk = newMakerState()
  const io = (body) => ({ getJson: async () => body })
  await assert.rejects(fetchTrades(io({ nope: 1 }), mk, ['0xa'], 0, 1), /without data/)
  await assert.rejects(fetchTrades(io({ data: [], pagination: { has_more: true } }), mk, ['0xa'], 0, 1), /without a cursor/)
  await assert.rejects(fetchTrades(io({ data: [{ token_id: '1', condition_id: '0xB', price: 0.5, size: 1, timestamp: 5 }] }), mk, ['0xa'], 0, 1), /not asked for/)
  await assert.rejects(fetchTrades(io(Array.from({ length: 1000 }, () => ({ asset: '1', conditionId: '0xa', price: 0.5, size: 1, timestamp: 5 }))), mk, ['0xa'], 0, 1), /full page/)
  // Paged: the same record repeated across pages counts once; repeated within a page it stays.
  const rec = { token_id: '1', condition_id: '0xA', price: 0.5, size: 1, side: 'SELL', timestamp: 5, transaction_hash: '0x9' }
  let n = 0
  const paged = { getJson: async () => (n++ === 0 ? { data: [rec, rec], pagination: { has_more: true, next_cursor: 'c' } } : { data: [rec], pagination: { has_more: false } }) }
  assert.equal((await fetchTrades(paged, mk, ['0xa'], 0, 1)).length, 2)
})

t('storage: open orders rest through a restart; replayed games keep only their fills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-'))
  const st = openMakerStore(dir)
  const mk = stateWith()
  st.addMarkets([mk.markets.M, { ...mk.markets.M, id: 'N' }])
  applyRead(mk, 'M', 40, 90, T0, () => {})
  st.saveOpen(mk)
  st.addOrders([order(0, 50, T0 - 5 * MIN, T0, { id: 'N' })])
  const f = fakeFill('trade', 1, true); f.id = 'M:0'; f.marketId = 'M'
  st.addFills([f]); st.addSettles([f])
  st.addReplayed([{ id: 'N', status: 'ok' }])
  mk.stats.orders = 9; st.saveMeta(mk)
  fs.appendFileSync(path.join(dir, 'maker-fills.jsonl'), '{"torn')
  const back = st.load()
  assert.equal(back.open['M:0'].pm, 50); assert.equal(back.open['M:0'].from, T0)
  assert.equal(back.markets.M.mark.mid, 0.065)
  assert.equal(back.markets.N, undefined); assert.equal(back.closed.N, undefined)     // replayed, no fills
  assert.equal(back.fills['trade|M:0'].settle.pnl, f.settle.pnl)
  assert.equal(back.stats.orders, 9); assert.equal(back.stats.restarts, 1)
})

t('a full day against fake Polymarket endpoints: enrol, quote, end at kickoff, replay the trades, settle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maker-'))
  const store = openMakerStore(dir)
  const mk = newMakerState()
  let now = T0
  const kick = T0 + 24 * 3600_000
  const market = { id: '77', conditionId: '0xC', clobTokenIds: JSON.stringify(TOK), outcomes: '["Over","Under"]', question: 'O/U 2.5', feeType: 'sports_fees_v2', enableOrderBook: true,
    orderPriceMinTickSize: 0.01, orderMinSize: 5, gameStartTime: new Date(kick).toISOString().replace('T', ' ').replace('.000Z', '+00'), endDate: new Date(kick).toISOString(),
    events: [{ id: '5', title: 'A vs. B - Totals', eventDate: '2026-10-16', series: [{ id: '9' }] }], sportsMarketType: 'totals' }
  const calls = []
  const io = {
    store, log: () => {}, clock: () => now,
    getJson: async (url) => {
      calls.push(url)
      if (url.includes('/markets/keyset')) return { markets: [market], next_cursor: null }
      if (url.includes('/v2/trades')) {
        const q = new URL(url).searchParams
        if (!q.get('condition_id')) return { data: [{ token_id: '99', condition_id: '0xz', price: '0.5', size: '1', side: 'BUY', timestamp: Math.floor(now / 1000) }], pagination: { has_more: false } }
        assert.equal(q.get('condition_id'), '0xc'); assert.equal(q.get('taker_only'), 'true')
        return { data: [{ token_id: '11', condition_id: '0xC', price: '0.05', size: '25', side: 'SELL', timestamp: Math.floor((T0 + 3 * MIN) / 1000), transaction_hash: '0xt' }], pagination: { has_more: false } }
      }
      if (url.includes('gamma-api.polymarket.com/markets?')) return [{ id: '77', closed: true, outcomePrices: '["1","0"]' }]
      throw new Error('unexpected ' + url)
    },
    postJson: async (url, body) => { calls.push(url); return Object.fromEntries(body.filter((b) => b.side === 'BUY').map((b) => [b.token_id, { BUY: '0.04', SELL: '0.09' }])) },
  }
  const e = await enroll(mk, io, now, null)
  assert.equal(e.added, 1)
  assert.equal((await enroll(mk, io, now + MIN, null)).added, 0)          // each market is enrolled once
  const r1 = await liveRound(mk, io, now)
  assert.equal(r1.resting, 2)
  now += MIN
  await liveRound(mk, io, now)
  assert.equal(mk.open['77:0'].from, mk.open['77:0'].from)
  assert.equal((await replayDue(mk, io, now)).replayed, 0)               // not two hours after kickoff yet
  now = kick + 1
  const r3 = await liveRound(mk, io, now)
  assert.equal(r3.resting, 0); assert.equal(mk.closed['77'].length, 2)
  now = kick + MAKER.tradesAfterMs
  const rp = await replayDue(mk, io, now)
  assert.equal(rp.replayed, 1)
  assert.equal(mk.fills['trade|77:0'].shares, 25); assert.equal(mk.fills['trade|77:0'].price, 0.05)
  assert.equal(mk.fills['trade|77:1'], undefined)
  assert.equal(await settleFills(mk, io, now), 2)                         // the trade and touch fills of outcome 0
  assert.equal(mk.cal['77'].mid, 0.065)                                    // its midpoint at kickoff, for the calibration
  assert.equal(await settleCal(mk, io, now), 1); assert.equal(mk.cal['77'].r0, 1)
  near(mk.fills['trade|77:0'].settle.pnl, 25 - 1.25)
  const d = makerDashboard(mk, now)
  assert.equal(d.kind, 'maker'); assert.equal(d.view.fills, 1); assert.equal(d.results.length, 1)
  assert.ok(makerExportLines(mk, now).some((l) => l.kind === 'fill'))
  const back = openMakerStore(dir).load(now)
  assert.equal(back.fills['trade|77:0'].settle.yesPrice, 1); assert.equal(back.replayed['77'].status, 'ok')
  assert.equal(back.cal['77'].r0, 1); assert.ok(back.enrolled.has('77'))
})

for (const [name, fn] of tests) {
  try { await fn(); passed++ } catch (e) { console.error('FAIL', name); throw e }
}
console.log(`polymaker: ${passed} passed`)
