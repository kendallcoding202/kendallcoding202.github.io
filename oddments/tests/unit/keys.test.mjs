// The keys: one for each of the eight places, handed over by its ringleader
// when the place is calm. That there is one for every place, each with a name
// and a line of its own that names who gave it; that you hold exactly the keys
// of the places you have calmed; and that each has its painting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { ROOMS, SPECIES } from '../../web/js/core/balance.js';
import { KEYS, keysOf, keyOf } from '../../web/js/core/story.js';
import { KEY_ART, keySrc } from '../../web/js/ui/keys.js';
import { ART } from '../../tools/art-manifest.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const NOW = 1_800_000_000_000;
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}

test('every place has a key, with a name and a line of its own that says which ringleader handed it over', () => {
  assert.deepEqual(Object.keys(KEYS), ROOMS.map((room) => room.id));
  const names = new Set();
  for (const room of ROOMS) {
    const key = KEYS[room.id];
    assert.ok(/^The [A-Z][a-z]+ Key$/.test(key.name), key.name);
    assert.ok(!names.has(key.name));
    names.add(key.name);
    assert.ok(key.line.length >= 50 && key.line.length <= 125, `${room.id}: ${key.line.length}`);
    const boss = SPECIES[room.path[room.path.length - 1].boss].name.replace(/^The /, '');
    assert.ok(key.line.includes(boss), `${room.id}: its line names ${boss}`);
    assert.deepEqual(keyOf(room.id), { room: room.id, ...key });
  }
  assert.equal(keyOf('nowhere'), null);
  // They are keys, on a key ring, and called nothing else.
  const words = Object.values(KEYS).map((key) => `${key.name} ${key.line}`).join(' ') + readFileSync(`${WEB}js/ui/keys.js`, 'utf8');
  assert.doesNotMatch(words, /badge|medal|trophy|gym/i);
});

test('you hold the key of every place you have calmed, and no other; the save keeps nothing more for them', () => {
  const game = fresh(4);
  assert.deepEqual(keysOf(game.state).map((key) => key.held), ROOMS.map(() => false));
  assert.deepEqual(keysOf(game.state).map((key) => [key.room, key.place]), ROOMS.map((room) => [room.id, room.name]));
  game.state.rooms.garden.clears = 1;
  game.state.rooms.garden.calmed = 31;
  game.state.rooms.alley.calmed = 15; // all but its ringleader: not calm yet
  assert.deepEqual(keysOf(game.state).filter((key) => key.held).map((key) => key.name), ['The Gate Key']);
  for (const room of ROOMS) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 31; }
  assert.equal(keysOf(game.state).filter((key) => key.held).length, ROOMS.length);
  // Nothing about keys is in the save, so a save cannot hand out a key: only calming does.
  const raw = JSON.parse(game.serialize(NOW));
  // (Nothing in the save is named for a key. One kind's own name happens to end in the word, so it is the names of things that are looked at.)
  const names = (thing) => (thing && typeof thing === 'object' ? Object.entries(thing).flatMap(([name, value]) => [name, ...names(value)]) : []);
  assert.deepEqual(names(raw).filter((name) => /key/i.test(name) && !SPECIES[name]), []);
  raw.keys = ['dark'];
  raw.rooms.dark.clears = 0;
  const state = reviveState(raw, NOW);
  assert.equal('keys' in state, false);
  assert.equal(keysOf(state).find((key) => key.room === 'dark').held, false);
});

test('each key has its painting in the game, each one different, and the manifest says how they were made', () => {
  assert.deepEqual(KEY_ART, ROOMS.map((room) => keySrc(room.id)));
  const sizes = new Set();
  for (const room of ROOMS) {
    const path = `${WEB}${keySrc(room.id)}`;
    assert.ok(existsSync(path), `${room.id}.webp is in the game`);
    const size = statSync(path).size;
    assert.ok(size > 3000 && size < 40_000, `${room.id}: ${size} bytes`);
    sizes.add(readFileSync(path).toString('base64').slice(0, 4000));
  }
  assert.equal(sizes.size, ROOMS.length, 'no two are the same picture');
  const sheet = ART.find((art) => art.id === 'world_keys');
  assert.ok(sheet && /exactly eight separate/.test(sheet.prompt));
  assert.ok(ART.find((art) => art.id === 'world_key_rooftops'), 'the rooftop key has a painting of its own');
});
