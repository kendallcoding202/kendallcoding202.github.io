import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { Bot } from './bot.js'
import { startDashboard } from './dashboard.js'
import { CommandListener } from './commands.js'
import { initStore, getState, clearHalt, openPositions, save, addPosition } from './store.js'
import { keygen, getPublicKey, getSolBalance, getAllTokenBalances } from './wallet.js'
import { sizingSummary } from './sizing.js'
import { analyze, formatReport } from './learn.js'
import { readBondingCurve } from './onchain.js'
import { heldByAnother } from './lock.js'
import { readRecent } from './journal.js'
import { normalizeEvent } from './curve.js'
import { positionPnl } from './position.js'
import { notify } from './notify.js'
import { log, sol, pct, esc, sleep } from './log.js'

const commands = {
  run,
  keygen: doKeygen,
  balance,
  positions,
  panic,
  learn,
  record,
  replay,
  adopt,
  reset,
}

/**
 * Clears the paper book so a measurement can start clean.
 *
 * The first hours of running produced 113 explore trades that all closed on "no price
 * update" — pure fee losses carrying no information, because without trade data nothing
 * could move and no outcome could be labelled. Leaving that in the ledger would bias
 * every statistic the learning report produces.
 *
 * Refuses in live mode: a live ledger is a record of real money and is not disposable.
 */
async function reset() {
  if (!config.paper) {
    console.error('\n  Refusing — this is the LIVE ledger, a record of real money.')
    console.error('  Nothing here is safe to discard automatically.\n')
    process.exitCode = 1
    return
  }

  const held = heldByAnother()
  if (held) {
    console.error(`\n  A pumpbot instance is running (heartbeat ${Math.round(held.ageMs / 1000)}s ago).`)
    console.error('  Stop it first, or its next save will write the old book straight back.\n')
    process.exitCode = 1
    return
  }

  initStore()
  const s = getState()
  const summary =
    `${s.closed.length} closed · ${Object.keys(s.positions).length} open · ` +
    `strategy ${(s.totalRealizedSol ?? 0).toFixed(4)} SOL · explore ${(s.exploreRealizedSol ?? 0).toFixed(4)} SOL`

  if (process.argv[3] !== '--confirm') {
    console.log(`\n  Paper book currently holds: ${summary}`)
    console.log('\n  Re-run with --confirm to clear it:')
    console.log('    npm run reset -- --confirm\n')
    console.log('  The decision journal is kept — that is the learning data. Only the')
    console.log('  trade ledger and activity feed are cleared.\n')
    return
  }

  s.positions = {}
  s.closed = []
  s.daily = {}
  s.activity = []
  s.totalRealizedSol = 0
  s.exploreRealizedSol = 0
  s.exploreWins = 0
  s.exploreLosses = 0
  s.consecutiveLosses = 0
  s.baseEquitySol = 0
  s.peakRealizedSol = 0
  s.blockedCreators = {}
  s.halted = null
  save()

  console.log(`\n  Cleared: ${summary}`)
  console.log('  Paper book is empty. Restart the bot to begin a clean measurement.\n')
}

/**
 * Brings wallet tokens the ledger lost track of back under management.
 *
 * Entry price is unknowable after the fact, so it is set to the current price and the
 * position is flagged `adopted`. That means P&L on it is measured from adoption, NOT
 * from what you actually paid — but the exit rules apply again from here, which is the
 * point. Explicit command rather than automatic: silently rewriting cost basis is not
 * something a bot should do on its own.
 */
async function adopt() {
  if (config.paper) {
    console.log('\n  Paper mode has no real wallet to adopt from.\n')
    return
  }

  initStore()
  const held = await getAllTokenBalances()
  const known = new Set(Object.keys(getState().positions))
  const orphans = held.filter((t) => !known.has(t.mint))

  if (!orphans.length) {
    console.log('\n  No unmanaged tokens — the ledger matches the wallet.\n')
    return
  }

  console.log(`\n  ${orphans.length} unmanaged token(s):\n`)
  for (const o of orphans) console.log(`    ${o.mint}  ${o.amount.toFixed(0)}`)

  if (process.argv[3] !== '--confirm') {
    console.log('\n  Re-run with --confirm to bring these under management:')
    console.log('    npm run adopt -- --confirm\n')
    console.log('  Their entry price will be set to the CURRENT price, so reported P&L')
    console.log('  will not reflect what you originally paid. Exit rules resume either way.')
    console.log('  If you would rather just get out, use `npm run panic`.\n')
    return
  }

  let adopted = 0

  for (const o of orphans) {
    // Price straight off the bonding curve. If we cannot price it, we cannot manage it.
    const priced = await readBondingCurve(o.mint)
    if (!(priced?.priceSol > 0)) {
      console.log(`    skipped ${o.mint} — no usable price (graduated, or not a pump.fun curve)`)
      continue
    }
    addPosition({
      mint: o.mint,
      symbol: o.mint.slice(0, 6),
      creator: null,
      pool: 'pump',
      state: 'open',
      openedAt: Date.now(),
      adopted: true,
      entryPriceSol: priced.priceSol,
      tokensBought: o.amount,
      tokensRemaining: o.amount,
      // Unknown — treated as zero so adoption cannot invent a fake profit.
      solSpent: 0,
      solRecovered: 0,
      rungsHit: [],
      peakPriceSol: priced.priceSol,
      lastPriceSol: priced.priceSol,
      lastVSol: priced.vSol,
      lastVTokens: priced.vTokens,
      entryVSol: priced.vSol,
      fills: [],
    })
    adopted++
    console.log(`    adopted ${o.mint} at ${priced.priceSol.toExponential(3)} SOL`)
  }

  console.log(`\n  ${adopted} position(s) now managed. Restart the bot to pick them up.\n`)
}

