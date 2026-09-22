import { parentPort, workerData } from 'node:worker_threads'
import { buildExportGzip } from './export.js'

/**
 * The journal export, run OFF the trading thread.
 *
 * buildExport() walks the whole journal — measured at ~3.6 seconds for 180,000 rows —
 * and it is synchronous. On the main thread that is three and a half seconds of not
 * reading the websocket, which is the identical shape to the bug that had analyze()
 * freezing the loop and force-closing positions on stale prices.
 *
 * It matters less here only because the export is manual and occasional rather than
 * running every five minutes on a timer. "Less" is not "not", and the fix is cheap, so
 * it does not get to be the exception.
 *
 * Short-lived and stateless on purpose: one worker per request, nothing cached, no
 * backoff machinery to get wrong. The caller holds an in-flight guard so a reloaded
 * download page cannot spawn a queue of these.
 */
try {
  const { gz, stats } = buildExportGzip(workerData ?? {})
  // Transferred, not copied — this buffer is several megabytes.
  const buf = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)
  parentPort.postMessage({ ok: true, gz: buf, stats }, [buf])
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message ?? String(err) })
}
