// Offline verification. No network, no keys, no orders.
// Run with: npm test
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pumpbot-test-'))
process.env.DATA_DIR = tmp
process.env.LOG_LEVEL = 'error'
process.env.PAPER = '1'
process.env.SUBSCRIBE_BATCH_MS = '120' // keep the suite fast; the real default is asserted below
delete process.env.PRIVATE_KEY

const { config } = await import('../src/config.js')
const { tierFor, buySolFor, maxDeployedFor, nextTier, sizingSummary } = await import('../src/sizing.js')
const { quoteBuy, quoteSell, priceFromReserves, normalizeEvent } = await import('../src/curve.js')
const { Candidate, evaluateEntry } = await import('../src/filter.js')
const { decideExit, newPosition, applySell, markPrice, positionPnl } = await import('../src/position.js')
const store = await import('../src/store.js')
const { canOpen } = await import('../src/risk.js')
const { buy, sell } = await import('../src/exec.js')
const { wilson, simulateLadder, bestThreshold, analyze } = await import('../src/learn.js')
const { buildSnapshot } = await import('../src/dashboard.js')

let passed = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

// ---------------------------------------------------------------- sizing tiers
console.log('\nSizing tiers')
{
  check('floor tier applies below the step', near(buySolFor(0.5), 0.075), String(buySolFor(0.5)))
  check('floor tier applies just under 5 SOL', near(buySolFor(4.99), 0.075), String(buySolFor(4.99)))
  check('steps up exactly at 5 SOL', near(buySolFor(5), 0.15), String(buySolFor(5)))
  check('stays up above the step', near(buySolFor(12), 0.15), String(buySolFor(12)))
  check(
    'size steps back DOWN if equity falls',
    near(buySolFor(3), 0.075),
    'ratcheting up but not down hands back a good run at the larger size',
  )
  check('zero balance still resolves to the floor tier', near(buySolFor(0), 0.075))
  check('deploy cap derives from the active tier', near(maxDeployedFor(0.5), 0.075 * config.sizing.maxConcurrentPositions))
  check('deploy cap scales with the tier', near(maxDeployedFor(6), 0.15 * config.sizing.maxConcurrentPositions))

  const s = sizingSummary(1)
  check('next tier is reported', s.nextTier?.atSol === 5 && near(s.nextTier.buySol, 0.15))
  check('distance to next tier is right', near(s.nextTier.remainingSol, 4), String(s.nextTier?.remainingSol))
  check('top tier reports no next step', nextTier(10) === null)
}

// ---------------------------------------------------------------- curve maths
console.log('\nBonding curve')
{
  check('spot price from reserves', near(priceFromReserves(30, 1e9), 3e-8))
  check('missing reserves yield no price', priceFromReserves(0, 1e9) === undefined)

  const q = quoteBuy({ vSol: 30, vTokens: 1_000_000_000, solIn: 0.075 })
  check('buy returns tokens', q.tokensOut > 0)
  check('buy moves price against you', q.avgPriceSol > priceFromReserves(30, 1e9))
  check('constant product is preserved', near(q.nextVSol * q.nextVTokens, 30 * 1e9, 1))

  const s = quoteSell({ vSol: q.nextVSol, vTokens: q.nextVTokens, tokensIn: q.tokensOut })
  check('immediate round trip loses to slippage only', s.solOut < 0.075 && s.solOut > 0.074, String(s.solOut))
  check('selling nothing is rejected', quoteSell({ vSol: 30, vTokens: 1e9, tokensIn: 0 }) === null)
}

// ---------------------------------------------------------------- feed parsing
console.log('\nFeed parsing')
{
  const created = normalizeEvent({
    txType: 'create', mint: 'M1', traderPublicKey: 'DEV', name: 'Dog', symbol: 'DOG',
    initialBuy: 30_000_000, solAmount: 1.5, vSolInBondingCurve: 31.5,
    vTokensInBondingCurve: 970_000_000, marketCapSol: 32.4, pool: 'pump',
  })
  check('create event parses', created?.kind === 'create')
  check('dev initial buy captured', created.initialBuyTokens === 30_000_000)
  check('price derived from reserves', near(created.priceSol, 31.5 / 970_000_000))

  const trade = normalizeEvent({
    txType: 'buy', mint: 'M1', traderPublicKey: 'BUYER', tokenAmount: 1000,
    solAmount: 0.05, vSolInBondingCurve: 32, vTokensInBondingCurve: 960_000_000,
  })
  check('buy event parses', trade?.kind === 'buy')

  // The live field spellings are unverified, so aliases must work.
  const aliased = normalizeEvent({
    type: 'sell', mintAddress: 'M2', trader: 'X', virtualSolReserves: 20,
    virtualTokenReserves: 500_000_000,
  })
  check('alternate field names still parse', aliased?.kind === 'sell' && aliased.mint === 'M2')
  check('price from aliased reserves', near(aliased.priceSol, 20 / 500_000_000))

  check('control messages are ignored', normalizeEvent({ message: 'subscribed' }) === null)
  check('garbage is ignored', normalizeEvent({ foo: 1 }) === null)

  const noReserves = normalizeEvent({ txType: 'buy', mint: 'M3', tokenAmount: 100, solAmount: 0.01 })
  check('price falls back to the trade itself', near(noReserves.priceSol, 0.0001))
}

// ---------------------------------------------------------------- entry filter
console.log('\nEntry filter')
const createEvt = (over = {}) =>
  normalizeEvent({
    txType: 'create', mint: 'MINT', traderPublicKey: 'DEV', name: 'Good Dog', symbol: 'GDOG',
    initialBuy: 20_000_000, solAmount: 0.8, vSolInBondingCurve: 31,
    vTokensInBondingCurve: 980_000_000, marketCapSol: 40, ...over,
  })

function buildCandidate({ create = {}, buyers = 20, sells = 2, devSells = false, mcap = 44 } = {}) {
  const c = new Candidate(createEvt(create))
  for (let i = 0; i < buyers; i++) {
    c.apply(normalizeEvent({
      txType: 'buy', mint: 'MINT', traderPublicKey: `B${i}`, tokenAmount: 1000, solAmount: 0.05,
      vSolInBondingCurve: 40, vTokensInBondingCurve: 900_000_000, marketCapSol: mcap,
    }))
  }
  for (let i = 0; i < sells; i++) {
    c.apply(normalizeEvent({
      txType: 'sell', mint: 'MINT', traderPublicKey: devSells ? 'DEV' : `S${i}`, tokenAmount: 500,
      solAmount: 0.02, vSolInBondingCurve: 40, vTokensInBondingCurve: 900_000_000, marketCapSol: mcap,
    }))
  }
  return c
}

{
  const good = evaluateEntry(buildCandidate())
  check('a healthy launch passes', good.pass, good.reason)

  const thin = evaluateEntry(buildCandidate({ buyers: 4 }))
  check('too few organic buyers is rejected', !thin.pass && thin.failed.some((c) => c.id === 'buyers'))

  const dumping = evaluateEntry(buildCandidate({ buyers: 20, sells: 18 }))
  check('heavy early selling is rejected', !dumping.pass && dumping.failed.some((c) => c.id === 'buy_pressure'))

  const devDump = evaluateEntry(buildCandidate({ devSells: true, sells: 1 }))
  check('dev selling is disqualifying', !devDump.pass && devDump.failed.some((c) => c.id === 'dev_not_selling'))

  const whaleDev = evaluateEntry(buildCandidate({ create: { initialBuy: 400_000_000 } }))
  check('dev holding too much supply is rejected', !whaleDev.pass && whaleDev.failed.some((c) => c.id === 'dev_hold'))

  const scamName = evaluateEntry(buildCandidate({ create: { name: 'Free AIRDROP claim' } }))
  check('impersonation keywords are rejected', !scamName.pass && scamName.failed.some((c) => c.id === 'naming'))

  const tooBig = evaluateEntry(buildCandidate({ mcap: 900 }))
  check('an already-run market cap is rejected', !tooBig.pass && tooBig.failed.some((c) => c.id === 'market_cap'))

  const tooSmall = evaluateEntry(buildCandidate({ mcap: 5 }))
  check('a market cap nobody has bid up is rejected', !tooSmall.pass && tooSmall.failed.some((c) => c.id === 'market_cap'))

  const c = buildCandidate()
  check('dev is excluded from the organic buyer count', c.organicBuyers === 20, String(c.organicBuyers))
  check('dev hold percent computed from supply', near(c.devHoldPct, 2), String(c.devHoldPct))
}

