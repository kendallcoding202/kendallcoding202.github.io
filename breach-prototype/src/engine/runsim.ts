/* Headless tests for the run/campaign engine.
   Run: node --experimental-strip-types src/engine/runsim.ts */

import type { BreachResult, RunNode, RunState } from "./types.ts";
import { CAMPAIGNS, CAMPAIGN_ORDER } from "./campaigns.ts";
import { createRun, currentOptions, isFinale, resolveBreach, resolveEvent, resolveSafehouse, addCard } from "./run.ts";
import { createInitialState } from "./engine.ts";
import { SYSTEMS } from "./systems.ts";

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean) => { cond ? passed++ : failures.push(name); };

const winResult = (loud = 0.3): BreachResult => ({ won: true, detection: Math.round(100 * loud), detectionMax: 100 });
const loseResult = (): BreachResult => ({ won: false, detection: 100, detectionMax: 100 });

// Resolve a single node with a "win everything" strategy; returns new run.
function takeNode(run: RunState, node: RunNode): RunState {
    if (node.type === "breach") return resolveBreach(run, node, winResult());
    if (node.type === "safehouse") return resolveSafehouse(run, node);
    if (node.type === "event") return resolveEvent(run, (node.choices || [])[0]);
    return run;
}

/* 1. Every campaign is completable to a win, and its data is well-formed. */
for (const id of CAMPAIGN_ORDER) {
    const c = CAMPAIGNS[id];
    check(`${id}: has intro/win/busted text`, !!c.intro && !!c.winText && !!c.bustedText);
    check(`${id}: every breach node maps to a real system`, [...c.steps.flat(), c.finale].every((n) => n.type !== "breach" || !!SYSTEMS[n.systemKey || ""]));

    let run = createRun(id);
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        check(`${id}: options available at step`, opts.length > 0);
        // prefer a breach node so we drive toward the finale
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = takeNode(run, node);
    }
    check(`${id}: reaches a win by playing well`, run.outcome === "won");
    check(`${id}: finished a few jobs`, run.jobsDone >= 2);
}

/* 2. Busted path — repeated failures spike Heat past the cap. */
{
    let run = createRun("burn"); // lowest heatMax (85)
    const firstBreach = currentOptions(run).find((n) => n.type === "breach")!;
    let guard = 0;
    while (run.outcome === "running" && guard++ < 30) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = node.type === "breach" ? resolveBreach(run, node, loseResult()) : takeNode(run, node);
    }
    check("repeated detections bust the run", run.outcome === "busted");
    check("busted run reports max heat", run.heat >= run.heatMax);
}

/* 3. Events apply their effects. */
{
    let run = createRun("ghost");
    run.credits = 50;
    const before = run.credits;
    const buy = { label: "buy", outcome: "bought", cost: 20, addCard: "zeroDay" };
    const after = resolveEvent(run, buy);
    check("event spends credits", after.credits === before - 20);
    check("event adds a card to the deck", after.deck.includes("zeroDay"));
    check("event advances the step", after.step === run.step + 1);
}

/* 4. Deck edits & a custom deck flows into a breach. */
{
    let run = createRun("ghost");
    const baseLen = run.deck.length;
    run = addCard(run, "killSwitch");
    check("addCard grows the deck", run.deck.length === baseLen + 1);
    const gs = createInitialState(1, "homeServer", run.deck);
    const totalInBreach = gs.deck.length + gs.hand.length + gs.discard.length;
    check("breach uses the run's deck", totalInBreach === run.deck.length && run.deck.includes("killSwitch"));
}

console.log(`=== RUN-ENGINE ASSERTIONS: ${passed} passed, ${failures.length} failed ===`);
if (failures.length) { failures.forEach((f) => console.log("   ❌ " + f)); process.exit(1); }
else console.log("   ✅ campaigns are completable, bustable, and deck/heat/events all behave");

// A readable sample traversal for eyeballing story flow.
{
    let run = createRun("daylight");
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = takeNode(run, node);
    }
    console.log(`\n=== SAMPLE RUN — Daylight ===`);
    console.log(run.story.slice(0, 2).join("\n"));
    console.log("...");
    console.log(run.story.slice(-3).join("\n"));
    console.log(`--> ${run.outcome.toUpperCase()} · jobs ${run.jobsDone} · heat ${run.heat}/${run.heatMax} · deck ${run.deck.length}`);
}
