// All the game's sound. Every effect and both tunes are made here, as they
// are needed, with the browser's own Web Audio: there are no sound files to
// ship or license, and nothing is fetched. This is the one file that knows
// about audio; the screens only say what happened (`play('hit')`) and where
// you are (`setScene('fight')`).
//
// A browser makes no sound until the player has touched the page, so nothing
// is heard before the first tap (`unlockSound`). On an iPhone the ring/silent
// switch silences this kind of sound too; that is the phone's doing.

// ---------------------------------------------------------------- the tunes
//
// Notes are counted in semitones from the tune's home note. A bar has a chord
// (three notes, low to high) and a melody: [when in the bar, which note, how
// long], in beats.

/** Walking the lane at night: a slow lullaby in three, as if from a music box. */
const LULLABY = {
  home: 293.66, // D above middle C
  beat: 0.62, // seconds
  beats: 3,
  bars: [
    { chord: [0, 4, 7], notes: [[0, 16, 2], [2, 12, 1]] },
    { chord: [-3, 0, 4], notes: [[0, 9, 2], [2, 12, 1]] },
    { chord: [-7, -3, 0], notes: [[0, 9, 1], [1, 7, 1], [2, 5, 1]] },
    { chord: [-5, -1, 2], notes: [[0, 7, 3]] },
    { chord: [0, 4, 7], notes: [[0, 16, 2], [2, 19, 1]] },
    { chord: [-8, -5, -1], notes: [[0, 19, 1], [1, 16, 1], [2, 11, 1]] },
    { chord: [-7, -3, 0], notes: [[0, 12, 2], [2, 9, 1]] },
    { chord: [-5, -1, 2], notes: [[0, 14, 3]] },
    { chord: [-7, -3, 0], notes: [[0, 17, 2], [2, 16, 1]] },
    { chord: [0, 4, 7], notes: [[0, 16, 1], [1, 12, 1], [2, 7, 1]] },
    { chord: [-10, -7, -3], notes: [[0, 14, 2], [2, 17, 1]] },
    { chord: [-5, -1, 2], notes: [[0, 14, 1], [1, 11, 1], [2, 7, 1]] },
    { chord: [-7, -3, 0], notes: [[0, 9, 2], [2, 12, 1]] },
    { chord: [0, 4, 7], notes: [[0, 16, 2], [2, 12, 1]] },
    { chord: [-5, -1, 2], notes: [[0, 14, 1], [1, 11, 1], [2, 14, 1]] },
    { chord: [0, 4, 7], notes: [[0, 12, 3]] },
  ],
};

/** A fight: quicker, in four, plucked, a little cheeky. Nobody is in real danger. */
const SCUFFLE = {
  home: 246.94, // B below middle C
  beat: 0.44,
  beats: 4,
  bars: [
    { chord: [0, 3, 7], notes: [[0, 12, 0.5], [0.5, 14, 0.5], [1, 15, 1], [2, 12, 1], [3, 10, 1]] },
    { chord: [-4, 0, 3], notes: [[0, 15, 1], [1, 12, 0.5], [1.5, 10, 0.5], [2, 8, 2]] },
    { chord: [3, 7, 10], notes: [[0, 10, 0.5], [0.5, 12, 0.5], [1, 15, 1], [2, 19, 1], [3, 15, 1]] },
    { chord: [-2, 2, 5], notes: [[0, 17, 1], [1, 14, 1], [2, 10, 2]] },
    { chord: [0, 3, 7], notes: [[0, 12, 0.5], [0.5, 14, 0.5], [1, 15, 1], [2, 19, 1], [3, 22, 1]] },
    { chord: [-4, 0, 3], notes: [[0, 20, 1], [1, 15, 0.5], [1.5, 12, 0.5], [2, 15, 2]] },
    { chord: [3, 7, 10], notes: [[0, 19, 1], [1, 15, 1], [2, 14, 0.5], [2.5, 12, 0.5], [3, 10, 1]] },
    { chord: [-5, -1, 2], notes: [[0, 14, 1], [1, 11, 1], [2, 7, 2]] },
  ],
};

/**
 * Where you are, as far as the music goes: which tune, how fast and how high. A ringleader gets
 * the fight tune lower and a touch quicker. 'quiet' is no music at all.
 */
