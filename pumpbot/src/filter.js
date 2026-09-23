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

    /**
     * THE MAYHEM AGENT, identified by the wallet pump.fun publishes.
     *
     * It trades an opted-in coin "with equal probabilities in a random walk" for the
     * coin's first 24 hours. Zero expected drift, by design and by their own statement
     * that it is "not intended to be a profitable Agent" — so its activity is variance
     * rather than demand, and variance is what our entry rules have been selecting for.
     *
     * Counted separately from organic buying in BOTH directions, because a net seller
     * is the dangerous case: the docs warn that once its extra billion tokens are in
     * circulation, holders may be unable to sell into the curve at all.
     */
    this.agentBuys = 0
    this.agentSells = 0
    this.agentBuySol = 0
    this.agentSellSol = 0

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
    /**
     * THE CURVE AS IT WAS AT LAUCH, kept because `vTokens` above is overwritten by every
     * subsequent trade and the launch value is the one that identifies the token type.
     *
     * A standard pump.fun launch starts from a fixed virtual token reserve. A token
     * deployed under an alternate mode — pump.fun's "Mayhem Mode" is reported to mint a
     * second billion for an AI agent to trade against — would start from a different
     * one, and that difference is visible in the very first event we receive.
     *
     * This matters beyond curiosity because PUMP_TOTAL_SUPPLY is hardcoded at one
     * billion in three places: devHoldPct divides by it, and market cap and price are
     * derived through it. If a token's real supply is double, we overstate the dev's
     * share by 2x and UNDERSTATE its market cap by half — which would place it in
     * exactly the low-cap band the journal says is the profitable one. Recording the
     * launch reserves is what lets that be checked instead of argued about.
     */
    this.launchVTokens = createEvent.vTokens
    this.launchVSol = createEvent.vSol
    /**
     * Has this coin ever priced BELOW its own launch price? A closed curve cannot.
     *
     * Its tokens leave the curve only by being bought out of it and return only by being
     * sold back in, so vTokens can never exceed the launch supply and the launch price is
     * a hard floor. Mayhem breaks that: its extra billion tokens are minted OUTSIDE the
     * curve, so selling them in pushes vTokens past the launch supply and the price under
     * the floor — and buying them back can carry it past where a closed curve completes.
     *
     * This is the structural tell the launch reserves could not give. Extra supply is
     * minted off-curve, so launch reserves look completely ordinary; the giveaway is the
     * BEHAVIOUR. 63.7% of agent-flagged coins price below their own launch price against
     * 13.0% of the rest, and some of that 13% is Mayhem the 30-second agent window
     * missed — which is exactly the false negative this exists to cover.
     */
    this.sawSubLaunchPrice = false
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

    // 5% of slack so a rounding difference between the create event and the first trade
    // cannot flag an ordinary coin. The real signal is a third below the floor, not a
    // fraction of a percent.
    const launchPrice = this.launchVSol > 0 && this.launchVTokens > 0 ? this.launchVSol / this.launchVTokens : 0
    if (launchPrice > 0 && event.priceSol > 0 && event.priceSol < launchPrice * 0.95) {
      this.sawSubLaunchPrice = true
    }

    const isDev = event.trader && event.trader === this.creator
    const isAgent = Boolean(event.trader) && event.trader === config.mayhem.agentWallet
    if (isAgent) {
      if (event.kind === 'buy') { this.agentBuys++; this.agentBuySol += event.solAmount }
      else if (event.kind === 'sell') { this.agentSells++; this.agentSellSol += event.solAmount }
    }

    const ageMs = event.at - this.createdAt
    const windowMs = Math.max(1, config.entry.observeSeconds * 1000)

    if (event.kind === 'buy') {
      this.buys++
      this.buyVolumeSol += event.solAmount
      if (event.trader) {
        this.buyers.add(event.trader)
        /**
         * The agent is not an organic buyer and must not be counted as one. Left in, it
         * inflates the buyer count and the concentration measure with a wallet that is
         * running a coin flip — which is precisely the contamination worth measuring
         * rather than absorbing.
         */
        if (!isDev && !isAgent) {
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

  /** Buyers who are neither the dev nor the Mayhem agent — the number that matters. */
  get organicBuyers() {
    const set = new Set(this.buyers)
    set.delete(this.creator)
    set.delete(config.mayhem.agentWallet)
    return set.size
  }

  /**
   * Did pump.fun's random-walk agent trade this coin at all?
   *
   * DELIBERATELY UNCHANGED. It means what it has always meant — the published agent
   * wallet was seen trading inside our observation window — so the journalled column
   * stays comparable across the whole dataset. Its weakness is known and large: the
   * window is 30 seconds, and an agent that stays quiet through it reads as false.
   */
  get mayhem() {
    return this.agentBuys + this.agentSells > 0
  }

  /**
   * The behavioural test, which does not require catching the agent in the act.
   *
   * A closed curve cannot price below its launch price, so seeing that means tokens are
   * entering the curve that were never bought out of it — which is what Mayhem's extra
   * billion does. Every impossible outcome in the 23 Sep export whose launch reserves we
   * know was an agent-flagged coin (14 of 14, against a 32% base rate), and the price
   * behaviour is the part that survives the agent being quiet.
   */
  get subLaunchPrice() {
    return this.sawSubLaunchPrice
  }

  /**
   * EITHER test firing. This is the one entry should act on.
   *
   * Neither alone is adequate: the agent test misses a quiet agent, and the price test
   * only fires once the agent has been a net seller. Together they catch a coin whose
   * supply is not conserved, which is the property that invalidates every bound this
   * bot reasons with — the appreciation ceiling, the reserve ceiling, the price floor.
   */
  get mayhemLikely() {
    return this.mayhem || this.sawSubLaunchPrice
  }

  /**
   * The agent's NET flow in SOL. Positive means it has been a net buyer so far.
   *
   * The sign matters more than the size: the docs warn that a net SELLER puts its extra
   * billion tokens into circulation, after which "there may be some holders who cannot
   * sell their tokens into the bonding curve due to the lack of liquidity". Our paper
   * fills assume a sale always clears, so that scenario is invisible to every model we
   * have.
   */
  get agentNetSol() {
    return this.agentBuySol - this.agentSellSol
  }

  /** How much of the window's buy volume was the agent rather than a person. */
  get agentBuyShare() {
    const total = this.buyVolumeSol
    return total > 0 ? this.agentBuySol / total : 0
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

  /**
   * The same question with the denominator cleaned up too.
   *
   * topBuyerShare divides by ALL buy volume, which includes the dev's opening buy and —
   * since it was written before any of this was known — the Mayhem agent's coin flips.
   * The numerator already excludes both, so a coin the agent trades heavily has its
   * concentration DILUTED by a wallet that is not a buyer in any meaningful sense.
   *
   * Added alongside rather than folded into the original on purpose. The live threshold
   * was fitted against the old definition on rows that carry it, and silently changing
   * what a column means halfway through a dataset makes every comparison across that
   * boundary quietly wrong. Both are journalled; the scan can say which one predicts.
   */
  get organicTopBuyerShare() {
    const total = [...this.buyerVolume.values()].reduce((sum, v) => sum + v, 0)
    if (!(total > 0)) return 0
    return Math.max(...this.buyerVolume.values()) / total
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

  /**
   * Concentration, as an inverted U rather than a ceiling — see minTopBuyerShare.
   *
   * Below the floor there is nobody with conviction and the launch goes nowhere (0.942x
   * out of sample). Above the ceiling there is nobody but the whale, and nobody to sell
   * to (0.949x). In between is where the runners are.
   */
  const topShare = candidate.topBuyerShare
  checks.push(
    check(
      'buyer_concentration',
      topShare >= e.minTopBuyerShare && topShare < e.maxTopBuyerShare,
      `top buyer is ${(topShare * 100).toFixed(0)}% of volume ` +
        `(want ${(e.minTopBuyerShare * 100).toFixed(0)}-${(e.maxTopBuyerShare * 100).toFixed(0)}%)`,
    ),
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
   * SUPPLY THAT IS NOT CONSERVED — Mayhem mode.
   *
   * Every bound this bot reasons with assumes a coin's tokens leave the curve only by
   * being bought out and return only by being sold back. Mayhem's extra billion is minted
   * outside the curve, so none of them hold: not the appreciation ceiling, not the
   * reserve ceiling, not the launch-price floor. Every physically impossible outcome in
   * the 23 Sep export whose launch reserves we know was one of these.
   *
   * Excluded on RISK, not on measured edge — the flagged rows actually score slightly
   * BETTER than the rest. The problem is that we cannot tell a real price from an
   * unexitable one, and the docs say unexitable is the expected state once the agent
   * turns net seller. Explore keeps buying them, so the evidence accrues either way.
   */
  if (e.rejectMayhem) {
    checks.push(
      check(
        'supply_conserved',
        !candidate.mayhemLikely,
        candidate.mayhem
          ? 'pump.fun mayhem agent is trading this coin'
          : candidate.subLaunchPrice
            ? 'priced below its own launch price — tokens are entering the curve from outside it'
            : 'supply looks conserved',
      ),
    )
  }

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
