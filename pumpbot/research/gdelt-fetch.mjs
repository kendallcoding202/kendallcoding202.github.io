/**
 * Fetch English headlines per coin from GDELT DOC 2.0, week by week, for the Jev news test.
 *
 *   node research/gdelt-fetch.mjs <outDir>
 *
 * GDELT allows one request per 5 seconds and searches only the last ~3 months. A week that
 * returns the 250-record cap is split in halves until it does not, so nothing is silently
 * dropped. Results are cached per (coin, window), so a rerun resumes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const outDir = process.argv[2]
fs.mkdirSync(outDir, { recursive: true })

// Fixed before any count was seen. Ambiguous names need a crypto term alongside.
const CRYPTO = '(crypto OR cryptocurrency OR memecoin OR "meme coin" OR solana OR token)'
export const QUERIES = {
  'bonk': `bonk ${CRYPTO}`,
  'book-of-meme': `"book of meme"`,
  'cat-in-a-dogs-world': `("cat in a dogs world" OR "MEW coin" OR "MEW token")`,
  'dogwifcoin': `dogwifhat`,
  'fartcoin': `fartcoin`,
  'moo-deng': `"moo deng" ${CRYPTO}`,
  'official-trump': `("trump memecoin" OR "trump meme coin" OR "official trump" OR "TRUMP token" OR "TRUMP coin")`,
  'peanut-the-squirrel': `("peanut the squirrel" OR pnut) ${CRYPTO}`,
  'popcat': `popcat ${CRYPTO}`,
  'pudgy-penguins': `(pengu OR "pudgy penguins") ${CRYPTO}`,
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
async function query(q, from, to) {
  const wait = last + 6000 - Date.now(); if (wait > 0) await sleep(wait)
  last = Date.now()
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
    query: `${q} sourcelang:english`, mode: 'artlist', format: 'json', maxrecords: '250', sort: 'datedesc',
    startdatetime: stamp(from), enddatetime: stamp(to),
  })
  for (let attempt = 1; attempt <= 5; attempt++) {
    // curl, not fetch: Node's fetch is refused by this environment's proxy for some hosts.
    let text = '', status = 0
    try {
      const outp = execFileSync('curl', ['-sS', '--max-time', '60', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 64 << 20 })
      const i = outp.lastIndexOf('\n'); text = outp.slice(0, i); status = +outp.slice(i + 1)
    } catch (e) { status = String(e.message).slice(0, 60) }
    const res = { ok: status === 200, status }
    if (res.ok && text.trim().startsWith('{')) return JSON.parse(text).articles ?? []
    if (res.ok && text.trim() === '') return []
    console.error(`  retry ${attempt} (${res.status ?? 'bad body'}) ${text.slice(0, 80)}`)
    await sleep(10_000 * attempt); last = Date.now()
  }
  throw new Error(`GDELT failed for ${q} ${stamp(from)}`)
}
async function window(coin, from, to, out) {
  const key = `${coin}_${stamp(from)}_${stamp(to)}`
  const f = path.join(outDir, 'cache', key + '.json')
  let arts
  if (fs.existsSync(f)) arts = JSON.parse(fs.readFileSync(f, 'utf8'))
  else {
    arts = await query(QUERIES[coin], from, to)
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(arts))
  }
  if (arts.length >= 250 && to - from > 3600_000) {   // capped: split, never truncate silently
    const mid = from + Math.floor((to - from) / 2)
    await window(coin, from, mid, out); await window(coin, mid, to, out); return
  }
  out.push(...arts)
}

const END = Date.UTC(2026, 9, 1)           // 2026-10-01 00:00 UTC
const START = END - 88 * 86400_000          // inside GDELT's rolling 3 months
const WEEK = 7 * 86400_000
for (const coin of Object.keys(QUERIES)) {
  const all = []
  for (let t = START; t < END; t += WEEK) await window(coin, t, Math.min(t + WEEK, END), all)
  const seen = new Set(); const uniq = all.filter((a) => !seen.has(a.url) && seen.add(a.url))
  fs.writeFileSync(path.join(outDir, `${coin}.json`), JSON.stringify(uniq))
  console.log(`${coin.padEnd(22)} ${String(uniq.length).padStart(5)} articles`)
}
