// Chapter two: the far bank. A river across the foot of the world, one bridge
// over it with a gate that the lane's eight keys open, and four more places
// beyond. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { ROOMS, SPECIES, STRAYS, GROWN_ODDS, roomOf } from '../../web/js/core/balance.js';
import { WORLD, RIVER, BRIDGE, WATER, WILDS, SPOTS, canStand, standing, roomy, routeTo, spotOf, overTheWater, onBridge, whereabouts, regionAt } from '../../web/js/core/world.js';
import { roomOpen, bridgeOpen, heldBy } from '../../web/js/core/rooms.js';
import { rollStrays } from '../../web/js/core/strays.js';
import { CALL, CALL2, LANE, FAR, KEYS, keysOf, laneQuiet, chapterOf, callDue, goalOf, aimOf, storySoFar } from '../../web/js/core/story.js';
import { INSIDES } from '../../web/js/core/indoors.js';
import { keySrc, KEY_ART } from '../../web/js/ui/keys.js';
import { ART } from '../../tools/art-manifest.mjs';

const NOW = 1_800_000_000_000;
const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
/** The whole lane calm, and Ines Tock told of all of it. */
function quietLane(game) {
  game.takeCall();
  for (const room of LANE) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 0b11111; }
  game.standBy('ines'); game.talkTo('ines'); game.talkTo('ines');
  return game;
}

test('there are two chapters: eight places on the lane, then four over the water, each after the last', () => {
  assert.deepEqual(LANE.map((room) => room.id), ['garden', 'alley', 'pantry', 'wash', 'stacks', 'rooftops', 'attic', 'dark']);
  assert.deepEqual(FAR.map((room) => room.id), ['glasshouse', 'deepend', 'shed', 'mending']);
  assert.deepEqual([...LANE, ...FAR], ROOMS);
  for (const room of FAR) {
    assert.ok(overTheWater(spotOf(room.id).door), `${room.id} is over the water`);
    assert.ok(INSIDES[room.id] && INSIDES[room.id].kind === 'place' && INSIDES[room.id].posts.length === room.path.length, `${room.id} is a room you walk into, with a post for every stop`);
    assert.ok(existsSync(`${WEB}assets/bg/${room.bg}.webp`), `${room.id} has something for a fight to be seen against`);
    assert.ok(GROWN_ODDS[room.id] >= GROWN_ODDS.dark, `${room.id}: at least as many there have grown up as in the last place of the lane`);
    // Every kind that lives there lives nowhere on the lane: the far bank's twenty are its own.
    for (const stop of room.path) for (const [kind] of stop.pool) assert.ok(!LANE.some((lane) => lane.path.some((s) => s.pool.some(([id]) => id === kind))), `${kind} is the far bank's own`);
  }
  assert.equal(new Set(FAR.flatMap((room) => room.path.flatMap((stop) => stop.pool.map(([id]) => id)))).size, 20);
  for (const room of LANE) assert.equal(overTheWater(spotOf(room.id).door), false);
  // Each begins about where the one before left off, and its ringleader is the strongest thing yet.
  for (let i = 1; i < ROOMS.length; i++) assert.ok(ROOMS[i].path[4].bossLevel > ROOMS[i - 1].path[4].bossLevel, ROOMS[i].id);
});

test('nobody walks on water: the river runs from one side of the world to the other, and the bridge is the one way over', () => {
  assert.ok(RIVER.y > spotOf('dark').door.y + 60 && RIVER.y + RIVER.h < WORLD.h - 1500);
  const mid = RIVER.y + RIVER.h / 2;
  for (let x = WORLD.edge + 2; x < WORLD.w - WORLD.edge; x += 6) {
    const dry = canStand(x, mid);
    const over = x > BRIDGE.x + WORLD.body && x < BRIDGE.x + BRIDGE.w - WORLD.body;
    if (Math.abs(x - BRIDGE.x - WORLD.body) > 3 && Math.abs(x - BRIDGE.x - BRIDGE.w + WORLD.body) > 3) assert.equal(dry, over, `at ${x}`);
  }
  assert.equal(WATER.length, 2);
  assert.ok(BRIDGE.w - 2 * WORLD.body >= 120, 'the bridge is wide enough to walk three abreast');
  assert.equal(onBridge({ x: BRIDGE.x + BRIDGE.w / 2, y: mid }), true);
  assert.equal(onBridge({ x: BRIDGE.x - 30, y: mid }), false);
  assert.equal(onBridge(null), false);
  assert.equal(whereabouts({ x: BRIDGE.x + BRIDGE.w / 2, y: mid }), 'Kettle Bridge');
  assert.equal(whereabouts({ x: 400, y: RIVER.y - 80 }), 'Chimney Hill');
  assert.equal(whereabouts({ x: 400, y: RIVER.y + RIVER.h + 80 }), 'Far Bank');
  assert.equal(whereabouts(spotOf('mending').door), 'Bobbin Row');
  assert.equal(overTheWater(null), false);
  assert.equal(regionAt({ x: 1180, y: RIVER.y + RIVER.h + 10 }).id, 'bank');
});

