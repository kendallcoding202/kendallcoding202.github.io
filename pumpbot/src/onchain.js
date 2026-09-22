import { PublicKey } from '@solana/web3.js'
import { config, LAMPORTS_PER_SOL, PUMP_DECIMALS } from './config.js'
import { getConnection } from './wallet.js'
import { log } from './log.js'

/**
 * Direct reads of the pump.fun bonding curve account.
 *
 * The feed gives us reserves for free on every trade, so this is only needed when we
 * have no recent event for a mint — adopting an orphaned position, or pricing something
 * that has gone quiet.
 *
 * CAVEAT: the account layout below is from the published program IDL and has NOT been
 * verified against a live account from this machine. decodeBondingCurve sanity-checks
 * what it reads and returns null rather than guessing, so a layout change degrades to
 * "cannot price" instead of "prices wrongly" — which for a trading bot is the only
 * acceptable failure direction.
 */

const PUMP_PROGRAM = new PublicKey(config.pumpProgramId)
const CURVE_SEED = Buffer.from('bonding-curve')

// 8-byte Anchor discriminator, then five u64s, then a bool.
const DISCRIMINATOR_BYTES = 8
const EXPECTED_MIN_LEN = DISCRIMINATOR_BYTES + 8 * 5 + 1

export function bondingCurveAddress(mint) {
  const [pda] = PublicKey.findProgramAddressSync([CURVE_SEED, new PublicKey(mint).toBuffer()], PUMP_PROGRAM)
  return pda
}

export function decodeBondingCurve(data) {
  if (!data || data.length < EXPECTED_MIN_LEN) return null

  const buf = Buffer.from(data)
  let offset = DISCRIMINATOR_BYTES
  const u64 = () => {
    const v = buf.readBigUInt64LE(offset)
    offset += 8
    return v
  }

  const virtualTokenReserves = u64()
  const virtualSolReserves = u64()
  const realTokenReserves = u64()
  const realSolReserves = u64()
  const tokenTotalSupply = u64()
  const complete = buf.readUInt8(offset) === 1

  const vSol = Number(virtualSolReserves) / LAMPORTS_PER_SOL
  const vTokens = Number(virtualTokenReserves) / 10 ** PUMP_DECIMALS

  // Sanity gate. A real curve has meaningful reserves on both sides; anything outside
  // these bounds means we decoded the wrong bytes and must not be trusted for pricing.
  const plausible =
    Number.isFinite(vSol) && Number.isFinite(vTokens) &&
    vSol > 0.001 && vSol < 100_000 &&
    vTokens > 1 && vTokens < 10_000_000_000

  if (!plausible) return null

  return {
    vSol,
    vTokens,
    priceSol: vSol / vTokens,
    realSol: Number(realSolReserves) / LAMPORTS_PER_SOL,
    realTokens: Number(realTokenReserves) / 10 ** PUMP_DECIMALS,
    totalSupply: Number(tokenTotalSupply) / 10 ** PUMP_DECIMALS,
    complete,
  }
}

/**
 * Curve state AND why it could not be read, which are different questions that were
 * being collapsed into the same `null`.
 *
 * A graduated token and an RPC that will not answer both produced "no price", so the bot
 * treated them identically: count three failures, then exit blind. But one of them is
 * PERMANENT and known — the curve account is closed, it is never coming back, and the
 * last curve price is the final one — while the other is a transient wobble where
 * patience is exactly right. Conflating them meant an RPC hiccup looked like a
 * graduation, and, more visibly, every graduation was announced as a failure on what
 * are consistently our best trades.
 *
 * `complete` is the curve's own flag for having filled. A complete curve still EXISTS,
 * so it prices fine — but it no longer trades here, which makes it terminal all the same.
 */
export async function readCurveState(mint) {
  try {
    const info = await getConnection().getAccountInfo(bondingCurveAddress(mint), 'confirmed')
    if (!info?.data) {
      log.debug(`no bonding curve account for ${mint} (graduated, or not a pump.fun token)`)
      return { curve: null, gone: true, error: null }
    }
    const decoded = decodeBondingCurve(info.data)
    if (!decoded) {
      log.warn(`bonding curve for ${mint} did not decode plausibly — not pricing it`)
      return { curve: null, gone: false, error: 'did not decode plausibly' }
    }
    return { curve: decoded, gone: Boolean(decoded.complete), error: null }
  } catch (err) {
    log.warn(`bonding curve read failed for ${mint}: ${err.message}`)
    return { curve: null, gone: false, error: err.message }
  }
}

/** Current curve state for a mint, or null if it cannot be read or decoded. */
export async function readBondingCurve(mint) {
  return (await readCurveState(mint)).curve
}