async function run() {
  if (!config.paper) {
    log.warn('════════════════════════════════════')
    log.warn('  LIVE MODE — this spends real SOL')
    log.warn('════════════════════════════════════')
    // A visible pause so a mistaken `PAPER=0` can still be caught with ctrl-c.
    await sleep(5000)
  }

  const bot = new Bot()
  await bot.start()

  /**
   * The dashboard must never be able to take the bot down.
   *
   * startDashboard throws when DASHBOARD_HOST is public and DASHBOARD_TOKEN is unset —
   * correct on its own terms, but called unguarded it kills the process AFTER the bot
   * has started and taken the ledger lock, so a hosted deploy crash-loops over a display
   * setting while positions sit unmanaged. Trading is the job; the dashboard is a window
   * onto it, and a broken window is not a reason to stop.
   */
  let server = null
  try {
    server = startDashboard(() => ({ walletSol: bot.walletSol, stats: bot.statsSnapshot() }))
  } catch (err) {
    log.error(`dashboard did not start: ${err.message}`)
    log.error('Continuing WITHOUT it — the bot keeps trading. Fix the setting and redeploy.')
    await notify(`⚠️ <b>Dashboard did not start</b>\n${esc(err.message)}\nThe bot is still running.`)
  }

  const telegram = new CommandListener(bot)
  await telegram.start()

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info(`${signal} received — shutting down`)
    // Open positions are deliberately left open: they are re-attached on restart.
    // Use `npm run panic` if you want them liquidated instead.
    telegram.stop()
    await bot.stop()
    server?.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  process.on('unhandledRejection', (err) => log.error('unhandled rejection:', err))
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception:', err)
    save()
  })
}

function doKeygen() {
  let pubkey
  try {
    pubkey = keygen()
  } catch (err) {
    // Expected refusals deserve a clean message, not a stack trace.
    console.error(`\n  ${err.message}\n`)
    console.error('  If you really want a new wallet, move the existing .env aside first.')
    console.error('  Whatever is in it controls real funds — back it up before you do.\n')
    process.exitCode = 1
    return
  }
  console.log('')
  console.log('  Burner wallet created. The secret was written to .env (chmod 600).')
  console.log('  It was NOT printed — nothing to leak from your scrollback.')
  console.log('')
  console.log(`  Fund this address:  ${pubkey}`)
  console.log('')
  console.log('  Back up .env somewhere safe. Losing it loses the wallet.')
  console.log('  Fund it with ONLY what you are willing to lose entirely.')
  console.log('')
}

async function balance() {
  const pubkey = getPublicKey().toBase58()
  const bal = config.paper ? config.paperStartSol : await getSolBalance()
  const s = sizingSummary(bal)
  console.log('')
  console.log(`  Wallet   ${pubkey}`)
  console.log(`  Balance  ${sol(bal)}${config.paper ? '  (paper)' : ''}`)
  console.log(`  Size     ${sol(s.buySol)} per trade · max ${s.maxConcurrent} open · cap ${sol(s.maxDeployedSol)}`)
  if (s.nextTier) {
    console.log(`  Next     ${sol(s.nextTier.buySol)} per trade at ${sol(s.nextTier.atSol)} — ${sol(s.nextTier.remainingSol)} to go`)
  }
  console.log('')
}

function positions() {
  initStore()
  const open = openPositions()
  const state = getState()

  if (state.halted) console.log(`\n  HALTED: ${state.halted.reason}\n`)

  console.log(`\n  Open positions (${open.length}):`)
  if (!open.length) console.log('    none')
  for (const p of open) {
    const pnl = positionPnl(p)
    const change = p.entryPriceSol > 0 ? ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100 : 0
    console.log(
      `    ${p.symbol.padEnd(12)} in ${sol(p.solSpent)} · out ${sol(p.solRecovered)} · ${pct(change).padStart(8)} · P&L ${sol(pnl.totalSol)}${pnl.initialsRecovered ? ' [initials out]' : ''}`,
    )
  }

  const recent = state.closed.slice(-10).reverse()
  console.log(`\n  Last ${recent.length} closed:`)
  for (const p of recent) {
    console.log(
      `    ${p.symbol.padEnd(12)} ${sol(p.realizedSol).padStart(12)} · ${Math.round((p.closedAt - p.openedAt) / 1000)}s · ${p.closeReason ?? ''}`,
    )
  }
  console.log(`\n  Total realized: ${sol(state.totalRealizedSol)}\n`)
}

