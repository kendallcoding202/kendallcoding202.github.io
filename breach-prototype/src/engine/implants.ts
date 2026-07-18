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
};

export const IMPLANT_ORDER: string[] = ["cortex", "dampener", "buffer", "coolant", "exfil", "reconSuite", "stealthBoot", "uplink"];

export function getImplant(id: string): Implant | undefined {
    return IMPLANTS[id];
}

/** Sum a set of installed implants into a single loadout for the breach engine. */
export function aggregateImplants(ids: string[]): ImplantLoadout {
    const acc: ImplantLoadout = {
        handSize: 0, noiseReduction: 0, detectionMaxDelta: 0, creepDelta: 0,
        breachDraw: false, reconDraw: false, firstCardSilent: false, creditsPerBreach: 0,
    };
    for (const id of ids) {
        const im = IMPLANTS[id];
        if (!im) continue;
        acc.handSize += im.handSize || 0;
        acc.noiseReduction += im.noiseReduction || 0;
        acc.detectionMaxDelta += im.detectionMaxDelta || 0;
        acc.creepDelta += im.creepDelta || 0;
        acc.creditsPerBreach += im.creditsPerBreach || 0;
        acc.breachDraw = acc.breachDraw || !!im.breachDraw;
        acc.reconDraw = acc.reconDraw || !!im.reconDraw;
        acc.firstCardSilent = acc.firstCardSilent || !!im.firstCardSilent;
    }
    return acc;
}
