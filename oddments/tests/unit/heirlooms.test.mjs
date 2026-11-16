// Heirlooms: now and then an Oddment turns up in rare colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rollEncounter } from '../../web/js/core/rooms.js';
import { createBattle, makeFighter, unitOf } from '../../web/js/core/battle.js';
import { settleUp } from '../../web/js/core/progress.js';
import { newState } from '../../web/js/core/state.js';
import { Game } from '../../web/js/core/game.js';
import { HEIRLOOM, SPECIES, SPECIES_IDS, ROOMS } from '../../web/js/core/balance.js';

const SPRITES = fileURLToPath(new URL('../../web/assets/sprites/', import.meta.url));

test('about one restless Oddment in sixty is an Heirloom, and a boss never is', () => {
  let met = 0;
  let rare = 0;
  for (let seed = 1; seed <= 6000; seed++) {
    for (const foe of rollEncounter({ rng: seed * 31 }, ROOMS[0], seed % ROOMS[0].path.length)) {
      if (SPECIES[foe.species].boss) { assert.equal(foe.heirloom, false); continue; }
      met++;
      if (foe.heirloom) rare++;
    }
  }
  assert.ok(met > 10000);
  const share = rare / met;
  assert.ok(share > HEIRLOOM.odds * 0.7 && share < HEIRLOOM.odds * 1.3, `${rare} of ${met}`);
  assert.ok(HEIRLOOM.odds > 1 / 200 && HEIRLOOM.odds < 1 / 20, 'rare, but something a player will actually see');
});

test('an Heirloom fights exactly like any other of its kind; it is only a little prouder', () => {
  const plain = makeFighter('foe', 0, { species: 'sockeel', level: 4 });
  const rare = makeFighter('foe', 0, { species: 'sockeel', level: 4, heirloom: true });
  assert.equal(rare.heirloom, true);
  for (const key of ['maxHp', 'hp', 'oomph', 'grit', 'pep', 'element', 'turns']) assert.equal(rare[key], plain[key], key);
  assert.deepEqual(rare.moves, plain.moves);
  assert.equal(rare.huff, plain.huff + HEIRLOOM.huff);
  assert.equal(makeFighter('ally', 0, { species: 'sockeel', level: 4, heirloom: true }).huff, 0, 'your own is not in a huff at all');
});

/** A won fight from a fresh save in which every foe has been calmed. */
function calmed(foes, prepare = () => {}) {
  const state = newState(1e12, 3);
  prepare(state);
  const battle = createBattle(state, { allies: [{ species: 'dustbunny', level: 3, friendId: 1 }], foes, fx: false });
  for (const unit of battle.units) if (unit.side === 'foe') unit.settled = true;
  battle.phase = 'won';
  return { state, summary: settleUp(state, battle) };
}

test('an Heirloom that comes home keeps its colours', () => {
  const { state, summary } = calmed([{ species: 'gnome', level: 3, heirloom: true }]);
  assert.equal(state.friends.find((f) => f.species === 'gnome').heirloom, true);
  assert.equal(summary.joined[0].heirloom, true);
  assert.equal(state.stats.heirlooms, 1);
});

test('an Heirloom of a kind you already have passes its colours on to your friend', () => {
  const { state, summary } = calmed([{ species: 'sockeel', level: 2, heirloom: true }]);
  const eel = state.friends.find((f) => f.species === 'sockeel');
  assert.equal(eel.heirloom, true);
  assert.equal(eel.level >= 3, true, 'it is still your friend, at its own level');
  assert.deepEqual(summary.heirlooms, ['sockeel']);
  assert.deepEqual(summary.joined, []);
  assert.equal(state.friends.filter((f) => f.species === 'sockeel').length, 1);
  assert.equal(state.stats.heirlooms, 1);
});

test('a plain visitor never takes the colours away again', () => {
  const { state, summary } = calmed([{ species: 'sockeel', level: 2 }], (s) => { s.friends[1].heirloom = true; });
  assert.equal(state.friends[1].heirloom, true);
  assert.deepEqual(summary.heirlooms, []);
  assert.equal(state.stats.heirlooms, 0);
});

test('meeting one is written in the scrapbook even if it gets away', () => {
  // Find a seed whose first encounter has an Heirloom in it.
  let game = null;
  for (let seed = 1; seed < 5000 && !game; seed++) {
    const candidate = new Game(newState(1e12, seed), { now: 1e12, fx: false });
    candidate.travelTo('garden');
    // Everyone is rolled as you step in, so they can be seen waiting.
    if (candidate.state.visit.groups[0].foes.some((foe) => foe.heirloom)) game = candidate;
  }
  assert.ok(game, 'found a seed with an Heirloom at the gate');
  const battle = game.startEncounter();
  const rare = battle.units.find((unit) => unit.side === 'foe' && unit.heirloom);
  assert.ok(rare);
  assert.deepEqual(game.state.book[rare.species], { met: true, heirloom: true });
  game.concede();
  game.finishBattle();
  assert.equal(game.state.book[rare.species].heirloom, true);
  assert.equal(unitOf(battle, rare.key).heirloom, true);
});

test('every kind that can be a friend has its Heirloom sprite, and a boss has none', () => {
  for (const id of SPECIES_IDS) {
    assert.equal(existsSync(`${SPRITES}${id}_heirloom.webp`), !SPECIES[id].boss, id);
  }
});
