import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')

/**
 * Minimal .env loader. Existing process env always wins, which is what lets a paper
 * instance run alongside a live one with nothing but inline overrides.
 * ENV_FILE selects a different file for fully separate configs.
 */
try {
  const envFile = process.env.ENV_FILE
    ? path.resolve(ROOT, process.env.ENV_FILE)
    : path.join(ROOT, '.env')
  const raw = fs.readFileSync(envFile, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
} catch {
  /* no .env is fine — everything can come from the environment */
}

const num = (k, d) => {
  const raw = process.env[k]
  if (raw === undefined || raw === '') return d
  const n = Number(raw)
  return Number.isFinite(n) ? n : d
}
const str = (k, d = '') => (process.env[k] ?? d).trim()
const bool = (k, d) => {
  const raw = process.env[k]
  if (raw === undefined || raw === '') return d
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

export const config = {
  /**
   * Paper mode defaults ON. This is a safety interlock, not a second opinion: an
   * untested build of a trading bot should never be able to spend real money on its
   * first run because of a missing env var. Set PAPER=0 in .env deliberately.
   */
  paper: bool('PAPER', true),

  privateKey: str('PRIVATE_KEY'),
  rpcUrl: str('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  wsFeedUrl: str('FEED_URL', 'wss://pumpportal.fun/api/data'),
  tradeApiUrl: str('TRADE_API_URL', 'https://pumpportal.fun/api/trade-local'),

  dataDir: str('DATA_DIR', path.join(ROOT, '.data')),

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
  },

  learning: {
    enabled: bool('LEARNING', true),
    // How long to follow a token after we decide on it, to label the outcome.
    outcomeWindowMinutes: num('OUTCOME_WINDOW_MINUTES', 15),
    // Cap on simultaneously shadow-tracked tokens, to bound memory and feed traffic.
    maxShadowTracked: num('MAX_SHADOW_TRACKED', 80),
    /**
     * Minimum labelled samples before the analyser will make any threshold suggestion.
     * Below this, apparent "edges" are sampling noise. 200 is already generous for a
     * binary outcome; do not lower it because the report looks empty.
     */
    minSamplesForSuggestion: num('MIN_SAMPLES_FOR_SUGGESTION', 200),
    // Minimum samples in a single bucket before that bucket's rate is reported.
    minBucketSamples: num('MIN_BUCKET_SAMPLES', 30),
    /**
     * Auto-applying learned thresholds is OFF and should stay off. Tuning a live
     * strategy on its own recent results is the fastest way to overfit into a
     * drawdown. The analyser proposes; a human decides.
     */
    autoApply: bool('LEARNING_AUTO_APPLY', false),
  },

  dashboard: {
    enabled: bool('DASHBOARD', true),
    port: num('DASHBOARD_PORT', 8080),
    /**
     * Localhost only by default. This page shows your wallet, your positions and your
     * P&L — it has no business being reachable from the internet. To view it from your
     * laptop, tunnel instead of rebinding:
     *   ssh -N -L 8080:localhost:8080 you@your-vps
     */
    host: str('DASHBOARD_HOST', '127.0.0.1'),
    // Only consulted when host is not loopback; then it is mandatory.
    token: str('DASHBOARD_TOKEN'),
  },

  sizing: {
    /**
     * Position size scales with account equity. Format: `minEquitySol:buySol`, so
     * "0:0.075,5:0.15" means trade 0.075 SOL a position until the wallet reaches
     * 5 SOL, then step up to 0.15. Tiers are evaluated against liquid wallet balance,
     * not mark-to-market equity — an open bag is not money you have.
     */
    tiers: parseTiers(str('SIZE_TIERS', '0:0.075,5:0.15')),
    maxConcurrentPositions: num('MAX_CONCURRENT_POSITIONS', 4),
    /**
     * Total SOL at risk in open positions at once. Left unset it derives from the
     * active tier (buySol × maxConcurrent) so exposure scales with the tier instead
     * of silently capping it.
     */
    maxDeployedSol: num('MAX_DEPLOYED_SOL', 0),
    // Never spend the wallet below this — transaction fees must always be payable.
    reserveSol: num('RESERVE_SOL', 0.05),
  },

  risk: {
    // Realized loss in a UTC day that halts all new entries.
    dailyLossLimitSol: num('DAILY_LOSS_LIMIT_SOL', 0.2),
    // Total realized loss that halts the bot permanently until you reset it.
    totalLossLimitSol: num('TOTAL_LOSS_LIMIT_SOL', 0.35),
    // Consecutive losing trades that halt new entries for the day.
    maxConsecutiveLosses: num('MAX_CONSECUTIVE_LOSSES', 6),
  },

  exec: {
    priorityFeeSol: num('PRIORITY_FEE_SOL', 0.0005),
    buySlippagePct: num('BUY_SLIPPAGE_PCT', 12),
    // Exits must clear even in a falling market; being stuck in is the worse failure.
    sellSlippagePct: num('SELL_SLIPPAGE_PCT', 25),
    // pump.fun protocol fee plus the trade API's cut, used for paper fills and PnL.
    feePct: num('FEE_PCT', 1.5),
    maxRetries: num('EXEC_MAX_RETRIES', 3),
    confirmTimeoutMs: num('CONFIRM_TIMEOUT_MS', 30000),
  },

  /**
   * Entry filter. We deliberately do NOT buy at deploy time — at retail latency the
   * block-zero trade is already taken by professional snipers, and buying blind is how
   * you fill every bundled launch. Instead we watch a token for OBSERVE_SECONDS and
   * enter only if real buyers showed up and the dev is not sitting on the supply.
   */
  entry: {
    observeSeconds: num('OBSERVE_SECONDS', 30),
    // Give up on a token that never qualifies, so the watch list cannot grow forever.
    abandonSeconds: num('ABANDON_SECONDS', 180),
    minUniqueBuyers: num('MIN_UNIQUE_BUYERS', 12),
    minBuysPerSell: num('MIN_BUY_SELL_RATIO', 1.8),
    minMarketCapSol: num('MIN_MARKET_CAP_SOL', 25),
    maxMarketCapSol: num('MAX_MARKET_CAP_SOL', 120),
    // Dev's share of supply from their own launch buy.
    maxDevHoldPct: num('MAX_DEV_HOLD_PCT', 12),
    // A dev who sells during the observation window is disqualifying, full stop.
    rejectIfDevSold: bool('REJECT_IF_DEV_SOLD', true),
    // Symbols/names containing these are almost always impersonation scams.
    bannedWords: str('BANNED_WORDS', 'airdrop,claim,presale,official,giveaway')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  exit: {
    /**
     * Rungs are percentages of the ORIGINAL token amount, evaluated against the entry
     * price. The first rung recovers the full stake: selling 67% at +50% returns
     * ~1.0x cost, so everything after it is house money.
     */
    ladder: parseLadder(
      str('LADDER', '50:67,100:10,200:10,400:10'),
    ),
    stopLossPct: num('STOP_LOSS_PCT', 30),
    // Exit anything that has not reached the first rung within this many seconds.
    timeStopSeconds: num('TIME_STOP_SECONDS', 600),
    // Give back at most this much of the peak once the first rung is hit.
    trailingDrawdownPct: num('TRAILING_DRAWDOWN_PCT', 50),
    // Abandon-ship if the curve drains — the pump.fun analogue of an LP pull.
    liquidityDropPct: num('LIQUIDITY_DROP_PCT', 60),
  },
}

function parseTiers(spec) {
  const tiers = []
  for (const part of spec.split(',')) {
    const [minEquity, buySol] = part.split(':').map((s) => Number(s.trim()))
    if (Number.isFinite(minEquity) && Number.isFinite(buySol) && buySol > 0 && minEquity >= 0) {
      tiers.push({ minEquitySol: minEquity, buySol })
    }
  }
  if (!tiers.length) throw new Error(`SIZE_TIERS "${spec}" has no usable tier`)
  // Highest threshold first, so tier lookup is a find() on the first match.
  tiers.sort((a, b) => b.minEquitySol - a.minEquitySol)
  if (!tiers.some((t) => t.minEquitySol === 0)) {
    throw new Error('SIZE_TIERS must include a 0: tier as the floor, e.g. "0:0.075,5:0.15"')
  }
  return tiers
}

function parseLadder(spec) {
  const rungs = []
  for (const part of spec.split(',')) {
    const [at, sell] = part.split(':').map((s) => Number(s.trim()))
    if (Number.isFinite(at) && Number.isFinite(sell) && at > 0 && sell > 0) {
      rungs.push({ atPct: at, sellPct: sell })
    }
  }
  rungs.sort((a, b) => a.atPct - b.atPct)
  const total = rungs.reduce((s, r) => s + r.sellPct, 0)
  if (total > 100) throw new Error(`LADDER sells ${total}% of the position — must be <= 100%`)
  return rungs
}

export const LAMPORTS_PER_SOL = 1_000_000_000
// Every pump.fun mint is 1e9 tokens at 6 decimals.
export const PUMP_TOTAL_SUPPLY = 1_000_000_000
export const PUMP_DECIMALS = 6
