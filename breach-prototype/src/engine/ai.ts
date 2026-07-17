/* ============================================================
   BREACH — heuristic "players" for headless balance sims.
   `smart` reads the telegraph (spoofs patches, protects recon) and
   picks targets/matched exploits well; the naive variant ignores the
   telegraph. The gap between them is the game's skill ceiling.
   ============================================================ */

import type { Action, GameState } from "./types.ts";
import { currentLayer, projectedNoise, targetableDefenses } from "./engine.ts";

const play = (card: string): Action => ({ type: "playCard", card });
const playT = (card: string, target: number): Action => ({ type: "playCard", card, target });
const end = (): Action => ({ type: "endTurn" });

export function chooseAction(s: GameState, smart = true): Action {
    return smart ? chooseClever(s) : chooseReckless(s);
}

/** Reckless baseline: no recon, no matched exploits, no telegraph reads —
    just smash the weakest defense and wipe when hot. Shows the cost of
    NOT playing cleverly (blind exploits are weaker and much louder). */
function chooseReckless(s: GameState): Action {
    const has = (id: string) => s.hand.includes(id);
    const opts = targetableDefenses(s);
    const layer = currentLayer(s);
    const defs = layer ? layer.defenses : [];
    const room = s.detectionMax - s.detection;
    const detFrac = s.detection / s.detectionMax;
    const safe = (id: string) => projectedNoise(s, id) < room;

    if (s.objectiveExposed && has("payload")) return play("payload");
    if (detFrac >= 0.85 && has("killSwitch")) return play("killSwitch");
    if (detFrac >= 0.6 && has("logWipe")) return play("logWipe");
    if (detFrac >= 0.6 && has("goDark")) return play("goDark");
    if (!opts.length) return end();
    const weakest = opts.slice().sort((a, b) => defs[a].strength - defs[b].strength)[0];
    if (has("zeroDay") && safe("zeroDay")) return playT("zeroDay", weakest);
    if (has("knownExploit") && safe("knownExploit")) return playT("knownExploit", weakest); // blind = weak & loud
    if (has("bruteForce") && safe("bruteForce")) return playT("bruteForce", weakest);
    if (has("logWipe")) return play("logWipe");
    return end();
}

function chooseClever(s: GameState): Action {
    const smart = true;
    const has = (id: string) => s.hand.includes(id);
    const layer = currentLayer(s);
    const opts = targetableDefenses(s);
    const defs = layer ? layer.defenses : [];
    const room = s.detectionMax - s.detection;
    const detFrac = s.detection / s.detectionMax;
    const safe = (id: string) => projectedNoise(s, id) < room;
    const intent = s.systemIntent;

    // 1. Win the instant we can.
    if (s.objectiveExposed && has("payload")) return play("payload");

    // 2. (smart) Counter the telegraph — spoof a patch/purge that would undo
    //    progress, or an obscure that would wipe recon we've invested in.
    if (smart && has("spoof") && intent && safe("spoof")) {
        const layerDamaged = !!layer && layer.defenses.some((d) => d.strength > 0 && d.strength < d.maxStrength);
        const reconInvested = !!layer && layer.defenses.some((d) => d.typeRevealed || d.strengthRevealed);
        if ((intent.kind === "patch" || intent.kind === "purge") && layerDamaged) return play("spoof");
        if (intent.kind === "obscure" && reconInvested) return play("spoof");
    }

    // 3. Cool down when hot.
    if (detFrac >= 0.85 && has("killSwitch")) return play("killSwitch");
    if (detFrac >= 0.55) {
        if (has("logWipe")) return play("logWipe");
        if (has("goDark")) return play("goDark");
    }

    if (!opts.length) return end();

    const byWeak = opts.slice().sort((a, b) => defs[a].strength - defs[b].strength);
    const weakest = byWeak[0];
    const strongest = byWeak[byWeak.length - 1];
    const firstUnknown = opts.find((i) => !defs[i].typeRevealed);

    // 4. Recon unknown defenses (cheap, quiet) before committing exploits.
    if (firstUnknown != null && detFrac < 0.7) {
        if (has("passiveRecon")) return play("passiveRecon");
        if (has("portScan")) return playT("portScan", firstUnknown);
        if (has("enumerate")) return play("enumerate");
        if (has("socialEngineer")) return playT("socialEngineer", firstUnknown);
    }

    // 5. Matched exploits on matching, revealed defenses.
    const dbIdx = opts.find((i) => defs[i].typeRevealed && defs[i].type === "database");
    if (dbIdx != null && has("sqlInjection") && safe("sqlInjection")) return playT("sqlInjection", dbIdx);
    const privIdx = opts.find((i) => defs[i].typeRevealed && defs[i].type === "privilege");
    if (privIdx != null && has("privEsc") && safe("privEsc")) return playT("privEsc", privIdx);

    // 6. Quiet chip.
    if (has("backdoor") && safe("backdoor")) return playT("backdoor", weakest);

    // 7. Big gun on a strong defense while still quiet — hide it.
    if (has("zeroDay") && detFrac < 0.5 && (defs[strongest].strength >= 6 || !defs[strongest].strengthRevealed)) {
        if (has("rootkit")) return play("rootkit");
        return playT("zeroDay", strongest);
    }

    // 8. Known exploit on a revealed target (weakest revealed).
    const revealedWeak = opts.filter((i) => defs[i].typeRevealed).sort((a, b) => defs[a].strength - defs[b].strength)[0];
    if (revealedWeak != null && has("knownExploit") && safe("knownExploit")) return playT("knownExploit", revealedWeak);

    // 9. Prep stealth before getting loud.
    if (has("proxyChain") && (has("bruteForce") || has("knownExploit"))) return play("proxyChain");
    if (has("rootkit") && has("bruteForce")) return play("rootkit");

    // 10. Desperation.
    if (has("bruteForce") && safe("bruteForce")) return playT("bruteForce", weakest);
    if (has("knownExploit") && safe("knownExploit")) return playT("knownExploit", weakest);

    return end();
}
