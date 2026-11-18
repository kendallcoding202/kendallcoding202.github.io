// Rooms: who is restless at each stop of a place, and a visit from stepping in to resting at home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollEncounter, fairEncounter, poolOf, placeCalm, staysCalm, calmedIn, wandering, wanderersMost, canMeet, nextGroup, roomOpen, enterRoom, leaveRoom, afterFight, heldBy, maxHpOf, teamOf, someone, stillAbout } from '../../web/js/core/rooms.js';
import { BARRICADE, districtOf, BRIDGE } from '../../web/js/core/world.js';
import { newState } from '../../web/js/core/state.js';
import { ROOMS, SPECIES, BREATHER, TEAM_SIZE, VISITORS, WANDERERS, START_TEAM, statAt, roomOf } from '../../web/js/core/balance.js';

// The gate on Kettle Bridge holds its ground until the whole lane is calm (tests/unit/farbank.test.mjs).
// These tests are about the places themselves, so they look at what is held apart from it.
const land = (held) => held.filter((spot) => !(spot.x === BRIDGE.gate.x && spot.y === BRIDGE.gate.y));


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

test('only the first place is open at the start; each opens when the one before is calm, and not before', () => {
  const state = newState(1e12, 1);
  assert.equal(roomOpen(state, ROOMS[0].id), true);
  for (const room of ROOMS.slice(1)) assert.equal(roomOpen(state, room.id), false, room.id);
  ROOMS.forEach((room, i) => {
    state.rooms[room.id].clears = 1;
    ROOMS.forEach((other, j) => assert.equal(roomOpen(state, other.id), j <= i + 1, `${room.id} calm: ${other.id}`));
  });
  // Calm out of turn opens nothing before its time.
  const skip = newState(1e12, 1);
  skip.rooms.pantry.clears = 1;
  assert.equal(roomOpen(skip, 'alley'), false);
  assert.equal(roomOpen(skip, 'wash'), true, 'the place after a calm one is open, whatever came before');
  assert.equal(roomOpen(state, 'nowhere'), false);
  assert.equal(roomOpen(state, 'constructor'), false);
});

