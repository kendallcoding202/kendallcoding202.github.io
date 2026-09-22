import { parentPort } from 'node:worker_threads'
import { analyze, formatReport } from './learn.js'

/**
 * The learning analysis, run OFF the trading thread.
 *
 * analyze() is synchronous and expensive — measured at 73 seconds and 1.2 GB peak on a
 * 197 MB journal of 152,000 rows carrying the real 24-feature vector. On the main thread
 * that is not a slow report, it is the bot going away: the websocket is not read, prices
 * go stale, and the stale-price rule force-closes open positions "blind" at whatever it
 * last saw. The analysis was corrupting the data it analyses, and costing real money
 * doing it.
 *
 * A worker has its own V8 isolate, so none of that work touches the event loop that
 * manages exits. It does NOT reduce process memory — workers are threads, not processes,
 * and RSS is shared — so the row cap still has to keep the footprint survivable.
 *
 * The projection happens HERE rather than on the other side: posting the whole analysis
 * back would copy a large object across the thread boundary for a page that needs a few
 * dozen numbers.
 */
function project(a) {
  return {
    labelled: a.totals.labelled,
    pending: a.totals.pending,
    bought: a.totals.bought,
    rejected: a.totals.rejected,
    explored: a.totals.explored,
    minSamples: a.minSamples,
    enoughData: a.enoughData,
    baseRatePct: a.rates.base.n ? a.rates.base.p * 100 : null,
    boughtRatePct: a.rates.bought.n ? a.rates.bought.p * 100 : null,
    rejectedRatePct: a.rates.rejected.n ? a.rates.rejected.p * 100 : null,
    filterEdge: a.filterEdge,
    ev: a.ev.bought,
    topMisses: a.falseNegatives.slice(0, 4),
    suggestions: a.suggestions.slice(0, 4),
    stale: a.totals.stale,
    truncated: a.totals.truncated,
    journalled: a.totals.journalled,
    labelledLastHour: a.totals.labelledLastHour,
    olderThanCap: a.totals.olderThanCap,
    // Whether the replay resembles the account. Belongs on the page, not only in the
    // Telegram report — it governs how much the exit numbers can be trusted.
    calibration: a.calibration,
    /**
     * The wallet prior travels with the analysis rather than being computed per poll.
     * Ranking wallets is a scan of the whole index, and the dashboard polls every few
     * seconds against a map of tens of thousands — the same cost that had to be kept
     * off the event loop in the first place.
     */
    wallets: a.wallets,
  }
}

parentPort.on('message', () => {
  try {
    const a = analyze()
    // The formatted report travels with it, so /learn never has to recompute.
    parentPort.postMessage({ ok: true, snapshot: project(a), report: formatReport(a), at: Date.now() })
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err?.message ?? String(err) })
  }
})
