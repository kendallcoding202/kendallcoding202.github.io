/* ============================================================
   BREACH — synthesized terminal SFX (Web Audio API)
   No audio files: every sound is generated at runtime, so it stays
   self-contained and CSP-safe (works in the hosted beta). Short,
   low-volume blips that fit the terminal aesthetic.
   ============================================================ */

let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem("breach_muted") === "1"; } catch { /* ignore */ }

function ac(): AudioContext | null {
    if (muted) return null;
    if (!ctx) {
        try {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            ctx = new AC();
        } catch { return null; }
    }
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => { /* ignore */ });
    return ctx;
}

interface ToneOpts { freq: number; dur: number; type?: OscillatorType; gain?: number; sweepTo?: number; delay?: number; }

function tone(o: ToneOpts) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t0 + o.dur);
    const peak = o.gain ?? 0.12;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
}

function noiseBurst(dur: number, gain: number) {
    const c = ac();
    if (!c) return;
    const frames = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    // deterministic-ish pseudo static (no Math.random dependency needed)
    let seed = 1234567;
    for (let i = 0; i < frames; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = (seed / 0x3fffffff - 1) * (1 - i / frames); }
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(g);
    g.connect(c.destination);
    src.start();
}

type SfxName = "card" | "select" | "hit" | "breach" | "turn" | "alert" | "win" | "fail" | "reward" | "transmission" | "cascade";

const SFX: Record<SfxName, () => void> = {
    card: () => tone({ freq: 430, dur: 0.05, type: "square", gain: 0.07 }),
    select: () => tone({ freq: 680, dur: 0.03, type: "square", gain: 0.05 }),
    hit: () => tone({ freq: 300, dur: 0.09, type: "sawtooth", gain: 0.1, sweepTo: 110 }),
    breach: () => { tone({ freq: 440, dur: 0.08, type: "square", gain: 0.09 }); tone({ freq: 660, dur: 0.13, type: "square", gain: 0.09, delay: 0.075 }); },
    turn: () => tone({ freq: 200, dur: 0.07, type: "triangle", gain: 0.07 }),
    alert: () => { tone({ freq: 880, dur: 0.11, type: "square", gain: 0.08, sweepTo: 620 }); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.15, type: "square", gain: 0.09, delay: i * 0.1 })),
    fail: () => tone({ freq: 240, dur: 0.5, type: "sawtooth", gain: 0.11, sweepTo: 55 }),
    reward: () => [660, 990].forEach((f, i) => tone({ freq: f, dur: 0.13, type: "triangle", gain: 0.08, delay: i * 0.09 })),
    transmission: () => { noiseBurst(0.16, 0.05); tone({ freq: 130, dur: 0.22, type: "sawtooth", gain: 0.06 }); tone({ freq: 90, dur: 0.22, type: "square", gain: 0.05, delay: 0.05 }); },
    // SYSTEM CASCADE: a bright ascending surge — the "engine coming online" sting
    cascade: () => { [392, 587, 784, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.11, type: "square", gain: 0.075, delay: i * 0.045 })); tone({ freq: 196, dur: 0.3, type: "sawtooth", gain: 0.05 }); },
};

// Mobile browsers keep the audio engine suspended until a user gesture, and
// iOS only unlocks it if a sound is armed INSIDE that gesture. Prime it on the
// very first tap/key anywhere so phone players actually hear the SFX afterward.
function unlockAudio() {
    if (muted) return;
    const c = ac();
    if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => { /* ignore */ });
    try {
        const g = c.createGain(); g.gain.value = 0.00001;
        const o = c.createOscillator(); o.connect(g); g.connect(c.destination);
        o.start(); o.stop(c.currentTime + 0.02);
    } catch { /* ignore */ }
}
if (typeof window !== "undefined") {
    const onFirst = () => {
        unlockAudio();
        window.removeEventListener("pointerdown", onFirst);
        window.removeEventListener("touchend", onFirst);
        window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst);
    window.addEventListener("touchend", onFirst);
    window.addEventListener("keydown", onFirst);
}

