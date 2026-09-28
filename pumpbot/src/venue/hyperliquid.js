/**
 * Hyperliquid adapter for Stage 0.
 *
 * SPLIT DELIBERATELY: the parsers are pure and tested against fixtures, the fetch is a
 * thin wrapper that does nothing else. Nothing in this file could be verified against the
 * live endpoint while writing it -- outbound is denied from the analysis environment --
 * and a parser that is quietly wrong does not fail loudly, it invents a number. That is
 * exactly how the off-curve oracle spent four days returning nothing while looking
 * configured, and how 46x and 228x reached a report.
 *
 * So the shapes below are ASSUMPTIONS until a real response proves them. Each parser
 * returns null rather than a guess when the shape does not match, and the runner reports
 * that as a failure to read the venue rather than as a venue with no opportunity.
 */

export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

/**
 * The taker fee is NOT hardcoded.
 *
 * It is the single number the gate divides by, it changes with volume tier and venue
 * policy, and this codebase already carried a 4pp slip guess unexamined for weeks. It is
 * supplied explicitly and echoed in the report so a stale value cannot hide.
 */
export function requireFeeBps(value) {
  const n = Number(value)
  if (!(n >= 0 && n < 1000)) {
    throw new Error('a taker fee in basis points is required (e.g. 2.5) — it is not assumed')
  }
  return n
}

/** {"levels": [[{px,sz,n}...bids], [{px,sz,n}...asks]]} */
export function parseL2Book(raw) {
  const levels = raw?.levels
  if (!Array.isArray(levels) || levels.length < 2) return null
  const side = (arr) =>
    Array.isArray(arr)
      ? arr
          .map((l) => ({ px: Number(l?.px), sz: Number(l?.sz) }))
          .filter((l) => Number.isFinite(l.px) && Number.isFinite(l.sz) && l.px > 0 && l.sz > 0)
      : []
  const bids = side(levels[0])
  const asks = side(levels[1])
  if (!bids.length || !asks.length) return null
  // Bids descend, asks ascend. A book that does not is a shape we do not understand.
  if (bids[0].px >= asks[0].px) return null
  return { bids, asks }
}

/** [{t,T,o,c,h,l,v,n}, ...] -> closes in time order. */
export function parseCandles(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const rows = raw
    .map((k) => ({ t: Number(k?.t), c: Number(k?.c) }))
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.c) && k.c > 0)
  if (rows.length < 2) return null
  rows.sort((a, b) => a.t - b.t)
  return rows.map((r) => r.c)
}

/** ["BTC","ETH",...] from {"universe":[{"name":"BTC",...}]} */
export function parseUniverse(raw) {
  const u = raw?.universe
  if (!Array.isArray(u)) return null
  const names = u.map((a) => a?.name).filter((n) => typeof n === 'string' && n.length)
  return names.length ? names : null
}

/** The only place that touches the network. Everything else is pure. */
export async function info(body, { url = HL_INFO_URL, timeoutMs = 15_000 } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

export const requests = {
  meta: () => ({ type: 'meta' }),
  l2Book: (coin) => ({ type: 'l2Book', coin }),
  candles: (coin, interval, startTime, endTime) => ({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  }),
}
