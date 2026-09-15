# pumpbot

Automated pump.fun trading: screens new launches, buys the few that show real organic
demand, then works a take-profit ladder that recovers your stake at +50% and lets the
rest ride. Telegram alerts, a live dashboard, and a decision journal that measures what
the filter is getting wrong.

Node 20+. Three dependencies. Runs as a persistent process on a VPS.

---

## Read this first

**Nothing here makes money reliably, and I can't make it do so.**

- Roughly **1% of pump.fun tokens** ever graduate to a real market. The default outcome
  for a launch is zero.
- Your counterparties on new launches are **professional snipers** with co-located
  infrastructure and private RPC. They are in the deploy block. You are not.
- At 0.075 SOL a position, **priority fees and protocol fees are ~2–3% round trip**
  before any price movement.
- The exit ladder is genuine risk management — recovering your stake at +50% means a
  coin that later dies still books roughly flat. It does not change the fact that most
  positions never reach +50%.

Fund the burner with **only what you are fine losing entirely**. Run paper mode first.
Believe the numbers it gives you over the numbers you hoped for.

### Key handling — non-negotiable

- `npm run keygen` writes the secret to `.env` (chmod 600) and **prints only the public
  address**, so it never enters your terminal scrollback.
- `.env` is gitignored. Never commit it, never paste it into a chat or screenshot, never
  put it in GitHub Actions secrets.
- Use a **dedicated burner**. Not your main Phantom wallet.
- The bot signs locally and submits through your own RPC. It uses the trade API's *local*
  transaction endpoint, which returns an unsigned transaction. Hosted endpoints that
  custody your key are deliberately unsupported.
- Logs run through a redactor that masks anything resembling a base58 secret.

---

## Quick start

```bash
cd pumpbot
npm install
npm test                     # 209 offline checks, no network or keys needed

cp .env.example .env
npm run keygen               # creates the burner, prints the address to fund

# Paper mode is the default. This spends nothing.
npm run paper                # dashboard at http://localhost:8081
```

Leave it for an hour and watch the dashboard. That is the point of the paper instance:
it runs the identical pipeline — live feed, live screening, live prices — with simulated
fills, so what you see is what the strategy would have done.

### Before you ever set `PAPER=0`

The feed's exact field names have **not been verified against a live connection**. Run
this first:

```bash
npm run record -- 120        # captures 2 minutes of live feed to .data/
npm run replay -- .data/feed-sample-<timestamp>.jsonl
```

`replay` reports how many messages parsed and which fields came back missing. If anything
important is missing from most events, add the alias in `src/curve.js` before going live.
**A bot that cannot read prices cannot manage exits.**

---

## Running paper and live side by side

This is supported directly — the two instances share nothing:

| | live | paper |
|---|---|---|
| command | `npm start` | `npm run paper` |
| dashboard | `:8080` | `:8081` |
| state file | `.data/live-state.json` | `.data/paper-state.json` |
| journal | `.data/journal-live.jsonl` | `.data/journal-paper.jsonl` |
| systemd | `pumpbot.service` | `pumpbot-paper.service` |

Inspect each book separately:

```bash
npm run positions       npm run paper:positions
npm run learn           npm run paper:learn
```

Keeping paper running permanently alongside live is worth the trivial cost: it is a
control group. When live underperforms paper, the gap is your real slippage and fee drag.

---

## The strategy

### Entry — observe, then buy

The bot does **not** buy at deploy. At retail latency the block-zero fill belongs to
snipers, and buying blind fills every bundled launch where all the "buyers" are the dev.
Instead each launch is watched for `OBSERVE_SECONDS` (default 30) and must then clear
every check:

| Check | Default | Why |
|---|---|---|
| Organic buyers | ≥ 12 | Excludes the dev. Real demand, not a bundle |
| Buy/sell ratio | ≥ 1.8x | Early selling means it's being distributed out of |
| Market cap | 25–120 SOL | Too low = nobody there; too high = already run |
| Dev holdings | ≤ 12% | The dev's own launch buy as a share of supply |
| Dev has not sold | required | A dev selling during observation is disqualifying |
| Name/symbol | clean | Blocks `airdrop`, `claim`, `presale`, `official`, `giveaway` |
| Priceable | required | No usable price means no manageable exit |

Note what is *absent*: mint and freeze authority checks. The pump.fun program revokes
both automatically at deploy, so those filters — useful on Raydium listings — pass for
literally every launch here and filter nothing.

### Exit — the ladder