test('the gate on the bridge is shut until all eight places on the lane are calm, and then it is open for good', () => {
  const game = fresh();
  const north = spotOf('dark').door;
  const south = spotOf('glasshouse').door;
  const crosses = () => {
    const can = roomy(standing(game.held()));
    const way = routeTo(north, south, can);
    const end = way.length ? way[way.length - 1] : north;
    return Math.hypot(end.x - south.x, end.y - south.y) < 40;
  };
  assert.equal(bridgeOpen(game.state), false);
  assert.equal(game.bridgeOpen(), false);
  assert.ok(heldBy(game.state).some((spot) => spot.x === BRIDGE.gate.x && spot.y === BRIDGE.gate.y && spot.r >= BRIDGE.w / 2), 'the gate holds the whole width of the bridge');
  assert.equal(crosses(), false, 'there is no way over');
  // Seven calm is not eight.
  for (const room of LANE.slice(0, 7)) game.state.rooms[room.id].clears = 1;
  assert.equal(bridgeOpen(game.state), false);
  assert.equal(crosses(), false);
  assert.equal(roomOpen(game.state, 'glasshouse'), false);
  game.state.rooms.dark.clears = 1;
  assert.equal(bridgeOpen(game.state), true);
  assert.equal(heldBy(game.state).some((spot) => spot.x === BRIDGE.gate.x && spot.y === BRIDGE.gate.y), false);
  assert.equal(crosses(), true, 'now you can walk from the far shed to the Glasshouse');
  assert.equal(roomOpen(game.state, 'glasshouse'), true);
  assert.equal(roomOpen(game.state, 'deepend'), false, 'and the places beyond open one after another, as on the lane');
  // Every door over there can be walked to, and back from.
  const can = roomy(standing(game.held()));
  for (const room of FAR) {
    const door = spotOf(room.id).door;
    const way = routeTo(spotOf('home').door, door, can);
    assert.ok(way.length && Math.hypot(way[way.length - 1].x - door.x, way[way.length - 1].y - door.y) < 40, `a way from home to ${room.id}`);
    assert.ok(way.filter((point) => point.y > RIVER.y && point.y < RIVER.y + RIVER.h).every((point) => point.x > BRIDGE.x && point.x < BRIDGE.x + BRIDGE.w), 'and it goes over the bridge');
  }
});

test('strays keep to this side of the river until the bridge is open; after that there are more of them, on both banks', () => {
  assert.ok(WILDS.filter(overTheWater).length >= 8, 'there are quiet spots over the water');
  assert.ok(WILDS.findIndex(overTheWater) === WILDS.length - WILDS.filter(overTheWater).length, 'and they come last in the list, so the lane\'s own are numbered as they always were');
  const game = fresh(5);
  for (let i = 0; i < 80; i++) {
    const strays = rollStrays(game.state);
    assert.ok(strays.length >= STRAYS.groups[0] && strays.length <= STRAYS.groups[1]);
    assert.ok(strays.every((stray) => !overTheWater(WILDS[stray.at])), 'nobody strays where you cannot go');
  }
  for (const room of LANE) game.state.rooms[room.id].clears = 1;
  let far = 0; let near = 0;
  for (let i = 0; i < 80; i++) {
    const strays = rollStrays(game.state);
    assert.ok(strays.length >= STRAYS.farGroups[0] && strays.length <= STRAYS.farGroups[1]);
    for (const stray of strays) { if (overTheWater(WILDS[stray.at])) far++; else near++; }
  }
  assert.ok(far > 80 && near > 80, `${far} over the water and ${near} this side, in eighty outings`);
  assert.ok(STRAYS.farGroups[0] > STRAYS.groups[0] && STRAYS.farGroups[1] <= WILDS.length);
});

