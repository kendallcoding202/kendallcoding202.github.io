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

  /**
   * Starting balance for the PAPER strategy book. No effect whatsoever in live mode,
   * which reads the real chain balance — this number cannot put a single lamport at
   * risk.
   *
   * Sized for running an experiment, not for mirroring the live stack. At 0.5 SOL the
   * strategy book halts on the total-loss limit after roughly sixteen losing trades,
   * which stops data collection an hour or two in — and a halted book is a book that
   * stops answering the question. The per-trade figures the learning report actually
   * reasons about (peakMultiple, hitFirstRung, simulated ladder return) are MULTIPLES OF
   * STAKE, so they are scale-invariant: the filter verdict from a 50 SOL paper run
   * carries over to a 0.5 SOL live account unchanged.
   *
   * What does NOT carry over is absolute P&L and the size tier — 50 SOL sits in the top
   * tier, so paper trades 0.15 while a 0.5 SOL live account would trade 0.075.
   */
  paperStartSol: num('PAPER_START_SOL', 50),

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
     * The experiment's notional bankroll. **0 means UNLIMITED, and that is the default.**
     *
     * A cap here only ever existed to stop the experiment wrecking the strategy's books:
     * explore used to share the strategy's paper balance, so an unbounded experiment
     * drove that balance negative and — because the size tier reads it — steered the
     * strategy's real position sizing. That is fixed at the source now; explore has its
     * own balance (paperExploreWalletSol), its own deployed figure, and touches none of
     * the strategy's numbers or circuit breakers.
     *
     * With the books separated there is no reason left to stop buying information with
     * money that does not exist. The experiment is the whole point: it is the only thing
     * sampling the other side of every threshold, and capping it just means the report
     * runs out of evidence on the rejected arm and cannot answer the one question it was
     * built for. Exploration remains bounded where it actually matters — maxConcurrent
     * positions at a time — and is hard-gated to paper, so "unlimited" is unlimited
     * pretend money and nothing else.
     *
     * Set a positive number to impose a cap. To stop exploring entirely, use EXPLORE=0.
     */
    budgetSol: num('EXPLORE_BUDGET_SOL', 0),
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
    /**
     * Cap on simultaneously shadow-tracked tokens.
     *
     * This has to be large enough to hold a FULL outcome window's worth of launches, or
     * rows get evicted early and the "outcome" being measured is not the 15-minute one
     * the report claims. At ~30 launches/minute, 80 slots holds under three minutes —
     * every row was being labelled on a window five times shorter than advertised, which
     * understates peakMultiple for everything and quietly suppresses hitFirstRung.
     *
     * 30/min x 15min is ~450, so 1500 leaves real headroom for a burst. The old cap was
     * partly about feed traffic, which no longer applies: the RPC log feed is one
     * subscription for all tokens, so an extra tracked mint costs a Map lookup.
     */
    maxShadowTracked: num('MAX_SHADOW_TRACKED', 1500),
    /**
     * Minimum labelled samples before the analyser will make any threshold suggestion.
     * Below this, apparent "edges" are sampling noise. 200 is already generous for a
     * binary outcome; do not lower it because the report looks empty.
     */
    minSamplesForSuggestion: num('MIN_SAMPLES_FOR_SUGGESTION', 200),
    // Minimum samples in a single bucket before that bucket's rate is reported.
    minBucketSamples: num('MIN_BUCKET_SAMPLES', 30),
    /**
     * Most recent rows the analysis walks.
     *
     * Raised to 200,000 on a benchmark that was WRONG, and this is the correction.
     *
     * That benchmark showed the cap buying nothing — flat time whatever the value — and
     * concluded that analysing the whole journal was free. Its synthetic rows carried a
     * handful of feature fields where the real ones carry twenty-four, so it almost
     * entirely missed the cost that matters: the threshold scan runs PER FEATURE, and
     * the permutation null runs the whole scan 60 times over.
     *
     * Re-measured on a journal matching the live one, 152,000 rows with the real feature
     * vector:
     *
     *    10,000 rows    3.2s     198 MB        100,000 rows   44.0s    823 MB
     *    25,000 rows    8.6s     303 MB        200,000 rows   77.5s  1,175 MB
     *    50,000 rows   16.9s     467 MB
     *
     * Linear in both, and at 200,000 it is 77 seconds and 1.2 GB — enough to OOM a small
     * container, and (before the work moved to a worker) enough to freeze the trading
     * loop for over a minute every refresh, which force-closed live positions on stale
     * prices. The analysis was corrupting the data it analyses.
     *
     * Set to 10,000, not 25,000, after the container crashed on dc49c89 with the
     * dashboard going down with it. Those figures are a STANDALONE process; on Railway
     * the analysis spike lands on top of a bot already holding a creator index built
     * from 152,000 rows, and the sum is what the container has to survive. 10,000 costs
     * roughly +/-0.6pp on a base rate instead of +/-0.4pp, which is not a real loss.
     *
     * The dashboard now reports process memory, so the next move here can be made
     * against a measurement from the machine that has to run it rather than from a
     * benchmark on a different one. That is what went wrong the first time.
     */
    maxRowsAnalyzed: num('MAX_ROWS_ANALYZED', 10_000),
    /**
     * How often the dashboard's cached report is rebuilt. analyse() is synchronous and
     * the feed shares its event loop, so this is a duty cycle, not a freshness setting:
     * ~2s of work every 30s would freeze the feed 7% of the time for numbers that move
     * over hours.
     */
    refreshSeconds: num('LEARNING_REFRESH_SECONDS', 300),
    // Permutation trials behind the noise floor. More is a better p95 and linearly slower.
    nullTrials: num('LEARNING_NULL_TRIALS', 60),
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
    /**
     * Where the dashboard is reachable from outside, so the bot can hand you a working
     * link. Railway injects RAILWAY_PUBLIC_DOMAIN; DASHBOARD_URL covers everywhere else.
     * Only ever used to build a link — never to decide who may read the page.
     */
    publicUrl:
      str('DASHBOARD_URL') ||
      (str('RAILWAY_PUBLIC_DOMAIN') ? `https://${str('RAILWAY_PUBLIC_DOMAIN')}` : ''),
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
    /**
     * Absolute floors, in SOL. These are correct for a ~0.5 SOL account and WRONG for a
     * larger one: a flat 0.35 SOL total-loss halt is 70% of a 0.5 SOL account but 7% of
     * the 5 SOL benchmark this bot is built to grow into, so a healthy account would
     * halt permanently on an ordinary drawdown. The percentage limits below are the ones
     * that scale; whichever triggers first wins.
     */
    dailyLossLimitSol: num('DAILY_LOSS_LIMIT_SOL', 0.2),
    totalLossLimitSol: num('TOTAL_LOSS_LIMIT_SOL', 0.35),
    /**
     * The same limits as a share of the account's high-water mark, which is what keeps
     * them meaningful at every size. Defaults are chosen to match the absolute numbers
     * above at a 0.5 SOL start (0.2/0.5 = 40%, 0.35/0.5 = 70%), so today's behaviour is
     * unchanged and only the scaling is new. Set either to 0 to disable it.
     */
    dailyLossLimitPct: num('DAILY_LOSS_LIMIT_PCT', 40),
    maxDrawdownPct: num('MAX_DRAWDOWN_PCT', 70),
    // Consecutive losing trades that halt new entries for the day.
    /**
     * Floor for the losing-streak pause. The EFFECTIVE limit scales with the strategy's
     * own win rate — see consecutiveLossLimit() in risk.js.
     *
     * A fixed 6 silently assumes a roughly even win rate. At the 20.1% this strategy
     * actually runs, P(6 losses in a row) is 26% and the expected wait for one is about
     * 14 trades — so the breaker fired within a few trades of every UTC day and stayed
     * on until the next one, which is exactly what it did: 0 bought and 15 launches the
     * filter approved refused at the gate. A circuit breaker that trips on ordinary
     * behaviour is not protecting anything, it is just switching the strategy off.
     */
    maxConsecutiveLosses: num('MAX_CONSECUTIVE_LOSSES', 6),
    /** Closed trades before the streak limit is derived from the win rate rather than fixed. */
    minTradesForAdaptiveStreak: num('MIN_TRADES_FOR_ADAPTIVE_STREAK', 30),
    /**
     * How unlikely a losing run must be, under the strategy's own win rate, before it
     * counts as evidence that something has changed rather than as variance. 0.01 means
     * "a run this long happens less than 1% of the time by chance".
     */
    streakAlpha: num('STREAK_ALPHA', 0.01),
  },

  exec: {
    priorityFeeSol: num('PRIORITY_FEE_SOL', 0.0005),
    buySlippagePct: num('BUY_SLIPPAGE_PCT', 12),
    // Exits must clear even in a falling market; being stuck in is the worse failure.
    sellSlippagePct: num('SELL_SLIPPAGE_PCT', 25),
    // pump.fun protocol fee plus the trade API's cut, used for paper fills and PnL.
    feePct: num('FEE_PCT', 1.5),
    /**
     * Price impact of one fill, as a percentage of the position, at the reference size
     * below. Buying into a bonding curve moves the price against you; so does selling.
     * An estimate, but leaving it at zero is not a neutral choice — it is a claim that
     * trading is free, and that claim always flatters the strategy.
     */
    priceImpactPct: num('PRICE_IMPACT_PCT', 0.5),
    // The position size the impact figure above was estimated for.
    impactReferenceSol: num('IMPACT_REFERENCE_SOL', 0.075),
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
    /**
     * Loosened from 12 and 1.8, which passed 0 of 169 screened launches across two runs.
     * A filter that never fires is not a conservative filter — it produces no evidence
     * at all, so the learning report has nothing to put on the "filter said YES" side
     * and can never tell you whether the filter is worth having. These numbers exist to
     * be measured, not defended; the report's threshold suggestions are what should move
     * them next, once there are ~200 labelled samples on both sides.
     */
    /**
     * Raised from 7 on the first real evidence, and raised a long way.
     *
     * Across 4,000 labelled launches the base rate of reaching +50% is 9.9%. At
     * `organicBuyers >= 85` it is 54.0% [40.4-67.0] — and break-even needs ~31.6%, so
     * even the low end of that interval clears it. At 7 buyers the filter was entering
     * on a signal barely distinguishable from noise: the launches it took hit 25.8%
     * [13.7-43.2], whose lower bound is below break-even.
     *
     * Set to 60 rather than the fitted 85. The cut was chosen on the same data that
     * scores it, so its edge is inflated by construction — the report says as much — and
     * 85 leaves only 1.25% of launches, which is too few to re-measure quickly. 60 keeps
     * the effect well clear of the 12.8pp noise floor while producing enough trades to
     * test the claim out of sample, which is the only test that counts.
     */
    minUniqueBuyers: num('MIN_UNIQUE_BUYERS', 60),
    /**
     * Lowered 1.4 -> 1.0 because at 1.4 this check was measurably doing nothing.
     *
     * Over 71,979 rejected launches it threw away winners at 11.6% [11.4-11.8] — the
     * base rate is 11.6% [11.4-11.8]. Identical, at a sample size where a real effect of
     * even half a point would be visible. It was not selecting; it was shrinking the
     * sample and costing entries for free. The threshold scan never surfaced buy/sell
     * ratio as a useful cut either, which is the same verdict from the other direction.
     *
     * Not removed outright: the evidence says 1.4 discriminates nothing, NOT that a
     * launch already being dumped is fine to buy. 1.0 keeps that degenerate guard —
     * more buys than sells — and drops the part that was an unevidenced guess. If the
     * next report shows 1.0 rejecting at the base rate too, it has earned deletion.
     */
    minBuysPerSell: num('MIN_BUY_SELL_RATIO', 1.0),
    /**
     * Late-window buys over early-window buys: is this still accelerating?
     *
     * The strongest finding in the first real dataset, and the one with the sample to
     * back it — `>= 0.51` gives 37.8% [34.1-41.7] against 4.8% for everything below, on
     * n=619. It survived a permutation null that reaches 12.8pp by chance.
     *
     * It is also the check the filter never had: every other test asks how much buying
     * happened, none asked whether it was still happening.
     */
    minBuyAcceleration: num('MIN_BUY_ACCELERATION', 0.5),
    /**
     * Refuse a deployer whose own record is demonstrably worse than the market's.
     *
     * The first real dataset contained deployers 0-for-111, 0-for-102 and 0-for-71
     * alongside one at 23% over 126 launches. That is not noise, and the bot was already
     * recording it and ignoring it.
     *
     * The floor below is a second safety on top of the Wilson test: the interval already
     * refuses to call a short record evidence, but a hard minimum makes the intent
     * explicit and survives anyone lowering the confidence level.
     */
    creatorHistory: bool('CREATOR_HISTORY', true),
    minCreatorLaunches: num('MIN_CREATOR_LAUNCHES', 20),
    minMarketCapSol: num('MIN_MARKET_CAP_SOL', 25),
    /**
     * The upper bound was BACKWARDS, and the data caught it.
     *
     * It rejected 693 launches of which 25.7% [22.6-29.1] would have reached +50% —
     * nearly three times the 9.9% base rate. It was the single most harmful check in the
     * filter: the only one whose rejects beat the market by a wide margin.
     *
     * The reason is mechanical. Market cap only started updating during the observation
     * window once it was derived from trade reserves; before that it was frozen at the
     * deploy value and the check never fired. Now a launch that RUNS during the window
     * crosses the ceiling and gets refused — so the rule was rejecting exactly the
     * momentum it should have been buying.
     *
     * Raised to 2000 so it still catches something already fully distributed, while no
     * longer vetoing a launch for the offence of going up.
     */
    maxMarketCapSol: num('MAX_MARKET_CAP_SOL', 2000),
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
    /**
     * One sell, all out, at +50%.
     *
     * The four-rung ladder cost 16% of a winner — five transactions, each paying a fee,
     * a priority fee and slippage — against 5.3% for a single exit. Scaling out reads as
     * prudent but on a bonding curve it is the expensive choice, and it raised the hit
     * rate needed to break even rather than lowering it.
     *
     * What this gives up is the moon bag: a coin that runs 10x now pays 1.5x, not more.
     * That is the trade, and it is the right way round only if big runners are rare
     * enough that their rarity does not pay for the fees on everything else. The exit
     * sweep measures exactly that against the recorded paths, so this is a hypothesis
     * with a test attached rather than a preference.
     */
    ladder: parseLadder(
      str('LADDER', '50:100'),
    ),
    /**
     * Tightened from 30%. Every loser used to cost 34% of stake, which at any realistic
     * hit rate is what buries the account: break-even needed ~44% of launches to reach
     * +50%, against a real rate nearer 10-25%. At 15% the requirement drops to ~32%.
     *
     * The risk runs the other way and is real: too tight and the stop knocks you out of
     * winners that dip before they run. At 10% the arithmetic goes impossible — the stop
     * fires on the dip and you are never in for the recovery. 15% is deliberately close
     * to that edge, so the sweep needs watching once there are labelled rows either side.
     */
    stopLossPct: num('STOP_LOSS_PCT', 15),
    // Exit anything that has not reached the first rung within this many seconds.
    timeStopSeconds: num('TIME_STOP_SECONDS', 600),
    // Give back at most this much of the peak once the first rung is hit.
    trailingDrawdownPct: num('TRAILING_DRAWDOWN_PCT', 50),
    // Abandon-ship if the curve drains — the pump.fun analogue of an LP pull.
    liquidityDropPct: num('LIQUIDITY_DROP_PCT', 60),
    /**
     * How long without a trade before this price counts as stale.
     *
     * It is now a REFRESH trigger, not a sell trigger. See sellOnStalePrice.
     */
    stalePriceSeconds: num('STALE_PRICE_SECONDS', 180),
    /** Go and read the curve from the chain after this much silence. */
    staleRefreshSeconds: num('STALE_REFRESH_SECONDS', 45),
    /**
     * Ceiling on chain reads per sweep, so a large explore book cannot turn a
     * five-second tick into a queue of RPC round trips and push exit management late.
     * Oldest price first; the strategy's positions ahead of the experiment's.
     */
    maxCurveReadsPerSweep: num('MAX_CURVE_READS_PER_SWEEP', 6),
    /**
     * Consecutive FAILED chain reads before a position is dumped for being unpriceable.
     *
     * The genuine can't-price cases are a graduated token whose curve account is gone
     * and an RPC that will not answer — not a token nobody happens to be trading.
     */
    blindExitAfterReads: num('BLIND_EXIT_AFTER_READS', 3),
    /**
     * Sell purely because the price stopped arriving. OFF, and the reasoning that had
     * it on was imported from a market this is not.
     *
     * On a bonding curve the price is vSol/vTokens and those move only on a trade, so
     * silence does not mean the price is unknown — it means the price is exactly what
     * it was. There is no blindness to escape, and the rule was converting "no
     * information" into a guaranteed realized loss. The live log was full of
     * "no price update in 211s — exiting blind" closing positions at -20% or worse.
     *
     * The one real risk it half-covered is our VIEW going stale rather than the price:
     * the RPC log feed drops events when Solana truncates long transaction logs, and a
     * graduated token stops trading on the curve entirely while its price moves on
     * Raydium. The answer to that is to go and read the curve — which the bot can
     * already do — not to sell at the last thing we happened to see.
     *
     * Kept as a switch rather than deleted so the exit sweep can price both against the
     * same coins and say what the old rule cost.
     */
    sellOnStalePrice: bool('SELL_ON_STALE_PRICE', false),
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
