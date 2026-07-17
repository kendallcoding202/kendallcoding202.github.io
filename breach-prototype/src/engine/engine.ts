/* ============================================================
   BREACH — the rules engine (pure functions over data)
   applyAction(state, action) -> new state. No mutation of the
   input, no I/O, no randomness outside the seeded rng.

   Layers hold MULTIPLE defenses; exploits and single-target recon
   pick a specific defense. A layer breaches only when all of its
   defenses fall. The system reacts each turn and telegraphs its
   next move so the player can outplay it.
   ============================================================ */

import type { Action, AlertStage, CardDef, Defense, GameState, Layer, SystemDef, SystemIntent } from "./types.ts";
import { CARDS, STARTER_DECK } from "./cards.ts";
import { SYSTEMS, DEFAULT_SYSTEM } from "./systems.ts";
import { shuffle } from "./rng.ts";

const PROXY_REDUCTION = 3;

/* ---------- construction ---------- */

export function createInitialState(seed: number, systemKey: string = DEFAULT_SYSTEM): GameState {
    const sys: SystemDef = SYSTEMS[systemKey] || SYSTEMS[DEFAULT_SYSTEM];
    const state: GameState = {
        system: sys.name,
        detection: 0,
        detectionMax: sys.detectionMax,
        baselineCreep: sys.baselineCreep,
        layers: sys.layers.map((l): Layer => ({
            name: l.name,
            breached: false,
            defenses: l.defenses.map((d): Defense => ({
                type: d.type, strength: d.strength, maxStrength: d.strength, typeRevealed: false, strengthRevealed: false,
            })),
        })),
        current: 0,
        objectiveExposed: false,
        deck: [],
        hand: [],
        discard: [],
        handSize: 6,
        turn: 1,
        turnNoise: 0,
        proxyCharges: 0,
        rootkitReady: false,
        spoofTurns: 0,
        alert: "IDLE",
        systemIntent: null,
        rng: seed >>> 0,
        outcome: "playing",
        lossReason: null,
        log: [],
    };
    state.deck = shuffle(state, STARTER_DECK);
    draw(state, state.handSize);
    refreshIntent(state);
    log(state, `Breaching ${state.system}. Stay quiet.`);
    return state;
}

/* ---------- helpers ---------- */

function log(s: GameState, msg: string) {
    s.log.push(msg);
    if (s.log.length > 100) s.log.shift();
}
export function currentLayer(s: GameState): Layer | null {
    return s.layers[s.current] || null;
}
/** Indices of the current layer's defenses that are still standing. */
export function targetableDefenses(s: GameState): number[] {
    const l = currentLayer(s);
    if (!l || l.breached) return [];
    return l.defenses.map((d, i) => (d.strength > 0 ? i : -1)).filter((i) => i >= 0);
}
function focusDefenseIndex(l: Layer): number {
    // the standing defense with the least strength = the one under attack
    let best = -1, bestStr = Infinity;
    l.defenses.forEach((d, i) => { if (d.strength > 0 && d.strength < bestStr) { bestStr = d.strength; best = i; } });
    return best;
}

function draw(s: GameState, n: number) {
    for (let i = 0; i < n; i++) {
        if (s.deck.length === 0) {
            if (s.discard.length === 0) break;
            s.deck = shuffle(s, s.discard);
            s.discard = [];
        }
        const c = s.deck.pop();
        if (c) s.hand.push(c);
    }
}

function reduceDetection(s: GameState, n: number) {
    s.detection = Math.max(0, s.detection - n);
}
function addDetection(s: GameState, n: number) {
    if (n <= 0) return;
    s.detection += n;
    if (s.detection >= s.detectionMax) {
        s.detection = s.detectionMax;
        s.outcome = "lost";
        s.lossReason = "Detected — the system locked you out.";
        log(s, "🚨 DETECTED. Access revoked.");
    }
}

/* ---------- reactive opponent (telegraphed & fair) ---------- */

function alertStage(s: GameState): AlertStage {
    const f = s.detection / s.detectionMax;
    if (f < 0.25) return "IDLE";
    if (f < 0.5) return "SUSPICIOUS";
    if (f < 0.8) return "ALERTED";
    return "LOCKDOWN";
}

function anyDamagedStanding(l: Layer): number {
    // index of a damaged (below max), still-standing defense, else -1
    let idx = -1, worst = 1;
    l.defenses.forEach((d, i) => {
        if (d.strength > 0 && d.strength < d.maxStrength) {
            const ratio = d.strength / d.maxStrength;
            if (ratio < worst) { worst = ratio; idx = i; }
        }
    });
    return idx;
}

function defenseLabel(d: Defense): string {
    return d.typeRevealed ? d.type : "a defense";
}

