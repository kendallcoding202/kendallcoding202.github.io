/* ============================================================
   BREACH — terminal UI.
   App is a mode machine: campaign select → run (a branching MAP,
   Heat, deck-building, story, and — on some runs — a watcher that
   taunts you as you close in) → breach → ending. All game logic
   lives in engine/ and run.ts; this file only renders and dispatches.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import type { BreachResult, Campaign, Defense, EventChoice, GameState, MapNode, RunState } from "../engine/types.ts";
import { CARDS } from "../engine/cards.ts";
import { SYSTEMS } from "../engine/systems.ts";
import { CAMPAIGNS, CAMPAIGN_ORDER, REWARD_POOL } from "../engine/campaigns.ts";
import { getModifier } from "../engine/modifiers.ts";
import { IMPLANTS, IMPLANT_ORDER, getImplant, aggregateImplants, combineLoadouts } from "../engine/implants.ts";
import { HACKERS, HACKER_ORDER, getHacker } from "../engine/hackers.ts";
import { threatEffects, threatLabel, THREAT_STEPS, MAX_THREAT } from "../engine/threat.ts";
import { recordWin, syncAchievements, isCampaignUnlocked, availableThreat, maxThreatCleared, campaignRequirement, loadProfile, unlockedAchievements, TOTAL_ACHIEVEMENTS, exportProfile, importProfile } from "./meta.ts";
import { ACHIEVEMENTS, getAchievement } from "../engine/achievements.ts";
import { HeroFace, WatcherFace } from "./Faces.tsx";
import { IS_DEMO, STEAM_URL, FEEDBACK_EMAIL, demoOperatorUnlocked, demoCampaignUnlocked } from "./demo.ts";
import { sfx } from "./audio.ts";
import { createInitialState, applyAction, canPlay, projectedNoise, needsTarget, targetableDefenses, previewOnTarget, sweepForecast, grabForecast } from "../engine/engine.ts";
import { createRun, currentOptions, atFinale, isTerminal, resolveBreach, resolveEvent, resolveSafehouse, addCard, addImplant, removeCard, getCampaign, getNode, clearTransmission, huntPressure } from "../engine/run.ts";
import type { HuntPressure, SystemModifier } from "../engine/types.ts";

const newSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0;
const meterColor = (f: number) => (f < 0.3 ? "#4af626" : f < 0.6 ? "#ffb000" : f < 0.85 ? "#ff7a1a" : "#ff4141");
function pickN(pool: string[], n: number): string[] {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
}
const pick3 = (pool: string[]) => pickN(pool, 3);

/** A card-sized panel for an implant (in the reward chooser). */
function ImplantCard({ id, onClick, num }: { id: string; onClick?: () => void; num?: number }) {
    const im = getImplant(id);
    if (!im) return null;
    return (
        <div className={"card implant" + (onClick ? " playable" : "")} onClick={onClick} title={im.blurb}>
            <div className="chead"><span className="cname">{num ? <span className="kbd">{num}</span> : null}◆ {im.name}</span></div>
            <div className="kind">implant · passive</div>
            <div className="ctext">{im.blurb}</div>
        </div>
    );
}
const nodeIcon = (n: MapNode) => (n.type === "breach" ? (isTerminal(n) ? "★" : "◈") : n.type === "safehouse" ? "☂" : "❋");
// per-archetype card glyph, so the hand reads visually at a glance (colour comes from --k)
const KIND_ICON: Record<string, string> = { exploit: "↯", recon: "⊙", stealth: "◐", utility: "❖" };
/* The living backdrop's mood — written by whichever screen is active, read by the
   code-rain loop every frame. 0 = calm ghost-green drizzle, 1 = red lockdown torrent. */
const RAIN_MOOD = { t: 0 };
/* Every card's hand-picked sigil — the glyph-mark that makes it recognisable at a
   glance. Rendered big-and-glowing in the card's art banner and as a watermark. */
const CARD_SIGIL: Record<string, string> = {
    // recon — eyes on the target
    portScan: "⌗⊚", passiveRecon: "◎⌇", enumerate: "≣⌗", socialEngineer: "⊙?", packetSniffer: "∿⊚",
    analyze: "≡⚙", quietScan: "◌⌗", patchScanner: "⚙⌗", dataSiphon: "▼≋", portKnock: "∴⌂", honeypot: "◉∿",
    // exploits — the cutting edge
    knownExploit: "⟫≡", scriptKiddie: "»»", sqlInjection: "▤⚡", firewallBypass: "▦❯", idsEvasion: "◎⌀",
    rainbowTable: "≣#", privEsc: "▲❯", zeroDay: "⌀⟫", bruteForce: "██", empBurst: "◉⌁", polymorph: "◇◆",
    precisionStrike: "⌖❯", overload: "⚡⚡", momentum: "⟫⟫", meltdown: "≋▓", wreckingBall: "●▬",
    powerSurge: "⚡❯", shortCircuit: "⌁✕", thermalRunaway: "≋≋", adrenalineRush: "❯❯❯", overflow: "≋█",
    bufferOverflow: "[≋]", quickHack: "❯⌁", daisyChain: "◈◈", scriptRunner: "»⚙", macro: "≣»",
    heuristicEngine: "⚙◎", sqlmap: "▤»", dictionaryAttack: "≣∴", wafBypass: "▦⌀", icePick: "❄▲",
    tokenTheft: "⊛❮", coldBoot: "❄⌁", glassCutter: "◇╱", corrosiveAgent: "⚗▒", acidWash: "⚗≋",
    phantomJab: "◌❯", ghostInTheShell: "◌⊙",
    // stealth — the quiet arts
    ghostProtocol: "◌⌁", blindSpot: "◎▒", goDark: "○●", coverTracks: "✕⌇", logWipe: "≣✕",
    proxyChain: "◈┄◈", spoof: "◎≠", feint: "❮❯", vanish: "◌◌", cloak: "▒◌", misdirect: "❮⌁", deadDrop: "▼◌",
    // worms & rot
    logicBomb: "▚☣", parasite: "☣❮", blight: "☣▒", incubate: "◔☣", viralLoad: "☣≋", necroticTouch: "☠❯",
    contagion: "☣∷", detonate: "▚⚡", trojan: "⌂☣", backdoor: "⌂❮", rootkit: "▼⚙",
    // utility — the toolkit
    killSwitch: "⊘❯", automate: "⚙»", overclock: "⚙⚡", cascade: "▼▼", chainReaction: "∞⚡",
};
const cardSigil = (id: string, kind: string) => CARD_SIGIL[id] || KIND_ICON[kind] || "◈";
// the operator's voice — short lines fired at key beats (picked at random for variety)
const HERO_QUIPS: Record<string, string[]> = {
    start: ["In and out. No trace.", "Let's keep this quiet.", "Clock's running — move.", "Doors are mine.", "Nice and slow. No noise.", "Patch me in. I'm going dark."],
    layer: ["One down.", "Layer's mine.", "Through. Keep moving.", "Next wall.", "Too easy.", "Peeled that one open.", "Deeper we go."],
    cascade: ["Now we're cooking.", "Chain's live — can't stop me.", "Faster than they can log.", "Everything's falling at once.", "This is the sweet spot."],
    hot: ["Too hot, too hot.", "They're onto me.", "Come on, come on…", "Cutting it close.", "The trace is breathing down my neck.", "Losing my cover — move it."],
    quiet: ["Silent as a ghost.", "They don't even know I'm here.", "Not a whisper on the wire.", "Invisible. Good."],
    suspicious: ["They twitched. Careful now.", "Something pinged. Stay smooth.", "Eyes are opening. Ease off."],
    won: ["Data's mine. Ghost out.", "Clean. Nobody saw a thing.", "Gone before the alarm.", "Extraction complete. I was never here.", "That's how it's done."],
    lost: ["Burned. Pulling out.", "They made me — damn.", "Not clean. Bailing.", "Cover's blown. I'm gone.", "Should've stayed quieter."],
    poke: ["Still here. Still a ghost.", "Working on it. Keep your head down.", "Trace is holding. For now.", "Give me a second — almost through.", "Talk less, hack more.", "I've got this. Probably."],
};
// the watcher breaks into your comms when the trace is closing in
const WATCHER_LINES = ["I see you moving in there.", "You can't stay quiet forever.", "Getting warmer. I'm coming.", "Every door you open, I hear.", "Run while you still can, ghost.", "I've got your scent now."];
const SWEEP_LINES = ["Silence is a signature. Found you.", "Nothing on the wire but you. Gotcha.", "Too still. The sweep sees a ghost that forgot to move.", "You went quiet. That's how I knew where to look."];
const pickFrom = (a: string[]) => a[(Math.random() * a.length) | 0];
const pickQuip = (k: string) => pickFrom(HERO_QUIPS[k]);
// a distinct "gate" emblem per breach layer so each reads as its own barrier
const LAYER_EMBLEMS = ["▦", "⊞", "⬢", "◈", "⟠", "⊠"];
const layerEmblem = (i: number, total: number) => (i === total - 1 ? "⊛" : LAYER_EMBLEMS[i % LAYER_EMBLEMS.length]);
// each defence type gets its OWN mark, so every layer reads as a distinct wall
const TYPE_EMBLEM: Record<string, string> = { firewall: "▦", ids: "◎", auth: "⊟", privilege: "▲", database: "▤" };
const typeEmblem = (t: string) => TYPE_EMBLEM[t] || "◈";
// system archetype (behavior) — telegraphed on the breach header so you can adapt
const BEHAVIOR_META: Record<string, { icon: string; label: string; tip: string }> = {
    segmented: { icon: "▤", label: "SEGMENTED", tip: "Crossing into a layer exposes the next layer's defense types — recon comes free as you advance." },
    adaptive: { icon: "◈", label: "ADAPTIVE", tip: "It learns — each layer you breach hardens the next fight (+1 to each of its defenses)." },
    honeypot: { icon: "🍯", label: "HONEYPOT", tip: "Bait. Cracking each layer trips a silent alarm (+detection). Get in and out FAST — don't linger." },
    liveClock: { icon: "📡", label: "LIVE-MONITORED", tip: "Watched in real time — the trace ACCELERATES every turn. Speed beats cleverness here." },
    selfHealing: { icon: "🕸", label: "SELF-HEALING", tip: "Damaged defenses knit back +2 at end of every turn. Overwhelm a whole layer in one push, or you lose the ground." },
    rogueAI: { icon: "🧠", label: "THE ROGUE", tip: "A living opponent. It learns every door you cross (+1 to the next layer), the trace quickens the deeper you cut, and it stitches deep wounds shut — the last door regenerates. Bring your whole kit." },
};
// active-countermeasure (ICE) display — revealed with the defense type
const TRAIT_META: Record<string, { icon: string; label: string; tip: string }> = {
    reactive: { icon: "⛨", label: "REACTIVE", tip: "Reactive Armor — hardens (+1 Strength) each time you hit it without killing it. Burst it in one blow; don't chip away." },
    blackIce: { icon: "⚡", label: "BLACK ICE", tip: "Black ICE — bites back with +3 detection every time you attack it and don't kill it. One-shot it, or rot it with a worm (logic bombs don't trigger it)." },
    regen: { icon: "♻", label: "REGEN", tip: "Self-healing — knits back +3 Strength at end of turn if it's still standing. Finish it within a single turn." },
};
// escalating danger colour by depth: cool green at the perimeter → hot red at the core
const dangerColor = (i: number, total: number) => `hsl(${Math.round(150 - 150 * (total > 1 ? i / (total - 1) : 0))}, 78%, 58%)`;

function MuteButton() {
    const [m, setM] = useState(sfx.isMuted());
    return <button className="term ghost tiny" onClick={() => setM(sfx.toggleMute())} title={m ? "sound off — click for sound" : "sound on"}>{m ? "🔇" : "🔊"}</button>;
}

function crtIsOn(): boolean { try { return localStorage.getItem("breach_crt") !== "0"; } catch { return true; } }
function applyCrt(on: boolean) { document.documentElement.classList.toggle("crt", on); try { localStorage.setItem("breach_crt", on ? "1" : "0"); } catch { /* ignore */ } }
function CrtButton() {
    const [on, setOn] = useState(crtIsOn);
    const toggle = () => { const v = !on; setOn(v); applyCrt(v); };
    return <button className="term ghost tiny crt-btn" style={{ marginRight: 8 }} onClick={toggle} title="CRT screen effect">{on ? "▣" : "▢"} CRT</button>;
}

