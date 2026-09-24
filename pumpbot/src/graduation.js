import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
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
    const now = Date.now()
    for (const r of this.rows.values()) {
      if (r.basePriceSol !== null) priced++
      if (r.lastTradeAt !== null && now - r.lastTradeAt > 600_000) quiet++
    }
    return {
      tracking: this.rows.size,
      priced,
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