```
+50%   → sell 67%   ← recovers the full stake; everything after is house money
+100%  → sell 10%
+200%  → sell 10%
+400%  → sell 10%
                      3% rides indefinitely
```

Plus four ways out that override the ladder, in priority order:

1. **Curve draining** ≥ 60% since entry — the pump.fun analogue of an LP pull. Beats
   everything, including taking profit.
2. **Stop-loss** at −30%.
3. **Time stop** at 600s, *only* if no rung was hit. Once you're riding recovered
   capital there's no reason to exit on a clock.
4. **Trailing stop** — after a rung, give back at most 50% of the peak. Stops a +400%
   position round-tripping to nothing.

A gap up clears several rungs in one sell rather than chasing the price down.

### Sizing — equity tiers

```
SIZE_TIERS=0:0.075,5:0.15
```

0.075 SOL a position until the wallet reaches 5 SOL, then 0.15. Tiers are evaluated on
**liquid wallet balance**, not mark-to-market — an open meme coin bag is not money you
have. Size steps **down** as well as up; ratcheting up but not down is how a good run
gets handed back at the larger size.

The deploy cap derives from the active tier (`buySol × maxConcurrent`), so exposure
scales with the tier instead of silently capping it.

### Risk controls

| Control | Default | Effect |
|---|---|---|
| Per-position size | tiered | 0.075 / 0.15 SOL |
| Max concurrent | 4 | |
| Deploy cap | tier-derived | 0.30 SOL at the floor tier |
| Reserve | 0.05 SOL | Never spent — fees must stay payable |
| Daily loss limit | 0.20 SOL | Stops new entries; open positions still exit |
| Total loss limit | 0.35 SOL | **Halts the bot** until cleared manually |
| Consecutive losses | 6 | Pauses entries for the day |
| Creator blocklist | automatic | A creator who costs you money is never bought again |

Circuit breakers stop *entries*, never *exits*. A halted bot still manages its open
positions out.

```bash
npm run panic              # liquidate everything now, at max slippage tolerance
npm run panic -- resume    # clear a halt after you've looked at why
```

---

## Dashboard

Served by the bot itself, because that's where the live data is.

Total value, net/realized/unrealized P&L, win rate, current size tier and distance to the
next one, open positions with per-position P&L and which rungs have fired, closed trade
history with exit reasons, the learning summary, and every active limit.

**Feed pipeline** is the panel to watch early on. It shows messages received, whether
parsing is healthy, and the funnel — launches seen → observing → screened → entered —
plus which checks are doing the rejecting. A bot that is working correctly but finding
nothing worth buying looks identical to a hung one without it. The same summary prints to
the log every 60 seconds:

```
+38 launches (1247 total) · watching 9 · screened +36/1204 · entered +0/7 · open 2
  · shadow 62 · rejects: buyers×812 buy_pressure×241 market_cap×104
```

If messages arrive but nothing parses, both the log and the dashboard say so loudly —
that means the feed's field names moved and `src/curve.js` needs the alias.

**Localhost only by default.** To view from your laptop, tunnel — don't rebind:

```bash
ssh -N -L 8080:localhost:8080 -L 8081:localhost:8081 you@your-vps
```

Then open `localhost:8080` (live) and `localhost:8081` (paper). Binding to `0.0.0.0`
requires `DASHBOARD_TOKEN` and the server refuses to start without one.

---

## Watching it from your phone

Telegram is the better answer than exposing the dashboard: push alerts, no public URL,
and nothing sensitive sitting in a browser history.

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and you get pushes on every entry, rung
fire, exit, halt, and — the one that saves money — liquidity draining out of a position
you hold. You can also talk back to it:

| Command | Does |
|---|---|
| `/status` | Balance, P&L, size tier, feed health, the full funnel |
| `/positions` | Open positions with P&L and which rungs have fired |
| `/pause` | Stop opening new positions (open ones still exit) |
| `/resume` | Allow new entries again |
| `/panic confirm` | Sell everything now |

It also sends a **scheduled digest every `TELEGRAM_SUMMARY_HOURS`** (default 4; `0`
disables). The digest leads with what CHANGED since the last one rather than repeating a
static snapshot — a message that reads identically every four hours trains you to ignore
it, which defeats the point. A window with no trades says so explicitly, and names how
many launches it screened and declined, so silence is legible instead of ambiguous.

**Only the configured `TELEGRAM_CHAT_ID` is obeyed.** Bot tokens leak, and anyone who has
one can message the bot — the chat id is the authorization boundary, and messages from
any other chat are ignored silently rather than answered. `/panic` refuses to act without
the literal word `confirm`, and a restart drains any queued backlog so an old command
cannot replay hours later.

