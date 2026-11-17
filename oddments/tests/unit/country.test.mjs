// The country beyond the lane: the stretches of the world and their names,
// the things that stand about them, the benches you can rest on, and that
// every place is still somewhere you can walk to and back from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState } from '../../web/js/core/state.js';
import { ROOMS } from '../../web/js/core/balance.js';
import { WORLD, REGIONS, PROPS, PROP_ROUND, BENCHES, SIT, MAILBOXES, POST_REACH, WILDS, SPOTS, PEOPLE, TREES, LAMPS, ROAD_POINTS, GREEN, DISTRICTS, regionAt, benchNear, mailNear, canStand, districtAt, spotOf, personAt, routeTo, straighten, roomy } from '../../web/js/core/world.js';
import { PROP_WIDE, WORLD_ART, worldSrc, wallOf } from '../../web/js/ui/scenery.js';
import { playOut } from '../../web/js/core/auto.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const NOW = 1_800_000_000_000;
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}

test('the world is the lane and the country south of it: five stretches from top to bottom, each with a name', () => {
  assert.deepEqual(REGIONS.map((region) => region.id), ['lane', 'bramble', 'row', 'meadow', 'hill']);
  assert.equal(REGIONS[0].y, 0);
  for (let i = 1; i < REGIONS.length; i++) assert.ok(REGIONS[i].y > REGIONS[i - 1].y + 400 && REGIONS[i].y < WORLD.h - 400, `${REGIONS[i].id} is a good stretch of ground`);
  assert.equal(new Set(REGIONS.map((region) => region.name)).size, REGIONS.length);
  assert.ok(WORLD.h >= 4800, 'the world is several lanes long');
  // Home and the first three places are on the lane; two more on each of the rows beyond; the far shed at the very end.
  const where = Object.fromEntries(SPOTS.map((spot) => [spot.id, regionAt(spot.door).id]));
  assert.deepEqual(where, { home: 'lane', garden: 'lane', alley: 'lane', pantry: 'lane', wash: 'row', stacks: 'row', rooftops: 'hill', attic: 'hill', dark: 'hill' });
  assert.equal(regionAt({ x: 5, y: -40 }).id, 'lane');
  assert.equal(regionAt({ x: 5, y: 1e9 }).id, 'hill');
  assert.equal(regionAt(null).id, 'lane');
  // Places open in the order you come to them walking south: nothing asks you to walk past a later one to an earlier.
  const south = ROOMS.map((room) => spotOf(room.id).door.y);
  for (let i = 3; i < south.length; i++) assert.ok(south[i] >= south[i - 1] - 200, `${ROOMS[i].id} is no nearer home than the one before`);
});

test('every place can be walked to from home and home from it, by the way the game finds, and a street runs all the way', () => {
  const home = spotOf('home').door;
  const can = roomy(canStand);
  for (const spot of SPOTS) {
    for (const [from, to] of [[home, spot.door], [spot.door, home]]) {
      const way = straighten(from, routeTo(from, to, can, WORLD), can);
      const end = way.length ? way[way.length - 1] : from;
      assert.ok(far(end, to) < 4, `${spot.id}: the way gets there`);
    }
  }
  // The streets join up: from the street past home you can follow streets to the last door.
  const points = ROAD_POINTS.flat();
  const reached = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const at = points[queue.pop()];
    points.forEach((point, i) => { if (!reached.has(i) && far(point, at) < 60) { reached.add(i); queue.push(i); } });
  }
  assert.equal(reached.size, points.length, 'every stretch of street joins the rest');
});

