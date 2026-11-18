// Strays: lost Clutterkin out on the lane itself. Where they turn up, who
// they are, that nobody has to meet them, how worn they leave the team, and
// what a save keeps of it all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { LONE_SHARE, xpFor, xpNeeded, ROOMS, SPECIES, STRAYS, BREATHER, HEIRLOOM, START_TEAM, roomOf } from '../../web/js/core/balance.js';
import { WORLD, WILDS, SPOTS, PEOPLE, GREEN, DISTRICTS, ROAD_POINTS, POST, canStand, districtAt, spotOf, routeTo, roomy, standing, clearWay } from '../../web/js/core/world.js';
import { rollStrays, fairStrays, strayPool, strayLevels, frontier, straysAbout } from '../../web/js/core/strays.js';
import { maxHpOf, enterRoom, leaveRoom } from '../../web/js/core/rooms.js';
import { playable } from '../../web/js/core/trial.js';
import { playOut } from '../../web/js/core/auto.js';

const NOW = 1_800_000_000_000;
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const back = (game, edit = () => {}) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };
/** Meets a group of strays and plays the fight out. */
function meet(game, index, how = {}) {
  assert.equal(game.approachStrays(index), true);
  const battle = game.startStrays();
  assert.ok(battle, 'the fight begins');
  playOut(battle, how);
  return game.finishBattle();
}

test('strays turn up at quiet spots: on open ground beside a street, clear of every door, gate, neighbour and each other, and you can walk to each', () => {
  assert.ok(WILDS.length >= STRAYS.groups[1] * 2, `${WILDS.length} spots for at most ${STRAYS.groups[1]} groups`);
  const home = spotOf('home').door;
  const roads = ROAD_POINTS.flat();
  WILDS.forEach((spot, i) => {
    assert.ok(canStand(spot.x, spot.y) && [[40, 0], [-40, 0], [0, 40], [0, -40]].every(([dx, dy]) => canStand(spot.x + dx, spot.y + dy)), `spot ${i} is open ground with room round it`);
    assert.equal(districtAt(spot), null, `spot ${i} is out on the lane, not inside a place`);
    for (const place of SPOTS) assert.ok(far(place.door, spot) > WORLD.reach + STRAYS.berth, `spot ${i} is clear of the door of ${place.id}`);
    for (const area of Object.values(DISTRICTS)) assert.ok(far(area.gate, spot) > POST.meet + STRAYS.berth, `spot ${i} is clear of a gate`);
    for (const person of PEOPLE) assert.ok(far(person, spot) > 200, `spot ${i} is not on top of ${person.id}`);
    assert.ok(!(spot.x > GREEN.x && spot.x < GREEN.x + GREEN.w && spot.y > GREEN.y && spot.y < GREEN.y + GREEN.h), `spot ${i} is off the green`);
    const road = Math.min(...roads.map((point) => far(point, spot)));
    assert.ok(road > STRAYS.meet && road < 200, `spot ${i} is beside a street, not on it (${Math.round(road)} away)`);
    for (const other of WILDS) if (other !== spot) assert.ok(far(other, spot) > 2 * STRAYS.berth, `spots ${i} and another are well apart`);
    // A way there from home, ending near enough to meet whoever is there.
    const can = roomy(standing());
    const way = routeTo(home, spot, can, WORLD);
    const end = way.length ? way[way.length - 1] : home;
    assert.ok(far(end, spot) < STRAYS.meet, `the way to spot ${i} gets there`);
  });
});

test('a new game has a few small groups of strays out, each at a spot of its own: garden kinds, at the garden\'s strength', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const state = newState(NOW, seed);
    assert.ok(state.strays.length >= STRAYS.groups[0] && state.strays.length <= STRAYS.groups[1], `seed ${seed}: ${state.strays.length} groups`);
    assert.equal(new Set(state.strays.map((stray) => stray.at)).size, state.strays.length);
    const gardenKinds = new Set(ROOMS[0].path.flatMap((spot) => spot.pool.map(([kind]) => kind)));
    for (const stray of state.strays) {
      assert.ok(WILDS[stray.at] && stray.done === false);
      assert.ok(stray.foes.length >= STRAYS.size[0] && stray.foes.length <= STRAYS.size[1]);
      assert.ok(fairStrays(state, stray.foes));
      for (const foe of stray.foes) {
        assert.ok(gardenKinds.has(foe.species) && !SPECIES[foe.species].boss, `${foe.species} lives in the garden`);
        assert.ok(foe.level >= ROOMS[0].path[0].level[0] && foe.level <= ROOMS[0].path[1].level[1], 'as strong as whoever waits at the garden\'s first two stops');
      }
    }
    // They have dice of their own: the game's dice are where the seed left them.
    assert.equal(state.rng, seed | 0);
    assert.deepEqual(newState(NOW, seed).strays, state.strays, 'the same seed, the same strays');
  }
  assert.equal(frontier(newState(NOW, 1)).id, 'garden');
});

