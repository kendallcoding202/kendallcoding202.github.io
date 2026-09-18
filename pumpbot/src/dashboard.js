import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import {
  getState,
  openPositions,
  strategyPositions,
  explorePositions,
  deployedSol,
  exploreDeployedSol,
  todayPnl,
} from './store.js'
import { positionPnl } from './position.js'
import { sizingSummary } from './sizing.js'
import { analyze } from './learn.js'
import { log } from './log.js'

let learningCache = { at: 0, data: null }

/**
 * Is the data actually being kept? On a hosted platform DATA_DIR has to point at a
 * mounted volume, or every restart starts from nothing — and that failure is silent,
 * because a bot writing to ephemeral disk looks completely healthy right up until it
 * forgets everything.
 */
function storageSnapshot() {
  const stat = (name) => {
    try {
      const st = fs.statSync(path.join(config.dataDir, name))
      return { bytes: st.size, modifiedAt: st.mtimeMs }
    } catch {
      return null
    }
  }
  const journal = stat(config.paper ? 'journal-paper.jsonl' : 'journal-live.jsonl')
  let writable = false
  try {
    fs.accessSync(config.dataDir, fs.constants.W_OK)
    writable = true
  } catch {
    /* reported as false */
  }
  return {
    dataDir: config.dataDir,
    writable,
    journalBytes: journal?.bytes ?? 0,
    ledger: Boolean(stat(config.paper ? 'paper-state.json' : 'live-state.json')),
    // A checkpoint means pending observations will survive the next restart.
    pendingCheckpoint: Boolean(stat(config.paper ? 'shadow-paper.json' : 'shadow-live.json')),
  }
}

let learningComputing = false

/**
 * NEVER computed on the request path.
 *
 * analyze() is synchronous and walks the whole journal; measured at 22s for 50,000 rows
 * before the scan was rewritten, and the journal grows by thousands of rows an hour. On
 * the request path that freezes the dashboard AND the trade feed, because they share one
 * event loop — a report that is expensive to read stops the bot it is reporting on.
 *
 * So: serve whatever is cached, kick off a refresh behind it, and let the next poll pick
 * up the new numbers. The page polls every few seconds, so a stale-by-one-cycle report is
 * invisible; a frozen bot is not.
 */
function learningSnapshot() {
  if (!config.learning.enabled) return null
  if (Date.now() - learningCache.at > 30_000 && !learningComputing) {
    learningComputing = true
    setTimeout(() => {
      try {
        computeLearning()
      } finally {
        learningComputing = false
      }
    }, 0).unref?.()
  }
  return learningCache.data
}

function computeLearning() {
  try {
    const a = analyze()
    learningCache = {
      at: Date.now(),
      data: {
        labelled: a.totals.labelled,
        pending: a.totals.pending,
        bought: a.totals.bought,
        rejected: a.totals.rejected,
        minSamples: a.minSamples,
        enoughData: a.enoughData,
        baseRatePct: a.rates.base.n ? a.rates.base.p * 100 : null,
        boughtRatePct: a.rates.bought.n ? a.rates.bought.p * 100 : null,
        rejectedRatePct: a.rates.rejected.n ? a.rates.rejected.p * 100 : null,
        filterEdge: a.filterEdge,
        ev: a.ev.bought,
        topMisses: a.falseNegatives.slice(0, 4),
        suggestions: a.suggestions.slice(0, 4),
        stale: a.totals.stale,
        truncated: a.totals.truncated,
        journalled: a.totals.journalled,
        olderThanCap: a.totals.olderThanCap,
        explored: a.totals.explored,
      },
    }
  } catch (err) {
    log.debug(`learning snapshot failed: ${err.message}`)
    learningCache = { at: Date.now(), data: null }
  }
  return learningCache.data
}

const here = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.join(here, 'dashboard.html')

let solPriceUsd = null
let solPriceAt = 0

/** Best-effort SOL/USD so the page can show dollars. Never blocks or throws. */
async function refreshSolPrice() {
  if (Date.now() - solPriceAt < 300_000) return solPriceUsd
  try {
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
      { signal: AbortSignal.timeout(8000) },
    )
    if (res.ok) {
      const data = await res.json()
      const best = (data?.pairs ?? [])
        .filter((p) => Number(p?.priceUsd) > 0)
        .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0]
      if (best) {
        solPriceUsd = Number(best.priceUsd)
        solPriceAt = Date.now()
      }
    }
  } catch {
    /* dollars are a nicety; SOL figures are the source of truth */
  }
  return solPriceUsd
}

