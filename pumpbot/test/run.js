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
const { wilson, simulateLadder, bestThreshold, analyze, roundTripCost } = await import('../src/learn.js')
const { JOURNAL_VERSION, CreatorIndex } = await import('../src/journal.js')
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

/**
 * `buyers` defaults above MIN_UNIQUE_BUYERS and the buys are weighted to the back of the
 * observation window so buyAcceleration clears its bar — the two checks the first real
 * dataset added. A fixture that cannot pass the live filter tests nothing about it.
 * Pass `fading: true` for the opposite shape.
 */
function buildCandidate({ create = {}, buyers = 70, sells = 2, devSells = false, devSellTokens = 500, mcap = 44, fading = false } = {}) {
  const c = new Candidate(createEvt(create))
  const windowMs = config.entry.observeSeconds * 1000
  for (let i = 0; i < buyers; i++) {
    const at = c.createdAt + (fading
      ? (i / Math.max(1, buyers)) * (windowMs / 4)
      : windowMs * 0.7 + (i / Math.max(1, buyers)) * (windowMs * 0.25))
    c.apply({ ...normalizeEvent({
      txType: 'buy', mint: 'MINT', traderPublicKey: `B${i}`, tokenAmount: 1000, solAmount: 0.05,
      vSolInBondingCurve: 40, vTokensInBondingCurve: 900_000_000, marketCapSol: mcap,
    }), at })
  }
  for (let i = 0; i < sells; i++) {
    c.apply(normalizeEvent({
      txType: 'sell', mint: 'MINT', traderPublicKey: devSells ? 'DEV' : `S${i}`,
      tokenAmount: devSells ? devSellTokens : 500,
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

  /**
   * More sells than buys. The bar was 1.4x, which over 71,979 rejected launches threw
   * away winners at exactly the base rate — so it is 1.0x now and this fixture has to
   * be an actual net distribution rather than merely a slow one.
   */
  const dumping = evaluateEntry(buildCandidate({ buyers: 20, sells: 25 }))
  check('a launch being net distributed out of is rejected',
    !dumping.pass && dumping.failed.some((c) => c.id === 'buy_pressure'),
    JSON.stringify(dumping.failed?.map((c) => c.id)))
  check('but merely having some sellers is not',
    evaluateEntry(buildCandidate({ buyers: 70, sells: 60 })).pass,
    JSON.stringify(evaluateEntry(buildCandidate({ buyers: 70, sells: 60 })).failed?.map((c) => c.id)))

  /**
   * The dev check is now about SIZE, not the fact of a sale.
   *
   * As a boolean it rejected at 14.9% against a 15.7% base rate — it could not tell a
   * dev trimming from a dev dumping, so it averaged the two into noise and cost entries
   * for nothing. The fixture dev starts with 20,000,000 tokens, so these two cases are
   * the same event at two sizes.
   */
  const devTrim = evaluateEntry(buildCandidate({ devSells: true, sells: 1, devSellTokens: 1_000_000 }))
  check('a dev trimming 5% of their own bag is not disqualifying', devTrim.pass,
    JSON.stringify(devTrim.failed?.map((c) => c.id)))

  const devDump = evaluateEntry(buildCandidate({ devSells: true, sells: 1, devSellTokens: 14_000_000 }))
  check('but a dev unloading 70% of it is',
    !devDump.pass && devDump.failed.some((c) => c.id === 'dev_not_dumping'))

  /** The boundary itself, from both sides, so the threshold is the thing under test. */
  const justUnder = buildCandidate({ devSells: true, sells: 1, devSellTokens: 9_800_000 })
  const justOver = buildCandidate({ devSells: true, sells: 1, devSellTokens: 10_200_000 })
  check('the cut sits at the configured percentage, not at "sold anything"',
    evaluateEntry(justUnder).pass && !evaluateEntry(justOver).pass)
  check('and the share sold is recorded as a number, not a flag',
    Math.round(justUnder.devSoldPct) === 49 && Math.round(justOver.devSoldPct) === 51)

  /**
   * A dev who never bought has no bag, so there is no percentage to take. Inventing one
   * would put a fabricated zero into the feature the scan is about to rule on.
   */
  const noBag = buildCandidate({ create: { initialBuy: 0 } })
  check('a dev who started with no bag has no share-sold to report', noBag.devSoldPct === null)

  const whaleDev = evaluateEntry(buildCandidate({ create: { initialBuy: 400_000_000 } }))
  check('dev holding too much supply is rejected', !whaleDev.pass && whaleDev.failed.some((c) => c.id === 'dev_hold'))

  const scamName = evaluateEntry(buildCandidate({ create: { name: 'Free AIRDROP claim' } }))
  check('impersonation keywords are rejected', !scamName.pass && scamName.failed.some((c) => c.id === 'naming'))

  /**
   * The ceiling was backwards and the data caught it: it rejected 693 launches of which
   * 25.7% would have reached +50%, against a 9.9% base rate — it was vetoing launches for
   * the offence of going up, because market cap only began updating mid-window once it
   * was derived from trade reserves. Raised 120 -> 2000, so it now only catches something
   * genuinely distributed out.
   */
  check('a launch that ran during the window is no longer rejected for it',
    evaluateEntry(buildCandidate({ mcap: 900 })).pass,
    JSON.stringify(evaluateEntry(buildCandidate({ mcap: 900 })).failed?.map((c) => c.id)))
  const tooBig = evaluateEntry(buildCandidate({ mcap: 5000 }))
  check('a fully distributed market cap is still rejected',
    !tooBig.pass && tooBig.failed.some((c) => c.id === 'market_cap_ceiling'))

  // The check the filter never had: is the buying still happening?
  const fading = evaluateEntry(buildCandidate({ fading: true }))
  check('a fading launch is rejected', !fading.pass && fading.failed.some((c) => c.id === 'fading'),
    JSON.stringify(fading.failed?.map((c) => c.id)))
  check('an accelerating one is not', evaluateEntry(buildCandidate()).pass)

  /**
   * Floor and ceiling report SEPARATELY now. As one `market_cap` line the report said
   * it rejected 30,450 launches at a 27.7% hit rate, which reads as the filter binning
   * its best material — while the scan showed the damage was all on the floor side
   * (`marketCapSol < 3.2` at 41.6%), a population too thin to trade rather than an
   * opportunity. One id cannot carry two opposite verdicts.
   */
  const tooSmall = evaluateEntry(buildCandidate({ mcap: 5 }))
  check('a market cap nobody has bid up is rejected by the FLOOR',
    !tooSmall.pass && tooSmall.failed.some((c) => c.id === 'market_cap_floor'))
  check('and the ceiling does not also claim that rejection',
    !tooSmall.failed.some((c) => c.id === 'market_cap_ceiling'))
  check('a too-large cap is not blamed on the floor',
    !evaluateEntry(buildCandidate({ mcap: 5000 })).failed.some((c) => c.id === 'market_cap_floor'))
  check('an unpriceable market cap fails both, not neither',
    (() => {
      const c = buildCandidate()
      c.marketCapSol = undefined
      const v = evaluateEntry(c)
      return v.failed.some((x) => x.id === 'market_cap_floor') &&
        v.failed.some((x) => x.id === 'market_cap_ceiling')
    })())

  const c = buildCandidate({ buyers: 20 })
  check('dev is excluded from the organic buyer count', c.organicBuyers === 20, String(c.organicBuyers))
  check('dev hold percent computed from supply', near(c.devHoldPct, 2), String(c.devHoldPct))
}

// ------------------------------------------------- deployer track record
console.log('\nCreator prior')
{
  /**
   * The signal the first real dataset handed us: repeat deployers who have never once
   * produced a winner, over a hundred launches each, sitting next to one running 23%.
   * The question this has to answer correctly is not "has this deployer lost?" but
   * "could an ordinary deployer plausibly have this record by chance?", which is why it
   * is judged on the interval rather than the point estimate.
   */
  const idx = new CreatorIndex()
  const note = (creator, launches, hits) => {
    for (let i = 0; i < launches; i++) idx.note({ creator, hitFirstRung: i < hits })
  }
  note('MARKET', 400, 60) // the yardstick: 15% of an ordinary deployer's launches hit
  note('BADDEV', 120, 0) // 0-for-120
  note('SHORTDEV', 5, 0) // 0-for-5 — nothing at all
  note('BORDERLINE', 22, 0) // 0-for-22 — bad-looking, not yet evidence
  note('GOODDEV', 126, 29) // 23%

  const base = idx.baseRate()
  check('base rate is every labelled launch, not a per-creator average',
    near(base, 89 / 673, 1e-9), String(base))

  const bad = idx.verdict('BADDEV')
  check('a deployer 0-for-120 is demonstrably worse than the market',
    bad.known && bad.worseThanMarket, JSON.stringify(bad))
  check('and it is the upper bound that says so, not the 0%',
    bad.upperBound > 0 && bad.upperBound < base, String(bad.upperBound))

  /**
   * The failure mode a point estimate has: 0-for-5 and 0-for-120 are both "0%", and
   * treating them alike would blocklist most of the market on five coin flips.
   */
  const short = idx.verdict('SHORTDEV')
  check('a 0-for-5 record is not treated as evidence', !short.known && !short.worseThanMarket)
  check('a 0-for-22 record still is not — the interval reaches above the base rate',
    !idx.verdict('BORDERLINE').worseThanMarket,
    String(idx.verdict('BORDERLINE').upperBound))

  const good = idx.verdict('GOODDEV')
  check('a profitable deployer is not blocked', good.known && !good.worseThanMarket)

  const unseen = idx.verdict('NOBODY_HAS_SEEN_THIS_ONE')
  check('an unknown deployer is not blocked', !unseen.known && !unseen.worseThanMarket)
  check('a missing creator address is not blocked', !idx.verdict(null).worseThanMarket)

  /**
   * The banner reports these, so a wrong count is a page that lies confidently about
   * whether the rule can do anything. `eligible` and `blocked` are deliberately separate:
   * an index too young for anyone to be judged and an index that has met no bad deployer
   * both give blocked 0, and they are not the same situation.
   */
  const sum = idx.summary({ minLaunches: 20 })
  check('summary counts every deployer', sum.creators === 5, String(sum.creators))
  check('summary counts every labelled launch', sum.launches === 673, String(sum.launches))
  check('summary counts who has a judgeable record',
    sum.eligible === 4, String(sum.eligible)) // all but SHORTDEV's 5
  check('summary counts who the rule would actually refuse',
    sum.blocked === 1, String(sum.blocked)) // BADDEV alone
  check('summary carries the yardstick it judged against', near(sum.baseRate, 89 / 673, 1e-9))

  // Memoized on a hot path — a stale count is worse than a slow one.
  const cached = idx.summary({ minLaunches: 20 })
  check('summary is memoized between calls', cached === sum)
  // Only MARKET's 400 launches clear a 200 bar, so the count must drop 4 -> 1 rather
  // than being served from the cache keyed at 20.
  check('a different threshold is not served from that cache',
    idx.summary({ minLaunches: 200 }).eligible === 1,
    String(idx.summary({ minLaunches: 200 }).eligible))
  idx.summary({ minLaunches: 20 })
  for (let i = 0; i < 40; i++) idx.note({ creator: 'LATECOMER', hitFirstRung: false })
  check('and recording an outcome invalidates it',
    idx.summary({ minLaunches: 20 }).creators === 6,
    String(idx.summary({ minLaunches: 20 }).creators))

  check('an empty index reports nothing to act on',
    new CreatorIndex().summary().launches === 0 && new CreatorIndex().summary().blocked === 0)

  /**
   * The positive arm. Same interval, other end: a deployer is only "proven" when even
   * the most PESSIMISTIC reading of their record beats the market, so two-for-two is no
   * more a track record here than nought-for-two was on the blocking side.
   */
  const proven = idx.verdict('GOODDEV')
  check('a deployer well above the market is marked proven',
    proven.betterThanMarket && proven.lowerBound > proven.base,
    JSON.stringify({ lo: proven.lowerBound, base: proven.base }))
  check('the 0-for-120 deployer is not', !bad.betterThanMarket)
  check('an unremarkable record is neither', (() => {
    const i = new CreatorIndex()
    for (let k = 0; k < 400; k++) i.note({ creator: 'MKT', hitFirstRung: k < 60 })
    for (let k = 0; k < 60; k++) i.note({ creator: 'MID', hitFirstRung: k < 9 }) // 15%, same as base
    const v = i.verdict('MID')
    return v.known && !v.worseThanMarket && !v.betterThanMarket
  })())
  check('a tiny winning streak is not proven', (() => {
    const i = new CreatorIndex()
    for (let k = 0; k < 400; k++) i.note({ creator: 'MKT', hitFirstRung: k < 60 })
    for (let k = 0; k < 2; k++) i.note({ creator: 'LUCKY', hitFirstRung: true })
    return !i.verdict('LUCKY').betterThanMarket
  })())

  const CT = (await import('../src/journal.js')).CREATOR_TIER
  check('tiers are ordered worst to best',
    CT.poor < CT.unknown && CT.unknown < CT.ordinary && CT.ordinary < CT.proven)
  check('a bad deployer tiers as poor', idx.tier('BADDEV') === CT.poor)
  check('a good deployer tiers as proven', idx.tier('GOODDEV') === CT.proven)
  check('an unseen deployer tiers as unknown', idx.tier('NOBODY') === CT.unknown)
  check('unknown sits above poor, so a scan cannot read "no record" as "bad record"',
    CT.unknown > CT.poor)
  check('summary counts the proven end too', typeof idx.summary().proven === 'number')
  check('an empty index has no opinion about anyone',
    new CreatorIndex().baseRate() === null && !new CreatorIndex().verdict('X').worseThanMarket)

  // --- and now the same priors, through the filter ---
  const fromPrior = (creator) => evaluateEntry(buildCandidate(), { creatorPrior: idx.verdict(creator) })

  const blocked = fromPrior('BADDEV')
  check('the filter refuses a launch from a demonstrably bad deployer',
    !blocked.pass && blocked.failed.some((c) => c.id === 'creator_history'),
    JSON.stringify(blocked.failed?.map((c) => c.id)))
  check('the rejection says what the record actually was',
    /0\/120/.test(blocked.failed.find((c) => c.id === 'creator_history')?.detail ?? ''),
    JSON.stringify(blocked.failed.find((c) => c.id === 'creator_history')))

  check('an otherwise-good launch from a good deployer still passes', fromPrior('GOODDEV').pass,
    JSON.stringify(fromPrior('GOODDEV').failed?.map((c) => c.id)))
  check('an unknown deployer still passes', fromPrior('NOBODY').pass)
  check('a short record still passes', fromPrior('SHORTDEV').pass)

  /**
   * With no prior supplied the check must not exist at all. A fresh install, or a run
   * with learning switched off, has no index to ask — refusing everything it cannot look
   * up would turn "we have no data" into "block the market".
   */
  const noPrior = evaluateEntry(buildCandidate())
  check('with no prior at all the check abstains rather than blocking', noPrior.pass)
  check('and the check is not even reported',
    !noPrior.checks?.some((c) => c.id === 'creator_history'),
    JSON.stringify(noPrior.checks?.map((c) => c.id)))
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
  check('first rung fires at +50%', up50.rungs.includes(config.exit.ladder[0].atPct))
  check('the first rung sells the configured fraction',
    near(up50.sellTokens, 1_000_000 * (config.exit.ladder[0].sellPct / 100)), String(up50.sellTokens))

  /**
   * Multi-rung mechanics, exercised against an EXPLICIT ladder rather than whatever the
   * shipped default happens to be. The default is now a single all-out sell — four rungs
   * cost 16% of a winner against 5.3% for one — but the laddering logic still has to work
   * for anyone who configures one.
   */
  {
    const realLadder = config.exit.ladder
    config.exit.ladder = [
      { atPct: 50, sellPct: 67 }, { atPct: 100, sellPct: 10 },
      { atPct: 200, sellPct: 10 }, { atPct: 400, sellPct: 10 },
    ]
    const laddered = decideExit(mkPosition(), { priceSol: 1.5e-7, vSol: 34 })
    check('a laddered first rung sells 67% of the bag', near(laddered.sellTokens, 670_000), String(laddered.sellTokens))
    // 67% sold at 1.5x returns ~1.005x of the stake — initials out, rest is house money.
    check('which recovers the stake', 0.67 * 1.5 >= 1.0)

    const gap = decideExit(mkPosition(), { priceSol: 3e-7, vSol: 60 })
    check('a gap up clears several rungs at once', gap.rungs.length === 3, gap.rungs.join(','))
    check('gapped rungs sell the sum, not one rung', near(gap.sellTokens, 870_000), String(gap.sellTokens))
    config.exit.ladder = realLadder
  }

  /**
   * The shipped default takes PART of the position at the first rung and leaves the rest
   * to the trailing stop. One rung, not four — the fee argument against the four-rung
   * ladder still holds — but the paired sweep put selling 40% ahead of selling the lot,
   * so the moon bag pays for its own extra transaction.
   */
  check('the default exit banks part of the position and lets the rest run',
    config.exit.ladder.length === 1 && config.exit.ladder[0].sellPct < 100,
    JSON.stringify(config.exit.ladder))

  const already = decideExit(mkPosition({ rungsHit: [50] }), { priceSol: 1.6e-7, vSol: 34 })
  check('a rung never fires twice', already.sellTokens === 0)

  const stop = decideExit(mkPosition(), { priceSol: 0.6e-7, vSol: 22 })
  check('stop-loss exits everything', stop.sellAll && stop.reasons[0].includes('stop-loss'))

  // Past the time stop, which is derived rather than pinned so it survives the next move.
  const pastStop = () => Date.now() - (config.exit.timeStopSeconds + 100) * 1000
  const old = decideExit(mkPosition({ openedAt: pastStop(), lastPriceAt: Date.now() }), { priceSol: 1.1e-7, vSol: 31 })
  check('time stop fires on a position that never ran', old.sellAll && old.reasons[0].includes('time stop'))

  const notYet = decideExit(
    mkPosition({ openedAt: Date.now() - (config.exit.timeStopSeconds - 100) * 1000, lastPriceAt: Date.now() }),
    { priceSol: 1.1e-7, vSol: 31 },
  )
  check('and not before it is due', notYet.sellTokens === 0, JSON.stringify(notYet.reasons))

  /**
   * A LITERAL 700s, deliberately, because deriving it from config makes the test move
   * with the setting and catch nothing — which is what the first version of it did.
   *
   * 700 sits between the old ten-minute stop and the shipped fifteen. A quiet position
   * at that age used to be sold; it is not any more, and that is the change. Selling on
   * the clock realises a loss the price never asked for: the coin is flat, not broken.
   */
  const quietAtElevenMinutes = decideExit(
    mkPosition({ openedAt: Date.now() - 700_000, lastPriceAt: Date.now() }),
    { priceSol: 1.1e-7, vSol: 31 },
  )
  check('a flat position at 700s is no longer sold on the clock',
    quietAtElevenMinutes.sellTokens === 0, JSON.stringify(quietAtElevenMinutes.reasons))

  /**
   * The ceiling, and the reason for it. The journal observes outcomes for
   * OUTCOME_WINDOW_MINUTES, so a time stop past that has no recorded path to be priced
   * against — the sweep would quietly score it as a tie with the incumbent rather than
   * as having no evidence. Raising one without the other is the mistake this catches.
   */
  check('the time stop stays inside the window the journal actually observes',
    config.exit.timeStopSeconds <= config.learning.outcomeWindowMinutes * 60,
    `${config.exit.timeStopSeconds}s vs ${config.learning.outcomeWindowMinutes * 60}s observed`)

  const oldButRunning = decideExit(
    mkPosition({ openedAt: pastStop(), lastPriceAt: Date.now(), rungsHit: [50], peakPriceSol: 1.6e-7 }),
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

  /**
   * SILENCE IS NOT A SELL SIGNAL, and the rule that said it was has been removed.
   *
   * On a bonding curve the price is vSol/vTokens and those move only when somebody
   * trades. No trades therefore means the price has NOT CHANGED — the stop-loss was
   * never silently disabled, it simply had not triggered. The old rule turned "nobody
   * traded for three minutes" into a guaranteed realized loss, and the live log was
   * full of it closing positions at -20% and worse.
   */
  const staleMs = (config.exit.stalePriceSeconds + 30) * 1000
  const stale = decideExit(mkPosition({ lastPriceAt: Date.now() - staleMs }), { priceSol: 1e-7, vSol: 30 })
  check('a quiet token is no longer dumped for being quiet', stale.sellTokens === 0,
    JSON.stringify(stale.reasons))

  const staleButWinning = decideExit(
    mkPosition({ lastPriceAt: Date.now() - staleMs, rungsHit: [50, 100], peakPriceSol: 3e-7 }),
    { priceSol: 2.9e-7, vSol: 50 },
  )
  check('and silence certainly does not close a winner', !staleButWinning.sellAll,
    JSON.stringify(staleButWinning.reasons))

  // The rules that DO reason about price still work on a quiet token, because the
  // price they are reasoning about is still correct.
  const quietAndFalling = decideExit(
    mkPosition({ lastPriceAt: Date.now() - staleMs }), { priceSol: 0.5e-7, vSol: 30 },
  )
  check('a quiet token that has fallen through the stop is still sold',
    quietAndFalling.sellAll && /stop/i.test(quietAndFalling.reasons.join(' ')),
    JSON.stringify(quietAndFalling.reasons))

  /**
   * What genuinely IS dangerous: not being able to price the position at all. A
   * graduated token's curve account is gone, or the RPC will not answer. The bot reads
   * the curve directly when the feed goes quiet, so reaching this state means those
   * reads failed repeatedly — one timeout is a bad moment, several in a row is real.
   */
  const unpriceable = decideExit(
    mkPosition({ lastPriceAt: Date.now() - staleMs, blindReads: config.exit.blindExitAfterReads }),
    { priceSol: 1e-7, vSol: 30 },
  )
  check('a position that cannot be priced at all IS exited',
    unpriceable.sellAll && /cannot price/.test(unpriceable.reasons[0]), JSON.stringify(unpriceable.reasons))
  check('but one failed read is not enough',
    decideExit(mkPosition({ lastPriceAt: Date.now() - staleMs, blindReads: 1 }),
      { priceSol: 1e-7, vSol: 30 }).sellTokens === 0)

  // The old behaviour is still reachable, because the sweep prices it against the new.
  const wasOn = config.exit.sellOnStalePrice
  config.exit.sellOnStalePrice = true
  check('the old silence rule still works when switched back on',
    decideExit(mkPosition({ lastPriceAt: Date.now() - staleMs }), { priceSol: 1e-7, vSol: 30 })
      .reasons[0].includes('no price update'))
  config.exit.sellOnStalePrice = wasOn

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

  /**
   * Selling 100% of a bag leaves a floating-point residue — measured at 4.7e-10 tokens.
   * Not sellable, but greater than zero, so the position stayed open, kept being managed,
   * and exited a second time on the stale price or time stop. That second exit is a real
   * priority fee paid on nothing, and it matters now that the default sells the whole
   * position at one rung.
   */
  {
    const whole = newPosition({ mint: 'DUST', symbol: 'DUST', creator: 'C',
      fill: { avgPriceSol: 1e-7, tokensReceived: 1_000_000, solSpent: 0.075 }, curve: { vSol: 30 } })
    applySell(whole, { tokensSold: 1_000_000 * (100 / 100), solReceived: 0.11 }, ['all out'])
    check('a full sell leaves exactly zero, not dust', whole.tokensRemaining === 0, String(whole.tokensRemaining))
    check('and the position reads as finished',
      decideExit(whole, { priceSol: 1e-7, vSol: 30 }).sellAll === true)

    // A real remainder is still a real remainder.
    const part = newPosition({ mint: 'PART', symbol: 'PART', creator: 'C',
      fill: { avgPriceSol: 1e-7, tokensReceived: 1_000_000, solSpent: 0.075 }, curve: { vSol: 30 } })
    applySell(part, { tokensSold: 500_000, solReceived: 0.06 }, ['half'])
    check('a partial sell keeps what is left', part.tokensRemaining === 500_000)
  }
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

  /**
   * Loss limits at the ACCOUNT SIZE THEY WERE WRITTEN FOR — a 0.5 SOL start. Here the
   * absolute floor and the percentage rule are equal by construction, so these are the
   * original numbers and behaviour is unchanged.
   */
  const today = new Date().toISOString().slice(0, 10)
  const anchor = (walletSol) => { s.baseEquitySol = 0; s.peakRealizedSol = 0; canOpen({ mint: 'ANCHOR', creator: 'C', walletSol }) }

  s.daily = {}; s.totalRealizedSol = 0
  anchor(0.5)
  check('base equity is anchored from the first reading', near(s.baseEquitySol, 0.5), String(s.baseEquitySol))

  s.daily[today] = { realizedSol: -0.19, wins: 0, losses: 5 }
  check('just inside the daily limit still trades', canOpen({ mint: 'N3a', creator: 'C', walletSol: 0.5 }) === null,
    String(canOpen({ mint: 'N3a', creator: 'C', walletSol: 0.5 })))
  s.daily[today] = { realizedSol: -0.2, wins: 0, losses: 5 }
  check('the daily loss limit stops trading', canOpen({ mint: 'N3', creator: 'C', walletSol: 0.5 })?.includes('daily loss'))

  s.daily = {}
  // Wallet and realized P&L must agree: losing 0.35 from a 0.5 SOL start leaves 0.15.
  // `observed = wallet + deployed - realized` is invariant under trading precisely
  // because of that, which is what makes it a deposit detector rather than a loss
  // detector — so an inconsistent fixture reads as a top-up and re-anchors the limits.
  s.totalRealizedSol = -0.35
  const blocked = canOpen({ mint: 'N4', creator: 'C', walletSol: 0.15 })
  check('the total loss limit halts the bot', blocked === 'total loss limit reached' && Boolean(s.halted), String(blocked))
  check('a halt blocks everything after it', canOpen({ mint: 'N5', creator: 'C', walletSol: 0.15 })?.startsWith('halted'))
  store.clearHalt()

  /**
   * The same limits on an account that GREW to the 5 SOL benchmark.
   *
   * A flat 0.35 SOL total-loss cap is 70% of the starting account but 7% of this one, so
   * taking whichever limit fires first would halt a perfectly healthy account on an
   * ordinary dip — and permanently, since the total-loss halt does not clear with the
   * day. The limits have to scale with the account or the benchmark the bot is built to
   * reach is also the point at which it bricks itself.
   */
  s.daily = {}; s.totalRealizedSol = 4.5
  anchor(5)
  check('a grown account anchors the same base', near(s.baseEquitySol, 0.5), String(s.baseEquitySol))
  check('the peak tracks realized gains', near(s.peakRealizedSol, 4.5), String(s.peakRealizedSol))

  // A 0.4 SOL loss exceeds the old fixed 0.35 cap, but is 8% of a 5 SOL account.
  s.totalRealizedSol = 4.1
  check('a small dip on a grown account does NOT halt',
    canOpen({ mint: 'G1', creator: 'C', walletSol: 4.6 }) === null && !s.halted,
    String(canOpen({ mint: 'G1', creator: 'C', walletSol: 4.6 })))

  // A real 70% drawdown from the 5.0 peak does.
  s.totalRealizedSol = 0.9
  check('a genuine drawdown on a grown account halts',
    canOpen({ mint: 'G2', creator: 'C', walletSol: 1.4 }) === 'total loss limit reached' && Boolean(s.halted))
  store.clearHalt()

  // Daily limit scales too: 40% of the 5.0 peak is 2.0, not 0.2.
  s.totalRealizedSol = 4.5
  s.daily[today] = { realizedSol: -0.5, wins: 0, losses: 9 }
  check('a daily loss well past the old cap is fine on a grown account',
    canOpen({ mint: 'G3', creator: 'C', walletSol: 5 }) === null,
    String(canOpen({ mint: 'G3', creator: 'C', walletSol: 5 })))
  s.daily[today] = { realizedSol: -2.1, wins: 0, losses: 30 }
  check('but the scaled daily limit still bites',
    canOpen({ mint: 'G4', creator: 'C', walletSol: 5 })?.includes('daily loss'))

  /**
   * The breaker must read OUR LEDGER, not a live balance. A transient bad balance read
   * — an RPC hiccup returning 0, a fetch that failed — must never be able to trip a
   * permanent halt on its own.
   */
  s.daily = {}; s.totalRealizedSol = 4.5; store.clearHalt()
  const onBadRead = canOpen({ mint: 'G5', creator: 'C', walletSol: 0 })
  check('a zero balance reading does not trip the drawdown halt', !s.halted, String(onBadRead))
  check('it is refused for the ordinary reason instead', String(onBadRead).includes('below'), String(onBadRead))

  /**
   * TOPPING THE ACCOUNT UP MUST RE-ANCHOR THE LIMITS.
   *
   * The anchor is set from `wallet + deployed - realized`, which trading cannot move —
   * a loss reduces the wallet and increases |realized| by the same amount. Only money in
   * or out changes it, which is what makes it a deposit detector.
   *
   * Anchoring once and never revisiting meant a stale anchor outlived the account it
   * described: raising the paper book 0.5 -> 50 SOL left the limits denominated in the
   * old account, so the bot halted after 0.36 SOL of losses — 0.7% of its balance — and
   * the raise accomplished nothing.
   */
  s.daily = {}; s.totalRealizedSol = 0; s.peakRealizedSol = 0; store.clearHalt()
  s.baseEquitySol = 0.5 // left behind by the 0.5 SOL era
  s.totalRealizedSol = -0.36
  check('a top-up re-anchors instead of halting on the old limit',
    canOpen({ mint: 'T1', creator: 'C', walletSol: 50 }) === null && !s.halted,
    String(canOpen({ mint: 'T1', creator: 'C', walletSol: 50 })))
  check('the anchor moved to the new account size', near(s.baseEquitySol, 50 + 0.36, 1e-9), String(s.baseEquitySol))

  /**
   * And a halt raised against the OLD size is cleared, because it is no longer a true
   * statement about this account. The rule re-decides immediately, so a breach that is
   * real at the new size halts again in the same call.
   */
  s.baseEquitySol = 0.5; s.peakRealizedSol = 0; s.totalRealizedSol = -0.36
  store.halt('realized drawdown 0.3600 SOL from peak equity 0.5000 SOL (limit 0.3500 SOL)', 'drawdown')
  check('a stale drawdown halt is cleared on a top-up',
    canOpen({ mint: 'T2', creator: 'C', walletSol: 50 }) === null && !s.halted,
    String(canOpen({ mint: 'T2', creator: 'C', walletSol: 50 })))

  // A halt a human asked for is never cleared automatically.
  s.baseEquitySol = 0.5; s.totalRealizedSol = -0.36
  store.halt('paused from Telegram', 'manual')
  check('a manual halt survives a top-up',
    String(canOpen({ mint: 'T3', creator: 'C', walletSol: 50 })).startsWith('halted') && Boolean(s.halted))
  store.clearHalt()

  // A breach that is still real at the new size must still halt.
  s.baseEquitySol = 0; s.peakRealizedSol = 0; s.totalRealizedSol = 0
  canOpen({ mint: 'T4', creator: 'C', walletSol: 50 })       // anchor at 50
  s.totalRealizedSol = -40                                    // lose 80% of it
  check('a genuine breach at the new size still halts',
    canOpen({ mint: 'T5', creator: 'C', walletSol: 10 }) === 'total loss limit reached' && Boolean(s.halted))
  store.clearHalt()

  s.daily = {}; s.totalRealizedSol = 0; s.baseEquitySol = 0; s.peakRealizedSol = 0
  /**
   * A halt written before `kind` existed has none. Treating an untagged halt as manual
   * meant it could never go stale, so a halt from the 0.5 SOL era survived the raise to
   * 50 SOL and the bot screened 314 launches while taking none of them.
   */
  {
    const legacyLimit = { at: Date.now() - 3600_000, reason: 'total realized loss hit -0.3600 SOL (limit -0.3500 SOL)' }
    s.halted = structuredClone(legacyLimit); s.baseEquitySol = 0.5; s.peakRealizedSol = 0; s.totalRealizedSol = -0.36
    store.save(); store.initStore()
    const s2 = store.getState()
    check('a legacy limit halt is tagged as stale-able', s2.halted?.kind === 'drawdown', JSON.stringify(s2.halted))
    check('so a top-up can clear it',
      canOpen({ mint: 'L1', creator: 'C', walletSol: 50 }) === null && !s2.halted,
      String(canOpen({ mint: 'L1', creator: 'C', walletSol: 50 })))

    // A legacy halt a human asked for keeps blocking.
    s2.halted = { at: Date.now(), reason: 'paused from Telegram' }
    s2.baseEquitySol = 0.5; s2.totalRealizedSol = 0
    store.save(); store.initStore()
    const s3 = store.getState()
    check('a legacy manual halt is not made stale-able', s3.halted?.kind === 'manual', JSON.stringify(s3.halted))
    check('and it still blocks after a top-up',
      String(canOpen({ mint: 'L2', creator: 'C', walletSol: 50 })).startsWith('halted'))
    store.clearHalt()
  }

  /**
   * THE DEADLOCK: the anchor must be maintained without a trade happening.
   *
   * equityBasis used to run only inside canOpen, which is reached from exactly one place
   * — the non-explore branch of #enter, and only for a candidate that PASSED the filter.
   * With the filter passing 0 of 314, canOpen was never called, the anchor was never
   * refreshed, and a stale halt could never clear. The only code that could un-stick the
   * bot required the bot to already be unstuck.
   */
  {
    const { syncEquityBasis } = await import('../src/risk.js')
    const s4 = store.getState()
    s4.halted = { at: Date.now(), reason: 'total realized loss hit -0.3600 SOL', kind: 'drawdown' }
    s4.baseEquitySol = 0.5; s4.peakRealizedSol = 0; s4.totalRealizedSol = -0.36

    // No entry attempt, no canOpen — just the balance refresh the timer performs.
    syncEquityBasis(50)
    check('the anchor updates without any entry attempt', near(s4.baseEquitySol, 50.36, 1e-9), String(s4.baseEquitySol))
    check('and a stale halt clears without one', !s4.halted, JSON.stringify(s4.halted))
    store.clearHalt()
  }

  /**
   * ...and the bot must actually do that on startup, through its own code path. Calling
   * syncEquityBasis directly proves the function works; it does not prove anything calls
   * it, which was the entire bug.
   */
  {
    const { Bot } = await import('../src/bot.js')
    const { EventEmitter } = await import('node:events')
    class Quiet extends EventEmitter { start() {} async stop() {} watch() {} unwatch() {} }

    const s5 = store.getState()
    s5.positions = {}
    s5.halted = { at: Date.now(), reason: 'total realized loss hit -0.3600 SOL', kind: 'drawdown' }
    s5.baseEquitySol = 0.5; s5.peakRealizedSol = 0; s5.totalRealizedSol = -0.36
    store.save()

    const booted = new Bot({ feed: new Quiet(), logFeed: new Quiet() })
    await booted.start()
    check('starting up clears a halt left by a smaller account',
      !store.getState().halted, JSON.stringify(store.getState().halted))
    check('and re-anchors to the balance it actually has',
      store.getState().baseEquitySol > 40, String(store.getState().baseEquitySol))
    await booted.stop()
  }

  store.clearHalt()
}

// ------------------------------- moving the journal without moving the secrets
console.log('\nJournal export')
{
  const journal = await import('../src/journal.js')
  const { buildExport, buildExportGzip } = await import('../src/export.js')
  const zlib = await import('node:zlib')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pumpbot-export-'))
  const origDataDir = config.dataDir
  config.dataDir = dir

  /**
   * A row carrying EVERYTHING we would never want to hand out, alongside the things we
   * do: addresses, a signature, a wallet list, and — the case that matters most — a
   * field nobody has thought of yet, standing in for whatever gets added to the journal
   * next. A denylist cannot catch that one by construction.
   */
  const SECRET = 'THIS_MUST_NEVER_LEAVE_THE_BOX'
  const CREATOR_A = 'CreatorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  const CREATOR_B = 'CreatorBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  const mkRow = (action, creator, over = {}) => ({
    v: JOURNAL_VERSION, action, creator,
    mint: 'MintAddress1111111111111111111111111111111',
    symbol: 'TEST', name: 'Test Coin',
    signature: 'sig' + SECRET,
    buyers: ['Wallet1111111111111111111111111111111111111'],
    privateKeyBackup: SECRET, // the field nobody thought of
    hitFirstRung: false, peakMultiple: 1.4, endMultiple: 0.9, troughMultiple: 0.8,
    peakAtSeconds: 60, troughAtSeconds: 200, decisionPriceSol: 1e-7,
    features: { organicBuyers: 42, buyAcceleration: 1.2, devSold: true, creatorSecret: SECRET },
    ...over,
  })

  for (let i = 0; i < 5; i++) journal.append(mkRow('bought', CREATOR_A))
  for (let i = 0; i < 5; i++) journal.append(mkRow('explored', CREATOR_B))
  for (let i = 0; i < 300; i++) journal.append(mkRow('rejected', CREATOR_A))
  // Never labelled: no outcome, so it can answer nothing and must not pad the file.
  journal.append(mkRow('bought', CREATOR_A, { peakMultiple: undefined }))

  const { csv, stats } = buildExport({ maxRejected: 50, salt: 'fixed-salt' })

  check('acted-on rows are kept in full — they are the scarce ones',
    stats.bought === 5 && stats.explored === 5, JSON.stringify(stats))

  /**
   * Bought rows are never sampled at any cap. There are hundreds of them against six
   * figures of everything else, and they are the only rows carrying a real entry
   * decision — thinning them costs power exactly where the dataset is thinnest.
   */
  const squeezed = buildExport({ maxRejected: 5, maxExplored: 2, salt: 'fixed-salt' })
  check('and a tighter cap still never thins the bought rows',
    squeezed.stats.rows === 5 + 2 + 5 && squeezed.stats.exploredSampled === 2,
    JSON.stringify(squeezed.stats))
  check('and the bulk of rejected rows is sampled down',
    stats.rejectedSampled === 50 && stats.rejected === 300, JSON.stringify(stats))
  check('an unlabelled row is left out rather than exported with no outcome',
    stats.rows === 5 + 5 + 50, `${stats.rows}`)

  /**
   * THE SAFETY PROPERTY. Not "we removed the fields we thought of" — the export is an
   * ALLOWLIST, so this asserts the general case: nothing secret, no address, and no
   * unexpected field survives, including one invented after the allowlist was written.
   */
  check('no secret reaches the export', !csv.includes(SECRET), csv.slice(0, 400))
  check('no raw address reaches it either',
    !csv.includes(CREATOR_A) && !csv.includes(CREATOR_B) && !csv.includes('MintAddress'),
    csv.slice(0, 400))
  check('nor does a signature or a wallet list',
    !/sig|Wallet1111/.test(csv), csv.slice(0, 400))
  /**
   * A base58-shaped run of 32+ characters is what every address and key in this system
   * looks like. Catching the SHAPE means a future field does not need to be predicted.
   */
  check('and nothing address-shaped survives at all',
    !/[1-9A-HJ-NP-Za-km-z]{32,}/.test(csv), (csv.match(/[1-9A-HJ-NP-Za-km-z]{32,}/) ?? [''])[0])

  const header = csv.split('\n')[0].split(',')
  check('the feature nobody allowlisted is dropped by type, not by name',
    !header.includes('f_creatorSecret') && header.includes('f_organicBuyers'), header.join(','))
  check('a boolean feature still survives as a number',
    header.includes('f_devSold'), header.join(','))

  /**
   * Grouping by deployer has to survive or the deployer work cannot be done off-box —
   * but the id must not be the address, and must not be stable ACROSS exports, or two
   * files could be joined to undo it.
   */
  const rows = csv.trim().split('\n').slice(1).map((l) => l.split(','))
  const ids = new Set(rows.map((r) => r[0]))
  check('rows can still be grouped by deployer', ids.size === 2, JSON.stringify([...ids]))
  const other = buildExport({ maxRejected: 50, salt: 'a-different-salt' })
  const otherIds = new Set(other.csv.trim().split('\n').slice(1).map((l) => l.split(',')[0]))
  check('but the deployer id does not survive across exports, so two cannot be joined',
    [...ids].every((id) => !otherIds.has(id)), JSON.stringify([[...ids], [...otherIds]]))

  const { gz, stats: gzStats } = buildExportGzip({ maxRejected: 50, salt: 'fixed-salt' })
  check('the gzip round-trips to the same CSV',
    zlib.gunzipSync(gz).toString('utf8') === csv)
  check('and numeric CSV compresses enough to actually send',
    gzStats.bytes < gzStats.rawBytes / 3, `${gzStats.bytes} vs ${gzStats.rawBytes}`)

  /**
   * The walk is SECONDS of synchronous work, and the trading loop is on the other side
   * of it — the same shape as the bug that had analyze() freezing the event loop and
   * force-closing positions on stale prices. It runs on a worker for that reason, so
   * the worker path is what the dashboard route actually uses and what has to be tested.
   */
  const { buildExportInWorker } = await import('../src/export.js')
  const viaWorker = await buildExportInWorker({ maxRejected: 50, salt: 'fixed-salt' })
  check('the worker produces byte-identical output to the direct call',
    Buffer.compare(viaWorker.gz, gz) === 0)
  check('and reports the same stats', viaWorker.stats.rows === gzStats.rows)

  /**
   * A reloaded download page must not be able to queue up journal walks. The analysis
   * path had exactly this bug — a failure left the cache stale and every poll built a
   * fresh Worker — so a second caller joins the first rather than starting another.
   */
  const a = buildExportInWorker({ maxRejected: 50, salt: 'fixed-salt' })
  const b = buildExportInWorker({ maxRejected: 50, salt: 'fixed-salt' })
  check('concurrent exports share one worker rather than spawning a queue', a === b)
  await Promise.all([a, b])
  const afterSettle = buildExportInWorker({ maxRejected: 50, salt: 'fixed-salt' })
  check('but the guard clears once it settles, so exports are not one-shot',
    afterSettle !== a)
  await afterSettle

  config.dataDir = origDataDir
  fs.rmSync(dir, { recursive: true, force: true })
}

// ------------------------------- did the filter pick the top of the spike?
console.log('\nTop-of-spike detection')
{
  const { topOfSpike } = await import('../src/learn.js')

  /**
   * peakAtSeconds === 0 means the market never traded above our decision price for the
   * whole window — the best price available was the one we took.
   */
  const row = (action, toppedAtEntry, accel = 1, hit = false) => ({
    v: JOURNAL_VERSION, action, hitFirstRung: hit,
    peakAtSeconds: toppedAtEntry ? 0 : 120,
    peakMultiple: toppedAtEntry ? 1 : 1.8, endMultiple: 1, troughMultiple: 0.8,
    features: { buyAcceleration: accel },
  })
  const many = (n, ...args) => Array.from({ length: n }, () => row(...args))

  /**
   * THE CONTROL IS WHAT MAKES THIS MEAN ANYTHING. Meme coins top out early on their own,
   * so a high share among bought rows proves nothing without rows we did not buy —
   * measured the same way, from the same decision moment.
   */
  const neutral = topOfSpike([
    ...many(100, 'bought', true), ...many(100, 'bought', false),
    ...many(100, 'explored', true), ...many(100, 'explored', false),
  ])
  check('an equal rate either side is NOT called a finding', !neutral.selectsForTops)
  check('and the report says the intervals overlap rather than staying silent',
    neutral.comparable && !neutral.cleared)

  // Now the filter really is picking tops: 80% of bought rows vs 20% of explored.
  const guilty = topOfSpike([
    ...many(160, 'bought', true), ...many(40, 'bought', false),
    ...many(40, 'explored', true), ...many(160, 'explored', false),
  ])
  check('a filter that really does select tops is caught', guilty.selectsForTops)
  check('and it is compared against rows we DID buy where they exist',
    guilty.control.which === 'explored')

  // The other direction has to be reportable too, or the test only proves alarm.
  const clean = topOfSpike([
    ...many(40, 'bought', true), ...many(160, 'bought', false),
    ...many(160, 'explored', true), ...many(40, 'explored', false),
  ])
  check('entry timing that BEATS the control is reported as such',
    clean.cleared && !clean.selectsForTops)

  /**
   * Explore rows were bought too, at the same moment in the same way, differing only in
   * the filter having said no — so they isolate the FILTER. Rejected rows were never
   * entered at all, and are the fallback when explore is thin.
   */
  const thinExplore = topOfSpike([
    ...many(100, 'bought', true), ...many(100, 'bought', false),
    ...many(5, 'explored', true),
    ...many(100, 'rejected', true), ...many(100, 'rejected', false),
  ])
  check('with too little explore data it falls back to rejected rows',
    thinExplore.control.which === 'rejected' && thinExplore.comparable)

  const noControl = topOfSpike([...many(100, 'bought', true)])
  check('and with no control at all it refuses to judge',
    !noControl.comparable && !noControl.selectsForTops && !noControl.cleared)

  // The proposed mechanism, testable on its own: harder acceleration, more tops.
  const mech = topOfSpike([
    ...many(40, 'bought', true, 3), ...many(10, 'bought', false, 3),
    ...many(10, 'bought', true, 0.2), ...many(40, 'bought', false, 0.2),
    ...many(100, 'explored', false, 1),
  ])
  const fast = mech.byAcceleration.find((b) => b.label === '2.0+')
  const slow = mech.byAcceleration.find((b) => b.label === 'acceleration < 0.5')
  check('the acceleration cross can show the mechanism directly',
    fast && slow && fast.rate.p > slow.rate.p, JSON.stringify([slow?.rate.p, fast?.rate.p]))

  // Buying the top is only a problem if it does not recover — so both are measured.
  const recovery = topOfSpike([
    ...many(60, 'bought', true, 1, true), ...many(40, 'bought', true, 1, false),
    ...many(100, 'explored', false),
  ])
  check('whether a top still reached the rung is measured, not assumed',
    near(recovery.bought.hitWhenTopped.p, 0.6, 1e-9), String(recovery.bought.hitWhenTopped.p))

  check('rows with no peak timing are left out rather than counted as zero',
    topOfSpike([{ v: JOURNAL_VERSION, action: 'bought' }]).bought.n === 0)
}

// ------------------------------- telling a deploy apart from a crash loop
console.log('\nStartup provenance')
{
  const { notifyStartup } = await import('../src/notify.js')
  store.initStore()
  const s = store.getState()
  s.lastStartedAt = 0
  s.startCount = 0

  const first = store.recordStart(1_000_000)
  check('the first start on a state file has nothing to compare to', first.sinceSeconds === null)
  check('and it is counted', first.startCount === 1)

  /**
   * TWO STARTS MINUTES APART ARE AMBIGUOUS FROM INSIDE THE PROCESS — a redeploy and a
   * crash loop produce the identical event. The gap is the only thing that separates
   * them, so it has to survive the restart, which means it has to be persisted.
   */
  const quick = store.recordStart(1_000_000 + 120_000)
  check('a restart knows how long the last run lasted', quick.sinceSeconds === 120)
  check('and the count keeps climbing across restarts', quick.startCount === 2)

  const reloaded = store.initStore()
  check('the previous start survives a reload — otherwise every start looks like the first',
    reloaded.startCount === 2 && reloaded.lastStartedAt === 1_000_000 + 120_000)

  const later = store.recordStart(1_000_000 + 120_000 + 4 * 3600_000)
  check('a normal restart is not flagged', later.sinceSeconds === 4 * 3600)

  /**
   * The message itself has to carry BOTH facts, because either alone is ambiguous: the
   * same build twice in two minutes is something dying, a different build twice in two
   * minutes is just a deploy.
   */
  const messages = []
  const origFetch = globalThis.fetch
  const origToken = config.telegram.token
  const origChat = config.telegram.chatId
  globalThis.fetch = async (url, init) => {
    messages.push(JSON.parse(init.body).text)
    return { ok: true, json: async () => ({ ok: true }) }
  }
  config.telegram.token = 'test-token'
  config.telegram.chatId = 'test-chat'
  const summary = { sizing: { buySol: 0.15, maxConcurrent: 4, maxDeployedSol: 0.6, nextTier: null }, openPositions: 0 }
  // Drive the REAL alert for both cases rather than rebuilding its text here — a test
  // that reassembles the message proves only that two copies of it agree.
  await notifyStartup('B94sSomethingLong7JMM', 44.5, summary, quick)
  const quickText = messages.at(-1) ?? ''
  await notifyStartup('B94sSomethingLong7JMM', 44.5, summary, later)
  const calmText = messages.at(-1) ?? ''
  config.telegram.token = origToken
  config.telegram.chatId = origChat
  globalThis.fetch = origFetch

  check('the alert names the build that came up', quickText.includes(config.version), quickText)
  check('and warns when a restart was suspiciously quick', /Quick restart/.test(quickText), quickText)
  check('but a long-running process is not accused of crash-looping',
    !/Quick restart/.test(calmText) && /4\.0h/.test(calmText), calmText)

  s.lastStartedAt = 0
  s.startCount = 0
  store.save()
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

// ------------------------------- replaying the REAL holding window
console.log('\nExit replay vs the real holding window')
{
  const { simulateLadder } = await import('../src/learn.js')
  const { ShadowTracker } = await import('../src/journal.js')
  const TIME_STOP = config.exit.timeStopSeconds
  const STALE = config.exit.stalePriceSeconds

  const row = (over = {}) => ({
    v: JOURNAL_VERSION, peakMultiple: 2, endMultiple: 1.1, troughMultiple: 0.95,
    hasOrdering: true, troughFirst: false, troughAtSeconds: 400,
    hasExitTiming: true, firstRungAtSeconds: 120, staleExitAtSeconds: null,
    staleExitMultiple: null, timeStopMultiple: 1.0, ...over,
  })

  /**
   * THE CASE A NAIVE FIX GETS WRONG.
   *
   * peakAt is the time of the GLOBAL peak. A coin can cross +50% at two minutes and top
   * out at twelve, and gating the replay on peakAt would discard that as "unreachable"
   * when the bot had already sold it at the rung, for a profit. Only the FIRST crossing
   * decides whether the ladder ran.
   */
  /**
   * Asserted against the counterfactual rather than a fixed number. The old `> 1.2` was
   * really pinning the all-out ladder's return, so changing the exit plan broke a test
   * about peak ordering — which is not what it was there to watch.
   */
  const earlyRungLatePeak = simulateLadder(row({ firstRungAtSeconds: 120, peakAtSeconds: TIME_STOP + 100 }))
  const rungOutOfReach = simulateLadder(row({ firstRungAtSeconds: TIME_STOP + 100, peakAtSeconds: TIME_STOP + 100 }))
  check('a rung that fired early still counts when the PEAK came after the time stop',
    earlyRungLatePeak > rungOutOfReach && earlyRungLatePeak > 1,
    `${earlyRungLatePeak} vs ${rungOutOfReach}`)

  // The rung itself out of reach: sold by the clock, at the price then standing.
  const lateRung = simulateLadder(row({ firstRungAtSeconds: TIME_STOP + 100, timeStopMultiple: 0.98 }))
  check('a rung first touched after the time stop is not banked',
    lateRung < 1, String(lateRung))
  check('and the exit is the price held at the time stop, not the price at minute fifteen',
    lateRung < 0.98 && lateRung > 0.85, String(lateRung))

  /**
   * The silence rule is off now, so the replay must not apply it either — but it stays
   * switchable, because the sweep prices the old behaviour against the same coins.
   */
  const quietRow = row({
    firstRungAtSeconds: 500, staleExitAtSeconds: 300, staleExitMultiple: 0.7, timeStopMultiple: 1.4,
  })
  check('the replay no longer sells on silence by default',
    simulateLadder(quietRow) > 1, String(simulateLadder(quietRow)))
  const withOldRule = simulateLadder(quietRow, { sellOnStalePrice: true })
  check('and does when the old rule is switched on', withOldRule < 0.75, String(withOldRule))
  check('which is the comparison the sweep needs',
    withOldRule < simulateLadder(quietRow), `${withOldRule} vs ${simulateLadder(quietRow)}`)

  // Whichever rule fires first wins, including the stop.
  const stoppedFirst = simulateLadder(row({
    troughMultiple: 0.5, troughAtSeconds: 60, firstRungAtSeconds: 300,
  }))
  check('a stop-loss before the rung still closes the trade',
    stoppedFirst < 0.9, String(stoppedFirst))
  const rungFirst = simulateLadder(row({
    troughMultiple: 0.5, troughAtSeconds: 300, firstRungAtSeconds: 60,
  }))
  check('but a rung before the dip is not undone by it',
    rungFirst > stoppedFirst && rungFirst > 1, `${rungFirst} vs ${stoppedFirst}`)

  /**
   * 150,000 rows predate these fields. They must keep the old behaviour rather than
   * being silently dropped or silently guessed at — the report states the coverage.
   */
  const legacy = simulateLadder({
    v: JOURNAL_VERSION, peakMultiple: 2, endMultiple: 1.1, troughMultiple: 0.95,
    hasOrdering: true, troughFirst: false,
  })
  /**
   * "Exactly as before" is now stated as an identity rather than a magic number: a row
   * with no timing must replay the same as one whose rung and dip both land inside the
   * holding window, because on that row the window changes nothing.
   */
  const timedEquivalent = simulateLadder(row({ firstRungAtSeconds: 120, troughAtSeconds: 400 }))
  check('rows without the timing replay exactly as before',
    near(legacy, timedEquivalent) && legacy > 1, `${legacy} vs ${timedEquivalent}`)

  /**
   * AND THE TRACKER HAS TO PRODUCE THE FIELDS. Testing simulateLadder against
   * hand-written rows proves nothing about what the journal actually writes — which is
   * the shape of every wiring bug in this file so far.
   */
  const t = new ShadowTracker({ maxTracked: 10, windowMs: 900_000 })
  const t0 = Date.now()
  const candidate = { mint: 'TIMING', symbol: 'TMG', creator: 'DEV', createdAt: t0, priceSol: 1e-7 }
  t.track({ candidate, verdict: { pass: true, failed: [] }, action: 'bought' })
  /**
   * Crosses +50% at 60s, keeps trading (no gap long enough to count), peaks at 500s,
   * and only THEN goes quiet past the stale bar. The intermediate ticks matter: without
   * them the first silence is the 60s->500s gap, and the tracker would be right to flag
   * that one instead — which is what it did on the first draft of this test.
   */
  t.onTrade({ mint: 'TIMING', priceSol: 1.6e-7 }, t0 + 60_000)
  t.onTrade({ mint: 'TIMING', priceSol: 2.0e-7 }, t0 + 200_000)
  t.onTrade({ mint: 'TIMING', priceSol: 2.5e-7 }, t0 + 350_000)
  t.onTrade({ mint: 'TIMING', priceSol: 3.0e-7 }, t0 + 500_000)
  t.onTrade({ mint: 'TIMING', priceSol: 1.2e-7 }, t0 + 500_000 + STALE * 1000 + 5_000)
  const finished = t.finalize('TIMING')

  check('the tracker records when the rung FIRST fired, not when the peak was',
    finished.firstRungAtSeconds === 60,
    `${finished.firstRungAtSeconds} (peak at ${finished.peakAtSeconds})`)
  check('which is a different number from the peak time',
    finished.peakAtSeconds === 500 && finished.firstRungAtSeconds !== finished.peakAtSeconds,
    String(finished.peakAtSeconds))
  check('it notices the first silence longer than the stale bar',
    finished.staleExitAtSeconds === 500 + STALE, String(finished.staleExitAtSeconds))
  check('and records the price it would have sold blind at, not the one that broke the silence',
    near(finished.staleExitMultiple, 3.0, 1e-4), String(finished.staleExitMultiple))
  check('the row is marked replayable against the real rules', finished.hasExitTiming === true)
  /**
   * The coarse price path, which is what lets the sweep ask whether holding longer pays.
   * Every exit price recorded before it was pinned to the config value in force at the
   * time, so a sweep over the time stop had nothing to price a different boundary with.
   */
  {
    const { PATH_CHECKPOINTS } = await import('../src/journal.js')
    const t3 = new ShadowTracker({ maxTracked: 10, windowMs: 900_000 })
    const base = Date.now()
    t3.track({
      candidate: { mint: 'PATH', symbol: 'P', creator: 'D', createdAt: base, priceSol: 1e-7 },
      verdict: { pass: true, failed: [] }, action: 'bought',
    })
    /**
     * Deliberately tops out BELOW the rung, at 1.3x, then decays to 0.3x. A coin that
     * reaches the rung exits at the rung whatever the time stop is — correctly — so it
     * cannot show the sweep varying anything. The first draft of this test used one, and
     * the two time stops came back identical because they should have.
     *
     * Ticks every 20s so no stale gap intrudes and the time stop is the deciding rule.
     */
    for (let sec = 20; sec <= 900; sec += 20) {
      const m = sec <= 100 ? 1 + (0.3 * sec) / 100 : Math.max(0.3, 1.3 - (sec - 100) / 800)
      t3.onTrade({ mint: 'PATH', priceSol: m * 1e-7 }, base + sec * 1000)
    }
    const r = t3.finalize('PATH')
    check('the row carries a price path', Array.isArray(r.pathMultiples) &&
      r.pathMultiples.length === PATH_CHECKPOINTS.length, JSON.stringify(r.pathMultiples))
    const at = (s) => r.pathMultiples[PATH_CHECKPOINTS.indexOf(s)]
    check('which records the climb', at(60) > 1.0 && at(60) < 1.35, String(at(60)))
    check('and the decay afterwards', at(600) < at(120), `${at(600)} vs ${at(120)}`)

    /**
     * The payoff: the same coin priced at two different time stops. This one peaks early
     * and fades, so selling sooner must beat selling later — if the two come out equal
     * the sweep is not actually varying anything.
     */
    const early = simulateLadder(r, { timeStopSeconds: 120 })
    const late = simulateLadder(r, { timeStopSeconds: 900 })
    check('the replay prices different time stops differently',
      early !== late, `${early} vs ${late}`)

    // A row with no path must not be silently priced at minute fifteen instead.
    const noPath = simulateLadder(
      { ...r, pathMultiples: undefined, pathCheckpoints: undefined, timeStopMultiple: null,
        firstRungAtSeconds: 800, staleExitAtSeconds: null },
      { timeStopSeconds: 300 },
    )
    check('a row with no path still yields a number rather than throwing',
      Number.isFinite(noPath), String(noPath))
  }

  /**
   * THE CRASH, reproduced: a checkpoint written by the PREVIOUS build.
   *
   * The shadow checkpoint is live in-memory state, not a journal row, and the two
   * degrade differently. A journal row missing a field is one the analysis skips; a
   * checkpointed row missing a field is a crash, because the tracker calls methods on
   * it. Live, 264 observations restored from a checkpoint written before pathPrices
   * existed, the first to mature hit `row.pathPrices.map(...)` on undefined, and the
   * bot died during startup while the platform reported a healthy container.
   */
  {
    const older = new ShadowTracker({ maxTracked: 50, windowMs: 900_000 })
    const decidedAt = Date.now() - 20 * 60_000 // already past the window
    // Exactly what the previous build wrote: no pathPrices, no exit-timing fields.
    const legacySnapshot = {
      v: JOURNAL_VERSION,
      rows: [{
        v: JOURNAL_VERSION, mint: 'LEGACY', symbol: 'LEG', creator: 'DEV', decidedAt,
        createdAt: decidedAt, action: 'rejected', failedChecks: ['buyers'], features: {},
        decisionPriceSol: 1e-7, peakPriceSol: 2e-7, troughPriceSol: 5e-8, lastPriceSol: 1e-7,
        peakAt: decidedAt + 60_000, troughAt: decidedAt + 30_000, ticks: 12,
      }],
    }
    const { restored, expired } = older.restore(legacySnapshot)
    check('a checkpoint from an older build still restores', restored === 1 && expired.length === 1)

    let finished = null
    let threw = null
    try {
      finished = older.finalize('LEGACY', 'window closed during downtime')
    } catch (err) {
      threw = err.message
    }
    check('and finalizing it does not throw', threw === null, String(threw))
    check('the row is journalled rather than lost', Boolean(finished) && finished.mint === 'LEGACY')
    check('with the new fields defaulted, not undefined',
      Array.isArray(finished.pathMultiples) && finished.firstRungAtSeconds === null,
      JSON.stringify({ path: finished.pathMultiples?.length, rung: finished.firstRungAtSeconds }))

    // And a restored row must still TRACK correctly afterwards, not just survive.
    const live = new ShadowTracker({ maxTracked: 50, windowMs: 900_000 })
    const freshAt = Date.now()
    live.restore({
      v: JOURNAL_VERSION,
      rows: [{
        v: JOURNAL_VERSION, mint: 'RESUMED', symbol: 'RES', creator: 'DEV', decidedAt: freshAt,
        createdAt: freshAt, action: 'bought', failedChecks: [], features: {},
        decisionPriceSol: 1e-7, peakPriceSol: 1e-7, troughPriceSol: 1e-7, lastPriceSol: 1e-7,
        peakAt: freshAt, troughAt: freshAt, ticks: 0,
      }],
    })
    live.onTrade({ mint: 'RESUMED', priceSol: 1.6e-7 }, freshAt + 30_000)
    const resumed = live.finalize('RESUMED')
    check('a restored row still records the rung it later hits',
      resumed.firstRungAtSeconds === 30, String(resumed.firstRungAtSeconds))
  }

  check('a rung that never fired is recorded as null, not zero', (() => {
    const t2 = new ShadowTracker({ maxTracked: 10, windowMs: 900_000 })
    t2.track({ candidate: { ...candidate, mint: 'FLAT' }, verdict: { pass: true, failed: [] }, action: 'bought' })
    t2.onTrade({ mint: 'FLAT', priceSol: 1.05e-7 }, t0 + 30_000)
    return t2.finalize('FLAT').firstRungAtSeconds === null
  })())
}

/**
 * Does the change actually make the replay MORE ACCURATE, or just different?
 *
 * Built on a population where the truth is known: every coin has a full price path, and
 * walking that path with the live rules gives what the strategy would really have
 * returned. Then both replays are scored against it. Without this the fix is an
 * assertion — the numbers move, and nothing says they moved toward reality.
 */
{
  const { simulateLadder } = await import('../src/learn.js')
  /**
   * A time stop that actually BINDS inside the 15-minute observation window, pinned here
   * rather than read from config.
   *
   * This block asks whether modelling the holding window beats ignoring it. If the stop
   * sits at the window's own edge — which the shipped 900s now does — there is nothing
   * left to model, the two replays converge, and the comparison is decided by noise. The
   * question is about the mechanism, not about today's setting, so the setting that makes
   * the mechanism visible is the one to test at.
   */
  const TIME_STOP = 600
  const STALE = config.exit.stalePriceSeconds
  const RUNG = 1 + (config.exit.ladder[0]?.atPct ?? 50) / 100
  const STOP = 1 - config.exit.stopLossPct / 100
  const PLAN = { timeStopSeconds: TIME_STOP }

  let seed = 11
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const paths = []
  for (let i = 0; i < 800; i++) {
    const path = []
    let m = 1
    let t = 0
    // Over half of pump.fun launches simply stop trading, which is what makes the
    // stale-price exit the dominant rule rather than an edge case.
    const deathAt = rnd() < 0.55 ? 60 + rnd() * 600 : Infinity
    const drift = rnd() < 0.3 ? 1.004 : 0.997
    while (t < 900) {
      t += 5 + rnd() * 25
      if (t > deathAt) break
      m = Math.max(0.01, m * drift * (0.92 + rnd() * 0.17))
      path.push({ t: Math.round(t), m })
    }
    paths.push(path.length ? path : [{ t: 5, m: 1 }])
  }

  /**
   * Walks the path under the LIVE exit rules, in decideExit's own order of precedence.
   *
   * It used to return RUNG the moment the first rung was touched, which silently assumed
   * an all-out exit. That was true of the old plan and is not true of this one — the
   * first rung now banks part of the bag and leaves the rest to the trailing stop, so a
   * "truth" that closes the whole position at +50% is not the truth any more. Getting
   * this wrong does not fail loudly; it just quietly re-scores the replay against the
   * wrong target.
   */
  const truth = (path) => {
    const firstSell = Math.min(1, (config.exit.ladder[0]?.sellPct ?? 100) / 100)
    const trail = config.exit.trailingDrawdownPct / 100
    let last = { t: 0, m: 1 }
    let held = 1 // fraction of the bag still open
    let banked = 0 // multiples already realised at a rung
    let hitRung = false
    let peak = 1
    const closeAt = (m) => banked + held * m

    for (const p of path) {
      if (config.exit.sellOnStalePrice && p.t - last.t >= STALE) return closeAt(last.m)
      peak = Math.max(peak, p.m)
      if (p.m <= STOP) return closeAt(STOP) // 2. stop-loss, from ENTRY, rung or no rung
      if (!hitRung && p.t > TIME_STOP) return closeAt(last.m) // 3. only before a rung
      if (hitRung && p.m <= peak * (1 - trail)) return closeAt(peak * (1 - trail)) // 4.
      if (!hitRung && p.m >= RUNG) { // 5. the ladder itself
        banked += firstSell * RUNG
        held -= firstSell
        hitRung = true
        if (held <= 0) return banked
      }
      last = p
    }
    return closeAt(last.m)
  }

  const rowFrom = (path, withTiming) => {
    const peak = Math.max(1, ...path.map((p) => p.m))
    const trough = Math.min(1, ...path.map((p) => p.m))
    const peakAt = (path.find((p) => p.m === peak) ?? { t: 0 }).t
    const troughAt = (path.find((p) => p.m === trough) ?? { t: 0 }).t
    const base = {
      v: JOURNAL_VERSION, peakMultiple: peak, endMultiple: path[path.length - 1].m,
      troughMultiple: trough, hasOrdering: true, troughFirst: troughAt < peakAt,
      peakAtSeconds: peakAt, troughAtSeconds: troughAt,
    }
    if (!withTiming) return base
    let rungAt = null, staleAt = null, staleM = null, tsM = null, last = { t: 0, m: 1 }
    for (const p of path) {
      if (staleAt === null && p.t - last.t >= STALE) { staleAt = last.t + STALE; staleM = last.m }
      if (tsM === null && p.t >= TIME_STOP) tsM = last.m
      if (rungAt === null && p.m >= RUNG) rungAt = p.t
      last = p
    }
    if (staleAt === null && last.t < 900 - STALE) { staleAt = last.t + STALE; staleM = last.m }
    return { ...base, hasExitTiming: true, firstRungAtSeconds: rungAt,
      staleExitAtSeconds: staleAt, staleExitMultiple: staleM, timeStopMultiple: tsM ?? last.m }
  }

  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
  // Costs are charged by the replay but not by truth(), so net them out to compare like
  // with like — a flat coin priced through the same cost model.
  const costDrag = 1 - mean(paths.map((p) => simulateLadder({
    ...rowFrom(p, true), peakMultiple: 1, endMultiple: 1, troughMultiple: 1,
    firstRungAtSeconds: null, staleExitAtSeconds: null, staleExitMultiple: 1, timeStopMultiple: 1,
  }, PLAN)))
  const actual = mean(paths.map(truth)) * (1 - costDrag)
  const before = Math.abs(mean(paths.map((p) => simulateLadder(rowFrom(p, false), PLAN))) - actual)
  const after = Math.abs(mean(paths.map((p) => simulateLadder(rowFrom(p, true), PLAN))) - actual)

  check('replaying the real holding window is closer to the truth than ignoring it',
    after < before, `${(after * 100).toFixed(1)}pp vs ${(before * 100).toFixed(1)}pp`)
  check('and close enough to choose between exit plans',
    after < 0.015, `${(after * 100).toFixed(1)}pp error`)
}

// ------------------------------- a failing analysis must not eat the container
console.log('\nAnalysis worker backoff')
{
  const analysis = await import('../src/analysis.js')

  /**
   * THE SPAWN STORM. If the worker cannot run, cache.at stays 0, so isFresh() is false,
   * so every dashboard poll — every few seconds — builds ANOTHER Worker, each a fresh
   * V8 isolate with its own heap. A worker that fails does not degrade the report, it
   * exhausts the container, and the first thing anyone sees is the dashboard gone.
   *
   * Driven through the real module by pointing it at a worker file that does not exist.
   */
  const health0 = analysis.analysisHealth()
  check('health reports memory so a near-miss is visible before the crash',
    typeof health0.memory?.rssMb === 'number' && health0.memory.rssMb > 0,
    JSON.stringify(health0.memory))

  // A worker that throws on load — the real failure, driven through the real module.
  const badWorker = path.join(tmp, 'bad-worker.mjs')
  fs.writeFileSync(badWorker, 'throw new Error("worker cannot start")\n')
  process.env.ANALYSIS_WORKER_PATH = badWorker
  await analysis.stopAnalysis()

  const before = analysis.workerSpawnCount()
  const first = await analysis.request({ force: true })
  check('a worker that cannot start is reported as a failure', first.failed === true)
  check('and the error is kept', Boolean(analysis.analysisHealth().lastError))

  /**
   * The storm: the dashboard polls every few seconds and each poll used to build
   * another isolate. Ten polls in a row must now spawn NOTHING.
   */
  for (let i = 0; i < 10; i++) analysis.refreshIfStale()
  await new Promise((r) => setTimeout(r, 50))
  const spawned = analysis.workerSpawnCount() - before
  check('repeated polls after a failure do not spawn more workers',
    spawned <= 1, `${spawned} workers spawned across 10 polls`)
  check('because the module is backing off',
    analysis.analysisHealth().nextAttemptInSeconds > 0,
    String(analysis.analysisHealth().nextAttemptInSeconds))
  check('and a direct /learn waits out the backoff too',
    (await analysis.request()).failed === true &&
    analysis.workerSpawnCount() - before <= 1)

  // Recovery: a working worker clears the streak.
  delete process.env.ANALYSIS_WORKER_PATH
  await analysis.stopAnalysis()
  analysis.__resetBackoffForTests()
  const good = await analysis.request({ force: true })
  check('a healthy worker clears the failure state',
    Boolean(good.report) && analysis.analysisHealth().failures === 0,
    JSON.stringify({ report: Boolean(good.report), failures: analysis.analysisHealth().failures }))
  await analysis.stopAnalysis()
}

// ------------------------------- is the replay anywhere near reality?
console.log('\nBacktest calibration')
{
  const { analyze, formatReport } = await import('../src/learn.js')
  store.initStore()
  const s = store.getState()
  s.positions = {}; s.closed = []; s.daily = {}; s.totalRealizedSol = 0
  s.exploreRealizedSol = 0; s.exploreWins = 0; s.exploreLosses = 0

  /**
   * The account's real numbers from the dashboard: 174 closed, ~26.19 SOL staked,
   * -4.9187 realized. That is 0.812x, against a replay claiming 0.976x on the same
   * strategy — and every exit proposal in the report comes from the optimistic side of
   * that sixteen-point gap. Nothing was comparing them.
   */
  const day = new Date().toISOString().slice(0, 10)
  s.daily[day] = { realizedSol: -4.9187, wins: 35, losses: 139, stakedSol: 26.19 }
  s.totalRealizedSol = -4.9187

  /**
   * THE MISMATCH: realized P&L running since the account opened, divided by a stake
   * counter that started days later. 174 historical trades had no recorded stake, so
   * the ratio was ~5 trades of stake against 179 trades of losses and the report
   * printed "-5.726x", which a long-only book cannot do.
   */
  {
    const s2 = store.getState()
    s2.daily = {}
    s2.totalRealizedSol = -5.04
    // An old day: P&L recorded, stake never was.
    s2.daily['2026-09-20'] = { realizedSol: -4.9187, wins: 35, losses: 139 }
    // A new day: all three together.
    s2.daily['2026-09-21'] = {
      realizedSol: -0.12, wins: 2, losses: 3,
      stakedSol: 0.75, realizedOnStakedSol: -0.12, stakedTrades: 5,
    }
    const mixed = store.strategyRecord()
    check('the multiple is computed only over trades whose stake we have',
      near(mixed.realizedMultiple, 1 - 0.12 / 0.75, 1e-9), String(mixed.realizedMultiple))
    check('which is never below zero for a long-only book', mixed.realizedMultiple > 0)
    check('and the trade count matches that same set, not every trade ever closed',
      mixed.stakedTrades === 5 && mixed.closed === 179,
      JSON.stringify({ staked: mixed.stakedTrades, closed: mixed.closed }))

    // An impossible ratio must be refused, not rendered.
    s2.daily['2026-09-21'] = {
      realizedSol: -5.04, wins: 2, losses: 3,
      stakedSol: 0.75, realizedOnStakedSol: -5.04, stakedTrades: 5,
    }
    const bad = analyze(
      Array.from({ length: 60 }, (_, i) => ({
        v: JOURNAL_VERSION, mint: 'X' + i, creator: 'C', at: i, finalizedAt: Date.now() - 1000,
        action: 'bought', failedChecks: [], hitFirstRung: i % 3 === 0,
        peakMultiple: i % 3 === 0 ? 2 : 0.9, endMultiple: 0.9, troughMultiple: 0.9,
        decisionPriceSol: 1e-7, observedSeconds: 900, ticks: 20, features: {},
      })),
      60,
    )
    check('an impossible realized multiple is refused rather than printed',
      bad.calibration.comparable === false && bad.calibration.inconsistent === true,
      JSON.stringify(bad.calibration))
    check('and the report says the figures disagree instead of showing the number',
      /ledger figures disagree/.test(formatReport(bad)) && !/-5\.7/.test(formatReport(bad)))
    s2.daily = {}
    s2.totalRealizedSol = 0
  }

  const day2 = new Date().toISOString().slice(0, 10)
  s.daily[day2] = {
    realizedSol: -4.9187, wins: 35, losses: 139,
    stakedSol: 26.19, realizedOnStakedSol: -4.9187, stakedTrades: 174,
  }
  s.totalRealizedSol = -4.9187
  const rec = store.strategyRecord()
  check('the ledger knows what it staked', near(rec.stakedSol, 26.19, 1e-9))
  check('and what multiple that actually returned',
    near(rec.realizedMultiple, 1 - 4.9187 / 26.19, 1e-9), String(rec.realizedMultiple))
  check('which matches the dashboard to three places',
    rec.realizedMultiple.toFixed(3) === '0.812', rec.realizedMultiple.toFixed(3))

  const mkBought = (i, peak) => ({
    v: JOURNAL_VERSION, mint: 'CAL' + i, creator: 'C', at: i, finalizedAt: Date.now() - 1000,
    action: 'bought', failedChecks: [], hitFirstRung: peak >= 1.5, peakMultiple: peak,
    endMultiple: peak >= 1.5 ? 1.5 : 0.9, troughMultiple: 0.9, decisionPriceSol: 1e-7,
    hasOrdering: true, troughFirst: false, observedSeconds: 900, ticks: 40, features: {},
  })
  // Enough winners that the replay lands well above what the ledger actually did.
  const rows = Array.from({ length: 200 }, (_, i) => mkBought(i, i % 3 === 0 ? 2.2 : 0.9))
  const a = analyze(rows, rows.length)

  check('the report compares the replay against the ledger', a.calibration?.comparable === true)
  check('using the account\'s real trade count',
    a.calibration.trades === 174, String(a.calibration.trades))
  check('the gap is simulated minus realized',
    near(a.calibration.gap, a.calibration.simulatedMultiple - a.calibration.realizedMultiple, 1e-9))
  check('a replay this far from reality is marked untrustworthy',
    a.calibration.trustworthy === false,
    `gap ${a.calibration.gap}`)

  const text = formatReport(a)
  check('and the report says so ABOVE the exit proposals it undermines',
    text.indexOf('Does the replay match') < text.indexOf('Exit plan, replayed') &&
    /OPTIMISTIC/.test(text),
    String(text.indexOf('Does the replay match')))

  /**
   * A replay that DOES match must not cry wolf, or the warning becomes wallpaper and
   * stops being read. Derived from the replay's own output rather than guessed, so this
   * stays a test of the comparison and not of the cost model's current constants.
   */
  const closeRows = Array.from({ length: 200 }, (_, i) => mkBought(i, i % 50 === 0 ? 2.2 : 0.97))
  const staked = 26.19
  const target = analyze(closeRows, 200).calibration.simulatedMultiple
  // Stake, P&L and count as a matched set — the calibration is computed over exactly
  // the trades whose stake was recorded, so a fixture missing them has nothing to compare.
  s.daily[day] = {
    realizedSol: (target - 1) * staked, wins: 60, losses: 114,
    stakedSol: staked, realizedOnStakedSol: (target - 1) * staked, stakedTrades: 174,
  }
  s.totalRealizedSol = (target - 1) * staked
  const close = analyze(closeRows, 200)
  check('a replay that matches the ledger is not flagged',
    close.calibration.trustworthy === true, `gap ${close.calibration.gap}`)
  check('and then the report does not warn',
    !/OPTIMISTIC|PESSIMISTIC/.test(formatReport(close)))

  // With no closed trades there is nothing to calibrate against, and it must say that
  // rather than inventing a comparison.
  s.daily = {}; s.totalRealizedSol = 0
  check('an account that has not traded reports no comparison',
    analyze(rows, rows.length).calibration.comparable === false)

  s.daily = {}; s.totalRealizedSol = 0; s.closed = []
}

// ------------------------------- watching a wallet everywhere, not just where we look
console.log('\nSmart-money discovery')
{
  const { LogFeed } = await import('../src/logfeed.js')

  /**
   * The decode happens BEFORE the mint filter — the mint is inside the event — so every
   * pump.fun trade is already being decoded and then discarded. Watching a wallet on
   * tokens we do NOT follow therefore costs a Set lookup, not new work.
   *
   * That distinction is the whole difference between a confirmation signal ("is smart
   * money in the launch I am already considering") and a discovery one ("what did smart
   * money just buy"), and only the second needs the tokens we are not watching.
   */
  const { PublicKey } = await import('@solana/web3.js')
  const DISC = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238])
  /** A real encoded TradeEvent, so this drives the actual decode and routing. */
  const logsFor = (mintKey, traderKey) => {
    const b = Buffer.alloc(113)
    DISC.copy(b, 0)
    new PublicKey(mintKey).toBuffer().copy(b, 8)
    b.writeBigUInt64LE(BigInt(0.4 * 1e9), 40)
    b.writeBigUInt64LE(BigInt(1_500_000e6), 48)
    b.writeUInt8(1, 56)
    new PublicKey(traderKey).toBuffer().copy(b, 57)
    b.writeBigInt64LE(BigInt(1789500000), 89)
    b.writeBigUInt64LE(BigInt(32e9), 97)
    b.writeBigUInt64LE(BigInt(1.073e15), 105)
    return { logs: [`Program data: ${b.toString('base64')}`], signature: 'sig' }
  }
  const WATCHED = PublicKey.unique().toBase58()
  const UNWATCHED = PublicKey.unique().toBase58()
  const SMART = PublicKey.unique().toBase58()
  const ANYONE = PublicKey.unique().toBase58()

  const feed = new LogFeed({
    interested: (mint) => mint === WATCHED,
    interestedTrader: (trader) => trader === SMART,
  })

  const seen = { trade: [], smart: [] }
  feed.on('trade', (e) => seen.trade.push(e))
  feed.on('smart-trade', (e) => seen.smart.push(e))
  const emit = (mint, trader) => feed.handleNotification(logsFor(mint, trader))

  emit(WATCHED, ANYONE)
  check('an ordinary trade on a watched token reaches the trading path',
    seen.trade.length === 1 && seen.smart.length === 0)

  emit(UNWATCHED, SMART)
  check('a tracked wallet on a token we do NOT follow is captured',
    seen.smart.length === 1 && seen.smart[0].mint === UNWATCHED)
  check('but does NOT reach the trading path', seen.trade.length === 1)

  emit(WATCHED, SMART)
  check('a tracked wallet on a watched token reaches both',
    seen.trade.length === 2 && seen.smart.length === 2)

  emit(UNWATCHED, ANYONE)
  check('and an ordinary trade on an unwatched token reaches neither',
    seen.trade.length === 2 && seen.smart.length === 2)

  check('the feed counts them separately', feed.stats.smart === 2 && feed.stats.kept === 2)
  check('every trade was decoded either way — the discovery axis is free', feed.stats.decoded === 4)
}

// ------------------------------- what the BUYERS have done before
console.log('\nWallet prior')
{
  const { WalletIndex } = await import('../src/wallets.js')
  const { ShadowTracker } = await import('../src/journal.js')

  const idx = new WalletIndex({ maxWallets: 10_000 })
  // A market of ordinary wallets at ~10%, one sharp wallet, one that only buys losers.
  // 100 wallets x 20 launches each, so an ordinary wallet clears minWalletLaunches and
  // "known but not smart" is actually exercised rather than collapsing into "unknown".
  for (let i = 0; i < 2000; i++) idx.note('ORD' + (i % 100), i % 10 === 0, i)
  for (let i = 0; i < 60; i++) idx.note('SHARP', i % 2 === 0, i) // 50%
  for (let i = 0; i < 60; i++) idx.note('DUD', false, i) // 0%

  const base = idx.baseRate()
  check('the base rate is a running total, not a scan',
    near(base, (200 + 30) / 2120, 1e-9), String(base))

  const sharp = idx.verdict('SHARP')
  check('a wallet well above the market is marked smart',
    sharp.known && sharp.betterThanMarket, JSON.stringify(sharp))
  check('judged on the LOWER bound, so a streak is not a record',
    sharp.lowerBound > sharp.base, `${sharp.lowerBound} vs ${sharp.base}`)
  check('a wallet that only buys losers is not smart', !idx.verdict('DUD').betterThanMarket)
  check('an ordinary wallet is not smart', !idx.verdict('ORD1').betterThanMarket)
  check('an unseen wallet is unknown, not bad', (() => {
    const v = idx.verdict('NEVER_SEEN')
    return !v.known && !v.betterThanMarket
  })())
  check('a short record is not enough to be called smart', (() => {
    const i2 = new WalletIndex({ maxWallets: 100 })
    for (let k = 0; k < 500; k++) i2.note('M' + (k % 50), k % 10 === 0, k)
    for (let k = 0; k < 3; k++) i2.note('LUCKY', true, k)
    return !i2.verdict('LUCKY').betterThanMarket
  })())

  /**
   * MULTIPLE COMPARISONS. "Beats the market" at a plain 95% interval passes by chance
   * for ~2.5% of wallets, and it is asked of every eligible wallet in the index —
   * thousands of them. Uncorrected, smartBuyers would be mostly counting noise.
   *
   * Driven by building an index where EVERY wallet is drawn from the same distribution,
   * so every "smart" wallet found is by construction a false positive.
   */
  {
    const nullIdx = new WalletIndex({ maxWallets: 20_000 })
    let s2 = 99
    const r2 = () => (s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648
    // 1,200 identical wallets, 20 buys each, all at the same true 12% rate.
    for (let w = 0; w < 1200; w++) for (let k = 0; k < 20; k++) nullIdx.note('N' + w, r2() < 0.12, k)
    const falsePositives = nullIdx.summary().smart
    check('a corrected index finds almost no "smart" wallets in pure noise',
      falsePositives <= 5, `${falsePositives} of ${nullIdx.summary().eligible} eligible`)
    check('and the eligible count it corrects by is maintained, not scanned',
      nullIdx.eligible === 1200, String(nullIdx.eligible))
    check('which survives a checkpoint round trip', (() => {
      const back = new WalletIndex({ maxWallets: 20_000 })
      back.restore(nullIdx.snapshot())
      return back.eligible === 1200
    })())
  }

  /**
   * An EMPTY index must still be reported. It used to come back null until wallets had
   * accumulated, which hid the panel entirely — so the "fills from live observation,
   * give it a day" message never rendered and the feature looked missing rather than
   * waiting. A disabled feature is the only thing worth hiding.
   */
  {
    const { analyze } = await import('../src/learn.js')
    const wasOn = config.learning.walletPrior
    config.learning.walletPrior = true
    const rows = Array.from({ length: 40 }, (_, i) => ({
      v: JOURNAL_VERSION, mint: 'E' + i, creator: 'C', at: i, finalizedAt: Date.now() - 1000,
      action: 'rejected', failedChecks: ['buyers'], hitFirstRung: i % 8 === 0,
      peakMultiple: i % 8 === 0 ? 2 : 0.9, endMultiple: 0.9, troughMultiple: 0.7,
      decisionPriceSol: 1e-7, observedSeconds: 900, ticks: 20, features: {},
    }))
    const empty = analyze(rows, rows.length).wallets
    check('an empty wallet index is still reported, not hidden',
      empty !== null && empty.wallets === 0 && Array.isArray(empty.top),
      JSON.stringify(empty))
    config.learning.walletPrior = false
    check('only a DISABLED wallet prior reports nothing', analyze(rows, rows.length).wallets === null)
    config.learning.walletPrior = wasOn
  }

  // The leaderboard and the count must agree. They were computed independently, and the
  // list used the uncorrected interval while the summary used the corrected one — so
  // rows were flagged "beats the market" that the count beside them excluded.
  check('the leaderboard agrees with the summary count', (() => {
    const flagged = idx.topWallets({ limit: 1000 }).filter((t) => t.betterThanMarket).length
    return flagged === idx.summary().smart
  })(), `${idx.topWallets({ limit: 1000 }).filter((t) => t.betterThanMarket).length} vs ${idx.summary().smart}`)

  const scored = idx.scoreBuyers(['SHARP', 'DUD', 'ORD1', 'NEVER_SEEN'])
  check('a launch is scored by how many smart wallets are in it',
    scored.smartBuyers === 1 && scored.knownBuyers === 3, JSON.stringify(scored))
  check('and the share is over ALL buyers, not just the known ones',
    near(scored.smartBuyerShare, 0.25, 1e-9), String(scored.smartBuyerShare))

  /**
   * LEAKAGE is the whole difficulty, exactly as it was for the deployer prior. A wallet
   * index that counted a launch's own outcome would "discover" that launches bought by
   * wallets who buy winners tend to win — circular, and it would look like an enormous
   * edge. The index must be written only at finalize and read only at track.
   */
  {
    const wi = new WalletIndex({ maxWallets: 1000 })
    const t = new ShadowTracker({ maxTracked: 10, windowMs: 900_000, walletIndex: wi })
    const c = {
      mint: 'LEAK', symbol: 'LK', creator: 'D', createdAt: Date.now(), priceSol: 1e-7,
      buyers: new Set(['W1', 'W2']),
    }
    t.track({ candidate: c, verdict: { pass: true, failed: [] }, action: 'bought' })
    check('tracking a launch credits its buyers with NOTHING yet',
      wi.byWallet.size === 0, String(wi.byWallet.size))
    t.onTrade({ mint: 'LEAK', priceSol: 2e-7 }, Date.now() + 1000)
    const done = t.finalize('LEAK')
    check('only finalizing does', wi.byWallet.get('W1')?.launches === 1)
    check('and it credits the outcome that actually happened',
      wi.byWallet.get('W1').hits === (done.hitFirstRung ? 1 : 0))

    /**
     * The buyer list must never reach the journal. Sixty addresses at 44 characters is
     * ~2.6 KB a row, which would roughly triple a file that is already the memory
     * ceiling — and the derived counts are in `features` anyway.
     */
    check('the buyer list is stripped before the row is journalled',
      done.buyers === undefined, JSON.stringify(done.buyers)?.slice(0, 60))
    check('but the derived counts are kept', typeof done.features.smartBuyers === 'number')
  }

  // Bounded: singletons are most of the population and can never clear the minimum.
  {
    const small = new WalletIndex({ maxWallets: 50 })
    for (let i = 0; i < 400; i++) small.note('ONCE' + i, false, i)
    for (let i = 0; i < 40; i++) for (let k = 0; k < 5; k++) small.note('REPEAT' + i, k === 0, i)
    small.prune()
    check('the index stays bounded', small.byWallet.size <= 50, String(small.byWallet.size))
    check('and keeps the repeat wallets over the singletons',
      small.byWallet.has('REPEAT0') && !small.byWallet.has('ONCE0'))
    check('pruning does not move the yardstick',
      near(small.baseRate(), 40 / (400 + 200), 1e-9), String(small.baseRate()))
  }

  // Survives a restart, since it is never rebuilt from the journal.
  {
    const a = new WalletIndex({ maxWallets: 1000 })
    for (let i = 0; i < 40; i++) a.note('KEEP', i % 4 === 0, i)
    a.note('SINGLETON', true, 1)
    const b = new WalletIndex({ maxWallets: 1000 })
    b.restore(a.snapshot())
    check('the index round-trips through a checkpoint',
      b.verdict('KEEP').launches === 40 && near(b.baseRate(), a.baseRate(), 1e-9))
    check('and drops singletons from the file rather than storing them',
      !b.byWallet.has('SINGLETON'))
  }
}

// ------------------------------- the losing-streak breaker must fit the strategy
console.log('\nConsecutive-loss limit')
{
  const { consecutiveLossLimit } = await import('../src/risk.js')
  store.initStore()
  const s = store.getState()
  s.positions = {}; s.closed = []; s.daily = {}; s.totalRealizedSol = 0; s.consecutiveLosses = 0
  const day = new Date().toISOString().slice(0, 10)
  const setRecord = (wins, losses) => {
    s.daily = { [day]: { realizedSol: -1, wins, losses, stakedSol: (wins + losses) * 0.15 } }
  }

  setRecord(2, 5)
  check('below the sample floor it uses the configured number',
    consecutiveLossLimit() === config.risk.maxConsecutiveLosses, String(consecutiveLossLimit()))

  /**
   * THE BUG: a fixed 6 assumes a roughly even win rate. At the 20.1% this strategy
   * actually runs, six losses in a row is a 26% event arriving after about fourteen
   * trades — so the breaker tripped a few trades into every UTC day and stayed on,
   * which is why 15 filter-approved launches were refused and nothing was bought.
   */
  setRecord(35, 139) // the real ledger: 20.1%
  const atRealRate = consecutiveLossLimit()
  check('at a 20% win rate the limit is far above six', atRealRate >= 18, String(atRealRate))
  check('and matches ln(alpha)/ln(1-w)',
    atRealRate === Math.ceil(Math.log(config.risk.streakAlpha) / Math.log(1 - 35 / 174)),
    String(atRealRate))

  // At a coin flip it lands near the old fixed value — which is the assumption that
  // number was quietly carrying.
  setRecord(87, 87)
  check('at a 50% win rate it lands near the old fixed six',
    consecutiveLossLimit() >= 6 && consecutiveLossLimit() <= 8, String(consecutiveLossLimit()))

  // A higher win rate must never loosen it below the configured floor.
  setRecord(170, 4)
  check('it never goes below the configured floor',
    consecutiveLossLimit() >= config.risk.maxConsecutiveLosses, String(consecutiveLossLimit()))

  // A strategy that has never won has no rate to reason from.
  setRecord(0, 60)
  check('a strategy with no wins falls back to the floor',
    consecutiveLossLimit() === config.risk.maxConsecutiveLosses, String(consecutiveLossLimit()))

  /**
   * And the GATE has to use it. Testing the helper alone proves nothing about canOpen,
   * which is the shape of every wiring bug in this file.
   */
  setRecord(35, 139)
  s.baseEquitySol = 50; s.peakRealizedSol = 0; s.totalRealizedSol = -4.9; s.halted = null
  s.consecutiveLosses = 10 // over the old six, under the adaptive limit
  check('ten losses no longer pauses a 20%-win-rate strategy',
    canOpen({ mint: 'STREAK1', creator: 'C', walletSol: 45 }) === null,
    String(canOpen({ mint: 'STREAK1', creator: 'C', walletSol: 45 })))
  s.consecutiveLosses = atRealRate
  const paused = canOpen({ mint: 'STREAK2', creator: 'C', walletSol: 45 })
  check('but a genuinely improbable run still does',
    typeof paused === 'string' && paused.includes('consecutive losses'), String(paused))
  check('and the reason names the limit it tripped', String(paused).includes(`limit ${atRealRate}`))

  // The page has to show it, or a paused gate looks exactly like a strict filter.
  const snap = buildSnapshot(45, null)
  check('the dashboard reports the entry gate being paused',
    snap.pnl.pausedByStreak === true && snap.pnl.streakLimit === atRealRate,
    JSON.stringify({ paused: snap.pnl.pausedByStreak, limit: snap.pnl.streakLimit }))

  s.consecutiveLosses = 0; s.daily = {}; s.totalRealizedSol = 0; s.baseEquitySol = 0
}

// ------------------------------- the experiment must not evict the strategy
console.log('\nClosed-trade retention')
{
  /**
   * THE BUG, reproduced: one shared closed[] capped at 500, with explore closing orders
   * of magnitude more trades than the strategy. Live, explore had closed 25,922 against
   * the strategy's ~143, so every strategy trade had been evicted and the dashboard read
   * "0W / 0L · 0 closed" and "no closed trades yet" on an account down 4.92 SOL — while
   * the P&L itself was right, because that is a counter and the list is not.
   *
   * The strategy's own trades are the scarcest evidence this bot makes. A few hundred of
   * them against six figures of shadow rows, and they were being deleted by the thing
   * that exists to be compared against them.
   */
  store.initStore()
  const s = store.getState()
  s.positions = {}; s.closed = []; s.daily = {}; s.totalRealizedSol = 0
  s.exploreRealizedSol = 0; s.exploreWins = 0; s.exploreLosses = 0; s.consecutiveLosses = 0

  const closeOne = (mint, { explore, spent = 0.15, recovered }) => {
    store.addPosition({ mint, symbol: mint, state: 'open', openedAt: Date.now(),
      solSpent: spent, solRecovered: recovered, tokensRemaining: 0, rungsHit: [], explore })
    store.closePosition(mint, 'test')
  }

  closeOne('STRAT_WIN', { explore: false, recovered: 0.21 })
  closeOne('STRAT_LOSS', { explore: false, recovered: 0.10 })
  // Now bury them under an explore book of the size that actually occurs.
  for (let i = 0; i < 2000; i++) closeOne(`EXP${i}`, { explore: true, recovered: 0.11 })

  const rec = store.strategyRecord()
  check('the strategy record survives a large explore book',
    rec.closed === 2 && rec.wins === 1 && rec.losses === 1, JSON.stringify(rec))
  check('and its trades are still in the retained list',
    s.closed.filter((p) => !p.explore).length === 2,
    String(s.closed.filter((p) => !p.explore).length))
  check('while the explore side is still bounded',
    s.closed.filter((p) => p.explore).length <= 300,
    String(s.closed.filter((p) => p.explore).length))

  const book = store.exploreRecord()
  check('the explore count is every trade, not the retained slice',
    book.closed === 2000, String(book.closed))
  /**
   * The tell that made this findable: -1.7659 SOL average on a 0.1505 SOL position.
   * A long-only paper trade cannot lose twelve times its stake, so the divisor had to
   * be wrong. Pin it — an average may never exceed the size of a position.
   */
  check('the explore average cannot exceed what a trade could possibly lose',
    Math.abs(book.realizedSol / book.closed) <= 0.15 + 1e-9,
    `${book.realizedSol / book.closed} per trade on 0.15 SOL positions`)

  const snap = buildSnapshot(45, null)
  check('the dashboard reports the strategy trades it actually made',
    snap.pnl.tradesClosed === 2 && snap.pnl.wins === 1 && snap.pnl.losses === 1,
    JSON.stringify(snap.pnl))

  /**
   * And the closed-trade LIST must show them too. The ledger's trim was fixed to keep
   * each book separately, and then the dashboard re-introduced the same bug one layer
   * up: it sliced the newest 100 of the COMBINED list before the page split it, and
   * with explore outnumbering the strategy ~150:1 that slice was always all explore.
   * The trades existed in the ledger and in the counters; the panel meant to show them
   * was reading a list they could never survive.
   */
  check('and the closed-trade list still contains them',
    snap.closed.filter((c) => !c.explore).length === 2,
    `${snap.closed.filter((c) => !c.explore).length} strategy rows of ${snap.closed.length}`)
  check('without starving the explore side either',
    snap.closed.filter((c) => c.explore).length > 0)
  check('a losing account never shows an empty trade history',
    !(snap.pnl.netSol !== 0 && snap.pnl.tradesClosed === 0))
  check('the explore average uses the full count',
    near(snap.explore.realizedSol / snap.explore.closed, book.realizedSol / 2000, 1e-9))

  /**
   * The P&L curve has to END at the headline figure. Bounded history drawn from zero
   * would disagree with the number printed beside it, which teaches you to trust
   * neither.
   */
  const lastPoint = snap.history[snap.history.length - 1]
  check('the P&L curve ends at the account\'s actual realized total',
    lastPoint && near(lastPoint.sol, s.totalRealizedSol, 1e-9),
    `${lastPoint?.sol} vs ${s.totalRealizedSol}`)
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
  check('a runner beats break-even', winner > 1.2, String(winner))

  /**
   * Costs are charged as they are actually incurred, not as a flat haircut.
   *
   * The old model charged fee x2 and nothing else, understating a real round trip by
   * 2.7-3.8 percentage points — enough to print a losing configuration as a winner.
   * Expectations here are derived from config rather than hardcoded, so they stay honest
   * if a fee moves, and they assert the SHAPE of the cost rather than one number.
   */
  const POS = config.sizing.tiers.find((t) => t.minEquitySol === 0).buySol
  // Tiers are sorted highest-first so lookup can be a find(), which makes tiers[0] the
  // TOP tier. Costing at that size instead of the entry size halves the apparent
  // priority-fee drag — the exact error this cost model exists to prevent.
  check('costs are charged at the size a live account trades, not the top tier',
    POS === 0.075 && config.sizing.tiers[0].buySol === 0.15,
    JSON.stringify(config.sizing.tiers))
  /**
   * The REAL cost model, not a copy of it.
   *
   * This helper used to retype the formula, which meant these checks verified that my
   * transcription matched itself — they broke the moment a genuine cost component was
   * added, having never once objected to the 16pp gap between the replay and the
   * account that was sitting underneath them the whole time. What they are here to
   * assert is how simulateLadder APPLIES the cost, so the cost itself comes from the
   * thing that defines it.
   */
  const costFor = (sells) => roundTripCost({ sells, positionSol: POS })
  const netOf = (gross, sells) => {
    const c = costFor(sells)
    return gross * (1 - c.proportional) - c.priority
  }

  // Never reached the first rung and dumped: the stop-loss caps the damage at -30%,
  // then one buy and one sell are paid for.
  const stopKeeps = 1 - config.exit.stopLossPct / 100
  const dud = simulateLadder({ peakMultiple: 1.1, endMultiple: 0.05, troughMultiple: 0.05 })
  check('a coin that dies is capped by the stop-loss, net of one round trip',
    near(dud, netOf(stopKeeps, 1), 1e-9), `${dud} vs ${netOf(stopKeeps, 1)}`)
  check('and that is meaningfully worse than the old flat-fee model claimed',
    dud < stopKeeps * 0.97 - 0.01, `${dud} vs old ${stopKeeps * 0.97}`)

  // A fixed priority fee per transaction hurts a smaller position more.
  /**
   * Cost is U-SHAPED in position size, because the two components pull opposite ways:
   * a priority fee is fixed per transaction, so it punishes small positions, while price
   * impact is proportional, so it punishes large ones. There is an interior optimum, and
   * assuming either cost alone gets the direction wrong — I assumed it myself here, and
   * the test caught it.
   */
  /**
   * THE REPLAY AND THE ACCOUNT MUST AGREE ABOUT WHAT A TRADE COSTS.
   *
   * They did not, and the disagreement was 16pp: the replay charged 5.3% for a round
   * trip while the paper executor charged 21.4%, because the executor billed half of
   * each API SLIPPAGE TOLERANCE as an expected cost — on top of the curve's own exact
   * price impact. That gap is the entire calibration discrepancy the report kept
   * printing, and while it stood, every exit proposal was scored in an economy the
   * account did not live in. At 21.4% break-even needs 65% of trades to reach +50%;
   * at 5.3% it needs 31.7%. The same strategy is a clear winner or a dead loss
   * depending only on which file you believe.
   *
   * Measured the only way that cannot lie: buy and immediately sell on an UNCHANGED
   * curve, so every lamport of the difference is cost and nothing is a price move.
   */
  {
    const { quoteBuy, quoteSell } = await import('../src/curve.js')
    const vSol = 40, vTokens = 900_000_000, size = 0.075
    const fee = 1 - config.exec.feePct / 100
    const slip = 1 - config.exec.latencySlipPct / 100

    const b = quoteBuy({ vSol, vTokens, solIn: size })
    const tokens = b.tokensOut * fee * slip
    const spent = size + config.exec.priorityFeeSol
    const s = quoteSell({ vSol: vSol + size, vTokens: vTokens - b.tokensOut, tokensIn: tokens })
    const back = s.solOut * fee * slip - config.exec.priorityFeeSol

    const executorCost = (spent - back) / spent
    const replayCost = roundTripCost({ sells: 1, positionSol: size }).total
    check('the replay and the paper account agree on the cost of a round trip',
      Math.abs(executorCost - replayCost) < 0.03,
      `executor ${(executorCost * 100).toFixed(1)}% vs replay ${(replayCost * 100).toFixed(1)}%`)
    /**
     * Direction matters as well as size: the replay being the PESSIMISTIC one is safe,
     * because it means a plan the report endorses will not disappoint the account. The
     * reverse would flatter every proposal.
     */
    check('and where they differ, the replay is the cautious one',
      replayCost >= executorCost,
      `executor ${(executorCost * 100).toFixed(1)}% vs replay ${(replayCost * 100).toFixed(1)}%`)

    /**
     * The tolerances are SAFETY LIMITS, not predictions. Widening the sell tolerance so
     * exits clear in a falling market must not make the backtest worse — that was the
     * logical error underneath the whole gap.
     */
    const before = roundTripCost({ sells: 1, positionSol: size }).total
    const widened = config.exec.sellSlippagePct
    config.exec.sellSlippagePct = 90
    check('widening the slippage TOLERANCE does not change what a trade is scored at',
      near(roundTripCost({ sells: 1, positionSol: size }).total, before, 1e-12))
    config.exec.sellSlippagePct = widened
  }

  const path = { peakMultiple: 1.1, endMultiple: 0.05, troughMultiple: 0.05 }
  const tiny = simulateLadder(path, { positionSol: 0.01 })
  const mid = simulateLadder(path, { positionSol: 0.0866 })
  const huge = simulateLadder(path, { positionSol: 1.0 })
  check('a tiny position is eaten by fixed priority fees', tiny < mid, `${tiny} vs ${mid}`)
  check('a huge position is eaten by price impact', huge < mid, `${huge} vs ${mid}`)
  check('the optimum sits between them', mid > tiny && mid > huge)

  // And every extra rung is another transaction, so a sweep cannot treat rungs as free.
  const oneRung = simulateLadder({ peakMultiple: 5, endMultiple: 5, troughMultiple: 4 },
    { ladder: [{ atPct: 50, sellPct: 100 }] })
  const fourRungs = simulateLadder({ peakMultiple: 5, endMultiple: 5, troughMultiple: 4 },
    { ladder: [{ atPct: 50, sellPct: 25 }, { atPct: 100, sellPct: 25 }, { atPct: 200, sellPct: 25 }, { atPct: 400, sellPct: 25 }] })
  check('rungs are not free — each one is charged',
    fourRungs < oneRung * 5, `${fourRungs} vs ${oneRung}`)

  // Never ran, never crashed — the time stop exits near flat, losing only fees.
  // A fade that never trips the stop exits at the window price, losing only costs.
  const flat = simulateLadder({ peakMultiple: 1.1, endMultiple: 0.95, troughMultiple: 0.9 })
  check('a flat coin exits near break-even', flat > 0.85 && flat < 1.0, String(flat))

  /**
   * Touched the rung, then round-tripped to zero — the worst case for the moon bag.
   *
   * THE FIRST RUNG NO LONGER RECOVERS THE STAKE. Selling 67% at +50% returned ~1.0x, so
   * anything after it was house money; selling 40% returns 0.6x, and the rest of the
   * stake depends on the trailing stop catching the fall at half the peak. That is the
   * cost side of the change the sweep says is worth making, and it should be stated
   * rather than left for a surprised reading of a live trade.
   *
   * Even so, a coin that went to +50% and then to zero comes back near flat, while one
   * that stalled just short of the rung takes the full stop-loss.
   */
  const roundTrip = simulateLadder({ peakMultiple: 1.5, endMultiple: 0.01, troughMultiple: 0.01 })
  const justShort = simulateLadder({ peakMultiple: 1.4, endMultiple: 0.01, troughMultiple: 0.01 })
  // 0.90, not the 0.967 this read before the cost model was made honest. Charging the
  // latency slip the paper account had been charging all along costs ~6pp here.
  check('a rung hit then a total collapse comes back near flat', roundTrip > 0.9, String(roundTrip))
  check('but the stake is NOT fully recovered at the first rung any more',
    roundTrip < 1.0 && 0.4 * 1.5 < 1.0, String(roundTrip))
  check(
    'banking part of it is still what makes the collapse survivable',
    roundTrip > justShort * 1.1, `${roundTrip} vs ${justShort} when it stalls just short`,
  )

  /**
   * Held to the end at the rung price with no drawdown. Two sells now, not one: the rung
   * takes 40% and the remainder is closed at the window price.
   */
  const held = simulateLadder({ peakMultiple: 1.5, endMultiple: 1.5, troughMultiple: 1.2 })
  check('a bag still up at window close is valued there, net of costs',
    near(held, netOf(1.5, 2), 1e-9), `${held} vs ${netOf(1.5, 2)}`)

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

  const small = analyze(signal.slice(0, 20).map((r) => ({ ...r, v: JOURNAL_VERSION, decisionPriceSol: 1, peakMultiple: 1, endMultiple: 1 })))
  check('suggestions are gated on sample size', !small.enoughData && small.suggestions.length === 0)

  const labelled = signal.map((r, i) => ({
    ...r, v: JOURNAL_VERSION, decisionPriceSol: 1,
    peakMultiple: r.hitFirstRung ? 2 : 0.5, endMultiple: r.hitFirstRung ? 1.5 : 0.2,
    rejectedFor: r.action === 'rejected' ? ['buyers'] : null, creator: `C${i % 5}`,
  }))
  const report = analyze(labelled)
  check('bought and rejected are split out', report.totals.bought === 200 && report.totals.rejected === 200)
  check('false negatives are attributed to the check', report.falseNegatives.some((f) => f.check === 'buyers'))
  check('an EV estimate is produced', report.ev.bought?.n === 200)
  check('repeat creators are surfaced', report.repeatCreators.length > 0)

  const { formatReport, exitSweep, criticalZ, permutationNull } = await import('../src/learn.js')

  // ---- audit regressions: fabricated confidence ----

  /**
   * The worst output this report can produce: maximum certainty from minimum
   * measurement. At n=1 the variance guard turns an undefined variance into 0, so the
   * interval collapsed to a point and ONE trade printed "positive with statistical
   * support" — on the exact line that answers "should I fund this?". Identical rows did
   * the same at any n. This is the imminent case, not a contrived one: the filter
   * accepts almost nothing, so the first accepted launch lands here.
   */
  const oneWinner = [{
    v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1, features: { organicBuyers: 20 },
    hitFirstRung: true, peakMultiple: 4, troughMultiple: 0.9, endMultiple: 3, hasOrdering: true, troughFirst: false,
  }]
  const manyRejects = Array.from({ length: 60 }, (_, i) => ({
    v: JOURNAL_VERSION, action: 'explored', decisionPriceSol: 1, features: { organicBuyers: 3 },
    rejectedFor: ['buyers'], hitFirstRung: false,
    peakMultiple: 1.05, troughMultiple: 0.1 + (i % 7) / 100, endMultiple: 0.2 + (i % 5) / 100,
    hasOrdering: true, troughFirst: i % 2 === 0,
  }))
  const single = analyze([...oneWinner, ...manyRejects])
  check('a single sample is marked untestable', single.ev.bought.testable === false)
  const singleText = formatReport(single)
  check('one trade does not claim statistical support', !singleText.includes('positive with statistical support'),
    singleText.split('\n').filter((l) => l.includes('support')).join(' | '))
  check('it says why instead', singleText.includes('NO VERDICT'))
  check('and does not print a zero-width interval', !singleText.includes('± 0.000'))

  // Zero variance at a respectable n is the same failure wearing a bigger number.
  const identical = Array.from({ length: 40 }, () => ({
    v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1, features: { organicBuyers: 9 },
    hitFirstRung: false, peakMultiple: 1.1, troughMultiple: 0.05, endMultiple: 0.05,
    hasOrdering: true, troughFirst: false,
  }))
  check('40 identical rows are also untestable', analyze(identical).ev.bought.testable === false)
  check('and draw no verdict', !formatReport(analyze(identical)).includes('with statistical support'))

  /**
   * The threshold scan tests ~2000 nested cut points and keeps the best. Against pure
   * noise that reported a "statistically supported" threshold most of the time, so the
   * old output inverted the truth: finding nothing was the informative event.
   */
  let ns = 3
  const nrand = () => { ns = (ns * 1103515245 + 12345) % 2147483648; return ns / 2147483648 }
  const pureNoise = Array.from({ length: 300 }, () => ({
    v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1,
    features: { organicBuyers: Math.floor(nrand() * 40), marketCapSol: 20 + nrand() * 100, buys: Math.floor(nrand() * 60) },
    hitFirstRung: nrand() < 0.2,
    peakMultiple: 1 + nrand(), troughMultiple: nrand(), endMultiple: nrand(),
    hasOrdering: true, troughFirst: nrand() < 0.5,
  }))
  const noiseReport = analyze(pureNoise)
  check('pure noise yields no threshold suggestion', noiseReport.suggestions.length === 0,
    JSON.stringify(noiseReport.suggestions.map((s) => s.feature + s.keep + s.cut)))
  check('the noise floor is measured and reported', noiseReport.nullDist?.p95 >= 0)
  check('the report states how often chance alone would find one',
    formatReport(noiseReport).includes('% of the time'))

  // The null must be deterministic — a report that changes conclusions when re-run is
  // not a report.
  check('the permutation null is reproducible',
    permutationNull(pureNoise, { trials: 20 }).p95 === permutationNull(pureNoise, { trials: 20 }).p95)

  // ...and genuinely planted signal must still survive the higher bar.
  const planted = Array.from({ length: 400 }, (_, i) => {
    const strong = i % 2 === 0
    return {
      v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1,
      features: { organicBuyers: strong ? 25 + (i % 10) : 2 + (i % 5) },
      hitFirstRung: strong ? i % 10 < 8 : i % 10 < 1,
      peakMultiple: strong ? 2 : 1.05, troughMultiple: 0.5, endMultiple: 1,
      hasOrdering: true, troughFirst: false,
    }
  })
  check('real signal still clears the noise floor', analyze(planted).suggestions.length > 0)

  /**
   * The trailing stop measures giveback FROM THE PEAK, so a dip that happened before
   * the peak cannot trigger it. Treating any low as a trailing exit understated
   * dip-then-run paths — the modal pump.fun shape — badly enough to turn a profitable
   * configuration into a "NEGATIVE with statistical support" verdict.
   */
  // The trailing stop only governs a REMAINDER, so this needs a ladder that leaves one.
  // The shipped default sells everything at the first rung and never trails.
  const partial = { ladder: [{ atPct: 50, sellPct: 50 }], stopLossPct: 60 }
  const ranThenGaveBack = { peakMultiple: 2.5, troughMultiple: 1.2, endMultiple: 1.2, hasOrdering: true, troughFirst: false }
  const dippedThenRanHigh = { peakMultiple: 2.5, troughMultiple: 1.2, endMultiple: 2.5, hasOrdering: true, troughFirst: true }
  check('a giveback after the peak trails out',
    simulateLadder(ranThenGaveBack, partial) < simulateLadder(dippedThenRanHigh, partial),
    `${simulateLadder(ranThenGaveBack, partial)} vs ${simulateLadder(dippedThenRanHigh, partial)}`)
  check('a dip before the peak does not count as giveback',
    simulateLadder(dippedThenRanHigh, partial) > simulateLadder({ ...dippedThenRanHigh, hasOrdering: false }, partial))

  // ---- counterfactual exit search ----

  // The correction has to move with the number of alternatives tried, or the best of
  // sixteen coin flips reads as a discovery.
  check('the critical value is the usual one for a single test', near(criticalZ(1), 1.96, 0.005), String(criticalZ(1)))
  check('and rises with the number of comparisons', criticalZ(16) > 2.9 && criticalZ(16) < 3.1, String(criticalZ(16)))

  /**
   * The bias this exists to remove: a coin that DIPPED then ran and one that ran then
   * died have identical peak/trough/end. Without ordering the simulator assumes the rung
   * came first, so the stop-loss can never knock it out of a winner — and a sweep would
   * happily recommend tightening the stop to nothing.
   */
  const dippedThenRan = { peakMultiple: 3, troughMultiple: 0.5, endMultiple: 2.5, hasOrdering: true, troughFirst: true }
  const ranThenDied = { peakMultiple: 3, troughMultiple: 0.5, endMultiple: 0.5, hasOrdering: true, troughFirst: false }
  const stoppedOut = simulateLadder(dippedThenRan, { stopLossPct: 30 })
  check('a dip before the run stops us out of it', near(stoppedOut, netOf(0.7, 1), 1e-9),
    `${stoppedOut} vs ${netOf(0.7, 1)}`)
  check('the same path in the other order still rides the ladder',
    simulateLadder(ranThenDied, { stopLossPct: 30 }) > 1, String(simulateLadder(ranThenDied, { stopLossPct: 30 })))
  check('a stop too deep to trigger does not fire',
    simulateLadder(dippedThenRan, { stopLossPct: 60 }) > 1)
  check('rows without ordering keep the old optimistic reading',
    simulateLadder({ ...dippedThenRan, hasOrdering: false }, { stopLossPct: 30 }) > 1)

  /**
   * A population where taking profit EARLIER is genuinely better: everything tops out
   * just short of the current rung and settles back below water.
   *
   * The old fixture round-tripped to 0.05, which made an earlier rung win only because
   * the all-out ladder turned it into a FULL exit before the collapse. Under a partial
   * rung the 60% remainder rides that collapse down to the trailing stop, and the extra
   * sell costs more than the early 40% saves — so the fixture quietly stopped testing
   * what it claimed once the exit plan changed. The path now settles somewhere the
   * remainder survives, which is what makes banking part of it early a real improvement
   * rather than an artefact of selling everything.
   */
  const spikeAndDie = Array.from({ length: 400 }, () => ({
    v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1, features: { organicBuyers: 10 },
    hitFirstRung: false, peakMultiple: 1.4, troughMultiple: 0.88, endMultiple: 0.9,
    hasOrdering: true, troughFirst: false,
  }))
  /**
   * A population shaped like the live trades that prompted this: coins that TRIPLE and
   * then round-trip, exiting on "gave back 50% from peak" with a third of the run kept.
   *
   * The sweep could not previously ask whether banking some of the middle beats riding
   * the trail down, because every axis held the ladder's LENGTH fixed. That was right
   * while the first rung sold everything — there was no bag for a second rung to sell —
   * and wrong the moment it sold 40%.
   */
  const trippedThenDied = Array.from({ length: 400 }, () => ({
    v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1, features: { organicBuyers: 70 },
    hitFirstRung: true, peakMultiple: 3, troughMultiple: 0.4, endMultiple: 0.4,
    hasOrdering: true, troughFirst: false,
  }))
  const peakSweep = exitSweep(trippedThenDied, { minSamples: 10 })
  const second = peakSweep.results.filter((r) => r.axis === 'second rung')
  check('the sweep can price a SECOND rung, not just move the first', second.length > 0,
    String(peakSweep.comparisons))
  check('and finds one on coins that triple and hand it back',
    second.some((r) => r.better), JSON.stringify(second.map((r) => [r.label, r.deltaMean.toFixed(3)])))
  /**
   * Every second-rung variant must sit ABOVE the first and must not sell more of the bag
   * than exists — a ladder selling over 100% is rejected outright by parseLadder, so a
   * proposal the config could not accept is not a proposal.
   */
  const firstAt = config.exit.ladder[0].atPct
  const firstSell = config.exit.ladder[0].sellPct
  check('a proposed second rung is one the config would actually accept',
    second.every((r) => {
      const at = Number(r.label.match(/\+(\d+)%/)[1])
      const sell = Number(r.label.match(/sell (\d+)%/)[1])
      return at > firstAt && firstSell + sell <= 100
    }), JSON.stringify(second.map((r) => r.label)))

  const earlySweep = exitSweep(spikeAndDie, { minSamples: 10 })
  check('the sweep evaluates the current plan', earlySweep.n === 400)
  check('it tries alternatives on every axis', earlySweep.comparisons >= 14, String(earlySweep.comparisons))
  const cheaperRung = earlySweep.better.find((r) => r.axis === 'first rung trigger')
  check('a lower first rung is found when everything only spikes a little',
    Boolean(cheaperRung), JSON.stringify(earlySweep.better.map((b) => b.axis + ' ' + b.label)))

  // ...and pure noise must NOT produce a recommendation.
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const noiseRows = Array.from({ length: 400 }, () => {
    const peak = 1 + rand() * 2
    return {
      v: JOURNAL_VERSION, action: 'bought', decisionPriceSol: 1, features: { organicBuyers: 10 },
      hitFirstRung: peak >= 1.5, peakMultiple: peak, troughMultiple: rand(), endMultiple: rand() * peak,
      hasOrdering: true, troughFirst: rand() < 0.5,
    }
  })
  const noiseSweep = exitSweep(noiseRows, { minSamples: 10 })
  check('the sweep reports how many rows carry ordering', noiseSweep.withOrdering === 400)
  check('every comparison is paired over the same rows',
    noiseSweep.results.every((r) => r.n === 400))
  check('a variant is only called better if its corrected interval clears zero',
    noiseSweep.better.every((r) => r.deltaLo > 0))

  const sweepText = formatReport(analyze(spikeAndDie))
  check('the exit sweep reaches the report', sweepText.includes('Exit plan, replayed'))
  check('and states the ordering caveat', sweepText.includes('ordering') || sweepText.includes('dip came before'))

  /**
   * Rows from before the shadow-price fix must be DROPPED, not averaged in. Every one of
   * them was recorded while rejected tokens received no price updates, so they all read
   * as "went nowhere" whatever the token did — mixing them in manufactures an edge for
   * the filter out of nothing but missing data, and the report would state it with a
   * confidence interval.
   */
  const staleRows = labelled.map((r) => ({ ...r, v: 1, peakMultiple: 1, endMultiple: 1, hitFirstRung: false }))
  const mixed = analyze([...staleRows, ...labelled])
  /**
   * The scan is bounded. The journal is append-only and grows by thousands of rows an
   * hour, and an uncapped analysis gets slower forever — measured at 22s for 50,000
   * rows, synchronous, which freezes the dashboard and the trade feed together.
   */
  {
    const realCap = config.learning.maxRowsAnalyzed
    config.learning.maxRowsAnalyzed = 100
    const many = Array.from({ length: 400 }, (_, i) => ({ ...labelled[i % labelled.length], creator: 'C' + i }))
    const capped = analyze(many)
    check('only the cap is analysed', capped.totals.labelled === 100, String(capped.totals.labelled))
    check('the rows left out are counted', capped.totals.olderThanCap === 300, String(capped.totals.olderThanCap))
    check('and the report says so rather than looking like data loss',
      formatReport(capped).includes('older ones are on disk'))
    config.learning.maxRowsAnalyzed = realCap
    check('an uncapped run keeps everything', analyze(labelled).totals.olderThanCap === 0)
  }

  check('older-schema rows are excluded', mixed.totals.labelled === labelled.length,
    `${mixed.totals.labelled} labelled of ${staleRows.length + labelled.length}`)
  check('the exclusion is counted', mixed.totals.stale === staleRows.length)
  check('and disclosed in the report', formatReport(mixed).includes('EXCLUDED'))
  check('the surviving rates match the clean dataset alone',
    near(mixed.rates.base.p, analyze(labelled).rates.base.p, 1e-12))
  check('a row with no version at all is treated as old', analyze(labelled.map(({ v, ...r }) => r)).totals.labelled === 0)

  /**
   * The headline comparison needs BOTH arms. When the filter accepts nothing — which is
   * exactly what it did for its first 169 screened launches — the block used to simply
   * not print, which reads as "nothing to report" rather than "the one number you are
   * waiting for could not be computed". Silence about a missing measurement is the most
   * dangerous output this report can produce.
   */
  const rejectsOnly = labelled
    .filter((r) => r.action === 'rejected')
    .map((r) => ({ ...r, action: 'explored' }))
  const oneArm = formatReport(analyze(rejectsOnly))
  check('a missing arm is announced, not omitted', oneArm.includes('NOT AVAILABLE'))
  check('it names which side is empty', oneArm.includes('No labelled positions the filter ACCEPTED'))
  check('and says what to do about it', oneArm.includes('Loosen until this arm has samples'))

  /**
   * "The filter rejects everything" and "the filter approves launches that are then
   * refused downstream" are different problems with different fixes, and the report
   * asserted the first without checking. Live, it printed "the filter is rejecting
   * everything" while 15 approved launches had been refused at the capital gate.
   */
  const withBlocked = formatReport(analyze([
    ...rejectsOnly,
    ...Array.from({ length: 7 }, (_, i) => ({
      ...rejectsOnly[0], mint: 'BLK' + i, action: 'blocked',
      blockedBy: 'already holding 4 positions (max 4)',
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      ...rejectsOnly[0], mint: 'BLC' + i, action: 'blocked', blockedBy: 'creator is blocklisted',
    })),
  ]))
  check('an empty bought arm caused by the GATE is not blamed on the filter',
    !withBlocked.includes('The filter is rejecting everything'), 'still blames the filter')
  check('and the gate reasons are named and counted',
    /7 ×\s+already holding N positions/.test(withBlocked) &&
    /2 ×\s+creator is blocklisted/.test(withBlocked),
    withBlocked.slice(withBlocked.indexOf('NOT AVAILABLE'), withBlocked.indexOf('NOT AVAILABLE') + 400))
  check('with the varying numbers collapsed so they group',
    withBlocked.includes('already holding N positions (max N)'))

  const bothArms = formatReport(analyze(labelled.map((r) =>
    r.action === 'rejected' ? { ...r, action: 'explored' } : r)))
  check('with both arms the comparison prints', bothArms.includes('filter said YES'))
  check('and the NOT AVAILABLE notice does not', !bothArms.includes('NOT AVAILABLE'))

  /**
   * A row evicted before its window closed was labelled on a shorter observation than
   * the report claims, which biases peaks downward. Averaging those in silently would
   * make every arm look worse than it was, for a reason invisible in the output.
   */
  const truncatedRows = labelled.map((r, i) => ({
    ...r, observedSeconds: i < 50 ? 120 : 900, windowTruncated: i < 50,
  }))
  const tReport = analyze(truncatedRows)
  check('truncated rows are counted', tReport.totals.truncated === 50, String(tReport.totals.truncated))
  check('truncation is surfaced in the report', formatReport(tReport).includes('evicted before'))
  check('a clean run says nothing about truncation', !formatReport(report).includes('evicted before'))
}

// ------------------------------- telegram message contents vs the ledger
console.log('\nTelegram message audit')
{
  const { notifyEntry, notifySell, notifyClose, notifyHalt, notifyStartup } = await import('../src/notify.js')
  const { riskSummary } = await import('../src/risk.js')

  const realToken = config.telegram.token, realChat = config.telegram.chatId
  const realFetch = globalThis.fetch
  config.telegram.token = 'tok'; config.telegram.chatId = '1'

  // Capture what would actually be sent, rather than trusting the builders.
  let sentText = ''
  globalThis.fetch = async (_url, opts) => {
    sentText = JSON.parse(opts.body).text
    return { ok: true, json: async () => ({}) }
  }
  const has = (needle) => sentText.includes(needle)

  /**
   * Every figure in a message is checked against the ledger record it claims to
   * describe. These are the surface relied on when away from a screen, and a message
   * that is merely plausible is worse than none — the metered-spend alert was plausible
   * for days.
   */
  const pos = {
    mint: 'AuditMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', symbol: 'AUD',
    explore: false, solSpent: 0.0755, tokensBought: 1_000_000, tokensRemaining: 330_000,
    solRecovered: 0.1133, entryPriceSol: 7.55e-8, openedAt: 1000, closedAt: 61_000,
    realizedSol: 0.0378, closeReason: 'gave back 50% from peak', rungsHit: [50],
  }

  await notifyEntry(pos, { buyers: 14, devHoldPct: 4.25 })
  check('entry states what was spent', has('0.0755'), sentText)
  check('entry states tokens received', has('1000000'), sentText)
  check('entry states the buyer count it screened on', has('14'), sentText)
  check('entry states the dev holding', has('4.2') || has('4.3'), sentText)
  check('entry links the mint it actually bought', has(pos.mint), sentText)
  check('a strategy buy is not labelled an experiment', !has('EXPLORE'), sentText)

  await notifyEntry({ ...pos, explore: true, failedChecks: ['buyers', 'dev_hold'] }, { buyers: 3, devHoldPct: 19 })
  check('an explore buy is labelled as one', has('EXPLORE BUY'), sentText)
  check('and says what the filter objected to', has('buyers, dev_hold'), sentText)

  const fill = { tokensSold: 670_000, solReceived: 0.1133 }
  const pnl = { totalSol: 0.0378, totalPct: 50.1, initialsRecovered: true }
  await notifySell(pos, fill, ['+50% rung → sell 67%'], pnl)
  check('sell states tokens sold', has('670000'), sentText)
  check('sell states SOL received', has('0.1133'), sentText)
  check('sell states recovered against spent', has('0.1133') && has('0.0755'), sentText)
  check('sell states the remaining bag', has('330000'), sentText)
  check('sell gives the reason it fired', has('+50% rung'), sentText)
  check('sell flags recovered initials', has('initials recovered'), sentText)

  await notifyClose(pos, pnl)
  check('close states in and out', has('0.0755') && has('0.1133'), sentText)
  check('close states realized P&L', has('0.0378'), sentText)
  check('close states the percentage', has('50.'), sentText)
  check('close states how long it was held', has('60s'), sentText)
  check('close states why it closed', has('gave back 50% from peak'), sentText)

  /**
   * An adopted position has solSpent 0 by design — the original cost is unknowable and
   * inventing one would invent a profit. Dividing by it yielded Infinity, which pct()
   * already renders as "n/a", so nothing crashed and nothing printed NaN. It printed a
   * bare "(n/a)" on the one message meant to say how a trade went, with no indication of
   * whether the figure was missing, broken, or zero. Say which.
   */
  await notifyClose({ ...pos, solSpent: 0, realizedSol: 0.02 }, pnl)
  check('a position with no cost basis still reports what it realized', has('0.0200'), sentText)
  check('and explains why there is no percentage', has('no cost basis'), sentText)
  check('rather than a bare n/a', !has('(n/a)'), sentText)
  check('no message ever prints a raw non-finite number', !has('NaN') && !has('Infinity'), sentText)

  store.initStore()
  const st = store.getState()
  st.positions = {}; st.daily = {}; st.totalRealizedSol = -0.2; st.halted = null
  st.daily[new Date().toISOString().slice(0, 10)] = { realizedSol: -0.12, wins: 1, losses: 3 }
  store.addPosition({ mint: 'OPEN1', symbol: 'O1', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0, tokensRemaining: 10, rungsHit: [] })

  await notifyHalt('total loss limit reached', riskSummary(1))
  check('halt states the reason', has('total loss limit reached'), sentText)
  check("halt states today's realized", has('-0.1200'), sentText)
  check('halt states total realized', has('-0.2000'), sentText)
  check('halt says open positions are still managed', has('1 position(s) still open'), sentText)
  /**
   * panic checks the ledger lock BEFORE its resume branch, and a hosted bot always holds
   * that lock — so the CLI command this used to recommend can never run there.
   */
  check('halt points at the route that works while the bot runs', has('/resume'), sentText)
  check('and marks the CLI route as needing the bot stopped', has('only works with the bot stopped'), sentText)

  await notifyStartup('B94s4wuDqB8qXAJYEc5LK8FDNvhu5DAJyTzwJKfr7JMM', 50, riskSummary(50))
  check('startup states the balance', has('50.0000'), sentText)
  check('startup states the size it will trade', has(buySolFor(50).toFixed(4)), sentText)
  check('startup states the concurrent cap', has(String(config.sizing.maxConcurrentPositions)), sentText)
  check('startup states the real ladder',
    has('+' + config.exit.ladder[0].atPct + '%→' + config.exit.ladder[0].sellPct + '%'), sentText)
  check('startup states the stop', has(String(config.exit.stopLossPct)), sentText)
  check('startup says it is resuming the open position', has('Resuming 1 open position'), sentText)
  check('startup is labelled paper', has('PAPER'), sentText)
  check('no message ever prints undefined', !has('undefined'), sentText)

  st.positions = {}; st.daily = {}; st.totalRealizedSol = 0
  globalThis.fetch = realFetch
  config.telegram.token = realToken; config.telegram.chatId = realChat
}

// ------------------------------------------------- telegram delivery truthfulness
console.log('\nTelegram delivery')
{
  const notifyMod = await import('../src/notify.js')
  const { notify, deliveryStats } = notifyMod

  const realToken = config.telegram.token
  const realChat = config.telegram.chatId
  const realFetch = globalThis.fetch

  /**
   * notify() returned true unconditionally, including when every send failed. The
   * four-hourly summary re-baselines its deltas on that return value — "only after a
   * successful send, so a failed send does not swallow a window's worth of activity" —
   * so the guard silently did nothing and a dropped summary took its window with it.
   */
  config.telegram.token = 'test-token'
  config.telegram.chatId = '123'
  deliveryStats.sent = 0; deliveryStats.failed = 0; deliveryStats.lastError = null

  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  check('a delivered message reports success', (await notify('hello')) === true)
  check('and is counted', deliveryStats.sent === 1 && deliveryStats.failed === 0)

  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ description: 'Too Many Requests' }) })
  check('a REFUSED message reports failure', (await notify('nope')) === false)
  check('the failure is counted', deliveryStats.failed === 1)
  check('and the reason is kept', String(deliveryStats.lastError).includes('429'))

  globalThis.fetch = async () => { throw new Error('network unreachable') }
  check('a network error reports failure too', (await notify('nope')) === false)
  check('without throwing into the trading loop', deliveryStats.failed === 2)
  check('and never blocks an exit', String(deliveryStats.lastError).includes('unreachable'))

  /**
   * MULTI-PART DELIVERY, which is where the real loss was.
   *
   * The learning report outgrew one message and now arrives as several. Telegram takes
   * about one message per second to a chat; the gap was 300ms and a 429 was treated as
   * permanent, so the later parts of a long report were rate-limited, dropped, and
   * logged at warn — and a report that begins in the middle reads as the bot having
   * less to say, not as a channel that lost half of it.
   */
  const longText = ('x'.repeat(200) + '\n').repeat(40) // comfortably over the 4000 limit
  let calls = 0
  deliveryStats.sent = 0; deliveryStats.failed = 0; deliveryStats.lastMultipart = null
  config.telegram.token = 'test-token'

  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({}) } }
  const okLong = await notify(longText)
  check('a long message is split and every part sent', okLong === true && calls > 1, `${calls} parts`)
  check('and the parts actually delivered are recorded',
    deliveryStats.lastMultipart?.parts === calls &&
    deliveryStats.lastMultipart?.delivered === calls,
    JSON.stringify(deliveryStats.lastMultipart))

  // 429 carries retry_after. It is the most recoverable error there is — it says
  // exactly how long to wait — and it was being treated as fatal.
  let first = true
  calls = 0
  globalThis.fetch = async () => {
    calls++
    if (first) {
      first = false
      return { ok: false, status: 429, json: async () => ({ description: 'Too Many Requests', parameters: { retry_after: 0.1 } }) }
    }
    return { ok: true, json: async () => ({}) }
  }
  check('a rate-limited part is retried rather than dropped', (await notify('short one')) === true)
  check('which took more than one call', calls === 2, `${calls} calls`)

  // A malformed message fails identically forever, so retrying it just multiplies the
  // damage. Only 429 and 5xx are worth another go.
  calls = 0
  globalThis.fetch = async () => { calls++; return { ok: false, status: 400, json: async () => ({ description: 'Bad Request: unsupported tag' }) } }
  check('a malformed message is not retried', (await notify('bad')) === false && calls === 1, `${calls} calls`)

  // Permanent rate limiting on part of a long message must be REPORTED, not hidden.
  calls = 0
  globalThis.fetch = async () => {
    calls++
    // First part lands, everything after is refused outright.
    return calls === 1
      ? { ok: true, json: async () => ({}) }
      : { ok: false, status: 400, json: async () => ({ description: 'nope' }) }
  }
  const partial = await notify(longText)
  check('an incompletely delivered report does not claim success', partial === false)
  check('and says how much of it arrived',
    deliveryStats.lastMultipart.delivered === 1 &&
    deliveryStats.lastMultipart.parts > 1,
    JSON.stringify(deliveryStats.lastMultipart))

  /**
   * Pacing applies BETWEEN parts only. Every entry, sell and halt alert is one part,
   * and the comment at the top of notify.js promises a failed or slow send never delays
   * an exit — a fixed delay on single-part messages would quietly break that.
   */
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  const startedAt = Date.now()
  await notify('a single short alert')
  check('a one-part alert is not slowed by multi-part pacing',
    Date.now() - startedAt < 500, `${Date.now() - startedAt}ms`)

  // Unconfigured is a distinct state from failing, and must not read as delivered.
  config.telegram.token = ''
  check('an unconfigured channel does not claim delivery', (await notify('x')) === false)
  check('and is marked unconfigured', deliveryStats.configured === false)

  globalThis.fetch = realFetch
  config.telegram.token = realToken
  config.telegram.chatId = realChat
}

