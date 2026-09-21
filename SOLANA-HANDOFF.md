# Solana tracker — agent handoff

Read this before editing `pumpbot/` or `solana-tracker/`. Update the "Now" section when you start or stop work.

## Who is who

| Agent | Where | Branch it may push |
|---|---|---|
| **Claude Code (cloud)** | [session](https://claude.ai/code/session_014J2AxPGBQb5ayF8k3tqWhN) | `claude/solana-meme-coin-tracker-gugfaj` only |
| **Cursor** | chat `5409b714-74f4-4440-99f9-9c616d8a7d3f` (Kendall started it 2026-09-16) | `cursor/solana-tracker` only |

Do **not** push to the other agent's branch. Do **not** force-push either branch. Merge the other branch with `git pull origin <their-branch>` (or a PR) before overlapping files.

Repo: `kendallcoding202/kendallcoding202.github.io`  
Local clone: `/Users/kendallsorenson/kendallcoding202.github.io`

## Now (2026-09-21)

- Claude is **active again** on `claude/solana-meme-coin-tracker-gugfaj`. Working in `pumpbot/` only. Treat those files as taken.
- Live build `e8c7644`. Collecting on a ~179 MB journal, 153,000 labelled launches, 37,000 deployers indexed. **Leave it collecting** — the next checkpoint is a `/learn` a day out.

### Where the strategy actually stands

- 174 closed strategy trades: **35W/139L, −4.92 SOL**, ≈ −0.028 SOL/trade on 0.15 stakes. Explore (buying what the filter rejects) is −0.034/trade over 26,000 trades — so **the filter does select**, it just does not yet clear costs. Break-even needs ≈33% realized win rate against today's 20%.
- The one candidate big enough: **`proven deployer` × `fast crowd` = 47.9% [43.7–52.2]**, and the lift survives *within* each crowd column, so the deployer record and the crowd are independent signals rather than one wearing two hats. That table was computed on rows collected AFTER the thresholds were chosen — the first genuinely out-of-sample confirmation this project has had.

### Do not undo these without reading why

- **`readFileSync().split()` in the journal read.** It goes through a `StringDecoder` because a 1 MiB chunk boundary splits multi-byte characters and a naive decode silently drops those rows — 6 of 9 byte alignments, measured. pump.fun names are mostly emoji.
- **Selling on a stale price** (`SELL_ON_STALE_PRICE=false`). On a bonding curve the price is vSol/vTokens and moves only on a trade, so silence means the price has not changed, not that it is unknown. The old rule turned no information into a guaranteed loss. Stale positions are refreshed via `readBondingCurve` and exit only after `BLIND_EXIT_AFTER_READS` consecutive FAILED reads.
- **`MAX_ROWS_ANALYZED` (now 10,000).** It has been set twice from benchmarks taken on a different machine than the one that runs it, and both times the container paid: 200,000 is 77s of blocked event loop and 1.2 GB. The dashboard now prints resident/peak memory — set this against THAT number and Railway's limit, not against a local run.
- **`hydrate()` in `journal.js`.** The shadow checkpoint is live in-memory state, not a journal row: a missing field there is a crash, not a skipped row. Adding `pathPrices` without it killed startup with 264 observations restored. Any new field `track()` seeds needs a default in `hydrate()`.
- **The dashboard starts before the bot** (`index.js`). Otherwise the only tool for diagnosing a broken bot is the first casualty of one.

### Open questions

- Entry thresholds in `config.js` were selected on the data that scored them. `proven × fast` is the exception and needs a second fresh batch.
- The deployer prior blocks ~239 of ~1,068 eligible deployers; under the null ~25 would be chance. Real, but roughly a tenth of the blocks are not. Explore samples prior-refused launches, so it measures itself.
- **Replay vs reality was ~20pp apart** (replay 0.976x, account 0.812x). `analyze()` now reports this calibration above the exit sweep, and `simulateLadder` models the real time stop and stale exit — but only on rows carrying `hasExitTiming`, so the gap closes as rows age in. **Do not act on exit proposals narrower than that gap.**
- Journal has no rotation. Memory is bounded now, but it grows forever.
- `RPC_URL` is unset in Railway, so curve reads go to the public mainnet endpoint. Worth pointing at a real provider now that stale positions trigger reads.
- Earlier: the learning-report performance fix — `analyze()` was O(n^2) and ran on the HTTP request path, so at 50,000 journal rows it blocked the event loop for 22s and froze the dashboard and the trade feed together. Now 1.2s, capped to the most recent 4,000 rows, and computed behind the response.
- Claude rebased onto `9bfd31f` rather than force-pushing, per the rules below.
- Cursor is **only** coordinating so far. No feature work started. Next Cursor commits go on `cursor/solana-tracker`.
- GitHub Actions **Solana tracker** workflow is on the Claude branch only, **not** on `main`, so the 5-minute cron has never fired. Repo is also missing `TELEGRAM_*` / `WALLET_ADDRESS` / `SOLANA_RPC_URL` secrets. Still **unowned** — nobody should fix it until Kendall assigns it here. (Note: `pumpbot/` does not use that workflow; it runs on Railway. This concerns `solana-tracker/` only.)

## Rules that prevent collisions

1. Before you edit, `git fetch` and read this file again.
2. If the other agent's "Now" line is **active**, skip those files or wait.
3. One concern per commit; mention this file in the commit body if you change ownership.
4. Paper trading / alerts only. No live keys in git, chat, or Actions unless Kendall explicitly asks.

## When Claude quota returns

Claude should: pull `origin/claude/solana-meme-coin-tracker-gugfaj`, read this file, then `git fetch origin cursor/solana-tracker` and merge or rebase that in if Cursor committed anything. Then set "Now" to active on Claude's side and idle on Cursor's, or split files (e.g. Claude owns `pumpbot/`, Cursor owns `solana-tracker/`).
