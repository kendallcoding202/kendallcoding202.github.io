import { config } from './config.js'
import { getState, openPositions, clearHalt, halt, save } from './store.js'
import { statusText, positionsText } from './summary.js'
import { notify } from './notify.js'
import { log, esc, sleep } from './log.js'

/**
 * Telegram command listener.
 *
 * Long-polls getUpdates so the bot can be queried and controlled from a phone without
 * exposing the dashboard on a public URL.
 *
 * SECURITY: every update is checked against the configured chat id before it is acted
 * on. Telegram bot tokens leak, and anyone who finds one can message the bot — without
 * this check a stranger could read your P&L or liquidate your positions. The chat id is
 * the authorization boundary.
 */
export class CommandListener {
  constructor(bot) {
    this.bot = bot
    this.offset = 0
    this.stopped = false
    this.enabled = Boolean(config.telegram.token && config.telegram.chatId)
  }

  async start() {
    if (!this.enabled) {
      log.debug('telegram commands disabled (no token/chat id)')
      return
    }
    // Drain anything queued while we were down, so a restart cannot replay an old
    // /panic that was sent hours ago.
    await this.#drainBacklog()
    this.#loop().catch((err) => log.error(`telegram command loop died: ${err.message}`))
    log.info('telegram commands active — send /status to the bot')
  }

  stop() {
    this.stopped = true
  }

  async #api(method, params = {}) {
    const url = `https://api.telegram.org/bot${config.telegram.token}/${method}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        // Longer than the long-poll timeout so the request is not cut short.
        signal: AbortSignal.timeout((params.timeout ?? 0) * 1000 + 15000),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data?.ok ? data.result : null
    } catch {
      return null
    }
  }

  async #drainBacklog() {
    const updates = await this.#api('getUpdates', { timeout: 0, offset: -1 })
    if (updates?.length) this.offset = updates[updates.length - 1].update_id + 1
  }

  async #loop() {
    while (!this.stopped) {
      const updates = await this.#api('getUpdates', { timeout: 25, offset: this.offset })
      if (!updates) {
        await sleep(5000) // network hiccup — back off rather than hammer
        continue
      }
      for (const u of updates) {
        this.offset = u.update_id + 1
        const msg = u.message ?? u.channel_post
        if (!msg?.text) continue

        // The authorization check. Anything from another chat is ignored silently —
        // replying would confirm the bot exists to whoever is probing it.
        if (String(msg.chat?.id) !== String(config.telegram.chatId)) {
          log.warn(`ignoring command from unauthorized chat ${msg.chat?.id}`)
          continue
        }

        await this.handle(msg.text.trim()).catch((err) =>
          log.error(`command "${msg.text}" failed: ${err.message}`),
        )
      }
    }
  }

  /** Exposed for tests: takes raw text, performs the command, returns what it replied. */
  async handle(text) {
    const [rawCmd, ...args] = text.split(/\s+/)
    const cmd = rawCmd.toLowerCase().replace(/@.*$/, '') // strip @botname in groups

    switch (cmd) {
      case '/start':
      case '/help':
        return this.#reply(
          [
            '<b>pumpbot commands</b>',
            '/status — balance, P&L, pipeline',
            '/positions — open positions',
            '/dashboard — a link that opens, token included',
            '/pause — stop opening new positions',
            '/resume — allow new positions again',
            '/panic confirm — sell everything now',
            '/reset confirm — clear the paper book (paper only)',
          ].join('\n'),
        )

      case '/status':
        return this.#reply(statusText(this.bot))

      case '/positions':
        return this.#reply(positionsText())

      /**
       * Hands over a link that actually opens.
       *
       * The dashboard is token-protected because it shows a wallet and its P&L, which
       * means the URL alone is useless — and the token lives in the host's environment,
       * not on a phone. This chat is already authenticated against a single chat id and
       * already has /panic and /reset, so it can open the dashboard without granting
       * anything it did not already have.
       */
      case '/dashboard':
      case '/link': {
        const { publicUrl, token: dashToken, host } = config.dashboard
        if (!config.dashboard.enabled) return this.#reply('The dashboard is switched off (<code>DASHBOARD=0</code>).')
        if (!publicUrl) {
          return this.#reply(
            'I do not know this bot\u2019s public URL.\n' +
              'Set <code>DASHBOARD_URL</code> to the address you open, then ask again.' +
              (host === '127.0.0.1' ? '\n\nThe dashboard is also bound to localhost only, so it is not reachable from a phone yet.' : ''),
          )
        }
        const url = dashToken ? `${publicUrl}/?token=${encodeURIComponent(dashToken)}` : publicUrl
        return this.#reply(
          `📊 <b>Dashboard</b>\n<a href="${esc(url)}">${esc(publicUrl)}</a>\n\n` +
            (dashToken
              ? '<i>The link carries the access token. Your phone remembers it after the first open, ' +
                'so later visits work from the plain address.</i>'
              : '<i>No token set — this page is open to anyone with the address.</i>'),
        )
      }

      case '/pause': {
        halt('paused from Telegram')
        return this.#reply('⏸ <b>Paused.</b> No new entries. Open positions are still managed to exit.')
      }

      case '/resume': {
        clearHalt()
        return this.#reply('▶️ <b>Resumed.</b> New entries allowed again.')
      }

      case '/panic': {
        // Destructive and irreversible — never on a bare command.
        if (args[0]?.toLowerCase() !== 'confirm') {
          const n = openPositions().length
          return this.#reply(
            `⚠️ This sells <b>all ${n} open position(s)</b> immediately at up to 90% slippage.\n` +
              'Send <code>/panic confirm</code> if you mean it.',
          )
        }
        await this.#reply('🛑 Panic selling…')
        await this.bot.panicSell()
        return 'panic'
      }

      /**
       * Clears the paper ledger from inside the running process. On a hosted platform
       * the CLI reset cannot run — the bot holds the single-writer lock, and rightly
       * so — which would otherwise leave no practical way to start a clean measurement.
       */
      case '/reset': {
        if (!config.paper) {
          return this.#reply('❌ Refusing — this is the <b>LIVE</b> ledger, a record of real money.')
        }
        const s2 = getState()
        const summary =
          `${s2.closed.length} closed · ${openPositions().length} open · ` +
          `strategy ${(s2.totalRealizedSol ?? 0).toFixed(4)} · explore ${(s2.exploreRealizedSol ?? 0).toFixed(4)} SOL`

        if (args[0]?.toLowerCase() !== 'confirm') {
          return this.#reply(
            `🧹 <b>Reset the paper book?</b>\nCurrently: ${summary}\n\n` +
              'Send <code>/reset confirm</code>. The decision journal is kept — that is ' +
              'the learning data; only the trade ledger is cleared.',
          )
        }

        s2.positions = {}
        s2.closed = []
        s2.daily = {}
        s2.activity = []
        s2.totalRealizedSol = 0
        s2.exploreRealizedSol = 0
        s2.exploreWins = 0
        s2.exploreLosses = 0
        s2.consecutiveLosses = 0
        s2.baseEquitySol = 0
        s2.peakRealizedSol = 0
        s2.blockedCreators = {}
        s2.halted = null
        save()
        return this.#reply(`🧹 <b>Paper book cleared.</b>\nWas: ${summary}\nMeasuring from here.`)
      }

      default:
        return null // not a command we know; stay quiet
    }
  }

  async #reply(text) {
    await notify(text)
    return text
  }
}
