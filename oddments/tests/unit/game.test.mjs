// The Game object: every action a player can take, and when each is allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { newFriend } from '../../web/js/core/progress.js';
import { ROOMS, LOOK_IDS, NAME_LENGTH, BREATHER, SPECIES } from '../../web/js/core/balance.js';
import { maxHpOf } from '../../web/js/core/rooms.js';
import { WORLD, POST, BARRICADE, DISTRICTS, districtOf, districtAt, spotOf, BRIDGE } from '../../web/js/core/world.js';

// The gate on Kettle Bridge holds its ground until the whole lane is calm (tests/unit/farbank.test.mjs).
// These tests are about the places themselves, so they look at what is held apart from it.
const land = (held) => held.filter((spot) => !(spot.x === BRIDGE.gate.x && spot.y === BRIDGE.gate.y));


const NOW = 1_800_000_000_000;
const fresh = (seed = 11) => new Game(newState(NOW, seed), { now: NOW });

test('the intro sets the name and look and starts the game', () => {
  const game = fresh();
  assert.equal(game.state.started, false);
  game.begin({ name: '  Marisol the Extremely Patient  ', look: LOOK_IDS[2] });
  assert.equal(game.state.started, true);
  assert.equal(game.state.player.name, 'Marisol the Extremely Patient'.slice(0, NAME_LENGTH).trim(), 'cut to length, with no space left dangling');
  assert.equal(game.state.player.look, LOOK_IDS[2]);
});

test('an empty name keeps the old one; an unknown look falls back to the first', () => {
  const game = fresh();
  game.begin({ name: 'Kit' });
  assert.deepEqual(game.setLook({ name: '   ', look: 'tuxedo' }), { name: 'Kit', look: LOOK_IDS[0] });
  assert.deepEqual(game.setLook({}), { name: 'Kit', look: LOOK_IDS[0] });
  assert.deepEqual(game.setLook({ name: 42 }), { name: '42', look: LOOK_IDS[0] });
});

test('you are at ease, out on a visit or in a fight, and each allows different things', () => {
  const game = fresh();
  assert.equal(game.place(), 'lane');
  assert.equal(game.startEncounter(), null, 'no fight when nobody is about');
  assert.equal(game.rest(), false);
  assert.equal(game.goHome(), false);
  assert.equal(game.meeting(), -1);
  assert.equal(game.nextGroup(), -1);
  assert.equal(game.approach(), false);
  assert.equal(game.finishBattle(), null);
  assert.equal(game.choices(), null);
  assert.equal(game.act({ type: 'move', id: 'brace' }), false);
  for (const nowhere of ['alley', 'home', 'nowhere', 'constructor', null]) assert.equal(game.travelTo(nowhere), false, String(nowhere));

  assert.equal(game.travelTo('garden'), true);
  assert.equal(game.place(), 'path');
  assert.equal(game.district(), 'garden');
  assert.equal(game.travelTo('garden'), false);
  assert.equal(game.setTeam([1, 2]), false, 'nobody is swapped half way through a visit');
  assert.equal(game.rest(), false, 'resting is done at home');

  assert.ok(game.startEncounter());
  assert.equal(game.place(), 'fight');
  assert.equal(game.standing(), null);
  assert.equal(game.walk({ x: 1000, y: 1500 }, 0.1), false, 'no walking off mid-fight');
  assert.equal(game.standAt('home'), false);
  assert.equal(game.startEncounter(), null, 'one fight at a time');
  assert.equal(game.goHome(), false, 'no slipping out of a fight by the side door');
  assert.equal(game.finishBattle(), null, 'not until it is over');
  assert.ok(game.choices().unit);
  assert.equal(game.concede(), true);
  assert.ok(game.finishBattle());
  assert.equal(game.place(), 'lane');
  assert.equal(game.near(), 'home', 'worn out, they are carried home');
});

