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

// Each operator now runs a fully bespoke deck (no shared core) so the four play
// like different games: WRAITH threads silent, TORCH blitzes loud, HEX plants
// rot, BYTE chains an engine. The passive reinforces that one fantasy.

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
        passiveBlurb: "The first card each turn makes no noise — thread a whole hand through without waking a thing.",
        // A stealth ENGINE: the first card is free noise, and the deck's
        // silent-scaling exploits get lethal the longer you stay unseen.
        passive: { firstCardSilent: true },
        deck: ["quietScan", "passiveRecon", "portScan", "enumerate", "phantomJab", "phantomJab", "phantomJab", "ghostProtocol", "ghostProtocol", "misdirect", "proxyChain", "feint", "rootkit", "deadDrop", "socialEngineer", "analyze", "knownExploit", "precisionStrike", "vanish", "spoof"],
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
        passiveBlurb: "Every exploit hits +2 harder, and every card makes 1 less noise — brute force that outruns the trace.",
        // Pure aggression: overload/power exploits that hit HARDER the louder you
        // already are, so TORCH wants the noise it makes. Race the lockout.
        passive: { exploitFlatBonus: 2, noiseReduction: 1 },
        deck: ["portScan", "packetSniffer", "bruteForce", "bruteForce", "wreckingBall", "overload", "overload", "powerSurge", "shortCircuit", "thermalRunaway", "precisionStrike", "overflow", "empBurst", "momentum", "killSwitch", "goDark", "automate", "knownExploit", "polymorph", "zeroDay"],
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
        passiveBlurb: "Your logic bombs tick +2 harder — rot that eats a system alive on a timer.",
        // Indirect and patient: stack rot on every defense, stay quiet while it
        // ticks (+2), then Detonate for the kill.
        passive: { bombBonus: 2 },
        deck: ["enumerate", "analyze", "passiveRecon", "logicBomb", "logicBomb", "parasite", "incubate", "necroticTouch", "detonate", "contagion", "trojan", "backdoor", "misdirect", "proxyChain", "knownExploit", "polymorph", "precisionStrike", "sqlmap", "socialEngineer", "spoof"],
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
        passiveBlurb: "Draw two extra cards every turn, and breaching a layer draws more — keep the chain spinning.",
        // An engine: relentless draw fuels long turns, and the chain/cascade
        // exploits get bigger with every card you fire — but it needs reliable
        // muscle too, so the starter packs real removal to close.
        passive: { handSize: 2, noiseReduction: 1, breachDraw: true },
        deck: ["packetSniffer", "portScan", "automate", "automate", "macro", "quickHack", "dataSiphon", "chainReaction", "cascade", "overclock", "heuristicEngine", "precisionStrike", "precisionStrike", "bruteForce", "wreckingBall", "sqlmap", "killSwitch", "knownExploit", "polymorph", "zeroDay"],
    },
];

export const HACKERS: Record<string, Hacker> = Object.fromEntries(HACKER_LIST.map((h) => [h.id, h]));
export const HACKER_ORDER: string[] = HACKER_LIST.map((h) => h.id);
export function getHacker(id: string): Hacker {
    return HACKERS[id] || HACKER_LIST[0];
}
