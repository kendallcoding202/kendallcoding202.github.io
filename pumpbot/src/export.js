import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { Worker } from 'node:worker_threads'
import { streamRows, TRAIL_LEVELS, PATH_CHECKPOINTS } from './journal.js'

/**
 * A portable, compact, SECRET-FREE slice of the journal.
 *
 * The journal is the most valuable thing this project has produced and the hardest to
 * look at: it lives on a hosted volume, it is ~84 MB, and every question asked of it so
 * far has had to be written into the report and waited a day for. This exists so the
 * data can travel to wherever the analysis is being done instead.
 *
 * THE SAFETY PROPERTY IS AN ALLOWLIST, NOT A DENYLIST. Only the columns named below are
 * ever written, so a field added to the journal later — a wallet list, a signature, a
 * key someone thought was harmless — cannot silently start appearing in an export that
 * gets emailed around. A denylist would have to be updated to stay correct; this fails
 * closed by default.
 *
 * Addresses are dropped rather than included. They are public chain data, not secrets,
 * but they are most of the bytes and none of the analysis. The one exception is the
 * deployer, which is kept as a SALTED HASH: the deployer-record work needs to know that
 * two rows share a creator, and never needs to know who.
 */

/** Outcome and decision columns. Everything here is a number, a bool or a short enum. */
const OUTCOME_COLUMNS = [
  'action',
  'hitFirstRung',
  'peakMultiple',
  'endMultiple',
  'troughMultiple',
  'maxDrawdownPct',
  'peakAtSeconds',
  'troughAtSeconds',
  'firstRungAtSeconds',
  'staleExitAtSeconds',
  'staleExitMultiple',
  'timeStopMultiple',
  'hasExitTiming',
  'hasOrdering',
  'troughFirst',
  'hitFirstRungInTime',
  'observedSeconds',
  'windowTruncated',
  'decisionPriceSol',
  'fillPriceSol',
  'finalizedAt',
]

/**
 * THE TWO ARRAYS ON THE ROW, flattened into one column each.
 *
 * `trailExits[i]` is where a trailing stop at TRAIL_LEVELS[i] would ACTUALLY have exited,
 * stamped at tick time as the path happened. `pathPrices[i]` is the price standing at
 * PATH_CHECKPOINTS[i] seconds. They are the only columns that can answer the two
 * questions currently blocking every exit decision — where a trail really fills, and
 * whether a fill was reachable in the first few seconds — and neither can be reconstructed
 * from peak/trough/end, which is the whole reason they were added.
 *
 * They were being dropped. The allowlist above holds scalars, `featureValue` takes only
 * finite numbers and booleans, and an array satisfies neither — so both were journalled
 * faithfully and then silently discarded on the way out. The export would have arrived
 * looking complete, with the two columns the analysis was waiting for simply absent.
 *
 * Named by their LEVEL rather than their index (trailExit25, not trailExits_3) so a
 * column cannot be misread if the levels are ever reordered or extended.
 */
const arrayColumns = () => [
  /**
   * WHETHER THIS ROW COULD CARRY THE DATA AT ALL, which is not the same question as
   * whether it does — and conflating the two would bias the one measurement these
   * columns exist for.
   *
   * An empty `trailExit50` means either "a 50% trail never triggered on this path" or
   * "this row was written before the feature existed". Both render as an empty cell.
   * JOURNAL_VERSION was not bumped when the arrays were added (bumping it now would make
   * the analyser discard every one of the ~193k rows already on disk), so the row's
   * version cannot tell them apart either.
   *
   * Left ambiguous, every pre-feature row would count as "the trail never fired" and the
   * trailing stop would look far rarer and far shallower than it is. Rows written by the
   * new code always carry the array — all-null if nothing triggered — so its PRESENCE is
   * the signal. Filter on this before computing anything about trails or fill windows.
   */
  ['hasTrailData', (row) => Array.isArray(row.trailExits)],
  ['hasPathData', (row) => Array.isArray(row.pathMultiples)],
  ...TRAIL_LEVELS.map((lvl, i) => [`trailExit${lvl}`, (row) => row.trailExits?.[i]]),
  /**
   * `pathMultiples`, NOT `pathPrices`. finalize() deliberately drops the raw prices —
   * they are working state, the multiples are the record, and keeping both would grow
   * every row for nothing. Reading the tracking field instead of the finalized one is
   * how the first attempt shipped: `hasPathData` came back 0 on every one of 40,346
   * rows, and eleven columns arrived empty, in the export built to stop exactly that.
   *
   * Named for what they are. A multiple against the decision price is also the more
   * useful quantity for the fill question — "how far had it moved by the time an order
   * would land" is a ratio, not a price.
   */
  ...PATH_CHECKPOINTS.map((sec, i) => [`multAt${sec}s`, (row) => row.pathMultiples?.[i]]),
]

/**
 * Features are DISCOVERED rather than listed, because the whole point of the feature
 * vector is that it grows — pinning the list here would mean every new feature was
 * invisible to analysis until someone remembered to add it in two places. Discovery is
 * still bounded by the allowlist above for everything outside `features`, and by the
 * type check below: only finite numbers and booleans survive, so an address or a wallet
 * array added under `features` cannot ride along.
 */
const featureValue = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

const csvCell = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  // Only `action` reaches here, and it is one of three known words — but quote anyway
  // rather than trusting that to stay true.
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Deterministic per-run salt so the same deployer maps to the same id WITHIN an export
 * and to a different one across exports. Grouping survives; correlating an old export
 * against a new one to re-identify anybody does not.
 */
