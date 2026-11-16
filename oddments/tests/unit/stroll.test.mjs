// A place that has been calmed stays calm. What a save may say about a
// stroll through one, and how a stroll goes in a place you walk into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playable } from '../../web/js/core/trial.js';
import { ROOMS, SPECIES, WANDERERS } from '../../web/js/core/balance.js';
import { fairEncounter, stillAbout, someone } from '../../web/js/core/rooms.js';
import { playOut } from '../../web/js/core/auto.js';
import { howItGoes } from '../../web/js/ui/text.js';

const NOW = 1_800_000_000_000;
function calmGardenGame(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  state.rooms.garden.clears = 1;
  state.rooms.garden.calmed = 31;
  return new Game(state, { now: NOW, fx: false });
}
const back = (game, edit = () => {}) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };

test('a save made in the middle of a stroll comes back as it was', () => {
  const game = calmGardenGame();
  assert.equal(game.travelTo('garden'), true);
  const visit = game.state.visit;
  assert.equal(visit.stroll, true);
  const first = visit.groups.findIndex((group) => !group.done);
  playOut(game.startEncounter(first), {});
  game.finishBattle();
  const again = back(game);
  assert.deepEqual(again.visit.groups, game.state.visit.groups);
  assert.equal(again.visit.stroll, true);
  assert.equal(again.visit.stop, game.state.visit.stop);
  assert.ok(playable(again, NOW));
});

test('a save cannot bring a calm place\'s ringleader back, nor fill it with more wanderers than there can be', () => {
  const game = calmGardenGame(5);
  game.travelTo('garden');
  const garden = ROOMS[0];
  // A save from before the rule, or one edited by hand: all five groups waiting in a place that is calm.
  const crowded = back(game, (raw) => {
    raw.visit.stroll = false;
    raw.visit.groups = garden.path.map((spot) => ({
      foes: spot.boss ? [{ species: spot.boss, level: spot.bossLevel, heirloom: false }, { species: spot.pool[0][0], level: spot.level[0], heirloom: false }]
        : Array.from({ length: spot.size[0] }, () => ({ species: spot.pool[0][0], level: spot.level[0], heirloom: false })),
      done: false,
    }));
  });
  assert.equal(crowded.visit.stroll, true, 'calm is calm, whatever the save says');
  assert.equal(stillAbout(crowded.visit), WANDERERS.groups[1], 'no more wanderers than there can be');
  assert.deepEqual(crowded.visit.groups[4], { foes: [], done: true }, 'and no ringleader');
  crowded.visit.groups.forEach((group, stop) => { if (someone(group)) assert.ok(fairEncounter(garden, stop, group.foes)); });
  assert.ok(crowded.visit.groups.flatMap((group) => group.foes).every((foe) => !SPECIES[foe.species].boss));
  assert.ok(playable(crowded, NOW));
  // Nobody at all, or rubbish: still a stroll, with nobody about, and still playable (home for a rest, and out again).
  for (const groups of [[], [null, 7, 'x'], garden.path.map(() => ({ foes: [{ species: 'boss_hydra', level: 99, heirloom: true }], done: false }))]) {
    const empty = back(game, (raw) => { raw.visit.groups = groups; });
    assert.equal(empty.visit.stroll, true);
    assert.equal(stillAbout(empty.visit), 0);
    assert.equal(empty.visit.stop, 0);
    assert.ok(playable(empty, NOW));
  }
  // And the other way: a save cannot make a restless place a stroll.
  const fresh = new Game(newState(NOW, 5), { now: NOW, fx: false });
  fresh.state.started = true;
  fresh.travelTo('garden');
  const restless = back(fresh, (raw) => { raw.visit.stroll = true; raw.visit.groups[2] = { foes: [], done: true }; raw.visit.groups[4] = { foes: [], done: true }; });
  assert.equal(restless.visit.stroll, false);
  assert.ok(restless.visit.groups.every((group, stop) => stop === 2 || someone(group)), 'everyone not calmed is there, the ringleader too');
  assert.deepEqual(restless.visit.groups[2], { foes: [], done: true }, 'a group the save says is calmed, is');
  assert.equal(restless.rooms.garden.calmed, 0b00100, 'and stays so');
  assert.equal(restless.visit.stop, 1);
  assert.equal(restless.visit.groups[4].done, false, 'and the ringleader has not been calmed by a save saying so');
});

test('the heading says how a visit is going: groups calmed while a place is restless, wanderers about once it is calm', () => {
  const garden = ROOMS[0];
  const restless = new Game(newState(NOW, 2), { now: NOW, fx: false });
  restless.travelTo('garden');
  assert.equal(howItGoes(restless.state.visit, garden), '0 of 5 calmed');
  const game = calmGardenGame(2);
  game.travelTo('garden');
  const about = stillAbout(game.state.visit);
  assert.equal(howItGoes(game.state.visit, garden), `calm · ${about} wandering`);
  for (const group of game.state.visit.groups) group.done = true;
  assert.equal(howItGoes(game.state.visit, garden), 'calm');
});

test('a calm place you walk into is strolled the same way: wanderers on its floor, no ringleader, and it stays calm', () => {
  const state = newState(NOW, 9);
  state.started = true;
  for (const id of ['garden', 'alley', 'pantry']) { state.rooms[id].clears = 1; state.rooms[id].calmed = 31; }
  for (const friend of state.friends) friend.level = 12;
  const game = new Game(state, { now: NOW, fx: false });
  assert.equal(game.travelTo('pantry'), true);
  assert.equal(game.indoors(), 'pantry');
  const visit = state.visit;
  assert.equal(visit.stroll, true);
  const about = visit.groups.map((group, stop) => (group.done ? -1 : stop)).filter((stop) => stop >= 0);
  assert.ok(about.length >= 1 && about.length <= 3);
  assert.equal(game.heldIndoors().length, about.length, 'only the wanderers hold the floor');
  assert.equal(game.approach(4), false, 'nobody at the ringleader\'s stop');
  for (const stop of about) {
    assert.equal(game.approach(stop), true);
    assert.equal(game.meeting(), stop);
    playOut(game.startEncounter(stop), { befriend: true, have: state.friends.map((friend) => friend.species) });
    const result = game.finishBattle();
    assert.equal(result.cleared, false);
    if (!result.won) return; // (carried home: that is tested elsewhere)
  }
  assert.equal(game.nextGroup(), -1);
  assert.equal(game.startEncounter(), null);
  assert.equal(state.rooms.pantry.clears, 1);
  assert.equal(game.indoors(), 'pantry');
  assert.equal(game.goHome(), true);
  assert.equal(state.visit, null);
});
