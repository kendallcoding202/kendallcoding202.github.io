import { config } from './config.js'
import { getState, openPositions, deployedSol, todayPnl, clearHalt, halt } from './store.js'
import { positionPnl } from './position.js'
import { sizingSummary } from './sizing.js'
import { notify } from './notify.js'
import { log, esc, sol, pct, shortAddr, sleep } from './log.js'

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
            '/pause — stop opening new positions',
            '/resume — allow new positions again',
            '/panic confirm — sell everything now',
          ].join('\n'),
        )

      case '/status':
        return this.#reply(this.#statusText())

      case '/positions':
        return this.#reply(this.#positionsText())

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

      default:
        return null // not a command we know; stay quiet
    }
  }

  async #reply(text) {
    await notify(text)
    return text
  }

  #statusText() {
    const state = getState()
    const today = todayPnl()
    const open = openPositions()
    const stats = this.bot?.statsSnapshot?.() ?? null
    const s = sizingSummary(this.bot?.walletSol)

    const unrealized = open.reduce((sum, p) => sum + positionPnl(p).totalSol, 0)
    const net = state.totalRealizedSol + unrealized

    const lines = [
      `<b>pumpbot</b> — ${config.paper ? 'PAPER' : '<b>LIVE</b>'}${state.halted ? ' · 🛑 HALTED' : ''}`,
      '',
      `Wallet ${sol(this.bot?.walletSol ?? 0)} · deployed ${sol(deployedSol())}`,
      `Net P&L <b>${sol(net)}</b> · realized ${sol(state.totalRealizedSol)} · unrealized ${sol(unrealized)}`,
      `Today ${sol(today.realizedSol)} · ${today.wins}W/${today.losses}L`,
      `Size ${sol(s.buySol)}/trade${s.nextTier ? ` · next ${sol(s.nextTier.buySol)} at ${sol(s.nextTier.atSol)}` : ''}`,
    ]

    if (state.halted) lines.push('', `Halt reason: ${esc(state.halted.reason)}`)

    if (stats) {
      const up = stats.uptimeSeconds
      const uptime = up < 3600 ? `${Math.round(up / 60)}m` : `${Math.floor(up / 3600)}h ${Math.round((up % 3600) / 60)}m`
      lines.push(
        '',
        `Up ${uptime} · ${stats.parsing ? 'feed OK' : '⚠️ FEED NOT PARSING'}`,
        `${stats.creates} launches → ${stats.watching} observing → ${stats.screened} screened → <b>${stats.entered} entered</b>`,
      )
      if (stats.topRejects?.length) {
        lines.push(`Rejects: ${stats.topRejects.map((r) => `${r.id}×${r.n}`).join(' · ')}`)
      }
    }

    lines.push('', `${open.length} open · ${state.closed.length} closed`)
    return lines.join('\n')
  }

  #positionsText() {
    const open = openPositions()
    if (!open.length) return '<b>No open positions.</b>'

    return [
      `<b>${open.length} open position(s)</b>`,
      '',
      ...open.map((p) => {
        const pnl = positionPnl(p)
        const change = p.entryPriceSol > 0 ? ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100 : 0
        const age = Math.round((Date.now() - p.openedAt) / 1000)
        return [
          `<b>${esc(p.symbol)}</b> ${pct(change)} · ${age < 60 ? `${age}s` : `${Math.round(age / 60)}m`}`,
          `  in ${sol(p.solSpent)} · out ${sol(p.solRecovered)} · P&L ${sol(pnl.totalSol)}`,
          `  ${pnl.initialsRecovered ? '✅ initials out · ' : ''}rungs ${p.rungsHit.length ? p.rungsHit.map((r) => `+${r}%`).join(' ') : 'none'}`,
          `  <code>${esc(shortAddr(p.mint))}</code>`,
        ].join('\n')
      }),
    ].join('\n')
  }
}