function computeIntent(s: GameState): SystemIntent {
    const layer = currentLayer(s);
    if (s.outcome !== "playing" || !layer || layer.breached) return { kind: "idle", label: "standing by" };
    const stage = alertStage(s);
    const lname = layer.name;
    const focus = focusDefenseIndex(layer);
    const focusDef = focus >= 0 ? layer.defenses[focus] : layer.defenses[0];
    const damagedIdx = anyDamagedStanding(layer);

    if (stage === "IDLE") return { kind: "idle", label: "scanning traffic — no action" };

    if (stage === "SUSPICIOUS") {
        if (damagedIdx >= 0) return { kind: "patch", label: `patch ${defenseLabel(layer.defenses[damagedIdx])} on ${lname} (+2)`, layerName: lname };
        return { kind: "harden", label: `harden ${defenseLabel(focusDef)} on ${lname} (+1)`, layerName: lname };
    }

    if (stage === "ALERTED") {
        if (damagedIdx >= 0) return { kind: "patch", label: `heavy-patch ${defenseLabel(layer.defenses[damagedIdx])} (+3)`, layerName: lname };
        const anyRevealed = s.layers.some((x) => !x.breached && x.defenses.some((d) => d.typeRevealed || d.strengthRevealed));
        if (anyRevealed) return { kind: "obscure", label: "re-obscure — your recon will reset" };
        return { kind: "harden", label: `harden ${defenseLabel(focusDef)} (+2)`, layerName: lname };
    }

    return { kind: "purge", label: `PURGE ${lname} — heavy patch, trace accelerates`, layerName: lname };
}

function refreshIntent(s: GameState) {
    s.alert = alertStage(s);
    s.systemIntent = computeIntent(s);
}

function systemReact(s: GameState) {
    if (s.spoofTurns > 0) {
        s.spoofTurns -= 1;
        log(s, "The system's move was spoofed away.");
        return;
    }
    const intent = s.systemIntent;
    const layer = currentLayer(s);
    if (!intent || !layer || layer.breached) return;

    if (intent.kind === "obscure") {
        s.layers.forEach((x) => { if (!x.breached) x.defenses.forEach((d) => { d.typeRevealed = false; d.strengthRevealed = false; }); });
        log(s, "The system re-obscured itself — your recon reset.");
        return;
    }
    if (intent.kind === "idle") return;

    // patch / harden / purge act on a single defense of the current layer
    const damagedIdx = anyDamagedStanding(layer);
    const idx = damagedIdx >= 0 ? damagedIdx : focusDefenseIndex(layer);
    if (idx < 0) return;
    const d = layer.defenses[idx];

    if (intent.kind === "patch") {
        const amt = s.alert === "ALERTED" ? 3 : 2;
        d.strength = Math.min(d.maxStrength, d.strength + amt);
        log(s, `The system patched ${defenseLabel(d)} on ${layer.name} (+${amt}).`);
    } else if (intent.kind === "harden") {
        const amt = s.alert === "ALERTED" ? 2 : 1;
        d.strength += amt; d.maxStrength += amt;
        log(s, `The system hardened ${defenseLabel(d)} on ${layer.name} (+${amt}).`);
    } else if (intent.kind === "purge") {
        d.strength = Math.min(d.maxStrength, d.strength + 3);
        s.baselineCreep += 1;
        log(s, `The system PURGED ${layer.name} — trace accelerating.`);
    }
}

/* ---------- breach mechanics ---------- */

function damageDefense(s: GameState, idx: number, amount: number) {
    const layer = currentLayer(s);
    if (!layer || layer.breached) return;
    const d = layer.defenses[idx];
    if (!d || d.strength <= 0) return;
    d.strength = Math.max(0, d.strength - amount);
    afterBreachCheck(s);
}

function afterBreachCheck(s: GameState) {
    const layer = currentLayer(s);
    if (!layer || layer.breached) return;
    if (layer.defenses.every((d) => d.strength <= 0)) {
        layer.breached = true;
        const isFinal = s.current === s.layers.length - 1;
        if (isFinal) {
            // Breaching the objective layer IS the win — you're in, grab it, vanish.
            s.objectiveExposed = true;
            s.outcome = "won";
            log(s, `${layer.name} breached — objective exfiltrated. You're a ghost.`);
        } else {
            log(s, `${layer.name} breached — moving inward.`);
            s.current += 1;
        }
    }
}

/* ---------- card effects (return EXTRA noise beyond base) ---------- */

