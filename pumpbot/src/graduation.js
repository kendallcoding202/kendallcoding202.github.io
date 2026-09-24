import fs from 'node:fs'
import path from 'node:path'
import { config, PUMP_TOTAL_SUPPLY, PUMP_INITIAL_VIRTUAL_SOL } from './config.js'
import { log } from './log.js'

/**
 * Minutes past graduation at which a price is recorded.
 *
 * Deliberately reaching 24h. Every horizon this project has measured so far tops out at
 * 900 SECONDS, and on that scale returns decay monotonically from the moment of entry.
 * The whole reason to look at graduated tokens is that their moves may finally be larger
 * than the ~5.6pp round trip; a window that stops at 15 minutes could not show that even
 * if it were true.
 */
export const GRAD_CHECKPOINTS = [1, 5, 15, 30, 60, 120, 240, 480, 1440]

/**
 * IS THIS PRICE ACTUALLY A POST-GRADUATION PRICE?
 *
 * A curve completes at a known state, so the price at graduation is predictable within a
 * band: a mint is 1e9 tokens, virtual SOL starts at 30 and a completing curve sits near
 * 115, so the implied market cap at the first post-graduation trade should be on the
 * order of a hundred SOL. A base price implying ~30 SOL is a LAUNCH price -- a stale tick
 * that arrived before the migration, which would make every multiple measured from it
 * garbage in the same way the deflated mayhem denominator did.
 *
 * This is the check the on-curve side never had. The 46x and 228x fantasies survived for
 * weeks because nothing ever asked whether a recorded price was physically reachable, and
 * that single omission is why the measured edge collapsed when it was finally asked.
 *
 * It classifies rather than rejects: the row is kept either way, because how often the
 * instrument catches the wrong tick is itself a measurement.
 */
const PUMP_INITIAL_VIRTUAL_TOKENS = 1.073e9
/** Virtual SOL a curve holds when it completes: the 30 offset plus ~85 real. */
const COMPLETION_VIRTUAL_SOL = 115

/**
 * Implied market cap at a completing curve, derived rather than guessed.
 *
 * price = vSol/vTokens and the curve is constant product, so at completion vTokens has
 * fallen to k/115 -- about 280M, NOT the 1e9 supply. Multiplying a completion price by
 * total supply therefore gives ~411 SOL, not 115. Getting this wrong by that factor is
 * exactly how a launch-era tick would have been waved through as plausible: a first
 * attempt at this check used 80 as the floor, which accepts a mid-curve price of 90.
 */
const COMPLETION_MCAP_SOL =
  (COMPLETION_VIRTUAL_SOL /
    ((PUMP_INITIAL_VIRTUAL_SOL * PUMP_INITIAL_VIRTUAL_TOKENS) / COMPLETION_VIRTUAL_SOL)) *
  PUMP_TOTAL_SUPPLY

export function baseSanity(basePriceSol) {
  if (!(basePriceSol > 0)) return { ok: false, impliedMcapSol: null, verdict: 'no price' }
  const impliedMcapSol = basePriceSol * PUMP_TOTAL_SUPPLY
  // Half the completion level cannot be a token that just completed its curve.
  if (impliedMcapSol < COMPLETION_MCAP_SOL / 2) {
    return {
      ok: false,
      impliedMcapSol,
      verdict: impliedMcapSol < PUMP_INITIAL_VIRTUAL_SOL * 2 ? 'launch-era tick' : 'pre-graduation tick',
    }
  }
  // Twelve times completion on the FIRST trade after migrating is a bad read, not a run.
  if (impliedMcapSol > COMPLETION_MCAP_SOL * 12) {
    return { ok: false, impliedMcapSol, verdict: 'implausibly high' }
  }
  return { ok: true, impliedMcapSol, verdict: 'plausible' }
}

const gradFile = () => path.join(config.dataDir, 'graduations.jsonl')

/**
 * A SEPARATE FILE, not a row type in the journal.
 *
 * Every analysis in this project reads the journal and assumes one row is one launch
 * decision. A graduation row is a different unit with a different clock, and one stray
 * `kind` check away from being averaged into a figure it has no business in. The launch
 * dataset is the only asset here that took months to build -- it does not get mixed with
 * an experiment on its first day.
 */
export function appendGraduation(row) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.appendFileSync(gradFile(), JSON.stringify(row) + '\n')
    return true
  } catch (err) {
    log.warn(`graduation write failed: ${err.message}`)
    return false
  }
}