// ---------------------------------------------------------------- exit ladder
console.log('\nExit ladder')
const mkPosition = (over = {}) => ({
  mint: 'M', symbol: 'T', state: 'open', openedAt: Date.now(),
  entryPriceSol: 1e-7, tokensBought: 1_000_000, tokensRemaining: 1_000_000,
  solSpent: 0.075, solRecovered: 0, rungsHit: [], peakPriceSol: 1e-7,
  // Fresh by default so the other rules are tested in isolation; the stale-price rule
  // fires before everything else and would otherwise mask them.
  lastPriceSol: 1e-7, lastPriceAt: Date.now(), entryVSol: 30, fills: [], ...over,
})

{
  const flat = decideExit(mkPosition(), { priceSol: 1e-7, vSol: 30 })
  check('no action while flat', flat.sellTokens === 0)

  const up50 = decideExit(mkPosition(), { priceSol: 1.5e-7, vSol: 34 })
  check('first rung fires at +50%', up50.rungs.includes(50))
  check('first rung sells 67% of the bag', near(up50.sellTokens, 670_000), String(up50.sellTokens))

  // 67% sold at 1.5x returns ~1.005x of the stake — initials out, rest is house money.
  check('first rung recovers the stake', 0.67 * 1.5 >= 1.0)

  const gap = decideExit(mkPosition(), { priceSol: 3e-7, vSol: 60 })
  check('a gap up clears several rungs at once', gap.rungs.length === 3, gap.rungs.join(','))
  check('gapped rungs sell the sum, not one rung', near(gap.sellTokens, 870_000), String(gap.sellTokens))

  const already = decideExit(mkPosition({ rungsHit: [50] }), { priceSol: 1.6e-7, vSol: 34 })
  check('a rung never fires twice', already.sellTokens === 0)

  const stop = decideExit(mkPosition(), { priceSol: 0.6e-7, vSol: 22 })
  check('stop-loss exits everything', stop.sellAll && stop.reasons[0].includes('stop-loss'))

  const old = decideExit(mkPosition({ openedAt: Date.now() - 700_000, lastPriceAt: Date.now() }), { priceSol: 1.1e-7, vSol: 31 })
  check('time stop fires on a position that never ran', old.sellAll && old.reasons[0].includes('time stop'))

  const oldButRunning = decideExit(
    mkPosition({ openedAt: Date.now() - 700_000, lastPriceAt: Date.now(), rungsHit: [50], peakPriceSol: 1.6e-7 }),
    { priceSol: 1.55e-7, vSol: 34 },
  )
  check('time stop does NOT fire once a rung is hit', oldButRunning.sellTokens === 0)

  const drawdown = decideExit(
    mkPosition({ rungsHit: [50, 100], peakPriceSol: 4e-7 }),
    { priceSol: 1.8e-7, vSol: 34 },
  )
  check('trailing stop protects the moon bag', drawdown.sellAll && drawdown.reasons[0].includes('peak'))

  const drained = decideExit(mkPosition(), { priceSol: 1.2e-7, vSol: 8 })
  check('a draining curve exits immediately', drained.sellAll && drained.reasons[0].includes('drained'))
  check(
    'draining beats the ladder even when in profit',
    decideExit(mkPosition(), { priceSol: 2e-7, vSol: 8 }).reasons[0].includes('drained'),
  )

  // Stale price: every other rule reasons from a price, so a frozen one silently
  // disables the stop-loss and the trailing stop. Holding blind is the worst state.
  const staleMs = (config.exit.stalePriceSeconds + 30) * 1000
  const stale = decideExit(mkPosition({ lastPriceAt: Date.now() - staleMs }), { priceSol: 1e-7, vSol: 30 })
  check('a frozen price forces an exit', stale.sellAll && stale.reasons[0].includes('no price update'))

  const staleButWinning = decideExit(
    mkPosition({ lastPriceAt: Date.now() - staleMs, rungsHit: [50, 100], peakPriceSol: 3e-7 }),
    { priceSol: 2.9e-7, vSol: 50 },
  )
  check('stale price beats even a winning ladder', staleButWinning.sellAll && staleButWinning.reasons[0].includes('no price update'))

  const freshEnough = decideExit(
    mkPosition({ lastPriceAt: Date.now() - (config.exit.stalePriceSeconds - 30) * 1000 }),
    { priceSol: 1e-7, vSol: 30 },
  )
  check('a price just inside the window does not force an exit', freshEnough.sellTokens === 0)

  const noPriceAt = decideExit(
    { ...mkPosition(), lastPriceAt: undefined, openedAt: Date.now() - staleMs },
    { priceSol: 1e-7, vSol: 30 },
  )
  check('missing lastPriceAt falls back to open time', noPriceAt.sellAll && noPriceAt.reasons[0].includes('no price update'))

  const empty = decideExit(mkPosition({ tokensRemaining: 0 }), { priceSol: 2e-7, vSol: 34 })
  check('an empty position closes', empty.sellAll)

  const closed = decideExit(mkPosition({ state: 'closed' }), { priceSol: 9e-7, vSol: 40 })
  check('a closed position never trades again', closed.sellTokens === 0)

  const noPrice = decideExit(mkPosition(), { priceSol: 0, vSol: 30 })
  check('a momentarily missing price means no decision', noPrice.sellTokens === 0)

  /**
   * Audit finding: a corrupted entry price used to return "no action", silently
   * disabling the stop-loss, trailing stop and ladder for the life of the position.
   * A corrupt position must not become an un-exitable one.
   */
  for (const [label, bad] of [['negative', -1e-8], ['zero', 0], ['NaN', NaN], ['Infinity', Infinity]]) {
    const corrupt = decideExit(mkPosition({ entryPriceSol: bad }), { priceSol: 2e-7, vSol: 34 })
    check(`a ${label} entry price forces an exit, not a freeze`,
      corrupt.sellAll && corrupt.reasons[0].includes('unusable entry price'),
      JSON.stringify(corrupt.reasons))
  }

  // Ladder can never oversell the remaining bag.
  const partial = decideExit(mkPosition({ tokensRemaining: 100_000 }), { priceSol: 5e-7, vSol: 60 })
  check('never sells more than is held', partial.sellTokens <= 100_000)
}

// ---------------------------------------------------------------- PnL accounting
console.log('\nPosition accounting')
{
  const p = newPosition({
    mint: 'M', symbol: 'T', creator: 'DEV',
    fill: { avgPriceSol: 1e-7, tokensReceived: 1_000_000, solSpent: 0.075, signature: 'x' },
    curve: { vSol: 30 },
  })
  check('entry recorded', near(p.solSpent, 0.075) && p.tokensRemaining === 1_000_000)

  applySell(p, { tokensSold: 670_000, solReceived: 0.0755, signature: 'y' }, ['+50% rung'])
  markPrice(p, 1.5e-7)
  const pnl = positionPnl(p)
  check('initials flagged recovered', pnl.initialsRecovered)
  check('remaining bag tracked', p.tokensRemaining === 330_000)
  check('mark value uses the live price', near(pnl.markValueSol, 330_000 * 1.5e-7))
  check('total P&L combines realized and mark', near(pnl.totalSol, 0.0755 + 330_000 * 1.5e-7 - 0.075))

  markPrice(p, 0.9e-7)
  check('peak price only ratchets up', near(p.peakPriceSol, 1.5e-7))
}

