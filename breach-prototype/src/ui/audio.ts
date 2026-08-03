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

function noiseBurst(dur: number, gain: number, delay = 0) {
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
    src.start(c.currentTime + delay);
}

type SfxName = "card" | "select" | "hit" | "breach" | "turn" | "alert" | "win" | "fail" | "reward" | "transmission" | "cascade" | "alarm"
    | "castExploit" | "castRecon" | "castStealth" | "castUtility" | "castWorm"
    | "stingWin" | "stingCaught" | "stingLockout" | "confront";

const SFX: Record<SfxName, () => void> = {
    card: () => tone({ freq: 430, dur: 0.05, type: "square", gain: 0.07 }),
    select: () => tone({ freq: 680, dur: 0.03, type: "square", gain: 0.05 }),
    hit: () => tone({ freq: 300, dur: 0.09, type: "sawtooth", gain: 0.1, sweepTo: 110 }),
    // the breach BOOM — matches the shockwave: blip pair + a deep chest-thump + debris hiss
    breach: () => {
        tone({ freq: 440, dur: 0.08, type: "square", gain: 0.09 });
        tone({ freq: 660, dur: 0.13, type: "square", gain: 0.09, delay: 0.075 });
        tone({ freq: 82, dur: 0.4, type: "sine", gain: 0.16, sweepTo: 36 });
        noiseBurst(0.14, 0.04, 0.02);
    },
    turn: () => tone({ freq: 200, dur: 0.07, type: "triangle", gain: 0.07 }),
    alert: () => { tone({ freq: 880, dur: 0.11, type: "square", gain: 0.08, sweepTo: 620 }); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.15, type: "square", gain: 0.09, delay: i * 0.1 })),
    fail: () => tone({ freq: 240, dur: 0.5, type: "sawtooth", gain: 0.11, sweepTo: 55 }),
    reward: () => [660, 990].forEach((f, i) => tone({ freq: f, dur: 0.13, type: "triangle", gain: 0.08, delay: i * 0.09 })),
    transmission: () => { noiseBurst(0.16, 0.05); tone({ freq: 130, dur: 0.22, type: "sawtooth", gain: 0.06 }); tone({ freq: 90, dur: 0.22, type: "square", gain: 0.05, delay: 0.05 }); },
    // SYSTEM CASCADE: a bright ascending surge — the "engine coming online" sting
    cascade: () => { [392, 587, 784, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.11, type: "square", gain: 0.075, delay: i * 0.045 })); tone({ freq: 196, dur: 0.3, type: "sawtooth", gain: 0.05 }); },
    // ALARM: an urgent descending klaxon just before the system strikes back
    alarm: () => { tone({ freq: 540, dur: 0.14, type: "sawtooth", gain: 0.1, sweepTo: 400 }); tone({ freq: 540, dur: 0.14, type: "sawtooth", gain: 0.1, sweepTo: 400, delay: 0.17 }); },

    /* --- CAST SOUNDS: each card kind has its own voice at the moment you play it,
       matched to its tracer — the click always answers back in character. --- */
    // exploit: a hard zap that lands with a thunk
    castExploit: () => { tone({ freq: 620, dur: 0.07, type: "square", gain: 0.09, sweepTo: 220 }); tone({ freq: 150, dur: 0.09, type: "sawtooth", gain: 0.07, sweepTo: 70, delay: 0.055 }); },
    // recon: a sonar ping rising away, with a faint echo
    castRecon: () => { tone({ freq: 980, dur: 0.09, type: "sine", gain: 0.07, sweepTo: 1480 }); tone({ freq: 1480, dur: 0.12, type: "sine", gain: 0.03, delay: 0.13 }); },
    // stealth: barely there — a hush of static and a breath sliding down
    castStealth: () => { noiseBurst(0.09, 0.016); tone({ freq: 330, dur: 0.16, type: "triangle", gain: 0.045, sweepTo: 205 }); },
    // utility: a mechanical click-clack, the toolkit doing its job
    castUtility: () => { tone({ freq: 380, dur: 0.04, type: "square", gain: 0.07 }); tone({ freq: 520, dur: 0.05, type: "square", gain: 0.06, delay: 0.055 }); },
    // worm: a wet, detuned burrow chewing downward
    castWorm: () => { tone({ freq: 190, dur: 0.16, type: "sawtooth", gain: 0.08, sweepTo: 62 }); tone({ freq: 245, dur: 0.14, type: "sawtooth", gain: 0.05, sweepTo: 82, delay: 0.04 }); },

    /* --- FINALE STINGS: score the held cinematic, one per ending. --- */
    // PAYLOAD SECURED — a dark-cyber triumph: minor world blooming into A major,
    // sparkle notes climbing over the pad while a shimmer of static settles
    stingWin: () => {
        [110, 138.59, 164.81, 220].forEach((f) => tone({ freq: f, dur: 1.7, type: "sawtooth", gain: 0.045 }));
        [440, 554.37, 659.25, 880, 1108.73].forEach((f, i) => tone({ freq: f, dur: 0.42, type: "triangle", gain: 0.06, delay: 0.28 + i * 0.15 }));
        noiseBurst(0.5, 0.012, 0.12);
    },
    // CAUGHT IN THE ACT — triple klaxon, then the whole signal dives and slams
    stingCaught: () => {
        [0, 0.2, 0.4].forEach((d) => tone({ freq: 600, dur: 0.16, type: "sawtooth", gain: 0.11, sweepTo: 430, delay: d }));
        tone({ freq: 320, dur: 1.2, type: "sawtooth", gain: 0.1, sweepTo: 42, delay: 0.55 });
        tone({ freq: 64, dur: 0.5, type: "sine", gain: 0.16, sweepTo: 30, delay: 0.6 });
        noiseBurst(0.3, 0.05, 0.58);
    },
    // THE CONFRONTATION — the rogue fills the screen: a deep dual-saw swell that
    // beats against itself, with a static crack as the face materialises
    confront: () => {
        tone({ freq: 55, dur: 2.2, type: "sawtooth", gain: 0.11 });
        tone({ freq: 58, dur: 2.2, type: "sawtooth", gain: 0.09 });
        tone({ freq: 220, dur: 1.4, type: "sine", gain: 0.045, sweepTo: 110, delay: 0.15 });
        noiseBurst(0.22, 0.05);
    },
    // TRACE COMPLETE — quieter defeat: two beating low tones sinking away
    stingLockout: () => {
        tone({ freq: 220, dur: 1.0, type: "sawtooth", gain: 0.09, sweepTo: 88 });
        tone({ freq: 110, dur: 1.5, type: "sine", gain: 0.11, sweepTo: 52, delay: 0.15 });
        tone({ freq: 261.63, dur: 0.4, type: "triangle", gain: 0.05, delay: 0.3 });
        tone({ freq: 233.08, dur: 0.7, type: "triangle", gain: 0.05, delay: 0.75 });
    },
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
   A continuous dark PAD (a low minor chord) + a slow heartbeat that
   tighten as tension rises (Heat on the map, detection inside a breach).
   All synthesized, no assets.

   IMPORTANT: the fundamentals sit at ~110-165 Hz with harmonic-rich
   sawtooths and an open filter, so the tone actually carries on tiny
   phone/laptop speakers. (An earlier ~46 Hz sub-bass version was
   inaudible on phones — those speakers roll off hard below ~200 Hz.)
   ============================================================ */
