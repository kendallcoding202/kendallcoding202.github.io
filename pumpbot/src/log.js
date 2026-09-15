const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info

/**
 * Anything that looks like a base58 secret is masked before it can reach a log file,
 * a terminal, or Telegram. Cheap insurance against one careless log line.
 */
const SECRET_LIKE = /\b[1-9A-HJ-NP-Za-km-z]{80,}\b/g

export function redact(value) {
  if (typeof value === 'string') return value.replace(SECRET_LIKE, '<redacted>')
  if (value instanceof Error) return value.stack ? redact(value.stack) : redact(value.message)
  if (value && typeof value === 'object') {
    try {
      return JSON.parse(
        JSON.stringify(value, (k, v) =>
          /private|secret|key|mnemonic|seed/i.test(k) && k !== 'publicKey' ? '<redacted>' : v,
        ),
      )
    } catch {
      return '<unserializable>'
    }
  }
  return value
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const out = level === 'error' || level === 'warn' ? console.error : console.log
  out(`${stamp} ${level.toUpperCase().padEnd(5)}`, ...args.map(redact))
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function sol(n, digits = 4) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 'n/a'
  return `${v >= 0 ? '' : '-'}${Math.abs(v).toFixed(digits)} SOL`
}

export function pct(n, digits = 1) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 'n/a'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function shortAddr(a) {
  const s = String(a ?? '')
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s
}

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)
