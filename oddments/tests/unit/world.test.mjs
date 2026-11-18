// The open world: where things stand, where feet can go, walking, and the garden you walk into.
import { test } from 'node:test';
import { insideOf } from '../../web/js/core/indoors.js';
import assert from 'node:assert/strict';
import {
  WORLD, SPOTS, SPOT_IDS, TREES, LAMPS, HEDGES, ROADS, ROAD_POINTS, GREEN, DISTRICTS, POST,
  canStand, standing, districtOf, districtAt, postNear, stepWalk, routeTo, straighten, clearWay, roomy, along, spotNear, spotOf, settleWhere,
} from '../../web/js/core/world.js';
import { ROOM_IDS, ROOMS, roomBuilt } from '../../web/js/core/balance.js';
import { fairEncounter } from '../../web/js/core/rooms.js';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';

const NOW = 1_800_000_000_000;
const GARDEN = DISTRICTS.garden;
const HOME = spotOf('home').door;
const INSIDE = { x: GARDEN.gate.x, y: GARDEN.gate.y - 90 }; // a few steps in through the garden gate
const everyone = standing(GARDEN.posts); // where feet can be while every group is still waiting

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

/** Walks a way a frame at a time, as the screen does. Returns where it ended and whether it ever stuck. */
function follow(from, way, can, frame = 1 / 60) {
  let pos = { ...from };
  let stuck = false;
  for (const point of way) {
    for (let i = 0; i < 3000 && Math.hypot(point.x - pos.x, point.y - pos.y) >= WORLD.arrive; i++) {
      const next = stepWalk(pos, point, frame, can);
      if (!next.moving) { stuck = true; break; }
      pos = next;
    }
  }
  return { pos, stuck };
}
const wayTo = (from, to, can = canStand) => straighten(from, routeTo(from, to, roomy(can)), roomy(can));

// ---------------------------------------------------------------- what stands where

test('home and all twelve places are in the world, each with a door or a gate you can stand at', () => {
  assert.deepEqual(SPOT_IDS, ['home', ...ROOM_IDS]);
  assert.equal(SPOTS.length, 13);
  for (const spot of SPOTS) {
    assert.ok(canStand(spot.door.x, spot.door.y), `${spot.id}: cannot stand at its door`);
    assert.equal(spotNear(spot.door), spot.id);
    assert.ok(spot.block.x >= WORLD.edge && spot.block.x + spot.block.w <= WORLD.w - WORLD.edge && spot.y - spot.tall > 0 && spot.y < WORLD.h - WORLD.edge, `${spot.id} stands inside the world`);
    assert.equal(canStand(spot.x, spot.y - 20), false, `${spot.id}: its building is solid`);
  }
  assert.equal(spotOf('nowhere'), null);
});

test('a place you walk into is at its gate, not at a door: its building stands inside it', () => {
  const garden = spotOf('garden');
  assert.deepEqual(garden.door, { x: GARDEN.gate.x, y: GARDEN.gate.y + 84 });
  assert.equal(districtAt(garden.door), null, 'you read about the garden from outside it');
  assert.equal(districtAt({ x: garden.x, y: garden.y }), 'garden', 'and its shed is in among the flowers');
  for (const spot of SPOTS) if (spot.id !== 'garden') assert.equal(districtAt(spot.door), null, spot.id);
});

test('no two doors are close enough to be confused, and nothing stands on a door', () => {
  for (const a of SPOTS) {
    for (const b of SPOTS) if (a !== b) assert.ok(Math.hypot(a.door.x - b.door.x, a.door.y - b.door.y) > WORLD.reach * 2.4, `${a.id} and ${b.id}`);
    for (const thing of [...TREES, ...LAMPS]) assert.ok(Math.hypot(thing.x - a.door.x, thing.y - a.door.y) > 60, `something stands at the door of ${a.id}`);
  }
});

test('the world is much bigger than a screen both ways', () => {
  assert.ok(WORLD.w >= 1900 && WORLD.h >= 2000);
  const xs = SPOTS.map((spot) => spot.x);
  const ys = SPOTS.map((spot) => spot.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1400, 'places are spread from side to side');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 1400, 'and from top to bottom');
});

