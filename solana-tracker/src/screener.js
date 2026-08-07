import { config } from './config.js'
import { fetchReport } from './sources/rugcheck.js'
import { fetchMintAuthorities } from './sources/solana.js'
import { ageString, usd, pct } from './util.js'

/**
 * Two kinds of check:
 *
 *  - hard gates: any failure disqualifies the token outright. These are the mechanical
 *    rug setups — things that let a creator take your money by construction.
 *  - soft signals: they add or subtract from a 0-100 quality score. A token must clear
 *    every hard gate AND reach MIN_SCORE to be alerted.
 *
 * What this cannot do: detect a creator who passes every check and dumps later. No
 * automated filter can. Passing means "no mechanical rug vector found", nothing more.
 */

const gate = (id, label, pass, detail) => ({ id, label, pass, detail, hard: true })
const signal = (id, label, pass, detail, points) => ({ id, label, pass, detail, hard: false, points })

export async function screenToken(pair) {
  const checks = []
  const now = Date.now()
  const ageMs = pair.pairCreatedAt ? now - pair.pairCreatedAt : NaN

  // --- Age window -----------------------------------------------------------------
  const ageMinutes = ageMs / 60000
  const ageOk =
    Number.isFinite(ageMinutes) &&
    ageMinutes >= config.scan.minAgeMinutes &&
    ageMinutes <= config.scan.maxAgeHours * 60
  checks.push(
    gate(
      'age',
      'Pair age in window',
      ageOk,
      Number.isFinite(ageMs)
        ? `${ageString(ageMs)} old (want ${config.scan.minAgeMinutes}m–${config.scan.maxAgeHours}h)`
        : 'creation time unknown',
    ),
  )
  // Everything downstream costs API calls; bail before spending them.
  if (!ageOk) return finish(pair, checks, null)

  // --- Market structure (DexScreener) ----------------------------------------------
  const { gates } = config
  checks.push(
    gate(
      'liquidity',
      'Liquidity in range',
      pair.liquidityUsd >= gates.minLiquidityUsd && pair.liquidityUsd <= gates.maxLiquidityUsd,
      `${usd(pair.liquidityUsd)} (want ${usd(gates.minLiquidityUsd)}–${usd(gates.maxLiquidityUsd)})`,
    ),
  )
  checks.push(
    gate(
      'volume',
      '24h volume floor',
      pair.volume24hUsd >= gates.minVolume24hUsd,
      `${usd(pair.volume24hUsd)} (want ≥ ${usd(gates.minVolume24hUsd)})`,
    ),
  )
  checks.push(
    gate(
      'marketcap',
      'Market cap in range',
      pair.marketCapUsd >= gates.minMarketCapUsd && pair.marketCapUsd <= gates.maxMarketCapUsd,
      `${usd(pair.marketCapUsd)} (want ${usd(gates.minMarketCapUsd)}–${usd(gates.maxMarketCapUsd)})`,
    ),
  )
  checks.push(
    gate(
      'txns',
      'Trade count floor',
      pair.txns24h >= gates.minTxns24h,
      `${pair.txns24h} trades in 24h (want ≥ ${gates.minTxns24h})`,
    ),
  )

  // Volume far in excess of the pool it trades against is the signature of wash trading.
  const volLiqRatio = pair.liquidityUsd > 0 ? pair.volume24hUsd / pair.liquidityUsd : Infinity
  checks.push(
    gate(
      'washtrading',
      'Volume/liquidity sane',
      volLiqRatio <= gates.maxVolumeToLiquidityRatio,
      `${Number.isFinite(volLiqRatio) ? volLiqRatio.toFixed(1) : '∞'}x (want ≤ ${gates.maxVolumeToLiquidityRatio}x)`,
    ),
  )

  // Buys with almost no sells is what a honeypot looks like from the outside.
  const sellRatio = pair.txns24h > 0 ? pair.sells24h / pair.txns24h : 0
  checks.push(
    gate(
      'honeypot',
      'Sells are going through',
      sellRatio >= gates.minSellRatio24h,
      `${(sellRatio * 100).toFixed(0)}% of trades are sells (want ≥ ${(gates.minSellRatio24h * 100).toFixed(0)}%)`,
    ),
  )

  // --- On-chain authorities (trustless read) ---------------------------------------
  const authorities = await fetchMintAuthorities(pair.mint)
  checks.push(
    gate(
      'mint_authority',
      'Mint authority revoked',
      authorities.ok && authorities.mintAuthority === null,
      authorities.ok
        ? authorities.mintAuthority
          ? `LIVE — creator can print more supply (${authorities.mintAuthority})`
          : 'revoked'
        : 'could not verify on-chain',
    ),
  )
  checks.push(
    gate(
      'freeze_authority',
      'Freeze authority revoked',
      authorities.ok && authorities.freezeAuthority === null,
      authorities.ok
        ? authorities.freezeAuthority
          ? `LIVE — creator can freeze your tokens (${authorities.freezeAuthority})`
          : 'revoked'
        : 'could not verify on-chain',
    ),
  )

  // --- Holder distribution and LP lock (RugCheck) ----------------------------------
  const report = await fetchReport(pair.mint)
  if (!report) {
    // Fail closed. An unverifiable token is not a passing token.
    checks.push(gate('rugcheck', 'Safety report available', false, 'RugCheck lookup failed — skipped'))
    return finish(pair, checks, null)
  }

  checks.push(gate('rugged', 'Not already flagged as rugged', !report.rugged, report.rugged ? 'flagged RUGGED' : 'clean'))

  checks.push(
    gate(
      'lp_locked',
      'LP burned or locked',
      report.lpLockedPct !== null && report.lpLockedPct >= gates.minLpLockedPct,
      report.lpLockedPct === null
        ? 'unknown'
        : `${report.lpLockedPct.toFixed(1)}% locked (want ≥ ${gates.minLpLockedPct}%)`,
    ),
  )
  checks.push(
    gate(
      'top10',
      'Top-10 concentration',
      report.top10Pct <= gates.maxTop10Pct,
      `${report.top10Pct.toFixed(1)}% held by top 10 (want ≤ ${gates.maxTop10Pct}%)`,
    ),
  )
  checks.push(
    gate(
      'whale',
      'No dominant single holder',
      report.largestHolderPct <= gates.maxSingleHolderPct,
      `largest holds ${report.largestHolderPct.toFixed(1)}% (want ≤ ${gates.maxSingleHolderPct}%)`,
    ),
  )
  checks.push(
    gate(
      'holders',
      'Holder count floor',
      report.totalHolders >= gates.minHolders,
      `${report.totalHolders} holders (want ≥ ${gates.minHolders})`,
    ),
  )

  const dangerRisks = report.risks.filter(
    (r) => r.level === 'danger' && !gates.ignoredRugcheckRisks.includes(r.name),
  )
  checks.push(
    gate(
      'risk_flags',
      'No critical risk flags',
      dangerRisks.length === 0,
      dangerRisks.length ? dangerRisks.map((r) => r.name).join('; ') : 'none',
    ),
  )
  checks.push(
    gate(
      'rug_score',
      'RugCheck score',
      Number.isFinite(report.score) && report.score <= gates.maxRugcheckScore,
      `${Number.isFinite(report.score) ? report.score : 'n/a'} (want ≤ ${gates.maxRugcheckScore}, lower is safer)`,
    ),
  )

  // --- Soft signals ------------------------------------------------------------------
  const warnRisks = report.risks.filter(
    (r) => r.level === 'warn' && !gates.ignoredRugcheckRisks.includes(r.name),
  )
  checks.push(
    signal('warn_flags', 'Minor risk flags', warnRisks.length === 0, warnRisks.map((r) => r.name).join('; ') || 'none', -8 * warnRisks.length),
  )
  checks.push(
    signal(
      'metadata',
      'Metadata immutable',
      !report.mutableMetadata,
      report.mutableMetadata ? 'name/image can still be changed' : 'immutable',
      -15,
    ),
  )
  checks.push(
    signal(
      'insiders',
      'Low insider supply',
      report.insiderPct <= 10,
      `${report.insiderPct.toFixed(1)}% held by flagged insiders`,
      -15,
    ),
  )
  checks.push(
    signal(
      'socials',
      'Has socials or site',
      pair.socials.length > 0 || pair.websites.length > 0,
      pair.socials.length || pair.websites.length
        ? [...pair.socials.map((s) => s.type), ...(pair.websites.length ? ['website'] : [])].join(', ')
        : 'none',
      -10,
    ),
  )
  checks.push(
    signal(
      'lp_providers',
      'Multiple LP providers',
      report.totalLpProviders > 1,
      `${report.totalLpProviders} provider(s)`,
      -10,
    ),
  )
  checks.push(
    signal(
      'momentum',
      'Positive 1h momentum',
      pair.priceChange1h > 0,
      pct(pair.priceChange1h),
      -6,
    ),
  )
  checks.push(
    signal(
      'depth',
      'Liquidity comfortably above floor',
      pair.liquidityUsd >= gates.minLiquidityUsd * 2,
      usd(pair.liquidityUsd),
      -8,
    ),
  )

  return finish(pair, checks, report)
}

function finish(pair, checks, report) {
  const hardChecks = checks.filter((c) => c.hard)
  const failedGates = hardChecks.filter((c) => !c.pass)

  let score = 100
  for (const c of checks) {
    if (!c.hard && !c.pass) score += c.points
  }
  score = Math.max(0, Math.min(100, score))

  const passed = failedGates.length === 0 && score >= config.gates.minScore

  return {
    pair,
    report,
    checks,
    failedGates,
    score,
    passed,
    // Present even when disqualified — useful when tuning thresholds with `npm run check`.
    reason: failedGates.length
      ? `failed: ${failedGates.map((c) => c.id).join(', ')}`
      : score < config.gates.minScore
        ? `score ${score} below ${config.gates.minScore}`
        : 'passed',
  }
}
