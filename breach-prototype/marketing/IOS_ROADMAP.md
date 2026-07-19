# BREACH — iOS / iPad roadmap (later, not now)

BREACH is a web app, so shipping to iOS is a **Capacitor** wrap of the *same* codebase — the mobile analogue of what Tauri does for the Steam desktop build. This doc is the ready-to-go plan for when the time is right.

## When to pull this trigger
**After** Steam has traction (good reviews + a real player base), not before. PC-first → reputation → mobile port to a waiting audience is how the genre's hits (Slay the Spire, Monster Train, Inscryption) did it. Target **iPad first** — the screen suits a text-heavy deckbuilder far better than a phone.

## What it costs / needs
- **Apple Developer Program:** $99/year (recurring).
- **A Mac + Xcode** to build and submit (unavoidable for iOS). GitHub Actions has **macOS runners**, so CI is possible later, but the first submission is smoothest on a real Mac.
- No engine rewrite — the game code is untouched.

## The Capacitor path (rough steps)
1. `cd breach-prototype && npm i @capacitor/core @capacitor/cli && npx cap init BREACH com.kendallcoding.breach`
2. `npm i @capacitor/ios && npx cap add ios`
3. Point Capacitor at the Vite build output — set `webDir: "dist"` in `capacitor.config.ts`.
4. `npm run build && npx cap copy ios` (copies the web build into the iOS shell).
5. `npx cap open ios` → Xcode → set signing team, bundle id, icons/launch screen → run on a device/simulator.
6. Archive → upload to **App Store Connect** → submit for review.
> localStorage (our save layer) persists inside the iOS WKWebView, and the `storage.ts` seam means we could later swap in a native/iCloud backend the same way we planned for Steam Cloud.

## Touch-UX checklist (do BEFORE submitting — the real work)
The game was built landscape/keyboard-first; touch needs a pass:
- [ ] **Tap targets ≥ 44px** — cards, defense chips, map nodes, menu buttons.
- [ ] **Card readability** on a small screen — bump font sizes / spacing at mobile breakpoints; consider a tap-to-zoom on a card.
- [ ] **The run map** — pan/pinch or a fitted layout so nodes aren't cramped; the current auto-scroll helps but verify on-device.
- [ ] **No keyboard reliance** — the number-key shortcuts are a bonus, not the only path (already true: everything is tappable). Confirm the arm→target flow feels good by touch.
- [ ] **Landscape lock** (or a graceful portrait layout) — we already have a rotate gate; decide lock vs. support both.
- [ ] **Safe-area insets** — respect the notch / home indicator (`env(safe-area-inset-*)`).
- [ ] **Haptics + sound** — optional polish; Web Audio works in WKWebView after a user gesture.
- [ ] **Remove/relabel desktop-only copy** (e.g., "press 1–9", "Enter ends turn") on the mobile build.

## App Store submission notes
- **Privacy:** the game collects nothing and has no accounts → a simple "Data Not Collected" privacy nutrition label. (The feedback form is copy-to-clipboard, no server — keep it that way and there's nothing to disclose.)
- **No third-party login / no ads / no IAP** for a premium paid app keeps review simpler.
- **Metadata:** reuse `STORE_COPY.md` (trim to App Store limits), `capsules/` for the icon source, `screens/` for screenshots (Apple wants device-sized shots — re-capture at iPad/iPhone resolutions).
- **Pricing:** premium (match Steam) or a free "lite" with the demo's scope. Given mobile's premium-resistance, a **free demo app + paid full app** (mirroring the Steam split we already built) is the safer play.
- Expect **stricter, slower review** than Steam; budget a few days to a couple weeks and possible rejections for UI polish.

## Bottom line
Low-friction later, premature now. Ship and prove it on Steam; when there's an audience, this becomes a weekend of Capacitor setup + a focused touch-UX pass, iPad-first.
