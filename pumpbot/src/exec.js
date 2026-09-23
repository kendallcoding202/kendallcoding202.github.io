import { VersionedTransaction } from '@solana/web3.js'
import { config, LAMPORTS_PER_SOL, PUMP_INITIAL_VIRTUAL_SOL } from './config.js'
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
          return finishBuy(mint, landed.fill, landed.sig, solAmount)
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

      return finishBuy(mint, fill, signature, solAmount)
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
      return finishBuy(mint, landed.fill, landed.sig, solAmount)
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
export function finishBuy(mint, fill, signature, swapSol) {
  const tokensReceived = fill.tokenDelta
  const solSpent = -fill.solDelta // buys move SOL out, so the delta is negative

  if (!(tokensReceived > 0)) throw new Error('transaction landed but no tokens arrived')
  if (!(solSpent > 0)) throw new Error(`measured a non-positive cost (${solSpent}) — refusing to open`)

  /**
   * THE ENTRY PRICE IS WHAT THE SWAP PAID PER TOKEN — NOT THE WALLET DELTA PER TOKEN.
   *
   * This divided the whole balance change by the tokens received, which folds the network
   * fee and, far worse, the ~0.00204 SOL of rent for a newly created token account into
   * the PRICE of the asset. Those are costs of transacting; they buy no tokens and they
   * are not what the market charged.
   *
   * The consequence was not a rounding error, it was a broken position. Every exit rule
   * compares the live curve price against entryPriceSol, so inflating the entry inflates
   * the loss on tick one: at a 0.01 SOL position the overhead is 25% of the trade, the
   * position opens at about -20% before the market has moved at all, and a -15% stop
   * fires within seconds. That is exactly what the first live run did — RANKR stopped at
   * -28.4% after 3 seconds, SADA at -17.5% after 12, and SADA sold back the same 292,584
   * tokens it bought for ~0.0099 against 0.0100 in. Neither was a market loss. The bot
   * stopped itself out on its own accounting.
   *
   * It is a LIVE-ONLY fault that scales with position size — rent does not exist in paper,
   * and at the strategy's 0.15 SOL it is a 1.7% nudge nobody would ever notice. Only the
   * probe's deliberately tiny size made it visible.
   *
   * solSpent stays the full outflow, because P&L should count every lamport that left. The
   * split is the point: DECISIONS use the price, ACCOUNTING uses the cost.
   */
  const swapped = Number.isFinite(swapSol) && swapSol > 0 ? Math.min(swapSol, solSpent) : solSpent
  const avgPriceSol = swapped / tokensReceived
  if (!(avgPriceSol > 0) || !Number.isFinite(avgPriceSol)) {
    throw new Error(`measured an unusable entry price (${avgPriceSol}) — refusing to open`)
  }
  const overheadSol = solSpent - swapped

  log.info(
    `BUY ${mint} filled: ${tokensReceived.toFixed(0)} tokens for ${sol(swapped)}` +
      (overheadSol > 0 ? ` (+${sol(overheadSol)} rent/fees, ${sol(solSpent)} total)` : ''),
  )
  return { ok: true, tokensReceived, solSpent, swapSol: swapped, overheadSol, avgPriceSol, signature }
}

/**
 * What to ask the venue to sell on this attempt.
 *
 * '100%' lets the venue compute the exact raw balance, which is the only way to land on
 * zero: getTokenBalance reports uiAmount, a float in display units, and these tokens
 * carry six decimals, so flooring it left up to 0.999999 tokens behind on every sell.
 * A token account can only be closed at a balance of exactly zero, so that rounding
 * stranded its 0.00203928 SOL rent permanently -- 2.72pp of a round trip at the top
 * tier, more than twice the measured edge.
 *
 * The LAST attempt always falls back to the numeric amount. Being unable to exit is the
 * worst outcome available, so a venue that rejects the percentage form must never be
 * able to trap a position; the fallback keeps every exit path at least as wide as it
 * was before this existed.
 */
export function sellAmountFor({ sellAll, attempt, target, maxRetries = config.exec.maxRetries }) {
  if (sellAll && attempt < maxRetries) return '100%'
  return Math.floor(target)
}

