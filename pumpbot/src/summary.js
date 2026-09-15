import { config } from './config.js'
import {
  getState,
  strategyPositions,
  explorePositions,
  deployedSol,
  exploreDeployedSol,
  todayPnl,
} from './store.js'
import { positionPnl } from './position.js'
import { sizingSummary } from './sizing.js'
import { esc, sol, pct, shortAddr } from './log.js'

/**
 * Shared text builders for the Telegram surface — used by the /status and /positions
 * commands and by the periodic summary, so the two can never drift apart.
 */

export function statusText(bot) {
  const state = getState()
  const today = todayPnl()
  const stats = bot?.statsSnapshot?.() ?? null
  const s = sizingSummary(bot?.walletSol)

  // Strategy only. Folding explore bags in here made the headline P&L describe a paper
  // experiment rather than the strategy the number is supposed to be reporting on.
  const unrealized = strategyPositions().reduce((sum, p) => sum + positionPnl(p).totalSol, 0)
  const net = state.totalRealizedSol + unrealized

  const lines = [
    `<b>pumpbot</b> — ${config.paper ? 'PAPER' : '<b>LIVE</b>'}${state.halted ? ' · 🛑 HALTED' : ''}`,
    '',
    `Wallet ${sol(bot?.walletSol ?? 0)} · deployed ${sol(deployedSol())}`,
    `Net P&L <b>${sol(net)}</b> · realized ${sol(state.totalRealizedSol)} · unrealized ${sol(unrealized)}`,
    `Today ${sol(today.realizedSol)} · ${today.wins}W/${today.losses}L`,
    `Size ${sol(s.buySol)}/trade${s.nextTier ? ` · next ${sol(s.nextTier.buySol)} at ${sol(s.nextTier.atSol)}` : ''}`,
  ]

  if (state.halted) lines.push('', `Halt reason: ${esc(state.halted.reason)}`)

  if (stats) {
    const tradeHealth =
      stats.creates > 40 && stats.tradesMatched === 0
        ? '⚠️ NO TRADE DATA — entry impossible'
        : `${stats.tradesMatched ?? 0} trades matched`

    lines.push(
      '',
      `Up ${duration(stats.uptimeSeconds)} · build <code>${esc(config.version)}</code> · ${stats.parsing ? 'feed OK' : '⚠️ FEED NOT PARSING'} · ${tradeHealth}`,
      `${stats.creates} launches → ${stats.watching} observing → ${stats.screened} screened → <b>${stats.entered} entered</b>` +
        (stats.explored ? ` · ${stats.explored} explored` : ''),
    )
    if (stats.topRejects?.length) {
      lines.push(`Rejects: ${stats.topRejects.map((r) => `${r.id}×${r.n}`).join(' · ')}`)
    }
  }

  const strategyOpen = strategyPositions()
  lines.push('', `<b>Strategy</b>: ${strategyOpen.length} open · ${state.closed.filter((p) => !p.explore).length} closed`)
  lines.push(exploreText())
  return lines.join('\n')
}

/**
 * The explore book's own P&L. It is its own money on its own bankroll, so it gets its
 * own total rather than a footnote on the strategy's.
 */
export function exploreText() {
  const state = getState()
  const open = explorePositions()
  const closed = state.closed.filter((p) => p.explore).length
  const realized = state.exploreRealizedSol ?? 0
  if (!open.length && !closed && !realized) return ''

  const unrealized = open.reduce((sum, p) => sum + positionPnl(p).totalSol, 0)
  const capped = config.explore.budgetSol > 0

  return [
    '',
    `🧪 <b>Explore book</b> — separate bankroll, not the strategy's money`,
    `  P&L <b>${sol(realized + unrealized)}</b> · realized ${sol(realized)} · open ${sol(unrealized)}`,
    `  ${state.exploreWins ?? 0}W/${state.exploreLosses ?? 0}L over ${closed} closed · ${open.length} open`,
    capped
      ? `  Bankroll ${sol(config.explore.budgetSol + realized - exploreDeployedSol())} left of ${sol(config.explore.budgetSol)}`
      : `  Bankroll unlimited (paper only) · ${sol(exploreDeployedSol())} deployed now`,
  ].join('\n')
}