/* ---------- rules briefing (accessible via ?) ---------- */
function Intro({ onClose }: { onClose: () => void }) {
    return (
        <div className="overlay intro">
            <div className="box">
                <h2 className="cyan">HOW TO BREACH</h2>
                <div className="brief">
                    <p><span className="amber">DETECTION</span> is everything. Every card makes <b>NOISE</b> that fills the meter. Fill it and you're <span className="red">locked out</span> (the job fails). Loud tools are powerful; quiet ones keep you invisible.</p>
                    <p><span className="amber">BREACH INWARD</span> through the layers. Each defense has a <b>Strength</b>; reduce it to 0 with exploits, clear every defense on a layer to move inward. Defenses start <b>UNKNOWN</b> — spend quiet <b>recon</b> to reveal type &amp; Strength, then hit each with its <b>matching exploit</b>.</p>
                    <p className="muted">Targeted cards (◎): click the card, then the glowing defense. You draw 6 a turn; ending a turn discards your hand and redraws — the deck recycles, nothing is lost. Holding cards is how you stay quiet.</p>
                    <p><span className="amber">THE SYSTEM REACTS</span> and <b>tells you its next move</b> (SYSTEM ALERT). Read it and counter — Spoof its patch, or breach a defense before it hardens.</p>
                    <p><span className="amber">⊚ TRACE SWEEP</span> runs every few turns. Go <b>too quiet</b> and it isolates your position — detection spikes. Recent <b>noise masks you</b>, so silence isn't free: finish fast, or make a little noise before it fires. The countdown &amp; projected hit are always shown.</p>
                    <p><span className="amber">THE GRAB GOES LOUD</span>. Cracking the final <b>objective</b> layer trips every alarm — a hard detection spike. Arrive with headroom and you exfiltrate clean; grab while you're in <span className="red">LOCKDOWN</span> and it catches you with the data in hand. The exfil risk is shown live on the objective.</p>
                    <p className="muted">Win the job: crack the objective and get out. Enter = end turn · Esc = cancel targeting.</p>
                </div>
                <button className="term" onClick={onClose}>Got it ▸</button>
            </div>
        </div>
    );
}

/** Aggregate the logic bombs planted on one defense: total decay per turn and
    how long the rot keeps ticking. Lets the chip SHOW that a worm is planted. */
function wormOn(state: GameState, layer: number, def: number): { amt: number; turns: number; count: number } | null {
    const on = state.bombs.filter((b) => b.layer === layer && b.def === def);
    if (!on.length) return null;
    return { amt: on.reduce((a, b) => a + b.amt, 0), turns: Math.max(...on.map((b) => b.turns)), count: on.length };
}

function DefenseChip({ d, chipId, worm, targetable, preview, kbdNum, hit, onClick }: { d: Defense; chipId?: string; worm?: { amt: number; turns: number; count: number } | null; targetable: boolean; preview?: string | null; kbdNum?: number; hit?: { amt: number; key: number }; onClick: () => void }) {
    const down = d.strength <= 0;
    return (
        <span data-chip={chipId} className={"dchip" + (targetable ? " targetable" : "") + (down ? " down" : "") + (worm && !down ? " infected" : "") + (d.typeRevealed && !down ? " t-" + d.type : "")} onClick={targetable ? onClick : undefined}>
            {hit && hit.amt > 0 ? <span className="dmg-float" key={hit.key}>−{hit.amt}</span> : null}
            {targetable && kbdNum ? <span className="kbd">{kbdNum}</span> : null}
            {down ? "✓ down" : d.typeRevealed ? <b className={"dtype t-" + d.type}>{d.type}</b> : <span className="muted">???</span>}
            {!down && d.typeRevealed && d.trait && TRAIT_META[d.trait] && (
                <span className={"dtrait tr-" + d.trait} title={TRAIT_META[d.trait].tip}><span className="tr-ico" aria-hidden>{TRAIT_META[d.trait].icon}</span>{TRAIT_META[d.trait].label}</span>
            )}
            {!down && (
                <span className="ds">
                    {d.strengthRevealed ? (
                        <><span className="dbar"><span className="df" style={{ width: `${(d.strength / d.maxStrength) * 100}%` }} /></span><span className="snum">STR {d.strength}</span></>
                    ) : (<span className="snum">STR ??</span>)}
                </span>
            )}
            {!down && (d.corrode || 0) > 0 && (
                <span className="corrode-badge" title={`Corroded ×${d.corrode} — this defense takes +${d.corrode} extra damage from every direct hit. Stacks; lasts the whole breach.`}>
                    <span className="cr-ico" aria-hidden>⚗</span>×{d.corrode}
                </span>
            )}
            {worm && !down && (
                <span className="worm-badge" title={`${worm.count > 1 ? worm.count + " worms" : "Worm"} eating this defense: −${worm.amt} strength at end of each turn, ${worm.turns} turn${worm.turns === 1 ? "" : "s"} left.`}>
                    <span className="worm-ico" aria-hidden>☣</span>−{worm.amt}/t<span className="worm-turns"> · {worm.turns}⟳</span>{worm.count > 1 ? <span className="worm-x"> ×{worm.count}</span> : null}
                </span>
            )}
            {targetable && preview && <span className="preview">▸ {preview}</span>}
        </span>
    );
}

function CardMini({ id, onClick, dim, num }: { id: string; onClick?: () => void; dim?: boolean; num?: number }) {
    const def = CARDS[id];
    if (!def) return null;
    return (
        <div className={"card mini kind-" + def.kind + (onClick ? " playable" : "") + (dim ? " disabled" : "")} onClick={onClick} title={def.text}>
            <div className="cart-bg" aria-hidden><span className="cart-wm">{cardSigil(id, def.kind)}</span></div>
            <div className="chead">
                <span className="cname">{num ? <span className="kbd">{num}</span> : null}<span className="cicon" aria-hidden>{KIND_ICON[def.kind] || "◈"}</span>{def.name}{def.needsTarget ? <span className="muted"> ◎</span> : null}</span>
                <span className="noise" style={{ color: def.noise === 0 ? "#35e0d8" : "#ffb000" }}>{def.noise === 0 ? "SILENT" : "◈" + def.noise}</span>
            </div>
            <div className="kind">{def.kind}{def.tag ? <span className={"synergy s-" + def.tag}> · {def.tag}</span> : null}</div>
            <div className="ctext">{def.text}</div>
        </div>
    );
}