/** Walks the game to a point the way the screen does: find the way, then a frame at a time. */
function walkTo(game, target) {
  for (const point of game.routeTo(target)) {
    for (let i = 0; i < 3000 && Math.hypot(point.x - game.state.where.x, point.y - game.state.where.y) >= WORLD.arrive; i++) {
      if (!game.walk(point, 1 / 60)) break;
    }
  }
  return game.state.where;
}
const GATE = districtOf('garden').gate;
const POSTS = districtOf('garden').posts;
const JUST_IN = { x: GATE.x, y: GATE.y - 90 };
// Tin Can Alley: shut behind a barricade until the garden is calm, its restless ones keeping to their bins.
const ALLEY = districtOf('alley');
const SHUT = { x: ALLEY.gate.x, y: ALLEY.gate.y, r: BARRICADE };
const UP_THE_ALLEY = { x: ALLEY.gate.x, y: ALLEY.gate.y - 90 };
/** A game in which the garden has been calmed, so the alley is open. */
const gardenCalm = (seed = 11) => { const game = fresh(seed); game.begin({ name: 'Kit' }); game.state.rooms.garden.clears = 1; game.state.rooms.garden.calmed = 31; return game; };

test('walking in through the gate, rested, begins a visit; walking back out does not end it', () => {
  const game = fresh();
  walkTo(game, spotOf('garden').door);
  assert.equal(game.near(), 'garden');
  assert.equal(game.district(), null);
  assert.equal(game.place(), 'lane', 'reading the sign is not a visit');
  walkTo(game, JUST_IN);
  assert.equal(game.district(), 'garden');
  assert.equal(game.place(), 'path');
  assert.equal(game.state.rooms.garden.visits, 1);
  assert.equal(game.state.visit.groups.length, 5);
  walkTo(game, spotOf('garden').door);
  assert.equal(game.district(), null);
  assert.equal(game.place(), 'path', 'still out on the same visit');
  walkTo(game, JUST_IN);
  assert.equal(game.state.rooms.garden.visits, 1, 'and stepping back in is not a new one');
});

test('from outside they are hidden but in the way; once you are in they hold their ground until calmed', () => {
  const game = fresh();
  assert.deepEqual(land(game.held()), [...POSTS, SHUT, ...ALLEY.posts], 'rested and outside: a bush at every post, and the alley shut');
  game.travelTo('garden');
  assert.deepEqual(land(game.held()), [...POSTS, SHUT, ...ALLEY.posts]);
  const post = POSTS[0];
  // Walk straight at a group: you stop short of where it stands.
  for (let i = 0; i < 600; i++) game.walk(post, 1 / 60);
  assert.ok(Math.hypot(game.state.where.x - post.x, game.state.where.y - post.y) >= POST.hold - 1e-6);
  assert.equal(game.meeting(), 0, 'and that is meeting it');
  playOut(game.startEncounter(game.meeting()), {});
  assert.equal(game.finishBattle().won, true);
  assert.deepEqual(land(game.held()), [...POSTS.slice(1), SHUT, ...ALLEY.posts], 'calm, they hold nothing');
  assert.equal(game.meeting(), -1);
  walkTo(game, post);
  assert.ok(Math.hypot(game.state.where.x - post.x, game.state.where.y - post.y) < 8, 'and you can stand where they stood');
});

test('the alley is shut behind a barricade until the garden is calm; then you walk straight in', () => {
  const game = fresh();
  game.begin({ name: 'Kit' });
  assert.equal(game.roomOpen('alley'), false);
  walkTo(game, spotOf('alley').door);
  assert.equal(game.near(), 'alley', 'you can walk up to its gate');
  walkTo(game, UP_THE_ALLEY);
  assert.equal(game.district(), null, 'but not through it');
  assert.ok(Math.hypot(game.state.where.x - ALLEY.gate.x, game.state.where.y - ALLEY.gate.y) >= BARRICADE - 1e-6);
  assert.equal(game.place(), 'lane');
  // Nor round it: every way to the inside of the alley ends outside.
  for (const post of ALLEY.posts) { walkTo(game, post); assert.equal(game.district(), null); }
  // Calm the garden and the barricade is gone.
  game.state.rooms.garden.clears = 1;
  assert.equal(game.held().some((point) => point.r === BARRICADE), false);
  walkTo(game, UP_THE_ALLEY);
  assert.equal(game.district(), 'alley');
  assert.equal(game.place(), 'path');
  assert.equal(game.state.visit.room, 'alley');
  assert.equal(game.state.visit.groups.length, ROOMS[1].path.length);
  assert.equal(game.state.rooms.alley.visits, 1);
});