export function positionsText() {
  const strategy = strategyPositions()
  const explore = explorePositions()
  if (!strategy.length && !explore.length) return '<b>No open positions.</b>'

  const render = (p) => {
    const pnl = positionPnl(p)
    const change = p.entryPriceSol > 0 ? ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100 : 0
    const age = Math.round((Date.now() - p.openedAt) / 1000)
    return [
      `<b>${esc(p.symbol)}</b> ${pct(change)} · ${age < 60 ? `${age}s` : `${Math.round(age / 60)}m`}`,
      `  in ${sol(p.solSpent)} · out ${sol(p.solRecovered)} · P&L ${sol(pnl.totalSol)}`,
      `  ${pnl.initialsRecovered ? '✅ initials out · ' : ''}rungs ${p.rungsHit.length ? p.rungsHit.map((r) => `+${r}%`).join(' ') : 'none'}` +
        (p.explore && p.failedChecks?.length ? ` · would skip: ${esc(p.failedChecks.join(','))}` : ''),
      `  <code>${esc(shortAddr(p.mint))}</code>`,
    ].join('\n')
  }

  const out = []
  out.push(`<b>Strategy — ${strategy.length} open</b>`)
  out.push('')
  out.push(...(strategy.length ? strategy.map(render) : ['<i>none</i>']))
  if (explore.length) {
    out.push('')
    out.push(`🧪 <b>Explore — ${explore.length} open</b> <i>(experiment, separate bankroll)</i>`)
    out.push('')
    out.push(...explore.map(render))
  }
  return out.join('\n')
}

/**
 * The scheduled digest. Leads with what CHANGED since the last one — a repeated static
 * snapshot every few hours trains you to ignore it, which defeats the point.
 */
export function summaryText(bot, since) {
  const state = getState()
  const stats = bot?.statsSnapshot?.() ?? null

  const realizedDelta = state.totalRealizedSol - (since?.totalRealizedSol ?? 0)
  const closedDelta = state.closed.length - (since?.closedCount ?? 0)
  const enteredDelta = (stats?.entered ?? 0) - (since?.entered ?? 0)
  const launchesDelta = (stats?.creates ?? 0) - (since?.creates ?? 0)
  const window = since?.at ? duration(Math.round((Date.now() - since.at) / 1000)) : 'startup'

  const headline =
    closedDelta > 0
      ? `${realizedDelta >= 0 ? '📈' : '📉'} <b>${sol(realizedDelta)}</b> realized on ${closedDelta} trade(s)`
      : enteredDelta > 0
        ? `🟢 <b>${enteredDelta} position(s) opened</b>, none closed yet`
        : '😴 <b>No trades</b> — nothing met the entry bar'

  const lines = [
    `🕓 <b>${window} summary</b>`,
    headline,
    '',
    statusText(bot),
  ]

  /**
   * This used to read "that is the filter working, not a fault". It is only reassuring
   * up to a point: a filter that takes NOTHING, window after window, produces no
   * evidence about itself and is indistinguishable from a broken one. Say which case
   * this is instead of always congratulating it.
   */
  if (launchesDelta > 0 && enteredDelta === 0) {
    const everEntered = (stats?.entered ?? 0) > 0
    lines.push(
      '',
      everEntered
        ? `<i>Screened ${launchesDelta} launches this window and took none — a quiet window.</i>`
        : `<i>Screened ${launchesDelta} launches and took none, and has never taken one. ` +
          `Nothing is being learned about the filter's own picks — consider loosening the entry bar.</i>`,
    )
  }

  if (strategyPositions().length || explorePositions().length) lines.push('', positionsText())

  return lines.join('\n')
}

/** Snapshot used as the baseline for the next summary's deltas. */
export function summaryBaseline(bot) {
  const state = getState()
  const stats = bot?.statsSnapshot?.() ?? null
  return {
    at: Date.now(),
    totalRealizedSol: state.totalRealizedSol,
    closedCount: state.closed.length,
    entered: stats?.entered ?? 0,
    creates: stats?.creates ?? 0,
  }
}

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h < 48 ? `${h}h ${m}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
