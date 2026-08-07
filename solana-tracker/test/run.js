// Offline verification of the screening and position logic.
// Run with: npm test
process.env.DRY_RUN = '1'
process.env.LOG_LEVEL = 'error'
process.env.STATE_PATH = '/dev/null'
process.env.CANDIDATE_DELAY_MS = '0'

const { dexPair, rugcheckReport, mockFetch, rpcHandler, MINTS } = await import('./fixtures.js')
const { screenToken } = await import('../src/screener.js')
const { summarizePair } = await import('../src/sources/dexscreener.js')
const { checkPositions, buildDigest } = await import('../src/wallet.js')
const { config } = await import('../src/config.js')

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function failedIds(result) {
  return result.failedGates.map((c) => c.id)
}

/** Screen one token against one rugcheck report + one RPC state. */
async function screen({ pair = {}, report = {}, rpc = {}, rugcheckStatus = 200 } = {}) {
  const mock = mockFetch({
    rugcheck: () =>
      rugcheckStatus === 200 ? rugcheckReport(report) : { status: rugcheckStatus, body: null },
    rpc: rpcHandler(rpc),
  })
  try {
    return await screenToken(summarizePair(dexPair(pair)))
  } finally {
    mock.restore()
  }
}

console.log('\nScreener — a clean token')
{
  const r = await screen()
  check('passes every hard gate', r.failedGates.length === 0, failedIds(r).join(','))
  check('scores 100', r.score === 100, String(r.score))
  check('would alert', r.passed === true)
}

console.log('\nScreener — mechanical rug vectors are hard failures')
{
  const r = await screen({ rpc: { mintAuthority: 'CreatorWallet111' } })
  check('live mint authority blocks the token', !r.passed && failedIds(r).includes('mint_authority'))
}
{
  const r = await screen({ rpc: { freezeAuthority: 'CreatorWallet111' } })
  check('live freeze authority blocks the token', !r.passed && failedIds(r).includes('freeze_authority'))
}
{
  const r = await screen({ report: { lpLockedPct: 12 } })
  check('unlocked LP blocks the token', !r.passed && failedIds(r).includes('lp_locked'))
}
{
  const r = await screen({ report: { omitLp: true } })
  check('missing LP data does not silently pass', !r.passed && failedIds(r).includes('lp_locked'), failedIds(r).join(','))
}
{
  const holders = Array.from({ length: 10 }, (_, i) => ({ pct: i === 0 ? 40 : 2, owner: `o${i}`, insider: false }))
  const r = await screen({ report: { topHolders: holders } })
  check(
    'whale concentration blocks the token',
    !r.passed && failedIds(r).includes('whale') && failedIds(r).includes('top10'),
    failedIds(r).join(','),
  )
}
{
  // 800 buys, 3 sells: you can get in but not out.
  const r = await screen({ pair: { buys: 800, sells: 3 } })
  check('honeypot sell ratio blocks the token', !r.passed && failedIds(r).includes('honeypot'))
}
{
  const r = await screen({ pair: { liquidityUsd: 20_000, volume24h: 4_000_000 } })
  check('wash-trading volume ratio blocks the token', !r.passed && failedIds(r).includes('washtrading'))
}
{
  const r = await screen({ report: { rugged: true } })
  check('already-rugged token is blocked', !r.passed && failedIds(r).includes('rugged'))
}
{
  const r = await screen({
    report: { risks: [{ name: 'Single holder ownership', level: 'danger', description: '' }] },
  })
  check('a danger-level risk flag blocks the token', !r.passed && failedIds(r).includes('risk_flags'))
}
{
  const r = await screen({ report: { score: 78 } })
  check('bad RugCheck score blocks the token', !r.passed && failedIds(r).includes('rug_score'))
}

console.log('\nScreener — fails closed when data is missing')
{
  const r = await screen({ rugcheckStatus: 404 })
  check('unavailable safety report means no alert', !r.passed && failedIds(r).includes('rugcheck'))
}
{
  const mock = mockFetch({
    rugcheck: () => rugcheckReport(),
    rpc: () => ({ status: 500, body: null }),
  })
  const r = await screenToken(summarizePair(dexPair()))
  mock.restore()
  check(
    'unreachable RPC means no alert (cannot verify authorities)',
    !r.passed && failedIds(r).includes('mint_authority'),
    failedIds(r).join(','),
  )
}

