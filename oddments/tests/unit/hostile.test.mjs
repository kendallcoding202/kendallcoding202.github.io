// A save is only a piece of text on the device, and text can be edited or
// damaged. These tests treat the save as an attack: whatever is in it, the
// game must either refuse it or come out with a state it can play, and never
// one that breaks at launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviveState, newState } from '../../web/js/core/state.js';
import { playable } from '../../web/js/core/trial.js';
import { Game } from '../../web/js/core/game.js';
import { playOut } from '../../web/js/core/auto.js';
import { SPECIES, ROSTER_MAX, TEAM_SIZE, MAX_LEVEL, NAME_LENGTH, ROOMS, LOOK_IDS, xpNeeded } from '../../web/js/core/balance.js';
import { maxHpOf } from '../../web/js/core/rooms.js';
import { playPlayer } from '../../tools/sim.mjs';

const NOW = 1_800_000_000_000;
// A real save to start from: several visits in, with friends at home, an
// Heirloom, a room visit in progress and a hint seen.
const sim = playPlayer({ seed: 21, visits: 3 });
sim.state.friends[1].heirloom = true;
sim.state.seen.calls = true;
sim.state.settings.fast = true;
const live = new Game(sim.state, { now: NOW, fx: false });
live.setLook({ name: 'Odalys', look: LOOK_IDS[3] });
live.travelTo('garden');
playOut(live.startEncounter(), {});
live.finishBattle();
const REAL = JSON.parse(live.serialize(NOW));

/** What the game does with a save: revive it, and rehearse it before trusting it. */
function load(saved) {
  const state = reviveState(JSON.parse(JSON.stringify(saved)), NOW);
  return state && playable(state, NOW) ? state : null;
}

test('the save the tests start from is a rich one', () => {
  assert.ok(REAL.friends.length >= 6 && REAL.visit && REAL.visit.stop === 1 && REAL.stats.befriended >= 3);
  assert.ok(REAL.friends.some((f) => f.heirloom) && Object.keys(REAL.seen).length === 1 && REAL.rooms.garden.clears >= 1);
});

test('a real save comes through the repair exactly as it went in', () => {
  const back = reviveState(JSON.parse(JSON.stringify(REAL)), NOW);
  assert.deepEqual(back, REAL);
  assert.equal(playable(back, NOW), true);
});

test('saves built to break the game at launch are repaired, and the game then runs', () => {
  const attacks = [
    { v: 1, friends: [] },
    { v: 1, friends: [{}] },
    { v: 1, friends: [null, 7, 'sockeel', []] },
    { v: 1, friends: [{ species: 'constructor' }] },
    { v: 1, friends: [{ species: '__proto__', level: 1e308 }] },
    { v: 1, friends: [{ species: 'boss_hydra', level: 40 }], team: [1] },
    { v: 1, friends: [{ id: 1, species: 'sockeel', level: -1e300, xp: 1e308 }], team: [1, 1, 1] },
    { v: 1, friends: [{ id: 1, species: 'sockeel', level: 3 }], team: [99, 'x', null, {}] },
    { v: 1, friends: REAL.friends, team: 'everyone' },
    { v: 1, friends: REAL.friends, team: [], visit: { room: 'garden', stop: 1e9, hp: { 1: -5, 2: 1e99, 3: 'full' } } },
    { v: 2, friends: REAL.friends, team: [], visit: { room: 'garden', stop: 1e9, groups: [], hp: { 1: -5, 2: 1e99, 3: 'full' } } },
    { v: 2, friends: REAL.friends, visit: { room: 'dark', stop: 0, groups: [], hp: {} } },
    { v: 2, friends: REAL.friends, visit: { room: 'constructor', stop: 0, groups: [] } },
    { v: 2, friends: REAL.friends, visit: { room: 'garden', stop: 4, groups: REAL.visit.groups, hp: { 1: 0, 2: 0, 3: 0 } } },
    { v: 2, friends: REAL.friends, visit: { room: 'garden', stop: -3, groups: 'everyone', hp: {} } },
    { v: 2, friends: REAL.friends, visit: { room: 'garden', groups: [{ done: true }, { done: true }, { done: true }, { done: true }, { done: true }], hp: {} } },
    { v: 2, friends: REAL.friends, visit: { room: 'garden', groups: [{ foes: [{ species: 'boss_hydra', level: 1, heirloom: false }] }, null, 7, { foes: { length: 3 } }, { foes: [], done: 1 }], hp: {} } },
    { v: 2, friends: REAL.friends, where: { x: 1e308, y: -1e308 }, visit: REAL.visit },
    { v: 2, friends: REAL.friends, where: 'in the hedge' },
    { v: 2, friends: REAL.friends, where: { x: 480, y: 800 }, visit: REAL.visit },
    { v: 2, friends: REAL.friends, rooms: { garden: { clears: -1, best: 99 }, alley: { clears: 9 } }, visit: { room: 'alley', stop: 0, groups: [], hp: {} } },
    { v: 2, friends: REAL.friends, rooms: { garden: { calmed: 1e9 }, alley: { calmed: 'all' }, pantry: { calmed: -7 } }, visit: { room: 'garden', stop: 9, groups: [{ wander: true }, { wander: 7, done: true }, null, { foes: [], wander: true }, { wander: true, done: true }], hp: {} } },
    { v: 1, friends: REAL.friends, book: { sockeel: 'yes', constructor: { met: true } }, stats: [], settings: 7, seen: 'everything' },
    { v: 1, friends: REAL.friends, rng: 'seven', nextFriendId: -3, started: 'yes', player: 'me' },
    { v: 0.5, friends: REAL.friends, rng: 1e308 },
  ];
  for (const attack of attacks) {
    const state = load(attack);
    assert.ok(state, `refused outright rather than repaired: ${JSON.stringify(attack).slice(0, 70)}`);
    const game = new Game(state, { now: NOW, fx: false });
    if (game.place() === 'lane') assert.equal(game.travelTo('garden'), true);
    for (let i = 0; i < 3 && game.place() === 'path'; i++) { playOut(game.startEncounter(), { befriend: true }); assert.ok(game.finishBattle()); }
    assert.ok(game.team().length >= 1 && game.team().length <= TEAM_SIZE);
    assert.ok(Number.isInteger(state.rng));
    assert.doesNotThrow(() => JSON.parse(game.serialize(NOW)));
  }
});

