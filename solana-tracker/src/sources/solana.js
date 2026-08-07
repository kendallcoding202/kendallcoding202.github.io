import { postJson } from '../http.js'
import { config, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../config.js'
import { log } from '../util.js'

let requestId = 0

async function rpc(method, params) {
  const res = await postJson(config.rpcUrl, {
    jsonrpc: '2.0',
    id: ++requestId,
    method,
    params,
  })
  if (!res.ok) {
    log.debug(`rpc ${method} failed (status ${res.status})`)
    return { ok: false, value: null }
  }
  if (res.data?.error) {
    log.debug(`rpc ${method} error: ${res.data.error.message}`)
    return { ok: false, value: null }
  }
  return { ok: true, value: res.data?.result }
}

/**
 * Authoritative on-chain read of the two checks that matter most. We do not take a
 * third party's word for mint/freeze authority — a live mint authority means the
 * creator can print unlimited supply, and a live freeze authority means they can
 * freeze your account so you can never sell.
 */
export async function fetchMintAuthorities(mint) {
  const { ok, value } = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }])
  const info = value?.value?.data?.parsed?.info
  if (!ok || !info) return { ok: false, mintAuthority: null, freezeAuthority: null }
  return {
    ok: true,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    decimals: Number(info.decimals) || 0,
    supply: info.supply ?? '0',
  }
}

export async function fetchSolBalance(owner) {
  const { ok, value } = await rpc('getBalance', [owner])
  if (!ok) return null
  return (Number(value?.value) || 0) / 1e9
}

/** Read-only: a public wallet address is all this needs. No key, no signing, ever. */
export async function fetchTokenBalances(owner) {
  const balances = []
  let anyOk = false

  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const { ok, value } = await rpc('getTokenAccountsByOwner', [
      owner,
      { programId },
      { encoding: 'jsonParsed' },
    ])
    if (!ok) continue
    anyOk = true
    for (const acct of value?.value || []) {
      const info = acct?.account?.data?.parsed?.info
      const amount = info?.tokenAmount
      const ui = Number(amount?.uiAmount) || 0
      if (!info?.mint || ui <= 0) continue
      balances.push({
        mint: info.mint,
        amount: ui,
        decimals: Number(amount?.decimals) || 0,
      })
    }
  }

  if (!anyOk) return null
  return balances
}
