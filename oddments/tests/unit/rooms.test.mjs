// Rooms: who is restless at each stop of a place, and a visit from stepping in to resting at home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollEncounter, fairEncounter, poolOf, placeCalm, canMeet, nextGroup, roomOpen, enterRoom, leaveRoom, afterFight, heldBy, maxHpOf, teamOf } from '../../web/js/core/rooms.js';
import { BARRICADE, districtOf } from '../../web/js/core/world.js';
import { newState } from '../../web/js/core/state.js';
import { ROOMS, SPECIES, BREATHER, TEAM_SIZE, VISITORS, START_TEAM, statAt } from '../../web/js/core/balance.js';

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

test('only the first place is open at the start; each opens when the one before is calm; one that is not built never opens', () => {
  const state = newState(1e12, 1);
  assert.equal(roomOpen(state, 'garden'), true);
  for (const room of ROOMS.slice(1)) assert.equal(roomOpen(state, room.id), false, room.id);
  state.rooms.garden.clears = 1;
  assert.equal(roomOpen(state, 'alley'), true);
  assert.equal(roomOpen(state, 'pantry'), false);
  state.rooms.alley.clears = 1;
  assert.equal(roomOpen(state, 'pantry'), false, 'cleared the way to it, but it is not built in this slice');
  assert.equal(roomOpen(state, 'nowhere'), false);
  assert.equal(roomOpen(state, 'constructor'), false);
});

test('ground is held by a barricade while a place is shut, by cover while you are elsewhere, by groups while you call', () => {
  const garden = districtOf('garden');
  const alley = districtOf('alley');
  const shut = { x: alley.gate.x, y: alley.gate.y, r: BARRICADE };
  const state = newState(1e12, 1);
  // A new game: everyone in the garden is in the bushes; the alley is barricaded, and its bins are full.
  assert.deepEqual(heldBy(state), [...garden.posts, shut, ...alley.posts]);
  assert.ok(BARRICADE * 2 > 140, 'a barricade fills the gateway from post to post');
  // Calling on the garden, its groups hold their ground until calmed.
  enterRoom(state, 'garden');
  state.visit.groups[1].done = true;
  assert.deepEqual(heldBy(state), [...garden.posts.filter((_, i) => i !== 1), shut, ...alley.posts]);
  // Calm the garden: the barricade comes down. Standing in the garden with no visit on, nothing is held there.
  state.visit = null;
  state.rooms.garden.clears = 1;
  assert.deepEqual(heldBy(state, garden.posts[0]), alley.posts);
  assert.deepEqual(heldBy(state, { x: 1180, y: 1454 }), [...garden.posts, ...alley.posts]);
  // One visit at a time: while you are calling on one place, the other keeps to its cover, even if you walk in.
  enterRoom(state, 'alley');
  assert.deepEqual(heldBy(state, garden.posts[0]), [...garden.posts, ...alley.posts]);
  // And the answer is for wherever is asked about, which need not be where the save says you stand.
  state.visit = null;
  state.where = { ...alley.posts[2] };
  assert.deepEqual(heldBy(state), garden.posts);
  assert.deepEqual(heldBy(state, null), [...garden.posts, ...alley.posts]);
});