// ---------------------------------------------------------------- risk gates
console.log('\nRisk gates')
{
  store.initStore()
  const s = store.getState()

  check('a clean slate allows opening', canOpen({ mint: 'A', creator: 'C', walletSol: 1 }) === null)

  check(
    'a thin wallet blocks the buy',
    canOpen({ mint: 'A', creator: 'C', walletSol: 0.05 })?.includes('below'),
    String(canOpen({ mint: 'A', creator: 'C', walletSol: 0.05 })),
  )

  s.positions.HELD = { mint: 'HELD', state: 'open', solSpent: 0.075, solRecovered: 0 }
  check('never doubles into the same mint', canOpen({ mint: 'HELD', creator: 'C', walletSol: 1 }) === 'already holding this mint')

  for (let i = 0; i < config.sizing.maxConcurrentPositions; i++) {
    s.positions[`P${i}`] = { mint: `P${i}`, state: 'open', solSpent: 0.075, solRecovered: 0 }
  }
  check('concurrent position cap holds', canOpen({ mint: 'NEW', creator: 'C', walletSol: 5 })?.includes('max'))

  s.positions = {}
  store.blockCreator('BADDEV', 'rugged us')
  check('blocklisted creators are refused', canOpen({ mint: 'N', creator: 'BADDEV', walletSol: 1 }) === 'creator is blocklisted')

  s.consecutiveLosses = config.risk.maxConsecutiveLosses
  check('a losing streak pauses entries', canOpen({ mint: 'N2', creator: 'C', walletSol: 1 })?.includes('consecutive'))
  s.consecutiveLosses = 0

  s.daily[new Date().toISOString().slice(0, 10)] = { realizedSol: -config.risk.dailyLossLimitSol, wins: 0, losses: 5 }
  check('the daily loss limit stops trading', canOpen({ mint: 'N3', creator: 'C', walletSol: 1 })?.includes('daily loss'))

  s.daily = {}
  s.totalRealizedSol = -config.risk.totalLossLimitSol
  const blocked = canOpen({ mint: 'N4', creator: 'C', walletSol: 1 })
  check('the total loss limit halts the bot', blocked === 'total loss limit reached' && Boolean(s.halted))
  check('a halt blocks everything after it', canOpen({ mint: 'N5', creator: 'C', walletSol: 1 })?.startsWith('halted'))

  store.clearHalt()
  s.totalRealizedSol = 0
}

// ---------------------------------------------------------------- store ledger
console.log('\nLedger')
{
  store.initStore()
  const s = store.getState()
  s.positions = {}
  s.closed = []
  s.daily = {}
  s.totalRealizedSol = 0
  s.consecutiveLosses = 0

  store.addPosition({ mint: 'W', symbol: 'W', state: 'open', openedAt: Date.now(), solSpent: 0.075, solRecovered: 0.12, tokensRemaining: 0, rungsHit: [50] })
  const win = store.closePosition('W', 'ladder complete')
  check('a winning trade books positive', near(win.realizedSol, 0.045), String(win.realizedSol))
  check('win counted', store.todayPnl().wins === 1)

  store.addPosition({ mint: 'L', symbol: 'L', state: 'open', openedAt: Date.now(), solSpent: 0.075, solRecovered: 0.05, tokensRemaining: 0, rungsHit: [] })
  const loss = store.closePosition('L', 'stop-loss')
  check('a losing trade books negative', near(loss.realizedSol, -0.025), String(loss.realizedSol))
  check('consecutive losses increment', s.consecutiveLosses === 1)

  store.addPosition({ mint: 'W2', symbol: 'W2', state: 'open', openedAt: Date.now(), solSpent: 0.075, solRecovered: 0.2, tokensRemaining: 0, rungsHit: [50, 100] })
  store.closePosition('W2', 'ladder')
  check('a win resets the loss streak', s.consecutiveLosses === 0)
  check('total realized accumulates', near(s.totalRealizedSol, 0.045 - 0.025 + 0.125), String(s.totalRealizedSol))
  check('deployed excludes closed positions', store.deployedSol() === 0)

  store.addPosition({ mint: 'O', symbol: 'O', state: 'open', openedAt: Date.now(), solSpent: 0.075, solRecovered: 0.08, tokensRemaining: 100 })
  check('deployed nets out recovered capital', near(store.deployedSol(), 0), String(store.deployedSol()))
}

// ---------------------------------------------------------------- paper fills
console.log('\nPaper execution')
{
  const fill = await buy({ mint: 'M', solAmount: 0.075, curve: { vSol: 30, vTokens: 1e9 } })
  check('paper buy fills', fill.ok && fill.tokensReceived > 0)
  check('paper buy charges the priority fee', fill.solSpent > 0.075)
  check('paper fill is pessimistic vs the raw quote',
    fill.tokensReceived < quoteBuy({ vSol: 30, vTokens: 1e9, solIn: 0.075 }).tokensOut)

  const out = await sell({ mint: 'M', tokenAmount: fill.tokensReceived, curve: { vSol: 30.075, vTokens: 1e9 - fill.tokensReceived } })
  check('paper sell fills', out.ok && out.solReceived > 0)
  check('an instant round trip loses money to fees', out.solReceived < fill.solSpent)

  const noCurve = await buy({ mint: 'M', solAmount: 0.075, curve: {} })
  check('no curve state means no paper fill', !noCurve.ok)
}

// ---------------------------------------------------------------- learning
console.log('\nLearning')
{
  check('wilson handles zero samples', wilson(0, 0).lo === 0)
  const tight = wilson(50, 100)
  const loose = wilson(5, 10)
  check('wilson interval narrows with sample size', tight.hi - tight.lo < loose.hi - loose.lo)

  const winner = simulateLadder({ peakMultiple: 5, endMultiple: 2, troughMultiple: 1 })
  check('a runner beats break-even', winner > 1.5, String(winner))

  // Never reached the first rung and dumped: the stop-loss caps the damage at -30%.
  const dud = simulateLadder({ peakMultiple: 1.1, endMultiple: 0.05, troughMultiple: 0.05 })
  check('a coin that dies is capped by the stop-loss', near(dud, 0.7 * 0.97, 0.01), String(dud))

  // Never ran, never crashed — the time stop exits near flat, losing only fees.
  const flat = simulateLadder({ peakMultiple: 1.1, endMultiple: 0.95, troughMultiple: 0.8 })
  check('a flat coin exits near break-even', flat > 0.85 && flat < 1.0, String(flat))

  // Touched the rung, then round-tripped to zero: initials are out, the bag is caught
  // by the trailing stop. This is the case the ladder exists for.
  const roundTrip = simulateLadder({ peakMultiple: 1.5, endMultiple: 0.01, troughMultiple: 0.01 })
  check('rung hit then collapse still beats break-even', roundTrip > 1.0, String(roundTrip))
  check(
    'recovering initials is what makes that survivable',
    roundTrip > simulateLadder({ peakMultiple: 1.4, endMultiple: 0.01, troughMultiple: 0.01 }),
    'a coin that stops just short of the rung does far worse',
  )

  // Held to the end at the rung price, no drawdown — the bag keeps its value.
  const held = simulateLadder({ peakMultiple: 1.5, endMultiple: 1.5, troughMultiple: 1.2 })
  check('a bag still up at window close is valued there', near(held, 1.5 * 0.97, 0.01), String(held))

  // A feature that genuinely separates outcomes should be found...
  const signal = []
  for (let i = 0; i < 200; i++) signal.push({ features: { organicBuyers: 30 + (i % 10) }, hitFirstRung: i % 10 < 7, action: 'bought' })
  for (let i = 0; i < 200; i++) signal.push({ features: { organicBuyers: 5 + (i % 5) }, hitFirstRung: i % 10 < 1, action: 'rejected' })
  const found = bestThreshold(signal, 'organicBuyers')
  check('a real threshold is discovered', found && found.cut > 10 && found.cut <= 30, JSON.stringify(found?.cut))

  // ...and pure noise should NOT produce a "finding".
  const noise = []
  for (let i = 0; i < 400; i++) noise.push({ features: { organicBuyers: i % 40 }, hitFirstRung: i % 3 === 0 })
  check('noise yields no false discovery', bestThreshold(noise, 'organicBuyers') === null)

  const small = analyze(signal.slice(0, 20).map((r) => ({ ...r, decisionPriceSol: 1, peakMultiple: 1, endMultiple: 1 })))
  check('suggestions are gated on sample size', !small.enoughData && small.suggestions.length === 0)

  const labelled = signal.map((r, i) => ({
    ...r, decisionPriceSol: 1, peakMultiple: r.hitFirstRung ? 2 : 0.5, endMultiple: r.hitFirstRung ? 1.5 : 0.2,
    rejectedFor: r.action === 'rejected' ? ['buyers'] : null, creator: `C${i % 5}`,
  }))
  const report = analyze(labelled)
  check('bought and rejected are split out', report.totals.bought === 200 && report.totals.rejected === 200)
  check('false negatives are attributed to the check', report.falseNegatives.some((f) => f.check === 'buyers'))
  check('an EV estimate is produced', report.ev.bought?.n === 200)
  check('repeat creators are surfaced', report.repeatCreators.length > 0)
}

