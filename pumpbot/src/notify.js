import { config } from './config.js'
import { log, esc, sol, pct, sleep, shortAddr } from './log.js'

const LIMIT = 4000

/**
 * Telegram notifications. Deliberately best-effort: a failed send must never take down
 * the trading loop or delay an exit, so every failure is logged and swallowed.
 */
export async function notify(text, { silent = false } = {}) {
  const tag = config.paper ? '📝 <b>[PAPER]</b> ' : ''
  const body = tag + text

  if (!config.telegram.token || !config.telegram.chatId) {
    log.info(`[notify] ${body.replace(/<[^>]+>/g, '')}`)
    return false
  }

  const url = `https://api.telegram.org/bot${config.telegram.token}/sendMessage`
  for (const part of split(body)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: part,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          disable_notification: silent,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const info = await res.json().catch(() => ({}))
        log.warn(`telegram send failed: ${res.status} ${info?.description ?? ''}`)
      }
    } catch (err) {
      log.warn(`telegram send error: ${err.message}`)
    }
    await sleep(300)
  }
  return true
}

function split(text) {
  if (text.length <= LIMIT) return [text]
  const parts = []
  let current = ''
  for (const block of text.split('\n')) {
    if (current && current.length + block.length + 1 > LIMIT) {
      parts.push(current)
      current = block
    } else {
      current = current ? `${current}\n${block}` : block
    }
  }
  if (current) parts.push(current)
  return parts
}

const chartLink = (mint) => `https://pump.fun/coin/${mint}`

export const notifyEntry = (position, entryChecks) =>
  notify(
    [
      position.explore
        ? `🧪 <b>EXPLORE BUY ${esc(position.symbol)}</b> <i>(experiment — not the strategy)</i>`
        : `🟢 <b>BOUGHT ${esc(position.symbol)}</b>`,
      `${sol(position.solSpent)} → ${position.tokensBought.toFixed(0)} tokens`,
      `Entry ${position.entryPriceSol.toExponential(3)} SOL/token`,
      `Buyers: ${entryChecks?.buyers ?? '?'} · dev holds ${entryChecks?.devHoldPct?.toFixed(1) ?? '?'}%`,
      position.explore && position.failedChecks?.length
        ? `Filter would have skipped: <code>${esc(position.failedChecks.join(', '))}</code>`
        : '',
      `<a href="${chartLink(position.mint)}">chart</a> · <code>${esc(position.mint)}</code>`,
    ]
      .filter(Boolean)
      .join('\n'),
    { silent: Boolean(position.explore) },
  )

export const notifySell = (position, fill, reasons, pnl) =>
  notify(
    [
      `${position.explore ? '🧪' : pnl.totalSol >= 0 ? '💰' : '🔻'} <b>${position.explore ? 'EXPLORE ' : ''}SOLD ${esc(position.symbol)}</b>`,
      reasons.join(' · '),
      `${fill.tokensSold.toFixed(0)} tokens → ${sol(fill.solReceived)}`,
      `Recovered ${sol(position.solRecovered)} of ${sol(position.solSpent)} · ${position.tokensRemaining.toFixed(0)} tokens left`,
      `P&L ${sol(pnl.totalSol)} (${pct(pnl.totalPct)})${pnl.initialsRecovered ? ' · <b>initials recovered</b>' : ''}`,
    ].join('\n'),
    { silent: Boolean(position.explore) },
  )

export const notifyClose = (position, pnl) =>
  notify(
    [
      `${position.explore ? '🧪' : position.realizedSol >= 0 ? '✅' : '❌'} <b>${position.explore ? 'EXPLORE ' : ''}CLOSED ${esc(position.symbol)}</b> — ${esc(position.closeReason ?? '')}`,
      `In ${sol(position.solSpent)} · out ${sol(position.solRecovered)}`,
      `Realized <b>${sol(position.realizedSol)}</b> (${pct((position.realizedSol / position.solSpent) * 100)})`,
      `Held ${Math.round((position.closedAt - position.openedAt) / 1000)}s`,
      position.explore ? '<i>Experiment — kept out of the strategy P&L.</i>' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    { silent: Boolean(position.explore) },
  )

export const notifyHalt = (reason, summary) =>
  notify(
    [
      `🛑 <b>BOT HALTED</b>`,
      esc(reason),
      `Today ${sol(summary.todayRealizedSol)} · total ${sol(summary.totalRealizedSol)}`,
      `${summary.openPositions} position(s) still open — they will still be managed to exit.`,
      `Clear with <code>npm run panic -- resume</code> once you have looked at why.`,
    ].join('\n'),
  )

export const notifyStartup = (pubkey, balanceSol, summary) => {
  const s = summary.sizing
  return notify(
    [
      `🤖 <b>pumpbot started</b> — ${config.paper ? 'PAPER' : '<b>LIVE</b>'}`,
      `Wallet <code>${esc(shortAddr(pubkey))}</code> · ${sol(balanceSol)}`,
      `Size <b>${sol(s.buySol)}</b>/trade · max ${s.maxConcurrent} open · cap ${sol(s.maxDeployedSol)}`,
      s.nextTier
        ? `Next tier ${sol(s.nextTier.buySol)}/trade at ${sol(s.nextTier.atSol)} (${sol(s.nextTier.remainingSol)} to go)`
        : 'Top size tier',
      `Ladder ${config.exit.ladder.map((r) => `+${r.atPct}%→${r.sellPct}%`).join(', ')}`,
      `Stop ${config.exit.stopLossPct}% · time stop ${config.exit.timeStopSeconds}s`,
      summary.openPositions ? `Resuming ${summary.openPositions} open position(s).` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}