---

## Exploration — taking risk on purpose, before it costs anything

A strict filter in paper mode is self-defeating. It produces almost no trades, so almost
no data — and every sample comes from one side of every threshold, which means it can
never tell you a threshold is too tight. Paper money is free. Spend it buying information.

In paper, the bot takes a random **`EXPLORE_SAMPLE_RATE`** (default 25%) of the
candidates its filter *rejected*, and trades them for real (simulated) with the full exit
ladder. Every check is treated as a hypothesis worth testing. The only one never
overridden is `priceable` — a token we cannot price is one whose exit we cannot manage,
so it would produce a stuck position and no usable label.

**This is hard-gated to paper. There is no environment variable that turns it on with
real money.** If you want live to take more trades, loosen the actual thresholds
deliberately.

Explore trades are kept in a **separate book**:

- their P&L does not touch the headline numbers or the daily/total loss limits, so an
  experiment that loses money on purpose cannot halt the thing it is measuring
- they do not consume `MAX_CONCURRENT_POSITIONS` or the deploy cap, so they never crowd
  out a real entry
- they carry no Telegram alerts — at 25% of rejects they would flood the chat
- the dashboard tints them amber and tags them with the checks they failed

What you get for it is the one question that actually matters, answered with data:

```
Filtered vs explored, simulated ladder return:
  filter said YES : 1.042x  n=63
  filter said NO  : 0.883x  n=214
  → the filter is adding value at this sample size.
```

If that ever reads *"the coins the filter REJECTS are outperforming"*, the filter is
costing you money and the thresholds need to change before you go live.

---

## Learning

**What this is not:** a model that trains itself into profitability. At this trade volume
you'll have tens of samples for months. Anything fitted on that is memorising noise.

**What it actually does**, which is the part that compounds:

- Journals **every token it evaluated**, including rejects, then keeps watching them for
  15 minutes and records what happened. Only logging your own trades teaches you nothing
  about false negatives — you'd never discover your filter is throwing away the winners.
- Reports hit rates with **Wilson confidence intervals**, so "31% vs 9%" is only called
  an edge when the intervals don't overlap.
- Attributes missed winners **to the specific check that rejected them** — the directly
  actionable output. "You rejected 40 coins on `buyers`; 18 of them hit +50%" tells you
  exactly what to loosen.
- Runs a **simulated ladder backtest** over the journal and reports mean return with a
  confidence interval, so it can tell you the strategy is losing money rather than
  leaving you to guess.

```bash
npm run learn          # or: npm run paper:learn
```

Threshold suggestions are gated behind `MIN_SAMPLES_FOR_SUGGESTION` (200). Below that the
report says so and proposes nothing. **Do not lower it because the report looks empty.**

`LEARNING_AUTO_APPLY` is off and should stay off. Tuning a live strategy on its own
recent results is the fastest way to overfit into a drawdown. The analyser proposes; you
decide.

The backtest is deliberately **optimistic** — it assumes a touched rung was filled and
that stops fill at their trigger price. Read its output as an upper bound.

---

## Running it 24/7

Your laptop only works while it is awake and the terminal is open. `caffeinate -i npm run
paper` stops it sleeping, but the moment you close the lid or the terminal, the bot dies
and open positions stop being managed. For anything real you need it hosted.

### Railway

Works well, and is the least setup. **One thing is mandatory:**

> **Attach a Volume and set `DATA_DIR` to its mount path.**
>
> Railway containers have an ephemeral filesystem. Without a volume, every redeploy,
> crash, or platform restart wipes `.data/` — and the bot comes back believing it holds
> nothing. Any open position becomes a bag with no stop-loss, no time stop, and no exit,
> sitting there until you notice. That is the single most expensive way this can fail.

Setup:

1. New Project → Deploy from GitHub repo → pick this repo and the tracker branch.
2. **Add a Volume**, mount path `/data`.
3. Variables:

   | Variable | Value |
   |---|---|
   | `DATA_DIR` | `/data` ← the volume mount, not a normal path |
   | `PAPER` | `1` |
   | `RPC_URL` | your Helius URL |
   | `PRIVATE_KEY` | *(leave unset until you go live)* |
   | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | optional |
   | `DASHBOARD_HOST` | `0.0.0.0` — only if you want the dashboard public |
   | `DASHBOARD_TOKEN` | a long random string — **required** with the above |

   `PORT` is injected by Railway and the dashboard picks it up automatically.

4. Deploy. Watch the deploy logs for `feed connected` and `feed parsing confirmed`.

