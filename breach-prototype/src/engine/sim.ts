/* ============================================================
   BREACH — headless test + balance harness
   Run:  node --experimental-strip-types src/engine/sim.ts
   ============================================================ */

import type { Action, GameState } from "./types.ts";
import { createInitialState, applyAction, currentLayer } from "./engine.ts";
import { chooseAction } from "./ai.ts";
import { SYSTEM_ORDER, SYSTEMS } from "./systems.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
    if (cond) passed++;
    else failures.push(name);
}

function runGame(seed: number, systemKey: string, smart: boolean) {
    let s = createInitialState(seed, systemKey);
    let guard = 0;
    while (s.outcome === "playing" && guard++ < 500) {
        const action: Action = chooseAction(s, smart);
        const before = s;
        s = applyAction(s, action);
        if (s === before && action.type !== "endTurn") s = applyAction(s, { type: "endTurn" });
    }
    const breached = s.layers.filter((l) => l.breached).length;
    return { outcome: s.outcome, turns: s.turn, detection: s.detection, lossReason: s.lossReason, breached, layers: s.layers.length };
}

/* ---------- correctness assertions ---------- */
function assertions() {
    let s = createInitialState(1);
    check("initial hand is 5", s.hand.length === 5);
    check("initial detection 0", s.detection === 0);
    check("4 layers on home server", s.layers.length === 4);
    check("defenses start hidden", s.layers.every((l) => l.defenses.every((d) => !d.typeRevealed)));
    check("system telegraphs an intent", s.systemIntent !== null);
    check("starts idle", s.alert === "IDLE");

    // noise + log wipe
    let t = createInitialState(2);
    t.hand = ["bruteForce", "logWipe"];
    const afterBrute = applyAction(t, { type: "playCard", card: "bruteForce" }); // auto-targets single defense
    check("brute force adds noise", afterBrute.detection >= 16);
    const afterWipe = applyAction(afterBrute, { type: "playCard", card: "logWipe" });
    check("log wipe reduces detection", afterWipe.detection === afterBrute.detection - 8);
    check("purity: original unchanged", t.detection === 0 && t.hand.length === 2);

    // known exploit revealed vs blind
    let r = createInitialState(3);
    r.hand = ["portScan", "knownExploit"];
    const rev = applyAction(applyAction(r, { type: "playCard", card: "portScan" }), { type: "playCard", card: "knownExploit" });
    let b = createInitialState(3);
    b.hand = ["knownExploit"];
    const blind = applyAction(b, { type: "playCard", card: "knownExploit" });
    check("known exploit louder when blind", blind.detection > rev.detection);
    check("known exploit harder when revealed", rev.layers[0].defenses[0].strength < blind.layers[0].defenses[0].strength);

    // rootkit hides the NEXT action
    let k = createInitialState(4);
    k.hand = ["rootkit", "bruteForce"];
    const ar = applyAction(k, { type: "playCard", card: "rootkit" });
    const ah = applyAction(ar, { type: "playCard", card: "bruteForce" });
    check("rootkit hides next action's noise", ah.detection === ar.detection);

    // zero-day breaches a single-defense layer and advances
    let z = createInitialState(5);
    z.hand = ["zeroDay"];
    const az = applyAction(z, { type: "playCard", card: "zeroDay" });
    check("zero-day breaches first layer", az.layers[0].breached === true);
    check("zero-day advances inward", az.current === 1);

    // multi-defense: a layer needs BOTH defenses down
    let m = createInitialState(6, "smallBusiness");
    m.current = 1; // internal network has two defenses
    m.hand = ["zeroDay"];
    const m1 = applyAction(m, { type: "playCard", card: "zeroDay", target: 0 });
    check("layer with 2 defenses not breached after one falls", m1.layers[1].breached === false && m1.current === 1);
    m1.hand = ["zeroDay"];
    const m2 = applyAction(m1, { type: "playCard", card: "zeroDay", target: 1 });
    check("layer breaches once all defenses fall", m2.layers[1].breached === true && m2.current === 2);

    // targeting: exploit needing a target on a multi-defense layer is rejected without one
    let tt = createInitialState(7, "smallBusiness");
    tt.current = 1;
    tt.hand = ["bruteForce"];
    const noTarget = applyAction(tt, { type: "playCard", card: "bruteForce" }); // ambiguous -> rejected
    check("ambiguous target rejected (no-op)", noTarget === tt || noTarget.hand.length === 1);

    // payload gating + win
    let p = createInitialState(8);
    p.objectiveExposed = true;
    p.hand = ["payload"];
    check("payload wins when objective exposed", applyAction(p, { type: "playCard", card: "payload" }).outcome === "won");

    // detection max = loss
    let l = createInitialState(9);
    l.detection = 95;
    l.hand = ["bruteForce"];
    check("maxing detection loses", applyAction(l, { type: "playCard", card: "bruteForce" }).outcome === "lost");

    // alert rises
    let a = createInitialState(10);
    a.detection = 70;
    a.hand = ["passiveRecon"];
    check("alert stage rises with detection", applyAction(a, { type: "playCard", card: "passiveRecon" }).alert === "ALERTED");

    // spoof cancels the telegraphed move
    let sp = createInitialState(11);
    sp.detection = 40;
    sp.hand = ["spoof"];
    const beforeStr = sp.layers[sp.current].defenses[0].strength;
    const spoofed = applyAction(applyAction(sp, { type: "playCard", card: "spoof" }), { type: "endTurn" });
    check("spoof cancels the system's next move", spoofed.layers[spoofed.current].defenses[0].strength <= beforeStr);

    // end turn creeps + redraws
    let en = createInitialState(12);
    en.hand = [];
    const ae = applyAction(en, { type: "endTurn" });
    check("end turn creeps detection", ae.detection === en.baselineCreep);
    check("end turn redraws", ae.hand.length === 5);
}

