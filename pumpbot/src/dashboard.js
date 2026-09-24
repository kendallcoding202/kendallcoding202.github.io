import http from 'node:http'
import zlib from 'node:zlib'
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
  strategyRecord,
  exploreRecord,
  recordSince,
  closeReasonMix,
} from './store.js'
import { journalHealth, volumeSpace } from './journal.js'
import { positionPnl } from './position.js'
import { sizingSummary } from './sizing.js'
import { consecutiveLossLimit } from './risk.js'
import { refreshIfStale, snapshot as analysisSnapshot, analysisHealth } from './analysis.js'
import { buildExportInWorker } from './export.js'
import { deliveryStats } from './notify.js'
import { readGraduations, GRAD_CHECKPOINTS } from './graduation.js'
import { log } from './log.js'


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
    /**
     * Whether rows are LANDING, which `writable` does not answer. accessSync tests
     * permissions; a volume with no space left passes it and then fails every write.
     * This is the only signal that separates "collecting" from "silently losing
     * everything", and it was not on the page.
     */
    writes: journalHealth(),
    /**
     * The real mount, so "how long until this fills up" stops being a question you have
     * to answer by navigating a hosting console — and starts being one the bot can warn
     * about BEFORE the writes start failing rather than after.
     */
    volume: volumeSpace(),
    journalBytes: journal?.bytes ?? 0,
    ledger: Boolean(stat(config.paper ? 'paper-state.json' : 'live-state.json')),
    // A checkpoint means pending observations will survive the next restart.
    pendingCheckpoint: Boolean(stat(config.paper ? 'shadow-paper.json' : 'shadow-live.json')),
  }
}


/**
 * Serve what was last computed; ask the WORKER for a fresh one if it is due.
 *
 * Deferring with setTimeout(0) was not enough and the reasoning above was wrong about
 * why. It moved the work off the request path but left it on the event loop, and the
 * cost had been measured on an unrepresentative sample: on the real journal, 152,000
 * rows carrying the full 24-feature vector, analyze() takes 73 SECONDS. That is not a
 * slow report — for 73 seconds the websocket is not read, so prices go stale and the
 * stale-price rule force-closes live positions blind. Every few minutes. The analysis
 * was corrupting the data it analyses and losing money doing it.
 */
