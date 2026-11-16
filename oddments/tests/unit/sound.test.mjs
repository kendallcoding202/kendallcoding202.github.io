// Sound. Nothing here can listen, but it can hold the sound code to its
// promises: every sound a screen asks for exists, the tunes are well formed,
// nothing is made before a touch or while a switch is off, the music is
// written a little ahead of the clock and never in a burst, and every number
// handed to the audio system is a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOUNDS, SOUND_NAMES, SCENES, TUNES, VOICE_NAMES, BACK_NAMES, FIGHT_SCENE, sceneFor, MASTER, MUSIC, createSound, kitFor, writeBar, play, setScene, unlockSound, setSound, hushSound, soundState } from '../../web/js/platform/sound.js';
import { newState, reviveState } from '../../web/js/core/state.js';

const WEB = fileURLToPath(new URL('../../web/js/', import.meta.url));

// ---------------------------------------------------------------- a stand-in for the browser's audio

/** A value that can be set now or scheduled, as an AudioParam can: it writes down everything asked of it. */
function param(log, what, value = 0) {
  const real = (n, name) => assert.ok(Number.isFinite(n), `${what}.${name} was given ${n}`);
  return {
    value,
    setValueAtTime(v, t) { real(v, 'setValueAtTime'); real(t, 'setValueAtTime'); log.push({ what, how: 'set', v, t }); this.value = v; },
    exponentialRampToValueAtTime(v, t) { real(v, 'ramp'); real(t, 'ramp'); assert.ok(v > 0, `${what}: an exponential ramp cannot reach ${v}`); log.push({ what, how: 'ramp', v, t }); this.value = v; },
    linearRampToValueAtTime(v, t) { real(v, 'ramp'); real(t, 'ramp'); log.push({ what, how: 'line', v, t }); this.value = v; },
    cancelScheduledValues(t) { real(t, 'cancel'); },
  };
}

/** A stand-in AudioContext: a clock that only moves when told, and a note of everything made on it. */
function standIn() {
  const made = { clocks: 0, oscillators: [], noises: [], gains: [], params: [] };
  class Clock {
    constructor() { made.clocks++; made.clock = this; this.currentTime = 0; this.sampleRate = 44100; this.state = 'suspended'; this.destination = { name: 'out' }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createGain() { const node = { gain: param(made.params, 'gain', 1), connect() {} }; made.gains.push(node); return node; }
    createDynamicsCompressor() { const p = () => param(made.params, 'limiter'); return { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect() {} }; }
    createBiquadFilter() { return { type: '', frequency: param(made.params, 'filter'), Q: param(made.params, 'q'), connect() {} }; }
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createOscillator() {
      const node = { type: '', frequency: param(made.params, 'pitch'), connect() {}, start(t) { assert.ok(Number.isFinite(t)); node.at = t; }, stop(t) { assert.ok(Number.isFinite(t) && t > node.at, 'a note ends after it begins'); node.until = t; } };
      made.oscillators.push(node);
      return node;
    }
    createBufferSource() {
      const node = { buffer: null, connect() {}, start(t, from, long) { for (const n of [t, from, long]) assert.ok(Number.isFinite(n) && n >= 0, `a puff of hiss was started with ${n}`); node.at = t; node.long = long; } };
      made.noises.push(node);
      return node;
    }
  }
  const timers = { running: null, every(fn) { timers.running = fn; return 7; }, stop(id) { assert.equal(id, 7); timers.running = null; } };
  return { Clock, made, timers };
}
/** A sound system on a stand-in clock, already touched (so allowed to make a noise). */
async function touched() {
  const rig = standIn();
  const sound = createSound(rig.Clock, rig.timers);
  sound.unlock();
  await Promise.resolve(); await Promise.resolve();
  return { ...rig, sound, clock: rig.made.clock };
}

// ---------------------------------------------------------------- what the screens ask for

/** Every name a screen passes to the sound code: the quoted words inside each `play(...)` or `sound(...)`. */
function asked() {
  const names = new Map();
  const files = [...readdirSync(`${WEB}ui`).map((f) => `ui/${f}`), 'main.js'];
  for (const file of files) {
    const text = readFileSync(`${WEB}${file}`, 'utf8');
    if (!/from '\.{1,2}\/platform\/sound\.js'/.test(text)) continue;
    const call = /import \{[^}]*\bplay as (\w+)/.test(text) ? RegExp.$1 : 'play';
    const opener = new RegExp(`(?<![\\w.])${call}\\(`, 'g');
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      let depth = 1;
      let end = m.index + m[0].length;
      while (depth > 0 && end < text.length) { if (text[end] === '(') depth++; else if (text[end] === ')') depth--; end++; }
      // The first argument only: what follows a top-level comma says how, not which.
      const inside = text.slice(m.index + m[0].length, end - 1);
      let level = 0;
      let first = inside;
      for (let i = 0; i < inside.length; i++) { if ('([{'.includes(inside[i])) level++; else if (')]}'.includes(inside[i])) level--; else if (inside[i] === ',' && level === 0) { first = inside.slice(0, i); break; } }
      for (const word of first.match(/'([a-z]+)'/g) || []) names.set(word.slice(1, -1), file);
    }
  }
  return names;
}

