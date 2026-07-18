/* ============================================================
   BREACH — the rules engine (pure functions over data)
   applyAction(state, action) -> new state. No mutation of the
   input, no I/O, no randomness outside the seeded rng.

   Layers hold MULTIPLE defenses; exploits and single-target recon
   pick a specific defense. A layer breaches only when all of its
   defenses fall. The system reacts each turn and telegraphs its
   next move so the player can outplay it.
   ============================================================ */

import type { Action, AlertStage, CardDef, Defense, GameState, HuntPressure, Layer, SystemDef, SystemIntent, SystemModifier } from "./types.ts";
import type { ImplantLoadout } from "./implants.ts";
import type { ThreatEffects } from "./threat.ts";
import { CARDS, STARTER_DECK } from "./cards.ts";
import { SYSTEMS, DEFAULT_SYSTEM } from "./systems.ts";
import { shuffle } from "./rng.ts";

const PROXY_REDUCTION = 3;

/* ---------- construction ---------- */

export function createInitialState(seed: number, systemKey: string = DEFAULT_SYSTEM, deck?: string[], modifier?: SystemModifier | null, hunt?: HuntPressure | null, implants?: ImplantLoadout | null, threat?: ThreatEffects | null): GameState {
    const sys: SystemDef = SYSTEMS[systemKey] || SYSTEMS[DEFAULT_SYSTEM];
    const m = modifier || null;
    const h = hunt && hunt.tier > 0 ? hunt : null; // the watcher's grip, if Heat is high
    const im = implants || null; // installed cyberware, applied to the whole run
    const th = threat || null; // ascension difficulty, if playing above Threat 0
    const sDelta = (m?.strengthDelta || 0) + (h?.strengthDelta || 0) + (th?.strengthDelta || 0);
    const detectionMax = Math.max(60, Math.round((sys.detectionMax + (m?.detectionMaxDelta || 0) + (im?.detectionMaxDelta || 0)) * (th?.detectionMaxMul ?? 1)));
    const startFrac = Math.min(0.5, (m?.detectionStartFrac || 0) + (h?.detectionStartFrac || 0));
    const state: GameState = {
        system: sys.name,
        behavior: sys.behavior || null,
        detection: startFrac > 0 ? Math.round(startFrac * detectionMax) : 0,
        detectionMax,
        baselineCreep: Math.max(1, sys.baselineCreep + (m?.creepDelta || 0) + (h?.creepDelta || 0) + (th?.creepDelta || 0) - (im?.creepDelta || 0)),
        layers: sys.layers.map((l): Layer => ({
            name: l.name,
            breached: false,
            defenses: l.defenses.map((d): Defense => {
                const strength = Math.max(1, d.strength + sDelta);
                return { type: d.type, strength, maxStrength: strength, typeRevealed: false, strengthRevealed: false };
            }),
        })),
        current: 0,
        objectiveExposed: false,
        deck: [],
        hand: [],
        discard: [],
        handSize: 6 + (im?.handSize || 0),
        turn: 1,
        turnNoise: 0,
        cardsThisTurn: 0,
        silentThisTurn: 0,
        noiseReduction: im?.noiseReduction || 0,
        breachDraw: !!im?.breachDraw,
        reconDraw: !!im?.reconDraw,
        firstCardSilent: !!im?.firstCardSilent,
        proxyCharges: 0,
        rootkitReady: false,
        spoofTurns: 0,
        exploitBonus: 0,
        exploitsThisTurn: 0,
        bombs: [],
        alert: "IDLE",
        systemIntent: null,
        modifierLabel: m && m.key !== "clean" ? m.label : null,
        modifierBlurb: m && m.key !== "clean" ? m.blurb : null,
        modifierTone: m && m.key !== "clean" ? m.tone : null,
        huntLabel: h ? h.label : null,
        huntBlurb: h ? h.blurb : null,
        rng: seed >>> 0,
        outcome: "playing",
        lossReason: null,
        log: [],
    };
    state.deck = shuffle(state, (deck && deck.length ? deck : STARTER_DECK).slice());
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

/** Reduce a specific defense on a specific layer (used by logic bombs that
    may resolve on a layer other than the one currently in focus). */
function reduceDefenseAt(s: GameState, layerIdx: number, defIdx: number, amount: number) {
    const layer = s.layers[layerIdx];
    if (!layer || layer.breached) return;
    const d = layer.defenses[defIdx];
    if (!d || d.strength <= 0) return;
    d.strength = Math.max(0, d.strength - amount);
    if (layerIdx === s.current) afterBreachCheck(s);
}

/** Tick every planted logic bomb by one turn; drop the spent ones. */
function tickBombs(s: GameState) {
    if (s.bombs.length === 0) return;
    for (const b of s.bombs) {
        reduceDefenseAt(s, b.layer, b.def, b.amt);
        b.turns -= 1;
    }
    const before = s.bombs.length;
    s.bombs = s.bombs.filter((b) => {
        const layer = s.layers[b.layer];
        const d = layer && layer.defenses[b.def];
        return b.turns > 0 && !!d && d.strength > 0 && !layer.breached;
    });
    if (s.bombs.length < before) log(s, "A logic bomb burned out.");
    else if (s.bombs.length > 0) log(s, `Logic bombs tick — ${s.bombs.length} still counting down.`);
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
            if (s.breachDraw) { draw(s, 1); log(s, "Auto-Exfil — breaching pulled you a card."); } // implant
            applyBehaviorOnBreach(s);
        }
    }
}