function applyEffect(s: GameState, card: CardDef, target: number): number {
    const layer = currentLayer(s);
    const defs = layer ? layer.defenses : [];
    const d: Defense | undefined = defs[target];

    switch (card.effect) {
        case "revealOne":
            if (d) { d.typeRevealed = true; d.strengthRevealed = true; log(s, `Port Scan: ${d.type} (${d.strength}).`); }
            return 0;
        case "revealTypeOnly":
            defs.forEach((x) => (x.typeRevealed = true));
            return 0;
        case "revealAll": {
            defs.forEach((x) => { x.typeRevealed = true; x.strengthRevealed = true; });
            const next = s.layers[s.current + 1];
            if (next) next.defenses.forEach((x) => { x.typeRevealed = true; x.strengthRevealed = true; });
            return 0;
        }
        case "revealAndWeaken":
            if (d) { d.typeRevealed = true; d.strengthRevealed = true; damageDefense(s, target, card.power || 2); }
            return 0;
        case "revealDraw":
            if (d) { d.typeRevealed = true; d.strengthRevealed = true; }
            draw(s, 1);
            log(s, `Packet Sniffer — revealed ${d ? d.type : "a defense"}, drew a card.`);
            return 0;
        case "draw":
            draw(s, card.amount || 1);
            log(s, `Drew ${card.amount || 1} card${(card.amount || 1) > 1 ? "s" : ""}.`);
            return 0;
        case "wipeDraw":
            reduceDetection(s, card.amount || 4);
            draw(s, 1);
            log(s, `Cover Tracks — detection −${card.amount || 4}, drew a card.`);
            return 0;
        case "patchScanner": {
            defs.forEach((x) => { x.typeRevealed = true; x.strengthRevealed = true; });
            const next = s.layers[s.current + 1];
            if (next) next.defenses.forEach((x) => (x.typeRevealed = true));
            return 0;
        }

        case "knownExploit": {
            if (!d) return 0;
            const known = d.typeRevealed;
            const power = known ? card.power || 4 : Math.ceil((card.power || 4) / 2);
            damageDefense(s, target, power);
            log(s, known ? `${card.name} hits ${d.type} for ${power}.` : `${card.name} fumbles a blind defense (${power}).`);
            return known ? 0 : 6;
        }
        case "typedExploit": {
            if (!d) return 0;
            const match = d.type === card.matchType;
            const power = match ? Math.round((card.power || 5) * 1.6) : Math.round((card.power || 5) * 0.4);
            damageDefense(s, target, power);
            log(s, match ? `${card.name} tears through ${d.type} for ${power}.` : `${card.name} is the wrong tool for ${d.type} (${power}).`);
            return match ? 0 : 3;
        }
        case "privEsc": {
            if (!d) return 0;
            if (d.type === "privilege") { damageDefense(s, target, card.power || 6); return 0; }
            log(s, "Privilege Escalation misfires — wrong defense.");
            return 4;
        }
        case "zeroDay":
            if (d) { damageDefense(s, target, card.power || 99); log(s, "Zero-Day detonates — defense shattered."); }
            return 0;
        case "bruteForce":
            if (d) { damageDefense(s, target, card.power || 6); log(s, "Brute Force — loud and ugly."); }
            return 0;
        case "backdoor":
            if (d) { damageDefense(s, target, card.power || 4); log(s, "Backdoor installed — quiet access."); }
            return 0;

        case "logWipe":
            reduceDetection(s, card.amount || 8);
            log(s, `Log Wipe — detection −${card.amount || 8}.`);
            return 0;
        case "goDark":
            reduceDetection(s, card.amount || 6);
            log(s, `Go Dark — detection −${card.amount || 6}.`);
            return 0;
        case "killSwitch":
            reduceDetection(s, card.amount || 40);
            s.discard.push(...s.hand);
            s.hand = [];
            log(s, "KILL SWITCH — tracks wiped, hand dumped.");
            return 0;
        case "proxyChain":
            s.proxyCharges += card.amount || 3;
            return 0;
        case "spoof":
            s.spoofTurns += 1;
            return 0;
        case "rootkit":
            s.rootkitReady = true;
            return 0;

        case "payload":
            if (s.objectiveExposed) {
                s.outcome = "won";
                log(s, "📦 PAYLOAD delivered. Objective exfiltrated. You're a ghost.");
            } else {
                log(s, "Payload has nothing to grab yet — breach the data layer first.");
            }
            return 0;
        default:
            return 0;
    }
}

/* ---------- public API ---------- */

export function canPlay(s: GameState, cardId: string): boolean {
    return s.outcome === "playing" && s.hand.includes(cardId) && !!CARDS[cardId];
}

/** Does this card require a target, and is `target` a valid standing defense? */
export function needsTarget(cardId: string): boolean {
    const c = CARDS[cardId];
    return !!c && c.needsTarget;
}