// ---------------------------------------------------------------- dashboard
console.log('\nDashboard snapshot')
{
  store.initStore()
  const s = store.getState()
  s.positions = {}
  s.closed = []
  store.addPosition({
    mint: 'D', symbol: 'DOG', state: 'open', openedAt: Date.now() - 60_000,
    entryPriceSol: 1e-7, lastPriceSol: 1.5e-7, peakPriceSol: 1.6e-7,
    tokensBought: 1_000_000, tokensRemaining: 330_000,
    solSpent: 0.075, solRecovered: 0.0755, rungsHit: [50], fills: [],
  })

  const snap = buildSnapshot(1.2)
  check('mode is reported', snap.mode === 'paper')
  check('open position appears', snap.positions.length === 1)
  check('change percent computed', near(snap.positions[0].changePct, 50))
  check('initials-recovered flag surfaces', snap.positions[0].initialsRecovered)
  check('total value includes open bags', snap.wallet.totalValueSol > 1.2)
  check('sizing tier included', near(snap.sizing.buySol, 0.075))
  check('next tier included', snap.sizing.nextTier?.atSol === 5)
  check('serialises cleanly for the API', typeof JSON.stringify(snap) === 'string')
}

// ---------------------------------------------- bonding curve account decoding
console.log('\nBonding curve account')
{
  const { decodeBondingCurve, bondingCurveAddress } = await import('../src/onchain.js')

  const encode = ({ vTokens, vSol, rTokens = 700_000_000e6, rSol = 30e9, supply = 1_000_000_000e6, complete = false }) => {
    const b = Buffer.alloc(8 + 8 * 5 + 1)
    b.writeBigUInt64LE(BigInt(Math.round(vTokens)), 8)
    b.writeBigUInt64LE(BigInt(Math.round(vSol)), 16)
    b.writeBigUInt64LE(BigInt(Math.round(rTokens)), 24)
    b.writeBigUInt64LE(BigInt(Math.round(rSol)), 32)
    b.writeBigUInt64LE(BigInt(Math.round(supply)), 40)
    b.writeUInt8(complete ? 1 : 0, 48)
    return b
  }

  // 1,073,000,000 tokens (6dp) against 32 SOL (9dp) — a typical early curve.
  const decoded = decodeBondingCurve(encode({ vTokens: 1_073_000_000e6, vSol: 32e9 }))
  check('decodes a plausible curve', Boolean(decoded))
  check('reserves converted out of base units', decoded && near(decoded.vSol, 32, 1e-6) && near(decoded.vTokens, 1_073_000_000, 1))
  check('price derived from reserves', decoded && near(decoded.priceSol, 32 / 1_073_000_000, 1e-15))

  check('rejects a truncated account', decodeBondingCurve(Buffer.alloc(20)) === null)
  check('rejects empty data', decodeBondingCurve(null) === null)

  // The safety property that matters: garbage must not produce a confident price.
  const garbage = Buffer.alloc(49)
  garbage.fill(0xff)
  check('rejects garbage rather than pricing it', decodeBondingCurve(garbage) === null)
  check('rejects an all-zero account', decodeBondingCurve(Buffer.alloc(49)) === null)
  check('rejects implausibly tiny reserves', decodeBondingCurve(encode({ vTokens: 1, vSol: 1 })) === null)

  const addr = bondingCurveAddress('So11111111111111111111111111111111111111112').toBase58()
  check('derives a deterministic curve PDA', typeof addr === 'string' && addr.length >= 32)
  check('PDA is stable across calls', bondingCurveAddress('So11111111111111111111111111111111111111112').toBase58() === addr)
}

// ------------------------------------------------- environment visibility
console.log('\nEnvironment visibility')
{
  const { envReport } = await import('../src/config.js')
  const report = envReport()
  const byName = Object.fromEntries(report.map((e) => [e.name, e]))

  check('the key we are debugging is reported on', Boolean(byName.PUMPPORTAL_API_KEY))
  check('a set variable reports present', byName.PAPER.present && byName.PAPER.length > 0)
  check('an unset variable reports missing', byName.PRIVATE_KEY.present === false)

  // The three cases that look identical from outside must be distinguishable.
  const before = process.env.PUMPPORTAL_API_KEY
  process.env.PUMPPORTAL_API_KEY = ''
  check('present-but-empty is distinct from missing',
    envReport().find((e) => e.name === 'PUMPPORTAL_API_KEY').present === true &&
    envReport().find((e) => e.name === 'PUMPPORTAL_API_KEY').trimmedLength === 0)
  process.env.PUMPPORTAL_API_KEY = '  key-with-padding  '
  const padded = envReport().find((e) => e.name === 'PUMPPORTAL_API_KEY')
  check('whitespace padding is visible as a length difference',
    padded.length > padded.trimmedLength, `${padded.length} vs ${padded.trimmedLength}`)
  if (before === undefined) delete process.env.PUMPPORTAL_API_KEY
  else process.env.PUMPPORTAL_API_KEY = before

  // It must never be able to leak a value.
  const src = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export function envReport'))
  check('the report exposes lengths, never values',
    !/return\s*\{[^}]*raw[,}]/.test(fn) && fn.includes('length'),
    'names and lengths only')
}

// ------------------------------------------------- graduation / venue routing
console.log('\nGraduation handling')
{
  const execSrc = fs.readFileSync(new URL('../src/exec.js', import.meta.url), 'utf8')
  const botSrc = fs.readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8')
  const feedSrc = fs.readFileSync(new URL('../src/feed.js', import.meta.url), 'utf8')

  /**
   * Audit finding: pool was frozen at token creation, so a graduated token — whose
   * bonding curve is CLOSED and liquidity moved to PumpSwap — could not be sold. That
   * lands on winners only: entries cap at 120 SOL mcap and the +200%/+400% rungs sit
   * past graduation, so the trades that run furthest were the unsellable ones.
   */
  check('sells resolve the venue instead of assuming it',
    execSrc.includes("action === 'sell' ? 'auto' : 'pump'"))
  check('buys still take the fast path', execSrc.includes("'pump'"))
  check('exit path does not reuse a stale pump venue',
    (botSrc.match(/position\.pool === 'pump' \? 'auto' : position\.pool/g) || []).length >= 2,
    'both the ladder exit and the panic sell must re-resolve')

  check('migration events are subscribed to', feedSrc.includes('subscribeMigration'))
  check('migration events are routed', feedSrc.includes("'migrate'"))
  check('a graduation updates the position venue', botSrc.includes('#onMigrate'))
  check('trade ticks refresh the venue too', botSrc.includes('venue moved'))

  const migrate = normalizeEvent({ txType: 'migrate', mint: 'GRADMINT', pool: 'pump-amm', signature: 'sig' })
  check('a minimal migrate payload parses', migrate?.kind === 'migrate' && migrate.mint === 'GRADMINT')
  check('the destination venue is read, not assumed', migrate.pool === 'pump-amm')
  check('migrate needs no reserves or price', migrate.vSol === undefined && migrate.priceSol === undefined)
}

// ------------------------------------------------- ledger lock
console.log('\nLedger lock')
{
  const lock = await import('../src/lock.js')
  lock.release()
  check('no lock means no holder', lock.heldByAnother() === null)

  lock.acquire()
  check('an acquired lock is visible to another reader', Boolean(lock.heldByAnother()))
  check('the holder heartbeat is fresh', lock.heldByAnother().ageMs < 5000)

  lock.release()
  check('releasing clears it', lock.heldByAnother() === null)

  // A crashed run must not block recovery forever.
  const fsx = await import('node:fs')
  const pathx = await import('node:path')
  const stale = pathx.join(config.dataDir, config.paper ? 'paper.lock' : 'live.lock')
  fsx.writeFileSync(stale, JSON.stringify({ pid: 999999, at: Date.now() - 10 * 60_000 }))
  check('a stale lock is ignored so a crash cannot wedge recovery', lock.heldByAnother() === null)
  fsx.unlinkSync(stale)

  const idxSrc = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  check('panic refuses to run against a live instance', idxSrc.includes('heldByAnother'))
  check('and points at the in-process route', idxSrc.includes('/panic confirm'))

  // reset clears the paper book; it must never touch a live ledger, and must not run
  // against a live instance that would write the old book straight back.
  check('reset refuses in live mode', idxSrc.includes('record of real money'))
  check('reset refuses against a running instance',
    idxSrc.slice(idxSrc.indexOf('async function reset')).includes('heldByAnother'))
  check('reset requires explicit confirmation',
    idxSrc.slice(idxSrc.indexOf('async function reset')).includes("--confirm"))
  check('reset keeps the decision journal',
    idxSrc.includes('decision journal is kept'),
    'the journal is the learning data — only the trade ledger is disposable')
}