test('every sound a screen asks for exists, and every sound that exists is asked for', () => {
  const names = asked();
  assert.ok(names.size >= 20, `the screens ask for ${names.size} sounds`);
  for (const [name, file] of names) assert.ok(SOUND_NAMES.includes(name), `${file} asks for "${name}", which is not a sound`);
  for (const name of SOUND_NAMES) assert.ok(names.has(name), `"${name}" is made but nothing asks for it`);
  assert.equal(new Set(SOUND_NAMES).size, SOUND_NAMES.length);
});

test('every effect makes something, briefly, quietly, and with real numbers', async () => {
  for (const name of SOUND_NAMES) {
    const { sound, made, clock } = await touched();
    clock.currentTime = 5;
    made.oscillators.length = 0; made.noises.length = 0; made.params.length = 0;
    assert.equal(sound.play(name, { who: 'dov', hard: true }), true, name);
    const parts = made.oscillators.length + made.noises.length;
    assert.ok(parts >= 1 && parts <= 30, `${name} is made of ${parts} parts`);
    for (const osc of made.oscillators) {
      assert.ok(osc.at >= 5 && osc.at < 5 + 3, `${name}: a part starts at ${osc.at}`);
      assert.ok(osc.until - osc.at <= 2, `${name}: a part lasts ${osc.until - osc.at}s`);
    }
    for (const puff of made.noises) assert.ok(puff.long > 0 && puff.long < 0.6 && puff.at >= 5, name);
    const loudest = Math.max(...made.params.filter((p) => p.what === 'gain').map((p) => p.v));
    assert.ok(loudest > 0.01 && loudest <= 0.25, `${name}: its loudest part is ${loudest}`);
    for (const p of made.params.filter((q) => q.what === 'pitch')) assert.ok(p.v >= 60 && p.v <= 9000, `${name}: a pitch of ${p.v}`);
  }
  // A voice for each person, and a plain one for anyone else.
  for (const who of ['maribel', 'ines', 'dov', 'spick', 'nobody', undefined]) {
    const { sound } = await touched();
    assert.equal(sound.play('talk', who === undefined ? undefined : { who }), true);
  }
});