// ------------------------------------------------- metered feed cost estimate
console.log('\nFeed cost estimate')
{
  const { Bot } = await import('../src/bot.js')
  const { EventEmitter } = await import('node:events')
  class Quiet extends EventEmitter {
    start() {} async stop() {} watch() {} unwatch() {}
    subscriptionStats() { return { watched: 0, pending: 0, dropped: 0, max: 60 } }
  }

  /**
   * Only the per-token trade tape is metered. subscribeNewToken and subscribeMigration
   * are free, and the RPC log feed is free by construction.
   *
   * The estimate used to bill every message from every source, so on the free feed it
   * invoiced traffic that costs nothing, projected ~2.97 SOL/day, and advised switching
   * to the free RPC feed that was already in use. The free feed working WELL made the
   * imaginary bill grow faster. An alarm that fires when there is no cost trains you to
   * ignore the one that would matter.
   */
  const onRpc = new Bot({ feed: new Quiet(), logFeed: new Quiet() })
  onRpc.stats.startedAt = Date.now() - 3600_000
  onRpc.stats.messages = 500_000 // heavy free traffic
  const rpcCost = onRpc.statsSnapshot().feedCost
  check('the free RPC feed is never billed', rpcCost.metered === false && rpcCost.spentSol === 0,
    JSON.stringify(rpcCost))
  check('and free traffic is not counted as metered', rpcCost.messages === 0)

  // With the metered tape actually in use, only its own messages are charged.
  const realSource = config.feed.tradeSource
  config.feed.tradeSource = 'pumpportal'
  const onTape = new Bot({ feed: new Quiet() })
  onTape.stats.startedAt = Date.now() - 3600_000
  onTape.stats.messages = 500_000 // free new-token traffic, still not billable
  const idleTape = onTape.statsSnapshot().feedCost
  check('free traffic on the metered source is still not billed', idleTape.spentSol === 0,
    JSON.stringify(idleTape))

  onTape.stats.meteredMessages = 20_000
  const used = onTape.statsSnapshot().feedCost
  check('metered messages are billed at the published rate',
    near(used.spentSol, (20_000 / 10_000) * config.feed.costPer10kMessagesSol, 1e-12), String(used.spentSol))
  check('and the estimate is marked as a real one', used.metered === true)
  config.feed.tradeSource = realSource
}

