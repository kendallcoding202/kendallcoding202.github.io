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
  pumpProgramId: str('PUMP_PROGRAM_ID', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  wsFeedUrl: str('FEED_URL', 'wss://pumpportal.fun/api/data'),
  /**
   * PumpPortal API key. WITHOUT IT THE BOT CANNOT TRADE.
   *
   * The free feed serves subscribeNewToken only; subscribeTokenTrade requires a key
   * funded with at least 0.02 SOL. No trade events means no buyer counts, so nothing
   * ever passes the entry filter, and — more seriously — no price ticks, so exits
   * degrade to the stop-loss and time stop firing on a stale entry price.
   *
   * This key is for DATA ONLY. Trades are still built and signed locally with your own
   * wallet; the key never gains the ability to move your funds.
   */
  feedApiKey: str('PUMPPORTAL_API_KEY'),
  tradeApiUrl: str('TRADE_API_URL', 'https://pumpportal.fun/api/trade-local'),

  dataDir: str('DATA_DIR', path.join(ROOT, '.data')),

  /**
   * Which build is actually running. Without this, "did my fix deploy?" is answered by
   * inferring from behaviour, which is exactly how you end up debugging a version that
   * is no longer running. Railway injects the first of these; the others cover other
   * hosts and local runs.
   */
  version: (
    str('RAILWAY_GIT_COMMIT_SHA') ||
    str('RAILWAY_DEPLOYMENT_ID') ||
    str('GIT_SHA') ||
    str('SOURCE_VERSION') ||
    'local'
  ).slice(0, 7),

  feed: {
    /**
     * Where trade ticks come from.
     *
     * 'rpc' decodes pump.fun's TradeEvent from Solana transaction logs: one
     * subscription covers every token, costs nothing per message, and has no
     * subscription cap. 'pumpportal' uses the metered tape, billed at 0.01 SOL per
     * 10,000 messages — at real launch density that runs over a SOL a day, many times
     * the trading stack it serves. Free is also strictly more complete here, since the
     * per-token tape only covers tokens we thought to subscribe to.
     *
     * New-token and migration discovery stay on PumpPortal either way; both are free.
     */
    tradeSource: str('TRADE_SOURCE', 'rpc'),
    /**
     * How long subscriptions accumulate before being sent as one message.
     *
     * This is deliberately long. Launches arrive one at a time, so a short window
     * produces a stream of one-key messages — which is the exact pattern the feed
     * warns against and is indistinguishable from the per-mint sends it replaced.
     * At five seconds a batch actually batches, and the socket sees ~12 messages a
     * minute instead of ~85. The cost is up to 5s of a 30s observation window.
     */
    subscribeBatchMs: num('SUBSCRIBE_BATCH_MS', 5000),
    /**
     * Upper bound on simultaneous per-token trade subscriptions.
     *
     * Kept low because PumpPortal METERS the data feed — published rate is 0.01 SOL
     * per 10,000 websocket messages. Freshly-launched tokens are the most trade-dense
     * on the platform, so each extra subscription is a recurring cost, not a free one.
     * 180 hot tokens can plausibly generate hundreds of thousands of messages a day,
     * which on a 0.5 SOL stack would cost more than the trading.
     */
    maxWatchedMints: num('MAX_WATCHED_MINTS', 60),
    /**
     * Published metering rate, used only to ESTIMATE spend from messages we count.
     * We cannot read the key's balance, so this turns an invisible drain into a number
     * you can watch. Set to 0 to hide the estimate.
     */
    costPer10kMessagesSol: num('FEED_COST_PER_10K_SOL', 0.01),
    // Warn once estimated feed spend crosses this. Default is the minimum funding.
    costWarnSol: num('FEED_COST_WARN_SOL', 0.02),
  },

  // How often the pipeline summary prints. The first beat always comes early so you
  // get confirmation the feed is alive without waiting a full interval.
  heartbeatSeconds: num('HEARTBEAT_SECONDS', 60),

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    chatId: str('TELEGRAM_CHAT_ID'),
  },

  /**
   * Exploration: deliberately take trades the filter would reject, to find out whether
   * the filter is right.
   *
   * A strict filter in paper mode produces almost no trades, which produces almost no
   * data — and the data it does produce is all from one side of every threshold, so it
   * can never tell you a threshold is too tight. Paper money is free; spend it buying
   * information.
   *
   * HARD-GATED TO PAPER. There is no env var to turn this on with real money. If you
   * want live to take more trades, loosen the actual thresholds deliberately.
   */
  explore: {
    enabled: bool('PAPER', true) && bool('EXPLORE', true),
    // Fraction of filter-rejected candidates to buy anyway.
    sampleRate: num('EXPLORE_SAMPLE_RATE', 0.25),
    // Paper mode can carry far more positions than live — it is not risking anything.
    maxConcurrent: num('EXPLORE_MAX_CONCURRENT', 15),
    /**
     * The experiment's own notional bankroll, kept entirely apart from the strategy
     * book (see paperExploreWalletSol). Explore may hold at most this much at once and
     * stops when it has lost this much.
     *
     * Sized for the question it has to answer, not for caution: the learning report
     * needs ~200 labelled samples before it will suggest anything, and explore trades
     * average roughly a 2% round-trip loss on a dead launch, so a few hundred samples
     * costs on the order of 1-2 SOL of PAPER money. A 0.3 bankroll ran the experiment
     * out in about twenty minutes and produced nothing conclusive.
     */
    budgetSol: num('EXPLORE_BUDGET_SOL', 3),
    /**
     * The only check never overridden. Everything else is a hypothesis worth testing;
     * an unpriceable token is one whose exit we cannot manage, so an explore trade on it
     * would produce a stuck position and no usable label.
     */
    neverRelax: ['priceable'],
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
    // PORT is the convention on hosted platforms (Railway, Render, Fly) — honour it
    // so the dashboard lands on the port the platform actually routes to.
    port: num('DASHBOARD_PORT', num('PORT', 8080)),
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
    // Sell attempts on one position before we stop retrying. Each failed attempt still
    // costs a priority fee that no circuit breaker can see.
    maxSellAttempts: num('MAX_SELL_ATTEMPTS', 8),
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
    /**
     * Exit if the price has not updated in this long.
     *
     * Holding a position we cannot price is the worst state this bot can be in: the
     * stop-loss can never fire because the price never moves, and the time stop is
     * disabled once a rung is hit. A token that spiked and then collapsed would be
     * held indefinitely. Getting out blind beats holding blind.
     */
    stalePriceSeconds: num('STALE_PRICE_SECONDS', 180),
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

/**
 * What the process can actually see, by NAME and LENGTH only — never values.
 *
 * Six variables reaching the container and a seventh not is not something to reason
 * about from the outside. This distinguishes the three cases that look identical from
 * a distance: the variable is absent, it is present but empty, or it is present and
 * populated and the remote end is rejecting it.
 */
export function envReport() {
  const expected = [
    'PAPER', 'DATA_DIR', 'PUMPPORTAL_API_KEY', 'RPC_URL', 'PRIVATE_KEY',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'DASHBOARD_HOST', 'DASHBOARD_TOKEN', 'PORT',
  ]
  return expected.map((name) => {
    const raw = process.env[name]
    return {
      name,
      present: raw !== undefined,
      length: raw === undefined ? 0 : raw.length,
      trimmedLength: raw === undefined ? 0 : raw.trim().length,
    }
  })
}

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

export const LAMPORTS_PER_SOL = 1_000_000_000
// Every pump.fun mint is 1e9 tokens at 6 decimals.
export const PUMP_TOTAL_SUPPLY = 1_000_000_000
export const PUMP_DECIMALS = 6
