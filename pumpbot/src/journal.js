import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { config } from './config.js'
import { log } from './log.js'
import { wilson } from './stats.js'

/**
 * The learning substrate.
 *
 * The important design choice: we journal EVERY token we evaluated, including the ones
 * we rejected, and then keep watching them. Only logging our own trades teaches you
 * nothing about false negatives — you would never discover that your filter is
 * throwing away the winners. Shadow rows are how the bot learns what it is missing.
 *
 * Storage is append-only JSONL so a crash can never corrupt history, and so the file
 * can be analysed with anything.
 */

/**
 * Journal schema version. Bump this whenever a change makes OLD ROWS UNCOMPARABLE to
 * new ones, so the analyser can drop them instead of averaging them in.
 *
 * v1 -> v2: before the LogFeed `interested` predicate covered shadow rows, a rejected
 * token stopped receiving prices the moment it was screened. Every v1 row therefore has
 * ticks 0, peakMultiple 1.0 and hitFirstRung false — not because those launches went
 * nowhere, but because nobody was watching. Mixed into a v2 dataset they drag the
 * "filter said NO" arm toward 1.0 and make the filter look good for a reason that has
 * nothing to do with the filter.
 */
export const JOURNAL_VERSION = 2

/**
 * A deployer's standing relative to the market, as an ordered scale.
 *
 * `poor` and `proven` are the two ends the Wilson interval can actually justify;
 * `ordinary` means we have a record and it is unremarkable; `unknown` means not enough
 * of a record to say anything, which is most launches and must never be confused with
 * `ordinary`. Kept between the two so the scale stays monotone for a threshold scan.
 */
export const CREATOR_TIER = { poor: 0, unknown: 1, ordinary: 2, proven: 3 }

/**
 * Where the price stood at fixed moments after the decision, in seconds.
 *
 * Eight numbers per row, and they unlock the question the exit sweep could not ask:
 * SHOULD WE HOLD LONGER? Every exit price recorded so far is pinned to the config value
 * in force when the row was written — timeStopMultiple is the price at 600s because the
 * time stop is 600s — so a sweep over the time stop had nothing to read. With a coarse
 * path it can price any of these boundaries against the same coins.
 *
 * Coarse on purpose. A full tick history would multiply the journal's size by a hundred,
 * and the journal is already the binding memory constraint on this bot.
 */
export const PATH_CHECKPOINTS = [30, 60, 120, 180, 300, 450, 600, 900]

let journalPath = null

function file() {
  if (!journalPath) {
    fs.mkdirSync(config.dataDir, { recursive: true })
    journalPath = path.join(config.dataDir, config.paper ? 'journal-paper.jsonl' : 'journal-live.jsonl')
  }
  return journalPath
}

export function append(row) {
  try {
    fs.appendFileSync(file(), JSON.stringify(row) + '\n')
  } catch (err) {
    log.warn(`journal write failed: ${err.message}`)
  }
}

const shadowPath = () =>
  path.join(config.dataDir, config.paper ? 'shadow-paper.json' : 'shadow-live.json')

/**
 * Checkpointed rather than written only on shutdown, because a hosted container is not
 * guaranteed to get a clean shutdown — an OOM kill or a platform restart takes the
 * process without running any handler, and that is exactly when you least want to lose
 * the pending observations.
 */
