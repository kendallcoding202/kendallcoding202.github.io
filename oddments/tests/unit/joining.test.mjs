// How an Clutterkin joins: it is calmed in the fight by reaching out, never caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, choices, act, chooser, unitOf, stat, reachAmount, standing, damageOf } from '../../web/js/core/battle.js';
import { settleUp } from '../../web/js/core/progress.js';
import { newState } from '../../web/js/core/state.js';
import { SPECIES, CALLS, REACH, MOVES, softSpotOf, xpFor } from '../../web/js/core/balance.js';

const fight = (seed, allies, foes) => createBattle({ rng: seed }, { allies, foes });
const move = (id, target) => ({ type: 'move', id, target });
const call = (id, target) => ({ type: 'call', id, target });
const reach = (target) => call('reach', target);
/** Ends the current friend's turn without touching anyone. */
const pass = (battle) => act(battle, move('brace'));
const endRound = (battle) => { const round = battle.round; while (battle.phase === 'fight' && battle.round === round) pass(battle); };
// Tough friends so nobody falls over while the test is talking.
const SITTERS = [{ species: 'toastghost', level: 12 }, { species: 'gnome', level: 12 }];

test('a restless Clutterkin starts in a full Huff; a friend has none', () => {
  const battle = fight(1, SITTERS, [{ species: 'thornhog', level: 1 }]);
  const hog = unitOf(battle, 'f0');
  assert.equal(hog.huff, SPECIES.thornhog.huff);
  assert.equal(hog.maxHuff, SPECIES.thornhog.huff);
  assert.equal(unitOf(battle, 'a0').maxHuff, 0);
});

test('reaching out takes pips off, and at none it settles and sits the fight out', () => {
  const battle = fight(1, SITTERS, [{ species: 'thornhog', level: 1 }, { species: 'ratscal', level: 1 }]);
  const hog = unitOf(battle, 'f0');
  assert.equal(reachAmount(battle, hog), REACH.base, 'nobody here is its soft spot');
  let left = hog.huff;
  while (left > 0) {
    assert.equal(act(battle, reach('f0')), true);
    left = Math.max(0, left - REACH.base);
    assert.equal(hog.huff, left);
    assert.equal(hog.settled, left === 0);
    if (left > 0) endRound(battle);
  }
  assert.equal(standing(hog), false);
  assert.ok(battle.events.some((e) => e.t === 'settle' && e.target === 'f0'));
  assert.equal(battle.phase, 'fight', 'the Ratscal is still up');
  // It takes no more turns and cannot be hit or reached again.
  const options = choices(battle);
  assert.ok(!options.moves[0].targets.includes('f0'));
  assert.equal(act(battle, move(chooser(battle).moves[0].id, 'f0')), false);
  endRound(battle);
  assert.ok(!battle.order.includes('f0'));
  assert.equal(act(battle, reach('f0')), false);
});

test('a friend of the element it has a soft spot for makes reaching out work better', () => {
  // A Snailor is Suds; Suds beats Crumb; so it has a soft spot for the Toast Ghost.
  assert.equal(softSpotOf(SPECIES.snailor.element), SPECIES.toastghost.element);
  const without = fight(1, [{ species: 'gnome', level: 12 }], [{ species: 'snailor', level: 1 }]);
  const withGhost = fight(1, [{ species: 'gnome', level: 12 }, { species: 'toastghost', level: 12 }], [{ species: 'snailor', level: 1 }]);
  assert.equal(reachAmount(without, unitOf(without, 'f0')), REACH.base);
  assert.equal(reachAmount(withGhost, unitOf(withGhost, 'f0')), REACH.base + REACH.soft);
  act(withGhost, reach('f0'));
  assert.equal(unitOf(withGhost, 'f0').huff, SPECIES.snailor.huff - REACH.base - REACH.soft);
  // Only while that friend is standing.
  unitOf(withGhost, 'a1').hp = 0;
  assert.equal(reachAmount(withGhost, unitOf(withGhost, 'f0')), REACH.base);
});

test('the friend that helps calm it is the one it hits hardest', () => {
  const battle = fight(1, [{ species: 'gnome', level: 3 }, { species: 'toastghost', level: 3 }], [{ species: 'snailor', level: 3 }]);
  const snail = unitOf(battle, 'f0');
  const ghost = unitOf(battle, 'a1');
  const same = { ...ghost, element: 'clank' };
  assert.ok(damageOf(snail, ghost, MOVES.saltspray) > damageOf(snail, same, MOVES.saltspray));
});

