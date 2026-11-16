// The lane: the open world you walk around between places.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, SPOTS, SPOT_IDS, TREES, LAMPS, AREAS, POST, canStand, canStandIn, meetingAt, atGate, areaOf, stepWalk, routeTo, straighten, clearWay, roomy, spotNear, spotOf, settleWhere } from '../../web/js/core/world.js';
import { ROOM_IDS, ROOMS, roomBuilt } from '../../web/js/core/balance.js';
import { fairEncounter } from '../../web/js/core/rooms.js';
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
    assert.ok(spot.block.x >= WORLD.edge && spot.block.x + spot.block.w <= WORLD.w - WORLD.edge && spot.y - spot.tall >= 0, `${spot.id} is inside the world`);
  }
  assert.equal(spotOf('garden').id, 'garden');
  assert.equal(spotOf('nowhere'), null);
});

test('no two doors are close enough to be confused, and no building or tree blocks a door', () => {
  for (const a of SPOTS) {
    for (const b of SPOTS) {
      if (a !== b) assert.ok(Math.hypot(a.door.x - b.door.x, a.door.y - b.door.y) > WORLD.reach * 2, `${a.id} and ${b.id}`);
    }
    for (const thing of [...TREES, ...LAMPS]) assert.ok(Math.hypot(a.door.x - thing.x, a.door.y - thing.y) > WORLD.reach, `something standing by ${a.id}'s door`);
  }
});

test('feet cannot go outside the lane, into a building, or through a tree trunk', () => {
  assert.equal(canStand(-5, 800), false);
  assert.equal(canStand(WORLD.w + 5, 800), false);
  assert.equal(canStand(320, -5), false);
  assert.equal(canStand(320, WORLD.h + 5), false);
  for (const bad of [NaN, Infinity, undefined]) assert.equal(canStand(bad, 800), false);
  for (const spot of SPOTS) assert.equal(canStand(spot.x, spot.y - 20), false, `inside ${spot.id}`);
  for (const tree of TREES) assert.equal(canStand(tree.x, tree.y), false);
  assert.equal(LAMPS.length, SPOTS.length, 'a lamp by every building');
  for (const lamp of LAMPS) assert.equal(canStand(lamp.x, lamp.y), false, 'nobody walks through a lamp post');
  const garden = spotOf('garden');
  assert.equal(canStand(garden.x, garden.y - garden.tall + 10), true, 'behind a roof is open ground');
});

test('a step covers speed x time, straight toward the target, and stops when it gets there', () => {
  const from = { x: 320, y: 1800 };
  const up = { x: 320, y: 1750 };
  const one = stepWalk(from, up, 0.05);
  assert.equal(one.moving, true);
  assert.ok(Math.abs(one.y - (1800 - WORLD.speed * 0.05)) < 1e-9 && one.x === 320);
  const short = stepWalk(from, { x: 323, y: 1800 }, 0.05);
  assert.deepEqual([short.x, short.y], [323, 1800], 'never past the target');
  assert.equal(stepWalk(from, from, 0.05).moving, false);
  assert.equal(stepWalk(from, up, 0).moving, false);
  assert.equal(stepWalk(from, up, -1).moving, false);
});

test('a long gap between frames is walked as a short one: nobody steps through a wall', () => {
  const home = spotOf('home');
  const below = { x: home.x, y: home.y + 34 };
  const jump = stepWalk(below, { x: home.x, y: home.y - 300 }, 30);
  assert.ok(Math.hypot(jump.x - below.x, jump.y - below.y) <= WORLD.speed * WORLD.maxStep + 1e-9);
  const { pos } = walk(below, { x: home.x, y: home.y - 300 });
  assert.ok(pos.y > home.block.y + home.block.h, 'walking straight at the front wall stops in front of it');
});

