import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from './util.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')

loadEnvFile(path.join(ROOT, '.env'))

const num = (key, fallback) => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const bool = (key, fallback) => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

const str = (key, fallback = '') => (process.env[key] ?? fallback).trim()

const list = (key, fallback = []) => {
  const raw = str(key)
  if (!raw) return fallback
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const config = {
  statePath: str('STATE_PATH', path.join(ROOT, '.state', 'state.json')),

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
    // Set true to run the whole pipeline and print alerts without sending them.
    dryRun: bool('DRY_RUN', false),
  },

  rpcUrl: str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  walletAddress: str('WALLET_ADDRESS'),

  scan: {
    enabled: bool('SCAN_ENABLED', true),
    // Skip brand-new pairs: the first minutes are noise and the LP state is still moving.
    minAgeMinutes: num('MIN_AGE_MINUTES', 15),
    maxAgeHours: num('MAX_AGE_HOURS', 24),
    // Hard cap on alerts per run so a bad filter can never flood the chat.
    maxAlertsPerRun: num('MAX_ALERTS_PER_RUN', 5),
    // How long a mint stays deduped after we alert on it.
    dedupeDays: num('DEDUPE_DAYS', 7),
    // Pause between deep screens, to spread load across RugCheck and the RPC.
    candidateDelayMs: num('CANDIDATE_DELAY_MS', 500),
  },

  gates: {
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 15000),
    maxLiquidityUsd: num('MAX_LIQUIDITY_USD', 5000000),
    minVolume24hUsd: num('MIN_VOLUME_24H_USD', 25000),
    minMarketCapUsd: num('MIN_MARKET_CAP_USD', 30000),
    maxMarketCapUsd: num('MAX_MARKET_CAP_USD', 20000000),
    minTxns24h: num('MIN_TXNS_24H', 150),
    minHolders: num('MIN_HOLDERS', 150),
    // Share of supply held by the top 10 non-LP wallets.
    maxTop10Pct: num('MAX_TOP10_PCT', 25),
    maxSingleHolderPct: num('MAX_SINGLE_HOLDER_PCT', 8),
    // Share of the LP that must be burned or locked.
    minLpLockedPct: num('MIN_LP_LOCKED_PCT', 90),
    // Wash-trading smell: 24h volume many multiples of the pool it trades against.
    maxVolumeToLiquidityRatio: num('MAX_VOL_LIQ_RATIO', 30),
    // Honeypot smell: lots of buys, almost no sells.
    minSellRatio24h: num('MIN_SELL_RATIO_24H', 0.15),
    // RugCheck's normalised score, where lower is safer.
    maxRugcheckScore: num('MAX_RUGCHECK_SCORE', 40),
    // RugCheck risk names to tolerate, e.g. "Low amount of LP Providers".
    ignoredRugcheckRisks: list('IGNORED_RUGCHECK_RISKS', []),
    // Soft score (0-100) a candidate must reach on top of passing every hard gate.
    minScore: num('MIN_SCORE', 60),
  },

  positions: {
    enabled: bool('POSITIONS_ENABLED', true),
    // Ignore dust so a few cents of an airdropped token does not generate noise.
    minValueUsd: num('POSITION_MIN_VALUE_USD', 25),
    // Alert when a holding moves this far from the last price we alerted at.
    movePct: num('POSITION_MOVE_PCT', 25),
    // Alert when a holding's pool drains this much from the last observed level.
    liquidityDropPct: num('POSITION_LIQ_DROP_PCT', 45),
    // Hard floor: any holding whose pool falls under this is flagged as exiting.
    liquidityFloorUsd: num('POSITION_LIQ_FLOOR_USD', 5000),
    // Send a full holdings summary once a day at this UTC hour. -1 disables.
    digestHourUtc: num('DIGEST_HOUR_UTC', 13),
  },
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

/** Stablecoins and wrapped SOL are never meme-coin candidates or PnL positions. */
export const QUOTE_MINTS = new Set([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
])

export function assertTelegramConfigured() {
  const missing = []
  if (!config.telegram.token) missing.push('TELEGRAM_BOT_TOKEN')
  if (!config.telegram.chatId) missing.push('TELEGRAM_CHAT_ID')
  if (missing.length && !config.telegram.dryRun) {
    throw new Error(
      `Missing ${missing.join(', ')}. Set them, or run with DRY_RUN=1 to print alerts instead of sending.`,
    )
  }
}
