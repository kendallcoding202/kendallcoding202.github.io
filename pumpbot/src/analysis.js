import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { config } from './config.js'
import { log } from './log.js'

/**
 * Owns the analysis worker and the cached result.
 *
 * One worker, reused, and at most one run in flight. Spawning per request would let the
 * dashboard's poll and a /learn arrive together and run the whole scan twice — which is
 * how a heavy job becomes a heavy job squared.
 */

let worker = null
let inFlight = null
let stopping = false
let failures = 0
let nextAttemptAt = 0
let cache = { at: 0, snapshot: null, report: null, lastError: null, lastRunMs: null }

const isFresh = () => cache.at > 0 && Date.now() - cache.at < config.learning.refreshSeconds * 1000

/**
 * Overridable so a test can point at a worker that fails on purpose. The spawn-storm
 * bug below took the whole container down, and a test for it has to drive the real
 * failure path rather than re-check the backoff arithmetic.
 */
const workerUrl = () =>
  process.env.ANALYSIS_WORKER_PATH
    ? pathToFileURL(process.env.ANALYSIS_WORKER_PATH)
    : new URL('./analysis-worker.js', import.meta.url)

let workersSpawned = 0
export const workerSpawnCount = () => workersSpawned

function ensureWorker() {
  if (worker) return worker
  workersSpawned++
  worker = new Worker(workerUrl())
  worker.unref() // must never hold the process open
  worker.on('error', (err) => {
    log.warn(`analysis worker error: ${err.message}`)
    cache.lastError = err.message
    settle({ ok: false, error: err.message })
    worker = null
  })
  worker.on('exit', (code) => {
    // terminate() exits non-zero by design, so a deliberate shutdown is not a fault.
    if (code !== 0 && !stopping) {
      const why = `analysis worker exited with code ${code}`
      log.warn(why)
      cache.lastError = why
      settle({ ok: false, error: why })
    }
    worker = null
  })
  worker.on('message', (msg) => settle(msg))
  return worker
}

function settle(msg) {
  const pending = inFlight
  inFlight = null
  if (!pending) return
  if (msg?.ok) {
    failures = 0
    nextAttemptAt = 0
    cache = { at: msg.at, snapshot: msg.snapshot, report: msg.report, lastError: null, lastRunMs: Date.now() - pending.startedAt }
  } else {
    cache.lastError = msg?.error ?? 'unknown analysis failure'
    /**
     * BACK OFF. Without this a failing worker is a spawn storm.
     *
     * cache.at stays 0 while the analysis keeps failing, so `isFresh()` is false, so
     * every dashboard poll — every few seconds — calls request(), which builds ANOTHER
     * Worker. Each one is a fresh V8 isolate with its own heap. A worker that cannot
     * start therefore does not degrade the report, it exhausts the container, and the
     * first symptom is the dashboard going away entirely.
     */
    failures++
    nextAttemptAt = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 6))
    log.warn(
      `analysis failed (${failures} in a row): ${cache.lastError} — next attempt in ` +
        `${Math.round((nextAttemptAt - Date.now()) / 1000)}s`,
    )
  }
  pending.resolve(msg?.ok ? cache : { ...cache, failed: true })
}

/**
 * Kick a refresh if one is due and none is running. Returns immediately — callers that
 * want the result await request() instead.
 */
export function refreshIfStale() {
  if (!config.learning.enabled) return
  if (inFlight) return
  if (Date.now() < nextAttemptAt) return
  if (Date.now() - cache.at < config.learning.refreshSeconds * 1000) return
  request().catch(() => {})
}

/**
 * The current analysis: served from cache when it is recent, otherwise computed.
 *
 * /learn twice in a minute should not mean two full scans — each one is hundreds of
 * megabytes and several seconds of a thread. Inside the refresh interval the numbers
 * cannot have moved enough to matter; they describe hours.
 */
export function request({ force = false } = {}) {
  if (!config.learning.enabled) return Promise.resolve(cache)
  if (inFlight) return inFlight.promise
  if (!force && isFresh()) return Promise.resolve(cache)
  // A caller asking directly (/learn) still waits out the backoff rather than starting
  // another isolate on a container that has already shown it cannot afford one.
  if (Date.now() < nextAttemptAt) return Promise.resolve({ ...cache, failed: true })
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  inFlight = { promise, resolve, startedAt: Date.now() }
  try {
    ensureWorker().postMessage('run')
  } catch (err) {
    log.warn(`could not start the analysis worker: ${err.message}`)
    settle({ ok: false, error: err.message })
  }
  return promise
}

/** Whatever we last computed. Never blocks, may be null before the first run. */
export const snapshot = () => cache.snapshot
export const report = () => cache.report
/**
 * Process memory, reported rather than inferred.
 *
 * The container crashed and the dashboard went with it, and every candidate cause was
 * a guess because nothing on the page said how much memory the process was using. The
 * benchmarks that set the row cap ran on a different machine with a different baseline;
 * this is the number from the machine that actually has to survive it.
 */
export const memoryUse = () => {
  const m = process.memoryUsage()
  return { rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576) }
}

export const analysisHealth = () => ({
  at: cache.at,
  running: Boolean(inFlight),
  lastError: cache.lastError,
  lastRunMs: cache.lastRunMs,
  failures,
  nextAttemptInSeconds: nextAttemptAt > Date.now() ? Math.round((nextAttemptAt - Date.now()) / 1000) : 0,
  memory: memoryUse(),
  peakRssMb,
})

/**
 * High-water RSS, sampled once a minute. A crash leaves no numbers behind, so the only
 * way to know whether the process was near its ceiling is to have been watching before.
 */
let peakRssMb = 0
const sampler = setInterval(() => {
  peakRssMb = Math.max(peakRssMb, memoryUse().rssMb)
}, 60_000)
sampler.unref?.()

/** Clears the backoff. Only the suite calls this, to test recovery without waiting. */
export function __resetBackoffForTests() {
  failures = 0
  nextAttemptAt = 0
}

export async function stopAnalysis() {
  if (!worker) return
  stopping = true
  const w = worker
  worker = null
  await w.terminate().catch(() => {})
  stopping = false
}
