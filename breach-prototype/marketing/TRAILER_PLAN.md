# BREACH — Announce Trailer Plan

A ~60-second cut built entirely from real gameplay. No pre-rendered CG — the terminal aesthetic *is* the hook, so we lean into it. Target: Steam page + wishlist driver. Everything below is capturable from the current build.

## Capture setup (OBS)
- **Canvas / output:** 1920×1080, 60 fps, capture the game in a maximized browser (or the Tauri desktop window) with browser chrome hidden (F11 fullscreen, or Tauri build).
- **Source:** Window Capture on the game. Add a crop so only the game content shows.
- **Audio:** Record the game's synthesized SFX on a separate track (Desktop Audio) so you can duck it under the music. The in-game sounds (card, breach, alert, transmission) are the trailer's texture — keep them.
- **Recording format:** MKV, then remux to MP4. Encoder: x264, CRF ~16 (near-lossless; Steam re-encodes).
- **Steam trailer specs:** upload 1920×1080 H.264 MP4, ≤ ~30 Mbps. Provide a 1-frame-title-safe poster frame too.

## Music
One track, ~60s, dark synthwave / minimal glitch that builds. Cut on the beat. Two royalty-free options to license: a low pulsing bassline that adds a percussive layer at the 0:20 "hook" mark and drops out for the final logo. (Don't ship copyrighted music — Steam trailers get flagged.)

## Shot list (≈60s)

| # | Time | On screen | Capture notes | Text overlay |
|---|------|-----------|---------------|--------------|
| 1 | 0:00–0:04 | Black. A terminal cursor blinks, types `./breach`, "access granted". | Use the capsule prompt look, or screen-record the boot. Hard cut to green flash on "granted". | — |
| 2 | 0:04–0:09 | Operator-select screen slow-pan across the 4 dossiers. | Scroll slowly L→R over WRAITH/TORCH/HEX/BYTE. | **"CHOOSE YOUR OPERATOR"** |
| 3 | 0:09–0:15 | The branching run map, camera drifts along the routes; hover lights up a node. | Move the mouse to scout 2–3 nodes so they glow. | **"EVERY RUN IS A DIFFERENT BREAK-IN"** |
| 4 | 0:15–0:20 | Breach screen: arm a card, the "▸ reveal it first" hint appears, play it, a defense reveals with its type color. | Play 2 cards cleanly. Let the SFX hit. | **"EVERY CARD IS A REAL INTRUSION"** |
| 5 | 0:20–0:24 | THE HOOK: detection bar climbs into SUSPICIOUS → ALERTED; the red "INCOMING TRANSMISSION" box types in a watcher taunt. | This is the money shot. Let the transmission type ~1.5s, keep the red glow. Music adds the bass layer here. | **"THE SYSTEM WATCHES BACK"** |
| 6 | 0:24–0:31 | Fast montage (0.7s each): a logic bomb detonating a whole layer, a silent Ghost play, a big Overload hit, a Chain of plays in one turn. | Pre-record 4 short clips of each archetype's payoff; hard-cut on the beat. | archetype words flash: **GHOST · OVERLOAD · WORM · CHAIN** |
| 7 | 0:31–0:37 | Detection maxes, "LOCKDOWN" — a run goes bad, screen flashes red "YOU'VE BEEN MADE." | Capture a real bust for stakes. | **"GET CAUGHT, AND THE RUN IS OVER"** |
| 8 | 0:37–0:44 | Recover: the final objective layer breaches, "objective exfiltrated. You're a ghost." win text. | Capture a clean finale breach. Let the win SFX ring. | **"OR GET OUT CLEAN"** |
| 9 | 0:44–0:50 | Quick hits of variety: an event card, an implant reward, the Threat Level select, a modifier badge on a job. | 4 × ~1.2s cuts. | **"MODIFIERS · IMPLANTS · THREAT LEVELS"** |
| 10 | 0:50–0:56 | THE TAGLINE SETUP: a quiet lull — no cards fired — then the amber **⊚ TRACE SWEEP** telegraph ticks to "this turn," the detection bar spikes, and the red transmission types **"Silence is a signature. Found you."** | Capture a real sweep: end 2 turns silently so the countdown reads "this turn," then let it fire. This is the beat that earns the tagline — hold the red glow on the line. Music drops to just pulse. | (let the in-game watcher line carry it — no overlay) |
| 11 | 0:56–1:00 | Cut to black → **"Silence is a signature."** types in green, holds a beat → resolves into the BREACH logo capsule (green A) glowing in. "Wishlist now on Steam." | Type the tagline in the game's monospace with the green underline, then dissolve to the `capsule-horizontal.html` render as the end card. | **"Silence is a signature."** → **BREACH** / **WISHLIST NOW** + Steam logo |

## Editing notes
- Keep every cut on-beat; the terminal's monospace + scanlines already read as "hacker," so resist adding filters — a light CRT vignette/curvature is the *only* effect worth adding.
- Color: the game is green-dominant by design; the red transmission + red LOCKDOWN + the red TRACE SWEEP spike are your only warm accents — use them as the emotional beats (shots 5, 7, and the tagline setup in 10).
- The tagline is diegetic: the watcher literally says "Silence is a signature." when the sweep catches you (shot 10). Closing on the same line as the brand card (shot 11) makes the mechanic and the marketing the same promise — don't split them across unrelated shots.
- Text overlays: same monospace font as the game, lower-third, with a 1px green underline that "types" in. Don't cover the play area.
- First 6 seconds must land the genre (deckbuilder) AND the twist (it hunts you) — Steam autoplays muted, so shots 4–5 need to read without audio.

## Deliverables to hand a video editor
- This shot list
- The 5 screenshots in `/screens` as reference frames
- The capsule renders in `/capsules` for the end card
- Raw OBS captures of: one full clean run, one busted run, one clip per archetype payoff (Ghost/Overload/Worm/Chain), and **one "went quiet → TRACE SWEEP spike + watcher line" beat** for the tagline setup (shot 10)

*(I can produce the screenshots and capsule art but cannot render video directly — this plan + the raw captures is everything an editor needs to assemble the cut.)*