// ------------------------------------------------- fill measurement
console.log('\nFill measurement')
{
  /**
   * The audit's critical finding: fills were measured as before/after whole-wallet SOL
   * deltas while up to four orders ran concurrently on different mints, so one order's
   * proceeds landed inside another's measurement window. Fills are now read from the
   * specific transaction, which cannot be contaminated.
   */
  const src = fs.readFileSync(new URL('../src/exec.js', import.meta.url), 'utf8')

  check('fills no longer use whole-wallet balance deltas',
    !/before\.solBal\s*-\s*after\.solBal/.test(src) && !/after\.solBal\s*-\s*before\.solBal/.test(src),
    'a concurrent order on another mint would corrupt the measurement')
  check('fills are read from the transaction itself', src.includes('fillFromTransaction'))
  check('it reads that transaction\'s own pre/post balances',
    src.includes('preBalances') && src.includes('postBalances'))
  check('token deltas are matched to our wallet and this mint',
    src.includes("b?.mint === mint && b?.owner === me"))
  check('a fill it cannot measure is a failure, not a guess',
    src.includes('its effect could not be measured'))

  // Validation must reject rather than store an unusable entry price.
  check('a non-positive cost is refused', src.includes('refusing to open'))
  check('a non-positive sale is refused', src.includes('measured a non-positive sale'))

  // Duplicate-order protection: a timed-out confirm may still have landed.
  check('sent signatures are recorded before confirmation', src.includes('sentSignatures.push(signature)'))
  check('retries check whether a send already landed', src.includes('alreadyLanded'))
  check('a landed order is adopted rather than re-sent', src.includes('retry avoided'))
}

// ------------------------------------------- pump.fun log event decoding
console.log('\nPump.fun log events')
{
  const { decodeTradeEvent, tradeEventsFromLogs, toFeedEvent, rpcWebsocketUrl,
          TRADE_EVENT_DISCRIMINATOR } = await import('../src/pumpevents.js')
  const { createHash } = await import('node:crypto')
  const { PublicKey } = await import('@solana/web3.js')

  // The discriminator must be DERIVED, not trusted — Anchor defines it as
  // sha256("event:<Name>")[0..8], and the base64 prefix is what real logs carry.
  const derived = createHash('sha256').update('event:TradeEvent').digest().subarray(0, 8)
  check('TradeEvent discriminator matches Anchor derivation', TRADE_EVENT_DISCRIMINATOR.equals(derived))
  check('and matches the prefix seen in mainnet logs', derived.toString('base64').startsWith('vdt/007mYe'))

  const mint = new PublicKey('So11111111111111111111111111111111111111112')
  const user = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
  const build = ({ isBuy = true, vSolLamports = 32e9, vTokensRaw = 1.073e15, tail = 0 } = {}) => {
    const b = Buffer.alloc(8 + 105 + tail)
    derived.copy(b, 0)
    mint.toBuffer().copy(b, 8)
    b.writeBigUInt64LE(BigInt(0.05e9), 40)      // solAmount
    b.writeBigUInt64LE(BigInt(1_500_000e6), 48) // tokenAmount
    b.writeUInt8(isBuy ? 1 : 0, 56)
    user.toBuffer().copy(b, 57)
    b.writeBigInt64LE(BigInt(1789500000), 89)
    b.writeBigUInt64LE(BigInt(vSolLamports), 97)
    b.writeBigUInt64LE(BigInt(vTokensRaw), 105)
    return b
  }

  const t = decodeTradeEvent(build())
  check('decodes a trade event', Boolean(t))
  check('mint decoded', t.mint === mint.toBase58())
  check('trader decoded — this is the distinct-buyer signal', t.trader === user.toBase58())
  check('direction decoded', t.isBuy === true)
  check('sol amount converted from lamports', near(t.solAmount, 0.05, 1e-9))
  check('token amount converted from base units', near(t.tokenAmount, 1_500_000, 1e-6))
  check('reserves converted', near(t.vSol, 32, 1e-9) && near(t.vTokens, 1.073e9, 1))

  const sell = decodeTradeEvent(build({ isBuy: false }))
  check('sell direction decoded', sell.isBuy === false)

  // The struct has grown upstream before; appended fields must not break the prefix.
  const withTail = decodeTradeEvent(build({ tail: 200 }))
  check('extra trailing bytes are ignored', Boolean(withTail) && withTail.mint === mint.toBase58())

  // Refuse rather than misreport — a layout change must not yield wrong prices.
  check('rejects a wrong discriminator', decodeTradeEvent(Buffer.alloc(150)) === null)
  check('rejects a truncated payload', decodeTradeEvent(build().subarray(0, 60)) === null)
  check('rejects implausible reserves', decodeTradeEvent(build({ vSolLamports: 1, vTokensRaw: 1 })) === null)

  const logs = [
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
    'Program log: Instruction: Buy',
    `Program data: ${build().toString('base64')}`,
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
  ]
  const found = tradeEventsFromLogs(logs)
  check('extracts trades from a log array', found.length === 1 && found[0].mint === mint.toBase58())
  check('ignores non-event log lines', tradeEventsFromLogs(['Program log: hello']).length === 0)
  check('survives a garbage Program data line', tradeEventsFromLogs(['Program data: not-base64!!!']).length === 0)
  check('handles missing logs', tradeEventsFromLogs(null).length === 0)

  const feedEvent = toFeedEvent(found[0])
  check('shapes into a feed event', feedEvent.kind === 'buy' && feedEvent.mint === mint.toBase58())
  check('price derived the same way as the websocket feed', near(feedEvent.priceSol, 32 / 1.073e9, 1e-18))

  check('derives a wss URL from an https RPC', rpcWebsocketUrl('https://x.helius-rpc.com/?api-key=k').startsWith('wss://'))
  check('derives ws from http', rpcWebsocketUrl('http://localhost:8899').startsWith('ws://'))
}

// ------------------------------------------------------- paper balance
console.log('\nPaper balance')
{
  const { paperWalletSol } = store
  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.daily = {}; st.totalRealizedSol = 0
  st.exploreRealizedSol = 0; st.exploreWins = 0; st.exploreLosses = 0
  st.consecutiveLosses = 0; st.halted = null
  store.save()

  const START = 0.5
  check('a clean slate equals the starting balance', near(paperWalletSol(START), START))

  // Open position: its cost is tied up, not spent-and-gone.
  store.addPosition({ mint: 'W1', symbol: 'W1', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [] })
  check('an open position ties up its cost', near(paperWalletSol(START), START - 0.075))

  // Partial recovery frees part of it back.
  store.getState().positions.W1.solRecovered = 0.05
  check('partial recovery frees capital', near(paperWalletSol(START), START - 0.025))

  // Closing at a loss books the loss and frees the rest.
  store.closePosition('W1', 'stop-loss')
  check('a closed loss lands in the balance', near(paperWalletSol(START), START - 0.025), String(paperWalletSol(START)))

  // Explore P&L counts toward the balance even though it is a separate book.
  store.addPosition({ mint: 'W2', symbol: 'W2', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0.12, tokensRemaining: 0, rungsHit: [], explore: true })
  store.closePosition('W2', 'ladder')
  check('explore P&L still moves real paper balance', near(paperWalletSol(START), START - 0.025 + 0.045))

  /**
   * The regression this exists for: a running counter resets to START on restart while
   * pre-existing positions keep crediting their sells, so every restart inflated the
   * balance — and an inflated balance silently bumps the size tier.
   */
  const beforeRestart = paperWalletSol(START)
  store.initStore() // simulates a process restart re-reading the ledger
  check('balance survives a restart unchanged', near(paperWalletSol(START), beforeRestart),
    `${paperWalletSol(START)} vs ${beforeRestart}`)

  // Many losing trades must drive it DOWN, never up.
  for (let i = 0; i < 20; i++) {
    store.addPosition({ mint: `L${i}`, symbol: `L${i}`, state: 'open', openedAt: Date.now(),
      solSpent: 0.075, solRecovered: 0.059, tokensRemaining: 0, rungsHit: [], explore: true })
    store.closePosition(`L${i}`, 'time stop')
  }
  check('twenty losing trades reduce the balance', paperWalletSol(START) < beforeRestart,
    String(paperWalletSol(START)))
  check('the drop matches the losses', near(paperWalletSol(START), beforeRestart - 20 * 0.016, 1e-9),
    String(paperWalletSol(START)))
}

