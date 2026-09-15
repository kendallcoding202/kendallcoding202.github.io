import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log } from './log.js'

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

export function readAll() {
  try {
    return fs
      .readFileSync(file(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** The feature vector we score a launch on. Keep this stable — it is the dataset schema. */
export function featuresOf(candidate) {
  return {
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
    observeSeconds: config.entry.observeSeconds,
  }
}

/**
 * Tracks what happened to a token after we made a call on it, so the row can be
 * labelled. Held in memory; flushed to the journal when the window closes.
 */
export class ShadowTracker {
  constructor({ windowMs = config.learning.outcomeWindowMinutes * 60_000, max = config.learning.maxShadowTracked } = {}) {
    this.windowMs = windowMs
    this.max = max
    this.rows = new Map() // mint -> pending row
  }

  track({ candidate, verdict, action, entryPriceSol }) {
    if (this.rows.size >= this.max) {
      // Drop the oldest rather than refuse — recent data is more representative.
      const oldest = [...this.rows.entries()].sort((a, b) => a[1].decidedAt - b[1].decidedAt)[0]
      if (oldest) this.finalize(oldest[0], 'evicted')
    }

    const price = entryPriceSol ?? candidate.priceSol
    this.rows.set(candidate.mint, {
      v: 1,
      mint: candidate.mint,
      symbol: candidate.symbol,
      creator: candidate.creator,
      decidedAt: Date.now(),
      createdAt: candidate.createdAt,
      action, // 'bought' | 'rejected'
      rejectedFor: verdict?.pass ? null : verdict?.failed?.map((c) => c.id) ?? null,
      features: featuresOf(candidate),
      decisionPriceSol: price,
      peakPriceSol: price,
      troughPriceSol: price,
      lastPriceSol: price,
      ticks: 0,
    })
  }

  onTrade(event) {
    const row = this.rows.get(event.mint)
    if (!row || !(event.priceSol > 0)) return
    row.ticks++
    row.lastPriceSol = event.priceSol
    if (event.priceSol > row.peakPriceSol) row.peakPriceSol = event.priceSol
    if (event.priceSol < row.troughPriceSol) row.troughPriceSol = event.priceSol
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

    const finished = {
      ...row,
      finalizedAt: Date.now(),
      finalizeReason: reason,
      peakMultiple: Number(peakMultiple.toFixed(4)),
      endMultiple: Number(endMultiple.toFixed(4)),
      troughMultiple: Number((row.troughPriceSol / base).toFixed(4)),
      maxDrawdownPct: Number((((row.peakPriceSol - row.troughPriceSol) / row.peakPriceSol) * 100).toFixed(1)),
      // The label everything else is measured against: would this have paid the first rung?
      hitFirstRung: peakMultiple >= 1 + firstRung / 100,
      firstRungPct: firstRung,
      wentToZero: endMultiple <= 0.1,
    }

    append(finished)
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
}