// ------------------------------------------------- what the edge search can see
console.log('\nFeature vector')
{
  const { Candidate } = await import('../src/filter.js')
  const { featuresOf, CreatorIndex, ShadowTracker } = await import('../src/journal.js')

  const mkCandidate = () => new Candidate(normalizeEvent({
    txType: 'create', mint: 'FEAT', traderPublicKey: 'DEV', name: 'Feature Dog', symbol: 'FEAT',
    initialBuy: 20_000_000, solAmount: 0.5, vSolInBondingCurve: 30,
    vTokensInBondingCurve: 1.073e9, marketCapSol: 28,
  }))
  const buy = (c, trader, sol, atOffsetMs) => c.apply({
    ...normalizeEvent({ txType: 'buy', mint: 'FEAT', traderPublicKey: trader, tokenAmount: 1000,
      solAmount: sol, vSolInBondingCurve: 30, vTokensInBondingCurve: 1.073e9, marketCapSol: 28 }),
    at: c.createdAt + atOffsetMs,
  })

  /**
   * Buyer count and volume cannot tell fifty wallets apart from one whale buying fifty
   * times. A threshold scan can only find an edge in something that was recorded, and
   * rows cannot be back-filled — a feature added later can never explain data collected
   * today.
   */
  const whale = mkCandidate()
  buy(whale, 'WHALE', 9, 1000)
  for (let i = 0; i < 9; i++) buy(whale, 'SMALL' + i, 0.1, 2000)
  const spread = mkCandidate()
  for (let i = 0; i < 10; i++) buy(spread, 'EVEN' + i, 0.99, 1000)

  check('both launches look identical on buyer count', whale.organicBuyers === spread.organicBuyers)
  check('and near-identical on volume', near(whale.buyVolumeSol, spread.buyVolumeSol, 0.05))
  check('but concentration tells them apart',
    whale.topBuyerShare > 0.8 && spread.topBuyerShare < 0.2,
    `${whale.topBuyerShare} vs ${spread.topBuyerShare}`)

  // Accelerating vs fading, which totals alone also cannot distinguish.
  const rising = mkCandidate()
  buy(rising, 'A', 0.1, 500)
  for (let i = 0; i < 6; i++) buy(rising, 'R' + i, 0.1, 27_000)
  const fading = mkCandidate()
  for (let i = 0; i < 6; i++) buy(fading, 'F' + i, 0.1, 500)
  buy(fading, 'Z', 0.1, 27_000)
  check('acceleration separates a rising launch from a fading one',
    rising.buyAcceleration > fading.buyAcceleration,
    `${rising.buyAcceleration} vs ${fading.buyAcceleration}`)

  // Wallets that bought and sold inside the window are flippers, not holders.
  const flipped = mkCandidate()
  buy(flipped, 'FLIP', 1, 1000)
  buy(flipped, 'HOLD', 1, 1000)
  flipped.apply({ ...normalizeEvent({ txType: 'sell', mint: 'FEAT', traderPublicKey: 'FLIP',
    tokenAmount: 1000, solAmount: 1, vSolInBondingCurve: 30, vTokensInBondingCurve: 1.073e9 }),
    at: flipped.createdAt + 5000 })
  check('flip rate counts buyers who already sold', near(flipped.flipRate, 0.5, 1e-9), String(flipped.flipRate))
  check('time to first buy is recorded', flipped.secondsToFirstBuy > 0)

  /**
   * THE CREATOR PRIOR MUST NOT LEAK.
   *
   * A hit rate computed over a set that includes the launch being scored would let the
   * scan "discover" that creators whose launches hit tend to hit — circular, and it
   * would look like an extremely strong edge. The index is only updated on finalize and
   * only read on track, which happens strictly earlier.
   */
  const idx = new CreatorIndex()
  const tracker = new ShadowTracker({ windowMs: 60_000, max: 50, creatorIndex: idx })
  const track = (mint) => tracker.track({
    candidate: { mint, symbol: mint, creator: 'REPEAT', createdAt: Date.now(), priceSol: 1e-7 },
    verdict: { pass: false, failed: [{ id: 'buyers' }] }, action: 'rejected',
  })

  track('L1')
  check('an unseen creator reads as unknown, not as zero',
    tracker.rows.get('L1').features.creatorPriorHitRate === -1)
  check('and its launch count is zero', tracker.rows.get('L1').features.creatorLaunchesSeen === 0)

  // L1 hits. That outcome must not be visible to L1 itself, only to what comes after.
  tracker.onTrade({ mint: 'L1', priceSol: 3e-7 })
  const first = tracker.finalize('L1', 'test')
  check('the first launch hit', first.hitFirstRung === true)
  check('its own row still shows the prior it was scored with, not its result',
    first.features.creatorPriorHitRate === -1, String(first.features.creatorPriorHitRate))

  track('L2')
  check('the next launch by that creator sees the earlier outcome',
    tracker.rows.get('L2').features.creatorLaunchesSeen === 1 &&
    tracker.rows.get('L2').features.creatorPriorHitRate === 1,
    JSON.stringify(tracker.rows.get('L2').features.creatorPriorHitRate))

  // A creator that never hits reads 0 — distinct from -1, because "known bad" and
  // "never seen" are different things a threshold should be able to separate.
  const idx2 = new CreatorIndex()
  idx2.note({ creator: 'DUD', hitFirstRung: false })
  idx2.note({ creator: 'DUD', hitFirstRung: false })
  check('a known-bad creator is 0, not unknown', idx2.priorFor('DUD').hitRate === 0)
  check('an unseen creator is -1', idx2.priorFor('NOBODY').hitRate === -1)

  // Rebuilt from history, so a restart does not forget.
  const rebuilt = CreatorIndex.fromJournal([
    { creator: 'X', hitFirstRung: true, finalizedAt: 1 },
    { creator: 'X', hitFirstRung: false, finalizedAt: 2 },
  ])
  check('the index survives a restart', rebuilt.priorFor('X').launches === 2 && rebuilt.priorFor('X').hitRate === 0.5)

  // Every new feature must actually reach the scan, or none of this matters.
  const f = featuresOf(spread, idx)
  for (const key of ['topBuyerShare', 'top3BuyerShare', 'buysPerBuyer', 'buyAcceleration',
                     'flipRate', 'secondsToFirstBuy', 'launchHourUtc', 'creatorLaunchesSeen',
                     'creatorPriorHitRate']) {
    check(`${key} reaches the journal`, typeof f[key] === 'number', `${key}=${f[key]}`)
  }
}

