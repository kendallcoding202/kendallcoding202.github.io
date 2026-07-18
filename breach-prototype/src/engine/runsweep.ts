/* Full-CAMPAIGN balance sweep per operator: plays whole runs with heat, hunt
   pressure, modifiers and events all live — the real player experience.
   Run: node --experimental-strip-types src/engine/runsweep.ts */
import type { Action, BreachResult, MapNode } from "./types.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { chooseAction } from "./ai.ts";
import { getModifier } from "./modifiers.ts";
import { combineLoadouts, aggregateImplants, IMPLANT_ORDER } from "./implants.ts";
import { getHacker, HACKER_ORDER } from "./hackers.ts";
import { threatEffects } from "./threat.ts";
import {
    createRun, currentOptions, isTerminal, resolveBreach, resolveEvent, resolveSafehouse,
    getCampaign, huntPressure, addCard, addImplant,
} from "./run.ts";
import { REWARD_POOL } from "./campaigns.ts";

/** Play one breach node headlessly with the smart AI; return the result. */
function playBreach(run: any, node: MapNode, seed: number): BreachResult {
    const hacker = getHacker(run.hackerId);
    const hunt = huntPressure(run.heat, run.heatMax, threatEffects(run.threat).huntOffset);
    const mod = getModifier(run.mods[node.id]);
    const loadout = combineLoadouts(hacker.passive, aggregateImplants(run.implants));
    let s = createInitialState(seed, node.systemKey || "homeServer", run.deck.slice(), mod, hunt, loadout, threatEffects(run.threat));
    let guard = 0;
    while (s.outcome === "playing" && guard++ < 600) {
        const a: Action = chooseAction(s, true);
        const before = s;
        s = applyAction(s, a);
        if (s === before && a.type !== "endTurn") s = applyAction(s, { type: "endTurn" });
    }
    return { won: s.outcome === "won", detection: s.detection, detectionMax: s.detectionMax };
}

/** Greedily pick the next map node. Prefer safehouses when hot, else the
    lowest-reward (safest) breach, else an event. A simple but reasonable player. */
function pickNode(run: any, opts: MapNode[]): MapNode {
    const hot = run.heat / run.heatMax > 0.6;
    if (hot) { const safe = opts.find((o) => o.type === "safehouse"); if (safe) return safe; }
    const breaches = opts.filter((o) => o.type === "breach");
    if (breaches.length) return breaches.reduce((a, b) => ((a.reward || 20) <= (b.reward || 20) ? a : b));
    return opts[0];
}

function playRun(campaignId: string, hackerId: string, seed: number): boolean {
    let run = createRun(campaignId, seed, 0, hackerId);
    let rng = (seed * 2654435761) >>> 0;
    const nextRnd = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
    let guard = 0;
    while (run.outcome === "running" && guard++ < 40) {
        const opts = currentOptions(run);
        if (!opts.length) break;
        const node = pickNode(run, opts);
        if (node.type === "breach") {
            const res = playBreach(run, node, seed * 131 + guard);
            run = resolveBreach(run, node, res);
            // draft a reward after a win — ~40% a random implant, else a random
            // pool card — mirroring the in-game reward flow, to exercise the whole
            // pool + implant set rather than a curated pick
            if (res.won && run.outcome === "running") {
                const free = IMPLANT_ORDER.filter((i) => !run.implants.includes(i));
                if (free.length && nextRnd() < 0.4) run = addImplant(run, free[Math.floor(nextRnd() * free.length)]);
                else run = addCard(run, REWARD_POOL[Math.floor(nextRnd() * REWARD_POOL.length)]);
            }
            // finale retry: if we failed the finale and still alive, loop tries again
            if (!res.won && isTerminal(node) && run.outcome === "running") { /* retry next loop */ }
        } else if (node.type === "event") {
            const ev = run.events[node.id];
            // pick the first choice we can afford; prefer heat-lowering
            const choices = (ev?.choices || []).filter((c) => !c.requiresCredits || run.credits >= c.requiresCredits);
            const choice = choices.sort((a, b) => (a.heat || 0) - (b.heat || 0))[0] || (ev?.choices || [])[0];
            run = choice ? resolveEvent(run, node, choice) : resolveSafehouse(run, node);
        } else {
            run = resolveSafehouse(run, node);
        }
    }
    return run.outcome === "won";
}

const N = 600;
const CAMPAIGNS = [["burn", "Burn (short)"], ["ghost", "Ghost (med)"], ["daylight", "Daylight (med)"], ["oracle", "Oracle (long)"]] as const;
const pad = (x: string, w: number) => x.padEnd(w);
console.log(`\n=== FULL-RUN BALANCE: campaign win% per operator (${N} runs each) ===`);
console.log(pad("operator", 10) + CAMPAIGNS.map((c) => pad(c[1], 15)).join(""));
for (const hid of HACKER_ORDER) {
    const h = getHacker(hid);
    const row = CAMPAIGNS.map(([cid]) => {
        let w = 0;
        for (let i = 0; i < N; i++) if (playRun(cid, hid, i + 1)) w++;
        return pad((100 * w / N).toFixed(0) + "%", 15);
    });
    console.log(pad(h.name, 10) + row.join(""));
}