export function saveShadow(tracker) {
  if (!tracker) return
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const tmp = `${shadowPath()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(tracker.snapshot()))
    fs.renameSync(tmp, shadowPath()) // atomic: a torn write must not destroy the last good copy
  } catch (err) {
    log.warn(`shadow checkpoint failed: ${err.message}`)
  }
}

export function loadShadow() {
  try {
    return JSON.parse(fs.readFileSync(shadowPath(), 'utf8'))
  } catch {
    return null
  }
}

export function clearShadow() {
  try {
    fs.unlinkSync(shadowPath())
  } catch {
    /* already gone */
  }
}

/**
 * Walk the journal one row at a time, never holding the file in memory.
 *
 * The old readAll() did `readFileSync(utf8).split('\n').map(JSON.parse)`, which has
 * THREE full-size copies of the journal live at once: the decoded file as a JS string,
 * the array of per-line substrings, and the parsed objects. On a 73 MB journal that
 * measured at 351 MB RSS — and it OOMs a small container long before the file troubles
 * a 5 GB volume, which is the failure this bot was actually heading for.
 *
 * Reading in fixed chunks means only the chunk, the partial trailing line, and whatever
 * the caller chooses to retain are ever live. A caller that keeps nothing (CreatorIndex)
 * now costs nothing.
 *
 * A truncated or half-written final line is skipped rather than throwing. Appends are
 * single writes of one line, but a process killed mid-append can still leave one.
 */
export function streamRows(onRow) {
  let fd
  try {
    fd = fs.openSync(file(), 'r')
  } catch {
    return 0
  }
  const CHUNK = 1 << 20 // 1 MiB
  const buf = Buffer.allocUnsafe(CHUNK)
  let carry = ''
  let n = 0

  const handle = (line) => {
    if (!line) return
    try {
      const row = JSON.parse(line)
      if (row) {
        onRow(row)
        n++
      }
    } catch {
      /* a corrupt line is skipped, not fatal — the rest of the journal is still good */
    }
  }

  /**
   * StringDecoder, not buf.toString('utf8'), and the difference is not cosmetic: a 1 MiB
   * boundary lands mid-character sooner or later, and toString() would emit U+FFFD for
   * the split bytes. Token names on pump.fun are full of emoji, so that is a JSON.parse
   * failure on a row whose only crime was where it sat in the file — a silently dropped
   * row, which is the kind of corruption this journal exists to avoid.
   */
  const decoder = new StringDecoder('utf8')

  try {
    for (;;) {
      const read = fs.readSync(fd, buf, 0, CHUNK, null)
      if (read <= 0) break
      const text = carry + decoder.write(buf.subarray(0, read))
      let start = 0
      for (;;) {
        const nl = text.indexOf('\n', start)
        if (nl === -1) break
        handle(text.slice(start, nl))
        start = nl + 1
      }
      carry = text.slice(start)
    }
    handle(carry + decoder.end())
  } finally {
    fs.closeSync(fd)
  }
  return n
}

/**
 * Every row, materialised. Same contract as before; the peak cost is now the rows
 * themselves rather than the rows plus two copies of the file.
 *
 * Prefer streamRows() or readRecent() where the whole history is not needed at once.
 */
export function readAll() {
  const rows = []
  streamRows((r) => rows.push(r))
  return rows
}

/**
 * The most recent `cap` rows, via a ring buffer, so a journal far larger than the
 * analysis window costs the window rather than the journal. Order is preserved.
 *
 * `total` is the true row count on disk, which the caller cannot recover from `rows`
 * once they have been capped — the dashboard reports it as "rows on disk in total" and
 * the report uses it to say how many were left out. Returning only the rows would make
 * the page quietly understate the dataset the moment the cap started biting.
 */
export function readRecent(cap) {
  if (!(cap > 0)) return { rows: [], total: 0 }
  const ring = new Array(cap)
  let n = 0
  streamRows((r) => {
    ring[n % cap] = r
    n++
  })
  if (n <= cap) return { rows: ring.slice(0, n), total: n }
  const start = n % cap
  return { rows: ring.slice(start).concat(ring.slice(0, start)), total: n }
}

/**
 * What a deployer's previous launches did — the single strongest signal we were already
 * collecting and never using.
 *
 * LEAKAGE IS THE WHOLE DIFFICULTY. A creator's hit rate computed over a set that includes
 * the launch being scored would let the scan "discover" that creators whose launches hit
 * tend to hit, which is circular and would look like a very strong edge. So this index is
 * only ever updated when a row FINALIZES, and only ever read when a row is TRACKED —
 * which happens strictly earlier. A launch can therefore only see outcomes that were
 * already known before it existed.
 */
export class CreatorIndex {
  constructor() {
    this.byCreator = new Map() // creator -> { launches, hits }
    // Invalidated by note(), so summary() rescans only when the data actually moved.
    // The dashboard polls every few seconds and finalize fires a few times a minute;
    // without this the page would walk the whole map on every poll for a number that
    // cannot have changed.
    this.summaryCache = null
  }

  /**
   * Rebuild from history at startup, so restarts do not lose the prior.
   *
   * Streamed, and the sort is gone. Both were costing real memory for nothing: the old
   * version materialised all 141k rows and then `[...rows]` copied the array again, at
   * startup, purely to order rows for a loop that is order-INDEPENDENT — note() only
   * increments two counters. The journal is appended at finalize time, so it is already
   * in finalization order anyway.
   *
   * What this index keeps is one small entry per DEPLOYER, not per launch: 141,090
   * launches collapse to ~34,000 counters. Streaming means the rows themselves are
   * garbage the moment they are counted.
   */
  static fromJournal(rows = null) {
    const idx = new CreatorIndex()
    if (rows) {
      for (const r of rows) idx.note(r)
    } else {
      streamRows((r) => idx.note(r))
    }
    return idx
  }

  note(row) {
    if (!row?.creator || typeof row.hitFirstRung !== 'boolean') return
    const e = this.byCreator.get(row.creator) ?? { launches: 0, hits: 0 }
    e.launches++
    if (row.hitFirstRung) e.hits++
    this.byCreator.set(row.creator, e)
    this.summaryCache = null
  }

  /**
   * What this index can currently DO, as opposed to how big it is.
   *
   * `launches` says how much history survived the last restart; `eligible` says how many
   * deployers have enough of a record to be judged at all; `blocked` says how many the
   * rule would actually refuse right now. All three matter because they fail separately:
   * a wiped journal gives launches 0, a young journal gives eligible 0, and a filter
   * that is simply not finding bad deployers gives blocked 0. Those are three very
   * different situations that all look identical from "the prior is enabled".
   */
  summary({ minLaunches = 20 } = {}) {
    if (this.summaryCache?.minLaunches === minLaunches) return this.summaryCache
    const base = this.baseRate()
    let launches = 0
    let eligible = 0
    let blocked = 0
    let proven = 0
    for (const [creator, e] of this.byCreator) {
      launches += e.launches
      if (e.launches < minLaunches) continue
      eligible++
      const v = this.verdict(creator, { minLaunches })
      if (v.worseThanMarket) blocked++
      else if (v.betterThanMarket) proven++
    }
    this.summaryCache = {
      minLaunches,
      creators: this.byCreator.size,
      launches,
      eligible,
      blocked,
      proven,
      baseRate: base,
    }
    return this.summaryCache
  }

  priorFor(creator) {
    const e = creator ? this.byCreator.get(creator) : null
    if (!e || e.launches === 0) return { launches: 0, hitRate: -1 }
    return { launches: e.launches, hitRate: e.hits / e.launches }
  }

  /** How often ANY launch we have labelled reached the first rung. The yardstick. */
  baseRate() {
    let launches = 0
    let hits = 0
    for (const e of this.byCreator.values()) {
      launches += e.launches
      hits += e.hits
    }
    return launches > 0 ? hits / launches : null
  }

  /**
   * Is this deployer demonstrably worse than the market?
   *
   * Judged on the UPPER bound of their hit rate, not the point estimate, because the
   * question is "could this plausibly be an ordinary deployer having a bad run?" Zero
   * winners in two launches is nothing — the upper bound is 66%. Zero in a hundred is a
   * different claim entirely: the upper bound is 3.7%, well under a ~10% base rate. The
   * interval is what separates those; a point estimate calls both of them 0%.
   *
   * Deliberately one-sided. A deployer nobody has seen is NOT refused — first-time
   * deployers are most launches and most winners, so requiring a track record would
   * reject the market. This only removes the ones that have earned it.
   */
  verdict(creator, { minLaunches = 20 } = {}) {
    const e = creator ? this.byCreator.get(creator) : null
    const base = this.baseRate()
    if (!e || e.launches < minLaunches || base === null) {
      return { known: false, launches: e?.launches ?? 0, hits: e?.hits ?? 0, worseThanMarket: false, base }
    }
    const w = wilson(e.hits, e.launches)
    return {
      known: true,
      launches: e.launches,
      hits: e.hits,
      hitRate: e.hits / e.launches,
      upperBound: w.hi,
      lowerBound: w.lo,
      // Even the most generous reading of their record is below the market's.
      worseThanMarket: w.hi < base,
      /**
       * The mirror image, and the one we were not asking for. The same index that knows
       * a deployer is 0-for-120 knows another is 29-for-126, and the data says launches
       * from proven deployers hit at roughly four times the base rate — an axis entirely
       * independent of what the crowd did in the last thirty seconds, which is where a
       * second signal is actually worth something.
       *
       * Judged on the LOWER bound for the same reason the block is judged on the upper:
       * "2 for 2" is not a track record.
       */
      betterThanMarket: w.lo > base,
      base,
    }
  }

  /**
   * The verdict collapsed to one ordered number, so it can be journalled and scanned.
   *
   * Ordinal rather than categorical on purpose — the threshold scan works on numbers,
   * and "higher is better" is the whole claim being tested.
   */
  tier(creator, opts = {}) {
    const v = this.verdict(creator, opts)
    if (!v.known) return CREATOR_TIER.unknown
    if (v.worseThanMarket) return CREATOR_TIER.poor
    if (v.betterThanMarket) return CREATOR_TIER.proven
    return CREATOR_TIER.ordinary
  }
}

/** The feature vector we score a launch on. Keep this stable — it is the dataset schema. */
export function featuresOf(candidate, creatorIndex = null, walletIndex = null) {
  /**
   * What this launch's early buyers have done before. Read HERE, at track time, from
   * outcomes that finalized earlier — the same discipline the deployer prior uses, and
   * the reason neither can see its own result.
   */
  const buyers = walletIndex ? walletIndex.scoreBuyers([...(candidate.buyers ?? [])]) : null
  return {
    smartBuyers: buyers?.smartBuyers ?? 0,
    knownBuyers: buyers?.knownBuyers ?? 0,
    smartBuyerShare: buyers ? round4(buyers.smartBuyerShare) : 0,
    organicBuyers: candidate.organicBuyers,
    buys: candidate.buys,
    sells: candidate.sells,
    buySellRatio: candidate.sells > 0 ? candidate.buys / candidate.sells : candidate.buys,
    buyVolumeSol: Number(candidate.buyVolumeSol?.toFixed?.(4) ?? candidate.buyVolumeSol),
    sellVolumeSol: Number(candidate.sellVolumeSol?.toFixed?.(4) ?? candidate.sellVolumeSol),
    netVolumeSol: Number((candidate.buyVolumeSol - candidate.sellVolumeSol).toFixed(4)),
    marketCapSol: candidate.marketCapSol,
    peakMarketCapSol: candidate.peakMarketCapSol,
    devHoldPct: Number(candidate.devHoldPct?.toFixed?.(2) ?? candidate.devHoldPct),
    devBuySol: candidate.devBuySol,
    devSold: candidate.devSold,
    symbolLength: (candidate.symbol ?? '').length,
    nameLength: (candidate.name ?? '').length,
    /**
     * The shape of the buying, not just its size. Buyer count and volume cannot tell
     * fifty wallets apart from one whale buying fifty times, or a launch that is
     * accelerating apart from one already fading. Whether any of this predicts anything
     * is the scan's job; recording it is the precondition for asking.
     */
    topBuyerShare: round4(candidate.topBuyerShare),
    top3BuyerShare: round4(candidate.top3BuyerShare),
    buysPerBuyer: round4(candidate.buysPerBuyer),
    buyAcceleration: round4(candidate.buyAcceleration),
    flipRate: round4(candidate.flipRate),
    secondsToFirstBuy: round4(candidate.secondsToFirstBuy),
    // Regime. Meme flow is not uniform across the day, and this is free to record.
    launchHourUtc: new Date(candidate.createdAt ?? Date.now()).getUTCHours(),
    /**
     * This deployer's record BEFORE this launch. -1 means never seen, which is most of
     * them — kept distinct from 0 (seen, never hit) because "unknown" and "known bad"
     * are different things and a threshold on them should be able to say so.
     */
    creatorLaunchesSeen: creatorIndex ? creatorIndex.priorFor(candidate.creator).launches : 0,
    creatorPriorHitRate: creatorIndex ? round4(creatorIndex.priorFor(candidate.creator).hitRate) : -1,
    /**
     * The same record as a statistical verdict rather than a raw rate.
     *
     * creatorPriorHitRate alone cannot tell 1-for-2 from 60-for-120: both read 0.5, and
     * a scan on that column happily "discovers" an edge built out of two coin flips.
     * This applies the interval first, so a cut on it means what it appears to mean.
     * Recorded at TRACK time from outcomes already finalized, so it carries no leakage.
     */
    creatorTier: creatorIndex
      ? creatorIndex.tier(candidate.creator, { minLaunches: config.entry.minCreatorLaunches })
      : CREATOR_TIER.unknown,
    observeSeconds: config.entry.observeSeconds,
  }
}

const round4 = (v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : undefined)

/**
 * Tracks what happened to a token after we made a call on it, so the row can be
 * labelled. Held in memory; flushed to the journal when the window closes.
 */
/**
 * Bring a checkpointed row up to the shape the current code expects.
 *
 * The shadow checkpoint is LIVE IN-MEMORY STATE, not a journal row, and the two
 * degrade differently. A journal row missing a field is just a row the analysis skips;
 * a checkpointed row missing a field is a crash, because the tracker goes on to call
 * methods on it. Adding pathPrices did exactly that: 264 observations restored from a
 * checkpoint written by the previous build, the first one to mature hit
 * `row.pathPrices.map(...)` on undefined, and the bot died on startup with the platform
 * still reporting a healthy container.
 *
 * So every field track() seeds gets a default here. Restoring is deliberately preferred
 * over discarding the checkpoint: those observations are hours of watching that cannot
 * be recreated, and throwing them away to dodge a migration would lose real evidence.
 */
function hydrate(row) {
  const at = row.decidedAt ?? Date.now()
  return {
    ticks: 0,
    ...row,
    peakAt: row.peakAt ?? at,
    troughAt: row.troughAt ?? at,
    lastTickAt: row.lastTickAt ?? at,
    firstRungAt: row.firstRungAt ?? null,
    staleExitAt: row.staleExitAt ?? null,
    staleExitPriceSol: row.staleExitPriceSol ?? null,
    timeStopPriceSol: row.timeStopPriceSol ?? null,
    pathPrices: Array.isArray(row.pathPrices) && row.pathPrices.length === PATH_CHECKPOINTS.length
      ? row.pathPrices
      : PATH_CHECKPOINTS.map(() => null),
    // A checkpoint from before the wallet prior has no buyer list; those rows simply
    // credit nothing when they mature, which is correct — we did not record who bought.
    buyers: Array.isArray(row.buyers) ? row.buyers : [],
  }
}

export class ShadowTracker {
  constructor({
    windowMs = config.learning.outcomeWindowMinutes * 60_000,
    max = config.learning.maxShadowTracked,
    creatorIndex = null,
    walletIndex = null,
  } = {}) {
    this.walletIndex = walletIndex
    this.windowMs = windowMs
    this.max = max
    this.rows = new Map() // mint -> pending row
    this.creatorIndex = creatorIndex
  }

  track({ candidate, verdict, action, entryPriceSol, blockedBy = null }) {
    if (this.rows.size >= this.max) {
      /**
       * Drop the oldest rather than refuse — recent data is more representative.
       *
       * A Map iterates in insertion order and decidedAt is stamped at insertion, so the
       * first key IS the oldest. The previous version copied and sorted the entire Map
       * on every insert, which at a 1500-row cap and ~30 launches a minute is tens of
       * thousands of comparisons per launch on the same thread that decodes the feed.
       */
      const oldest = this.rows.keys().next().value
      if (oldest !== undefined) this.finalize(oldest, 'evicted')
    }

    /**
     * EVERY row is labelled against the same yardstick: the mid price off the curve.
     *
     * Rows we traded used to be based on the FILL price, which bakes in the trade fee,
     * half the slippage tolerance and the priority fee — about 9% above mid on a 0.075
     * SOL buy. Rejected rows used mid. So on an identical price path, a bought row had
     * to reach +63% to be scored a winner while a rejected row only needed +50%, and
     * the headline "did the filter pick better?" comparison was rigged against the
     * filter by a constant margin. Worse, 'explored' rows count in the rejected arm, so
     * that arm mixed both bases.
     *
     * The fill price is still recorded — as its own field, for P&L — but it is not what
     * the outcome label is measured from.
     */
    const price = candidate.priceSol ?? entryPriceSol
    this.rows.set(candidate.mint, {
      v: JOURNAL_VERSION,
      mint: candidate.mint,
      symbol: candidate.symbol,
      creator: candidate.creator,
      decidedAt: Date.now(),
      createdAt: candidate.createdAt,
      action, // 'bought' | 'explored' | 'rejected' | 'blocked'
      // Why the capital gate refused a launch the FILTER approved. Present only for
      // action 'blocked', which belongs to neither arm of the comparison.
      blockedBy,
      // What we actually paid, kept apart from the yardstick above.
      fillPriceSol: entryPriceSol ?? null,
      rejectedFor: verdict?.pass ? null : verdict?.failed?.map((c) => c.id) ?? null,
      features: featuresOf(candidate, this.creatorIndex, this.walletIndex),
      decisionPriceSol: price,
      peakPriceSol: price,
      troughPriceSol: price,
      lastPriceSol: price,
      // Seeded to the decision moment so ordering is defined even with zero ticks.
      peakAt: Date.now(),
      troughAt: Date.now(),
      /**
       * Everything a replay needs to apply the LIVE exit rules rather than an idealised
       * version of them. See onTrade for why each one is necessary.
       */
      firstRungAt: null, // first crossing of the rung, which is not when the peak happened
      lastTickAt: Date.now(), // gap detection for the stale-price exit
      staleExitAt: null, // when the feed first went quiet for longer than the rule allows
      staleExitPriceSol: null, // the price the bot would have sold blind at
      timeStopPriceSol: null, // the price at the time-stop boundary
      // Price held at each PATH_CHECKPOINTS moment; null until that moment passes.
      pathPrices: PATH_CHECKPOINTS.map(() => null),
      /**
       * The wallets that bought inside the observation window, kept IN MEMORY ONLY so
       * the wallet index can be credited when this row's outcome is known. Sixty
       * addresses at 44 characters would add ~2.6 KB to every journalled row and roughly
       * triple a file that is already the memory ceiling, so it is dropped at append.
       */
      buyers: config.learning.walletPrior ? [...(candidate.buyers ?? [])] : [],
      ticks: 0,
    })
  }

  onTrade(event, now = Date.now()) {
    const row = this.rows.get(event.mint)
    if (!row || !(event.priceSol > 0)) return

    /**
     * Checked BEFORE lastPriceSol is overwritten, because the price that matters for
     * both of these is the one the bot was holding at the moment the rule fired — not
     * the price on the tick that happens to end the silence.
     */
    const heldPrice = row.lastPriceSol
    const staleMs = config.exit.stalePriceSeconds * 1000
    if (row.staleExitAt === null && now - row.lastTickAt >= staleMs) {
      // The feed went quiet long enough that the live bot would have exited blind.
      row.staleExitAt = row.lastTickAt + staleMs
      row.staleExitPriceSol = heldPrice
    }
    const timeStopMs = config.exit.timeStopSeconds * 1000
    if (row.timeStopPriceSol === null && now - row.decidedAt >= timeStopMs) {
      row.timeStopPriceSol = heldPrice
    }
    // Same rule for every checkpoint the clock has passed: the price we were HOLDING
    // when that moment arrived, not the one on the tick that happens to notice it.
    const elapsed = (now - row.decidedAt) / 1000
    for (let i = 0; i < PATH_CHECKPOINTS.length; i++) {
      if (row.pathPrices[i] === null && elapsed >= PATH_CHECKPOINTS[i]) row.pathPrices[i] = heldPrice
    }
    row.lastTickAt = now

    row.ticks++
    row.lastPriceSol = event.priceSol

    /**
     * WHEN THE RUNG FIRST FIRED, which is emphatically not when the peak happened.
     *
     * A coin can cross +50% at two minutes and top out at twelve. Gating the replay on
     * peakAt would throw that trade away as "unreachable" when the bot had in fact
     * already sold it at the rung, for a profit. The two questions are different and
     * only this one decides whether the ladder ran.
     */
    if (row.firstRungAt === null && row.decisionPriceSol > 0) {
      const target = 1 + (config.exit.ladder[0]?.atPct ?? 50) / 100
      if (event.priceSol / row.decisionPriceSol >= target) row.firstRungAt = now
    }
    /**
     * WHEN the peak and trough happened, not just their values.
     *
     * Without the ordering, a replay of the exit rules cannot tell a coin that dipped
     * and then recovered from one that spiked and then died — they have identical
     * peak/trough/end. The simulator resolves that ambiguity in the strategy's favour,
     * so the stop-loss can never knock it out of an eventual winner, and tighter stops
     * come out looking free. Two timestamps remove the guess.
     */
    if (event.priceSol > row.peakPriceSol) {
      row.peakPriceSol = event.priceSol
      row.peakAt = now
    }
    if (event.priceSol < row.troughPriceSol) {
      row.troughPriceSol = event.priceSol
      row.troughAt = now
    }
  }

  /** Mints whose observation window has elapsed. */
  due(now = Date.now()) {
    const out = []
    for (const [mint, row] of this.rows) {
      if (now - row.decidedAt >= this.windowMs) out.push(mint)
    }
    return out
  }

  finalize(mint, reason = 'window closed') {
    const row = this.rows.get(mint)
    if (!row) return null
    this.rows.delete(mint)

    const base = row.decisionPriceSol
    if (!(base > 0)) return null

    const peakMultiple = row.peakPriceSol / base
    const endMultiple = row.lastPriceSol / base
    const firstRung = config.exit.ladder[0]?.atPct ?? 50

    const observedSeconds = Math.round((Date.now() - row.decidedAt) / 1000)

    const finished = {
      ...row,
      finalizedAt: Date.now(),
      finalizeReason: reason,
      /**
       * How long this row was ACTUALLY watched. A row evicted early was labelled on a
       * shorter window than the report claims, which biases peakMultiple down. Recording
       * it means the analyser can say so instead of averaging truncated rows in silently.
       */
      observedSeconds,
      windowTruncated: observedSeconds < Math.round(this.windowMs / 1000) * 0.9,
      peakMultiple: Number(peakMultiple.toFixed(4)),
      endMultiple: Number(endMultiple.toFixed(4)),
      troughMultiple: Number((row.troughPriceSol / base).toFixed(4)),
      maxDrawdownPct: Number((((row.peakPriceSol - row.troughPriceSol) / row.peakPriceSol) * 100).toFixed(1)),
      // The label everything else is measured against: would this have paid the first rung?
      hitFirstRung: peakMultiple >= 1 + firstRung / 100,
      firstRungPct: firstRung,
      /**
       * WHEN the extremes happened, in seconds from the decision.
       *
       * The observation window is 15 minutes; the bot's time stop is 10, and its
       * stale-price rule exits after 3 minutes of silence. So a launch that peaks at
       * minute twelve is labelled a hit here and is a position the strategy had already
       * closed. Without these, a replay cannot tell that apart from a peak at minute
       * two, and it credits the strategy with runs it was never present for.
       */
      peakAtSeconds: Math.max(0, Math.round((row.peakAt - row.decidedAt) / 1000)),
      troughAtSeconds: Math.max(0, Math.round((row.troughAt - row.decidedAt) / 1000)),
      /**
       * The live exit rules, made replayable. `firstRungAtSeconds` is null when the rung
       * was never touched; the two stale fields are null when the feed never went quiet
       * for long enough. Presence of this field is what tells the replay it may apply
       * the real rules — rows written before it exists keep the idealised behaviour, and
       * the report states the coverage rather than mixing the two silently.
       */
      firstRungAtSeconds:
        row.firstRungAt === null ? null : Math.max(0, Math.round((row.firstRungAt - row.decidedAt) / 1000)),
      staleExitAtSeconds:
        row.staleExitAt === null ? null : Math.max(0, Math.round((row.staleExitAt - row.decidedAt) / 1000)),
      staleExitMultiple:
        row.staleExitPriceSol > 0 ? Number((row.staleExitPriceSol / base).toFixed(4)) : null,
      /**
       * Where the position stood when the time stop came due. Filled at finalize when no
       * tick arrived after the boundary — a coin that simply stopped trading never
       * produces one, and the bot would have sold at the last price it had.
       */
      timeStopMultiple:
        (row.timeStopPriceSol ?? (observedSeconds >= config.exit.timeStopSeconds ? row.lastPriceSol : null)) > 0
          ? Number(
              ((row.timeStopPriceSol ?? row.lastPriceSol) / base).toFixed(4),
            )
          : null,
      hasExitTiming: true,
      /**
       * The coarse price path, as multiples. A checkpoint the row never reached — the
       * window closed first, or the coin stopped trading — stays null rather than being
       * filled with the last price, so a replay can tell "flat" from "we were not there".
       */
      pathCheckpoints: PATH_CHECKPOINTS,
      // A slot is non-null only because onTrade saw that moment pass, so no second
      // check against the wall clock — which is a DIFFERENT clock from the one the
      // ticks carry, and disagreeing with it nulled the whole path.
      // Defensive as well as hydrated on restore: finalize() is reached from several
      // paths and a missing field here kills the process, not just the row.
      pathMultiples: (row.pathPrices ?? PATH_CHECKPOINTS.map(() => null)).map((p) =>
        p > 0 ? Number((p / base).toFixed(4)) : null,
      ),
      // The raw prices were working state; the multiples are the record. Keeping both
      // would grow every row for nothing, and the journal is the memory ceiling here.
      pathPrices: undefined,
      // Likewise the buyer list: it exists to credit the wallet index, and the derived
      // counts are already in `features`. Journalling it would triple the file.
      buyers: undefined,
      /**
       * The same label, restricted to what the live exit rules could actually have
       * captured. Kept ALONGSIDE hitFirstRung rather than replacing it: 150,000 existing
       * rows carry the old label, and silently redefining it would make every historical
       * rate incomparable to every new one. Reporting both is how we find out how large
       * the difference is.
       */
      hitFirstRungInTime:
        peakMultiple >= 1 + firstRung / 100 &&
        row.peakAt - row.decidedAt <= config.exit.timeStopSeconds * 1000,
      wentToZero: endMultiple <= 0.1,
      /**
       * Did the low come before the high? This is what lets a replay decide whether a
       * stop-loss would have fired BEFORE the coin ran — without it the simulator has
       * to guess, and it guesses in the strategy's favour.
       */
      troughFirst: row.troughAt < row.peakAt,
      hasOrdering: Number.isFinite(row.troughAt) && Number.isFinite(row.peakAt) && row.ticks > 0,
    }

    append(finished)
    // Only now does this outcome become visible to future launches. Updating any earlier
    // would let a launch see its own result through its creator's prior.
    this.creatorIndex?.note(finished)
    /**
     * Same moment, same reason, for the buyers. Credited from `row` rather than
     * `finished` because the buyer list is deliberately stripped before the row is
     * appended — the index is built from what we saw, not from what we store.
     */
    if (this.walletIndex && Array.isArray(row.buyers)) {
      for (const w of row.buyers) this.walletIndex.note(w, finished.hitFirstRung, finished.finalizedAt)
      this.walletIndex.prune()
    }
    return finished
  }

  finalizeAllDue() {
    const out = []
    for (const mint of this.due()) {
      const row = this.finalize(mint)
      if (row) out.push(row)
    }
    return out
  }

  has(mint) {
    return this.rows.has(mint)
  }

  get size() {
    return this.rows.size
  }

  /**
   * In-flight rows, persisted across restarts.
   *
   * Without this, every row still inside its outcome window is discarded whenever the
   * process stops — and on a hosted platform it stops often. At ~30 launches a minute
   * against a 15-minute window there are ~450 rows in flight at any moment, so a restart
   * every half hour throws away half the dataset and a restart every fifteen minutes
   * throws away all of it.
   *
   * The loss is also BIASED, which is worse than its size: rows are only ever discarded
   * around a restart, and restarts cluster around deploys. A dataset that systematically
   * omits whatever was launching while you were shipping changes is not a random sample
   * of the market.
   */
  snapshot() {
    return { v: JOURNAL_VERSION, savedAt: Date.now(), rows: [...this.rows.values()] }
  }

  /**
   * Returns rows whose window elapsed while the process was down — the caller finalizes
   * them. They are labelled on the prices seen before the gap, which is honest: the row
   * carries observedSeconds and windowTruncated, so a shortened observation cannot pass
   * itself off as a full one.
   */
  restore(snapshot, now = Date.now()) {
    if (!snapshot || (snapshot.v ?? 1) < JOURNAL_VERSION) return { restored: 0, expired: [] }
    const expired = []
    let restored = 0
    for (const row of snapshot.rows ?? []) {
      if (!row?.mint || !(row.decidedAt > 0)) continue
      // Oldest first, so the Map's insertion order still means "oldest" for eviction.
      this.rows.set(row.mint, hydrate(row))
      restored++
    }
    // Sorting after the fact is cheap here (once per process) and keeps eviction O(1).
    const ordered = [...this.rows.entries()].sort((a, b) => a[1].decidedAt - b[1].decidedAt)
    this.rows = new Map(ordered)
    for (const [mint, row] of this.rows) {
      if (now - row.decidedAt >= this.windowMs) expired.push(mint)
    }
    return { restored, expired }
  }
}
