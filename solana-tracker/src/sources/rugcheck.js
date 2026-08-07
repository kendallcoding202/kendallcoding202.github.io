import { getJson } from '../http.js'
import { log } from '../util.js'

const BASE = 'https://api.rugcheck.xyz/v1'

/**
 * RugCheck supplies the holder distribution and LP-lock data that is expensive to
 * derive from raw RPC. A failed lookup returns null and the caller MUST treat that as
 * "cannot verify" — we never let an unverifiable token through the filter.
 */
export async function fetchReport(mint) {
  const res = await getJson(`${BASE}/tokens/${mint}/report`, { timeoutMs: 20000, retries: 2 })
  if (!res.ok || !res.data) {
    log.debug(`rugcheck unavailable for ${mint} (status ${res.status})`)
    return null
  }
  return normalize(res.data)
}

function normalize(raw) {
  const risks = Array.isArray(raw.risks) ? raw.risks : []
  const markets = Array.isArray(raw.markets) ? raw.markets : []

  // A token can trade in several pools; the safe reading of "is the LP locked" is the
  // weakest pool that holds meaningful liquidity, not the average.
  let lpLockedPct = null
  for (const m of markets) {
    const pctLocked = Number(m?.lp?.lpLockedPct)
    if (!Number.isFinite(pctLocked)) continue
    if (lpLockedPct === null || pctLocked < lpLockedPct) lpLockedPct = pctLocked
  }

  const holders = Array.isArray(raw.topHolders) ? raw.topHolders : []
  // RugCheck flags pool/vault accounts; excluding them keeps concentration honest.
  const realHolders = holders.filter((h) => !h?.pool && !isLikelyPoolAccount(h, markets))
  const top10Pct = realHolders
    .slice(0, 10)
    .reduce((sum, h) => sum + (Number(h?.pct) || 0), 0)
  const largestPct = realHolders.length ? Number(realHolders[0]?.pct) || 0 : 0
  const insiderPct = realHolders
    .filter((h) => h?.insider)
    .reduce((sum, h) => sum + (Number(h?.pct) || 0), 0)

  return {
    mintAuthority: raw.token?.mintAuthority ?? raw.mintAuthority ?? null,
    freezeAuthority: raw.token?.freezeAuthority ?? raw.freezeAuthority ?? null,
    mutableMetadata: raw.tokenMeta?.mutable === true,
    creator: raw.creator || null,
    rugged: raw.rugged === true,
    score: Number(raw.score_normalised ?? raw.score),
    risks: risks.map((r) => ({
      name: r?.name || 'unknown',
      level: (r?.level || 'info').toLowerCase(),
      description: r?.description || '',
    })),
    totalHolders: Number(raw.totalHolders) || 0,
    totalLpProviders: Number(raw.totalLPProviders) || 0,
    totalMarketLiquidity: Number(raw.totalMarketLiquidity) || 0,
    lpLockedPct,
    top10Pct,
    largestHolderPct: largestPct,
    insiderPct,
    holderCountObserved: realHolders.length,
  }
}

function isLikelyPoolAccount(holder, markets) {
  const owner = holder?.owner
  if (!owner) return false
  return markets.some((m) => m?.pubkey === owner || m?.liquidityA === owner || m?.liquidityB === owner)
}
