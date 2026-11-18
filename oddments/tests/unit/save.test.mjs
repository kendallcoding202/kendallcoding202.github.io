// The save: a fresh one, one that has been played, and ones from other versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playable } from '../../web/js/core/trial.js';
import { Game } from '../../web/js/core/game.js';
import { SAVE_VERSION, START_TEAM, ROOM_IDS, SPECIES_IDS, LOOK_IDS, DEFAULT_NAME } from '../../web/js/core/balance.js';
import { playPlayer } from '../../tools/sim.mjs';

const NOW = 1_800_000_000_000;

test('a new game: the three you start with, nothing cleared, nothing met but them', () => {
  const state = newState(NOW, 7);
  assert.equal(state.v, SAVE_VERSION);
  assert.equal(state.rng, 7);
  assert.equal(state.started, false);
  assert.deepEqual(state.friends.map((f) => [f.species, f.level, f.xp, f.heirloom]), START_TEAM.map(([species, level]) => [species, level, 0, false]));
  assert.deepEqual(state.team, [1, 2, 3]);
  assert.equal(state.nextFriendId, 4);
  assert.equal(state.visit, null);
  assert.deepEqual(Object.keys(state.rooms), ROOM_IDS);
  assert.deepEqual(Object.keys(state.book), SPECIES_IDS);
  assert.deepEqual(SPECIES_IDS.filter((id) => state.book[id].met), START_TEAM.map(([id]) => id));
  assert.deepEqual(state.player, { name: DEFAULT_NAME, look: LOOK_IDS[0] });
});

test('two new games started at different moments are not the same game', () => {
  assert.notEqual(newState(NOW).rng, newState(NOW + 1).rng);
});

test('a new save, and one in the middle of a visit, come back exactly as they went in', () => {
  const fresh = newState(NOW, 3);
  assert.deepEqual(reviveState(JSON.parse(JSON.stringify(fresh)), NOW), fresh);

  const { state } = playPlayer({ seed: 5, visits: 2 });
  const game = new Game(state, { now: NOW, fx: false });
  game.setLook({ name: 'Marisol', look: LOOK_IDS[2] });
  assert.equal(game.travelTo('garden'), true);
  game.startEncounter(); game.concede(); game.finishBattle(); // home again
  game.travelTo('garden');
  state.visit.hp[state.team[0]] = 7;
  const saved = JSON.parse(game.serialize(NOW));
  assert.ok(saved.friends.length > 3 && saved.visit && saved.stats.battles > 5);
  const back = reviveState(JSON.parse(JSON.stringify(saved)), NOW);
  assert.deepEqual(back, saved);
  assert.equal(playable(back, NOW), true);
});

test('the fight in progress is not part of the save', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  game.travelTo('garden');
  game.startEncounter();
  const saved = JSON.parse(game.serialize(NOW));
  assert.equal(saved.battle, undefined);
  assert.equal(JSON.stringify(saved).includes('events'), false);
  assert.equal(saved.visit.stop, 0, 'reloading puts you back in front of them');
  assert.equal(saved.visit.groups[0].done, false);
  assert.equal(saved.facing, undefined);
});

test('saving stamps the time; loading never trusts a time in the future', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  assert.equal(JSON.parse(game.serialize(NOW + 5000)).lastSeen, NOW + 5000);
  const future = { ...newState(NOW, 3), createdAt: NOW + 9e9, lastSeen: NOW + 9e9 };
  const back = reviveState(future, NOW);
  assert.equal(back.lastSeen, NOW);
  assert.equal(back.createdAt, NOW);
});

test('a save from a newer version is refused rather than guessed at', () => {
  assert.equal(reviveState({ ...newState(NOW, 3), v: SAVE_VERSION + 1 }, NOW), null);
});

test('things that are not saves are refused', () => {
  for (const junk of [null, undefined, 0, 'save', [], [1], {}, { v: 1 }, { v: '1', friends: [] }, { friends: [] }, { v: 1, friends: {} }]) {
    assert.equal(reviveState(junk, NOW), null, JSON.stringify(junk));
  }
});

test('a save from before a field existed gets that field as new', () => {
  const old = JSON.parse(JSON.stringify(newState(NOW, 3)));
  old.friends[0].level = 9;
  delete old.book; delete old.settings; delete old.stats; delete old.seen; delete old.player; delete old.rooms;
  for (const friend of old.friends) delete friend.heirloom; // as if saved before Heirlooms
  const back = reviveState(old, NOW);
  const fresh = newState(NOW, 3);
  assert.equal(back.friends[0].level, 9);
  assert.equal(back.friends[0].heirloom, false);
  assert.deepEqual(back.book, fresh.book);
  assert.deepEqual(back.settings, fresh.settings);
  assert.deepEqual(back.stats, fresh.stats);
  assert.deepEqual(back.player, fresh.player);
  assert.deepEqual(back.rooms, fresh.rooms);
});

test('the scrapbook never forgets a friend: whoever is at home has been met', () => {
  const saved = JSON.parse(JSON.stringify(newState(NOW, 3)));
  saved.friends.push({ id: 9, species: 'gnome', level: 2, xp: 0, heirloom: true });
  saved.book.gnome = { met: false, heirloom: false };
  const back = reviveState(saved, NOW);
  assert.deepEqual(back.book.gnome, { met: true, heirloom: true, grown: false });
});