test('the alley is one group wide: there is no going round, so they are met in turn, the Baron last', () => {
  const game = gardenCalm();
  assert.equal(game.travelTo('alley'), true);
  assert.equal(districtAt(game.state.where), 'alley');
  const far = ALLEY.posts[ALLEY.posts.length - 1];
  for (let turn = 0; turn < ALLEY.posts.length; turn++) {
    // Tap the far end of the alley. The way there is blocked by whoever is next, so that is who you walk up to.
    assert.equal(game.meeting(), -1);
    walkTo(game, far);
    assert.equal(game.meeting(), turn, `tapping past them, you meet group ${turn}`);
    const post = ALLEY.posts[turn];
    assert.ok(game.state.where.y > post.y, 'from the gate side');
    // And walking straight at the far end gets you no further than them.
    for (let i = 0; i < 400; i++) game.walk(far, 1 / 60);
    assert.ok(Math.hypot(game.state.where.x - post.x, game.state.where.y - post.y) >= POST.hold - 1e-6);
    assert.ok(game.state.where.y > post.y - 20, `nobody slips past group ${turn}`);
    // Calm them (without the fight: this is about the walking), and the way on is open as far as the next.
    game.state.visit.groups[turn].done = true;
    game.state.visit.stop = turn + 1;
  }
  walkTo(game, far);
  assert.ok(Math.hypot(game.state.where.x - far.x, game.state.where.y - far.y) < 8, 'with everyone calm you can walk the length of it');
  // And back out again to home.
  walkTo(game, spotOf('home').door);
  assert.equal(game.near(), 'home');
});

test('every group in the alley can really be fought, in order, by a team that has grown a bit', () => {
  let cleared = null;
  for (let seed = 1; seed <= 30 && !cleared; seed++) {
    const game = gardenCalm(seed);
    for (const friend of game.state.friends) friend.level = 7;
    game.travelTo('alley');
    const stops = [];
    while (game.place() === 'path') {
      stops.push(game.nextGroup());
      playOut(game.startEncounter(), {});
      game.finishBattle();
    }
    if (game.state.rooms.alley.clears) cleared = { game, stops };
  }
  assert.ok(cleared, 'a grown team calms the alley within a few tries');
  assert.deepEqual(cleared.stops, [0, 1, 2, 3, 4]);
  assert.equal(cleared.game.state.book.boss_baron.met, true);
  assert.equal(cleared.game.district(), 'alley');
  assert.deepEqual(land(cleared.game.held()), [], 'calm, the alley holds nothing; and the garden, calm before it, has stayed calm');
});

test('one visit at a time: while you are calling on one place, the other keeps to its cover', () => {
  const game = gardenCalm();
  assert.equal(game.travelTo('garden'), true);
  // Walk out of the garden and down into the alley, mid-visit.
  walkTo(game, spotOf('alley').door);
  walkTo(game, UP_THE_ALLEY);
  assert.equal(game.district(), 'alley', 'you can step in');
  assert.equal(game.state.visit.room, 'garden', 'but your visit is still to the garden');
  assert.equal(game.state.rooms.alley.visits, 0);
  walkTo(game, ALLEY.posts[0]);
  assert.equal(game.meeting(), -1, 'and nobody in the alley comes out to you');
  assert.ok(Math.hypot(game.state.where.x - ALLEY.posts[0].x, game.state.where.y - ALLEY.posts[0].y) >= POST.hold - 1e-6, 'though they are still in the way');
  // Rest at home, and then the alley is yours to call on.
  walkTo(game, spotOf('home').door);
  assert.equal(game.rest(), true);
  walkTo(game, spotOf('alley').door);
  walkTo(game, UP_THE_ALLEY);
  assert.equal(game.state.visit.room, 'alley');
  walkTo(game, ALLEY.posts[0]);
  assert.equal(game.meeting(), 0);
});

