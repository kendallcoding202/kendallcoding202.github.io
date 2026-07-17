/* Headless tests for the run/campaign engine + new card mechanics.
   Run: node --experimental-strip-types src/engine/runsim.ts */

import type { BreachResult, MapNode, RunState } from "./types.ts";
import { CAMPAIGNS, CAMPAIGN_ORDER } from "./campaigns.ts";
import { createRun, currentOptions, isTerminal, resolveBreach, resolveEvent, resolveSafehouse, addCard, getCampaign, huntPressure, HUNT_ACTION_LINES } from "./run.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { SYSTEMS } from "./systems.ts";
import { MODIFIERS, getModifier } from "./modifiers.ts";

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
    check(`${id}: finished at least a couple jobs`, run.jobsDone >= 2);
    check(`${id}: recorded a path`, run.path.length >= 3);
}

/* 1b. Campaigns come in different lengths (short / medium / long). */
{
    const stops = (id: string) => Math.max(...CAMPAIGNS[id].map.map((n) => n.col)) + 1;
    const lens = CAMPAIGN_ORDER.map(stops);
    check("there is a short campaign", lens.some((l) => l <= 3));
    check("there is a longer campaign", lens.some((l) => l >= 6));
    check("campaign lengths actually vary", new Set(lens).size >= 2);
}