test('the four tunes are well formed: every bar full, every note in the bar and in a singable range', () => {
  assert.deepEqual(Object.keys(TUNES), ['LULLABY', 'SCUFFLE', 'RACKET', 'RINGLEADER']);
  assert.equal(TUNES.LULLABY.beats, 3, 'the lullaby is in three');
  assert.equal(TUNES.SCUFFLE.beats, 4, 'the scuffle is in four');
  assert.ok(TUNES.SCUFFLE.beat < TUNES.LULLABY.beat, 'and quicker');
  assert.ok(TUNES.RACKET.beat < TUNES.SCUFFLE.beat, 'the alley\'s fight tune is quicker again');
  assert.ok(TUNES.RINGLEADER.home < Math.min(TUNES.SCUFFLE.home, TUNES.RACKET.home), 'a ringleader\'s is the lowest of the fight tunes');
  // No two tunes are the same tune moved about: each has its own key note, and its own first bar.
  assert.equal(new Set(Object.values(TUNES).map((tune) => tune.home)).size, 4);
  assert.equal(new Set(Object.values(TUNES).map((tune) => JSON.stringify(tune.bars[0].notes))).size, 4);
  for (const [name, tune] of Object.entries(TUNES)) {
    assert.ok(tune.home > 190 && tune.home < 400 && tune.beat > 0.3 && tune.beat < 1);
    assert.ok(tune.bars.length % 4 === 0 && tune.bars.length >= 8, `${name}: ${tune.bars.length} bars`);
    tune.bars.forEach((bar, i) => {
      assert.equal(bar.chord.length, 3, `${name} bar ${i + 1}`);
      assert.ok(bar.chord[0] < bar.chord[1] && bar.chord[1] < bar.chord[2] && bar.chord[2] - bar.chord[0] <= 7, `${name} bar ${i + 1}: a close chord, low to high`);
      assert.ok(bar.notes.length >= 1 && bar.notes.length <= 6);
      let at = 0;
      for (const [when, note, long] of bar.notes) {
        assert.ok(when >= at - 1e-9, `${name} bar ${i + 1}: the melody is one note at a time`);
        assert.ok(long > 0 && when + long <= tune.beats + 1e-9, `${name} bar ${i + 1}: a note runs past the bar line`);
        assert.ok(Number.isInteger(note) && note >= 5 && note <= 24, `${name} bar ${i + 1}: note ${note}`);
        at = when + long;
      }
      assert.ok(Math.abs(at - tune.beats) < 1e-9, `${name} bar ${i + 1}: the melody fills the bar`);
    });
    // It ends where it can begin again: on the home chord, or the one that leads back to it.
    const last = tune.bars[tune.bars.length - 1].chord;
    assert.ok([0, -5, 7].includes(((last[0] % 12) + 12) % 12 === 0 ? 0 : last[0]), `${name}: the last bar leads home`);
  }
});

test('where you are picks the tune: a lullaby in the world, a fight tune by place, and a ringleader\'s own', () => {
  assert.deepEqual(Object.keys(SCENES), ['quiet', 'world', 'fight', 'clatter', 'boss']);
  assert.equal(SCENES.quiet, null);
  assert.equal(SCENES.world.tune, TUNES.LULLABY);
  assert.equal(SCENES.fight.tune, TUNES.SCUFFLE);
  assert.equal(SCENES.clatter.tune, TUNES.RACKET);
  assert.equal(SCENES.boss.tune, TUNES.RINGLEADER, 'a ringleader has a tune of its own, not the scuffle moved down');
  // Every scene is played by something that exists, and no two scenes sound alike: each has its own voice and its own backing.
  const playing = Object.values(SCENES).filter(Boolean);
  for (const scene of playing) assert.ok(VOICE_NAMES.includes(scene.voice) && BACK_NAMES.includes(scene.back) && scene.speed > 0 && scene.loud > 0.5 && scene.loud <= 1);
  assert.equal(new Set(playing.map((scene) => scene.voice)).size, playing.length);
  assert.equal(new Set(playing.map((scene) => scene.back)).size, playing.length);
  // Which scene it is.
  assert.equal(sceneFor(), 'world');
  assert.equal(sceneFor({ fight: false, boss: true, room: 'alley' }), 'world', 'out of a fight it is the world, whatever else is said');
  assert.equal(sceneFor({ fight: true, room: 'garden' }), 'fight');
  assert.equal(sceneFor({ fight: true, room: 'alley' }), 'clatter', 'Tin Can Alley has a fight tune of its own');
  assert.equal(sceneFor({ fight: true, boss: true, room: 'garden' }), 'boss');
  assert.equal(sceneFor({ fight: true, boss: true, room: 'alley' }), 'boss');
  for (const odd of ['pantry', 'constructor', 'toString', '', undefined]) assert.equal(sceneFor({ fight: true, room: odd }), 'fight', `a place with no tune of its own (${odd}) has the scuffle`);
  for (const [room, name] of Object.entries(FIGHT_SCENE)) assert.ok(SCENES[name] && name !== 'world' && name !== 'boss', room);
  assert.ok(MASTER > 0.5 && MASTER <= 2 && MUSIC > 0.2 && MUSIC < 1, 'the music sits under the effects');
});