test('the way to one group never brushes past another: you meet who you walked up to, nobody else', () => {
  const others = [0, 1, 2, 3]; // everyone but the boss, who will not be met yet anyway
  const trip = (game, from, to) => {
    for (const point of game.routeTo(POSTS[to])) {
      for (let i = 0; i < 3000 && Math.hypot(point.x - game.state.where.x, point.y - game.state.where.y) >= WORLD.arrive; i++) {
        if (!game.walk(point, 1 / 60)) break;
        const met = game.meeting();
        assert.ok(met === -1 || met === to || met === from, `on the way from ${from} to ${to}, brushed past ${met}`);
        if (met === to) return true;
      }
    }
    return game.meeting() === to;
  };
  for (const to of others) {
    const game = fresh();
    game.travelTo('garden');
    assert.equal(trip(game, -1, to), true, `from the gate to group ${to}`);
  }
  for (const from of others) {
    for (const to of others) {
      if (from === to) continue;
      const game = fresh();
      game.travelTo('garden');
      game.approach(from); // standing right beside one group, having thought better of it
      assert.equal(trip(game, from, to), true, `from beside group ${from} to group ${to}`);
    }
  }
  // And walking home from beside any of them meets nobody on the way.
  for (const from of others) {
    const game = fresh();
    game.travelTo('garden');
    game.approach(from);
    for (const point of game.routeTo(spotOf('home').door)) {
      for (let i = 0; i < 3000 && Math.hypot(point.x - game.state.where.x, point.y - game.state.where.y) >= WORLD.arrive; i++) {
        if (!game.walk(point, 1 / 60)) break;
        assert.ok([-1, from].includes(game.meeting()), `walking home from group ${from}, brushed past ${game.meeting()}`);
      }
    }
    assert.equal(game.near(), 'home', `home from beside group ${from}`);
  }
});

test('walk up to any group and you have met it; the boss will not be met until the rest are calm', () => {
  const game = fresh();
  game.travelTo('garden');
  assert.equal(game.nextGroup(), 0);
  assert.equal(game.approach(3), true, 'the fourth group first, if you like');
  assert.equal(game.meeting(), 3);
  const battle = game.startEncounter(game.meeting());
  assert.deepEqual(battle.units.filter((u) => u.side === 'foe').map((u) => u.species), game.state.visit.groups[3].foes.map((foe) => foe.species));
  assert.equal(game.facing, 3);
  game.concede(); game.finishBattle();

  game.travelTo('garden');
  assert.equal(game.approach(4), false, 'the boss is not to be approached yet');
  game.state.where = { x: POSTS[4].x, y: POSTS[4].y + POST.hold + 8 };
  assert.equal(game.meeting(), -1, 'standing right in front of it meets nobody');
  assert.equal(game.startEncounter(4), null);
  for (const odd of [-1, 5, 1.5, '0', null]) assert.equal(game.startEncounter(odd), null, String(odd));
  for (let i = 0; i < 4; i++) { playOut(game.startEncounter(i), {}); game.finishBattle(); if (game.place() !== 'path') return; }
  game.state.where = { x: POSTS[4].x, y: POSTS[4].y + POST.hold + 8 };
  assert.equal(game.meeting(), 4, 'with everyone else calm, it faces you');
  assert.equal(game.nextGroup(), 4);
});