test('feet cannot go outside the world, into a building, through a hedge, a tree trunk or a lamp post', () => {
  assert.equal(canStand(HOME.x, HOME.y), true);
  for (const [x, y] of [[WORLD.edge - 1, 1200], [WORLD.w - WORLD.edge + 1, 1200], [1000, WORLD.edge - 1], [1000, WORLD.h - WORLD.edge + 1], [-1e9, 5], [NaN, 5], [5, NaN], [Infinity, Infinity]]) {
    assert.equal(canStand(x, y), false, `${x},${y}`);
  }
  for (const spot of SPOTS) {
    assert.equal(canStand(spot.x, spot.block.y + 5), false, spot.id);
    assert.equal(canStand(spot.block.x - WORLD.body + 1, spot.y - 10), false, `${spot.id}: a body does not overlap its wall`);
    assert.equal(canStand(spot.block.x - WORLD.body - 1, spot.y - 10), true, `${spot.id}: but can brush past it`);
  }
  for (const hedge of HEDGES) assert.equal(canStand(Math.max(WORLD.edge + 1, hedge.x + hedge.w / 2), Math.max(WORLD.edge + 1, hedge.y + hedge.h / 2)), false);
  for (const tree of TREES) {
    assert.equal(canStand(tree.x, tree.y), false);
    assert.equal(canStand(tree.x + tree.r * 0.55 + WORLD.body + 1, tree.y), true, 'under the leaves is fine');
  }
  for (const lamp of LAMPS) assert.equal(canStand(lamp.x, lamp.y), false);
});

test('trees are scattered the same way every time, off the streets, the doors and the green', () => {
  assert.ok(TREES.length >= 180 && TREES.length <= 260, `${TREES.length} trees`);
  assert.ok(TREES.filter((tree) => tree.y < 2200).length >= 30 && TREES.filter((tree) => tree.y >= 2200).length >= 90, 'on the lane, and thicker out in the country');
  assert.equal(new Set(TREES.map((tree) => `${tree.x},${tree.y}`)).size, TREES.length);
  for (const tree of TREES) {
    assert.ok(Number.isInteger(tree.x) && Number.isInteger(tree.y) && tree.r >= 20 && tree.r <= 32);
    for (const road of ROAD_POINTS) for (const p of road) assert.ok(Math.hypot(p.x - tree.x, p.y - tree.y) >= 80, `a tree at ${tree.x},${tree.y} crowds a street`);
    assert.equal(tree.x > GREEN.x && tree.x < GREEN.x + GREEN.w && tree.y > GREEN.y && tree.y < GREEN.y + GREEN.h, false, 'the green is kept clear');
    for (const other of TREES) if (other !== tree) assert.ok(Math.hypot(other.x - tree.x, other.y - tree.y) >= 150);
  }
});