export const SCENES = {
  quiet: null,
  world: { tune: LULLABY, voice: 'box', speed: 1, shift: 0, loud: 1 },
  fight: { tune: SCUFFLE, voice: 'pluck', speed: 1, shift: 0, loud: 0.9 },
  boss: { tune: SCUFFLE, voice: 'pluck', speed: 1.12, shift: -3, loud: 1 },
};
export const TUNES = { LULLABY, SCUFFLE };

// ---------------------------------------------------------------- the effects
//
// Each is a few shaped tones or a puff of filtered noise. `kit` is the handful of ways to make a
// noise (see `kitFor`), `with_` whatever the caller said about this particular one.
const VOICES = { maribel: 587, ines: 392, dov: 698, spick: 233 };

export const SOUNDS = {
  // Getting about
  tap: (kit) => kit.tone({ freq: 620, to: 780, dur: 0.045, type: 'triangle', vol: 0.08 }),
  step: (kit, with_) => kit.noise({ dur: 0.06, vol: with_.hard ? 0.11 : 0.08, freq: with_.hard ? 1700 : 620, q: 0.7 }),
  nope: (kit) => kit.tone({ freq: 196, to: 147, dur: 0.12, type: 'square', vol: 0.05 }),
  gate: (kit) => { kit.tone({ freq: 170, to: 250, dur: 0.2, type: 'sawtooth', vol: 0.03 }); kit.bell(784, { delay: 0.14, vol: 0.09 }); kit.bell(1047, { delay: 0.26, vol: 0.08 }); },
  goal: (kit) => { kit.bell(880, { vol: 0.08 }); kit.bell(1175, { delay: 0.12, vol: 0.08 }); },
  rest: (kit) => { [784, 659, 523].forEach((freq, i) => kit.bell(freq, { delay: i * 0.22, vol: 0.09, dur: 1.2 })); kit.tone({ freq: 131, dur: 1.3, type: 'sine', vol: 0.07, delay: 0.44, attack: 0.08 }); },
  // People
  ring: (kit) => { for (let burst = 0; burst < 2; burst++) for (let i = 0; i < 9; i++) kit.tone({ freq: i % 2 ? 1245 : 1568, dur: 0.05, type: 'sine', vol: 0.085, delay: burst * 0.75 + i * 0.055 }); },
  talk: (kit, with_) => { const freq = VOICES[with_.who] || 440; [1, 1.12, 0.94].forEach((bend, i) => kit.tone({ freq: freq * bend, to: freq * bend * 1.05, dur: 0.07, type: 'triangle', vol: 0.06, delay: i * 0.075 })); },
  // A fight
  meet: (kit) => { [392, 494, 587, 784].forEach((freq, i) => kit.tone({ freq, dur: 0.1, type: 'triangle', vol: 0.09, delay: i * 0.065 })); kit.noise({ dur: 0.3, vol: 0.04, freq: 900, sweep: 3000 }); },
  use: (kit) => { kit.noise({ dur: 0.14, vol: 0.2, freq: 600, sweep: 2600, q: 0.6 }); kit.tone({ freq: 300, to: 520, dur: 0.1, type: 'sine', vol: 0.035 }); },
  hit: (kit) => { kit.noise({ dur: 0.07, vol: 0.13, freq: 1400 }); kit.tone({ freq: 190, to: 95, dur: 0.1, type: 'triangle', vol: 0.13 }); },
  strong: (kit) => { kit.noise({ dur: 0.1, vol: 0.16, freq: 2600 }); kit.tone({ freq: 240, to: 90, dur: 0.14, type: 'triangle', vol: 0.15 }); kit.tone({ freq: 988, dur: 0.09, type: 'square', vol: 0.045, delay: 0.02 }); },
  weak: (kit) => { kit.noise({ dur: 0.06, vol: 0.07, freq: 500 }); kit.tone({ freq: 140, to: 100, dur: 0.08, type: 'sine', vol: 0.09 }); },
  faint: (kit) => kit.tone({ freq: 392, to: 110, dur: 0.34, type: 'triangle', vol: 0.1 }),
  mend: (kit) => [659, 784, 988].forEach((freq, i) => kit.bell(freq, { delay: i * 0.07, vol: 0.08, dur: 0.5 })),
  up: (kit) => kit.tone({ freq: 330, to: 660, dur: 0.16, type: 'triangle', vol: 0.08 }),
  down: (kit) => kit.tone({ freq: 440, to: 196, dur: 0.18, type: 'triangle', vol: 0.08 }),
  brace: (kit) => { kit.tone({ freq: 130, to: 98, dur: 0.12, type: 'sine', vol: 0.12 }); kit.noise({ dur: 0.05, vol: 0.05, freq: 400 }); },
  call: (kit) => { kit.tone({ freq: 784, dur: 0.07, type: 'sine', vol: 0.07 }); kit.tone({ freq: 1047, dur: 0.1, type: 'sine', vol: 0.07, delay: 0.08 }); },
  // Making friends
  reach: (kit) => { kit.tone({ freq: 392, dur: 0.32, type: 'sine', vol: 0.09, attack: 0.06 }); kit.tone({ freq: 523, dur: 0.42, type: 'sine', vol: 0.09, delay: 0.16, attack: 0.06 }); },
  pip: (kit) => kit.bell(1319, { vol: 0.07, dur: 0.25 }),
  huff: (kit) => kit.tone({ freq: 233, to: 196, dur: 0.12, type: 'square', vol: 0.05 }),
  settle: (kit) => [1047, 784, 659, 523].forEach((freq, i) => kit.bell(freq, { delay: i * 0.14, vol: 0.085, dur: 0.9 })),
  joined: (kit) => [784, 988, 1175, 1568].forEach((freq, i) => kit.bell(freq, { delay: i * 0.09, vol: 0.09, dur: 0.7 })),
  heirloom: (kit) => { for (let i = 0; i < 7; i++) kit.bell(1047 * Math.pow(2, [0, 7, 4, 12, 9, 16, 12][i] / 12), { delay: i * 0.07, vol: 0.055, dur: 0.6 }); },
  // How it went
  win: (kit) => { [523, 659, 784].forEach((freq, i) => kit.bell(freq, { delay: i * 0.1, vol: 0.09, dur: 0.6 })); kit.bell(1047, { delay: 0.3, vol: 0.1, dur: 1 }); },
  lose: (kit) => [392, 330, 262, 196].forEach((freq, i) => kit.tone({ freq, dur: 0.3, type: 'sine', vol: 0.09, delay: i * 0.16, attack: 0.03 })),
  calm: (kit) => { [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => kit.bell(freq, { delay: i * 0.1, vol: 0.085, dur: 0.9 })); [523, 784, 1047].forEach((freq) => kit.bell(freq, { delay: 0.72, vol: 0.07, dur: 1.6 })); },
  level: (kit) => [523, 659, 784, 1047].forEach((freq, i) => kit.tone({ freq, dur: 0.13, type: 'triangle', vol: 0.09, delay: i * 0.07 })),
};
export const SOUND_NAMES = Object.keys(SOUNDS);

