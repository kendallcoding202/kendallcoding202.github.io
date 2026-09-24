import { config, envReport, ROOT, PUMP_MAX_CURVE_SOL } from './config.js'
import { Feed } from './feed.js'
import { LogFeed } from './logfeed.js'
import { Candidate, evaluateEntry } from './filter.js'
import { buy, sell } from './exec.js'
import { canOpen, riskSummary, rolloverDaily, syncEquityBasis } from './risk.js'
import { buySolFor, buySolForCurve, tooSmallToTrade, tierFor, sizingSummary } from './sizing.js'
import { ShadowTracker, CreatorIndex, saveShadow, loadShadow, journalHealth, volumeSpace } from './journal.js'
import { WalletIndex, saveWallets, loadWallets } from './wallets.js'
import { GraduationTracker, saveGraduations, loadGraduations, baseSanity } from './graduation.js'
import {
  initStore,
  getState,
  save,
  addPosition,
  updatePosition,
  closePosition,
  openPositions,
  explorePositions,
  blockCreator,
  halt,
  logActivity,
  paperWalletSol,
  paperExploreWalletSol,
  topUpPaper,
  recordProbeOrder,
  probeLedger,
  recordStart,
  recordGradProbe,
  gradProbeLedger,
} from './store.js'
import { decideExit, newPosition, applySell, markPrice, positionPnl } from './position.js'
import { getPublicKey, getSolBalance, getAllTokenBalances } from './wallet.js'
import { notifyEntry, notifySell, notifyClose, notifyHalt, notifyStartup, notify } from './notify.js'
import { summaryText, summaryBaseline } from './summary.js'
import { acquire as acquireLock, release as releaseLock } from './lock.js'
import { stopAnalysis } from './analysis.js'
import { readCurveState } from './onchain.js'
import { offCurvePrice, noteOracleCheck, oracleTrusted, oracleHealth } from './offcurve.js'
import { log, sol, esc, utcDay } from './log.js'

/**
 * The trading loop.
 *
 * Watch every deploy, observe each for a window, buy the few that show real organic
 * buying, then manage exits off the live trade feed. Exits are driven by price events
 * rather than a timer, so a rung fires on the tick that crosses it.
 */
/**
 * Split what the wallet holds into real unmanaged positions and rounding dust.
 *
 * A TRADE WE CLOSED IS NOT AN UNMANAGED POSITION. closePosition moves the record to
 * `closed` and deletes it from `positions` (store.js), so checking `positions` alone
 * cannot tell "we sold this and it left a fraction behind" from "we have never seen this
 * mint". Every sell used to floor a six-decimal uiAmount, so essentially every closed
 * trade left dust in its token account -- and this alert reported each of them, forever,
 * as real money with no stop-loss.
 *
 * It cost a working day: the count climbing 5 -> 9 was read as deploys orphaning live
 * positions, and sent us through the volume, the mount path and DATA_DIR, all of which
 * were correct. The dust was from trades that had exited cleanly.
 *
 * Dust is still reported, as cleanup rather than as an emergency: closed trades fall off
 * the end of the retained `closed` list, so their remainder reappears here later with no
 * record left to match it against.
 */
export function classifyHeldTokens(held, state, dustTokens = config.exec.dustTokens) {
  const known = new Set([
    ...Object.keys(state?.positions ?? {}),
    ...(state?.closed ?? []).map((p) => p.mint),
  ])
  const unknown = (held ?? []).filter((t) => !known.has(t.mint))
  return {
    orphans: unknown.filter((t) => t.amount >= dustTokens),
    dust: unknown.filter((t) => t.amount < dustTokens),
  }
}

export class Bot {
  /**
   * `feed` is injectable so the whole loop can be driven by a synthetic feed in tests,
   * and `readCurve` for the same reason — the stale-price refresh is an RPC call, and a
   * test that has to reach the chain to check an exit rule is a test nobody trusts.
   */
  constructor({ feed, logFeed, readCurve = readCurveState, getBalance = getSolBalance } = {}) {
    this.readCurve = readCurve
    // Injected for the same reason readCurve is: the startup balance gate is a rule worth
    // testing, and a test that must reach the chain to exercise it is a test nobody runs.
    this.getBalance = getBalance
    this.feed = feed ?? new Feed()
    this.usingRpcTrades = config.feed.tradeSource === 'rpc'
    // One subscription to the program covers every token, so the per-token tape is
    // not needed at all when this is on.
    this.logFeed =
      logFeed ??
      (this.usingRpcTrades
        ? new LogFeed({
            // Shadow rows MUST be in here. A rejected token leaves `candidates` the
            // instant it is screened, so without this clause it receives no further
            // trades, and its journal row finalizes at peakMultiple 1.0 with zero
            // ticks. That does not read as "no data" — it reads as "every token we
            // rejected went nowhere", which is the filter grading its own homework.
            // The per-mint tape had the equivalent guard at feed.unwatch().
            interested: (mint) =>
              this.candidates.has(mint) ||
              Boolean(getState().positions[mint]) ||
              Boolean(this.shadow?.has(mint)),
            /**
             * Wallets we track, on ANY token — including ones we have never watched,
             * which is the whole point. Those trades were already being decoded and
             * thrown away, so this is a Set lookup, not new work.
             */
            interestedTrader: (trader) => Boolean(this.wallets?.smartSet().has(trader)),
          })
        : null)
    this.candidates = new Map() // mint -> Candidate, pre-entry
    // Built from history at startup so a restart does not forget what each deployer did.
    /**
     * The wallet index is NOT rebuilt from the journal, unlike the creator one: the
     * buyer lists it is built from are deliberately never journalled, so it persists to
     * its own file and accumulates from live observation.
     */
    this.wallets = config.learning.enabled && config.learning.walletPrior ? new WalletIndex() : null
    if (this.wallets) {
      const n = this.wallets.restore(loadWallets())
      if (n) log.info(`wallet prior restored: ${n} wallets with a track record`)
    }
    this.shadow = config.learning.enabled
      ? new ShadowTracker({ creatorIndex: CreatorIndex.fromJournal(), walletIndex: this.wallets })
      : null
    /**
     * THE GRADUATION EXPERIMENT -- a separate hypothesis, sharing this process only
     * because it needs the same feed. It observes and never trades. See
     * PREREG-GRADUATION.md; its rows go to their own file so they cannot be averaged
     * into the launch dataset.
     */
    this.graduations = config.graduation.enabled ? new GraduationTracker() : null
    if (this.graduations) {
      const { restored } = this.graduations.restore(loadGraduations())
      if (restored) log.info(`graduation tracking restored: ${restored} token(s) still inside their 24h window`)
    }
    this.smartTape = [] // live tape of trades by wallets with a proven record
    this.walletSol = 0
    this.lastDay = utcDay()
    this.lastTierFloor = null
    // Spacing for the oracle validation probes — see #refreshStalePrice.
    this.lastOracleCheckAt = 0
    // Set by the dashboard's SOL/USD refresh; only used to cross-check an oracle price.
    this.solPriceUsd = 0
    this.busy = new Set() // mints with an in-flight order, preventing double-sends
    // A sweep awaits network calls, so a 5s interval can start one while the previous
    // is still mid-entry. Overlapping sweeps each read the same pre-buy state, so
    // canOpen passes repeatedly and the position cap is exceeded.
    this.sweeping = false
    this.stopping = false

    /**
     * Pipeline counters. Without these a healthy bot that simply is not finding
     * anything worth buying looks exactly like a hung one — which matters most during
     * the hours of paper running where you are deciding whether to trust it at all.
     */
    this.stats = {
      messages: 0,
      creates: 0,
      trades: 0,
      tradesMatched: 0,
      screened: 0,
      /**
       * Launches that PASSED the filter, as distinct from `screened`.
       *
       * `screened` is incremented by #countReject as well as on the pass path, so it has
       * always meant "decided" — every launch we formed an opinion about. Printed next to
       * `entered` in the heartbeat it reads as "passed screening", and it cost a real
       * misdiagnosis: 146 screened / 0 entered looked like every approved launch being
       * blocked at the capital gate, when it meant no launch had been approved at all.
       */
      passed: 0,
      entered: 0,
      explored: 0,
      rejects: new Map(),
      firstParsedAt: null,
      startedAt: null,
      // Reset each heartbeat so the log shows rate, not just a running total.
      sinceBeat: { messages: 0, creates: 0, screened: 0, passed: 0, entered: 0 },
      costWarned: false,
      // Messages on the METERED per-token trade tape only. Everything else is free.
      meteredMessages: 0,
      // Explore sampling, counted rather than inferred. See #shouldExplore.
      exploreOffered: 0,
      exploreTaken: 0,
      exploreSkips: { disabled: 0, unpriceable: 0, concurrency: 0, noTradeData: 0, bankroll: 0, sampledOut: 0 },
      // Sampled, then refused at the entry gate. The gap between taken and explored.
      exploreBlockedEntries: 0,
      exploreBlockReason: null,
      // Approved launches the CAPITAL gate turned away, by reason. See #enter.
      blockedEntries: new Map(),
      /**
       * How much of what we see is pump.fun's random-walk agent.
       *
       * The agent trades opted-in coins with equal buy/sell probabilities for 24 hours —
       * zero expected drift by design. The two newest entry rules select for exactly
       * what that produces, so "is our edge inside this population or outside it" is the
       * open question, and this is the live read on how big the population even is.
       */
      /** Ticks refused for reporting reserves a live curve cannot hold. See #onTrade. */
      impossibleCurve: 0,
      lastImpossibleCurve: null,
      /** Mayhem-likely candidates DECIDED, and how many entry then refused. */
      mayhemSeen: 0,
      mayhemRefused: 0,
      mayhemScreened: 0,
      mayhemEntered: 0,
      uptimeHours() {
        return this.startedAt ? (Date.now() - this.startedAt) / 3_600_000 : 0
      },
    }
  }

