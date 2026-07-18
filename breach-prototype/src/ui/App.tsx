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
import { IMPLANTS, IMPLANT_ORDER, getImplant, aggregateImplants } from "../engine/implants.ts";
import { threatEffects, threatLabel, THREAT_STEPS, MAX_THREAT } from "../engine/threat.ts";
import { recordWin, isCampaignUnlocked, availableThreat, maxThreatCleared, campaignRequirement, loadProfile } from "./meta.ts";
import { sfx } from "./audio.ts";
import { createInitialState, applyAction, canPlay, projectedNoise, needsTarget, targetableDefenses, previewOnTarget } from "../engine/engine.ts";
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
function ImplantCard({ id, onClick }: { id: string; onClick?: () => void }) {
    const im = getImplant(id);
    if (!im) return null;
    return (
        <div className={"card implant" + (onClick ? " playable" : "")} onClick={onClick} title={im.blurb}>
            <div className="chead"><span className="cname">◆ {im.name}</span></div>
            <div className="kind">implant · passive</div>
            <div className="ctext">{im.blurb}</div>
        </div>
    );
}
const nodeIcon = (n: MapNode) => (n.type === "breach" ? (isTerminal(n) ? "★" : "◈") : n.type === "safehouse" ? "☂" : "❋");

function MuteButton() {
    const [m, setM] = useState(sfx.isMuted());
    return <button className="term ghost tiny" onClick={() => setM(sfx.toggleMute())} title={m ? "sound off — click for sound" : "sound on"}>{m ? "🔇" : "🔊"}</button>;
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
                    <p className="muted">Win the job: clear the final objective layer. Enter = end turn · Esc = cancel targeting.</p>
                </div>
                <button className="term" onClick={onClose}>Got it ▸</button>
            </div>
        </div>
    );
}

function DefenseChip({ d, targetable, preview, onClick }: { d: Defense; targetable: boolean; preview?: string | null; onClick: () => void }) {
    const down = d.strength <= 0;
    return (
        <span className={"dchip" + (targetable ? " targetable" : "") + (down ? " down" : "") + (d.typeRevealed && !down ? " t-" + d.type : "")} onClick={targetable ? onClick : undefined}>
            {down ? "✓ down" : d.typeRevealed ? <b className={"dtype t-" + d.type}>{d.type}</b> : <span className="muted">???</span>}
            {!down && (
                <span className="ds">
                    {d.strengthRevealed ? (
                        <><span className="dbar"><span className="df" style={{ width: `${(d.strength / d.maxStrength) * 100}%` }} /></span><span className="snum">STR {d.strength}</span></>
                    ) : (<span className="snum">STR ??</span>)}
                </span>
            )}
            {targetable && preview && <span className="preview">▸ {preview}</span>}
        </span>
    );
}

function CardMini({ id, onClick, dim }: { id: string; onClick?: () => void; dim?: boolean }) {
    const def = CARDS[id];
    if (!def) return null;
    return (
        <div className={"card mini kind-" + def.kind + (onClick ? " playable" : "") + (dim ? " disabled" : "")} onClick={onClick} title={def.text}>
            <div className="chead">
                <span className="cname">{def.name}{def.needsTarget ? <span className="muted"> ◎</span> : null}</span>
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
    );
}

/* ============================================================
   BREACH SCREEN (one job)
   ============================================================ */