test('ground is held by a barricade while a place is shut, by cover while you are elsewhere, by groups while you call', () => {
  const garden = districtOf('garden');
  const alley = districtOf('alley');
  const shut = { x: alley.gate.x, y: alley.gate.y, r: BARRICADE };
  const state = newState(1e12, 1);
  // A new game: everyone in the garden is in the bushes; the alley is barricaded, and its bins are full.
  assert.deepEqual(land(heldBy(state)), [...garden.posts, shut, ...alley.posts]);
  assert.ok(BARRICADE * 2 > 140, 'a barricade fills the gateway from post to post');
  // Calling on the garden, its groups hold their ground until calmed.
  enterRoom(state, 'garden');
  state.visit.groups[1].done = true;
  assert.deepEqual(land(heldBy(state)), [...garden.posts.filter((_, i) => i !== 1), shut, ...alley.posts]);
  // Calm the garden: the barricade comes down. Standing in the garden with no visit on, nothing is held there.
  state.visit = null;
  state.rooms.garden.clears = 1;
  assert.deepEqual(land(heldBy(state, garden.posts[0])), alley.posts);
  // A calm place stays calm: nobody is back in its bushes, from wherever you look.
  assert.deepEqual(land(heldBy(state, { x: 1180, y: 1454 })), alley.posts);
  // One visit at a time: strolling in the calm garden, the alley keeps to its cover, even if you walk in.
  enterRoom(state, 'garden');
  const strolling = garden.posts.filter((_, i) => !state.visit.groups[i].done);
  assert.ok(strolling.length >= 1 && strolling.length <= 3);
  assert.deepEqual(land(heldBy(state, alley.posts[2])), [...strolling, ...alley.posts]);
  // Calling on the alley, its groups hold their ground, and the calm garden holds none.
  state.visit = null;
  enterRoom(state, 'alley');
  assert.deepEqual(land(heldBy(state, garden.posts[0])), alley.posts);
  // And the answer is for wherever is asked about, which need not be where the save says you stand.
  state.visit = null;
  state.where = { ...alley.posts[2] };
  assert.deepEqual(land(heldBy(state)), [], 'standing in the alley with no visit on, nothing is held there; nor in the calm garden');
  assert.deepEqual(land(heldBy(state, null)), alley.posts);
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

test('a place you have calmed stays calm: stepping in is a stroll, with a few wanderers and no ringleader', () => {
  assert.equal(placeCalm(newState(1e12, 1), 'garden'), false);
  for (const odd of ['nowhere', 'constructor', null]) assert.equal(placeCalm(newState(1e12, 1), odd), false);
  assert.deepEqual(WANDERERS.groups, [1, 3]);
  const garden = ROOMS[0];
  let visitors = 0;
  const counts = new Set();
  const stops = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const first = newState(1e12, seed);
    enterRoom(first, 'garden');
    assert.equal(first.visit.stroll, false);
    assert.ok(first.visit.groups.every((group) => someone(group) && !group.done), 'restless, every stop has its group');
    for (const group of first.visit.groups) for (const foe of group.foes) assert.equal(VISITORS.kinds.includes(foe.species), false);

    const again = newState(1e12, seed);
    again.rooms.garden.clears = 1;
    assert.equal(placeCalm(again, 'garden'), true);
    enterRoom(again, 'garden');
    const visit = again.visit;
    assert.equal(visit.stroll, true);
    assert.equal(visit.stop, 0);
    assert.equal(visit.groups.length, garden.path.length, 'a place for every stop still, most of them with nobody at them');
    const about = visit.groups.filter((group) => !group.done);
    assert.equal(stillAbout(visit), about.length);
    assert.ok(about.length >= 1 && about.length <= 3);
    counts.add(about.length);
    assert.deepEqual(visit.groups[garden.path.length - 1], { foes: [], done: true }, 'no ringleader');
    visit.groups.forEach((group, stop) => {
      if (group.done) { assert.deepEqual(group, { foes: [], done: true }); assert.equal(someone(group), false); return; }
      stops.add(stop);
      assert.ok(fairEncounter(garden, stop, group.foes), 'a wanderer is a fair roll for the stop it is at');
      assert.ok(group.foes.every((foe) => !SPECIES[foe.species].boss));
    });
    visitors += about.flatMap((group) => group.foes).filter((foe) => VISITORS.kinds.includes(foe.species)).length;
    assert.equal(again.rooms.garden.clears, 1);
    // The same seed strolls the same stroll.
    const twin = newState(1e12, seed);
    twin.rooms.garden.clears = 1;
    enterRoom(twin, 'garden');
    assert.deepEqual(twin.visit, visit);
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3], 'one, two or three groups of them');
  assert.deepEqual([...stops].sort(), [0, 1, 2, 3], 'at any stop but the ringleader\'s');
  assert.ok(visitors >= 20, `${visitors} visitors among the wanderers of 200 calm gardens`);
});

test('a stroll is counted in wanderers calmed, cannot calm the place again, and ends when you rest', () => {
  const state = newState(1e12, 4);
  state.rooms.garden.clears = 1;
  state.rooms.garden.calmed = 31;
  enterRoom(state, 'garden');
  const garden = ROOMS[0];
  const about = state.visit.groups.map((group, stop) => (group.done ? -1 : stop)).filter((stop) => stop >= 0);
  assert.equal(canMeet(state.visit, garden, 4), false, 'there is no ringleader to meet');
  assert.equal(nextGroup(state.visit, garden), about[0]);
  about.forEach((stop, i) => {
    assert.equal(canMeet(state.visit, garden, stop), true);
    const left = Object.fromEntries(Object.keys(state.visit.hp).map((id) => [id, 5]));
    assert.deepEqual(afterFight(state, stop, true, left), { cleared: false, home: false });
    assert.equal(state.visit.stop, i + 1);
  });
  assert.equal(nextGroup(state.visit, garden), -1, 'everyone met: nobody about until you have rested');
  assert.equal(stillAbout(state.visit), 0);
  assert.deepEqual([state.rooms.garden.clears, state.rooms.garden.calmed], [1, 31], 'the record of calming it stands as it was');
  assert.equal(leaveRoom(state), true);
  assert.equal(enterRoom(state, 'garden'), true);
  assert.ok(stillAbout(state.visit) >= 1, 'and after a rest, others have wandered in');
  // A loss on a stroll is a loss like any other: carried home.
  const stop = state.visit.groups.findIndex((group) => !group.done);
  assert.deepEqual(afterFight(state, stop, false, {}), { cleared: false, home: true });
  assert.equal(state.visit, null);
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
  assert.equal(state.rooms.garden.calmed, 0b00100, 'and the place remembers who is calm');
  assert.deepEqual([0, 1, 2, 3, 4].map((stop) => staysCalm(state, 'garden', stop)), [false, false, true, false, false]);
  assert.equal(calmedIn(state, 'garden'), 1);
});

