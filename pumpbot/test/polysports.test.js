// Offline tests for the sports paper tracker. No network.
import assert from 'node:assert/strict'
import { sortedAsks, walkAsks, takerFee, isCandidate, decide, settle, profitPerDollar, summarise, dashboardData, firstRecordMs, calibration, settleAll, freeze, RULE } from '../src/polysports.js'

let passed = 0
const t = (name, fn) => { fn(); passed++ }

t('asks are sorted cheapest first regardless of API order', () => {
  const a = sortedAsks({ asks: [{ price: '0.30', size: '10' }, { price: '0.10', size: '5' }, { price: '0.20', size: '0' }] })
  assert.deepEqual(a.map((x) => x.price), [0.10, 0.30])
})

t('walking $2 through the book pays up through levels', () => {
  const w = walkAsks([{ price: 0.10, size: 10 }, { price: 0.20, size: 100 }], 2)
  assert.equal(w.filled, true)
  assert.ok(Math.abs(w.shares - 15) < 1e-9)          // $1 buys 10 @0.10, $1 buys 5 @0.20
  assert.ok(Math.abs(w.avgPrice - 2 / 15) < 1e-9)
})

t('a thin book does not fill', () => {
  const w = walkAsks([{ price: 0.10, size: 3 }], 2)
  assert.equal(w.filled, false)
  assert.ok(Math.abs(w.spent - 0.3) < 1e-9)
})

t('fee follows the documented formula', () => {
  // 100 shares at 0.5, rate 0.05, exponent 1: 100 × 0.5 × 0.05 × 0.25
  assert.ok(Math.abs(takerFee({ rate: 0.05, exponent: 1 }, 0.5, 100) - 0.625) < 1e-9)
  assert.equal(takerFee(null, 0.5, 100), 0)
})

const now = Date.parse('2026-10-01T12:00:00Z')
const mkt = (over = {}) => ({ id: 7, question: 'Will X win?', outcomes: '["Yes", "No"]', feeType: 'sports_fees_v3', enableOrderBook: true,
  endDate: '2026-10-02T12:00:00Z', clobTokenIds: '["111","222"]', feeSchedule: { rate: 0.05, exponent: 1 }, volumeNum: 50, lastTradePrice: '0.08', ...over })

t('only sports Yes/No markets 22–26h out are candidates', () => {
  assert.equal(isCandidate(mkt(), now), true)
  assert.equal(isCandidate(mkt({ feeType: 'crypto_fees_v2' }), now), false)
  assert.equal(isCandidate(mkt({ outcomes: '["A", "B"]' }), now), false)
  assert.equal(isCandidate(mkt({ endDate: '2026-10-02T16:00:00Z' }), now), false)   // 28h
  assert.equal(isCandidate(mkt({ endDate: '2026-10-02T09:00:00Z' }), now), false)   // 21h
})

t('the rule fires on a cheap filled book and not on an expensive or thin one', () => {
  assert.equal(decide(mkt(), { asks: [{ price: '0.10', size: '1000' }] }, now).rule, true)
  assert.equal(decide(mkt(), { asks: [{ price: '0.40', size: '1000' }] }, now).rule, false)
  assert.equal(decide(mkt(), { asks: [{ price: '0.10', size: '1' }] }, now).rule, false)
  assert.equal(decide(mkt(), { asks: [{ price: '0.01', size: '1000' }] }, now).rule, false)
})

t('settlement pays shares on YES, nothing on NO, waits while open', () => {
  const r = decide(mkt(), { asks: [{ price: '0.10', size: '1000' }] }, now)
  assert.equal(settle(r, { closed: false, outcomePrices: '["1","0"]' }), null)
  const win = settle(r, { closed: true, outcomePrices: '["1","0"]', volumeNum: 2000 })
  assert.ok(Math.abs(win.payout - 20) < 1e-9 && win.pnl > 17)
  const loss = settle(r, { closed: true, outcomePrices: '["0","1"]' })
  assert.ok(Math.abs(loss.pnl + loss.cost) < 1e-9 && loss.cost > 2)
})

t('profit per dollar and its interval are computed on cost including fees', () => {
  const r = decide(mkt(), { asks: [{ price: '0.10', size: '1000' }] }, now)
  const bets = Array.from({ length: 20 }, (_, i) => ({ ...r, settle: settle(r, { closed: true, outcomePrices: i < 2 ? '["1","0"]' : '["0","1"]' }) }))
  bets.forEach((b, i) => { b.event = `match${i % 7}` })
  const p = profitPerDollar(bets)
  assert.equal(p.n, 20); assert.equal(p.events, 7)
  // 2 wins × 20 shares = 40 paid back on 20 × (2 + fee) staked: just under breakeven.
  assert.ok(p.perDollar < 0 && p.perDollar > -0.01)
  assert.ok(p.lo <= p.perDollar && p.perDollar <= p.hi)
})