console.log('\nScreener — age window')
{
  const r = await screen({ pair: { ageHours: 0.05 } })
  check('too new is skipped', !r.passed && failedIds(r).includes('age'))
  check('too new short-circuits before paid lookups', r.checks.length === 1, `${r.checks.length} checks ran`)
}
{
  const r = await screen({ pair: { ageHours: 72 } })
  check('too old is skipped', !r.passed && failedIds(r).includes('age'))
}

console.log('\nScreener — soft signals reduce the score without blocking')
{
  const r = await screen({ pair: { socials: [], websites: [] } })
  check('no socials still clears the gates', r.failedGates.length === 0, failedIds(r).join(','))
  check('no socials costs score', r.score === 90, String(r.score))
}
{
  const r = await screen({
    pair: { socials: [], websites: [], priceChange1h: -5 },
    report: { mutable: true, totalLPProviders: 1 },
  })
  check('stacked soft failures drop below MIN_SCORE', !r.passed && r.failedGates.length === 0, String(r.score))
}

console.log('\nWallet positions')
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
config.walletAddress = WALLET

async function positions(state, { tokenAccounts, prices, solBalance = 2.5 }) {
  const mock = mockFetch({
    rpc: rpcHandler({ solBalance, tokenAccounts }),
    pairs: (mints) =>
      mints
        .filter((m) => prices[m])
        .map((m) =>
          dexPair({
            mint: m,
            symbol: prices[m].symbol,
            priceUsd: prices[m].priceUsd,
            liquidityUsd: prices[m].liquidityUsd,
          }),
        ),
  })
  try {
    return await checkPositions(state)
  } finally {
    mock.restore()
  }
}

const newState = () => ({ version: 1, alertedTokens: {}, positions: {}, lastDigestDay: null })

{
  const state = newState()
  const accounts = [{ mint: MINTS.MINT_A, amount: 1_000_000 }]
  const prices = {
    [MINTS.MINT_A]: { symbol: 'GOODDOG', priceUsd: 0.001, liquidityUsd: 60_000 },
    [MINTS.SOL]: { symbol: 'SOL', priceUsd: 150, liquidityUsd: 5_000_000 },
  }

  const first = await positions(state, { tokenAccounts: accounts, prices })
  check('new holding is reported as opened', first.alerts.some((a) => a.kind === 'opened'))
  check('SOL is valued but never alerted as a new position', first.totalUsd > 1300, String(first.totalUsd))
  check('baseline recorded', state.positions[MINTS.MINT_A]?.basePrice === 0.001)

  const flat = await positions(state, { tokenAccounts: accounts, prices })
  check('no alert when nothing moved', flat.alerts.length === 0, JSON.stringify(flat.alerts.map((a) => a.kind)))

  prices[MINTS.MINT_A].priceUsd = 0.0014 // +40%
  const up = await positions(state, { tokenAccounts: accounts, prices })
  check('a 40% move alerts', up.alerts.some((a) => a.kind === 'move'))
  check('baseline ratchets to the alerted price', state.positions[MINTS.MINT_A].lastAlertPrice === 0.0014)

  prices[MINTS.MINT_A].priceUsd = 0.00145 // +3.6% from the new baseline
  const small = await positions(state, { tokenAccounts: accounts, prices })
  check('small follow-up move does not re-alert', !small.alerts.some((a) => a.kind === 'move'))

  prices[MINTS.MINT_A].liquidityUsd = 8_000 // pool drained ~87%
  const drain = await positions(state, { tokenAccounts: accounts, prices })
  check('liquidity drain alerts', drain.alerts.some((a) => a.kind === 'liquidity'))

  const gone = await positions(state, { tokenAccounts: [], prices })
  check('disappeared holding alerts as closed', gone.alerts.some((a) => a.kind === 'closed'))
  check('closed holding is dropped from state', state.positions[MINTS.MINT_A] === undefined)
}

{
  const state = newState()
  const accounts = [{ mint: MINTS.MINT_B, amount: 5 }]
  const prices = {
    [MINTS.MINT_B]: { symbol: 'DUST', priceUsd: 0.0001, liquidityUsd: 20_000 },
    [MINTS.SOL]: { symbol: 'SOL', priceUsd: 150, liquidityUsd: 5_000_000 },
  }
  const r = await positions(state, { tokenAccounts: accounts, prices })
  check('dust below the floor is ignored', !r.alerts.some((a) => a.kind === 'opened'))
  check('dust is not tracked in state', state.positions[MINTS.MINT_B] === undefined)
}

