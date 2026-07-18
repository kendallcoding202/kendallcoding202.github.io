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

/** What each level ADDS on top of the previous one (for the UI).
    The ladder squeezes the HEAT economy first — less headroom, a warmer
    start, an earlier watcher — and lets the (gradual) hunt system supply the
    on-breach escalation, rather than flatly bombing every breach with creep
    and strength. That keeps T0→T10 a smooth climb instead of a wall at T5. */
export const THREAT_STEPS: string[] = [
    "", // T0 — base game
    "The trace runs hotter — 6% less Heat headroom.",
    "Targets are hardened — every defense +1 Strength.",
    "Leaner salvage — one fewer reward option, and the watcher stirs early.",
    "Less room to breathe — another 5% less Heat headroom.",
    "You start warm — begin each run already at 5% Heat.",
    "Tighter breaches — 5% less room before lockout.",
    "Relentless watcher — its pressure hits 7% sooner.",
    "Harder targets — every defense +1 (total +2).",
    "The net tightens — less headroom and a warmer start (10% Heat).",
    "The gauntlet — the trace climbs +1 per turn and breaches tighten further.",
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
            case 1: eff.heatMaxMul -= 0.06; break;
            case 2: eff.strengthDelta += 1; break;
            case 3: eff.leanRewards = true; eff.huntOffset += 0.06; break;
            case 4: eff.heatMaxMul -= 0.05; break;
            case 5: eff.startHeatFrac += 0.05; break;
            case 6: eff.detectionMaxMul -= 0.05; break;
            case 7: eff.huntOffset += 0.07; break;
            case 8: eff.strengthDelta += 1; break;
            case 9: eff.heatMaxMul -= 0.05; eff.startHeatFrac += 0.05; break;
            case 10: eff.creepDelta += 1; eff.detectionMaxMul -= 0.04; break;
        }
    }
    return eff;
}

/** A short label for the whole level (shown on the campaign select). */
export function threatLabel(level: number): string {
    if (level <= 0) return "THREAT 0 · standard";
    return `THREAT ${level}`;
}
