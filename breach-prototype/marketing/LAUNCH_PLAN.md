# BREACH — Launch Plan (Fall 2026)

_Last updated: 2026-07-20_

## The strategy in one paragraph

Ship **this fall (Sept–Nov 2026)**, not early 2027. The only thing worth
waiting for is enough **wishlists** that launch day isn't cold — and a
**6–8 week** store-page runway gets us into the "fine" zone without burning
half a year. We skip the October Next Fest as a hard requirement (it's a
single-use card, and the wishlist ceiling for a niche first title is
uncertain), and instead run a short, focused wishlist push. The real gating
factor is **KYC verification** — every date below is relative to the day that
clears, called **T+0**.

## The one rule we don't break

Do **not** launch cold with ~0 wishlists. That's the single move that wastes a
Steam launch, and a short runway avoids it. Everything here exists to make sure
launch day has a wishlist pile to convert.

---

## Critical path (KYC-gated)

```
KYC clears (T+0)
   │
   ├─ App created + fee confirmed          T+0 to T+3 days
   ├─ Store page built & submitted         T+0 to T+1 week   ← assets already done
   ├─ Valve review (~2–5 business days)     ~T+1 to T+2 weeks
   ├─ Store page LIVE ("Coming Soon")       ~T+2 weeks        ← wishlists start here
   │
   ├─ Wishlist push                          6–8 weeks
   │
   └─ LAUNCH                                 ~T+8 to T+10 weeks
```

**Worked example** — if KYC clears **early August 2026**:
store page live ~**late August** → launch **mid-to-late October 2026**.

---

## Phase 0 — NOW (pre-KYC, nothing blocked)

Everything here can happen before verification clears.

- [x] Game feature-complete + balanced (72 cards, 4 operators, threat ladder)
- [x] Free demo built (full + demo Windows binaries, CI verified)
- [x] Store assets ready: capsules, screenshots, trailer plan, store copy
      (`STORE_COPY.md`, `TRAILER_PLAN.md`, `capsules/`, `screens/`)
- [x] Playable beta on itch.io + hosted build
- [ ] **Re-upload the latest itch build** (CRT + juice + audio + map fix) and
      set the embed to 1280×720 with the fullscreen button
- [ ] Start collecting feedback on the itch/demo build now — every player is a
      potential wishlist later
- [ ] (Optional) stand up a tiny landing spot — even just the itch page — that
      we can later point at "Wishlist on Steam"

## Phase 1 — KYC clears → store page live (T+0 → ~2 weeks)

**What I need from you the day KYC clears:** the **App ID** and **Depot ID**.
That's the key that unlocks all the config work.

- [ ] Create the Steam app, confirm the $100 fee applied
- [ ] I wire the SteamPipe config (`steam/app_build_*.vdf`,
      `steam/depot_build_*.vdf`) + set `STEAM_URL`
- [ ] Fill the store page from `STORE_COPY.md`; upload capsules + screenshots +
      trailer
- [ ] Set a **placeholder release date** ("Coming Q4 2026" / "October 2026")
- [ ] Submit store page for review → wait for Valve (~2–5 business days)
- [ ] **Store page goes LIVE as "Coming Soon"** — the wishlist bucket opens

## Phase 2 — Wishlist push (6–8 weeks)

The whole point of the runway. Order roughly by impact.

- [ ] **Steam demo live** on the store page ("Download Demo" button) — biggest
      single converter. Already built; just needs wiring to the app.
- [ ] Add a **"Wishlist on Steam"** button to the itch page + anywhere you post
- [ ] Post gameplay clips: TikTok / YouTube Shorts (15–30s, the juiciest
      breach moments — the CRT look reads great on video)
- [ ] Relevant communities: r/roguelikes, r/deckbuilding, r/incremental_games,
      cyberpunk/hacking-themed subs and Discords — devlog-style, not spam
- [ ] Reach out to a handful of small streamers/creators with demo keys
- [ ] Lock the **real release date** ~2–3 weeks out once wishlists are trending
      (a healthy count feeds "Popular Upcoming" in the final 2 weeks)

## Phase 3 — Launch (fall 2026)

- [ ] Set the confirmed release date (Steam wants it locked in advance)
- [ ] Final build uploaded to the default branch; demo stays up
- [ ] Launch → wishlist owners get the auto-notification email
- [ ] Launch-week: post the "it's out" clip everywhere, thank early players
- [ ] Watch the first-48h reviews; hotfix fast if anything surfaces

---

## Fallback path (if KYC drags)

If verification slips into **September** and a fall launch would mean rushing:

- Hold and target the **February 2027 Steam Next Fest** instead
  (submission deadlines land ~Jan–Feb; the fest is a single-use, one-time card
  worth doing *right* rather than rushed)
- Store page still goes live the moment KYC clears — wishlists accumulate the
  whole time regardless
- Launch **spring 2027**, riding the Next Fest wishlist spike

Decision point: if the store page can't be live and polished by **early
September**, switch to the fallback rather than launch cold.

---

## What I need from you

1. **Tell me the day KYC clears** — that's T+0, the trigger for everything.
2. **App ID + Depot ID** as soon as the app exists — unlocks the SteamPipe
   config and the `STEAM_URL` wiring.
3. A yes/no on skipping October Next Fest vs. holding for February — we can
   decide once we see how fast KYC moves.

Everything else on the game/build/assets side is already done or in my court.