test('every street runs over open ground from end to end, and one runs to every door', () => {
  assert.equal(ROAD_POINTS.length, ROADS.length);
  for (const road of ROAD_POINTS) for (const p of road) assert.ok(canStand(p.x, p.y), `a street is blocked at ${Math.round(p.x)},${Math.round(p.y)}`);
  for (const spot of SPOTS) {
    const near = Math.min(...ROAD_POINTS.flat().map((p) => Math.hypot(p.x - spot.door.x, p.y - spot.door.y)));
    assert.ok(near < 130, `no street comes to ${spot.id} (nearest ${Math.round(near)})`);
  }
  const bend = along([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10, true);
  assert.ok(bend.every((p) => p.x >= -1e-6 && p.x <= 100 + 1e-6 && p.y >= -1e-6 && p.y <= 100 + 1e-6) && bend.some((p) => p.x > 60 && p.y > 1 && p.y < 40), 'a rounded corner stays inside the corner');
  assert.equal(along([{ x: 0, y: 0 }, { x: 50, y: 0 }], 10, true).length, 5);
});

// ---------------------------------------------------------------- walking

test('a step covers speed x time, straight toward the target, and stops when it gets there', () => {
  const from = { x: HOME.x, y: HOME.y + 60 };
  const down = { x: HOME.x, y: HOME.y + 160 };
  const one = stepWalk(from, down, 0.05);
  assert.equal(one.moving, true);
  assert.ok(Math.abs(one.y - (from.y + WORLD.speed * 0.05)) < 1e-9 && one.x === from.x);
  const short = stepWalk(from, { x: from.x + 3, y: from.y }, 0.05);
  assert.deepEqual([short.x, short.y], [from.x + 3, from.y], 'never past the target');
  assert.equal(stepWalk(from, from, 0.05).moving, false);
  assert.equal(stepWalk(from, down, 0).moving, false);
  assert.equal(stepWalk(from, down, -1).moving, false);
});

test('a long gap between frames is walked as a short one: nobody steps through a wall', () => {
  const home = spotOf('home');
  const jump = stepWalk(HOME, { x: home.x, y: home.y - 300 }, 30);
  assert.ok(Math.hypot(jump.x - HOME.x, jump.y - HOME.y) <= WORLD.speed * WORLD.maxStep + 1e-9);
  const { pos } = walk(HOME, { x: home.x, y: home.y - 300 });
  assert.ok(pos.y > home.block.y + home.block.h, 'walking straight at the front wall stops in front of it');
  // The thinnest things in the world are still thicker than the longest step.
  const longest = WORLD.speed * WORLD.maxStep;
  for (const hedge of HEDGES) assert.ok(Math.min(hedge.w, hedge.h) + 2 * WORLD.body > longest);
  for (const lamp of LAMPS) assert.ok(2 * (lamp.r + WORLD.body) > longest);
  assert.ok(2 * POST.hold > longest && POST.meet - POST.hold < POST.hold);
});

test('wherever the walk goes, feet are always somewhere feet can be', () => {
  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let pos = HOME;
  for (let trip = 0; trip < 400; trip++) {
    const target = { x: random() * (WORLD.w + 200) - 100, y: random() * (WORLD.h + 200) - 100 };
    for (let i = 0; i < 160; i++) {
      const next = stepWalk(pos, target, 1 / 30, everyone);
      if (!next.moving) break;
      assert.ok(everyone(next.x, next.y), `stepped into something at ${next.x},${next.y}`);
      pos = next;
    }
  }
});

test('being at a door means being within reach of it, and nowhere else is anywhere', () => {
  const wash = spotOf('wash').door;
  assert.equal(spotNear({ x: wash.x - WORLD.reach + 1, y: wash.y }), 'wash');
  assert.equal(spotNear({ x: wash.x - WORLD.reach - 1, y: wash.y }), null);
  assert.equal(spotNear({ x: GREEN.x + GREEN.w / 2, y: GREEN.y + GREEN.h / 2 }), null, 'the middle of the green');
});

test('every door can be walked to from every other, a frame at a time, without once sticking', () => {
  for (const a of SPOTS) {
    for (const b of SPOTS) {
      if (a === b) continue;
      const way = wayTo(a.door, b.door, everyone);
      const { pos, stuck } = follow(a.door, way, everyone);
      assert.equal(stuck, false, `stuck walking from ${a.id} to ${b.id} near ${Math.round(pos.x)},${Math.round(pos.y)}`);
      assert.equal(spotNear(pos), b.id, `${a.id} to ${b.id}`);
    }
  }
});

test('a way keeps a little clear of everything, so walking it never brushes a lamp post or a corner', () => {
  const wide = roomy(canStand);
  for (const lamp of LAMPS) {
    assert.equal(canStand(lamp.x + 24, lamp.y), true, 'feet can pass close by a lamp');
    assert.equal(wide(lamp.x + 24, lamp.y), false, 'but a way is not laid that close');
  }
});

test('a way is found round whatever is between, and a tap on something solid leads as near as feet can get', () => {
  // (Found the way the game finds it: with a little room on every side, and the corners taken out.)
  for (const spot of SPOTS) {
    const way = wayTo(HOME, spot.door);
    assert.ok(way.every((point) => canStand(point.x, point.y)));
    const walked = follow(HOME, way, canStand);
    assert.equal(walked.stuck, false, `the way from home to ${spot.id} is never stuck`);
    assert.equal(spotNear(walked.pos), spot.id, `the way from home to ${spot.id}`);
  }
  const wash = spotOf('wash');
  const roof = { x: wash.x, y: wash.y - 30 }; // a tap on the building itself
  assert.equal(canStand(roof.x, roof.y), false);
  const near = follow(HOME, routeTo(HOME, roof, canStand), canStand).pos;
  assert.ok(Math.hypot(near.x - roof.x, near.y - roof.y) < 90, 'ends beside the building');
  assert.deepEqual(routeTo(HOME, HOME, canStand), []);
  assert.deepEqual(routeTo(HOME, { x: NaN, y: 3 }, canStand), []);
  assert.ok(routeTo(HOME, { x: 1e9, y: -1e9 }, canStand).length > 0, 'a tap far outside the world still walks toward it');
});

test('a tap exactly on the line between two squares of the map still gets there', () => {
  // The alley's door sits on such a line; so do these.
  for (const to of [spotOf('alley').door, { x: 1200, y: 1512 }, { x: 1440, y: 1680 }, { x: 480, y: 1200 }]) {
    assert.ok(canStand(to.x, to.y));
    const way = routeTo(HOME, to, canStand);
    assert.deepEqual(way[way.length - 1], to);
  }
});

test('a way is walked with the corners taken out: few points, every stretch clear, the same end', () => {
  const wide = roomy(canStand);
  for (const spot of SPOTS.slice(1)) {
    const squares = routeTo(HOME, spot.door, wide);
    const way = straighten(HOME, squares, wide);
    assert.ok(way.length >= 1 && way.length <= squares.length, spot.id);
    assert.ok(way.length <= Math.max(4, squares.length / 4), `${spot.id}: ${way.length} turns of ${squares.length} squares is a walk, not a staircase`);
    assert.deepEqual(way[way.length - 1], squares[squares.length - 1]);
    let at = HOME;
    for (const point of way) {
      assert.ok(clearWay(at, point, wide), `${spot.id}: a stretch comes too near something`);
      at = point;
    }
  }
  assert.deepEqual(straighten(HOME, [], canStand), []);
});

test('finding a way is quick enough to do while a finger drags across the screen', () => {
  const targets = [...SPOTS.map((spot) => spot.door), ...GARDEN.posts, { x: 60, y: 2150 }, { x: 1950, y: 60 }, { x: 1750, y: 300 }];
  const started = performance.now();
  let ways = 0;
  for (const from of [HOME, INSIDE, spotOf('dark').door]) for (const to of targets) { wayTo(from, to, everyone); ways++; }
  const each = (performance.now() - started) / ways;
  assert.ok(each < 25, `${each.toFixed(1)} ms a way`);
});

test('a position from a save is kept only if feet could really be there', () => {
  assert.deepEqual(settleWhere({ x: 150, y: 1780 }), { x: 150, y: 1780 });
  for (const bad of [null, undefined, 7, 'here', [], {}, { x: 'a', y: 1 }, { x: NaN, y: 5 }, { x: 1e308, y: 1e308 }, { x: -50, y: 20 }, { x: spotOf('wash').x, y: spotOf('wash').y - 10 }]) {
    assert.deepEqual(settleWhere(bad), HOME, JSON.stringify(bad));
  }
  const post = GARDEN.posts[1];
  assert.deepEqual(settleWhere({ x: post.x, y: post.y }), { x: post.x, y: post.y }, 'open grass when nobody is there');
  assert.deepEqual(settleWhere({ x: post.x, y: post.y }, GARDEN.posts), HOME, 'but not where a group is standing');
});

test('a new game starts at the door of home, and the save remembers where you walked to', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  assert.equal(game.near(), 'home');
  const to = { x: HOME.x - 40, y: HOME.y + 260 };
  assert.equal(game.walk(to, 0.1), true);
  for (let i = 0; i < 60; i++) game.walk(to, 0.1);
  assert.equal(game.near(), null);
  const back = reviveState(JSON.parse(game.serialize(NOW)), NOW);
  assert.deepEqual(back.where, game.state.where);
  assert.ok(Math.hypot(back.where.x - to.x, back.where.y - to.y) < 2);
});

