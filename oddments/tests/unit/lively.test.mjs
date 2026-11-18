// Something to come back for each day: one calm place is lively tonight, a
// different one each real day. More wander there, and far more of them are in
// their rare colours. The rules keep no clock: whoever runs the game says what
// day it is. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { ROOMS, HEIRLOOM, WANDERERS, LIVELY } from '../../web/js/core/balance.js';
import { livelyPlace, rollEncounter, enterRoom, leaveRoom, wanderersMost, someone } from '../../web/js/core/rooms.js';
import { tonightOf } from '../../web/js/core/story.js';

const NOW = 1_800_000_000_000;
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
const calm = (game, count) => { for (const room of ROOMS.slice(0, count)) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 0b11111; } return game; };

test('nothing is lively until somebody says what day it is, and nowhere is until somewhere is calm', () => {
  const game = calm(fresh(), 5);
  assert.equal(game.state.day, 0);
  assert.equal(livelyPlace(game.state), null, 'a test or the simulator, which say no day, play as they always did');
  assert.equal(game.lively(), null);
  assert.equal(game.tonight(), null);
  assert.equal(tonightOf(null), null);
  const none = fresh();
  assert.equal(none.setDay(20_000), true);
  assert.equal(livelyPlace(none.state), null, 'with nowhere calm there is nowhere to be lively');
  // Only a whole, positive, sensible number is a day.
  for (const odd of [0, -3, 1.5, NaN, Infinity, '20000', null, undefined, 1e6, 1e9]) assert.equal(game.setDay(odd), false, String(odd));
  assert.equal(game.state.day, 0);
  assert.equal(game.setDay(20_000), true);
  assert.equal(game.setDay(20_000), false, 'the same day again changes nothing');
  assert.equal(game.state.day, 20_000);
});

test('each day one calm place is lively: a different one each day, going round them all before any comes again', () => {
  for (let count = 1; count <= ROOMS.length; count++) {
    const game = calm(fresh(), count);
    const calmIds = ROOMS.slice(0, count).map((room) => room.id);
    const seen = [];
    for (let day = 20_000; day < 20_000 + count * 3; day++) {
      game.setDay(day);
      const room = livelyPlace(game.state);
      assert.ok(room && calmIds.includes(room.id), `with ${count} calm, it is one of them`);
      assert.equal(game.lively(), room.id);
      seen.push(room.id);
    }
    for (let i = 1; i < seen.length; i++) if (count > 1) assert.notEqual(seen[i], seen[i - 1], `with ${count} calm, never the same two days running`);
    // In any run of as many days as there are calm places, each has its day exactly once.
    for (let start = 0; start + count <= seen.length; start++) assert.equal(new Set(seen.slice(start, start + count)).size, count, `with ${count} calm, each has its turn`);
    // And it is not simply down the lane in order, once there are enough of them for that to show.
    if (count >= 4) assert.notDeepEqual(seen.slice(0, count), [...calmIds.slice(seen.length ? calmIds.indexOf(seen[0]) : 0), ...calmIds.slice(0, calmIds.indexOf(seen[0]))]);
  }
  // A place that is not calm is never the one, however the days fall.
  const game = calm(fresh(), 3);
  for (let day = 1; day < 400; day++) { game.setDay(day); assert.ok(['garden', 'alley', 'pantry'].includes(game.lively())); }
});

