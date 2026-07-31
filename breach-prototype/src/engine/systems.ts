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
        baselineCreep: 7,
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
        baselineCreep: 7,
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
        flavor: "Five layers, a DMZ, and multi-defense chokepoints. Segmented — each layer you breach exposes the next one's defense types.",
        difficulty: 3,
        detectionMax: 126,
        baselineCreep: 7,
        behavior: "segmented",
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 9 }] },
            { name: "DMZ", defenses: [{ type: "firewall", strength: 7 }, { type: "ids", strength: 7, trait: "blackIce" }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 8 }, { type: "auth", strength: 8 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 10, trait: "reactive" }] },
            { name: "Objective: Crown Jewels", defenses: [{ type: "database", strength: 10 }, { type: "auth", strength: 7 }] },
        ],
    },

    blackSite: {
        key: "blackSite",
        name: "Black Site",
        flavor: "Hardened everything, and adaptive — every layer you breach makes the rest tougher. It learns. For ghosts only.",
        difficulty: 5,
        detectionMax: 185,
        baselineCreep: 7,
        behavior: "adaptive",
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 10 }, { type: "ids", strength: 8, trait: "blackIce" }] },
            { name: "Internal Network", defenses: [{ type: "ids", strength: 10 }, { type: "auth", strength: 8 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 11 }, { type: "auth", strength: 8 }] },
            { name: "Vault Gateway", defenses: [{ type: "database", strength: 8, trait: "regen" }, { type: "firewall", strength: 8 }] },
            { name: "Objective: The Core", defenses: [{ type: "database", strength: 12 }, { type: "privilege", strength: 9 }] },
        ],
    },

    honeypotTrap: {
        key: "honeypotTrap",
        name: "Honeypot",
        flavor: "Looks like a soft, juicy target — because it's bait. Cracking each layer trips a silent alarm. Get in and out FAST, before the trap fills up.",
        difficulty: 2,
        detectionMax: 112,
        baselineCreep: 6,
        behavior: "honeypot",
        layers: [
            { name: "Open Port (too easy)", defenses: [{ type: "firewall", strength: 5 }] },
            { name: "Decoy Fileshare", defenses: [{ type: "ids", strength: 6 }] },
            { name: "Objective: Planted Bait", defenses: [{ type: "database", strength: 8 }] },
        ],
    },

    liveOps: {
        key: "liveOps",
        name: "Live Ops Center",
        flavor: "Someone is watching this network in real time. The trace accelerates every single turn — speed is everything. No time to get clever.",
        difficulty: 3,
        detectionMax: 122,
        baselineCreep: 6,
        behavior: "liveClock",
        layers: [
            { name: "Perimeter", defenses: [{ type: "firewall", strength: 8 }] },
            { name: "Ops Floor", defenses: [{ type: "ids", strength: 8 }, { type: "auth", strength: 7 }] },
            { name: "Privilege Escalation", defenses: [{ type: "privilege", strength: 9 }] },
            { name: "Objective: Live Feed", defenses: [{ type: "database", strength: 10 }] },
        ],
    },

    meshGrid: {
        key: "meshGrid",
        name: "Distributed Mesh",
        flavor: "A self-healing grid with no single point of failure — damaged defenses knit back together at the end of every turn. You have to overwhelm a whole layer in one push.",
        difficulty: 4,
        detectionMax: 150,
        baselineCreep: 7,
        behavior: "selfHealing",
        layers: [
            { name: "Edge Nodes", defenses: [{ type: "firewall", strength: 7 }, { type: "ids", strength: 6 }] },
            { name: "Relay Cluster", defenses: [{ type: "ids", strength: 8 }, { type: "auth", strength: 7 }] },
            { name: "Control Plane", defenses: [{ type: "privilege", strength: 9 }] },
            { name: "Objective: Root Ledger", defenses: [{ type: "database", strength: 10 }, { type: "auth", strength: 7 }] },
        ],
    },
};

export const SYSTEM_ORDER = ["homeServer", "smallBusiness", "honeypotTrap", "corpNetwork", "liveOps", "meshGrid", "blackSite"];
export const DEFAULT_SYSTEM = "homeServer";