test('a save cannot put you, or a stray, over the water while the gate is shut; nor take the second call early', () => {
  const game = fresh(3);
  game.takeCall();
  const raw = JSON.parse(game.serialize(NOW));
  const over = spotOf('glasshouse').door;
  const farSpot = WILDS.findIndex(overTheWater);
  const hostile = { ...raw, where: { x: over.x, y: over.y }, story: { ...raw.story, call2: true }, strays: [{ at: farSpot, foes: raw.strays[0].foes, done: false }] };
  const back = reviveState(JSON.parse(JSON.stringify(hostile)), NOW);
  assert.deepEqual(back.where, spotOf('home').door, 'you wake at home');
  assert.equal(back.story.call2, false);
  assert.ok(back.strays.every((stray) => !overTheWater(WILDS[stray.at])));
  assert.equal(chapterOf(back), 1);
  // With the lane calm, the same save is taken at its word.
  for (const room of LANE) hostile.rooms[room.id].clears = 1;
  const fine = reviveState(JSON.parse(JSON.stringify(hostile)), NOW);
  assert.deepEqual(fine.where, { x: over.x, y: over.y });
  assert.equal(fine.story.call2, true);
  assert.equal(chapterOf(fine), 2);
});

test('when the lane is quiet and Ines Tock knows, great-aunt Maribel rings again: that call opens the second chapter', () => {
  const game = fresh();
  assert.equal(callDue(game.state), true, 'the first call is due as soon as the game begins');
  assert.equal(game.takeCall(), CALL);
  assert.equal(game.callDue(), false);
  assert.equal(game.takeCall(), null);
  // The lane calm, but she has not been told: no call yet.
  for (const room of LANE) game.state.rooms[room.id].clears = 1;
  assert.equal(laneQuiet(game.state), true);
  assert.equal(game.callDue(), false);
  assert.equal(game.goal().id, 'meet');
  game.standBy('ines');
  const told = game.talkTo('ines');
  assert.ok(told.length >= 4);
  assert.equal(game.callDue(), true);
  assert.deepEqual([game.goal().id, game.goal().title], ['call', 'Answer the telephone']);
  assert.match(game.talkTo('ines')[0].text, /^All eight calm.*telephone/, 'asked again, she has heard it ringing');
  assert.deepEqual(aimOf(game.state), { title: 'Calm all eight places before Monday', count: [8, 8] });
  assert.equal(chapterOf(game.state), 1);

  const call = game.takeCall();
  assert.equal(call, CALL2);
  assert.ok(call.length === 4 && call.every((line) => line.who === 'maribel' && line.text.length > 40 && line.text.length < 260));
  const said = call.map((line) => line.text).join(' ');
  for (const word of ['far bank', 'Kettle Bridge', 'Glasshouse', 'bath house', 'Tinker\'s Shed', 'Mending Room', 'eight locks', 'eight keys']) assert.ok(said.includes(word), `she says "${word}"`);
  assert.equal(game.state.story.call2, true);
  assert.equal(game.callDue(), false);
  assert.equal(game.takeCall(), null);
  assert.equal(chapterOf(game.state), 2);
  assert.deepEqual(aimOf(game.state), { title: 'Calm the four places over the water', count: [0, 4] });
  const goal = game.goal();
  assert.deepEqual([goal.id, goal.room, goal.title, goal.count], ['calm', 'glasshouse', 'Calm the Glasshouse', [0, 5]]);
  assert.match(goal.detail, /Kettle Bridge.*eight keys/);
  assert.match(game.talkTo('ines')[0].text, /^The Glasshouse first/);
  assert.ok(storySoFar(game.state).some((line) => /rang again/.test(line)));
  // It is saved, and comes back.
  const back = reviveState(JSON.parse(game.serialize(NOW)), NOW);
  assert.equal(back.story.call2, true);
  assert.equal(goalOf(back).room, 'glasshouse');
});

