/* ============================================================
   BREACH — achievements as DATA
   Pure definitions + a pure evaluator. Each achievement is a
   condition over an AchievementCtx (built at run-end from the run
   plus the persisted profile). The UI layer stores which are
   unlocked and renders them; this file has no side effects.
   ============================================================ */

/** Everything an achievement condition can look at, gathered at run-end. */
export interface AchievementCtx {
    won: boolean;
    campaignId: string;
    hackerId: string;
    threat: number;
    jobsDone: number;
    loudestPct: number | null; // highest detection % on a won breach this run
    quietestPct: number | null; // lowest detection % on a won breach this run
    heatFrac: number; // final Heat / Heat cap
    implantsInstalled: number;
    deckSize: number;
    credits: number;
    // profile-derived (cumulative, AFTER this run is recorded):
    totalWins: number;
    operatorsWonCount: number; // distinct operators with ≥1 win
    campaignsWonCount: number; // distinct campaigns with ≥1 win
}

export interface Achievement {
    id: string;
    name: string;
    desc: string;
    glyph: string;
    check: (c: AchievementCtx) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
    { id: "first_contract", name: "First Contract", glyph: "🎯", desc: "Complete any storyline.", check: (c) => c.won },
    { id: "ghost", name: "Ghost", glyph: "👻", desc: "Win a run where your loudest breach stayed at 25% detection or less.", check: (c) => c.won && c.loudestPct != null && c.loudestPct <= 25 },
    { id: "sledgehammer", name: "Sledgehammer", glyph: "🔨", desc: "Win a run with a breach that hit 90% detection or more — and got out anyway.", check: (c) => c.won && c.loudestPct != null && c.loudestPct >= 90 },
    { id: "clean_exit", name: "Clean Exit", glyph: "🧊", desc: "Finish a winning run with the trace under 20%.", check: (c) => c.won && c.heatFrac < 0.2 },
    { id: "cyborg", name: "Cyborg", glyph: "🦾", desc: "Install 4 or more implants in a single run.", check: (c) => c.implantsInstalled >= 4 },
    { id: "deck_architect", name: "Deck Architect", glyph: "🃏", desc: "Finish a run holding a deck of 30+ cards.", check: (c) => c.deckSize >= 30 },
    { id: "data_broker", name: "Data Broker", glyph: "💰", desc: "End a run with 150 or more credits banked.", check: (c) => c.credits >= 150 },
    { id: "smash_grab", name: "Smash and Grab", glyph: "🚪", desc: "Complete Burn Notice.", check: (c) => c.won && c.campaignId === "burn" },
    { id: "deniable", name: "Deniable", glyph: "🕶️", desc: "Complete Ghost Contract.", check: (c) => c.won && c.campaignId === "ghost" },
    { id: "whistleblower", name: "Whistleblower", glyph: "📰", desc: "Complete Daylight.", check: (c) => c.won && c.campaignId === "daylight" },
    { id: "deicide", name: "Deicide", glyph: "🧠", desc: "Complete Ghost in the Wire — pull the plug on the rogue.", check: (c) => c.won && c.campaignId === "oracle" },
    { id: "full_roster", name: "Full Roster", glyph: "👥", desc: "Win with all four operators.", check: (c) => c.operatorsWonCount >= 4 },
    { id: "grand_slam", name: "Grand Slam", glyph: "🌐", desc: "Win every storyline at least once.", check: (c) => c.campaignsWonCount >= 4 },
    { id: "escalation", name: "Escalation", glyph: "⚠️", desc: "Clear any storyline at Threat 3 or higher.", check: (c) => c.won && c.threat >= 3 },
    { id: "hunted", name: "Hunted", glyph: "🩸", desc: "Clear any storyline at Threat 6 or higher.", check: (c) => c.won && c.threat >= 6 },
    { id: "the_gauntlet", name: "The Gauntlet", glyph: "☠️", desc: "Clear a storyline at Threat 10 — the maximum.", check: (c) => c.won && c.threat >= 10 },
    { id: "apex", name: "Apex Intruder", glyph: "🔺", desc: "Beat Ghost in the Wire at Threat 5 or higher.", check: (c) => c.won && c.campaignId === "oracle" && c.threat >= 5 },
    { id: "veteran", name: "Veteran", glyph: "🎖️", desc: "Complete 10 contracts in total.", check: (c) => c.totalWins >= 10 },
    { id: "legend", name: "Legend", glyph: "🏆", desc: "Complete 25 contracts in total.", check: (c) => c.totalWins >= 25 },
];

/** Which achievement ids the ctx now satisfies (unlocked or not). */
export function satisfiedAchievements(ctx: AchievementCtx): string[] {
    return ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
}

export function getAchievement(id: string): Achievement | undefined {
    return ACHIEVEMENTS.find((a) => a.id === id);
}
