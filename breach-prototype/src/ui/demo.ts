/* ============================================================
   BREACH — demo build configuration
   The free Steam demo is a SLICE of the full game, produced by
   building with the VITE_DEMO flag set (npm run build:demo). One
   codebase, two builds — no forked content to keep in sync.

   The demo exposes:
     · 2 of 4 operators (WRAITH, TORCH) — the others tease the full game
     · 1 of 4 campaigns (Burn Notice — short, self-contained, has a finale)
     · Threat Level 0 only (the ascension ladder is a full-game hook)
   …and ends on a wishlist call-to-action.
   ============================================================ */

// Vite replaces import.meta.env.VITE_DEMO at build time. Undefined in the
// normal build (and in headless node), so the full game is the default.
export const IS_DEMO: boolean = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_DEMO === "1";

// TODO: swap in the real Steam app id once the store page exists.
export const STEAM_URL = "https://store.steampowered.com/app/0000000/BREACH/";

export const DEMO_OPERATORS = ["wraith", "torch"];
export const DEMO_CAMPAIGN = "burn";

export const demoOperatorUnlocked = (id: string): boolean => !IS_DEMO || DEMO_OPERATORS.includes(id);
export const demoCampaignUnlocked = (id: string): boolean => !IS_DEMO || id === DEMO_CAMPAIGN;