test('a bar is written into the future: melody, bass and chord, all inside the bar', () => {
  for (const name of ['world', 'fight', 'clatter', 'boss']) {
    const { Clock, made } = standIn();
    const clock = new Clock();
    clock.currentTime = 10;
    const kit = kitFor(clock, { name: 'music' }, clock.createBuffer(1, 44100, 44100));
    const scene = SCENES[name];
    const long = writeBar(kit, scene, 0, 10.25, { name: 'music' });
    assert.ok(Math.abs(long - (scene.tune.beat / scene.speed) * scene.tune.beats) < 1e-9);
    assert.ok(made.oscillators.length >= 8, `${name}: ${made.oscillators.length} notes in a bar`);
    for (const osc of made.oscillators) assert.ok(osc.at >= 10.25 - 1e-9 && osc.at < 10.25 + long, `${name}: a note at ${osc.at}`);
    // Bars follow one another round and round.
    assert.equal(writeBar(kit, scene, scene.tune.bars.length, 20, {}), long);
  }
});

// ---------------------------------------------------------------- when anything is heard at all

test('nothing is made before the first touch; after it the music starts and is kept written a little ahead', async () => {
  const { Clock, made, timers } = standIn();
  const sound = createSound(Clock, timers);
  sound.scene('world');
  assert.equal(sound.play('tap'), false, 'not before a touch');
  assert.equal(made.clocks, 0, 'not even an audio clock');
  assert.deepEqual({ ...sound.state(), heard: null }, { effects: true, music: true, scene: 'world', running: false, playing: false, heard: null });
  sound.unlock();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(made.clocks, 1);
  assert.equal(sound.state().running, true);
  assert.equal(sound.state().playing, true, 'the lullaby is playing');
  assert.ok(timers.running, 'and something keeps writing it');
  const first = made.oscillators.length;
  assert.ok(first > 0);
  const horizon = () => Math.max(...made.oscillators.map((osc) => osc.at));
  assert.ok(horizon() > 0.5 && horizon() < 4, `written ${horizon()}s ahead`);
  // As the clock runs, more is written, a bar at a time, never far ahead.
  const clock = made.clock;
  for (let tick = 1; tick <= 100; tick++) { clock.currentTime = tick * 0.12; timers.running(); assert.ok(horizon() - clock.currentTime < 4); assert.ok(horizon() >= clock.currentTime - 0.15, 'never caught up with: the last note written is no more than a beat behind the half second kept in hand'); }
  assert.ok(made.oscillators.length > first * 3);
  for (const osc of made.oscillators) assert.ok(osc.at >= 0);
  // More touches change nothing.
  const before = made.oscillators.length;
  sound.unlock(); sound.unlock();
  assert.equal(made.clocks, 1);
  assert.equal(made.oscillators.length, before);
});

test('if the clock has run on while the page slept, the music picks up from now, not in a burst', async () => {
  const { sound, made, timers, clock } = await touched();
  sound.scene('world');
  timers.running();
  const before = made.oscillators.length;
  clock.currentTime += 600; // ten minutes with no timer
  timers.running();
  const burst = made.oscillators.length - before;
  assert.ok(burst > 0 && burst < 120, `${burst} notes written on waking`);
  for (const osc of made.oscillators.slice(before)) assert.ok(osc.at >= clock.currentTime - 1e-6, 'none of them in the past');
});

test('the two switches: effects off makes no effects; music off stops the tune and on starts it again', async () => {
  const { sound, made, timers } = await touched();
  sound.scene('fight');
  assert.equal(sound.state().playing, true);
  sound.set({ effects: false });
  const before = made.oscillators.length + made.noises.length;
  assert.equal(sound.play('hit'), false);
  assert.equal(made.oscillators.length + made.noises.length, before);
  assert.equal(sound.state().playing, true, 'the music is its own switch');
  sound.set({ music: false });
  assert.equal(sound.state().playing, false);
  assert.equal(timers.running, null, 'and nothing goes on writing it');
  sound.set({ effects: true, music: true });
  assert.equal(sound.play('hit'), true);
  assert.equal(sound.state().playing, true);
  assert.deepEqual([sound.state().effects, sound.state().music], [true, true]);
  // Anything that is not a plain yes or no changes nothing.
  sound.set({ effects: 'no', music: 0 });
  sound.set({});
  assert.deepEqual([sound.state().effects, sound.state().music], [true, true]);
});

