import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { log } from './log.js'

/**
 * A single-writer lock on the ledger.
 *
 * The state file is rewritten whole on every save, so two processes writing it is
 * data loss, not a merge conflict. The concrete failure the audit found: `npm run
 * panic` liquidates everything and sets a halt in its own process, then the still-
 * running bot's next save() overwrites the file from its stale in-memory copy —
 * resurrecting the sold positions and clearing the halt. The emergency tool silently
 * undoes itself.
 *
 * The lock is a heartbeat file rather than a pid check, because a pid means nothing
 * across containers and a crashed process never cleans up after itself.
 */

const STALE_MS = 90_000
const REFRESH_MS = 30_000

const lockPath = () => path.join(config.dataDir, config.paper ? 'paper.lock' : 'live.lock')

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath(), 'utf8'))
    return typeof raw?.at === 'number' ? raw : null
  } catch {
    return null
  }
}

/** Is another process currently holding the ledger? */
export function heldByAnother() {
  const lock = read()
  if (!lock) return null
  const ageMs = Date.now() - lock.at
  if (ageMs > STALE_MS) return null // abandoned — a crashed run must not block recovery
  return { ...lock, ageMs }
}

let timer = null

export function acquire() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const write = () => {
    try {
      fs.writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, at: Date.now() }))
    } catch (err) {
      log.debug(`could not refresh the ledger lock: ${err.message}`)
    }
  }
  write()
  timer = setInterval(write, REFRESH_MS)
  timer.unref?.()
}

export function release() {
  clearInterval(timer)
  timer = null
  try {
    fs.unlinkSync(lockPath())
  } catch {
    /* already gone */
  }
}
