/* ============================================================
   BREACH — heuristic "players" for headless balance sims.
   `smart` reads the telegraph (spoofs patches, protects recon) and
   picks targets/matched exploits well; the naive variant ignores the
   telegraph. The gap between them is the game's skill ceiling.
   ============================================================ */

import type { Action, GameState } from "./types.ts";
import { CARDS } from "./cards.ts";
import { currentLayer, projectedNoise, targetableDefenses, predictDamage, grabForecast } from "./engine.ts";

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
    const has = (id: string) => s.hand.includes(id);
    const layer = currentLayer(s);
    const opts = targetableDefenses(s);
    const defs = layer ? layer.defenses : [];
    const room = s.detectionMax - s.detection;
    const detFrac = s.detection / s.detectionMax;
    const safe = (id: string) => projectedNoise(s, id) < room;
    const intent = s.systemIntent;

    // 1. Win the instant we can.

    // 2. Counter the telegraph — spoof/misdirect/feint a patch/purge that would
    //    undo progress, or an obscure that would wipe recon we've invested in.
    const spoofer = ["spoof", "misdirect", "feint", "honeypot"].find((c) => has(c) && safe(c));
    if (spoofer && intent) {
        const layerDamaged = !!layer && layer.defenses.some((d) => d.strength > 0 && d.strength < d.maxStrength);
        const reconInvested = !!layer && layer.defenses.some((d) => d.typeRevealed || d.strengthRevealed);
        if ((intent.kind === "patch" || intent.kind === "purge") && layerDamaged) return play(spoofer);
        if (intent.kind === "obscure" && reconInvested) return play(spoofer);
    }

    // 3. Cool down when hot (misdirect also cancels a move, so it leads). On the
    //    final layer, judge "hot" against the post-grab projection so we bank
    //    headroom for the alarm spike before taking the objective.
    const onFinal = !!layer && s.current === s.layers.length - 1;
    const hotFrac = onFinal ? grabForecast(s).frac : detFrac;
    if (hotFrac >= 0.85 && has("killSwitch")) return play("killSwitch");
    if (hotFrac >= 0.55) {
        if (has("misdirect")) return play("misdirect");
        if (has("vanish")) return play("vanish");
        if (has("coverTracks")) return play("coverTracks");
        if (has("logWipe")) return play("logWipe");
        if (has("cloak")) return play("cloak");
        if (has("goDark")) return play("goDark");
    }

    if (!opts.length) return end();

    // 3.5 Exfil discipline: grabbing the objective trips a hard alarm. On the final
    //     layer, don't take the last defense while the grab would catch us — cool
    //     down first if we have any means. Only take the shot when we'll survive it
    //     (or when there's nothing left to cool us and it's a hail-mary anyway).
    if (onFinal && opts.length === 1 && grabForecast(s).caught) {
        const cooler = ["misdirect", "vanish", "coverTracks", "logWipe", "cloak", "goDark", "killSwitch"].find((c) => has(c));
        if (cooler) return play(cooler);
        // no cooler in hand: draw/recon to dig for one while the layer still stands,
        // rather than immediately busting on the grab.
        for (const c of ["deadDrop", "automate", "macro", "dataSiphon", "quietScan", "passiveRecon"]) if (has(c) && safe(c)) return play(c);
        // truly nothing — fall through and take the shot (better than looping).
    }

    const byWeak = opts.slice().sort((a, b) => defs[a].strength - defs[b].strength);
    const weakest = byWeak[0];
    const strongest = byWeak[byWeak.length - 1];
    const firstUnknown = opts.find((i) => !defs[i].typeRevealed);
    const standing = opts.filter((i) => defs[i].strength > 0);

    // 4. Draw for options while it's quiet and the hand is thin.
    if (detFrac < 0.5 && s.hand.length <= 4) {
        if (has("automate") && safe("automate")) return play("automate");
        if (has("macro") && safe("macro")) return play("macro");
        if (has("dataSiphon") && safe("dataSiphon")) return play("dataSiphon");
        if (has("scriptRunner") && safe("scriptRunner")) return play("scriptRunner");
        if (has("deadDrop")) return play("deadDrop");
        if (has("analyze") && firstUnknown != null && safe("analyze")) return play("analyze");
        if (firstUnknown != null && has("packetSniffer")) return playT("packetSniffer", firstUnknown);
    }

    // 5. Recon unknown defenses (cheap, quiet) before committing exploits.
    if (firstUnknown != null && detFrac < 0.75) {
        if (has("passiveRecon")) return play("passiveRecon");
        if (has("quietScan")) return play("quietScan");
        if (has("packetSniffer")) return playT("packetSniffer", firstUnknown);
        if (has("patchScanner") && safe("patchScanner")) return play("patchScanner");
        if (has("portScan")) return playT("portScan", firstUnknown);
        if (has("enumerate")) return play("enumerate");
        if (has("socialEngineer")) return playT("socialEngineer", firstUnknown);
    }

    // 6. Cash in planted worm bombs when the blast would breach or nearly clear
    //    a defense (Detonate hits for amt*turns each, immediately).
    if (has("detonate") && s.bombs.length && safe("detonate")) {
        const blast = s.bombs.reduce((sum, b) => {
            const d = s.layers[b.layer]?.defenses[b.def];
            return sum + (d ? Math.min(b.amt * b.turns, d.strength) : 0);
        }, 0);
        const wouldClear = s.bombs.some((b) => { const d = s.layers[b.layer]?.defenses[b.def]; return d && d.strength > 0 && b.amt * b.turns >= d.strength; });
        if (wouldClear || blast >= 8) return play("detonate");
    }

    // 7. Pick the best attack this turn across EVERY attack shape — targeted
    //    exploits, auto-target strikes, and layer-wide hits — by strength removed.
    const reserved = new Set(["zeroDay", "bruteForce"]);
    let best: { action: Action; val: number } | null = null;
    const consider = (action: Action, val: number) => { if (val > 0 && (!best || val > best.val)) best = { action, val }; };
    const revealed = opts.filter((i) => defs[i].typeRevealed);
    for (const id of s.hand) {
        const c = CARDS[id];
        if (!c || reserved.has(id) || !safe(id)) continue;
        const isAttack = c.kind === "exploit" || c.effect === "backdoor" || c.effect === "trojan";
        if (!isAttack) continue;
        if (c.needsTarget) {
            // best revealed target for this card (specialists shine on their type)
            let localBest: { t: number; dmg: number } | null = null;
            for (const t of revealed) {
                const dmg = Math.min(predictDamage(s, id, t), defs[t].strength);
                if (dmg > 0 && (!localBest || dmg > localBest.dmg)) localBest = { t, dmg };
            }
            // logic bombs are delayed — value them at a discount so immediate hits win ties
            if (localBest) consider(playT(id, localBest.t), c.effect === "logicBomb" ? localBest.dmg * 0.6 : localBest.dmg);
        } else if (c.effect === "precisionStrike") {
            if (standing.length) consider(play(id), Math.min(predictDamage(s, id, weakest), defs[weakest].strength));
        } else if (c.effect === "exploitAll") {
            const each = (c.power || 3);
            consider(play(id), standing.reduce((sum, i) => sum + Math.min(each, defs[i].strength), 0));
        } else if (c.effect === "meltdown") {
            const per = Math.max(1, Math.floor(s.detection / (c.amount || 12)));
            if (per >= 2) consider(play(id), standing.reduce((sum, i) => sum + Math.min(per, defs[i].strength), 0));
        } else if (c.effect === "contagion") {
            // plant on all standing; delayed, so discounted
            consider(play(id), standing.reduce((sum, i) => sum + Math.min((c.power || 2) * (c.amount || 3), defs[i].strength), 0) * 0.6);
        } else if (c.effect === "splitHit") {
            const two = standing.slice().sort((a, b) => defs[a].strength - defs[b].strength).slice(0, 2);
            consider(play(id), two.reduce((sum, i) => sum + Math.min(c.power || 4, defs[i].strength), 0));
        } else if (c.effect === "overflowAll") {
            const per = Math.floor(s.cardsThisTurn / 2);
            if (per >= 1) consider(play(id), standing.reduce((sum, i) => sum + Math.min(per, defs[i].strength), 0));
        }
    }
    if (best) return (best as { action: Action; val: number }).action;

    // 8. Big gun on a strong defense while still quiet — hide it if we can.
    if (has("zeroDay") && detFrac < 0.5 && (defs[strongest].strength >= 6 || !defs[strongest].strengthRevealed)) {
        if (has("rootkit")) return play("rootkit");
        return playT("zeroDay", strongest);
    }

    // 9. Prep stealth/buff before getting loud.
    if (has("overclock") && (has("bruteForce") || has("knownExploit") || has("polymorph")) && safe("overclock")) return play("overclock");
    if (has("proxyChain") && (has("bruteForce") || has("knownExploit"))) return play("proxyChain");
    if (has("rootkit") && has("bruteForce")) return play("rootkit");

    // 10. Desperation.
    if (has("bruteForce") && safe("bruteForce")) return playT("bruteForce", weakest);
    if (has("knownExploit") && safe("knownExploit")) return playT("knownExploit", weakest);
    if (has("scriptKiddie") && safe("scriptKiddie")) return playT("scriptKiddie", weakest);

    return end();
}