// How loud it all is, and how loud the music is beside the effects. Each effect above is written
// quiet (a tenth of full or so) so that several at once have room; this brings the whole up to where
// a phone held in the hand at half volume can be heard.
export const MASTER = 1.7;
export const MUSIC = 0.6;

// Sounds that can be asked for many times a second are held to this often (seconds).
const NO_SOONER = { step: 0.2, hit: 0.06, strong: 0.06, weak: 0.06, tap: 0.04, pip: 0.05, huff: 0.05 };

// ---------------------------------------------------------------- making a noise

/** The few ways there are to make a sound, all ending at `out`, on one audio clock. */
export function kitFor(audio, out, hiss) {
  const now = () => audio.currentTime;
  /** One shaped tone: a quick rise, then a fall away to nothing. It may slide from `freq` to `to`. */
  function tone({ freq, to = 0, dur = 0.12, type = 'triangle', vol = 0.1, delay = 0, attack = 0.008, dest = out }) {
    const at = now() + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }
  /** A struck bar, as in a music box: the note, and two quieter, higher partials that die sooner. */
  function bell(freq, { dur = 0.8, vol = 0.1, delay = 0, dest = out } = {}) {
    tone({ freq, dur, type: 'sine', vol, delay, attack: 0.004, dest });
    // (Only partials that can be heard: past about 9,000 a second there is nothing to gain.)
    if (freq * 2.76 < 9000) tone({ freq: freq * 2.76, dur: dur * 0.35, type: 'sine', vol: vol * 0.28, delay, attack: 0.004, dest });
    if (freq * 5.4 < 9000) tone({ freq: freq * 5.4, dur: dur * 0.16, type: 'sine', vol: vol * 0.12, delay, attack: 0.004, dest });
  }
  /** A plucked string: bright at first, soon dull. */
  function pluck(freq, { dur = 0.3, vol = 0.1, delay = 0, dest = out } = {}) {
    tone({ freq, dur, type: 'triangle', vol, delay, attack: 0.004, dest });
    tone({ freq: freq * 2, dur: dur * 0.3, type: 'square', vol: vol * 0.12, delay, attack: 0.004, dest });
  }
  /** A puff of hiss through a filter, which may sweep. Thumps, footfalls and whooshes. */
  function noise({ dur = 0.08, vol = 0.1, freq = 1200, q = 0.7, sweep = 0, delay = 0, dest = out }) {
    const at = now() + delay;
    const src = audio.createBufferSource();
    src.buffer = hiss;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, at);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, at + dur);
    filter.Q.setValueAtTime(q, at);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    // Begin somewhere different in the hiss each time, so no two thumps are the same thump.
    src.start(at, Math.random() * Math.max(0, hiss.duration - dur - 0.05), dur + 0.05);
  }
  return { tone, bell, pluck, noise, now };
}