test('once a place is calm, kinds like your first three come calling there: never before, never beside its ringleader', () => {
  assert.deepEqual(VISITORS.kinds, START_TEAM.map(([id]) => id));
  assert.ok(VISITORS.weight > 0 && VISITORS.weight < 1, 'a visitor is less likely than anyone who lives there');
  for (const room of ROOMS.filter((r) => r.path)) {
    room.path.forEach((spot, stop) => {
      assert.equal(poolOf(room, stop, false), spot.pool, 'not calm: only who lives there');
      assert.equal(poolOf(room, stop), spot.pool);
      const calm = poolOf(room, stop, true);
      if (spot.boss) { assert.equal(calm, spot.pool, 'nobody visits a ringleader'); return; }
      assert.deepEqual(calm.slice(0, spot.pool.length), spot.pool, 'calm: everyone who lives there, as before');
      assert.deepEqual(calm.slice(spot.pool.length), VISITORS.kinds.map((id) => [id, VISITORS.weight]));
    });
  }
  // Rolled many times: no visitor ever turns up while the place is restless, some do once it is calm, none with the boss.
  const seenAt = (calm) => { const kinds = new Set(); for (let seed = 1; seed <= 600; seed++) for (let stop = 0; stop < 5; stop++) for (const foe of rollEncounter({ rng: seed * 17 }, GARDEN, stop, calm)) kinds.add(`${stop}:${foe.species}`); return kinds; };
  const restless = seenAt(false);
  const calm = seenAt(true);
  for (const id of VISITORS.kinds) {
    for (let stop = 0; stop < 5; stop++) assert.equal(restless.has(`${stop}:${id}`), false, `${id} in a restless garden`);
    for (let stop = 0; stop < 4; stop++) assert.equal(calm.has(`${stop}:${id}`), true, `${id} never visits stop ${stop + 1} of a calm garden`);
    assert.equal(calm.has(`4:${id}`), false, `${id} beside the Sprinkler`);
  }
  // A visitor is a fair thing to find at a stop visitors can come to, at that stop's levels, and nowhere else.
  const level = GARDEN.path[1].level[0];
  assert.equal(fairEncounter(GARDEN, 1, [{ species: 'dustbunny', level, heirloom: true }, { species: 'sockeel', level, heirloom: false }]), true);
  assert.equal(fairEncounter(GARDEN, 1, [{ species: 'dustbunny', level: level + 9, heirloom: false }, { species: 'sockeel', level, heirloom: false }]), false, 'not at any level it likes');
  assert.equal(fairEncounter(GARDEN, 4, [{ species: 'dustbunny', level: 3, heirloom: false }, { species: 'boss_hydra', level: 5, heirloom: false }, { species: 'dandepuff', level: 3, heirloom: false }]), false, 'not beside the boss');
});

test('stepping into a place you have calmed rolls it as calm; a seed throws the same dice either way', () => {
  assert.equal(placeCalm(newState(1e12, 1), 'garden'), false);
  for (const odd of ['nowhere', 'constructor', null]) assert.equal(placeCalm(newState(1e12, 1), odd), false);
  let visitors = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const first = newState(1e12, seed);
    const again = newState(1e12, seed);
    again.rooms.garden.clears = 1;
    assert.equal(placeCalm(again, 'garden'), true);
    enterRoom(first, 'garden');
    enterRoom(again, 'garden');
    assert.equal(first.rng, again.rng, 'the same number of dice thrown');
    first.visit.groups.forEach((group, stop) => {
      assert.equal(group.foes.length, again.visit.groups[stop].foes.length, 'the same numbers of them');
      assert.deepEqual(group.foes.map((foe) => foe.level), again.visit.groups[stop].foes.map((foe) => foe.level), 'at the same levels');
      for (const foe of group.foes) assert.equal(VISITORS.kinds.includes(foe.species), false);
    });
    visitors += again.visit.groups.flatMap((group) => group.foes).filter((foe) => VISITORS.kinds.includes(foe.species)).length;
  }
  assert.ok(visitors >= 20, `${visitors} visitors in 60 calm gardens`);
});

test('you step in rested, with every group already waiting, and cannot step in twice', () => {
  const state = newState(1e12, 1);
  assert.equal(enterRoom(state, 'alley'), false);
  assert.equal(state.visit, null);
  assert.equal(enterRoom(state, 'garden'), true);
  assert.equal(state.visit.room, 'garden');
  assert.equal(state.visit.stop, 0);
  assert.equal(state.visit.groups.length, GARDEN.path.length);
  state.visit.groups.forEach((group, stop) => {
    assert.equal(group.done, false);
    assert.equal(fairEncounter(GARDEN, stop, group.foes), true, `${GARDEN.path[stop].name} is a fair roll for its stop`);
  });
  for (const friend of teamOf(state)) assert.equal(state.visit.hp[friend.id], maxHpOf(friend));
  assert.equal(state.rooms.garden.visits, 1);
  assert.equal(enterRoom(state, 'garden'), false);
  assert.equal(state.rooms.garden.visits, 1);
});

