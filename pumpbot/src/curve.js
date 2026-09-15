import { PUMP_TOTAL_SUPPLY } from './config.js'
import { log } from './log.js'

/**
 * Normalizes a feed message into one shape.
 *
 * IMPORTANT: the exact field spellings used by the live feed have not been verified
 * against a real connection from this machine, so every field is read through a list of
 * plausible aliases and anything unrecognised is surfaced rather than silently zeroed.
 * Run `npm run record` against the live feed and `npm run replay` to confirm before
 * trusting this in live mode.
 */
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

const nu = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null

  const mint = pick(raw, 'mint', 'mintAddress', 'tokenAddress', 'ca')
  if (!mint) return null

  const txTypeRaw = String(pick(raw, 'txType', 'type', 'action') ?? '').toLowerCase()
  const kind = txTypeRaw === 'create' ? 'create' : txTypeRaw === 'sell' ? 'sell' : txTypeRaw === 'buy' ? 'buy' : null
  if (!kind) return null

  const vSol = nu(pick(raw, 'vSolInBondingCurve', 'virtualSolReserves', 'vSol', 'solReserves'))
  const vTokens = nu(pick(raw, 'vTokensInBondingCurve', 'virtualTokenReserves', 'vTokens', 'tokenReserves'))

  const event = {
    kind,
    mint: String(mint),
    signature: pick(raw, 'signature', 'txSignature', 'sig'),
    trader: pick(raw, 'traderPublicKey', 'trader', 'user', 'owner'),
    solAmount: nu(pick(raw, 'solAmount', 'sol', 'solIn', 'solOut')) ?? 0,
    tokenAmount: nu(pick(raw, 'tokenAmount', 'tokens', 'amount')) ?? 0,
    traderTokenBalance: nu(pick(raw, 'newTokenBalance', 'tokenBalance')),
    marketCapSol: nu(pick(raw, 'marketCapSol', 'marketCap', 'mcapSol')),
    vSol,
    vTokens,
    pool: pick(raw, 'pool') ?? 'pump',
    name: pick(raw, 'name', 'tokenName'),
    symbol: pick(raw, 'symbol', 'ticker'),
    // Only present on create events — the deployer's own opening buy.
    initialBuySol: kind === 'create' ? nu(pick(raw, 'solAmount', 'initialBuySol')) : undefined,
    initialBuyTokens: kind === 'create' ? nu(pick(raw, 'initialBuy', 'initialBuyTokens')) : undefined,
    at: Date.now(),
    raw,
  }

  event.priceSol = priceFromReserves(vSol, vTokens) ?? deriveTradePrice(event)
  return event
}

/** Spot price in SOL per token, straight off the virtual reserves. */
export function priceFromReserves(vSol, vTokens) {
  if (!Number.isFinite(vSol) || !Number.isFinite(vTokens) || vTokens <= 0 || vSol <= 0) return undefined
  return vSol / vTokens
}

/** Fallback: the effective price of the trade itself when reserves are missing. */
function deriveTradePrice(e) {
  if (e.tokenAmount > 0 && e.solAmount > 0) return e.solAmount / e.tokenAmount
  if (Number.isFinite(e.marketCapSol) && e.marketCapSol > 0) return e.marketCapSol / PUMP_TOTAL_SUPPLY
  return undefined
}

/**
 * Constant-product quotes against the bonding curve. Used for paper fills and for
 * sanity-checking a live quote before signing.
 */
export function quoteBuy({ vSol, vTokens, solIn }) {
  if (!(vSol > 0 && vTokens > 0 && solIn > 0)) return null
  const k = vSol * vTokens
  const tokensOut = vTokens - k / (vSol + solIn)
  if (!(tokensOut > 0)) return null
  return {
    tokensOut,
    avgPriceSol: solIn / tokensOut,
    nextVSol: vSol + solIn,
    nextVTokens: vTokens - tokensOut,
  }
}

export function quoteSell({ vSol, vTokens, tokensIn }) {
  if (!(vSol > 0 && vTokens > 0 && tokensIn > 0)) return null
  const k = vSol * vTokens
  const solOut = vSol - k / (vTokens + tokensIn)
  if (!(solOut > 0)) return null
  return {
    solOut,
    avgPriceSol: solOut / tokensIn,
    nextVSol: vSol - solOut,
    nextVTokens: vTokens + tokensIn,
  }
}

/** Price impact of a trade, as a positive percentage against you. */
export function priceImpactPct(spotPrice, avgPrice) {
  if (!(spotPrice > 0) || !(avgPrice > 0)) return Infinity
  return Math.abs((avgPrice - spotPrice) / spotPrice) * 100
}

let warnedUnknown = 0
export function warnUnknownShape(raw) {
  if (warnedUnknown >= 3) return
  warnedUnknown++
  log.warn('feed message did not match any known shape:', JSON.stringify(raw).slice(0, 400))
}