interface Bed {
    master: GainNode; filt: BiquadFilterNode; padGain: GainNode; melodyGain: GainNode;
    voices: OscillatorNode[];
    heart: OscillatorNode; heartGain: GainNode;
    tension: OscillatorNode; tensionGain: GainNode;
}
let bed: Bed | null = null;
let bedTimer: number | null = null;
let bedStep = 0;
let chordIdx = 0;
let bedTension = 0; // last-applied tension (the scheduler reads this to shape the music)

// A slow, dark chord progression (A-minor: i - VI - III - VII) as [root, 3rd, 5th]
// frequencies. The pad GLIDES between these so the harmony keeps moving instead of
// droning on one chord forever. Low fundamentals, but sawtooth harmonics carry.
const CHORDS: number[][] = [
    [110.00, 130.81, 164.81], // Am  (A2 C3 E3)
    [87.31, 130.81, 174.61],  // F   (F2 C3 F3)
    [130.81, 164.81, 196.00], // C   (C3 E3 G3)
    [98.00, 146.83, 196.00],  // G   (G2 D3 G3)
];
// Melody notes: A-minor pentatonic up high, so any note sits consonant over any chord.
const MELODY = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

function startBed() {
    const c = ac(); if (!c || bed) return;
    const master = c.createGain(); master.gain.value = 0.0001; master.connect(c.destination);
    const filt = c.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 700; filt.Q.value = 0.7; filt.connect(master);
    const padGain = c.createGain(); padGain.gain.value = 0.32; padGain.connect(filt);
    // the pad: three sawtooth voices holding the current chord, gently detuned for warmth
    chordIdx = 0; bedStep = 0;
    const detune = [0, -5, 6];
    const voices = CHORDS[0].map((hz, i) => {
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = detune[i];
        o.connect(padGain); o.start(); return o;
    });
    // sparse melody layer — soft notes plucked over the pad, routed through the filter
    const melodyGain = c.createGain(); melodyGain.gain.value = 0.5; melodyGain.connect(filt);
    // the heartbeat: a sub-audio LFO adding a pulsing swell to the master gain
    const heartGain = c.createGain(); heartGain.gain.value = 0.0; heartGain.connect(master.gain);
    const heart = c.createOscillator(); heart.type = "sine"; heart.frequency.value = 0.85; heart.connect(heartGain); heart.start();
    // the tension layer: an uneasy minor-6th tone (F3) that surfaces when things get hot
    const tensionGain = c.createGain(); tensionGain.gain.value = 0.0; tensionGain.connect(filt);
    const tension = c.createOscillator(); tension.type = "sawtooth"; tension.frequency.value = 174.6; tension.connect(tensionGain); tension.start();
    bed = { master, filt, padGain, melodyGain, voices, heart, heartGain, tension, tensionGain };
    applyBed(0);
    // drive the evolving progression + melody on a slow beat (~1.9s)
    bedTimer = window.setInterval(bedTick, 1900);
}