/** Half a second of hiss, made once and used for every thump and whoosh. */
function hissFor(audio) {
  const length = Math.ceil(audio.sampleRate * 0.6);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Writes one bar of a scene's tune into the future, starting at clock time `at`: the melody, a
 * bass note, and the chord (a waltz's two soft beats, or a plucked walk in a fight).
 */
export function writeBar(kit, scene, barIndex, at, dest) {
  const { tune, voice, speed, shift, loud } = scene;
  const beat = tune.beat / speed;
  const bar = tune.bars[barIndex % tune.bars.length];
  const pitch = (semitones) => tune.home * Math.pow(2, (semitones + shift) / 12);
  const delayOf = (beats) => Math.max(0, at + beats * beat - kit.now());
  for (const [when, note, long] of bar.notes) {
    if (voice === 'box') kit.bell(pitch(note), { dur: Math.max(0.9, long * beat * 1.5), vol: 0.085 * loud, delay: delayOf(when), dest });
    else kit.pluck(pitch(note), { dur: Math.max(0.22, long * beat * 0.95), vol: 0.075 * loud, delay: delayOf(when), dest });
  }
  if (voice === 'box') {
    // (A triangle, not a pure tone: a phone's small speaker cannot sound a note this low, only its overtones.)
    kit.tone({ freq: pitch(bar.chord[0] - 12), dur: beat * tune.beats * 0.98, type: 'triangle', vol: 0.055 * loud, delay: delayOf(0), attack: 0.03, dest });
    for (let b = 1; b < tune.beats; b++) {
      kit.bell(pitch(bar.chord[1]), { dur: beat * 0.9, vol: 0.026 * loud, delay: delayOf(b), dest });
      kit.bell(pitch(bar.chord[2]), { dur: beat * 0.9, vol: 0.026 * loud, delay: delayOf(b), dest });
    }
  } else {
    // Root, fifth, octave, fifth, twice over, on the half beats: a plucked bass that walks on the spot.
    const walk = [0, 7, 12, 7];
    for (let half = 0; half < tune.beats * 2; half++) {
      kit.pluck(pitch(bar.chord[0] - 12 + walk[half % 4]), { dur: beat * 0.42, vol: 0.06 * loud, delay: delayOf(half / 2), dest });
      if (half % 4 === 2) kit.noise({ dur: 0.04, vol: 0.018 * loud, freq: 5200, q: 1.2, delay: delayOf(half / 2), dest });
    }
  }
  return beat * tune.beats; // how long the bar lasts
}

/**
 * The sound of the game, for one kind of audio clock. `AudioClock` is the browser's AudioContext
 * (or a stand-in, in tests); with none, every call quietly does nothing.
 */
export function createSound(AudioClock, timers = { every: (fn, ms) => setInterval(fn, ms), stop: (id) => clearInterval(id) }) {
  let audio = null;
  let kit = null;
  let effectsOut = null;
  let musicOut = null;
  let effectsOn = true;
  let musicOn = true;
  let sceneName = 'quiet';
  let line = null; // the music playing now: { gain, scene, bar, next }
  let ticker = null;
  const last = {};
  // What has been asked for and played, by name: for tests, which cannot listen.
  const heard = {};

  function ensure() {
    if (audio || !AudioClock) return audio;
    try { audio = new AudioClock(); } catch (err) { audio = null; return null; }
    // Everything goes out through one volume and then a limiter, so that a pile of sounds landing
    // together (a boss falling as a level is gained) is squeezed, never torn.
    const master = audio.createGain();
    master.gain.value = MASTER;
    const limiter = audio.createDynamicsCompressor ? audio.createDynamicsCompressor() : null;
    if (limiter) {
      limiter.threshold.value = -9;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      master.connect(limiter);
      limiter.connect(audio.destination);
    } else master.connect(audio.destination);
    effectsOut = audio.createGain();
    effectsOut.gain.value = 1;
    effectsOut.connect(master);
    musicOut = audio.createGain();
    musicOut.gain.value = MUSIC;
    musicOut.connect(master);
    kit = kitFor(audio, effectsOut, hissFor(audio));
    return audio;
  }
  const running = () => !!audio && audio.state === 'running';

  function stopMusic() {
    if (ticker !== null) { timers.stop(ticker); ticker = null; }
    if (line && audio) {
      // What is already written fades away with its own volume, quickly, rather than stopping dead.
      const at = audio.currentTime;
      line.gain.gain.cancelScheduledValues(at);
      line.gain.gain.setValueAtTime(line.gain.gain.value, at);
      line.gain.gain.linearRampToValueAtTime(0.0001, at + 0.35);
    }
    line = null;
  }

  function write() {
    if (!line || !running()) return;
    // If the clock has run on without us (the page was asleep), pick up from now, not from then.
    if (line.next < audio.currentTime - 0.1) line.next = audio.currentTime + 0.1;
    // Keep about half a second of music written ahead of the clock.
    while (line.next < audio.currentTime + 0.5) {
      line.next += writeBar(kit, line.scene, line.bar, line.next, line.gain);
      line.bar++;
    }
  }

  function startMusic() {
    const scene = SCENES[sceneName];
    if (!musicOn || !scene || !running()) { stopMusic(); return; }
    if (line && line.scene === scene) return;
    stopMusic();
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.linearRampToValueAtTime(1, audio.currentTime + 0.4);
    gain.connect(musicOut);
    line = { gain, scene, bar: 0, next: audio.currentTime + 0.25 };
    write();
    ticker = timers.every(write, 120);
  }

  return {
    /** Browsers allow sound only after a touch: call this from every one (it is cheap). */
    unlock() {
      if (!ensure()) return;
      if (audio.state === 'suspended' && audio.resume) {
        const woke = audio.resume();
        if (woke && woke.then) woke.then(startMusic, () => {});
      }
      startMusic();
    },
    /** The two switches in Settings. */
    set({ effects, music }) {
      if (typeof effects === 'boolean') effectsOn = effects;
      if (typeof music === 'boolean' && music !== musicOn) { musicOn = music; if (musicOn) startMusic(); else stopMusic(); }
    },
    /** Away from the game (the app in the background, the tab hidden) there is silence. */
    hush(hidden) {
      if (!audio) return;
      if (hidden) { stopMusic(); if (audio.suspend) { const slept = audio.suspend(); if (slept && slept.catch) slept.catch(() => {}); } return; }
      if (audio.resume) { const woke = audio.resume(); if (woke && woke.then) woke.then(startMusic, () => {}); }
    },
    /** Plays an effect by name. `with_` says more where a sound has more than one way to go. */
    play(name, with_ = {}) {
      heard[name] = (heard[name] || 0) + 1;
      if (!effectsOn || !running() || !Object.prototype.hasOwnProperty.call(SOUNDS, name)) return false;
      const gap = NO_SOONER[name];
      if (gap) {
        if (audio.currentTime - (last[name] === undefined ? -1 : last[name]) < gap) return false;
        last[name] = audio.currentTime;
      }
      SOUNDS[name](kit, with_ || {});
      return true;
    },
    /** Says where you are, for the music: one of SCENES. */
    scene(name) {
      if (!Object.prototype.hasOwnProperty.call(SCENES, name) || name === sceneName) return;
      sceneName = name;
      startMusic();
    },
    /** How things stand, for tests and for Settings. */
    state: () => ({ effects: effectsOn, music: musicOn, scene: sceneName, running: running(), playing: !!line, heard: { ...heard } }),
  };
}

// ---------------------------------------------------------------- the one the game uses

const here = typeof window !== 'undefined' ? window : null;
const sound = createSound(here ? (here.AudioContext || here.webkitAudioContext || null) : null);

export const unlockSound = () => sound.unlock();
export const setSound = (switches) => sound.set(switches);
export const hushSound = (hidden) => sound.hush(hidden);
export const play = (name, with_) => sound.play(name, with_);
export const setScene = (name) => sound.scene(name);
export const soundState = () => sound.state();