{
  // SOL is the quote side of most pools; pricing must not silently value it at zero.
  const state = newState()
  const mock = mockFetch({
    rpc: rpcHandler({ solBalance: 4, tokenAccounts: [] }),
    pairs: () => [
      {
        chainId: 'solana',
        dexId: 'raydium',
        url: 'https://dexscreener.com/solana/x',
        pairAddress: 'x',
        baseToken: { address: MINTS.MINT_B, symbol: 'PEPE', name: 'Pepe' },
        quoteToken: { address: MINTS.SOL, symbol: 'SOL', name: 'Wrapped SOL' },
        priceUsd: '0.30',
        priceNative: '0.002', // 0.002 SOL per PEPE -> SOL = $150
        liquidity: { usd: 900_000 },
        priceChange: { h24: 5 },
        txns: { h24: { buys: 1, sells: 1 } },
        volume: { h24: 1 },
      },
    ],
  })
  const r = await checkPositions(state)
  mock.restore()
  const sol = r.holdings.find((h) => h.mint === MINTS.SOL)
  check('quote-side token is priced, not zeroed', Math.round(sol?.priceUsd ?? 0) === 150, String(sol?.priceUsd))
  check('quote-side value is correct', Math.round(r.totalUsd) === 600, String(r.totalUsd))
}

{
  const mock = mockFetch({ rpc: () => ({ status: 500, body: null }), pairs: () => [] })
  const r = await checkPositions(newState())
  mock.restore()
  check('unreadable wallet degrades instead of reporting an empty portfolio', r.degraded === true)
  check('degraded run emits no closed-position alerts', r.alerts.length === 0)
}

console.log('\nFormatting')
{
  const digest = buildDigest(
    [{ symbol: 'A<b>', valueUsd: 500, priceChange24h: 12, liquidityUsd: 40_000 }],
    500,
  )
  check('digest escapes HTML in token symbols', digest.includes('A&lt;b&gt;'), digest.slice(0, 80))
  check('digest states the PnL caveat', digest.includes('not tracked'))
}
{
  const { formatCandidate } = await import('../src/pipeline.js')
  const r = await screen()
  const msg = formatCandidate(r)
  check('alert carries the mint address', msg.includes(MINTS.MINT_A))
  check('alert carries the risk disclaimer', msg.includes('lose all of it'))
  check('alert fits in one Telegram message', msg.length < 4000, String(msg.length))
}

console.log('\nEnd-to-end scan')
{
  const { runScan } = await import('../src/pipeline.js')
  const CLEAN = 'C1cccccccccccccccccccccccccccccccccccccccc'
  const MINTABLE = 'D2dddddddddddddddddddddddddddddddddddddddd'
  const STALE = 'E3eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

  const scenario = {
    discovery: () => [CLEAN, MINTABLE, STALE].map((tokenAddress) => ({ chainId: 'solana', tokenAddress })),
    pairs: (mints) =>
      mints.map((m) =>
        dexPair({ mint: m, symbol: m.slice(0, 4), ageHours: m === STALE ? 100 : 3 }),
      ),
    rugcheck: () => rugcheckReport(),
    // Only the MINTABLE token still has a live mint authority.
    rpc: (body) => {
      const live = body.params?.[0] === MINTABLE
      return rpcHandler({ mintAuthority: live ? 'CreatorWallet111' : null })(body)
    },
  }

  const state = newState()
  let mock = mockFetch(scenario)
  const sent = await runScan(state)
  mock.restore()

  check('only the clean token alerts', sent === 1, `${sent} sent`)
  check('alerted mint is recorded for dedupe', state.alertedTokens[CLEAN] !== undefined)
  check('rejected mints are not recorded', state.alertedTokens[MINTABLE] === undefined)
  check('stale mint never reached deep screening', state.alertedTokens[STALE] === undefined)

  mock = mockFetch(scenario)
  const again = await runScan(state)
  mock.restore()
  check('second run re-alerts nothing', again === 0, `${again} sent`)
}

{
  const { runScan } = await import('../src/pipeline.js')
  const many = Array.from({ length: 12 }, (_, i) => `F${i}ffffffffffffffffffffffffffffffffffffff`.slice(0, 43))
  const mock = mockFetch({
    discovery: () => many.map((tokenAddress) => ({ chainId: 'solana', tokenAddress })),
    pairs: (mints) => mints.map((m) => dexPair({ mint: m, symbol: m.slice(0, 4) })),
    rugcheck: () => rugcheckReport(),
    rpc: rpcHandler(),
  })
  const sent = await runScan(newState())
  mock.restore()
  check(
    'per-run alert cap holds even when everything passes',
    sent === config.scan.maxAlertsPerRun,
    `${sent} sent, cap ${config.scan.maxAlertsPerRun}`,
  )
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