test('friends are rebuilt field by field, keeping nothing the game did not make', () => {
  const state = load({
    ...REAL,
    friends: [
      { id: 5, species: 'gnome', level: 4.9, xp: 12.7, heirloom: 'yes', name: '<img src=x onerror=alert(1)>', evil: { deep: true }, moves: ['lawnorder'] },
      { id: 5, species: 'sockeel', level: '9', xp: -4 }, // the same id again, a level that is text
      { id: 6, species: 'gnome', level: 30 }, // a second Gnome
      { id: 7, species: 'boss_hydra', level: 5 }, // nobody's friend
      { id: 8, species: 'toString', level: 5 },
      { id: 2.5, species: 'ratscal', level: 2, xp: 1e12, heirloom: true },
      null, 7, 'dustbunny',
    ],
    team: [5, 5, 7, 6, 2.5],
  });
  assert.deepEqual(state.friends.map((f) => f.species), ['gnome', 'sockeel', 'ratscal']);
  for (const friend of state.friends) assert.deepEqual(Object.keys(friend), ['id', 'species', 'level', 'xp', 'heirloom']);
  const [gnome, eel, rat] = state.friends;
  assert.deepEqual([gnome.level, gnome.xp, gnome.heirloom], [4, 12, false], 'whole numbers; "yes" is not true');
  assert.deepEqual([eel.level, eel.xp], [1, 0], 'a level that is not a number is level 1');
  assert.deepEqual([rat.level, rat.xp, rat.heirloom], [2, xpNeeded(2) - 1, true], 'experience cannot exceed the bar');
  assert.equal(new Set(state.friends.map((f) => f.id)).size, 3, 'no two friends share an id');
  assert.ok(state.friends.every((f) => Number.isInteger(f.id) && f.id >= 1));
  assert.ok(state.nextFriendId > Math.max(...state.friends.map((f) => f.id)));
  assert.equal(state.team.length, 3);
  assert.equal(new Set(state.team).size, 3, 'nobody is on the team twice');
  assert.ok(state.team.every((id) => state.friends.some((f) => f.id === id)));
});

test('the only text taken from a save is the house-sitter\'s name, cut to length', () => {
  const state = load({ ...REAL, player: { name: `  <b>${'x'.repeat(5000)}`, look: '<script>' } });
  assert.equal(state.player.name.length, NAME_LENGTH);
  assert.equal(state.player.look, LOOK_IDS[0], 'a look is one of the game\'s own or the first');
  assert.equal(load({ ...REAL, player: { name: '   ', look: 5 } }).player.name, 'Sitter');
  const strings = [];
  JSON.stringify(state, (key, value) => { if (typeof value === 'string') strings.push(value); return value; });
  const known = new Set([...Object.keys(SPECIES), ...ROOMS.map((r) => r.id), ...LOOK_IDS, state.player.name]);
  assert.deepEqual(strings.filter((s) => !known.has(s)), []);
});

