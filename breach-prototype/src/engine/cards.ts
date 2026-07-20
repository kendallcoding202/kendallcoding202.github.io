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
    analyze: {
        id: "analyze", name: "Analyze", kind: "recon", noise: 3, amount: 2, effect: "analyze", needsTarget: false,
        text: "Fully reveal every defense on this layer AND draw 2 cards. Medium noise.",
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
        id: "privEsc", name: "Privilege Escalation", kind: "exploit", noise: 4, power: 6, effect: "privEsc", matchType: "privilege", needsTarget: true,
        text: "Reduce a PRIVILEGE defense's Strength by 6. On any other type it misfires — no effect, loud.",
    },
    zeroDay: {
        id: "zeroDay", name: "Zero-Day", kind: "exploit", noise: 12, power: 99, effect: "zeroDay", needsTarget: true, exhausts: true,
        text: "Instantly drop any one defense's Strength to 0, whatever its type. Very loud. One use per run.",
    },
    bruteForce: {
        id: "bruteForce", name: "Brute Force", kind: "exploit", noise: 16, power: 6, effect: "bruteForce", needsTarget: true, tag: "overload",
        text: "Reduce any defense's Strength by 6. Extremely loud — a last resort.",
    },
    empBurst: {
        id: "empBurst", name: "EMP Burst", kind: "exploit", noise: 9, power: 3, effect: "exploitAll", needsTarget: false, tag: "overload",
        text: "Reduce EVERY standing defense on this layer by 3. Loud — but it clears multi-defense chokepoints.",
    },
    polymorph: {
        id: "polymorph", name: "Polymorph", kind: "exploit", noise: 5, power: 5, effect: "adaptiveExploit", needsTarget: true,
        text: "Reduce ANY defense by 5 — revealed or not, whatever its type. No specialist needed, a bit louder.",
    },
    precisionStrike: {
        id: "precisionStrike", name: "Precision Strike", kind: "exploit", noise: 3, power: 7, effect: "precisionStrike", needsTarget: false,
        text: "Automatically hit the WEAKEST standing defense on this layer for 7. Recon first to line it up.",
    },
    overload: {
        id: "overload", name: "Overload", kind: "exploit", noise: 4, power: 3, effect: "overload", needsTarget: true, tag: "overload",
        text: "Reduce a defense by 3, +1 for every 10 detection you've drawn. Devastating when you're already loud.",
    },
    momentum: {
        id: "momentum", name: "Momentum", kind: "exploit", noise: 3, power: 3, amount: 2, effect: "momentum", needsTarget: true,
        text: "Reduce a defense by 3, +2 for every layer you've already breached. Snowballs as you go deeper.",
    },

    /* ---------- Archetype keystones — reward committing to a build ---------- */
    ghostProtocol: {
        id: "ghostProtocol", name: "Ghost Protocol", kind: "exploit", noise: 0, power: 2, effect: "silentScale", needsTarget: true, tag: "ghost",
        text: "SILENT. Reduce a defense by 2, +2 for every silent card you've already played this turn. Built for a quiet, patient hand.",
    },
    blindSpot: {
        id: "blindSpot", name: "Blind Spot", kind: "exploit", noise: 1, power: 8, amount: 3, effect: "lowDetStrike", needsTarget: true, tag: "ghost",
        text: "If your detection is under 25%, reduce a defense by 8 — otherwise just 3. Devastating while you're still unseen.",
    },
    meltdown: {
        id: "meltdown", name: "Meltdown", kind: "exploit", noise: 10, amount: 12, effect: "meltdown", needsTarget: false, exhausts: true, tag: "overload",
        text: "Reduce EVERY defense on this layer by 1 for every 12 detection you've drawn. A finisher for a loud, reckless run. One use.",
    },
    contagion: {
        id: "contagion", name: "Contagion", kind: "exploit", noise: 3, power: 2, amount: 3, effect: "contagion", needsTarget: false, tag: "worm",
        text: "Plant a decay on EVERY standing defense here: each loses 2 Strength at the end of your next 3 turns. Set it and pressure elsewhere.",
    },
    chainReaction: {
        id: "chainReaction", name: "Chain Reaction", kind: "exploit", noise: 2, power: 2, effect: "chainReaction", needsTarget: true, tag: "chain",
        text: "Reduce a defense by 2, +1 for every card you've already played this turn. Rewards long, draw-fueled turns.",
    },
    cascade: {
        id: "cascade", name: "Cascade", kind: "exploit", noise: 2, power: 3, effect: "chainExploit", needsTarget: true, tag: "chain",
        text: "Reduce a defense by 3, +2 for every other exploit you've already played this turn. Rewards big combo turns.",
    },
    logicBomb: {
        id: "logicBomb", name: "Logic Bomb", kind: "exploit", noise: 2, power: 3, amount: 3, effect: "logicBomb", needsTarget: true, tag: "worm",
        text: "Plant on a defense: it loses 3 Strength at the end of each of your next 3 turns. Very quiet — set it and pressure elsewhere.",
    },

    /* ---------- Stealth — control the detection meter ---------- */
    logWipe: {
        id: "logWipe", name: "Log Wipe", kind: "stealth", noise: 0, amount: 8, effect: "logWipe", needsTarget: false, tag: "ghost",
        text: "Lower detection by 8. Makes no noise itself.",
    },
    goDark: {
        id: "goDark", name: "Go Dark", kind: "stealth", noise: 0, amount: 6, effect: "goDark", needsTarget: false, tag: "ghost",
        text: "Lower detection by 6. Best played just before you end a quiet turn.",
    },
    coverTracks: {
        id: "coverTracks", name: "Cover Tracks", kind: "stealth", noise: 0, amount: 4, effect: "wipeDraw", needsTarget: false, tag: "ghost",
        text: "Lower detection by 4 AND draw a card. Makes no noise.",
    },
    killSwitch: {
        id: "killSwitch", name: "Kill Switch", kind: "stealth", noise: 0, amount: 40, effect: "killSwitch", needsTarget: false, exhausts: true,
        text: "Emergency: lower detection by 40, but discard the rest of your hand. One use per run.",
    },
    proxyChain: {
        id: "proxyChain", name: "Proxy Chain", kind: "stealth", noise: 1, amount: 3, effect: "proxyChain", needsTarget: false, tag: "ghost",
        text: "Your next 3 cards each make 3 less noise. Set this up before a loud play.",
    },
    spoof: {
        id: "spoof", name: "Spoof", kind: "stealth", noise: 1, effect: "spoof", needsTarget: false,
        text: "Cancel the system's next move — the one shown under SYSTEM ALERT.",
    },
    feint: {
        id: "feint", name: "Feint", kind: "stealth", noise: 3, amount: 2, effect: "feint", needsTarget: false,
        text: "Makes some noise now, but cancels the system's next 2 moves. Buy yourself two quiet turns to work.",
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
        id: "automate", name: "Automate", kind: "utility", noise: 1, amount: 2, effect: "draw", needsTarget: false, tag: "chain",
        text: "Draw 2 cards. More options, more plays this turn.",
    },
    overclock: {
        id: "overclock", name: "Overclock", kind: "utility", noise: 2, power: 3, effect: "overclock", needsTarget: false,
        text: "Your NEXT exploit this turn hits +3 harder, and you draw a card. Set up a big hit.",
    },
    dataSiphon: {
        id: "dataSiphon", name: "Data Siphon", kind: "utility", noise: 1, effect: "siphon", needsTarget: false, tag: "chain",
        text: "Draw 1 card, plus 1 more for every layer you've breached. Pays off the deeper you get.",
    },
    detonate: {
        id: "detonate", name: "Detonate", kind: "utility", noise: 1, effect: "detonate", needsTarget: false, tag: "worm",
        text: "Blow ALL your planted logic bombs at once, dealing their full remaining damage instantly. The payoff for a patient worm build.",
    },
    misdirect: {
        id: "misdirect", name: "Misdirect", kind: "stealth", noise: 1, amount: 4, effect: "misdirect", needsTarget: false, tag: "ghost",
        text: "Feed the system a false trail: lower detection by 4 AND cancel its next move. Quiet control.",
    },
    trojan: {
        id: "trojan", name: "Trojan", kind: "utility", noise: 1, power: 3, amount: 3, effect: "trojan", needsTarget: true, exhausts: true,
        text: "Quietly reduce a defense by 3 AND lower detection by 3 — infiltrate without a trace. One use per run.",
    },

    /* ==========================================================
       EXPANSION SET — deepens every archetype + flexible generalists.
       Mostly draftable from the reward pool; a few seed operator decks.
       ========================================================== */

    /* ---- GHOST: silent, unseen, patient ---- */
    phantomJab: {
        id: "phantomJab", name: "Phantom Jab", kind: "exploit", noise: 0, power: 3, effect: "silentScale", needsTarget: true, tag: "ghost",
        text: "SILENT. Reduce a defense by 3, +2 for every silent card you've already played this turn.",
    },
    ghostInTheShell: {
        id: "ghostInTheShell", name: "Ghost in the Shell", kind: "exploit", noise: 1, power: 9, amount: 2, effect: "lowDetStrike", needsTarget: true, tag: "ghost",
        text: "If your detection is under 25%, reduce a defense by 9 — otherwise just 2. A killer opener.",
    },
    quietScan: {
        id: "quietScan", name: "Quiet Scan", kind: "recon", noise: 0, effect: "quietScan", needsTarget: false, tag: "ghost",
        text: "Reveal the TYPE of every defense on this layer AND draw a card. Completely silent.",
    },
    deadDrop: {
        id: "deadDrop", name: "Dead Drop", kind: "utility", noise: 0, effect: "silentDraw", needsTarget: false, tag: "ghost",
        text: "Draw a card. If every card you've played this turn was silent, draw 2 instead. Silent.",
    },
    vanish: {
        id: "vanish", name: "Vanish", kind: "stealth", noise: 0, amount: 3, effect: "vanish", needsTarget: false, tag: "ghost",
        text: "Lower detection by 3, and your next 2 cards each make 3 less noise. Silent.",
    },
    cloak: {
        id: "cloak", name: "Cloak", kind: "stealth", noise: 0, amount: 6, effect: "logWipe", needsTarget: false, tag: "ghost",
        text: "Lower detection by 6. Makes no noise.",
    },

    /* ---- OVERLOAD: turn your own noise into power ---- */
    powerSurge: {
        id: "powerSurge", name: "Power Surge", kind: "exploit", noise: 8, power: 4, effect: "overload", needsTarget: true, tag: "overload",
        text: "Reduce a defense by 4, +1 for every 10 detection you've drawn. Hits hard once you're loud.",
    },
    shortCircuit: {
        id: "shortCircuit", name: "Short Circuit", kind: "exploit", noise: 9, power: 4, effect: "exploitAll", needsTarget: false, tag: "overload",
        text: "Reduce EVERY standing defense on this layer by 4. Loud — clears a crowded layer.",
    },
    thermalRunaway: {
        id: "thermalRunaway", name: "Thermal Runaway", kind: "exploit", noise: 11, amount: 10, effect: "meltdown", needsTarget: false, exhausts: true, tag: "overload",
        text: "Reduce EVERY defense here by 1 for every 10 detection you've drawn. A finisher for a loud run. One use.",
    },
    adrenalineRush: {
        id: "adrenalineRush", name: "Adrenaline Rush", kind: "utility", noise: 0, power: 8, amount: 2, effect: "spike", needsTarget: false, tag: "overload",
        text: "Go loud on purpose: raise your OWN detection by 8, draw 2 cards, and your next exploit hits +2.",
    },
    wreckingBall: {
        id: "wreckingBall", name: "Wrecking Ball", kind: "exploit", noise: 15, power: 9, effect: "bruteForce", needsTarget: true, tag: "overload",
        text: "Reduce any defense by 9. Extremely loud — the sledgehammer.",
    },

    /* ---- WORM: plant, spread, decay ---- */
    parasite: {
        id: "parasite", name: "Parasite", kind: "exploit", noise: 1, power: 2, amount: 4, effect: "logicBomb", needsTarget: true, tag: "worm",
        text: "Plant on a defense: it loses 2 Strength at the end of each of your next 4 turns. Very quiet.",
    },
    blight: {
        id: "blight", name: "Blight", kind: "exploit", noise: 3, power: 3, amount: 2, effect: "contagion", needsTarget: false, tag: "worm",
        text: "Plant a decay on EVERY standing defense here: each loses 3 at the end of your next 2 turns.",
    },
    incubate: {
        id: "incubate", name: "Incubate", kind: "exploit", noise: 1, power: 5, amount: 2, effect: "logicBomb", needsTarget: true, tag: "worm",
        text: "Plant on a defense: it loses 5 Strength at the end of each of your next 2 turns. Quiet.",
    },
    viralLoad: {
        id: "viralLoad", name: "Viral Load", kind: "exploit", noise: 3, power: 2, effect: "wormScale", needsTarget: true, tag: "worm",
        text: "Reduce a defense by 2, +2 for every logic bomb currently ticking. The worm's payoff.",
    },
    necroticTouch: {
        id: "necroticTouch", name: "Necrotic Touch", kind: "exploit", noise: 2, power: 3, amount: 2, effect: "drainPlant", needsTarget: true, tag: "worm",
        text: "Reduce a defense by 3 now, AND plant a decay on it (2/turn for 2 turns).",
    },

    /* ---- CHAIN: reward long, draw-fuelled turns ---- */
    quickHack: {
        id: "quickHack", name: "Quick Hack", kind: "exploit", noise: 1, power: 1, effect: "chainReaction", needsTarget: true, tag: "chain",
        text: "Reduce a defense by 1, +1 for every card you've already played this turn. Dirt cheap.",
    },
    daisyChain: {
        id: "daisyChain", name: "Daisy Chain", kind: "exploit", noise: 2, power: 2, effect: "chainExploit", needsTarget: true, tag: "chain",
        text: "Reduce a defense by 2, +2 for every other exploit you've already played this turn.",
    },
    scriptRunner: {
        id: "scriptRunner", name: "Script Runner", kind: "utility", noise: 1, effect: "cadence", needsTarget: false, tag: "chain",
        text: "Draw a card — draw 2 instead if you've already played 3+ cards this turn.",
    },
    macro: {
        id: "macro", name: "Macro", kind: "utility", noise: 2, amount: 3, effect: "draw", needsTarget: false, tag: "chain",
        text: "Draw 3 cards. Fuel for a big combo turn.",
    },
    overflow: {
        id: "overflow", name: "Overflow", kind: "exploit", noise: 3, effect: "overflowAll", needsTarget: false, exhausts: true, tag: "chain",
        text: "Reduce EVERY standing defense by 1 for every 2 cards you've played this turn. One use — the chain finisher.",
    },

    /* ---- FLEXIBLE generalists + second-tier specialists ---- */
    heuristicEngine: {
        id: "heuristicEngine", name: "Heuristic Engine", kind: "exploit", noise: 5, power: 6, effect: "adaptiveExploit", needsTarget: true,
        text: "Reduce ANY defense by 6 — revealed or not, whatever its type. The reliable workhorse.",
    },
    bufferOverflow: {
        id: "bufferOverflow", name: "Buffer Overflow", kind: "exploit", noise: 5, power: 4, effect: "splitHit", needsTarget: false,
        text: "Reduce the TWO weakest standing defenses by 4 each. Cracks multi-lock chokepoints.",
    },
    portKnock: {
        id: "portKnock", name: "Port Knock", kind: "exploit", noise: 2, power: 6, amount: 2, effect: "firstStrike", needsTarget: true,
        text: "Reduce a defense by 6 if it's at full Strength — otherwise only 2. Strike before it's softened.",
    },
    sqlmap: {
        id: "sqlmap", name: "sqlmap", kind: "exploit", noise: 3, power: 4, effect: "typedExploit", matchType: "database", needsTarget: true,
        text: "Reduce a DATABASE defense by 6. Against any other type: only 2, and louder.",
    },
    dictionaryAttack: {
        id: "dictionaryAttack", name: "Dictionary Attack", kind: "exploit", noise: 3, power: 4, effect: "typedExploit", matchType: "auth", needsTarget: true,
        text: "Reduce an AUTH defense by 6. Against any other type: only 2, and louder.",
    },
    wafBypass: {
        id: "wafBypass", name: "WAF Bypass", kind: "exploit", noise: 3, power: 4, effect: "typedExploit", matchType: "firewall", needsTarget: true,
        text: "Reduce a FIREWALL defense by 6. Against any other type: only 2, and louder.",
    },
    icePick: {
        id: "icePick", name: "ICE Pick", kind: "exploit", noise: 3, power: 4, effect: "typedExploit", matchType: "ids", needsTarget: true,
        text: "Reduce an IDS defense by 6. Against any other type: only 2, and louder.",
    },
    tokenTheft: {
        id: "tokenTheft", name: "Token Theft", kind: "exploit", noise: 3, power: 4, effect: "typedExploit", matchType: "privilege", needsTarget: true,
        text: "Reduce a PRIVILEGE defense by 6. Against any other type: only 2, and louder.",
    },
    honeypot: {
        id: "honeypot", name: "Honeypot", kind: "stealth", noise: 2, amount: 2, effect: "feint", needsTarget: false,
        text: "Feed the system a fake target: cancels its next 2 moves. Buys two clean turns.",
    },
};

/** Prototype starting deck — a bigger, more varied spread (~26 cards).
    Includes a specialist exploit for every defense type (firewall / ids /
    auth / database / privilege), cheap chips, and draw/economy cards so a
    turn has real choices. */
export const STARTER_DECK: string[] = [
    // recon (5)
    "portScan", "portScan", "passiveRecon", "enumerate", "packetSniffer",
    // exploits — mostly FLEXIBLE attacks you can always play well: generalists and
    // condition-based scalers, plus a couple of specialists for big matched hits.
    // (The other type-specialists live in the reward pool for when you want them.)
    "knownExploit", "knownExploit", "scriptKiddie",
    "polymorph", "precisionStrike", "momentum", "cascade",
    "firewallBypass", "idsEvasion", "privEsc",
    "zeroDay", "bruteForce",
    // stealth (6)
    "logWipe", "goDark", "coverTracks", "proxyChain", "spoof", "misdirect",
    // utility (5)
    "rootkit", "automate", "patchScanner", "overclock", "dataSiphon",
];
