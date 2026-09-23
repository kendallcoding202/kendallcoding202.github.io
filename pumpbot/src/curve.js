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
  const kind =
    txTypeRaw === 'create' ? 'create'
    : txTypeRaw === 'sell' ? 'sell'
    : txTypeRaw === 'buy' ? 'buy'
    // Graduation. The payload is minimal — signature, mint, txType, pool — so it must
    // not be required to carry reserves or a price.
    : txTypeRaw === 'migrate' || txTypeRaw === 'migration' ? 'migrate'
    : null
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

/**
 * `realSol` is what the curve can ACTUALLY PAY, and leaving it out was how a paper sale
 * came to book more SOL than existed.
 *
 * virtual_sol_reserves is `PUMP_INITIAL_VIRTUAL_SOL + real_sol_reserves`. The offset
 * shapes the price curve and is not money: a brand-new coin quotes vSol = 30 while
 * holding nothing at all. Pricing off the virtual side is right — the offset cancels on
 * any trade small against the reserves — but the PROCEEDS of a sale come out of the real
 * balance, and nothing was bounding them by it. The constant-product maths alone caps a
 * sale at vSol, so the model would happily hand back 30 SOL from an empty curve.
 *
 * That is not a rounding error on the trades that matter. It is largest exactly where the
 * measured edge lives: a big bag sold into a thin curve is precisely the case where the
 * virtual and real answers diverge most, so every large paper win is the one most likely
 * to be fiction.
 *
 * `capped` says the bound bit, so a fill that reality could not have provided is visible
 * instead of silently smaller.
 */
export function quoteSell({ vSol, vTokens, tokensIn, realSol = null }) {
  if (!(vSol > 0 && vTokens > 0 && tokensIn > 0)) return null
  const k = vSol * vTokens
  const raw = vSol - k / (vTokens + tokensIn)
  if (!(raw > 0)) return null
  // Only bound when we have a real figure. Inventing one would replace a known
  // overstatement with an unknown one.
  const payable = Number.isFinite(realSol) && realSol >= 0 ? realSol : Infinity
  const solOut = Math.min(raw, payable)
  if (!(solOut > 0)) return { solOut: 0, avgPriceSol: 0, nextVSol: vSol, nextVTokens: vTokens + tokensIn, capped: true, wantedSol: raw }
  return {
    solOut,
    avgPriceSol: solOut / tokensIn,
    nextVSol: vSol - solOut,
    nextVTokens: vTokens + tokensIn,
    capped: solOut < raw,
    wantedSol: raw,
  }
}

/** Price impact of a trade, as a positive percentage against you. */
export function priceImpactPct(spotPrice, avgPrice) {
  if (!(spotPrice > 0) || !(avgPrice > 0)) return Infinity
  return Math.abs((avgPrice - spotPrice) / spotPrice) * 100
}

/**
 * Unparsed messages are the single most valuable diagnostic this bot has: a message we
 * cannot read is a trade we cannot count, and the symptom ("no buyers") looks nothing
 * like the cause. So we count them all and keep verbatim samples.
 */
let unknownCount = 0
const unknownSamples = []

export function warnUnknownShape(raw) {
  unknownCount++
  if (unknownSamples.length < 5) {
    const json = JSON.stringify(raw)
    unknownSamples.push(json.slice(0, 600))
    // ERROR, not WARN: this is why nothing trades, and it must not be easy to miss.
    log.error(`UNPARSED feed message #${unknownCount}: ${json.slice(0, 600)}`)
    log.error(`  its keys: ${Object.keys(raw ?? {}).join(', ')}`)
  }
}

export function unknownShapeStats() {
  return { count: unknownCount, samples: unknownSamples }
}
