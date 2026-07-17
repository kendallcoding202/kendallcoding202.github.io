/* ============================================================
   BREACH — terminal UI over the pure engine.
   Renders GameState, dispatches Actions. Zero game logic here.
   ============================================================ */

import { useEffect, useMemo, useState } from "react";
import type { Defense, GameState } from "../engine/types.ts";
import { CARDS } from "../engine/cards.ts";
import { SYSTEMS, SYSTEM_ORDER } from "../engine/systems.ts";
import { createInitialState, applyAction, canPlay, projectedNoise, currentLayer, needsTarget, targetableDefenses, previewOnTarget } from "../engine/engine.ts";

const newSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0;

function meterColor(f: number): string {
    if (f < 0.3) return "#4af626";
    if (f < 0.6) return "#ffb000";
    if (f < 0.85) return "#ff7a1a";
    return "#ff4141";
}

/* ---------- intro ---------- */
function Intro({ onClose }: { onClose: () => void }) {
    return (
        <div className="overlay intro">
            <div className="box">
                <h2 className="cyan">BREACH // BRIEFING</h2>
                <div className="brief">
                    <p>You're inside a live system. Breach it and exfiltrate the data — before it detects you.</p>
                    <p><span className="amber">DETECTION</span> is everything. Every card makes <b>NOISE</b> that fills the meter. Fill it and you're <span className="red">locked out</span>. Loud tools are powerful; quiet ones keep you invisible.</p>
                    <p><span className="amber">BREACH INWARD</span> through the layers. Each defense has a <b>Strength</b> number — reduce it to 0 with exploits to take that defense down, and clear every defense on a layer to move inward. Defenses start <b>UNKNOWN</b>; spend quiet <b>recon</b> to reveal their type &amp; Strength, then hit each with its <b>matching exploit</b>.</p>
                    <p className="muted">To use a targeted card (marked ◎): click the card, then click the glowing defense it should hit.</p>
                    <p className="muted">You draw 5 cards a turn. Ending a turn discards whatever you didn't play and draws 5 fresh — your deck recycles, so nothing is ever lost. You don't have to play your whole hand; holding cards is how you stay quiet.</p>
                    <p><span className="amber">THE SYSTEM REACTS</span> — and it <b>tells you its next move</b> (SYSTEM ALERT panel). Read it and counter: Spoof its patch, or breach a defense before it hardens.</p>
                    <p className="muted">Win: breach the objective layer, then play Payload. Lose: detection maxes out. Enter = end turn · Esc = cancel targeting.</p>
                </div>
                <button className="term" onClick={onClose}>Begin ▸</button>
            </div>
        </div>
    );
}

