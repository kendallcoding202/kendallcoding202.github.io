/* Headless tests for the run/campaign engine + new card mechanics.
   Run: node --experimental-strip-types src/engine/runsim.ts */

import type { BreachResult, MapNode, RunState } from "./types.ts";
import { CAMPAIGNS, CAMPAIGN_ORDER } from "./campaigns.ts";
import { createRun, currentOptions, isTerminal, resolveBreach, resolveEvent, resolveSafehouse, addCard, getCampaign } from "./run.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { SYSTEMS } from "./systems.ts";

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean) => { cond ? passed++ : failures.push(name); };

const winResult = (loud = 0.3): BreachResult => ({ won: true, detection: Math.round(100 * loud), detectionMax: 100 });
const loseResult = (): BreachResult => ({ won: false, detection: 100, detectionMax: 100 });

// Resolve a single node with a "win everything" strategy; returns new run.
function takeNode(run: RunState, node: MapNode): RunState {
    if (node.type === "breach") return resolveBreach(run, node, winResult());
    if (node.type === "safehouse") return resolveSafehouse(run, node);
    if (node.type === "event") return resolveEvent(run, node, (node.choices || [])[0]);
    return run;
}

/* 1. Every campaign is a well-formed, completable map. */
for (const id of CAMPAIGN_ORDER) {
    const c = CAMPAIGNS[id];
    check(`${id}: has intro/win/busted text`, !!c.intro && !!c.winText && !!c.bustedText);
    check(`${id}: every breach node maps to a real system`, c.map.every((n) => n.type !== "breach" || !!SYSTEMS[n.systemKey || ""]));
    check(`${id}: has entry nodes`, c.entryIds.length > 0 && c.entryIds.every((eid) => c.map.some((n) => n.id === eid)));
    check(`${id}: exactly one terminal (finale)`, c.map.filter(isTerminal).length === 1);
    check(`${id}: all edges resolve`, c.map.every((n) => n.next.every((nx) => c.map.some((m) => m.id === nx))));
    const reachable = new Set<string>(c.entryIds);
    for (let i = 0; i < c.map.length; i++) for (const n of c.map) if (reachable.has(n.id)) n.next.forEach((nx) => reachable.add(nx));
    check(`${id}: every node reachable from an entry`, c.map.every((n) => reachable.has(n.id)));

    let run = createRun(id);
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        check(`${id}: options available while running`, opts.length > 0);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = takeNode(run, node);
    }
    check(`${id}: reaches a win by playing well`, run.outcome === "won");
    check(`${id}: finished several jobs`, run.jobsDone >= 3);
    check(`${id}: recorded a path`, run.path.length >= 4);
}

/* 2. Busted path — repeated failures spike Heat past the cap. */
{
    let run = createRun("burn"); // lowest heatMax (85)
    let guard = 0;
    while (run.outcome === "running" && guard++ < 30) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = node.type === "breach" ? resolveBreach(run, node, loseResult()) : takeNode(run, node);
    }
    check("repeated detections bust the run", run.outcome === "busted");
    check("busted run reports max heat", run.heat >= run.heatMax);
}

/* 3. Route commitment: picking an entry constrains the next options. */
{
    const c = getCampaign("ghost");
    let run = createRun("ghost");
    const entryP = currentOptions(run).find((n) => n.id.endsWith("-P"))!;
    const afterP = takeNode(run, entryP);
    const optIds = currentOptions(afterP).map((n) => n.id).sort();
    check("entry P leads only to its own successors", JSON.stringify(optIds) === JSON.stringify([...entryP.next].sort()));
    check("map choice is real (P and Q differ)", JSON.stringify(c.map.find((n) => n.id.endsWith("-P"))!.next) !== JSON.stringify(c.map.find((n) => n.id.endsWith("-Q"))!.next));
}

/* 4. Events apply their effects and move you along the map. */
{
    let run = createRun("ghost");
    run.credits = 50;
    const node = getCampaign("ghost").map.find((n) => n.type === "event")!;
    const before = run.credits;
    const buy = { label: "buy", outcome: "bought", cost: 20, addCard: "zeroDay" };
    const after = resolveEvent(run, node, buy);
    check("event spends credits", after.credits === before - 20);
    check("event adds a card to the deck", after.deck.includes("zeroDay"));
    check("event moves you onto the node", after.nodeId === node.id && after.path.includes(node.id));
}

/* 5. Every campaign with a watcher transmits — a fresh line on start and
      one more line for each depth reached, escalating toward the finale. */
