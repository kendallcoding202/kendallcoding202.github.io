// The story: the people of the lane, what they say and when, the goal it gives
// you, and that none of it can be broken by a save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAST, CAST_IDS, NEIGHBOURS, CALL, newStory, reviveStory, goalOf, aimOf, storySoFar, hasNews, talk, takeCall, placesCalm, nextPlace } from '../../web/js/core/story.js';
import { PEOPLE, TALK, WORLD, SPOTS, TREES, LAMPS, ROAD_POINTS, GREEN, canStand, standing, personNear, personAt, routeTo, straighten, roomy, stepWalk, spotNear, districtAt, DISTRICTS } from '../../web/js/core/world.js';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { LOOK_IDS, ROOMS } from '../../web/js/core/balance.js';

const NOW = 1_800_000_000_000;
const SPRITES = fileURLToPath(new URL('../../web/assets/sprites/', import.meta.url));
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
/** Plays the garden through with a sensible stand-in until it is calm. */
function calmGarden(game) {
  for (let tries = 0; tries < 12 && game.state.rooms.garden.clears === 0; tries++) {
    if (game.place() === 'lane') game.travelTo('garden');
    while (game.place() === 'path') { playOut(game.startEncounter(), { befriend: true, have: game.state.friends.map((f) => f.species) }); game.finishBattle(); }
  }
  assert.ok(game.state.rooms.garden.clears > 0, 'the stand-in calmed the garden');
}
/** Then the alley the same way, coming home to rest between tries. */
function calmAlley(game) {
  for (let tries = 0; tries < 12 && game.state.rooms.alley.clears === 0; tries++) {
    if (game.place() === 'path') game.goHome();
    game.travelTo('alley');
    while (game.place() === 'path') { playOut(game.startEncounter(), { befriend: true, have: game.state.friends.map((f) => f.species) }); game.finishBattle(); }
  }
  assert.ok(game.state.rooms.alley.clears > 0, 'the stand-in calmed the alley');
}

// ---------------------------------------------------------------- who is who

test('the cast is four people, each with a name, a part to play and a painting', () => {
  assert.deepEqual(CAST_IDS, ['maribel', 'ines', 'dov', 'spick']);
  for (const id of CAST_IDS) {
    assert.ok(CAST[id].name && CAST[id].role, id);
    assert.ok(existsSync(`${SPRITES}${CAST[id].art}.webp`), `${id} has a painting`);
  }
  assert.equal(new Set(CAST_IDS.map((id) => CAST[id].name)).size, 4);
});

test('the house-sitter can be seen from the side, the front and behind, in every look', () => {
  for (const look of LOOK_IDS) for (const view of ['', '_front', '_back']) assert.ok(existsSync(`${SPRITES}${look}${view}.webp`), `${look}${view}`);
});

test('three neighbours stand in the lane; great-aunt Maribel is away and rings', () => {
  assert.deepEqual(PEOPLE.map((person) => person.id).sort(), [...NEIGHBOURS].sort());
  assert.equal(personAt('maribel'), null);
  assert.ok(CALL.length >= 3 && CALL.every((line) => line.who === 'maribel' && line.text.length > 20));
});

// ---------------------------------------------------------------- where they stand

test('each neighbour stands on open ground, solid, clear of streets, doors, trees and lamps', () => {
  for (const person of PEOPLE) {
    assert.equal(canStand(person.x, person.y), false, `${person.id} is solid`);
    assert.equal(canStand(person.x, person.y + person.r + WORLD.body + 1), true, `${person.id}: you can stand in front of them`);
    assert.equal(districtAt(person), null, `${person.id} is out in the lane, not inside a place`);
    for (const road of ROAD_POINTS) for (const p of road) assert.ok(Math.hypot(p.x - person.x, p.y - person.y) > person.r + WORLD.body + 10, `${person.id} stands in a street`);
    for (const spot of SPOTS) assert.ok(Math.hypot(spot.door.x - person.x, spot.door.y - person.y) > TALK + WORLD.reach, `${person.id} is too near the door of ${spot.id} to tell which you mean`);
    for (const thing of [...TREES, ...LAMPS]) assert.ok(Math.hypot(thing.x - person.x, thing.y - person.y) > 60, `something stands on ${person.id}`);
    for (const other of PEOPLE) if (other !== person) assert.ok(Math.hypot(other.x - person.x, other.y - person.y) > 2 * TALK + 20);
    assert.equal(person.x > GREEN.x + 50 && person.x < GREEN.x + GREEN.w - 50 && person.y > GREEN.y + 30 && person.y < GREEN.y + GREEN.h - 30, false, `${person.id} is not where friends potter about`);
  }
});

test('Ines Tock can be seen from the door of home, so the first goal is in sight', () => {
  const home = SPOTS[0].door;
  const ines = personAt('ines');
  assert.ok(Math.abs(ines.x - home.x) < 300 && Math.abs(ines.y - home.y) < 300);
});

