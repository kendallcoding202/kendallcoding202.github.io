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

type SfxName = "card" | "select" | "hit" | "breach" | "turn" | "alert" | "win" | "fail" | "reward" | "transmission";

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
};

export const sfx = {
    play(name: SfxName) {
        if (muted) return;
        try { SFX[name](); } catch { /* ignore */ }
    },
    toggleMute(): boolean {
        muted = !muted;
        try { localStorage.setItem("breach_muted", muted ? "1" : "0"); } catch { /* ignore */ }
        if (!muted) ac(); // unlock/resume on enable
        return muted;
    },
    isMuted(): boolean { return muted; },
};