export function buildSnapshot(walletSol, stats = null) {
  const state = getState()
  const open = openPositions()
  const today = todayPnl()

  const positions = open.map((p) => {
    const pnl = positionPnl(p)
    return {
      mint: p.mint,
      symbol: p.symbol,
      openedAt: p.openedAt,
      ageSeconds: Math.round((Date.now() - p.openedAt) / 1000),
      solSpent: p.solSpent,
      solRecovered: p.solRecovered,
      tokensBought: p.tokensBought,
      tokensRemaining: p.tokensRemaining,
      entryPriceSol: p.entryPriceSol,
      lastPriceSol: p.lastPriceSol,
      peakPriceSol: p.peakPriceSol,
      changePct:
        p.entryPriceSol > 0 ? ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100 : 0,
      rungsHit: p.rungsHit,
      explore: Boolean(p.explore),
      failedChecks: p.failedChecks ?? [],
      markValueSol: pnl.markValueSol,
      totalSol: pnl.totalSol,
      totalPct: pnl.totalPct,
      initialsRecovered: pnl.initialsRecovered,
      failedSells: p.failedSells ?? 0,
    }
  })

  const markValueSol = positions.filter((p) => !p.explore).reduce((s, p) => s + p.markValueSol, 0)
  const unrealizedSol = positions.filter((p) => !p.explore).reduce((s, p) => s + p.totalSol, 0)

  const closed = [...state.closed].reverse().slice(0, 100).map((p) => ({
    mint: p.mint,
    symbol: p.symbol,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    heldSeconds: Math.round((p.closedAt - p.openedAt) / 1000),
    solSpent: p.solSpent,
    solRecovered: p.solRecovered,
    realizedSol: p.realizedSol,
    realizedPct: p.solSpent > 0 ? (p.realizedSol / p.solSpent) * 100 : 0,
    reason: p.closeReason,
    explore: Boolean(p.explore),
    // What the filter objected to, so an explore row says why it was an experiment.
    failedChecks: p.failedChecks ?? [],
    rungsHit: p.rungsHit,
  }))

  const strategyClosed = state.closed.filter((p) => !p.explore)
  const exploreClosed = state.closed.filter((p) => p.explore)
  const wins = strategyClosed.filter((p) => p.realizedSol > 0).length
  const losses = strategyClosed.filter((p) => p.realizedSol < 0).length

  // Cumulative realized curve for the chart, oldest first.
  let running = 0
  const history = [...strategyClosed]
    .sort((a, b) => a.closedAt - b.closedAt)
    .map((p) => ({ at: p.closedAt, sol: (running += p.realizedSol) }))

  const nextTierSol = sizingSummary(walletSol).nextTier?.atSol ?? null

  return {
    mode: config.paper ? 'paper' : 'live',
    version: config.version,
    halted: state.halted,
    updatedAt: Date.now(),
    solPriceUsd,
    wallet: {
      solBalance: walletSol,
      deployedSol: deployedSol(),
      markValueSol,
      // Liquid SOL plus what the open bags are currently worth.
      totalValueSol: (Number.isFinite(walletSol) ? walletSol : 0) + markValueSol,
    },
    pnl: {
      realizedTotalSol: state.totalRealizedSol,
      realizedTodaySol: today.realizedSol,
      unrealizedSol,
      netSol: state.totalRealizedSol + unrealizedSol,
      wins,
      losses,
      winRatePct: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      consecutiveLosses: state.consecutiveLosses,
      tradesClosed: strategyClosed.length,
    },
    sizing: sizingSummary(walletSol),
    pipeline: stats,
    history,
    goal: nextTierSol
      ? {
          targetSol: nextTierSol,
          currentSol: walletSol ?? 0,
          pct: Math.max(0, Math.min(100, ((walletSol ?? 0) / nextTierSol) * 100)),
        }
      : null,
    activity: [...(state.activity ?? [])].reverse().slice(0, 60),
    explore: {
      realizedSol: state.exploreRealizedSol ?? 0,
      wins: state.exploreWins ?? 0,
      losses: state.exploreLosses ?? 0,
      open: explorePositions().length,
      closed: exploreClosed.length,
      // The experiment's separate bankroll, so it is obvious at a glance that none of
      // this is coming out of the strategy's money. null means unlimited — the panel
      // shows what has been spent instead of what is left, which is the useful number
      // when there is no ceiling to count down from.
      deployedSol: exploreDeployedSol(),
      bankrollSol: config.explore.budgetSol > 0 ? config.explore.budgetSol : null,
      bankrollLeftSol:
        config.explore.budgetSol > 0
          ? config.explore.budgetSol + (state.exploreRealizedSol ?? 0) - exploreDeployedSol()
          : null,
      enabled: config.explore.enabled,
    },
    learning: learningSnapshot(),
    learningPending: config.learning.enabled && learningCache.at === 0,
    storage: storageSnapshot(),
    /**
     * The EFFECTIVE settings, read back out of the live config rather than assumed.
     *
     * A default changed in code is silently overridden by an environment variable of the
     * same name, and the last time that happened it cost several rounds of guessing at
     * what the deployment was actually running. Showing the values the process resolved
     * turns "did my change take effect?" into something you can read off the page.
     */
    limits: {
      maxConcurrent: config.sizing.maxConcurrentPositions,
      dailyLossLimitSol: config.risk.dailyLossLimitSol,
      totalLossLimitSol: config.risk.totalLossLimitSol,
      dailyLossLimitPct: config.risk.dailyLossLimitPct,
      maxDrawdownPct: config.risk.maxDrawdownPct,
      ladder: config.exit.ladder,
      stopLossPct: config.exit.stopLossPct,
      timeStopSeconds: config.exit.timeStopSeconds,
      entry: {
        minUniqueBuyers: config.entry.minUniqueBuyers,
        minBuysPerSell: config.entry.minBuysPerSell,
        minMarketCapSol: config.entry.minMarketCapSol,
        maxMarketCapSol: config.entry.maxMarketCapSol,
        maxDevHoldPct: config.entry.maxDevHoldPct,
        observeSeconds: config.entry.observeSeconds,
      },
      learning: {
        maxShadowTracked: config.learning.maxShadowTracked,
        outcomeWindowMinutes: config.learning.outcomeWindowMinutes,
        minSamplesForSuggestion: config.learning.minSamplesForSuggestion,
      },
      exploreBankrollSol: config.explore.budgetSol,
    },
    positions,
    closed,
  }
}

