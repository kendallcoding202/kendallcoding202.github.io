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
    /**
     * The bag the dev started with, kept separately from the running balance so "how
     * much of it did they sell" is answerable. Without it the only question we can ask
     * is the binary one, and the binary one measurably discriminates nothing.
     */
    this.initialDevTokens = createEvent.initialBuyTokens ?? 0

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

  /**
   * How much of their OWN bag the dev has sold during the window, 0-100.
   *
   * Null when they started with nothing, because then there is no bag to take a
   * percentage of and any answer would be invented. Clamped at zero because a dev who
   * buys MORE during the window has sold a negative fraction of nothing.
   */
  get devSoldPct() {
    if (!(this.initialDevTokens > 0)) return null
    const sold = 1 - this.devTokens / this.initialDevTokens
    return Math.min(100, Math.max(0, sold * 100))
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
/**
 * `creatorPrior` is what CreatorIndex.verdict() returned for this deployer, computed
 * from launches that finalized BEFORE this one existed. Optional: without it the check
 * abstains rather than guessing, so a fresh install with no history behaves exactly as
 * it did before.
 */
export function evaluateEntry(candidate, { creatorPrior = null } = {}) {
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

  /**
   * Floor and ceiling as SEPARATE checks, because as one line they were unreadable.
   *
   * The report said `market_cap` rejected 30,450 launches of which 27.7% would have hit,
   * against an 11.6% base — which looks like the filter throwing away its best material.
   * It was one number covering two opposite failures, and only the scan's own threshold
   * list showed which: `marketCapSol < 3.2` hits at 41.6%. That is the FLOOR, and those
   * launches are not an opportunity — a fresh pump.fun curve is ~28 SOL by construction
   * and only rises, so a 3.2 SOL cap is either a non-standard supply or a bad read, and
   * either way 0.075 SOL into it is buying ~2% of the token at a price impact nothing in
   * the cost model describes.
   *
   * Split, each side can be judged on its own evidence instead of averaging a real
   * ceiling against an artefact.
   */
  const mc = candidate.marketCapSol
  const priced = Number.isFinite(mc)
  const shown = priced ? mc.toFixed(1) : 'n/a'
  checks.push(
    check('market_cap_floor', priced && mc >= e.minMarketCapSol, `${shown} SOL (want ≥ ${e.minMarketCapSol})`),
  )
  checks.push(
    check('market_cap_ceiling', priced && mc <= e.maxMarketCapSol, `${shown} SOL (want ≤ ${e.maxMarketCapSol})`),
  )

  checks.push(
    check(
      'dev_hold',
      candidate.devHoldPct <= e.maxDevHoldPct,
      `dev holds ${candidate.devHoldPct.toFixed(1)}% (want ≤ ${e.maxDevHoldPct}%)`,
    ),
  )

  /**
   * Graduated from a boolean, because as a boolean it was measurably doing nothing.
   *
   * Over the labelled journal it rejected launches at 14.9% against a 15.7% base rate.
   * Indistinguishable, at a sample size where half a point would show — so it was not
   * selecting, it was shrinking the sample and costing entries for free. Same verdict
   * the buy/sell ratio got at 1.4, and the same remedy: keep the degenerate guard, drop
   * the unevidenced part.
   *
   * The degenerate case is a dev DUMPING, and "sold any at all" is not that. A dev
   * trimming a few percent of their own buy is ordinary; a dev unloading half the bag
   * into the first buyers is the exit-scam pattern this check was written for.
   *
   * `devSoldPct` is journalled from here on so the threshold scan can rule on where the
   * cut belongs. It cannot back-fill, so today's 50% is a guard, not a finding — the
   * only claim being made is that it is a better guard than the boolean, which the
   * boolean's own numbers establish.
   */
  const soldPct = candidate.devSoldPct
  const dumping = e.rejectIfDevSold && soldPct !== null && soldPct >= e.maxDevSoldPct
  checks.push(
    check(
      'dev_not_dumping',
      !dumping,
      soldPct === null
        ? 'dev started with no bag to sell'
        : `dev has sold ${soldPct.toFixed(0)}% of their bag (want < ${e.maxDevSoldPct}%)`,
    ),
  )

  /**
   * This deployer's own record, when there is enough of it to mean something.
   *
   * One-sided on purpose. An unknown deployer passes — first-timers are most launches
   * and most winners, so demanding a track record would reject the market itself. This
   * only removes deployers whose most generous reading is still below the market's own
   * hit rate: 0-for-111 and 0-for-102 were both in the first real dataset, next to one
   * running 23% over 126.
   */
  if (e.creatorHistory && creatorPrior) {
    checks.push(
      check(
        'creator_history',
        !creatorPrior.worseThanMarket,
        creatorPrior.known
          ? `${creatorPrior.hits}/${creatorPrior.launches} past launches hit ` +
            `(≤${(creatorPrior.upperBound * 100).toFixed(1)}% vs market ${(creatorPrior.base * 100).toFixed(1)}%)`
          : `only ${creatorPrior.launches} past launches — not enough to judge`,
      ),
    )
  }

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
