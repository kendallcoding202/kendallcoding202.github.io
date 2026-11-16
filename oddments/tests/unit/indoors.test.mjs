// Going indoors: the floors of the buildings you can walk into, what there is
// to do on them, and how a visit to a place you walk into by its door goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { ROOMS, roomOf, roomBuilt } from '../../web/js/core/balance.js';
import { POST, spotOf, districtOf, clearWay } from '../../web/js/core/world.js';
import { INSIDES, INSIDE_IDS, INDOOR, insideOf, canStandIn, standingIn, routeIn, spotIn, onMat, besidePost, settleIn } from '../../web/js/core/indoors.js';
import { playOut } from '../../web/js/core/auto.js';

const NOW = 1_800_000_000_000;
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}
const openPantry = (game) => { game.state.rooms.garden.clears = 1; game.state.rooms.alley.clears = 1; };

test('every inside is a building that stands in the lane: home, and each built place that is not a stretch of the lane itself', () => {
  assert.ok(INSIDE_IDS.includes('home'));
  for (const id of INSIDE_IDS) {
    const room = INSIDES[id];
    assert.ok(spotOf(id), `${id} has a building, and so a door`);
    assert.equal(insideOf(id), room);
    assert.ok(room.w >= 500 && room.h > room.wall + 500 && room.view >= 500 && room.view <= room.w, id);
    const place = roomOf(id);
    assert.equal(room.kind, place ? 'place' : 'home', id);
    if (place) {
      assert.ok(roomBuilt(place), `${id} is built`);
      assert.equal(districtOf(id), null, `${id} is indoors, not a stretch of the lane as well`);
      assert.equal(room.posts.length, place.path.length);
    } else assert.equal(room.posts.length, 0);
  }
  for (const place of ROOMS.filter(roomBuilt)) assert.ok(!!insideOf(place.id) !== !!districtOf(place.id), `${place.id} is somewhere`);
  for (const odd of ['nowhere', 'constructor', '__proto__', '', null, undefined, 7]) assert.equal(insideOf(odd), null, String(odd));
});

test('on every floor you can stand where you come in, on the mat, and at everything there is to do; never in the furniture or the walls', () => {
  for (const id of INSIDE_IDS) {
    const room = INSIDES[id];
    assert.ok(canStandIn(room, room.start.x, room.start.y), `${id}: where you come in`);
    assert.ok(canStandIn(room, room.door.x, room.door.y), `${id}: the mat`);
    assert.ok(onMat(room, room.door) && !onMat(room, room.start), `${id}: coming in does not put you straight out again`);
    assert.ok(room.start.y < room.door.y - 2 * INDOOR.out, `${id}: you come in a few steps up from the mat`);
    for (const [x, y] of [[-5, room.h / 2], [room.w + 5, room.h / 2], [room.w / 2, room.wall - 4], [room.w / 2, room.h + 4], [NaN, 300], [300, Infinity]]) assert.equal(canStandIn(room, x, y), false, `${id}: ${x},${y}`);
    for (const block of room.blocks) {
      assert.equal(canStandIn(room, block.x + block.w / 2, block.y + block.h / 2), false, `${id}: inside the ${block.id}`);
      assert.ok(block.x >= 0 && block.x + block.w <= room.w && block.y >= room.wall && block.y + block.h < room.h, `${id}: the ${block.id} is on the floor`);
    }
    const things = new Set();
    for (const spot of room.spots) {
      assert.ok(canStandIn(room, spot.x, spot.y), `${id}: standing at the ${spot.id}`);
      assert.equal(spotIn(room, spot).id, spot.id);
      assert.ok(['rest', 'ring', 'book', 'team'].includes(spot.does));
      things.add(spot.does);
      // And you can walk there from the door, and from there to the mat.
      const way = routeIn(room, room.start, spot);
      const end = way.length ? way[way.length - 1] : room.start;
      assert.ok(Math.hypot(end.x - spot.x, end.y - spot.y) < 4, `${id}: the way to the ${spot.id} gets there`);
      let at = room.start;
      for (const point of way) { assert.ok(clearWay(at, point, standingIn(room)), `${id}: the way to the ${spot.id} goes through nothing`); at = point; }
    }
    assert.equal(things.size, room.spots.length, `${id}: one of each thing`);
    assert.equal(spotIn(room, room.start), null, `${id}: nothing to do right inside the door`);
  }
  assert.deepEqual(INSIDES.home.spots.map((spot) => spot.does).sort(), ['book', 'rest', 'ring', 'team'], 'home has a bed, a telephone, the scrapbook and the basket');
});

