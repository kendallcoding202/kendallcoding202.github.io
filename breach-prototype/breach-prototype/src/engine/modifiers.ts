/* ============================================================
   BREACH — per-run system MODIFIERS (data)
   Rolled onto each breach when a run is generated, so the same
   job plays differently every run. You can SCOUT a node on the map
   to see its modifier and route around the nasty ones. Also the
   main balance lever — the "sloppy/exposed" rolls soften variance.
   ============================================================ */

import type { MapNode, SystemModifier } from "./types.ts";
import { rngInt } from "./rng.ts";

export const MODIFIERS: Record<string, SystemModifier> = {
    clean: { key: "clean", label: "", blurb: "A standard target — no surprises.", tone: "neutral" },

    /* --- harder --- */
    hardened: { key: "hardened", label: "HARDENED", blurb: "Extra-patched — every defense is +2 Strength.", tone: "harder", strengthDelta: 2 },
    fastTrace: { key: "fastTrace", label: "AGGRESSIVE TRACE", blurb: "The trace climbs faster here (+2 per turn).", tone: "harder", creepDelta: 2 },
    onAlert: { key: "onAlert", label: "ON ALERT", blurb: "Security's already twitchy — you start at SUSPICIOUS.", tone: "harder", detectionStartFrac: 0.26 },
    fortified: { key: "fortified", label: "FORTIFIED", blurb: "Tougher and tighter — defenses +1, less room before lockout.", tone: "harder", strengthDelta: 1, detectionMaxDelta: -15 },

    /* --- easier --- */
    sloppy: { key: "sloppy", label: "SLOPPY CONFIG", blurb: "Someone cut corners — every defense is −2 Strength.", tone: "easier", strengthDelta: -2 },
    exposed: { key: "exposed", label: "WIDE OPEN", blurb: "Poorly monitored — lots of room before you're detected.", tone: "easier", detectionMaxDelta: 22 },

    /* --- neutral / weird --- */
    unstable: { key: "unstable", label: "UNSTABLE", blurb: "Flaky and loud — defenses −2, but the trace runs +2.", tone: "neutral", strengthDelta: -2, creepDelta: 2 },
};

// Weighted pools by where the breach sits on the map. Entries stay clean
// (warm-ups). Mid-map jobs can be nasty because you can ROUTE AROUND them —
// that's the interesting choice. Pre-finale jobs drop the harshest rolls.
// The finale is FORCED (you can't avoid it), so it stays mostly clean/easier
// and is decided by the deck you built, not a punishing dice roll.
const MID_POOL: string[] = [
    "clean", "clean", "clean",
    "hardened", "hardened", "fastTrace", "fastTrace", "onAlert", "fortified",
    "sloppy", "sloppy", "exposed", "unstable",
];
const LATE_POOL: string[] = [
    "clean", "clean", "clean",
    "hardened", "fastTrace", "fortified",
    "sloppy", "sloppy", "exposed", "unstable",
];
const FINALE_POOL: string[] = [
    "clean", "clean", "clean", "clean", "clean", "clean",
    "fastTrace",
    "sloppy", "sloppy", "exposed", "unstable",
];

/** Roll a modifier key for a breach node using the run's RNG state. */
export function rollModifier(rngState: { rng: number }, node: MapNode): string {
    if (node.col === 0) return "clean"; // entry jobs are warm-ups
    const pool = node.next.length === 0 ? FINALE_POOL : node.col >= 3 ? LATE_POOL : MID_POOL;
    return pool[rngInt(rngState, pool.length)];
}

export function getModifier(key: string | undefined): SystemModifier {
    return MODIFIERS[key || "clean"] || MODIFIERS.clean;
}
