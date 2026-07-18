/* Per-card play-rate instrument: how often the smart AI plays a card when it's
   in hand. Low rate = dead/situational; ~always = auto-include.
   Run: node --experimental-strip-types src/engine/cardsweep.ts */
import type { Action } from "./types.ts";
import { createInitialState, applyAction } from "./engine.ts";
import { chooseAction } from "./ai.ts";
import { CARDS } from "./cards.ts";
import { SYSTEM_ORDER } from "./systems.ts";

const ALL = Object.keys(CARDS);
// a broad deck: two of everything, so the AI sees every card often
const DECK = [...ALL, ...ALL];
const seen: Record<string, number> = {};
const played: Record<string, number> = {};
for (const c of ALL) { seen[c] = 0; played[c] = 0; }

const N = 500;
for (const sys of SYSTEM_ORDER) {
    for (let i = 0; i < N; i++) {
        let s = createInitialState(i + 1, sys, DECK.slice());
        let guard = 0;
        while (s.outcome === "playing" && guard++ < 400) {
            for (const c of s.hand) if (seen[c] !== undefined) seen[c]++;
            const a: Action = chooseAction(s, true);
            if (a.type === "playCard" && played[a.card] !== undefined) played[a.card]++;
            const before = s;
            s = applyAction(s, a);
            if (s === before && a.type !== "endTurn") s = applyAction(s, { type: "endTurn" });
        }
    }
}
const rows = ALL.map((c) => ({ c, kind: CARDS[c].kind, seen: seen[c], played: played[c], rate: seen[c] ? played[c] / seen[c] : 0 }))
    .sort((a, b) => a.rate - b.rate);
const pad = (x: string, w: number) => x.padEnd(w);
console.log(`\n=== CARD PLAY-RATE (smart AI, all systems, ${N} each) — lowest first ===`);
console.log(pad("card", 16) + pad("kind", 9) + pad("play-rate", 11) + "(played/seen)");
for (const r of rows) console.log(pad(r.c, 16) + pad(r.kind, 9) + pad((100 * r.rate).toFixed(0) + "%", 11) + `(${r.played}/${r.seen})`);
