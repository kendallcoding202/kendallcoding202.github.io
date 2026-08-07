# Solana meme coin tracker

Screens newly-listed Solana tokens against automated rug filters and watches a read-only
wallet for position moves. Alerts go to Telegram. Runs on GitHub Actions — no server.

Zero runtime dependencies: plain Node 20+ and `fetch`.

---

## Read this before you use it

**Passing the filter does not mean a coin is safe.** These checks find *mechanical* rug
vectors — the ones where the creator can take your money by construction:

- a live mint authority (they can print unlimited new supply)
- a live freeze authority (they can freeze your account so you can never sell)
- an unburned, unlocked LP (they can pull the pool)
- supply concentrated in a few wallets (one seller ends the chart)
- a honeypot pattern where buys go through and sells do not

None of that catches the most common way people lose money on meme coins: a creator who
passes every check, waits, and dumps. No automated filter catches that, because nothing
on-chain distinguishes "holding" from "about to sell."

Treat an alert as *"worth a look, and not an obvious scam."* Most tokens that pass will
still go to zero. Only risk what you are fine losing entirely.

This tool never asks for a private key or seed phrase and cannot trade. It reads a public
address. If any tool in this space asks for your seed phrase, it is stealing from you.

---

## What it does

**Every 5 minutes, it:**

1. Pulls recently-listed Solana tokens from DexScreener.
2. Drops anything already alerted, outside the age window, or below the liquidity floor.
3. Deep-screens the survivors against on-chain state and RugCheck.
4. Telegrams the ones that clear every hard gate and score high enough.
5. Re-prices your wallet and alerts on big moves, draining pools, and new/closed positions.

### Hard gates — any failure disqualifies

| Check | Default | Why |
|---|---|---|
| Mint authority revoked | required | Creator could otherwise print unlimited supply |
| Freeze authority revoked | required | Creator could otherwise freeze your tokens |
| LP burned or locked | ≥ 90% | Unlocked LP can be pulled at any moment |
| Top-10 holder share | ≤ 25% | Concentrated supply means one seller ends it |
| Largest single holder | ≤ 8% | Same, for one dominant wallet |
| Holder count | ≥ 150 | Thin holder base is trivially manipulated |
| Liquidity | $15k – $5M | Too thin to exit / too big to be an early entry |
| 24h volume | ≥ $25k | Needs real trading, not a dead pool |
| Market cap | $30k – $20M | Same reasoning as liquidity |
| Trade count 24h | ≥ 150 | Filters dead listings |
| Volume ÷ liquidity | ≤ 30x | Wildly excessive volume is the wash-trading signature |
| Sells ÷ all trades | ≥ 15% | Buys with no sells is what a honeypot looks like |
| RugCheck score | ≤ 40 | Their aggregate risk score (lower is safer) |
| No `danger` risk flags | required | RugCheck's own critical findings |
| Not flagged rugged | required | — |
| Pair age | 15m – 24h | Skip the first chaotic minutes, skip stale coins |

**If a data source is unreachable, the token is skipped, not passed.** An unverifiable
token is never an alerted token.

### Soft signals — reduce a 0–100 score

Immutable metadata, insider supply share, socials/website present, multiple LP providers,
1h momentum, liquidity comfortably above the floor. A token needs every hard gate **and**
`MIN_SCORE` (default 60) to alert.

### Position alerts

- 🆕 new position appears in the wallet
- 📈/📉 price moved ≥ 25% since the last alert for that token (ratchets, so a steady climb
  alerts per step rather than every run)
- 🚨 **the pool backing a token you hold drained ≥ 45%** — the one that actually saves money
- ✅ position no longer in the wallet
- 💼 daily holdings digest at a configurable UTC hour

PnL is measured from when the tracker first saw a position, **not from what you paid** —
swap history is not parsed. Every message says so.

---

## Setup

### 1. Telegram bot (2 minutes)

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts → copy the token.
2. Send your new bot any message (a bot cannot start a conversation with you).
3. Open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and copy
   `result[0].message.chat.id`.

### 2. Repo secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Required | Value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | from BotFather |
| `TELEGRAM_CHAT_ID` | yes | from `getUpdates` |
| `WALLET_ADDRESS` | for positions | your Phantom **receive address** — never a seed phrase |
| `SOLANA_RPC_URL` | recommended | free [Helius](https://helius.dev) key; the public RPC is heavily rate limited |

### 3. Turn it on

Actions → **Solana tracker** → **Run workflow**. Tick *dry run* for the first go to see what
it would send without sending it.

Once it's running, the schedule takes over. Note: GitHub disables scheduled workflows after
60 days with no repo activity, and the 5-minute cron is best-effort — expect 5–15 minute
spacing in practice.

### 4. Local use

```bash
cd solana-tracker
cp .env.example .env      # fill in your values
npm test                  # 48 offline checks, no network needed
npm run test-alert        # confirms Telegram is wired up
DRY_RUN=1 npm run scan    # full pipeline, prints instead of sending

npm run check -- <mint>   # screen one specific token, see every check
npm run loop              # continuous local polling (LOOP_SECONDS=60)
```

`npm run check` is the one to use when tuning thresholds — it prints every gate with the
actual value next to the requirement:

```
  PASS  Mint authority revoked             revoked
  FAIL  LP burned or locked                34.2% locked (want ≥ 90%)
  PASS  Top-10 concentration               18.4% held by top 10 (want ≤ 25%)
```

---

## Tuning

Every threshold is an env var (see `.env.example`) — in Actions, add them to the `env:`
block in `.github/workflows/solana-tracker.yml` or as repo secrets.

**Getting nothing?** The defaults are deliberately strict. Loosen in this order:
`MIN_HOLDERS` → `MIN_VOLUME_24H_USD` → `MIN_LIQUIDITY_USD` → `MIN_SCORE`.
Leave the authority and LP gates alone — those are the ones doing real work.

**Getting too much?** Raise `MIN_SCORE` to 75, drop `MAX_TOP10_PCT` to 18, raise
`MIN_LIQUIDITY_USD`.

---

## Coverage limits

Worth being straight about what this does not do:

- **Discovery is DexScreener's free endpoints** (latest token profiles + boosted tokens).
  That covers coins that got far enough to be listed and described — the population worth
  screening — but it is *not* every pump.fun mint the second it launches. For full
  firehose coverage you need a paid stream (Helius webhooks, Bitquery, Moralis). The
  discovery layer in `src/sources/dexscreener.js` is isolated so another source can be
  added without touching the screening logic.
- **A 5-minute cron is not a sniper.** By the time a coin clears a 15-minute age window and
  a $15k liquidity floor, the first movers are already in. This tool is for filtering out
  garbage, not for being first.
- **Holder analysis leans on RugCheck.** Mint and freeze authority are read directly from
  chain and never trusted to a third party, but concentration and LP-lock data come from
  their API. If it's down, tokens get skipped.

## Layout

```
src/
  index.js       CLI entry (scan | positions | check | test-alert | loop)
  pipeline.js    scan + position run loops, alert formatting
  screener.js    the gates and scoring — the interesting file
  wallet.js      read-only position tracking and diffing
  state.js       dedupe + last-seen prices (persisted via the Actions cache)
  telegram.js    message sending, chunking, escaping
  config.js      every threshold, all env-overridable
  http.js        retries, backoff, concurrency limiting
  sources/       dexscreener.js · rugcheck.js · solana.js (RPC)
test/
  run.js         48 offline checks
  fixtures.js    recorded API response shapes + fetch mock
```

State lives in the Actions cache, which can be evicted — dedupe is best-effort. The real
protection against re-alerting old coins is the age window, not the dedupe map.
