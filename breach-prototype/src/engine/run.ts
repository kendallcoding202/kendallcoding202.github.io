/* ============================================================
   BREACH — the run/campaign engine (pure functions over data)
   Manages a whole storyline as a branching MAP: you move node to
   node, your choices commit you to a route, run-level Heat climbs,
   the deck persists. The single-breach engine handles the actual
   hacking; results flow back here.
   ============================================================ */

import type { BreachResult, Campaign, EventChoice, MapNode, RunState } from "./types.ts";
import { CAMPAIGNS } from "./campaigns.ts";
import { STARTER_DECK } from "./cards.ts";

const LOSE_HEAT = 25; // Heat spike for getting detected on a job

export function getCampaign(id: string): Campaign {
    return CAMPAIGNS[id] || CAMPAIGNS[Object.keys(CAMPAIGNS)[0]];
}

export function getNode(campaign: Campaign, id: string | null): MapNode | null {
    if (!id) return null;
    return campaign.map.find((n) => n.id === id) || null;
}

export function createRun(campaignId: string): RunState {
    const c = getCampaign(campaignId);
    const run: RunState = {
        campaignId: c.id,
        heat: 0,
        heatMax: c.heatMax,
        credits: 0,
        deck: STARTER_DECK.slice(),
        nodeId: null,
        path: [],
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
        const loudness = Math.round((result.detection / Math.max(1, result.detectionMax)) * 12);
        const gained = 4 + loudness;
        run.heat += gained;
        run.credits += node.reward || 20;
        run.story.push(`✓ ${node.title} — data secured. +${node.reward || 20}cr. The job raised the trace by ${gained}.`);
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
    return run;
}

/** Take a safehouse: cool the trace, no pay. */
export function resolveSafehouse(prev: RunState, node: MapNode): RunState {
    const run = clone(prev);
    run.heat = Math.max(0, run.heat - (node.heatRelief || 20));
    run.story.push(`› ${node.title} — you go dark for a while. The trace cools by ${node.heatRelief || 20}.`);
    moveTo(run, node);
    return run;
}

/** Deck edits (from rewards / contacts). These do NOT move you on the map. */
export function addCard(prev: RunState, cardId: string): RunState {
    const run = clone(prev);
    run.deck.push(cardId);
    return run;
}
export function removeCard(prev: RunState, cardId: string): RunState {
    const run = clone(prev);
    const i = run.deck.indexOf(cardId);
    if (i >= 0) run.deck.splice(i, 1);
    return run;
}