test('strays are whoever lives where you have got to, at the strength of the furthest place open: never a ringleader, never from further on', () => {
  const state = newState(NOW, 7);
  state.rooms.garden.clears = 1;
  state.rooms.alley.clears = 1;
  assert.equal(frontier(state).id, 'pantry');
  assert.deepEqual(strayLevels(state), [roomOf('pantry').path[0].level[0], roomOf('pantry').path[1].level[1]]);
  const kinds = strayPool(state).map(([kind]) => kind);
  const open = new Set(ROOMS.slice(0, 3).flatMap((room) => room.path.flatMap((spot) => spot.pool.map(([kind]) => kind))));
  assert.deepEqual([...kinds].sort(), [...open].sort());
  assert.ok(kinds.every((kind) => !SPECIES[kind].boss));
  const seenKinds = new Set();
  for (let i = 0; i < 60; i++) for (const stray of rollStrays(state)) for (const foe of stray.foes) { seenKinds.add(foe.species); assert.ok(open.has(foe.species) && foe.level <= strayLevels(state)[1] && foe.level >= strayLevels(state)[0]); }
  assert.ok(seenKinds.size >= 8, `a good spread of kinds turns up (${seenKinds.size})`);
  // With every place calm, anyone from anywhere, at the strength of the last place.
  for (const room of ROOMS) state.rooms[room.id].clears = 1;
  assert.equal(frontier(state).id, ROOMS[ROOMS.length - 1].id);
  // (All but the three kinds you set out with, who live nowhere on the lane: they come calling in calm places instead.)
  assert.equal(strayPool(state).length, 40 - START_TEAM.length);
  // Rarely, one is an Heirloom: about as often as anywhere not yet calm.
  let heirlooms = 0; let all = 0;
  for (let i = 0; i < 400; i++) for (const stray of rollStrays(state)) for (const foe of stray.foes) { all++; if (foe.heirloom) heirlooms++; }
  assert.ok(heirlooms / all > HEIRLOOM.odds / 3 && heirlooms / all < HEIRLOOM.odds * 3, `${heirlooms} of ${all}`);
});

test('nobody has to meet a stray: they hold no ground, the way found for you goes round them, and only walking right up to one meets it', () => {
  const game = fresh(5);
  const strays = game.strays();
  assert.equal(strays.length, game.state.strays.length);
  assert.equal(game.strayNear(), -1, 'none at the door of home');
  for (const stray of strays) {
    assert.equal(game.held().some((point) => far(point, stray) < 1), false, 'a stray holds no ground');
    assert.ok(canStand(stray.x, stray.y, game.held()), 'you could stand where it stands');
  }
  // The way to somewhere past a stray keeps clear of it.
  const one = strays[0];
  game.state.where = { x: one.x - 260, y: one.y };
  const past = { x: one.x + 260, y: one.y };
  if (canStand(past.x, past.y) && canStand(game.state.where.x, game.state.where.y)) {
    const way = game.routeTo(past);
    let at = game.state.where;
    for (const point of way) {
      const steps = Math.ceil(far(at, point) / 4);
      for (let i = 1; i <= steps; i++) assert.ok(far({ x: at.x + ((point.x - at.x) * i) / steps, y: at.y + ((point.y - at.y) * i) / steps }, one) > STRAYS.meet, 'the way does not brush it');
      at = point;
    }
  }
  // But a tap on it walks you up to it, and there you can meet it.
  const way = game.routeTo({ x: one.x, y: one.y });
  for (let steps = 0; steps < 4000 && way.length; steps++) { if (!game.walk(way[0], 0.05) || far(way[0], game.state.where) < 3) way.shift(); }
  assert.equal(game.strayNear(), one.index, 'walked right up to it');
  assert.equal(game.meeting(), -1, 'it is not one of a place\'s groups');
  // From indoors, or in a fight, nobody is near.
  game.standAt('home');
  game.enter('home');
  assert.equal(game.strayNear(), -1);
  assert.equal(game.startStrays(one.index), null);
});

