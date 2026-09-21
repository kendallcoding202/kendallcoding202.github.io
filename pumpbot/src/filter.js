import { config, PUMP_TOTAL_SUPPLY } from './config.js'

/**
 * Accumulates everything we learn about a freshly-deployed token during its
 * observation window.
 *
 * The deliberate choice here is to NOT buy at deploy. At retail latency the block-zero
 * fill belongs to professional snipers with co-located infrastructure, and buying blind
 * means filling every bundled launch where the "buyers" are all the dev. Watching for
 * OBSERVE_SECONDS costs us the earliest entry and buys the only edge available at this
 * latency: knowing whether anyone real actually showed up.
 */
export class Candidate {
  constructor(createEvent) {
    this.mint = createEvent.mint
    this.creator = createEvent.trader
    this.name = createEvent.name ?? ''
    this.symbol = createEvent.symbol ?? ''
    this.createdAt = createEvent.at
    this.pool = createEvent.pool

    this.buyers = new Set()
    this.sellers = new Set()
    this.buys = 0
    this.sells = 0
    this.buyVolumeSol = 0
    this.sellVolumeSol = 0

    /**
     * Shape of the buying, not just its size.
     *
     * The filter could previously only ask "how many buyers and how much volume". Those
     * two numbers cannot tell fifty wallets apart from one whale buying fifty times, or
     * a launch accelerating apart from one already fading — and a threshold scan can only
     * find an edge in something that was recorded. Rows cannot be back-filled, so a
     * feature added later can never explain data collected today.
     */
    this.buyerVolume = new Map() // trader -> SOL bought, for concentration
    this.firstBuyAt = null // how long the first organic buyer took to show up
    this.earlyBuys = 0 // buys in the first third of the observation window
    this.lateBuys = 0 // buys in the last third — the two give a velocity ratio
    this.flippers = new Set() // wallets that bought and then sold inside the window

    this.devSold = false
    this.devTokens = createEvent.initialBuyTokens ?? 0
    this.devBuySol = createEvent.initialBuySol ?? 0

    this.priceSol = createEvent.priceSol
    this.marketCapSol = createEvent.marketCapSol
    this.vSol = createEvent.vSol
    this.vTokens = createEvent.vTokens
    this.peakMarketCapSol = createEvent.marketCapSol ?? 0
    this.lastEventAt = createEvent.at
  }

  apply(event) {
    this.lastEventAt = event.at
    if (event.priceSol) this.priceSol = event.priceSol
    if (Number.isFinite(event.marketCapSol)) {
      this.marketCapSol = event.marketCapSol
      this.peakMarketCapSol = Math.max(this.peakMarketCapSol, event.marketCapSol)
    }
    if (Number.isFinite(event.vSol)) this.vSol = event.vSol
    if (Number.isFinite(event.vTokens)) this.vTokens = event.vTokens

    const isDev = event.trader && event.trader === this.creator

    const ageMs = event.at - this.createdAt
    const windowMs = Math.max(1, config.entry.observeSeconds * 1000)

    if (event.kind === 'buy') {
      this.buys++
      this.buyVolumeSol += event.solAmount
      if (event.trader) {
        this.buyers.add(event.trader)
        if (!isDev) {
          this.buyerVolume.set(event.trader, (this.buyerVolume.get(event.trader) ?? 0) + event.solAmount)
          if (this.firstBuyAt === null) this.firstBuyAt = ageMs
        }
      }
      // Thirds of the window, so "is this accelerating?" is answerable later.
      if (ageMs <= windowMs / 3) this.earlyBuys++
      else if (ageMs >= (windowMs * 2) / 3) this.lateBuys++
    } else if (event.kind === 'sell') {
      this.sells++
      this.sellVolumeSol += event.solAmount
      if (event.trader) {
        this.sellers.add(event.trader)
        // Bought and sold inside the window: a flipper, not a holder.
        if (this.buyers.has(event.trader) && !isDev) this.flippers.add(event.trader)
      }
      if (isDev) this.devSold = true
    }

    // Trust the reported balance when the feed gives it; otherwise track deltas.
    if (isDev) {
      if (Number.isFinite(event.traderTokenBalance)) this.devTokens = event.traderTokenBalance
      else if (event.kind === 'buy') this.devTokens += event.tokenAmount
      else if (event.kind === 'sell') this.devTokens = Math.max(0, this.devTokens - event.tokenAmount)
    }
  }

  get ageSeconds() {
    return (Date.now() - this.createdAt) / 1000
  }

  get devHoldPct() {
    return (this.devTokens / PUMP_TOTAL_SUPPLY) * 100
  }

  /** Buyers who are not the dev — the number that actually matters. */
  get organicBuyers() {
    const set = new Set(this.buyers)
    set.delete(this.creator)
    return set.size
  }