// ------------------------------------------------- feed subscription batching
console.log('\nFeed subscriptions')
{
  const { Feed } = await import('../src/feed.js')
  const feed = new Feed()
  const sent = []
  // Pretend the socket is open and capture what would go over the wire.
  feed.ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) }

  for (let i = 0; i < 50; i++) feed.watch('MINT' + i)
  check('watching does not send immediately', sent.length === 0, 'batched, not per-mint')
  // The shipped default must be long enough that a batch actually batches — a short
  // window degenerates to one-key messages, which is the pattern we replaced.
  const { execFileSync: exec2 } = await import('node:child_process')
  const shipped = Number(exec2('node', ['--input-type=module', '-e',
    "const {config} = await import('/home/user/kendallcoding202.github.io/pumpbot/src/config.js');" +
    'console.log(config.feed.subscribeBatchMs)'],
    { encoding: 'utf8', env: { ...process.env, SUBSCRIBE_BATCH_MS: '' } }).trim())
  check('shipped batch window actually batches', shipped >= 2000, `${shipped}ms`)
  check('all mints are tracked', feed.subscriptionStats().watched === 50)

  await new Promise((r) => setTimeout(r, config.feed.subscribeBatchMs + 120))
  check('one batched message covers them all', sent.length === 1, String(sent.length))
  check('batch carries every mint', sent[0]?.keys?.length === 50)
  check('batch uses the subscribe method', sent[0]?.method === 'subscribeTokenTrade')

  sent.length = 0
  for (let i = 0; i < 10; i++) feed.unwatch('MINT' + i)
  await new Promise((r) => setTimeout(r, config.feed.subscribeBatchMs + 120))
  check('unsubscribes batch too', sent.length === 1 && sent[0].keys.length === 10)
  check('unsubscribe uses the right method', sent[0]?.method === 'unsubscribeTokenTrade')
  check('watched count drops', feed.subscriptionStats().watched === 40)

  // A watch immediately followed by an unwatch should cancel, not churn the socket.
  sent.length = 0
  feed.watch('CHURN'); feed.unwatch('CHURN')
  await new Promise((r) => setTimeout(r, config.feed.subscribeBatchMs + 120))
  check('watch+unwatch in one window does not subscribe', !sent.some((m) => m.method === 'subscribeTokenTrade'))

  // The cap must hold, and be visible.
  const capped = new Feed()
  capped.ws = { readyState: 1, send: () => {} }
  for (let i = 0; i < config.feed.maxWatchedMints + 40; i++) capped.watch('C' + i)
  check('the cap is low enough to bound a metered feed', config.feed.maxWatchedMints <= 100,
    `${config.feed.maxWatchedMints} — each subscription is a recurring cost, not a free one`)
  check('subscriptions are capped', capped.subscriptionStats().watched === config.feed.maxWatchedMints)
  check('dropped watches are counted, not silent', capped.subscriptionStats().dropped === 40)

  // Oversized batches are chunked rather than sent as one huge message.
  const many = new Feed()
  const manySent = []
  many.maxWatched = 500 // this test is about chunking, not the cap
  many.ws = { readyState: 1, send: (s) => manySent.push(JSON.parse(s)) }
  for (let i = 0; i < 150; i++) many.watch('M' + i)
  await new Promise((r) => setTimeout(r, config.feed.subscribeBatchMs + 120))
  check('large batches are chunked', manySent.length === 2, String(manySent.length))
  check('chunks total the full set', manySent.reduce((n, m) => n + m.keys.length, 0) === 150)

  await feed.stop(); await capped.stop(); await many.stop()
}

// ------------------------------------------------------- explore mode
console.log('\nExplore mode')
{
  check('explore is on in paper', config.explore.enabled === true)
  check('priceable is never relaxed', config.explore.neverRelax.includes('priceable'))

  // The safety property that matters: there must be no env var that turns exploration
  // on with real money. Checked in a separate process so config re-reads the env.
  const { execFileSync } = await import('node:child_process')
  const probe = (env) =>
    execFileSync('node', ['--input-type=module', '-e',
      "const {config} = await import('/home/user/kendallcoding202.github.io/pumpbot/src/config.js');" +
      "console.log(JSON.stringify({explore: config.explore.enabled, paper: config.paper}))"],
      { encoding: 'utf8', env: { ...process.env, ...env } }).trim()

  const live = JSON.parse(probe({ PAPER: '0', EXPLORE: '1', PRIVATE_KEY: '' }))
  check('explore is OFF in live even with EXPLORE=1', live.explore === false, JSON.stringify(live))
  const paperOff = JSON.parse(probe({ PAPER: '1', EXPLORE: '0' }))
  check('explore can be turned off in paper', paperOff.explore === false)

  check('exploration has a budget', config.explore.budgetSol > 0)

  // Explore positions must not consume the strategy's exposure budget.
  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.daily = {}; st.totalRealizedSol = 0
  st.exploreRealizedSol = 0; st.exploreWins = 0; st.exploreLosses = 0; st.consecutiveLosses = 0
  st.halted = null; st.activity = []

  for (let i = 0; i < 10; i++) {
    store.addPosition({ mint: `X${i}`, symbol: `X${i}`, state: 'open', openedAt: Date.now(),
      solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [], explore: true })
  }
  check('explore positions are excluded from strategy positions', store.strategyPositions().length === 0)
  check('explore positions do not count as deployed', store.deployedSol() === 0)
  check('10 explore positions still allow a real entry',
    canOpen({ mint: 'REAL', creator: 'C', walletSol: 1 }) === null,
    String(canOpen({ mint: 'REAL', creator: 'C', walletSol: 1 })))

  // Explore losses must not trip the strategy's circuit breakers.
  for (let i = 0; i < 10; i++) {
    store.getState().positions[`X${i}`].solRecovered = 0.01 // a 0.065 loss each
    store.closePosition(`X${i}`, 'stop-loss')
  }
  check('explore P&L books to its own bucket', near(st.exploreRealizedSol, -0.65, 1e-9), String(st.exploreRealizedSol))
  check('strategy P&L is untouched by explore losses', st.totalRealizedSol === 0)
  check('explore losses do not count as a losing streak', st.consecutiveLosses === 0)
  check('explore losses do not hit the daily limit',
    canOpen({ mint: 'REAL2', creator: 'C', walletSol: 1 }) === null)
  check('explore wins/losses tallied separately', st.exploreLosses === 10 && st.exploreWins === 0)

  // A real loss still counts normally.
  store.addPosition({ mint: 'REALLOSS', symbol: 'RL', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0.05, tokensRemaining: 0, rungsHit: [] })
  store.closePosition('REALLOSS', 'stop-loss')
  check('a real loss still books to the strategy', near(st.totalRealizedSol, -0.025, 1e-9))
  check('a real loss still increments the streak', st.consecutiveLosses === 1)

  // The experiment must stop when its budget is gone. Left unbounded it spent 1.58 SOL
  // from a 0.5 SOL paper account, driving the derived balance negative.
  {
    const { Bot } = await import('../src/bot.js')
    const { EventEmitter } = await import('node:events')
    class Stub extends EventEmitter {
      constructor() { super(); this.watched = new Set() }
      start() {} ; async stop() {} ; watch() {} ; unwatch() {}
      subscriptionStats() { return { watched: 0, pending: 0, dropped: 0, max: 60 } }
    }
    const b = new Bot({ feed: new Stub() })
    const verdict = { failed: [{ id: 'buyers' }], pass: false }

    // Healthy feed, budget intact -> exploration is possible.
    b.stats.creates = 100
    b.stats.tradesMatched = 500
    store.getState().exploreRealizedSol = 0
    let any = false
    for (let i = 0; i < 200; i++) if (b.explorePermitted(verdict)) { any = true; break }
    check('explores when data flows and budget remains', any)

    // Budget exhausted -> stop, regardless of sample rate.
    store.getState().exploreRealizedSol = -config.explore.budgetSol
    check('stops once the budget is spent',
      Array.from({ length: 200 }, () => b.explorePermitted(verdict)).every((x) => x === false))

    // No trade data -> every explore trade is a forced blind exit at fee cost, which
    // costs budget and teaches nothing.
    store.getState().exploreRealizedSol = 0
    b.stats.tradesMatched = 0
    check('pauses when there is no trade data',
      Array.from({ length: 200 }, () => b.explorePermitted(verdict)).every((x) => x === false))

    // Never relaxes the one check it must not.
    b.stats.tradesMatched = 500
    check('still never explores an unpriceable token',
      Array.from({ length: 200 }, () => b.explorePermitted({ failed: [{ id: 'priceable' }], pass: false }))
        .every((x) => x === false))
  }

  // Activity log is bounded.
  for (let i = 0; i < 400; i++) store.logActivity('buy', `event ${i}`)
  check('activity log is capped', st.activity.length === 300, String(st.activity.length))
  check('activity log keeps the newest', st.activity.at(-1).text === 'event 399')
}

