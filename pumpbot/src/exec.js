import { VersionedTransaction } from '@solana/web3.js'
import { config, LAMPORTS_PER_SOL } from './config.js'
import { getKeypair, getPublicKey, getConnection, getTokenBalance } from './wallet.js'
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
      /**
       * Buys are always fresh bonding-curve tokens, so 'pump' is right and avoids a
       * venue lookup on the latency-critical path. Sells must use 'auto': a token that
       * graduates has its curve CLOSED and its liquidity migrated to PumpSwap, so a
       * sell routed at 'pump' fails outright. That failure lands on our winners —
       * entries cap at 120 SOL market cap and the +200%/+400% rungs sit past
       * graduation — which is the worst possible place to be unable to exit.
       */
      pool: pool || (action === 'sell' ? 'auto' : 'pump'),
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

async function signAndSend(tx, sentSignatures = []) {
  const connection = getConnection()
  tx.sign([getKeypair()])
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true, // preflight against a moving curve rejects fills that would land
    maxRetries: 0, // we manage our own retries with fresh blockhashes
  })

  // Recorded before confirmation: a send whose confirm times out may still land, and
  // we must be able to find it rather than retry into a duplicate order.
  sentSignatures.push(signature)

  const latest = await connection.getLatestBlockhash('confirmed')
  const result = await connection.confirmTransaction(
    { signature, ...latest },
    'confirmed',
  )
  if (result.value.err) throw new Error(`transaction failed on chain: ${JSON.stringify(result.value.err)}`)
  return signature
}

/**
 * Measures what a SPECIFIC transaction did to our wallet, by reading that
 * transaction's own pre/post balances.
 *
 * This replaced a before/after wallet-balance snapshot, which was unsound: up to four
 * orders run concurrently on different mints, the busy lock is per-mint, and #onTrade
 * fires #manage without awaiting. So another order's proceeds could land inside this
 * order's measurement window. That produced wrong entry prices — and when the
 * contamination exceeded the trade size, a NEGATIVE one, which made decideExit return
 * "no action" on every future tick and left the position with no working exit at all.
 *
 * Reading the transaction is exact and immune to anything else happening concurrently.
 */
async function fillFromTransaction(signature, mint) {
  const connection = getConnection()
  const me = getPublicKey().toBase58()

  // Confirmation and indexing can lag slightly; a fill we cannot measure is worse
  // than a slow one, so retry briefly rather than fall back to a guess.
  let tx = null
  for (let attempt = 0; attempt < 5 && !tx; attempt++) {
    if (attempt) await sleep(600)
    try {
      tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
    } catch (err) {
      log.debug(`getTransaction retry ${attempt}: ${err.message}`)
    }
  }
  if (!tx?.meta) return null
  if (tx.meta.err) return null

  // The fee payer is always account index 0, and that is us — we sign every order.
  const keys = tx.transaction?.message?.staticAccountKeys ?? tx.transaction?.message?.accountKeys
  const first = keys?.[0]
  const firstKey = typeof first?.toBase58 === 'function' ? first.toBase58() : String(first ?? '')
  if (firstKey && firstKey !== me) {
    log.warn(`fee payer ${firstKey} is not our wallet — refusing to measure this fill`)
    return null
  }

  const pre = tx.meta.preBalances?.[0]
  const post = tx.meta.postBalances?.[0]
  if (!Number.isFinite(pre) || !Number.isFinite(post)) return null
  // Net of fees, which is what a position actually cost or returned.
  const solDelta = (post - pre) / LAMPORTS_PER_SOL

  const ours = (list) =>
    (list ?? []).find((b) => b?.mint === mint && b?.owner === me)?.uiTokenAmount?.uiAmount ?? 0
  const tokenDelta = (Number(ours(tx.meta.postTokenBalances)) || 0) - (Number(ours(tx.meta.preTokenBalances)) || 0)

  return { solDelta, tokenDelta }
}

/**
 * A send whose confirmation times out may still have landed. Retrying blind would buy
 * twice, so every signature we have sent is checked before another attempt.
 */
async function alreadyLanded(signatures, mint) {
  for (const sig of signatures) {
    const fill = await fillFromTransaction(sig, mint)
    if (fill) return { sig, fill }
  }
  return null
}