/**
 * Observes what a token does AFTER its curve completes. Observation only -- it never
 * trades, exactly like the shadow tracker it is modelled on.
 */
export class GraduationTracker {
  constructor({ max = config.graduation.maxTracked, checkpoints = GRAD_CHECKPOINTS } = {}) {
    this.max = max
    this.checkpoints = checkpoints
    this.rows = new Map()
    this.completed = 0
    this.expired = 0
  }

  get size() {
    return this.rows.size
  }

  /** The mints being watched, so the feed can subscribe to exactly these. */
  mints() {
    return [...this.rows.keys()]
  }

  open({ mint, symbol = null, at = Date.now(), pool = null, marketCapSol = null, features = null }) {
    if (!mint || this.rows.has(mint)) return null
    if (this.rows.size >= this.max) {
      const oldest = this.rows.keys().next().value
      if (oldest !== undefined) this.finalize(oldest, 'evicted')
    }
    const row = {
      mint,
      symbol,
      graduatedAt: at,
      pool,
      marketCapAtGraduation: marketCapSol,
      features,
      /**
       * The denominator. Unknown until the first trade after graduation: the migrate
       * payload carries no reserves, so there is nothing to price against at the instant
       * it arrives. Every multiple is measured from this, and a row without it is never
       * journalled -- a deflated or missing denominator is exactly what produced the 46x
       * and 228x fantasies on the curve side.
       */
      basePriceSol: null,
      basePriceAt: null,
      lastPriceSol: null,
      lastTradeAt: null,
      trades: 0,
      mult: this.checkpoints.map(() => null),
    }
    this.rows.set(mint, row)
    return row
  }

  /** A trade tick for a tracked mint. */
  note(mint, priceSol, now = Date.now()) {
    const row = this.rows.get(mint)
    if (!row || !(priceSol > 0)) return
    if (row.basePriceSol === null) {
      row.basePriceSol = priceSol
      row.basePriceAt = now
    }
    row.lastPriceSol = priceSol
    row.lastTradeAt = now
    row.trades++
    this.#fill(row, now)
  }