test('you are near enough to talk within a step or two, and nobody is near from far off', () => {
  for (const person of PEOPLE) {
    assert.equal(personNear({ x: person.x, y: person.y + TALK - 1 }), person.id);
    assert.equal(personNear({ x: person.x, y: person.y + TALK + 1 }), null);
  }
  for (const spot of SPOTS) assert.equal(personNear(spot.door), null, `at the door of ${spot.id} nobody is talking to you`);
});

test('every neighbour can be walked up to from home, a frame at a time, and a tap on one walks you to them', () => {
  const everyone = standing(DISTRICTS.garden.posts);
  const wide = roomy(everyone);
  for (const person of PEOPLE) {
    let pos = { ...SPOTS[0].door };
    for (const point of straighten(pos, routeTo(pos, person, wide), wide)) {
      for (let i = 0; i < 3000 && Math.hypot(point.x - pos.x, point.y - pos.y) >= WORLD.arrive; i++) {
        const next = stepWalk(pos, point, 1 / 60, everyone);
        assert.equal(next.moving, true, `stuck walking to ${person.id}`);
        pos = next;
      }
    }
    assert.equal(personNear(pos), person.id, `a tap on ${person.id} ends near enough to talk`);
    assert.equal(spotNear(pos), null);
  }
});

// ---------------------------------------------------------------- the call

test('the first call is taken once, and only once the game has begun', () => {
  const game = new Game(newState(NOW, 3), { now: NOW, fx: false });
  assert.equal(game.takeCall(), null, 'not during the intro');
  assert.equal(game.state.story.call, false);
  game.begin({ name: 'Kit' });
  assert.deepEqual(game.takeCall(), CALL);
  assert.equal(game.state.story.call, true);
  assert.equal(game.takeCall(), null);
  assert.equal(takeCall(game.state), null);
});

// ---------------------------------------------------------------- talking

test('you have to be standing by someone to talk to them, and never in a fight', () => {
  const game = fresh();
  assert.equal(game.personNear(), null);
  assert.equal(game.talkTo('ines'), null, 'not from the door of home');
  assert.equal(game.state.story.ines, 0);
  for (const who of NEIGHBOURS) {
    assert.equal(game.standBy(who), true);
    assert.equal(game.personNear(), who);
    for (const other of NEIGHBOURS) if (other !== who) assert.equal(game.talkTo(other), null);
  }
  for (const odd of ['maribel', 'nobody', 'constructor', '__proto__', null, 7]) { assert.equal(game.standBy(odd), false); assert.equal(talk(game.state, odd), null); }
  game.travelTo('garden');
  game.startEncounter();
  assert.equal(game.personNear(), null);
  assert.equal(game.standBy('ines'), false);
});

test('Ines Tock sends you to the garden, nudges you while it is restless, hears about it when it is calm, and sends you on', () => {
  const game = fresh();
  assert.equal(game.hasNews('ines'), true);
  game.standBy('ines');
  const first = game.talkTo('ines');
  assert.ok(first.length >= 4 && first.every((line) => line.who === 'ines'));
  assert.match(first[first.length - 1].text, /The Garden Gate/);
  assert.equal(game.state.story.ines, 1);
  assert.equal(game.hasNews('ines'), false);
  const nudge = game.talkTo('ines');
  assert.ok(nudge.length === 2 && /Reaching out/.test(nudge[1].text), 'with no friend made yet, she says how');
  game.state.stats.befriended = 1;
  assert.equal(game.talkTo('ines').length, 1);
  assert.equal(game.state.story.ines, 1, 'talking again does not move the story on by itself');

  calmGarden(game);
  assert.equal(game.hasNews('ines'), true, 'now she has something to hear');
  game.standBy('ines');
  const calmed = game.talkTo('ines');
  assert.match(calmed[0].text, /gone quiet/);
  assert.ok(calmed.some((line) => /Tin Can Alley is next/.test(line.text)), 'and she says where to go next, and how to get there');
  assert.ok(calmed.some((line) => /east/.test(line.text)));
  assert.equal(game.state.story.ines, 2);
  assert.equal(game.hasNews('ines'), false);
  assert.match(game.talkTo('ines')[0].text, /^Tin Can Alley first/, 'asked again, she nudges you toward it');

  calmAlley(game);
  assert.equal(game.hasNews('ines'), true);
  game.standBy('ines');
  const second = game.talkTo('ines');
  assert.match(second[0].text, /^Tin Can Alley, quiet/);
  assert.ok(second.some((line) => /The Midnight Pantry is next/.test(line.text)));
  assert.equal(game.state.story.ines, 3);
  assert.equal(game.hasNews('ines'), false);
  assert.match(game.talkTo('ines')[0].text, /^2 of 8 calm/, 'with nowhere built to send you, she counts');
});

