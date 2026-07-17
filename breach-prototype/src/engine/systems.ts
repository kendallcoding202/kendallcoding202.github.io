/* ============================================================
   BREACH — targets to breach (data)
   Each system is a stack of layers breached inward; the LAST layer
   is always the objective. Layers can carry multiple defenses that
   must all fall to advance. Difficulty scales layer count, defenses
   per layer, strength, and how fast the trace climbs.
   ============================================================ */

import type { SystemDef } from "./types.ts";

export const SYSTEMS: Record<string, SystemDef> = {
    homeServer: {
        key: "homeServer",
        name: "Home Server",
        flavor: "An under-patched box on a residential line. One defense per layer. A gentle warm-up.",
        difficulty: 1,
        detectionMax: 100,
        baselineCreep: 4,
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 8 }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 10 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 9 }] },
            { name: "Objective: Data Store", defenses: [{ type: "database", strength: 12 }] },
        ],
    },

    smallBusiness: {
        key: "smallBusiness",
        name: "Small Business",
        flavor: "A real office network. The internal layer runs two defenses — you'll need to juggle targets.",
        difficulty: 2,
        detectionMax: 108,
        baselineCreep: 4,
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 9 }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 8 }, { type: "auth", strength: 8 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 10 }] },
            { name: "Objective: Records DB", defenses: [{ type: "database", strength: 12 }] },
        ],
    },

    corpNetwork: {
        key: "corpNetwork",
        name: "Corporate Network",
        flavor: "Five layers, a DMZ, and multi-defense chokepoints. A trace that climbs fast. Bring recon.",
        difficulty: 3,
        detectionMax: 135,
        baselineCreep: 4,
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 9 }] },
            { name: "DMZ", defenses: [{ type: "firewall", strength: 7 }, { type: "ids", strength: 7 }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 8 }, { type: "auth", strength: 8 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 10 }] },
            { name: "Objective: Crown Jewels", defenses: [{ type: "database", strength: 10 }, { type: "auth", strength: 7 }] },
        ],
    },

    blackSite: {
        key: "blackSite",
        name: "Black Site",
        flavor: "Hardened everything. Two defenses on every layer and an aggressive trace. For ghosts only.",
        difficulty: 5,
        detectionMax: 170,
        baselineCreep: 4,
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 10 }, { type: "ids", strength: 8 }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 10 }, { type: "auth", strength: 8 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 11 }, { type: "auth", strength: 8 }] },
            { name: "Vault Gateway", defenses: [{ type: "database", strength: 10 }, { type: "firewall", strength: 8 }] },
            { name: "Objective: The Core", defenses: [{ type: "database", strength: 12 }, { type: "privilege", strength: 9 }] },
        ],
    },
};

export const SYSTEM_ORDER = ["homeServer", "smallBusiness", "corpNetwork", "blackSite"];
export const DEFAULT_SYSTEM = "homeServer";
