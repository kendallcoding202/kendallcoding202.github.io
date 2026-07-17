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
    | "revealDraw"
    | "analyze"
    | "knownExploit"
    | "typedExploit"
    | "exploitAll"
    | "chainExploit"
    | "logicBomb"
    | "zeroDay"
    | "privEsc"
    | "bruteForce"
    | "trojan"
    | "overclock"
    | "logWipe"
    | "wipeDraw"
    | "proxyChain"
    | "spoof"
    | "feint"
    | "goDark"
    | "backdoor"
    | "rootkit"
    | "patchScanner"
    | "draw"
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
    amount?: number; // secondary magnitude (detection removed, charges, cards drawn, ...)
    matchType?: DefenseType; // for typedExploit: the defense type it specialises against
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

/** A planted logic bomb: chips a specific defense at the end of each turn. */
export interface LogicBomb {
    layer: number; // layer index it was planted on
    def: number; // defense index on that layer
    amt: number; // strength removed per tick
    turns: number; // ticks remaining
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
    turnNoise: number; // noise made from cards THIS turn (resets each turn)

    // stealth / persistence flags
    proxyCharges: number; // Proxy Chain: reduce noise on the next N cards
    rootkitReady: boolean; // hide the next noisy action this turn
    spoofTurns: number; // suppress the system's end-of-turn reaction
    exploitBonus: number; // Overclock: added to your NEXT exploit's damage this turn
    exploitsThisTurn: number; // exploits played this turn (for combo-scaling cards)
    bombs: LogicBomb[]; // planted logic bombs that tick each end of turn

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

/* ============================================================
   CAMPAIGN / RUN LAYER — strings breaches into a story with routes
   ============================================================ */

/** What the single-breach engine reports back to the run. */
export interface BreachResult {
    won: boolean;
    detection: number;
    detectionMax: number;
}

export type RunNodeType = "breach" | "event" | "safehouse";

export interface EventChoice {
    label: string;
    outcome: string; // result text shown after choosing
    heat?: number; // +raises / -lowers run Heat
    credits?: number;
    addCard?: string; // card id granted (may cost credits via `cost`)
    cost?: number; // credits required for this choice
    removeCard?: boolean; // opens a "scrub a card from your deck" flow
    requiresCredits?: number; // choice disabled unless you have this many credits
}

export interface RunNode {
    id: string;
    type: RunNodeType;
    title: string;
    blurb: string; // the story text for this node
    systemKey?: string; // breach: which system provides the difficulty
    reward?: number; // breach: credits on a win
    choices?: EventChoice[]; // event
    heatRelief?: number; // safehouse: Heat removed
    heatCost?: number; // safehouse/event: Heat added when taken
}

/** A node on the campaign MAP: run content plus its position and the
    downstream nodes it leads to. Terminal nodes (next === []) are finales. */
export interface MapNode extends RunNode {
    col: number; // column / depth (0 = entry)
    row: number; // vertical position for layout
    next: string[]; // ids of nodes reachable after resolving this one
}

/** An antagonist that "watches" the run and transmits as you close in.
    `lines[col]` is broadcast when you first reach that map column, so the
    messages escalate with how deep along the path you are. */
export interface Antagonist {
    name: string; // handle shown in the terminal
    lines: string[]; // indexed by column depth (0..)
}

export interface Campaign {
    id: string;
    name: string;
    tagline: string;
    premise: string; // shown on the select card
    handler: string; // who's feeding you jobs
    heatMax: number;
    intro: string; // run-start briefing
    winText: string; // ending on success
    bustedText: string; // ending when Heat maxes out
    map: MapNode[]; // the branching route graph
    entryIds: string[]; // the col-0 nodes you start by choosing from
    antagonist?: Antagonist; // optional watcher that taunts you as you advance
}

export type RunOutcome = "running" | "won" | "busted";

export interface RunState {
    campaignId: string;
    heat: number;
    heatMax: number;
    credits: number;
    deck: string[];
    nodeId: string | null; // the node you're currently AT (null = at the start)
    path: string[]; // ids of nodes resolved so far, in order
    story: string[]; // narrative feed
    outcome: RunOutcome;
    jobsDone: number;
    transmission: string | null; // an incoming antagonist message to surface, if any
}
