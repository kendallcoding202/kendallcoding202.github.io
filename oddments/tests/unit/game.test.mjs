// The Game object: every action a player can take, and when each is allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../web/js/core/game.js';
import { newState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { newFriend } from '../../web/js/core/progress.js';
import { ROOMS, LOOK_IDS, NAME_LENGTH, BREATHER, SPECIES } from '../../web/js/core/balance.js';
import { maxHpOf } from '../../web/js/core/rooms.js';

const NOW = 1_800_000_000_000;
const fresh = (seed = 11) => new Game(newState(NOW, seed), { now: NOW });

test('the intro sets the name and look and starts the game', () => {
  const game = fresh();
  assert.equal(game.state.started, false);
  game.begin({ name: '  Marisol the Extremely Patient  ', look: LOOK_IDS[2] });
  assert.equal(game.state.started, true);
  assert.equal(game.state.player.name, 'Marisol the Extremely Patient'.slice(0, NAME_LENGTH));
  assert.equal(game.state.player.look, LOOK_IDS[2]);
});

test('an empty name keeps the old one; an unknown look falls back to the first', () => {
  const game = fresh();
  game.begin({ name: 'Kit' });
  assert.deepEqual(game.setLook({ name: '   ', look: 'tuxedo' }), { name: 'Kit', look: LOOK_IDS[0] });
  assert.deepEqual(game.setLook({}), { name: 'Kit', look: LOOK_IDS[0] });
  assert.deepEqual(game.setLook({ name: 42 }), { name: '42', look: LOOK_IDS[0] });
});

test('you are at home, on a path or in a fight, and each allows different things', () => {
  const game = fresh();
  assert.equal(game.place(), 'lane');
  assert.equal(game.startEncounter(), null, 'no fight at home');
  assert.equal(game.leaveRoom(), false);
  assert.equal(game.finishBattle(), null);
  assert.equal(game.choices(), null);
  assert.equal(game.act({ type: 'move', id: 'brace' }), false);

  assert.equal(game.travelTo('garden'), true);
  assert.equal(game.place(), 'path');
  assert.equal(game.travelTo('garden'), false);
  assert.equal(game.setTeam([1, 2]), false, 'nobody is swapped half way down a path');

  assert.ok(game.startEncounter());
  assert.equal(game.place(), 'fight');
  assert.equal(game.startEncounter(), null, 'one fight at a time');
  assert.equal(game.leaveRoom(), false, 'no slipping out of a fight by the side door');
  assert.equal(game.finishBattle(), null, 'not until it is over');
  assert.ok(game.choices().unit);
  assert.equal(game.concede(), true);
  assert.ok(game.finishBattle());
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
  assert.equal(game.state.rooms.garden.best, 5);
  assert.equal(game.state.book.boss_hydra.met, true);
  assert.ok(game.state.friends.length > 3, 'and made friends on the way');
  assert.ok(game.state.friends.every((f) => !SPECIES[f.species].boss));
  assert.ok(game.team().every((f) => f.level > 3));
  assert.equal(game.place(), 'lane');
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
