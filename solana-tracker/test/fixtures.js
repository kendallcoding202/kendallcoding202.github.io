/**
 * Response shapes recorded from the real APIs. Keeping them here means the screening
 * logic can be exercised offline and every threshold change is verified against known
 * inputs before it goes near live money.
 */

const MINT_A = 'A1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MINT_B = 'B2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SOL = 'So11111111111111111111111111111111111111112'

export const MINTS = { MINT_A, MINT_B, SOL }

const HOURS = 3600_000

export function dexPair(overrides = {}) {
  const {
    mint = MINT_A,
    symbol = 'GOODDOG',
    name = 'Good Dog',
    ageHours = 3,
    liquidityUsd = 60_000,
    volume24h = 300_000,
    marketCap = 900_000,
    buys = 800,
    sells = 500,
    priceUsd = 0.00045,
    priceChange1h = 12,
    priceChange24h = 140,
    socials = [{ type: 'twitter', url: 'https://x.com/gooddog' }],
    websites = [{ url: 'https://gooddog.fun' }],
  } = overrides

  return {
    chainId: 'solana',
    dexId: 'raydium',
    url: `https://dexscreener.com/solana/pair-${mint}`,
    pairAddress: `pair-${mint}`,
    baseToken: { address: mint, name, symbol },
    quoteToken: { address: SOL, name: 'Wrapped SOL', symbol: 'SOL' },
    priceUsd: String(priceUsd),
    txns: {
      m5: { buys: 10, sells: 6 },
      h1: { buys: 90, sells: 60 },
      h24: { buys, sells },
    },
    volume: { h24: volume24h, h6: volume24h / 3, h1: volume24h / 12, m5: volume24h / 200 },
    priceChange: { m5: 1, h1: priceChange1h, h6: 60, h24: priceChange24h },
    liquidity: { usd: liquidityUsd, base: 1e9, quote: 200 },
    fdv: marketCap,
    marketCap,
    pairCreatedAt: Date.now() - ageHours * HOURS,
    info: { socials, websites },
  }
}

export function rugcheckReport(overrides = {}) {
  const {
    mintAuthority = null,
    freezeAuthority = null,
    mutable = false,
    rugged = false,
    score = 12,
    risks = [],
    totalHolders = 900,
    totalLPProviders = 3,
    lpLockedPct = 100,
    // Some markets report no lp block at all — the screener must not read that as safe.
    omitLp = false,
    // Ten ordinary holders at 1.5% each -> 15% top-10 concentration.
    topHolders = Array.from({ length: 10 }, (_, i) => ({
      address: `holder-acct-${i}`,
      owner: `holder-owner-${i}`,
      pct: 1.5,
      insider: false,
      pool: false,
    })),
  } = overrides

  return {
    mint: MINT_A,
    creator: 'creator-wallet',
    token: { mintAuthority, freezeAuthority, decimals: 6, supply: '1000000000000000' },
    tokenMeta: { name: 'Good Dog', symbol: 'GOODDOG', mutable },
    topHolders,
    mintAuthority,
    freezeAuthority,
    risks,
    score_normalised: score,
    score,
    totalHolders,
    totalLPProviders,
    totalMarketLiquidity: 60_000,
    rugged,
    markets: [
      {
        pubkey: 'market-1',
        marketType: 'raydium',
        liquidityA: 'vault-a',
        liquidityB: 'vault-b',
        ...(omitLp ? {} : { lp: { lpLocked: 1e9, lpLockedPct, lpTotalSupply: 1e9 } }),
      },
    ],
  }
}

/**
 * Installs a fake global fetch. `scenario` maps a coarse route name to a handler.
 * Returns a restore function plus a log of every call made.
 */
export function mockFetch(scenario) {
  const original = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url)
    let route = 'unknown'
    let detail = null

    if (href.includes('token-profiles') || href.includes('token-boosts')) {
      route = 'discovery'
    } else if (href.includes('dexscreener.com')) {
      route = 'pairs'
      detail = href.split('/').pop().split(',')
    } else if (href.includes('rugcheck.xyz')) {
      route = 'rugcheck'
      detail = href.match(/tokens\/([^/]+)\/report/)?.[1]
    } else if (href.includes('api.telegram.org')) {
      route = 'telegram'
      detail = JSON.parse(init.body)
    } else if (init.method === 'POST') {
      route = 'rpc'
      detail = JSON.parse(init.body)
    }

    calls.push({ route, href, detail })

    const handler = scenario[route]
    if (!handler) return jsonResponse(404, { error: `no mock for ${route} ${href}` })
    const result = await handler(detail, href)
    if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
      return jsonResponse(result.status, result.body)
    }
    return jsonResponse(200, result)
  }

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body ?? null)
    },
  }
}

/** Standard RPC handler: mint with both authorities revoked. */
export function rpcHandler({ mintAuthority = null, freezeAuthority = null, solBalance = 2.5, tokenAccounts = [] } = {}) {
  return (body) => {
    switch (body.method) {
      case 'getAccountInfo':
        return {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            value: {
              data: {
                parsed: {
                  info: { mintAuthority, freezeAuthority, decimals: 6, supply: '1000000000000000' },
                },
              },
            },
          },
        }
      case 'getBalance':
        return { jsonrpc: '2.0', id: body.id, result: { value: Math.round(solBalance * 1e9) } }
      case 'getTokenAccountsByOwner': {
        const programId = body.params?.[1]?.programId
        // Only the classic token program holds anything in these fixtures.
        const accounts = programId?.startsWith('Tokenkeg') ? tokenAccounts : []
        return {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            value: accounts.map((a) => ({
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: a.mint,
                      tokenAmount: { uiAmount: a.amount, decimals: 6, amount: String(a.amount * 1e6) },
                    },
                  },
                },
              },
            })),
          },
        }
      }
      default:
        return { jsonrpc: '2.0', id: body.id, error: { message: `unmocked ${body.method}` } }
    }
  }
}