test('meeting strays is a fight like any other; it leaves the team worn until they rest, and resting brings others out', () => {
  const game = fresh(11);
  for (const friend of game.state.friends) friend.level = 6;
  const first = game.strays()[0];
  assert.equal(game.rested(), true);
  assert.equal(game.startStrays(first.index), null, 'not from across the lane');
  const result = meet(game, first.index);
  assert.equal(result.won, true);
  assert.deepEqual([result.strays, result.cleared, result.home, result.room], [true, false, false, null]);
  assert.ok(result.xp > 0, 'it was worth something');
  assert.equal(game.state.strays[first.index].done, true);
  assert.equal(game.strays().some((stray) => stray.index === first.index), false, 'they are gone');
  assert.equal(game.strayNear(), -1);
  assert.equal(game.place(), 'lane', 'no visit began');
  assert.equal(game.state.visit, null);
  assert.equal(game.rested(), false, 'but the team is not as fresh as it was');
  for (const member of game.teamHealth()) assert.ok(member.hp > 0 && member.hp <= member.max && member.hp === game.state.worn[member.id]);
  for (const foe of first.foes) assert.equal(game.state.book[foe.species].met, true, 'whoever it was is in the scrapbook');
  assert.equal(game.setTeam(game.state.team.slice(0, 2)), false, 'the team is not changed until everyone is rested');
  // Rest: only at home, and then everyone is fresh and a new lot is out.
  assert.equal(game.rest(), false, 'not out here');
  const before = JSON.stringify(game.state.strays);
  assert.equal(game.goHome(), true);
  assert.equal(game.rested(), true);
  assert.equal(game.state.worn, null);
  for (const member of game.teamHealth()) assert.equal(member.hp, member.max);
  assert.ok(game.state.strays.every((stray) => !stray.done) && game.state.strays.length >= STRAYS.groups[0]);
  assert.notEqual(JSON.stringify(game.state.strays), before, 'others have wandered by');
  assert.equal(game.rest(), false, 'nothing to rest from now');
  assert.equal(game.goHome(), false);
  assert.equal(game.setTeam(game.state.team.slice(0, 2)), true);
});

test('worn from strays, you step into a place as you are; and on a visit a stray is fought with what the visit has left you', () => {
  const game = fresh(4);
  for (const friend of game.state.friends) friend.level = 6;
  const [a, b, c] = game.team();
  // Worn on the lane, then through the garden gate.
  game.state.worn = { [a.id]: 7, [b.id]: maxHpOf(b), [c.id]: 0 };
  assert.equal(game.travelTo('garden'), true);
  assert.deepEqual(game.state.visit.hp, { [a.id]: 7, [b.id]: maxHpOf(b), [c.id]: 0 });
  assert.equal(game.state.worn, null, 'the visit keeps it from here');
  // A stray met in the middle of the visit: the same Health in, and what is left (and a breather) back into the visit.
  const one = game.strays()[0];
  assert.equal(game.approachStrays(one.index), true);
  const battle = game.startStrays();
  assert.deepEqual(battle.units.filter((unit) => unit.side === 'ally').map((unit) => unit.hp), [7, maxHpOf(b), 0]);
  playOut(battle, {});
  const groups = JSON.stringify(game.state.visit.groups);
  const result = game.finishBattle();
  if (result.won) {
    assert.equal(game.state.worn, null);
    assert.ok(game.state.visit.hp[c.id] === Math.ceil(maxHpOf(c) * BREATHER), 'whoever was down gets up again');
    assert.equal(JSON.stringify(game.state.visit.groups), groups, 'and nobody in the garden is any different');
    assert.equal(game.state.visit.stop, 0);
  }
  // Rules on their own: resting clears both, and stepping in rested is stepping in fresh.
  const state = newState(NOW, 2);
  state.worn = { 1: 3 };
  assert.equal(leaveRoom(state), true);
  assert.equal(state.worn, null);
  assert.equal(leaveRoom(state), false);
  enterRoom(state, 'garden');
  for (const friend of state.friends) assert.equal(state.visit.hp[friend.id], maxHpOf(friend));
});

