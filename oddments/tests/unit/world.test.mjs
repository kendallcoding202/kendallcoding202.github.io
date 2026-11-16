// The lane: the open world you walk around between places.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, SPOTS, SPOT_IDS, TREES, canStand, stepWalk, spotNear, spotOf, settleWhere } from '../../web/js/core/world.js';
import { ROOM_IDS } from '../../web/js/core/balance.js';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';

const NOW = 1_800_000_000_000;
/** Walks from a point toward a target until it stops; returns where it ended and how long it took. */
function walk(from, to, frame = 1 / 60, limit = 4000) {
  let pos = { x: from.x, y: from.y };
  let frames = 0;
  for (; frames < limit; frames++) {
    const next = stepWalk(pos, to, frame);
    if (!next.moving) break;
    pos = next;
  }
  return { pos, seconds: frames * frame };
}

test('home and all eight rooms stand in the lane, each with a door you can stand at', () => {
  assert.deepEqual(SPOT_IDS, ['home', ...ROOM_IDS]);
  assert.equal(SPOTS.length, 9);
  for (const spot of SPOTS) {
    assert.ok(canStand(spot.door.x, spot.door.y), `${spot.id}: its door is somewhere feet can be`);
    assert.equal(spotNear(spot.door), spot.id, `${spot.id}: standing at its door is being at it`);
    assert.ok(spot.block.x >= WORLD.edge && spot.block.x + spot.block.w <= WORLD.w - WORLD.edge && spot.y - spot.tall > 0, `${spot.id} is inside the world`);
  }
  assert.equal(spotOf('garden').id, 'garden');
  assert.equal(spotOf('nowhere'), null);
});

test('no two doors are close enough to be confused, and no building or tree blocks a door', () => {
  for (const a of SPOTS) {
    for (const b of SPOTS) {
      if (a !== b) assert.ok(Math.hypot(a.door.x - b.door.x, a.door.y - b.door.y) > WORLD.reach * 2, `${a.id} and ${b.id}`);
    }
    for (const tree of TREES) assert.ok(Math.hypot(a.door.x - tree.x, a.door.y - tree.y) > WORLD.reach, `a tree by ${a.id}'s door`);
  }
});

test('feet cannot go outside the lane, into a building, or through a tree trunk', () => {
  assert.equal(canStand(-5, 800), false);
  assert.equal(canStand(WORLD.w + 5, 800), false);
  assert.equal(canStand(360, -5), false);
  assert.equal(canStand(360, WORLD.h + 5), false);
  for (const bad of [NaN, Infinity, undefined]) assert.equal(canStand(bad, 800), false);
  for (const spot of SPOTS) assert.equal(canStand(spot.x, spot.y - 20), false, `inside ${spot.id}`);
  for (const tree of TREES) assert.equal(canStand(tree.x, tree.y), false);
  const garden = spotOf('garden');
  assert.equal(canStand(garden.x, garden.y - garden.tall + 10), true, 'behind a roof is open ground');
});

test('a step covers speed x time, straight toward the target, and stops when it gets there', () => {
  const from = { x: 360, y: 1560 };
  const one = stepWalk(from, { x: 360, y: 1360 }, 0.05);
  assert.equal(one.moving, true);
  assert.ok(Math.abs(one.y - (1560 - WORLD.speed * 0.05)) < 1e-9 && one.x === 360);
  const short = stepWalk(from, { x: 363, y: 1560 }, 0.05);
  assert.deepEqual([short.x, short.y], [363, 1560], 'never past the target');
  assert.equal(stepWalk(from, from, 0.05).moving, false);
  assert.equal(stepWalk(from, { x: 360, y: 1360 }, 0).moving, false);
  assert.equal(stepWalk(from, { x: 360, y: 1360 }, -1).moving, false);
});

test('a long gap between frames is walked as a short one: nobody steps through a wall', () => {
  const home = spotOf('home');
  const below = { x: home.x, y: home.y + 34 };
  const jump = stepWalk(below, { x: home.x, y: home.y - 300 }, 30);
  assert.ok(Math.hypot(jump.x - below.x, jump.y - below.y) <= WORLD.speed * WORLD.maxStep + 1e-9);
  const { pos } = walk(below, { x: home.x, y: home.y - 300 });
  assert.ok(pos.y > home.block.y + home.block.h, 'walking straight at the front wall stops in front of it');
});