/* 1c. Every event node is dealt a well-formed event from the deck. */
for (const id of CAMPAIGN_ORDER) {
    const run = createRun(id, 4242);
    const eventNodes = CAMPAIGNS[id].map.filter((n) => n.type === "event");
    check(`${id}: every event node was dealt an event`, eventNodes.every((n) => !!run.events[n.id] && run.events[n.id].choices.length > 0));
    // different seeds usually deal different events (when there's more than one to draw)
    if (eventNodes.length > 0) {
        const other = createRun(id, 88);
        const same = eventNodes.every((n) => run.events[n.id].title === other.events[n.id].title);
        check(`${id}: event nodes vary across seeds`, eventNodes.length === 1 ? true : !same);
    }
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
    check(`${id}: watcher delivered escalating lines`, seen.size >= 3);
    const allowed = [...c.antagonist!.lines, ...Object.values(HUNT_ACTION_LINES)];
    check(`${id}: every watcher line came from its script or hunt lines`, [...seen].every((l) => allowed.includes(l)));
    check(`${id}: story feed carries the transmissions`, run.story.filter((l) => l.startsWith("⌁")).length >= 3);
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

/* 8. Per-run modifiers: rolled onto every breach, entries stay clean,
      different seeds give different runs, and they apply in the breach. */
{
    const c = getCampaign("ghost");
    const runA = createRun("ghost", 12345);
    const runB = createRun("ghost", 999);
    // every breach node has a modifier key; entries are clean warm-ups
    const breachNodes = c.map.filter((n) => n.type === "breach");
    check("every breach gets a rolled modifier", breachNodes.every((n) => !!runA.mods[n.id]));
    check("entry breaches stay clean", c.map.filter((n) => n.col === 0 && n.type === "breach").every((n) => runA.mods[n.id] === "clean"));
    check("all rolled modifier keys are real", breachNodes.every((n) => !!MODIFIERS[runA.mods[n.id]]));
    // determinism + variety
    const runA2 = createRun("ghost", 12345);
    check("same seed -> same modifiers", JSON.stringify(runA.mods) === JSON.stringify(runA2.mods));
    check("different seeds -> different modifiers (usually)", JSON.stringify(runA.mods) !== JSON.stringify(runB.mods));

    // apply a HARDENED breach: defenses come out stronger than base
    const base = createInitialState(1, "smallBusiness");
    const hard = createInitialState(1, "smallBusiness", undefined, MODIFIERS.hardened);
    check("HARDENED raises every defense's strength", hard.layers[0].defenses[0].strength === base.layers[0].defenses[0].strength + 2);
    check("HARDENED surfaces its label to the UI", hard.modifierLabel === "HARDENED" && hard.modifierTone === "harder");
    // SLOPPY weakens; ON ALERT starts you detected; WIDE OPEN adds room
    const sloppy = createInitialState(1, "smallBusiness", undefined, MODIFIERS.sloppy);
    check("SLOPPY lowers defense strength", sloppy.layers[0].defenses[0].strength < base.layers[0].defenses[0].strength);
    const alert = createInitialState(1, "smallBusiness", undefined, MODIFIERS.onAlert);
    check("ON ALERT starts you partway detected & suspicious", alert.detection > 0 && alert.alert === "SUSPICIOUS");
    const open = createInitialState(1, "smallBusiness", undefined, MODIFIERS.exposed);
    check("WIDE OPEN raises the detection ceiling", open.detectionMax > base.detectionMax);
    check("a clean modifier shows no badge", getModifier("clean").label === "" && createInitialState(1, "homeServer").modifierLabel === null);
}

/* 9. Run stats accumulate for the end-of-run summary. */
{
    let run = createRun("daylight", 7);
    let guard = 0;
    while (run.outcome === "running" && guard++ < 20) {
        const opts = currentOptions(run);
        const node = opts.find((n) => n.type === "breach") || opts[0];
        run = node.type === "breach" ? resolveBreach(run, node, winResult(0.35)) : takeNode(run, node);
    }
    check("stats counted the breaches", run.stats.breaches >= 3);
    check("stats recorded quietest/loudest detection", run.stats.quietestPct != null && run.stats.loudestPct != null && run.stats.quietestPct <= run.stats.loudestPct);
}

/* 10. The watcher BITES: high Heat makes breaches harder, crossing a tier
       fires a transmission, and lying low relaxes the pressure. */
{
    check("hunt: calm at low heat", huntPressure(10, 100).tier === 0);
    check("hunt: warm at ~45%", huntPressure(45, 100).tier === 1);
    check("hunt: hot at ~70%", huntPressure(70, 100).tier === 2);
    check("hunt: critical at ~90%", huntPressure(90, 100).tier === 3);

    const base = createInitialState(1, "smallBusiness");
    const hunted = createInitialState(1, "smallBusiness", undefined, null, huntPressure(90, 100)); // critical
    check("hunt raises starting detection", hunted.detection > base.detection);
    check("hunt speeds the trace", hunted.baselineCreep > base.baselineCreep);
    check("hunt reinforces defenses", hunted.layers[0].defenses[0].strength > base.layers[0].defenses[0].strength);
    check("hunt surfaces a breach badge", hunted.huntLabel != null);
    check("no hunt badge when calm", createInitialState(1, "smallBusiness", undefined, null, huntPressure(10, 100)).huntLabel === null);

    // crossing into a HUNTED tier fires an antagonist transmission
    let run = createRun("ghost", 5);
    run.heat = Math.round(run.heatMax * 0.5); // warm
    const evNode = getCampaign("ghost").map.find((n) => n.type === "event")!;
    const after = resolveEvent(run, evNode, { label: "x", outcome: "considered the offer" });
    check("crossing into HUNTED escalates the watcher", after.huntTier >= 1);
    check("the escalation is transmitted", !!after.transmission && after.story.some((l) => l.startsWith("⌁")));

    // lying low relaxes the watcher
    let hot = createRun("ghost", 6);
    hot.heat = Math.round(hot.heatMax * 0.7); hot.huntTier = 2; // hot
    const safe = getCampaign("ghost").map.find((n) => n.type === "safehouse")!;
    const cooled = resolveSafehouse(hot, safe);
    check("lying low lowers the watcher tier", cooled.huntTier < 2);
}

/* 11. New flexible attacks (no defense-type requirement). */
{
    // Polymorph works on a HIDDEN defense at full power (no reveal needed)
    let p = createInitialState(1, "smallBusiness", ["polymorph"]);
    p.layers[0].defenses[0].strength = 30; p.layers[0].defenses[0].maxStrength = 30;
    const s0 = p.layers[0].defenses[0].strength;
    p = applyAction(p, { type: "playCard", card: "polymorph", target: 0 });
    check("Polymorph hits a hidden defense at full power", s0 - p.layers[0].defenses[0].strength === 5);

    // Precision Strike auto-hits the weakest standing defense with no target
    let pr = createInitialState(2, "smallBusiness", ["precisionStrike"]);
    pr.current = 1; // internal network has two defenses
    pr.layers[1].defenses[0].strength = 12; pr.layers[1].defenses[0].maxStrength = 12;
    pr.layers[1].defenses[1].strength = 4; pr.layers[1].defenses[1].maxStrength = 12; // weakest
    pr = applyAction(pr, { type: "playCard", card: "precisionStrike" });
    check("Precision Strike hits the weakest defense automatically", pr.layers[1].defenses[1].strength === 0 && pr.layers[1].defenses[0].strength === 12);

    // Overload scales with current detection
    let o = createInitialState(3, "smallBusiness", ["overload", "overload"]);
    o.layers[0].defenses[0].strength = 40; o.layers[0].defenses[0].maxStrength = 40;
    o.detection = 30; // +3 to the base 3 => 6
    const os = o.layers[0].defenses[0].strength;
    o = applyAction(o, { type: "playCard", card: "overload", target: 0 });
    check("Overload scales with detection", os - o.layers[0].defenses[0].strength === 6);

    // Momentum scales with breached layers
    let m = createInitialState(4, "homeServer", ["zeroDay", "momentum"]);
    m.layers[1].defenses[0].strength = 30; m.layers[1].defenses[0].maxStrength = 30;
    m = applyAction(m, { type: "playCard", card: "zeroDay", target: 0 }); // breach layer 0 -> current 1, 1 breached
    const ms = m.layers[1].defenses[0].strength;
    m = applyAction(m, { type: "playCard", card: "momentum", target: 0 }); // 3 + 2*1 = 5
    check("Momentum scales with breached layers", ms - m.layers[1].defenses[0].strength === 5);
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
