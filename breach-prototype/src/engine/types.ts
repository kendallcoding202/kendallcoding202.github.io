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
    | "adaptiveExploit"
    | "precisionStrike"
    | "overload"
    | "momentum"
    | "silentScale"
    | "lowDetStrike"
    | "meltdown"
    | "contagion"
    | "detonate"
    | "chainReaction"
    | "exploitAll"
    | "chainExploit"
    | "logicBomb"
    | "zeroDay"
    | "privEsc"
    | "bruteForce"
    | "trojan"
    | "overclock"
    | "siphon"
    | "misdirect"
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
    tag?: SynergyTag; // build-archetype this card belongs to / rewards
    text: string;
}

/** Deck archetypes. Cards carry a tag so a build can commit to a strategy,
    and the payoff keystones scale with how hard you've leaned into it. */
export type SynergyTag = "ghost" | "overload" | "worm" | "chain";

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
    behavior?: SystemBehavior; // an intrinsic quirk that makes this target play distinctly
    layers: { name: string; defenses: { type: DefenseType; strength: number }[] }[];
}

/** Intrinsic system behaviors — what makes a Black Site feel different from a
    Home Server beyond bigger numbers.
    - segmented: breaching a layer reveals the NEXT layer's defense types (helpful)
    - adaptive: when a layer breaches, the remaining layers harden (+1 each) */
export type SystemBehavior = "segmented" | "adaptive";

/** The watcher's grip on you, derived from run Heat. The higher the trace,
    the more your targets are warned — so breaches start harder. Telegraphed
    and stacks on top of the rolled SystemModifier. */
export interface HuntPressure {
    tier: number; // 0 calm · 1 warm · 2 hot · 3 critical
    label: string;
    blurb: string;
    detectionStartFrac?: number; // start the breach already this detected
    creepDelta?: number; // faster trace per turn
    strengthDelta?: number; // defenses reinforced
}

/** A per-run twist rolled onto a breach so the same job plays differently
    every run — the core of replayability, and a balance lever. */
export interface SystemModifier {
    key: string;
    label: string; // short badge, e.g. "HARDENED"
    blurb: string; // one-line explanation
    tone: "harder" | "easier" | "neutral";
    strengthDelta?: number; // +/- to every defense's Strength (and max)
    creepDelta?: number; // +/- baseline detection creep per turn
    detectionMaxDelta?: number; // +/- detection ceiling (room to work)
    detectionStartFrac?: number; // start the breach already this far detected
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
    behavior: SystemBehavior | null; // this target's intrinsic quirk
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
    cardsThisTurn: number; // total cards played this turn (for chain/combo payoffs)
    silentThisTurn: number; // cards played that made ZERO noise this turn (for ghost payoffs)
    // passive implant effects (installed for the whole run)
    noiseReduction: number; // every card makes this much less noise
    breachDraw: boolean; // draw a card whenever you breach a layer
    reconDraw: boolean; // recon cards also draw a card
    firstCardSilent: boolean; // the first card each turn makes no noise

    // stealth / persistence flags
    proxyCharges: number; // Proxy Chain: reduce noise on the next N cards
    rootkitReady: boolean; // hide the next noisy action this turn
    spoofTurns: number; // suppress the system's end-of-turn reaction
    exploitBonus: number; // Overclock: added to your NEXT exploit's damage this turn
    exploitsThisTurn: number; // exploits played this turn (for combo-scaling cards)
    bombs: LogicBomb[]; // planted logic bombs that tick each end of turn

    alert: AlertStage; // derived from detection; drives the system's behaviour
    systemIntent: SystemIntent | null; // telegraphed next move (always visible)
    modifierLabel: string | null; // this run's twist on this system, if any
    modifierBlurb: string | null;
    modifierTone: "harder" | "easier" | "neutral" | null;
    huntLabel: string | null; // the watcher's pressure on this breach, if Heat is high
    huntBlurb: string | null;
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

/** A drawable event (from the shared deck or a campaign's signature set). */
export interface EventDef {
    id: string;
    title: string;
    blurb: string;
    choices: EventChoice[];
}

/** The concrete event dealt to an event node for this run. */
export interface RunEvent {
    title: string;
    blurb: string;
    choices: EventChoice[];
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

/** Accumulated run stats for the end-of-run summary. */
export interface RunStats {
    breaches: number; // successful breaches
    quietestPct: number | null; // lowest detection % on a won breach
    loudestPct: number | null; // highest detection % on a won breach
}

export interface RunState {
    campaignId: string;
    seed: number; // deterministic seed for this run's rolled modifiers
    heat: number;
    heatMax: number;
    credits: number;
    deck: string[];
    nodeId: string | null; // the node you're currently AT (null = at the start)
    path: string[]; // ids of nodes resolved so far, in order
    mods: Record<string, string>; // breach node id -> SystemModifier key (rolled at run start)
    events: Record<string, RunEvent>; // event node id -> the event dealt this run
    implants: string[]; // passive cyberware installed this run (Implant ids)
    huntTier: number; // highest watcher-pressure tier reached (to detect crossings)
    stats: RunStats;
    story: string[]; // narrative feed
    outcome: RunOutcome;
    jobsDone: number;
    transmission: string | null; // an incoming antagonist message to surface, if any
}