test('every place can be walked to from home, sliding round whatever is in the way', () => {
  const home = spotOf('home').door;
  let pos = home;
  for (const spot of SPOTS.slice(1)) {
    const trip = walk(pos, spot.door);
    assert.equal(spotNear(trip.pos), spot.id, `walked from the last door to ${spot.id}`);
    assert.ok(trip.seconds < 6, `${spot.id}: ${trip.seconds.toFixed(1)}s`);
    pos = trip.pos;
  }
  const back = walk(pos, home, 1 / 30);
  assert.ok(back.seconds < 14, `all the way home is ${back.seconds.toFixed(1)}s`);
});

test('wherever the walk goes, feet are always somewhere feet can be', () => {
  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let pos = spotOf('home').door;
  for (let trip = 0; trip < 300; trip++) {
    const target = { x: random() * (WORLD.w + 200) - 100, y: random() * (WORLD.h + 200) - 100 };
    for (let i = 0; i < 120; i++) {
      const next = stepWalk(pos, target, 1 / 30);
      if (!next.moving) break;
      assert.ok(canStand(next.x, next.y), `stepped into something at ${next.x},${next.y}`);
      pos = next;
    }
  }
});

test('being at a door means being within reach of it, and nowhere else is anywhere', () => {
  const garden = spotOf('garden').door;
  assert.equal(spotNear({ x: garden.x + WORLD.reach - 1, y: garden.y }), 'garden');
  assert.equal(spotNear({ x: garden.x + WORLD.reach + 1, y: garden.y }), null);
  assert.equal(spotNear({ x: 360, y: 1300 }), null, 'the middle of the lane');
});

test('a position from a save is kept only if feet could really be there', () => {
  const home = spotOf('home').door;
  assert.deepEqual(settleWhere({ x: 200, y: 1400 }), { x: 200, y: 1400 });
  for (const bad of [null, undefined, 7, 'here', [], {}, { x: 'a', y: 1 }, { x: NaN, y: 5 }, { x: 1e308, y: 1e308 }, { x: -50, y: 20 }, { x: spotOf('wash').x, y: spotOf('wash').y - 10 }]) {
    assert.deepEqual(settleWhere(bad), home, JSON.stringify(bad));
  }
});

test('a new game starts at the door of home, and the save remembers where you walked to', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  assert.equal(game.near(), 'home');
  assert.equal(game.walk({ x: 200, y: 1400 }, 0.1), true);
  for (let i = 0; i < 60; i++) game.walk({ x: 200, y: 1400 }, 0.1);
  assert.equal(game.near(), null);
  const back = reviveState(JSON.parse(game.serialize(NOW)), NOW);
  assert.deepEqual(back.where, game.state.where);
  assert.ok(Math.hypot(back.where.x - 200, back.where.y - 1400) < 2);
});

test('you can only walk into a room from its door', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  assert.equal(game.enterRoom('garden'), false, 'not from the door of home');
  assert.equal(game.state.visit, null);
  const door = spotOf('garden').door;
  for (let i = 0; i < 200 && game.near() !== 'garden'; i++) game.walk(door, 1 / 30);
  assert.equal(game.near(), 'garden');
  assert.equal(game.enterRoom('alley'), false, 'nor into some other room');
  assert.equal(game.enterRoom('garden'), true);
});

test('there is no walking about while on a path or in a fight', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  game.travelTo('garden');
  const before = { ...game.state.where };
  assert.equal(game.walk({ x: 300, y: 300 }, 0.1), false);
  assert.equal(game.standAt('home'), false);
  game.startEncounter();
  assert.equal(game.walk({ x: 300, y: 300 }, 0.1), false);
  assert.deepEqual(game.state.where, before);
  for (const bad of [null, undefined, {}, { x: NaN, y: 1 }, 'north']) assert.equal(new Game(newState(NOW, 3), { now: NOW }).walk(bad, 0.1), false);
});

test('worn out, the team is carried home; after a win you step back out where you went in', () => {
  const lost = new Game(newState(NOW, 3), { now: NOW, fx: false });
  lost.travelTo('garden');
  lost.startEncounter(); lost.concede(); lost.finishBattle();
  assert.equal(lost.near(), 'home');
  const left = new Game(newState(NOW, 3), { now: NOW, fx: false });
  left.travelTo('garden');
  left.leaveRoom();
  assert.equal(left.near(), 'garden');
});
