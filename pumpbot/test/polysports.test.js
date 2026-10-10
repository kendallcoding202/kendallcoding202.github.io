// Offline tests for the sports paper tracker. No network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sortedAsks, walkAsks, takerFee, isCandidate, armOf, matchKeyOf, decide, settle, profitPerDollar, summarise, dashboardData, firstRecordMs, calibration, settleAll, freeze,
  sportsIndex, betTypeOf, tagsOf, tagMissing, breakdown, openStore, correctFee, armFor, refineSport, WATCH_SPORTS, RULE } from '../src/polysports.js'

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

t('fee follows Polymarket\'s own client: shares × rate × (p(1−p))^exponent', () => {
  // 100 shares at 0.5, rate 0.05, exponent 1: 100 × 0.05 × 0.25 = $1.25 (the docs' sports maximum per 100 shares)
  assert.ok(Math.abs(takerFee({ rate: 0.05, exponent: 1 }, 0.5, 100) - 1.25) < 1e-9)
  // The docs' table: 100 shares at 10¢, rate 0.07 → $0.63.
  assert.ok(Math.abs(takerFee({ rate: 0.07, exponent: 1 }, 0.10, 100) - 0.63) < 1e-9)
  // A $2 bet at 10¢ on a sports market pays about 4.5% of the stake in fees.
  assert.ok(Math.abs(takerFee({ rate: 0.05, exponent: 1 }, 0.10, 20) / 2 - 0.045) < 1e-9)
  assert.equal(takerFee(null, 0.5, 100), 0)
})


const now = Date.parse('2026-10-01T12:00:00Z')
const mkt = (over = {}) => ({ id: 7, question: 'Will X win?', outcomes: '["Yes", "No"]', feeType: 'sports_fees_v3', enableOrderBook: true,
  endDate: '2026-10-02T12:00:00Z', clobTokenIds: '["111","222"]', feeSchedule: { rate: 0.05, exponent: 1 }, volumeNum: 50, lastTradePrice: '0.08', ...over })

t('records from before the correction are brought onto the true fee exactly', () => {
  const r = decide(mkt(), { asks: [{ price: '0.08', size: '1000' }] }, now)
  const truth = r.fee
  const old = { ...r, fill: { ...r.fill }, fee: truth * 0.08 }; delete old.feeVersion      // what the first version stored
  old.settle = { payout: 0, cost: old.fill.spent + old.fee, pnl: -(old.fill.spent + old.fee), yesPrice: 0 }
  correctFee(old)
  assert.ok(Math.abs(old.fee - truth) < 1e-12)
  assert.ok(Math.abs(old.settle.cost - (2 + truth)) < 1e-9 && Math.abs(old.settle.pnl + 2 + truth) < 1e-9)
  correctFee(old); assert.ok(Math.abs(old.fee - truth) < 1e-12)                            // idempotent
  assert.equal(correctFee({ ...r }).fee, truth)                                             // new records untouched
})