  /**
   * Share of organic buy volume taken by the single largest buyer.
   *
   * Twenty buyers where one is 90% of the volume is a different launch from twenty
   * roughly equal ones, and the buyer COUNT cannot tell them apart. Whether that
   * difference predicts anything is exactly what the threshold scan is for — but only
   * if it is written down.
   */
  get topBuyerShare() {
    if (!this.buyerVolume.size || !(this.buyVolumeSol > 0)) return 0
    const largest = Math.max(...this.buyerVolume.values())
    return largest / this.buyVolumeSol
  }

  /** Same question, less sensitive to one outlier. */
  get top3BuyerShare() {
    if (!this.buyerVolume.size || !(this.buyVolumeSol > 0)) return 0
    const top = [...this.buyerVolume.values()].sort((a, b) => b - a).slice(0, 3)
    return top.reduce((sum, v) => sum + v, 0) / this.buyVolumeSol
  }

  /** Buys per distinct buyer. High means a few wallets churning, not broad interest. */
  get buysPerBuyer() {
    const n = this.organicBuyers
    return n > 0 ? this.buys / n : 0
  }

  /** Late-window buys over early-window buys. Above 1 means it is still accelerating. */
  get buyAcceleration() {
    if (this.earlyBuys === 0) return this.lateBuys > 0 ? this.lateBuys : 0
    return this.lateBuys / this.earlyBuys
  }

  /** Share of buyers who already sold inside the observation window. */
  get flipRate() {
    const n = this.organicBuyers
    return n > 0 ? this.flippers.size / n : 0
  }

  /** Seconds before the first organic buyer appeared. */
  get secondsToFirstBuy() {
    return this.firstBuyAt === null ? -1 : this.firstBuyAt / 1000
  }
}

const check = (id, pass, detail) => ({ id, pass, detail })

/**
 * Hard entry filter. Every check must pass. There is no soft score here — with real
 * money on a 10-minute horizon, a "probably fine" is a no.
 */
export function evaluateEntry(candidate) {
  const e = config.entry
  const checks = []

  const text = `${candidate.name} ${candidate.symbol}`.toLowerCase()
  const hit = e.bannedWords.find((w) => text.includes(w))
  checks.push(check('naming', !hit, hit ? `name contains "${hit}"` : 'clean'))

  checks.push(
    check('has_symbol', Boolean(candidate.symbol?.trim()), candidate.symbol || 'missing symbol'),
  )

  const buyers = candidate.organicBuyers
  checks.push(
    check('buyers', buyers >= e.minUniqueBuyers, `${buyers} organic buyers (want ≥ ${e.minUniqueBuyers})`),
  )

  // Buy/sell balance: early sellers mean the launch is already being distributed out of.
  const ratio = candidate.sells > 0 ? candidate.buys / candidate.sells : candidate.buys > 0 ? Infinity : 0
  checks.push(
    check(
      'buy_pressure',
      ratio >= e.minBuysPerSell,
      `${candidate.buys}b/${candidate.sells}s = ${Number.isFinite(ratio) ? ratio.toFixed(1) : '∞'}x (want ≥ ${e.minBuysPerSell}x)`,
    ),
  )

  /**
   * Is the buying still accelerating? The strongest signal in the first real dataset:
   * 37.8% [34.1-41.7] above this line against 4.8% below it, on n=619.
   */
  const accel = candidate.buyAcceleration
  checks.push(
    check(
      'fading',
      accel >= e.minBuyAcceleration,
      `late/early buys ${Number.isFinite(accel) ? accel.toFixed(2) : 'n/a'} (want ≥ ${e.minBuyAcceleration})`,
    ),
  )

  const mc = candidate.marketCapSol
  checks.push(
    check(
      'market_cap',
      Number.isFinite(mc) && mc >= e.minMarketCapSol && mc <= e.maxMarketCapSol,
      `${Number.isFinite(mc) ? mc.toFixed(1) : 'n/a'} SOL (want ${e.minMarketCapSol}–${e.maxMarketCapSol})`,
    ),
  )

  checks.push(
    check(
      'dev_hold',
      candidate.devHoldPct <= e.maxDevHoldPct,
      `dev holds ${candidate.devHoldPct.toFixed(1)}% (want ≤ ${e.maxDevHoldPct}%)`,
    ),
  )

  checks.push(
    check(
      'dev_not_selling',
      !(e.rejectIfDevSold && candidate.devSold),
      candidate.devSold ? 'DEV IS SELLING' : 'dev has not sold',
    ),
  )

  // A price we cannot compute is a position we cannot manage an exit on.
  checks.push(
    check(
      'priceable',
      Number.isFinite(candidate.priceSol) && candidate.priceSol > 0 && candidate.vSol > 0 && candidate.vTokens > 0,
      Number.isFinite(candidate.priceSol) ? `${candidate.priceSol.toExponential(3)} SOL/token` : 'no usable price',
    ),
  )

  const failed = checks.filter((c) => !c.pass)
  return {
    pass: failed.length === 0,
    checks,
    failed,
    reason: failed.length ? failed.map((c) => c.id).join(', ') : 'all checks passed',
  }
}