t('profit stays hidden until the registered stop', () => {
  const r = decide(mkt(), { asks: [{ price: '0.10', size: '1000' }] }, now)
  r.settle = { ...settle(r, { closed: true, outcomePrices: '["1","0"]' }), settledAt: '2026-10-03T00:00:00Z' }
  const s = summarise({ records: { 7: r } }, now + 86400_000)
  assert.equal(s.done, false); assert.equal(s.result, undefined)
  // 400 settled bets alone is not enough before the minimum week has passed.
  const many = Object.fromEntries(Array.from({ length: RULE.stopBets }, (_, i) => [i, { ...r, id: String(i) }]))
  assert.equal(summarise({ records: many }, now + 2 * 86400_000).done, false)
  assert.equal(summarise({ records: many }, now + (RULE.minDays + 0.1) * 86400_000).done, true)
  const late = summarise({ records: { 7: r } }, now + (RULE.stopDays + 1) * 86400_000)
  assert.equal(late.done, true); assert.ok(late.result && late.verdict)
})

// ---------------------------------------------------------------- dashboard + settlement
const OUTCOME_KEYS = ['pnl', 'payout', 'yesPrice', 'won', 'result', 'hitRate', 'avgFill', 'verdict', 'withSlip1c', 'finalVolume1k', 'calibration', 'askMinusLastTrade']
function bookAt(price) { return { asks: [{ price: String(price), size: '10000' }] } }
function stateWith(n, { settledEvery = 1, startMs = now } = {}) {
  const records = {}
  for (let i = 0; i < n; i++) {
    const r = decide(mkt({ id: i, events: [{ id: 'g' + Math.floor(i / 3) }], question: `Q${i} <img src=x onerror=alert(1)>` }), bookAt(0.02 + (i % 9) * 0.02), startMs + i * 60_000)
    if (settledEvery && i % settledEvery === 0) r.settle = { ...settle(r, { closed: true, outcomePrices: i % 10 === 0 ? '["1","0"]' : '["0","1"]' }), settledAt: new Date(startMs + 30 * 3600_000).toISOString() }
    records[r.id] = r
  }
  return { records, lastScanAt: new Date(startMs).toISOString(), lastSettleAt: null, errors: 0 }
}

t('the dashboard carries no outcome before the registered stop', () => {
  const st = stateWith(450)                                    // 450 settled, but only day 2
  const d = dashboardData(st, now + 2 * 86400_000)
  assert.equal(d.done, false)
  const text = JSON.stringify(d)
  for (const k of OUTCOME_KEYS) assert.ok(!text.includes(`"${k}"`), `leaked ${k} before the stop`)
  assert.equal(d.settled, 450); assert.equal(d.ruleBets, 450)
  assert.equal(d.latest.length, 40)
  assert.ok(d.latest.every((b) => !('won' in b) && !('pnl' in b)))
})

t('reaching the stop shows "finishing", still without outcomes, until the result is frozen', () => {
  const st = stateWith(450)
  const d = dashboardData(st, now + (RULE.minDays + 1) * 86400_000)
  assert.equal(d.done, false); assert.equal(d.finishing, true)
  const text = JSON.stringify(d)
  for (const k of OUTCOME_KEYS) assert.ok(!text.includes(`"${k}"`), `leaked ${k} while finishing`)
})

t('after the stop the dashboard carries the result, each outcome and calibration', () => {
  const st = stateWith(450)
  freeze(st, now + (RULE.minDays + 1) * 86400_000)
  const d = dashboardData(st, now + (RULE.minDays + 1) * 86400_000)
  assert.equal(d.done, true)
  assert.ok(d.result && typeof d.result.perDollar === 'number' && d.verdict)
  assert.ok(d.latest.some((b) => b.won === true) && d.latest.some((b) => b.won === false))
  assert.ok(Array.isArray(d.calibration) && d.calibration.length > 0)
  const n = d.calibration.reduce((a, b) => a + b.n, 0)
  assert.equal(n, 450)
  assert.ok(d.calibration.every((b) => b.avgPrice >= b.lo && b.avgPrice < b.hi + 1e-9))
})

t('the frozen result cannot be moved by bets that settle afterwards', () => {
  const st = stateWith(450)
  const later = now + (RULE.minDays + 1) * 86400_000
  const f = freeze(st, later)
  const before = JSON.stringify(dashboardData(st, later).result)
  // A late bet settles a big winner after the stop.
  const extra = decide(mkt({ id: 'late', events: [{ id: 'late' }] }), bookAt(0.02), later)
  extra.settle = { ...settle(extra, { closed: true, outcomePrices: '["1","0"]' }), settledAt: new Date(later + 3600_000).toISOString() }
  st.records.late = extra
  const d = dashboardData(st, later + 2 * 3600_000)
  assert.equal(JSON.stringify(d.result), before)
  assert.equal(d.settled, f.settled)
  assert.ok(d.latest.every((b) => b.counted) && !d.latest.some((b) => b.question === extra.question))
  assert.equal(freeze(st, later + 5 * 86400_000), f)          // idempotent: the first result stands
  assert.ok(!('settledIds' in d))
})