test('an indoor place has a post for every stop, clear of the walls, the furniture, the door and each other, and a way to every one of them', () => {
  for (const id of INSIDE_IDS.filter((key) => INSIDES[key].kind === 'place')) {
    const room = INSIDES[id];
    room.posts.forEach((post, i) => {
      assert.ok(canStandIn(room, post.x, post.y), `${id} post ${i} is open floor once whoever stood there is calm`);
      assert.ok(Math.hypot(post.x - room.start.x, post.y - room.start.y) > POST.meet + 60, `${id} post ${i}: nobody waits right inside the door`);
      for (const other of room.posts) if (other !== post) assert.ok(Math.hypot(post.x - other.x, post.y - other.y) > 2 * POST.meet + 20, `${id}: two groups are never met at once`);
      for (const block of room.blocks) assert.ok(Math.hypot(post.x - (block.x + block.w / 2), post.y - (block.y + block.h / 2)) > POST.hold, `${id} post ${i} is clear of the ${block.id}`);
      // With everyone still waiting, there is a place to stand beside each, and a way there from the door that meets nobody else.
      const beside = besidePost(room, post, room.posts);
      assert.ok(beside, `${id} post ${i}: somewhere to stand beside it`);
      const others = room.posts.filter((p) => p !== post).map((p) => ({ x: p.x, y: p.y, r: POST.meet + 14 }));
      const way = routeIn(room, room.start, post, [post, ...others]);
      const end = way.length ? way[way.length - 1] : room.start;
      assert.ok(Math.hypot(end.x - post.x, end.y - post.y) <= POST.meet, `${id} post ${i}: the way ends near enough to meet them (${Math.round(Math.hypot(end.x - post.x, end.y - post.y))})`);
      for (const point of way) for (const other of room.posts) if (other !== post) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) > POST.meet, `${id} post ${i}: and brushes past nobody else`);
    });
  }
});

test('you go into home from its door and step out by the mat, and are at its door either way', () => {
  const game = fresh();
  assert.equal(game.indoors(), null);
  assert.equal(game.mayEnter('home'), true);
  assert.equal(game.mayEnter('garden'), 'away', 'the garden is not a building you walk into');
  assert.equal(game.enter('garden'), false);
  game.standBy('ines');
  assert.equal(game.mayEnter('home'), 'away');
  assert.equal(game.enter('home'), false, 'not from across the green');
  game.standAt('home');
  assert.equal(game.enter('home'), true);
  assert.equal(game.indoors(), 'home');
  assert.deepEqual(game.standing(), INSIDES.home.start);
  assert.equal(game.near(), 'home', 'in the world you are still at its door');
  assert.equal(game.personNear(), null, 'and nobody outside can be talked to from in here');
  assert.equal(game.enter('home'), false, 'you are already in');
  assert.equal(game.state.visit, null, 'going home begins no visit');
  // Walk to the bed, by the way the game finds.
  const bed = INSIDES.home.spots.find((spot) => spot.does === 'rest');
  let way = game.routeTo(bed);
  for (let steps = 0; steps < 2000 && way.length; steps++) { if (!game.walk(way[0], 0.05) || Math.hypot(way[0].x - game.standing().x, way[0].y - game.standing().y) < 3) way.shift(); }
  assert.equal(game.spotNear().id, 'bed');
  assert.equal(game.indoors(), 'home');
  // And out: walking onto the mat is stepping out.
  way = game.routeTo(INSIDES.home.door);
  for (let steps = 0; steps < 4000 && way.length && game.indoors(); steps++) { if (!game.walk(way[0], 0.05) || Math.hypot(way[0].x - game.standing().x, way[0].y - game.standing().y) < 3) way.shift(); }
  assert.equal(game.indoors(), null, 'the mat put you out');
  assert.equal(game.near(), 'home');
  assert.deepEqual(game.standing(), spotOf('home').door);
  assert.equal(game.spotNear(), null);
  assert.equal(game.leave(), false, 'there is no leaving the lane');
});