test('a loss sends you home and is counted; nothing is taken, and whoever you calmed before it stays calm', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  afterFight(state, 0, true, {});
  const friends = JSON.stringify(state.friends);
  assert.deepEqual(afterFight(state, 1, false, {}), { cleared: false, home: true });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 0, losses: 1, calmed: 0b00001 });
  assert.equal(JSON.stringify(state.friends), friends);
  assert.equal(enterRoom(state, 'garden'), true, 'and you can set straight out again, rested');
  assert.equal(state.visit.stop, 1);
  assert.deepEqual(state.visit.groups.map((group) => group.done), [true, false, false, false, false], 'with only the others still waiting');
  assert.deepEqual(state.visit.groups[0], { foes: [], done: true });
});

test('calming the boss clears the place and ends the visit where you stand', () => {
  const state = newState(1e12, 1);
  enterRoom(state, 'garden');
  for (let stop = 0; stop < GARDEN.path.length - 1; stop++) assert.deepEqual(afterFight(state, stop, true, {}), { cleared: false, home: false });
  assert.deepEqual(afterFight(state, GARDEN.path.length - 1, true, {}), { cleared: true, home: false });
  assert.equal(state.visit, null);
  assert.deepEqual(state.rooms.garden, { visits: 1, clears: 1, losses: 0, calmed: 0b11111 });
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

// ------------------------------------------------------------------ whoever you calm stays calm

test('whoever you calm stays calm, visit after visit, and the ringleader faces you once the others are, however many visits that took', () => {
  const state = newState(1e12, 4);
  const last = GARDEN.path.length - 1;
  // One group a visit, resting or being carried home between: four visits, and the ringleader is next.
  [2, 0, 3, 1].forEach((stop, n) => {
    assert.equal(enterRoom(state, 'garden'), true);
    assert.equal(state.visit.stop, n, 'you step in with everyone calmed so far still calm');
    assert.equal(canMeet(state.visit, GARDEN, last), false, 'not the ringleader yet');
    assert.equal(state.visit.groups[stop].done, false);
    assert.ok(!state.visit.groups[stop].wander && fairEncounter(GARDEN, stop, state.visit.groups[stop].foes), 'whoever is restless is waiting where they were');
    assert.deepEqual(afterFight(state, stop, true, {}), { cleared: false, home: false });
    if (n % 2) assert.deepEqual(afterFight(state, last, false, {}), { cleared: false, home: true }); else assert.equal(leaveRoom(state), true);
    assert.equal(calmedIn(state, 'garden'), n + 1);
  });
  assert.equal(state.rooms.garden.calmed, 0b01111);
  assert.equal(placeCalm(state, 'garden'), false, 'the place is not calm until its ringleader is');
  assert.equal(enterRoom(state, 'garden'), true);
  assert.equal(state.visit.stop, 4);
  assert.equal(state.visit.stroll, false);
  assert.equal(canMeet(state.visit, GARDEN, last), true, 'the ringleader will face you straight away');
  assert.equal(nextGroup(state.visit, GARDEN), last, 'and is who a sensible visitor meets next');
  assert.ok(fairEncounter(GARDEN, last, state.visit.groups[last].foes) && !state.visit.groups[last].wander);
  assert.deepEqual(afterFight(state, last, true, {}), { cleared: true, home: false });
  assert.deepEqual(state.rooms.garden, { visits: 5, clears: 1, losses: 2, calmed: 0b11111 });
});

test('you are never stuck at a ringleader: every time you set out, a few wanderers are about the stops you have calmed, there if you want them', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const state = newState(1e12, seed);
    state.rooms.garden.calmed = 0b01111;
    for (let visit = 0; visit < 3; visit++) {
      assert.equal(enterRoom(state, 'garden'), true);
      const about = state.visit.groups.map((group, stop) => (wandering(state.visit, stop) ? stop : -1)).filter((stop) => stop >= 0);
      assert.ok(about.length >= 1 && about.length <= WANDERERS.groups[1], `seed ${seed}: ${about.length} groups wandering`);
      assert.equal(about.includes(GARDEN.path.length - 1), false, 'never at the ringleader\'s stop');
      for (const stop of about) {
        const group = state.visit.groups[stop];
        assert.equal(group.wander, true);
        assert.ok(fairEncounter(GARDEN, stop, group.foes), 'they are whoever belongs at that stop, at its levels');
        assert.ok(canMeet(state.visit, GARDEN, stop), 'and can be met, for the practice');
      }
      state.visit.groups.forEach((group, stop) => { if (stop < 4 && !about.includes(stop)) assert.deepEqual(group, { foes: [], done: true }); });
      assert.equal(stillAbout(state.visit), about.length + 1);
      assert.equal(state.visit.stop, 4, 'they are not counted against you');
      assert.equal(nextGroup(state.visit, GARDEN), 4, 'and nobody\'s next but the ringleader is');
      // Calm one: it is practice. The place is no calmer and no less calm for it.
      assert.deepEqual(afterFight(state, about[0], true, {}), { cleared: false, home: false });
      assert.equal(wandering(state.visit, about[0]), false);
      assert.deepEqual([state.visit.stop, state.rooms.garden.calmed, state.rooms.garden.clears], [4, 0b01111, 0]);
      assert.equal(leaveRoom(state), true);
    }
  }
});