  statsSnapshot() {
    const s = this.stats
    return {
      messages: s.messages,
      creates: s.creates,
      trades: s.trades,
      tradesMatched: s.tradesMatched,
      subscriptions: this.feed.subscriptionStats?.() ?? null,
      tradeSource: this.usingRpcTrades ? 'rpc-logs' : 'pumpportal',
      logFeed: this.logFeed?.feedStats?.() ?? null,
      screened: s.screened,
      /** Passed the filter. `screened` counts every launch DECIDED, rejections included. */
      passed: s.passed,
      entered: s.entered,
      explored: s.explored,
      watching: this.candidates.size,
      shadowTracked: this.shadow?.size ?? 0,
      creatorPrior: this.#creatorPriorStats(),
      walletPrior: this.wallets ? this.wallets.summary() : null,
      smartTape: this.wallets ? [...this.smartTape].reverse().slice(0, 40) : null,
      explore: {
        enabled: config.explore.enabled,
        sampleRate: config.explore.sampleRate,
        offered: s.exploreOffered,
        taken: s.exploreTaken,
        traded: s.explored,
        blockedEntries: s.exploreBlockedEntries,
        blockReason: s.exploreBlockReason,
        skips: { ...s.exploreSkips },
      },
      parsing: s.firstParsedAt !== null,
      uptimeSeconds: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
      topRejects: [...s.rejects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n })),
      /**
       * What the capital gate refused, as opposed to what the filter did. These are
       * launches the strategy WANTED and did not get, which is the only honest answer
       * to "why are we not trading more".
       */
      /**
       * The Mayhem split, live. Until the journal carries enough flagged rows to compare
       * outcomes, this at least answers how much of what we trade is a coin the house is
       * running a random walk on.
       */
      /**
       * Ticks refused for quoting reserves no live curve can hold. Surfaced because the
       * symptom of NOT having this — a bag marked at 228x and sold into that mark — reads
       * as the best trade the bot has ever made.
       */
      impossibleCurve: { count: s.impossibleCurve, last: s.lastImpossibleCurve },
      mayhem: {
        screened: s.mayhemScreened,
        entered: s.mayhemEntered,
        screenedShare: s.screened > 0 ? s.mayhemScreened / s.screened : null,
        enteredShare: s.entered > 0 ? s.mayhemEntered / s.entered : null,
        /** Decided, and refused — the figures that survive entry rejecting them. */
        seen: s.mayhemSeen,
        refused: s.mayhemRefused,
        decided: s.screened + [...s.rejects.values()].reduce((a, b) => a + b, 0),
        rejecting: config.entry.rejectMayhem,
      },
      blockedEntries: [...s.blockedEntries.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, n]) => ({ reason, n })),
      feedCost: this.#feedCost(),
      offCurve: oracleHealth(),
      /** The fill probe's results — the one thing paper cannot measure. See config.probe. */
      probe: config.probe.enabled ? { ...probeLedger(), ...config.probe } : null,
      /** Live handle for the separate graduation experiment. See PREREG-GRADUATION.md. */
      graduationTracker: this.graduations,
    }
  }

  /**
   * Estimated spend on the metered feed. We cannot read the API key's balance, so this
   * is derived from messages received — an estimate, but an observable one, and far
   * better than discovering the wallet drained by watching trades stop.
   */
  #feedCost() {
    const rate = config.feed.costPer10kMessagesSol
    if (!(rate > 0)) return null

    /**
     * Only the PER-TOKEN TRADE TAPE is metered. subscribeNewToken and subscribeMigration
     * are free, and the RPC log feed is free by construction — it is one subscription to
     * the program, billed by nobody.
     *
     * This used to bill `stats.messages`, which is every message from every source. On
     * the free RPC feed that produced an invoice for traffic that costs nothing, warned
     * that it was heading for 2.97 SOL/day, and advised moving to the free RPC feed —
     * which was already in use. It also meant the free feed working WELL made the
     * imaginary bill grow faster, since its trade events were counted too.
     *
     * A cost estimate that fires when there is no cost is worse than no estimate: it
     * trains you to ignore the one alarm that would matter if the metered tape were ever
     * switched back on.
     */
    if (this.usingRpcTrades) return { metered: false, messages: 0, spentSol: 0, perDaySol: 0, warnAtSol: config.feed.costWarnSol }

    const metered = this.stats.meteredMessages
    const spentSol = (metered / 10_000) * rate
    const uptimeH = Math.max(this.stats.uptimeHours(), 1 / 60)
    return {
      metered: true,
      messages: metered,
      spentSol,
      perDaySol: (spentSol / uptimeH) * 24,
      warnAtSol: config.feed.costWarnSol,
    }
  }

  /**
   * What our own journal says about this deployer, or null if we have no index to ask.
   *
   * The index lives on the shadow tracker because that is what maintains it: a launch is
   * only counted once its outcome window has CLOSED, so a row can never be scored using
   * its own result. With learning off there is no index and this returns null, which
   * `evaluateEntry` reads as "no opinion" and skips the check entirely — the filter
   * behaves exactly as it did before the prior existed rather than silently blocking
   * every deployer it cannot look up.
   */
  /**
   * Whether the deployer prior is capable of doing anything, reported rather than
   * assumed. `refused` is the count of entries it has actually blocked this run — the
   * difference between a rule that is switched on and a rule that is working.
   */
  /**
   * A quiet position gets a PRICE, not a market order.
   *
   * The feed only speaks when somebody trades, so a token nobody is trading goes silent
   * while its curve price sits exactly where it was. The bot used to read that silence
   * as blindness and dump the position; it is not blindness, and the curve account says
   * so authoritatively. One RPC read per stale position per sweep, at most four open
   * positions — cheap next to the losses the old rule was booking.
   *
   * Consecutive failures are counted rather than acted on immediately: one timeout is a
   * bad moment, several in a row means the position genuinely cannot be priced (a
   * graduated token's curve account is gone), and only then is exiting right.
   */
  /**
   * Refresh the stale positions, in PARALLEL and BOUNDED.
   *
   * The sweep fires every 5 seconds and iterates every open position — strategy and
   * explore together, and explore runs on an unlimited bankroll with a dozen or more
   * open at a time. Awaiting one RPC read per position in sequence meant a dozen
   * round trips inside a five-second tick: the sweep would run long, the next one would
   * be skipped by the overlap guard, and exit management would start lagging. A fix for
   * blind selling that delays the stop-loss is not a fix.
   *
   * Oldest price first, so the positions most in need of one get the budget, and the
   * strategy ahead of the experiment when they are equally stale.
   */
  async #refreshStalePrices() {
    const now = Date.now()
    const due = openPositions()
      .filter((p) => p.state === 'open')
      .map((p) => ({ p, age: (now - (p.lastPriceAt ?? p.openedAt)) / 1000 }))
      .filter((x) => x.age >= config.exit.staleRefreshSeconds)
      .sort((a, b) => (a.p.explore === b.p.explore ? b.age - a.age : a.p.explore ? 1 : -1))
      .slice(0, config.exit.maxCurveReadsPerSweep)
    if (!due.length) return
    await Promise.all(due.map((x) => this.#refreshStalePrice(x.p)))
  }

  async #refreshStalePrice(position) {
    const { curve, gone } = await this.readCurve(position.mint)
    const price = curve && curve.vTokens > 0 ? curve.vSol / curve.vTokens : null

    /**
     * THE CURVE IS CLOSED, and that is a fact rather than a failure.
     *
     * A graduated token's curve account is gone — or flagged complete — and it is never
     * coming back. Waiting out three spaced retries to conclude that is both slow and
     * misleading: it announces our best trades, the ones that ran far enough to fill the
     * curve, as "cannot price this position", which reads like something broke.
     *
     * Recorded rather than acted on here, so the exit still goes through the one place
     * that decides exits. The price, if we got one, is the FINAL curve price and is
     * worth keeping — it is what the position is worth at the moment it stopped trading
     * where we can see it.
     */
    if (gone) {
      /**
       * CAN WE STILL SEE IT? Graduation is the moment the bag has run furthest, so
       * dumping it here truncates exactly the tail the strategy is paid for. If the
       * off-curve oracle has EARNED trust against live curve prices, the position keeps
       * being managed on the new venue instead of being closed for lack of a number.
       */
      const offCurve = oracleTrusted() ? await offCurvePrice(position.mint, this.solPriceUsd) : null
      if (offCurve?.priceSol > 0) {
        const patch = {
          curveGone: false,
          offCurve: true,
          venue: offCurve.venue,
          lastPriceSol: offCurve.priceSol,
          lastPriceAt: Date.now(),
          blindReads: 0,
          lastBlindReadAt: 0,
        }
        updatePosition(position.mint, patch)
        Object.assign(position, patch)
        markPrice(position, offCurve.priceSol)
        log.info(`${position.symbol}: graduated to ${offCurve.venue} — still priced, still managed`)
        return
      }

      const patch = { curveGone: true }
      if (price > 0) {
        patch.lastPriceSol = price
        patch.lastPriceAt = Date.now()
        patch.lastVSol = curve.vSol
        patch.lastVTokens = curve.vTokens
        // The MEASURED real balance, which only a curve-account read carries — a trade
        // event has the virtual reserves alone. It is what bounds a sale's proceeds.
        if (Number.isFinite(curve.realSol)) patch.lastRealSol = curve.realSol
      }
      updatePosition(position.mint, patch)
      Object.assign(position, patch)
      log.info(`${position.symbol}: bonding curve closed — graduated, exiting at the last curve price`)
      return
    }

    if (!(price > 0)) {
      /**
       * SPACED IN TIME, not counted per sweep.
       *
       * A failed read does not touch lastPriceAt, so the position stays "due" on the
       * very next sweep — which meant three failures took FIFTEEN SECONDS, not three
       * genuine attempts spread over minutes. A brief RPC wobble would therefore close
       * every open position at once, on the last price seen, for the offence of the
       * endpoint being slow. That is the stale-price rule's mistake with a shorter fuse:
       * no information converted into a realized loss.
       *
       * The counter is meant to distinguish "one bad moment" from "this genuinely cannot
       * be priced", and only elapsed time can tell those apart. One strike per refresh
       * interval, so reaching the limit means the reads have been failing for
       * blindExitAfterReads x staleRefreshSeconds of real time.
       */
      const now = Date.now()
      const lastTry = position.lastBlindReadAt ?? 0
      if (now - lastTry < config.exit.staleRefreshSeconds * 1000) return

      const blindReads = (position.blindReads ?? 0) + 1
      updatePosition(position.mint, { blindReads, lastBlindReadAt: now })
      position.blindReads = blindReads
      position.lastBlindReadAt = now
      log.debug(`curve read failed for ${position.symbol} (${blindReads} in a row)`)
      return
    }

    /**
     * THE SAME REFUSAL AS THE TICK PATH. Half-applying it is worse than not applying it.
     *
     * #onTrade refuses a reserve figure no live curve can hold, but this path did not —
     * so a coin whose supply is not conserved was refused a price from its trades and
     * then handed one by the next curve read, which is the fantasy mark arriving by a
     * different door. The decoder's own bound is 100,000 SOL, far past anything possible,
     * so nothing else was going to stop it.
     */
    if (Number.isFinite(curve.vSol) && curve.vSol > PUMP_MAX_CURVE_SOL) {
      this.stats.impossibleCurve++
      this.stats.lastImpossibleCurve = { mint: position.mint, symbol: position.symbol, vSol: curve.vSol, at: Date.now() }
      log.debug(`${position.symbol}: curve read reports ${curve.vSol.toFixed(1)} SOL — refusing to price it`)
      return
    }

    updatePosition(position.mint, {
      lastPriceSol: price,
      lastPriceAt: Date.now(),
      lastVSol: curve.vSol,
      lastVTokens: curve.vTokens,
      // A good read clears the streak — the test is CONSECUTIVE failures. The timestamp
      // goes with it, so the next failure starts a fresh interval rather than inheriting
      // an old one and counting twice in quick succession.
      blindReads: 0,
      lastBlindReadAt: 0,
    })
    position.lastPriceSol = price
    position.lastPriceAt = Date.now()
    position.lastVSol = curve.vSol
    position.lastVTokens = curve.vTokens
    if (Number.isFinite(curve.realSol)) position.lastRealSol = curve.realSol
    position.blindReads = 0
    position.lastBlindReadAt = 0

    /**
     * PROVE THE ORACLE AGAINST GROUND TRUTH WE ALREADY HOLD.
     *
     * The off-curve price source could not be verified while it was written — the shape
     * of a response nobody can fetch is a guess, and a price parser that is quietly
     * wrong does not fail loudly, it invents a number and closes positions with it.
     *
     * But a token still ON its curve has a price we know exactly. So every so often,
     * ask the oracle for a token we can already price and compare. Agreement means it is
     * reading the right field of the right object for the right token, which is all
     * three ways this goes wrong. It runs in production against live data because that
     * is the only place it can run at all.
     */
    if (config.exit.offCurvePricing && !oracleTrusted() &&
        Date.now() - this.lastOracleCheckAt >= config.exit.oracleCheckSeconds * 1000) {
      this.lastOracleCheckAt = Date.now()
      const probe = await offCurvePrice(position.mint, this.solPriceUsd)
      if (probe?.priceSol > 0) noteOracleCheck(position.mint, price, probe.priceSol)
    }
  }

  /**
   * A live tape of what the wallets with a proven record are doing.
   *
   * The index says WHO is worth watching; this says what they are doing right now. It
   * is a Set lookup per trade, not a verdict computation — the feed carries every
   * pump.fun trade and putting statistics on that path would be the same mistake as
   * running the analysis on the event loop.
   *
   * COVERAGE IS PARTIAL, deliberately. The log feed only decodes trades for mints we
   * are already interested in — candidates, open positions, shadow rows — so this shows
   * smart-wallet activity on launches inside our pipeline, not everything they do
   * anywhere. Subscribing to the whole program's trade flow to catch the rest would
   * cost far more than the feature is worth.
   */
  #noteSmartMoney(event, candidate) {
    if (!this.wallets || !event?.trader) return
    if (!this.wallets.smartSet().has(event.trader)) return
    const known = Boolean(candidate) || Boolean(getState().positions[event.mint]) ||
      Boolean(this.shadow?.has(event.mint))
    this.smartTape.push({
      at: event.at ?? Date.now(),
      wallet: event.trader,
      mint: event.mint,
      symbol: candidate?.symbol ?? getState().positions[event.mint]?.symbol ?? null,
      kind: event.kind === 'sell' ? 'sell' : 'buy',
      solAmount: Number(event.solAmount) || 0,
      ageSeconds: candidate ? Math.round(candidate.ageSeconds) : null,
      /**
       * A token the bot is NOT already following. These are the discovery cases — the
       * only ones that could tell us about something our own pipeline missed — and
       * they are invisible unless marked, because on the tape they look identical to
       * a confirmation on a launch we were already screening.
       */
      unseen: !known,
    })
    // Display state, bounded hard — this is a tape, not a record.
    if (this.smartTape.length > 120) this.smartTape = this.smartTape.slice(-120)
  }

  #creatorPriorStats() {
    if (!config.entry.creatorHistory) return { enabled: false }
    const idx = this.shadow?.creatorIndex
    if (!idx) return { enabled: true, indexed: false }
    return {
      enabled: true,
      indexed: true,
      ...idx.summary({ minLaunches: config.entry.minCreatorLaunches }),
      refused: this.stats.rejects.get('creator_history') ?? 0,
    }
  }

  #creatorPrior(creator) {
    return (
      this.shadow?.creatorIndex?.verdict(creator, {
        minLaunches: config.entry.minCreatorLaunches,
      }) ?? null
    )
  }

  #countReject(verdict) {
    this.stats.screened++
    this.stats.sinceBeat.screened++
    for (const c of verdict?.failed ?? []) {
      this.stats.rejects.set(c.id, (this.stats.rejects.get(c.id) ?? 0) + 1)
    }
  }

  #heartbeat() {
    const s = this.stats
    const beat = s.sinceBeat

    /**
     * IS THE JOURNAL ACTUALLY BEING WRITTEN? Checked first, because everything else this
     * heartbeat reports is about trading and this is about whether any of it is being
     * remembered.
     *
     * A failed append was caught inside journal.append and logged to stdout, which on a
     * hosted box nobody reads. So a full volume meant every row silently failing while
     * the bot traded on and the dashboard stayed green — the storage check tests
     * permissions, and a disk with no space left is still permissioned to write.
     *
     * The journal is the only copy of everything gathered, and the deployer and wallet
     * priors are rebuilt from it at every startup. Alerted ONCE per outage rather than
     * per beat: a channel that repeats itself every minute gets muted, and this is the
     * message that must not be.
     */
    const writes = journalHealth()
    if (writes.consecutive > 0 && !this.journalAlerted) {
      this.journalAlerted = true
      log.error(`JOURNAL NOT BEING WRITTEN — ${writes.consecutive} consecutive failures: ${writes.lastError}`)
      notify(
        `🚨 <b>The journal is not being written</b>\n` +
          `${writes.consecutive} consecutive failed writes — <code>${esc(String(writes.lastError))}</code>\n` +
          `Everything gathered from here is being LOST and cannot be recovered. ` +
          `Most likely the volume at <code>${esc(config.dataDir)}</code> is full.`,
      )
    } else if (writes.consecutive === 0 && this.journalAlerted) {
      this.journalAlerted = false
      notify('✅ <b>Journal writes recovered</b> — rows are landing again. Anything lost during the outage is still lost.')
    }

    /**
     * And the warning BEFORE any of that, which is the half worth having.
     *
     * The alert above fires once rows are already being lost. This one fires while there
     * is still room to do something — raise the volume, turn on rotation, take a backup.
     * Latched, so it is said once per crossing rather than every beat.
     */
    const vol = volumeSpace()
    if (vol && vol.usedPct >= config.volumeWarnPct && !this.volumeAlerted) {
      this.volumeAlerted = true
      const gb = (b) => (b / 1e9).toFixed(2)
      log.warn(`data volume ${vol.usedPct.toFixed(0)}% full — ${gb(vol.freeBytes)} GB left`)
      notify(
        `⚠️ <b>Data volume ${vol.usedPct.toFixed(0)}% full</b>\n` +
          `${gb(vol.freeBytes)} GB left of ${gb(vol.totalBytes)} GB at <code>${esc(config.dataDir)}</code>\n` +
          `When it fills, journal rows are lost silently and cannot be recovered.`,
      )
    } else if (vol && vol.usedPct < config.volumeWarnPct - 5 && this.volumeAlerted) {
      // Five points of hysteresis, so hovering at the threshold does not flap.
      this.volumeAlerted = false
    }

    // Messages arriving but nothing parsing means the feed's field names moved.
    if (s.messages > 50 && s.creates === 0 && s.trades === 0) {
      log.error(
        `${s.messages} feed messages received but NONE parsed — the field names in src/curve.js ` +
          'do not match this feed. Run `npm run record -- 120` and `npm run replay`. Not trading.',
      )
      return
    }

    if (!s.messages) {
      log.warn('no feed messages at all — the socket is connected but silent')
      return
    }

    const subs = this.feed.subscriptionStats?.()

    // Launches arriving with no per-token trades means our trade subscriptions are not
    // being served — which looks exactly like "a quiet market" from the filter's side,
    // because every candidate then shows zero buyers and can never pass.
    if (s.creates > 40 && s.tradesMatched === 0) {
      log.error(
        `${s.creates} launches seen but ZERO trade events matched a watched token ` +
          `(${s.trades} trade events total, ${subs?.watched ?? '?'} subscriptions). ` +
          'Entry is impossible in this state — every candidate scores 0 buyers.',
      )
      // Show exactly what we sent, so the payload can be checked against the docs.
      log.error(`last subscribe payload: ${JSON.stringify(subs?.lastSubscribe ?? null)}`)
    }

    // Metered feed: say something before the funding is gone, not after.
    const cost = this.#feedCost()
    if (cost?.metered && !s.costWarned && cost.spentSol >= cost.warnAtSol) {
      s.costWarned = true
      log.error(
        `Estimated feed spend ${cost.spentSol.toFixed(4)} SOL from ${cost.messages} messages ` +
          `(~${cost.perDaySol.toFixed(2)} SOL/day at this rate). Top up the API key, lower ` +
          'MAX_WATCHED_MINTS, or switch to the free RPC log feed.',
      )
      notify(
        `💸 <b>Metered feed spend ~${cost.spentSol.toFixed(4)} SOL</b>\n` +
          `${cost.messages.toLocaleString()} messages · ~<b>${cost.perDaySol.toFixed(2)} SOL/day</b> at this rate\n` +
          'Top up the PumpPortal key, lower MAX_WATCHED_MINTS, or move to the free RPC feed.',
      ).catch(() => {})
    }

    const rejects = this.statsSnapshot().topRejects
    log.info(
      `+${beat.creates} launches (${s.creates} total) · watching ${this.candidates.size} · ` +
        `trades ${s.tradesMatched}/${s.trades} matched · subs ${subs?.watched ?? '?'}` +
        (subs?.dropped ? ` (${subs.dropped} dropped)` : '') + ' · ' +
        `decided +${beat.screened}/${s.screened} · passed +${beat.passed}/${s.passed} · ` +
        `entered +${beat.entered}/${s.entered} · ` +
        `open ${openPositions().length} · shadow ${this.shadow?.size ?? 0}` +
        (rejects.length ? ` · rejects: ${rejects.map((r) => `${r.id}×${r.n}`).join(' ')}` : ''),
    )

    /**
     * THE PROBE'S RESULTS, IN THE LOG.
     *
     * probeLedger() was reachable only through statsSnapshot and therefore only through
     * the dashboard — and the probe is precisely the deployment that has no dashboard,
     * because exposing a live wallet's positions on a public URL needs a token and the
     * right call is not to expose it at all. So the one measurement this bot spends real
     * money to produce was being recorded and never shown.
     *
     * `attempts` against `trades` is the fill rate: orders sent versus positions opened.
     * The median fill ratio is the latency slip — what we actually paid over what we were
     * quoted — which is the largest term in the cost model and the only one never
     * observed. Both belong where a live run can be read from, which is the log.
     */
    if (config.probe.enabled) {
      const p = probeLedger()
      /*
       * Only samples from THIS build are averaged together.
       *
       * A fill ratio is comparable only to others taken under the same execution code.
       * Mixing builds is how a median of six samples reported 21.98% slip while
       * containing two paper fills and three measured by the pre-fix entry-price bug --
       * a number with no referent, reported to four decimal places. Older samples are
       * still counted and shown, so the sample is never silently narrowed.
       */
      const all = (p.fillRatios ?? []).filter((x) => Number.isFinite(x?.r))
      const mine = all.filter((x) => x.build === config.version).map((x) => x.r).sort((a, b) => a - b)
      const stale = all.length - mine.length
      const ratios = mine
      const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null
      const topReasons = Object.entries(p.reasons ?? {})
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r}×${n}`).join(' ')
      log.info(
        `probe: ${p.trades}/${p.attempts} orders landed` +
          (p.attempts > 0 ? ` (${((p.trades / p.attempts) * 100).toFixed(0)}%)` : '') +
          ` · ${sol(p.committedSol)} committed of ${sol(config.probe.maxTotalSol)}` +
          (median !== null
            ? ` · median fill ${median.toFixed(4)}x quoted (${((median - 1) * 100).toFixed(2)}% slip, n=${ratios.length})` +
              /*
               * The individual ratios, not just the median.
               *
               * This ledger PERSISTS across deploys, by design -- a restart must not hand
               * the probe a fresh spending allowance. The side effect is that samples
               * taken under an older build stay in the array and keep moving the median,
               * long after the bug that produced them is fixed. A ratio near 1.29 is the
               * signature of the pre-fix entry-price bug, where rent and fees were divided
               * into the token count as though they had bought tokens; a clean sample sits
               * just above 1.00. With n this small the raw list is the only way to see
               * which of the two a median is actually reporting.
               */
              ` [${ratios.map((r) => r.toFixed(3)).join(' ')}]`
            : ` · no fill ratios from this build yet${stale ? ` (${stale} from older builds, not comparable)` : ''}`) +
          (median !== null && stale ? ` · ${stale} older sample(s) excluded` : '') +
          (topReasons ? ` · failures: ${topReasons}` : ''),
      )
    }

    s.sinceBeat = { messages: 0, creates: 0, screened: 0, passed: 0, entered: 0 }
  }

  async start() {
    initStore()
    acquireLock()
    const pubkey = getPublicKey().toBase58()

    if (config.paper) {
      this.paperStartSol = config.paperStartSol
      this.walletSol = paperWalletSol(this.paperStartSol)
    } else {
      this.walletSol = await this.getBalance()
      const needed = buySolFor(this.walletSol) + config.sizing.reserveSol
      if (this.walletSol < needed) {
        /**
         * NAME THE WALLET. The address is two lines up and was not in the message.
         *
         * "wallet holds 0.0009 SOL" is unanswerable on its own, and it is emitted at the
         * exact moment the likely cause is that the funded address and the address this
         * key controls are DIFFERENT ONES — a private key exported from the wrong account
         * in a multi-account wallet resolves to a real, empty address and fails exactly
         * like this. Without the pubkey the reader cannot tell that from "the transfer
         * has not landed yet", and those want opposite actions: re-export, or wait.
         */
        throw new Error(
          `wallet ${pubkey} holds ${sol(this.walletSol)} — needs at least ${sol(needed)} ` +
            '(one position + reserve). If you funded a different address, this key belongs ' +
            'to another account — check the address above against the one you sent SOL to.',
        )
      }
    }

    this.lastTierFloor = tierFor(this.walletSol).minEquitySol
    // Before anything else reads the risk state: re-anchor to the balance we actually
    // have, which is what lets a halt raised against a different account size go stale.
    syncEquityBasis(this.walletSol)
    const summary = riskSummary(this.walletSol)

    log.info(`starting in ${config.paper ? 'PAPER' : 'LIVE'} mode as ${pubkey} · build ${config.version}`)

    // Names and lengths only. Printed once at startup so "is the variable reaching the
    // container" is answered by reading, not by inference.
    log.info(
      'env: ' +
        envReport()
          .map((e) => (e.present ? `${e.name}=${e.trimmedLength}ch` : `${e.name}=MISSING`))
          .join(' · '),
    )
    log.info(
      `tier: ${sol(summary.sizing.buySol)}/trade at ${sol(this.walletSol)} equity` +
        (summary.sizing.nextTier
          ? ` · next ${sol(summary.sizing.nextTier.buySol)}/trade at ${sol(summary.sizing.nextTier.atSol)}`
          : ''),
    )
    /**
     * A LIVE BOT ON AN EPHEMERAL DISK LOSES ITS POSITIONS, SILENTLY.
     *
     * DATA_DIR defaults to a directory inside the application itself, which on a hosted
     * platform is part of the image: a container restart keeps it, a redeploy does not.
     * State written there survives just often enough to look fine. That is exactly how
     * this was missed -- one position re-attached cleanly across a restart, which was
     * read as proof the disk persisted, and four more were orphaned by later deploys.
     *
     * An orphan has no stop-loss and no exit rules, so the failure mode is real money
     * sitting in the wallet with nothing managing it, discovered only by the orphan
     * sweep on some later boot. Say so at startup, on the channel that reaches a phone,
     * rather than leaving it to be inferred from a list of mints.
     */
    if (!config.paper && config.dataDir.startsWith(ROOT)) {
      log.error(
        `DATA_DIR is unset, so live state is being written to ${config.dataDir} — inside the ` +
          'container. A redeploy will DELETE it and every open position becomes an orphan ' +
          'with no stop-loss. Mount a persistent volume and point DATA_DIR at it.',
      )
      notify(
        '⚠️ <b>State is not persistent</b>\n' +
          `Live positions are stored in <code>${config.dataDir}</code>, inside the container.\n` +
          'The next deploy will orphan every open position — no stop-loss, no exit rules.\n' +
          'Mount a volume and set <code>DATA_DIR</code> to it.',
      ).catch(() => {})
    }

    const start = recordStart()
    log.info(
      `start #${start.startCount} of build ${config.version}` +
        (start.sinceSeconds === null ? ' (first on this state)' : ` · ${start.sinceSeconds}s since the last`),
    )
    await notifyStartup(pubkey, this.walletSol, summary, start)

    for (const p of openPositions()) {
      this.feed.watch(p.mint)
      log.info(`resuming position ${p.symbol} (${p.mint})`)
    }

    /**
     * Pending observations survive the restart. Without this every row still inside its
     * outcome window is lost whenever the process stops, and on a hosted platform that
     * is often — a restart every 15 minutes against a 15-minute window keeps nothing at
     * all, and the rows it does lose cluster around deploys rather than being a random
     * sample of the market.
     */
    if (this.shadow) {
      const { restored, expired } = this.shadow.restore(loadShadow())
      if (restored) {
        log.info(`restored ${restored} pending observation(s) from the last run`)
        for (const mint of expired) {
          this.shadow.finalize(mint, 'window closed during downtime')
          if (!getState().positions[mint]) this.feed.unwatch(mint)
        }
        if (expired.length) log.info(`${expired.length} of them had already matured and were journalled`)
      }
    }

    await this.#checkForOrphans()

    this.stats.startedAt = Date.now()
    this.feed.on('raw', () => {
      this.stats.messages++
      this.stats.sinceBeat.messages++
    })
    this.feed.on('trade-feed-refused', async () => {
      if (config.paper) return
      // Live with no trade feed means unmanageable exits. Refuse to open anything.
      halt('trade feed refused — no price data, exits cannot be managed')
      await notify(
        '🛑 <b>HALTED — no trade feed</b>\n' +
          'PumpPortal is serving new-token events only, so we get no prices.\n' +
          'Entry is impossible and exits cannot be managed.\n' +
          'Set <code>PUMPPORTAL_API_KEY</code> (funded with 0.02 SOL) and restart.',
      )
    })
    this.feed.on('migrate', (e) => this.#onMigrate(e).catch((err) => log.error(err)))
    this.feed.on('create', (e) => this.#onCreate(e))
    // Only take the metered tape when we are not decoding trades ourselves.
    if (!this.usingRpcTrades) {
      this.feed.on('trade', (e) => {
        // This tape, and only this tape, is billed per message.
        this.stats.meteredMessages++
        this.#onTrade(e)
      })
    }
    this.feed.start()

    if (this.logFeed) {
      this.logFeed.on('trade', (e) => {
        this.stats.messages++
        this.#onTrade(e)
      })
      /**
       * A separate channel, deliberately. These are trades by wallets we track on ANY
       * token, including ones the bot has never looked at — so they must not touch the
       * trading path or its counters. They are an observation, not an input.
       */
      this.logFeed.on('smart-trade', (e) => this.#noteSmartMoney(e, this.candidates.get(e.mint)))
      this.logFeed.start()
      log.info('trade ticks from RPC program logs (free) — metered tape not subscribed')
    }

    // Sweeps cover everything the event stream cannot: silent tokens, the time stop,
    // abandoning stale candidates, closing outcome windows, and the day rollover.
    this.sweepTimer = setInterval(() => this.#sweep().catch((e) => log.error(e)), 5000)
    this.balanceTimer = setInterval(() => this.#refreshBalance().catch((e) => log.debug(e)), 60_000)
    /**
     * Checkpoint pending observations, not just on shutdown. A hosted container is not
     * guaranteed a clean exit — an OOM kill or a platform restart takes the process
     * without running any handler, which is precisely when losing 450 in-flight rows
     * hurts most.
     */
    if (this.shadow) {
      this.shadowTimer = setInterval(() => {
        saveShadow(this.shadow)
        saveWallets(this.wallets)
      }, 30_000)
      this.shadowTimer.unref?.()
    }
    /**
     * The graduation window is 24 HOURS, so this one cannot rely on a clean shutdown at
     * all: on a hosted platform a row that is not persisted between deploys would never
     * once reach its final checkpoint. Sweeping on the same timer advances each row's
     * clock, journals the ones that have run their full window, and releases their feed
     * subscription -- 400 tracked mints would otherwise hold subscriptions the launch
     * strategy needs.
     */
    /**
     * The toll measurement, on its own slow timer. Off unless GRAD_PROBE is set: it
     * spends real money to buy a number, which has to be someone's decision rather than
     * something a deploy starts doing. Slow because eight round trips is the entire
     * sample -- there is no hurry, and haste here only spends more.
     */
    if (config.gradProbe.enabled && !config.paper) {
      log.warn(
        `graduation toll probe ENABLED — will spend up to ${sol(config.gradProbe.maxTotalSol)} ` +
          `in ${config.gradProbe.positionSol} SOL round trips to measure the PumpSwap round trip`,
      )
      this.gradProbeTimer = setInterval(() => {
        this.#gradProbeTick().catch((err) => log.error(`grad probe: ${err.message}`))
      }, 90_000)
      this.gradProbeTimer.unref?.()
    }
    if (this.graduations) {
      this.gradTimer = setInterval(() => {
        this.#gradPriceSweep().catch((err) => log.error(`graduation pricing: ${err.message}`))
        const done = this.graduations.sweep()
        saveGraduations(this.graduations)
      }, 30_000)
      this.gradTimer.unref?.()
    }
    if (config.telegram.summaryHours > 0) {
      this.summaryBase = summaryBaseline(this)
      const everyMs = config.telegram.summaryHours * 3600_000
      this.summaryTimer = setInterval(() => this.#sendSummary().catch((e) => log.warn(e.message)), everyMs)
      log.info(`telegram summary every ${config.telegram.summaryHours}h`)
    }

    // First beat lands early for fast confirmation, then settles into the interval.
    const beatMs = config.heartbeatSeconds * 1000
    this.heartbeatTimer = setTimeout(() => {
      this.#heartbeat()
      this.heartbeatTimer = setInterval(() => this.#heartbeat(), beatMs)
    }, Math.min(15_000, beatMs))
  }

  async stop() {
    this.stopping = true
    clearInterval(this.sweepTimer)
    clearInterval(this.balanceTimer)
    clearInterval(this.heartbeatTimer)
    clearInterval(this.summaryTimer)
    clearInterval(this.shadowTimer)
    await this.feed.stop()
    await this.logFeed?.stop()
    // The analysis thread is unref'd so it cannot hold the process open, but a shutdown
    // should still take it down rather than leave it mid-scan holding a few hundred MB.
    await stopAnalysis()
    save()
    saveShadow(this.shadow)
    saveWallets(this.wallets)
    if (this.gradTimer) clearInterval(this.gradTimer)
    if (this.gradProbeTimer) clearInterval(this.gradProbeTimer)
    saveGraduations(this.graduations)
    releaseLock()
  }

  async #refreshBalance() {
    if (config.paper) {
      /**
       * Refill before reading, so a book that has run dry does not spend a minute
       * unable to trade. A bot that stops trading stops learning, and that is the only
       * thing this instance exists to do — the balance is notional, so there is no
       * argument for letting it end the experiment.
       */
      if (config.paperAutoTopUp) {
        const added = topUpPaper(this.paperStartSol)
        if (added) {
          this.stats.paperTopUps = (this.stats.paperTopUps ?? 0) + 1
          logActivity('risk', `paper book topped up by ${sol(added)} — realized P&L unchanged`)
          await notify(
            `💧 <b>Paper book topped up</b> by ${sol(added)}\n` +
              'The experiment keeps running. Realized P&amp;L is untouched, so this cannot ' +
              'flatter the numbers — only the notional balance moved.',
          )
        }
      }
      // Recomputed rather than trusted, so any drift corrects itself every minute.
      this.walletSol = paperWalletSol(this.paperStartSol)
      syncEquityBasis(this.walletSol)
      return
    }
    const before = this.walletSol
    this.walletSol = await getSolBalance()
    syncEquityBasis(this.walletSol)

    // Announce a tier change in either direction — size going down matters more.
    const floor = tierFor(this.walletSol).minEquitySol
    if (this.lastTierFloor !== null && floor !== this.lastTierFloor) {
      const s = sizingSummary(this.walletSol)
      const up = floor > this.lastTierFloor
      await notify(
        `${up ? '📈' : '📉'} <b>Size tier ${up ? 'up' : 'down'}</b>\n` +
          `Wallet ${sol(before)} → ${sol(this.walletSol)}\n` +
          `Now trading <b>${sol(s.buySol)}</b> per position (cap ${sol(s.maxDeployedSol)})` +
          (s.nextTier ? `\nNext step ${sol(s.nextTier.buySol)} at ${sol(s.nextTier.atSol)}` : ''),
      )
      this.lastTierFloor = floor
    }
  }

  #onCreate(event) {
    this.stats.creates++
    this.stats.sinceBeat.creates++

    // One-time confirmation that the feed's field names actually match the parser.
    if (this.stats.firstParsedAt === null) {
      this.stats.firstParsedAt = Date.now()
      log.info(
        `feed parsing confirmed — first launch "${event.symbol ?? '?'}" ` +
          `at ${event.marketCapSol?.toFixed(1) ?? '?'} SOL mcap, price ${event.priceSol?.toExponential(2) ?? 'MISSING'}`,
      )
      if (!(event.priceSol > 0)) {
        log.error('launch parsed but has NO PRICE — exits cannot be managed. Check src/curve.js.')
      }
    }

    if (this.stopping) return
    if (this.candidates.has(event.mint)) return

    /**
     * A HALT STOPS TRADING, NOT LEARNING.
     *
     * This used to return early when halted, which killed the entire pipeline: no
     * candidates, so nothing observed, nothing screened, nothing shadow-tracked, and
     * `interested()` false for every mint so the trade feed decoded tens of thousands of
     * events and kept none. The dashboard read "312 launches · 0 observing · 0 screened"
     * — a bot that looks alive and is learning nothing. Worse, a halt is exactly when
     * you most want the data: it is the moment you need evidence about whether the
     * strategy deserves to be restarted.
     *
     * Entry is still blocked — canOpen checks `halted` first and nothing gets past it.
     * What continues is observation, screening and journalling, all of which are free.
     */
    if (getState().halted && !this.haltedNoticeShown) {
      this.haltedNoticeShown = true
      log.warn(
        `HALTED (${getState().halted.reason}) — still observing and journalling, ` +
          'but taking no positions. Clear it with /resume in Telegram.',
      )
    }

    /**
     * Observing is deliberately NOT gated on how many positions are open.
     *
     * It used to be, and that was a deadlock: explore positions counted toward the
     * limit, so once the experiment held more than MAX_CONCURRENT_POSITIONS the bot
     * stopped watching new launches entirely — no candidates, no screening, no data,
     * and no way out of the state. Observation is cheap and already bounded by
     * MAX_WATCHED_MINTS; the exposure limits belong at entry, where canOpen enforces
     * them against strategy positions only.
     */
    this.candidates.set(event.mint, new Candidate(event))
    this.feed.watch(event.mint)
  }

  /**
   * Ask the off-curve oracle for a price, but only for rows with a checkpoint due.
   *
   * The oracle has to EARN trust before it prices anything -- it is checked continuously
   * against curve prices we already know exactly, and only a source that agrees
   * repeatedly is parsing the right field of the right object. An untrusted oracle
   * records nothing rather than inventing a denominator, which is the failure that
   * produced the 46x and 228x fantasies on the curve side.
   *
   * Capped per sweep so a backlog cannot turn into a burst of outbound calls.
   */
  async #gradPriceSweep() {
    if (!this.graduations || this.stopping) return
    if (!oracleTrusted()) {
      this.stats.gradOracleBlocked = (this.stats.gradOracleBlocked ?? 0) + 1
      return
    }
    const due = this.graduations.dueForPrice().slice(0, config.graduation.maxPricePerSweep)
    if (!due.length) return
    for (const row of due) {
      try {
        const p = await offCurvePrice(row.mint, this.solPriceUsd)
        if (p?.priceSol > 0) {
          this.graduations.note(row.mint, p.priceSol)
          this.stats.gradPriced = (this.stats.gradPriced ?? 0) + 1
        }
      } catch (err) {
        this.stats.gradPriceErrors = (this.stats.gradPriceErrors ?? 0) + 1
        if ((this.stats.gradPriceErrors ?? 0) === 1) log.warn(`graduation pricing: ${err.message}`)
      }
    }
  }

  /**
   * MEASURE ONE PUMPSWAP ROUND TRIP, in the only way a round trip can be measured.
   *
   * Buy a tiny amount of a graduated token and sell all of it immediately. The SOL that
   * does not come back IS the toll: fees, slippage, impact and priority together, with no
   * model in between. The graduation bar is 1 + this number, because the 1.06 in the
   * original pre-registration came from a bonding curve and this hypothesis does not
   * trade on one.
   *
   * Deliberately NOT a strategy. It holds for no time, picks no winners, and exists only
   * to turn an assumption into a measurement. It stops as soon as the estimate stops
   * moving -- more round trips after that buy nothing and cost real money.
   */
  async #gradProbeTick() {
    if (!config.gradProbe.enabled || config.paper || this.stopping) return
    const led = gradProbeLedger()
    if (led.trips >= config.gradProbe.targetSamples) return
    if (led.spentSol + config.gradProbe.positionSol > config.gradProbe.maxTotalSol) return
    if (!this.graduations) return

    /**
     * Only a token whose price could belong to a completed curve, and that is actually
     * trading. Probing a mint priced off a stale pre-migration tick would measure the
     * round trip of something that is not the population under test.
     */
    const now = Date.now()
    const target = this.graduations.inFlight().find(
      (r) =>
        r.basePriceSol > 0 &&
        baseSanity(r.basePriceSol).ok &&
        r.trades >= 3 &&
        r.lastTradeAt !== null &&
        now - r.lastTradeAt < 120_000 &&
        !this.busy.has(r.mint) &&
        !this.gradProbed?.has(r.mint),
    )
    if (!target) return

    this.gradProbed ??= new Set()
    this.gradProbed.add(target.mint)
    this.busy.add(target.mint)
    try {
      const spend = config.gradProbe.positionSol
      const fill = await buy({ mint: target.mint, solAmount: spend, pool: 'auto' })
      if (!fill.ok) {
        recordGradProbe({ ok: false, spentSol: 0, mint: target.mint, reason: `buy: ${fill.error}` })
        log.warn(`grad probe buy failed on ${target.mint.slice(0, 8)}: ${fill.error}`)
        return
      }
      // Straight back out. Anything held is a position, and this is a measurement.
      const out = await sell({
        mint: target.mint,
        tokenAmount: fill.tokensReceived,
        sellAll: true,
        pool: 'auto',
      })
      if (!out.ok) {
        /**
         * Bought and could not sell. That is worth more than a clean number: a venue we
         * cannot exit is a venue the strategy cannot use, whatever its round trip costs.
         */
        recordGradProbe({ ok: false, spentSol: fill.solSpent, mint: target.mint, reason: `sell: ${out.error}` })
        log.error(`grad probe COULD NOT EXIT ${target.mint} — ${out.error}`)
        await notify(`⚠️ <b>Graduation probe could not exit</b>\n<code>${target.mint}</code>\n${out.error}`).catch(() => {})
        return
      }
      const spentSol = fill.solSpent
      const returnedSol = out.solReceived ?? 0
      const g = recordGradProbe({ ok: true, spentSol, returnedSol, mint: target.mint })
      const toll = 1 - returnedSol / spentSol
      log.info(
        `grad probe: ${sol(spentSol)} out, ${sol(returnedSol)} back — toll ${(toll * 100).toFixed(2)}% ` +
          `(${g.trips}/${config.gradProbe.targetSamples} samples)`,
      )
    } catch (err) {
      recordGradProbe({ ok: false, spentSol: 0, mint: target.mint, reason: err.message })
      log.error(`grad probe error: ${err.message}`)
    } finally {
      this.busy.delete(target.mint)
    }
  }

  /**
   * A token we hold has graduated: its bonding curve is closed and liquidity has moved.
   * Record the new venue so exits route somewhere that still exists, and say so — this
   * is the moment the thesis changes on our best positions.
   */
  async #onMigrate(event) {
    this.stats.migrations = (this.stats.migrations ?? 0) + 1

    /**
     * EVERY graduation is observed, not only the ones we happen to hold.
     *
     * This method used to return here unless the mint was an open position, so the
     * subscription has been delivering every graduation on the network and we have been
     * discarding all but a handful. That is the entire dataset the new hypothesis needs.
     */
    if (this.graduations) {
      const opened = this.graduations.open({
        mint: event.mint,
        symbol: getState().positions[event.mint]?.symbol ?? this.candidates.get(event.mint)?.symbol ?? null,
        at: Date.now(),
        pool: event.pool ?? null,
        marketCapSol: Number.isFinite(event.marketCapSol) ? event.marketCapSol : null,
        /**
         * Not copied here. The launch row for this mint is already in the journal with
         * every feature we compute, and graduation happens long after the candidate has
         * been evicted -- so the join is on `mint` at analysis time, against data that
         * is already on disk. Duplicating it would only create a second copy to drift.
         */
        features: null,
      })
      /**
       * DELIBERATELY NOT SUBSCRIBED.
       *
       * Watching every graduation's trades was the wrong shape: subscriptions are capped
       * at 60 and shared with the launch strategy, and PumpPortal meters the feed. With
       * 400 tracked mints, at most 60 could ever be priced -- 47.8% of the first 268
       * rows had no price at all -- and the rest silently consumed slots the strategy
       * needed. The experiment needs nine prices over 24h, not a day of every trade, so
       * it asks the off-curve oracle when a checkpoint falls due. See #gradPriceSweep.
       */
      void opened
    }

    const position = getState().positions[event.mint]
    if (!position || position.state !== 'open') return

    const to = event.pool && event.pool !== 'pump' ? event.pool : 'auto'
    log.info(`GRADUATED: ${position.symbol} migrated to ${to}`)
    position.pool = to
    position.graduatedAt = Date.now()
    save()
    logActivity('risk', `GRADUATED ${position.symbol} → ${to}`, { mint: event.mint })

    if (!position.explore) {
      await notify(
        `🎓 <b>${esc(position.symbol)} graduated</b> → <code>${esc(to)}</code>\n` +
          'Bonding curve closed; exits now route to the new venue.\n' +
          'We cannot price it from here — the curve account is gone and the log feed ' +
          'only decodes pump.fun trades — so the bag will close at the last curve ' +
          'price once the reads fail. That is the graduation price, which is a good ' +
          'one; it just means no upside past this point.',
      )
    }
  }

  #onTrade(event) {
    this.stats.trades++
    if (this.stopping) return

    const candidate = this.candidates.get(event.mint)
    const position = getState().positions[event.mint]
    if (candidate || position) this.stats.tradesMatched++

    candidate?.apply(event)
    this.shadow?.onTrade(event)

    /**
     * Post-graduation price, for the separate experiment.
     *
     * Taken from the trade's own price rather than from curve reserves: after graduation
     * the bonding curve is CLOSED, so there are no reserves to divide and anything
     * derived from them would be stale or invented. The pre-registration is explicit
     * that a missing or deflated denominator is what produced the 46x and 228x fantasies
     * on the curve side, so this side only ever records a price it actually saw traded.
     */
    if (this.graduations && event.priceSol > 0) this.graduations.note(event.mint, event.priceSol)

    if (position?.state === 'open') {
      /**
       * A RESERVE THAT CANNOT EXIST MEANS A PRICE THAT CANNOT EXIST, and it was being
       * marked and sold into anyway.
       *
       * On a bonding curve the reserves ARE the price. Constant product then caps how far
       * a curve can run: filling it is what completes it, so between launch and
       * completion the price can rise about 15x and no further. Positions have been
       * marked at 46x and 228x, which is not a pump — it is a reserve figure that no live
       * curve can hold, and the paper executor quoted a sale against it and booked the
       * proceeds as profit. Those fantasy fills are concentrated in the largest wins,
       * which is where the entire measured edge lives.
       *
       * Ignoring the tick is the conservative response, not an aggressive one: the
       * position keeps its last good price, goes stale, and the existing stale/blind-exit
       * path takes it. Inventing a correction would be guessing at a number we do not
       * have.
       */
      if (Number.isFinite(event.vSol) && event.vSol > PUMP_MAX_CURVE_SOL) {
        this.stats.impossibleCurve++
        this.stats.lastImpossibleCurve = { mint: event.mint, symbol: position.symbol, vSol: event.vSol, at: Date.now() }
        if (this.stats.impossibleCurve === 1) {
          log.error(
            `${position.symbol}: reserves report ${event.vSol.toFixed(1)} SOL, which no live pump.fun ` +
              'curve can hold (completes near 115). Refusing to price or sell against it.',
          )
        }
        return
      }
      markPrice(position, event.priceSol)
      // Only overwrite with real numbers. A tick without reserves would otherwise wipe
      // the values the drain detector and the paper sell path both need.
      if (Number.isFinite(event.vSol)) position.lastVSol = event.vSol
      if (Number.isFinite(event.vTokens)) position.lastVTokens = event.vTokens
      // Venues change under us when a token graduates; believe the feed over history.
      if (event.pool && event.pool !== position.pool) {
        log.info(`${position.symbol} venue moved ${position.pool} -> ${event.pool}`)
        position.pool = event.pool
        save()
      }
      // Evaluate on the tick, not on a timer — a rung should fire when it is crossed.
      this.#manage(position, event.priceSol, event.vSol).catch((err) => log.error(err))
    }
  }

  /** The scheduled digest. Deltas are measured from the previous summary, not all-time. */
  async #sendSummary() {
    const text = summaryText(this, this.summaryBase)
    // Re-baseline only after a successful send, so a failed send does not swallow a
    // window's worth of activity.
    if (await notify(text)) this.summaryBase = summaryBaseline(this)
  }

  /**
   * Tokens the wallet holds that the ledger knows nothing about.
   *
   * This is the failure mode of running with ephemeral storage: the container restarts,
   * the state file is gone, and the bot silently forgets it is holding real positions.
   * Those bags then sit there with no stop-loss, no time stop, and no exit — the single
   * most expensive way this can go wrong. Loud is the correct behaviour.
   */
  async #checkForOrphans() {
    if (config.paper) return []

    let held
    try {
      held = await getAllTokenBalances()
    } catch (err) {
      log.warn(`could not check for orphaned positions: ${err.message}`)
      return []
    }

    /**
     * A TRADE WE CLOSED IS NOT AN UNMANAGED POSITION.
     *
     * closePosition moves the record to `closed` and deletes it from `positions`
     * (store.js), so checking `positions` alone cannot tell "we sold this and it left a
     * fraction behind" from "we have never seen this mint". Every sell used to floor a
     * six-decimal uiAmount, so essentially every closed trade left dust in its token
     * account -- which meant this alert reported each of them, forever, as real money
     * with no stop-loss.
     *
     * It cost a working day: the count climbing 5 -> 9 was read as deploys orphaning live
     * positions, and sent us through the volume, the mount path and DATA_DIR, all of
     * which were correct. The dust was from trades that had exited cleanly.
     */
    const { orphans, dust } = classifyHeldTokens(held, getState())

    if (dust.length) {
      log.info(
        `${dust.length} token account(s) hold only dust (< ${config.exec.dustTokens} tokens) — ` +
          'residue from closed trades. Each strands its rent until closed.',
      )
    }
    if (!orphans.length) return []

    log.error('═══════════════════════════════════════════════════════════')
    log.error(`${orphans.length} token(s) in the wallet are NOT in the ledger:`)
    for (const o of orphans) log.error(`   ${o.mint}  ${o.amount.toFixed(0)} tokens`)
    log.error('These are unmanaged — no stop-loss, no time stop, no exit.')
    log.error('This means a position was opened that the ledger never recorded, or the')
    log.error('state file was lost. Dust from closed trades is reported separately.')
    log.error('Run `npm run adopt` to bring them under management, or sell manually.')
    log.error('═══════════════════════════════════════════════════════════')

    await notify(
      `⚠️ <b>${orphans.length} unmanaged position(s)</b>\n` +
        'Tokens in the wallet that the ledger does not know about — they have no ' +
        'stop-loss and no exit rules.\n' +
        orphans.map((o) => `<code>${o.mint}</code> · ${o.amount.toFixed(0)} tokens`).join('\n') +
        '\n\nRun <code>npm run adopt</code>.',
    )

    return orphans
  }

  /** Runs one sweep on demand. The scheduler calls #sweep directly; tests use this. */
  async tick() {
    return this.#sweep()
  }

  async #sweep() {
    if (this.stopping || this.sweeping) return
    this.sweeping = true
    try {
      await this.#sweepOnce()
    } finally {
      this.sweeping = false
    }
  }

  async #sweepOnce() {
    if (this.stopping) return

    const today = utcDay()
    if (rolloverDaily(this.lastDay, today)) {
      log.info(`new UTC day ${today} — consecutive-loss counter reset`)
      this.lastDay = today
      save()
    }

    for (const [mint, candidate] of [...this.candidates]) {
      if (candidate.ageSeconds >= config.entry.abandonSeconds) {
        this.candidates.delete(mint)
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        continue
      }
      // The candidate's OWN window, not the global one — see observeWindowFor.
      if (candidate.ageSeconds < candidate.observeSeconds) continue

      const verdict = evaluateEntry(candidate, { creatorPrior: this.#creatorPrior(candidate.creator) })
      this.candidates.delete(mint)

      /**
       * Counted on every DECIDED candidate, not only on the ones we buy.
       *
       * mayhemScreened sits after the pass check, so once entry started refusing these
       * coins it could never increment again and the panel read "nothing screened yet"
       * forever — on a population that is roughly a third of what we look at. A counter
       * that goes permanently silent the moment its subject starts being filtered is
       * worse than no counter: it reports absence where there is avoidance.
       */
      if (candidate.mayhemLikely) {
        this.stats.mayhemSeen++
        if (!verdict.pass) this.stats.mayhemRefused++
      }

      if (!verdict.pass) {
        log.debug(`skip ${candidate.symbol}: ${verdict.reason}`)
        this.#countReject(verdict)

        // Buy a sample of rejects anyway, in paper, to find out if the filter is right.
        if (this.#shouldExplore(verdict)) {
          await this.#enter(candidate, verdict, { explore: true })
          continue
        }

        // Keep watching the rest so we still learn what the filter throws away.
        this.shadow?.track({ candidate, verdict, action: 'rejected' })
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        continue
      }

      this.stats.screened++
      this.stats.sinceBeat.screened++
      this.stats.passed++
      this.stats.sinceBeat.passed++
      if (candidate.mayhem) this.stats.mayhemScreened++

      await this.#enter(candidate, verdict)
    }

    // Close out outcome windows and stop following those mints.
    for (const row of this.shadow?.finalizeAllDue() ?? []) {
      if (!getState().positions[row.mint]) this.feed.unwatch(row.mint)
    }

    await this.#refreshStalePrices()

    // Positions whose feed has gone quiet still need the time stop and stop-loss run.
    for (const position of openPositions()) {
      if (position.state !== 'open') continue
      await this.#manage(position, position.lastPriceSol, position.lastVSol)
    }
  }

  /**
   * Whether to take a filter-rejected candidate anyway, for information.
   *
   * Only the un-relaxable checks veto this. Everything else our filter believes is a
   * hypothesis, and the only way to learn that a threshold is too tight is to sometimes
   * trade the other side of it.
   */
  /** Exposed for tests; the loop calls it through #shouldExplore. */
  explorePermitted(verdict) {
    return this.#shouldExplore(verdict)
  }

  #shouldExplore(verdict) {
    const e = config.explore
    /**
     * Every rejected candidate is OFFERED to the sampler, and each outcome is counted.
     *
     * Without this, "explored: 0" is unreadable: at a 25% sample rate four rejects
     * produce no explore trade about a third of the time, so zero is equally consistent
     * with healthy sampling and with the experiment being switched off, parked or
     * starved. The counters below say which, instead of leaving it to be inferred from
     * the outcome — the one habit that has resolved every silent failure in this bot.
     */
    this.stats.exploreOffered++
    if (!e.enabled) {
      this.stats.exploreSkips.disabled++
      return false
    }
    if (verdict.failed.some((c) => e.neverRelax.includes(c.id))) {
      this.stats.exploreSkips.unpriceable++
      return false
    }
    /**
     * Count EXPLORE positions, not every open position. The two books are separate
     * money, and mixing them here let strategy positions eat the experiment's slots —
     * the same class of bug that once deadlocked observation, where explore positions
     * consumed the strategy's limit and the bot stopped watching launches entirely.
     */
    if (explorePositions().length >= e.maxConcurrent) {
      this.stats.exploreSkips.concurrency++
      return false
    }

    /**
     * Without trade data every explore position is a forced blind exit at fee cost —
     * a guaranteed loss carrying zero information, because nothing can move and no
     * outcome can be labelled. Spending a budget to learn nothing is the worst trade
     * available, so the experiment pauses until prices flow.
     */
    if (this.stats.creates > 30 && this.stats.tradesMatched === 0) {
      if (!this.stats.exploreParked) {
        this.stats.exploreParked = true
        log.warn('exploration paused — no trade data, so explore trades can only lose fees')
      }
      this.stats.exploreSkips.noTradeData++
      return false
    }
    this.stats.exploreParked = false

    /**
     * An optional bankroll cap. When set, the gate is capital AT RISK — not just money
     * already lost. Gating on realized P&L alone let 15 concurrent positions tie up
     * 1.1 SOL while "spent" still read near zero, which is how a 0.3 budget produced a
     * -0.650 balance. What is left = bankroll + realized - still deployed.
     *
     * Unlimited (budgetSol 0) is the default and skips this entirely. Exploration is
     * still bounded by maxConcurrent, and by being paper-only.
     */
    if (e.budgetSol > 0) {
      const left = paperExploreWalletSol(e.budgetSol)
      if (left < buySolFor(this.walletSol)) {
        if (!this.stats.exploreBudgetHit) {
          this.stats.exploreBudgetHit = true
          log.warn(`exploration paused — ${sol(left)} left of its ${sol(e.budgetSol)} bankroll`)
        }
        this.stats.exploreSkips.bankroll++
        return false
      }
      // Recoverable: positions close and free capital, unlike the old one-way latch.
      this.stats.exploreBudgetHit = false
    }

    const take = Math.random() < e.sampleRate
    if (take) this.stats.exploreTaken++
    else this.stats.exploreSkips.sampledOut++
    return take
  }

  async #enter(candidate, verdict, { explore = false } = {}) {
    const mint = candidate.mint
    if (this.busy.has(mint)) return

    // Explore trades are paper-only and exist to gather data, so the exposure caps that
    // protect real capital do not apply — but a halt still does, and so does not
    // double-buying the same mint.
    /**
     * A HALT DOES NOT STOP EXPLORE.
     *
     * The halt is a circuit breaker protecting capital, and explore risks none: it is
     * hard-gated to paper, runs on its own notional bankroll, and exists purely to
     * measure whether the filter is right. Blocking it meant the bot stopped learning at
     * the exact moment the evidence mattered most — when you are deciding whether the
     * strategy is salvageable. It is the same reasoning that keeps observation and
     * journalling alive through a halt.
     *
     * Strategy entries are still refused; canOpen checks `halted` first and nothing gets
     * past it. In live, explore is disabled outright, so this can never move real money.
     */
    const blocked = explore
      ? getState().positions[mint]
        ? 'already holding this mint'
        : null
      : canOpen({ mint, creator: candidate.creator, walletSol: this.walletSol })

    if (blocked) {
      log.info(`not entering ${candidate.symbol}: ${blocked}`)
      /**
       * A sampled explore trade that never happened has to be counted, or the numbers
       * contradict each other with no way to tell why. The dashboard read "took 82 of
       * 307 rejects" beside "EXPLORED 0" — the sampler said yes 82 times and every one
       * was refused downstream by a halt, and nothing on the page said so.
       */
      if (explore) {
        this.stats.exploreBlockedEntries++
        this.stats.exploreBlockReason = blocked
      } else {
        /**
         * WHY an approved launch was not taken, counted by reason.
         *
         * "Why are we not trading more?" has been answered by guessing at it more than
         * once — the concurrency cap, the loss limits and the losing-streak pause all
         * produce the same silence, and they want completely different responses. The
         * filter's own rejections were always counted; the CAPITAL gate's were not, so
         * the one number that says what is actually throttling the strategy did not
         * exist. Collapse the digits so "already holding 4 positions (max 4)" is one
         * bucket rather than one per count.
         */
        const key = String(blocked).replace(/\d+/g, 'N')
        this.stats.blockedEntries.set(key, (this.stats.blockedEntries.get(key) ?? 0) + 1)
      }
      /**
       * Journal the DECISION, not the outcome of the capital gate.
       *
       * canOpen blocks for reasons that have nothing to do with the launch — four
       * positions already open, the deploy cap, a daily loss limit, a blocklisted
       * creator. Recording those as 'rejected' put launches the filter APPROVED into
       * the arm that is supposed to measure what the filter turned down, and because
       * rejectedFor is null for a passing verdict they were invisible in the
       * "what our filter threw away" breakdown too. With positions held up to the
       * 600s time stop, every approved launch in a ten-minute stretch landed there.
       */
      this.shadow?.track({
        candidate,
        verdict,
        action: verdict?.pass ? 'blocked' : 'rejected',
        blockedBy: blocked,
      })
      if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
      if (getState().halted) await notifyHalt(getState().halted.reason, riskSummary(this.walletSol))
      return
    }

    this.busy.add(mint)
    try {
      /**
       * Sized to the COIN as well as the account. A thin curve cannot absorb a full-tier
       * position without the fill drag eating the trade, and since the market-cap floor
       * came off most of what we buy is thinner than it used to be.
       */
      const buySol = buySolForCurve(this.walletSol, candidate.vSol)
      if (tooSmallToTrade(buySol)) {
        log.info(`skipping ${candidate.symbol}: curve holds ${candidate.vSol?.toFixed?.(1)} SOL, ` +
          `so the most we should take is ${sol(buySol)} — below the fee floor`)
        this.shadow?.track({
          candidate, verdict,
          action: verdict?.pass ? 'blocked' : 'rejected',
          blockedBy: 'curve too thin to size a position',
        })
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        return
      }
      log.info(
        `${explore ? 'EXPLORING' : 'ENTERING'} ${candidate.symbol} at ${sol(buySol)} — ` +
          `${candidate.organicBuyers} buyers, mc ${candidate.marketCapSol?.toFixed(1)} SOL` +
          (explore ? ` (would have skipped: ${verdict.reason})` : ''),
      )

      const fill = await buy({
        mint,
        solAmount: buySol,
        curve: { vSol: candidate.vSol, vTokens: candidate.vTokens },
        pool: candidate.pool,
      })

      /**
       * THE PROBE'S WHOLE PURPOSE: what happened to the order.
       *
       * `quoted` is the price the decision was made at. The ratio against what we
       * actually paid is the number paper cannot produce, because a paper fill is a
       * model of exactly this. A failure records WHY — "did not land" and "landed 30%
       * worse" are different problems with different fixes.
       */
      const quoted = candidate.vTokens > 0 ? candidate.vSol / candidate.vTokens : null
      /*
       * A paper fill is not a measurement, so it never enters the probe ledger.
       *
       * The probe exists to find out what a REAL order does -- the one number paper
       * cannot produce, because a paper fill is a model of exactly this. While the
       * entry-price bug was being fixed the probe service ran with PAPER=1, and because
       * the ledger persists across deploys those modelled fills stayed in it, sitting at
       * 1.000 and dragging the median toward "no slip". They must not consume the real
       * spending allowance either, since no SOL left the wallet.
       */
      if (config.probe.enabled && !config.paper) {
        recordProbeOrder({
          ok: Boolean(fill.ok),
          solSpent: fill.ok ? (fill.solSpent ?? buySol) : 0,
          fillRatio: fill.ok && quoted > 0 && fill.avgPriceSol > 0 ? fill.avgPriceSol / quoted : null,
          reason: fill.ok ? null : fill.error,
        })
      }

      if (!fill.ok) {
        log.warn(`entry failed for ${candidate.symbol}: ${fill.error}`)
        // Same reasoning: a failed fill is not the filter declining the launch.
        this.shadow?.track({
          candidate,
          verdict,
          action: verdict?.pass ? 'blocked' : 'rejected',
          blockedBy: `entry failed: ${fill.error}`,
        })
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        return
      }

      const position = newPosition({
        mint,
        symbol: candidate.symbol,
        creator: candidate.creator,
        fill,
        curve: { vSol: candidate.vSol },
        pool: candidate.pool,
      })
      position.lastVSol = candidate.vSol
      position.lastVTokens = candidate.vTokens
      position.explore = explore
      // What the filter objected to — the whole point of the experiment.
      position.failedChecks = explore ? verdict.failed.map((c) => c.id) : []
      addPosition(position)
      logActivity(explore ? 'explore' : 'buy',
        `${explore ? 'EXPLORE' : 'BUY'} ${position.symbol} ${sol(fill.solSpent)}` +
          (explore ? ` · would skip: ${verdict.failed.map((c) => c.id).join(',')}` : ''),
        { mint, sol: -fill.solSpent })
      // Paper derives from the ledger (which now includes this position); live keeps a
      // running figure between the once-a-minute chain reads.
      this.walletSol = config.paper
        ? paperWalletSol(this.paperStartSol)
        : this.walletSol - fill.solSpent

      if (explore) this.stats.explored++
      else {
        this.stats.entered++
        this.stats.sinceBeat.entered++
        if (candidate.mayhem) this.stats.mayhemEntered++
      }
      this.shadow?.track({
        candidate, verdict,
        action: explore ? 'explored' : 'bought',
        entryPriceSol: fill.avgPriceSol,
      })

      if (!explore || config.telegram.exploreAlerts) {
        await notifyEntry(position, {
          buyers: candidate.organicBuyers,
          devHoldPct: candidate.devHoldPct,
        })
      }
    } finally {
      this.busy.delete(mint)
    }
  }

  async #manage(position, priceSol, vSol) {
    const mint = position.mint
    if (this.busy.has(mint) || position.state !== 'open') return
    if (position.unsellable) return
    if (position.retryAfter && Date.now() < position.retryAfter) return

    const decision = decideExit(position, { priceSol, vSol })
    if (!(decision.sellTokens > 0)) {
      /**
       * A RUNG CAN TRIGGER WITHOUT SELLING ANYTHING — and it still has to COUNT.
       *
       * `rungsHit` does two jobs beyond bookkeeping: it arms the trailing stop and it
       * disarms the time stop. Both are gated on `hitAnyRung`, so whether the bot rides a
       * runner or dumps it on the clock is decided by whether a rung was recorded, not by
       * how much it sold.
       *
       * That was tied to a sale landing. A ladder of `50:0,900:40` — "start trailing at
       * +50%, sell nothing yet", which is exactly how you hold the biggest possible bag —
       * produced no tokens to sell, returned here, and never recorded the rung. The
       * trailing stop then never armed and the time stop never lifted, so the position
       * was managed as one that never got going and closed at 900s at whatever price
       * happened to be standing. The config would have read as "ride it" and behaved as
       * "sell it on a timer", silently, with nothing in the log disagreeing.
       *
       * Today's ladder sells 20% at the first rung, so this changes no live behaviour. It
       * makes the zero-sell rung mean what it says, which is the precondition for testing
       * a bigger moon bag at all.
       */
      const fresh = decision.rungs.filter((r) => !position.rungsHit.includes(r))
      if (fresh.length) {
        position.rungsHit.push(...fresh)
        log.info(`${position.symbol} reached +${fresh.join('%, +')}% — trailing stop armed, nothing sold`)
        save()
      }
      return
    }

    this.busy.add(mint)
    try {
      const fill = await sell({
        mint,
        tokenAmount: decision.sellTokens,
        // A full exit asks the venue for the whole balance, so nothing is left behind
        // to strand the account's rent. See sell().
        sellAll: Boolean(decision.sellAll),
        curve: { vSol, vTokens: position.lastVTokens, realSol: position.lastRealSol },
        // What of OUR stake is still in — the chain's real reserve cannot include a
        // paper buy that never happened. See paperSell.
        paperCredit: Math.max(0, (position.solSpent ?? 0) - (position.solRecovered ?? 0)),
        // 'auto' rather than the venue recorded at creation: a graduated token no
        // longer trades where it was born.
        pool: position.pool === 'pump' ? 'auto' : position.pool,
      })

      if (!fill.ok) {
        log.error(`SELL FAILED for ${position.symbol}: ${fill.error}`)
        position.failedSells = (position.failedSells ?? 0) + 1
        position.lastSellAttemptAt = Date.now()

        /**
         * Retrying an unsellable mint forever burns priority fees on every attempt,
         * and no circuit breaker can see that spend — it is never booked as a realized
         * loss. Back off geometrically and stop trying after the cap, leaving the
         * position flagged for a human rather than grinding the wallet down.
         */
        const n = position.failedSells
        position.retryAfter = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(n - 1, 6))

        // Escaped: an unescaped symbol or error text makes the alert fail HTML parsing,
        // so the one message you most need to receive is silently never delivered.
        if (n === 3 || n === config.exec.maxSellAttempts) {
          await notify(
            `⚠️ <b>Cannot exit ${esc(position.symbol)}</b>\n` +
              `${n} failed sell attempts: ${esc(String(fill.error))}\n` +
              (n >= config.exec.maxSellAttempts
                ? 'Giving up automatic retries — this looks unsellable. Handle it manually.'
                : `Next attempt in ${Math.round((position.retryAfter - Date.now()) / 60_000)}m.`) +
              `\n<code>${esc(mint)}</code>`,
          )
        }
        if (n >= config.exec.maxSellAttempts) {
          position.unsellable = true
          log.error(`${position.symbol} marked unsellable after ${n} attempts — no further retries`)
        }
        save()
        return
      }
      position.failedSells = 0
      position.retryAfter = 0

      applySell(position, fill, decision.reasons)
      position.rungsHit.push(...decision.rungs)
      // Persist before any awaited notification: a crash during the Telegram round-trip
      // would otherwise lose a fill that really happened on chain.
      save()
      this.walletSol = config.paper
        ? paperWalletSol(this.paperStartSol)
        : this.walletSol + fill.solReceived

      const pnl = positionPnl(position)
      logActivity('sell', `SELL ${position.symbol} ${sol(fill.solReceived)} · ${decision.reasons[0] ?? ''}`,
        { mint, sol: fill.solReceived, explore: Boolean(position.explore) })
      if (!position.explore || config.telegram.exploreAlerts) await notifySell(position, fill, decision.reasons, pnl)

      if (decision.sellAll || position.tokensRemaining <= 0) {
        const closed = closePosition(mint, decision.reasons.join('; '))
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        logActivity(closed.realizedSol >= 0 ? 'win' : 'loss',
          `${closed.explore ? 'EXPLORE ' : ''}CLOSE ${closed.symbol} ${sol(closed.realizedSol)} · ${closed.closeReason ?? ''}`,
          { mint, sol: closed.realizedSol, explore: Boolean(closed.explore) })
        if (!closed.explore || config.telegram.exploreAlerts) await notifyClose(closed, pnl)

        /**
         * A loss on a launch is a signal about who deployed it — but ONLY from a trade
         * the strategy actually chose to take.
         *
         * Explore buys launches the filter rejected, on purpose, and they lose most of
         * the time. Without the guard, ~90 explore closes an hour each permanently
         * blocklisted their deployer, and the blocklist is read only by canOpen on the
         * strategy path. So the experiment was quietly vetoing the strategy's own picks:
         * any later launch the filter LIKED from a creator the experiment had lost money
         * on was refused and then journalled as a reject. The one comparison this whole
         * exercise exists to produce was being poisoned by the thing that was supposed
         * to be isolated from it.
         */
        if (!closed.explore && closed.realizedSol < 0 && position.creator) {
          blockCreator(position.creator, `lost ${sol(closed.realizedSol)} on ${position.symbol}`)
        }

        const after = riskSummary(this.walletSol)
        if (after.halted) await notifyHalt(after.halted.reason, after)
      } else {
        save()
      }
    } finally {
      this.busy.delete(mint)
    }
  }

  /** Emergency: dump every open position at maximum slippage tolerance. */
  async panicSell() {
    halt('panic sell requested')
    const positions = openPositions()
    log.warn(`panic selling ${positions.length} position(s)`)

    for (const position of positions) {
      try {
        const fill = await sell({
          mint: position.mint,
          tokenAmount: position.tokensRemaining,
          // Panic is always a full exit.
          sellAll: true,
          curve: { vSol: position.lastVSol, vTokens: position.lastVTokens },
          pool: position.pool === 'pump' ? 'auto' : position.pool,
        })
        if (fill.ok) {
          applySell(position, fill, ['panic sell'])
          const closed = closePosition(position.mint, 'panic sell')
          log.info(`panic sold ${closed.symbol}: ${sol(closed.realizedSol)}`)
        } else {
          log.error(`panic sell failed for ${position.symbol}: ${fill.error}`)
        }
      } catch (err) {
        log.error(`panic sell error on ${position.symbol}: ${err.message}`)
      }
    }

    const summary = riskSummary(this.walletSol)
    await notify(
      `🛑 <b>Panic sell complete</b>\nTotal realized ${sol(summary.totalRealizedSol)}\n${summary.openPositions} position(s) could not be closed.`,
    )
  }
}
