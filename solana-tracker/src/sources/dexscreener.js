import { getJson, mapLimit } from '../http.js'
import { chunk, log, isLikelyAddress } from '../util.js'
import { QUOTE_MINTS } from '../config.js'

const BASE = 'https://api.dexscreener.com'

/**
 * Discovery. DexScreener's free endpoints expose recently-listed token profiles and
 * boosted tokens. That covers coins that have gotten far enough to be listed and
 * described — which is exactly the population we want to screen — but it is NOT every
 * pump.fun launch the instant it mints. See README "Coverage limits".
 */
export async function discoverSolanaTokens() {
  const endpoints = [
    `${BASE}/token-profiles/latest/v1`,
    `${BASE}/token-boosts/latest/v1`,
    `${BASE}/token-boosts/top/v1`,
  ]

  const responses = await mapLimit(endpoints, 3, (url) => getJson(url))
  const addresses = new Set()

  for (const [i, res] of responses.entries()) {
    if (!res.ok || !Array.isArray(res.data)) {
      log.warn(`discovery source failed: ${endpoints[i]} (status ${res.status})`)
      continue
    }
    for (const entry of res.data) {
      if (entry?.chainId !== 'solana') continue
      const addr = entry?.tokenAddress
      if (isLikelyAddress(addr) && !QUOTE_MINTS.has(addr)) addresses.add(addr)
    }
  }

  log.info(`discovery: ${addresses.size} candidate Solana mints`)
  return [...addresses]
}

/** Fetch raw pair data for up to 30 mints per call. */
async function fetchRawPairs(mints) {
  const batches = chunk(mints, 30)
  const results = await mapLimit(batches, 3, async (batch) => {
    const res = await getJson(`${BASE}/tokens/v1/solana/${batch.join(',')}`)
    if (res.ok && Array.isArray(res.data)) return res.data
    // Fall back to the older endpoint shape if the newer one is unavailable.
    const legacy = await getJson(`${BASE}/latest/dex/tokens/${batch.join(',')}`)
    if (legacy.ok && Array.isArray(legacy.data?.pairs)) return legacy.data.pairs
    log.warn(`pair fetch failed for batch of ${batch.length} (status ${res.status})`)
    return []
  })
  return results.flat().filter((p) => p && p.chainId === 'solana')
}

/**
 * Each mint's deepest pool, keyed by mint. Screening only ever treats a token as the
 * base asset, and the deepest pool is the one that actually sets its price.
 */
export async function fetchPairsForTokens(mints) {
  const wanted = new Set(mints)
  const byMint = new Map()

  for (const pair of await fetchRawPairs(mints)) {
    const mint = pair.baseToken?.address
    if (!mint || !wanted.has(mint)) continue
    const liq = Number(pair.liquidity?.usd) || 0
    const current = byMint.get(mint)
    if (!current || liq > (Number(current.liquidity?.usd) || 0)) byMint.set(mint, pair)
  }

  return byMint
}

/**
 * Price/liquidity lookup for wallet holdings.
 *
 * Unlike screening, a held token may appear as the *quote* side of its deepest pool —
 * SOL is the obvious case. Keying only on baseToken would silently value those at zero,
 * so we derive the quote-side price from the base's USD price and the native ratio.
 */
export async function fetchPrices(mints) {
  const unique = [...new Set(mints.filter(isLikelyAddress))]
  const wanted = new Set(unique)
  const best = new Map()

  for (const pair of await fetchRawPairs(unique)) {
    const liquidityUsd = Number(pair.liquidity?.usd) || 0
    const baseAddr = pair.baseToken?.address
    const quoteAddr = pair.quoteToken?.address

    if (baseAddr && wanted.has(baseAddr)) {
      consider(best, baseAddr, {
        side: 'base',
        priceUsd: Number(pair.priceUsd) || 0,
        liquidityUsd,
        symbol: pair.baseToken?.symbol || '',
        name: pair.baseToken?.name || '',
        priceChange24h: Number(pair.priceChange?.h24) || 0,
        url: pair.url || '',
      })
    }

    if (quoteAddr && wanted.has(quoteAddr)) {
      const basePriceUsd = Number(pair.priceUsd) || 0
      const basePriceInQuote = Number(pair.priceNative) || 0
      const derived = basePriceInQuote > 0 ? basePriceUsd / basePriceInQuote : 0
      if (derived > 0) {
        consider(best, quoteAddr, {
          side: 'quote',
          priceUsd: derived,
          liquidityUsd,
          symbol: pair.quoteToken?.symbol || '',
          name: pair.quoteToken?.name || '',
          // 24h change on the pair describes the base token, not this one.
          priceChange24h: 0,
          url: pair.url || '',
        })
      }
    }
  }

  return best
}

/** A base-side quote always beats a derived one; otherwise deeper liquidity wins. */
function consider(map, mint, candidate) {
  const current = map.get(mint)
  if (!current) {
    map.set(mint, candidate)
    return
  }
  if (current.side === 'quote' && candidate.side === 'base') {
    map.set(mint, candidate)
    return
  }
  if (current.side === candidate.side && candidate.liquidityUsd > current.liquidityUsd) {
    map.set(mint, candidate)
  }
}

export function summarizePair(pair) {
  const txns24 = pair.txns?.h24 || {}
  const buys = Number(txns24.buys) || 0
  const sells = Number(txns24.sells) || 0
  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol || '?',
    name: pair.baseToken?.name || '',
    dexId: pair.dexId || '',
    pairAddress: pair.pairAddress,
    url: pair.url || `https://dexscreener.com/solana/${pair.pairAddress}`,
    priceUsd: Number(pair.priceUsd) || 0,
    liquidityUsd: Number(pair.liquidity?.usd) || 0,
    marketCapUsd: Number(pair.marketCap) || Number(pair.fdv) || 0,
    volume24hUsd: Number(pair.volume?.h24) || 0,
    volume1hUsd: Number(pair.volume?.h1) || 0,
    priceChange1h: Number(pair.priceChange?.h1) || 0,
    priceChange24h: Number(pair.priceChange?.h24) || 0,
    buys24h: buys,
    sells24h: sells,
    txns24h: buys + sells,
    pairCreatedAt: Number(pair.pairCreatedAt) || 0,
    socials: pair.info?.socials || [],
    websites: pair.info?.websites || [],
  }
}