// ---------------------------------------------------------------- the garden: a place you walk into

test('every built place is a stretch of the world with a gate, or a building you walk into, with a post for each stop of its path', () => {
  for (const room of ROOMS) {
    const area = districtOf(room.id);
    const inside = insideOf(room.id);
    if (!roomBuilt(room)) { assert.equal(area, null, `${room.id} is not built, so has nowhere to walk into`); assert.equal(inside, null); continue; }
    assert.ok(!!area !== !!inside, `${room.id} is one or the other`);
    if (inside) { assert.equal(inside.kind, 'place'); assert.equal(inside.posts.length, room.path.length); continue; } // (its floor is looked at in indoors.test.mjs)
    assert.equal(area.posts.length, room.path.length);
    assert.ok(canStand(area.gate.x, area.gate.y), 'the gateway is open ground');
    assert.equal(districtAt(area.gate), null, 'standing in the gateway is not yet inside');
    assert.equal(districtAt({ x: area.gate.x, y: area.gate.y - 30 }), room.id);
    for (const post of area.posts) {
      assert.equal(districtAt(post), room.id);
      assert.ok(canStand(post.x, post.y), 'a post is open ground once whoever stood there is calm');
      assert.ok(Math.hypot(post.x - area.gate.x, post.y - area.gate.y) > POST.meet + 100, 'nobody waits right in the gateway');
      for (const other of area.posts) if (other !== post) assert.ok(Math.hypot(post.x - other.x, post.y - other.y) > 2 * POST.meet + 20, 'two groups are never met at once');
    }
  }
  for (const odd of ['nowhere', 'constructor', '__proto__', null, 7]) assert.equal(districtOf(odd), null);
  assert.equal(districtAt(null), null);
  assert.equal(districtAt(HOME), null);
});