t('sports two-outcome markets 22–26h out are candidates: Yes/No for test A, the rest for test B', () => {
  assert.equal(isCandidate(mkt(), now), true)
  assert.equal(armOf(mkt()), 'A')
  assert.equal(isCandidate(mkt({ feeType: 'crypto_fees_v2' }), now), false)
  assert.equal(armOf(mkt({ outcomes: '["Over", "Under"]' })), 'B')
  assert.equal(isCandidate(mkt({ outcomes: '["Over", "Under"]' }), now), true)
  assert.equal(isCandidate(mkt({ outcomes: '["Over", "Under"]' }), now, ['A']), false)    // a stopped test B is not scanned
  assert.equal(isCandidate(mkt(), now, ['B']), false)
  assert.equal(armOf(mkt({ outcomes: '["A", "B", "C"]' })), null)
  assert.equal(armOf(mkt({ outcomes: 'not json' })), null)
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
  bets.forEach((b, i) => { b.game = `match${i % 7}` })
  const p = profitPerDollar(bets)
  assert.equal(p.n, 20); assert.equal(p.events, 7)
  // 2 wins × 20 shares = 40 paid back on 20 × (2 + 0.09 fee) staked: −4.3%, the fee alone.
  assert.ok(Math.abs(p.perDollar - (40 / (20 * 2.09) - 1)) < 1e-9)
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
const OUTCOME_KEYS = ['pnl', 'payout', 'yesPrice', 'won', 'result', 'hitRate', 'avgFill', 'verdict', 'withSlip1c', 'finalVolume1k', 'calibration', 'askMinusLastTrade',
  'wins', 'losses', 'perDollar', 'profitLo', 'profitHi', 'viewResult', 'settledIds', 'counted', 'resolved']
const INDEX = sportsIndex([{ sport: 'epl', name: 'Premier League', tags: '1,100639,100350', series: 'S1' }, { sport: 'nhl', name: 'NHL', tags: '1,899', series: 'S2' }])
function bookAt(price) { return { asks: [{ price: String(price), size: '10000' }] } }
function stateWith(n, { settledEvery = 1, startMs = now } = {}) {
  const records = {}
  for (let i = 0; i < n; i++) {
    const r = decide(mkt({ id: i, events: [{ id: 'e' + i, title: `Club ${Math.floor(i / 3)} vs. Club X - Result ${i % 3}`, eventDate: '2026-10-02', series: [{ id: i % 2 ? 'S1' : 'S2' }] }], sportsMarketType: i % 3 ? 'moneyline' : 'soccer_exact_score',
      question: `Q${i} <img src=x onerror=alert(1)>` }), bookAt(0.02 + (i % 9) * 0.02), startMs + i * 60_000, INDEX)
    if (settledEvery && i % settledEvery === 0) r.settle = { ...settle(r, { closed: true, outcomePrices: i % 10 === 0 ? '["1","0"]' : '["0","1"]' }), settledAt: new Date(startMs + 30 * 3600_000).toISOString() }
    records[r.id] = r
  }
  return { records, lastScanAt: new Date(startMs).toISOString(), lastSettleAt: null, errors: 0 }
}

t('before the stop the dashboard shows the running result, but never a verdict', () => {
  // Amendment 3: the running result is shown at the user's request; the verdict waits for the stop.
  const st = stateWith(450)                                    // 450 settled, but only day 2
  const d = dashboardData(st, now + 2 * 86400_000)
  assert.equal(d.done, false); assert.equal(d.running, true)
  assert.equal(d.verdict, undefined)
  assert.equal(d.result.n, 450); assert.ok(d.result.lo <= d.result.perDollar && d.result.perDollar <= d.result.hi)
  assert.equal(d.hitRate, 45 / 450)                                                    // every 10th bet won
  assert.equal(d.settled, 450); assert.equal(d.ruleBets, 450)
  assert.equal(d.latest.length, 40)
  assert.ok(d.latest.every((b) => typeof b.won === 'boolean' && typeof b.pnl === 'number'))
  assert.ok(d.latest.every((b) => b.arm === 'A' && b.outcome === 'Yes'))              // what was bought, always
  const f = dashboardData(st, now + 2 * 86400_000, { sport: 'Soccer', type: 'Exact score' })
  assert.equal(f.viewResult.result.n, f.view.settled)
  // Every filter combination works, the empty test B included, and none carries a verdict.
  for (const o of [{ sport: 'Hockey', type: 'Moneyline' }, { arm: 'B' }, { arm: 'W' }]) assert.equal(dashboardData(st, now + 2 * 86400_000, o).verdict, undefined)
})

t('reaching the stop shows "finishing", with the running result but no verdict, until it is frozen', () => {
  const st = stateWith(450)
  const d = dashboardData(st, now + (RULE.minDays + 1) * 86400_000)
  assert.equal(d.done, false); assert.equal(d.finishing, true)
  assert.equal(d.verdict, undefined); assert.equal(d.result.n, 450)
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
  assert.equal(d.view.games, 10)
  assert.equal(d.view.upcoming, 29); assert.equal(d.view.waiting, 0)
  // The upcoming list is every unsettled bet, soonest kickoff first, whenever it was placed.
  assert.equal(d.upcoming.length, 29)
  assert.ok(d.upcoming.every((b) => b.status !== 'settled'))
  assert.ok(d.upcoming.every((b, i, a) => i === 0 || Date.parse(a[i - 1].endDate) <= Date.parse(b.endDate)))
  const later = dashboardData(st, now + 2 * 86400_000)
  assert.equal(later.view.waiting, 29); assert.equal(later.view.upcoming, 0)
  assert.ok(later.oldestWaitingAt)
  const stale = dashboardData(st, now + (RULE.unsettledAfterDays + 2) * 86400_000)
  assert.equal(stale.view.waiting, 0); assert.equal(stale.unsettledStale, 29); assert.equal(stale.view.stale, 29)
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


// ---------------------------------------------------------------- sport, bet type, test B
t('sports come from directory tags, or the league code when a big league has none', () => {
  const ix = sportsIndex([
    { sport: 'tur', name: 'Süper Lig', tags: '1,100639,100350', series: '10292' },
    { sport: 'nfl', name: 'NFL', tags: '1,450,100639', series: '10187' },
    { sport: 'bkkbl', name: 'KBL', tags: '1,28,100639', series: '20001,20002' },
    { sport: 'mystery', name: 'Mystery', tags: '1', series: '9' },
  ])
  assert.deepEqual(ix.get('10292'), { sport: 'Soccer', league: 'Süper Lig' })
  assert.equal(ix.get('10187').sport, 'NFL')
  assert.equal(ix.get('20002').sport, 'Basketball')
  assert.equal(ix.get('9').sport, 'Other')
  const m = mkt({ events: [{ id: 'e', series: [{ id: '10292', title: 'Süper Lig 2025' }] }], sportsMarketType: 'soccer_exact_score' })
  assert.deepEqual(tagsOf(m, ix), { seriesId: '10292', sport: 'Soccer', league: 'Süper Lig', type: 'Exact score', typeRaw: 'soccer_exact_score' })
  assert.equal(tagsOf(m, null).sport, null)                                     // directory not read yet: tagged later
  assert.equal(tagsOf(mkt({ events: [{ id: 'e' }] }), ix).sport, 'Other')        // no league at all
})

t('bet types are grouped the way a bettor reads them', () => {
  const cases = { moneyline: 'Moneyline', totals: 'Over/under', first_half_totals: 'Over/under', q3_totals: 'Over/under', spreads: 'Spread',
    team_totals: 'Team total O/U', soccer_first_half_team_totals: 'Team total O/U', total_corners: 'Corners', soccer_team_total_corners: 'Corners',
    soccer_game_corners_odd_even: 'Corners', soccer_first_corner: 'Corners', soccer_exact_score: 'Exact score', soccer_halftime_result: 'Half result',
    soccer_second_half_result: 'Half result', soccer_first_to_score: 'First to score', both_teams_to_score_first_half: 'Both teams to score',
    player_points: 'Player prop', something_new: 'Other' }
  for (const [raw, label] of Object.entries(cases)) assert.equal(betTypeOf(raw), label, raw)
  assert.equal(betTypeOf(null), 'Other')
})

t('one match is one bootstrap unit, however Polymarket splits it into events', () => {
  const ev = (id, title, gameId) => mkt({ events: [{ id, title, eventDate: '2026-10-10', ...(gameId ? { gameId } : {}) }] })
  const k = matchKeyOf(ev('1', 'Çaykur Rizespor vs. Fenerbahçe SK', 90119459))
  assert.equal(matchKeyOf(ev('2', 'Çaykur Rizespor vs. Fenerbahçe SK - Exact Score', 90119459)), k)
  assert.equal(matchKeyOf(ev('3', 'Çaykur Rizespor vs. Fenerbahçe SK - Total Corners')), k)      // no gameId on corners events
  assert.notEqual(matchKeyOf(mkt({ events: [{ id: '4', title: 'Çaykur Rizespor vs. Fenerbahçe SK', eventDate: '2026-10-17' }] })), k)
  assert.notEqual(matchKeyOf(ev('5', 'FC Porto vs. CS Marítimo')), k)
  // The bootstrap groups by match: 6 contracts on 2 matches are 2 units, not 6.
  const r = decide(ev('1', 'A vs. B'), bookAt(0.1), now)
  const bets = ['A vs. B', 'A vs. B - Exact Score', 'A vs. B - Halftime Result', 'C vs. D', 'C vs. D - Exact Score', 'C vs. D - Total Corners']
    .map((title, i) => { const b = decide(ev('x' + i, title), bookAt(0.1), now); b.settle = settle(b, { closed: true, outcomePrices: '["0","1"]' }); return b })
  assert.equal(profitPerDollar(bets).events, 2)
  assert.ok(r.game.startsWith('a vs. b|'))
})

const twoWay = (over = {}) => mkt({ outcomes: '["Over", "Under"]', question: 'A vs. B: O/U 4.5', sportsMarketType: 'totals', lastTradePrice: '0.88', ...over })
t('test B buys the cheaper side the book can fill, and settles on that side', () => {
  const r = decide(twoWay(), [bookAt(0.90), bookAt(0.12)], now)
  assert.equal(r.arm, 'B'); assert.equal(r.side, 1); assert.equal(r.outcome, 'Under'); assert.equal(r.rule, true)
  assert.ok(Math.abs(r.fill.avgPrice - 0.12) < 1e-9)
  assert.equal(r.token, '222')
  assert.equal(r.feeRate, 0.05); assert.equal(r.feeExp, 1)
  assert.ok(Math.abs(r.lastTrade - 0.12) < 1e-9)                               // the second side's last trade is the complement
  assert.ok(Math.abs(settle(r, { closed: true, outcomePrices: '["0","1"]' }).payout - r.fill.shares) < 1e-9)
  assert.equal(settle(r, { closed: true, outcomePrices: '["1","0"]' }).payout, 0)
  // A side that cannot fill $2 is not chosen, even when its top price is lower.
  const thin = decide(twoWay(), [bookAt(0.15), { asks: [{ price: '0.05', size: '3' }] }], now)
  assert.equal(thin.side, 0); assert.equal(thin.rule, true)
  // Neither side cheap: recorded for calibration, not a bet, and kept slim.
  const mid = decide(twoWay(), [bookAt(0.55), bookAt(0.47)], now)
  assert.equal(mid.rule, false); assert.equal(mid.side, 1); assert.equal(mid.question, undefined)
})

t('each test stops and freezes on its own', () => {
  const st = stateWith(450)
  for (let i = 0; i < 30; i++) {
    const r = decide(twoWay({ id: 'b' + i, events: [{ id: 'bg' + i }] }), [bookAt(0.9), bookAt(0.1)], now + 6 * 86400_000)
    r.settle = { ...settle(r, { closed: true, outcomePrices: '["0","1"]' }), settledAt: new Date(now + 7 * 86400_000).toISOString() }
    st.records[r.id] = r
  }
  const at = now + (RULE.minDays + 1) * 86400_000
  assert.equal(summarise(st, at, { arm: 'A', withhold: true }).done, true)
  assert.equal(summarise(st, at, { arm: 'B', withhold: true }).done, false)     // B started day 6; 30 bets
  freeze(st, at, 'A')
  assert.ok(st.finalByArm.A && !st.finalByArm.B)
  const b = dashboardData(st, at, { arm: 'B' })
  assert.equal(b.done, false); assert.equal(b.verdict, undefined)                     // B keeps running, no verdict
  assert.equal(b.result.n, 30)                                                        // its own bets only, none of A's
  assert.equal(b.view.bets, 30)
  assert.deepEqual(b.arms.map((x) => [x.key, x.done]), [['A', true], ['B', false]])
  assert.equal(dashboardData(st, at, { arm: 'A' }).done, true)
  assert.equal(dashboardData(st, at, { arm: 'nonsense' }).arm, 'A')
})

t('breakdowns by sport and bet type: running records before the stop, frozen ones after', () => {
  const st = stateWith(450)
  const before = dashboardData(st, now + 2 * 86400_000)
  assert.deepEqual(before.bySport.map((x) => [x.name, x.bets]).sort(), [['Hockey', 225], ['Soccer', 225]])
  assert.deepEqual(before.byType.map((x) => [x.name, x.bets]).sort(), [['Exact score', 150], ['Moneyline', 300]])
  assert.equal(before.bySport.reduce((a, x) => a + x.wins, 0), 45)
  // A bet settling after the stop moves the running numbers before it, never the frozen ones after.
  const at = now + (RULE.minDays + 1) * 86400_000
  freeze(st, at, 'A')
  const after = dashboardData(st, at)
  const soccer = after.bySport.find((x) => x.name === 'Soccer')
  assert.equal(soccer.wins + soccer.losses, soccer.counted)
  assert.ok(soccer.perDollar !== null && soccer.profitLo <= soccer.perDollar && soccer.perDollar <= soccer.profitHi)
  assert.equal(after.bySport.reduce((a, x) => a + x.counted, 0), after.settled)
  // A filter narrows every count and the list, and gives that slice's own result.
  const f = dashboardData(st, at, { sport: 'Soccer', type: 'Exact score' })
  assert.ok(f.view.bets > 0 && f.view.bets < after.view.bets)
  assert.ok(f.latest.every((x) => x.sport === 'Soccer' && x.type === 'Exact score'))
  assert.ok(f.viewResult && f.viewResult.result.n === f.view.settled)
  assert.equal(f.settled, after.settled)                                          // the stop and verdict stay the whole test's
  assert.deepEqual(f.byType.map((x) => x.name).sort(), ['Exact score', 'Moneyline'])   // the other dimension stays visible
  assert.ok(f.byType.every((x) => x.bets <= soccer.bets))
  const frozenSoccer = JSON.stringify(soccer)
  const late = decide(mkt({ id: 'late2', events: [{ id: 'x', title: 'Late', series: [{ id: 'S2' }] }] }), bookAt(0.05), at, INDEX)
  late.settle = { ...settle(late, { closed: true, outcomePrices: '["1","0"]' }), settledAt: new Date(at + 3600_000).toISOString() }
  st.records.late2 = late; st.version = (st.version ?? 0) + 1
  assert.equal(JSON.stringify(dashboardData(st, at + 7200_000).bySport.find((x) => x.name === 'Soccer')), frozenSoccer)
})

// ---------------------------------------------------------------- the watch list
const WIX = sportsIndex([{ sport: 'nhl', name: 'NHL', tags: '1,899', series: 'NHL' }, { sport: 'cfb', name: 'College Football', tags: '1,100351', series: 'CFB' },
  { sport: 'epl', name: 'Premier League', tags: '1,100350', series: 'EPL' }])
const at = (h, over = {}) => mkt({ endDate: new Date(now + h * 3600_000).toISOString(), ...over })
const nhl = (h, over = {}) => at(h, { outcomes: '["Over", "Under"]', events: [{ id: 'n', title: 'Rangers vs. Capitals', series: [{ id: 'NHL' }] }], ...over })
t('the watch list takes the watch sports kicking off too soon for the tests, and nothing else', () => {
  assert.deepEqual(WATCH_SPORTS, ['Hockey', 'College football'])
  assert.equal(WIX.get('CFB').sport, 'College football')
  assert.equal(armFor(nhl(5), now, ['A', 'B', 'W'], WIX), 'W')                        // tonight's hockey
  assert.equal(armFor(nhl(23), now, ['A', 'B', 'W'], WIX), 'B')                       // tomorrow's: the test, not the watch list
  assert.equal(armFor(nhl(0.1), now, ['A', 'B', 'W'], WIX), null)                     // too close to the puck drop
  assert.equal(armFor(nhl(5), now, ['A', 'B'], WIX), null)                            // only when the watch list is scanning
  const cfb = at(8, { outcomes: '["BYU", "Iowa State"]', events: [{ id: 'c', title: 'Iowa State vs. BYU', series: [{ id: 'CFB' }] }] })
  assert.equal(armFor(cfb, now, ['A', 'B', 'W'], WIX), 'W')
  const soccer = at(5, { events: [{ id: 's', title: 'A vs. B', series: [{ id: 'EPL' }] }] })
  assert.equal(armFor(soccer, now, ['A', 'B', 'W'], WIX), null)                       // not a watch sport
  assert.equal(armFor(nhl(5), now, ['A', 'B', 'W'], null), null)                      // no directory yet: cannot tell the sport
  // A watch bet is decided by the market's shape: the cheap side of a two-way market.
  const r = decide(nhl(5), [bookAt(0.80), bookAt(0.19)], now, WIX, 'W')
  assert.equal(r.arm, 'W'); assert.equal(r.outcome, 'Under'); assert.equal(r.rule, true); assert.equal(r.sport, 'Hockey')
})

t('the watch list shows results as they come in, and never moves a test', () => {
  const st = stateWith(450)                                                           // test A, day 2: still hidden
  for (let i = 0; i < 6; i++) {
    const r = decide(nhl(5, { id: 'w' + i, events: [{ id: 'n' + i, title: 'Game ' + i, series: [{ id: 'NHL' }] }] }), [bookAt(0.85), bookAt(0.15)], now, WIX, 'W')
    if (i < 4) r.settle = { ...settle(r, { closed: true, outcomePrices: i === 0 ? '["0","1"]' : '["1","0"]' }), settledAt: new Date(now + 6 * 3600_000).toISOString() }
    st.records[r.id] = r
  }
  const w = dashboardData(st, now + 2 * 86400_000, { arm: 'W' })
  assert.equal(w.watch, true); assert.equal(w.done, true)
  assert.equal(w.result.n, 4)                                                         // settled watch bets, live
  assert.equal(w.latest.length, 6)                                                    // pending ones listed too
  assert.equal(w.latest.filter((b) => b.counted).length, 4)
  assert.equal(w.latest.filter((b) => b.won).length, 1)
  assert.ok(w.bySport.find((x) => x.name === 'Hockey').wins === 1)
  assert.equal(w.eta, null)
  // The tests are untouched: the watch bets are in neither their counts nor their results.
  const a = dashboardData(st, now + 2 * 86400_000)
  assert.equal(a.ruleBets, 450); assert.equal(a.result.n, 450); assert.equal(a.verdict, undefined)
  assert.ok(a.latest.every((b) => b.arm === 'A'))
  assert.deepEqual(a.arms.map((x) => x.key), ['A', 'B', 'W'])
  assert.equal(summarise(st, now + 30 * 86400_000, { arm: 'A', withhold: true }).ruleBets, 450)
})

t('college football and the NFL are told apart, including records filed before the split', () => {
  assert.equal(refineSport({ sport: 'American football', league: 'College Football' }).sport, 'College football')
  assert.equal(refineSport({ sport: 'American football', league: 'NFL' }).sport, 'NFL')
  assert.equal(refineSport({ sport: 'American football', league: 'UFL' }).sport, 'American football')
  assert.equal(refineSport({ sport: 'Soccer', league: 'NFL' }).sport, 'Soccer')
})

// ---------------------------------------------------------------- storage and tagging
function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'polysports-')) }
t('storage round-trips records, settlements, tags and each frozen result', () => {
  const dir = tmpdir(), store = openStore(dir)
  const st = stateWith(6, { settledEvery: 0 })
  store.addRecords(Object.values(st.records))
  const r0 = st.records['0']; r0.settle = { ...settle(r0, { closed: true, outcomePrices: '["1","0"]' }), settledAt: 'x' }
  store.addSettles([r0])
  store.addTags([{ id: '1', sport: 'Rugby', league: 'Top 14', type: 'Spread', typeRaw: 'spreads', seriesId: 'S9' }])
  st.finalByArm = { A: { done: true, frozenAt: 'f', settledIds: ['0'] } }; st.errors = 3; st.lastScanAt = 'L'
  store.saveMeta(st)
  fs.appendFileSync(path.join(dir, 'records.jsonl'), '{"id":"torn","arm":"A"')           // a crash mid-write
  const back = openStore(dir).load()
  assert.equal(Object.keys(back.records).length, 6)
  assert.equal(back.records['0'].settle.yesPrice, 1)
  assert.equal(back.records['1'].sport, 'Rugby'); assert.equal(back.records['1'].type, 'Spread')
  assert.equal(back.records['2'].settle, undefined)
  assert.deepEqual(back.finalByArm.A.settledIds, ['0']); assert.equal(back.errors, 3); assert.equal(back.lastScanAt, 'L')
  assert.equal(back.records['3'].question, st.records['3'].question)
})

t('a first-version state.json is migrated once, frozen result and all', () => {
  const dir = tmpdir()
  const st = stateWith(4, { settledEvery: 2 })
  const truth = {}
  for (const r of Object.values(st.records)) {
    delete r.arm; delete r.side; delete r.sport; delete r.type; delete r.feeVersion          // the first version had none of these
    truth[r.id] = r.fee; r.fee = r.fee * r.fill.avgPrice                                    // and charged the fee × p too small
    if (r.settle) { r.settle.cost = r.fill.spent + r.fee; r.settle.pnl = r.settle.payout - r.settle.cost }
  }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...st, final: { done: true, settledIds: ['0'] } }))
  const back = openStore(dir).load()
  assert.equal(Object.keys(back.records).length, 4)
  assert.ok(Object.values(back.records).every((r) => r.arm === 'A' && r.side === 0))
  assert.equal(back.records['0'].settle.yesPrice, 1); assert.equal(back.records['1'].settle, undefined)
  assert.deepEqual(back.finalByArm.A.settledIds, ['0']); assert.equal(back.final, undefined)
  assert.ok(!fs.existsSync(path.join(dir, 'state.json')) && fs.existsSync(path.join(dir, 'state.json.migrated')))
  assert.equal(Object.keys(openStore(dir).load().records).length, 4)                 // a second load does not migrate again
  // The first version's fees (× p too small) are corrected on load, settled cost and profit with them.
  for (const r of Object.values(back.records)) assert.ok(Math.abs(r.fee - truth[r.id]) < 1e-12, `fee of ${r.id}`)
  const s0 = back.records['0'].settle
  assert.ok(Math.abs(s0.cost - (back.records['0'].fill.spent + truth['0'])) < 1e-9 && Math.abs(s0.pnl - (s0.payout - s0.cost)) < 1e-12)
})

