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
- Latest Claude commit: the **deployer track record** wired into the entry filter (600 tests). The first real dataset had repeat deployers 0-for-111 and 0-for-102 beside one at 23% over 126, and the bot was recording that and ignoring it. A deployer is now refused only when the Wilson **upper** bound on their hit rate is below the market's own base rate, so an unknown or short-record deployer still passes. `src/stats.js` is new (holds `wilson`, breaking a journal↔learn import cycle).
- Open question, not yet answered: the thresholds now in `config.js` (buyers ≥ 60, acceleration ≥ 0.5, mcap ≤ 2000) were **selected on the same data that scored them**. They need out-of-sample confirmation before anyone treats them as an edge.
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
