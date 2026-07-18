/* ============================================================
   BREACH — the run/campaign engine (pure functions over data)
   Manages a whole storyline as a branching MAP: you move node to
   node, your choices commit you to a route, run-level Heat climbs,
   the deck persists. The single-breach engine handles the actual
   hacking; results flow back here.
   ============================================================ */

import type { BreachResult, Campaign, EventChoice, EventDef, HuntPressure, MapNode, RunEvent, RunState } from "./types.ts";
import { CAMPAIGNS } from "./campaigns.ts";
import { rollModifier } from "./modifiers.ts";
import { GENERIC_EVENTS } from "./events.ts";
import { aggregateImplants } from "./implants.ts";
import { threatEffects } from "./threat.ts";
import { getHacker } from "./hackers.ts";
import { shuffle } from "./rng.ts";

const LOSE_HEAT = 25; // Heat spike for getting detected on a job

export function getCampaign(id: string): Campaign {
    return CAMPAIGNS[id] || CAMPAIGNS[Object.keys(CAMPAIGNS)[0]];
}

/* ---- the watcher's bite: run Heat makes breaches harder ---- */
/** How hard the watcher is pressing, from the current trace (Heat). This
    is applied to every breach you START while at that heat, so pushing loud
    makes each job tougher — and lying low (safehouses) buys it back. */
export function huntPressure(heat: number, heatMax: number, offset = 0): HuntPressure {
    const f = heat / Math.max(1, heatMax);
    if (f >= 0.85 - offset) return { tier: 3, label: "HUNTED · critical", blurb: "The watcher is on top of you — targets start alert, reinforced, and patching fast.", detectionStartFrac: 0.22, creepDelta: 2, strengthDelta: 1 };
    if (f >= 0.65 - offset) return { tier: 2, label: "HUNTED · hot", blurb: "Live intel is reaching your targets — systems start alert and patch faster.", detectionStartFrac: 0.16, creepDelta: 1 };
    if (f >= 0.40 - offset) return { tier: 1, label: "HUNTED · warm", blurb: "The watcher warned your targets — you start each breach a little exposed.", detectionStartFrac: 0.10 };
    return { tier: 0, label: "", blurb: "" };
}

export const HUNT_ACTION_LINES: Record<number, string> = {
    1: "the trace is warm now. i've made some calls ahead — expect a warmer welcome.",
    2: "i'm feeding them everything as you move. they'll be alert before you even arrive.",
    3: "i'm right behind you now. every door from here is watched, reinforced, and waiting.",
};

/** After Heat changes, escalate (or relax) the watcher and, on a rise,
    fire an incoming transmission announcing what it's doing to you. */
function applyHeatWatcher(run: RunState) {
    const tier = huntPressure(run.heat, run.heatMax, threatEffects(run.threat).huntOffset).tier;
    if (tier > run.huntTier) {
        run.huntTier = tier;
        const ant = getCampaign(run.campaignId).antagonist;
        if (ant && HUNT_ACTION_LINES[tier]) {
            run.transmission = HUNT_ACTION_LINES[tier];
            run.story.push(`⌁ ${ant.name}: ${HUNT_ACTION_LINES[tier]}`);
        }
    } else if (tier < run.huntTier) {
        run.huntTier = tier;
        run.story.push("› You go quiet. The trace cools — the watcher loses ground, for now.");
    }
}

export function getNode(campaign: Campaign, id: string | null): MapNode | null {
    if (!id) return null;
    return campaign.map.find((n) => n.id === id) || null;
}

export function createRun(campaignId: string, seed = 1, threat = 0, hackerId = "wraith"): RunState {
    const c = getCampaign(campaignId);
    const hacker = getHacker(hackerId);
    const eff = threatEffects(threat);
    const heatMax = Math.max(30, Math.round(c.heatMax * eff.heatMaxMul));
    // Roll a per-run modifier onto every breach so the map plays differently
    // each run. Deterministic from the seed for testability.
    const rngState = { rng: seed >>> 0 };
    const mods: Record<string, string> = {};
    for (const n of c.map) if (n.type === "breach") mods[n.id] = rollModifier(rngState, n);
    // Deal each event node a fresh event this run — from the shared deck plus
    // this campaign's own signature events, so what you meet between jobs varies.
    const eventNodes = c.map.filter((n) => n.type === "event");
    const signature: EventDef[] = eventNodes.map((n) => ({ id: n.id, title: n.title, blurb: n.blurb, choices: n.choices || [] }));
    const pool = shuffle(rngState, [...signature, ...GENERIC_EVENTS]);
    const events: Record<string, RunEvent> = {};
    eventNodes.forEach((n, i) => { const e = pool[i % pool.length]; events[n.id] = { title: e.title, blurb: e.blurb, choices: e.choices }; });
    const run: RunState = {
        campaignId: c.id,
        hackerId: hacker.id,
        threat,
        seed: seed >>> 0,
        heat: Math.round(eff.startHeatFrac * heatMax),
        heatMax,
        credits: 0,
        deck: hacker.deck.slice(),
        nodeId: null,
        path: [],
        mods,
        events,
        implants: [],
        huntTier: 0,
        stats: { breaches: 0, quietestPct: null, loudestPct: null },
        story: [c.intro],
        outcome: "running",
        jobsDone: 0,
        transmission: null,
    };
    // the watcher notices you the moment you start (offered the col-0 nodes)
    if (c.antagonist && c.antagonist.lines[0]) {
        run.transmission = c.antagonist.lines[0];
        run.story.push(`⌁ ${c.antagonist.name}: ${c.antagonist.lines[0]}`);
    }
    return run;
}