test('every hit you land puts a pip back, up to the full Huff: you cannot calm what you are hitting', () => {
  const battle = fight(1, [{ species: 'gnome', level: 12 }, { species: 'gnome', level: 12 }], [{ species: 'snailor', level: 14 }]);
  const snail = unitOf(battle, 'f0');
  assert.equal(act(battle, reach('f0')), true);
  assert.equal(snail.huff, SPECIES.snailor.huff - REACH.base);
  act(battle, move('rodwhack', 'f0'));
  assert.equal(snail.huff, SPECIES.snailor.huff - REACH.base + REACH.hitBack);
  assert.ok(battle.events.some((e) => e.t === 'huff' && e.by === REACH.hitBack));
  for (let i = 0; i < 4 && battle.phase === 'fight'; i++) act(battle, move('rodwhack', 'f0'));
  assert.equal(battle.phase, 'fight');
  assert.equal(snail.huff, snail.maxHuff, 'never more than it started with');
});

test('a hit from its own side, or on a friend, changes nobody\'s Huff', () => {
  const battle = fight(4, [{ species: 'toastghost', level: 12 }], [{ species: 'grumblebee', level: 1 }]);
  act(battle, reach('f0'));
  const after = unitOf(battle, 'f0').huff;
  pass(battle); // the Grumblebee hits the Toast Ghost
  assert.ok(battle.events.some((e) => e.t === 'hit' && e.who === 'f0'));
  assert.equal(unitOf(battle, 'f0').huff, after);
});

test('the house-sitter makes one Call a round, during a friend\'s turn, without using the turn up', () => {
  const battle = fight(2, SITTERS, [{ species: 'thornhog', level: 1 }, { species: 'ratscal', level: 1 }]);
  const who = chooser(battle).key;
  assert.equal(act(battle, call('cheer', 'a0')), true);
  assert.equal(chooser(battle).key, who, 'still the same friend\'s turn');
  assert.equal(battle.called, true);
  assert.equal(act(battle, reach('f0')), false, 'one a round');
  assert.equal(act(battle, call('cheer', 'a1')), false);
  assert.ok(choices(battle).calls.every((c) => !c.ready && c.used));
  endRound(battle);
  assert.equal(battle.called, false);
  assert.equal(act(battle, reach('f0')), true, 'and again next round');
});

test('Cheer on makes a friend\'s next move hit harder, once', () => {
  const battle = fight(2, [{ species: 'gnome', level: 5 }], [{ species: 'snailor', level: 30 }]);
  const gnome = unitOf(battle, 'a0');
  act(battle, call('cheer', 'a0'));
  assert.equal(stat(gnome, 'oomph'), gnome.oomph * (1 + CALLS.cheer.boost.by));
  act(battle, move('rodwhack', 'f0'));
  assert.equal(stat(gnome, 'oomph'), gnome.oomph, 'spent with the move');
});

test('Patch up mends a fifth, only someone hurt, and only every other round', () => {
  const battle = fight(2, [{ species: 'gnome', level: 5, hp: 10 }, { species: 'toastghost', level: 5 }], [{ species: 'snailor', level: 1 }]);
  const gnome = unitOf(battle, 'a0');
  assert.equal(act(battle, call('patch', 'a1')), false, 'the Toast Ghost is not hurt');
  const before = gnome.hp;
  assert.equal(act(battle, call('patch', 'a0')), true);
  assert.equal(gnome.hp, before + Math.round(gnome.maxHp * CALLS.patch.mend));
  endRound(battle);
  assert.equal(choices(battle).calls.find((c) => c.id === 'patch').ready, false, 'resting this round');
  assert.equal(act(battle, call('patch', 'a0')), false);
  assert.equal(act(battle, call('cheer', 'a0')), true, 'another Call is fine');
  endRound(battle);
  assert.equal(act(battle, call('patch', 'a0')), true);
});