export async function buy({ mint, solAmount, curve, pool }) {
  if (config.paper) return paperBuy({ mint, solAmount, curve })

  const sent = []
  let lastError = null

  for (let attempt = 1; attempt <= config.exec.maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const landed = await alreadyLanded(sent, mint)
        if (landed) {
          log.warn(`buy retry avoided — ${landed.sig.slice(0, 8)} actually landed`)
          return finishBuy(mint, landed.fill, landed.sig)
        }
      }

      const tx = await buildTransaction({
        action: 'buy',
        mint,
        amount: solAmount,
        denominatedInSol: true,
        slippage: config.exec.buySlippagePct,
        pool,
      })
      const signature = await signAndSend(tx, sent)
      const fill = await fillFromTransaction(signature, mint)
      if (!fill) throw new Error('transaction sent but its effect could not be measured')

      return finishBuy(mint, fill, signature)
    } catch (err) {
      lastError = err
      log.warn(`buy attempt ${attempt}/${config.exec.maxRetries} failed: ${err.message}`)
      if (attempt < config.exec.maxRetries) await sleep(400 * attempt)
    }
  }

  // Last chance: the final send may have landed after its confirmation gave up.
  const landed = await alreadyLanded(sent, mint)
  if (landed) {
    log.warn('buy reported failure but a transaction landed — adopting it')
    try {
      return finishBuy(mint, landed.fill, landed.sig)
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  return { ok: false, error: lastError?.message ?? 'buy failed' }
}

/**
 * Validates a measured buy before it becomes a position. A position built on a bad
 * entry price cannot be exited correctly, so refusing here is far better than storing
 * it — an unusable fill should read as a failed buy.
 */
function finishBuy(mint, fill, signature) {
  const tokensReceived = fill.tokenDelta
  const solSpent = -fill.solDelta // buys move SOL out, so the delta is negative

  if (!(tokensReceived > 0)) throw new Error('transaction landed but no tokens arrived')
  if (!(solSpent > 0)) throw new Error(`measured a non-positive cost (${solSpent}) — refusing to open`)

  const avgPriceSol = solSpent / tokensReceived
  if (!(avgPriceSol > 0) || !Number.isFinite(avgPriceSol)) {
    throw new Error(`measured an unusable entry price (${avgPriceSol}) — refusing to open`)
  }

  log.info(`BUY ${mint} filled: ${tokensReceived.toFixed(0)} tokens for ${sol(solSpent)}`)
  return { ok: true, tokensReceived, solSpent, avgPriceSol, signature }
}

export async function sell({ mint, tokenAmount, curve, pool }) {
  if (config.paper) return paperSell({ mint, tokenAmount, curve })

  const held = await getTokenBalance(mint)
  if (!(held > 0)) return { ok: false, error: 'no tokens held' }

  // Never try to sell more than we actually hold — the transaction would simply fail.
  const target = Math.min(tokenAmount, held)
  const sent = []
  let lastError = null

  for (let attempt = 1; attempt <= config.exec.maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const landed = await alreadyLanded(sent, mint)
        if (landed) {
          log.warn(`sell retry avoided — ${landed.sig.slice(0, 8)} actually landed`)
          return await finishSell(mint, landed.fill, landed.sig)
        }
      }

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
      const signature = await signAndSend(tx, sent)
      const fill = await fillFromTransaction(signature, mint)
      if (!fill) throw new Error('transaction sent but its effect could not be measured')

      return await finishSell(mint, fill, signature)
    } catch (err) {
      lastError = err
      log.warn(`sell attempt ${attempt}/${config.exec.maxRetries} failed: ${err.message}`)
      if (attempt < config.exec.maxRetries) await sleep(400 * attempt)
    }
  }

  const landed = await alreadyLanded(sent, mint)
  if (landed) {
    log.warn('sell reported failure but a transaction landed — adopting it')
    try {
      return await finishSell(mint, landed.fill, landed.sig)
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  return { ok: false, error: lastError?.message ?? 'sell failed' }
}

async function finishSell(mint, fill, signature) {
  const tokensSold = -fill.tokenDelta // sells move tokens out
  const solReceived = fill.solDelta

  if (!(tokensSold > 0)) throw new Error('transaction landed but no tokens left the wallet')
  // A sell that nets negative SOL would book a fabricated loss against the risk limits.
  if (!(solReceived > 0)) throw new Error(`measured a non-positive sale (${solReceived})`)

  const remainingTokens = await getTokenBalance(mint)
  log.info(`SELL ${mint} filled: ${tokensSold.toFixed(0)} tokens for ${sol(solReceived)}`)
  return {
    ok: true,
    tokensSold,
    solReceived,
    remainingTokens,
    avgPriceSol: solReceived / tokensSold,
    signature,
  }
}

// --- Paper fills -------------------------------------------------------------------
/**
 * Modelled on the same constant-product curve as the real thing — so PRICE IMPACT is
 * exact, not estimated — minus fees, minus a latency haircut for the trades that land
 * between our decision and ours.
 *
 * That haircut used to be half the API SLIPPAGE TOLERANCE: 6% on the buy and 12.5% on
 * the sell, stacked on top of the curve's own impact, for a 21.4% round trip before the
 * market moved at all. A tolerance is the worst fill we will accept, not the fill we
 * expect, and billing it as a cost meant a wider safety margin scored as a worse
 * strategy. It also put the paper account 16pp away from the replay, which is the
 * calibration gap the report kept reporting and nobody could place.
 *
 * Optimistic paper fills are worse than useless, so the number that replaced it is
 * still conservative — but it is now the SAME number the replay charges, and the two
 * can no longer tell different stories about the same trade.
 */
function paperBuy({ mint, solAmount, curve }) {
  const q = quoteBuy({ vSol: curve?.vSol, vTokens: curve?.vTokens, solIn: solAmount })
  if (!q) return { ok: false, error: 'no curve state for paper fill' }

  const feeMultiplier = 1 - config.exec.feePct / 100
  const slipMultiplier = 1 - config.exec.latencySlipPct / 100
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
  const slipMultiplier = 1 - config.exec.latencySlipPct / 100
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
