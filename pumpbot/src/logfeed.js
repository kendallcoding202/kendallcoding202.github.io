import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { config } from './config.js'
import { log, sleep } from './log.js'
import { tradeEventsFromLogs, toFeedEvent, rpcWebsocketUrl } from './pumpevents.js'

/**
 * Trade feed built from Solana transaction logs instead of a metered data provider.
 *
 * ONE subscription to the pump.fun program delivers every trade on every token, so
 * there is no per-token subscribe, no subscription cap, no batching delay, and no
 * per-message billing. PumpPortal's trade tape is metered at 0.01 SOL per 10,000
 * messages, which at real launch-density runs well over a SOL a day — many times the
 * entire trading stack it is meant to serve.
 *
 * What it gives us is exactly what the paid tape gave us: the trader address (distinct
 * buyers), the direction (buy/sell ratio), and post-trade reserves (price).
 *
 * Known limitation: Solana truncates very long transaction logs, so an event inside a
 * heavily-nested transaction can be dropped. A geyser/gRPC feed would not lose those,
 * but costs hundreds a month. For counting buyers in a 30-second window, occasional
 * loss is acceptable; for exits it is covered by the stale-price rule.
 */
export class LogFeed extends EventEmitter {
  /**
   * `interested` skips DOWNSTREAM work for mints we do not care about — the decode has
   * already happened by then, since the mint is inside the event.
   *
   * `interestedTrader` is the other axis: a wallet we are tracking, on ANY token. That
   * distinction is what separates a confirmation signal from a discovery one. Asking
   * "is smart money in the launch I am already considering" only needs mints in our
   * pipeline; asking "what did smart money just buy" needs the tokens we are NOT
   * watching, which is precisely the interesting case. Those trades were being decoded
   * and discarded, so the second axis costs one Set lookup.
   */
  constructor({ interested = () => true, interestedTrader = () => false } = {}) {
    super()
    this.interested = interested
    this.interestedTrader = interestedTrader
    this.url = rpcWebsocketUrl()
    this.ws = null
    this.stopped = false
    this.attempt = 0
    this.subscriptionId = null
    this.lastMessageAt = 0
    this.stats = { notifications: 0, decoded: 0, kept: 0, smart: 0 }
  }

  start() {
    if (!this.url) {
      log.error('no usable RPC websocket URL — the free trade feed cannot start')
      return
    }
    this.stopped = false
    this.#connect()
    this.watchdog = setInterval(() => {
      if (this.stopped || !this.lastMessageAt) return
      if (Date.now() - this.lastMessageAt > 120_000) {
        log.warn('log feed silent for 120s — reconnecting')
        this.lastMessageAt = Date.now()
        try {
          this.ws?.terminate()
        } catch {
          /* already gone */
        }
      }
    }, 30_000)
  }

  async stop() {
    this.stopped = true
    clearInterval(this.watchdog)
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }

  #redacted() {
    return String(this.url).replace(/api[-_]?key=[^&]*/i, 'api-key=<redacted>')
  }

  #connect() {
    if (this.stopped) return
    log.info(`log feed connecting to ${this.#redacted()}`)
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.on('open', () => {
      this.attempt = 0
      this.lastMessageAt = Date.now()
      // `mentions` takes exactly one address — the program ID is all we need, and the
      // mint filter happens locally.
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'logsSubscribe',
          params: [{ mentions: [config.pumpProgramId] }, { commitment: 'processed' }],
        }),
      )
      log.info('log feed subscribed to the pump.fun program')
      this.emit('open')
    })

    ws.on('message', (data) => {
      this.lastMessageAt = Date.now()
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }

      if (msg.id === 1 && msg.result !== undefined) {
        this.subscriptionId = msg.result
        return
      }
      if (msg.method !== 'logsNotification') return

      const value = msg.params?.result?.value
      if (!value || value.err) return // failed transactions moved no money

      this.handleNotification(value)
    })

    ws.on('close', () => {
      this.emit('close')
      if (!this.stopped) this.#reconnect()
    })

    ws.on('error', (err) => log.warn(`log feed error: ${err.message}`))
  }

  /**
   * Split out from the socket handler so the routing can be tested against real decoded
   * logs rather than a reimplementation of it. Which channel a trade reaches is the
   * whole behaviour here, and a test that rebuilds the rules to check them proves only
   * that the copy agrees with itself.
   */
  handleNotification(value) {
    if (!value || value.err) return
    this.stats.notifications++
    for (const trade of tradeEventsFromLogs(value.logs)) {
      this.stats.decoded++
      const mintWanted = this.interested(trade.mint)
      const traderWanted = this.interestedTrader(trade.trader)
      if (!mintWanted && !traderWanted) continue
      const event = toFeedEvent(trade)
      event.signature = value.signature
      /**
       * Emitted on a SEPARATE channel, not folded into 'trade'.
       *
       * A tracked wallet's trade on a token we do not follow must not reach the
       * trading path: it would inflate the trade counters and be handed to candidate
       * and shadow lookups that can only miss. Two questions, two events.
       */
      if (traderWanted) {
        this.stats.smart++
        this.emit('smart-trade', event)
      }
      if (!mintWanted) continue
      this.stats.kept++
      this.emit('trade', event)
    }
  }

  async #reconnect() {
    this.attempt++
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt - 1, 5))
    log.warn(`log feed disconnected — reconnecting in ${wait / 1000}s`)
    await sleep(wait)
    this.#connect()
  }

  feedStats() {
    return { ...this.stats, connected: this.ws?.readyState === WebSocket.OPEN }
  }
}
