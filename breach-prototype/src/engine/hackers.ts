/* ============================================================
   BREACH — OPERATORS (playable hackers) as DATA
   Each operator is an identity: a curated starting deck built
   around one of the synergy archetypes, plus a signature passive
   (reuses the implant loadout system). Personality and style are
   flavor; the deck + passive are the mechanical fingerprint.
   ============================================================ */

import type { ImplantLoadout } from "./implants.ts";

export interface Hacker {
    id: string;
    name: string;
    glyph: string; // a mark for the dossier
    style: string; // one-line archetype tag
    tagline: string;
    bio: string;
    quote: string;
    passiveName: string;
    passiveBlurb: string;
    passive: Partial<ImplantLoadout>;
    deck: string[];
}

// Every operator shares this core so each deck can still recon, attack, and
// stay a little quiet — then the archetype package on top gives it identity.
const BASE = ["portScan", "portScan", "passiveRecon", "packetSniffer", "knownExploit", "scriptKiddie", "polymorph", "logWipe"];

const HACKER_LIST: Hacker[] = [
    {
        id: "wraith",
        name: "WRAITH",
        glyph: "🎭",
        style: "Silent · stealth",
        tagline: "In, precise, gone.",
        bio: "Never triggers an alarm, never leaves a log. Treats a breach like surgery — into the system and out again before it finishes booting a response.",
        quote: "You'll never know I was here.",
        passiveName: "Ghostwalk",
        passiveBlurb: "The first card you play each turn makes no noise.",
        passive: { firstCardSilent: true },
        // A true stealth kit: heavy on evasion, light on raw firepower. WRAITH
        // stays invisible but must DRAFT the muscle to crack the deep systems —
        // it can't out-remove a Black Site on its starter alone.
        deck: [...BASE, "goDark", "coverTracks", "misdirect", "proxyChain", "feint", "spoof", "rootkit", "ghostProtocol", "blindSpot", "enumerate", "firewallBypass", "idsEvasion", "zeroDay"],
    },
    {
        id: "torch",
        name: "TORCH",
        glyph: "🔥",
        style: "Loud · brute force",
        tagline: "Kick the door off the hinges.",
        bio: "Dares the trace to keep up. Loud, fast, and hits like a freight train — subtlety is for people who lose. Manages the noise by simply moving faster than the alarm.",
        quote: "Knock knock.",
        passiveName: "Live Wire",
        passiveBlurb: "Every exploit hits +1 harder — and you move so fast the alarm lags: every card makes 1 less noise.",
        // The loud operator was drowning in its own detection. Live Wire now
        // also shaves noise, so brute force stays survivable deep in — TORCH
        // outruns the trace instead of getting buried by it.
        passive: { exploitFlatBonus: 1, noiseReduction: 1 },
        deck: [...BASE, "bruteForce", "bruteForce", "overload", "overload", "empBurst", "momentum", "cascade", "firewallBypass", "idsEvasion", "sqlInjection", "goDark", "automate", "killSwitch", "precisionStrike", "knownExploit", "zeroDay"],
    },
    {
        id: "hex",
        name: "HEX",
        glyph: "🕷",
        style: "Decay · logic bombs",
        tagline: "It's already inside.",
        bio: "Doesn't break systems — infects them. Plants quiet rot and walks away while the target decays from within. Patience is the weapon; the kill happens on a timer.",
        quote: "Let it spread.",
        passiveName: "Necrosis",
        passiveBlurb: "Your logic bombs tick +2 harder — patient rot that really bites.",
        // +2 per tick makes the slow-decay plan a real payoff without the extra
        // breach-draw velocity, which (once a pilot actually cashes bombs in with
        // Detonate) pushed HEX from the weakest operator to the strongest.
        passive: { bombBonus: 2 },
        deck: [...BASE, "logicBomb", "logicBomb", "contagion", "detonate", "trojan", "backdoor", "goDark", "coverTracks", "enumerate", "firewallBypass", "idsEvasion", "momentum", "analyze", "proxyChain", "patchScanner", "zeroDay"],
    },
    {
        id: "byte",
        name: "BYTE",
        glyph: "⚡",
        style: "Combo · draw",
        tagline: "Watch this. Watchthiswatchthis—",
        bio: "Runs on caffeine and a hundred scripts a minute. Chains play after play into cascading combos — when the engine's spinning, nothing holds. When it stalls, everything does.",
        quote: "One more card, I swear.",
        passiveName: "Caffeine",
        passiveBlurb: "Draw one extra card every turn.",
        passive: { handSize: 1 },
        // The extra card already makes BYTE the most consistent operator, so its
        // starter runs leaner on premium removal — the engine is the payoff, not
        // a stacked toolkit. Draft the finishers you want.
        deck: [...BASE, "automate", "automate", "dataSiphon", "cascade", "chainReaction", "overclock", "packetSniffer", "spoof", "coverTracks", "firewallBypass", "idsEvasion", "momentum", "zeroDay"],
    },
];

export const HACKERS: Record<string, Hacker> = Object.fromEntries(HACKER_LIST.map((h) => [h.id, h]));
export const HACKER_ORDER: string[] = HACKER_LIST.map((h) => h.id);
export function getHacker(id: string): Hacker {
    return HACKERS[id] || HACKER_LIST[0];
}
