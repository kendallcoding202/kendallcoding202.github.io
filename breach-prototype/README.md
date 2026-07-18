# BREACH

A single-player roguelike deckbuilder where you breach **reactive computer
systems**. You're the hacker; the system watches, adapts, and locks you out if
you get caught. The tension isn't HP vs. HP — it's **quiet-and-clever vs.
loud-and-caught.**

> Prototype status: the rules engine and a minimal terminal UI are in place.
> The one question the prototype answers — *does a single breach feel tense and
> clever?* — is now playable.

## The three signature mechanics

1. **Detection** — the master resource. Every card makes NOISE. Cross a
   threshold and the system escalates; max it out and you're locked out. This
   replaces the "enemy attacks you" loop of normal deckbuilders.
2. **Layered target** — you breach *inward*, and layers can carry **multiple
   defenses** that must all fall to advance. Exploits and single-target recon
   pick a specific defense, and type-matching matters (SQL Injection wrecks a
   database, misfires on a firewall). Four **target systems** of escalating
   difficulty give variety — from a gentle Home Server to a two-defense-per-layer
   Black Site.
3. **Hidden information** — defenses start unknown. Spend quiet recon to reveal
   them, or gamble blind and fast. Playing against incomplete info is the
   "outsmart" core.

## Architecture — the one rule that matters

**The rules engine is completely separate from the UI.** All game logic lives in
`src/engine/` as pure functions over plain data; React only renders state and
dispatches actions. This is what makes the game *tunable* (balance numbers are a
data table, not buried in components) and *portable* (the engine can drive a
future PvP defender-AI, an Expo mobile wrap, or a Godot port unchanged).

```
src/engine/
  types.ts     game state & card/defense/system types
  cards.ts     every card as DATA (noise / power tuning lives here)
  systems.ts   the targets you breach (layers, detection budget)
  rng.ts       seeded deterministic RNG (pure, reproducible)
  engine.ts    the reducer: applyAction(state, action) -> state
  ai.ts        a heuristic "player" — for headless balance sims only
  sim.ts       assertions + a 3,000-breach balance run
src/ui/        React terminal UI (renders engine state; zero game logic)
```

## Run it

```bash
npm install

npm run dev       # play it in the browser (Vite dev server)
npm run build     # production build -> dist/  (deploy to Vercel)
npm run sim       # headless: rules assertions + balance report
npm run typecheck # tsc --noEmit
```

`npm run sim` needs Node 22.6+ (it runs the TypeScript engine directly via
`--experimental-strip-types`). If your Node is older, `npx tsx src/engine/sim.ts`
works too.

## Desktop app (Tauri → Steam)

BREACH ships to Steam as a native desktop app via **Tauri**, which wraps this
exact web build in a lightweight native window (small binaries, uses the OS's
own webview). **The game code is unchanged** — Tauri is only the shell, so every
gameplay change we make flows straight into the desktop build on the next
rebuild. The Tauri project lives in `src-tauri/`.

**Prerequisites (on the machine you build from):**

- **Rust** toolchain — install from <https://rustup.rs>.
- A platform webview:
  - **Windows** (the primary Steam target): WebView2 — preinstalled on Win 10/11.
  - **macOS**: built in (WKWebView).
  - **Linux**: `webkit2gtk-4.1` + `librsvg2` dev packages.

**Commands:**

```bash
npm install
npm run desktop        # run the game in a native window (hot-reloads like dev)
npm run desktop:build  # produce a release binary + installer
```

`npm run desktop:build` outputs to `src-tauri/target/release/`:

- the runnable executable (`BREACH.exe` on Windows), and
- installers under `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows,
  `.dmg`/`.app` on macOS, `.deb`/`.AppImage` on Linux).

Build on the platform you're targeting — for Steam that's almost always the
**Windows** binary (most Steam players are on Windows), built on a Windows PC.

**App icon:** regenerate all icon sizes from one 1024×1024 PNG with
`npm run tauri icon path/to/icon.png` (writes into `src-tauri/icons/`).

**To Steam:** in Steamworks, point your app's depot at the built binary/bundle,
upload, and set the launch executable. Steam overlay works out of the box;
achievements / cloud saves are an optional later step via the Steamworks SDK.

## Tuning loop

Because the engine is pure and seeded, you can balance the whole game without
touching UI:

1. Edit numbers in `src/cards.ts` / `src/systems.ts` (noise, power, layer
   strength, detection thresholds).
2. `npm run sim` — get win-rate, average turns, average end-detection, and loss
   causes over 3,000 simulated breaches in ~1 second.
3. Repeat until the numbers feel right, then confirm the *feel* by playing.

Current tuning shows a clean difficulty gradient AND proves the depth matters —
a **reckless** bot (blind, no recon, no telegraph reads) wins **0%** on every
system, while a **clever** bot (recon → matched exploits → reads the telegraph)
wins:

| System            | Difficulty | Clever win |
| ----------------- | ---------- | ---------- |
| Home Server       | ◆          | ~85%       |
| Small Business    | ◆◆         | ~58%       |
| Corporate Network | ◆◆◆        | ~18%       |
| Black Site        | ◆◆◆◆◆      | ~12%       |

The 0% → win gap is the point: the game's cleverness (recon, type-matching,
reading the system's telegraphed move) is what wins — not raw card power.

## Deploy

`npm run build` produces a static `dist/`. Point Vercel at the repo (framework
preset: Vite) or run `vercel` — instant browser-playable link for playtesting.

## Not in the prototype (by design)

Run structure (chaining breaches), meta-progression, card unlocks, PvP, story,
and art beyond the terminal look. Those come only if a single breach proves fun.
