import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { getState, openPositions, strategyPositions, explorePositions, deployedSol, todayPnl } from './store.js'
import { positionPnl } from './position.js'
import { sizingSummary } from './sizing.js'
import { analyze } from './learn.js'
import { log } from './log.js'

let learningCache = { at: 0, data: null }

/**
 * The learning report is a full pass over the journal, so it is cached — the dashboard
 * polls every few seconds and this does not change that fast.
 */
function learningSnapshot() {
  if (!config.learning.enabled) return null
  if (Date.now() - learningCache.at < 30_000) return learningCache.data
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
      ? { targetSol: nextTierSol, currentSol: walletSol ?? 0, pct: Math.min(100, ((walletSol ?? 0) / nextTierSol) * 100) }
      : null,
    activity: [...(state.activity ?? [])].reverse().slice(0, 60),
    explore: {
      realizedSol: state.exploreRealizedSol ?? 0,
      wins: state.exploreWins ?? 0,
      losses: state.exploreLosses ?? 0,
      open: explorePositions().length,
      closed: exploreClosed.length,
    },
    learning: learningSnapshot(),
    limits: {
      maxConcurrent: config.sizing.maxConcurrentPositions,
      dailyLossLimitSol: config.risk.dailyLossLimitSol,
      totalLossLimitSol: config.risk.totalLossLimitSol,
      ladder: config.exit.ladder,
      stopLossPct: config.exit.stopLossPct,
      timeStopSeconds: config.exit.timeStopSeconds,
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
        res.writeHead(401, { 'content-type': 'text/plain' })
        res.end('unauthorized')
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
