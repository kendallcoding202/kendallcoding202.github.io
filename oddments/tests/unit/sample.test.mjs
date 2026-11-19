// The free sample. The copy of the game on the web holds the first two places
// and stops there; the app is the whole game, and can never be the sample.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playable } from '../../web/js/core/trial.js';
import { ROOMS, ROOM_IDS, SAMPLE, roomBuilt } from '../../web/js/core/balance.js';
import { roomOpen, bridgeOpen } from '../../web/js/core/rooms.js';
import { goalOf } from '../../web/js/core/story.js';
import { rivalDue } from '../../web/js/core/rival.js';
import { setSample, sampleOn, inSample, sampleDone, samplePlaces, sampleWords } from '../../web/js/core/sample.js';
import { sampleFor } from '../../web/js/platform/sample.js';

const NOW = 1_800_000_000_000;
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
const calmTo = (game, roomId) => { for (const id of ROOM_IDS.slice(0, ROOM_IDS.indexOf(roomId) + 1)) { game.state.rooms[id].clears = 1; game.state.rooms[id].calmed = 0b11111; } return game; };
/** Runs something as the sample, and puts the whole game back whatever happens. */
const asSample = (fn) => { setSample(true); try { return fn(); } finally { setSample(false); } };
const [GARDEN, ALLEY, PANTRY] = ROOM_IDS;

test('the app is never the sample: a numbered build, the app\'s shell, or the app\'s kind of address each rule it out', () => {
  const web = { build: 'dev', native: false, protocol: 'https:', hostname: 'example.github.io', asked: false };
  assert.equal(sampleFor(web), true, 'the published copy on the web is the sample');
  assert.equal(sampleFor({ ...web, protocol: 'http:' }), true);
  // A numbered build is what goes into the app.
  for (const build of ['43', '1', 'release', '', undefined, null, 0]) assert.equal(sampleFor({ ...web, build }), false, `build ${String(build)}`);
  // So is a page the app's shell is carrying.
  assert.equal(sampleFor({ ...web, native: true }), false);
  // And a page at the app's own kind of address, whatever else is said of it.
  for (const protocol of ['capacitor:', 'ionic:', 'file:', 'app:', '', undefined]) assert.equal(sampleFor({ ...web, protocol }), false, `protocol ${String(protocol)}`);
  assert.equal(sampleFor({ build: '43', native: true, protocol: 'capacitor:', hostname: 'localhost', asked: true }), false, 'the app as it really is, even asked');
  assert.equal(sampleFor({ ...web, build: '43', asked: true }), false, 'asking does not make a numbered build the sample');
  assert.equal(sampleFor({ ...web, native: true, asked: true }), false, 'nor the app\'s shell');
});

test('a copy on your own machine is the whole game unless it asks to be the sample', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '']) {
    assert.equal(sampleFor({ build: 'dev', native: false, protocol: 'http:', hostname, asked: false }), false, hostname);
    assert.equal(sampleFor({ build: 'dev', native: false, protocol: 'http:', hostname, asked: true }), true, `${hostname}, asked`);
  }
  assert.equal(sampleFor({ build: 'dev', native: false, protocol: 'http:', hostname: undefined, asked: false }), false);
});

test('the whole game is what you get unless told otherwise, and only `true` tells it', () => {
  assert.equal(sampleOn(), false);
  for (const value of [1, 'true', 'yes', {}, [], null, undefined]) { setSample(value); assert.equal(sampleOn(), false, String(value)); }
  for (const id of ROOM_IDS) assert.equal(inSample(id), true);
  assert.equal(sampleDone(calmTo(fresh(), ROOM_IDS[ROOM_IDS.length - 1]).state), false, 'the whole game is never a sample played out');
  assert.equal(SAMPLE.places, 2);
  assert.deepEqual(samplePlaces().map((room) => room.name), ['The Garden Gate', 'Tin Can Alley']);
});