test('things stand about the country: each on open ground off the streets, solid, clear of doors, and with a painting', () => {
  assert.ok(PROPS.length >= 25);
  const roads = ROAD_POINTS.flat();
  for (const prop of PROPS) {
    assert.ok(PROP_ROUND[prop.kind] > 0 && prop.r === PROP_ROUND[prop.kind], prop.kind);
    assert.ok(PROP_WIDE[prop.kind] >= prop.r * 2 - 10, `${prop.kind} is painted about as wide as the ground it takes`);
    assert.ok(WORLD_ART.includes(`r_${prop.kind}`) && existsSync(`${WEB}${worldSrc(`r_${prop.kind}`)}`), `${prop.kind} has a painting`);
    assert.equal(canStand(prop.x, prop.y), false, `${prop.kind} at ${prop.x},${prop.y} is solid`);
    assert.ok(canStand(prop.x, prop.y + prop.r + WORLD.body + 2) || canStand(prop.x + prop.r + WORLD.body + 2, prop.y) || canStand(prop.x - prop.r - WORLD.body - 2, prop.y), `${prop.kind}: but you can stand beside it`);
    assert.equal(districtAt(prop), null);
    assert.ok(Math.min(...roads.map((point) => far(point, prop))) >= prop.r + WORLD.body + 4, `${prop.kind} at ${prop.x},${prop.y} is not in a street`);
    for (const spot of SPOTS) assert.ok(far(spot.door, prop) > 80, `${prop.kind} is not on the doorstep of ${spot.id}`);
    for (const other of PROPS) if (other !== prop) assert.ok(far(other, prop) > 100, `${prop.kind} and ${other.kind} are apart`);
    for (const tree of TREES) assert.ok(far(tree, prop) > prop.r + 40, `${prop.kind} is not in a tree`);
    for (const wild of WILDS) assert.ok(far(wild, prop) > prop.r + 70, `${prop.kind} is not where strays turn up`);
  }
  // A signpost says something; nothing else does. And there is one wherever one stretch gives way to the next.
  const signs = PROPS.filter((prop) => prop.kind === 'signpost');
  assert.ok(signs.length >= 4 && signs.every((sign) => typeof sign.says === 'string' && sign.says.length > 8 && sign.says.length <= 48));
  assert.ok(PROPS.every((prop) => prop.kind === 'signpost' || prop.says === undefined));
  // White fences on the rows are painted from the country's own fence.
  assert.ok(wallOf({ x: 100, y: 100, w: 200, h: 26, look: 'picket' }).every((piece) => piece.art === 'r_fence' && piece.y > 100));
});

test('most of the quiet spots where strays turn up are out in the country, and some are in every stretch of it', () => {
  const south = WILDS.filter((spot) => spot.y >= REGIONS[1].y);
  assert.ok(south.length >= WILDS.length * 0.6, `${south.length} of ${WILDS.length} are south of the lane`);
  for (const region of REGIONS) assert.ok(WILDS.some((spot) => regionAt(spot).id === region.id), `there is one somewhere in ${region.name}`);
});

test('there is a bench on each row beyond the lane, and sitting on one rests everyone as home does', () => {
  assert.deepEqual(BENCHES.map((bench) => bench.id).sort(), ['hill', 'row']);
  for (const bench of BENCHES) {
    assert.equal(regionAt(bench).id, bench.id);
    assert.ok(far(bench, spotOf('home').door) > 1500, 'it is a long walk from home');
    assert.equal(benchNear({ x: bench.x, y: bench.y + SIT - 2 }), bench.id);
    assert.equal(benchNear({ x: bench.x, y: bench.y + SIT + 4 }), null);
  }
  assert.equal(benchNear(spotOf('home').door), null);
  assert.equal(benchNear(null), null);

  const game = fresh(5);
  for (const friend of game.state.friends) friend.level = 6;
  assert.equal(game.standAtBench('row'), true);
  assert.equal(game.benchNear(), 'row');
  assert.equal(game.rest(), false, 'rested already: nothing to rest from');
  // Out on a visit, with one group calm: sit down, and everyone is fresh; who was calm is calm; others are out.
  game.travelTo('garden');
  playOut(game.startEncounter(0), {});
  assert.equal(game.finishBattle().won, true);
  game.state.visit.hp = Object.fromEntries(game.team().map((friend) => [friend.id, 3]));
  const strays = JSON.stringify(game.state.strays);
  assert.equal(game.standAtBench('hill'), true);
  assert.equal(game.rest(), true);
  assert.equal(game.state.visit, null);
  assert.equal(game.rested(), true);
  for (const member of game.teamHealth()) assert.equal(member.hp, member.max);
  assert.equal(game.state.rooms.garden.calmed, 0b00001);
  assert.notEqual(JSON.stringify(game.state.strays), strays);
  assert.equal(game.benchNear(), 'hill', 'and you are still sitting where you sat');
  // Worn from strays alone, a bench will do as well.
  const one = game.strays()[0];
  game.approachStrays(one.index);
  playOut(game.startStrays(), {});
  assert.equal(game.finishBattle().won, true);
  assert.equal(game.rested(), false);
  game.state.where = { x: 1000, y: 1000 };
  assert.equal(game.rest(), false, 'not just anywhere');
  game.standAtBench('row');
  assert.equal(game.rest(), true);
  assert.equal(game.standAtBench('nowhere'), false);
  // Not from indoors, and not in a fight.
  game.standAt('home');
  game.enter('home');
  assert.equal(game.benchNear(), null);
});

