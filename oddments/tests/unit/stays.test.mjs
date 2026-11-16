// Whoever you calm stays calm: what a save keeps of it, what a save from before
// the rule wakes up as, and how the heading puts it. (The rule itself is in
// rooms.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { ROOMS, WANDERERS } from '../../web/js/core/balance.js';
import { fairEncounter, wandering, stillAbout, calmedIn, staysCalm } from '../../web/js/core/rooms.js';
import { playable } from '../../web/js/core/trial.js';
import { playOut } from '../../web/js/core/auto.js';
import { howItGoes } from '../../web/js/ui/text.js';

const NOW = 1_800_000_000_000;
const GARDEN = ROOMS[0];
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}
const back = (game, edit = () => {}) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };

test('a save keeps who is calm: rested at home, part way through a visit, and with wanderers about', () => {
  const game = fresh(6);
  game.travelTo('garden');
  for (const stop of [0, 1]) { playOut(game.startEncounter(stop), {}); assert.equal(game.finishBattle().won, true); }
  // Part way through a visit.
  let woke = back(game);
  assert.deepEqual(woke.rooms.garden, game.state.rooms.garden);
  assert.equal(woke.rooms.garden.calmed, 0b00011);
  assert.deepEqual(woke.visit, game.state.visit, 'the visit comes back as it was');
  assert.equal(woke.visit.stop, 2);
  // Rested.
  game.goHome();
  woke = back(game);
  assert.equal(woke.visit, null);
  assert.equal(calmedIn(woke, 'garden'), 2);
  // Out again: one wanderer at one of the two calm stops, and the save keeps it as a wanderer.
  game.travelTo('garden');
  const about = [0, 1].filter((stop) => wandering(game.state.visit, stop));
  assert.equal(about.length, 1);
  woke = back(game);
  assert.deepEqual(woke.visit, game.state.visit);
  assert.equal(woke.visit.groups[about[0]].wander, true);
  assert.equal(howItGoes(woke.visit, GARDEN), '2 of 5 calmed · 1 wandering');
  assert.ok(playable(woke, NOW));
  // Calm the wanderer and it is still two of five; the heading drops the wanderer.
  playOut(game.startEncounter(about[0]), {});
  assert.equal(game.finishBattle().won, true);
  assert.equal(howItGoes(game.state.visit, GARDEN), '2 of 5 calmed');
  assert.deepEqual(back(game).visit, game.state.visit);
});

test('a save from before groups stayed calm wakes up with as many calm as it had ever calmed in one go', () => {
  const game = fresh(2);
  const old = (best, extra = {}) => back(game, (raw) => { delete raw.rooms.garden.calmed; raw.rooms.garden.best = best; Object.assign(raw.rooms.garden, extra); });
  assert.equal(old(0).rooms.garden.calmed, 0);
  assert.equal(old(3).rooms.garden.calmed, 0b00111);
  assert.equal(old(5).rooms.garden.calmed, 0b01111, 'never the ringleader: calming that is calming the place');
  assert.equal(old(99).rooms.garden.calmed, 0b01111, 'however big the number');
  assert.equal(old('lots').rooms.garden.calmed, 0, 'and something that is no number is none');
  assert.equal(old(2, { clears: 1 }).rooms.garden.calmed, 0b11111, 'a calm place is calm all through');
  assert.equal('best' in old(3).rooms.garden, false, 'the old count is not kept');
  // In the middle of a visit, whoever that visit had calmed is calm as well.
  game.travelTo('garden');
  playOut(game.startEncounter(3), {});
  game.finishBattle();
  const mid = back(game, (raw) => { delete raw.rooms.garden.calmed; raw.rooms.garden.best = 1; });
  assert.equal(mid.rooms.garden.calmed, 0b01001);
  assert.deepEqual(mid.visit.groups.map((group) => group.done), [true, false, false, true, false]);
  assert.equal(mid.visit.stop, 2);
  assert.ok(playable(mid, NOW));
});