/* ---------- target select screen ---------- */
function SelectScreen({ onPick }: { onPick: (key: string) => void }) {
    return (
        <div className="wrap">
            <div className="title">BREACH <span className="sub">// select target</span></div>
            <hr />
            <p className="muted">Choose a system to breach. Harder targets stack more layers, more defenses per layer, and a faster trace.</p>
            <div className="systems">
                {SYSTEM_ORDER.map((key) => {
                    const sys = SYSTEMS[key];
                    return (
                        <div className="syscard" key={key} onClick={() => onPick(key)}>
                            <div className="sysname">{sys.name}</div>
                            <div className="diff">
                                <span className="on">{"◆".repeat(sys.difficulty)}</span>
                                <span className="off">{"◇".repeat(5 - sys.difficulty)}</span>
                            </div>
                            <div className="sysflavor">{sys.flavor}</div>
                            <div className="sysmeta muted">
                                {sys.layers.length} layers · {sys.layers.reduce((n, l) => n + l.defenses.length, 0)} defenses · trace budget {sys.detectionMax}
                            </div>
                            <button className="term">Breach ▸</button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ---------- defense chip ---------- */
function DefenseChip({ d, targetable, preview, onClick }: { d: Defense; targetable: boolean; preview?: string | null; onClick: () => void }) {
    const down = d.strength <= 0;
    return (
        <span className={"dchip" + (targetable ? " targetable" : "") + (down ? " down" : "")} onClick={targetable ? onClick : undefined}>
            {down ? "✓ down" : d.typeRevealed ? <b className="cyan">{d.type}</b> : <span className="muted">???</span>}
            {!down && (
                <span className="ds">
                    {d.strengthRevealed ? (
                        <>
                            <span className="dbar"><span className="df" style={{ width: `${(d.strength / d.maxStrength) * 100}%` }} /></span>
                            <span className="snum">STR {d.strength}</span>
                        </>
                    ) : (
                        <span className="snum">STR ??</span>
                    )}
                </span>
            )}
            {targetable && preview && <span className="preview">▸ {preview}</span>}
        </span>
    );
}

/* ---------- main ---------- */
export function App() {
    const [screen, setScreen] = useState<"select" | "playing">("select");
    const [state, setState] = useState<GameState | null>(null);
    const [armed, setArmed] = useState<string | null>(null);
    const [showIntro, setShowIntro] = useState(() => {
        try { return localStorage.getItem("breach_seen_intro") !== "1"; } catch { return true; }
    });
    const closeIntro = () => { setShowIntro(false); try { localStorage.setItem("breach_seen_intro", "1"); } catch { /* ignore */ } };

    const startSystem = (key: string) => { setState(createInitialState(newSeed(), key)); setArmed(null); setScreen("playing"); };
    const toSelect = () => { setScreen("select"); setState(null); setArmed(null); };
    const restart = () => { if (state) { const key = SYSTEM_ORDER.find((k) => SYSTEMS[k].name === state.system) || "homeServer"; startSystem(key); } };

    const dispatch = (card: string, target?: number) => { setState((s) => (s ? applyAction(s, { type: "playCard", card, target }) : s)); setArmed(null); };
    const endTurn = () => { setState((s) => (s ? applyAction(s, { type: "endTurn" }) : s)); setArmed(null); };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (screen !== "playing" || !state || state.outcome !== "playing" || showIntro) return;
            if (e.key === "Enter") { e.preventDefault(); endTurn(); }
            if (e.key === "Escape") setArmed(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [screen, state, showIntro]);

    if (screen === "select" || !state) {
        return (
            <>
                <SelectScreen onPick={startSystem} />
                {showIntro && <Intro onClose={closeIntro} />}
            </>
        );
    }

    const detFrac = state.detection / state.detectionMax;
    const room = state.detectionMax - state.detection;
    const targetOpts = targetableDefenses(state);
    const handCards = state.hand.map((id, i) => ({ id, i, def: CARDS[id] }));

    const onCardClick = (id: string) => {
        if (!canPlay(state, id)) return;
        if (!needsTarget(id)) { dispatch(id); return; }
        const opts = targetableDefenses(state);
        if (opts.length === 0) return;
        // Always arm targeted cards so the flow is consistent everywhere:
        // click card → its targets glow → click a defense. (No invisible auto-fire.)
        setArmed(armed === id ? null : id);
    };

    return (
        <div className="wrap">
            <div className="title">
                BREACH <span className="sub">// {state.system}</span>
                <button className="term ghost tiny" style={{ marginLeft: 14 }} onClick={toSelect}>◂ targets</button>
            </div>
            <div className="muted">turn {state.turn} · objective: exfiltrate the data before you're detected</div>
            <hr />

            <div className="meter-label">
                <span className="amber">DETECTION</span>
                <span style={{ color: meterColor(detFrac) }}>{state.detection} / {state.detectionMax}</span>
            </div>
            <div className="meter">
                <div className="fill" style={{ width: `${detFrac * 100}%`, background: meterColor(detFrac) }} />
                <div className="ticks" />
                <div className="mark" style={{ left: "25%" }} />
                <div className="mark" style={{ left: "50%" }} />
                <div className="mark" style={{ left: "80%" }} />
            </div>
            <div className="meter-marks">
                <span style={{ left: "25%", color: "#ffb000" }}>SUSPICIOUS</span>
                <span style={{ left: "50%", color: "#ff7a1a" }}>ALERTED</span>
                <span style={{ left: "80%", color: "#ff4141" }}>LOCKDOWN</span>
            </div>

            <div className="sys">
                <span>SYSTEM ALERT: <span className={"stage " + state.alert}>{state.alert}</span></span>
                <span className="intent">
                    NEXT MOVE ▸ {state.spoofTurns > 0 ? <span className="cyan">— suppressed (spoofed) —</span> : <span>{state.systemIntent ? state.systemIntent.label : "—"}</span>}
                </span>
            </div>

            {state.objectiveExposed && (
                <div className="cyan" style={{ marginTop: 8 }}>▶ OBJECTIVE EXPOSED — play <b>Payload</b> to exfiltrate and win.</div>
            )}

            <div className="layers">
                {state.layers.map((l, i) => {
                    const isCurrent = i === state.current && !l.breached;
                    return (
                        <div key={i} className={"layer" + (isCurrent ? " current" : "") + (l.breached ? " breached" : "")}>
                            <span className="lname">{l.breached ? "✓ " : isCurrent ? "▶ " : "  "}{l.name}</span>
                            <span className="defs">
                                {l.breached ? <span className="muted">BREACHED</span> : l.defenses.map((d, di) => (
                                    <DefenseChip
                                        key={di}
                                        d={d}
                                        targetable={isCurrent && !!armed && d.strength > 0}
                                        preview={isCurrent && armed && d.strength > 0 ? previewOnTarget(state, armed, di) : null}
                                        onClick={() => dispatch(armed!, di)}
                                    />
                                ))}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* what just happened — clear feedback for every play */}
            <div className="last-action">▸ {state.log[state.log.length - 1]}</div>

            {armed ? (
                <div className="amber armed-hint">▶ SELECT A TARGET DEFENSE — the ▸ tag on each shows what this card will do (Esc to cancel)</div>
            ) : (
                <div className="muted hand-legend">
                    YOUR HAND — click to play. &nbsp; <span className="amber">◈N</span> = noise added · <span className="cyan">SILENT</span> = no noise · <span className="muted">◎</span> = needs a target
                </div>
            )}

            <div className="hand">
                {handCards.map(({ id, i, def }) => {
                    const playable = canPlay(state, id);
                    const noise = projectedNoise(state, id);
                    const danger = noise >= room && noise > 0;
                    const needsT = needsTarget(id);
                    const blocked = needsT && targetOpts.length === 0;
                    return (
                        <div
                            key={i}
                            className={"card" + (playable && !blocked ? "" : " disabled") + (danger ? " danger" : "") + (armed === id ? " armed" : "")}
                            onClick={() => !blocked && onCardClick(id)}
                            title={def.text}
                        >
                            <div className="chead">
                                <span className="cname">{def.name}{needsT ? <span className="muted"> ◎</span> : null}</span>
                                <span className="noise" style={{ color: danger ? "#ff4141" : noise === 0 ? "#35e0d8" : "#ffb000" }}>{noise === 0 ? "SILENT" : "◈" + noise}</span>
                            </div>
                            <div className="kind">{def.kind}</div>
                            <div className="ctext">{def.text}</div>
                        </div>
                    );
                })}
                {handCards.length === 0 && <span className="muted">— empty hand — end the turn —</span>}
            </div>

            <div className="controls">
                <button className="term" onClick={endTurn}>End Turn ▸</button>
                <button className="term ghost" onClick={restart}>Retry</button>
                <button className="term ghost" onClick={() => setShowIntro(true)}>?</button>
                <span className="piles muted">🂠 draw {state.deck.length} · discard {state.discard.length}</span>
            </div>
            <div className="muted turn-note">
                Ending a turn <b>discards your hand and draws 5 fresh</b> (cards recycle — nothing is lost), then the system takes its telegraphed move and the trace climbs +{state.baselineCreep}.
            </div>

            <div className="log">
                {state.log.slice(-3).map((line, i) => <span className="ln" key={i}>{line}</span>)}
            </div>

            {showIntro && <Intro onClose={closeIntro} />}

            {state.outcome !== "playing" && (
                <div className={"overlay " + state.outcome}>
                    <div className="box">
                        <h2>{state.outcome === "won" ? "ACCESS :: OBJECTIVE SECURED" : "TRACE COMPLETE :: LOCKED OUT"}</h2>
                        <p className="muted">
                            {state.outcome === "won" ? "You slipped in, grabbed the data, and vanished. Clean." : state.lossReason || "The system caught you."}
                        </p>
                        <p className="muted" style={{ fontSize: 12 }}>
                            {state.layers.filter((l) => l.breached).length}/{state.layers.length} layers breached · {state.turn} turns · detection {state.detection}/{state.detectionMax}
                        </p>
                        <div style={{ marginTop: 14 }}>
                            <button className="term" onClick={restart}>Retry ▸</button>
                            <button className="term ghost" style={{ marginLeft: 10 }} onClick={toSelect}>Other Targets</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