test('worn out anywhere in the world, you are carried all the way home', () => {
  const game = fresh(4);
  for (const room of ROOMS.slice(0, 7)) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 31; }
  for (const friend of game.state.friends) friend.level = 1;
  assert.equal(game.travelTo('dark'), true);
  assert.equal(regionAt(game.state.where).id, 'hill');
  game.state.visit.hp = Object.fromEntries(game.team().map((friend) => [friend.id, 1]));
  assert.equal(game.approach(0), true);
  playOut(game.startEncounter(0), { careless: true });
  assert.equal(game.finishBattle().won, false);
  assert.equal(game.near(), 'home');
  assert.equal(regionAt(game.state.where).id, 'lane');
  assert.equal(game.indoors(), null);
});

// ------------------------------------------------------------------ mailboxes

test('there is a mailbox by home and by each of the four far houses, and a note posted in one tells Ines Tock what talking to her would', () => {
  assert.equal(MAILBOXES.length, 5);
  for (const id of ['home', 'wash', 'stacks', 'rooftops', 'attic']) assert.ok(MAILBOXES.some((box) => far(box, spotOf(id).door) < 260), `one near the door of ${id}`);
  MAILBOXES.forEach((box, i) => {
    assert.equal(mailNear({ x: box.x, y: box.y + POST_REACH - 2 }), i);
    assert.equal(mailNear({ x: box.x, y: box.y + POST_REACH + 6 }), -1);
  });
  assert.equal(mailNear(null), -1);

  const game = fresh(8);
  game.begin({ name: 'Kit' });
  assert.equal(game.standAtMail(1), true);
  assert.equal(game.mailNear(), 1);
  assert.equal(game.postToInes(), null, 'you have not met her yet: a first meeting is face to face');
  game.standBy('ines');
  assert.ok(game.talkTo('ines'));
  game.standAtMail(1);
  assert.equal(game.postToInes(), null, 'and with no news there is nothing to post');
  // Calm the garden: now there is news, and it can go in the post from the far end of the world.
  game.state.rooms.garden.clears = 1;
  game.state.rooms.garden.calmed = 31;
  assert.equal(game.goal().id, 'report');
  assert.match(game.goal().detail, /mailbox/);
  const twin = new Game(JSON.parse(JSON.stringify(game.state)), { now: NOW, fx: false });
  twin.standBy('ines');
  const spoken = twin.talkTo('ines');
  assert.equal(game.standAtMail(4), true);
  const written = game.postToInes();
  assert.deepEqual(written, spoken, 'her answer by return is what she would have said');
  assert.equal(game.state.story.ines, twin.state.story.ines);
  assert.notEqual(game.goal().id, 'report', 'and the goal moves on');
  assert.equal(game.postToInes(), null, 'once told, there is nothing more to post');
  // Not from across the road, from indoors, or in a fight.
  game.state.rooms.alley.clears = 1;
  game.state.where = { x: 1000, y: 1000 };
  assert.equal(game.mailNear(), -1);
  assert.equal(game.postToInes(), null);
  game.standAt('home');
  game.enter('home');
  assert.equal(game.mailNear(), -1);
  assert.equal(game.standAtMail(99), false);
});
