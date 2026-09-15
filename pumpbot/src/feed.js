import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { config } from './config.js'
import { log, sleep } from './log.js'
import { normalizeEvent, warnUnknownShape, unknownShapeStats } from './curve.js'

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
    // Subscriptions are batched. Sending one socket message per mint means a message
    // every couple of seconds at real launch rates, which the feed throttles — and a
    // throttled subscribe is silent, so it looks like "no trades happening" rather
    // than "we never subscribed".
    this.pendingSub = new Set()
    this.pendingUnsub = new Set()
    this.flushTimer = null
    this.maxWatched = config.feed.maxWatchedMints
    this.droppedWatches = 0
    this.controlMessages = 0
    // Kept verbatim: when the feed refuses a subscription it says so here, and that
    // reply is the only place the real reason appears.
    this.controlSamples = []
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
    clearTimeout(this.flushTimer)
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
        this.pendingSub = new Set(this.watchedMints)
        this.pendingUnsub.clear()
        this.#flush()
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
      if ((parsed?.message || parsed?.errors) && !parsed?.mint) {
        this.controlMessages++
        const text = JSON.stringify(parsed).slice(0, 300)
        // Keep distinct texts only — 30 copies of the same ack tells us nothing.
        if (!this.controlSamples.includes(text) && this.controlSamples.length < 6) {
          this.controlSamples.push(text)
          log.info(`feed control message: ${text}`)
        }
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
    if (this.watchedMints.size >= this.maxWatched) {
      // Refusing loudly beats silently subscribing to more than the feed will serve.
      this.droppedWatches++
      return
    }
    this.watchedMints.add(mint)
    this.pendingUnsub.delete(mint)
    this.pendingSub.add(mint)
    this.#scheduleFlush()
  }

  unwatch(mint) {
    if (!this.watchedMints.delete(mint)) return
    this.pendingSub.delete(mint)
    this.pendingUnsub.add(mint)
    this.#scheduleFlush()
  }

  #scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.#flush()
    }, config.feed.subscribeBatchMs)
  }

  #flush() {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    for (const [method, set] of [
      ['subscribeTokenTrade', this.pendingSub],
      ['unsubscribeTokenTrade', this.pendingUnsub],
    ]) {
      if (!set.size) continue
      const keys = [...set]
      set.clear()
      // Chunked so one message never gets rejected for being oversized.
      for (let i = 0; i < keys.length; i += 100) {
        const payload = { method, keys: keys.slice(i, i + 100) }
        // Kept so the "no trades matched" diagnostic can show exactly what we sent —
        // comparing our payload against the docs is the fastest way to settle whether
        // the subscription format is wrong.
        if (method === 'subscribeTokenTrade') {
          this.lastSubscribe = { method, sampleKeys: payload.keys.slice(0, 2), count: payload.keys.length, at: Date.now() }
        }
        this.#send(payload)
      }
    }
  }

  subscriptionStats() {
    return {
      watched: this.watchedMints.size,
      pending: this.pendingSub.size + this.pendingUnsub.size,
      dropped: this.droppedWatches,
      max: this.maxWatched,
      lastSubscribe: this.lastSubscribe ?? null,
      controlMessages: this.controlMessages,
      controlSamples: this.controlSamples,
      unparsed: unknownShapeStats(),
    }
  }
}