test('changing where you are changes the tune once; saying the same place again, or a made-up one, does nothing', async () => {
  const { sound, made } = await touched();
  sound.scene('world');
  const lullaby = made.oscillators.length;
  sound.scene('world');
  assert.equal(made.oscillators.length, lullaby, 'the same place: the tune plays on');
  sound.scene('fight');
  assert.ok(made.oscillators.length > lullaby, 'a fight: the scuffle starts');
  assert.equal(sound.state().scene, 'fight');
  for (const odd of ['disco', 'constructor', '', null, 7]) { sound.scene(odd); assert.equal(sound.state().scene, 'fight'); }
  sound.scene('quiet');
  assert.equal(sound.state().playing, false, 'quiet is no music at all');
});

test('away from the game there is silence, and it comes back with you', async () => {
  const { sound, clock, timers } = await touched();
  sound.scene('world');
  sound.hush(true);
  assert.equal(clock.state, 'suspended');
  assert.equal(sound.state().playing, false);
  assert.equal(timers.running, null);
  assert.equal(sound.play('tap'), false, 'no effects while away either');
  sound.hush(false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(clock.state, 'running');
  assert.equal(sound.state().playing, true);
  // Before any touch there is nothing to hush.
  const fresh = createSound(standIn().Clock);
  assert.doesNotThrow(() => { fresh.hush(true); fresh.hush(false); });
});

test('a sound asked for many times at once is made once; an unknown one is not made at all', async () => {
  const { sound, clock } = await touched();
  assert.equal(sound.play('step'), true);
  assert.equal(sound.play('step'), false, 'two footfalls in the same instant are one');
  clock.currentTime += 0.3;
  assert.equal(sound.play('step'), true);
  assert.equal(sound.play('win'), true);
  assert.equal(sound.play('win'), true, 'a jingle is not held back');
  for (const odd of ['kazoo', 'constructor', 'toString', '', null]) assert.equal(sound.play(odd), false, String(odd));
  assert.equal(sound.state().heard.step, 3, 'what was asked for is counted, heard or not');
});

test('with no audio at all (an old browser, or these tests) everything is a quiet no-op', () => {
  for (const Missing of [null, undefined, class { constructor() { throw new Error('no audio here'); } }]) {
    const sound = createSound(Missing);
    assert.doesNotThrow(() => { sound.unlock(); sound.set({ effects: true, music: true }); sound.scene('fight'); sound.hush(true); sound.hush(false); });
    assert.equal(sound.play('hit'), false);
    assert.equal(sound.state().running, false);
  }
  // The game's own one, here in Node where there is no window, is the same.
  assert.doesNotThrow(() => { unlockSound(); setSound({ effects: true, music: true }); setScene('world'); hushSound(false); });
  assert.equal(play('tap'), false);
  assert.equal(soundState().running, false);
});

// ---------------------------------------------------------------- the save

test('sound and music are on in a new game, on for a save from before there was sound, and stay off once turned off', () => {
  const NOW = 1_800_000_000_000;
  const fresh = newState(NOW, 3);
  assert.deepEqual(fresh.settings, { fast: false, sound: true, music: true });
  const old = JSON.parse(JSON.stringify(fresh));
  old.settings = { fast: true }; // as saved before sound existed
  assert.deepEqual(reviveState(old, NOW).settings, { fast: true, sound: true, music: true });
  old.settings = { fast: false, sound: false, music: false };
  assert.deepEqual(reviveState(JSON.parse(JSON.stringify(old)), NOW).settings, { fast: false, sound: false, music: false });
  for (const wrong of [null, 7, 'loud', [], { sound: 'yes', music: 1, fast: null, extra: true }]) {
    old.settings = wrong;
    assert.deepEqual(reviveState(JSON.parse(JSON.stringify(old)), NOW).settings, { fast: false, sound: true, music: true }, JSON.stringify(wrong));
  }
});