test('worn out by strays, you are carried home: that ends a visit too, nobody you calmed is any less calm, and others are out', () => {
  const game = fresh(9);
  assert.equal(game.travelTo('garden'), true);
  playOut(game.startEncounter(0), {});
  assert.equal(game.finishBattle().won, true);
  game.state.visit.hp = Object.fromEntries(game.team().map((friend) => [friend.id, 1]));
  for (const friend of game.state.friends) friend.level = 1;
  const result = meet(game, game.strays()[0].index, { careless: true });
  assert.equal(result.won, false);
  assert.deepEqual([result.home, result.strays], [true, true]);
  assert.equal(game.state.visit, null);
  assert.equal(game.state.worn, null);
  assert.equal(game.rested(), true);
  assert.equal(game.near(), 'home');
  assert.equal(game.indoors(), null);
  assert.equal(game.state.rooms.garden.calmed, 0b00001, 'who was calm is calm');
  assert.equal(game.state.rooms.garden.losses, 0, 'and it was not the garden that beat you');
  assert.ok(game.state.strays.every((stray) => !stray.done));
});

test('calming a place, or being carried home from one, brings other strays out', () => {
  const game = fresh(6);
  const before = JSON.stringify(game.state.strays);
  for (const friend of game.state.friends) friend.level = 1;
  game.travelTo('garden');
  game.state.visit.hp = Object.fromEntries(game.team().map((friend) => [friend.id, 1]));
  playOut(game.startEncounter(0), { careless: true });
  assert.equal(game.finishBattle().won, false);
  assert.notEqual(JSON.stringify(game.state.strays), before);
  // And once the garden is calm, kinds from the alley are among them.
  for (const friend of game.state.friends) friend.level = 14;
  game.travelTo('garden');
  while (game.place() === 'path') { playOut(game.startEncounter(), {}); game.finishBattle(); }
  assert.equal(game.state.rooms.garden.clears, 1);
  assert.deepEqual(strayLevels(game.state), [roomOf('alley').path[0].level[0], roomOf('alley').path[1].level[1]]);
  for (const stray of game.state.strays) assert.ok(fairStrays(game.state, stray.foes));
});

