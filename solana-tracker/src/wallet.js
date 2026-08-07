import { config, SOL_MINT } from './config.js'
import { fetchSolBalance, fetchTokenBalances } from './sources/solana.js'
import { fetchPrices } from './sources/dexscreener.js'
import { esc, usd, pct, log, shortAddr } from './util.js'

/**
 * Read-only position tracking from a public wallet address. Nothing here signs, and
 * nothing here needs a private key or seed phrase — a Phantom *address* is enough.
 *
 * Cost basis: we do not parse swap history, so PnL is measured from the first time this
 * tracker saw the position, not from what you actually paid. Every message says so.
 */
export async function checkPositions(state) {
  const owner = config.walletAddress
  if (!owner) return { alerts: [], holdings: [], totalUsd: 0 }

  const [solBalance, tokens] = await Promise.all([fetchSolBalance(owner), fetchTokenBalances(owner)])

  if (tokens === null) {
    log.warn('could not read token accounts — skipping position check this run')
    return { alerts: [], holdings: [], totalUsd: 0, degraded: true }
  }

  const mints = [SOL_MINT, ...tokens.map((t) => t.mint)]
  const prices = await fetchPrices(mints)

  const holdings = []
  if (solBalance !== null && solBalance > 0) {
    const p = prices.get(SOL_MINT)
    holdings.push({
      mint: SOL_MINT,
      symbol: 'SOL',
      amount: solBalance,
      priceUsd: p?.priceUsd || 0,
      valueUsd: solBalance * (p?.priceUsd || 0),
      liquidityUsd: p?.liquidityUsd || 0,
      priceChange24h: p?.priceChange24h || 0,
      url: 'https://dexscreener.com/solana/' + SOL_MINT,
    })
  }

  for (const t of tokens) {
    const p = prices.get(t.mint)
    if (!p) continue // no market — untradeable dust or unlisted; nothing to value
    holdings.push({
      mint: t.mint,
      symbol: p.symbol || shortAddr(t.mint),
      amount: t.amount,
      priceUsd: p.priceUsd,
      valueUsd: t.amount * p.priceUsd,
      liquidityUsd: p.liquidityUsd,
      priceChange24h: p.priceChange24h,
      url: p.url || `https://dexscreener.com/solana/${t.mint}`,
    })
  }

  holdings.sort((a, b) => b.valueUsd - a.valueUsd)
  const totalUsd = holdings.reduce((s, h) => s + h.valueUsd, 0)

  const alerts = diffPositions(state, holdings)
  return { alerts, holdings, totalUsd }
}

function diffPositions(state, holdings) {
  const alerts = []
  const seen = new Set()
  const { movePct, liquidityDropPct, liquidityFloorUsd, minValueUsd } = config.positions

  for (const h of holdings) {
    const prior = state.positions[h.mint]
    // Track anything already tracked, plus anything newly above the dust floor. A
    // position that crashed below the floor still deserves alerts.
    if (!prior && h.valueUsd < minValueUsd) continue
    seen.add(h.mint)

    if (!prior) {
      state.positions[h.mint] = {
        firstSeen: Date.now(),
        basePrice: h.priceUsd,
        lastAlertPrice: h.priceUsd,
        lastLiquidity: h.liquidityUsd,
        symbol: h.symbol,
      }
      if (h.mint !== SOL_MINT) {
        alerts.push({
          kind: 'opened',
          text:
            `🆕 <b>New position: ${esc(h.symbol)}</b>\n` +
            `Holding ${fmtAmount(h.amount)} · ${usd(h.valueUsd)}\n` +
            `Price ${usd(h.priceUsd)} · pool ${usd(h.liquidityUsd)}\n` +
            `<a href="${esc(h.url)}">chart</a> · <code>${esc(h.mint)}</code>\n` +
            `<i>Tracking from here — PnL below is measured from this price, not your fill.</i>`,
        })
      }
      continue
    }

    prior.symbol = h.symbol

    // Liquidity draining out from under a position is the alert that actually saves money.
    const liqDrop =
      prior.lastLiquidity > 0 ? ((prior.lastLiquidity - h.liquidityUsd) / prior.lastLiquidity) * 100 : 0
    if (
      h.mint !== SOL_MINT &&
      (liqDrop >= liquidityDropPct || (h.liquidityUsd < liquidityFloorUsd && prior.lastLiquidity >= liquidityFloorUsd))
    ) {
      alerts.push({
        kind: 'liquidity',
        text:
          `🚨 <b>LIQUIDITY DRAINING: ${esc(h.symbol)}</b>\n` +
          `Pool ${usd(prior.lastLiquidity)} → ${usd(h.liquidityUsd)} (${pct(-liqDrop)})\n` +
          `Your position: ${usd(h.valueUsd)} at ${usd(h.priceUsd)}\n` +
          `<a href="${esc(h.url)}">chart</a> · <code>${esc(h.mint)}</code>\n` +
          `<i>A shrinking pool means exits get worse the longer you wait.</i>`,
      })
    }
    prior.lastLiquidity = h.liquidityUsd

    // Ratchet on the last alerted price so a steady climb alerts per step, not per run.
    const base = prior.lastAlertPrice || prior.basePrice
    if (base > 0 && h.priceUsd > 0) {
      const move = ((h.priceUsd - base) / base) * 100
      if (Math.abs(move) >= movePct) {
        const fromEntry =
          prior.basePrice > 0 ? ((h.priceUsd - prior.basePrice) / prior.basePrice) * 100 : 0
        alerts.push({
          kind: 'move',
          text:
            `${move > 0 ? '📈' : '📉'} <b>${esc(h.symbol)} ${pct(move)}</b> since last alert\n` +
            `Price ${usd(base)} → ${usd(h.priceUsd)}\n` +
            `Position now ${usd(h.valueUsd)} · ${pct(fromEntry)} since tracked\n` +
            `Pool ${usd(h.liquidityUsd)} · <a href="${esc(h.url)}">chart</a>`,
        })
        prior.lastAlertPrice = h.priceUsd
      }
    }
  }

  // Anything tracked last run and absent now was sold, burned, or has lost its market.
  for (const [mint, prior] of Object.entries(state.positions)) {
    if (seen.has(mint)) continue
    alerts.push({
      kind: 'closed',
      text: `✅ <b>Position gone: ${esc(prior.symbol || shortAddr(mint))}</b>\nNo longer in the wallet (sold, or its market disappeared).`,
    })
    delete state.positions[mint]
  }

  return alerts
}

export function buildDigest(holdings, totalUsd) {
  if (!holdings.length) return null
  const lines = holdings
    .filter((h) => h.valueUsd >= config.positions.minValueUsd)
    .slice(0, 25)
    .map(
      (h) =>
        `• <b>${esc(h.symbol)}</b> — ${usd(h.valueUsd)} · ${pct(h.priceChange24h)} 24h · pool ${usd(h.liquidityUsd)}`,
    )
  return (
    `💼 <b>Daily holdings</b> — ${usd(totalUsd)} total\n\n` +
    (lines.join('\n') || '<i>nothing above the dust floor</i>') +
    `\n\n<i>Values are live market prices. PnL vs. your actual fills is not tracked.</i>`
  )
}

function fmtAmount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`
  if (n >= 1) return n.toFixed(2)
  return n.toPrecision(3)
}