/**
 * getContext() returns { walletSol, stats } — a getter rather than values so every
 * poll reflects live bot state.
 */
export function startDashboard(getContext) {
  if (!config.dashboard.enabled) return null

  const { host, port, token } = config.dashboard
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'

  if (!isLoopback && !token) {
    throw new Error(
      `DASHBOARD_HOST is ${host} but DASHBOARD_TOKEN is unset. ` +
        'Refusing to expose wallet and P&L data without a token — prefer an SSH tunnel to 127.0.0.1.',
    )
  }

  const server = http.createServer(async (req, res) => {
    // Constant-ish token check for non-loopback binds.
    if (!isLoopback) {
      const provided = new URL(req.url, 'http://x').searchParams.get('token') ?? ''
      if (provided !== token) {
        /**
         * Say what is missing, not just that something is. A bare "unauthorized" gives
         * no way forward, and the answer — append ?token= — is not guessable from it.
         * The token itself is never echoed: the whole point of the check is that this
         * page exposes a wallet and its P&L.
         */
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>pumpbot — token required</title>' +
            '<body style="background:#080b14;color:#e8edf7;font:15px/1.6 ui-sans-serif,system-ui;' +
            'padding:32px 20px;max-width:640px;margin:0 auto">' +
            '<h1 style="font-size:19px;margin:0 0 14px">Token required</h1>' +
            '<p style="color:#6b7a99;margin:0 0 18px">This page shows a wallet balance, open ' +
            'positions and P&amp;L, so it is not reachable without one.</p>' +
            '<p style="margin:0 0 10px">Add your token to the URL:</p>' +
            '<pre style="background:#0e1422;border:1px solid #1e2942;border-radius:10px;padding:12px 14px;' +
            'overflow-x:auto;font-size:13px;color:#4dd8ff">' +
            (provided ? '…up.railway.app/?token=&lt;the correct token&gt;' : '…up.railway.app/?token=&lt;your token&gt;') +
            '</pre>' +
            '<p style="color:#6b7a99;font-size:13.5px;margin:16px 0 0">' +
            (provided
              ? 'A token was supplied but did not match. '
              : 'No token was supplied. ') +
            'It is the value of <code style="color:#ffb347">DASHBOARD_TOKEN</code> in your ' +
            'host\u2019s environment variables. Once the page loads it keeps the token on every ' +
            'refresh, so bookmark the full URL.</p></body>',
        )
        return
      }
    }

    const url = new URL(req.url, 'http://x')

    if (url.pathname === '/api/state') {
      await refreshSolPrice()
      const ctx = getContext() ?? {}
      const body = JSON.stringify(buildSnapshot(ctx.walletSol, ctx.stats ?? null))
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      res.end(body)
      return
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const html = fs.readFileSync(PAGE)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(html)
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(`dashboard page missing: ${err.message}`)
      }
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  server.listen(port, host, () => {
    log.info(`dashboard on http://${host}:${port}${isLoopback ? '  (tunnel: ssh -N -L ' + port + ':localhost:' + port + ' user@vps)' : ''}`)
  })

  server.on('error', (err) => log.error(`dashboard server error: ${err.message}`))
  return server
}