/** Play one soft melody note (through the filter, for cohesion with the pad). */
function playBedNote(freq: number) {
    const c = ac(); if (!c || !bed) return;
    const t = c.currentTime;
    const g = c.createGain(); g.gain.value = 0.0001; g.connect(bed.melodyGain);
    const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = freq; o.connect(g);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.08); // gentle attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1); // slow decay
    o.start(t); o.stop(t + 1.2);
}

/** One beat of the ambient bed: advance the chord every 4 beats, sprinkle melody. */
function bedTick() {
    const c = ac(); if (!c || !bed) return;
    bedStep++;
    if (bedStep % 4 === 0) {
        // move to the next chord — glide each pad voice for a smooth harmony change
        chordIdx = (chordIdx + 1) % CHORDS.length;
        const t = c.currentTime;
        bed.voices.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[chordIdx][i], t, 0.5));
    }
    // melody density rises with tension: gentle when calm, busier as the trace climbs
    const chance = 0.42 + 0.45 * bedTension;
    if (Math.random() < chance) {
        // higher, brighter picks when things are hot
        const hi = Math.random() < 0.3 + 0.4 * bedTension;
        const pool = hi ? MELODY.slice(3) : MELODY.slice(0, 5);
        playBedNote(pool[Math.floor(Math.random() * pool.length)]);
    }
}

function applyBed(f: number) {
    const c = ac(); if (!c || !bed) return;
    bedTension = Math.max(0, Math.min(1, f));
    const t = c.currentTime, k = 0.5; // smooth glide toward each target
    bed.master.gain.setTargetAtTime(0.085 + 0.075 * f, t, k);    // audible floor, swells with tension
    bed.filt.frequency.setTargetAtTime(700 + 1700 * f, t, k);    // brightens/harshens as it heats up
    bed.heart.frequency.setTargetAtTime(0.85 + 1.7 * f, t, k);   // pulse quickens as it closes in
    bed.heartGain.gain.setTargetAtTime(0.006 + 0.03 * f, t, k);  // and swells deeper
    const tens = f < 0.4 ? 0 : (f - 0.4) / 0.6;                  // the dread layer fades in past 40%
    bed.tensionGain.gain.setTargetAtTime(0.06 * tens * tens, t, k);
}

function stopBed() {
    const b = bed; if (!b) return; bed = null;
    if (bedTimer !== null) { window.clearInterval(bedTimer); bedTimer = null; }
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    b.master.gain.setTargetAtTime(0.0001, t, 0.35);
    const stopAt = t + 1.4;
    [...b.voices, b.heart, b.tension].forEach((o) => { try { o.stop(stopAt); } catch { /* ignore */ } });
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