/* ---------- the watcher's incoming transmission (typed out) ---------- */
function Transmission({ name, text, onClose }: { name: string; text: string; onClose: () => void }) {
    const [shown, setShown] = useState("");
    const done = shown.length >= text.length;
    useEffect(() => {
        sfx.play("transmission");
        setShown("");
        let i = 0;
        const id = setInterval(() => { i++; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(id); }, 26);
        return () => clearInterval(id);
    }, [text]);
    return (
        <div className="overlay transmission" onClick={() => (done ? onClose() : setShown(text))}>
            <div className="box tbox" onClick={(e) => e.stopPropagation()}>
                <div className="tbar"><span className="tdot" /> INCOMING TRANSMISSION — SOURCE UNKNOWN</div>
                <div className="trow">
                    <WatcherFace talking={!done} state="tense" className="txface" />
                    <div className="tside">
                        <div className="tbody">
                            <span className="tname">{name} ›</span> <span className="ttext">{shown}</span><span className="tcursor">█</span>
                        </div>
                        {!done ? (
                            <button className="term ghost tiny" onClick={() => setShown(text)}>skip ▸</button>
                        ) : (
                            <button className="term" onClick={onClose}>◂ sever the connection</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ============================================================
   OPERATOR COMMS — the dedicated character panel in a breach
   ============================================================ */
function CommsPanel({ op, opState, feed, onPoke }: { op: string; opState: "calm" | "tense" | "alarmed"; feed: { who: "op" | "watcher"; text: string; key: number }[]; onPoke: () => void }) {
    const compromised = opState === "alarmed";
    return (
        <div className={"comms fx-" + opState}>
            <button className="comms-face" onClick={onPoke} title="ping your operator" aria-label="ping your operator">
                {compromised ? <WatcherFace state="alarmed" /> : <HeroFace op={op} state={opState} />}
                <span className="comms-tag">{compromised ? "⌁ TRACE LOCK" : opState === "tense" ? "ON EDGE" : "GHOST"}</span>
            </button>
            <div className="comms-feed">
                <div className="comms-head"><span className="cdot" /> SECURE CHANNEL — {compromised ? <span className="red">COMPROMISED</span> : "operator online"}<span className="comms-hint"> · tap the face to ping</span></div>
                <div className="comms-lines">
                    {feed.length === 0
                        ? <div className="cline muted">…patching into the channel…</div>
                        : feed.map((l) => <div key={l.key} className={"cline " + l.who}><b>{l.who === "watcher" ? "⌁ WATCHER" : "› YOU"}</b> {l.text}</div>)}
                </div>
            </div>
        </div>
    );
}

/** Flanking comms towers that fill the side gutters on wide screens: the hero
    operator on the left (always with you), and the watcher/villain on the right
    that stays dormant while you're a ghost, then rises in and escalates as the
    trace climbs. Hidden on narrower screens (the inline CommsPanel covers those). */
function CommsTowers({ op, opState, alert, detFrac, feed, onPoke, onTaunt }: { op: string; opState: "calm" | "tense" | "alarmed"; alert: string; detFrac: number; feed: { who: "op" | "watcher"; text: string; key: number }[]; onPoke: () => void; onTaunt: () => void }) {
    const opLines = feed.filter((f) => f.who === "op").slice(-7);
    const watcherLines = feed.filter((f) => f.who === "watcher").slice(-7);
    const vClass = alert === "LOCKDOWN" ? "lockdown" : alert === "ALERTED" ? "hunting" : alert === "SUSPICIOUS" ? "watching" : "dormant";
    const vState: "calm" | "tense" | "alarmed" = alert === "LOCKDOWN" ? "alarmed" : alert === "ALERTED" || alert === "SUSPICIOUS" ? "tense" : "calm";
    const vLabel = alert === "LOCKDOWN" ? "⌁ TRACE LOCKED" : alert === "ALERTED" ? "⌁ HUNTING YOU" : alert === "SUSPICIOUS" ? "⌁ ON YOUR TRAIL" : "⌁ TRACE DORMANT";
    // live vitals fill the space under each portrait: the operator's signal drains
    // as the trace climbs (with a pulse that races when things get hot); the watcher's
    // lock fills toward you. Two mirrored bars — pressure you can feel at a glance.
    const f = Math.max(0, Math.min(1, detFrac));
    const signal = Math.round((1 - f) * 100);
    const bpm = 60 + Math.round(f * 84); // 60 calm → ~144 in lockdown
    const beat = (60 / bpm).toFixed(2) + "s";
    const sigTone = f >= 0.62 ? "crit" : f >= 0.32 ? "warn" : "ok";
    const lock = Math.round(f * 100);
    const proximity = alert === "LOCKDOWN" ? "POSITION LOCKED" : alert === "ALERTED" ? "CLOSING IN" : alert === "SUSPICIOUS" ? "NARROWING" : "SWEEPING BLIND";
    return (
        <>
            <aside className={"comms-tower hero fx-" + opState} aria-hidden>
                <div className="tower-head"><span className="cdot" /> OPERATOR · <span className="cyan">{op.toUpperCase()}</span></div>
                <button className="tower-face" onClick={onPoke} title="ping your operator" aria-label="ping your operator">
                    <HeroFace op={op} state={opState} />
                    <span className="tower-tag">{opState === "alarmed" ? "ON EDGE" : opState === "tense" ? "FOCUSED" : "GHOST"}</span>
                </button>
                <div className={"tower-vitals sig-" + sigTone}>
                    <div className="vrow"><span className="vheart" style={{ animationDuration: beat }}>♥</span> <b>{bpm}</b> <span className="vu">BPM</span></div>
                    <div className="vbar"><i style={{ width: signal + "%" }} /></div>
                    <div className="vlabel">SIGNAL INTEGRITY · {signal}%</div>
                </div>
                <div className="tower-feed">
                    {opLines.length ? opLines.map((l) => <div key={l.key} className="tline op">{l.text}</div>) : <div className="tline muted">…secure channel open…</div>}
                </div>
                <div className="tower-hint">▸ tap to ping</div>
            </aside>
            <aside className={"comms-tower villain " + vClass} onClick={onTaunt} title="the watcher" aria-hidden>
                <div className="tower-head"><span className="cdot" /> {vLabel}</div>
                <div className="tower-face"><WatcherFace state={vState} /><span className="tower-tag">{alert}</span></div>
                <div className="tower-vitals lock">
                    <div className="vlabel">TRACE LOCK · {lock}%</div>
                    <div className="vbar"><i style={{ width: lock + "%" }} /></div>
                    <div className="vrow">◎ {proximity}</div>
                </div>
                <div className="tower-feed">
                    {vClass === "dormant"
                        ? <div className="tline muted">standby · no signal on you yet</div>
                        : (watcherLines.length ? watcherLines.map((l) => <div key={l.key} className="tline watcher">{l.text}</div>) : <div className="tline muted">…triangulating your position…</div>)}
                </div>
            </aside>
        </>
    );
}

/* ============================================================
   CORE SCENE — the target rendered as a living core you drill into.
   Pure decoration (aria-hidden): the layer rows beside it stay the
   interactive truth. Rings = layers (outermost first), arcs = defenses
   draining as you cut them, the red trace ring is the watcher closing
   in as detection rises, and the probe line is YOU, drilling inward.
   ============================================================ */
const TYPE_COLOR: Record<string, string> = { firewall: "#ff8a4a", ids: "#46d6e6", auth: "#ffd24a", privilege: "#c08cff", database: "#64e88a" };
function CoreScene({ state, spark, shatterIdx, punching, detFrac }: { state: GameState; spark: number; shatterIdx: number | null; punching: boolean; detFrac: number }) {
    const [bursts, setBursts] = useState<{ id: number; ang: number }[]>([]);
    const burstKey = useRef(0);
    useEffect(() => {
        if (spark === 0) return;
        const id = ++burstKey.current;
        const ang = (spark * 137) % 360; // walk the ring so repeat hits don't stack in one spot
        setBursts((b) => [...b, { id, ang }]);
        const t = window.setTimeout(() => setBursts((b) => b.filter((q) => q.id !== id)), 520);
        return () => window.clearTimeout(t);
    }, [spark]);
    const n = state.layers.length;
    const C = 120;
    const rOuter = 102, rInner = 34;
    const stepR = n > 1 ? (rOuter - rInner) / (n - 1) : 0;
    const rad = (i: number) => rOuter - i * stepR;
    const cur = Math.min(state.current, n - 1);
    const curR = rad(cur);
    // the watcher's ring: starts at the boundary, closes onto the core as detection climbs
    const traceR = 112 - Math.min(1, detFrac) * (112 - rInner + 6);
    return (
        <div className={"corescene" + (punching ? " punching" : "")} aria-hidden>
            <svg viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet">
                <circle className="cs-bound" cx={C} cy={C} r={112} />
                {state.layers.map((l, i) => {
                    const r = rad(i);
                    if (l.breached) return <circle key={i} className={"cs-breached" + (shatterIdx === i ? " cs-shatter" : "")} cx={C} cy={C} r={r} />;
                    const isCur = i === cur;
                    const N = l.defenses.length;
                    const gap = 3.5;
                    const seg = 100 / N - gap;
                    return (
                        <g key={i} className={"cs-layer" + (isCur ? " cs-active" : "") + (shatterIdx === i ? " cs-shatter" : "")} style={{ opacity: isCur ? 1 : 0.5 }}>
                            {l.defenses.map((d, di) => {
                                const off = 25 - di * (100 / N); // segments start at 12 o'clock, walk clockwise
                                const colr = d.typeRevealed ? TYPE_COLOR[d.type] : "#667870";
                                const frac = d.strength > 0 ? d.strength / d.maxStrength : 0;
                                return (
                                    <g key={di}>
                                        <circle className="cs-track" cx={C} cy={C} r={r} pathLength={100} strokeDasharray={`${seg} ${100 - seg}`} strokeDashoffset={off} style={{ stroke: colr }} />
                                        {frac > 0 && <circle className="cs-fill" cx={C} cy={C} r={r} pathLength={100} strokeDasharray={`${seg * frac} ${100 - seg * frac}`} strokeDashoffset={off} style={{ stroke: colr }} />}
                                    </g>
                                );
                            })}
                            {isCur && <circle className="cs-reticle" cx={C} cy={C} r={r + 5.5} />}
                        </g>
                    );
                })}
                <circle className={"cs-trace" + (detFrac >= 0.8 ? " hot" : "")} cx={C} cy={C} r={Math.max(traceR, rInner - 6)} style={{ opacity: 0.14 + Math.min(1, detFrac) * 0.66 }} />
                <line className="cs-probe" x1={C} y1={236} x2={C} y2={C + curR + 4} />
                <polygon className="cs-probehead" points={`${C - 4},${C + curR + 9} ${C + 4},${C + curR + 9} ${C},${C + curR + 2}`} />
                <g className={"cs-core" + (cur >= n - 1 ? " exposed" : "")}>
                    <circle className="cs-corehalo" cx={C} cy={C} r={22} />
                    <polygon points={`${C},${C - 13} ${C + 13},${C} ${C},${C + 13} ${C - 13},${C}`} />
                </g>
                {bursts.map((b) => (
                    <g key={b.id} className="cs-sparks" transform={`rotate(${b.ang} ${C} ${C}) translate(${C} ${C - curR})`}>
                        <line x1={0} y1={0} x2={0} y2={-10} />
                        <line x1={0} y1={0} x2={8} y2={-6} />
                        <line x1={0} y1={0} x2={-8} y2={-6} />
                    </g>
                ))}
            </svg>
            <div className="cs-caption">LIVE TARGET · TRACE {Math.round(detFrac * 100)}%</div>
        </div>
    );
}

/* ============================================================
   BREACH SCREEN (one job)
   ============================================================ */
function Breach({ systemKey, systemTitle, deck, modifier, hunt, implants, threat, hackerId, onComplete }: { systemKey: string; systemTitle: string; deck: string[]; modifier?: SystemModifier | null; hunt?: HuntPressure | null; implants?: string[]; threat?: number; hackerId?: string; onComplete: (r: BreachResult) => void }) {
    const hacker = getHacker(hackerId || "wraith");
    const [state, setState] = useState<GameState>(() => createInitialState(newSeed(), systemKey, deck, modifier, hunt, combineLoadouts(hacker.passive, aggregateImplants(implants || [])), threatEffects(threat || 0)));
    const [armed, setArmed] = useState<string | null>(null);
    const [showIntro, setShowIntro] = useState(() => { try { return localStorage.getItem("breach_seen_intro") !== "1"; } catch { return true; } });
    const closeIntro = () => { setShowIntro(false); try { localStorage.setItem("breach_seen_intro", "1"); } catch { /* ignore */ } };
    // --- juice / game-feel transient state ---
    const [shaking, setShaking] = useState(false);
    const [breachFx, setBreachFx] = useState(false);
    const [cascadeFx, setCascadeFx] = useState(false);
    const [spike, setSpike] = useState(false);
    const [glitch, setGlitch] = useState(0); // 0 none · 1 minor · 2 hard — detection-rise screen glitch
    const [hits, setHits] = useState<Record<string, { amt: number; key: number }>>({});
    const [projectiles, setProjectiles] = useState<{ id: number; cls: string; glyph: string; x: number; y: number; dx: number; dy: number; dur: number; delay: number }[]>([]);
    const [shatterIdx, setShatterIdx] = useState<number | null>(null);
    const [castKind, setCastKind] = useState<string | null>(null); // console recoil flash, coloured by the card just played
    const [punching, setPunching] = useState(false); // forward camera-lunge when you cross into the next layer
    const [shockwaves, setShockwaves] = useState<{ id: number; cls: string }[]>([]); // expanding rings on the big beats
    const [shards, setShards] = useState<{ id: number; x: number; y: number; dx: number; dy: number; rot: number }[]>([]); // debris when a wall shatters
    const [grabCine, setGrabCine] = useState<null | "secured" | "caught" | "lockout">(null); // the finale cinematic
    const [coreSpark, setCoreSpark] = useState(0); // bumps when a hit lands, so the core scene sparks
    const [lunge, setLunge] = useState(false); // hard camera push toward the core on the grab
    const [resultReady, setResultReady] = useState(false); // hold the win/lose box until the cinematic has played
    const [feed, setFeed] = useState<{ who: "op" | "watcher"; text: string; key: number }[]>([]); // the live comms transcript
    const fxKey = useRef(0);
    const feedKey = useRef(0);
    const castVoiced = useRef(false); // a cast sound already spoke for this play
    const wasAlarmed = useRef(false);
    const wasSusp = useRef(false);
    const opened = useRef(false);
    const push = (who: "op" | "watcher", text: string) => setFeed((f) => [...f, { who, text, key: ++feedKey.current }].slice(-5));
    const say = (kind: string) => push("op", pickQuip(kind));
    const watcherSays = () => push("watcher", pickFrom(WATCHER_LINES));

    // Cast FX: EVERY card sends something into the system so a play always lands,
    // not just attacks. An exploit fires a hard packet up from your console; a
    // bug/worm crawls in from the edge and burrows; recon pings a scan pulse up;
    // stealth breathes a soft ghost-ripple; utility sends a tool spark. The motion
    // and colour read the card's kind. Skipped under reduced-motion.
    const spawnCastFx = (card: string, target?: number) => {
        const c = CARDS[card];
        if (!c || typeof window === "undefined") return;
        const eff = c.effect || "";
        const isWorm = /bomb|parasite|contagion|trojan|necro|incubate|worm|detonate|blight|viral/i.test(eff);
        // the cast VOICE: every kind answers the click in character (plays even
        // under reduced-motion — it replaces, not decorates, the visual tracer)
        const CAST_SFX: Record<string, "castExploit" | "castRecon" | "castStealth" | "castUtility"> = { exploit: "castExploit", recon: "castRecon", stealth: "castStealth", utility: "castUtility" };
        sfx.play(isWorm ? "castWorm" : CAST_SFX[c.kind] || "castUtility");
        castVoiced.current = true; // the generic card blip stands down for this commit
        // the console recoils on EVERY play — a themed muzzle flash at the launch rail
        setCastKind(c.kind); window.setTimeout(() => setCastKind((k) => (k === c.kind ? null : k)), 320);
        try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch { /* no matchMedia */ }
        // where it lands: the aimed defense, else the current layer
        let tRect: DOMRect | null = null;
        if (target != null) { const el = document.querySelector(`[data-chip="${state.current}-${target}"]`); if (el) tRect = el.getBoundingClientRect(); }
        if (!tRect) { const el = document.querySelector(`[data-layer="${state.current}"]`); if (el) tRect = el.getBoundingClientRect(); }
        if (!tRect) return;
        const tx = tRect.left + tRect.width / 2, ty = tRect.top + tRect.height / 2;
        // per-kind motion + glyph; worms always crawl in from the left edge
        const FX: Record<string, { glyph: string; cls: string; dur: number }> = {
            exploit: { glyph: "⟫", cls: "fx-exploit", dur: 300 },
            recon: { glyph: "⊚", cls: "fx-recon", dur: 340 },
            stealth: { glyph: "◌", cls: "fx-stealth", dur: 380 },
            utility: { glyph: "◈", cls: "fx-utility", dur: 320 },
        };
        const kind = isWorm ? "worm" : (FX[c.kind] ? c.kind : "utility");
        const spec = isWorm ? { glyph: "☣", cls: "fx-worm", dur: 520 } : FX[kind];
        const sx = isWorm ? -28 : window.innerWidth / 2;
        const sy = isWorm ? ty : window.innerHeight - 52;
        const id = ++fxKey.current, bid = id + 500000;
        setProjectiles((p) => [...p,
            { id, cls: spec.cls, glyph: spec.glyph, x: sx, y: sy, dx: tx - sx, dy: ty - sy, dur: spec.dur, delay: 0 },
            { id: bid, cls: spec.cls + "-burst fx-burst", glyph: "", x: tx, y: ty, dx: 0, dy: 0, dur: 280, delay: spec.dur - 40 },
        ]);
        window.setTimeout(() => setProjectiles((p) => p.filter((q) => q.id !== id && q.id !== bid)), spec.dur + 320);
    };
    const dispatch = (card: string, target?: number) => { spawnCastFx(card, target); setState((s) => applyAction(s, { type: "playCard", card, target })); setArmed(null); };
    const reducedMotion = () => { try { return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
    // an expanding shock ring on the big beats (breach / cascade / grab)
    const spawnShockwave = (cls: string) => {
        if (reducedMotion()) return;
        const id = ++fxKey.current;
        setShockwaves((w) => [...w, { id, cls }]);
        window.setTimeout(() => setShockwaves((w) => w.filter((q) => q.id !== id)), 760);
    };
    // debris flung from a wall as it shatters, sourced from that layer's on-screen box
    const spawnShards = (layerIdx: number, n = 12) => {
        if (reducedMotion() || typeof window === "undefined") return;
        const el = document.querySelector(`[data-layer="${layerIdx}"]`);
        const r = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2 - 200, top: window.innerHeight / 2, width: 400, height: 40 } as DOMRect;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const batch = Array.from({ length: n }, () => {
            const ang = (fxKey.current * 47 + Math.floor(Math.random() * 360)) * (Math.PI / 180);
            const dist = 120 + Math.random() * 220;
            return { id: ++fxKey.current, x: cx + (Math.random() - 0.5) * r.width, y: cy, dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist - 40, rot: (Math.random() - 0.5) * 540 };
        });
        setShards((s) => [...s, ...batch]);
        const ids = new Set(batch.map((b) => b.id));
        window.setTimeout(() => setShards((s) => s.filter((q) => !ids.has(q.id))), 720);
    };
    const endTurn = () => {
        // telegraph the system's counter-move: sound the alarm right before it strikes
        const it = state.systemIntent;
        if (it && it.kind !== "idle" && state.spoofTurns === 0) sfx.play("alarm");
        setState((s) => applyAction(s, { type: "endTurn" })); setArmed(null);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (state.outcome !== "playing" || showIntro) return;
            if (e.key === "Enter" || e.key === " " || e.key === "e" || e.key === "E") { e.preventDefault(); endTurn(); return; }
            if (e.key === "Escape") { setArmed(null); return; }
            // number keys: pick a target when armed, else play the Nth hand card
            if (e.key >= "1" && e.key <= "9") {
                const n = parseInt(e.key, 10) - 1;
                const opts = targetableDefenses(state);
                if (armed) {
                    if (n < opts.length) dispatch(armed, opts[n]);
                    return;
                }
                const id = state.hand[n];
                if (!id || !canPlay(state, id)) return;
                if (!needsTarget(id)) dispatch(id);
                else if (opts.length === 1) dispatch(id, opts[0]); // only one target — just play it
                else if (opts.length > 1) { sfx.play("select"); setArmed(id); }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [state, showIntro, armed]);

    // the operator's opening line, once the job is actually in front of you
    useEffect(() => {
        if (showIntro || opened.current) return;
        opened.current = true;
        const t = window.setTimeout(() => { if (state.outcome === "playing") say("start"); }, 550);
        return () => window.clearTimeout(t);
    }, [showIntro]); // eslint-disable-line react-hooks/exhaustive-deps

    // sound: derive SFX from state transitions (fires once per commit)
    const prevRef = useRef(state);
    useEffect(() => {
        const prev = prevRef.current;
        if (state !== prev) {
            const total = (s: GameState) => s.layers.reduce((a, l) => a + l.defenses.reduce((b, d) => b + Math.max(0, d.strength), 0), 0);
            const brk = (s: GameState) => s.layers.filter((l) => l.breached).length;
            const rank: Record<string, number> = { IDLE: 0, SUSPICIOUS: 1, ALERTED: 2, LOCKDOWN: 3 };
            const voiced = castVoiced.current; castVoiced.current = false; // consume the cast-voice flag every commit
            if (state.outcome === "won" && prev.outcome === "playing") sfx.play("stingWin"); // scores the held PAYLOAD SECURED card
            else if (state.outcome === "lost" && prev.outcome === "playing") sfx.play(state.objectiveExposed ? "stingCaught" : "stingLockout");
            else if (brk(state) > brk(prev)) sfx.play("breach");
            else if (state.turn > prev.turn) sfx.play("turn");
            else if (state.log.length > prev.log.length && !voiced) sfx.play(total(state) < total(prev) ? "hit" : "card");
            if (state.outcome === "playing" && rank[state.alert] > rank[prev.alert]) sfx.play("alert");

            // --- the operator talks: one line per commit, by priority ---
            const df = state.detection / Math.max(1, state.detectionMax);
            let q: string | null = null;
            if (state.outcome === "won" && prev.outcome === "playing") q = "won";
            else if (state.outcome === "lost" && prev.outcome === "playing") q = "lost";
            else if (state.cascade && !prev.cascade) q = "cascade";
            else if (df >= 0.62 && !wasAlarmed.current) q = "hot";
            else if (rank[state.alert] > rank[prev.alert] && state.alert === "SUSPICIOUS" && !wasSusp.current) q = "suspicious";
            else if (brk(state) > brk(prev)) q = "layer";
            else if (state.turn > prev.turn && state.turnNoise === 0 && prev.cardsThisTurn >= 2 && df < 0.4 && Math.random() < 0.5) q = "quiet";
            if (state.alert === "SUSPICIOUS") wasSusp.current = true; else if (state.alert === "IDLE") wasSusp.current = false;
            wasAlarmed.current = df >= 0.55; // reset the "hot" latch once you cool back down
            if (q) say(q);
            // the watcher breaks into your channel when the trace locks on (ALERTED+ rising)
            if (rank[state.alert] > rank[prev.alert] && rank[state.alert] >= 2) watcherSays();
            // ...and taunts specifically when a TRACE SWEEP catches you lurking
            else if (state.log.length > prev.log.length && state.log.slice(prev.log.length).some((l) => l.includes("isolated your position"))) {
                push("watcher", pickFrom(SWEEP_LINES));
            }

            // --- juice triggers ---
            const dDet = state.detection - prev.detection;
            if (dDet >= 6) { setSpike(true); window.setTimeout(() => setSpike(false), 380); }
            // detection rose → the screen glitches, harder the louder the jump
            if (dDet >= 3) { const lvl = dDet >= 9 ? 2 : 1; setGlitch(lvl); window.setTimeout(() => setGlitch(0), lvl === 2 ? 480 : 300); }
            // SYSTEM CASCADE fired — celebrate the power spike (banner + surge + shake + bed pulse)
            if (state.cascade && !prev.cascade) {
                sfx.play("cascade"); sfx.setTension(1);
                setCascadeFx(true); setShaking(true); spawnShockwave("sw-cascade");
                window.setTimeout(() => setCascadeFx(false), 950);
                window.setTimeout(() => setShaking(false), 340);
            }
            // a mid-run layer breach (NOT the objective grab, handled as the finale below)
            if (brk(state) > brk(prev) && state.outcome === "playing") {
                setShaking(true); setBreachFx(true); spawnShockwave("sw-breach");
                window.setTimeout(() => setShaking(false), 340);
                window.setTimeout(() => setBreachFx(false), 560);
                // the wall comes down: crack-sweep the layer that just breached + fling debris
                const li = state.layers.findIndex((l, k) => l.breached && !prev.layers[k]?.breached);
                if (li >= 0) { setShatterIdx(li); spawnShards(li, 12); window.setTimeout(() => setShatterIdx((cur) => (cur === li ? null : cur)), 720); }
                // crossing INWARD to a new layer: lunge the camera forward through the wall
                if (state.current > prev.current) { setPunching(true); window.setTimeout(() => setPunching(false), 640); }
            }
            // THE FINALE — the objective cracks (win = clean grab; lost + objective = caught in
            // the act; lost without it = traced out). A held cinematic before the result box.
            if (state.outcome !== "playing" && prev.outcome === "playing") {
                const won = state.outcome === "won";
                const grabbed = state.objectiveExposed; // the objective layer was actually cracked
                if (!reducedMotion()) {
                    setGrabCine(won ? "secured" : grabbed ? "caught" : "lockout");
                    setLunge(true); // hard camera push toward the core (own transform, not the shake)
                    spawnShockwave(won ? "sw-grab" : "sw-lockout");
                    if (grabbed) spawnShards(state.layers.length - 1, 20);
                    window.setTimeout(() => setLunge(false), 720);
                    window.setTimeout(() => setGrabCine(null), 2800);
                }
                const hold = reducedMotion() ? 0 : 2500; // hold the result box until the cinematic has REALLY landed
                window.setTimeout(() => setResultReady(true), hold);
            }
            // per-defense damage → floating numbers (keyed by defense, replays on new hit)
            const newHits: Record<string, { amt: number; key: number }> = {};
            for (let li = 0; li < state.layers.length; li++) {
                const pl = prev.layers[li], cl = state.layers[li];
                if (!pl || !cl) continue;
                for (let di = 0; di < cl.defenses.length; di++) {
                    const b = pl.defenses[di]?.strength ?? 0, a = cl.defenses[di]?.strength ?? 0;
                    if (b - a > 0) newHits[`${li}-${di}`] = { amt: b - a, key: ++fxKey.current };
                }
            }
            if (Object.keys(newHits).length) {
                setHits((h) => ({ ...h, ...newHits }));
                // a hit landed on the wall you were facing → the core scene sparks
                if (Object.keys(newHits).some((k) => k.startsWith(prev.current + "-"))) setCoreSpark((c) => c + 1);
            }

            prevRef.current = state;
        }
    }, [state]);

    const detFrac = state.detection / state.detectionMax;
    const sweep = sweepForecast(state); // telegraphed TRACE SWEEP: when, and how hard if you stay quiet
    const sweepImminent = sweep.in <= 1 && sweep.hit > 0;
    // ambient bed: a breach is where the dread peaks — drone tightens with detection,
    // maxing out as you near lockout. Fades back to the map's level on the way out.
    useEffect(() => {
        if (state.outcome === "playing") sfx.setTension(0.2 + 0.8 * Math.min(1, detFrac));
    }, [detFrac, state.outcome]);
    // the living backdrop tracks the trace while a breach is live, then falls calm
    useEffect(() => { RAIN_MOOD.t = Math.min(1, detFrac); return () => { RAIN_MOOD.t = 0; }; }, [detFrac]);
    const room = state.detectionMax - state.detection;
    // the corner avatar reads the danger: you stay a ghost, then get rattled, then made
    const avatarState: "calm" | "tense" | "alarmed" = detFrac >= 0.62 ? "alarmed" : detFrac >= 0.32 ? "tense" : "calm";
    const targetOpts = targetableDefenses(state);
    const STAGES = [{ name: "SUSPICIOUS", at: 0.25 }, { name: "ALERTED", at: 0.5 }, { name: "LOCKDOWN", at: 0.8 }];
    const nextStage = STAGES.find((st) => st.at * state.detectionMax > state.detection) || null;
    const roomToNext = nextStage ? Math.ceil(nextStage.at * state.detectionMax - state.detection) : null;

    const onCardClick = (id: string) => {
        if (!canPlay(state, id)) return;
        if (!needsTarget(id)) { dispatch(id); return; }
        if (targetableDefenses(state).length === 0) return;
        sfx.play("select");
        setArmed(armed === id ? null : id);
    };

    return (
        <>
            {/* fixed-position towers live OUTSIDE .wrap so the breach shake/glitch
                (a transform on .wrap) can't reparent them and fling them to center */}
            <CommsTowers op={hackerId || "wraith"} opState={avatarState} alert={state.alert} detFrac={detFrac} feed={feed} onPoke={() => say("poke")} onTaunt={watcherSays} />
        <div className={"wrap breachview" + (shaking ? " shaking" : "") + (lunge ? " lunge" : "") + (glitch ? (glitch === 2 ? " glitching hard" : " glitching") : "")}>
            {breachFx && <div className="breach-flash"><div className="bd">LAYER DOWN</div></div>}
            {cascadeFx && <div className="cascade-flash"><div className="cd">⚡ SYSTEM CASCADE</div></div>}
            {projectiles.length > 0 && (
                <div className="fxfield" aria-hidden>
                    {projectiles.map((p) => (
                        <span key={p.id} className={"fxproj " + p.cls} style={{ left: p.x, top: p.y, ["--dx" as string]: p.dx + "px", ["--dy" as string]: p.dy + "px", ["--dur" as string]: p.dur + "ms", animationDelay: p.delay + "ms" }}>{p.glyph}</span>
                    ))}
                </div>
            )}
            {glitch > 0 && <div className={"det-glitch" + (glitch === 2 ? " hard" : "")} />}
            {castKind && <div className={"cast-recoil k-" + castKind} aria-hidden />}
            {shockwaves.length > 0 && <div className="fxfield" aria-hidden>{shockwaves.map((w) => <span key={w.id} className={"shockwave " + w.cls} />)}</div>}
            {shards.length > 0 && (
                <div className="fxfield" aria-hidden>
                    {shards.map((s) => <span key={s.id} className="shard" style={{ left: s.x, top: s.y, ["--dx" as string]: s.dx + "px", ["--dy" as string]: s.dy + "px", ["--rot" as string]: s.rot + "deg" }} />)}
                </div>
            )}
            {grabCine && (
                <div className={"cinematic cine-" + grabCine} aria-hidden>
                    <div className="cine-strobe" />
                    <div className="cine-rays" />
                    <div className="cine-title">
                        {grabCine === "secured" ? <><span className="cine-mark">◈</span> PAYLOAD SECURED <span className="cine-mark">◈</span></>
                            : grabCine === "caught" ? <><span className="cine-mark">⚠</span> CAUGHT IN THE ACT <span className="cine-mark">⚠</span></>
                            : <><span className="cine-mark">⌁</span> TRACE COMPLETE <span className="cine-mark">⌁</span></>}
                    </div>
                    <div className="cine-sub">{grabCine === "secured" ? "you're a ghost — out clean" : grabCine === "caught" ? "they had you the second you took it" : "the system locked on — you bailed"}</div>
                </div>
            )}
            <div className="title">
                BREACH <span className="sub">// {systemTitle}</span>
                <button className="term ghost tiny" style={{ marginLeft: 14 }} onClick={() => onComplete({ won: false, detection: state.detectionMax, detectionMax: state.detectionMax })}>abort job</button>
            </div>
            <div className="muted">turn {state.turn} · target: {state.system}
                {state.behavior && BEHAVIOR_META[state.behavior]
                    ? <span className={"sysbehavior beh-" + state.behavior} title={BEHAVIOR_META[state.behavior].tip}> · <span className="beh-ico" aria-hidden>{BEHAVIOR_META[state.behavior].icon}</span> <b>{BEHAVIOR_META[state.behavior].label}</b> <span className="beh-tip">({BEHAVIOR_META[state.behavior].tip})</span></span>
                    : " · clear the objective before you're detected"}
            </div>
            {state.modifierLabel && (
                <div className={"modbar " + state.modifierTone}>
                    <span className="modtag">{state.modifierTone === "easier" ? "▽" : state.modifierTone === "harder" ? "⚠" : "◈"} {state.modifierLabel}</span>
                    <span className="modblurb">{state.modifierBlurb}</span>
                </div>
            )}
            {state.huntLabel && (
                <div className="modbar hunt">
                    <span className="modtag">⌁ {state.huntLabel}</span>
                    <span className="modblurb">{state.huntBlurb}</span>
                </div>
            )}
            <div className="implant-strip muted">{hacker.glyph} <b>{hacker.name}</b> · <span className="cyan">{hacker.passiveName}</span>{implants && implants.length > 0 ? " · ◆ " + implants.map((id) => IMPLANTS[id] && IMPLANTS[id].name).filter(Boolean).join(" · ") : ""}</div>
            <CommsPanel op={hackerId || "wraith"} opState={avatarState} feed={feed} onPoke={() => say("poke")} />
            <hr />

            <div className="meter-label">
                <span className="amber">DETECTION</span>
                <span style={{ color: meterColor(detFrac) }}>{state.detection} / {state.detectionMax}</span>
            </div>
            <div className={"meter" + (detFrac >= 0.8 ? " hot" : "") + (spike ? " spike" : "")}>
                <div className="fill" style={{ width: `${detFrac * 100}%`, background: meterColor(detFrac) }} />
                <div className="ticks" />
                <div className="mark" style={{ left: "25%" }} /><div className="mark" style={{ left: "50%" }} /><div className="mark" style={{ left: "80%" }} />
            </div>
            <div className="meter-marks">
                <span style={{ left: "25%", color: "#ffb000" }}>SUSPICIOUS</span>
                <span style={{ left: "50%", color: "#ff7a1a" }}>ALERTED</span>
                <span style={{ left: "80%", color: "#ff4141" }}>LOCKDOWN</span>
            </div>

            <div className={"sys kind-" + (state.systemIntent ? state.systemIntent.kind : "idle")}>
                <span className="sys-alert">SYSTEM ALERT: <span className={"stage " + state.alert}>{state.alert}</span></span>
                <span className="intent">
                    <span className="intent-label">⚠ SYSTEM WILL:</span>{" "}
                    {state.spoofTurns > 0 ? <span className="intent-text cyan">— suppressed (spoofed) —</span> : <span className="intent-text">{state.systemIntent ? state.systemIntent.label : "—"}</span>}
                </span>
                <span className={"sweep-tell" + (sweepImminent ? " imminent" : "") + (sweep.hit === 0 ? " safe" : "")} title="The intrusion scan runs every few turns. Stay too quiet and it isolates you — make noise to blend in.">
                    <span className="sweep-ico" aria-hidden>⊚</span> TRACE SWEEP{" "}
                    {sweep.in <= 1 ? <b>this turn</b> : <>in <b>{sweep.in}</b></>}
                    {" · "}
                    {sweep.hit > 0
                        ? <span className="sweep-hit">+{sweep.hit} if you stay quiet</span>
                        : <span className="sweep-clear">masked by your noise</span>}
                </span>
            </div>

            <div className="schematic-head">▼ INTRUSION PATH · <b>depth {Math.min(state.current + 1, state.layers.length)}/{state.layers.length}</b> — punch inward to the core</div>
            <div className="pathwrap">
            <CoreScene state={state} spark={coreSpark} shatterIdx={shatterIdx} punching={punching} detFrac={detFrac} />
            <div className={"layers schematic depthstack" + (punching ? " punching" : "")}>
                {punching && <div className="punch-banner" aria-hidden>▸▸ PUNCHING INWARD · DEPTH {Math.min(state.current + 1, state.layers.length)}/{state.layers.length}</div>}
                {state.layers.map((l, i) => {
                    const isCurrent = i === state.current && !l.breached;
                    const isObjective = i === state.layers.length - 1;
                    const nodeGlyph = l.breached ? "✓" : isCurrent ? "◉" : isObjective ? "◎" : "○";
                    // depth cue: layers still AHEAD recede toward the core (the objective is deepest)
                    const rel = i - state.current;
                    const ahead = !l.breached && rel > 0 ? rel : 0;
                    const barType = (l.defenses.find((d) => d.strength > 0) || l.defenses[0])?.type || "firewall";
                    return (
                        <div key={i} data-layer={i} className={"layer bar-" + barType + (isCurrent ? " current" : "") + (l.breached ? " breached" : "") + (isObjective ? " objective" : "") + (shatterIdx === i ? " shatter" : "")}
                            style={{ ["--danger" as string]: dangerColor(i, state.layers.length), ...(ahead > 0 ? { transform: `translateZ(${-ahead * 42}px)`, opacity: Math.max(0.32, 0.72 - ahead * 0.13), zIndex: 10 - ahead } : {}) }}>
                            {isCurrent && !l.breached && <span className={"barrier-tex tex-" + barType} aria-hidden />}
                            {isCurrent && !l.breached && <span className="barrier-activate" aria-hidden />}
                            {isCurrent && !l.breached && <span className="barrier-frame" aria-hidden><i /><i /><i /><i /></span>}
                            <span className="lnode" aria-hidden>{nodeGlyph}</span>
                            <span className="lgate">{isCurrent && !l.breached && <span className="lstatus" aria-hidden />}<span className="lemblem" aria-hidden>{l.breached ? "✓" : typeEmblem(barType)}</span><span className="lname">{l.name}</span>{!l.breached && <span className="ltype" aria-hidden>· {barType.toUpperCase()}</span>}</span>
                            <span className="defs">
                                {l.breached ? <span className="muted">BREACHED</span> : l.defenses.map((d, di) => (
                                    <DefenseChip key={di} d={d} chipId={`${i}-${di}`} worm={wormOn(state, i, di)} targetable={isCurrent && !!armed && d.strength > 0} preview={isCurrent && armed && d.strength > 0 ? previewOnTarget(state, armed, di) : null} kbdNum={isCurrent && armed ? targetOpts.indexOf(di) + 1 : undefined} hit={hits[`${i}-${di}`]} onClick={() => dispatch(armed!, di)} />
                                ))}
                            </span>
                            {isCurrent && l.defenses.some((d) => !d.typeRevealed && d.strength > 0) && (
                                <span className="scan-hint">🔍 unscanned — play a <b>recon</b> card to reveal <b>Strength</b> &amp; lock in matched exploits</span>
                            )}
                            {isObjective && !l.breached && (() => {
                                const g = grabForecast(state);
                                const cls = g.caught ? " caught" : g.critical ? " danger" : g.frac >= 0.7 ? " warn" : "";
                                return isCurrent ? (
                                    <span className={"grab-tell" + cls} title="Grabbing the objective trips every alarm — a hard detection spike. Don't grab while in LOCKDOWN or it catches you.">
                                        <span className="grab-ico" aria-hidden>⚠</span> THE GRAB TRIPS THE ALARM: +{g.spike} → <b>{g.after}/{state.detectionMax}</b>
                                        {g.caught ? <b className="grab-verdict"> · CAUGHT — cool down first!</b> : g.critical ? <b className="grab-verdict"> · you're in LOCKDOWN — grabbing catches you</b> : g.frac >= 0.7 ? <span className="grab-verdict"> · cutting it close</span> : <span className="grab-verdict"> · clean exfil</span>}
                                    </span>
                                ) : (
                                    <span className="grab-tell muted-tell"><span className="grab-ico" aria-hidden>⚠</span> the grab here trips the alarm (+{g.spike} detection) — arrive with headroom</span>
                                );
                            })()}
                        </div>
                    );
                })}
            </div>
            </div>

            <div className="last-action">▸ {state.log[state.log.length - 1]}</div>

            <div className="budget">
                <span className="budget-turn">◈ NOISE THIS TURN: <b>{state.turnNoise}</b>{state.cardsThisTurn > 0 ? <span className="muted"> · {state.cardsThisTurn} played{state.silentThisTurn > 0 ? `, ${state.silentThisTurn} silent` : ""}</span> : null}{state.bombs.length > 0 ? <span className="muted"> · 💣 {state.bombs.length}</span> : null}{state.exploitBonus > 0 ? <span className="cyan"> · next exploit +{state.exploitBonus}</span> : null}</span>
                <span className="budget-room">
                    ROOM LEFT:{" "}
                    {roomToNext != null && nextStage ? (<><b className="amber">{roomToNext}</b> before <span className="amber">{nextStage.name}</span> &nbsp;·&nbsp; </>) : null}
                    <b className="red">{room}</b> before <span className="red">LOCKOUT</span>
                </span>
            </div>

            {armed ? (
                <div className="amber armed-hint">▶ SELECT A TARGET DEFENSE — click it or press its number · the ▸ tag shows what the card will do (Esc to cancel)</div>
            ) : (
                <div className="muted hand-legend">YOUR HAND — click or press <b className="kbd-inline">1</b>–<b className="kbd-inline">9</b> to play · <b className="kbd-inline">Enter</b> ends turn. &nbsp; <span className="amber">◈N</span> = noise · <span className="cyan">SILENT</span> = no noise · <span className="muted">◎</span> = needs a target</div>
            )}

            <div className="hand">
                {state.hand.map((id, i) => {
                    const def = CARDS[id];
                    const playable = canPlay(state, id);
                    const noise = projectedNoise(state, id);
                    const danger = noise >= room && noise > 0;
                    const needsT = needsTarget(id);
                    const blocked = needsT && targetOpts.length === 0;
                    return (
                        <div key={i} className={"card kind-" + def.kind + (playable && !blocked ? "" : " disabled") + (danger ? " danger" : "") + (armed === id ? " armed" : "")} onClick={() => !blocked && onCardClick(id)}>
                            <div className="cart-bg" aria-hidden><span className="cart-wm">{cardSigil(id, def.kind)}</span></div>
                            <div className="cart" aria-hidden><span className="cart-sigil">{cardSigil(id, def.kind)}</span></div>
                            <div className="chead">
                                <span className="cname">{i < 9 && !armed ? <span className="kbd">{i + 1}</span> : null}<span className="cicon" aria-hidden>{KIND_ICON[def.kind] || "◈"}</span>{def.name}{needsT ? <span className="muted"> ◎</span> : null}</span>
                                <span className="noise" style={{ color: danger ? "#ff4141" : noise === 0 ? "#35e0d8" : "#ffb000" }}>{noise === 0 ? "SILENT" : "◈" + noise}</span>
                            </div>
                            <div className="kind">{def.kind}{def.matchType ? <span className="typetag"> ▸ vs {def.matchType.toUpperCase()}</span> : null}{def.tag ? <span className={"synergy s-" + def.tag}> · {def.tag}</span> : null}</div>
                            <div className="ctext">{def.text}</div>
                            <div className="card-full" aria-hidden>
                                <div className="cf-name"><span className="cicon" aria-hidden>{KIND_ICON[def.kind] || "◈"}</span>{def.name} <span className="cf-noise" style={{ color: noise === 0 ? "#35e0d8" : "#ffb000" }}>· {noise === 0 ? "SILENT" : "◈" + noise + " noise"}</span></div>
                                <div className="cf-kind">{def.kind}{def.matchType ? ` ▸ vs ${def.matchType.toUpperCase()}` : ""}{def.tag ? ` · ${def.tag}` : ""}</div>
                                <div className="cf-text">{def.text}</div>
                            </div>
                        </div>
                    );
                })}
                {state.hand.length === 0 && <span className="muted">— empty hand — end the turn —</span>}
            </div>

            <div className="controls">
                <button className="term" onClick={endTurn}>End Turn ▸</button>
                <button className="term ghost" onClick={() => setShowIntro(true)}>?</button>
                <CrtButton /><MuteButton />
                <span className="piles muted">🂠 draw {state.deck.length} · discard {state.discard.length}</span>
            </div>
            <div className="muted turn-note">Ending a turn <b>discards your hand and draws {state.handSize} fresh</b> (cards recycle), then the system acts and the trace climbs +{state.baselineCreep}.</div>

            <div className="log">{state.log.slice(-3).map((line, i) => <span className="ln" key={i}>{line}</span>)}</div>

            {showIntro && <Intro onClose={closeIntro} />}

            {state.outcome !== "playing" && resultReady && (
                <div className={"overlay " + state.outcome}>
                    <div className="box">
                        <h2>{state.outcome === "won" ? "ACCESS :: OBJECTIVE SECURED" : "TRACE COMPLETE :: LOCKED OUT"}</h2>
                        <p className="muted">{state.outcome === "won" ? "You slipped in, grabbed the data, and vanished." : "The system made you — you had to bail before it locked on."}</p>
                        <p className="muted" style={{ fontSize: 12 }}>{state.layers.filter((l) => l.breached).length}/{state.layers.length} layers breached · {state.turn} turns · detection {state.detection}/{state.detectionMax}</p>
                        <button className="term" style={{ marginTop: 14 }} onClick={() => onComplete({ won: state.outcome === "won", detection: state.detection, detectionMax: state.detectionMax })}>Continue ▸</button>
                    </div>
                </div>
            )}
        </div>
        </>
    );
}

/* ============================================================
   CAMPAIGN SELECT
   ============================================================ */
/* ============================================================
   OPERATOR SELECT — choose your hacker
   ============================================================ */
function HackerSelect({ onPick }: { onPick: (id: string) => void }) {
    return (
        <div className="wrap">
            <div className="title">BREACH{IS_DEMO && <span className="demo-badge">DEMO</span>} <span style={{ float: "right" }}><CrtButton /><MuteButton /></span></div>
            <div className="hero-banner">
                <HeroFace state="calm" className="banner-face" />
                <div className="hb-text">
                    <div className="hb-slogan">Silence is a signature.</div>
                    <p className="muted">Choose your operator. Each runs a different starting deck and a signature passive — a completely different way to break in.</p>
                    <div className="hb-tag cyan">SLIP IN · STAY A GHOST · TAKE THE DATA · GET GONE</div>
                </div>
            </div>
            <hr />
            <div className="hackers">
                {HACKER_ORDER.map((id) => {
                    const h = HACKERS[id];
                    const locked = !demoOperatorUnlocked(id);
                    return (
                        <div className={"hackercard" + (locked ? " locked" : "")} key={id} onClick={() => !locked && onPick(id)}>
                            <div className="hhead"><span className="hglyph">{h.glyph}</span><span className="hname">{h.name}</span></div>
                            <div className="hstyle cyan">{h.style}</div>
                            <div className="hbio">{h.bio}</div>
                            <div className="hpassive"><span className="amber">◆ {h.passiveName}</span> — {h.passiveBlurb}</div>
                            <div className="hquote muted">“{h.quote}”</div>
                            {locked ? <div className="lockbox">🔒 In the full game</div> : <button className="term">Jack in ▸</button>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function CampaignSelect({ onPick, onBack, hacker, onShowAchievements, onShowFeedback }: { onPick: (id: string, threat: number) => void; onBack: () => void; hacker: string; onShowAchievements: () => void; onShowFeedback: () => void }) {
    const h = getHacker(hacker);
    const profile = loadProfile();
    const achCount = unlockedAchievements(profile).length;
    const [threats, setThreats] = useState<Record<string, number>>(() =>
        Object.fromEntries(CAMPAIGN_ORDER.map((id) => [id, availableThreat(id, profile)])));
    const setThreat = (id: string, t: number) => setThreats((s) => ({ ...s, [id]: t }));

    return (
        <div className="wrap">
            <div className="title">BREACH{IS_DEMO && <span className="demo-badge">DEMO</span>} <span style={{ float: "right" }}><span className="deck-link" onClick={onShowFeedback} style={{ marginRight: 12 }}>💬 Feedback</span><span className="deck-link" onClick={onShowAchievements} style={{ marginRight: 12 }}>🏆 Achievements {achCount}/{TOTAL_ACHIEVEMENTS}</span><CrtButton /><MuteButton /></span></div>
            <p className="muted">Operator: <b className="cyan">{h.glyph} {h.name}</b> · {h.passiveName} <span className="deck-link" onClick={onBack} style={{ marginLeft: 6 }}>◂ change</span>{profile.totalWins > 0 ? ` · ${profile.totalWins} contract${profile.totalWins === 1 ? "" : "s"} completed` : ""}</p>
            <hr />
            <div className="systems">
                {CAMPAIGN_ORDER.map((id) => {
                    const c = CAMPAIGNS[id];
                    const depth = Math.max(...c.map.map((n) => n.col)) + 1;
                    const length = depth <= 3 ? "SHORT" : depth >= 6 ? "LONG" : "MEDIUM";
                    const demoLocked = !demoCampaignUnlocked(id);
                    // in the demo the one featured campaign is always open (ignore the
                    // full-game win-gate); everything else is a locked full-game tease.
                    const unlocked = IS_DEMO ? !demoLocked : isCampaignUnlocked(id, profile);
                    // the demo runs at Threat 0 only — the ascension ladder is a full-game hook
                    const avail = IS_DEMO ? 0 : availableThreat(id, profile);
                    const cleared = maxThreatCleared(id, profile);
                    const t = Math.min(threats[id] ?? 0, avail);
                    return (
                        <div className={"syscard" + (unlocked ? "" : " locked")} key={id}>
                            <div className="sysname">{c.name} <span className={"lentag " + length.toLowerCase()}>{length}</span></div>
                            <div className="cyan" style={{ fontSize: 12, margin: "2px 0 6px" }}>{c.tagline}</div>
                            <div className="sysflavor">{c.premise}</div>
                            <div className="sysmeta muted">Handler: {c.handler} · {depth}-stop map{c.antagonist ? " · ⌁ watched" : ""}</div>
                            {unlocked ? (
                                <>
                                    {avail > 0 && (
                                        <div className="threatpick">
                                            <button className="tstep" disabled={t <= 0} onClick={() => setThreat(id, Math.max(0, t - 1))}>◀</button>
                                            <span className="tlabel">{threatLabel(t)}{cleared >= t && t > 0 ? " ✓" : ""}</span>
                                            <button className="tstep" disabled={t >= avail} onClick={() => setThreat(id, Math.min(avail, t + 1))}>▶</button>
                                        </div>
                                    )}
                                    {t > 0 && <div className="threatdesc">＋ {THREAT_STEPS[t]}</div>}
                                    <button className="term" onClick={() => onPick(id, t)}>Begin ▸</button>
                                </>
                            ) : (
                                <div className="lockbox">🔒 {demoLocked ? "In the full game" : `Complete ${campaignRequirement(id)} contract${campaignRequirement(id) === 1 ? "" : "s"} to unlock`}</div>
                            )}
                        </div>
                    );
                })}
            </div>
            {IS_DEMO ? (
                <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>This is the <b className="amber">free demo</b>. The full game adds 3 more campaigns, 2 more operators, collectible implants, and a 10-level <b className="amber">Threat Level</b> ascension ladder.</p>
            ) : (
                <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>Complete a storyline to raise its <b className="amber">Threat Level</b> — each one stacks a new twist, all the way to Threat {MAX_THREAT}. Progress is saved.</p>
            )}
        </div>
    );
}

function AchievementsModal({ onClose }: { onClose: () => void }) {
    const earned = new Set(unlockedAchievements());
    return (
        <div className="overlay" onClick={onClose}>
            <div className="box" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
                <h2 className="cyan">Achievements <span className="muted" style={{ fontSize: 14 }}>{earned.size}/{TOTAL_ACHIEVEMENTS}</span></h2>
                <div className="ach-grid">
                    {ACHIEVEMENTS.map((a) => {
                        const got = earned.has(a.id);
                        return (
                            <div className={"ach-card" + (got ? " got" : "")} key={a.id}>
                                <div className="ach-card-g">{got ? a.glyph : "🔒"}</div>
                                <div className="ach-card-body">
                                    <div className="ach-card-name">{a.name}</div>
                                    <div className="ach-card-desc">{a.desc}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="ach-actions">
                    <button className="term ghost tiny" onClick={() => exportProfile()} title="Download your progress as a file">⭳ Export save</button>
                    <button className="term ghost tiny" onClick={async () => { if (await importProfile()) location.reload(); }} title="Load progress from a file (merges, never erases)">⭱ Import save</button>
                    <button className="term" onClick={onClose}>Close</button>
                </div>
                <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>Progress saves automatically. On Steam it syncs to the Cloud; anywhere, Export keeps a backup you can move between machines.</p>
            </div>
        </div>
    );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
    const [fun, setFun] = useState(0);
    const [difficulty, setDifficulty] = useState("");
    const [operator, setOperator] = useState("");
    const [confusing, setConfusing] = useState("");
    const [comments, setComments] = useState("");
    const [sent, setSent] = useState<"" | "copied" | "failed">("");
    const p = loadProfile();

    const summary = () => [
        "=== BREACH playtest feedback ===",
        `Build: ${IS_DEMO ? "DEMO" : "FULL"}`,
        `Contracts completed: ${p.totalWins}`,
        `Fun: ${fun ? fun + "/5" : "—"}`,
        `Difficulty: ${difficulty || "—"}`,
        `Favorite operator: ${operator || "—"}`,
        `Confusing / unclear: ${confusing.trim() || "—"}`,
        `Other comments: ${comments.trim() || "—"}`,
    ].join("\n");

    const copy = async () => {
        try { await navigator.clipboard.writeText(summary()); setSent("copied"); }
        catch { setSent("failed"); }
    };
    const email = () => {
        const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("BREACH playtest feedback")}&body=${encodeURIComponent(summary())}`;
        try { window.open(url, "_blank"); } catch { /* ignore */ }
    };

    return (
        <div className="overlay" onClick={onClose}>
            <div className="box fb" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
                <h2 className="cyan">Tester feedback</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Two minutes of notes genuinely shapes the game. Nothing is sent automatically — you copy it and share it however you like.</p>

                <div className="fb-q"><label>How much fun was that? (1–5)</label>
                    <div className="fb-scale">{[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} className={"fb-pip" + (fun === n ? " on" : "")} onClick={() => setFun(n)}>{n}</button>
                    ))}</div>
                </div>
                <div className="fb-q"><label>Difficulty felt…</label>
                    <div className="fb-opts">{["too easy", "about right", "too hard"].map((d) => (
                        <button key={d} className={"fb-opt" + (difficulty === d ? " on" : "")} onClick={() => setDifficulty(d)}>{d}</button>
                    ))}</div>
                </div>
                <div className="fb-q"><label>Favorite operator</label>
                    <div className="fb-opts">{HACKER_ORDER.map((id) => (
                        <button key={id} className={"fb-opt" + (operator === HACKERS[id].name ? " on" : "")} onClick={() => setOperator(HACKERS[id].name)}>{HACKERS[id].glyph} {HACKERS[id].name}</button>
                    ))}</div>
                </div>
                <div className="fb-q"><label>Anything confusing or unclear?</label>
                    <textarea value={confusing} onChange={(e) => setConfusing(e.target.value)} rows={2} placeholder="A card, a screen, a mechanic…" />
                </div>
                <div className="fb-q"><label>Anything else? (bugs, ideas, what you'd pay)</label>
                    <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="Say anything." />
                </div>

                <div className="ach-actions">
                    <button className="term" onClick={copy}>⧉ Copy feedback</button>
                    <button className="term ghost" onClick={email}>✉ Email it</button>
                    <button className="term ghost tiny" onClick={onClose}>Close</button>
                </div>
                {sent === "copied" && <p className="cyan" style={{ fontSize: 12, marginTop: 8 }}>Copied to your clipboard — paste it into Discord, email, or the feedback thread. Thank you!</p>}
                {sent === "failed" && <p className="amber" style={{ fontSize: 12, marginTop: 8 }}>Couldn't reach the clipboard here — use “Email it”, or select the summary manually.</p>}
            </div>
        </div>
    );
}

/* ============================================================
   RUN MAP — the branching route graph, Slay-the-Spire style
   ============================================================ */
const COLW = 190, ROWH = 98, PADX = 16, PADY = 16, NODEW = 152, NODEH = 70;

function RunMap({ run, campaign, onPick }: { run: RunState; campaign: Campaign; onPick: (n: MapNode) => void }) {
    const [hover, setHover] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => { setSelected(null); setHover(null); }, [run.nodeId]);
    // keep the current position in view as the map advances (no page scroll)
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const cur = getNode(campaign, run.nodeId);
        const col = cur ? cur.col : 0;
        const x = PADX + col * COLW + NODEW / 2;
        el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "smooth" });
    }, [run.nodeId, campaign]);
    const options = currentOptions(run);
    const optionIds = new Set(options.map((n) => n.id));
    const pathSet = new Set(run.path);
    const nodes = campaign.map;
    const maxCol = Math.max(...nodes.map((n) => n.col));
    const maxRow = Math.max(...nodes.map((n) => n.row));
    const width = PADX * 2 + maxCol * COLW + NODEW;
    const height = PADY * 2 + maxRow * ROWH + NODEH;
    const cx = (n: MapNode) => PADX + n.col * COLW + NODEW / 2;
    const cy = (n: MapNode) => PADY + n.row * ROWH + NODEH / 2;

    const traveled = new Set<string>();
    for (let i = 0; i < run.path.length - 1; i++) traveled.add(`${run.path[i]}>${run.path[i + 1]}`);

    const edges: { from: MapNode; to: MapNode; cls: string }[] = [];
    for (const n of nodes) for (const mId of n.next) {
        const to = getNode(campaign, mId);
        if (!to) continue;
        const cls = traveled.has(`${n.id}>${to.id}`) ? "traveled" : (n.id === run.nodeId && optionIds.has(to.id)) ? "open" : "dim";
        edges.push({ from: n, to, cls });
    }

    const detail = getNode(campaign, hover) || getNode(campaign, selected) || (options.length === 1 ? options[0] : null);
    const detailOpen = !!detail && optionIds.has(detail.id);

    return (
        <>
            <div className="mapscroll" ref={scrollRef}>
                <div className="mapwrap" style={{ width, height }}>
                    <svg className="edges" width={width} height={height}>
                        {!run.nodeId && options.map((o) => (
                            <line key={"s" + o.id} className="edge open" x1={PADX} y1={cy(o)} x2={cx(o) - NODEW / 2} y2={cy(o)} />
                        ))}
                        {edges.map((e, i) => (
                            <line key={i} className={"edge " + e.cls} x1={cx(e.from) + NODEW / 2 - 6} y1={cy(e.from)} x2={cx(e.to) - NODEW / 2 + 6} y2={cy(e.to)} />
                        ))}
                    </svg>
                    {!run.nodeId && <div className="mapstart" style={{ top: PADY + 0.6 * ROWH + NODEH / 2 - 8 }}>START ▸</div>}
                    {nodes.map((n) => {
                        const isCurrent = n.id === run.nodeId;
                        const isDone = pathSet.has(n.id) && !isCurrent;
                        const isOpen = optionIds.has(n.id);
                        const cls = isCurrent ? "cur" : isDone ? "done" : isOpen ? "open" : "locked";
                        const diff = n.type === "breach" && n.systemKey ? SYSTEMS[n.systemKey].difficulty : 0;
                        const mod = n.type === "breach" ? getModifier(run.mods[n.id]) : null;
                        const marked = mod && mod.key !== "clean";
                        return (
                            <div
                                key={n.id}
                                className={"mnode " + n.type + " " + cls + (isTerminal(n) ? " finale" : "") + (selected === n.id ? " sel" : "") + (marked ? " mod-" + mod!.tone : "")}
                                style={{ left: PADX + n.col * COLW, top: PADY + n.row * ROWH, width: NODEW, height: NODEH }}
                                onClick={() => setSelected(n.id)}
                                onMouseEnter={() => setHover(n.id)}
                                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                            >
                                {marked && <span className={"mnodemark " + mod!.tone}>{mod!.tone === "easier" ? "▽" : mod!.tone === "harder" ? "⚠" : "◈"}</span>}
                                <span className="micon">{nodeIcon(n)}</span>
                                <span className="mlabel">{n.type === "event" ? (run.events[n.id]?.title || n.title) : n.title}</span>
                                {diff > 0 && <span className="mdiff">{"◆".repeat(diff)}</span>}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="maplegend">
                <span className="lg"><span className="li" style={{ color: "var(--amber)" }}>◈</span> job</span>
                <span className="lg"><span className="li" style={{ color: "#ffd24a" }}>★</span> final job</span>
                <span className="lg"><span className="li" style={{ color: "var(--cyan)" }}>☂</span> safehouse <span className="muted">· cools heat</span></span>
                <span className="lg"><span className="li" style={{ color: "#c98cff" }}>❋</span> event <span className="muted">· a choice</span></span>
                <span className="lg"><span className="li" style={{ color: "var(--red)" }}>◆</span> difficulty</span>
                <span className="lg"><span className="li" style={{ color: "var(--red)" }}>⚠</span> harder <span className="muted">/</span> <span className="li" style={{ color: "var(--cyan)" }}>▽</span> easier <span className="muted">twist</span></span>
            </div>
            <div className={"mapdetail" + (detail ? "" : " empty")}>
                {detail ? (
                    <>
                        <div className="md-head">
                            <span className="md-tag">{nodeIcon(detail)} {detail.type === "breach" ? (isTerminal(detail) ? "FINAL BREACH" : "BREACH") : detail.type === "safehouse" ? "SAFEHOUSE" : "EVENT"}</span>
                            {detailOpen && <button className="term md-go" onClick={() => onPick(detail)}>▶ Take this route</button>}
                        </div>
                        <b className="md-title">{detail.type === "event" ? (run.events[detail.id]?.title || detail.title) : detail.title}</b>
                        <span className="md-blurb">{detail.type === "event" ? (run.events[detail.id]?.blurb || detail.blurb) : detail.blurb}</span>
                        {detail.type === "breach" && (() => { const md = getModifier(run.mods[detail.id]); return md.key !== "clean" ? <span className={"md-mod " + md.tone}>{md.tone === "easier" ? "▽" : md.tone === "harder" ? "⚠" : "◈"} {md.label} — {md.blurb}</span> : null; })()}
                        <span className="md-foot muted">
                            {detail.type === "breach" && detail.systemKey ? `target: ${SYSTEMS[detail.systemKey].name} · difficulty ${SYSTEMS[detail.systemKey].difficulty}/5 · reward ${detail.reward || 20}cr` : null}
                            {detail.type === "safehouse" ? `lie low · −${detail.heatRelief || 20} heat · no pay` : null}
                            {detail.type === "event" ? "a choice — no breach" : null}
                            {!detailOpen && (pathSet.has(detail.id) ? "  ·  ✓ visited" : "  ·  not on your current route")}
                        </span>
                    </>
                ) : <span className="muted">Tap a node to scout it · the lit nodes are the routes open to you now.</span>}
            </div>
        </>
    );
}

/* ============================================================
   RUN VIEW (the map, Heat, story, deck; overlays for events)
   ============================================================ */
function RunView({ run, campaign, onLaunchBreach, onRun, onOpenDeck }: {
    run: RunState; campaign: Campaign; onLaunchBreach: (n: MapNode) => void; onRun: (r: RunState) => void; onOpenDeck: () => void;
}) {
    const [activeEvent, setActiveEvent] = useState<MapNode | null>(null);
    const [removing, setRemoving] = useState<{ choice: EventChoice; node: MapNode } | null>(null);
    const finale = atFinale(run);
    const heatFrac = run.heat / run.heatMax;
    const hp = huntPressure(run.heat, run.heatMax, threatEffects(run.threat).huntOffset);
    const watcherName = campaign.antagonist ? campaign.antagonist.name : "The watcher";

    const pickChoice = (node: MapNode, choice: EventChoice) => {
        if (choice.removeCard) { setRemoving({ choice, node }); return; }
        onRun(resolveEvent(run, node, choice)); setActiveEvent(null);
    };
    const doRemove = (cardId: string) => {
        if (!removing) return;
        onRun(resolveEvent(removeCard(run, cardId), removing.node, removing.choice));
        setRemoving(null); setActiveEvent(null);
    };
    const pickNode = (n: MapNode) => {
        sfx.play("select");
        if (n.type === "breach") onLaunchBreach(n);
        else if (n.type === "safehouse") onRun(resolveSafehouse(run, n));
        else setActiveEvent(n);
    };

    return (
        <div className="wrap">
            <div className="title">{campaign.name} <span className="sub">// {finale ? "the final job" : "choose your route"}</span>{run.threat > 0 ? <span className="threatbadge"> ⚠ THREAT {run.threat}</span> : null}</div>
            <div className="run-stats">
                <span className="cyan">{getHacker(run.hackerId).glyph} {getHacker(run.hackerId).name}</span>
                <span>💾 <b className="gold">{run.credits}</b>cr</span>
                <span className="deck-link" onClick={onOpenDeck}>🃏 deck: <b>{run.deck.length}</b> ▸</span>
                <span className="muted">jobs pulled: {run.jobsDone}</span>
            </div>
            {run.implants.length > 0 && (
                <div className="implants-owned">
                    <span className="muted">◆ INSTALLED:</span>
                    {run.implants.map((id) => <span key={id} className="implant-chip" title={IMPLANTS[id] ? IMPLANTS[id].blurb : ""}>{IMPLANTS[id] ? IMPLANTS[id].name : id}</span>)}
                </div>
            )}

            <div className="meter-label"><span className="red">TRACE ON YOU (HEAT)</span><span style={{ color: meterColor(heatFrac) }}>{run.heat} / {run.heatMax}</span></div>
            <div className="meter"><div className="fill" style={{ width: `${heatFrac * 100}%`, background: meterColor(heatFrac) }} /></div>
            {hp.tier > 0 ? (
                <div className={"watcher-status tier" + hp.tier}>⌁ <b>{watcherName}</b> is closing in — <b>{hp.label}</b>: {hp.blurb} <span className="muted">Lie low to shake it.</span></div>
            ) : (
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Loud jobs and blown breaches raise the trace. Let it climb and the watcher starts making your breaches harder — so play quiet, and lie low when you can.</div>
            )}

            <hr />
            <h3 className="amber" style={{ margin: "6px 0 6px" }}>▶ {finale ? "THE FINAL JOB" : "THE MAP — pick where you go next"}</h3>
            <RunMap run={run} campaign={campaign} onPick={pickNode} />

            <div className="story">
                {run.story.slice(-2).map((line, i) => <p key={i} className={"story-line" + (line.startsWith("⌁") ? " rogue" : "")}>{line}</p>)}
            </div>

            {/* event overlay */}
            {activeEvent && !removing && (() => {
                const ev = run.events[activeEvent.id] || { title: activeEvent.title, blurb: activeEvent.blurb, choices: activeEvent.choices || [] };
                return (
                <div className="overlay">
                    <div className="box" style={{ textAlign: "left", maxWidth: 560 }}>
                        <h2 className="cyan">{ev.title}</h2>
                        <p className="brief">{ev.blurb}</p>
                        <div className="event-choices">
                            {ev.choices.map((ch, i) => {
                                const cant = ch.requiresCredits != null && run.credits < ch.requiresCredits;
                                return (
                                    <button key={i} className={"term event-choice" + (cant ? " disabled" : "")} disabled={cant} onClick={() => pickChoice(activeEvent, ch)}>
                                        {ch.label}{cant ? " (not enough credits)" : ""}
                                    </button>
                                );
                            })}
                        </div>
                        <button className="term ghost tiny" style={{ marginTop: 12 }} onClick={() => setActiveEvent(null)}>◂ back to the map</button>
                    </div>
                </div>
                );
            })()}

            {/* remove-a-card chooser */}
            {removing && (
                <div className="overlay">
                    <div className="box" style={{ maxWidth: 820 }}>
                        <h2>Scrub a card from your deck</h2>
                        <div className="grid-cards">{run.deck.map((id, i) => <CardMini key={i} id={id} onClick={() => doRemove(id)} />)}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ============================================================
   ENDING
   ============================================================ */
function Ending({ run, campaign, newlyUnlocked, onRestart, onFeedback }: { run: RunState; campaign: Campaign; newlyUnlocked: string[]; onRestart: () => void; onFeedback: () => void }) {
    const won = run.outcome === "won";
    const s = run.stats;
    const heatFrac = run.heat / run.heatMax;
    // a little flavor verdict on how you played
    const verdict = s.loudestPct == null ? "no jobs pulled"
        : s.loudestPct <= 40 ? "You were a ghost — barely a ripple."
        : s.loudestPct <= 70 ? "Loud in places, but you got out."
        : "You kicked the door in. It worked — this time.";
    return (
        <div className="wrap">
            <div className="overlay">
                <div className={"box " + (won ? "won" : "lost")} style={{ textAlign: "left", maxWidth: 620 }}>
                    <div className="end-face">{won ? <HeroFace op={run.hackerId} state="calm" /> : <WatcherFace state="alarmed" />}</div>
                    <p className={"end-say " + (won ? "cyan" : "red")}>{won ? "“Data’s clean. Nobody saw a ghost.”" : "“I flagged you the moment you knocked.”"}</p>
                    <h2 className={won ? "cyan" : "red"} style={{ textAlign: "center" }}>{won ? "CONTRACT COMPLETE" : "BUSTED"}</h2>
                    <p className="brief">{won ? campaign.winText : campaign.bustedText}</p>
                    <div className="runsummary">
                        <div className="rs-row"><span>Campaign</span><b>{campaign.name}{run.threat > 0 ? ` · Threat ${run.threat}` : ""}</b></div>
                        <div className="rs-row"><span>Jobs pulled</span><b>{run.jobsDone}</b></div>
                        <div className="rs-row"><span>Route length</span><b>{run.path.length} stops</b></div>
                        <div className="rs-row"><span>Final trace (Heat)</span><b style={{ color: meterColor(heatFrac) }}>{run.heat} / {run.heatMax}</b></div>
                        {s.quietestPct != null && <div className="rs-row"><span>Quietest breach</span><b className="cyan">{s.quietestPct}% detection</b></div>}
                        {s.loudestPct != null && <div className="rs-row"><span>Loudest breach</span><b className="amber">{s.loudestPct}% detection</b></div>}
                        <div className="rs-row"><span>Deck</span><b>{run.deck.length} cards</b></div>
                        {run.implants.length > 0 && <div className="rs-row"><span>Implants installed</span><b>{run.implants.length}</b></div>}
                    </div>
                    <p className="muted" style={{ fontSize: 12, fontStyle: "italic", marginTop: 8 }}>{verdict}</p>
                    {newlyUnlocked.length > 0 && (
                        <div className="ach-earned">
                            {newlyUnlocked.map((id) => { const a = getAchievement(id); return a ? (
                                <div className="ach-earned-row" key={id}><span className="ach-g">{a.glyph}</span> <b>ACHIEVEMENT UNLOCKED</b> — {a.name}</div>
                            ) : null; })}
                        </div>
                    )}
                    {IS_DEMO ? (
                        <div className="demo-cta">
                            <p className="cyan" style={{ textAlign: "center", fontWeight: "bold", marginBottom: 4 }}>{won ? "That's the demo." : "Want another shot? That's the demo."}</p>
                            <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>The full game: 4 operators, 4 campaigns (short to long), collectible implants, and a 10-level Threat ascension ladder.</p>
                            <a className="term wishlist" href={STEAM_URL} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: "block", textAlign: "center" }}>★ Wishlist BREACH on Steam</a>
                        </div>
                    ) : (
                        <>
                            {won && run.threat < MAX_THREAT && <p className="amber" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>▲ THREAT {run.threat + 1} unlocked for {campaign.name}.</p>}
                            {won && run.threat >= MAX_THREAT && <p className="cyan" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>★ You cleared the maximum Threat. You've mastered this contract.</p>}
                        </>
                    )}
                    <button className="term" style={{ marginTop: 14, display: "block", marginInline: "auto" }} onClick={onRestart}>◂ {IS_DEMO ? "Play again" : "Choose another storyline"}</button>
                    <div style={{ textAlign: "center", marginTop: 10 }}><span className="deck-link" onClick={onFeedback}>💬 Share feedback on this run</span></div>
                </div>
            </div>
        </div>
    );
}

/* ---------- boot intro: a 2s fake connection sequence on load ---------- */
function BootIntro({ onDone }: { onDone: () => void }) {
    const LINES = [
        { t: "establishing uplink" },
        { t: "spoofing MAC address" },
        { t: "routing through 7 proxies" },
        { t: "cracking the handshake" },
        { t: "ACCESS GRANTED", grant: true },
    ];
    const [n, setN] = useState(0);
    const [leaving, setLeaving] = useState(false);
    const finish = () => { if (leaving) return; setLeaving(true); sfx.play("transmission"); window.setTimeout(onDone, 480); };
    useEffect(() => {
        let i = 0;
        const id = window.setInterval(() => { i++; setN(i); if (i >= LINES.length) { window.clearInterval(id); window.setTimeout(finish, 650); } }, 320);
        return () => window.clearInterval(id);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <div className={"boot" + (leaving ? " done" : "")} onClick={finish}>
            {LINES.slice(0, n).map((l, i) => (
                <div className="bline" key={i}>
                    {l.grant
                        ? <span className="ok" style={{ fontWeight: "bold", letterSpacing: "3px" }}>&gt; {l.t}{i === n - 1 && <span className="bcursor" />}</span>
                        : <>&gt; {l.t}{".".repeat(Math.max(3, 26 - l.t.length))} <span className="ok">ok</span></>}
                </div>
            ))}
            <div className="bskip">click to skip ▸</div>
        </div>
    );
}

/* ============================================================
   APP — mode machine
   ============================================================ */
export function App() {
    const [mode, setMode] = useState<"hacker" | "campaign" | "run" | "breach" | "ending">("hacker");
    const [hackerId, setHackerId] = useState<string>("wraith");
    const [run, setRun] = useState<RunState | null>(null);
    const [activeNode, setActiveNode] = useState<MapNode | null>(null);
    const [reward, setReward] = useState<{ kind: "card" | "implant"; options: string[] } | null>(null);
    const [showDeck, setShowDeck] = useState(false);
    const [showAchievements, setShowAchievements] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [endAchievements, setEndAchievements] = useState<string[]>([]);
    const [booted, setBooted] = useState(() => { try { return sessionStorage.getItem("breach_booted") === "1"; } catch { return false; } });
    const finishBoot = () => { setBooted(true); try { sessionStorage.setItem("breach_booted", "1"); } catch { /* ignore */ } };
    useEffect(() => { applyCrt(crtIsOn()); }, []); // apply CRT screen mode on load

    // LIVING BACKGROUND: a faint stream of data drifting behind the whole app, so the
    // screen always reads as a running system rather than a static board. Canvas is
    // pinned to <body> (behind #root) so it persists across every screen. Respects
    // reduced-motion, and throttles to ~18fps to stay cheap on phones.
    useEffect(() => {
        if (typeof window === "undefined" || !document.body) return;
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const canvas = document.createElement("canvas");
        canvas.className = "coderain"; canvas.setAttribute("aria-hidden", "true");
        document.body.insertBefore(canvas, document.body.firstChild);
        const ctx = canvas.getContext("2d");
        if (!ctx) { canvas.remove(); return; }
        const FONT = 14, COLW = 26; // COLW > FONT spaces the streams out so it reads calm, not busy
        const GLYPHS = "0101ABCDEF0123456789<>[]{}/\\|=+*#%$?".split("");
        let w = 0, h = 0, cols = 0, drops: number[] = [], sp: number[] = [], raf = 0, last = 0;
        const resize = () => {
            w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight;
            cols = Math.ceil(w / COLW);
            drops = Array.from({ length: cols }, () => Math.random() * -60);
            sp = Array.from({ length: cols }, () => 0.16 + Math.random() * 0.28);
            ctx.font = FONT + "px ui-monospace, monospace";
        };
        resize();
        window.addEventListener("resize", resize);
        const frame = (t: number) => {
            raf = requestAnimationFrame(frame);
            if (t - last < 60) return; // ~16fps — alive but light
            last = t;
            ctx.fillStyle = "rgba(5,8,10,0.42)"; ctx.fillRect(0, 0, w, h); // shorter trails
            // the backdrop breathes with the threat: green drizzle when you're a ghost,
            // amber churn once suspicion builds, a fast red torrent in lockdown
            const md = RAIN_MOOD.t;
            const bright = md >= 0.8 ? "rgba(255,110,110,0.5)" : md >= 0.45 ? "rgba(255,190,90,0.4)" : "rgba(120,255,190,0.38)";
            const dim = md >= 0.8 ? "rgba(220,60,60,0.26)" : md >= 0.45 ? "rgba(214,150,64,0.2)" : "rgba(46,196,124,0.20)";
            const rush = 1 + md * 2.4; // the rain accelerates as the trace closes
            for (let i = 0; i < cols; i++) {
                const y = drops[i] * FONT;
                if (y > 0) {
                    ctx.fillStyle = Math.random() > 0.97 ? bright : dim;
                    ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * COLW, y);
                }
                drops[i] += sp[i] * rush;
                if (y > h && Math.random() > (md >= 0.6 ? 0.93 : 0.975)) drops[i] = Math.random() * -20;
            }
        };
        raf = requestAnimationFrame(frame);
        return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); canvas.remove(); };
    }, []);

    // ambient bed: hum low on the map (scaled by Heat), let a breach drive its own
    // dread, and go silent in menus / after the run ends.
    useEffect(() => {
        if (mode === "run" && run) { sfx.setTension(0.1 + 0.55 * (run.heat / Math.max(1, run.heatMax))); RAIN_MOOD.t = 0.3 * (run.heat / Math.max(1, run.heatMax)); }
        else if (mode !== "breach") { sfx.stopBed(); RAIN_MOOD.t = 0; }
    }, [mode, run?.heat, run?.heatMax]);

    const campaign = run ? getCampaign(run.campaignId) : null;

    const pickHacker = (id: string) => { setHackerId(id); setMode("campaign"); };
    const startCampaign = (id: string, threat = 0) => { setRun(createRun(id, newSeed(), threat, hackerId)); setActiveNode(null); setReward(null); setMode("run"); };
    const launchBreach = (n: MapNode) => { setActiveNode(n); setMode("breach"); };

    // Finalize a finished run: record the win (meta-progression) and evaluate
    // achievements, stashing any freshly earned for the ending screen to show.
    const finishRun = (newRun: RunState) => {
        if (newRun.outcome === "won") recordWin(newRun.campaignId, newRun.threat, newRun.hackerId);
        const earned = syncAchievements({
            won: newRun.outcome === "won",
            campaignId: newRun.campaignId,
            hackerId: newRun.hackerId,
            threat: newRun.threat,
            jobsDone: newRun.jobsDone,
            loudestPct: newRun.stats.loudestPct,
            quietestPct: newRun.stats.quietestPct,
            heatFrac: newRun.heat / Math.max(1, newRun.heatMax),
            implantsInstalled: newRun.implants.length,
            deckSize: newRun.deck.length,
            credits: newRun.credits,
        });
        setEndAchievements(earned);
        setMode("ending");
    };

    const onBreachComplete = (result: BreachResult) => {
        if (!run || !activeNode) return;
        const newRun = resolveBreach(run, activeNode, result);
        setRun(newRun);
        setActiveNode(null);
        if (newRun.outcome !== "running") {
            finishRun(newRun);
            return;
        }
        setMode("run");
        if (result.won) {
            // sometimes the salvage is cyberware (an implant) rather than a card
            const lean = threatEffects(newRun.threat).leanRewards; // higher Threat = leaner salvage
            const available = IMPLANT_ORDER.filter((i) => !newRun.implants.includes(i));
            if (available.length >= 2 && Math.random() < (lean ? 0.3 : 0.4)) setReward({ kind: "implant", options: pickN(available, 2) });
            else setReward({ kind: "card", options: pickN(REWARD_POOL, lean ? 2 : 3) });
            sfx.play("reward");
        }
    };
    const onRun = (r: RunState) => { setRun(r); if (r.outcome !== "running") finishRun(r); };
    const takeReward = (id: string | null) => {
        if (id && run && reward) setRun(reward.kind === "implant" ? addImplant(run, id) : addCard(run, id));
        setReward(null);
    };
    // keyboard: pick a reward with number keys, skip with Esc/0
    useEffect(() => {
        if (!reward) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" || e.key === "0") { takeReward(null); return; }
            if (e.key >= "1" && e.key <= "9") { const n = parseInt(e.key, 10) - 1; if (n < reward.options.length) takeReward(reward.options[n]); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [reward]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!booted) return <BootIntro onDone={finishBoot} />;

    if (mode === "hacker") return <HackerSelect onPick={pickHacker} />;

    if (mode === "campaign" || !run || !campaign) return (
        <>
            <CampaignSelect onPick={startCampaign} onBack={() => setMode("hacker")} hacker={hackerId} onShowAchievements={() => setShowAchievements(true)} onShowFeedback={() => setShowFeedback(true)} />
            {showAchievements && <AchievementsModal onClose={() => setShowAchievements(false)} />}
            {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
        </>
    );

    if (mode === "breach" && activeNode) {
        return <Breach systemKey={activeNode.systemKey || "homeServer"} systemTitle={activeNode.title} deck={run.deck} modifier={getModifier(run.mods[activeNode.id])} hunt={huntPressure(run.heat, run.heatMax, threatEffects(run.threat).huntOffset)} implants={run.implants} threat={run.threat} hackerId={run.hackerId} onComplete={onBreachComplete} />;
    }

    if (mode === "ending") return (
        <>
            <Ending run={run} campaign={campaign} newlyUnlocked={endAchievements} onRestart={() => { setMode("campaign"); setRun(null); }} onFeedback={() => setShowFeedback(true)} />
            {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
        </>
    );

    // run mode — the map, plus reward / deck / transmission overlays
    return (
        <>
            <RunView run={run} campaign={campaign} onLaunchBreach={launchBreach} onRun={onRun} onOpenDeck={() => setShowDeck(true)} />
            {reward && (
                <div className="overlay">
                    <div className="box" style={{ maxWidth: 660 }}>
                        <h2 className="cyan">{reward.kind === "implant" ? "SALVAGE — install cyberware" : "JOB PAID — pick up a new tool"}</h2>
                        {reward.kind === "implant" && <p className="muted" style={{ marginTop: -4 }}>Passive. Applies to every breach for the rest of the run.</p>}
                        <p className="muted" style={{ fontSize: 11, marginTop: -2 }}>Click, or press <b className="kbd-inline">1</b>–<b className="kbd-inline">{reward.options.length}</b> to pick · <b className="kbd-inline">Esc</b> to skip.</p>
                        <div className="card-choices">{reward.options.map((id, i) => reward.kind === "implant"
                            ? <ImplantCard key={i} id={id} num={i + 1} onClick={() => takeReward(id)} />
                            : <CardMini key={i} id={id} num={i + 1} onClick={() => takeReward(id)} />)}</div>
                        <button className="term ghost" onClick={() => takeReward(null)}>{reward.kind === "implant" ? "Skip — stay unmodified" : "Skip — keep the deck lean"}</button>
                    </div>
                </div>
            )}
            {showDeck && (
                <div className="overlay" onClick={() => setShowDeck(false)}>
                    <div className="box" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
                        <h2>Your Deck ({run.deck.length})</h2>
                        <div className="grid-cards">{run.deck.slice().sort().map((id, i) => <CardMini key={i} id={id} />)}</div>
                        <button className="term" style={{ marginTop: 12 }} onClick={() => setShowDeck(false)}>Close</button>
                    </div>
                </div>
            )}
            {campaign.antagonist && run.transmission && (
                <Transmission name={campaign.antagonist.name} text={run.transmission} onClose={() => setRun(clearTransmission(run))} />
            )}
        </>
    );
}
