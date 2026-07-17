/* ============================================================
   BREACH — the run/campaign engine (pure functions over data)
   Manages a whole storyline: route choices, run-level Heat, the
   persistent deck, credits, and win/busted outcomes. The single
   -breach engine handles the actual hacking; results flow back here.
   ============================================================ */

import type { BreachResult, Campaign, EventChoice, RunNode, RunState } from "./types.ts";
import { CAMPAIGNS } from "./campaigns.ts";
import { STARTER_DECK } from "./cards.ts";

const LOSE_HEAT = 25; // Heat spike for getting detected on a job

export function getCampaign(id: string): Campaign {
    return CAMPAIGNS[id] || CAMPAIGNS[Object.keys(CAMPAIGNS)[0]];
}

export function createRun(campaignId: string): RunState {
    const c = getCampaign(campaignId);
    return {
        campaignId: c.id,
        heat: 0,
        heatMax: c.heatMax,
        credits: 0,
        deck: STARTER_DECK.slice(),
        step: 0,
        story: [c.intro],
        outcome: "running",
        jobsDone: 0,
    };
}

/** Are we at the finale (past the last branching step)? */
export function isFinale(run: RunState): boolean {
    const c = getCampaign(run.campaignId);
    return run.step >= c.steps.length;
}

/** The node options to choose from right now (finale is a single option). */
export function currentOptions(run: RunState): RunNode[] {
    const c = getCampaign(run.campaignId);
    if (isFinale(run)) return [c.finale];
    return c.steps[run.step] || [];
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

function advance(run: RunState) {
    // moving off a branching step; finale advancement is handled in resolveBreach
    if (!isFinale(run)) run.step += 1;
}

/** Apply the result of a breach job. */
export function resolveBreach(prev: RunState, node: RunNode, result: BreachResult): RunState {
    const run = clone(prev);
    const finale = isFinale(run);
    if (result.won) {
        run.jobsDone += 1;
        const loudness = Math.round((result.detection / Math.max(1, result.detectionMax)) * 12);
        const gained = 4 + loudness;
        run.heat += gained;
        run.credits += node.reward || 20;
        run.story.push(`✓ ${node.title} — data secured. +${node.reward || 20}cr. The job raised the trace by ${gained}.`);
        if (finale) {
            run.outcome = "won";
            run.story.push(getCampaign(run.campaignId).winText);
        } else {
            advance(run);
        }
    } else {
        run.heat += LOSE_HEAT;
        run.story.push(`✗ ${node.title} — you were detected and had to bail. No payout. The trace jumped +${LOSE_HEAT}.`);
        if (!finale) advance(run); // a blown normal job still moves the clock forward
        // finale failure: you stay on the finale and may retry (heat permitting)
    }
    checkHeat(run);
    return run;
}

/** Apply an event choice. */
export function resolveEvent(prev: RunState, choice: EventChoice): RunState {
    const run = clone(prev);
    if (choice.cost) run.credits = Math.max(0, run.credits - choice.cost);
    if (choice.credits) run.credits += choice.credits;
    if (choice.heat) run.heat += choice.heat;
    run.heat = Math.max(0, run.heat);
    if (choice.addCard) run.deck.push(choice.addCard);
    run.story.push(`› ${choice.outcome}`);
    checkHeat(run);
    if (run.outcome === "running") advance(run);
    return run;
}

/** Take a safehouse: cool the trace, no pay. */
export function resolveSafehouse(prev: RunState, node: RunNode): RunState {
    const run = clone(prev);
    run.heat = Math.max(0, run.heat - (node.heatRelief || 20));
    run.story.push(`› ${node.title} — you go dark for a while. The trace cools by ${node.heatRelief || 20}.`);
    advance(run);
    return run;
}

/** Deck edits (from rewards / contacts). These do NOT advance the step. */
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