/** Short prediction of what a TARGETED card will do to a specific defense —
    shown in the UI when a card is armed so the matched-exploit rules are
    legible before you commit. Returns null for non-targeted cards. */
export function previewOnTarget(s: GameState, cardId: string, idx: number): string | null {
    const card = CARDS[cardId];
    const layer = currentLayer(s);
    if (!card || !card.needsTarget || !layer) return null;
    const d = layer.defenses[idx];
    if (!d || d.strength <= 0) return null;
    switch (card.effect) {
        case "revealOne": return "reveal";
        case "revealDraw": return "reveal +draw";
        case "revealAndWeaken": return `reveal, −${card.power || 2}`;
        case "knownExploit": return d.typeRevealed ? `−${card.power || 4}` : `−${Math.ceil((card.power || 4) / 2)} · blind, loud`;
        case "typedExploit":
            if (!d.typeRevealed) return "reveal it first";
            return d.type === card.matchType ? `−${Math.round((card.power || 5) * 1.6)}` : `−${Math.round((card.power || 5) * 0.4)} · weak, loud`;
        case "privEsc":
            if (!d.typeRevealed) return "reveal it first";
            return d.type === "privilege" ? `−${card.power || 6}` : "misfires · loud";
        case "zeroDay": return "SHATTER";
        case "bruteForce": return `−${card.power || 6} · loud`;
        case "backdoor": return `−${card.power || 4} · quiet`;
        default: return null;
    }
}

/** Numeric damage prediction for the AI (0 for non-exploits). Uses the
    defense's true type; callers gate on `typeRevealed` to play fair. */
export function predictDamage(s: GameState, cardId: string, idx: number): number {
    const card = CARDS[cardId];
    const layer = currentLayer(s);
    if (!card || !layer) return 0;
    const d = layer.defenses[idx];
    if (!d || d.strength <= 0) return 0;
    switch (card.effect) {
        case "knownExploit": return d.typeRevealed ? card.power || 4 : Math.ceil((card.power || 4) / 2);
        case "typedExploit": return d.type === card.matchType ? Math.round((card.power || 5) * 1.6) : Math.round((card.power || 5) * 0.4);
        case "privEsc": return d.type === "privilege" ? card.power || 6 : 0;
        case "zeroDay": return 999;
        case "bruteForce": return card.power || 6;
        case "backdoor": return card.power || 4;
        case "revealAndWeaken": return card.power || 2;
        default: return 0;
    }
}

export function projectedNoise(s: GameState, cardId: string): number {
    const card = CARDS[cardId];
    if (!card) return 0;
    let noise = card.noise;
    if (s.rootkitReady) return 0;
    if (s.proxyCharges > 0) noise = Math.max(0, noise - PROXY_REDUCTION);
    return noise;
}

export function applyAction(prev: GameState, action: Action): GameState {
    if (prev.outcome !== "playing") return prev;
    const s: GameState = structuredClone(prev);

    if (action.type === "playCard") {
        const cardId = action.card;
        if (!s.hand.includes(cardId) || !CARDS[cardId]) return prev;
        const card = CARDS[cardId];

        // resolve / validate the target for targeted cards
        let target = action.target ?? -1;
        if (card.needsTarget) {
            const options = targetableDefenses(s);
            if (options.length === 0) return prev; // nothing to hit
            if (target < 0 || !options.includes(target)) {
                if (options.length === 1) target = options[0]; // auto-target the only option
                else return prev; // ambiguous — UI must supply a target
            }
        }

        s.hand.splice(s.hand.indexOf(cardId), 1);

        const rootkitBefore = s.rootkitReady;
        const proxyBefore = s.proxyCharges;

        const extraNoise = applyEffect(s, card, target);
        let noise = card.noise + extraNoise;
        if (rootkitBefore && noise > 0) {
            noise = 0;
            s.rootkitReady = false;
            log(s, `${card.name} hidden by Rootkit — silent.`);
        } else if (proxyBefore > 0 && noise > 0) {
            noise = Math.max(0, noise - PROXY_REDUCTION);
            s.proxyCharges -= 1;
        }
        addDetection(s, noise);
        s.turnNoise += noise;

        if (card.exhausts) log(s, `${card.name} spent (one-time).`);
        else s.discard.push(cardId);

        refreshIntent(s);
        return s;
    }

    if (action.type === "endTurn") {
        s.discard.push(...s.hand);
        s.hand = [];
        systemReact(s);
        addDetection(s, s.baselineCreep);
        s.rootkitReady = false;
        s.turnNoise = 0; // reset the per-turn noise budget
        if (s.outcome === "playing") {
            draw(s, s.handSize);
            s.turn += 1;
        }
        refreshIntent(s);
        return s;
    }

    return prev;
}
