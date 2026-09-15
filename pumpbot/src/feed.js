import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { config } from './config.js'
import { log, sleep } from './log.js'
import { normalizeEvent, warnUnknownShape } from './curve.js'

/**
 * Live feed of pump.fun deploys and trades.
 *
 * Emits: 'create' (new token), 'trade' (buy/sell on a watched mint), 'raw', 'open',
 * 'close'. Reconnects with backoff and re-subscribes, because a silently dead socket
 * while holding open positions is the most dangerous failure this bot has.
 */
export class Feed extends EventEmitter {
  constructor({ url = config.wsFeedUrl } = {}) {
    super()
    this.url = url
    this.ws = null
    this.watchedMints = new Set()
    this.stopped = false
    this.attempt = 0
    this.lastMessageAt = 0
  }

  start() {
    this.stopped = false
    this.#connect()
    // A feed that stops delivering looks identical to a quiet market from the outside.
    this.watchdog = setInterval(() => {
      if (this.stopped || !this.lastMessageAt) return
      const idleMs = Date.now() - this.lastMessageAt
      if (idleMs > 120_000) {
        log.warn(`no feed messages for ${Math.round(idleMs / 1000)}s — forcing a reconnect`)
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

  #connect() {
    if (this.stopped) return
    log.info(`connecting to feed ${this.url}`)
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.on('open', () => {
      this.attempt = 0
      this.lastMessageAt = Date.now()
      log.info('feed connected')
      this.#send({ method: 'subscribeNewToken' })
      if (this.watchedMints.size) {
        this.#send({ method: 'subscribeTokenTrade', keys: [...this.watchedMints] })
      }
      this.emit('open')
    })

    ws.on('message', (data) => {
      this.lastMessageAt = Date.now()
      let parsed
      try {
        parsed = JSON.parse(data.toString())
      } catch {
        return
      }
      this.emit('raw', parsed)

      // Subscription acks and similar control messages carry no mint.
      if (parsed?.message && !parsed?.mint) {
        log.debug('feed control message:', parsed.message)
        return
      }

      const event = normalizeEvent(parsed)
      if (!event) {
        warnUnknownShape(parsed)
        return
      }
      this.emit(event.kind === 'create' ? 'create' : 'trade', event)
    })

    ws.on('close', () => {
      this.emit('close')
      if (this.stopped) return
      this.#reconnect()
    })

    ws.on('error', (err) => {
      log.warn('feed error:', err.message)
    })
  }

  async #reconnect() {
    this.attempt++
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt - 1, 5))
    log.warn(`feed disconnected — reconnecting in ${wait / 1000}s (attempt ${this.attempt})`)
    await sleep(wait)
    this.#connect()
  }

  #send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(payload))
    return true
  }

  watch(mint) {
    if (this.watchedMints.has(mint)) return
    this.watchedMints.add(mint)
    this.#send({ method: 'subscribeTokenTrade', keys: [mint] })
  }

  unwatch(mint) {
    if (!this.watchedMints.delete(mint)) return
    this.#send({ method: 'unsubscribeTokenTrade', keys: [mint] })
  }
}