test('groups can be met in any order, but the boss only once everyone else is calm', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  const last = GARDEN.path.length - 1;
  for (let stop = 0; stop < last; stop++) assert.equal(canMeet(state.visit, GARDEN, stop), true);
  assert.equal(canMeet(state.visit, GARDEN, last), false, 'not the boss yet');
  assert.equal(nextGroup(state.visit, GARDEN), 0);
  for (const odd of [-1, last + 1, 1.5, '0', null, undefined, NaN]) assert.equal(canMeet(state.visit, GARDEN, odd), false, String(odd));
  assert.equal(canMeet(null, GARDEN, 0), false);

  afterFight(state, 3, true, {});
  afterFight(state, 0, true, {});
  assert.equal(canMeet(state.visit, GARDEN, 3), false, 'nobody is met twice');
  assert.equal(nextGroup(state.visit, GARDEN), 1);
  assert.equal(canMeet(state.visit, GARDEN, last), false);
  afterFight(state, 2, true, {});
  afterFight(state, 1, true, {});
  assert.equal(state.visit.stop, last);
  assert.equal(canMeet(state.visit, GARDEN, last), true, 'now the boss will face you');
  assert.equal(nextGroup(state.visit, GARDEN), last);
});

test('after a win that group is calm, everyone takes a breather, and the rest are still waiting', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  const [a, b, c] = teamOf(state);
  const before = JSON.stringify(state.visit.groups.map((group) => group.foes));
  const moved = afterFight(state, 2, true, { [a.id]: 10, [b.id]: 0, [c.id]: maxHpOf(c) });
  assert.deepEqual(moved, { cleared: false, home: false });
  assert.equal(state.visit.stop, 1);
  assert.deepEqual(state.visit.groups.map((group) => group.done), [false, false, true, false, false]);
  assert.equal(JSON.stringify(state.visit.groups.map((group) => group.foes)), before, 'nobody else changes while you fight');
  assert.equal(state.visit.hp[a.id], 10 + Math.ceil(maxHpOf(a) * BREATHER));
  assert.equal(state.visit.hp[b.id], Math.ceil(maxHpOf(b) * BREATHER), 'whoever was knocked down gets up again');
  assert.equal(state.visit.hp[c.id], maxHpOf(c), 'never past full');
  assert.equal(state.rooms.garden.best, 1);
});

test('a loss sends you home and is counted; nothing else is taken', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  afterFight(state, 0, true, {});
  const friends = JSON.stringify(state.friends);
  assert.deepEqual(afterFight(state, 1, false, {}), { cleared: false, home: true });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 0, losses: 1, best: 1 });
  assert.equal(JSON.stringify(state.friends), friends);
  assert.equal(enterRoom(state, 'garden'), true, 'and you can set straight out again, rested');
  assert.equal(state.visit.stop, 0);
  assert.ok(state.visit.groups.every((group) => !group.done), 'with everyone restless again');
});

test('calming the boss clears the place and ends the visit where you stand', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  for (let stop = 0; stop < GARDEN.path.length - 1; stop++) assert.deepEqual(afterFight(state, stop, true, {}), { cleared: false, home: false });
  assert.deepEqual(afterFight(state, GARDEN.path.length - 1, true, {}), { cleared: true, home: false });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 1, losses: 0, best: GARDEN.path.length });
});

test('resting early is allowed and costs nothing', () => {
  const state = newState(1e12, 1);
  assert.equal(leaveRoom(state), false, 'not when already rested');
  enterRoom(state, 'garden');
  assert.equal(leaveRoom(state), true);
  assert.equal(state.visit, null);
  assert.equal(state.rooms.garden.losses, 0);
});

test('Health is worked out from kind and level', () => {
  assert.equal(maxHpOf({ species: 'sockeel', level: 3 }), statAt(SPECIES.sockeel.hp, 3));
});