test('whatever has gone quiet since she last heard, Ines Tock hears it all at once and speaks of the furthest', () => {
  const game = fresh();
  game.standBy('ines'); game.talkTo('ines');
  game.state.rooms.garden.clears = 1;
  game.state.rooms.alley.clears = 1;
  assert.match(goalOf(game.state).detail, /^Tin Can Alley is calm/);
  const lines = game.talkTo('ines');
  assert.match(lines[0].text, /^Tin Can Alley, quiet/);
  assert.equal(game.state.story.ines, 3);
  assert.equal(game.hasNews('ines'), false);
  // A place with no words written for it yet still gets a plain line, never a blank.
  game.state.rooms.pantry.clears = 1;
  assert.deepEqual(game.talkTo('ines').map((line) => line.text), ['The Midnight Pantry is calm. Good. That is one more off Mr. Spick\'s list.']);
  assert.equal(game.state.story.ines, 4);
});

test('if you calm the garden before ever meeting her, she takes it in her stride', () => {
  const game = fresh();
  calmGarden(game);
  assert.equal(goalOf(game.state).id, 'meet');
  game.standBy('ines');
  const lines = game.talkTo('ines');
  assert.match(lines[lines.length - 1].text, /calm already/);
  assert.equal(game.state.story.ines, 2);
  const goal = goalOf(game.state);
  assert.deepEqual([goal.id, goal.room, goal.title], ['calm', 'alley', 'Calm Tin Can Alley'], 'and the goal moves straight on to the next place');
});

test('Dov has a first thing to say and then a tip each time, round and round; Mr. Spick keeps count', () => {
  const game = fresh();
  game.standBy('dov');
  assert.equal(game.hasNews('dov'), true);
  assert.equal(game.talkTo('dov').length, 3);
  assert.equal(game.hasNews('dov'), false);
  const tips = [];
  for (let i = 0; i < 15; i++) { const said = game.talkTo('dov'); assert.equal(said.length, 1); tips.push(said[0].text); }
  assert.equal(new Set(tips).size, 7, 'seven tips');
  assert.equal(tips[7], tips[0], 'and then round again');
  assert.ok(tips.some((tip) => /Heirloom/.test(tip) && /calm/.test(tip)), 'one of them says where to look for Heirlooms');
  assert.ok(tips.some((tip) => /alley/.test(tip)), 'one or two of them about the alley');
  for (let i = 0; i < 300; i++) game.talkTo('dov');
  assert.ok(game.state.story.dov <= 99, 'however often you ask, the count stays small');

  game.standBy('spick');
  assert.equal(game.talkTo('spick').length, 3);
  assert.match(game.talkTo('spick')[0].text, /^None quiet\. 8 for the van/);
  calmGarden(game);
  game.standBy('spick');
  assert.match(game.talkTo('spick')[0].text, /^1 quiet\. 7 for the van/);
});

// ---------------------------------------------------------------- the goal

test('the goal leads from the first call to a calm garden, back to Ines Tock, on to the alley, and back again', () => {
  const game = fresh(4);
  assert.deepEqual(aimOf(game.state), { title: 'Calm all eight places before Monday', count: [0, 8] });
  let goal = game.goal();
  assert.deepEqual([goal.id, goal.who, goal.room, goal.count], ['meet', 'ines', null, null]);

  game.standBy('ines'); game.talkTo('ines');
  goal = game.goal();
  assert.deepEqual([goal.id, goal.who, goal.room], ['friend', null, 'garden']);

  // A fight won without making a friend does not move it on; a friend made does.
  game.travelTo('garden');
  playOut(game.startEncounter(), {});
  assert.equal(game.finishBattle().won, true);
  assert.equal(game.goal().id, 'friend');
  game.state.stats.befriended = 1;
  goal = game.goal();
  assert.deepEqual([goal.id, goal.room, goal.count], ['calm', 'garden', [1, 5]]);

  calmGarden(game);
  goal = game.goal();
  assert.deepEqual([goal.id, goal.who], ['report', 'ines']);
  assert.deepEqual(game.aim().count, [1, 8]);
  game.standBy('ines'); game.talkTo('ines');
  goal = game.goal();
  assert.deepEqual([goal.id, goal.who, goal.room, goal.title, goal.count], ['calm', null, 'alley', 'Calm Tin Can Alley', [0, 5]]);
  assert.match(goal.detail, /East along the street/, 'it says where the alley is');
  assert.equal(nextPlace(game.state).id, 'alley');
  assert.equal(placesCalm(game.state), 1);
  // Part of the way up the alley, the goal counts how far you have got.
  game.state.rooms.alley.best = 3;
  assert.deepEqual(game.goal().count, [3, 5]);

  calmAlley(game);
  goal = game.goal();
  assert.deepEqual([goal.id, goal.who], ['report', 'ines']);
  assert.match(goal.detail, /^Tin Can Alley is calm/);
  assert.deepEqual(game.aim().count, [2, 8]);
  game.standBy('ines'); game.talkTo('ines');
  goal = game.goal();
  assert.equal(goal.id, 'more');
  assert.match(goal.title, /The Midnight Pantry is next/);
  assert.match(goal.detail, /not built yet/);
  assert.deepEqual(goal.count, [2, 8]);
  assert.equal(nextPlace(game.state).id, 'pantry');
});

