// Heirlooms: now and then an Clutterkin turns up in rare colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rollEncounter } from '../../web/js/core/rooms.js';
import { createBattle, makeFighter, unitOf } from '../../web/js/core/battle.js';
import { settleUp } from '../../web/js/core/progress.js';
import { newState } from '../../web/js/core/state.js';
import { Game } from '../../web/js/core/game.js';
import { HEIRLOOM, VISITORS, SPECIES, SPECIES_IDS, ROOMS, roomBuilt } from '../../web/js/core/balance.js';
import { poolOf } from '../../web/js/core/rooms.js';

const SPRITES = fileURLToPath(new URL('../../web/assets/sprites/', import.meta.url));

test('about one restless Clutterkin in sixty is an Heirloom, and a boss never is', () => {
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

test('in a place you have calmed they bring out their best colours: about one in twenty there', () => {
  assert.ok(HEIRLOOM.calmOdds > HEIRLOOM.odds * 2 && HEIRLOOM.calmOdds <= 1 / 10, 'a real difference, and still a find');
  for (const room of ROOMS.filter(roomBuilt)) {
    let met = 0;
    let rare = 0;
    for (let seed = 1; seed <= 6000; seed++) {
      for (const foe of rollEncounter({ rng: seed * 31 }, room, seed % room.path.length, true)) {
        if (SPECIES[foe.species].boss) { assert.equal(foe.heirloom, false, 'a boss never is, calm or not'); continue; }
        met++;
        if (foe.heirloom) rare++;
      }
    }
    const share = rare / met;
    assert.ok(share > HEIRLOOM.calmOdds * 0.75 && share < HEIRLOOM.calmOdds * 1.25, `${room.id}: ${rare} of ${met}`);
  }
});

test('every kind that can be a friend can turn up as an Heirloom somewhere, once places are calm', () => {
  // (The two Keepsakes are met in no place: each has a spot of its own, and its rare colours are found there.)
  const canJoin = SPECIES_IDS.filter((id) => !SPECIES[id].boss && !SPECIES[id].keepsake);
  const restless = new Set(ROOMS.filter(roomBuilt).flatMap((room) => room.path.flatMap((_, stop) => poolOf(room, stop, false).map(([id]) => id))));
  const calm = new Set(ROOMS.filter(roomBuilt).flatMap((room) => room.path.flatMap((_, stop) => poolOf(room, stop, true).map(([id]) => id))));
  const never = canJoin.filter((id) => !restless.has(id));
  assert.deepEqual(never.sort(), [...VISITORS.kinds].sort(), 'while everywhere is restless, the three you set out with are met nowhere');
  for (const id of canJoin) assert.ok(calm.has(id), `${id} is never met, so its Heirloom could never be found`);
  for (const id of canJoin) assert.ok(SPECIES[id].huff > 0, `${id} can be calmed, so can be an Heirloom`);
  // And one that visits really can be one: found by rolling.
  let found = null;
  for (let seed = 1; seed <= 20000 && !found; seed++) found = rollEncounter({ rng: seed }, ROOMS[0], seed % 4, true).find((foe) => foe.heirloom && VISITORS.kinds.includes(foe.species)) || null;
  assert.ok(found, 'an Heirloom of one of your first three turns up in a calm garden');
});

test('calming an Heirloom of a kind you set out with gives your own friend its colours', () => {
  const state = newState(1e12, 5);
  state.started = true;
  state.rooms.garden.clears = 1;
  const game = new Game(state, { now: 1e12, fx: false });
  assert.equal(game.travelTo('garden'), true);
  const level = ROOMS[0].path[0].level[0];
  state.visit.groups[0].foes = [{ species: 'dustbunny', level, heirloom: true }, { species: 'dandepuff', level, heirloom: false }];
  const mine = state.friends.find((friend) => friend.species === 'dustbunny');
  assert.equal(mine.heirloom, false);
  const battle = game.startEncounter(0);
  assert.deepEqual(battle.units.filter((unit) => unit.side === 'foe').map((unit) => [unit.species, unit.heirloom]), [['dustbunny', true], ['dandepuff', false]], 'the visitor is met as it was seen, not rolled again');
  // Settle the visitor and win.
  const rare = battle.units.find((unit) => unit.side === 'foe' && unit.heirloom);
  rare.huff = 0; rare.settled = true; rare.hp = 0;
  for (const unit of battle.units) if (unit.side === 'foe' && !unit.settled) unit.hp = 0;
  battle.phase = 'won';
  const summary = settleUp(state, battle);
  assert.deepEqual(summary.heirlooms, ['dustbunny']);
  assert.equal(mine.heirloom, true, 'your Dust Bunny wears the colours now');
  assert.equal(state.friends.filter((friend) => friend.species === 'dustbunny').length, 1, 'and there is still only one of it');
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
  assert.deepEqual(game.state.book[rare.species], { met: true, heirloom: true, grown: false });
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
