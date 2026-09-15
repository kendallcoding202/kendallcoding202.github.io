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
  /** `interested` lets the bot skip decoding work for mints it does not care about. */
  constructor({ interested = () => true } = {}) {
    super()
    this.interested = interested
    this.url = rpcWebsocketUrl()
    this.ws = null
    this.stopped = false
    this.attempt = 0
    this.subscriptionId = null
    this.lastMessageAt = 0
    this.stats = { notifications: 0, decoded: 0, kept: 0 }
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

      this.stats.notifications++
      for (const trade of tradeEventsFromLogs(value.logs)) {
        this.stats.decoded++
        if (!this.interested(trade.mint)) continue
        this.stats.kept++
        const event = toFeedEvent(trade)
        event.signature = value.signature
        this.emit('trade', event)
      }
    })

    ws.on('close', () => {
      this.emit('close')
      if (!this.stopped) this.#reconnect()
    })

    ws.on('error', (err) => log.warn(`log feed error: ${err.message}`))
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