test('the garden is walled: the only way in is through its gate', () => {
  const inside = { x: 500, y: 500 };
  const open = follow(HOME, wayTo(HOME, inside), canStand).pos;
  assert.equal(districtAt(open), 'garden');
  // Stand someone in the gateway and there is no other way round.
  const shut = standing([GARDEN.gate]);
  const end = follow(HOME, wayTo(HOME, inside, shut), shut).pos;
  assert.equal(districtAt(end), null, 'with the gateway held, you stay outside');
  // And every bit of its edge that is not the gateway is solid, or the edge of the world.
  for (let x = WORLD.edge; x < GARDEN.x + GARDEN.w; x += 10) {
    const gap = Math.abs(x - GARDEN.gate.x) < 70;
    if (!gap) assert.equal(canStand(x, GARDEN.y + GARDEN.h + 20), false, `a gap in the hedge at x=${x}`);
  }
  for (let y = WORLD.edge; y < GARDEN.y + GARDEN.h; y += 10) assert.equal(canStand(GARDEN.x + GARDEN.w + 20, y), false, `a gap in the hedge at y=${y}`);
});

test('the alley is walled too, with junk down one side, the edge of the world down the other and a fence at its foot', () => {
  const ALLEY = DISTRICTS.alley;
  const up = { x: ALLEY.gate.x, y: 700 };
  const open = follow(HOME, wayTo(HOME, up), canStand).pos;
  assert.equal(districtAt(open), 'alley');
  const shut = standing([ALLEY.gate]);
  assert.equal(districtAt(follow(HOME, wayTo(HOME, up, shut), shut).pos), null, 'with the gateway held, you stay outside');
  for (let y = WORLD.edge; y < ALLEY.y + ALLEY.h; y += 10) {
    assert.equal(canStand(ALLEY.x - 20, y), false, `a gap in the junk at y=${y}`);
    assert.equal(canStand(ALLEY.x + ALLEY.w + 4, y), false, 'and nothing past the edge of the world');
  }
  for (let x = ALLEY.x - 40; x < WORLD.w; x += 10) {
    const gap = Math.abs(x - ALLEY.gate.x) < 70;
    if (!gap) assert.equal(canStand(x, ALLEY.y + ALLEY.h + 20), false, `a gap in the fence at x=${x}`);
  }
  assert.equal(ALLEY.narrow, true);
  assert.equal(GARDEN.narrow, undefined, 'the garden is open ground');
});