test('resting is done at home: it ends the visit, and whoever was calmed stays calm', () => {
  const game = fresh(4);
  game.travelTo('garden');
  playOut(game.startEncounter(), {});
  assert.equal(game.finishBattle().won, true);
  assert.equal(game.state.visit.stop, 1);
  assert.equal(game.rest(), false, 'not out here');
  walkTo(game, spotOf('home').door);
  assert.equal(game.near(), 'home');
  assert.equal(game.place(), 'path', 'walking home is not yet resting');
  assert.equal(game.rest(), true);
  assert.equal(game.place(), 'lane');
  for (const member of game.teamHealth()) assert.equal(member.hp, member.max);
  assert.equal(game.rest(), false);
  assert.equal(game.setTeam(game.state.team.slice(0, 2)), true, 'rested, the team can change');
  // From outside, nobody keeps to cover where you calmed them; back in, only the others are waiting.
  assert.equal(game.held().filter((point) => !point.r && POSTS.includes(point)).length, 4);
  assert.equal(game.held().includes(POSTS[0]), false);
  game.travelTo('garden');
  assert.equal(game.state.visit.stop, 1, 'the group calmed before the rest is still calm');
  assert.deepEqual(game.state.visit.groups.map((group) => group.done), [true, false, false, false, false]);
  assert.deepEqual(game.state.visit.groups[0], { foes: [], done: true }, 'and nobody stands where they stood');
  assert.equal(game.nextGroup(), 1);
  assert.equal(game.calmedIn('garden'), 1);
  assert.equal(game.staysCalm('garden', 0) && !game.staysCalm('garden', 1), true);
  assert.equal(game.goHome(), true);
  assert.equal(game.near(), 'home');
  assert.equal(game.place(), 'lane');
});

test('the team is one to three friends you actually have, each once', () => {
  const game = fresh();
  game.state.friends.push(newFriend(4, 'gnome', 2), newFriend(5, 'ratscal', 2));
  assert.equal(game.setTeam([4, 5, 1]), true);
  assert.deepEqual(game.team().map((f) => f.species), ['gnome', 'ratscal', 'dustbunny']);
  assert.equal(game.setTeam([2]), true);
  assert.deepEqual(game.state.team, [2]);
  for (const bad of [[], [1, 1], [1, 2, 3, 4], [99], [1, 'x'], 'all', null, [[1]]]) {
    assert.equal(game.setTeam(bad), false, JSON.stringify(bad));
    assert.deepEqual(game.state.team, [2]);
  }
});

test('a short-handed team fights short-handed', () => {
  const game = fresh();
  game.setTeam([3]);
  game.travelTo('garden');
  const battle = game.startEncounter();
  assert.equal(battle.units.filter((u) => u.side === 'ally').length, 1);
  assert.equal(game.teamHealth().length, 1);
});

test('meeting a kind writes it in the scrapbook', () => {
  const game = fresh();
  game.travelTo('garden');
  const battle = game.startEncounter();
  for (const foe of battle.units.filter((u) => u.side === 'foe')) assert.equal(game.state.book[foe.species].met, true);
  assert.equal(game.state.book.boss_hydra.met, false);
});

test('Health carries from one fight to the next with a breather between, and is full again at home', () => {
  const game = fresh(4);
  game.travelTo('garden');
  const battle = game.startEncounter();
  playOut(battle, {});
  const left = Object.fromEntries(battle.units.filter((u) => u.side === 'ally').map((u) => [u.friendId, u.hp]));
  const result = game.finishBattle();
  assert.equal(result.won, true);
  assert.deepEqual([result.room, result.stop, result.cleared, result.home], ['garden', 0, false, false]);
  for (const member of game.teamHealth()) {
    assert.equal(member.hp, Math.min(member.max, left[member.id] + Math.ceil(member.max * BREATHER)));
  }
  const next = game.startEncounter();
  // Whoever is quicker than the team may already have landed a hit; count those back in.
  const taken = (key) => next.events.filter((e) => e.t === 'hit' && e.target === key).reduce((sum, e) => sum + e.dmg, 0);
  for (const unit of next.units.filter((u) => u.side === 'ally')) assert.equal(unit.hp + taken(unit.key), game.state.visit.hp[unit.friendId]);
  game.concede(); game.finishBattle();
  for (const member of game.teamHealth()) assert.equal(member.hp, member.max);
});

