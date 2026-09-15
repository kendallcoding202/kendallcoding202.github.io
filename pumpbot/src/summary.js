import { config } from './config.js'
import { getState, openPositions, strategyPositions, explorePositions, deployedSol, todayPnl } from './store.js'
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
  const open = openPositions()
  const stats = bot?.statsSnapshot?.() ?? null
  const s = sizingSummary(bot?.walletSol)

  const unrealized = open.reduce((sum, p) => sum + positionPnl(p).totalSol, 0)
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

  const strategyOpen = strategyPositions().length
  const exploreOpen = explorePositions().length
  lines.push('', `<b>Strategy</b>: ${strategyOpen} open · ${state.closed.filter((p) => !p.explore).length} closed`)

  if (exploreOpen || state.exploreRealizedSol) {
    lines.push(
      `🧪 <b>Explore</b> (experiment, separate book): ${exploreOpen} open · ` +
        `${state.exploreWins ?? 0}W/${state.exploreLosses ?? 0}L · ${sol(state.exploreRealizedSol ?? 0)}`,
    )
  }
  return lines.join('\n')
}

export function positionsText() {
  const open = openPositions()
  if (!open.length) return '<b>No open positions.</b>'

  return [
    `<b>${open.length} open position(s)</b>`,
    '',
    ...open.map((p) => {
      const pnl = positionPnl(p)
      const tag = p.explore ? ' 🧪' : ''
      const change = p.entryPriceSol > 0 ? ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100 : 0
      const age = Math.round((Date.now() - p.openedAt) / 1000)
      return [
        `<b>${esc(p.symbol)}</b>${tag} ${pct(change)} · ${age < 60 ? `${age}s` : `${Math.round(age / 60)}m`}`,
        `  in ${sol(p.solSpent)} · out ${sol(p.solRecovered)} · P&L ${sol(pnl.totalSol)}`,
        `  ${pnl.initialsRecovered ? '✅ initials out · ' : ''}rungs ${p.rungsHit.length ? p.rungsHit.map((r) => `+${r}%`).join(' ') : 'none'}`,
        `  <code>${esc(shortAddr(p.mint))}</code>`,
      ].join('\n')
    }),
  ].join('\n')
}

/**
 * The scheduled digest. Leads with what CHANGED since the last one — a repeated static
 * snapshot every few hours trains you to ignore it, which defeats the point.
 */
export function summaryText(bot, since) {
  const state = getState()
  const open = openPositions()
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

  if (launchesDelta > 0 && enteredDelta === 0) {
    lines.push('', `<i>Screened ${launchesDelta} launches this window and took none. That is the filter working, not a fault.</i>`)
  }

  if (open.length) lines.push('', positionsText())

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