test('resting in your own bed ends a visit, as resting at the door does', () => {
  const game = fresh();
  assert.equal(game.travelTo('garden'), true);
  assert.equal(game.mayEnter('home'), 'away');
  game.standAt('home');
  assert.equal(game.enter('home'), true, 'you may come home in the middle of a visit');
  assert.ok(game.state.visit);
  assert.equal(game.rest(), true);
  assert.equal(game.state.visit, null);
  assert.equal(game.indoors(), 'home', 'and you are still indoors');
});

test('a place you walk into is shut until the one before is calm; going in, rested, begins a visit; and it is one visit at a time', () => {
  const game = fresh();
  game.standAt('pantry');
  assert.equal(game.mayEnter('pantry'), 'shut');
  assert.equal(game.enter('pantry'), false);
  assert.equal(game.travelTo('pantry'), false);
  game.standAt('wash');
  assert.equal(game.mayEnter('wash'), 'away', 'a place that is not built has no inside at all');
  openPantry(game);
  // Out calling on the garden, the pantry will not have you.
  assert.equal(game.travelTo('garden'), true);
  game.standAt('pantry');
  assert.equal(game.mayEnter('pantry'), 'elsewhere');
  assert.equal(game.enter('pantry'), false);
  game.goHome();
  game.standAt('pantry');
  assert.equal(game.mayEnter('pantry'), true);
  assert.equal(game.enter('pantry'), true);
  const visit = game.state.visit;
  assert.ok(visit && visit.room === 'pantry' && visit.stop === 0 && visit.groups.length === 5);
  assert.equal(game.state.rooms.pantry.visits, 1);
  assert.equal(game.place(), 'path');
  assert.equal(game.district(), null, 'it is not a stretch of the lane');
  assert.equal(game.heldIndoors().length, 5, 'all five groups hold their ground');
  assert.equal(game.held().some((point) => !point.r && Math.hypot(point.x - INSIDES.pantry.posts[0].x, point.y - INSIDES.pantry.posts[0].y) < 1), false, 'on its own floor, not out in the lane');
  // Step out and back in: the same visit, nobody rolled again.
  assert.equal(game.leave(), true);
  assert.equal(game.meeting(), -1, 'nobody is met from outside');
  assert.equal(game.approach(0), false);
  assert.equal(game.enter('pantry'), true);
  assert.equal(game.state.visit, visit);
  assert.equal(game.state.rooms.pantry.visits, 1);
});

test('indoors, you meet a group by walking up to it; win and you are where you stood; lose and you are carried home, outdoors', () => {
  const game = fresh(11);
  openPantry(game);
  for (const friend of game.state.friends) friend.level = 12;
  assert.equal(game.travelTo('pantry'), true);
  assert.equal(game.indoors(), 'pantry');
  assert.equal(game.meeting(), -1, 'nobody is met just inside the door');
  assert.equal(game.approach(4), false, 'the ringleader will not be met while the others are restless');
  assert.equal(game.approach(2), true);
  assert.equal(game.meeting(), 2);
  const stood = { ...game.standing() };
  const battle = game.startEncounter(2);
  assert.ok(battle);
  assert.equal(game.walk({ x: 300, y: 900 }, 0.1), false, 'no walking off in a fight');
  playOut(battle, {});
  const won = game.finishBattle();
  assert.equal(won.won, true);
  assert.equal(game.indoors(), 'pantry');
  assert.deepEqual(game.standing(), stood, 'you are standing where you stood');
  assert.equal(game.heldIndoors().length, 4, 'and that group no longer holds its ground');
  assert.equal(game.meeting(), -1);
  // Walking toward a group gives everyone else a wide berth.
  const post = INSIDES.pantry.posts[3];
  const way = game.routeTo(post);
  assert.ok(way.length > 0);
  for (const point of way) for (const other of game.heldIndoors()) if (other !== post) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) > POST.meet, 'the way brushes past nobody else');
  // A loss: carried home, and that is outdoors, at the door.
  for (const friend of game.state.friends) friend.level = 1;
  game.state.visit.hp = Object.fromEntries(game.team().map((friend) => [friend.id, 1]));
  assert.equal(game.approach(0), true);
  const lost = game.startEncounter(0);
  playOut(lost, { careless: true });
  const result = game.finishBattle();
  assert.equal(result.won, false);
  assert.equal(game.indoors(), null);
  assert.equal(game.near(), 'home');
  assert.equal(game.state.visit, null);
});