test('every place can be walked to from the one before, and all the way home again, in a few seconds', () => {
  // The way the game walks: find the way, take the corners out, head for each point in turn.
  const trip = (from, to) => {
    let pos = { ...from };
    let seconds = 0;
    for (const point of straighten(from, routeTo(from, to, roomy(canStand), WORLD), roomy(canStand))) {
      const leg = walk(pos, point);
      pos = leg.pos;
      seconds += leg.seconds;
    }
    return { pos, seconds };
  };
  const home = spotOf('home').door;
  let pos = home;
  for (const spot of SPOTS.slice(1)) {
    const leg = trip(pos, spot.door);
    assert.equal(spotNear(leg.pos), spot.id, `walked from the last door to ${spot.id}`);
    assert.ok(leg.seconds < 6, `${spot.id}: ${leg.seconds.toFixed(1)}s`);
    pos = leg.pos;
  }
  const back = trip(pos, home);
  assert.equal(spotNear(back.pos), 'home');
  assert.ok(back.seconds < 12, `all the way home is ${back.seconds.toFixed(1)}s`);
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
  assert.equal(spotNear({ x: 320, y: 1380 }), null, 'the middle of the lane');
});

test('a position from a save is kept only if feet could really be there', () => {
  const home = spotOf('home').door;
  assert.deepEqual(settleWhere({ x: 150, y: 1780 }), { x: 150, y: 1780 });
  for (const bad of [null, undefined, 7, 'here', [], {}, { x: 'a', y: 1 }, { x: NaN, y: 5 }, { x: 1e308, y: 1e308 }, { x: -50, y: 20 }, { x: spotOf('wash').x, y: spotOf('wash').y - 10 }]) {
    assert.deepEqual(settleWhere(bad), home, JSON.stringify(bad));
  }
});

