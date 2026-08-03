# BREACH — Post-Launch Content Roadmap

The principle: **every update is also a marketing beat** — a Steam announcement,
a clip cycle, a fresh-reviews bump, and (for the big ones) a Steam visibility
round. So the roadmap alternates cheap-but-sticky retention features with
headline content drops, on a rhythm a solo dev can actually sustain.

What the architecture makes CHEAP: campaigns, systems, modifiers, events,
watchers and cards are all **data** — the engine doesn't change. Seeded
determinism makes challenge modes nearly free. What's EXPENSIVE: anything
needing a backend (online leaderboards), Workshop, localization volume.

---

## Update 0 — Launch week (reactive)
Hotfixes only. Watch the first-48h reviews, fix what players actually hit.
One "thank you + what's coming" announcement linking this roadmap → sets the
expectation that the game is alive (drives wishlist-conversion stragglers).

## Update 1 — "DAILY BREACH" (~1 month post-launch · small, sticky)
The retention engine. Nearly free because runs are already seeded + deterministic.
- **Daily run**: one shared seed per day — fixed operator, fixed campaign,
  fixed modifiers. Everyone plays the same break-in; score = heat margin +
  turns + layers. Local best tracked; "share your seed/score" culture first,
  Steam leaderboards later if traction justifies the plumbing.
- **Challenge seeds**: enter/share any seed + loadout as a code.
- QoL sweep from launch feedback (undo-turn? speed toggle? whatever reviews ask for).

## Update 2 — "THE FIFTH OPERATOR" (~2–3 months · headline)
A new operator built around **CORRODE** — the newest keyword has cards but no
champion. Working name **SOLVENT**: the patient dissolver.
- Passive: direct hits apply +1 CORRODE (or corroded defenses never regen).
- ~8 new acid/decay cards to round out the archetype pool.
- A signature confrontation reply + operator quips (the voice system is data).
- Balance sweep across all campaigns like every operator before it.
This is the "come back to BREACH" moment for lapsed players — operators are
the strongest re-engagement hook in the genre.

## Update 3 — "THE SECOND WATCHER" (~4–6 months · headline)
A fifth campaign with a NEW antagonist that isn't the rogue:
- **Working concept: "INQUEST"** — a human corp security director (contrast to
  the AI: colder, procedural, personal in a different way). New transmission
  script, new hunt flavor, new finale boss composed from the behavior system
  (e.g., liveClock + adaptive: a war-room that watches AND learns).
- 2 new target systems + a handful of new events.
- A second full-screen CONFRONTATION (the component is reusable).
Campaigns are pure data — this is mostly writing + tuning, and it doubles the
endgame narrative surface.

## Update 4 — "BLACK VAULT" (~6–9 months · endless mode)
- **Gauntlet**: an endless tower of procedurally-assembled systems (the
  modifier + behavior + ICE pools recombine), escalating until you're caught.
  Score = depth. Feeds the daily-run scoreboard culture.
- **Cursed implants**: high-power implants with real drawbacks (risk-reward
  drafting depth).
- More Threat tiers with RULE changes, not stat inflation (e.g., "sweeps are
  invisible", "the grab is always lethal in lockdown").

## Continuous (fits any update)
- New cards in 4–6 card themed packs (each pack = one announcement).
- New events, modifiers, ICE traits, target archetypes — all data.
- Achievements expansion (achievements.ts → Steam achievements at launch).
- Localization when reviews show non-English demand: FIGS+zh-CN first;
  card text is the volume, UI strings are small.

## Ports (separate tracks, after PC traction)
- **iOS/iPad** — plan already written: `IOS_ROADMAP.md` (Capacitor wrap).
- **Steam Deck Verified** pass — mostly input/glyph checks; the game is
  turn-based and light, a natural Deck fit and a real sales channel.

## What we deliberately DON'T do
- No Workshop/modding until the base game is stable (huge support surface).
- No multiplayer. The genre doesn't need it and the engine isn't shaped for it.
- No paid DLC before the free updates have built goodwill — free updates
  first year, then judge whether a paid expansion is earned.
