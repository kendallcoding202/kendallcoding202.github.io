import { info, requests, parseL2Book, parseCandles, requireFeeBps } from './hyperliquid.js'
import { observableToll, opportunity, qualify, formatStage0 } from './stage0.js'

/**
 * Stage 0 against a live venue. See PREREG-VENUE.md.
 *
 *   npm run stage0 -- BTC 2.5 1000
 *                     coin  feeBps  sizeUsd
 *
 * The fee and the size are both required: a toll quoted without a size is not a number,
 * and the fee is what the gate divides by. Neither is assumed.
 */
export async function runStage0({ coin, feeBps, sizeUsd, intervalMinutes = 1, lookbackHours = 24 }) {
  const fee = requireFeeBps(feeBps)
  const size = Number(sizeUsd)
  if (!(size > 0)) throw new Error('a size in USD is required — impact is a function of it')

  const endTime = Date.now()
  const startTime = endTime - lookbackHours * 3600_000

  const [bookRaw, candleRaw] = await Promise.all([
    info(requests.l2Book(coin)),
    info(requests.candles(coin, `${intervalMinutes}m`, startTime, endTime)),
  ])

  const book = parseL2Book(bookRaw)
  const closes = parseCandles(candleRaw)
  /**
   * A shape we cannot read is reported as a failure to READ the venue, never as a venue
   * with no opportunity. Those are opposite conclusions and only one of them is ours.
   */
  if (!book) throw new Error('could not read the order book — response shape did not match')
  if (!closes) throw new Error('could not read candles — response shape did not match')

  const toll = observableToll({ bids: book.bids, asks: book.asks, feeBps: fee, sizeUsd: size })
  // Horizons in CANDLES, so they scale with the interval: 1m, 5m, 15m, 1h, 4h at 1m bars.
  const horizons = [1, 5, 15, 60, 240].filter((h) => h < closes.length)
  const opp = opportunity(closes, { horizons, tollBps: toll?.totalBps ?? null })
  const gate = qualify({ toll, opportunity: opp })
  return { coin, toll, opportunity: opp, gate, candles: closes.length }
}

export async function stage0Cli(argv) {
  const [coin, feeBps, sizeUsd] = argv
  if (!coin || feeBps === undefined || sizeUsd === undefined) {
    console.error('\n  usage: npm run stage0 -- <coin> <takerFeeBps> <sizeUsd>')
    console.error('  e.g.:  npm run stage0 -- BTC 2.5 1000')
    console.error('\n  The fee and size are required. A toll quoted without a size is not a number,')
    console.error('  and this codebase already carried a 4pp slip guess unexamined for weeks.\n')
    process.exitCode = 1
    return
  }
  try {
    const r = await runStage0({ coin, feeBps, sizeUsd })
    console.log('\n' + formatStage0(`hyperliquid:${r.coin}`, r.toll, r.opportunity, r.gate))
    console.log(`\n  (${r.candles} candles read)\n`)
  } catch (err) {
    console.error(`\n  stage 0 failed: ${err.message}\n`)
    process.exitCode = 1
  }
}
