import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Keypair, Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { config, ROOT, LAMPORTS_PER_SOL, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './config.js'
import { log } from './log.js'

let cachedKeypair = null
let cachedConnection = null

/**
 * The signing key is read from the environment and never written to disk by the bot,
 * never logged, and never sent anywhere except a locally-signed transaction. If
 * PRIVATE_KEY is unset we can still run in paper mode against a throwaway public key.
 */
export function getKeypair() {
  if (cachedKeypair) return cachedKeypair
  const raw = config.privateKey
  if (!raw) {
    if (config.paper) {
      /**
       * Derived from a fixed seed rather than generated, so the paper wallet is the
       * same address on every restart. A new random address each time makes restart
       * notifications unreadable — you cannot tell a restart from a second instance.
       * Nothing signs in paper mode, so this key never controls anything.
       */
      const seed = createHash('sha256').update('pumpbot:paper:v1').digest()
      cachedKeypair = Keypair.fromSeed(new Uint8Array(seed))
      log.warn('PRIVATE_KEY unset — paper mode is using a fixed, non-funded demo key')
      return cachedKeypair
    }
    throw new Error('PRIVATE_KEY is required for live trading. Run `npm run keygen` first.')
  }
  try {
    const bytes = raw.trim().startsWith('[')
      ? Uint8Array.from(JSON.parse(raw))
      : bs58.decode(raw.trim())
    cachedKeypair = Keypair.fromSecretKey(bytes)
  } catch {
    // Never echo the offending value.
    throw new Error('PRIVATE_KEY could not be parsed (expected base58 or a JSON byte array)')
  }
  return cachedKeypair
}

export function getPublicKey() {
  return getKeypair().publicKey
}

export function getConnection() {
  if (!cachedConnection) {
    cachedConnection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: config.exec.confirmTimeoutMs,
    })
  }
  return cachedConnection
}

export async function getSolBalance() {
  const lamports = await getConnection().getBalance(getPublicKey(), 'confirmed')
  return lamports / LAMPORTS_PER_SOL
}

/** Token balance in whole tokens for a mint we hold. Returns 0 when we hold none. */
export async function getTokenBalance(mint) {
  const res = await getConnection().getParsedTokenAccountsByOwner(getPublicKey(), {
    mint: new PublicKey(mint),
  })
  let total = 0
  for (const { account } of res.value) {
    total += Number(account.data?.parsed?.info?.tokenAmount?.uiAmount) || 0
  }
  return total
}

/**
 * Every SPL token the wallet currently holds. Used to detect positions the ledger has
 * lost track of — which is exactly what happens if state is stored on an ephemeral
 * filesystem and the container restarts.
 */
export async function getAllTokenBalances() {
  const connection = getConnection()
  const out = []
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    let res
    try {
      res = await connection.getParsedTokenAccountsByOwner(getPublicKey(), {
        programId: new PublicKey(programId),
      })
    } catch (err) {
      log.warn(`could not read ${programId.slice(0, 8)} accounts: ${err.message}`)
      continue
    }
    for (const { account } of res.value) {
      const info = account.data?.parsed?.info
      const amount = Number(info?.tokenAmount?.uiAmount) || 0
      if (info?.mint && amount > 0) out.push({ mint: info.mint, amount })
    }
  }
  return out
}

/**
 * Generates a burner wallet and writes it to .env with owner-only permissions.
 * The secret is deliberately never printed — it goes straight to the file so it cannot
 * end up in terminal scrollback, a screen recording, or a pasted log.
 */
export function keygen() {
  const envPath = path.join(ROOT, '.env')
  let existing = ''
  try {
    existing = fs.readFileSync(envPath, 'utf8')
  } catch {
    /* first run */
  }

  if (/^PRIVATE_KEY=\S/m.test(existing)) {
    throw new Error('.env already contains a PRIVATE_KEY — refusing to overwrite it')
  }

  const kp = Keypair.generate()
  const secret = bs58.encode(kp.secretKey)
  const line = `PRIVATE_KEY=${secret}\n`

  const next = /^PRIVATE_KEY=\s*$/m.test(existing)
    ? existing.replace(/^PRIVATE_KEY=\s*$/m, line.trimEnd())
    : `${existing}${existing.endsWith('\n') || !existing ? '' : '\n'}${line}`

  fs.writeFileSync(envPath, next, { mode: 0o600 })
  fs.chmodSync(envPath, 0o600)

  return kp.publicKey.toBase58()
}