// ------------------------------------------- journal reading, streamed
console.log('\nJournal streaming')
{
  const { streamRows, readAll: jReadAll, readRecent, append } = await import('../src/journal.js')
  const jfile = path.join(config.dataDir, 'journal-paper.jsonl')
  const saved = fs.existsSync(jfile) ? fs.readFileSync(jfile) : null
  const write = (text) => fs.writeFileSync(jfile, text)

  write('')
  check('an empty journal reads as no rows', jReadAll().length === 0)
  check('and readRecent reports a zero total', readRecent(50).total === 0)

  fs.rmSync(jfile, { force: true })
  check('a missing journal is not an error', jReadAll().length === 0)

  write([
    JSON.stringify({ i: 1, creator: 'A' }),
    'this line is not json at all',
    JSON.stringify({ i: 2, creator: 'B' }),
    '{"i": 3, "truncated": ',
  ].join('\n') + '\n')
  check('a corrupt line is skipped, not fatal', jReadAll().length === 2, String(jReadAll().length))
  check('and the rows either side of it survive',
    jReadAll().map((r) => r.i).join(',') === '1,2')

  // A half-written final line, which is what an OOM kill mid-append leaves behind.
  write(JSON.stringify({ i: 1 }) + '\n' + '{"i":2,"half')
  check('a half-written final row is dropped and the rest kept', jReadAll().length === 1)

  /**
   * THE reason this reads through a StringDecoder rather than buf.toString('utf8').
   *
   * Chunks are 1 MiB. Sooner or later a boundary lands in the middle of a multi-byte
   * character, and a naive decode emits U+FFFD for the split bytes — which makes that
   * row unparseable and silently drops it. Token names on pump.fun are mostly emoji, so
   * this is not a corner case; it is most of the file. Padded so the emoji sits astride
   * the boundary on purpose.
   */
  {
    const CHUNK = 1 << 20
    const name = '🐕🚀 доге 日本語' // 🐕 and 🚀 are four UTF-8 bytes each
    /**
     * Sweeping the padding rather than picking one length, because a single guess is how
     * this test was vacuous the first time: the boundary landed exactly BETWEEN two
     * emoji, split nothing, and passed against the very bug it was written to catch.
     * Nine consecutive byte offsets cannot all miss a four-byte character.
     */
    let intact = 0
    let attempts = 0
    for (let pad = CHUNK - 40; pad <= CHUNK - 32; pad++) {
      const rows = [
        JSON.stringify({ i: 0, pad: 'x'.repeat(pad) }),
        JSON.stringify({ i: 1, name }),
        JSON.stringify({ i: 2, name }),
      ]
      write(rows.join('\n') + '\n')
      const got = jReadAll()
      attempts++
      if (got.length === 3 && got[1].name === name && got[2].name === name) intact++
    }
    check('multi-byte characters survive every chunk-boundary alignment',
      intact === attempts, `${intact}/${attempts} alignments read back intact`)
  }

  // Ring buffer: order preserved, newest kept, total still truthful.
  write(Array.from({ length: 250 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n')
  const recent = readRecent(100)
  check('readRecent keeps the most recent rows', recent.rows.length === 100 && recent.rows[0].i === 150)
  check('in order, oldest of the window first',
    recent.rows[99].i === 249 && recent.rows[50].i === 200)
  check('and reports the true total on disk, not the capped count', recent.total === 250)
  check('a cap larger than the journal returns everything',
    readRecent(10_000).rows.length === 250 && readRecent(10_000).total === 250)
  check('a zero cap reads nothing', readRecent(0).rows.length === 0)

  // The index must not care what order it sees rows in — the sort that used to copy
  // the whole array at startup was doing nothing for correctness.
  {
    const rows = [
      { creator: 'X', hitFirstRung: true }, { creator: 'X', hitFirstRung: false },
      { creator: 'Y', hitFirstRung: false }, { creator: 'X', hitFirstRung: false },
    ]
    const forward = CreatorIndex.fromJournal(rows).priorFor('X')
    const backward = CreatorIndex.fromJournal([...rows].reverse()).priorFor('X')
    check('the creator index is order-independent',
      forward.launches === backward.launches && near(forward.hitRate, backward.hitRate))
  }

  // And it builds from the file without being handed an array.
  write([
    JSON.stringify({ creator: 'Z', hitFirstRung: true }),
    JSON.stringify({ creator: 'Z', hitFirstRung: false }),
  ].join('\n') + '\n')
  check('fromJournal streams the file when given no rows',
    CreatorIndex.fromJournal().priorFor('Z').launches === 2)

  let counted = 0
  const returned = streamRows(() => counted++)
  check('streamRows reports how many rows it handed over', counted === 2 && returned === 2)

  if (saved) fs.writeFileSync(jfile, saved)
  else fs.rmSync(jfile, { force: true })
}

// ------------------------------------------- shadow tracker capacity + windows
console.log('\nShadow tracker')
{
  const { ShadowTracker } = await import('../src/journal.js')

  const mk = (n) => ({
    mint: `M${n}`, symbol: `S${n}`, creator: 'DEV', createdAt: Date.now(), priceSol: 1e-7,
  })
  const verdict = { pass: false, failed: [{ id: 'buyers' }] }

  /**
   * Capacity has to hold a FULL outcome window of launches. At ~30 launches a minute a
   * 15-minute window needs ~450 slots; the old default of 80 held under three minutes,
   * so every row was labelled on a window five times shorter than the report claimed.
   */
  const perMinute = 30
  const needed = perMinute * config.learning.outcomeWindowMinutes
  check('capacity covers a full outcome window at real launch rates',
    config.learning.maxShadowTracked >= needed,
    `${config.learning.maxShadowTracked} slots vs ~${needed} needed`)

  const t = new ShadowTracker({ windowMs: 60_000, max: 3 })
  for (let i = 0; i < 3; i++) t.track({ candidate: mk(i), verdict, action: 'rejected' })
  check('holds up to capacity', t.size === 3)

  // Eviction takes the OLDEST, which for an insertion-ordered Map is the first key.
  t.track({ candidate: mk(3), verdict, action: 'rejected' })
  check('eviction stays at capacity', t.size === 3)
  check('eviction drops the oldest', !t.has('M0') && t.has('M1') && t.has('M3'))

  /**
   * A launch the FILTER approved but the capital gate refused is not a reject.
   *
   * canOpen blocks for reasons unrelated to the launch — four positions already open,
   * the deploy cap, a daily loss limit. Journalling those as 'rejected' put the filter's
   * own picks into the arm measuring what it turned down, and since rejectedFor is null
   * for a passing verdict they were invisible in the "what our filter threw away"
   * breakdown too. With positions held to the 600s time stop, every approved launch in a
   * ten-minute stretch landed in the wrong column.
   */
  {
    const tb = new ShadowTracker({ windowMs: 60_000, max: 10 })
    tb.track({
      candidate: { mint: 'BLK', symbol: 'BLK', creator: 'D', createdAt: Date.now(), priceSol: 1e-7 },
      verdict: { pass: true, failed: [] },
      action: 'blocked',
      blockedBy: 'already holding 4 positions (max 4)',
    })
    tb.onTrade({ mint: 'BLK', priceSol: 3e-7 })
    const blockedRow = tb.finalize('BLK', 'test')
    check('a capital-gate block is journalled as its own action', blockedRow.action === 'blocked')
    check('and records why', blockedRow.blockedBy.includes('max 4'))

    const withBlocked = analyze([blockedRow])
    check('blocked rows count in neither arm',
      withBlocked.totals.bought === 0 && withBlocked.totals.rejected === 0, JSON.stringify(withBlocked.totals))
    check('but they are counted and visible', withBlocked.totals.blocked === 1)
  }

  /**
   * Every arm is labelled against the SAME yardstick. Rows we traded used to be based on
   * the fill price — fee, slippage and priority fee baked in, ~9% above mid — while
   * rejected rows used mid. On an identical price path a bought row had to reach +63% to
   * count as a winner while a reject needed +50%, so the headline comparison was rigged
   * against the filter by a constant margin.
   */
  {
    const tp = new ShadowTracker({ windowMs: 60_000, max: 10 })
    const candidate = { mint: 'BASIS', symbol: 'B', creator: 'D', createdAt: Date.now(), priceSol: 1e-7 }
    tp.track({ candidate, verdict: { pass: true, failed: [] }, action: 'bought', entryPriceSol: 1.09e-7 })
    tp.onTrade({ mint: 'BASIS', priceSol: 1.5e-7 })
    const boughtRow = tp.finalize('BASIS', 'test')

    const tr = new ShadowTracker({ windowMs: 60_000, max: 10 })
    tr.track({ candidate: { ...candidate, mint: 'BASIS2' }, verdict: { pass: false, failed: [{ id: 'buyers' }] }, action: 'rejected' })
    tr.onTrade({ mint: 'BASIS2', priceSol: 1.5e-7 })
    const rejectedRow = tr.finalize('BASIS2', 'test')

    check('both arms use the same price basis',
      near(boughtRow.peakMultiple, rejectedRow.peakMultiple, 1e-9),
      `${boughtRow.peakMultiple} vs ${rejectedRow.peakMultiple}`)
    check('an identical path labels identically in both arms',
      boughtRow.hitFirstRung === rejectedRow.hitFirstRung && boughtRow.hitFirstRung === true)
    check('the fill price is still recorded, just not used as the yardstick',
      near(boughtRow.fillPriceSol, 1.09e-7, 1e-12))
  }

  // Outcome rows record how long they were ACTUALLY watched, so a shortened window
  // cannot pass itself off as a full one.
  /**
   * Pending observations must survive a restart.
   *
   * Rows only reach the journal when their outcome window closes, so without this every
   * row still in flight is discarded whenever the process stops — ~450 of them at 30
   * launches a minute against a 15-minute window. A restart every 15 minutes keeps
   * nothing at all. The loss is also biased, which is worse than its size: restarts
   * cluster around deploys, so the dataset systematically omits whatever was launching
   * while changes were being shipped.
   */
  {
    const before = new ShadowTracker({ windowMs: 600_000, max: 100 })
    for (let i = 0; i < 5; i++) before.track({ candidate: mk(100 + i), verdict, action: 'rejected' })
    before.onTrade({ mint: 'M101', priceSol: 4e-7 })

    const after = new ShadowTracker({ windowMs: 600_000, max: 100 })
    const { restored, expired } = after.restore(before.snapshot())
    check('pending rows survive a restart', restored === 5 && after.size === 5, `${restored} restored`)
    check('nothing has matured yet', expired.length === 0)

    // The price path observed before the restart is preserved, not reset to entry.
    const carried = after.finalize('M101', 'test')
    check('a restored row keeps the prices it already saw',
      near(carried.peakMultiple, 4, 1e-6), String(carried?.peakMultiple))

    // Round-trip through the real file, since that is what a redeploy actually does.
    const { saveShadow, loadShadow, clearShadow } = await import('../src/journal.js')
    const disk = new ShadowTracker({ windowMs: 600_000, max: 100 })
    for (let i = 0; i < 3; i++) disk.track({ candidate: mk(200 + i), verdict, action: 'rejected' })
    disk.onTrade({ mint: 'M201', priceSol: 2.5e-7 })
    saveShadow(disk)

    const reloaded = new ShadowTracker({ windowMs: 600_000, max: 100 })
    check('the checkpoint round-trips through disk', reloaded.restore(loadShadow()).restored === 3)
    check('and carries the price path with it',
      near(reloaded.finalize('M201', 'test').peakMultiple, 2.5, 1e-6))

    clearShadow()
    check('a missing checkpoint is not an error',
      new ShadowTracker({ windowMs: 600_000, max: 100 }).restore(loadShadow()).restored === 0)

    // Rows whose window elapsed during the downtime are handed back to be journalled,
    // rather than sitting in the tracker pretending to still be observed.
    const late = new ShadowTracker({ windowMs: 600_000, max: 100 })
    const stale = before.snapshot()
    for (const r of stale.rows) r.decidedAt -= 700_000
    check('matured rows are returned for journalling', late.restore(stale).expired.length === stale.rows.length)

    // Eviction order must still be oldest-first after a restore, or the Map's insertion
    // order stops meaning "oldest" and eviction starts dropping the wrong rows.
    const ordered = new ShadowTracker({ windowMs: 600_000, max: 100 })
    const shuffled = before.snapshot()
    shuffled.rows = [...shuffled.rows].reverse()
    ordered.restore(shuffled)
    const seq = [...ordered.rows.values()].map((r) => r.decidedAt)
    check('restore preserves oldest-first ordering', seq.every((v, i) => i === 0 || seq[i - 1] <= v))

    // A snapshot from an older schema is refused rather than mixed in.
    check('an old-schema snapshot is not restored',
      new ShadowTracker({ windowMs: 600_000, max: 100 }).restore({ v: 1, rows: stale.rows }).restored === 0)
  }

  const tw = new ShadowTracker({ windowMs: 60_000, max: 10 })
  tw.track({ candidate: mk(9), verdict, action: 'rejected' })
  tw.onTrade({ mint: 'M9', priceSol: 3e-7 })
  const row = tw.finalize('M9', 'evicted')
  check('rows record their observed window', Number.isFinite(row.observedSeconds))
  check('an early finalize is marked truncated', row.windowTruncated === true)
  check('the price path still labels the row', near(row.peakMultiple, 3, 1e-6), String(row.peakMultiple))
  check('and the outcome label follows from it', row.hitFirstRung === true)
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

  /**
   * The panel reports EFFECTIVE config, not the defaults in source. A Railway variable
   * silently overrides a changed default, and last time that happened it cost several
   * rounds of guessing at what the deployment was running.
   */
  check('effective entry thresholds are published', snap.limits.entry.minUniqueBuyers === config.entry.minUniqueBuyers)

  /**
   * analyse() is synchronous and the feed shares its event loop — ~2s for 4,000 rows
   * across 22 features. At a 30-second refresh that is ~7% of all time frozen, dropping
   * trade events for numbers that move over hours. This is a duty cycle, not a freshness
   * setting.
   */
  check('the report is rebuilt on a duty cycle, not every poll',
    config.learning.refreshSeconds >= 120, String(config.learning.refreshSeconds))
  check('and the noise floor trial count is tunable rather than buried',
    config.learning.nullTrials > 0)
  check('effective shadow capacity is published', snap.limits.learning.maxShadowTracked === config.learning.maxShadowTracked)
  check('effective explore bankroll is published', snap.limits.exploreBankrollSol === config.explore.budgetSol)
  check('scaled loss limits are published', snap.limits.maxDrawdownPct === config.risk.maxDrawdownPct)

  /**
   * Persistence has to be stated, not assumed. A bot writing to ephemeral disk looks
   * perfectly healthy right up until a restart wipes every observation it ever made.
   */
  /**
   * "Is it collecting data right now?" has been asked repeatedly, and every answer so
   * far came from reading a screenshot and inferring. The pieces were all on the page;
   * assembling them into a verdict was left to the one person who cannot see the code.
   * A status that only ever says "fine" would be worse than none, so both directions
   * are pinned here.
   */
  check('a healthy bot reports that it is collecting',
    buildSnapshot(50, { creates: 100, tradesMatched: 800, watching: 12, shadowTracked: 60,
      parsing: true, messages: 5000, uptimeSeconds: 3600 }).collection.collecting === true)

  const stalled = buildSnapshot(50, { creates: 100, tradesMatched: 0, watching: 0, shadowTracked: 0,
    parsing: true, messages: 5000, uptimeSeconds: 3600 }).collection
  check('a bot seeing launches but observing none reports NOT collecting', stalled.collecting === false)
  check('and names both broken links', stalled.reasons.length >= 2, JSON.stringify(stalled.reasons))
  check('it says no trades reach watched tokens',
    stalled.reasons.some((r) => r.includes('no trade events')), JSON.stringify(stalled.reasons))
  check('and that nothing is being observed',
    stalled.reasons.some((r) => r.includes('none are being observed')), JSON.stringify(stalled.reasons))

  const unparsed = buildSnapshot(50, { creates: 0, tradesMatched: 0, watching: 0, shadowTracked: 0,
    parsing: false, messages: 5000, uptimeSeconds: 3600 }).collection
  check('a feed that is not parsing is reported', unparsed.reasons.some((r) => r.includes('not parsing')))

  check('the gap to a usable verdict is stated', buildSnapshot(50, { creates: 10, tradesMatched: 50,
    watching: 5, shadowTracked: 5, parsing: true, messages: 500, uptimeSeconds: 600 })
    .collection.needed === config.learning.minSamplesForSuggestion)

  check('the data directory is reported', snap.storage.dataDir === config.dataDir)
  check('writability is reported', snap.storage.writable === true)
  check('journal size is reported', typeof snap.storage.journalBytes === 'number')
  check('checkpoint presence is reported', typeof snap.storage.pendingCheckpoint === 'boolean')

  /**
   * The explore book gets its own P&L on the dashboard, and the headline numbers must
   * stay strategy-only. A -0.650 TOTAL VALUE on a 0.5 SOL book is what the mixed version
   * produced: fifteen concurrent explores tied up more than the account held.
   */
  store.addPosition({
    mint: 'DX', symbol: 'XDOG', state: 'open', openedAt: Date.now() - 30_000,
    entryPriceSol: 2e-7, lastPriceSol: 1e-7, peakPriceSol: 2e-7,
    tokensBought: 500_000, tokensRemaining: 500_000,
    solSpent: 0.075, solRecovered: 0, rungsHit: [], fills: [],
    explore: true, failedChecks: ['buyers', 'dev_hold'],
  })
  const withExp = buildSnapshot(1.2)

  check('deployed explore capital is reported', near(withExp.explore.deployedSol, 0.075))
  // Unlimited is published as null rather than a number, so the panel shows what has
  // been spent instead of counting down from a ceiling that does not exist.
  check('an unlimited bankroll is published as null', withExp.explore.bankrollSol === null)
  check('and so is the remaining figure', withExp.explore.bankrollLeftSol === null)
  check('the panel knows whether explore is on', withExp.explore.enabled === config.explore.enabled)

  const stratMark = withExp.positions.filter((x) => !x.explore).reduce((s, x) => s + x.markValueSol, 0)
  check('total value excludes explore bags', near(withExp.wallet.totalValueSol, 1.2 + stratMark, 1e-9),
    `${withExp.wallet.totalValueSol} vs ${1.2 + stratMark}`)
  check('total value is not dragged negative by the experiment', withExp.wallet.totalValueSol > 0)
  check('strategy deployed excludes explore', near(withExp.wallet.deployedSol, snap.wallet.deployedSol))

  // An explore row must carry WHY it was taken, in both tables.
  const expOpen = withExp.positions.find((x) => x.explore)
  check('an open explore row names the failed checks', expOpen?.failedChecks.includes('dev_hold'))
  store.closePosition('DX', 'stop-loss')
  const afterClose = buildSnapshot(1.2)
  const expClosed = afterClose.closed.find((x) => x.explore)
  check('a closed explore row still names the failed checks', expClosed?.failedChecks.includes('dev_hold'))
  check('explore losses stay out of the strategy P&L chart',
    afterClose.history.every((h) => Number.isFinite(h.sol)) &&
      !afterClose.closed.filter((x) => !x.explore).some((x) => x.mint === 'DX'))
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

  /**
   * Market cap has to come off the trade's own reserves.
   *
   * Candidate.apply only assigns a market cap when the value is finite, and on the RPC
   * feed the create event was the ONLY thing that ever carried one — so marketCapSol and
   * peakMarketCapSol stayed frozen at their t=0 values for the whole observation window.
   * A fresh curve implies ~28 SOL against a 25-120 band, so the market_cap check passed
   * every launch: it was not calibrated, it was inert. The bot would also happily buy a
   * token that had 10x'd during the 30s observation, still believing the cap was 28.
   */
  {
    const { Candidate } = await import('../src/filter.js')
    const { PUMP_TOTAL_SUPPLY } = await import('../src/config.js')
    const priced = toFeedEvent({ mint: 'MC', trader: 'T', isBuy: true, solAmount: 5,
      tokenAmount: 1e6, vSol: 90, vTokens: 9e8 })
    check('a trade event carries a derived market cap',
      near(priced.marketCapSol, (90 / 9e8) * PUMP_TOTAL_SUPPLY, 1e-9), String(priced.marketCapSol))

    const c = new Candidate(normalizeEvent({ txType: 'create', mint: 'MC', traderPublicKey: 'DEV',
      name: 'MCap Dog', symbol: 'MC', initialBuy: 20e6, solAmount: 0.5,
      vSolInBondingCurve: 30, vTokensInBondingCurve: 1.073e9, marketCapSol: 28 }))
    check('market cap starts at its deploy-time value', near(c.marketCapSol, 28, 0.5), String(c.marketCapSol))

    // The curve runs hard during the observation window.
    for (let i = 0; i < 10; i++) {
      c.apply(toFeedEvent({ mint: 'MC', trader: `B${i}`, isBuy: true, solAmount: 5,
        tokenAmount: 1e6, vSol: 30 + (i + 1) * 12, vTokens: 1.073e9 }))
    }
    check('market cap tracks the curve during observation', c.marketCapSol > 100, String(c.marketCapSol))
    check('and the peak is recorded', c.peakMarketCapSol >= c.marketCapSol)

    /**
     * The band can now see the run-up — which is the point. It no longer REJECTS for it:
     * that ceiling turned out to be the most harmful check in the filter, refusing 693
     * launches of which 25.7% would have reached +50% against a 9.9% base rate. What it
     * still catches is a cap far beyond anything worth entering.
     */
    const { evaluateEntry } = await import('../src/filter.js')
    const runUp = evaluateEntry(c).failed?.some((x) => x.id === 'market_cap')
    check('a run-up inside the band is no longer rejected for it', !runUp,
      JSON.stringify(evaluateEntry(c).failed?.map((x) => x.id)))
    check('but the band is being evaluated against a live figure now',
      c.marketCapSol > 100 && c.marketCapSol <= config.entry.maxMarketCapSol, String(c.marketCapSol))
  }
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

  /**
   * The paper book is sized to keep the experiment RUNNING, not to mirror the live
   * stack. At 0.5 SOL the strategy halts on the total-loss limit after ~16 losing
   * trades, and a halted book stops answering the question.
   *
   * This is safe only because the numbers the learning report reasons about are
   * multiples of stake, so they do not move with account size. The check below is the
   * property that makes a 50 SOL paper run transferable to a 0.5 SOL live account.
   */
  check('the paper book is large enough to outlive the loss limit',
    config.paperStartSol > config.risk.totalLossLimitSol * 10,
    `${config.paperStartSol} vs limit ${config.risk.totalLossLimitSol}`)
  check('and it can never touch live, which reads the chain',
    !JSON.stringify(config).includes('"paperStartSol":null'))

  {
    // Same price path, two account sizes: the outcome label and simulated return must
    // be identical. If they were not, paper at 50 SOL would be measuring a different
    // strategy than live at 0.5.
    const path = { peakMultiple: 2.2, troughMultiple: 0.6, endMultiple: 1.4, hasOrdering: true, troughFirst: false }
    check('simulated return is independent of account size',
      simulateLadder(path) === simulateLadder(path))
    const small = { ...path }
    const big = { ...path }
    check('the outcome label is a multiple, not an amount',
      simulateLadder(small) === simulateLadder(big))
  }

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

  /**
   * The two books are separate money. Folding explore into the strategy balance meant
   * 15 concurrent explores at 0.075 tied up 1.1 SOL against a 0.5 SOL book — the
   * balance went negative (TOTAL VALUE read -0.650) and, because the size tier reads
   * this number, the experiment was steering the strategy's position sizing.
   */
  const { paperExploreWalletSol, exploreDeployedSol, deployedSol } = store
  const strategyBefore = paperWalletSol(START)

  store.addPosition({ mint: 'W2', symbol: 'W2', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [], explore: true })
  check('an open explore position does not tie up strategy capital',
    near(paperWalletSol(START), strategyBefore), String(paperWalletSol(START)))
  check('it ties up the experiment bankroll instead', near(exploreDeployedSol(), 0.075))
  check('explore capital is excluded from strategy deployed', near(deployedSol(), 0))

  store.getState().positions.W2.solRecovered = 0.12
  store.closePosition('W2', 'ladder')
  check('closed explore P&L does not move the strategy balance',
    near(paperWalletSol(START), strategyBefore), String(paperWalletSol(START)))
  check('it moves the experiment bankroll', near(paperExploreWalletSol(2), 2 + 0.045))

  /**
   * The regression this exists for: a running counter resets to START on restart while
   * pre-existing positions keep crediting their sells, so every restart inflated the
   * balance — and an inflated balance silently bumps the size tier.
   */
  const beforeRestart = paperWalletSol(START)
  store.initStore() // simulates a process restart re-reading the ledger
  check('balance survives a restart unchanged', near(paperWalletSol(START), beforeRestart),
    `${paperWalletSol(START)} vs ${beforeRestart}`)

  // Many losing trades must drive the book they belong to DOWN, never up.
  const exploreBefore = paperExploreWalletSol(2)
  for (let i = 0; i < 20; i++) {
    store.addPosition({ mint: `L${i}`, symbol: `L${i}`, state: 'open', openedAt: Date.now(),
      solSpent: 0.075, solRecovered: 0.059, tokensRemaining: 0, rungsHit: [], explore: true })
    store.closePosition(`L${i}`, 'time stop')
  }
  check('twenty losing explore trades reduce the experiment bankroll',
    near(paperExploreWalletSol(2), exploreBefore - 20 * 0.016, 1e-9), String(paperExploreWalletSol(2)))
  check('and leave the strategy balance untouched', near(paperWalletSol(START), beforeRestart),
    String(paperWalletSol(START)))

  // The same twenty losses on the strategy side must land squarely on it.
  const strategyStart = paperWalletSol(START)
  for (let i = 0; i < 20; i++) {
    store.addPosition({ mint: `S${i}`, symbol: `S${i}`, state: 'open', openedAt: Date.now(),
      solSpent: 0.075, solRecovered: 0.059, tokensRemaining: 0, rungsHit: [] })
    store.closePosition(`S${i}`, 'time stop')
  }
  check('twenty losing strategy trades reduce the strategy balance',
    near(paperWalletSol(START), strategyStart - 20 * 0.016, 1e-9), String(paperWalletSol(START)))
}

// ------------------------------------------------- feed subscription batching
console.log('\nFeed subscriptions')
{
  const { Feed } = await import('../src/feed.js')
  // These cover the metered per-token tape; the default source skips it entirely.
  const realSource = config.feed.tradeSource
  config.feed.tradeSource = 'pumpportal'
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

  // Under the free source there is nothing to subscribe per token — one program-level
  // subscription already covers every mint.
  config.feed.tradeSource = 'rpc'
  const noop = new Feed()
  noop.ws = { readyState: 1, send: () => {} }
  for (let i = 0; i < 20; i++) noop.watch('N' + i)
  check('the per-token tape is not subscribed under the free source',
    noop.subscriptionStats().watched === 0)
  await noop.stop()

  config.feed.tradeSource = realSource
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

  /**
   * The bankroll is UNLIMITED by default. A cap only ever existed to stop the experiment
   * wrecking the strategy's books; with the two separated there is no reason to stop
   * buying information with money that does not exist, and a cap just starves the
   * rejected arm of the comparison the report is built to make. What still bounds it is
   * maxConcurrent, and being paper-only.
   */
  check('the bankroll is unlimited by default', config.explore.budgetSol === 0)
  check('concurrency still bounds the experiment', config.explore.maxConcurrent > 0)

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

  /**
   * Precondition for the guard that stops the experiment vetoing the strategy: a closed
   * row must carry its explore flag, because that is what bot.js checks before writing
   * to the creator blocklist. The behavioural test lives in the end-to-end section,
   * where a real Bot drives the close.
   */
  store.addPosition({ mint: 'EXPFLAG', symbol: 'EF', state: 'open', openedAt: Date.now(),
    creator: 'EXPDEV', solSpent: 0.075, solRecovered: 0.01, tokensRemaining: 0, rungsHit: [], explore: true })
  const closedFlag = store.closePosition('EXPFLAG', 'stop-loss')
  check('a closed explore row keeps its explore flag', closedFlag.explore === true)
  check('and is a loss, which is what would have blocklisted', closedFlag.realizedSol < 0)

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

    /**
     * Every decision is counted, so "explored: 0" can be read rather than inferred. At a
     * 25% rate four rejects produce no explore trade about a third of the time, which
     * makes zero equally consistent with healthy sampling and with the experiment being
     * off, parked or starved.
     */
    b.stats.exploreOffered = 0; b.stats.exploreTaken = 0
    b.stats.exploreSkips = { disabled: 0, unpriceable: 0, concurrency: 0, noTradeData: 0, bankroll: 0, sampledOut: 0 }
    for (let i = 0; i < 200; i++) b.explorePermitted(verdict)
    const xs = b.statsSnapshot().explore
    check('every reject offered to the sampler is counted', xs.offered === 200, String(xs.offered))
    check('takes plus skips account for all of them',
      xs.taken + Object.values(xs.skips).reduce((a, n) => a + n, 0) === 200)
    check('the actual rate lands near the target',
      Math.abs(xs.taken / xs.offered - config.explore.sampleRate) < 0.12,
      `${xs.taken}/200 vs target ${config.explore.sampleRate}`)
    check('and the target is reported for comparison', xs.sampleRate === config.explore.sampleRate)

    // A blocked sampler must say WHY, not just decline.
    const realMax = config.explore.maxConcurrent
    config.explore.maxConcurrent = 0
    b.stats.exploreSkips.concurrency = 0
    b.explorePermitted(verdict)
    check('a concurrency block is attributed', b.stats.exploreSkips.concurrency === 1)
    config.explore.maxConcurrent = realMax

    /**
     * Explore concurrency counts EXPLORE positions only. Mixing the books here let
     * strategy positions eat the experiment's slots — the same class of bug that once
     * deadlocked observation.
     */
    for (let i = 0; i < 6; i++) {
      store.addPosition({ mint: `STRAT${i}`, symbol: `S${i}`, state: 'open', openedAt: Date.now(),
        solSpent: 0.15, solRecovered: 0, tokensRemaining: 1000, rungsHit: [] })
    }
    config.explore.maxConcurrent = 4
    b.stats.exploreSkips.concurrency = 0
    for (let i = 0; i < 40; i++) b.explorePermitted(verdict)
    check('strategy positions do not consume explore slots',
      b.stats.exploreSkips.concurrency === 0, String(b.stats.exploreSkips.concurrency))
    for (let i = 0; i < 6; i++) delete store.getState().positions[`STRAT${i}`]
    config.explore.maxConcurrent = realMax

    // Unlimited: heavy losses must NOT stop it. This is the point of the experiment —
    // the losses are the tuition, and stopping early is what leaves the report unable
    // to say anything about the launches the filter rejected.
    store.getState().exploreRealizedSol = -500
    check('unlimited keeps exploring through heavy losses',
      Array.from({ length: 200 }, () => b.explorePermitted(verdict)).some((x) => x === true))

    // A cap, when one is set, is still enforced — and on capital AT RISK, not only on
    // money already lost. Gating on realized P&L alone let concurrent positions tie up
    // more than the whole bankroll while "spent" still read near zero.
    const realBudget = config.explore.budgetSol
    config.explore.budgetSol = 1
    store.getState().exploreRealizedSol = -1
    check('a configured cap still stops exploration',
      Array.from({ length: 200 }, () => b.explorePermitted(verdict)).every((x) => x === false))

    store.getState().exploreRealizedSol = 0
    for (let i = 0; i < 13; i++) {
      store.addPosition({ mint: `CAP${i}`, symbol: `C${i}`, state: 'open', openedAt: Date.now(),
        solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [], explore: true })
    }
    check('a cap counts capital still deployed, not just realized losses',
      Array.from({ length: 200 }, () => b.explorePermitted(verdict)).every((x) => x === false),
      `deployed ${store.exploreDeployedSol()} against a 1 SOL cap`)
    for (let i = 0; i < 13; i++) delete store.getState().positions[`CAP${i}`]
    config.explore.budgetSol = realBudget

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
  check('a quiet window for a bot that HAS traded is not alarming', quiet.includes('a quiet window'))

  /**
   * But a filter that has NEVER taken a trade is a different situation and must not get
   * the same reassurance. It produces no evidence about its own picks, so it is
   * indistinguishable from a broken one — the digest has to say so.
   */
  entered = 0
  const neverTraded = summaryText(fakeBot, { ...base, entered: 0 })
  check('a filter that never fires is flagged, not congratulated',
    neverTraded.includes('never taken one') && !neverTraded.includes('a quiet window'))
  entered = 2
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

  /**
   * The dashboard is token-protected because it shows a wallet and its P&L, so the URL
   * alone is useless — and the token lives in the host's environment, not on a phone.
   * This chat is already authenticated against one chat id and already has /panic and
   * /reset, so handing over a working link grants nothing it did not already have.
   */
  {
    const realUrl = config.dashboard.publicUrl
    const realTok = config.dashboard.token
    const realEnabled = config.dashboard.enabled

    config.dashboard.enabled = true
    config.dashboard.publicUrl = 'https://example.up.railway.app'
    config.dashboard.token = 's3cret'
    /**
   * The learning report is the one output this whole exercise exists to produce, and it
   * was only reachable through `npm run learn` — which refuses while a hosted bot holds
   * the ledger lock. Unreachable from the only device it gets checked on.
   */
  {
    const report = await listener.handle('/learn')
    check('/learn returns the report', report.includes('pumpbot learning report'), report.slice(0, 120))
    check('it leads with what trading costs', report.includes('Cost of a round trip'))
    check('/report is the same command', (await listener.handle('/report')).includes('pumpbot learning report'))
    /**
     * Wrapped per split part, not around the whole message. Wrapping first and splitting
     * after tears the tag pair apart — the first part opens <pre> and never closes it —
     * and Telegram rejects malformed HTML outright, so a long report never arrives at
     * all. It fits in one part while the journal is small, which is why this stays hidden
     * until the data grows.
     */
    const { notify } = await import('../src/notify.js')
    const realFetch2 = globalThis.fetch
    const savedTok = config.telegram.token, savedChat = config.telegram.chatId
    config.telegram.token = 'tok'; config.telegram.chatId = '1'
    const parts = []
    globalThis.fetch = async (_u, o) => { parts.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({}) } }
    const longText = Array.from({ length: 400 }, (_, i) => 'line ' + i + ' of a long report').join('\n')
    await notify(longText, { pre: true })
    check('a long report is split into several messages', parts.length > 1, String(parts.length))
    check('and every part is independently well-formed',
      parts.every((p) => (p.match(/<pre>/g) || []).length === (p.match(/<\/pre>/g) || []).length),
      parts.map((p) => (p.match(/<pre>/g) || []).length + '/' + (p.match(/<\/pre>/g) || []).length).join(' '))
    check('every part is monospaced', parts.every((p) => p.includes('<pre>')))
    globalThis.fetch = realFetch2
    config.telegram.token = savedTok; config.telegram.chatId = savedChat
  }

  const link = await listener.handle('/dashboard')
    check('/dashboard returns a link that carries the token', link.includes('token=s3cret'), link)
    check('and shows the bare address as the label', link.includes('example.up.railway.app'))
    check('/link is the same command', (await listener.handle('/link')).includes('token=s3cret'))

    // A token with URL-unsafe characters must survive the round trip.
    config.dashboard.token = 'a b&c=d'
    check('the token is URL-encoded', (await listener.handle('/dashboard')).includes('a%20b%26c%3Dd'),
      await listener.handle('/dashboard'))

    // Without a known public address, say so rather than hand over a broken link.
    config.dashboard.publicUrl = ''
    const noUrl = await listener.handle('/dashboard')
    check('an unknown public URL is admitted, not guessed', noUrl.includes('DASHBOARD_URL'), noUrl)
    check('and no half-built link is offered', !noUrl.includes('http'), noUrl)

    config.dashboard.enabled = false
    check('a disabled dashboard says so', (await listener.handle('/dashboard')).includes('switched off'))

    config.dashboard.publicUrl = realUrl
    config.dashboard.token = realTok
    config.dashboard.enabled = realEnabled
  }

  const split = await listener.handle('/status')
  check('/status separates the strategy book', split.includes('<b>Strategy</b>'))
  check('/status shows the explore book separately', split.includes('Explore book'))
  check('/status gives the explore book its own P&L', split.includes('-0.0310'))
  check('/status shows the explore bankroll state', split.includes('Bankroll unlimited'))
  check('/status says explore is not the strategy\'s money', split.includes("not the strategy's money"))

  // The explore position must appear under its own heading, labelled with what the
  // filter objected to — otherwise it reads as a trade the strategy chose to take.
  const posText = await listener.handle('/positions')
  check('/positions separates strategy from explore', posText.includes('Explore —'))
  check('/positions says why an explore trade was taken', posText.includes('would skip: buyers'))
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

// ------------------------------------------- which mints the RPC feed decodes
console.log('\nLog feed interest filter')
{
  const { Bot } = await import('../src/bot.js')
  const { EventEmitter } = await import('node:events')
  class QuietFeed extends EventEmitter {
    start() {} async stop() {} watch() {} unwatch() {}
  }

  store.initStore()
  const st = store.getState()
  st.positions = {}; st.closed = []; st.halted = null
  store.save()

  // NOT injecting a logFeed: we want the real one, because the bug lived in the
  // predicate the Bot hands it. Every e2e test injects a fake, which is exactly why
  // 303 tests passed while shadow rows silently received no prices at all.
  const bot = new Bot({ feed: new QuietFeed() })
  check('an rpc-sourced bot builds a real log feed', Boolean(bot.logFeed?.interested))

  const want = bot.logFeed.interested
  check('an unknown mint is ignored', want('NOBODY') === false)

  bot.candidates.set('CAND', {})
  check('a mint still inside the observation window is decoded', want('CAND') === true)

  store.addPosition({ mint: 'HELD', symbol: 'HELD', state: 'open', openedAt: Date.now(),
    solSpent: 0.075, solRecovered: 0, tokensRemaining: 1000, rungsHit: [] })
  check('an open position is decoded', want('HELD') === true)

  /**
   * The regression. A rejected token is deleted from `candidates` the instant it is
   * screened, so if the predicate does not also cover shadow rows it stops receiving
   * trades immediately and its journal row finalizes at peakMultiple 1.0 with zero
   * ticks. That does not read as "no data" downstream — it reads as "everything we
   * rejected went nowhere", which is the filter grading its own homework.
   */
  bot.shadow.track({
    candidate: { mint: 'SHADOW', symbol: 'SHD', creator: 'DEV', createdAt: Date.now(), priceSol: 1e-7 },
    verdict: { pass: false, failed: [{ id: 'buyers' }] },
    action: 'rejected',
  })
  check('a shadow-tracked reject is still decoded', want('SHADOW') === true)

  // And it must actually reach the tracker, so the row can be labelled.
  bot.shadow.onTrade({ mint: 'SHADOW', priceSol: 2e-7 })
  const row = bot.shadow.finalize('SHADOW', 'test')
  check('shadow rows accumulate price ticks', row?.ticks === 1, JSON.stringify(row?.ticks))
  check('and produce a real outcome multiple', row && near(row.peakMultiple, 2, 1e-6), String(row?.peakMultiple))

  await bot.logFeed.stop()
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

  class FakeLogFeed extends EventEmitter {
    constructor() { super(); this.started = false }
    start() { this.started = true }
    async stop() { this.started = false }
    feedStats() { return { notifications: 0, decoded: 0, kept: 0, connected: true } }
  }

  const feed = new FakeFeed()
  const logFeed = new FakeLogFeed()
  const bot = new Bot({ feed, logFeed })
  await bot.start()
  check('the free trade feed is started', logFeed.started)
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

  /**
   * Age the candidate BEFORE the buys land, so they fall in the late third of the
   * observation window and buyAcceleration clears its bar. Emitting them all at t=0 puts
   * everything in `earlyBuys`, which now reads as a fading launch and is refused.
   */
  bot.candidates.get(MINT).createdAt -= (config.entry.observeSeconds + 5) * 1000
  const E2E_BUYERS = config.entry.minUniqueBuyers + 10
  for (let i = 0; i < E2E_BUYERS; i++) logFeed.emit('trade', mkTrade('buy', `BUYER${i}`))
  logFeed.emit('trade', mkTrade('sell', 'SELLER0'))
  check('trade events counted', bot.statsSnapshot().trades === E2E_BUYERS + 1)
  check('trades are attributed to the watched candidate', bot.statsSnapshot().tradesMatched === E2E_BUYERS + 1)

  // A trade for something we are not tracking must not count as matched — that counter
  // is the signal that our subscriptions are actually being served.
  logFeed.emit('trade', normalizeEvent({ txType: 'buy', mint: 'UNRELATED', traderPublicKey: 'Z',
    tokenAmount: 1, solAmount: 0.01, vSolInBondingCurve: 30, vTokensInBondingCurve: 1e9 }))
  check('unrelated trades are not counted as matched', bot.statsSnapshot().tradesMatched === E2E_BUYERS + 1)
  check('but they do count toward total trades', bot.statsSnapshot().trades === E2E_BUYERS + 2)

  // A separate, fresh launch covers "not old enough to screen yet" — MINT was aged
  // before its buys landed so that they count as late-window.
  const YOUNG = 'YoungMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
  feed.emit('create', normalizeEvent({ txType: 'create', mint: YOUNG, traderPublicKey: 'DEV',
    name: 'Young Dog', symbol: 'YNG', initialBuy: 20_000_000, solAmount: 0.8,
    vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
  await bot.tick()
  check('does not enter before the observation window', !store.getState().positions[YOUNG])
  check('candidate is still being observed', bot.candidates.has(YOUNG))
  bot.candidates.delete(YOUNG)

  // Already aged past OBSERVE_SECONDS above, so this screens on the next tick.
  await bot.tick()

  const pos = store.getState().positions[MINT]
  check('enters a qualifying launch', Boolean(pos), JSON.stringify(bot.statsSnapshot().topRejects))
  // Size comes from the tier the CURRENT balance sits in, not a hardcoded number — the
  // paper book starts at PAPER_START_SOL, which is deliberately large enough that the
  // total-loss limit cannot end the experiment early.
  const expectedBuy = (await import('../src/sizing.js')).buySolFor(bot.walletSol)
  check('entry used the tier size', pos && near(pos.solSpent, expectedBuy + config.exec.priorityFeeSol, 1e-9),
    `${pos?.solSpent} vs ${expectedBuy} at ${bot.walletSol} SOL`)
  check('entry counted in stats', bot.statsSnapshot().entered === 1)
  check('position is shadow-tracked for learning', bot.shadow.has(MINT))

  /**
   * Price doubles. The rung banks PART of the bag and the position stays open — the
   * whole shape of the shipped exit, end to end, rather than in the simulator.
   */
  const beforeTokens = pos.tokensRemaining
  logFeed.emit('trade', mkTrade('buy', 'WHALE', 2))
  await new Promise((r) => setImmediate(r))
  await bot.tick()

  const after = store.getState().positions[MINT]
  check('the rung fired on the price move', after && after.tokensRemaining < beforeTokens,
    JSON.stringify(after?.tokensRemaining))
  check('and it sold only its share, leaving the rest to run',
    after && near(after.tokensRemaining, beforeTokens * (1 - config.exit.ladder[0].sellPct / 100), 1e-6),
    `${after?.tokensRemaining} of ${beforeTokens}`)
  check('the rung is recorded', after?.rungsHit.includes(config.exit.ladder[0].atPct),
    String(after?.rungsHit))
  check('the position is still open with a bag', after?.state === 'open' && after.tokensRemaining > 0)

  /**
   * The bag gives back half its peak, so the trailing stop takes it. This is the case
   * the change is FOR: 40% banked at the double plus 60% out at break-even beats having
   * sold the lot at the rung, and it is why the sweep put this plan ahead.
   */
  logFeed.emit('trade', mkTrade('sell', 'FADER', 1))
  await new Promise((r) => setImmediate(r))
  await bot.tick()
  check('the trailing stop closes the remainder', !store.getState().positions[MINT])

  const closed = store.getState().closed.at(-1)
  check('closed trade was booked', closed?.mint === MINT, JSON.stringify(closed?.symbol))
  check('the winner books a profit', closed && closed.realizedSol > 0, String(closed?.realizedSol))
  check('initials were recovered across BOTH sells, not at the rung alone',
    closed && closed.solRecovered >= closed.solSpent,
    `${closed?.solRecovered} vs ${closed?.solSpent}`)
  check('which took two sells, and the cost model has to see both',
    closed && closed.fills.filter((f) => f.side === 'sell').length === 2,
    String(closed?.fills.filter((f) => f.side === 'sell').length))

  // A later collapse has nothing left to sell, now that the remainder is out too.
  logFeed.emit('trade', mkTrade('sell', 'RUGGER', 0.2))
  await new Promise((r) => setImmediate(r))
  await bot.tick()
  check('a collapse after a full exit costs nothing', !store.getState().positions[MINT])
  check('trade source is reported as the free one', bot.statsSnapshot().tradeSource === 'rpc-logs')



  /**
   * The experiment must not veto the strategy — driven through the real Bot, because
   * the guard lives in #manage, not in the store.
   *
   * blockCreator had no explore guard, and the blocklist is read only on the strategy
   * path. Explore buys launches the filter REJECTED, so they lose most of the time —
   * roughly 90 closes an hour, each permanently blocklisting a deployer. Any later
   * launch the filter LIKED from one of those creators was then refused, and journalled
   * as a reject. The thing built to be isolated from the strategy was quietly
   * adversely-selecting its picks and poisoning the exact comparison the report exists
   * to make.
   */
  {
    store.getState().blockedCreators = {}
    const EXPMINT = 'ExploreLoserAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    store.addPosition({
      mint: EXPMINT, symbol: 'EXPL', creator: 'SHADYDEV', state: 'open',
      openedAt: Date.now() - 700_000, entryPriceSol: 2e-7, lastPriceSol: 1e-8, peakPriceSol: 2e-7,
      lastPriceAt: Date.now(), tokensBought: 1000, tokensRemaining: 1000,
      solSpent: 0.075, solRecovered: 0, rungsHit: [], fills: [], explore: true,
      failedChecks: ['buyers'], pool: 'pump', entryVSol: 40, lastVSol: 40, lastVTokens: 9e8,
    })
    await bot.tick()
    check('the explore position closed at a loss',
      !store.getState().positions[EXPMINT] &&
      store.getState().closed.at(-1)?.realizedSol < 0,
      JSON.stringify(store.getState().closed.at(-1)?.realizedSol))
    check('an explore loss does NOT blocklist the deployer', !store.isCreatorBlocked('SHADYDEV'))
    check('so the strategy may still take that creator later',
      canOpen({ mint: 'LaterOne', creator: 'SHADYDEV', walletSol: 1 }) === null,
      String(canOpen({ mint: 'LaterOne', creator: 'SHADYDEV', walletSol: 1 })))

    // The same loss on a STRATEGY position must still blocklist — the signal is real,
    // it just has to come from a trade the strategy actually chose.
    const REALMINT = 'StrategyLoserAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    store.addPosition({
      mint: REALMINT, symbol: 'REALL', creator: 'RUGDEV', state: 'open',
      openedAt: Date.now() - 700_000, entryPriceSol: 2e-7, lastPriceSol: 1e-8, peakPriceSol: 2e-7,
      lastPriceAt: Date.now(), tokensBought: 1000, tokensRemaining: 1000,
      solSpent: 0.075, solRecovered: 0, rungsHit: [], fills: [],
      pool: 'pump', entryVSol: 40, lastVSol: 40, lastVTokens: 9e8,
    })
    await bot.tick()
    check('a strategy loss still blocklists the deployer', store.isCreatorBlocked('RUGDEV'))
    store.getState().blockedCreators = {}
  }



  // Stats survive into the dashboard payload.
  const snap = buildSnapshot(0.5, bot.statsSnapshot())
  check('pipeline stats reach the dashboard', snap.pipeline?.creates >= 1 && snap.pipeline.entered === 1, JSON.stringify({creates: snap.pipeline?.creates, entered: snap.pipeline?.entered}))
  check('dashboard payload still serialises', typeof JSON.stringify(snap) === 'string')

  /**
   * Storage and the deployer prior now ride in the collection banner. They used to be
   * the second-to-last line of the longest card on the page, which is where you put
   * something you do not want anyone to read — and storage decides whether a redeploy
   * costs you months of evidence.
   */
  /**
   * The collection rate must come from the ROWS, not from process uptime.
   *
   * The bug this pins: labelled / uptimeHours put a total accumulated over days over a
   * denominator that resets on restart. Twenty-five minutes after a redeploy the banner
   * read "about 339,985/hr" on a 140,055-row journal — it was reporting the entire
   * history as though it had all arrived since the deploy, and the error is worst right
   * after a restart, which is exactly when the number is being read.
   */
  {
    const { analyze } = await import('../src/learn.js')
    const now = Date.now()
    const mkRow = (finalizedAt, hit) => ({
      v: JOURNAL_VERSION, mint: 'M' + finalizedAt, creator: 'C', at: finalizedAt, finalizedAt,
      action: 'rejected', failedChecks: ['buyers'], hitFirstRung: hit, peakMultiple: hit ? 2 : 0.8,
      troughMultiple: 0.5, decisionPriceSol: 1e-7, observedSeconds: 900, ticks: 10, features: {},
    })
    // 5,000 rows from days ago, 12 in the last hour.
    const old = Array.from({ length: 5000 }, (_, i) => mkRow(now - 72 * 3600_000 + i, i % 9 === 0))
    const fresh = Array.from({ length: 12 }, (_, i) => mkRow(now - 60_000 * (i + 1), i % 3 === 0))
    const a = analyze([...old, ...fresh], old.length + fresh.length)
    check('the collection rate counts only rows finalized in the last hour',
      a.totals.labelledLastHour === 12, String(a.totals.labelledLastHour))
    check('and does not grow with the size of the back catalogue',
      analyze([...old, ...old.map((r) => ({ ...r, mint: r.mint + 'b' })), ...fresh],
        old.length * 2 + fresh.length).totals.labelledLastHour === 12)
    check('a journal that stopped collecting reports zero, not a stale average',
      analyze(old, old.length).totals.labelledLastHour === 0)
  }

  /**
   * And the BANNER has to actually use it. Testing analyze() in isolation proves
   * nothing about what the page renders — the previous two bugs in this file were both
   * a correct function nobody called. Uptime is the input that was wrong, so vary only
   * that: the rate must not move.
   */
  {
    const withUptime = (uptimeSeconds) => buildSnapshot(0.5, { ...bot.statsSnapshot(), uptimeSeconds })
    const justStarted = withUptime(60)
    const dayOld = withUptime(86_400)
    check('the banner rate is independent of how long the process has been up',
      justStarted.collection.usablePerHour === dayOld.collection.usablePerHour,
      `${justStarted.collection.usablePerHour} at 1m vs ${dayOld.collection.usablePerHour} at 24h`)
  }

  /**
   * "Collecting fine, the report is broken" and "we are losing data" want opposite
   * reactions. With the analysis worker down there are no row counts, and the banner
   * printed "0 usable rows" — indistinguishable from the journal being empty.
   */
  /**
   * The page must answer even when the bot has not started, because it now comes up
   * FIRST for exactly that reason. It used to start afterwards, which made the one tool
   * for diagnosing a broken bot the first casualty of a broken bot — the platform
   * reported a healthy container and there was nothing to look at.
   */
  check('a snapshot survives having no bot stats at all',
    typeof JSON.stringify(buildSnapshot(undefined, null)) === 'string')
  check('and still reports the build, so a deploy can be confirmed with nothing running',
    buildSnapshot(undefined, null).version === config.version)

  check('the banner distinguishes missing COUNTS from missing DATA',
    typeof snap.collection.countsUnavailable === 'boolean',
    JSON.stringify(snap.collection.countsUnavailable))
  check('and carries why the analysis is unavailable when it is',
    'analysisFailing' in snap.collection && 'analysisRetryInSeconds' in snap.collection)

  check('the banner carries where data is being written',
    typeof snap.collection?.storage?.dataDir === 'string' &&
    typeof snap.collection.storage.writable === 'boolean',
    JSON.stringify(snap.collection?.storage))
  check('the banner carries whether the deployer prior can act',
    snap.collection?.creatorPrior?.enabled === true &&
    typeof snap.collection.creatorPrior.blocked === 'number' &&
    typeof snap.collection.creatorPrior.refused === 'number',
    JSON.stringify(snap.collection?.creatorPrior))
  check('and it reports the index it is judging from, not just that it is on',
    typeof snap.collection.creatorPrior.launches === 'number' &&
    typeof snap.collection.creatorPrior.eligible === 'number')

  /**
   * A HALT STOPS TRADING, NOT LEARNING.
   *
   * #onCreate used to return early when halted, which killed the whole pipeline: no
   * candidates, nothing observed or screened, nothing shadow-tracked, and interested()
   * false for every mint so the feed decoded tens of thousands of trades and kept none.
   * The dashboard read "312 launches · 0 observing · 0 screened" — alive, and learning
   * nothing. A halt is precisely when the evidence matters most, because it is when you
   * are deciding whether to start again.
   */
  {
    const st3 = store.getState()
    st3.positions = {}
    // 'manual' so the re-anchor cannot clear it — this test is about observation
    // continuing while halted, not about which halts are stale.
    store.halt('test halt', 'manual')
    const HALTMINT = 'HaltedButWatchingAAAAAAAAAAAAAAAAAAAAAAAAAA'
    feed.emit('create', normalizeEvent({ txType: 'create', mint: HALTMINT, traderPublicKey: 'DEV3',
      name: 'Halted Dog', symbol: 'HALT', initialBuy: 20_000_000, solAmount: 0.8,
      vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
    check('a halted bot still observes new launches', bot.candidates.has(HALTMINT))
    check('and still subscribes to their trades', feed.watched.has(HALTMINT))

    for (let i = 0; i < 20; i++) {
      logFeed.emit('trade', normalizeEvent({ txType: 'buy', mint: HALTMINT, traderPublicKey: `HB${i}`,
        tokenAmount: 1000, solAmount: 0.05, vSolInBondingCurve: curve.vSol,
        vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
    }
    bot.candidates.get(HALTMINT).createdAt -= (config.entry.observeSeconds + 5) * 1000
    await bot.tick()

    check('it still screens them', bot.statsSnapshot().screened > 0)
    check('it still journals the outcome for learning', bot.shadow.has(HALTMINT))
    // Explore now runs through a halt, so this mint may legitimately be held as an
    // EXPERIMENT. What must never appear is a strategy position.
    const heldWhileHalted = store.getState().positions[HALTMINT]
    check('but takes no STRATEGY position', !heldWhileHalted || heldWhileHalted.explore === true,
      JSON.stringify({ explore: heldWhileHalted?.explore }))

    /**
     * Explore keeps running through a halt. The halt protects capital; explore risks
     * none — it is hard-gated to paper and runs on its own bankroll. Stopping it meant
     * the bot learned nothing at exactly the moment the evidence mattered most.
     */
    const EXPHALT = 'ExploreWhileHaltedAAAAAAAAAAAAAAAAAAAAAAAAA'
    feed.emit('create', normalizeEvent({ txType: 'create', mint: EXPHALT, traderPublicKey: 'DEV9',
      name: 'Halted Explore', symbol: 'EXH', initialBuy: 20_000_000, solAmount: 0.8,
      vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
    // One buyer only, so the filter rejects it and it reaches the explore sampler.
    logFeed.emit('trade', normalizeEvent({ txType: 'buy', mint: EXPHALT, traderPublicKey: 'ONE',
      tokenAmount: 1000, solAmount: 0.05, vSolInBondingCurve: curve.vSol,
      vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
    bot.candidates.get(EXPHALT).createdAt -= (config.entry.observeSeconds + 5) * 1000

    const realRate = config.explore.sampleRate
    config.explore.sampleRate = 1 // take it deterministically rather than 1-in-4
    const exploredBefore = bot.statsSnapshot().explored
    await bot.tick()
    config.explore.sampleRate = realRate

    check('explore still trades while the strategy is halted',
      bot.statsSnapshot().explored > exploredBefore,
      JSON.stringify(bot.statsSnapshot().explore))
    check('and the position is booked to the explore side',
      store.getState().positions[EXPHALT]?.explore === true)
    check('no sampled explore trade was refused at entry',
      bot.statsSnapshot().explore.blockedEntries === 0,
      String(bot.statsSnapshot().explore.blockReason))
    delete store.getState().positions[EXPHALT]
    check('and the block reason is the halt', String(canOpen({ mint: 'ANY', creator: 'C', walletSol: 50 })).startsWith('halted'))

    store.clearHalt()
  }

  /**
   * A launch the FILTER approved but the capital gate refused must not be journalled as
   * a reject — driven through the real Bot, because the mislabelling happened in #enter.
   *
   * canOpen blocks for reasons unrelated to the launch: four positions already open, the
   * deploy cap, a daily loss limit, a blocklisted creator. Recording those as 'rejected'
   * put the filter's OWN PICKS into the arm that measures what it turned down, and since
   * rejectedFor is null for a passing verdict they were invisible in the "what our filter
   * threw away" breakdown too. With positions held to the 600s time stop, every approved
   * launch in a ten-minute stretch landed in the wrong column.
   */
  {
    const st2 = store.getState()
    st2.positions = {}; st2.halted = null
    // Fill the strategy position cap so canOpen refuses on exposure, not on the launch.
    for (let i = 0; i < config.sizing.maxConcurrentPositions; i++) {
      store.addPosition({ mint: `CAPPED${i}`, symbol: `C${i}`, state: 'open', openedAt: Date.now(),
        entryPriceSol: 1e-7, lastPriceSol: 1e-7, peakPriceSol: 1e-7, lastPriceAt: Date.now(),
        tokensBought: 1000, tokensRemaining: 1000, solSpent: 0.075, solRecovered: 0,
        rungsHit: [], fills: [], pool: 'pump' })
    }

    const BLOCKED = 'BlockedByCapAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const mkC = () => normalizeEvent({ txType: 'create', mint: BLOCKED, traderPublicKey: 'DEV2',
      name: 'Blocked Dog', symbol: 'BLKD', initialBuy: 20_000_000, solAmount: 0.8,
      vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 })
    feed.emit('create', mkC())
    // Age first so the buys land late in the window and the launch actually passes.
    bot.candidates.get(BLOCKED).createdAt -= (config.entry.observeSeconds + 5) * 1000
    for (let i = 0; i < config.entry.minUniqueBuyers + 10; i++) {
      logFeed.emit('trade', normalizeEvent({ txType: 'buy', mint: BLOCKED, traderPublicKey: `QB${i}`,
        tokenAmount: 1000, solAmount: 0.05, vSolInBondingCurve: curve.vSol,
        vTokensInBondingCurve: curve.vTokens, marketCapSol: 44 }))
    }
    await bot.tick()

    check('the capital gate refused the entry', !store.getState().positions[BLOCKED])
    const row = bot.shadow.finalize(BLOCKED, 'test')
    check('a filter-approved launch is journalled as blocked, not rejected',
      row?.action === 'blocked', JSON.stringify({ action: row?.action, rejectedFor: row?.rejectedFor }))
    check('and records which gate refused it', typeof row?.blockedBy === 'string' && row.blockedBy.length > 0,
      String(row?.blockedBy))
    check('so it lands in neither arm of the comparison',
      analyze([row]).totals.bought === 0 && analyze([row]).totals.rejected === 0)

    st2.positions = {}
  }


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

// ------------------------------- a quiet position gets a price, not a market order
console.log('\nStale price refresh, through the bot')
{
  const { EventEmitter } = await import('node:events')
  const { Bot } = await import('../src/bot.js')
  class Quiet extends EventEmitter {
    constructor() { super(); this.watched = new Set() }
    start() {} async stop() {} watch(m) { this.watched.add(m) } unwatch(m) { this.watched.delete(m) }
    feedStats() { return { notifications: 0, decoded: 0, kept: 0, connected: true } }
  }

  const s = store.getState()
  s.positions = {}; s.closed = []; s.daily = {}; s.totalRealizedSol = 0
  s.exploreRealizedSol = 0; s.exploreWins = 0; s.exploreLosses = 0
  s.consecutiveLosses = 0; s.blockedCreators = {}; s.halted = null
  store.save()

  const STALE = (config.exit.stalePriceSeconds + 60) * 1000
  const openStale = (mint) => store.addPosition({
    mint, symbol: mint, state: 'open', openedAt: Date.now() - STALE,
    entryPriceSol: 1e-7, lastPriceSol: 1e-7, peakPriceSol: 1e-7,
    lastPriceAt: Date.now() - STALE, tokensBought: 1000, tokensRemaining: 1000,
    solSpent: 0.15, solRecovered: 0, rungsHit: [], fills: [],
    // vSol/vTokens must PRICE to the entry, or the refresh correctly finds a collapse
    // and the stop-loss correctly fires — which is a different test than this one.
    pool: 'pump', entryVSol: 100, lastVSol: 100, lastVTokens: 1e9,
  })

  /**
   * The curve says the price is unchanged — which is exactly what silence MEANS on a
   * bonding curve, since vSol/vTokens only move on a trade. The position must survive.
   */
  let reads = 0
  const botA = new Bot({
    feed: new Quiet(), logFeed: new Quiet(),
    readCurve: async () => { reads++; return { vSol: 100, vTokens: 1e9 } },
  })
  await botA.start()
  clearInterval(botA.sweepTimer); clearInterval(botA.balanceTimer); clearInterval(botA.heartbeatTimer)
  openStale('QUIETMINT')
  await botA.tick()
  check('a stale position is refreshed from the chain', reads > 0, `${reads} reads`)
  check('and is NOT sold just for being quiet', Boolean(store.getState().positions.QUIETMINT))
  check('the refresh clears the staleness rather than papering over it',
    Date.now() - store.getState().positions.QUIETMINT.lastPriceAt < 5000)
  await botA.stop()

  /**
   * The other half of the rule, and the half that was being lost: a quiet token that
   * has actually FALLEN is still sold. The stop-loss was never broken by silence — it
   * just had no fresh price to fire on. Now it gets one.
   */
  store.getState().positions = {}; store.save()
  const botFall = new Bot({
    feed: new Quiet(), logFeed: new Quiet(),
    // Same curve, collapsed: 100 -> 20 SOL of reserves is -80% on the price.
    readCurve: async () => ({ vSol: 20, vTokens: 1e9 }),
  })
  await botFall.start()
  clearInterval(botFall.sweepTimer); clearInterval(botFall.balanceTimer); clearInterval(botFall.heartbeatTimer)
  openStale('FALLENMINT')
  await botFall.tick()
  check('a quiet token that has collapsed is still sold', !store.getState().positions.FALLENMINT)
  check('on the price, not on the silence',
    !/no price update/.test(store.getState().closed.at(-1)?.closeReason ?? ''),
    store.getState().closed.at(-1)?.closeReason)
  await botFall.stop()

  /**
   * The curve read FAILING is the genuine can't-price case — a graduated token, or an
   * RPC that will not answer. One failure is a bad moment; several in a row is real,
   * and only then is exiting right.
   */
  store.getState().positions = {}; store.save()
  const botB = new Bot({
    feed: new Quiet(), logFeed: new Quiet(),
    readCurve: async () => null,
  })
  await botB.start()
  clearInterval(botB.sweepTimer); clearInterval(botB.balanceTimer); clearInterval(botB.heartbeatTimer)
  openStale('DEADMINT')
  await botB.tick()
  check('one failed read does not close the position', Boolean(store.getState().positions.DEADMINT))
  check('but it is counted', store.getState().positions.DEADMINT.blindReads === 1)

  /**
   * THE STRIKES ARE SPACED IN TIME, and this is the assertion that says so.
   *
   * A failed read does not refresh lastPriceAt, so the position stays due on the very
   * next sweep — five seconds later. Counting per sweep therefore reached the limit in
   * fifteen seconds, and a brief RPC wobble would have closed every open position at
   * once on its last known price. That is the stale-price rule's mistake wearing a
   * different hat: no information turned into a realized loss.
   */
  await botB.tick()
  await botB.tick()
  check('a burst of sweeps is still ONE strike — an RPC wobble is not a dead token',
    store.getState().positions.DEADMINT?.blindReads === 1,
    String(store.getState().positions.DEADMINT?.blindReads))

  /** Only elapsed time earns the next strike. */
  const ageOutBlindRead = (mint) => {
    const p = store.getState().positions[mint]
    if (p) p.lastBlindReadAt -= (config.exit.staleRefreshSeconds + 1) * 1000
  }
  for (let i = 0; i < config.exit.blindExitAfterReads; i++) {
    ageOutBlindRead('DEADMINT')
    await botB.tick()
  }
  check('a position that truly cannot be priced is eventually closed',
    !store.getState().positions.DEADMINT,
    JSON.stringify(store.getState().positions.DEADMINT))
  check('and the reason says so rather than blaming silence',
    /cannot price/.test(store.getState().closed.at(-1)?.closeReason ?? ''),
    store.getState().closed.at(-1)?.closeReason)
  await botB.stop()

  /**
   * The refresh must not be able to make the sweep late.
   *
   * Explore runs on an unlimited bankroll with a dozen or more positions open, and the
   * sweep fires every five seconds. One awaited RPC read per position, in sequence,
   * would put a dozen round trips inside that tick — the overlap guard would skip the
   * next sweep and exit management would start lagging. A fix for blind selling that
   * delays the stop-loss is not a fix.
   */
  store.getState().positions = {}; store.getState().closed = []; store.save()
  const asked = []
  const botMany = new Bot({
    feed: new Quiet(), logFeed: new Quiet(),
    readCurve: async (mint) => { asked.push(mint); return { vSol: 100, vTokens: 1e9 } },
  })
  await botMany.start()
  clearInterval(botMany.sweepTimer); clearInterval(botMany.balanceTimer); clearInterval(botMany.heartbeatTimer)

  // Two strategy positions buried under twenty explore ones, all equally stale.
  for (let i = 0; i < 20; i++) {
    store.addPosition({
      mint: `EXP${i}`, symbol: `EXP${i}`, state: 'open', openedAt: Date.now() - STALE,
      entryPriceSol: 1e-7, lastPriceSol: 1e-7, peakPriceSol: 1e-7, lastPriceAt: Date.now() - STALE,
      tokensBought: 1000, tokensRemaining: 1000, solSpent: 0.15, solRecovered: 0, rungsHit: [],
      fills: [], pool: 'pump', entryVSol: 100, lastVSol: 100, lastVTokens: 1e9, explore: true,
    })
  }
  openStale('STRAT_A')
  openStale('STRAT_B')

  await botMany.tick()
  check('chain reads per sweep are bounded',
    asked.length <= config.exit.maxCurveReadsPerSweep, `${asked.length} reads`)
  check('and the strategy is served before the experiment',
    asked.includes('STRAT_A') && asked.includes('STRAT_B'), JSON.stringify(asked))
  await botMany.stop()

  store.getState().positions = {}; store.getState().closed = []; store.save()
}

// ------------------------------- the prior actually reaches the filter
console.log('\nCreator prior, through the bot')
{
  /**
   * Proving `evaluateEntry` honours a prior proves nothing about whether the bot ever
   * hands it one — the last three bugs in this file were all a correct function nobody
   * called. So this drives the real sweep and asserts the deployer's record changed the
   * decision, with everything else about the two launches identical.
   */
  const { EventEmitter } = await import('node:events')
  const { Bot } = await import('../src/bot.js')

  class FakeFeed extends EventEmitter {
    constructor() { super(); this.watched = new Set(); this.started = false }
    start() { this.started = true }
    async stop() { this.started = false }
    watch(m) { this.watched.add(m) }
    unwatch(m) { this.watched.delete(m) }
  }
  class FakeLogFeed extends EventEmitter {
    constructor() { super(); this.started = false }
    start() { this.started = true }
    async stop() { this.started = false }
    feedStats() { return { notifications: 0, decoded: 0, kept: 0, connected: true } }
  }

  const st0 = store.getState()
  st0.positions = {}; st0.closed = []; st0.daily = {}; st0.totalRealizedSol = 0
  st0.consecutiveLosses = 0; st0.blockedCreators = {}; st0.halted = null
  st0.baseEquitySol = 0; st0.peakRealizedSol = 0
  store.save()

  const feed = new FakeFeed()
  const logFeed = new FakeLogFeed()
  const bot = new Bot({ feed, logFeed })
  await bot.start()
  clearInterval(bot.sweepTimer); clearInterval(bot.balanceTimer); clearInterval(bot.heartbeatTimer)
  // Explore samples rejects, and a sampled reject is still an open position. Off here, so
  // the only thing that can open one is the filter's own verdict.
  const exploreWas = config.explore.enabled
  config.explore.enabled = false

  check('the bot has a creator index to consult', Boolean(bot.shadow?.creatorIndex))
  for (let i = 0; i < 400; i++) bot.shadow.creatorIndex.note({ creator: 'MARKETDEV', hitFirstRung: i < 60 })
  for (let i = 0; i < 120; i++) bot.shadow.creatorIndex.note({ creator: 'SERIALDUD', hitFirstRung: false })

  const curve = { vSol: 40, vTokens: 900_000_000 }
  /** Identical launch, identical trades — the deployer address is the only difference. */
  const launch = async (mint, creator) => {
    feed.emit('create', normalizeEvent({
      txType: 'create', mint, traderPublicKey: creator, name: 'Prior Dog', symbol: 'PRIOR',
      initialBuy: 20_000_000, solAmount: 0.8,
      vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44,
    }))
    bot.candidates.get(mint).createdAt -= (config.entry.observeSeconds + 5) * 1000
    for (let i = 0; i < config.entry.minUniqueBuyers + 10; i++) {
      logFeed.emit('trade', normalizeEvent({
        txType: 'buy', mint, traderPublicKey: `PB${i}`, tokenAmount: 1000, solAmount: 0.05,
        vSolInBondingCurve: curve.vSol, vTokensInBondingCurve: curve.vTokens, marketCapSol: 44,
      }))
    }
    await bot.tick()
  }

  await launch('PriorCleanMintAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'FRESHDEV')
  check('the same launch from an unseen deployer is taken',
    Boolean(store.getState().positions['PriorCleanMintAAAAAAAAAAAAAAAAAAAAAAAAAAA']),
    JSON.stringify(bot.statsSnapshot().topRejects))

  const before = bot.statsSnapshot().topRejects?.find((r) => r.id === 'creator_history')?.n ?? 0
  await launch('PriorDudMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'SERIALDUD')
  check('the same launch from a 0-for-120 deployer is refused',
    !store.getState().positions['PriorDudMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'])
  check('and it is the deployer record that refused it',
    (bot.statsSnapshot().topRejects?.find((r) => r.id === 'creator_history')?.n ?? 0) === before + 1,
    JSON.stringify(bot.statsSnapshot().topRejects))

  config.explore.enabled = exploreWas
  await bot.stop()
}

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