test('a save keeps the strays and how worn the team is; one tampered with gets nothing it should not', () => {
  const game = fresh(8);
  for (const friend of game.state.friends) friend.level = 6;
  assert.deepEqual(back(game).strays, game.state.strays);
  assert.equal(back(game).strayRng, game.state.strayRng);
  assert.equal(back(game).worn, null);
  assert.equal(meet(game, game.strays()[0].index).won, true);
  let woke = back(game);
  assert.deepEqual(woke.strays, game.state.strays, 'whoever was met stays met');
  assert.deepEqual(woke.worn, game.state.worn);
  assert.ok(playable(woke, NOW));
  // Health that could not be: kept inside what each can have. Nobody on their feet: carried home, rested.
  woke = back(game, (raw) => { for (const id of Object.keys(raw.worn)) raw.worn[id] = 1e9; });
  for (const friend of woke.friends.filter((f) => woke.team.includes(f.id))) assert.equal(woke.worn[friend.id], maxHpOf(friend));
  assert.equal(back(game, (raw) => { for (const id of Object.keys(raw.worn)) raw.worn[id] = 0; }).worn, null);
  for (const junk of ['tired', 7, [], true]) assert.equal(back(game, (raw) => { raw.worn = junk; }).worn, null);
  // Strays that could not be: a ringleader, someone far too strong, someone from a place still shut,
  // two at one spot, a spot that is nowhere. None is kept; if none is left, a fair lot is rolled.
  const soft = (species, level = 2) => [{ species, level, heirloom: false }];
  for (const [what, strays] of [
    ['a ringleader', [{ at: 0, foes: soft('boss_hydra'), done: false }]],
    ['too strong', [{ at: 0, foes: soft(ROOMS[0].path[0].pool[0][0], 40), done: false }]],
    ['from further on', [{ at: 0, foes: soft(ROOMS[7].path[0].pool[0][0]), done: false }]],
    ['nowhere', [{ at: 999, foes: soft(ROOMS[0].path[0].pool[0][0]), done: false }, { at: -1, foes: soft(ROOMS[0].path[0].pool[0][0]), done: false }]],
    ['rubbish', [null, 7, 'stray', { at: 'here' }, { at: 1, foes: 'everyone' }, { at: 2, foes: [] }]],
  ]) {
    const mended = back(game, (raw) => { raw.strays = strays; });
    assert.ok(mended.strays.length >= STRAYS.groups[0] && mended.strays.every((stray) => fairStrays(mended, stray.foes) && WILDS[stray.at]), what);
    assert.ok(playable(mended, NOW), what);
  }
  const fair = soft(ROOMS[0].path[0].pool[0][0]);
  const crowd = back(game, (raw) => { raw.strays = WILDS.map((_, at) => ({ at, foes: fair, done: false })); });
  assert.equal(crowd.strays.length, STRAYS.groups[1], 'no more groups than there can be');
  const twice = back(game, (raw) => { raw.strays = [{ at: 3, foes: fair, done: false }, { at: 3, foes: fair, done: true }, { at: 4, foes: fair, done: 'yes' }]; });
  assert.deepEqual(twice.strays.map((stray) => [stray.at, stray.done]), [[3, false], [4, false]]);
  // A save from before there were strays has some.
  const old = back(game, (raw) => { delete raw.strays; delete raw.strayRng; delete raw.worn; });
  assert.ok(old.strays.length >= STRAYS.groups[0] && old.worn === null);
  // On a visit, the visit keeps how everyone is: the save's `worn` is not taken as well.
  const out = fresh(8);
  out.travelTo('garden');
  assert.equal(back(out, (raw) => { raw.worn = { 1: 1, 2: 1, 3: 1 }; }).worn, null);
});

// ------------------------------------------------------------------ enough practice to be had

test('strays come alone, in pairs and in threes; one alone teaches least, and a rest brings more out', () => {
  const sizes = new Set();
  const game = fresh(11);
  for (let i = 0; i < 40; i++) { for (const stray of game.strays()) sizes.add(stray.foes.length); rollStrays(game.state); }
  assert.deepEqual([...sizes].sort(), [1, 2, 3]);
  assert.deepEqual(STRAYS.size, [1, 3]);
  // Meet one alone and one in company: the lone one teaches its share, the others each their worth.
  for (const want of [1, 2, 3]) {
    const play = fresh(11);
    let found = null;
    for (let i = 0; i < 60 && !found; i++) { found = play.strays().find((stray) => stray.foes.length === want) || null; if (!found) rollStrays(play.state); }
    assert.ok(found, `a group of ${want}`);
    const worth = found.foes.reduce((sum, foe) => sum + xpFor(foe.species, foe.level), 0);
    const result = meet(play, found.index);
    if (result.won) assert.equal(result.xp, want === 1 ? Math.round(worth * LONE_SHARE) : worth);
    assert.equal(result.lone, want === 1);
  }
});

test('there is always enough practice: an outing among the strays is worth about a level, however far along you are', () => {
  for (const room of ROOMS) {
    const game = fresh(5);
    // Everything before this place calm, so this is the furthest place open.
    for (const before of ROOMS.slice(0, ROOMS.indexOf(room))) { game.state.rooms[before.id].clears = 1; game.state.rooms[before.id].calmed = 31; }
    assert.equal(frontier(game.state).id, room.id);
    let total = 0;
    const outings = 30;
    for (let i = 0; i < outings; i++) {
      for (const stray of rollStrays(game.state)) {
        const worth = stray.foes.reduce((sum, foe) => sum + xpFor(foe.species, foe.level), 0);
        total += stray.foes.length === 1 ? Math.round(worth * LONE_SHARE) : worth;
      }
    }
    // What a team about to face this place's ringleader needs for its next level.
    const level = room.path[room.path.length - 1].bossLevel - 1;
    const share = total / outings / xpNeeded(level);
    assert.ok(share > 0.7 && share < 2.2, `${room.id}: the strays of one outing are worth ${share.toFixed(2)} of a level at level ${level}`);
  }
});
