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
        deck: [...BASE, "goDark", "coverTracks", "misdirect", "proxyChain", "feint", "spoof", "rootkit", "ghostProtocol", "blindSpot", "precisionStrike", "enumerate", "firewallBypass", "idsEvasion", "privEsc", "patchScanner", "zeroDay"],
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
        passiveBlurb: "Every exploit you play hits +1 harder.",
        passive: { exploitFlatBonus: 1 },
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
        passiveBlurb: "Your logic bombs tick +1 harder.",
        passive: { bombBonus: 1 },
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
        deck: [...BASE, "automate", "automate", "dataSiphon", "cascade", "chainReaction", "overclock", "packetSniffer", "spoof", "coverTracks", "firewallBypass", "idsEvasion", "momentum", "precisionStrike", "knownExploit", "zeroDay"],
    },
];

export const HACKERS: Record<string, Hacker> = Object.fromEntries(HACKER_LIST.map((h) => [h.id, h]));
export const HACKER_ORDER: string[] = HACKER_LIST.map((h) => h.id);
export function getHacker(id: string): Hacker {
    return HACKERS[id] || HACKER_LIST[0];
}
