import { config, assertTelegramConfigured } from './config.js'
import { fetchPairsForTokens, summarizePair } from './sources/dexscreener.js'
import { screenToken } from './screener.js'
import { runScan, runPositions } from './pipeline.js'
import { loadState, saveState, pruneState } from './state.js'
import { sendAlert } from './telegram.js'
import { log, isLikelyAddress } from './util.js'

async function checkOne(mint) {
  if (!isLikelyAddress(mint)) {
    console.error('Usage: npm run check -- <mint-address>')
    process.exitCode = 1
    return
  }
  const pairs = await fetchPairsForTokens([mint])
  const pair = pairs.get(mint)
  if (!pair) {
    console.log('No DexScreener pair found for that mint.')
    return
  }
  const result = await screenToken(summarizePair(pair))
  const p = result.pair

  console.log(`\n${p.symbol} — ${p.name}`)
  console.log(`${p.url}\n`)
  for (const c of result.checks) {
    const mark = c.pass ? '  PASS' : c.hard ? '  FAIL' : '  warn'
    console.log(`${mark}  ${c.label.padEnd(34)} ${c.detail}`)
  }
  console.log(`\nScore: ${result.score}/100 (need ${config.gates.minScore})`)
  console.log(`Verdict: ${result.passed ? 'WOULD ALERT' : `no alert — ${result.reason}`}\n`)
}

async function runOnce(command) {
  const state = loadState()
  pruneState(state)
  try {
    if (command === 'scan' || command === 'all') await runScan(state)
    if (command === 'positions' || command === 'scan' || command === 'all') await runPositions(state)
  } finally {
    // Persist even on a partial failure so we never re-alert what already went out.
    saveState(state)
  }
}

async function main() {
  const command = process.argv[2] || 'scan'

  if (command === 'check') {
    await checkOne(process.argv[3])
    return
  }

  assertTelegramConfigured()

  if (command === 'test-alert') {
    const ok = await sendAlert('🤖 <b>Solana tracker is wired up.</b>\nIf you can read this, alerts work.')
    console.log(ok ? 'Sent.' : 'Failed — check the log above.')
    if (!ok) process.exitCode = 1
    return
  }

  if (command === 'loop') {
    // For running on your own machine instead of GitHub Actions.
    const everyMs = Math.max(30, Number(process.env.LOOP_SECONDS) || 60) * 1000
    log.info(`looping every ${everyMs / 1000}s — ctrl-c to stop`)
    for (;;) {
      try {
        await runOnce('scan')
      } catch (err) {
        log.error(err?.stack || String(err))
      }
      await new Promise((r) => setTimeout(r, everyMs))
    }
  }

  if (!['scan', 'positions', 'all'].includes(command)) {
    console.error(`Unknown command "${command}". Use: scan | positions | all | check | test-alert | loop`)
    process.exitCode = 1
    return
  }

  await runOnce(command)
}

main().catch((err) => {
  log.error(err?.stack || String(err))
  process.exitCode = 1
})