  /**
   * Fill any checkpoint whose moment has passed, carrying the last known price.
   *
   * Carrying forward is the honest choice for a token that stops trading: its last price
   * is what you could mark it at, and leaving the cell null would silently drop exactly
   * the tokens that died -- the survivorship trap the pre-registration names. `trades`
   * and `lastTradeAt` travel with the row so a dead quote can be told from a live one.
   */
  #fill(row, now) {
    if (row.basePriceAt === null || !(row.lastPriceSol > 0)) return
    for (let i = 0; i < this.checkpoints.length; i++) {
      if (row.mult[i] !== null) continue
      if (now - row.graduatedAt >= this.checkpoints[i] * 60_000) {
        row.mult[i] = Number((row.lastPriceSol / row.basePriceSol).toFixed(6))
      }
    }
  }

  /**
   * Rows whose next checkpoint has passed and that still need a price for it.
   *
   * Nine samples over 24h is what this experiment needs. Holding a per-token TRADE
   * subscription to get them was the wrong shape entirely: subscriptions are capped at
   * 60 and shared with the launch strategy, and PumpPortal meters the feed, so 400
   * tracked mints meant at most 60 could ever be priced -- 47.8% of the first 268 rows
   * had no price at all -- while the rest silently starved the strategy's own slots.
   *
   * Asking for a price only when a checkpoint is actually due costs nine reads per token
   * instead of a day of every trade, and scales past the cap rather than fighting it.
   */
  dueForPrice(now = Date.now()) {
    const out = []
    for (const row of this.rows.values()) {
      const age = now - row.graduatedAt
      const due = this.checkpoints.some((m, i) => row.mult[i] === null && age >= m * 60_000)
      // Base price first: without it there is no denominator and no multiple to record.
      if (due || row.basePriceSol === null) out.push(row)
    }
    return out
  }

  /** Advance every row's clock; finalize the ones that have run their full window. */
  sweep(now = Date.now()) {
    const done = []
    for (const [mint, row] of this.rows) {
      this.#fill(row, now)
      if (now - row.graduatedAt >= this.checkpoints.at(-1) * 60_000) done.push(mint)
    }
    for (const mint of done) this.finalize(mint, 'complete')
    return done
  }

  finalize(mint, reason = 'complete') {
    const row = this.rows.get(mint)
    if (!row) return null
    this.rows.delete(mint)
    // A row that never saw a trade has no denominator, so it has no multiple to report.
    // Journalled anyway, with its reason: how often a graduated token simply stops
    // trading IS one of the outcomes this experiment is measuring.
    const out = {
      v: 1,
      mint: row.mint,
      symbol: row.symbol,
      graduatedAt: row.graduatedAt,
      pool: row.pool,
      marketCapAtGraduation: row.marketCapAtGraduation,
      basePriceSol: row.basePriceSol,
      /** Whether that price could belong to a completed curve at all. See baseSanity. */
      baseSanity: baseSanity(row.basePriceSol),
      trades: row.trades,
      lastTradeAt: row.lastTradeAt,
      quoteWentQuiet: row.lastTradeAt === null || Date.now() - row.lastTradeAt > 3_600_000,
      reason,
      checkpoints: this.checkpoints,
      mult: row.mult,
      features: row.features,
      finalizedAt: Date.now(),
    }
    if (reason === 'complete') this.completed++
    else this.expired++
    appendGraduation(out)
    return out
  }

  /**
   * In-flight rows, in the same shape a journalled one has.
   *
   * A row is only written when its full 24h window expires, so for the first day the
   * file is empty and any count taken from it reads zero -- including "complete to
   * 240m", which is the pre-registered decision horizon and is FOUR hours, not
   * twenty-four. The data exists in memory long before it lands on disk; not counting it
   * made the progress bar sit at zero while the experiment was working perfectly.
   *
   * Finalising at 240m instead would be the wrong fix: it would throw away the 480m and
   * 1440m checkpoints, which are the whole reason for a 24h window.
   */
  inFlight() {
    return [...this.rows.values()].map((r) => ({
      mint: r.mint,
      graduatedAt: r.graduatedAt,
      /** The venue decides the toll, so it travels with every row. */
      pool: r.pool,
      basePriceSol: r.basePriceSol,
      trades: r.trades,
      lastTradeAt: r.lastTradeAt,
      quoteWentQuiet: r.lastTradeAt === null || Date.now() - r.lastTradeAt > 3_600_000,
      mult: r.mult,
      pending: true,
    }))
  }

  /** Survives a restart. A 24h window that a deploy resets would never complete a row. */
  snapshot() {
    return { v: 1, rows: [...this.rows.values()], completed: this.completed, expired: this.expired }
  }

  restore(snap, now = Date.now()) {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.rows)) return { restored: 0 }
    let restored = 0
    for (const row of snap.rows) {
      if (!row?.mint) continue
      if (now - row.graduatedAt >= this.checkpoints.at(-1) * 60_000) continue
      this.rows.set(row.mint, row)
      restored++
    }
    this.completed = snap.completed ?? 0
    this.expired = snap.expired ?? 0
    return { restored }
  }

  stats() {
    /**
     * `priced` is the health check for the whole experiment.
     *
     * After graduation the bonding curve is CLOSED and the token trades on PumpSwap, so
     * a price only arrives if the feed actually delivers post-graduation trades for a
     * watched mint. If it does not, every row fills with nulls and we would not find out
     * until the first 24h window expired with nothing in it. Tracked-but-unpriced is the
     * number that says so within minutes instead.
     */
    let priced = 0
    let quiet = 0
    let implausible = 0
    const now = Date.now()
    for (const r of this.rows.values()) {
      if (r.basePriceSol !== null) {
        priced++
        if (!baseSanity(r.basePriceSol).ok) implausible++
      }
      if (r.lastTradeAt !== null && now - r.lastTradeAt > 600_000) quiet++
    }
    return {
      tracking: this.rows.size,
      priced,
      /** Priced, but at a price a completed curve cannot have produced. */
      implausible,
      quiet,
      completed: this.completed,
      expired: this.expired,
    }
  }
}

const gradStatePath = () => path.join(config.dataDir, 'graduation-state.json')

export function saveGraduations(tracker) {
  if (!tracker) return
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const tmp = `${gradStatePath()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(tracker.snapshot()))
    fs.renameSync(tmp, gradStatePath())
  } catch (err) {
    log.warn(`graduation state save failed: ${err.message}`)
  }
}

export function loadGraduations() {
  try {
    return JSON.parse(fs.readFileSync(gradStatePath(), 'utf8'))
  } catch {
    return null
  }
}

/** Rows written so far, for the dashboard and for analysis. */
export function readGraduations(limit = 5000) {
  try {
    const lines = fs.readFileSync(gradFile(), 'utf8').trim().split('\n')
    return lines.slice(-limit).map((l) => JSON.parse(l)).filter(Boolean)
  } catch {
    return []
  }
}