test('wanderers leave one calm stop empty, so none come until two are calm; and none come to Tin Can Alley until it is calm, where there is no walking round them', () => {
  const count = (state, room) => { enterRoom(state, room); const n = state.visit.groups.filter((_, stop) => wandering(state.visit, stop)).length; leaveRoom(state); return n; };
  for (let seed = 1; seed <= 20; seed++) {
    const state = newState(1e12, seed);
    assert.equal(wanderersMost(state, 'garden'), 0);
    assert.equal(count(state, 'garden'), 0, 'nobody calmed, nobody wandering');
    state.rooms.garden.calmed = 0b00100;
    assert.equal(count(state, 'garden'), 0, 'one stop calm: it stays empty');
    state.rooms.garden.calmed = 0b00101;
    assert.equal(wanderersMost(state, 'garden'), 1);
    assert.equal(count(state, 'garden'), 1, 'two calm: one has somebody wandering');
    enterRoom(state, 'garden');
    assert.ok(wandering(state.visit, 0) !== wandering(state.visit, 2));
    assert.ok(!state.visit.groups[1].wander && !state.visit.groups[3].wander && !state.visit.groups[4].wander, 'and whoever is restless is nobody\'s wanderer');
    assert.equal(nextGroup(state.visit, GARDEN), 1, 'next is the nearest still restless, not a wanderer');
    leaveRoom(state);
    state.rooms.garden.calmed = 0b01111;
    assert.equal(wanderersMost(state, 'garden'), 3);
    // The alley is one group wide.
    state.rooms.garden.clears = 1;
    state.rooms.alley.calmed = 0b01111;
    assert.equal(wanderersMost(state, 'alley'), 0);
    assert.equal(count(state, 'alley'), 0);
    enterRoom(state, 'alley');
    assert.deepEqual(state.visit.groups.slice(0, 4), [0, 1, 2, 3].map(() => ({ foes: [], done: true })), 'the way to Baron Pilfer is clear');
    assert.equal(nextGroup(state.visit, roomOf('alley')), 4);
    leaveRoom(state);
    state.rooms.alley.clears = 1;
    assert.equal(wanderersMost(state, 'alley'), 3, 'calm, it is a stroll like anywhere else');
  }
});

test('from outside, only the stops still restless have somebody keeping to cover', () => {
  const state = newState(1e12, 2);
  const posts = districtOf('garden').posts;
  assert.equal(heldBy(state).filter((point) => posts.includes(point)).length, 5);
  state.rooms.garden.calmed = 0b01010;
  assert.deepEqual(land(heldBy(state)).filter((point) => posts.includes(point)), [posts[0], posts[2], posts[4]]);
});