test('every goal says what to do in a line, and points somewhere when there is somewhere to point', () => {
  const game = fresh();
  const seen = [];
  const look = () => { const goal = game.goal(); seen.push(goal.id); assert.ok(goal.title.length > 5 && goal.title.length <= 34, goal.title); assert.ok(goal.detail.length > 20); assert.ok(!(goal.who && goal.room)); };
  look();
  game.standBy('ines'); game.talkTo('ines'); look();
  game.state.stats.befriended = 2; look();
  calmGarden(game); look();
  game.standBy('ines'); game.talkTo('ines'); look();
  calmAlley(game); look();
  game.standBy('ines'); game.talkTo('ines'); look();
  assert.deepEqual(seen, ['meet', 'friend', 'calm', 'report', 'calm', 'report', 'more']);
});

test('the journal tells what has happened, in order, and grows as it happens', () => {
  const game = fresh();
  assert.deepEqual(game.journal(), []);
  game.takeCall();
  assert.equal(game.journal().length, 1);
  game.standBy('ines'); game.talkTo('ines');
  game.standBy('spick'); game.talkTo('spick');
  calmGarden(game);
  const told = game.journal();
  assert.ok(told.length >= 5);
  assert.match(told[0], /Maribel rang/);
  assert.match(told[told.length - 1], /The Garden Gate is calm\./);
  assert.ok(told.some((line) => /friend/.test(line)));
});

// ---------------------------------------------------------------- the save

test('the story is saved, and comes back as it went in', () => {
  const game = fresh();
  game.takeCall();
  game.standBy('ines'); game.talkTo('ines');
  game.standBy('dov'); game.talkTo('dov'); game.talkTo('dov');
  const saved = JSON.parse(game.serialize(NOW));
  assert.deepEqual(saved.story, { call: true, ines: 1, dov: 2, spick: 0 });
  const back = reviveState(JSON.parse(JSON.stringify(saved)), NOW);
  assert.deepEqual(back.story, saved.story);
  assert.equal(goalOf(back).id, 'friend');
});

test('a save cannot break the story: whatever is stored, it is four small whole numbers', () => {
  assert.deepEqual(newStory(), { call: false, ines: 0, dov: 0, spick: 0 });
  for (const wrong of [null, undefined, 7, 'told', [], [1, 2], {}, { call: 'yes', ines: '2', dov: null, spick: {} }, { ines: NaN, dov: Infinity, spick: -Infinity }]) {
    assert.deepEqual(reviveStory(wrong), newStory(), JSON.stringify(wrong));
  }
  assert.deepEqual(reviveStory({ call: true, ines: 1e308, dov: -5, spick: 2.9, extra: 'x', constructor: 1 }), { call: true, ines: 99, dov: 0, spick: 2 });
  // A save that claims Ines has heard about a calm garden that is not calm: the goal still makes sense.
  const state = reviveState({ ...JSON.parse(JSON.stringify(newState(NOW, 3))), started: true, story: { call: true, ines: 2, dov: 50, spick: 50 } }, NOW);
  const goal = goalOf(state);
  assert.equal(goal.id, 'friend');
  for (const who of NEIGHBOURS) assert.ok(talk(state, who).length >= 1);
  // And one from before there was a story has not taken the call yet.
  const old = JSON.parse(JSON.stringify(newState(NOW, 3)));
  delete old.story;
  assert.deepEqual(reviveState({ ...old, started: true }, NOW).story, newStory());
});

test('whatever the story says, in every state, it says it without breaking', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const game = fresh(seed);
    for (let step = 0; step < 40; step++) {
      const who = NEIGHBOURS[(seed + step) % 3];
      game.standBy(who);
      const lines = game.talkTo(who);
      assert.ok(Array.isArray(lines) && lines.length >= 1 && lines.every((line) => CAST[line.who] && typeof line.text === 'string' && line.text.length > 8 && !/undefined|NaN|\[object/.test(line.text)));
      assert.ok(game.goal().title);
      if (step === 10) calmGarden(game);
      if (step === 20) for (const room of ROOMS) game.state.rooms[room.id].clears = 3;
    }
    assert.equal(game.goal().title, 'The lane is quiet');
    assert.deepEqual(game.aim().count, [8, 8]);
  }
});