**On the private key.** Railway variables are a reasonable place for a burner holding
~$100. They are not a reasonable place for a wallet you would mind losing. Generate the
key locally with `npm run keygen`, then paste it into the Railway variable — do not
generate it in a shell whose history is stored.

**On exposing the dashboard.** Setting `DASHBOARD_HOST=0.0.0.0` puts your wallet and P&L
on a public URL. The server refuses to start without `DASHBOARD_TOKEN`, and you then
reach it at `https://your-app.up.railway.app/?token=YOUR_TOKEN`. That token is the only
thing protecting it, so make it long. Leaving the host at `127.0.0.1` and reading the
deploy logs instead is the safer choice.

### Orphaned positions

If state is ever lost while positions are open, the bot detects it on the next start:
tokens in the wallet that the ledger knows nothing about get a loud log block and a
Telegram alert. Then either:

```bash
npm run adopt               # lists them
npm run adopt -- --confirm  # brings them back under the exit rules
npm run panic               # or just get out
```

Adoption sets entry price to the *current* price, so reported P&L on those positions is
measured from adoption rather than from what you paid. It is an explicit command, never
automatic — silently rewriting your cost basis is not something a bot should decide.

### VPS deploy

There is a bootstrap script for a fresh Ubuntu/Debian box:

```bash
curl -fsSL https://raw.githubusercontent.com/kendallcoding202/kendallcoding202.github.io/claude/solana-meme-coin-tracker-gugfaj/pumpbot/deploy/setup.sh -o setup.sh
less setup.sh        # read it first — it runs as root
sudo bash setup.sh   # --firewall to also enable ufw
```

It installs Node 20, creates an unprivileged `pumpbot` user, clones to `/opt/pumpbot`,
runs the tests, and starts paper mode. It deliberately does not create a wallet, enable
live trading, or open any port.

Manual equivalent:

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/pumpbot pumpbot
sudo mkdir -p /opt/pumpbot && sudo chown pumpbot:pumpbot /opt/pumpbot
# copy the pumpbot/ directory to /opt/pumpbot, then:
cd /opt/pumpbot && sudo -u pumpbot npm install
sudo -u pumpbot npm run keygen
sudo chmod 600 /opt/pumpbot/.env

sudo cp deploy/pumpbot-paper.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now pumpbot-paper
journalctl -u pumpbot-paper -f
```

Add `pumpbot.service` only once paper results justify it and you've done the feed
verification above.

---

## Commands

| Command | Does |
|---|---|
| `npm test` | 209 offline checks |
| `npm run keygen` | Create the burner wallet |
| `npm run balance` | Address, balance, current size tier |
| `npm run paper` | Paper instance, dashboard on :8081 |
| `npm start` | Live instance, dashboard on :8080 |
| `npm run record -- 120` | Capture live feed to a file |
| `npm run replay -- <file>` | Check the parser against a capture |
| `npm run positions` | Open and recent closed trades |
| `npm run learn` | Learning report |
| `npm run panic` | Liquidate everything |
| `npm run adopt` | Re-manage tokens the ledger lost track of |

---

## Layout

```
src/
  index.js      CLI dispatch
  bot.js        the trading loop — discovery, entry, exit management
  filter.js     entry checks
  position.js   exit decisions (pure, fully unit tested)
  sizing.js     equity-tiered position sizing
  risk.js       circuit breakers and exposure limits
  exec.js       buy/sell, live and simulated
  curve.js      bonding-curve maths and feed normalisation
  feed.js       websocket with reconnect and watchdog
  store.js      atomic ledger
  journal.js    decision journal + shadow tracking
  learn.js      statistics over the journal
  dashboard.js  local HTTP server
  onchain.js    bonding curve account reads (pricing when the feed is silent)
  notify.js     Telegram alerts
  commands.js   Telegram /status, /pause, /panic
  summary.js    shared status + digest text
deploy/         systemd units for live and paper
test/run.js     209 checks
```

## What is unverified

Built and tested without network access to the trading APIs, so:

- **Feed field names are unconfirmed.** Parsing is defensive with aliases, and `record` /
  `replay` exist to verify before you go live. Do that.
- **Trade API request/response shape is unconfirmed.** Paper mode exercises everything
  around it; the live path itself has not executed a real order.
- **Thresholds are untuned.** They're reasoned defaults, not backtested ones. That is
  exactly what the paper instance and the learning report are for.

`npm test` covers the logic that decides when to buy, when to sell, how much, and when to
stop — all of it offline. It cannot cover whether the APIs behave as assumed.
