import fs from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Minimal .env loader so we stay dependency-free. Existing env vars always win. */
export function loadEnvFile(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

/** Telegram HTML parse mode only needs these three escaped. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function usd(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 'n/a'
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  if (abs >= 1) return `$${v.toFixed(2)}`
  if (abs === 0) return '$0'
  // Sub-dollar meme coin prices need real precision.
  return `$${v.toPrecision(4)}`
}

export function pct(n, digits = 1) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 'n/a'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function ageString(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function shortAddr(a) {
  const s = String(a ?? '')
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s
}

export function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info

function emit(level, args) {
  if (LEVELS[level] < threshold) return
  const stamp = new Date().toISOString().slice(11, 19)
  const stream = level === 'error' || level === 'warn' ? console.error : console.log
  stream(`${stamp} ${level.toUpperCase().padEnd(5)}`, ...args)
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
}

/** Base58 check — good enough to reject obviously malformed mint/wallet addresses. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export function isLikelyAddress(a) {
  return typeof a === 'string' && BASE58.test(a)
}