/** A system's intrinsic quirk fires as you move inward. */
function applyBehaviorOnBreach(s: GameState) {
    if (s.behavior === "segmented") {
        // helpful: the next layer's defense TYPES are exposed as you cross in
        const next = s.layers[s.current];
        if (next && !next.breached && next.defenses.some((d) => !d.typeRevealed)) {
            next.defenses.forEach((d) => (d.typeRevealed = true));
            log(s, "Segmented network — crossing the boundary exposed the next layer's defense types.");
        }
    } else if (s.behavior === "adaptive") {
        // it learns: the layer you're now facing reinforces (+1 each) — punishing,
        // but only the next fight, so it doesn't compound out of control
        const l = s.layers[s.current];
        let hardened = 0;
        if (l && !l.breached) l.defenses.forEach((d) => { if (d.strength > 0) { d.strength += 1; d.maxStrength += 1; hardened++; } });
        if (hardened) log(s, `Adaptive ICE — it learns. This layer's ${hardened} defense${hardened === 1 ? "" : "s"} hardened (+1).`);
    }
}

/* ---------- card effects (return EXTRA noise beyond base) ---------- */

/** Consume the one-shot Overclock bonus (added to a single exploit's damage). */
function takeExploitBonus(s: GameState): number {
    const b = s.exploitBonus;
    s.exploitBonus = 0;
    return b;
}

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
        case "analyze": {
            defs.forEach((x) => { x.typeRevealed = true; x.strengthRevealed = true; });
            draw(s, card.amount || 2);
            log(s, `Analyze — this layer fully mapped, drew ${card.amount || 2}.`);
            return 0;
        }
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
            const power = (known ? card.power || 4 : Math.ceil((card.power || 4) / 2)) + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, known ? `${card.name} hits ${d.type} for ${power}.` : `${card.name} fumbles a blind defense (${power}).`);
            return known ? 0 : 6;
        }
        case "typedExploit": {
            if (!d) return 0;
            const match = d.type === card.matchType;
            const power = (match ? Math.round((card.power || 5) * 1.6) : Math.round((card.power || 5) * 0.4)) + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, match ? `${card.name} tears through ${d.type} for ${power}.` : `${card.name} is the wrong tool for ${d.type} (${power}).`);
            return match ? 0 : 3;
        }
        case "adaptiveExploit": {
            // works on ANY defense, revealed or not, no type penalty — the flexible generalist
            if (!d) return 0;
            const power = (card.power || 5) + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} reshapes to fit ${d.typeRevealed ? d.type : "the target"} — ${power} off.`);
            return 0;
        }
        case "precisionStrike": {
            // auto-hits the weakest standing defense on the layer (no target needed)
            const idx = layer ? focusDefenseIndex(layer) : -1;
            if (idx < 0) return 0;
            const power = (card.power || 7) + takeExploitBonus(s);
            damageDefense(s, idx, power);
            log(s, `${card.name} finds the soft spot — ${power} off the weakest defense.`);
            return 0;
        }
        case "overload": {
            // scales with how loud you already are — big when detected, weak when quiet
            if (!d) return 0;
            const power = (card.power || 3) + Math.floor(s.detection / 10) + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} rides your noise — ${power} off (louder = stronger).`);
            return 0;
        }
        case "momentum": {
            // stronger the deeper you've already broken in
            if (!d) return 0;
            const breached = s.layers.filter((l) => l.breached).length;
            const power = (card.power || 3) + (card.amount || 2) * breached + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} builds on ${breached} breached layer${breached === 1 ? "" : "s"} — ${power} off.`);
            return 0;
        }
        /* ---- GHOST archetype: reward staying silent / unseen ---- */
        case "silentScale": {
            if (!d) return 0;
            const power = (card.power || 2) + 2 * s.silentThisTurn + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} strikes from the dark — ${power} off (built on ${s.silentThisTurn} silent play${s.silentThisTurn === 1 ? "" : "s"}).`);
            return 0;
        }
        case "lowDetStrike": {
            if (!d) return 0;
            const unseen = s.detection < s.detectionMax * 0.25;
            const power = (unseen ? card.power || 8 : card.amount || 3) + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, unseen ? `${card.name} lands clean while you're unseen — ${power} off.` : `${card.name} glances off — you're too exposed (${power}).`);
            return 0;
        }
        /* ---- OVERLOAD archetype: turn your own noise into power ---- */
        case "meltdown": {
            const per = Math.max(1, Math.floor(s.detection / (card.amount || 12))) + takeExploitBonus(s);
            for (let i = defs.length - 1; i >= 0; i--) if (defs[i].strength > 0) reduceDefenseAt(s, s.current, i, per);
            log(s, `${card.name} — the grid melts down, ${per} off every defense (rides your ${s.detection} detection).`);
            return 0;
        }
        /* ---- WORM archetype: plant & detonate ---- */
        case "contagion": {
            let n = 0;
            defs.forEach((x, i) => { if (x.strength > 0) { s.bombs.push({ layer: s.current, def: i, amt: card.power || 2, turns: card.amount || 3 }); n++; } });
            log(s, `${card.name} spreads — ${n} defense${n === 1 ? "" : "s"} now decaying ${card.power || 2}/turn.`);
            return 0;
        }
        case "detonate": {
            if (s.bombs.length === 0) { log(s, "Detonate — nothing planted to blow."); return 0; }
            let total = 0;
            const count = s.bombs.length;
            for (const b of s.bombs) { const dmg = b.amt * b.turns; reduceDefenseAt(s, b.layer, b.def, dmg); total += dmg; }
            s.bombs = [];
            log(s, `Detonate — ${count} bomb${count === 1 ? "" : "s"} blown at once for ${total} total.`);
            return 0;
        }
        /* ---- CHAIN archetype: reward playing many cards a turn ---- */
        case "chainReaction": {
            if (!d) return 0;
            const power = (card.power || 2) + s.cardsThisTurn + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} chains off ${s.cardsThisTurn} card${s.cardsThisTurn === 1 ? "" : "s"} this turn — ${power} off.`);
            return 0;
        }
        case "exploitAll": {
            const bonus = takeExploitBonus(s);
            const base = (card.power || 3) + bonus;
            const standing = defs.filter((x) => x.strength > 0).length;
            for (let i = defs.length - 1; i >= 0; i--) if (defs[i].strength > 0) reduceDefenseAt(s, s.current, i, base);
            log(s, `EMP Burst — every defense on ${layer ? layer.name : "the layer"} hit for ${base} (${standing} struck).`);
            return 0;
        }
        case "chainExploit": {
            if (!d) return 0;
            const power = (card.power || 3) + 2 * s.exploitsThisTurn + takeExploitBonus(s);
            damageDefense(s, target, power);
            log(s, `${card.name} cascades for ${power} (built on ${s.exploitsThisTurn} exploit${s.exploitsThisTurn === 1 ? "" : "s"} this turn).`);
            return 0;
        }
        case "logicBomb":
            if (d) {
                s.bombs.push({ layer: s.current, def: target, amt: card.power || 3, turns: card.amount || 3 });
                log(s, `Logic bomb planted on ${d.typeRevealed ? d.type : "a defense"} — ${card.power || 3}/turn for ${card.amount || 3} turns.`);
            }
            return 0;
        case "privEsc": {
            if (!d) return 0;
            if (d.type === "privilege") { damageDefense(s, target, (card.power || 6) + takeExploitBonus(s)); return 0; }
            log(s, "Privilege Escalation misfires — wrong defense.");
            return 4;
        }
        case "zeroDay":
            if (d) { damageDefense(s, target, card.power || 99); log(s, "Zero-Day detonates — defense shattered."); }
            return 0;
        case "bruteForce":
            if (d) { damageDefense(s, target, (card.power || 6) + takeExploitBonus(s)); log(s, "Brute Force — loud and ugly."); }
            return 0;
        case "backdoor":
            if (d) { damageDefense(s, target, (card.power || 4) + takeExploitBonus(s)); log(s, "Backdoor installed — quiet access."); }
            return 0;
        case "trojan":
            if (d) { damageDefense(s, target, (card.power || 3) + takeExploitBonus(s)); reduceDetection(s, card.amount || 3); log(s, `Trojan — defense −${card.power || 3}, detection −${card.amount || 3}.`); }
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
        case "feint":
            s.spoofTurns += card.amount || 2;
            log(s, `Feint — the system's next ${card.amount || 2} moves are spoofed away.`);
            return 0;
        case "overclock":
            s.exploitBonus += card.power || 3;
            draw(s, 1);
            log(s, `Overclock — your next exploit hits +${card.power || 3} harder. Drew a card.`);
            return 0;
        case "siphon": {
            const n = 1 + s.layers.filter((l) => l.breached).length;
            draw(s, n);
            log(s, `Data Siphon — drew ${n} (1 + breached layers).`);
            return 0;
        }
        case "misdirect":
            s.spoofTurns += 1;
            reduceDetection(s, card.amount || 4);
            log(s, `Misdirect — the system chases a ghost; detection −${card.amount || 4}, its next move cancelled.`);
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
    const bonus = s.exploitBonus;
    const plus = bonus ? ` (+${bonus})` : "";
    switch (card.effect) {
        case "revealOne": return "reveal";
        case "revealDraw": return "reveal +draw";
        case "revealAndWeaken": return `reveal, −${card.power || 2}`;
        case "knownExploit": return d.typeRevealed ? `−${(card.power || 4) + bonus}${plus}` : `−${Math.ceil((card.power || 4) / 2) + bonus} · blind, loud`;
        case "typedExploit":
            if (!d.typeRevealed) return "reveal it first";
            return d.type === card.matchType ? `−${Math.round((card.power || 5) * 1.6) + bonus}${plus}` : `−${Math.round((card.power || 5) * 0.4) + bonus} · weak, loud`;
        case "chainExploit": return `−${(card.power || 3) + 2 * s.exploitsThisTurn + bonus} · scales w/ combo`;
        case "silentScale": return `−${(card.power || 2) + 2 * s.silentThisTurn + bonus} · scales w/ silent plays`;
        case "lowDetStrike": return s.detection < s.detectionMax * 0.25 ? `−${(card.power || 8) + bonus} · UNSEEN` : `−${(card.amount || 3) + bonus} · too loud`;
        case "chainReaction": return `−${(card.power || 2) + s.cardsThisTurn + bonus} · scales w/ cards played`;
        case "adaptiveExploit": return `−${(card.power || 5) + bonus}${plus} · any type`;
        case "overload": return `−${(card.power || 3) + Math.floor(s.detection / 10) + bonus} · scales w/ detection`;
        case "momentum": return `−${(card.power || 3) + (card.amount || 2) * (layer ? s.layers.filter((l) => l.breached).length : 0) + bonus} · deeper = bigger`;
        case "logicBomb": return `plant ${card.power || 3}/turn ×${card.amount || 3}`;
        case "trojan": return `−${(card.power || 3) + bonus}, −det${plus}`;
        case "privEsc":
            if (!d.typeRevealed) return "reveal it first";
            return d.type === "privilege" ? `−${(card.power || 6) + bonus}${plus}` : "misfires · loud";
        case "zeroDay": return "SHATTER";
        case "bruteForce": return `−${(card.power || 6) + bonus} · loud`;
        case "backdoor": return `−${(card.power || 4) + bonus} · quiet`;
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
    const bonus = s.exploitBonus;
    switch (card.effect) {
        case "knownExploit": return (d.typeRevealed ? card.power || 4 : Math.ceil((card.power || 4) / 2)) + bonus;
        case "typedExploit": return (d.type === card.matchType ? Math.round((card.power || 5) * 1.6) : Math.round((card.power || 5) * 0.4)) + bonus;
        case "adaptiveExploit": return (card.power || 5) + bonus;
        case "overload": return (card.power || 3) + Math.floor(s.detection / 10) + bonus;
        case "momentum": return (card.power || 3) + (card.amount || 2) * s.layers.filter((l) => l.breached).length + bonus;
        case "precisionStrike": return (card.power || 7) + bonus;
        case "silentScale": return (card.power || 2) + 2 * s.silentThisTurn + bonus;
        case "lowDetStrike": return (s.detection < s.detectionMax * 0.25 ? card.power || 8 : card.amount || 3) + bonus;
        case "chainReaction": return (card.power || 2) + s.cardsThisTurn + bonus;
        case "exploitAll": return (card.power || 3) + bonus;
        case "chainExploit": return (card.power || 3) + 2 * s.exploitsThisTurn + bonus;
        case "logicBomb": return (card.power || 3) * (card.amount || 3);
        case "trojan": return (card.power || 3) + bonus;
        case "privEsc": return d.type === "privilege" ? (card.power || 6) + bonus : 0;
        case "zeroDay": return 999;
        case "bruteForce": return (card.power || 6) + bonus;
        case "backdoor": return (card.power || 4) + bonus;
        case "revealAndWeaken": return card.power || 2;
        default: return 0;
    }
}