test('the alley is one group wide: whoever waits there fills it from wall to wall', () => {
  const ALLEY = DISTRICTS.alley;
  ALLEY.posts.forEach((post, i) => {
    const held = standing([post]);
    for (let x = ALLEY.x; x <= WORLD.w; x += 2) assert.equal(held(x, post.y), false, `room to slip past group ${i} at x=${x}`);
    assert.ok(canStand(post.x, post.y + POST.hold + 8), 'you can stand in front of them');
    if (i > 0) assert.ok(post.y < ALLEY.posts[i - 1].y, 'each further up the alley than the last');
    // With them standing there, no way leads from the gate to anywhere beyond them.
    const beyond = { x: post.x, y: post.y - POST.hold - 30 };
    const start = { x: ALLEY.gate.x, y: ALLEY.gate.y - 60 };
    const end = follow(start, wayTo(start, beyond, held), held).pos;
    assert.ok(end.y > post.y || districtAt(end) !== 'alley', `a way past group ${i}`);
  });
  // The garden is not like that: there is room round everyone.
  for (const post of GARDEN.posts) assert.ok([-1, 1].some((side) => standing([post])(post.x + side * (POST.hold + 20), post.y)));
});

test('whoever is waiting holds their ground: you cannot walk through them, but you can walk up to every one', () => {
  for (const post of GARDEN.posts) {
    assert.equal(everyone(post.x, post.y), false);
    assert.equal(everyone(post.x, post.y + POST.hold - 1), false);
    const { pos, stuck } = follow(INSIDE, wayTo(INSIDE, post, everyone), everyone);
    assert.equal(stuck, false);
    assert.equal(postNear(GARDEN.posts, pos), GARDEN.posts.indexOf(post), 'a tap on a group walks you up to it');
  }
  assert.equal(postNear(GARDEN.posts, INSIDE), -1);
  assert.equal(postNear([null, GARDEN.posts[1]], { x: GARDEN.posts[0].x, y: GARDEN.posts[0].y }), -1, 'a group that is not there is not met');
});

test('you are never shut in: from beside any group, with everyone still waiting, there is a way home', () => {
  for (const post of GARDEN.posts) {
    const beside = follow(INSIDE, wayTo(INSIDE, post, everyone), everyone).pos;
    const { pos, stuck } = follow(beside, wayTo(beside, HOME, everyone), everyone);
    assert.equal(stuck, false);
    assert.equal(spotNear(pos), 'home');
  }
});

test('groups can be reached in any order: none stands in the way of another', () => {
  // With every group still waiting, walk from beside each one to beside each other one.
  const beside = GARDEN.posts.map((post) => follow(INSIDE, wayTo(INSIDE, post, everyone), everyone).pos);
  for (let a = 0; a < beside.length; a++) {
    for (let b = 0; b < beside.length; b++) {
      if (a === b) continue;
      const { pos, stuck } = follow(beside[a], wayTo(beside[a], GARDEN.posts[b], everyone), everyone);
      assert.equal(stuck, false, `${a} to ${b}`);
      assert.equal(postNear(GARDEN.posts, pos), b, `${a} to ${b}`);
    }
  }
});

// ---------------------------------------------------------------- the game in the world

test('the game finds the way for wherever you are, and none during a fight', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  assert.ok(game.routeTo(spotOf('garden').door).length >= 1);
  game.travelTo('garden');
  assert.equal(game.district(), 'garden');
  const way = game.routeTo(GARDEN.posts[0]);
  assert.ok(way.length >= 1 && way.every((point) => everyone(point.x, point.y)));
  game.startEncounter();
  assert.equal(game.standing(), null);
  assert.deepEqual(game.routeTo({ x: 100, y: 100 }), []);
});