t('dashboard counts: price bins, games, waiting vs before kickoff, stale', () => {
  const st = stateWith(30, { settledEvery: 1000 })            // only record 0 settled
  const d = dashboardData(st, now)                             // games end ~24h out: all before kickoff
  assert.equal(d.priceBins.reduce((a, b) => a + b.n, 0), 30)
  assert.deepEqual(d.priceBins.map((b) => b.n), [4, 4, 4, 3, 3, 3, 3, 3, 3])   // prices 2¢…18¢ in turn
  assert.equal(d.games, 10)
  assert.equal(d.upcoming, 29); assert.equal(d.waiting, 0)
  const later = dashboardData(st, now + 2 * 86400_000)
  assert.equal(later.waiting, 29); assert.equal(later.upcoming, 0)
  assert.ok(later.oldestWaitingAt)
  const stale = dashboardData(st, now + (RULE.unsettledAfterDays + 2) * 86400_000)
  assert.equal(stale.waiting, 0); assert.equal(stale.unsettledStale, 29)
  assert.ok(stale.latest.every((b) => b.status === 'stale' || b.status === 'settled'))
})

t('the verdict date is the 7-day minimum when 400 bets come quickly, and never past 28 days', () => {
  const d = dashboardData(stateWith(450, { settledEvery: 1000 }), now + 3600_000)
  assert.equal(Date.parse(d.eta), now + RULE.minDays * 86400_000)
  const slow = dashboardData(stateWith(2, { settledEvery: 1000 }), now + 3600_000)
  assert.ok(Date.parse(slow.eta) <= now + RULE.stopDays * 86400_000)
})

t('first record time works for 200k records (Math.min spread would throw)', () => {
  const recs = Array.from({ length: 200_000 }, (_, i) => ({ recordedAt: new Date(now + i * 1000).toISOString() }))
  assert.equal(firstRecordMs(recs), now)
  assert.equal(firstRecordMs([]), null)
})

t('calibration ignores unsettled, unfilled and out-of-range records', () => {
  const r = decide(mkt(), bookAt(0.5), now)
  const a = { ...r, settle: { yesPrice: 1 } }
  const thin = { ...decide(mkt(), { asks: [{ price: '0.5', size: '1' }] }, now), settle: { yesPrice: 1 } }
  const cheap = { ...decide(mkt(), bookAt(0.01), now), settle: { yesPrice: 0 } }
  const c = calibration([a, r, thin, cheap])
  assert.equal(c.length, 1); assert.equal(c[0].n, 1); assert.equal(c[0].yesRate, 1)
})

await (async () => {
  // Batched settlement: 120 due records → 3 requests of ≤50 ids; open markets stay pending.
  const st = stateWith(120, { settledEvery: 0 })
  const after = now + 2 * 86400_000                            // games (ending ~24h out) are over
  const calls = []
  const fake = async (url) => {
    const ids = new URL(url).searchParams.getAll('id')
    calls.push({ n: ids.length, closed: new URL(url).searchParams.get('closed') })
    return ids.filter((id) => +id % 2 === 0).map((id) => ({ id, closed: true, outcomePrices: +id % 4 === 0 ? '["1","0"]' : '["0","1"]', volumeNum: 5 }))
  }
  const n = await settleAll(st, fake, after)
  assert.equal(calls.length, 3); assert.ok(calls.every((c) => c.n <= 50 && c.closed === 'true'))
  assert.equal(n, 60)
  assert.equal(Object.values(st.records).filter((r) => r.settle).length, 60)
  assert.equal(st.records['4'].settle.yesPrice, 1); assert.equal(st.records['2'].settle.yesPrice, 0)
  assert.equal(st.records['1'].settle, undefined)
  // A second pass only asks about the 60 still open.
  calls.length = 0
  await settleAll(st, fake, after)
  assert.equal(calls.reduce((a, c) => a + c.n, 0), 60)
  // A failed request counts an error and does not throw.
  const errs = st.errors
  await settleAll(st, async () => { throw new Error('boom') }, after)
  // Nothing is asked about before a game ends, or once it is stale.
  calls.length = 0
  await settleAll(stateWith(5, { settledEvery: 0 }), fake, now)
  await settleAll(stateWith(5, { settledEvery: 0 }), fake, now + (RULE.unsettledAfterDays + 2) * 86400_000)
  assert.equal(calls.length, 0)
  assert.ok(st.errors > errs)
  passed++
})()

console.log(`polysports: ${passed} passed`)
