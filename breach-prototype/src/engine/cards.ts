/* ============================================================
   BREACH — card definitions as DATA
   Tuning lives here (noise / power / amount). Adding or balancing
   a card = editing this table, never touching the engine or UI.
   Card text is written to state EXACTLY what happens, in numbers.
   ============================================================ */

import type { CardDef } from "./types.ts";

export const CARDS: Record<string, CardDef> = {
    /* ---------- Recon — reveal hidden defenses so exploits land ---------- */
    portScan: {
        id: "portScan", name: "Port Scan", kind: "recon", noise: 2, effect: "revealOne", needsTarget: true,
        text: "Pick a defense and reveal it — its type and strength. Low noise.",
    },
    passiveRecon: {
        id: "passiveRecon", name: "Passive Recon", kind: "recon", noise: 0, effect: "revealTypeOnly", needsTarget: false,
        text: "Reveal the TYPE of every defense on this layer. Makes no noise at all.",
    },
    enumerate: {
        id: "enumerate", name: "Enumerate", kind: "recon", noise: 4, effect: "revealAll", needsTarget: false,
        text: "Fully reveal this layer AND the next one. Medium noise.",
    },
    socialEngineer: {
        id: "socialEngineer", name: "Social Engineer", kind: "recon", noise: 1, effect: "revealAndWeaken", power: 2, needsTarget: true,
        text: "Pick a defense: reveal it and cut its strength by 2. Low noise.",
    },

    /* ---------- Exploits — knock strength off a defense ---------- */
    knownExploit: {
        id: "knownExploit", name: "Known Exploit", kind: "exploit", noise: 3, power: 4, effect: "knownExploit", needsTarget: true,
        text: "Break 4 off a REVEALED defense. Against a hidden one: only 2 — and much louder.",
    },
    sqlInjection: {
        id: "sqlInjection", name: "SQL Injection", kind: "exploit", noise: 4, power: 5, effect: "sqlInjection", needsTarget: true,
        text: "Break 8 off a DATABASE defense. Against any other type: only 2, and louder.",
    },
    privEsc: {
        id: "privEsc", name: "Privilege Escalation", kind: "exploit", noise: 4, power: 6, effect: "privEsc", needsTarget: true,
        text: "Break 6 off a PRIVILEGE defense. On any other type it misfires — no effect, loud.",
    },
    zeroDay: {
        id: "zeroDay", name: "Zero-Day", kind: "exploit", noise: 12, power: 99, effect: "zeroDay", needsTarget: true, exhausts: true,
        text: "Completely shatter any one defense, whatever its type. Very loud. One use per run.",
    },
    bruteForce: {
        id: "bruteForce", name: "Brute Force", kind: "exploit", noise: 16, power: 6, effect: "bruteForce", needsTarget: true,
        text: "Break 6 off any defense. Extremely loud — a last resort.",
    },

    /* ---------- Stealth — control the detection meter ---------- */
    logWipe: {
        id: "logWipe", name: "Log Wipe", kind: "stealth", noise: 0, amount: 8, effect: "logWipe", needsTarget: false,
        text: "Lower detection by 8. Makes no noise itself.",
    },
    goDark: {
        id: "goDark", name: "Go Dark", kind: "stealth", noise: 0, amount: 6, effect: "goDark", needsTarget: false,
        text: "Lower detection by 6. Best played just before you end a quiet turn.",
    },
    killSwitch: {
        id: "killSwitch", name: "Kill Switch", kind: "stealth", noise: 0, amount: 40, effect: "killSwitch", needsTarget: false, exhausts: true,
        text: "Emergency: lower detection by 40, but discard the rest of your hand. One use per run.",
    },
    proxyChain: {
        id: "proxyChain", name: "Proxy Chain", kind: "stealth", noise: 1, amount: 3, effect: "proxyChain", needsTarget: false,
        text: "Your next 3 cards each make 3 less noise. Set this up before a loud play.",
    },
    spoof: {
        id: "spoof", name: "Spoof", kind: "stealth", noise: 1, effect: "spoof", needsTarget: false,
        text: "Cancel the system's next move — the one shown under SYSTEM ALERT.",
    },

    /* ---------- Utility ---------- */
    rootkit: {
        id: "rootkit", name: "Rootkit", kind: "utility", noise: 1, effect: "rootkit", needsTarget: false,
        text: "Your NEXT card this turn makes zero noise. Great for hiding one loud exploit.",
    },
    backdoor: {
        id: "backdoor", name: "Backdoor", kind: "utility", noise: 1, power: 4, effect: "backdoor", needsTarget: true, exhausts: true,
        text: "Quietly break 4 off a defense — barely a whisper of noise. One use per run.",
    },
    patchScanner: {
        id: "patchScanner", name: "Deep Scan", kind: "utility", noise: 1, effect: "patchScanner", needsTarget: false,
        text: "Fully reveal this layer, plus the types of the next layer's defenses.",
    },
    payload: {
        id: "payload", name: "Payload", kind: "utility", noise: 5, effect: "payload", needsTarget: false,
        text: "Steal the data and WIN — but only works once the objective layer is fully breached.",
    },
};

/** Prototype starting deck — a representative spread of every mechanic. */
export const STARTER_DECK: string[] = [
    "portScan", "portScan", "enumerate", "passiveRecon",
    "knownExploit", "knownExploit", "knownExploit",
    "sqlInjection", "privEsc",
    "logWipe", "logWipe", "proxyChain", "goDark", "rootkit",
    "zeroDay", "bruteForce", "patchScanner", "payload",
];