await (async () => {
  // Tagging after the fact: from the directory when the league is known, from Gamma otherwise.
  const st = stateWith(4, { settledEvery: 0 })
  const ids = Object.keys(st.records)
  for (const id of ids) { const r = st.records[id]; delete r.sport; delete r.type; delete r.seriesId }   // day-one records
  st.records['3'].seriesId = 'S1'; st.records['3'].type = 'Moneyline'                 // knows its league already
  const asked = []
  const fake = async (url) => {
    const u = new URL(url), want = u.searchParams.getAll('id'); asked.push([u.searchParams.get('closed'), want.length])
    const open = u.searchParams.get('closed') === 'false'
    return want.filter((id) => (open ? id !== '2' : id === '2')).map((id) => ({ id, sportsMarketType: 'soccer_exact_score', events: [{ id: 'e', series: [{ id: 'S2' }] }] }))
  }
  const out = []
  const n = await tagMissing(st, INDEX, fake, (list) => out.push(...list))
  assert.equal(n, 4); assert.equal(out.length, 4)
  assert.equal(st.records['3'].sport, 'Soccer')                                        // S1, no request needed
  assert.equal(st.records['0'].sport, 'Hockey'); assert.equal(st.records['0'].type, 'Exact score')
  assert.equal(st.records['2'].sport, 'Hockey')                                        // found among closed markets
  assert.deepEqual(asked, [['false', 3], ['true', 1]])
  assert.equal(await tagMissing(st, INDEX, fake), 0)                                   // nothing left to do
  assert.equal(await tagMissing(st, null, fake), 0)                                    // no directory: wait
  // A market Gamma never returns is asked about at most 3 times.
  const lost = stateWith(1, { settledEvery: 0 }); delete lost.records['0'].sport; delete lost.records['0'].seriesId
  let calls = 0
  for (let i = 0; i < 5; i++) await tagMissing(lost, INDEX, async () => { calls++; return [] })
  assert.equal(calls, 6)                                                               // 3 tries × (open, closed)
  passed++
})()

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