test('a save cannot calm a ringleader, call somebody restless a wanderer, or crowd the calm stops', () => {
  const game = fresh(9);
  for (const junk of [-1, 1e9, 2.5, '7', null, [], true]) {
    const woke = back(game, (raw) => { raw.rooms.garden.calmed = junk; });
    assert.ok(Number.isInteger(woke.rooms.garden.calmed) && woke.rooms.garden.calmed >= 0 && woke.rooms.garden.calmed <= 0b01111, String(junk));
    assert.equal(staysCalm(woke, 'garden', 4), false, String(junk));
  }
  assert.equal(back(game, (raw) => { raw.rooms.garden.calmed = 0b11111; }).rooms.garden.calmed, 0b01111, 'every bit set is not a calm place');
  assert.equal(back(game, (raw) => { raw.rooms.garden.calmed = 0b11111; }).rooms.garden.clears, 0);
  // On a visit: a restless group marked as a wanderer is still restless, and still has to be calmed.
  game.travelTo('garden');
  const fibbed = back(game, (raw) => { for (const group of raw.visit.groups) group.wander = true; });
  assert.ok(fibbed.visit.groups.every((group) => !group.wander && !group.done));
  assert.equal(fibbed.visit.stop, 0);
  // With four calm, a save that puts somebody at every one of them keeps as many as there can be.
  game.goHome();
  game.state.rooms.garden.calmed = 0b01111;
  game.travelTo('garden');
  const crowded = back(game, (raw) => {
    raw.visit.groups = GARDEN.path.map((spot, stop) => (stop === 4 ? raw.visit.groups[4]
      : { foes: Array.from({ length: spot.size[0] }, () => ({ species: spot.pool[0][0], level: spot.level[0], heirloom: false })), done: false, wander: true }));
  });
  assert.equal(crowded.visit.groups.filter((_, stop) => wandering(crowded.visit, stop)).length, WANDERERS.groups[1]);
  assert.equal(stillAbout(crowded.visit), WANDERERS.groups[1] + 1);
  crowded.visit.groups.forEach((group, stop) => { if (group.foes.length) assert.ok(fairEncounter(GARDEN, stop, group.foes)); });
  assert.equal(crowded.visit.stop, 4);
  assert.ok(playable(crowded, NOW));
  // Somebody unfair at a calm stop is nobody; a save cannot put the ringleader's company there.
  const odd = back(game, (raw) => { raw.visit.groups[0] = { foes: [{ species: 'boss_hydra', level: 3, heirloom: false }], done: false, wander: true }; });
  assert.deepEqual(odd.visit.groups[0], { foes: [], done: true });
});

test('nobody is stuck at the first ringleader: even tapping at random, with new friends and nobody else left to calm, practice on the wanderers gets you there', () => {
  // The worst case there is: the three you set out with, at the levels they set out at, and only Old Summerlong left.
  let most = 0;
  for (let player = 0; player < 16; player++) {
    const game = fresh(500 + player * 7919);
    game.state.rooms.garden.calmed = 0b01111;
    let outings = 0;
    while (game.state.rooms.garden.clears === 0 && outings < 40) {
      outings++;
      assert.equal(game.travelTo('garden'), true);
      for (let stop = 0; stop < 4 && game.place() === 'path'; stop++) {
        if (wandering(game.state.visit, stop)) { playOut(game.startEncounter(stop), { careless: true }); game.finishBattle(); }
      }
      if (game.place() === 'path') { playOut(game.startEncounter(4), { careless: true }); game.finishBattle(); }
      if (game.place() === 'path') game.goHome();
    }
    assert.equal(game.state.rooms.garden.clears, 1, `player ${player} calmed the garden`);
    most = Math.max(most, outings);
  }
  assert.ok(most <= 25, `the slowest took ${most} outings`);
});
