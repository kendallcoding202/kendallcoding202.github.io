import { config } from './config.js'
import { readJson, writeJson, log } from './util.js'

const EMPTY = { version: 1, alertedTokens: {}, positions: {}, lastDigestDay: null }

export function loadState() {
  const state = readJson(config.statePath, null)
  if (!state || state.version !== 1) {
    log.info('no usable state found — starting fresh')
    return structuredClone(EMPTY)
  }
  return { ...structuredClone(EMPTY), ...state }
}

export function saveState(state) {
  writeJson(config.statePath, state)
}

/**
 * State lives in the Actions cache, which can be evicted. Dedupe is therefore
 * best-effort — the real protection against re-alerting ancient coins is the age
 * window in the screener, not this map.
 */
export function wasAlerted(state, mint) {
  return Boolean(state.alertedTokens[mint])
}

export function markAlerted(state, mint, symbol) {
  state.alertedTokens[mint] = { at: Date.now(), symbol }
}

export function pruneState(state) {
  const cutoff = Date.now() - config.scan.dedupeDays * 86400000
  for (const [mint, entry] of Object.entries(state.alertedTokens)) {
    if (!entry?.at || entry.at < cutoff) delete state.alertedTokens[mint]
  }
}