test('a boss is too proud to reach', () => {
  const battle = fight(3, SITTERS, [{ species: 'boss_hydra', level: 1 }, { species: 'dandepuff', level: 1 }]);
  assert.equal(unitOf(battle, 'f0').maxHuff, 0);
  assert.deepEqual(choices(battle).calls.find((c) => c.id === 'reach').targets, ['f1']);
  assert.equal(act(battle, reach('f0')), false);
});

test('calming the last one standing wins the fight', () => {
  const battle = fight(3, SITTERS, [{ species: 'ratscal', level: 1 }]);
  for (let guard = 0; guard < 5 && battle.phase === 'fight'; guard++) { act(battle, reach('f0')); endRound(battle); }
  assert.equal(battle.phase, 'won');
  assert.equal(unitOf(battle, 'f0').settled, true);
  assert.ok(unitOf(battle, 'f0').hp > 0);
});

// ---------------------------------------------------------------- coming home

/** A fight from a fresh save in which the given foes have been calmed (or not) and the fight ended as `phase`. */
function ended(foes, phase, settled = []) {
  const state = newState(1e12, 5);
  const battle = createBattle(state, {
    allies: state.team.map((id) => { const f = state.friends.find((x) => x.id === id); return { species: f.species, level: f.level, friendId: f.id }; }),
    foes, fx: false,
  });
  for (const key of settled) unitOf(battle, key).settled = true;
  for (const unit of battle.units) if (unit.side === 'foe' && !unit.settled) unit.hp = phase === 'won' ? 0 : unit.hp;
  battle.phase = phase;
  return { state, battle };
}

test('a calmed Clutterkin comes home from a fight that was won, at the level it was met', () => {
  const { state, battle } = ended([{ species: 'gnome', level: 4 }, { species: 'ratscal', level: 2 }], 'won', ['f0']);
  const summary = settleUp(state, battle);
  assert.deepEqual(summary.joined.map((j) => [j.species, j.level, j.heirloom]), [['gnome', 4, false]]);
  const gnome = state.friends.find((f) => f.species === 'gnome');
  assert.deepEqual(gnome, { id: 4, species: 'gnome', level: 4, xp: 0, heirloom: false });
  assert.equal(state.nextFriendId, 5);
  assert.equal(state.stats.befriended, 1);
  assert.ok(!state.team.includes(gnome.id), 'it waits at home until it is picked');
  assert.ok(!state.friends.some((f) => f.species === 'ratscal'), 'the one knocked down does not');
});

test('a calmed Clutterkin slips away if the fight is lost', () => {
  const { state, battle } = ended([{ species: 'gnome', level: 4 }, { species: 'ratscal', level: 2 }], 'lost', ['f0']);
  const summary = settleUp(state, battle);
  assert.deepEqual(summary.joined, []);
  assert.equal(state.friends.length, 3);
  assert.equal(summary.xp, 0, 'and nothing is learned from the one that was calmed');
});

test('there is one friend of each kind: a second sends it off happy and your friend learns from the visit', () => {
  const { state, battle } = ended([{ species: 'sockeel', level: 5 }, { species: 'gnome', level: 2 }, { species: 'gnome', level: 3 }], 'won', ['f0', 'f1', 'f2']);
  const eel = state.friends.find((f) => f.species === 'sockeel');
  const summary = settleUp(state, battle);
  assert.deepEqual(summary.joined.map((j) => j.species), ['gnome'], 'the first Gnome joins, the second visits');
  assert.deepEqual(summary.visited, ['sockeel', 'gnome']);
  assert.equal(state.friends.filter((f) => f.species === 'gnome').length, 1);
  assert.equal(state.friends.filter((f) => f.species === 'sockeel').length, 1);
  const fightXp = xpFor('sockeel', 5) + xpFor('gnome', 2) + xpFor('gnome', 3);
  const paid = eel.xp + [3, 4, 5, 6, 7].slice(0, eel.level - 3).reduce((sum, level) => sum + Math.round(24 * Math.pow(level, 1.5)), 0);
  assert.equal(paid, fightXp + xpFor('sockeel', 5), 'the fight, plus the visit');
});

test('a boss never comes home, whatever a fight claims', () => {
  const { state, battle } = ended([{ species: 'boss_hydra', level: 5 }], 'won', ['f0']);
  assert.deepEqual(settleUp(state, battle).joined, []);
  assert.equal(state.friends.length, 3);
});
