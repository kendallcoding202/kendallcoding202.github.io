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
        text: "Reveal one defense on this layer — its type and Strength. Low noise.",
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
        text: "Reveal one defense and reduce its Strength by 2. Low noise.",
    },
    packetSniffer: {
        id: "packetSniffer", name: "Packet Sniffer", kind: "recon", noise: 1, effect: "revealDraw", needsTarget: true,
        text: "Reveal one defense AND draw a card. Low noise.",
    },

    /* ---------- Exploits — knock strength off a defense ---------- */
    knownExploit: {
        id: "knownExploit", name: "Known Exploit", kind: "exploit", noise: 3, power: 4, effect: "knownExploit", needsTarget: true,
        text: "Reduce a REVEALED defense's Strength by 4. Against a hidden one: only 2 — and much louder.",
    },
    scriptKiddie: {
        id: "scriptKiddie", name: "Script Kiddie", kind: "exploit", noise: 1, power: 2, effect: "knownExploit", needsTarget: true,
        text: "Cheap & quiet: reduce a REVEALED defense's Strength by 2. Hidden one: just 1, and louder.",
    },
    sqlInjection: {
        id: "sqlInjection", name: "SQL Injection", kind: "exploit", noise: 4, power: 5, effect: "typedExploit", matchType: "database", needsTarget: true,
        text: "Reduce a DATABASE defense's Strength by 8. Against any other type: only 2, and louder.",
    },
    firewallBypass: {
        id: "firewallBypass", name: "Firewall Bypass", kind: "exploit", noise: 4, power: 5, effect: "typedExploit", matchType: "firewall", needsTarget: true,
        text: "Reduce a FIREWALL defense's Strength by 8. Against any other type: only 2, and louder.",
    },
    idsEvasion: {
        id: "idsEvasion", name: "IDS Evasion", kind: "exploit", noise: 4, power: 5, effect: "typedExploit", matchType: "ids", needsTarget: true,
        text: "Reduce an IDS defense's Strength by 8. Against any other type: only 2, and louder.",
    },
    rainbowTable: {
        id: "rainbowTable", name: "Rainbow Table", kind: "exploit", noise: 4, power: 5, effect: "typedExploit", matchType: "auth", needsTarget: true,
        text: "Reduce an AUTH defense's Strength by 8. Against any other type: only 2, and louder.",
    },
    privEsc: {
        id: "privEsc", name: "Privilege Escalation", kind: "exploit", noise: 4, power: 6, effect: "privEsc", needsTarget: true,
        text: "Reduce a PRIVILEGE defense's Strength by 6. On any other type it misfires — no effect, loud.",
    },
    zeroDay: {
        id: "zeroDay", name: "Zero-Day", kind: "exploit", noise: 12, power: 99, effect: "zeroDay", needsTarget: true, exhausts: true,
        text: "Instantly drop any one defense's Strength to 0, whatever its type. Very loud. One use per run.",
    },
    bruteForce: {
        id: "bruteForce", name: "Brute Force", kind: "exploit", noise: 16, power: 6, effect: "bruteForce", needsTarget: true,
        text: "Reduce any defense's Strength by 6. Extremely loud — a last resort.",
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
    coverTracks: {
        id: "coverTracks", name: "Cover Tracks", kind: "stealth", noise: 0, amount: 4, effect: "wipeDraw", needsTarget: false,
        text: "Lower detection by 4 AND draw a card. Makes no noise.",
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
        text: "Quietly reduce a defense's Strength by 4 — barely any noise. One use per run.",
    },
    patchScanner: {
        id: "patchScanner", name: "Deep Scan", kind: "utility", noise: 1, effect: "patchScanner", needsTarget: false,
        text: "Fully reveal this layer, plus the types of the next layer's defenses.",
    },
    automate: {
        id: "automate", name: "Automate", kind: "utility", noise: 1, amount: 2, effect: "draw", needsTarget: false,
        text: "Draw 2 cards. More options, more plays this turn.",
    },
};

/** Prototype starting deck — a bigger, more varied spread (~26 cards).
    Includes a specialist exploit for every defense type (firewall / ids /
    auth / database / privilege), cheap chips, and draw/economy cards so a
    turn has real choices. */
export const STARTER_DECK: string[] = [
    // recon (5)
    "portScan", "portScan", "passiveRecon", "enumerate", "packetSniffer",
    // exploits (11) — reliable generalists + one specialist per type + heavies
    "knownExploit", "knownExploit", "knownExploit", "scriptKiddie",
    "firewallBypass", "idsEvasion", "rainbowTable", "sqlInjection", "privEsc",
    "zeroDay", "bruteForce",
    // stealth (6)
    "logWipe", "logWipe", "goDark", "coverTracks", "proxyChain", "spoof",
    // utility (3)
    "rootkit", "automate", "patchScanner",
];
