import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { Bot } from './bot.js'
import { startDashboard } from './dashboard.js'
import { initStore, getState, clearHalt, openPositions, save } from './store.js'
import { keygen, getPublicKey, getSolBalance } from './wallet.js'
import { sizingSummary } from './sizing.js'
import { analyze, formatReport } from './learn.js'
import { readAll } from './journal.js'
import { normalizeEvent } from './curve.js'
import { positionPnl } from './position.js'
import { log, sol, pct, sleep } from './log.js'

const commands = {
  run,
  keygen: doKeygen,
  balance,
  positions,
  panic,
  learn,
  record,
  replay,
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

  const server = startDashboard(() => bot.walletSol)

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info(`${signal} received — shutting down`)
    // Open positions are deliberately left open: they are re-attached on restart.
    // Use `npm run panic` if you want them liquidated instead.
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
  const bal = config.paper ? Number(process.env.PAPER_START_SOL ?? 0.5) : await getSolBalance()
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
  const rows = readAll()
  if (!rows.length) {
    console.log('\n  Journal is empty — nothing to analyse yet.\n')
    return
  }
  console.log(formatReport(analyze(rows)))
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
