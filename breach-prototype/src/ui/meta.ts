/* ============================================================
   BREACH — meta-progression (the Operator Profile)
   Persists between runs: campaigns unlocked, Threat Levels cleared,
   total wins. Uses localStorage (persistent in the desktop/Steam
   build); degrades to in-session memory if storage is unavailable.
   ============================================================ */

import { MAX_THREAT } from "../engine/threat.ts";
import { ACHIEVEMENTS, satisfiedAchievements } from "../engine/achievements.ts";
import type { AchievementCtx } from "../engine/achievements.ts";

export interface Profile {
    totalWins: number;
    wins: Record<string, number>; // wins per campaign
    maxThreatCleared: Record<string, number>; // highest Threat Level beaten per campaign (-1 = none)
    operatorWins: Record<string, number>; // wins per operator (for the "all operators" achievement)
    achievements: string[]; // unlocked achievement ids
}

const KEY = "breach_profile";

function fresh(): Profile {
    return { totalWins: 0, wins: {}, maxThreatCleared: {}, operatorWins: {}, achievements: [] };
}

let cache: Profile | null = null;

export function loadProfile(): Profile {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const p = JSON.parse(raw) as Partial<Profile>;
            cache = { totalWins: p.totalWins || 0, wins: p.wins || {}, maxThreatCleared: p.maxThreatCleared || {}, operatorWins: p.operatorWins || {}, achievements: p.achievements || [] };
            return cache;
        }
    } catch { /* storage blocked — fall through to in-memory */ }
    cache = fresh();
    return cache;
}

function save(p: Profile) {
    cache = p;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Record a campaign win at a given Threat Level (unlocks the next). */
export function recordWin(campaignId: string, threat: number, hackerId?: string): Profile {
    const cur = loadProfile();
    const p: Profile = {
        ...cur,
        totalWins: cur.totalWins + 1,
        wins: { ...cur.wins, [campaignId]: (cur.wins[campaignId] || 0) + 1 },
        maxThreatCleared: { ...cur.maxThreatCleared, [campaignId]: Math.max(cur.maxThreatCleared[campaignId] ?? -1, threat) },
        operatorWins: hackerId ? { ...cur.operatorWins, [hackerId]: (cur.operatorWins[hackerId] || 0) + 1 } : cur.operatorWins,
    };
    save(p);
    return p;
}

/** Evaluate achievements at run-end against the CURRENT (already-recorded)
    profile plus this run's stats. Persists any newly earned ones and returns
    their ids so the ending screen can announce them. */
export function syncAchievements(run: Omit<AchievementCtx, "totalWins" | "operatorsWonCount" | "campaignsWonCount">): string[] {
    const p = loadProfile();
    const ctx: AchievementCtx = {
        ...run,
        totalWins: p.totalWins,
        operatorsWonCount: Object.values(p.operatorWins).filter((n) => n > 0).length,
        campaignsWonCount: Object.values(p.wins).filter((n) => n > 0).length,
    };
    const earned = satisfiedAchievements(ctx);
    const fresh = earned.filter((id) => !p.achievements.includes(id));
    if (fresh.length) save({ ...p, achievements: [...p.achievements, ...fresh] });
    return fresh;
}

export function unlockedAchievements(p: Profile = loadProfile()): string[] {
    return p.achievements;
}

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENTS.length;

/** Total wins required to unlock a campaign (a gentle progression arc). */
export function campaignRequirement(campaignId: string): number {
    switch (campaignId) {
        case "burn": return 1; // unlocks after your first win
        case "oracle": return 2; // the epic finale campaign — earn it
        default: return 0; // ghost & daylight are open from the start
    }
}

export function isCampaignUnlocked(campaignId: string, p: Profile = loadProfile()): boolean {
    return p.totalWins >= campaignRequirement(campaignId);
}

/** Highest Threat Level you may select for a campaign = cleared + 1. */
export function availableThreat(campaignId: string, p: Profile = loadProfile()): number {
    const cleared = p.maxThreatCleared[campaignId] ?? -1;
    return Math.max(0, Math.min(MAX_THREAT, cleared + 1));
}

export function maxThreatCleared(campaignId: string, p: Profile = loadProfile()): number {
    return p.maxThreatCleared[campaignId] ?? -1;
}

export function resetProfile(): Profile {
    const p = fresh();
    save(p);
    return p;
}
