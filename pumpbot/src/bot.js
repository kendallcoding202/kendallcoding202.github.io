import { config } from './config.js'
import { Feed } from './feed.js'
import { Candidate, evaluateEntry } from './filter.js'
import { buy, sell } from './exec.js'
import { canOpen, riskSummary, rolloverDaily } from './risk.js'
import { buySolFor, tierFor, sizingSummary } from './sizing.js'
import { ShadowTracker } from './journal.js'
import {
  initStore,
  getState,
  save,
  addPosition,
  closePosition,
  openPositions,
  blockCreator,
  halt,
  logActivity,
  paperWalletSol,
} from './store.js'
import { decideExit, newPosition, applySell, markPrice, positionPnl } from './position.js'
import { getPublicKey, getSolBalance, getAllTokenBalances } from './wallet.js'
import { notifyEntry, notifySell, notifyClose, notifyHalt, notifyStartup, notify } from './notify.js'
import { summaryText, summaryBaseline } from './summary.js'
import { log, sol, utcDay } from './log.js'

/**
 * The trading loop.
 *
 * Watch every deploy, observe each for a window, buy the few that show real organic
 * buying, then manage exits off the live trade feed. Exits are driven by price events
 * rather than a timer, so a rung fires on the tick that crosses it.
 */
export class Bot {
  /** `feed` is injectable so the whole loop can be driven by a synthetic feed in tests. */
  constructor({ feed } = {}) {
    this.feed = feed ?? new Feed()
    this.candidates = new Map() // mint -> Candidate, pre-entry
    this.shadow = config.learning.enabled ? new ShadowTracker() : null
    this.walletSol = 0
    this.lastDay = utcDay()
    this.lastTierFloor = null
    this.busy = new Set() // mints with an in-flight order, preventing double-sends
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
      entered: 0,
      explored: 0,
      rejects: new Map(),
      firstParsedAt: null,
      startedAt: null,
      // Reset each heartbeat so the log shows rate, not just a running total.
      sinceBeat: { messages: 0, creates: 0, screened: 0, entered: 0 },
      costWarned: false,
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
      screened: s.screened,
      entered: s.entered,
      explored: s.explored,
      watching: this.candidates.size,
      shadowTracked: this.shadow?.size ?? 0,
      parsing: s.firstParsedAt !== null,
      uptimeSeconds: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
      topRejects: [...s.rejects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n })),
      feedCost: this.#feedCost(),
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
    const spentSol = (this.stats.messages / 10_000) * rate
    const uptimeH = Math.max(this.stats.uptimeHours(), 1 / 60)
    return {
      messages: this.stats.messages,
      spentSol,
      perDaySol: (spentSol / uptimeH) * 24,
      warnAtSol: config.feed.costWarnSol,
    }
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
    if (cost && !s.costWarned && cost.spentSol >= cost.warnAtSol) {
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
        `screened +${beat.screened}/${s.screened} · entered +${beat.entered}/${s.entered} · ` +
        `open ${openPositions().length} · shadow ${this.shadow?.size ?? 0}` +
        (rejects.length ? ` · rejects: ${rejects.map((r) => `${r.id}×${r.n}`).join(' ')}` : ''),
    )

    s.sinceBeat = { messages: 0, creates: 0, screened: 0, entered: 0 }
  }

  async start() {
    initStore()
    const pubkey = getPublicKey().toBase58()

    if (config.paper) {
      this.paperStartSol = Number(process.env.PAPER_START_SOL ?? 0.5)
      this.walletSol = paperWalletSol(this.paperStartSol)
    } else {
      this.walletSol = await getSolBalance()
      const needed = buySolFor(this.walletSol) + config.sizing.reserveSol
      if (this.walletSol < needed) {
        throw new Error(
          `wallet holds ${sol(this.walletSol)} — needs at least ${sol(needed)} (one position + reserve)`,
        )
      }
    }

    this.lastTierFloor = tierFor(this.walletSol).minEquitySol
    const summary = riskSummary(this.walletSol)

    log.info(`starting in ${config.paper ? 'PAPER' : 'LIVE'} mode as ${pubkey} · build ${config.version}`)
    log.info(
      `tier: ${sol(summary.sizing.buySol)}/trade at ${sol(this.walletSol)} equity` +
        (summary.sizing.nextTier
          ? ` · next ${sol(summary.sizing.nextTier.buySol)}/trade at ${sol(summary.sizing.nextTier.atSol)}`
          : ''),
    )
    await notifyStartup(pubkey, this.walletSol, summary)

    for (const p of openPositions()) {
      this.feed.watch(p.mint)
      log.info(`resuming position ${p.symbol} (${p.mint})`)
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
    this.feed.on('create', (e) => this.#onCreate(e))
    this.feed.on('trade', (e) => this.#onTrade(e))
    this.feed.start()

    // Sweeps cover everything the event stream cannot: silent tokens, the time stop,
    // abandoning stale candidates, closing outcome windows, and the day rollover.
    this.sweepTimer = setInterval(() => this.#sweep().catch((e) => log.error(e)), 5000)
    this.balanceTimer = setInterval(() => this.#refreshBalance().catch((e) => log.debug(e)), 60_000)
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
    await this.feed.stop()
    save()
  }

  async #refreshBalance() {
    if (config.paper) {
      // Recomputed rather than trusted, so any drift corrects itself every minute.
      this.walletSol = paperWalletSol(this.paperStartSol)
      return
    }
    const before = this.walletSol
    this.walletSol = await getSolBalance()

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

    if (this.stopping || getState().halted) return
    if (this.candidates.has(event.mint)) return

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

  #onTrade(event) {
    this.stats.trades++
    if (this.stopping) return

    const candidate = this.candidates.get(event.mint)
    const position = getState().positions[event.mint]
    if (candidate || position) this.stats.tradesMatched++

    candidate?.apply(event)
    this.shadow?.onTrade(event)

    if (position?.state === 'open') {
      markPrice(position, event.priceSol)
      position.lastVSol = event.vSol
      position.lastVTokens = event.vTokens
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

    const known = new Set(Object.keys(getState().positions))
    const orphans = held.filter((t) => !known.has(t.mint))
    if (!orphans.length) return []

    log.error('═══════════════════════════════════════════════════════════')
    log.error(`${orphans.length} token(s) in the wallet are NOT in the ledger:`)
    for (const o of orphans) log.error(`   ${o.mint}  ${o.amount.toFixed(0)} tokens`)
    log.error('These are unmanaged — no stop-loss, no time stop, no exit.')
    log.error('Usually this means the state file was lost (ephemeral storage?).')
    log.error('Run `npm run adopt` to bring them under management, or sell manually.')
    log.error('═══════════════════════════════════════════════════════════')

    await notify(
      `⚠️ <b>${orphans.length} unmanaged position(s)</b>\n` +
        'Tokens in the wallet that the ledger does not know about — they have no ' +
        'stop-loss and no exit rules.\n' +
        orphans.map((o) => `<code>${o.mint}</code>`).join('\n') +
        '\n\nThis usually means the state file was lost. Run <code>npm run adopt</code>.',
    )

    return orphans
  }

  /** Runs one sweep on demand. The scheduler calls #sweep directly; tests use this. */
  async tick() {
    return this.#sweep()
  }

  async #sweep() {
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
      if (candidate.ageSeconds < config.entry.observeSeconds) continue

      const verdict = evaluateEntry(candidate)
      this.candidates.delete(mint)

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

      await this.#enter(candidate, verdict)
    }

    // Close out outcome windows and stop following those mints.
    for (const row of this.shadow?.finalizeAllDue() ?? []) {
      if (!getState().positions[row.mint]) this.feed.unwatch(row.mint)
    }

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
    if (!e.enabled) return false
    if (verdict.failed.some((c) => e.neverRelax.includes(c.id))) return false
    if (openPositions().length >= e.maxConcurrent) return false

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
      return false
    }
    this.stats.exploreParked = false

    // The experiment has a budget, like any experiment.
    const spent = -(getState().exploreRealizedSol ?? 0)
    if (spent >= e.budgetSol) {
      if (!this.stats.exploreBudgetHit) {
        this.stats.exploreBudgetHit = true
        log.warn(`exploration stopped — spent ${sol(spent)} of its ${sol(e.budgetSol)} budget`)
      }
      return false
    }

    return Math.random() < e.sampleRate
  }

  async #enter(candidate, verdict, { explore = false } = {}) {
    const mint = candidate.mint
    if (this.busy.has(mint)) return

    // Explore trades are paper-only and exist to gather data, so the exposure caps that
    // protect real capital do not apply — but a halt still does, and so does not
    // double-buying the same mint.
    const blocked = explore
      ? getState().halted
        ? `halted: ${getState().halted.reason}`
        : getState().positions[mint]
          ? 'already holding this mint'
          : null
      : canOpen({ mint, creator: candidate.creator, walletSol: this.walletSol })

    if (blocked) {
      log.info(`not entering ${candidate.symbol}: ${blocked}`)
      this.shadow?.track({ candidate, verdict, action: 'rejected' })
      if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
      if (getState().halted) await notifyHalt(getState().halted.reason, riskSummary(this.walletSol))
      return
    }

    this.busy.add(mint)
    try {
      const buySol = buySolFor(this.walletSol)
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

      if (!fill.ok) {
        log.warn(`entry failed for ${candidate.symbol}: ${fill.error}`)
        this.shadow?.track({ candidate, verdict, action: 'rejected' })
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

    const decision = decideExit(position, { priceSol, vSol })
    if (!(decision.sellTokens > 0)) return

    this.busy.add(mint)
    try {
      const fill = await sell({
        mint,
        tokenAmount: decision.sellTokens,
        curve: { vSol, vTokens: position.lastVTokens },
        pool: position.pool,
      })

      if (!fill.ok) {
        log.error(`SELL FAILED for ${position.symbol}: ${fill.error}`)
        position.failedSells = (position.failedSells ?? 0) + 1
        // Repeated exit failures mean we are stuck. Say so loudly — silently retrying
        // forever is how a small loss becomes a total one.
        if (position.failedSells === 3) {
          await notify(
            `⚠️ <b>Cannot exit ${position.symbol}</b>\n3 failed sell attempts: ${fill.error}\nThis may be unsellable. <code>${mint}</code>`,
          )
        }
        save()
        return
      }

      applySell(position, fill, decision.reasons)
      position.rungsHit.push(...decision.rungs)
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

        // A total loss on a launch is a signal about who deployed it.
        if (closed.realizedSol < 0 && position.creator) {
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
          curve: { vSol: position.lastVSol, vTokens: position.lastVTokens },
          pool: position.pool,
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
