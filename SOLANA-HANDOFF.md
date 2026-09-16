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

## Now (2026-09-16, ~11:15 AM Denver)

- Claude hit **weekly limit** (resets 1:00 AM America/Denver). That session cannot run commands or commit until then. Treat it as **paused**, not abandoned.
- Last Claude commit on `claude/solana-meme-coin-tracker-gugfaj`: `d417e4b` — halt deadlock / explore no longer blocked by halt (463 tests).
- Cursor is **only** coordinating today. No feature work started. Next Cursor commits go on `cursor/solana-tracker`.
- GitHub Actions **Solana tracker** workflow is on the Claude branch only, **not** on `main`, so the 5-minute cron has never fired. Repo is also missing `TELEGRAM_*` / `WALLET_ADDRESS` / `SOLANA_RPC_URL` secrets. Do not "fix" that on both branches at once — pick one owner in this file first.

## Rules that prevent collisions

1. Before you edit, `git fetch` and read this file again.
2. If the other agent's "Now" line is **active**, skip those files or wait.
3. One concern per commit; mention this file in the commit body if you change ownership.
4. Paper trading / alerts only. No live keys in git, chat, or Actions unless Kendall explicitly asks.

## When Claude quota returns

Claude should: pull `origin/claude/solana-meme-coin-tracker-gugfaj`, read this file, then `git fetch origin cursor/solana-tracker` and merge or rebase that in if Cursor committed anything. Then set "Now" to active on Claude's side and idle on Cursor's, or split files (e.g. Claude owns `pumpbot/`, Cursor owns `solana-tracker/`).