test('calm a place you walked into and you are still standing in it, with nobody left; step out and in again and it is restless once more', () => {
  const game = fresh(5);
  openPantry(game);
  for (const friend of game.state.friends) friend.level = 14;
  for (let tries = 0; tries < 6 && game.state.rooms.pantry.clears === 0; tries++) {
    if (game.place() === 'path') game.goHome();
    assert.equal(game.travelTo('pantry'), true);
    while (game.place() === 'path') { playOut(game.startEncounter(), {}); game.finishBattle(); }
  }
  assert.equal(game.state.rooms.pantry.clears, 1);
  assert.equal(game.indoors(), 'pantry');
  assert.equal(game.state.visit, null);
  assert.deepEqual(game.heldIndoors(), []);
  assert.equal(game.leave(), true);
  assert.equal(game.enter('pantry'), true);
  assert.ok(game.state.visit && game.state.visit.room === 'pantry' && game.state.visit.stop === 0);
});

test('a save keeps you indoors only where you could really be standing', () => {
  const game = fresh();
  game.standAt('home');
  game.enter('home');
  game.state.indoors.x = 144; game.state.indoors.y = 436;
  const back = (edit) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };
  assert.deepEqual(back(() => {}).indoors, { id: 'home', x: 144, y: 436 });
  assert.equal(newState(NOW, 1).indoors, null);
  // In the furniture, off the floor, or not a number: you are where you would have come in.
  for (const at of [{ x: 100, y: 300 }, { x: -50, y: 500 }, { x: NaN, y: 500 }, { x: '144', y: 436 }, { x: 1e308, y: 1e308 }]) assert.deepEqual(back((raw) => { Object.assign(raw.indoors, at); }).indoors, { id: 'home', ...INSIDES.home.start });
  // Somewhere that is not an inside, or with the world saying you are not at its door: you are outdoors.
  for (const id of ['garden', 'nowhere', 'constructor', '__proto__', 7, null]) assert.equal(back((raw) => { raw.indoors.id = id; }).indoors, null, String(id));
  assert.equal(back((raw) => { raw.where = { x: 400, y: 1540 }; }).indoors, null, 'the save says indoors at home, and standing down the street');
  for (const junk of ['home', 7, [], true]) assert.equal(back((raw) => { raw.indoors = junk; }).indoors, null);
  // A place that is still shut is not somewhere to be standing; nor one you are not calling on while out calling on another.
  assert.equal(back((raw) => { raw.indoors = { id: 'pantry', x: 380, y: 1500 }; raw.where = { ...spotOf('pantry').door }; }).indoors, null, 'shut');
  openPantry(game);
  const open = back((raw) => { raw.indoors = { id: 'pantry', x: 380, y: 1500 }; raw.where = { ...spotOf('pantry').door }; });
  assert.deepEqual(open.indoors, { id: 'pantry', x: 380, y: 1500 });
  game.leave();
  game.travelTo('garden');
  assert.equal(back((raw) => { raw.indoors = { id: 'pantry', x: 380, y: 1500 }; raw.where = { ...spotOf('pantry').door }; }).indoors, null, 'out calling on the garden');
  // settleIn on its own.
  assert.deepEqual(settleIn(INSIDES.home, null), INSIDES.home.start);
  assert.deepEqual(settleIn(INSIDES.home, { x: 300, y: 600 }), { x: 300, y: 600 });
});