/* ============================================================
   ADAPTIVE AMBIENT BED — the "sound of dread"
   A continuous low drone + a slow heartbeat that tighten as tension
   rises (Heat on the map, detection inside a breach). All synthesized,
   no assets. Silence between actions read as sterile; this gives the
   terminal a pulse you feel in your chest as the trace closes in.
   ============================================================ */
interface Bed {
    master: GainNode; filt: BiquadFilterNode;
    sub1: OscillatorNode; sub2: OscillatorNode;
    heart: OscillatorNode; heartGain: GainNode;
    tension: OscillatorNode; tensionGain: GainNode;
}
let bed: Bed | null = null;

function startBed() {
    const c = ac(); if (!c || bed) return;
    const master = c.createGain(); master.gain.value = 0.0001; master.connect(c.destination);
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 200; filt.Q.value = 5; filt.connect(master);
    // the drone: two near-detuned low oscillators that beat slowly against each other
    const sub1 = c.createOscillator(); sub1.type = "triangle"; sub1.frequency.value = 46; sub1.connect(filt);
    const sub2 = c.createOscillator(); sub2.type = "sine"; sub2.frequency.value = 46.6; sub2.connect(filt);
    // the heartbeat: a sub-audio LFO adding a pulsing swell to the master gain
    const heartGain = c.createGain(); heartGain.gain.value = 0.0; heartGain.connect(master.gain);
    const heart = c.createOscillator(); heart.type = "sine"; heart.frequency.value = 0.85; heart.connect(heartGain);
    // the tension layer: an uneasy higher tone that only surfaces when things get hot
    const tensionGain = c.createGain(); tensionGain.gain.value = 0.0; tensionGain.connect(filt);
    const tension = c.createOscillator(); tension.type = "sawtooth"; tension.frequency.value = 98; tension.connect(tensionGain);
    sub1.start(); sub2.start(); heart.start(); tension.start();
    bed = { master, filt, sub1, sub2, heart, heartGain, tension, tensionGain };
    applyBed(0);
}

function applyBed(f: number) {
    const c = ac(); if (!c || !bed) return;
    const t = c.currentTime, k = 0.5; // smooth glide toward each target
    bed.master.gain.setTargetAtTime(0.03 + 0.06 * f, t, k);
    bed.filt.frequency.setTargetAtTime(180 + 1100 * f, t, k);
    bed.heart.frequency.setTargetAtTime(0.85 + 1.7 * f, t, k);   // pulse quickens as it closes in
    bed.heartGain.gain.setTargetAtTime(0.004 + 0.02 * f, t, k);  // and swells deeper
    const tens = f < 0.4 ? 0 : (f - 0.4) / 0.6;                  // the dread layer fades in past 40%
    bed.tensionGain.gain.setTargetAtTime(0.05 * tens * tens, t, k);
    bed.tension.frequency.setTargetAtTime(96 + 34 * tens, t, k);
}

function stopBed() {
    const b = bed; if (!b) return; bed = null;
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    b.master.gain.setTargetAtTime(0.0001, t, 0.35);
    const stopAt = t + 1.4;
    [b.sub1, b.sub2, b.heart, b.tension].forEach((o) => { try { o.stop(stopAt); } catch { /* ignore */ } });
}

export const sfx = {
    play(name: SfxName) {
        if (muted) return;
        try { SFX[name](); } catch { /* ignore */ }
    },
    /** Drive the ambient bed. `f` is 0..1 tension; starts the bed on first call. */
    setTension(f: number) {
        if (muted) { stopBed(); return; }
        const c = ac(); if (!c) return;
        if (!bed) startBed();
        applyBed(Math.max(0, Math.min(1, f)));
    },
    /** Fade out and tear down the ambient bed (menus / run over). */
    stopBed() { stopBed(); },
    toggleMute(): boolean {
        muted = !muted;
        try { localStorage.setItem("breach_muted", muted ? "1" : "0"); } catch { /* ignore */ }
        if (muted) stopBed(); // silence the ambient bed immediately
        else ac(); // unlock/resume on enable
        return muted;
    },
    isMuted(): boolean { return muted; },
};