test('a new game starts at the door of home, and the save remembers where you walked to', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  assert.equal(game.near(), 'home');
  assert.equal(game.walk({ x: 150, y: 1780 }, 0.1), true);
  for (let i = 0; i < 60; i++) game.walk({ x: 150, y: 1780 }, 0.1);
  assert.equal(game.near(), null);
  const back = reviveState(JSON.parse(game.serialize(NOW)), NOW);
  assert.deepEqual(back.where, game.state.where);
  assert.ok(Math.hypot(back.where.x - 150, back.where.y - 1780) < 2);
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

test('there is no walking during a fight, and walking inside a place does not move you in the lane', () => {
  const game = new Game(newState(NOW, 3), { now: NOW });
  game.travelTo('garden');
  const outside = { ...game.state.where };
  assert.equal(game.walk({ x: 200, y: 1400 }, 0.1), true, 'inside, you walk');
  assert.deepEqual(game.state.where, outside);
  assert.equal(game.standAt('home'), false);
  const inside = { ...game.state.visit.at };
  game.startEncounter();
  assert.equal(game.walk({ x: 300, y: 300 }, 0.1), false);
  assert.deepEqual(game.state.visit.at, inside);
  for (const bad of [null, undefined, {}, { x: NaN, y: 1 }, 'north']) assert.equal(new Game(newState(NOW, 3), { now: NOW }).walk(bad, 0.1), false);
});

// ---------------------------------------------------------------- inside a place

const GARDEN = AREAS.garden;
const inside = (x, y, stop = 0) => canStandIn(GARDEN, x, y, stop);

test('every built room has an inside to walk through, with a post for each stop of its path', () => {
  for (const room of ROOMS) {
    assert.equal(!!areaOf(room.id), roomBuilt(room), room.id);
    if (!roomBuilt(room)) continue;
    const area = areaOf(room.id);
    assert.equal(area.posts.length, room.path.length);
    assert.ok(canStandIn(area, area.gate.x, area.gate.y, 0), 'the gate is somewhere feet can be');
    assert.ok(atGate(area, area.gate));
  }
  assert.equal(areaOf('constructor'), null);
  assert.equal(areaOf('alley'), null);
});

test('inside, feet cannot go through a hedge or past the edge', () => {
  for (const block of GARDEN.blocks) assert.equal(inside(block.x + block.w / 2, block.y + block.h / 2, 99), false);
  assert.equal(inside(-10, 700, 99), false);
  assert.equal(inside(320, GARDEN.h + 10, 99), false);
  assert.equal(inside(320, 1400), true);
});

test('whoever is waiting holds their ground until they are dealt with: there is no way past them', () => {
  GARDEN.posts.forEach((post, stop) => {
    assert.equal(inside(post.x, post.y, stop), false, `stop ${stop} holds its post`);
    assert.equal(inside(post.x, post.y, stop + 1), true, `and it is open ground once they are gone`);
    assert.equal(meetingAt(GARDEN, { x: post.x, y: post.y + POST.hold + 4 }, stop), true);
    assert.equal(meetingAt(GARDEN, { x: post.x, y: post.y + POST.meet + 40 }, stop), false);
  });
  // Walk at the far end from the gate with nobody dealt with: you get as far as the first group and no further.
  let pos = { ...GARDEN.gate };
  const far = GARDEN.posts[GARDEN.posts.length - 1];
  for (const via of [GARDEN.posts[0], far, { x: 620, y: 20 }, { x: 20, y: 20 }, far]) {
    for (let i = 0; i < 900; i++) { const next = stepWalk(pos, via, 1 / 30, (x, y) => inside(x, y, 0)); if (!next.moving) break; pos = next; }
  }
  assert.ok(pos.y > GARDEN.blocks[0].y, `still below the first hedge at y=${Math.round(pos.y)}`);
});

/** Walks a route the way the screen does: head for each point in turn. */
function follow(from, way, can) {
  let pos = { ...from };
  for (const point of way) {
    for (let i = 0; i < 400; i++) { const next = stepWalk(pos, point, 1 / 30, can); if (!next.moving) break; pos = next; }
  }
  return pos;
}

test('with each group dealt with the way on opens, all the way to the boss', () => {
  let pos = { ...GARDEN.gate };
  GARDEN.posts.forEach((post, stop) => {
    const can = (x, y) => inside(x, y, stop);
    // Tap on them: the way leads round the hedges and stops where they are holding their ground.
    const way = routeTo(pos, post, can, GARDEN);
    assert.ok(way.length > 0 && way.every((point) => can(point.x, point.y)), `the way to stop ${stop} never goes through anything`);
    pos = follow(pos, way, can);
    assert.equal(meetingAt(GARDEN, pos, stop), true, `walked up to stop ${stop}`);
  });
});

test('a way is found round whatever is between, and a tap on something solid leads as near as feet can get', () => {
  const home = spotOf('home').door;
  for (const spot of SPOTS) {
    const way = routeTo(home, spot.door, canStand, WORLD);
    assert.ok(way.every((point) => canStand(point.x, point.y)));
    assert.equal(spotNear(follow(home, way, canStand)), spot.id, `the way from home to ${spot.id}`);
  }
  const wash = spotOf('wash');
  const roof = { x: wash.x, y: wash.y - 30 }; // a tap on the building itself
  assert.equal(canStand(roof.x, roof.y), false);
  const near = follow(home, routeTo(home, roof, canStand, WORLD), canStand);
  assert.ok(Math.hypot(near.x - roof.x, near.y - roof.y) < 90, 'ends beside the building');
  assert.deepEqual(routeTo(home, home, canStand, WORLD), []);
  assert.deepEqual(routeTo(home, { x: NaN, y: 3 }, canStand, WORLD), []);
  assert.ok(routeTo(home, { x: 1e9, y: -1e9 }, canStand, WORLD).length > 0, 'a tap far outside the world still walks toward it');
});

test('a way is walked with the corners taken out: fewer points, every stretch clear, the same end', () => {
  const home = spotOf('home').door;
  for (const spot of SPOTS.slice(1)) {
    const squares = routeTo(home, spot.door, roomy(canStand), WORLD);
    const way = straighten(home, squares, roomy(canStand));
    assert.ok(way.length >= 1 && way.length <= squares.length, spot.id);
    assert.ok(way.length <= Math.max(3, squares.length / 4), `${spot.id}: ${way.length} turns of ${squares.length} squares is a walk, not a staircase`);
    assert.deepEqual(way[way.length - 1], squares[squares.length - 1]);
    let at = home;
    for (const point of way) {
      if (point !== way[0]) assert.ok(clearWay(at, point, roomy(canStand)), `${spot.id}: a stretch comes too near something`);
      at = point;
    }
    assert.equal(spotNear(follow(home, way, canStand)), spot.id);
  }
  assert.deepEqual(straighten(home, [], canStand), []);
});

test('the lane and every inside are exactly one screen wide', () => {
  assert.equal(WORLD.w, 640);
  for (const area of Object.values(AREAS)) assert.equal(area.w, WORLD.w);
});

test('a way keeps a little clear of everything, so walking it never brushes a lamp post or a corner', () => {
  const wide = roomy(canStand);
  for (const lamp of LAMPS) {
    assert.equal(canStand(lamp.x + 24, lamp.y), true, 'feet can pass close by a lamp');
    assert.equal(wide(lamp.x + 24, lamp.y), false, 'but a way is not laid that close');
  }
  // Walk every door to every other door, a frame at a time: never once blocked on the way.
  for (const a of SPOTS) {
    for (const b of SPOTS) {
      if (a === b) continue;
      let pos = { ...a.door };
      for (const point of straighten(pos, routeTo(pos, b.door, wide, WORLD), wide)) {
        for (let i = 0; i < 2000; i++) {
          if (Math.hypot(point.x - pos.x, point.y - pos.y) < 7) break;
          const next = stepWalk(pos, point, 1 / 60);
          assert.equal(next.moving, true, `stuck walking from ${a.id} to ${b.id} at ${Math.round(pos.x)},${Math.round(pos.y)}`);
          pos = next;
        }
      }
      assert.equal(spotNear(pos), b.id, `${a.id} to ${b.id}`);
    }
  }
});

test('the game finds the way for wherever you are, and none during a fight', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  assert.ok(game.routeTo(spotOf('garden').door).length >= 1);
  game.travelTo('garden');
  assert.deepEqual(game.standing(), GARDEN.gate);
  const way = game.routeTo(GARDEN.posts[0]);
  assert.ok(way.length >= 1 && way.every((point) => inside(point.x, point.y, 0)));
  game.startEncounter();
  assert.equal(game.standing(), null);
  assert.deepEqual(game.routeTo({ x: 100, y: 100 }), []);
});

