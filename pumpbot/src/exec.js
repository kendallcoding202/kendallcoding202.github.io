import { VersionedTransaction } from '@solana/web3.js'
import { config } from './config.js'
import { getKeypair, getPublicKey, getConnection, getSolBalance, getTokenBalance } from './wallet.js'
import { quoteBuy, quoteSell } from './curve.js'
import { log, sleep, sol } from './log.js'

/**
 * Trade execution.
 *
 * Live path uses the trade API's LOCAL transaction endpoint: it returns an unsigned
 * serialized transaction that we sign here and submit through our own RPC. The signing
 * key never leaves this process. The hosted "lightning"-style endpoints that hold your
 * key for you are deliberately not supported.
 */

async function buildTransaction({ action, mint, amount, denominatedInSol, slippage, pool }) {
  const res = await fetch(config.tradeApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: getPublicKey().toBase58(),
      action,
      mint,
      amount,
      denominatedInSol: denominatedInSol ? 'true' : 'false',
      slippage,
      priorityFee: config.exec.priorityFeeSol,
      pool: pool || 'pump',
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`trade API ${res.status}: ${body.slice(0, 200)}`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length < 64) throw new Error(`trade API returned ${bytes.length} bytes — not a transaction`)
  return VersionedTransaction.deserialize(bytes)
}

async function signAndSend(tx) {
  const connection = getConnection()
  tx.sign([getKeypair()])
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true, // preflight against a moving curve rejects fills that would land
    maxRetries: 0, // we manage our own retries with fresh blockhashes
  })

  const latest = await connection.getLatestBlockhash('confirmed')
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    'confirmed',
  )
  if (result.value.err) throw new Error(`transaction failed on chain: ${JSON.stringify(result.value.err)}`)
  return signature
}

/** Snapshot both balances so fills can be measured from reality, not from a quote. */
async function snapshot(mint) {
  const [solBal, tokenBal] = await Promise.all([getSolBalance(), getTokenBalance(mint)])
  return { solBal, tokenBal }
}

export async function buy({ mint, solAmount, curve, pool }) {
  if (config.paper) return paperBuy({ mint, solAmount, curve })

  const before = await snapshot(mint)
  let lastError = null

  for (let attempt = 1; attempt <= config.exec.maxRetries; attempt++) {
    try {
      const tx = await buildTransaction({
        action: 'buy',
        mint,
        amount: solAmount,
        denominatedInSol: true,
        slippage: config.exec.buySlippagePct,
        pool,
      })
      const signature = await signAndSend(tx)
      const after = await snapshot(mint)

      const tokensReceived = after.tokenBal - before.tokenBal
      const solSpent = before.solBal - after.solBal

      if (!(tokensReceived > 0)) throw new Error('transaction landed but no tokens arrived')

      log.info(`BUY ${mint} filled: ${tokensReceived.toFixed(0)} tokens for ${sol(solSpent)}`)
      return { ok: true, tokensReceived, solSpent, avgPriceSol: solSpent / tokensReceived, signature }
    } catch (err) {
      lastError = err
      log.warn(`buy attempt ${attempt}/${config.exec.maxRetries} failed: ${err.message}`)
      if (attempt < config.exec.maxRetries) await sleep(400 * attempt)
    }
  }

  return { ok: false, error: lastError?.message ?? 'buy failed' }
}

export async function sell({ mint, tokenAmount, curve, pool }) {
  if (config.paper) return paperSell({ mint, tokenAmount, curve })

  const before = await snapshot(mint)
  if (!(before.tokenBal > 0)) return { ok: false, error: 'no tokens held' }

  // Never try to sell more than we actually hold — the transaction would simply fail.
  const target = Math.min(tokenAmount, before.tokenBal)
  let lastError = null

  for (let attempt = 1; attempt <= config.exec.maxRetries; attempt++) {
    try {
      // Being unable to exit is the worst outcome available, so each retry widens
      // the slippage tolerance rather than giving up at the original limit.
      const slippage = Math.min(90, config.exec.sellSlippagePct * attempt)
      const tx = await buildTransaction({
        action: 'sell',
        mint,
        amount: Math.floor(target),
        denominatedInSol: false,
        slippage,
        pool,
      })
      const signature = await signAndSend(tx)
      const after = await snapshot(mint)

      const tokensSold = before.tokenBal - after.tokenBal
      const solReceived = after.solBal - before.solBal

      if (!(tokensSold > 0)) throw new Error('transaction landed but no tokens left the wallet')

      log.info(`SELL ${mint} filled: ${tokensSold.toFixed(0)} tokens for ${sol(solReceived)}`)
      return {
        ok: true,
        tokensSold,
        solReceived,
        remainingTokens: after.tokenBal,
        avgPriceSol: solReceived / tokensSold,
        signature,
      }
    } catch (err) {
      lastError = err
      log.warn(`sell attempt ${attempt}/${config.exec.maxRetries} failed: ${err.message}`)
      if (attempt < config.exec.maxRetries) await sleep(400 * attempt)
    }
  }

  return { ok: false, error: lastError?.message ?? 'sell failed' }
}

// --- Paper fills -------------------------------------------------------------------
// Modelled on the same constant-product curve as the real thing, minus fees, minus a
// slippage haircut standing in for the traders who get there before us. Optimistic
// paper fills are worse than useless, so this errs pessimistic.

function paperBuy({ mint, solAmount, curve }) {
  const q = quoteBuy({ vSol: curve?.vSol, vTokens: curve?.vTokens, solIn: solAmount })
  if (!q) return { ok: false, error: 'no curve state for paper fill' }

  const feeMultiplier = 1 - config.exec.feePct / 100
  const slipMultiplier = 1 - config.exec.buySlippagePct / 200 // assume half the tolerance is used
  const tokensReceived = q.tokensOut * feeMultiplier * slipMultiplier
  const solSpent = solAmount + config.exec.priorityFeeSol

  log.info(`[paper] BUY ${mint}: ${tokensReceived.toFixed(0)} tokens for ${sol(solSpent)}`)
  return {
    ok: true,
    tokensReceived,
    solSpent,
    avgPriceSol: solSpent / tokensReceived,
    signature: `paper-buy-${Date.now()}`,
    paper: true,
  }
}

function paperSell({ mint, tokenAmount, curve }) {
  const q = quoteSell({ vSol: curve?.vSol, vTokens: curve?.vTokens, tokensIn: tokenAmount })
  if (!q) return { ok: false, error: 'no curve state for paper fill' }

  const feeMultiplier = 1 - config.exec.feePct / 100
  const slipMultiplier = 1 - config.exec.sellSlippagePct / 200
  const solReceived = q.solOut * feeMultiplier * slipMultiplier - config.exec.priorityFeeSol

  log.info(`[paper] SELL ${mint}: ${tokenAmount.toFixed(0)} tokens for ${sol(solReceived)}`)
  return {
    ok: true,
    tokensSold: tokenAmount,
    solReceived: Math.max(0, solReceived),
    remainingTokens: 0,
    avgPriceSol: solReceived / tokenAmount,
    signature: `paper-sell-${Date.now()}`,
    paper: true,
  }
}