/* ---------- balance per system, naive vs telegraph-smart ---------- */
function balance(n: number) {
    console.log(`\n=== BALANCE: ${n} breaches per system · naive vs. telegraph-smart AI ===`);
    console.log("system            diff  naive-win  smart-win  avg-turns(smart)");
    for (const key of SYSTEM_ORDER) {
        const sys = SYSTEMS[key];
        let nWins = 0, sWins = 0, sTurns = 0;
        for (let i = 0; i < n; i++) {
            if (runGame(i + 1, key, false).outcome === "won") nWins++;
            const sr = runGame(i + 1, key, true);
            if (sr.outcome === "won") { sWins++; sTurns += sr.turns; }
        }
        const pad = (x: string, w: number) => x.padEnd(w);
        console.log(
            `${pad(sys.name, 18)}${pad(String(sys.difficulty), 6)}${pad((100 * nWins / n).toFixed(0) + "%", 11)}${pad((100 * sWins / n).toFixed(0) + "%", 11)}${(sWins ? sTurns / sWins : 0).toFixed(1)}`,
        );
    }
}

/* ---------- run ---------- */
assertions();
console.log(`=== ASSERTIONS: ${passed} passed, ${failures.length} failed ===`);
if (failures.length) failures.forEach((f) => console.log("   ❌ " + f));
else console.log("   ✅ all engine rules behave as specified");

balance(1500);

console.log(`\n=== SAMPLE BREACH — Corporate Network (seed 42, smart) ===`);
{
    let s = createInitialState(42, "corpNetwork");
    let guard = 0;
    while (s.outcome === "playing" && guard++ < 500) {
        const a = chooseAction(s, true);
        const before = s;
        s = applyAction(s, a);
        if (s === before && a.type !== "endTurn") s = applyAction(s, { type: "endTurn" });
    }
    console.log(s.log.slice(-14).join("\n"));
    console.log(`--> ${s.outcome.toUpperCase()} on turn ${s.turn}, detection ${s.detection}/${s.detectionMax}`);
}

if (failures.length) process.exit(1);
