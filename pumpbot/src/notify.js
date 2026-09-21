import { config } from './config.js'
import { log, esc, sol, pct, sleep, shortAddr } from './log.js'

const LIMIT = 4000

/**
 * Telegram notifications. Deliberately best-effort: a failed send must never take down
 * the trading loop or delay an exit, so every failure is logged and swallowed.
 */
/**
 * Delivery health, so "am I actually receiving these?" is answerable.
 *
 * Every failure here is swallowed on purpose — a Telegram outage must never delay an
 * exit — but swallowed is not the same as invisible, and the difference matters: a
 * silent channel and a healthy one looked identical from the outside.
 */
export const deliveryStats = {
  sent: 0,
  failed: 0,
  lastError: null,
  lastSentAt: null,
  configured: false,
  /**
   * How the last MULTI-PART message went, because that is the failure that hides.
   *
   * A dropped part of a ten-part report does not look like an error from the outside;
   * it looks like a report that begins in the middle, which reads as the bot having
   * less to say rather than the channel having lost some of it.
   */
  lastMultipart: null, // { at, parts, delivered }
}

/**
 * Telegram accepts roughly one message per second to a single chat. The gap here was
 * 300ms, which is fine for the one- or two-part messages this started with and too fast
 * for a report that now needs ten — the later parts come back 429, and a 429 was logged
 * and swallowed, so parts of the learning report simply never arrived.
 */
const PART_GAP_MS = 1100
const MAX_ATTEMPTS = 3
/**
 * Never wait longer than this on a retry, even when Telegram asks for more. notify() is
 * awaited from the trade path, and a rate limit on a chat must not be able to stall an
 * exit — dropping one alert is recoverable, holding the loop for half a minute is not.
 */
const MAX_RETRY_WAIT_MS = 4000

/**
 * `pre` wraps EACH split part, rather than the whole message.
 *
 * Wrapping first and splitting after tears the tag pair apart: the first part opens <pre>
 * and never closes it, the last closes one that was never opened, and Telegram rejects
 * malformed HTML outright — so a long report simply never arrives, with nothing to show
 * for it. Short reports fit in one part and look fine, which is why this hides until the
 * data grows.
 */
export async function notify(text, { silent = false, pre = false } = {}) {
  const tag = config.paper ? '📝 <b>[PAPER]</b> ' : ''
  const body = tag + text

  deliveryStats.configured = Boolean(config.telegram.token && config.telegram.chatId)
  if (!deliveryStats.configured) {
    log.info(`[notify] ${body.replace(/<[^>]+>/g, '')}`)
    return false
  }

  const url = `https://api.telegram.org/bot${config.telegram.token}/sendMessage`
  const parts = split(body)
  let delivered = 0

  for (let i = 0; i < parts.length; i++) {
    // Only BETWEEN parts. A single-part alert — every entry, sell and halt — must not
    // pay a pacing delay it cannot benefit from.
    if (i > 0) await sleep(PART_GAP_MS)
    const part = pre ? `<pre>${parts[i]}</pre>` : parts[i]
    if (await sendPart(url, part, silent)) delivered++
  }

  if (parts.length > 1) {
    deliveryStats.lastMultipart = { at: Date.now(), parts: parts.length, delivered }
    if (delivered < parts.length) {
      log.warn(`telegram delivered ${delivered}/${parts.length} parts — the message arrived incomplete`)
    }
  }
  const allDelivered = delivered === parts.length

  /**
   * Report what actually happened.
   *
   * This returned `true` unconditionally, including when every send failed. The
   * four-hourly summary re-baselines its deltas on a truthful return — "only after a
   * successful send, so a failed send does not swallow a window's worth of activity" —
   * so the guard silently did nothing, and a dropped summary took that window's activity
   * with it. The next digest then measured from a baseline for a report nobody received.
   */
  return allDelivered
}

/**
 * One part, with bounded retries.
 *
 * 429 is the case that mattered: Telegram returns it with `parameters.retry_after`, and
 * the old code treated it as a permanent failure — so a rate-limited part of a long
 * report was dropped and never mentioned. It is the most RECOVERABLE error there is;
 * it says exactly how long to wait.
 */
async function sendPart(url, part, silent) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      if (res.ok) {
        deliveryStats.sent++
        deliveryStats.lastSentAt = Date.now()
        return true
      }
      const info = await res.json().catch(() => ({}))
      const why = `${res.status} ${info?.description ?? ''}`.trim()
      const askedFor = Number(info?.parameters?.retry_after) * 1000
      // 429 says wait; 5xx is Telegram's own problem and usually passes. A 400 is a
      // malformed message and will fail identically forever, so it is not retried.
      const wait = res.status === 429 ? (Number.isFinite(askedFor) && askedFor > 0 ? askedFor + 250 : 1500) : attempt * 800
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS && wait <= MAX_RETRY_WAIT_MS) {
        log.debug(`telegram ${why} — retrying in ${wait}ms (${attempt}/${MAX_ATTEMPTS})`)
        await sleep(wait)
        continue
      }
      log.warn(`telegram send failed: ${why}`)
      deliveryStats.failed++
      deliveryStats.lastError = why
      return false
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 800)
        continue
      }
      log.warn(`telegram send error: ${err.message}`)
      deliveryStats.failed++
      deliveryStats.lastError = err.message
      return false
    }
  }
  return false
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
      /**
       * An adopted position has solSpent 0 by design — what it originally cost is
       * unknowable after the fact, and inventing a number would invent a profit. So the
       * percentage is undefined, and dividing anyway printed NaN% or Infinity% on the
       * one message that is supposed to tell you how a trade went.
       */
      position.solSpent > 0
        ? `Realized <b>${sol(position.realizedSol)}</b> (${pct((position.realizedSol / position.solSpent) * 100)})`
        : `Realized <b>${sol(position.realizedSol)}</b> <i>(no cost basis — adopted position)</i>`,
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
      /**
       * Telegram first, because the CLI path cannot work here. `panic` checks the ledger
       * lock before reaching its resume branch, and on a hosted deploy the bot always
       * holds that lock — so the command this used to recommend always refuses.
       */
      `Clear with <code>/resume</code> here once you have looked at why.`,
      `(<code>npm run panic -- resume</code> only works with the bot stopped.)`,
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