test('walking in puts you at the gate with the first group already waiting where you can see them', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  game.travelTo('garden');
  const visit = game.state.visit;
  assert.deepEqual(visit.at, GARDEN.gate);
  assert.equal(game.atGate(), true);
  assert.equal(game.meeting(), false);
  assert.equal(fairEncounter(ROOMS[0], 0, visit.waiting), true);
  const seen = JSON.stringify(visit.waiting);
  assert.equal(game.approach(), true);
  assert.equal(game.meeting(), true);
  assert.equal(game.atGate(), false);
  const battle = game.startEncounter();
  assert.equal(JSON.stringify(battle.units.filter((u) => u.side === 'foe').map((u) => ({ species: u.species, level: u.level, heirloom: u.heirloom }))), seen, 'who you saw is who you fight');
});

test('after a win the next group is waiting further on; you stay where you were standing', () => {
  const game = new Game(newState(NOW, 8), { now: NOW, fx: false });
  game.travelTo('garden');
  game.approach();
  const stood = { ...game.state.visit.at };
  const battle = game.startEncounter();
  for (const unit of battle.units) if (unit.side === 'foe') unit.hp = 0;
  battle.phase = 'won';
  game.finishBattle();
  assert.equal(game.state.visit.stop, 1);
  assert.deepEqual(game.state.visit.at, stood);
  assert.equal(fairEncounter(ROOMS[0], 1, game.state.visit.waiting), true);
  assert.equal(game.meeting(), false, 'the next ones are further in');
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

test('a save cannot put you past a group, swap the boss for something soft, or stand you in a hedge', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  game.travelTo('garden');
  const saved = JSON.parse(game.serialize(NOW));
  const far = GARDEN.posts[4];
  const edited = { ...saved, visit: { ...saved.visit, stop: 4, at: { x: far.x, y: far.y }, waiting: [{ species: 'dandepuff', level: 1, heirloom: false }] } };
  const back = reviveState(edited, NOW);
  assert.deepEqual(back.visit.at, GARDEN.gate, 'standing on the boss is not somewhere feet can be');
  assert.equal(fairEncounter(ROOMS[0], 4, back.visit.waiting), true, 'the boss is still the boss');
  assert.ok(back.visit.waiting.some((foe) => foe.species === 'boss_hydra'));
  const hedge = GARDEN.blocks[0];
  assert.deepEqual(reviveState({ ...saved, visit: { ...saved.visit, at: { x: hedge.x + 50, y: hedge.y + 10 } } }, NOW).visit.at, GARDEN.gate);
  const kept = reviveState(JSON.parse(JSON.stringify(saved)), NOW);
  assert.deepEqual(kept.visit, saved.visit, 'an honest visit comes back as it was');
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
