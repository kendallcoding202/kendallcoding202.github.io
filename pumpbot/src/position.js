import { config } from './config.js'

/**
 * Pure exit logic: given a position and the current market, decide what to sell and why.
 * No I/O here so the whole exit ladder is testable without touching the chain.
 *
 * Rules are evaluated most-urgent first, and anything that sells the whole remainder
 * short-circuits — once we have decided to get out, we do not also try to work a ladder.
 */
export function decideExit(position, { priceSol, vSol, now = Date.now() }) {
  const none = { sellTokens: 0, sellAll: false, reasons: [], rungs: [] }
  if (position.state === 'closed') return none
  if (!(position.tokensRemaining > 0)) return { ...none, sellAll: true, reasons: ['no tokens left'] }
  if (!(priceSol > 0) || !(position.entryPriceSol > 0)) return none

  const pnlPct = ((priceSol - position.entryPriceSol) / position.entryPriceSol) * 100
  const ageSeconds = (now - position.openedAt) / 1000
  const exitAll = (reason) => ({ sellTokens: position.tokensRemaining, sellAll: true, reasons: [reason], rungs: [] })

  // 0. We have stopped receiving prices for this token. Everything below reasons from
  //    a price, so a stale one silently disables the stop-loss and the trailing stop.
  //    Exiting blind is strictly better than holding blind.
  const priceAgeSeconds = (now - (position.lastPriceAt ?? position.openedAt)) / 1000
  if (priceAgeSeconds >= config.exit.stalePriceSeconds) {
    return {
      sellTokens: position.tokensRemaining,
      sellAll: true,
      reasons: [`no price update in ${Math.round(priceAgeSeconds)}s — exiting blind`],
      rungs: [],
    }
  }

  // 1. The curve is draining. On pump.fun this is the analogue of an LP pull: the SOL
  //    backing the token is leaving, and every second of delay is a worse fill.
  if (position.entryVSol > 0 && Number.isFinite(vSol) && vSol > 0) {
    const dropPct = ((position.entryVSol - vSol) / position.entryVSol) * 100
    if (dropPct >= config.exit.liquidityDropPct) {
      return exitAll(`curve drained ${dropPct.toFixed(0)}% since entry`)
    }
  }

  // 2. Hard stop-loss.
  if (pnlPct <= -config.exit.stopLossPct) {
    return exitAll(`stop-loss at ${pnlPct.toFixed(1)}%`)
  }

  const firstRung = config.exit.ladder[0]?.atPct ?? Infinity
  const hitAnyRung = position.rungsHit.length > 0

  // 3. Time stop — only for positions that never got going. Once a rung is hit we are
  //    riding recovered capital and there is no reason to force an exit on the clock.
  if (!hitAnyRung && ageSeconds >= config.exit.timeStopSeconds) {
    return exitAll(`time stop at ${Math.round(ageSeconds)}s, never reached +${firstRung}%`)
  }

  // 4. Trailing stop on the moon bag, so a round trip from +400% to +20% is not a thing
  //    we sit through.
  if (hitAnyRung && position.peakPriceSol > 0) {
    const fromPeakPct = ((position.peakPriceSol - priceSol) / position.peakPriceSol) * 100
    if (fromPeakPct >= config.exit.trailingDrawdownPct) {
      return exitAll(`gave back ${fromPeakPct.toFixed(0)}% from peak`)
    }
  }

  // 5. Take-profit ladder. A gap up can clear several rungs at once, so collect all of
  //    them rather than selling one per tick and chasing the price down.
  const triggered = config.exit.ladder.filter(
    (rung) => pnlPct >= rung.atPct && !position.rungsHit.includes(rung.atPct),
  )
  if (!triggered.length) return none

  const wanted = triggered.reduce((sum, r) => sum + (position.tokensBought * r.sellPct) / 100, 0)
  const sellTokens = Math.min(wanted, position.tokensRemaining)

  return {
    sellTokens,
    sellAll: sellTokens >= position.tokensRemaining,
    reasons: triggered.map((r) => `+${r.atPct}% rung → sell ${r.sellPct}%`),
    rungs: triggered.map((r) => r.atPct),
  }
}

export function newPosition({ mint, symbol, creator, fill, curve, pool }) {
  return {
    mint,
    symbol: symbol || mint.slice(0, 6),
    creator,
    pool: pool || 'pump',
    state: 'open',
    openedAt: Date.now(),
    entryPriceSol: fill.avgPriceSol,
    tokensBought: fill.tokensReceived,
    tokensRemaining: fill.tokensReceived,
    solSpent: fill.solSpent,
    solRecovered: 0,
    rungsHit: [],
    peakPriceSol: fill.avgPriceSol,
    lastPriceSol: fill.avgPriceSol,
    lastPriceAt: Date.now(),
    entryVSol: curve?.vSol ?? 0,
    fills: [{ side: 'buy', at: Date.now(), tokens: fill.tokensReceived, sol: fill.solSpent, signature: fill.signature }],
  }
}

/** Folds a completed sell back into the position. */
export function applySell(position, fill, reasons) {
  position.tokensRemaining = Math.max(0, position.tokensRemaining - fill.tokensSold)
  position.solRecovered += fill.solReceived
  position.fills.push({
    side: 'sell',
    at: Date.now(),
    tokens: fill.tokensSold,
    sol: fill.solReceived,
    reasons,
    signature: fill.signature,
  })
  return position
}

export function markPrice(position, priceSol) {
  if (!(priceSol > 0)) return position
  position.lastPriceSol = priceSol
  position.lastPriceAt = Date.now()
  if (priceSol > position.peakPriceSol) position.peakPriceSol = priceSol
  return position
}

/** Unrealized + realized, in SOL, as of the last seen price. */
export function positionPnl(position) {
  const markValue = position.tokensRemaining * (position.lastPriceSol || 0)
  const total = position.solRecovered + markValue - position.solSpent
  return {
    realizedSol: position.solRecovered - position.solSpent,
    markValueSol: markValue,
    totalSol: total,
    totalPct: position.solSpent > 0 ? (total / position.solSpent) * 100 : 0,
    initialsRecovered: position.solRecovered >= position.solSpent,
  }
}
