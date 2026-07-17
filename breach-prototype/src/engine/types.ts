/* ============================================================
   BREACH — rules engine types
   Pure data model. No UI, no side effects. Everything the game
   needs to describe a breach-in-progress lives in GameState.
   ============================================================ */

export type CardKind = "recon" | "exploit" | "stealth" | "utility";

/** Defense archetypes. Exploits care which type they're up against. */
export type DefenseType = "firewall" | "ids" | "auth" | "privilege" | "database";

export type EffectKind =
    | "revealOne"
    | "revealTypeOnly"
    | "revealAll"
    | "revealAndWeaken"
    | "knownExploit"
    | "zeroDay"
    | "privEsc"
    | "sqlInjection"
    | "bruteForce"
    | "logWipe"
    | "proxyChain"
    | "spoof"
    | "goDark"
    | "backdoor"
    | "rootkit"
    | "patchScanner"
    | "payload"
    | "killSwitch";

/** A card is DATA. The engine reads `effect` + tuning numbers; no logic here. */
export interface CardDef {
    id: string;
    name: string;
    kind: CardKind;
    noise: number; // base detection added when played
    effect: EffectKind;
    power?: number; // breach magnitude
    amount?: number; // secondary magnitude (detection removed, charges, ...)
    needsTarget: boolean; // acts on the current layer's defense
    exhausts?: boolean; // leaves the deck for the rest of the breach
    text: string;
}

export interface Defense {
    type: DefenseType;
    strength: number;
    maxStrength: number;
    typeRevealed: boolean; // do we know WHAT it is?
    strengthRevealed: boolean; // do we know how strong?
}

export interface Layer {
    name: string;
    defenses: Defense[]; // ALL must be breached to advance inward
    breached: boolean;
}

export interface SystemDef {
    key: string;
    name: string;
    flavor: string;
    difficulty: number; // 1..5, for the select screen
    detectionMax: number;
    baselineCreep: number; // detection gained at end of each turn (time pressure)
    layers: { name: string; defenses: { type: DefenseType; strength: number }[] }[];
}

export type Outcome = "playing" | "won" | "lost";

export type AlertStage = "IDLE" | "SUSPICIOUS" | "ALERTED" | "LOCKDOWN";

/** What the system has TELEGRAPHED it will do at the next end of turn.
    Making this visible is what turns the reactive opponent into a fair,
    outsmartable puzzle instead of random escalation. */
export interface SystemIntent {
    kind: "idle" | "patch" | "harden" | "obscure" | "purge";
    label: string;
    layerName?: string;
}

export interface GameState {
    system: string;
    detection: number;
    detectionMax: number;
    baselineCreep: number;

    layers: Layer[];
    current: number; // index of the layer we're breaching
    objectiveExposed: boolean; // final layer breached; play Payload to win

    deck: string[];
    hand: string[];
    discard: string[];
    handSize: number;
    turn: number;

    // stealth / persistence flags
    proxyCharges: number; // Proxy Chain: reduce noise on the next N cards
    rootkitReady: boolean; // hide the next noisy action this turn
    spoofTurns: number; // suppress the system's end-of-turn reaction

    alert: AlertStage; // derived from detection; drives the system's behaviour
    systemIntent: SystemIntent | null; // telegraphed next move (always visible)
    rng: number; // deterministic RNG state
    outcome: Outcome;
    lossReason: string | null;
    log: string[];
}

export type Action =
    | { type: "playCard"; card: string; target?: number } // target = defense index on current layer
    | { type: "endTurn" };