/** Dismiss the current incoming transmission. */
export function clearTransmission(prev: RunState): RunState {
    const run = clone(prev);
    run.transmission = null;
    return run;
}

/** A terminal node (nothing downstream) is a finale. */
export function isTerminal(node: MapNode): boolean {
    return node.next.length === 0;
}

/** Are we sitting on the finale (the only thing left to pick is terminal)? */
export function atFinale(run: RunState): boolean {
    const opts = currentOptions(run);
    return opts.length > 0 && opts.every(isTerminal);
}

/** The node options you can choose from right now. */
export function currentOptions(run: RunState): MapNode[] {
    const c = getCampaign(run.campaignId);
    if (!run.nodeId) return c.entryIds.map((id) => getNode(c, id)!).filter(Boolean);
    const cur = getNode(c, run.nodeId);
    if (!cur) return [];
    return cur.next.map((id) => getNode(c, id)!).filter(Boolean);
}

function clone(run: RunState): RunState {
    return structuredClone(run);
}

function checkHeat(run: RunState) {
    if (run.heat >= run.heatMax) {
        run.heat = run.heatMax;
        run.outcome = "busted";
        run.story.push("⚠ THE TRACE COMPLETED. You've been made.");
    }
}

/** Move onto a node (record it as the current position + on the path).
    If the campaign has a watcher, broadcast the line for the depth you're
    now being offered — so the menace escalates as the finale nears. */
function moveTo(run: RunState, node: MapNode) {
    const c = getCampaign(run.campaignId);
    run.nodeId = node.id;
    run.path.push(node.id);
    const ant = c.antagonist;
    if (!ant || node.next.length === 0) return; // no watcher, or you just cleared the finale
    const nextNode = getNode(c, node.next[0]);
    const offeredCol = nextNode ? nextNode.col : node.col + 1;
    if (ant.lines[offeredCol]) {
        run.transmission = ant.lines[offeredCol];
        run.story.push(`⌁ ${ant.name}: ${ant.lines[offeredCol]}`);
    }
}

/** Apply the result of a breach job. */
export function resolveBreach(prev: RunState, node: MapNode, result: BreachResult): RunState {
    const run = clone(prev);
    const finale = isTerminal(node);
    if (result.won) {
        run.jobsDone += 1;
        const pct = Math.round((result.detection / Math.max(1, result.detectionMax)) * 100);
        run.stats.breaches += 1;
        run.stats.quietestPct = run.stats.quietestPct == null ? pct : Math.min(run.stats.quietestPct, pct);
        run.stats.loudestPct = run.stats.loudestPct == null ? pct : Math.max(run.stats.loudestPct, pct);
        const loudness = Math.round((result.detection / Math.max(1, result.detectionMax)) * 12);
        const gained = 4 + loudness;
        run.heat += gained;
        const bonusCredits = aggregateImplants(run.implants).creditsPerBreach;
        run.credits += (node.reward || 20) + bonusCredits;
        run.story.push(`✓ ${node.title} — data secured. +${(node.reward || 20) + bonusCredits}cr. The job raised the trace by ${gained}.`);
        moveTo(run, node);
        if (finale) {
            run.outcome = "won";
            run.story.push(getCampaign(run.campaignId).winText);
        }
    } else {
        run.heat += LOSE_HEAT;
        run.story.push(`✗ ${node.title} — you were detected and had to bail. No payout. The trace jumped +${LOSE_HEAT}.`);
        if (!finale) moveTo(run, node); // a blown normal job still moves you down the map
        // finale failure: you stay put and may retry (Heat permitting)
    }
    applyHeatWatcher(run);
    checkHeat(run);
    return run;
}

/** Apply an event choice. */
export function resolveEvent(prev: RunState, node: MapNode, choice: EventChoice): RunState {
    const run = clone(prev);
    if (choice.cost) run.credits = Math.max(0, run.credits - choice.cost);
    if (choice.credits) run.credits += choice.credits;
    if (choice.heat) run.heat += choice.heat;
    run.heat = Math.max(0, run.heat);
    if (choice.addCard) run.deck.push(choice.addCard);
    run.story.push(`› ${choice.outcome}`);
    checkHeat(run);
    if (run.outcome === "running") moveTo(run, node);
    applyHeatWatcher(run);
    return run;
}

/** Take a safehouse: cool the trace, no pay. */
export function resolveSafehouse(prev: RunState, node: MapNode): RunState {
    const run = clone(prev);
    run.heat = Math.max(0, run.heat - (node.heatRelief || 20));
    run.story.push(`› ${node.title} — you go dark for a while. The trace cools by ${node.heatRelief || 20}.`);
    moveTo(run, node);
    applyHeatWatcher(run);
    return run;
}

/** Deck edits (from rewards / contacts). These do NOT move you on the map. */
export function addCard(prev: RunState, cardId: string): RunState {
    const run = clone(prev);
    run.deck.push(cardId);
    return run;
}
export function addImplant(prev: RunState, implantId: string): RunState {
    const run = clone(prev);
    if (!run.implants.includes(implantId)) run.implants.push(implantId);
    return run;
}
export function removeCard(prev: RunState, cardId: string): RunState {
    const run = clone(prev);
    const i = run.deck.indexOf(cardId);
    if (i >= 0) run.deck.splice(i, 1);
    return run;
}
