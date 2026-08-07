import { config } from './config.js'
import { discoverSolanaTokens, fetchPairsForTokens, summarizePair } from './sources/dexscreener.js'
import { screenToken } from './screener.js'
import { checkPositions, buildDigest } from './wallet.js'
import { wasAlerted, markAlerted } from './state.js'
import { sendAlert } from './telegram.js'
import { esc, usd, pct, ageString, log, isLikelyAddress, sleep } from './util.js'

export function formatCandidate(result) {
  const { pair, report, score } = result
  const age = pair.pairCreatedAt ? ageString(Date.now() - pair.pairCreatedAt) : 'unknown'
  const socials = pair.socials.map((s) => s.type).join(', ')

  return [
    `🟢 <b>${esc(pair.symbol)}</b> — ${esc(pair.name)}  <i>(score ${score}/100)</i>`,
    '',
    `Price ${usd(pair.priceUsd)} · MC ${usd(pair.marketCapUsd)} · ${age} old`,
    `Liquidity ${usd(pair.liquidityUsd)} · 24h vol ${usd(pair.volume24hUsd)}`,
    `1h ${pct(pair.priceChange1h)} · 24h ${pct(pair.priceChange24h)} · ${pair.txns24h} trades`,
    '',
    '<b>Passed</b>',
    '✅ Mint authority revoked · ✅ Freeze authority revoked',
    `✅ LP ${report.lpLockedPct?.toFixed(0) ?? '?'}% locked · ✅ Top-10 hold ${report.top10Pct.toFixed(1)}%`,
    `✅ ${report.totalHolders} holders · ✅ RugCheck score ${report.score}`,
    socials || pair.websites.length ? `Links: ${esc(socials || 'website')}` : 'Links: none',
    '',
    `<a href="${esc(pair.url)}">DexScreener</a> · <a href="https://rugcheck.xyz/tokens/${esc(pair.mint)}">RugCheck</a>`,
    `<code>${esc(pair.mint)}</code>`,
    '',
    '<i>Passed automated filters. That rules out mechanical rugs, not a dev who dumps later. Assume you can lose all of it.</i>',
  ].join('\n')
}

export async function runScan(state) {
  if (!config.scan.enabled) {
    log.info('scan disabled')
    return 0
  }

  const mints = await discoverSolanaTokens()
  const fresh = mints.filter((m) => !wasAlerted(state, m))
  log.info(`${fresh.length} mints not yet alerted`)
  if (!fresh.length) return 0

  const pairs = await fetchPairsForTokens(fresh)
  log.info(`${pairs.size} mints have tradeable pairs`)

  // Cheap local pre-filter before spending RugCheck/RPC calls on obvious non-starters.
  const shortlist = [...pairs.values()]
    .map(summarizePair)
    .filter((p) => {
      if (!p.mint || !p.pairCreatedAt) return false
      const ageMin = (Date.now() - p.pairCreatedAt) / 60000
      if (ageMin < config.scan.minAgeMinutes || ageMin > config.scan.maxAgeHours * 60) return false
      return p.liquidityUsd >= config.gates.minLiquidityUsd
    })
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 40)

  log.info(`${shortlist.length} mints reach deep screening`)

  let sent = 0
  for (const pair of shortlist) {
    if (sent >= config.scan.maxAlertsPerRun) {
      log.info('per-run alert cap reached')
      break
    }
    const result = await screenToken(pair)
    log.info(`${pair.symbol.padEnd(12)} score=${result.score} ${result.reason}`)
    if (!result.passed) continue

    if (await sendAlert(formatCandidate(result), { disablePreview: false })) {
      markAlerted(state, pair.mint, pair.symbol)
      sent++
    }
    await sleep(config.scan.candidateDelayMs)
  }

  log.info(`scan complete — ${sent} alert(s) sent`)
  return sent
}

export async function runPositions(state) {
  if (!config.positions.enabled || !config.walletAddress) {
    log.info('position tracking disabled or WALLET_ADDRESS unset')
    return 0
  }
  if (!isLikelyAddress(config.walletAddress)) {
    log.error('WALLET_ADDRESS does not look like a Solana address')
    return 0
  }

  const { alerts, holdings, totalUsd, degraded } = await checkPositions(state)
  log.info(`wallet: ${holdings.length} priced holdings worth ${usd(totalUsd)}`)

  // Liquidity warnings first — they are the time-sensitive ones.
  const order = { liquidity: 0, closed: 1, move: 2, opened: 3 }
  alerts.sort((a, b) => order[a.kind] - order[b.kind])
  for (const alert of alerts) await sendAlert(alert.text)

  if (degraded) return alerts.length

  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  if (
    config.positions.digestHourUtc >= 0 &&
    now.getUTCHours() === config.positions.digestHourUtc &&
    state.lastDigestDay !== day
  ) {
    const digest = buildDigest(holdings, totalUsd)
    if (digest && (await sendAlert(digest))) state.lastDigestDay = day
  }

  return alerts.length
}
