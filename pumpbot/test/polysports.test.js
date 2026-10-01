// Offline tests for the sports paper tracker. No network.
import assert from 'node:assert/strict'
import { sortedAsks, walkAsks, takerFee, isCandidate, decide, settle, profitPerDollar, summarise, RULE } from '../src/polysports.js'

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

console.log(`polysports: ${passed} passed`)
