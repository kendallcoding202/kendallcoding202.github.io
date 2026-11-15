// Rooms: who turns up at each stop, and a visit from walking in to going home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollEncounter, roomOpen, enterRoom, leaveRoom, afterFight, maxHpOf, teamOf } from '../../web/js/core/rooms.js';
import { newState } from '../../web/js/core/state.js';
import { ROOMS, SPECIES, BREATHER, TEAM_SIZE, statAt } from '../../web/js/core/balance.js';

const GARDEN = ROOMS[0];

test('whoever turns up at a stop comes from that stop\'s list, in its numbers and at its levels', () => {
  GARDEN.path.forEach((spot, stop) => {
    const seen = new Set();
    for (let seed = 1; seed <= 300; seed++) {
      const foes = rollEncounter({ rng: seed }, GARDEN, stop);
      const company = foes.filter((foe) => !SPECIES[foe.species].boss);
      assert.ok(foes.length >= 1 && foes.length <= TEAM_SIZE);
      assert.ok(company.length >= spot.size[0] && company.length <= spot.size[1], `${spot.name}: ${company.length}`);
      for (const foe of company) {
        assert.ok(spot.pool.some(([id]) => id === foe.species), `${foe.species} at ${spot.name}`);
        assert.ok(foe.level >= spot.level[0] && foe.level <= spot.level[1]);
        seen.add(foe.species);
      }
    }
    assert.equal(seen.size, spot.pool.length, `everyone on the list turns up at ${spot.name} sooner or later`);
  });
});

test('the last stop is the boss, standing in the middle of its company', () => {
  const last = GARDEN.path.length - 1;
  for (let seed = 1; seed <= 50; seed++) {
    const foes = rollEncounter({ rng: seed }, GARDEN, last);
    assert.equal(foes.length, 3);
    assert.deepEqual(foes.map((foe) => !!SPECIES[foe.species].boss), [false, true, false]);
    assert.equal(foes[1].level, GARDEN.path[last].bossLevel);
    assert.equal(foes[1].heirloom, false);
  }
  for (let stop = 0; stop < last; stop++) assert.ok(rollEncounter({ rng: 1 }, GARDEN, stop).every((foe) => !SPECIES[foe.species].boss));
});

test('the same seed meets the same company', () => {
  assert.deepEqual(rollEncounter({ rng: 77 }, GARDEN, 2), rollEncounter({ rng: 77 }, GARDEN, 2));
});

test('only the first room is open at the start; a room that is not built never opens', () => {
  const state = newState(1e12, 1);
  assert.equal(roomOpen(state, 'garden'), true);
  for (const room of ROOMS.slice(1)) assert.equal(roomOpen(state, room.id), false, room.id);
  state.rooms.garden.clears = 1;
  assert.equal(roomOpen(state, 'alley'), false, 'cleared the way to it, but it is not built in this slice');
  assert.equal(roomOpen(state, 'nowhere'), false);
  assert.equal(roomOpen(state, 'constructor'), false);
});

test('you walk in rested, at the first stop, and cannot walk in twice', () => {
  const state = newState(1e12, 1);
  assert.equal(enterRoom(state, 'alley'), false);
  assert.equal(state.visit, null);
  assert.equal(enterRoom(state, 'garden'), true);
  assert.equal(state.visit.room, 'garden');
  assert.equal(state.visit.stop, 0);
  for (const friend of teamOf(state)) assert.equal(state.visit.hp[friend.id], maxHpOf(friend));
  assert.equal(state.rooms.garden.visits, 1);
  assert.equal(enterRoom(state, 'garden'), false);
  assert.equal(state.rooms.garden.visits, 1);
});

test('after a win everyone takes a breather and the visit moves to the next stop', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  const [a, b, c] = teamOf(state);
  const moved = afterFight(state, true, { [a.id]: 10, [b.id]: 0, [c.id]: maxHpOf(c) });
  assert.deepEqual(moved, { cleared: false, home: false });
  assert.equal(state.visit.stop, 1);
  assert.equal(state.visit.hp[a.id], 10 + Math.ceil(maxHpOf(a) * BREATHER));
  assert.equal(state.visit.hp[b.id], Math.ceil(maxHpOf(b) * BREATHER), 'whoever was knocked down gets up again');
  assert.equal(state.visit.hp[c.id], maxHpOf(c), 'never past full');
  assert.equal(state.rooms.garden.best, 1);
});

test('a loss sends you home and is counted; nothing else is taken', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  afterFight(state, true, {});
  const friends = JSON.stringify(state.friends);
  assert.deepEqual(afterFight(state, false, {}), { cleared: false, home: true });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 0, losses: 1, best: 1 });
  assert.equal(JSON.stringify(state.friends), friends);
  assert.equal(enterRoom(state, 'garden'), true, 'and you can set straight out again, rested');
  assert.equal(state.visit.stop, 0);
});

test('beating the boss clears the room and sends you home', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  for (let stop = 0; stop < GARDEN.path.length - 1; stop++) assert.deepEqual(afterFight(state, true, {}), { cleared: false, home: false });
  assert.deepEqual(afterFight(state, true, {}), { cleared: true, home: true });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 1, losses: 0, best: GARDEN.path.length });
});

test('going home early is allowed and costs nothing', () => {
  const state = newState(1e12, 1);
  assert.equal(leaveRoom(state), false, 'not when already at home');
  enterRoom(state, 'garden');
  assert.equal(leaveRoom(state), true);
  assert.equal(state.visit, null);
  assert.equal(state.rooms.garden.losses, 0);
});

test('Health is worked out from kind and level', () => {
  assert.equal(maxHpOf({ species: 'sockeel', level: 3 }), statAt(SPECIES.sockeel.hp, 3));
});