test('the lively place has more wandering in it that night, and far more of them in their rare colours; nowhere else changes', () => {
  const tally = (lively) => {
    let groups = 0; let visits = 0; let rare = 0; let all = 0; let fewest = 99; let most = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const game = calm(fresh(seed), 6);
      // Find a day on which the Wash is the lively place, or one on which it is not.
      let day = 20_000;
      game.setDay(day);
      while ((game.lively() === 'wash') !== lively) game.setDay(++day);
      assert.equal(wanderersMost(game.state, 'wash'), lively ? LIVELY.groups[1] : WANDERERS.groups[1]);
      assert.equal(enterRoom(game.state, 'wash'), true);
      assert.equal(game.state.visit.stroll, true);
      const about = game.state.visit.groups.filter((group) => someone(group));
      assert.ok(about.every((group) => !group.foes.some((foe) => foe.species.startsWith('boss_'))), 'a calm place has no ringleader in it, lively or not');
      groups += about.length; visits++;
      fewest = Math.min(fewest, about.length); most = Math.max(most, about.length);
      for (const group of about) for (const foe of group.foes) { all++; if (foe.heirloom) rare++; }
      leaveRoom(game.state);
    }
    return { groups: groups / visits, fewest, most, rare: rare / all };
  };
  const quiet = tally(false);
  const busy = tally(true);
  assert.ok(quiet.fewest >= WANDERERS.groups[0] && quiet.most <= WANDERERS.groups[1], `an ordinary night: ${quiet.fewest} to ${quiet.most} groups`);
  assert.ok(busy.fewest >= LIVELY.groups[0] && busy.most <= LIVELY.groups[1], `a lively night: ${busy.fewest} to ${busy.most} groups`);
  assert.ok(busy.groups > quiet.groups + 1, `${busy.groups} groups on a lively night against ${quiet.groups}`);
  assert.ok(Math.abs(quiet.rare - HEIRLOOM.calmOdds) < 0.02, `an ordinary night: ${quiet.rare} of them in rare colours`);
  assert.ok(Math.abs(busy.rare - LIVELY.heirloom) < 0.03, `a lively night: ${busy.rare}`);
  assert.ok(LIVELY.heirloom >= HEIRLOOM.calmOdds * 2.5 && LIVELY.heirloom <= 0.25);
  assert.ok(LIVELY.groups[0] > WANDERERS.groups[0] && LIVELY.groups[1] <= 4, 'never so many that a calm place has someone at every stop');
});

test('the same dice are thrown whether a place is lively or not, so a seed\'s run of luck does not shift', () => {
  const wash = ROOMS.find((room) => room.id === 'wash');
  for (let seed = 1; seed <= 60; seed++) {
    const a = { rng: seed * 7919 };
    const b = { rng: seed * 7919 };
    const plain = rollEncounter(a, wash, seed % 4, true, false);
    const lively = rollEncounter(b, wash, seed % 4, true, true);
    assert.equal(a.rng, b.rng);
    assert.deepEqual(plain.map((foe) => [foe.species, foe.level]), lively.map((foe) => [foe.species, foe.level]), 'the same ones turn up: only their colours may differ');
    // And a place that is not calm is never lively, whatever is asked.
    const c = { rng: seed * 7919 };
    const d = { rng: seed * 7919 };
    assert.deepEqual(rollEncounter(c, wash, seed % 4, false, true), rollEncounter(d, wash, seed % 4, false, false));
  }
});

test('the journal says which place it is; the day is saved, and a save cannot say anything silly about it', () => {
  const game = calm(fresh(4), 4);
  game.setDay(20_123);
  const tonight = game.tonight();
  const room = livelyPlace(game.state);
  assert.deepEqual([tonight.room, tonight.title], [room.id, `${room.name} is lively tonight`]);
  assert.ok(tonight.detail.length > 60 && tonight.detail.length < 200 && /rare colours/.test(tonight.detail) && /Tomorrow/.test(tonight.detail));
  const raw = JSON.parse(game.serialize(NOW));
  assert.equal(raw.day, 20_123);
  assert.equal(reviveState(JSON.parse(JSON.stringify(raw)), NOW).day, 20_123);
  for (const odd of [-1, 0, 2.5, '7', null, [], {}, 1e6, 1e300]) assert.equal(reviveState({ ...JSON.parse(JSON.stringify(raw)), day: odd }, NOW).day, 0, JSON.stringify(odd));
  const old = JSON.parse(JSON.stringify(raw));
  delete old.day;
  assert.equal(reviveState(old, NOW).day, 0, 'a save from before there were days has none');
});