test('a fair roll for a stop is the right boss, the right numbers, the right kinds and levels', () => {
  const boss = { species: 'boss_hydra', level: 5, heirloom: false };
  const puff = { species: 'dandepuff', level: 3, heirloom: false };
  assert.equal(fairEncounter(ROOMS[0], 4, [puff, boss, puff]), true);
  for (const unfair of [
    [puff, puff], [boss], [puff, boss, puff, puff], [puff, { ...boss, level: 1 }, puff], [puff, { ...boss, heirloom: true }, puff], [boss, boss, puff],
    [{ ...puff, level: 9 }, boss, puff], [{ ...puff, species: 'gnome' }, boss, puff], [{ ...puff, species: 'constructor' }, boss, puff],
    [{ ...puff, heirloom: 'yes' }, boss, puff], [null, boss, puff], 'boss', null, [],
  ]) assert.equal(fairEncounter(ROOMS[0], 4, unfair), false, JSON.stringify(unfair));
  assert.equal(fairEncounter(ROOMS[0], 0, [boss]), false, 'no boss at the gate');
  assert.equal(fairEncounter(ROOMS[0], 9, [puff]), false);
});

test('a save cannot calm the boss early, swap it for something soft, or stand you where a group is', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  game.travelTo('garden');
  const saved = JSON.parse(game.serialize(NOW));
  const kept = reviveState(JSON.parse(JSON.stringify(saved)), NOW);
  assert.deepEqual(kept.visit, saved.visit, 'an honest visit comes back as it was');
  assert.deepEqual(kept.where, saved.where);

  const far = GARDEN.posts[4];
  const soft = [{ species: 'dandepuff', level: 1, heirloom: false }];
  const edited = { ...saved, where: { x: far.x, y: far.y }, visit: { ...saved.visit, stop: 4, groups: saved.visit.groups.map((group, i) => (i === 4 ? { foes: soft, done: true } : { ...group, done: i === 1 })) } };
  const back = reviveState(edited, NOW);
  assert.deepEqual(back.where, HOME, 'standing on the boss is not somewhere feet can be');
  assert.equal(back.visit.groups[4].done, false, 'the boss is not calm until it has been met');
  assert.equal(fairEncounter(ROOMS[0], 4, back.visit.groups[4].foes), true, 'and is still the boss');
  assert.ok(back.visit.groups[4].foes.some((foe) => foe.species === 'boss_hydra'));
  assert.deepEqual(back.visit.groups.map((group) => group.done), [false, true, false, false, false]);
  assert.equal(back.visit.stop, 1, 'how many are calm is counted, not taken on trust');

  const calmed = saved.visit.groups.map((group, i) => ({ ...group, done: i === 1 }));
  const there = reviveState({ ...saved, where: { ...GARDEN.posts[1] }, visit: { ...saved.visit, groups: calmed } }, NOW);
  assert.deepEqual(there.where, GARDEN.posts[1], 'where a calmed group stood is open grass');
  const hedge = HEDGES[2];
  assert.deepEqual(reviveState({ ...saved, where: { x: hedge.x + 20, y: hedge.y + 300 } }, NOW).where, HOME);
  for (const groups of [null, 'all', 7, {}, [], [null, null], Array(5).fill({ foes: 'everyone', done: 'yes' })]) {
    const mended = reviveState({ ...saved, visit: { ...saved.visit, groups } }, NOW);
    if (!Array.isArray(groups)) { assert.equal(mended.visit, null, 'not a visit at all'); continue; }
    assert.equal(mended.visit.groups.length, 5);
    mended.visit.groups.forEach((group, stop) => { assert.equal(group.done, false); assert.equal(fairEncounter(ROOMS[0], stop, group.foes), true); });
  }
});

test('a save from before the world was laid out afresh wakes up rested, at the door of home', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  game.travelTo('garden');
  const saved = JSON.parse(game.serialize(NOW));
  const old = reviveState({ ...saved, v: 1, where: { x: 320, y: 1700 }, visit: { room: 'garden', stop: 2, hp: saved.visit.hp, at: { x: 320, y: 900 }, waiting: [] } }, NOW);
  assert.equal(old.v, 2);
  assert.equal(old.visit, null);
  assert.deepEqual(old.where, HOME);
  assert.equal(old.friends.length, saved.friends.length, 'and keeps everything else');
});

test('worn out, the team is carried home; after a win you stay where you stood', () => {
  const lost = new Game(newState(NOW, 3), { now: NOW, fx: false });
  lost.travelTo('garden');
  lost.startEncounter(); lost.concede(); lost.finishBattle();
  assert.equal(lost.near(), 'home');
  assert.equal(lost.place(), 'lane');
});