export async function sell({ mint, tokenAmount, curve, pool, paperCredit = 0, sellAll = false }) {
  // paperCredit is only meaningful to the paper fill — a live sale takes what the chain
  // gives it, and our SOL really is in the curve.
  if (config.paper) return paperSell({ mint, tokenAmount, curve, paperCredit })

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
      /**
       * A FULL EXIT ASKS FOR THE WHOLE BALANCE, not a number we rounded.
       *
       * getTokenBalance reports uiAmount -- a float in display units -- and these tokens
       * carry six decimals, so Math.floor discarded up to 0.999999 tokens on every sell.
       * That is the "1 tokens left" in the log. A token account can only be closed at a
       * balance of exactly zero, so each exit stranded its 0.00203928 SOL rent forever:
       * 2.72pp of every round trip at the top tier, which is more than twice the entire
       * measured edge, thrown away on a rounding mode.
       *
       * The venue computes the exact raw balance for '100%', which is the only way to
       * land on zero from a float. The LAST attempt always falls back to the numeric
       * path: being unable to exit is the worst outcome available, and a venue that
       * rejects the percentage form must not be able to trap a position.
       */
      const tx = await buildTransaction({
        action: 'sell',
        mint,
        amount: sellAmountFor({ sellAll, attempt, target }),
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
  /**
   * Paper pays the TOKEN-ACCOUNT RENT too, because paper exists to predict live.
   *
   * A live buy of a mint the wallet has never held creates an associated token account
   * and is charged ~0.00204 SOL of rent-exemption for it, which nothing in this bot ever
   * reclaims. Paper creates no account, so it is not charged by the chain — but a paper
   * book that skips a cost the live book pays is not a forecast of anything. At 0.15 SOL
   * it overstates every trade by 1.4% of stake; at the probe's 0.01 it would be 20%.
   *
   * Charged as part of solSpent, alongside the priority fee, and deliberately NOT folded
   * into avgPriceSol — it is a cost of transacting, not a price the market quoted.
   */
  const overheadSol = config.exec.priorityFeeSol + config.exec.ataRentSol
  const solSpent = solAmount + overheadSol

  log.info(`[paper] BUY ${mint}: ${tokensReceived.toFixed(0)} tokens for ${sol(solSpent)}`)
  return {
    ok: true,
    tokensReceived,
    solSpent,
    swapSol: solAmount,
    overheadSol,
    // The SWAP price, matching the live path. Folding the priority fee in is 0.3% at the
    // strategy's size and 5% at the probe's — small enough to hide, large enough to
    // misprice an exit, and there is no reason for the two executors to differ.
    avgPriceSol: solAmount / tokensReceived,
    signature: `paper-buy-${Date.now()}`,
    paper: true,
  }
}

function paperSell({ mint, tokenAmount, curve, paperCredit = 0 }) {
  /**
   * WHAT THE CURVE CAN ACTUALLY PAY, which this was not asking.
   *
   * A pump.fun trade event carries the VIRTUAL reserves only, and virtual SOL is
   * `PUMP_INITIAL_VIRTUAL_SOL + real`. So the real balance is recoverable from it, and
   * where we have read the curve account directly we have the real figure outright.
   * Prefer the measured one; fall back to the derivation; and if neither is available
   * pass null rather than a guess, so quoteSell leaves the old behaviour alone instead
   * of trading a known overstatement for an invented number.
   */
  const onCurve = Number.isFinite(curve?.realSol)
    ? curve.realSol
    : Number.isFinite(curve?.vSol)
      ? Math.max(0, curve.vSol - PUMP_INITIAL_VIRTUAL_SOL)
      : null
  /**
   * OUR OWN MONEY IS NOT IN THAT BALANCE, because in paper the buy never happened.
   *
   * The chain's real reserve reflects everyone's trades except ours, so capping a paper
   * sale at it alone would under-pay every position — most obviously one sold moments
   * after entry on a fresh curve, where the real balance is ~0 and we would book nothing
   * for a stake we notionally paid. `paperCredit` is what we still have in: spent minus
   * already recovered, floored at zero. On a bag that has already taken more out than it
   * put in it contributes nothing, which is exactly when the cap needs to bite hardest.
   */
  const realSol = onCurve === null ? null : onCurve + Math.max(0, paperCredit)
  const q = quoteSell({ vSol: curve?.vSol, vTokens: curve?.vTokens, tokensIn: tokenAmount, realSol })
  if (!q) return { ok: false, error: 'no curve state for paper fill' }
  if (q.capped) {
    log.warn(
      `[paper] SELL ${mint} capped by the curve's real balance: wanted ${sol(q.wantedSol)}, ` +
        `the curve holds ${sol(realSol ?? 0)} (incl. our ${sol(Math.max(0, paperCredit))} stake). ` +
          'A live sale could not have returned more.',
    )
  }

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
