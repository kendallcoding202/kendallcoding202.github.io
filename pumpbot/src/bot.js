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
} from './store.js'
import { decideExit, newPosition, applySell, markPrice, positionPnl } from './position.js'
import { getPublicKey, getSolBalance } from './wallet.js'
import { notifyEntry, notifySell, notifyClose, notifyHalt, notifyStartup, notify } from './notify.js'
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
      screened: 0,
      entered: 0,
      rejects: new Map(),
      firstParsedAt: null,
      startedAt: null,
      // Reset each heartbeat so the log shows rate, not just a running total.
      sinceBeat: { messages: 0, creates: 0, screened: 0, entered: 0 },
    }
  }

  statsSnapshot() {
    const s = this.stats
    return {
      messages: s.messages,
      creates: s.creates,
      trades: s.trades,
      screened: s.screened,
      entered: s.entered,
      watching: this.candidates.size,
      shadowTracked: this.shadow?.size ?? 0,
      parsing: s.firstParsedAt !== null,
      uptimeSeconds: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
      topRejects: [...s.rejects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n })),
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

    const rejects = this.statsSnapshot().topRejects
    log.info(
      `+${beat.creates} launches (${s.creates} total) · watching ${this.candidates.size} · ` +
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
      // Paper mode starts at the configured floor tier so sizing behaves identically.
      this.walletSol = Number(process.env.PAPER_START_SOL ?? 0.5)
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

    log.info(`starting in ${config.paper ? 'PAPER' : 'LIVE'} mode as ${pubkey}`)
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

    this.stats.startedAt = Date.now()
    this.feed.on('raw', () => {
      this.stats.messages++
      this.stats.sinceBeat.messages++
    })
    this.feed.on('create', (e) => this.#onCreate(e))
    this.feed.on('trade', (e) => this.#onTrade(e))
    this.feed.start()

    // Sweeps cover everything the event stream cannot: silent tokens, the time stop,
    // abandoning stale candidates, closing outcome windows, and the day rollover.
    this.sweepTimer = setInterval(() => this.#sweep().catch((e) => log.error(e)), 5000)
    this.balanceTimer = setInterval(() => this.#refreshBalance().catch((e) => log.debug(e)), 60_000)
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
    await this.feed.stop()
    save()
  }

  async #refreshBalance() {
    if (config.paper) return
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
    if (openPositions().length >= config.sizing.maxConcurrentPositions) return

    this.candidates.set(event.mint, new Candidate(event))
    this.feed.watch(event.mint)
  }

  #onTrade(event) {
    this.stats.trades++
    if (this.stopping) return

    this.candidates.get(event.mint)?.apply(event)
    this.shadow?.onTrade(event)

    const position = getState().positions[event.mint]
    if (position?.state === 'open') {
      markPrice(position, event.priceSol)
      position.lastVSol = event.vSol
      position.lastVTokens = event.vTokens
      // Evaluate on the tick, not on a timer — a rung should fire when it is crossed.
      this.#manage(position, event.priceSol, event.vSol).catch((err) => log.error(err))
    }
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
        // Keep watching rejects so we learn what the filter is throwing away.
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

  async #enter(candidate, verdict) {
    const mint = candidate.mint
    if (this.busy.has(mint)) return

    const blocked = canOpen({ mint, creator: candidate.creator, walletSol: this.walletSol })
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
        `ENTERING ${candidate.symbol} at ${sol(buySol)} — ${candidate.organicBuyers} buyers, mc ${candidate.marketCapSol?.toFixed(1)} SOL`,
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
      addPosition(position)
      this.walletSol -= fill.solSpent

      this.stats.entered++
      this.stats.sinceBeat.entered++
      this.shadow?.track({ candidate, verdict, action: 'bought', entryPriceSol: fill.avgPriceSol })

      await notifyEntry(position, {
        buyers: candidate.organicBuyers,
        devHoldPct: candidate.devHoldPct,
      })
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
      this.walletSol += fill.solReceived

      const pnl = positionPnl(position)
      await notifySell(position, fill, decision.reasons, pnl)

      if (decision.sellAll || position.tokensRemaining <= 0) {
        const closed = closePosition(mint, decision.reasons.join('; '))
        if (!this.shadow?.has(mint)) this.feed.unwatch(mint)
        await notifyClose(closed, pnl)

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
