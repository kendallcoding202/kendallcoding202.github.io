/* ============================================================
   BREACH — terminal UI.
   App is a mode machine: campaign select → run (routes, Heat,
   deck-building, story) → breach → ending. All game logic lives
   in engine/ and run.ts; this file only renders and dispatches.
   ============================================================ */

import { useEffect, useState } from "react";
import type { BreachResult, Campaign, Defense, EventChoice, GameState, RunNode, RunState } from "../engine/types.ts";
import { CARDS } from "../engine/cards.ts";
import { SYSTEMS } from "../engine/systems.ts";
import { CAMPAIGNS, CAMPAIGN_ORDER, REWARD_POOL } from "../engine/campaigns.ts";
import { createInitialState, applyAction, canPlay, projectedNoise, currentLayer, needsTarget, targetableDefenses, previewOnTarget } from "../engine/engine.ts";
import { createRun, currentOptions, isFinale, resolveBreach, resolveEvent, resolveSafehouse, addCard, removeCard, getCampaign } from "../engine/run.ts";

const newSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0;
const meterColor = (f: number) => (f < 0.3 ? "#4af626" : f < 0.6 ? "#ffb000" : f < 0.85 ? "#ff7a1a" : "#ff4141");
function pick3(pool: string[]): string[] {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, 3);
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
        <span className={"dchip" + (targetable ? " targetable" : "") + (down ? " down" : "")} onClick={targetable ? onClick : undefined}>
            {down ? "✓ down" : d.typeRevealed ? <b className="cyan">{d.type}</b> : <span className="muted">???</span>}
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
        <div className={"card mini" + (onClick ? " playable" : "") + (dim ? " disabled" : "")} onClick={onClick} title={def.text}>
            <div className="chead">
                <span className="cname">{def.name}{def.needsTarget ? <span className="muted"> ◎</span> : null}</span>
                <span className="noise" style={{ color: def.noise === 0 ? "#35e0d8" : "#ffb000" }}>{def.noise === 0 ? "SILENT" : "◈" + def.noise}</span>
            </div>
            <div className="kind">{def.kind}</div>
            <div className="ctext">{def.text}</div>
        </div>
    );
}

/* ============================================================
   BREACH SCREEN (one job)
   ============================================================ */