const makeCreatorId = (salt) => {
  const seen = new Map()
  return (creator) => {
    if (!creator) return ''
    if (!seen.has(creator)) {
      seen.set(creator, crypto.createHash('sha256').update(salt).update(String(creator)).digest('hex').slice(0, 10))
    }
    return seen.get(creator)
  }
}

/**
 * Walks the journal and returns { csv, stats }.
 *
 * Rows we ACTED on are kept in full — they are the scarce ones and the only side of
 * every threshold that carries an entry decision. Rejected rows are the bulk and are
 * sampled deterministically (every Nth), because 40,000 of them answers any question
 * this dataset can answer and 150,000 of them mostly answers it again.
 */
export function buildExport({
  maxRejected = 20_000,
  maxExplored = 20_000,
  salt = crypto.randomBytes(16).toString('hex'),
} = {}) {
  const kept = []
  const featureKeys = new Set()
  const stats = { scanned: 0, bought: 0, explored: 0, rejected: 0, rejectedSampled: 0, skipped: 0 }
  const creatorId = makeCreatorId(salt)

  streamRows((row) => {
    stats.scanned++
    const action = row?.action
    if (action !== 'bought' && action !== 'explored' && action !== 'rejected') {
      stats.skipped++
      return
    }
    // Unlabelled rows cannot answer anything — they have no outcome yet.
    if (!Number.isFinite(row.peakMultiple)) {
      stats.skipped++
      return
    }
    /**
     * Counted only once a row has survived both checks, so these are KEPT rows rather
     * than scanned ones. They are printed next to the sampled figures as the "before",
     * and a before that silently includes rows which were never eligible makes the
     * sampling look lossier than it is.
     */
    stats[action]++
    kept.push(row)
    for (const [k, v] of Object.entries(row.features ?? {})) {
      if (featureValue(v) !== null) featureKeys.add(k)
    }
  })

  /**
   * Sample AFTER the walk, evenly across the whole file. Taking the first N would take
   * the first N hours, which is one market regime and not the one we are in.
   *
   * BOUGHT ROWS ARE NEVER SAMPLED. There are hundreds of them against six figures of
   * everything else, they are the only rows carrying a real entry decision, and losing
   * any of them costs power exactly where the dataset is thinnest.
   */
  const spread = (rows, cap) => {
    if (rows.length <= cap) return rows
    const step = rows.length / cap
    return Array.from({ length: cap }, (_, i) => rows[Math.floor(i * step)])
  }
  const bought = kept.filter((r) => r.action === 'bought')
  const explored = spread(kept.filter((r) => r.action === 'explored'), maxExplored)
  const rejected = spread(kept.filter((r) => r.action === 'rejected'), maxRejected)
  stats.exploredSampled = explored.length
  stats.rejectedSampled = rejected.length

  const features = [...featureKeys].sort()
  const arrays = arrayColumns()
  const header = [
    'creatorId',
    ...OUTCOME_COLUMNS,
    ...arrays.map(([name]) => name),
    ...features.map((f) => `f_${f}`),
  ]
  const lines = [header.join(',')]

  for (const row of [...bought, ...explored, ...rejected]) {
    const cells = [
      csvCell(creatorId(row.creator)),
      ...OUTCOME_COLUMNS.map((c) => csvCell(row[c])),
      // featureValue, not csvCell directly: it is what rejects anything that is not a
      // finite number, so a malformed array element cannot become a bogus price.
      ...arrays.map(([, read]) => csvCell(featureValue(read(row)))),
      ...features.map((f) => csvCell(featureValue(row.features?.[f]))),
    ]
    lines.push(cells.join(','))
  }

  stats.rows = lines.length - 1
  stats.columns = header.length
  return { csv: lines.join('\n') + '\n', stats }
}

/** Gzipped, because this is numeric CSV and it compresses about tenfold. */
export function buildExportGzip(options = {}) {
  const { csv, stats } = buildExport(options)
  const gz = zlib.gzipSync(Buffer.from(csv, 'utf8'), { level: 9 })
  return { gz, stats: { ...stats, bytes: gz.length, rawBytes: Buffer.byteLength(csv) } }
}

let exportInFlight = null

/**
 * The same thing, on a worker thread, because the walk is seconds of synchronous work
 * and the trading loop is on the other side of it.
 *
 * ONE AT A TIME. A download link that a browser retries — or a reloaded page — must not
 * be able to spawn a queue of journal walks; the analysis path had exactly that bug,
 * where a failure left the cache stale and every poll built a new Worker. A second
 * caller joins the first instead of starting another.
 */
export function buildExportInWorker(options = {}) {
  if (exportInFlight) return exportInFlight
  exportInFlight = new Promise((resolve, reject) => {
    const url = new URL('./export-worker.js', import.meta.url)
    const worker = new Worker(url, { workerData: options })
    let settled = false
    const done = (fn, arg) => {
      if (settled) return
      settled = true
      worker.terminate().catch(() => {})
      fn(arg)
    }
    worker.on('message', (msg) => {
      if (msg?.ok) done(resolve, { gz: Buffer.from(msg.gz), stats: msg.stats })
      else done(reject, new Error(msg?.error ?? 'export worker failed'))
    })
    worker.on('error', (err) => done(reject, err))
    worker.on('exit', (code) => done(reject, new Error(`export worker exited with ${code}`)))
  }).finally(() => {
    exportInFlight = null
  })
  return exportInFlight
}