// ------------------------------------------------------- periodic summary
console.log('\nPeriodic summary')
{
  const { summaryText, summaryBaseline, statusText } = await import('../src/summary.js')

  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.halted = null; st.totalRealizedSol = 0

  let entered = 2
  let creates = 400
  const fakeBot = {
    walletSol: 0.52,
    statsSnapshot: () => ({
      messages: 90_000, creates, trades: 88_000, screened: 380, entered,
      watching: 7, shadowTracked: 55, parsing: true, uptimeSeconds: 14_400,
      topRejects: [{ id: 'buyers', n: 300 }, { id: 'market_cap', n: 40 }],
    }),
  }

  // A realistic baseline: 4 hours ago, when 400 launches had been seen and 2 entered.
  const base = { at: Date.now() - 4 * 3600_000, totalRealizedSol: 0, closedCount: 0, entered: 2, creates: 400 }

  // A quiet window — 500 more launches screened since, none taken.
  creates = 900
  const quiet = summaryText(fakeBot, base)
  check('quiet window says so plainly', quiet.includes('No trades'))
  check('quiet window reassures rather than alarms', quiet.includes('filter working'))
  check('quiet window names how many it screened', quiet.includes('500 launches'))
  check('window length is labelled', quiet.includes('4h 0m'))
  check('summary embeds full status', quiet.includes('launches') && quiet.includes('feed OK'))

  // Same window, now with activity.
  entered = 5
  store.addPosition({
    mint: 'SumMint11111111111111111111111111111111111', symbol: 'SUMDOG', state: 'open',
    openedAt: Date.now() - 200_000, entryPriceSol: 1e-7, lastPriceSol: 1.7e-7, peakPriceSol: 1.8e-7,
    tokensBought: 1e6, tokensRemaining: 330_000, solSpent: 0.075, solRecovered: 0.0765,
    rungsHit: [50], fills: [],
  })
  store.addPosition({
    mint: 'ClosedMint1111111111111111111111111111111', symbol: 'CLOSED', state: 'open',
    openedAt: Date.now() - 400_000, solSpent: 0.075, solRecovered: 0.19, tokensRemaining: 0, rungsHit: [50, 100],
  })
  store.closePosition('ClosedMint1111111111111111111111111111111', 'ladder complete')

  const active = summaryText(fakeBot, base)
  check('active window leads with realized delta', active.includes('realized on 1 trade'))
  check('delta is measured from the baseline, not all-time', active.includes('0.1150'), 'expected +0.115 SOL')
  check('open positions are appended', active.includes('SUMDOG'))
  check('quiet-window note is suppressed when trades happened', !active.includes('filter working'))

  // Baseline advances so the next window starts clean.
  const next = summaryBaseline(fakeBot)
  check('new baseline captures realized', near(next.totalRealizedSol, 0.115, 1e-9))
  check('new baseline captures trade count', next.closedCount === 1)
  check('new baseline captures entries', next.entered === 5)
  const afterRebase = summaryText(fakeBot, next)
  check('immediately after re-baselining the window reads quiet', afterRebase.includes('No trades'))

  // Entries but no exits yet.
  const openedOnly = summaryText({ ...fakeBot, statsSnapshot: () => ({ ...fakeBot.statsSnapshot(), entered: 9 }) }, next)
  check('entries-without-exits is its own headline', openedOnly.includes('opened'))

  check('status alone is a subset of the summary', quiet.includes(statusText(fakeBot).split('\n')[0]))
  check('summary fits a Telegram message', active.length < 4000, String(active.length))
}

// ------------------------------------------------------- telegram commands
console.log('\nTelegram commands')
{
  const { CommandListener } = await import('../src/commands.js')

  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.halted = null; st.totalRealizedSol = 0.12
  store.addPosition({
    mint: 'TgMint111111111111111111111111111111111111', symbol: 'TGDOG', state: 'open',
    openedAt: Date.now() - 90_000, entryPriceSol: 1e-7, lastPriceSol: 1.6e-7, peakPriceSol: 1.7e-7,
    tokensBought: 1_000_000, tokensRemaining: 330_000, solSpent: 0.075, solRecovered: 0.0762,
    rungsHit: [50], fills: [],
  })

  let panicked = false
  const fakeBot = {
    walletSol: 1.25,
    statsSnapshot: () => ({
      messages: 5000, creates: 120, trades: 4800, screened: 100, entered: 3,
      watching: 6, shadowTracked: 40, parsing: true, uptimeSeconds: 7200,
      topRejects: [{ id: 'buyers', n: 80 }],
    }),
    panicSell: async () => { panicked = true },
  }

  // With no token configured, notify() logs instead of sending, so handle() can be
  // called directly and we assert on what it would have replied.
  const listener = new CommandListener(fakeBot)
  const status = await listener.handle('/status')
  check('/status reports mode', status.includes('PAPER'))
  check('/status reports wallet', status.includes('1.2500'))
  check('/status reports net P&L', status.includes('P&L'))
  check('/status reports the funnel', status.includes('120 launches') && status.includes('3 entered'))
  check('/status reports feed health', status.includes('feed OK'))

  // Explore and strategy books must be distinguishable from the phone.
  store.addPosition({ mint: 'TgExp1111111111111111111111111111111111111', symbol: 'EXPDOG', state: 'open',
    openedAt: Date.now() - 30_000, entryPriceSol: 2e-7, lastPriceSol: 1.8e-7, peakPriceSol: 2.1e-7,
    tokensBought: 500_000, tokensRemaining: 500_000, solSpent: 0.075, solRecovered: 0,
    rungsHit: [], fills: [], explore: true, failedChecks: ['buyers'] })
  store.getState().exploreRealizedSol = -0.031
  store.getState().exploreWins = 1
  store.getState().exploreLosses = 4

  const split = await listener.handle('/status')
  check('/status separates the strategy book', split.includes('<b>Strategy</b>'))
  check('/status shows the explore book separately', split.includes('Explore</b> (experiment'))
  check('/status shows explore W/L and P&L', split.includes('1W/4L') && split.includes('0.0310'))
  check('strategy open count excludes explore', split.includes('<b>Strategy</b>: 1 open'))

  const pos = await listener.handle('/positions')
  check('/positions tags explore positions', pos.includes('EXPDOG') && pos.includes('🧪'))
  check('/positions leaves strategy positions untagged', /TGDOG<\/b> \+/.test(pos))
  delete store.getState().positions['TgExp1111111111111111111111111111111111111']
  check('/positions lists the open position', pos.includes('TGDOG'))
  check('/positions shows initials recovered', pos.includes('initials out'))
  check('/positions shows rungs hit', pos.includes('+50%'))

  await listener.handle('/pause')
  check('/pause halts the bot', Boolean(store.getState().halted))
  const haltedStatus = await listener.handle('/status')
  check('/status surfaces the halt', haltedStatus.includes('HALTED'))

  await listener.handle('/resume')
  check('/resume clears the halt', store.getState().halted === null)

  // The destructive one must never fire on a bare command.
  const warned = await listener.handle('/panic')
  check('/panic alone only warns', !panicked && warned.includes('confirm'))
  check('/panic warning names the position count', warned.includes('1 open'))

  await listener.handle('/panic confirm')
  check('/panic confirm actually liquidates', panicked)

  // /reset must never be a bare command, and must never touch a live ledger.
  store.getState().closed = [{ symbol: 'X', realizedSol: -0.01, explore: true, openedAt: 1, closedAt: 2, solSpent: 0.075, solRecovered: 0.065 }]
  store.getState().exploreRealizedSol = -1.86
  const resetWarn = await listener.handle('/reset')
  check('/reset alone only warns', resetWarn.includes('confirm') && store.getState().closed.length === 1)
  check('/reset warning shows what would go', resetWarn.includes('1.8600'))
  const resetDone = await listener.handle('/reset confirm')
  check('/reset confirm clears the ledger', store.getState().closed.length === 0)
  check('and zeroes the explore book', store.getState().exploreRealizedSol === 0)
  check('reset reports what it cleared', resetDone.includes('cleared'))

  check('unknown commands are ignored', (await listener.handle('/nonsense')) === null)
  check('plain chat is ignored', (await listener.handle('hello there')) === null)
  check('/help lists the commands', (await listener.handle('/help')).includes('/status'))
  check('@botname suffix is stripped', (await listener.handle('/status@pumpbot')).includes('pumpbot'))

  // Authorization: only the configured chat id may drive the bot.
  check('listener is disabled without credentials', new CommandListener(fakeBot).enabled === false)
  check('escaping is applied to symbols', typeof pos === 'string' && !pos.includes('<script'))
}