function Breach({ systemKey, systemTitle, deck, onComplete }: { systemKey: string; systemTitle: string; deck: string[]; onComplete: (r: BreachResult) => void }) {
    const [state, setState] = useState<GameState>(() => createInitialState(newSeed(), systemKey, deck));
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
        setArmed(armed === id ? null : id);
    };

    return (
        <div className="wrap">
            <div className="title">
                BREACH <span className="sub">// {systemTitle}</span>
                <button className="term ghost tiny" style={{ marginLeft: 14 }} onClick={() => onComplete({ won: false, detection: state.detectionMax, detectionMax: state.detectionMax })}>abort job</button>
            </div>
            <div className="muted">turn {state.turn} · target: {state.system} · clear the objective before you're detected</div>
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
                <span className="budget-turn">◈ NOISE THIS TURN: <b>{state.turnNoise}</b></span>
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
                        <div key={i} className={"card" + (playable && !blocked ? "" : " disabled") + (danger ? " danger" : "") + (armed === id ? " armed" : "")} onClick={() => !blocked && onCardClick(id)} title={def.text}>
                            <div className="chead">
                                <span className="cname">{def.name}{needsT ? <span className="muted"> ◎</span> : null}</span>
                                <span className="noise" style={{ color: danger ? "#ff4141" : noise === 0 ? "#35e0d8" : "#ffb000" }}>{noise === 0 ? "SILENT" : "◈" + noise}</span>
                            </div>
                            <div className="kind">{def.kind}</div>
                            <div className="ctext">{def.text}</div>
                        </div>
                    );
                })}
                {state.hand.length === 0 && <span className="muted">— empty hand — end the turn —</span>}
            </div>

            <div className="controls">
                <button className="term" onClick={endTurn}>End Turn ▸</button>
                <button className="term ghost" onClick={() => setShowIntro(true)}>?</button>
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
function CampaignSelect({ onPick }: { onPick: (id: string) => void }) {
    return (
        <div className="wrap">
            <div className="title">BREACH</div>
            <p className="muted">A hacking roguelike. Choose a storyline — a chain of breaches with branching routes, a rising trace, and a deck you build as you go.</p>
            <hr />
            <div className="systems">
                {CAMPAIGN_ORDER.map((id) => {
                    const c = CAMPAIGNS[id];
                    return (
                        <div className="syscard" key={id} onClick={() => onPick(id)}>
                            <div className="sysname">{c.name}</div>
                            <div className="cyan" style={{ fontSize: 12, margin: "2px 0 6px" }}>{c.tagline}</div>
                            <div className="sysflavor">{c.premise}</div>
                            <div className="sysmeta muted">Handler: {c.handler} · {c.steps.length + 1} jobs</div>
                            <button className="term">Begin ▸</button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ============================================================
   RUN VIEW (between jobs: routes, story, Heat, deck)
   ============================================================ */
function RunView({ run, campaign, onLaunchBreach, onRun, onOpenDeck }: {
    run: RunState; campaign: Campaign; onLaunchBreach: (n: RunNode) => void; onRun: (r: RunState) => void; onOpenDeck: () => void;
}) {
    const [activeEvent, setActiveEvent] = useState<RunNode | null>(null);
    const [removing, setRemoving] = useState<EventChoice | null>(null);
    const options = currentOptions(run);
    const finale = isFinale(run);
    const heatFrac = run.heat / run.heatMax;

    const pickChoice = (choice: EventChoice) => {
        if (choice.removeCard) { setRemoving(choice); return; }
        onRun(resolveEvent(run, choice)); setActiveEvent(null);
    };
    const doRemove = (cardId: string) => {
        if (!removing) return;
        onRun(resolveEvent(removeCard(run, cardId), removing));
        setRemoving(null); setActiveEvent(null);
    };

    const clickNode = (n: RunNode) => {
        if (n.type === "breach") onLaunchBreach(n);
        else if (n.type === "safehouse") onRun(resolveSafehouse(run, n));
        else setActiveEvent(n);
    };

    return (
        <div className="wrap">
            <div className="title">{campaign.name} <span className="sub">// {finale ? "the final job" : `job ${run.step + 1} of ${campaign.steps.length + 1}`}</span></div>
            <div className="run-stats">
                <span>💾 <b className="gold">{run.credits}</b>cr</span>
                <span className="deck-link" onClick={onOpenDeck}>🃏 deck: <b>{run.deck.length}</b> ▸</span>
            </div>

            {/* run-level Heat (the trace hunting YOU) */}
            <div className="meter-label"><span className="red">TRACE ON YOU (HEAT)</span><span style={{ color: meterColor(heatFrac) }}>{run.heat} / {run.heatMax}</span></div>
            <div className="meter"><div className="fill" style={{ width: `${heatFrac * 100}%`, background: meterColor(heatFrac) }} /></div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Loud jobs and blown breaches raise the trace. Max it out and the run is over — so play quiet, and lie low when you can.</div>

            <hr />
            <div className="story">
                {run.story.slice(-4).map((line, i) => <p key={i} className="story-line">{line}</p>)}
            </div>

            <h3 className="amber" style={{ margin: "10px 0 4px" }}>{finale ? "▶ THE FINAL JOB" : "▶ CHOOSE YOUR NEXT MOVE"}</h3>
            <div className="routes">
                {options.map((n) => (
                    <div key={n.id} className={"route route-" + n.type} onClick={() => clickNode(n)}>
                        <div className="route-head">
                            <span className="route-tag">{n.type === "breach" ? "◈ BREACH" : n.type === "safehouse" ? "☂ LIE LOW" : "❋ EVENT"}</span>
                            {n.type === "breach" && n.systemKey && <span className="route-diff">{"◆".repeat(SYSTEMS[n.systemKey].difficulty)}<span className="off">{"◇".repeat(5 - SYSTEMS[n.systemKey].difficulty)}</span></span>}
                        </div>
                        <div className="route-title">{n.title}</div>
                        <div className="route-blurb">{n.blurb}</div>
                        {n.type === "breach" && <div className="route-foot muted">reward: {n.reward || 20}cr · target: {SYSTEMS[n.systemKey || "homeServer"].name}</div>}
                        {n.type === "safehouse" && <div className="route-foot muted">−{n.heatRelief || 20} heat · no pay</div>}
                    </div>
                ))}
            </div>

            {/* event overlay */}
            {activeEvent && !removing && (
                <div className="overlay">
                    <div className="box" style={{ textAlign: "left", maxWidth: 560 }}>
                        <h2 className="cyan">{activeEvent.title}</h2>
                        <p className="brief">{activeEvent.blurb}</p>
                        <div className="event-choices">
                            {(activeEvent.choices || []).map((ch, i) => {
                                const cant = ch.requiresCredits != null && run.credits < ch.requiresCredits;
                                return (
                                    <button key={i} className={"term event-choice" + (cant ? " disabled" : "")} disabled={cant} onClick={() => pickChoice(ch)}>
                                        {ch.label}{cant ? " (not enough credits)" : ""}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

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
    return (
        <div className="wrap">
            <div className="overlay">
                <div className={"box " + (won ? "won" : "lost")} style={{ textAlign: "left", maxWidth: 620 }}>
                    <h2 className={won ? "cyan" : "red"} style={{ textAlign: "center" }}>{won ? "CONTRACT COMPLETE" : "BUSTED"}</h2>
                    <p className="brief">{won ? campaign.winText : campaign.bustedText}</p>
                    <p className="muted" style={{ fontSize: 12 }}>Campaign: {campaign.name} · jobs pulled: {run.jobsDone} · final heat: {run.heat}/{run.heatMax} · deck: {run.deck.length} cards</p>
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
    const [activeNode, setActiveNode] = useState<RunNode | null>(null);
    const [reward, setReward] = useState<string[] | null>(null);
    const [showDeck, setShowDeck] = useState(false);

    const campaign = run ? getCampaign(run.campaignId) : null;

    const startCampaign = (id: string) => { setRun(createRun(id)); setActiveNode(null); setReward(null); setMode("run"); };
    const launchBreach = (n: RunNode) => { setActiveNode(n); setMode("breach"); };

    const onBreachComplete = (result: BreachResult) => {
        if (!run || !activeNode) return;
        const newRun = resolveBreach(run, activeNode, result);
        setRun(newRun);
        setActiveNode(null);
        if (newRun.outcome !== "running") { setMode("ending"); return; }
        setMode("run");
        if (result.won) setReward(pick3(REWARD_POOL)); // offer a card after a successful job
    };
    const onRun = (r: RunState) => { setRun(r); if (r.outcome !== "running") setMode("ending"); };
    const takeReward = (id: string | null) => { if (id && run) setRun(addCard(run, id)); setReward(null); };

    if (mode === "campaign" || !run || !campaign) return <CampaignSelect onPick={startCampaign} />;

    if (mode === "breach" && activeNode) {
        return <Breach systemKey={activeNode.systemKey || "homeServer"} systemTitle={activeNode.title} deck={run.deck} onComplete={onBreachComplete} />;
    }

    if (mode === "ending") return <Ending run={run} campaign={campaign} onRestart={() => { setMode("campaign"); setRun(null); }} />;

    // run mode
    return (
        <>
            <RunView run={run} campaign={campaign} onLaunchBreach={launchBreach} onRun={onRun} onOpenDeck={() => setShowDeck(true)} />
            {reward && (
                <div className="overlay">
                    <div className="box" style={{ maxWidth: 620 }}>
                        <h2 className="cyan">JOB PAID — pick up a new tool</h2>
                        <div className="card-choices">{reward.map((id, i) => <CardMini key={i} id={id} onClick={() => takeReward(id)} />)}</div>
                        <button className="term ghost" onClick={() => takeReward(null)}>Skip — keep the deck lean</button>
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
        </>
    );
}