test('a whole room can be played from the gate to the boss, and clearing it is remembered', () => {
  let cleared = null;
  for (let seed = 1; seed <= 40 && !cleared; seed++) {
    const game = fresh(seed);
    game.begin({ name: 'Kit' });
    game.travelTo('garden');
    const fights = [];
    while (game.place() === 'path') {
      playOut(game.startEncounter(), { befriend: true, have: game.state.friends.map((f) => f.species) });
      fights.push(game.finishBattle());
    }
    if (fights[fights.length - 1].cleared) cleared = { game, fights };
  }
  assert.ok(cleared, 'a sensible player clears the garden within a few tries');
  const { game, fights } = cleared;
  assert.equal(fights.length, ROOMS[0].path.length);
  assert.deepEqual(fights.map((f) => f.stop), [0, 1, 2, 3, 4]);
  assert.ok(fights.every((f) => f.won));
  assert.equal(game.state.rooms.garden.clears, 1);
  assert.equal(game.calmedIn('garden'), 5);
  assert.equal(game.state.book.boss_hydra.met, true);
  assert.ok(game.state.friends.length > 3, 'and made friends on the way');
  assert.ok(game.state.friends.every((f) => !SPECIES[f.species].boss));
  assert.ok(game.team().every((f) => f.level > 3));
  assert.equal(game.place(), 'lane');
  // You are still standing in the garden, rested, and nobody is about.
  assert.equal(game.district(), 'garden');
  assert.deepEqual(land(game.held()), ALLEY.posts, 'nothing in the garden; and the alley\'s barricade is down');
  for (const member of game.teamHealth()) assert.equal(member.hp, member.max);
  // Step out of the gate and it stays calm: nobody goes back into the bushes. Step in again and
  // it is a stroll: a few wanderers at some of its stops, and no ringleader.
  walkTo(game, spotOf('garden').door);
  assert.deepEqual(land(game.held()), ALLEY.posts);
  assert.equal(game.place(), 'lane');
  walkTo(game, JUST_IN);
  assert.equal(game.place(), 'path');
  assert.equal(game.state.rooms.garden.visits, 2);
  const stroll = game.state.visit;
  assert.equal(stroll.stroll, true);
  const about = stroll.groups.filter((group) => !group.done);
  assert.ok(about.length >= 1 && about.length <= 3, `${about.length} groups wandering`);
  assert.deepEqual(stroll.groups[4], { foes: [], done: true }, 'the ringleader does not come back');
  assert.ok(about.every((group) => group.foes.length >= 1 && group.foes.every((foe) => !SPECIES[foe.species].boss)));
  assert.equal(game.held().filter((point) => !point.r && POSTS.includes(point)).length, about.length, 'only the wanderers hold ground');
  // Meet them all and the garden is empty until you have rested; its record stands.
  while (game.nextGroup() >= 0) { playOut(game.startEncounter(), {}); assert.equal(game.finishBattle().cleared, false); if (game.place() !== 'path') break; }
  if (game.place() === 'path') {
    assert.equal(game.startEncounter(), null, 'nobody left to meet');
    assert.equal(game.state.visit.stop, about.length);
  }
  assert.equal(game.state.rooms.garden.clears, 1, 'calming it is counted once');
  assert.equal(game.calmedIn('garden'), 5);
});

test('with fx off no events are kept; with fx on the fight tells its story', () => {
  const quiet = new Game(newState(NOW, 2), { now: NOW, fx: false });
  quiet.travelTo('garden');
  assert.equal(quiet.startEncounter().events, null);
  const loud = fresh(2);
  loud.travelTo('garden');
  const events = loud.startEncounter().events;
  assert.equal(events[0].t, 'start');
  assert.equal(events[0].units.length, loud.battle.units.length);
  assert.equal(events[1].t, 'round');
  assert.ok(events.some((e) => e.t === 'turn'));
});

test('friend() finds a friend by id, and maxHp follows its level', () => {
  const game = fresh();
  assert.equal(game.friend(2).species, 'sockeel');
  assert.equal(game.friend(99), null);
  assert.equal(game.teamHealth()[1].max, maxHpOf(game.friend(2)));
});
