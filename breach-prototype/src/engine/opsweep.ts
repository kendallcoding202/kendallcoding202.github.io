/* Per-operator balance sweep. Run: node --experimental-strip-types src/engine/opsweep.ts */
import type { Action } from "./types.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { chooseAction } from "./ai.ts";
import { SYSTEM_ORDER, SYSTEMS } from "./systems.ts";
import { HACKER_ORDER, getHacker } from "./hackers.ts";
import { combineLoadouts, aggregateImplants } from "./implants.ts";

function runGame(seed: number, systemKey: string, deck: string[], loadout: any) {
    let s = createInitialState(seed, systemKey, deck, null, null, loadout);
    let guard = 0;
    while (s.outcome === "playing" && guard++ < 500) {
        const action: Action = chooseAction(s, true);
        const before = s;
        s = applyAction(s, action);
        if (s === before && action.type !== "endTurn") s = applyAction(s, { type: "endTurn" });
    }
    return { won: s.outcome === "won", turns: s.turn };
}

const N = 1200;
const pad = (x: string, w: number) => x.padEnd(w);
console.log(`\n=== OPERATOR BALANCE: smart-AI win% (${N} each) ===`);
console.log(pad("operator", 10) + SYSTEM_ORDER.map((k) => pad(SYSTEMS[k].name.slice(0, 9), 11)).join(""));
for (const hid of HACKER_ORDER) {
    const h = getHacker(hid);
    const loadout = combineLoadouts(h.passive, aggregateImplants([]));
    const row = SYSTEM_ORDER.map((key) => {
        let w = 0;
        for (let i = 0; i < N; i++) if (runGame(i + 1, key, h.deck.slice(), loadout).won) w++;
        return pad((100 * w / N).toFixed(0) + "%", 11);
    });
    console.log(pad(h.name, 10) + row.join(""));
}