function learningSnapshot() {
  if (!config.learning.enabled) return null
  refreshIfStale()
  return analysisSnapshot()
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

/**
 * One unambiguous answer to "is it collecting data right now?"
 *
 * That question has been asked repeatedly and every answer so far has come from reading
 * a screenshot and inferring. The pieces were all on the page — launches, shadowed,
 * journal size, halt banner — but assembling them into a verdict was left to the reader,
 * and the reader is the one person who cannot see the code. So decide it here, from the
 * same state the bot acts on, and say which link of the chain is broken when one is.
 */
function collectionStatus(stats, storage, learning, analysis = null) {
  const reasons = []
  if (!config.learning.enabled) reasons.push('LEARNING is off — nothing is being journalled')
  if (!storage.writable) reasons.push(`${storage.dataDir} is not writable — nothing can be saved`)
  /**
   * Writes FAILING is a different failure from the directory being unwritable, and it is
   * the one that actually happens: the volume fills, appendFileSync throws ENOSPC on
   * every row, and every other indicator on this page stays green.
   */
  /**
   * Running OUT of room, said before the writes start failing.
   *
   * The failure alert below is the backstop, and a backstop is the wrong place to learn
   * this: by the time appends throw, rows are already being lost. The default 85% is
   * late enough not to nag and early enough to act on at ~40 MB/day.
   */
  if (storage.volume && storage.volume.usedPct >= config.volumeWarnPct) {
    reasons.push(
      `the volume at ${storage.dataDir} is ${storage.volume.usedPct.toFixed(0)}% full ` +
        `(${(storage.volume.freeBytes / 1e9).toFixed(2)} GB left of ` +
        `${(storage.volume.totalBytes / 1e9).toFixed(2)} GB) — when it fills, rows are lost silently`,
    )
  }
  if (storage.writes?.consecutive > 0) {
    reasons.push(
      `the journal is NOT being written — ${storage.writes.consecutive} consecutive failed writes` +
        `${storage.writes.lastError ? ` (${storage.writes.lastError})` : ''}. ` +
        'Everything gathered since then is lost and is not recoverable.',
    )
  }
  if (stats) {
    if (!stats.parsing && stats.messages > 50) reasons.push('the feed is not parsing')
    if (stats.creates > 40 && stats.tradesMatched === 0) {
      reasons.push('no trade events are reaching watched tokens, so no outcome can be labelled')
    }
    if (stats.creates > 20 && stats.watching === 0 && stats.shadowTracked === 0) {
      reasons.push('launches are arriving but none are being observed')
    }
  }

  /**
   * Rows per hour, from the rows' own timestamps rather than from uptime.
   *
   * This was `labelled / uptimeHours`, which divides a total accumulated over days by
   * the time since the last restart. Twenty-five minutes after a redeploy it claimed
   * 339,985 rows/hr on a journal of 140,055 — it was reporting the entire history as if
   * all of it had arrived since the deploy. Worse, the error is largest right after a
   * restart, which is precisely when the banner is being read to check a deploy landed.
   */
  const perHour = learning && typeof learning.labelledLastHour === 'number' ? learning.labelledLastHour : null

  return {
    collecting: reasons.length === 0,
    reasons,
    tracking: stats?.shadowTracked ?? 0,
    usableRows: learning?.labelled ?? 0,
    rowsOnDisk: learning?.journalled ?? 0,
    usablePerHour: perHour,
    // Enough to say anything at all about the filter.
    needed: config.learning.minSamplesForSuggestion,
    /**
     * Storage belongs HERE, not in the limits panel where it used to sit.
     *
     * Whether DATA_DIR is a mounted volume decides whether months of evidence survive
     * the next redeploy, which makes it the single most consequential fact on the page —
     * and it was the second-to-last line of the longest card, below the loss limits.
     * "Are we collecting?" and "will what we collect still be here tomorrow?" are the
     * same question, so they belong in the same banner.
     */
    storage,
    creatorPrior: stats?.creatorPrior ?? null,
    walletPrior: stats?.walletPrior ?? null,
    /**
     * Sits with the priors rather than in the pipeline note: while it is unproven it is
     * the most uncertain thing running, since its response format could not be verified
     * before shipping.
     */
    offCurve: stats?.offCurve ?? null,
    /** How much of what we trade is a coin pump.fun is running a random walk on. */
    mayhem: stats?.mayhem ?? null,
    /** Price ticks refused as physically impossible for a bonding curve. */
    impossibleCurve: stats?.impossibleCurve ?? null,
    /** WHY positions are closing, per book — the fastest read on whether a change landed. */
    exitMix: { strategy: closeReasonMix(false), explore: closeReasonMix(true) },
    /** The fill probe's results — the one thing paper cannot measure. */
    probe: stats?.probe ?? null,
    // Live, from the bot — unlike the rankings, which ride along with the analysis.
    smartTape: stats?.smartTape ?? null,
    /**
     * COLLECTING and ANALYSING are different things, and the banner must not conflate
     * them. Journalling is the bot writing rows; the analysis is a separate worker that
     * reads them afterwards. When that worker fails, learningSnapshot() is null, so
     * usableRows and rowsOnDisk both read 0 — which looks exactly like the data being
     * gone while the bot is in fact journalling perfectly well.
     *
     * "Collecting fine, the report is broken" and "we are losing data" want opposite
     * reactions, so say which one it is.
     */
    countsUnavailable: Boolean(learning === null && config.learning.enabled),
    analysisFailing: (analysis?.failures ?? 0) > 0,
    analysisRetryInSeconds: analysis?.nextAttemptInSeconds ?? 0,
    analysisError: analysis?.lastError ?? null,
  }
}

/**
 * THE GRADUATION EXPERIMENT, reported apart from the trading numbers.
 *
 * This is a different hypothesis on a different population with a different clock, and
 * it never trades. Folding it into the P&L panels would invite exactly the confusion the
 * whole exercise is meant to avoid -- the launch strategy is a measured negative, and a
 * promising-looking number from a separate experiment must not read as its recovery.
 *
 * Progress is reported against the PRE-REGISTERED bar (n >= 300 complete to 240m), not
 * against whatever has arrived, so a curve computed on 12 rows cannot look like an answer.
 */
function graduationSummary(tracker) {
  if (!config.graduation.enabled) return null
  /**
   * Journalled rows AND the ones still inside their window.
   *
   * A row lands on disk only when its full 24h window expires, but the pre-registered
   * decision horizon is 240m -- four hours. Counting the file alone left the progress bar
   * at zero for a full day while 153 tokens were being tracked and 70 were already
   * priced. A row whose 240m checkpoint is filled is evidence whether or not its last
   * checkpoint has arrived.
   */
  const rows = [...readGraduations(), ...(tracker?.inFlight() ?? [])]
  const idx240 = GRAD_CHECKPOINTS.indexOf(240)
  // A fixed population, present at every checkpoint up to 240m. Coverage decaying with
  // horizon is what made the on-curve horizon curve unreadable until it was controlled.
  const complete = rows.filter((r) => r.mult?.slice(0, idx240 + 1).every((m) => m !== null))
  const curve = GRAD_CHECKPOINTS.map((min, i) => {
    const v = complete.map((r) => r.mult?.[i]).filter((m) => Number.isFinite(m))
    return { min, n: v.length, mean: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
  })
  const at240 = curve[idx240]
  const quiet = rows.filter((r) => r.quoteWentQuiet).length
  const live = tracker?.stats() ?? null
  return {
    tracking: live?.tracking ?? 0,
    /**
     * Watched mints that have actually produced a post-graduation price. If this stays
     * at zero while `tracking` climbs, the feed is not delivering PumpSwap trades and the
     * experiment is collecting nothing -- which must be visible now, not in 24 hours.
     */
    priced: live?.priced ?? 0,
    quiet: live?.quiet ?? 0,
    recorded: rows.filter((r) => !r.pending).length,
    /** Tracked, priced, and not yet at the end of their window. */
    pending: rows.filter((r) => r.pending).length,
    complete: complete.length,
    /** The pre-registered bar. Below it, nothing is decided. */
    needed: 300,
    powered: complete.length >= 300,
    quietShare: rows.length ? quiet / rows.length : null,
    curve,
    meanAt240: at240?.mean ?? null,
    /** Pre-registered: act only above 1.06, which is the ~5.6pp round trip. */
    clearsToll: at240?.mean !== null && at240?.mean !== undefined ? at240.mean > 1.06 : null,
    checkpoints: GRAD_CHECKPOINTS,
  }
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

  /**
   * Newest first, capped PER BOOK — the same lesson as the ledger's own trim, missed
   * one layer up.
   *
   * This was `[...state.closed].reverse().slice(0, 100)` on the COMBINED list, and the
   * page then split the result into strategy and explore. Explore closes outnumber the
   * strategy's roughly 150 to 1, so the newest hundred entries were all explore and the
   * strategy's table filtered a list its rows had already been pushed out of. The
   * trades existed, in the ledger and in the counters; the panel showing them was
   * reading a slice they could never survive.
   */
  const newestPerBook = (wantExplore, limit) =>
    [...state.closed].reverse().filter((p) => Boolean(p.explore) === wantExplore).slice(0, limit)
  const closed = [...newestPerBook(false, 100), ...newestPerBook(true, 100)]
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    .map((p) => ({
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
  const record = strategyRecord()
  const exploreBook = exploreRecord()
  const { wins, losses } = record

  /**
   * Cumulative realized curve, oldest first — but STARTED from what the account had
   * already realized before the oldest trade we still retain, not from zero.
   *
   * The list is bounded, so on an account with more history than that the curve would
   * otherwise begin at 0 and end somewhere that is not the account's actual P&L. A
   * chart whose last point disagrees with the headline figure beside it teaches you to
   * distrust both.
   */
  const retained = [...strategyClosed].sort((a, b) => a.closedAt - b.closedAt)
  const retainedSum = retained.reduce((sum, p) => sum + (p.realizedSol ?? 0), 0)
  let running = (state.totalRealizedSol ?? 0) - retainedSum
  const history = retained.map((p) => ({ at: p.closedAt, sol: (running += p.realizedSol) }))

  /**
   * SOL ALREADY BANKED OUT OF POSITIONS THAT ARE STILL OPEN.
   *
   * totalRealizedSol only moves when a position CLOSES, so a rung that sold 3 SOL out of
   * a runner leaves the realized curve flat while NET P&L — which counts solRecovered —
   * jumps. Two P&L numbers on one page, disagreeing by several SOL, with nothing saying
   * why. Both are correct and they answer different questions; the page has to say which
   * is which, or it teaches you to distrust both.
   */
  const bankedOnOpen = strategyPositions()
    .filter((p) => p.state === 'open')
    .reduce((sum, p) => sum + (p.solRecovered ?? 0), 0)

  const nextTierSol = sizingSummary(walletSol).nextTier?.atSol ?? null

  /**
   * How the CURRENT rules are doing, separately from the book they inherited.
   *
   * Cumulative P&L answers "how has this bot done", which stops being useful the moment
   * the strategy changes: days of losses from rules that no longer exist bury whatever
   * the new ones are doing, and reading it means remembering when the change landed and
   * doing arithmetic by eye. This is the same figures over the trades closed since this
   * build first ran.
   */
  const build = state.buildFirstSeenAt
    ? { ...recordSince(state.buildFirstSeenAt), version: state.buildVersion }
    : null

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
    /** How the rules RUNNING RIGHT NOW are doing, apart from the book they inherited. */
    build,
    /** Banked from rungs on positions that have not closed yet — see above. */
    bankedOnOpenSol: bankedOnOpen,
    pnl: {
      realizedTotalSol: state.totalRealizedSol,
      realizedTodaySol: today.realizedSol,
      unrealizedSol,
      netSol: state.totalRealizedSol + unrealizedSol,
      wins,
      losses,
      winRatePct: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      consecutiveLosses: state.consecutiveLosses,
      /**
       * Whether the ENTRY GATE is currently refusing everything. A bot that screens
       * thousands of launches and takes none looks identical to a bot with a strict
       * filter, and for a full day the difference was invisible: the streak breaker was
       * paused and the only trace was a 'blocked' count nothing printed.
       */
      streakLimit: consecutiveLossLimit(),
      pausedByStreak: state.consecutiveLosses >= consecutiveLossLimit(),
      blockedCreators: Object.keys(state.blockedCreators ?? {}).length,
      tradesClosed: record.closed,
      // How much of that history the chart can actually draw.
      tradesCharted: retained.length,
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
      realizedSol: exploreBook.realizedSol,
      wins: exploreBook.wins,
      losses: exploreBook.losses,
      open: explorePositions().length,
      // All of them, not the retained slice — this is the average's denominator.
      closed: exploreBook.closed,
      /**
       * What the rejected arm ACTUALLY returned per SOL staked, measured rather than
       * assumed. Explore is sized by curve depth, so there is no single position size to
       * divide by — and this is the largest sample the bot has for scoring the replay.
       */
      stakedSol: exploreBook.stakedSol,
      stakedTrades: exploreBook.stakedTrades,
      realizedOnStakedSol: exploreBook.realizedOnStaked,
      realizedMultiple: exploreBook.realizedMultiple,
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
    graduation: graduationSummary(stats?.graduationTracker ?? null),
    learningPending: config.learning.enabled && analysisHealth().at === 0,
    analysis: analysisHealth(),
    collection: collectionStatus(stats, storageSnapshot(), learningSnapshot(), analysisHealth()),
    /**
     * Whether Telegram is actually receiving anything. Sends are best-effort by design —
     * an outage must never delay an exit — but a silent channel and a healthy one looked
     * identical from the outside, which is a bad property for the surface you rely on
     * when you are not at a screen.
     */
    telegram: {
      configured: deliveryStats.configured,
      sent: deliveryStats.sent,
      failed: deliveryStats.failed,
      lastError: deliveryStats.lastError,
      lastSentAt: deliveryStats.lastSentAt,
      lastMultipart: deliveryStats.lastMultipart,
    },
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
        // The two checks the first real dataset added. Publishing them matters as much
        // as the older ones: a threshold the page does not show is a threshold nobody
        // can tell is switched on.
        minBuyAcceleration: config.entry.minBuyAcceleration,
        creatorHistory: config.entry.creatorHistory,
        minCreatorLaunches: config.entry.minCreatorLaunches,
      },
      learning: {
        // Published so "did raising the cap take effect?" is answered by looking rather
        // than by inferring it from whether the row count moved.
        maxRowsAnalyzed: config.learning.maxRowsAnalyzed,
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
/**
 * The page a visitor without a valid token sees.
 *
 * It takes the token once and remembers it, rather than making someone hand-edit a query
 * string on a phone. It also means the token does not have to live in the address bar:
 * the main page strips it on arrival, which matters because screenshots of this dashboard
 * get shared, and a token baked into the URL would be in every one of them.
 *
 * The token is never echoed into this page — the whole point of the check is that what it
 * guards is a wallet and its P&L.
 */
function unlockPage(wasWrong) {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>pumpbot — unlock</title>
<body style="background:#080b14;color:#e8edf7;font:15px/1.6 ui-sans-serif,system-ui;padding:32px 20px;max-width:560px;margin:0 auto">
<h1 style="font-size:19px;margin:0 0 12px">pumpbot</h1>
<p style="color:#6b7a99;margin:0 0 20px">This page shows a wallet balance, open positions and P&amp;L, so it needs your access token.</p>
${wasWrong ? '<p style="color:#ff5c72;margin:0 0 14px">That token did not match. Try again.</p>' : ''}
<form id="f" style="display:flex;gap:9px;flex-wrap:wrap">
  <input id="t" type="password" autocomplete="current-password" placeholder="DASHBOARD_TOKEN"
    style="flex:1;min-width:210px;background:#0e1422;border:1px solid #1e2942;border-radius:10px;
    padding:12px 14px;color:#e8edf7;font:14px ui-monospace,monospace">
  <button style="background:#a97bff;border:0;border-radius:10px;padding:12px 20px;color:#080b14;
    font-weight:700;font-size:14px;cursor:pointer">Open</button>
</form>
<p style="color:#46536e;font-size:13px;margin:18px 0 0">Find it in your host's environment variables as
<code style="color:#ffb347">DASHBOARD_TOKEN</code>. It is stored in this browser only, so you enter it once.</p>
<script>
  var KEY = 'pumpbot.token'
  function saved() { try { return localStorage.getItem(KEY) || '' } catch (e) { return '' } }
  // A token remembered from last time gets used automatically, so a refresh just works.
  var prior = saved()
  if (prior && !${wasWrong}) location.replace('/?token=' + encodeURIComponent(prior))
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault()
    var v = document.getElementById('t').value.trim()
    if (!v) return
    try { localStorage.setItem(KEY, v) } catch (err) {}
    location.replace('/?token=' + encodeURIComponent(v))
  })
</script></body>`
}

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
        res.end(unlockPage(Boolean(provided)))
        return
      }
    }

    const url = new URL(req.url, 'http://x')

    if (url.pathname === '/api/state') {
      await refreshSolPrice()
      /**
       * The page now comes up BEFORE the bot, so this has to survive being asked for a
       * snapshot while the bot is still starting — or has failed to. Reporting the
       * failure is the entire reason the page starts first; throwing here would put us
       * back where we were, with a healthy-looking container and nothing to read.
       */
      let ctx = {}
      let snapshotError = null
      try {
        ctx = getContext() ?? {}
      } catch (err) {
        snapshotError = err?.message ?? String(err)
      }
      let payload
      try {
        payload = buildSnapshot(ctx.walletSol, ctx.stats ?? null)
      } catch (err) {
        payload = { mode: config.paper ? 'paper' : 'live', version: config.version, updatedAt: Date.now() }
        snapshotError = err?.message ?? String(err)
      }
      payload.startupError = ctx.startupError ?? null
      payload.snapshotError = snapshotError
      const body = JSON.stringify(payload)
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      res.end(body)
      return
    }

    /**
     * The journal, compact and stripped, as a download.
     *
     * Sits behind the same token as everything else here — but note what it does and
     * does not contain: no addresses beyond a salted deployer hash, no wallet lists, no
     * signatures, and an ALLOWLIST of columns so a field added to the journal later
     * cannot start riding along in a file that gets shared. See src/export.js.
     */
    /**
     * The graduation rows, downloadable.
     *
     * They live in their own file precisely so they cannot be averaged into the launch
     * dataset -- which also means /api/export does not carry them, and on a hosted
     * platform a file with no download path is a file that cannot be analysed. Gzipped
     * JSONL rather than CSV: the rows hold a variable-length `mult` array, and flattening
     * it here would duplicate the export's column logic for a second dataset that is one
     * day old and still changing shape.
     */
    if (url.pathname === '/api/graduations') {
      try {
        const rows = readGraduations(200_000)
        const gz = zlib.gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'))
        const stamp = new Date().toISOString().slice(0, 10)
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="pumpbot-graduations-${stamp}.jsonl.gz"`,
          'content-length': gz.length,
          'x-graduation-rows': String(rows.length),
          'cache-control': 'no-store',
        })
        res.end(gz)
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(`graduation export failed: ${err.message}`)
      }
      return
    }

    if (url.pathname === '/api/export') {
      try {
        const cap = (name, dflt) =>
          Math.min(200_000, Math.max(500, Number(url.searchParams.get(name)) || dflt))
        const { gz, stats } = await buildExportInWorker({
          maxRejected: cap('maxRejected', 20_000),
          maxExplored: cap('maxExplored', 20_000),
        })
        const stamp = new Date().toISOString().slice(0, 10)
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="pumpbot-journal-${stamp}.csv.gz"`,
          'content-length': gz.length,
          'x-export-rows': String(stats.rows),
          'x-export-columns': String(stats.columns),
          'cache-control': 'no-store',
        })
        res.end(gz)
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(`export failed: ${err.message}`)
      }
      return
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        /**
         * STAMP THE PAGE WITH THE BUILD THAT SERVED IT.
         *
         * A page left open across a deploy keeps polling /api/dashboard, so it renders
         * NEW data with OLD code. The header's build number comes from that payload, so
         * the one thing you would check to confirm a deploy looks correct while the
         * renderer around it is stale — two lines shipped that afternoon were simply
         * absent, and nothing said why.
         *
         * The page can only notice this if it knows its OWN build, which it cannot get
         * from the payload. So it is injected at serve time and compared client-side.
         */
        const html = String(fs.readFileSync(PAGE)).replace('__PAGE_BUILD__', config.version)
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