export function projectedNoise(s: GameState, cardId: string): number {
    const card = CARDS[cardId];
    if (!card) return 0;
    if (s.rootkitReady) return 0;
    if (s.firstCardSilent && s.cardsThisTurn === 0) return 0;
    let noise = Math.max(0, card.noise - s.noiseReduction);
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

        const firstSilent = s.firstCardSilent && s.cardsThisTurn === 0; // Stealth Boot implant
        const extraNoise = applyEffect(s, card, target);
        let noise = Math.max(0, card.noise + extraNoise - s.noiseReduction);
        if (firstSilent) {
            noise = 0;
        } else if (rootkitBefore && noise > 0) {
            noise = 0;
            s.rootkitReady = false;
            log(s, `${card.name} hidden by Rootkit — silent.`);
        } else if (proxyBefore > 0 && noise > 0) {
            noise = Math.max(0, noise - PROXY_REDUCTION);
            s.proxyCharges -= 1;
        }
        addDetection(s, noise);
        s.turnNoise += noise;
        s.cardsThisTurn += 1;
        if (noise === 0) s.silentThisTurn += 1;
        if (card.kind === "exploit") s.exploitsThisTurn += 1;
        if (s.reconDraw && card.kind === "recon") draw(s, 1); // Recon Suite implant

        if (card.exhausts) log(s, `${card.name} spent (one-time).`);
        else s.discard.push(cardId);

        refreshIntent(s);
        return s;
    }

    if (action.type === "endTurn") {
        s.discard.push(...s.hand);
        s.hand = [];
        tickBombs(s); // planted logic bombs resolve as the turn closes
        systemReact(s);
        addDetection(s, s.baselineCreep);
        s.rootkitReady = false;
        s.turnNoise = 0; // reset the per-turn noise budget
        s.exploitBonus = 0; // Overclock lasts only for the turn it was played
        s.exploitsThisTurn = 0;
        s.cardsThisTurn = 0;
        s.silentThisTurn = 0;
        if (s.outcome === "playing") {
            draw(s, s.handSize);
            s.turn += 1;
        }
        refreshIntent(s);
        return s;
    }

    return prev;
}
