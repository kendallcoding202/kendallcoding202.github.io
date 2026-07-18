/* ============================================================
   BREACH — IMPLANTS (relics) as DATA
   Passive cyberware you install during a run. Unlike cards, they
   apply to EVERY breach for the rest of the run, so collecting them
   shapes how your whole run plays. Aggregated into one loadout that
   the breach engine reads at start.
   ============================================================ */

export interface Implant {
    id: string;
    name: string;
    blurb: string;
    handSize?: number; // draw this many more cards a turn
    noiseReduction?: number; // every card makes this much less noise
    detectionMaxDelta?: number; // more room before lockout
    creepDelta?: number; // slow the baseline trace by this much
    breachDraw?: boolean; // draw a card whenever you breach a layer
    reconDraw?: boolean; // recon cards also draw a card
    firstCardSilent?: boolean; // the first card each turn makes no noise
    creditsPerBreach?: number; // extra credits on every successful breach
    exploitFlatBonus?: number; // every exploit deals +N
    bombBonus?: number; // logic bombs tick +N harder
    breachHeal?: number; // breaching a layer lowers detection by N
    startTypeReveal?: boolean; // start each breach seeing the first layer's types
    overkillCarry?: boolean; // overkill damage spills onto the next defense
}

export interface ImplantLoadout {
    handSize: number;
    noiseReduction: number;
    detectionMaxDelta: number;
    creepDelta: number;
    breachDraw: boolean;
    reconDraw: boolean;
    firstCardSilent: boolean;
    creditsPerBreach: number;
    exploitFlatBonus: number; // every exploit deals +N (operator passives + implants)
    bombBonus: number; // logic bombs tick +N harder
    breachHeal: number; // breaching a layer lowers detection by N
    startTypeReveal: boolean; // start each breach seeing the first layer's types
    overkillCarry: boolean; // overkill damage spills onto the next defense
}

const EMPTY_LOADOUT: ImplantLoadout = {
    handSize: 0, noiseReduction: 0, detectionMaxDelta: 0, creepDelta: 0,
    breachDraw: false, reconDraw: false, firstCardSilent: false, creditsPerBreach: 0,
    exploitFlatBonus: 0, bombBonus: 0, breachHeal: 0, startTypeReveal: false, overkillCarry: false,
};

/** Merge loadouts (e.g. an operator's passive + collected implants). */
export function combineLoadouts(...parts: Partial<ImplantLoadout>[]): ImplantLoadout {
    const acc: ImplantLoadout = { ...EMPTY_LOADOUT };
    for (const p of parts) {
        acc.handSize += p.handSize || 0;
        acc.noiseReduction += p.noiseReduction || 0;
        acc.detectionMaxDelta += p.detectionMaxDelta || 0;
        acc.creepDelta += p.creepDelta || 0;
        acc.creditsPerBreach += p.creditsPerBreach || 0;
        acc.exploitFlatBonus += p.exploitFlatBonus || 0;
        acc.bombBonus += p.bombBonus || 0;
        acc.breachHeal += p.breachHeal || 0;
        acc.breachDraw = acc.breachDraw || !!p.breachDraw;
        acc.reconDraw = acc.reconDraw || !!p.reconDraw;
        acc.firstCardSilent = acc.firstCardSilent || !!p.firstCardSilent;
        acc.startTypeReveal = acc.startTypeReveal || !!p.startTypeReveal;
        acc.overkillCarry = acc.overkillCarry || !!p.overkillCarry;
    }
    return acc;
}

export const IMPLANTS: Record<string, Implant> = {
    cortex: { id: "cortex", name: "Overclocked Cortex", blurb: "Draw one extra card every turn — more options, more plays.", handSize: 1 },
    dampener: { id: "dampener", name: "Signal Dampener", blurb: "Every card you play makes 1 less noise. Quieter, all run long.", noiseReduction: 1 },
    buffer: { id: "buffer", name: "Expanded Buffer", blurb: "Raise the detection ceiling by 18 — more room before lockout.", detectionMaxDelta: 18 },
    coolant: { id: "coolant", name: "Coolant System", blurb: "The trace climbs 1 slower at the end of every turn.", creepDelta: 1 },
    exfil: { id: "exfil", name: "Auto-Exfil Rig", blurb: "Draw a card every time you breach a layer.", breachDraw: true },
    reconSuite: { id: "reconSuite", name: "Recon Suite", blurb: "Your recon cards also draw a card.", reconDraw: true },
    stealthBoot: { id: "stealthBoot", name: "Stealth Boot", blurb: "The first card you play each turn makes no noise.", firstCardSilent: true },
    uplink: { id: "uplink", name: "Black-Market Uplink", blurb: "Earn +8 credits after every successful breach.", creditsPerBreach: 8 },
    // --- expansion: archetype and tempo cyberware ---
    neuralLace: { id: "neuralLace", name: "Neural Lace", blurb: "Every exploit you play hits +1 harder — all run long.", exploitFlatBonus: 1 },
    wetware: { id: "wetware", name: "Wetware Graft", blurb: "Your logic bombs tick +1 harder. The worm's best friend.", bombBonus: 1 },
    regenMesh: { id: "regenMesh", name: "Regen Mesh", blurb: "Breaching a layer lowers detection by 5 — press deeper, stay cool.", breachHeal: 5 },
    wardriver: { id: "wardriver", name: "Wardriver", blurb: "Start every breach already knowing the first layer's defense types.", startTypeReveal: true },
    kineticSink: { id: "kineticSink", name: "Kinetic Sink", blurb: "Overkill damage spills onto the next defense on the layer — no wasted hits.", overkillCarry: true },
    blackIce: { id: "blackIce", name: "Black ICE", blurb: "Quieter AND harder: −1 noise on every card, +1 on every exploit.", noiseReduction: 1, exploitFlatBonus: 1 },
    deepCache: { id: "deepCache", name: "Deep Cache", blurb: "Draw +1 a turn, and +8 detection headroom. Room to think.", handSize: 1, detectionMaxDelta: 8 },
    microturbine: { id: "microturbine", name: "Microturbine", blurb: "The trace climbs 1 slower, and every breach pays +5 credits.", creepDelta: 1, creditsPerBreach: 5 },
};

export const IMPLANT_ORDER: string[] = [
    "cortex", "dampener", "buffer", "coolant", "exfil", "reconSuite", "stealthBoot", "uplink",
    "neuralLace", "wetware", "regenMesh", "wardriver", "kineticSink", "blackIce", "deepCache", "microturbine",
];

export function getImplant(id: string): Implant | undefined {
    return IMPLANTS[id];
}

/** Sum a set of installed implants into a single loadout for the breach engine. */
export function aggregateImplants(ids: string[]): ImplantLoadout {
    const parts = ids.map((id) => IMPLANTS[id]).filter(Boolean) as Implant[];
    return combineLoadouts(...parts);
}