for (const id of CAMPAIGN_ORDER) {
    const c = CAMPAIGNS[id];
    if (!c.antagonist) continue;
    let run = createRun(id);
    check(`${id}: watcher speaks the moment the run starts`, run.transmission === c.antagonist.lines[0]);
    const seen = new Set<string>([run.transmission!]);
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = takeNode(run, node);
        if (run.transmission) seen.add(run.transmission);
    }
    check(`${id}: watcher delivered several escalating lines`, seen.size >= 4);
    check(`${id}: every watcher line came from its script`, [...seen].every((l) => c.antagonist!.lines.includes(l)));
    check(`${id}: story feed carries the transmissions`, run.story.filter((l) => l.startsWith("⌁")).length >= 4);
}

/* 6. Custom deck flows into a breach. */
{
    let run = createRun("ghost");
    const baseLen = run.deck.length;
    run = addCard(run, "killSwitch");
    check("addCard grows the deck", run.deck.length === baseLen + 1);
    const gs = createInitialState(1, "homeServer", run.deck);
    const totalInBreach = gs.deck.length + gs.hand.length + gs.discard.length;
    check("breach uses the run's deck", totalInBreach === run.deck.length && run.deck.includes("killSwitch"));
}

/* 7. New card mechanics behave in the breach engine. */
{
    // EMP Burst hits every standing defense on the current layer.
    let s = createInitialState(7, "blackSite", ["empBurst", "empBurst"]);
    const before = s.layers[0].defenses.map((d) => d.strength);
    s = applyAction(s, { type: "playCard", card: "empBurst" });
    const after = s.layers[0].defenses.map((d) => d.strength);
    check("EMP Burst damages all defenses on the layer", after.every((v, i) => v < before[i]));

    // Overclock buffs the next exploit; the bonus is consumed once.
    let o = createInitialState(3, "homeServer", ["overclock", "bruteForce", "bruteForce"]);
    o.layers[0].defenses[0].typeRevealed = true;
    o.layers[0].defenses[0].strength = 30; o.layers[0].defenses[0].maxStrength = 30; // avoid clamping at 0
    o = applyAction(o, { type: "playCard", card: "overclock" });
    check("overclock sets an exploit bonus", o.exploitBonus === 3);
    const s0 = o.layers[0].defenses[0].strength;
    o = applyAction(o, { type: "playCard", card: "bruteForce", target: 0 }); // 6 + 3
    check("overclock adds to the next exploit", s0 - o.layers[0].defenses[0].strength === 9);
    check("overclock bonus is spent after one exploit", o.exploitBonus === 0);

    // Logic Bomb ticks at end of turn.
    let b = createInitialState(5, "homeServer", ["logicBomb", "logWipe", "logWipe", "logWipe", "logWipe", "logWipe", "logWipe"]);
    b.layers[0].defenses[0].typeRevealed = true;
    const bs0 = b.layers[0].defenses[0].strength;
    b = applyAction(b, { type: "playCard", card: "logicBomb", target: 0 });
    check("logic bomb is planted, deals no immediate damage", b.layers[0].defenses[0].strength === bs0 && b.bombs.length === 1);
    b = applyAction(b, { type: "endTurn" });
    check("logic bomb ticks the defense down at end of turn", b.layers[0].defenses[0].strength === bs0 - 3);

    // Cascade scales with exploits already played this turn.
    let ch = createInitialState(9, "homeServer", ["scriptKiddie", "scriptKiddie", "cascade"]);
    ch.layers[0].defenses[0].typeRevealed = true;
    ch.layers[0].defenses[0].strength = 30; ch.layers[0].defenses[0].maxStrength = 30; // avoid clamping at 0
    ch = applyAction(ch, { type: "playCard", card: "scriptKiddie", target: 0 }); // exploits=1
    ch = applyAction(ch, { type: "playCard", card: "scriptKiddie", target: 0 }); // exploits=2
    const midStr = ch.layers[0].defenses[0].strength;
    ch = applyAction(ch, { type: "playCard", card: "cascade", target: 0 }); // 3 + 2*2 = 7
    check("cascade scales with combo count", midStr - ch.layers[0].defenses[0].strength === 7);
}

console.log(`=== RUN-ENGINE ASSERTIONS: ${passed} passed, ${failures.length} failed ===`);
if (failures.length) { failures.forEach((f) => console.log("   ❌ " + f)); process.exit(1); }
else console.log("   ✅ maps are well-formed & completable; heat/events/deck/antagonist/new-cards all behave");

// A readable sample traversal for eyeballing the rogue's escalating taunts.
{
    let run = createRun("oracle");
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = takeNode(run, node);
    }
    console.log(`\n=== SAMPLE RUN — Ghost in the Wire (rogue transmissions) ===`);
    console.log(run.story.filter((l) => l.startsWith("⌁")).join("\n"));
    console.log(`--> ${run.outcome.toUpperCase()} · jobs ${run.jobsDone} · heat ${run.heat}/${run.heatMax} · path ${run.path.length} nodes`);
}