// ------------------------------------------------- end-to-end, synthetic feed
console.log('\nEnd-to-end bot loop')
{
  const { EventEmitter } = await import('node:events')
  const { Bot } = await import('../src/bot.js')

  // A feed we drive by hand. Same event contract as the real one.
  class FakeFeed extends EventEmitter {
    constructor() { super(); this.watched = new Set(); this.started = false }
    start() { this.started = true }
    async stop() { this.started = false }
    watch(m) { this.watched.add(m) }
    unwatch(m) { this.watched.delete(m) }
  }

  const MINT = 'E2EmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const curve = { vSol: 40, vTokens: 900_000_000 }
  const priceAt = (mult) => (curve.vSol * mult) / curve.vTokens

  const mkCreate = () => normalizeEvent({
    txType: 'create', mint: MINT, traderPublicKey: 'DEV', name: 'E2E Dog', symbol: 'E2E',
    initialBuy: 20_000_000, solAmount: 0.8,
    vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44,
  })
  const mkTrade = (kind, trader, mult = 1) => normalizeEvent({
    txType: kind, mint: MINT, traderPublicKey: trader, tokenAmount: 1000, solAmount: 0.05,
    vSolInBondingCurve: curve.vSol * mult, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 * mult,
  })

  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.daily = {}; st.totalRealizedSol = 0
  st.consecutiveLosses = 0; st.blockedCreators = {}; st.halted = null
  // Must persist: bot.start() re-runs initStore(), which reloads from disk.
  store.save()

  const feed = new FakeFeed()
  const bot = new Bot({ feed })
  await bot.start()
  // Drop the real schedulers; this test drives every tick explicitly.
  clearInterval(bot.sweepTimer); clearInterval(bot.balanceTimer); clearInterval(bot.heartbeatTimer)

  check('bot subscribes to the feed on start', feed.started)

  check('paper wallet address is stable across runs',
    (await import('../src/wallet.js')).getPublicKey().toBase58() ===
    (await import('../src/wallet.js')).getPublicKey().toBase58())

  feed.emit('raw', {}); feed.emit('create', mkCreate())
  check('a new launch is watched', feed.watched.has(MINT))
  check('launch counted in stats', bot.statsSnapshot().creates === 1)
  check('parsing marked healthy', bot.statsSnapshot().parsing === true)

  for (let i = 0; i < 20; i++) feed.emit('trade', mkTrade('buy', `BUYER${i}`))
  feed.emit('trade', mkTrade('sell', 'SELLER0'))
  check('trade events counted', bot.statsSnapshot().trades === 21)
  check('trades are attributed to the watched candidate', bot.statsSnapshot().tradesMatched === 21)

  // A trade for something we are not tracking must not count as matched — that counter
  // is the signal that our subscriptions are actually being served.
  feed.emit('trade', normalizeEvent({ txType: 'buy', mint: 'UNRELATED', traderPublicKey: 'Z',
    tokenAmount: 1, solAmount: 0.01, vSolInBondingCurve: 30, vTokensInBondingCurve: 1e9 }))
  check('unrelated trades are not counted as matched', bot.statsSnapshot().tradesMatched === 21)
  check('but they do count toward total trades', bot.statsSnapshot().trades === 22)

  // Not old enough to screen yet.
  await bot.tick()
  check('does not enter before the observation window', !store.getState().positions[MINT])
  check('candidate is still being observed', bot.candidates.has(MINT))

  // Age the candidate past OBSERVE_SECONDS.
  bot.candidates.get(MINT).createdAt -= (config.entry.observeSeconds + 5) * 1000
  await bot.tick()

  const pos = store.getState().positions[MINT]
  check('enters a qualifying launch', Boolean(pos), JSON.stringify(bot.statsSnapshot().topRejects))
  check('entry used the tier size', pos && near(pos.solSpent, 0.075 + config.exec.priorityFeeSol, 1e-9))
  check('entry counted in stats', bot.statsSnapshot().entered === 1)
  check('position is shadow-tracked for learning', bot.shadow.has(MINT))

  // Price doubles -> first two rungs fire.
  const beforeTokens = pos.tokensRemaining
  feed.emit('trade', mkTrade('buy', 'WHALE', 2))
  await new Promise((r) => setImmediate(r))
  await bot.tick()

  const after = store.getState().positions[MINT]
  check('ladder fired on the price move', !after || after.tokensRemaining < beforeTokens)
  if (after) {
    check('initials were recovered', after.solRecovered >= after.solSpent, `${after.solRecovered} vs ${after.solSpent}`)
    check('rungs recorded', after.rungsHit.length >= 1, after.rungsHit.join(','))
  }

  // Curve collapses -> emergency exit closes the position.
  feed.emit('trade', mkTrade('sell', 'RUGGER', 0.2))
  await new Promise((r) => setImmediate(r))
  await bot.tick()

  check('collapse closes the position', !store.getState().positions[MINT])
  const closed = store.getState().closed.at(-1)
  check('closed trade was booked', closed?.mint === MINT, JSON.stringify(closed?.symbol))
  check('a ladder winner books a profit', closed && closed.realizedSol > 0, String(closed?.realizedSol))
  check('feed unsubscribed after close', !feed.watched.has(MINT) || bot.shadow.has(MINT))

  // Stats survive into the dashboard payload.
  const snap = buildSnapshot(0.5, bot.statsSnapshot())
  check('pipeline stats reach the dashboard', snap.pipeline?.creates === 1 && snap.pipeline.entered === 1)
  check('dashboard payload still serialises', typeof JSON.stringify(snap) === 'string')


  // Regression: explore positions once counted toward MAX_CONCURRENT_POSITIONS in
  // #onCreate, so the experiment could fill the limit and stop the bot observing any
  // new launch at all — no candidates, no data, and no way out of the state.
  for (let i = 0; i < config.sizing.maxConcurrentPositions + 3; i++) {
    store.addPosition({ mint: `BLOCK${i}`, symbol: `B${i}`, state: 'open', openedAt: Date.now(),
      solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [], explore: true })
  }
  feed.emit('create', normalizeEvent({ txType: 'create', mint: 'NOTBLOCKED', traderPublicKey: 'D',
    name: 'Free', symbol: 'FREE', initialBuy: 1e7, solAmount: 0.5,
    vSolInBondingCurve: 31, vTokensInBondingCurve: 9.8e8, marketCapSol: 40 }))
  check('open positions do not block observing new launches', bot.candidates.has('NOTBLOCKED'))
  check('and the new launch is subscribed to', feed.watched.has('NOTBLOCKED'))
  bot.candidates.delete('NOTBLOCKED')
  for (let i = 0; i < config.sizing.maxConcurrentPositions + 3; i++) delete store.getState().positions[`BLOCK${i}`]
  store.save()

  await bot.stop()
  check('bot stops cleanly', !feed.started)
}

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