test('nothing in a save can be bigger than the game allows', () => {
  const state = load({
    ...REAL,
    friends: REAL.friends.concat(Array.from({ length: 50_000 }, (_, i) => ({ id: i, species: 'gnome', level: 5 }))),
    team: Array.from({ length: 10_000 }, (_, i) => i),
    player: { name: 'x'.repeat(2_000_000) },
    seen: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, true])),
    stats: { battles: 1e300, wins: -5, rounds: Infinity },
    extra: 'y'.repeat(100_000),
  });
  assert.ok(state.friends.length <= ROSTER_MAX);
  assert.equal(state.friends.filter((f) => f.species === 'gnome').length, 1);
  assert.equal(state.team.length, TEAM_SIZE);
  assert.ok(Object.keys(state.seen).length <= 64);
  assert.ok(state.stats.battles <= 1e9 && state.stats.wins === 0 && state.stats.rounds === 0);
  assert.equal(state.extra, undefined);
  assert.ok(JSON.stringify(state).length < 6000);
});

test('a value nested thousands deep is dropped, not saved back', () => {
  let deep = true;
  for (let i = 0; i < 6000; i++) deep = { d: deep };
  const state = reviveState({ ...REAL, seen: { ...REAL.seen, trap: deep }, book: { sockeel: deep }, visit: { room: 'garden', stop: deep, hp: deep } }, NOW);
  assert.equal(state.seen.trap, undefined);
  assert.doesNotThrow(() => JSON.stringify(state));
  assert.equal(playable(state, NOW), true);
});

test('no number in a save can stall or overflow the game', () => {
  for (const big of [1e308, -1e308, 1e15, -1, 0.5, NaN]) {
    const hostile = JSON.parse(JSON.stringify(REAL), (key, value) => (typeof value === 'number' && key !== 'v' ? big : value));
    const state = load(hostile);
    assert.ok(state, `numbers all set to ${big}`);
    for (const friend of state.friends) {
      assert.ok(friend.level >= 1 && friend.level <= MAX_LEVEL && friend.xp >= 0 && friend.xp < xpNeeded(friend.level));
      assert.ok(Number.isFinite(maxHpOf(friend)));
    }
    assert.ok(Number.isInteger(state.rng));
    if (state.visit) for (const id of state.team) assert.ok(state.visit.hp[id] >= 0 && state.visit.hp[id] <= maxHpOf(state.friends.find((f) => f.id === id)));
  }
});

// Every field of the real save, replaced in turn by every kind of wrong thing.
const WRONG = [null, true, 0, -1, 1e308, 3.5, '', 'constructor', '__proto__', '<img src=x onerror=alert(1)>', [], [null], [{}], {}, { length: 1e9 }, { species: 'sockeel' }];
function* paths(node, prefix = []) {
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      yield [...prefix, key];
      yield* paths(node[key], [...prefix, key]);
    }
  }
}
test('every field of a save, replaced by every kind of wrong value, still gives a playable game or a refusal', () => {
  let tried = 0;
  let refused = 0;
  for (const path of paths(REAL)) {
    for (const wrong of WRONG) {
      const hostile = JSON.parse(JSON.stringify(REAL));
      let at = hostile;
      for (const key of path.slice(0, -1)) at = at[key];
      at[path[path.length - 1]] = wrong;
      let state;
      assert.doesNotThrow(() => { state = reviveState(hostile, NOW); }, `revive threw with ${path.join('.')} = ${JSON.stringify(wrong)}`);
      tried++;
      if (!state) { refused++; continue; }
      assert.equal(playable(state, NOW), true, `not playable with ${path.join('.')} = ${JSON.stringify(wrong)}`);
    }
  }
  assert.ok(tried > 1500, `${tried} cases`);
  // Only the two things that say whether it is a save at all may refuse it: the version and the list of friends.
  assert.ok(refused <= 2 * WRONG.length, `${refused} refusals`);
});

test('a rehearsal catches a state that would break the game, without touching it', () => {
  const broken = newState(NOW, 4);
  broken.friends[0].species = 'nothing'; // what an unrepaired save could hold
  const before = JSON.stringify(broken);
  assert.equal(playable(broken, NOW), false);
  assert.equal(JSON.stringify(broken), before);
  const empty = newState(NOW, 4);
  empty.team = [];
  assert.equal(playable(empty, NOW), false);
  const fresh = newState(NOW, 4);
  const untouched = JSON.stringify(fresh);
  assert.equal(playable(fresh, NOW), true);
  assert.equal(JSON.stringify(fresh), untouched);
});
