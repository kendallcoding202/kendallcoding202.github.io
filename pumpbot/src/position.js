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

  /**
   * An unusable entry price used to return "no action", which silently disabled every
   * rule below — the stop-loss, the trailing stop, the ladder, all of it — for the life
   * of the position. That is the worst possible default: a corrupt position became an
   * un-exitable one. Get out instead.
   */
  if (!(position.entryPriceSol > 0) || !Number.isFinite(position.entryPriceSol)) {
    return {
      sellTokens: position.tokensRemaining,
      sellAll: true,
      reasons: [`unusable entry price (${position.entryPriceSol}) — exiting rather than holding blind`],
      rungs: [],
    }
  }

  // No current price is different: it is transient, and the stale-price rule above
  // already covers a price that stops arriving for good.
  if (!(priceSol > 0)) return none

  const pnlPct = ((priceSol - position.entryPriceSol) / position.entryPriceSol) * 100
  const ageSeconds = (now - position.openedAt) / 1000
  const exitAll = (reason) => ({ sellTokens: position.tokensRemaining, sellAll: true, reasons: [reason], rungs: [] })

  /**
   * 0. Can we price this position at all?
   *
   * This used to sell on SILENCE, and that was wrong. On a bonding curve the price is
   * vSol/vTokens, and those move only when somebody trades — so no trades means the
   * price has not changed, not that it is unknown. The stop-loss was never "silently
   * disabled"; it simply had not triggered. The rule turned no information into a
   * guaranteed loss, and the log shows it closing positions at -20% and worse for the
   * offence of nobody having traded for three minutes.
   *
   * What IS dangerous is being unable to price the position: a graduated token whose
   * curve account is gone, or an RPC that will not answer. The bot refreshes from the
   * chain when the feed goes quiet (see Bot.#refreshStalePrice), so reaching here means
   * those reads have failed repeatedly and there is genuinely no price to reason from.
   */
  const priceAgeSeconds = (now - (position.lastPriceAt ?? position.openedAt)) / 1000

  /**
   * The curve is CLOSED — graduated. Said separately from a failed read because they are
   * not the same event and should not read the same.
   *
   * This fires on our best trades by construction: filling the bonding curve is what
   * graduation IS, so a position that gets here ran far enough to complete it. Reporting
   * that as "cannot price this position" makes a +127% exit look like a malfunction.
   *
   * Exiting is still right — we cannot see the new venue's price, so we cannot manage
   * the position there — but the reason should say what happened.
   */
  if (position.curveGone) {
    return {
      sellTokens: position.tokensRemaining,
      sellAll: true,
      reasons: ['graduated — bonding curve closed, exiting at the final curve price'],
      rungs: [],
    }
  }

  if ((position.blindReads ?? 0) >= config.exit.blindExitAfterReads) {
    return {
      sellTokens: position.tokensRemaining,
      sellAll: true,
      reasons: [`cannot price this position (${position.blindReads} failed curve reads) — exiting`],
      rungs: [],
    }
  }
  if (config.exit.sellOnStalePrice && priceAgeSeconds >= config.exit.stalePriceSeconds) {
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

  // 3. Time stop — for positions that never got going.
  if (!hitAnyRung && ageSeconds >= config.exit.timeStopSeconds) {
    return exitAll(`time stop at ${Math.round(ageSeconds)}s, never reached +${firstRung}%`)
  }

  /**
   * 3b. A HARD CEILING ON HOLDING, which a bag that has hit a rung previously had none of.
   *
   * The old reasoning was "once a rung is hit we are riding recovered capital, so there
   * is no reason to force an exit on the clock". That was true when the first rung sold
   * 67-100% and the stake really was out. At a 20% rung it recovers 0.30x, so what is
   * actually riding is 80% of real money — and the exemption outlived the premise.
   *
   * The failure it leaves is not theoretical. On a bonding curve the price moves ONLY on
   * a trade, so a token that stops trading holds its last price forever: the trailing
   * stop never sees a giveback, the stop-loss never sees a fall, and with no time stop
   * the position is open indefinitely. It stops appearing to update because nothing is
   * updating. Meanwhile it holds one of a small number of position slots, which now costs
   * real opportunity — the entry rules admit hundreds of candidates a day.
   *
   * On what we can measure, 95% of peaks arrive within ten minutes of the decision and
   * the late ones are no larger (3.65x against 3.53x). THAT EVIDENCE IS BOUNDED BY THE
   * 15-MINUTE OBSERVATION WINDOW and says nothing about an hour, which is why this is
   * set well beyond the window rather than at the measured elbow: it is a backstop
   * against holding a corpse, not a claim about the right time to sell.
   */
  /**
   * A GRADUATED, STILL-PRICED position gets a longer leash, because the backstop above
   * exists for a corpse and this is the opposite of one.
   *
   * The max hold is there because a token that stops trading holds its last price
   * forever, so no price rule can ever fire. That reasoning does not apply once a real
   * venue is quoting the position: the trailing stop is live again and will take it on a
   * giveback. And these are the positions worth being patient with — filling the curve
   * is what graduation IS, so every one of them is a bag that ran. Still bounded, since
   * a flat quote is as unmanageable as no quote.
   */
  const holdLimit = position.offCurve
    ? Math.max(config.exit.maxHoldSeconds, config.exit.offCurveMaxHoldSeconds)
    : config.exit.maxHoldSeconds
  if (holdLimit > 0 && ageSeconds >= holdLimit) {
    return exitAll(`held ${Math.round(ageSeconds / 60)}m — max hold reached, releasing the slot`)
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

/**
 * Smallest holding worth tracking. A pump.fun mint has six decimals, so anything below
 * one base unit cannot be sold and is not a position — it is subtraction error.
 */
const DUST_TOKENS = 1e-6

/**
 * Folds a completed sell back into the position, and RECORDS WHAT THE EXIT ACTUALLY GOT
 * against what the position was marked at.
 *
 * Every model here assumes a sale clears at something like the last price. pump.fun's
 * own Mayhem docs say that need not hold: once the agent's extra billion tokens are in
 * circulation, "there may be some holders who cannot sell their tokens into the bonding
 * curve due to the lack of liquidity". A bag we cannot exit is the one failure the paper
 * book would otherwise report as a clean win, because paperSell always quotes a number.
 *
 * So measure it. Expected is tokens x the mark; got is what came back. The ratio is the
 * only early warning that the exits are not real, and it costs two fields.
 */
export function applySell(position, fill, reasons) {
  const expected = fill.tokensSold * (position.lastPriceSol || 0)
  if (expected > 0) {
    const ratio = fill.solReceived / expected
    position.worstExitRatio = Math.min(position.worstExitRatio ?? Infinity, ratio)
    position.lastExitRatio = Number(ratio.toFixed(4))
  }
  const left = Math.max(0, position.tokensRemaining - fill.tokensSold)
  /**
   * Snap dust to zero. Selling the last of a bag leaves a floating-point residue —
   * measured at 4.7e-10 tokens — which is not sellable but is still greater than zero,
   * so the position stayed open, kept being managed, and eventually exited again on the
   * time stop. That second exit is a real priority fee paid on nothing. It applies to
   * whichever sell empties the position, which with a partial first rung is usually the
   * trailing stop rather than the rung.
   */
  position.tokensRemaining = left < DUST_TOKENS ? 0 : left
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