test('Ines Tock hears about each of the four in turn, counts them, and sends you on; and has a last word when both banks are quiet', () => {
  const game = quietLane(fresh());
  game.takeCall();
  FAR.forEach((room, i) => {
    const goal = game.goal();
    assert.deepEqual([goal.id, goal.room], ['calm', room.id]);
    assert.ok(goal.title.length <= 34 && goal.detail.length > 60 && goal.detail.length < 260, `${room.id}: the goal says where it is and what to take`);
    game.state.rooms[room.id].clears = 1;
    assert.deepEqual([game.goal().id, game.goal().who], ['report', 'ines']);
    assert.equal(game.hasNews('ines'), true);
    const lines = game.talkTo('ines');
    assert.equal(lines.length, 3, room.id);
    assert.ok(lines.every((line) => line.who === 'ines' && line.text.length > 30 && line.text.length < 260), room.id);
    assert.equal(/is calm\. Good\./.test(lines[0].text), false, `${room.id}: her own word on it`);
    assert.deepEqual(aimOf(game.state).count, [i + 1, 4]);
    const next = FAR[i + 1];
    if (next) {
      assert.match(lines[1].text, new RegExp(`^${['One', 'Two', 'Three'][i]} of the four over the water\\. `));
      assert.ok(lines[1].text.includes(`${next.name} is next`) || lines[1].text.includes(`Only ${next.name.replace(/^The /, 'the ')} is left`), `${room.id}: she names ${next.name}`);
      assert.match(game.talkTo('ines')[0].text, new RegExp(`^${next.name} first`));
    } else {
      assert.match(lines[1].text, /^Both banks, quiet/);
      assert.match(game.talkTo('ines')[0].text, /^Both banks calm/);
    }
  });
  const goal = game.goal();
  assert.deepEqual([goal.id, goal.room, goal.title, goal.count], ['more', null, 'Both banks are quiet', [12, 12]]);
  assert.match(goal.detail, /beyond Bobbin Row.*on its way/, 'it says there is more to come');
  const told = storySoFar(game.state);
  assert.ok(told.indexOf('The Roaring Dark is calm.') < told.findIndex((line) => /rang again/.test(line)) && told.findIndex((line) => /rang again/.test(line)) < told.indexOf('The Glasshouse is calm.'), 'the journal tells it in the order it happened');
});

test('each of the four hands over a key; the far bank\'s hooks are on the ring from the second call', () => {
  const game = quietLane(fresh());
  const names = new Set();
  for (const room of FAR) {
    const key = KEYS[room.id];
    const boss = SPECIES[room.path[4].boss].name;
    assert.ok(key && /Key$/.test(key.name) && key.line.length > 40 && key.line.length < 130, room.id);
    assert.ok(key.line.includes(boss), `${room.id}: its line says ${boss} handed it over`);
    names.add(key.name);
    assert.ok(KEY_ART.includes(keySrc(room.id)) && existsSync(`${WEB}${keySrc(room.id)}`), `${room.id}: its key is painted`);
  }
  assert.equal(names.size, 4);
  assert.equal(KEY_ART.length, 12);
  const keys = keysOf(game.state);
  assert.deepEqual(keys.map((key) => key.chapter), [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(keys.filter((key) => key.held).map((key) => key.room), LANE.map((room) => room.id));
  game.state.rooms.glasshouse.clears = 1;
  assert.equal(keysOf(game.state).find((key) => key.room === 'glasshouse').held, true);
  // The manifest says how they were made: a sheet of four, cut in the order of the places.
  assert.ok(ART.some((art) => art.id === 'world_keys2' && /exactly four separate ornate old-fashioned door keys/.test(art.prompt)));
  assert.ok(ART.some((art) => art.id === 'world_far_sheet'));
});

test('each of the four places can be played from its door to its ringleader by a team that has grown into it', () => {
  for (const room of FAR) {
    const game = quietLane(fresh(21));
    game.takeCall();
    for (const before of FAR.slice(0, FAR.indexOf(room))) game.state.rooms[before.id].clears = 1;
    const need = room.path[4].bossLevel + 5;
    for (const friend of game.state.friends) { friend.level = need; friend.grown = true; }
    game.goHome();
    let summary = null;
    for (let tries = 0; tries < 10 && game.state.rooms[room.id].clears === 0; tries++) {
      if (game.place() === 'path') game.goHome();
      assert.equal(game.travelTo(room.id), true, `into ${room.id}`);
      assert.equal(game.indoors(), room.id);
      while (game.place() === 'path' && game.nextGroup() >= 0) {
        const battle = game.startEncounter();
        if (game.nextGroup() === 4 || battle.units.some((unit) => unit.boss)) assert.ok(battle.units.some((unit) => unit.species === room.path[4].boss), `${room.id}: its ringleader is the last to be met`);
        playOut(battle, { befriend: true, have: game.state.friends.map((f) => f.species) });
        summary = game.finishBattle();
      }
    }
    assert.ok(game.state.rooms[room.id].clears > 0, `${room.id} can be calmed`);
    assert.equal(summary.cleared, true);
    assert.equal(game.state.book[room.path[4].boss].met, true);
    assert.equal(roomOf(room.id).chapter, 2);
  }
});
