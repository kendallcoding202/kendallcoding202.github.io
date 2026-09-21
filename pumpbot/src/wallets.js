import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log } from './log.js'
import { wilson } from './stats.js'

/**
 * What the WALLETS buying a launch have done before.
 *
 * The same shape as the deployer prior, pointed at buyers instead of creators — and
 * built because that prior is the best-performing check in the filter by a wide margin:
 * what creator_history rejects hits at 1.6% against a 10.8% base. Actor identity
 * predicts outcomes here. Buyers are a far larger and richer population of actors than
 * deployers, so the same question asked of them is worth asking.
 *
 * DELIBERATELY NOT P&L. Reconstructing per-wallet profit needs per-(wallet, mint)
 * position state, cost basis and partial fills — a lot of machinery and a lot of memory
 * for a number that would still be a proxy. This asks the question the journal already
 * answers: of the launches this wallet bought early, how many went on to reach the
 * first rung? Identical to the deployer prior, so it inherits its statistics and its
 * leak discipline for free.
 *
 * LEAKAGE is the whole difficulty, as it was for creators. The index is updated ONLY
 * when a row finalizes and read ONLY when a row is tracked, which happens strictly
 * earlier — so a launch can never be scored using wallets' knowledge of its own result.
 *
 * NOT IN THE JOURNAL. Sixty buyer addresses at 44 characters each would add ~2.6 KB to
 * every row and roughly triple a file that is already this bot's memory ceiling. The
 * buyer list lives on the in-memory shadow row and is dropped before the row is
 * appended; only the derived counts are journalled. The index persists to its own
 * compact file instead.
 */
export class WalletIndex {
  constructor({ maxWallets = config.learning.maxWalletsTracked } = {}) {
    this.byWallet = new Map() // wallet -> { launches, hits, lastAt }
    this.maxWallets = maxWallets
    /**
     * Running totals, not a scan.
     *
     * baseRate() on the deployer index walks the whole map, which is fine when it is
     * called once per launch. Here it would be called once per BUYER — sixty times a
     * launch against a map of tens of thousands — and that is millions of operations
     * per screened launch on the thread that decodes the feed.
     */
    this.totalLaunches = 0
    this.totalHits = 0
  }

  note(wallet, hit, at = 0) {
    if (!wallet) return
    const e = this.byWallet.get(wallet) ?? { launches: 0, hits: 0, lastAt: 0 }
    e.launches++
    if (hit) e.hits++
    e.lastAt = at || e.lastAt
    this.byWallet.set(wallet, e)
    this.totalLaunches++
    if (hit) this.totalHits++
  }

  /** How often ANY launch a tracked wallet bought reached the rung. The yardstick. */
  baseRate() {
    return this.totalLaunches > 0 ? this.totalHits / this.totalLaunches : null
  }

  /**
   * Is this wallet demonstrably better than the market?
   *
   * The LOWER bound, for the same reason the deployer block uses the upper one: two
   * wins out of two is not a record. A wallet nobody has enough history on is simply
   * unknown — which is most wallets, and must never be confused with a bad one.
   */
  verdict(wallet, { minLaunches = config.learning.minWalletLaunches } = {}) {
    const e = wallet ? this.byWallet.get(wallet) : null
    const base = this.baseRate()
    if (!e || e.launches < minLaunches || base === null) {
      return { known: false, launches: e?.launches ?? 0, betterThanMarket: false, base }
    }
    const w = wilson(e.hits, e.launches)
    return {
      known: true,
      launches: e.launches,
      hits: e.hits,
      hitRate: e.hits / e.launches,
      lowerBound: w.lo,
      betterThanMarket: w.lo > base,
      base,
    }
  }

  /** What a launch's early buyers look like, as features. Read at TRACK time. */
  scoreBuyers(wallets = []) {
    let known = 0
    let smart = 0
    for (const w of wallets) {
      const v = this.verdict(w)
      if (!v.known) continue
      known++
      if (v.betterThanMarket) smart++
    }
    const total = wallets.length || 0
    return {
      smartBuyers: smart,
      knownBuyers: known,
      smartBuyerShare: total > 0 ? smart / total : 0,
    }
  }

  /**
   * Keep the map bounded. Wallets seen once are the overwhelming majority and can never
   * clear minWalletLaunches, so they are pure weight — dropped first, then the least
   * recently active. Totals are NOT decremented: the base rate is a statement about
   * everything observed, and shrinking it to match whatever survived pruning would make
   * the yardstick drift with the eviction policy.
   */
  prune() {
    if (this.byWallet.size <= this.maxWallets) return 0
    const before = this.byWallet.size
    for (const [w, e] of this.byWallet) {
      if (e.launches < 2) this.byWallet.delete(w)
      if (this.byWallet.size <= this.maxWallets) break
    }
    if (this.byWallet.size > this.maxWallets) {
      const ordered = [...this.byWallet.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)
      for (const [w] of ordered.slice(0, this.byWallet.size - this.maxWallets)) this.byWallet.delete(w)
    }
    return before - this.byWallet.size
  }

  summary() {
    let eligible = 0
    let smart = 0
    const min = config.learning.minWalletLaunches
    for (const [wallet, e] of this.byWallet) {
      if (e.launches < min) continue
      eligible++
      if (this.verdict(wallet).betterThanMarket) smart++
    }
    return {
      wallets: this.byWallet.size,
      observations: this.totalLaunches,
      eligible,
      smart,
      baseRate: this.baseRate(),
      minLaunches: min,
    }
  }

  snapshot() {
    return {
      v: 1,
      totalLaunches: this.totalLaunches,
      totalHits: this.totalHits,
      // Only wallets that could ever matter; singletons are regenerated from live flow.
      rows: [...this.byWallet.entries()]
        .filter(([, e]) => e.launches >= 2)
        .map(([w, e]) => [w, e.launches, e.hits, e.lastAt]),
    }
  }

  restore(snap) {
    if (!snap || snap.v !== 1) return 0
    this.totalLaunches = snap.totalLaunches ?? 0
    this.totalHits = snap.totalHits ?? 0
    for (const [w, launches, hits, lastAt] of snap.rows ?? []) {
      this.byWallet.set(w, { launches, hits, lastAt: lastAt ?? 0 })
    }
    return this.byWallet.size
  }
}

const walletPath = () =>
  path.join(config.dataDir, config.paper ? 'wallets-paper.json' : 'wallets-live.json')

export function saveWallets(index) {
  if (!index) return
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const tmp = `${walletPath()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(index.snapshot()))
    fs.renameSync(tmp, walletPath()) // atomic: a torn write must not destroy the last copy
  } catch (err) {
    log.warn(`wallet index save failed: ${err.message}`)
  }
}

export function loadWallets() {
  try {
    return JSON.parse(fs.readFileSync(walletPath(), 'utf8'))
  } catch {
    return null
  }
}
