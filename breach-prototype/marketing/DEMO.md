# BREACH — Free Demo Build

A free demo is a wishlist engine: players try a real slice, hit the ceiling, and see exactly what the full game adds. Same codebase, one build flag — no forked content to keep in sync.

## What the demo includes
- **2 of 4 operators** — WRAITH (silent/stealth) and TORCH (loud/brute-force). The clearest playstyle contrast, so the demo shows range. HEX and BYTE appear on the select screen locked with "🔒 In the full game" — a tease, not a blank.
- **1 of 4 campaigns** — *Burn Notice*, the short "on the run" storyline. Self-contained, ~15 minutes, a full arc with a real blackSite finale and the antagonist "THE TRACE." The other three campaigns show on the select screen, locked.
- **Threat Level 0 only** — the 10-level ascension ladder is a headline full-game hook, so it's hidden in the demo.
- **A demo-complete screen** — on win *or* loss the ending shows a "★ Wishlist BREACH on Steam" call-to-action and a one-line summary of what the full game adds.

Everything else — the card engine, the branching map, per-run modifiers, the event deck, implants dropping mid-run, the reactive system behaviors, sound — is fully intact. The demo is the real game, just a smaller slice of content.

## How it's built
The demo is produced by setting the `VITE_DEMO` flag; `src/ui/demo.ts` reads it and gates content. Nothing in the engine changes.

```
npm run build:demo      # web build -> dist-demo/
npm run dev:demo        # run the demo locally
npm run desktop:demo    # Tauri desktop demo (the Steam demo depot)
```

To tweak the slice, edit `src/ui/demo.ts`:
- `DEMO_OPERATORS` — which operators are playable (default WRAITH + TORCH)
- `DEMO_CAMPAIGN` — the featured campaign (default `burn`)
- `STEAM_URL` — **swap in the real Steam app id** once the store page exists (currently a placeholder)

## Steam setup notes
- On Steamworks a demo is a **separate app** linked to the main app; it gets its own store page and a "Download Demo" button on the main page.
- Ship the demo as its own depot built with `desktop:demo`.
- Steam lets you keep demo and full-game saves separate (the demo uses the same localStorage-backed Operator Profile; it simply can't progress past Threat 0 or unlock the gated content).
- A demo is one of the strongest wishlist drivers on Steam and is eligible to feature in Next Fest — plan the demo to be ready for a Next Fest window.

## Before publishing the demo
- [ ] Replace `STEAM_URL` in `src/ui/demo.ts` with the real app id.
- [ ] Decide final operator/campaign slice (current default is a strong one).
- [ ] Build with `npm run desktop:demo` and smoke-test the wishlist button opens the store page in the desktop build.
