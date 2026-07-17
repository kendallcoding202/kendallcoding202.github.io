/* ============================================================
   BREACH — card definitions as DATA
   Tuning lives here (noise / power / amount). Adding or balancing
   a card = editing this table, never touching the engine or UI.
   ============================================================ */

import type { CardDef } from "./types.ts";

export const CARDS: Record<string, CardDef> = {
    /* ---------- Recon (quiet; reveal hidden defenses) ---------- */
    portScan: {
        id: "portScan", name: "Port Scan", kind: "recon", noise: 2, effect: "revealOne", needsTarget: true,
        text: "Reveal a chosen defense (type & strength). Low noise.",
    },
    passiveRecon: {
        id: "passiveRecon", name: "Passive Recon", kind: "recon", noise: 0, effect: "revealTypeOnly", needsTarget: false,
        text: "Reveal the TYPE of every defense on this layer. Zero noise.",
    },
    enumerate: {
        id: "enumerate", name: "Enumerate", kind: "recon", noise: 4, effect: "revealAll", needsTarget: false,
        text: "Fully reveal this layer AND the next. Medium noise.",
    },
    socialEngineer: {
        id: "socialEngineer", name: "Social Engineer", kind: "recon", noise: 1, effect: "revealAndWeaken", power: 2, needsTarget: true,
        text: "Reveal a chosen defense and weaken it by 2. Low noise.",
    },

    /* ---------- Exploits (breach the current layer) ---------- */
    knownExploit: {
        id: "knownExploit", name: "Known Exploit", kind: "exploit", noise: 3, power: 4, effect: "knownExploit", needsTarget: true,
        text: "Breach a REVEALED defense for 4. Against an unknown defense: weaker and much louder.",
    },
    sqlInjection: {
        id: "sqlInjection", name: "SQL Injection", kind: "exploit", noise: 4, power: 5, effect: "sqlInjection", needsTarget: true,
        text: "Breach for 5 — devastating vs. a database layer, feeble elsewhere.",
    },
    privEsc: {
        id: "privEsc", name: "Privilege Escalation", kind: "exploit", noise: 4, power: 6, effect: "privEsc", needsTarget: true,
        text: "Breach a privilege layer for 6. Useless — and noisy — anywhere else.",
    },
    zeroDay: {
        id: "zeroDay", name: "Zero-Day", kind: "exploit", noise: 12, power: 99, effect: "zeroDay", needsTarget: true, exhausts: true,
        text: "Breach ANY defense completely, ignoring its type. Very loud. One use.",
    },
    bruteForce: {
        id: "bruteForce", name: "Brute Force", kind: "exploit", noise: 16, power: 6, effect: "bruteForce", needsTarget: true,
        text: "Breach any defense for 6. MASSIVE noise — the desperate option.",
    },

    /* ---------- Stealth (manage detection) ---------- */
    logWipe: {
        id: "logWipe", name: "Log Wipe", kind: "stealth", noise: 0, amount: 8, effect: "logWipe", needsTarget: false,
        text: "Reduce detection by 8. Cover your tracks.",
    },
    proxyChain: {
        id: "proxyChain", name: "Proxy Chain", kind: "stealth", noise: 1, amount: 3, effect: "proxyChain", needsTarget: false,
        text: "Your next 3 cards make 3 less noise each.",
    },
    spoof: {
        id: "spoof", name: "Spoof", kind: "stealth", noise: 1, effect: "spoof", needsTarget: false,
        text: "Suppress the system's next end-of-turn reaction.",
    },
    goDark: {
        id: "goDark", name: "Go Dark", kind: "stealth", noise: 0, amount: 6, effect: "goDark", needsTarget: false,
        text: "Reduce detection by 6. Best played as you end a quiet turn.",
    },
    killSwitch: {
        id: "killSwitch", name: "Kill Switch", kind: "stealth", noise: 0, amount: 40, effect: "killSwitch", needsTarget: false, exhausts: true,
        text: "Emergency: drop detection by 40, but discard the rest of your hand. One use.",
    },

    /* ---------- Utility / persistence ---------- */
    backdoor: {
        id: "backdoor", name: "Backdoor", kind: "utility", noise: 1, power: 4, effect: "backdoor", needsTarget: true, exhausts: true,
        text: "Quietly breach the current defense for 4. Installs persistent access.",
    },
    rootkit: {
        id: "rootkit", name: "Rootkit", kind: "utility", noise: 1, effect: "rootkit", needsTarget: false,
        text: "Hide your next action this turn — it makes zero noise.",
    },
    patchScanner: {
        id: "patchScanner", name: "Patch Scanner", kind: "utility", noise: 1, effect: "patchScanner", needsTarget: false,
        text: "Reveal the current defense and preview the system's next move.",
    },
    payload: {
        id: "payload", name: "Payload", kind: "utility", noise: 5, effect: "payload", needsTarget: false,
        text: "Exfiltrate the objective — WIN. Only works once the data layer is breached.",
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
