/* ============================================================
   BREACH — THREAT LEVELS (the ascension ladder)
   Beat a campaign and you unlock its next Threat Level. Each level
   stacks one more twist on top of the last, so skilled players have
   a long climb (T0..T10) that keeps the game hard and fresh well
   past the first win. Pure data + a cumulative aggregator.
   ============================================================ */

export const MAX_THREAT = 10;

/** The aggregate difficulty tweaks applied at a given Threat Level. */
export interface ThreatEffects {
    heatMaxMul: number; // <1 = less headroom before the trace busts you
    startHeatFrac: number; // begin each run already this warm
    strengthDelta: number; // every defense +N Strength
    creepDelta: number; // the trace climbs +N faster per turn
    detectionMaxMul: number; // <1 = tighter breaches (less room before lockout)
    huntOffset: number; // the watcher's Heat tiers trigger this much sooner
    leanRewards: boolean; // fewer reward options
}

/** What each level ADDS on top of the previous one (for the UI). */
export const THREAT_STEPS: string[] = [
    "", // T0 — base game
    "The trace runs hotter — 8% less Heat headroom.",
    "Targets are hardened — every defense +1 Strength.",
    "Leaner salvage — one fewer reward option.",
    "The watcher wakes early — its pressure hits 12% sooner.",
    "Faster trace — every breach climbs +1 per turn.",
    "Harder targets — every defense +1 (total +2).",
    "You start warm — begin each run at 15% Heat.",
    "Tighter breaches — 6% less room before lockout.",
    "Relentless watcher — pressure hits another 10% sooner.",
    "The gauntlet — defenses +1 (total +3) and trace +1 (total +2).",
];

/** Compute the cumulative effects for Threat Level `level` (0..MAX_THREAT). */
export function threatEffects(level: number): ThreatEffects {
    const eff: ThreatEffects = {
        heatMaxMul: 1, startHeatFrac: 0, strengthDelta: 0, creepDelta: 0,
        detectionMaxMul: 1, huntOffset: 0, leanRewards: false,
    };
    const n = Math.max(0, Math.min(MAX_THREAT, Math.floor(level)));
    for (let l = 1; l <= n; l++) {
        switch (l) {
            case 1: eff.heatMaxMul -= 0.08; break;
            case 2: eff.strengthDelta += 1; break;
            case 3: eff.leanRewards = true; break;
            case 4: eff.huntOffset += 0.12; break;
            case 5: eff.creepDelta += 1; break;
            case 6: eff.strengthDelta += 1; break;
            case 7: eff.startHeatFrac += 0.15; break;
            case 8: eff.detectionMaxMul -= 0.06; break;
            case 9: eff.huntOffset += 0.10; break;
            case 10: eff.strengthDelta += 1; eff.creepDelta += 1; break;
        }
    }
    return eff;
}

/** A short label for the whole level (shown on the campaign select). */
export function threatLabel(level: number): string {
    if (level <= 0) return "THREAT 0 · standard";
    return `THREAT ${level}`;
}