function Breach({ systemKey, systemTitle, deck, modifier, hunt, implants, threat, onComplete }: { systemKey: string; systemTitle: string; deck: string[]; modifier?: SystemModifier | null; hunt?: HuntPressure | null; implants?: string[]; threat?: number; onComplete: (r: BreachResult) => void }) {
    const [state, setState] = useState<GameState>(() => createInitialState(newSeed(), systemKey, deck, modifier, hunt, aggregateImplants(implants || []), threatEffects(threat || 0)));
    const [armed, setArmed] = useState<string | null>(null);
    const [showIntro, setShowIntro] = useState(() => { try { return localStorage.getItem("breach_seen_intro") !== "1"; } catch { return true; } });
    const closeIntro = () => { setShowIntro(false); try { localStorage.setItem("breach_seen_intro", "1"); } catch { /* ignore */ } };

    const dispatch = (card: string, target?: number) => { setState((s) => applyAction(s, { type: "playCard", card, target })); setArmed(null); };
    const endTurn = () => { setState((s) => applyAction(s, { type: "endTurn" })); setArmed(null); };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (state.outcome !== "playing" || showIntro) return;
            if (e.key === "Enter") { e.preventDefault(); endTurn(); }
            if (e.key === "Escape") setArmed(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [state, showIntro]);

    // sound: derive SFX from state transitions (fires once per commit)
    const prevRef = useRef(state);
    useEffect(() => {
        const prev = prevRef.current;
        if (state !== prev) {
            const total = (s: GameState) => s.layers.reduce((a, l) => a + l.defenses.reduce((b, d) => b + Math.max(0, d.strength), 0), 0);
            const brk = (s: GameState) => s.layers.filter((l) => l.breached).length;
            const rank: Record<string, number> = { IDLE: 0, SUSPICIOUS: 1, ALERTED: 2, LOCKDOWN: 3 };
            if (state.outcome === "won" && prev.outcome === "playing") sfx.play("win");
            else if (state.outcome === "lost" && prev.outcome === "playing") sfx.play("fail");
            else if (brk(state) > brk(prev)) sfx.play("breach");
            else if (state.turn > prev.turn) sfx.play("turn");
            else if (state.log.length > prev.log.length) sfx.play(total(state) < total(prev) ? "hit" : "card");
            if (state.outcome === "playing" && rank[state.alert] > rank[prev.alert]) sfx.play("alert");
            prevRef.current = state;
        }
    }, [state]);

    const detFrac = state.detection / state.detectionMax;
    const room = state.detectionMax - state.detection;
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
        <div className="wrap">
            <div className="title">
                BREACH <span className="sub">// {systemTitle}</span>
                <button className="term ghost tiny" style={{ marginLeft: 14 }} onClick={() => onComplete({ won: false, detection: state.detectionMax, detectionMax: state.detectionMax })}>abort job</button>
            </div>
            <div className="muted">turn {state.turn} · target: {state.system} · clear the objective before you're detected</div>
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
            {implants && implants.length > 0 && (
                <div className="implant-strip muted">◆ implants: {implants.map((id) => IMPLANTS[id] && IMPLANTS[id].name).filter(Boolean).join(" · ")}</div>
            )}
            <hr />

            <div className="meter-label">
                <span className="amber">DETECTION</span>
                <span style={{ color: meterColor(detFrac) }}>{state.detection} / {state.detectionMax}</span>
            </div>
            <div className="meter">
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
            </div>

            <div className="layers">
                {state.layers.map((l, i) => {
                    const isCurrent = i === state.current && !l.breached;
                    return (
                        <div key={i} className={"layer" + (isCurrent ? " current" : "") + (l.breached ? " breached" : "")}>
                            <span className="lname">{l.breached ? "✓ " : isCurrent ? "▶ " : "  "}{l.name}</span>
                            <span className="defs">
                                {l.breached ? <span className="muted">BREACHED</span> : l.defenses.map((d, di) => (
                                    <DefenseChip key={di} d={d} targetable={isCurrent && !!armed && d.strength > 0} preview={isCurrent && armed && d.strength > 0 ? previewOnTarget(state, armed, di) : null} onClick={() => dispatch(armed!, di)} />
                                ))}
                            </span>
                        </div>
                    );
                })}
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
                <div className="amber armed-hint">▶ SELECT A TARGET DEFENSE — the ▸ tag shows what this card will do (Esc to cancel)</div>
            ) : (
                <div className="muted hand-legend">YOUR HAND — click to play. &nbsp; <span className="amber">◈N</span> = noise · <span className="cyan">SILENT</span> = no noise · <span className="muted">◎</span> = needs a target</div>
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
                        <div key={i} className={"card kind-" + def.kind + (playable && !blocked ? "" : " disabled") + (danger ? " danger" : "") + (armed === id ? " armed" : "")} onClick={() => !blocked && onCardClick(id)} title={def.text}>
                            <div className="chead">
                                <span className="cname">{def.name}{needsT ? <span className="muted"> ◎</span> : null}</span>
                                <span className="noise" style={{ color: danger ? "#ff4141" : noise === 0 ? "#35e0d8" : "#ffb000" }}>{noise === 0 ? "SILENT" : "◈" + noise}</span>
                            </div>
                            <div className="kind">{def.kind}{def.tag ? <span className={"synergy s-" + def.tag}> · {def.tag}</span> : null}</div>
                            <div className="ctext">{def.text}</div>
                        </div>
                    );
                })}
                {state.hand.length === 0 && <span className="muted">— empty hand — end the turn —</span>}
            </div>

            <div className="controls">
                <button className="term" onClick={endTurn}>End Turn ▸</button>
                <button className="term ghost" onClick={() => setShowIntro(true)}>?</button>
                <MuteButton />
                <span className="piles muted">🂠 draw {state.deck.length} · discard {state.discard.length}</span>
            </div>
            <div className="muted turn-note">Ending a turn <b>discards your hand and draws {state.handSize} fresh</b> (cards recycle), then the system acts and the trace climbs +{state.baselineCreep}.</div>

            <div className="log">{state.log.slice(-3).map((line, i) => <span className="ln" key={i}>{line}</span>)}</div>

            {showIntro && <Intro onClose={closeIntro} />}

            {state.outcome !== "playing" && (
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
    );
}

/* ============================================================
   CAMPAIGN SELECT
   ============================================================ */
