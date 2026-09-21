import { Worker } from 'node:worker_threads'
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
let cache = { at: 0, snapshot: null, report: null, lastError: null, lastRunMs: null }

const isFresh = () => cache.at > 0 && Date.now() - cache.at < config.learning.refreshSeconds * 1000

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./analysis-worker.js', import.meta.url))
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
    cache = { at: msg.at, snapshot: msg.snapshot, report: msg.report, lastError: null, lastRunMs: Date.now() - pending.startedAt }
  } else {
    cache.lastError = msg?.error ?? 'unknown analysis failure'
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
export const analysisHealth = () => ({
  at: cache.at,
  running: Boolean(inFlight),
  lastError: cache.lastError,
  lastRunMs: cache.lastRunMs,
})

export async function stopAnalysis() {
  if (!worker) return
  stopping = true
  const w = worker
  worker = null
  await w.terminate().catch(() => {})
  stopping = false
}