async function panic() {
  initStore()

  /**
   * The ledger is rewritten whole on every save, so two writers is data loss. Without
   * this check, panic would liquidate and halt in its own process and the still-running
   * bot's next save() would overwrite the file from its stale copy — resurrecting the
   * sold positions and clearing the halt. The emergency tool would silently undo itself.
   */
  const held = heldByAnother()
  if (held) {
    console.error('')
    console.error(`  A pumpbot instance is running (heartbeat ${Math.round(held.ageMs / 1000)}s ago).`)
    console.error('  Running panic here would be overwritten by it, losing the liquidation.')
    console.error('')
    console.error('  Use Telegram instead — it runs inside the live process:')
    console.error('      /panic confirm')
    console.error('')
    console.error('  Or stop the bot first, then re-run this.')
    console.error('')
    process.exitCode = 1
    return
  }

  if (process.argv[3] === 'resume') {
    clearHalt()
    console.log('Halt cleared. Restart the bot to resume trading.')
    return
  }
  const bot = new Bot()
  await bot.panicSell()
  process.exit(0)
}

function learn() {
  // The capped, streamed read — same path the dashboard and /learn take, so the CLI
  // cannot quietly hold the whole journal in memory to print the same report.
  const { rows, total } = readRecent(config.learning.maxRowsAnalyzed)
  if (!total) {
    console.log('\n  Journal is empty — nothing to analyse yet.\n')
    return
  }
  console.log(formatReport(analyze(rows, total)))
}

/**
 * Connects to the live feed and dumps raw messages to a file. The field names this bot
 * parses have not been verified against a live connection, so run this first and check
 * the output before trusting live mode.
 */
async function record() {
  const seconds = Number(process.argv[3]) || 60
  const out = path.join(config.dataDir, `feed-sample-${Date.now()}.jsonl`)
  fs.mkdirSync(config.dataDir, { recursive: true })

  const { Feed } = await import('./feed.js')
  const feed = new Feed()
  let count = 0
  const kinds = new Map()

  feed.on('raw', (msg) => {
    count++
    fs.appendFileSync(out, JSON.stringify(msg) + '\n')
    const normalized = normalizeEvent(msg)
    const key = normalized ? `parsed:${normalized.kind}` : 'UNPARSED'
    kinds.set(key, (kinds.get(key) ?? 0) + 1)
  })

  feed.start()
  console.log(`Recording for ${seconds}s → ${out}`)
  await sleep(seconds * 1000)
  await feed.stop()

  console.log(`\n  ${count} messages captured`)
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(18)} ${v}`)
  const unparsed = kinds.get('UNPARSED') ?? 0
  if (unparsed > count * 0.2) {
    console.log(`\n  ⚠️  ${unparsed} messages did not parse. Check the field names in src/curve.js`)
    console.log('     against the recorded sample BEFORE running live.\n')
  } else {
    console.log('\n  Parsing looks healthy.\n')
  }
  process.exit(0)
}

/** Replays a recorded feed sample through the parser. No orders, no network. */
async function replay() {
  const file = process.argv[3]
  if (!file) {
    console.error('Usage: npm run replay -- <path-to-feed-sample.jsonl>')
    process.exitCode = 1
    return
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  let parsed = 0
  const kinds = new Map()
  const missing = new Map()

  for (const line of lines) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    const e = normalizeEvent(msg)
    if (!e) continue
    parsed++
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
    for (const field of ['priceSol', 'vSol', 'vTokens', 'marketCapSol', 'trader']) {
      if (e[field] === undefined) missing.set(field, (missing.get(field) ?? 0) + 1)
    }
  }

  console.log(`\n  ${lines.length} messages · ${parsed} parsed`)
  for (const [k, v] of kinds) console.log(`    ${k.padEnd(10)} ${v}`)
  if (missing.size) {
    console.log('\n  Fields missing from parsed events:')
    for (const [k, v] of missing) console.log(`    ${k.padEnd(14)} missing in ${v}/${parsed}`)
    console.log('  Anything missing from most events needs its alias added in src/curve.js.')
  }
  console.log('')
}

const name = process.argv[2] ?? 'run'
const handler = commands[name]

if (!handler) {
  console.error(`Unknown command "${name}". Use one of: ${Object.keys(commands).join(', ')}`)
  process.exitCode = 1
} else {
  // Handlers may be sync or async; normalise so both report failures the same way.
  Promise.resolve()
    .then(() => handler())
    .catch((err) => {
      log.error(err?.stack ?? String(err))
      process.exitCode = 1
    })
}
