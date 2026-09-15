import { PublicKey } from '@solana/web3.js'
import { config, LAMPORTS_PER_SOL, PUMP_DECIMALS } from './config.js'
import { log } from './log.js'

/**
 * Decodes pump.fun Anchor events out of Solana transaction logs.
 *
 * Every pump.fun trade emits a self-CPI `Program data: <base64>` log carrying a full
 * TradeEvent struct. Reading those gives us the same three things PumpPortal's metered
 * trade feed gives — the trader address (distinct buyers), the direction (buy/sell
 * ratio), and post-trade reserves (price) — from a single RPC subscription that costs
 * nothing per token.
 *
 * Discriminators are computed, not copied: Anchor's is the first 8 bytes of
 * sha256("event:<Name>"). The TradeEvent value below was verified to match the
 * `vdt/007mYe` prefix observed in real mainnet logs.
 */

// sha256("event:TradeEvent")[0..8]
export const TRADE_EVENT_DISCRIMINATOR = Buffer.from('bddb7fd34ee661ee', 'hex')
// sha256("event:CreateEvent")[0..8]
export const CREATE_EVENT_DISCRIMINATOR = Buffer.from('1b72a94ddeeb6376', 'hex')

const DISC = 8
// mint(32) + solAmount(8) + tokenAmount(8) + isBuy(1) + user(32) + timestamp(8)
// + virtualSolReserves(8) + virtualTokenReserves(8)
const TRADE_BODY = 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8
const TRADE_MIN_LEN = DISC + TRADE_BODY

/**
 * The struct has grown over time (longer payloads are observed on mainnet as fields are
 * appended). We decode the prefix we know and ignore the tail, so an append upstream
 * does not break us — only a reorder would, and that would fail the sanity checks.
 */
export function decodeTradeEvent(data) {
  if (!data || data.length < TRADE_MIN_LEN) return null
  const buf = Buffer.from(data)
  if (!buf.subarray(0, DISC).equals(TRADE_EVENT_DISCRIMINATOR)) return null

  let o = DISC
  const pubkey = () => {
    const k = buf.subarray(o, o + 32)
    o += 32
    return k
  }
  const u64 = () => {
    const v = buf.readBigUInt64LE(o)
    o += 8
    return v
  }

  const mintBytes = pubkey()
  const solAmount = Number(u64()) / LAMPORTS_PER_SOL
  const tokenAmount = Number(u64()) / 10 ** PUMP_DECIMALS
  const isBuy = buf.readUInt8(o) === 1
  o += 1
  const userBytes = pubkey()
  const timestamp = Number(buf.readBigInt64LE(o))
  o += 8
  const vSol = Number(u64()) / LAMPORTS_PER_SOL
  const vTokens = Number(u64()) / 10 ** PUMP_DECIMALS

  // Same principle as the bonding-curve decoder: refuse rather than report nonsense.
  // A layout change must degrade to "no data", never to "wrong prices".
  const plausible =
    vSol > 0.001 && vSol < 100_000 &&
    vTokens > 1 && vTokens < 10_000_000_000 &&
    solAmount >= 0 && solAmount < 100_000 &&
    tokenAmount >= 0

  if (!plausible) return null

  return {
    mint: new PublicKey(mintBytes).toBase58(),
    trader: new PublicKey(userBytes).toBase58(),
    isBuy,
    solAmount,
    tokenAmount,
    timestamp,
    vSol,
    vTokens,
  }
}

/** Pulls every decodable TradeEvent out of one transaction's log array. */
export function tradeEventsFromLogs(logs) {
  if (!Array.isArray(logs)) return []
  const out = []
  for (const line of logs) {
    if (typeof line !== 'string') continue
    const idx = line.indexOf('Program data: ')
    if (idx === -1) continue
    const b64 = line.slice(idx + 'Program data: '.length).trim()
    // Cheap prefix test before paying for a base64 decode on every log line.
    if (!b64.startsWith('vdt/007mYe')) continue
    let decoded
    try {
      decoded = decodeTradeEvent(Buffer.from(b64, 'base64'))
    } catch {
      continue
    }
    if (decoded) out.push(decoded)
  }
  return out
}

/** Shapes a decoded TradeEvent like a feed event, so the bot cannot tell the difference. */
export function toFeedEvent(trade) {
  return {
    kind: trade.isBuy ? 'buy' : 'sell',
    mint: trade.mint,
    trader: trade.trader,
    solAmount: trade.solAmount,
    tokenAmount: trade.tokenAmount,
    traderTokenBalance: undefined, // not in the event; dev holdings tracked by delta
    marketCapSol: undefined,
    vSol: trade.vSol,
    vTokens: trade.vTokens,
    pool: 'pump',
    priceSol: trade.vTokens > 0 ? trade.vSol / trade.vTokens : undefined,
    at: Date.now(),
    source: 'rpc-logs',
  }
}

/** https RPC URL -> wss, so one setting configures both. */
export function rpcWebsocketUrl(httpUrl = config.rpcUrl) {
  try {
    const u = new URL(httpUrl)
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:'
    return u.toString()
  } catch {
    log.warn(`could not derive a websocket URL from ${httpUrl}`)
    return null
  }
}
