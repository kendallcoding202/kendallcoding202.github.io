import { sleep, log } from './util.js'

const UA = 'solana-tracker/1.0 (+https://github.com/kendallcoding202)'

/**
 * Every network helper returns a result object instead of throwing. Callers decide
 * what a failure means — and for safety checks a failure must mean "skip", never
 * "assume fine".
 */
async function request(url, { method = 'GET', body, headers = {}, timeoutMs = 15000, retries = 3 }) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(8000, 500 * 2 ** (attempt - 1))
      await sleep(backoff)
    }
    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': UA,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })

      // Retryable: rate limits and server-side faults.
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`)
        log.debug(`retryable ${res.status} from ${url}`)
        continue
      }

      const text = await res.text()
      let data = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          if (res.ok) return { ok: false, status: res.status, data: null, error: new Error('bad JSON') }
        }
      }
      if (!res.ok) {
        return { ok: false, status: res.status, data, error: new Error(`HTTP ${res.status}`) }
      }
      return { ok: true, status: res.status, data, error: null }
    } catch (err) {
      lastError = err
      log.debug(`request failed (${err.name}) ${url}`)
    }
  }
  return { ok: false, status: 0, data: null, error: lastError }
}

export const getJson = (url, opts = {}) => request(url, { ...opts, method: 'GET' })
export const postJson = (url, body, opts = {}) => request(url, { ...opts, method: 'POST', body })

/**
 * Simple concurrency limiter so we do not blow through public-API rate limits.
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