test('in the sample the first two places open as they always did, and the third never does', () => {
  asSample(() => {
    const game = fresh();
    assert.equal(game.sample(), true);
    assert.equal(roomOpen(game.state, GARDEN), true);
    assert.equal(roomOpen(game.state, ALLEY), false, 'the alley waits for the garden, as in the whole game');
    calmTo(game, GARDEN);
    assert.equal(roomOpen(game.state, ALLEY), true);
    calmTo(game, ALLEY);
    assert.equal(roomOpen(game.state, PANTRY), false, 'the third place stays shut though the second is calm');
    assert.equal(game.inSample(PANTRY), false);
    assert.equal(game.travelTo(PANTRY), false, 'and cannot be gone into');
    // Not if every place in the save says it is calm, either.
    calmTo(game, ROOM_IDS[ROOM_IDS.length - 1]);
    for (const room of ROOMS.filter(roomBuilt)) assert.equal(roomOpen(game.state, room.id), samplePlaces().includes(room), room.id);
    assert.equal(bridgeOpen(game.state), false, 'nor is there a way over the water');
    assert.equal(inSample('nowhere'), false);
  });
  // The same save, in the whole game: the third place opens.
  const game = calmTo(fresh(), ALLEY);
  assert.equal(roomOpen(game.state, PANTRY), true);
});

test('the sample can be played from a new game to its end, and says so when it is over', () => {
  asSample(() => {
    const game = fresh();
    assert.equal(playable(game.state, NOW), true, 'a save is still found playable');
    assert.notEqual(goalOf(game.state).id, 'sample');
    assert.equal(game.sampleDone(), false);
    // The garden calm, and Ines Tock told: the alley is the goal, as ever.
    game.state.story.ines = 1;
    calmTo(game, GARDEN);
    assert.equal(goalOf(game.state).id, 'report');
    game.state.story.ines = 2;
    assert.deepEqual([goalOf(game.state).id, goalOf(game.state).room], ['calm', ALLEY]);
    assert.equal(rivalDue(game.state), 0, 'and the rival\'s first meeting is part of it');
    // The alley calm: she is told, and what she says does not send you to a place that is shut.
    calmTo(game, ALLEY);
    assert.equal(game.sampleDone(), true);
    assert.equal(goalOf(game.state).id, 'report');
    game.standBy('ines');
    const said = game.talkTo('ines').map((line) => (typeof line === 'string' ? line : line.text)).join(' ');
    assert.match(said, /The Midnight Pantry is next, and that is a longer story than tonight's\./);
    assert.doesNotMatch(said, /striped awning/, 'no directions to a place the sample does not hold');
    // Then the goal is that the sample is over; it names what was calmed and where the rest is.
    const goal = goalOf(game.state);
    assert.equal(goal.id, 'sample');
    assert.equal(goal.title, 'That is the free sample');
    assert.match(goal.detail, /The Garden Gate and Tin Can Alley are calm/);
    assert.match(goal.detail, /The whole game is coming to iPhone\./);
    assert.equal(goal.room, null);
    // Her first meeting won and heard out: her second waits on a place the sample does not hold.
    game.state.story.rival = 1;
    game.state.story.heard = 1;
    assert.equal(rivalDue(game.state), -1);
    assert.equal(playable(game.state, NOW), true);
  });
});

test('what the sample says of itself is counted from the game', () => {
  const words = sampleWords();
  assert.equal(words.held, 'The Garden Gate and Tin Can Alley');
  assert.match(words.intro, /^This is the free sample: The Garden Gate and Tin Can Alley, the first 2 places of 12\./);
  assert.equal(words.gate('The Midnight Pantry'), 'The free sample ends here. The Midnight Pantry is in the whole game, coming to iPhone.');
  assert.match(words.end[1], /12 places on both banks of the river, \d+ kinds of Clutterkin/);
  assert.equal(ROOMS.filter(roomBuilt).length, 12);
});

test('a save from the whole game, opened as the sample, loses nothing but the way in', () => {
  // Somebody played the copy on the web before it became a sample, and was indoors in the fifth place.
  const game = calmTo(fresh(), ROOM_IDS[3]);
  const friends = game.state.friends.length;
  assert.equal(game.travelTo(ROOM_IDS[4]), true);
  const stored = game.serialize(NOW);
  assert.equal(reviveState(JSON.parse(stored), NOW).visit.room, ROOM_IDS[4], 'in the whole game the visit is kept');
  asSample(() => {
    const state = reviveState(JSON.parse(stored), NOW);
    assert.equal(state.visit, null, 'in the sample they are not standing in a place that is shut');
    assert.equal(state.indoors, null);
    assert.equal(state.friends.length, friends, 'their friends are all still theirs');
    for (const id of ROOM_IDS.slice(0, 4)) assert.equal(state.rooms[id].clears, 1, `${id} is still calm in the save`);
    assert.equal(playable(state, NOW), true);
    const again = new Game(state, { now: NOW, fx: false });
    assert.equal(again.place(), 'lane');
    assert.notEqual(goalOf(state).id, 'calm', 'and they are not sent to calm a place that is shut');
  });
});