function CampaignSelect({ onPick }: { onPick: (id: string, threat: number) => void }) {
    const profile = loadProfile();
    const [threats, setThreats] = useState<Record<string, number>>(() =>
        Object.fromEntries(CAMPAIGN_ORDER.map((id) => [id, availableThreat(id, profile)])));
    const setThreat = (id: string, t: number) => setThreats((s) => ({ ...s, [id]: t }));

    return (
        <div className="wrap">
            <div className="title">BREACH <span style={{ float: "right" }}><MuteButton /></span></div>
            <p className="muted">A hacking roguelike. Choose a storyline — a branching map of breaches, a rising trace, and a deck you build as you go.{profile.totalWins > 0 ? ` · ${profile.totalWins} contract${profile.totalWins === 1 ? "" : "s"} completed` : ""}</p>
            <hr />
            <div className="systems">
                {CAMPAIGN_ORDER.map((id) => {
                    const c = CAMPAIGNS[id];
                    const depth = Math.max(...c.map.map((n) => n.col)) + 1;
                    const length = depth <= 3 ? "SHORT" : depth >= 6 ? "LONG" : "MEDIUM";
                    const unlocked = isCampaignUnlocked(id, profile);
                    const avail = availableThreat(id, profile);
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
                                <div className="lockbox">🔒 Complete {campaignRequirement(id)} contract{campaignRequirement(id) === 1 ? "" : "s"} to unlock</div>
                            )}
                        </div>
                    );
                })}
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>Complete a storyline to raise its <b className="amber">Threat Level</b> — each one stacks a new twist, all the way to Threat {MAX_THREAT}. Progress is saved.</p>
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
function Ending({ run, campaign, onRestart }: { run: RunState; campaign: Campaign; onRestart: () => void }) {
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
                    {won && run.threat < MAX_THREAT && <p className="amber" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>▲ THREAT {run.threat + 1} unlocked for {campaign.name}.</p>}
                    {won && run.threat >= MAX_THREAT && <p className="cyan" style={{ fontSize: 13, textAlign: "center", marginTop: 6 }}>★ You cleared the maximum Threat. You've mastered this contract.</p>}
                    <button className="term" style={{ marginTop: 14, display: "block", marginInline: "auto" }} onClick={onRestart}>◂ Choose another storyline</button>
                </div>
            </div>
        </div>
    );
}

/* ============================================================
   APP — mode machine
   ============================================================ */
export function App() {
    const [mode, setMode] = useState<"campaign" | "run" | "breach" | "ending">("campaign");
    const [run, setRun] = useState<RunState | null>(null);
    const [activeNode, setActiveNode] = useState<MapNode | null>(null);
    const [reward, setReward] = useState<{ kind: "card" | "implant"; options: string[] } | null>(null);
    const [showDeck, setShowDeck] = useState(false);

    const campaign = run ? getCampaign(run.campaignId) : null;

    const startCampaign = (id: string, threat = 0) => { setRun(createRun(id, newSeed(), threat)); setActiveNode(null); setReward(null); setMode("run"); };
    const launchBreach = (n: MapNode) => { setActiveNode(n); setMode("breach"); };

    const onBreachComplete = (result: BreachResult) => {
        if (!run || !activeNode) return;
        const newRun = resolveBreach(run, activeNode, result);
        setRun(newRun);
        setActiveNode(null);
        if (newRun.outcome !== "running") {
            if (newRun.outcome === "won") recordWin(newRun.campaignId, newRun.threat); // meta-progression
            setMode("ending");
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
    const onRun = (r: RunState) => { setRun(r); if (r.outcome !== "running") setMode("ending"); };
    const takeReward = (id: string | null) => {
        if (id && run && reward) setRun(reward.kind === "implant" ? addImplant(run, id) : addCard(run, id));
        setReward(null);
    };

    if (mode === "campaign" || !run || !campaign) return <CampaignSelect onPick={startCampaign} />;

    if (mode === "breach" && activeNode) {
        return <Breach systemKey={activeNode.systemKey || "homeServer"} systemTitle={activeNode.title} deck={run.deck} modifier={getModifier(run.mods[activeNode.id])} hunt={huntPressure(run.heat, run.heatMax, threatEffects(run.threat).huntOffset)} implants={run.implants} threat={run.threat} onComplete={onBreachComplete} />;
    }

    if (mode === "ending") return <Ending run={run} campaign={campaign} onRestart={() => { setMode("campaign"); setRun(null); }} />;

    // run mode — the map, plus reward / deck / transmission overlays
    return (
        <>
            <RunView run={run} campaign={campaign} onLaunchBreach={launchBreach} onRun={onRun} onOpenDeck={() => setShowDeck(true)} />
            {reward && (
                <div className="overlay">
                    <div className="box" style={{ maxWidth: 660 }}>
                        <h2 className="cyan">{reward.kind === "implant" ? "SALVAGE — install cyberware" : "JOB PAID — pick up a new tool"}</h2>
                        {reward.kind === "implant" && <p className="muted" style={{ marginTop: -4 }}>Passive. Applies to every breach for the rest of the run.</p>}
                        <div className="card-choices">{reward.options.map((id, i) => reward.kind === "implant"
                            ? <ImplantCard key={i} id={id} onClick={() => takeReward(id)} />
                            : <CardMini key={i} id={id} onClick={() => takeReward(id)} />)}</div>
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
