// The fight: turn order, damage, waits, boosts and saps, and how it ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, choices, act, concede, chooser, unitOf, stat, damageOf, makeFighter, standing, alliesOf, foesOf } from '../../web/js/core/battle.js';
import { playOut, suggest } from '../../web/js/core/auto.js';
import { MOVES, BRACE, STRONG, WEAK, WOBBLE, MAX_ROUNDS, SPECIES, statAt } from '../../web/js/core/balance.js';

const TRIO = [{ species: 'dustbunny', level: 3 }, { species: 'sockeel', level: 3 }, { species: 'toastghost', level: 3 }];
const fight = (seed, allies, foes, fx = true) => createBattle({ rng: seed }, { allies, foes, fx });
const move = (id, target) => ({ type: 'move', id, target });
/** Everyone braces until it is `key`'s turn. */
function waitFor(battle, key) {
  for (let guard = 0; guard < 50 && chooser(battle) && chooser(battle).key !== key; guard++) act(battle, move('brace'));
  assert.equal(chooser(battle)?.key, key);
}
const snapshot = (battle) => JSON.stringify({ ...battle, events: null });

test('the same seed and the same choices give the same fight, blow for blow', () => {
  const foes = [{ species: 'gnome', level: 3 }, { species: 'grumblebee', level: 3 }, { species: 'snailor', level: 3 }];
  const a = playOut(fight(99, TRIO, foes), {});
  const b = playOut(fight(99, TRIO, foes), {});
  assert.ok(a.events.length > 20);
  assert.deepEqual(a.events, b.events);
  const c = playOut(fight(100, TRIO, foes), {});
  assert.notDeepEqual(c.events, a.events, 'a different seed is a different fight');
});

test('everyone standing acts once a round, fastest first', () => {
  const battle = fight(1, TRIO, [{ species: 'grumblebee', level: 3 }, { species: 'snailor', level: 3 }]);
  const round = battle.events.find((e) => e.t === 'round');
  assert.equal(round.n, 1);
  assert.equal(round.order.length, 5);
  const peps = round.order.map((key) => stat(unitOf(battle, key), 'pep'));
  for (let i = 1; i < peps.length; i++) assert.ok(peps[i] <= peps[i - 1], `order by Pep: ${peps.join(' ')}`);
  assert.equal(round.order[0], 'f0', 'the Grumblebee is quickest');
  assert.equal(round.order[4], 'f1', 'the Snailor is last');
});

test('equal Pep is settled by the dice, not by which side you are on', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const battle = fight(seed, [{ species: 'gnome', level: 2 }], [{ species: 'gnome', level: 2 }]);
    firsts.add(battle.events.find((e) => e.t === 'round').order[0]);
  }
  assert.deepEqual([...firsts].sort(), ['a0', 'f0']);
});

test('a boss acts twice a round, its second turn after everyone else', () => {
  const battle = fight(5, TRIO, [{ species: 'boss_hydra', level: 5 }], true);
  const order = battle.events.find((e) => e.t === 'round').order;
  assert.equal(order.filter((key) => key === 'f0').length, 2);
  assert.equal(order[order.length - 1], 'f0');
});

test('damage is power x Oomph x (Oomph / Grit), within sensible bounds, and never less than 1', () => {
  const bunny = makeFighter('ally', 0, { species: 'dustbunny', level: 3 });
  const gnome = makeFighter('foe', 0, { species: 'gnome', level: 3 });
  const plain = MOVES.lintflurry; // fluff into clank: even
  const expected = plain.power * bunny.oomph * (bunny.oomph / gnome.grit);
  assert.equal(damageOf(bunny, gnome, plain, 0.5), Math.round(expected));
  assert.equal(damageOf(bunny, gnome, plain, 0), Math.round(expected * (1 - WOBBLE)));
  assert.equal(damageOf(bunny, gnome, plain, 1), Math.round(expected * (1 + WOBBLE)));
  assert.ok(damageOf(bunny, gnome, MOVES.underbed) > damageOf(bunny, gnome, plain), 'more power, more damage');
  // However lopsided, the ratio only counts between 0.4 and 2.5.
  const mouse = { ...bunny, oomph: 1, mods: [] };
  const wall = { ...gnome, grit: 9999, mods: [] };
  assert.equal(damageOf(mouse, wall, plain), 1);
  const giant = { ...bunny, oomph: 100, mods: [] };
  const paper = { ...gnome, grit: 1, mods: [] };
  assert.equal(damageOf(giant, paper, plain), Math.round(plain.power * 100 * 2.5));
});

test('the element of the move counts, not the element of whoever uses it', () => {
  const bunny = makeFighter('ally', 0, { species: 'dustbunny', level: 3 });
  const even = makeFighter('foe', 0, { species: 'gnome', level: 3 });
  const base = (target, m) => m.power * bunny.oomph * (bunny.oomph / target.grit);
  const suds = makeFighter('foe', 1, { species: 'snailor', level: 3 }); // fluff mops up suds
  const spark = makeFighter('foe', 2, { species: 'sparkplug', level: 3 }); // spark singes fluff
  assert.equal(damageOf(bunny, suds, MOVES.lintflurry), Math.round(base(suds, MOVES.lintflurry) * STRONG));
  assert.equal(damageOf(bunny, spark, MOVES.lintflurry), Math.round(base(spark, MOVES.lintflurry) * WEAK));
  assert.equal(damageOf(bunny, even, MOVES.lintflurry), Math.round(base(even, MOVES.lintflurry)));
  // A fluff creature using a (hypothetical) suds move is judged as suds.
  assert.equal(damageOf(bunny, suds, { ...MOVES.lintflurry, element: 'suds' }), Math.round(base(suds, MOVES.lintflurry)));
});

test('a hit takes exactly its damage off, says so, and reports the edge', () => {
  const battle = fight(3, [{ species: 'dustbunny', level: 5 }], [{ species: 'snailor', level: 2 }]);
  const before = unitOf(battle, 'f0').hp;
  battle.events.length = 0;
  assert.equal(act(battle, move('lintflurry', 'f0')), true);
  const hit = battle.events.find((e) => e.t === 'hit' && e.who === 'a0');
  assert.equal(hit.edge, 1);
  assert.equal(hit.target, 'f0');
  assert.equal(before - hit.dmg, hit.hp);
});

test('a strong move has to wait its turns before it can be used again', () => {
  const battle = fight(8, [{ species: 'dustbunny', level: 3 }], [{ species: 'snailor', level: 9 }]);
  const ready = () => choices(battle).moves.find((m) => m.id === 'underbed');
  assert.equal(MOVES.underbed.wait, 2);
  assert.equal(ready().ready, true);
  assert.equal(act(battle, move('underbed', 'f0')), true);
  assert.deepEqual([ready().ready, ready().wait], [false, 2]);
  assert.equal(act(battle, move('underbed', 'f0')), false, 'not while it is waiting');
  act(battle, move('lintflurry', 'f0'));
  assert.deepEqual([ready().ready, ready().wait], [false, 1]);
  act(battle, move('lintflurry', 'f0'));
  assert.equal(ready().ready, true, 'two turns later it is back');
});

test('Brace takes a third off until its next turn, and anyone can do it', () => {
  const battle = fight(4, [{ species: 'toastghost', level: 3 }], [{ species: 'gnome', level: 3 }]);
  const ghost = unitOf(battle, 'a0');
  assert.ok(choices(battle).moves.some((m) => m.id === 'brace' && m.ready));
  const plain = damageOf(unitOf(battle, 'f0'), ghost, MOVES.rodwhack);
  act(battle, move('brace'));
  assert.equal(stat(ghost, 'grit'), ghost.grit * (1 + BRACE.boost.by), 'still braced when its turn comes round');
  const braced = damageOf(unitOf(battle, 'f0'), ghost, MOVES.rodwhack);
  assert.ok(Math.abs(braced / plain - 1 / 1.5) < 0.06, `${braced} against ${plain}`);
  act(battle, move('crumbtoss', 'f0'));
  assert.equal(stat(ghost, 'grit'), ghost.grit, 'and gone after it');
});

test('a boost on itself covers the stated number of rounds, then wears off', () => {
  const battle = fight(6, [{ species: 'thornhog', level: 3 }], [{ species: 'snailor', level: 1 }]);
  const hog = unitOf(battle, 'a0');
  const up = hog.grit * (1 + MOVES.bristleup.boost.by);
  act(battle, move('bristleup', 'a0'));
  for (let turn = 1; turn <= MOVES.bristleup.boost.turns; turn++) {
    assert.equal(stat(hog, 'grit'), up, `boosted while waiting for turn ${turn}`);
    act(battle, move('brambleshove', 'f0'));
  }
  assert.equal(stat(hog, 'grit'), hog.grit);
});

test('boosts to one stat do not stack: the bigger one counts, and the smaller is still there after it', () => {
  const battle = fight(6, [{ species: 'thornhog', level: 3 }], [{ species: 'snailor', level: 1 }]);
  const hog = unitOf(battle, 'a0');
  act(battle, move('bristleup', 'a0'));
  act(battle, move('brace'));
  assert.equal(stat(hog, 'grit'), hog.grit * (1 + BRACE.boost.by), 'braced: the bigger boost');
  act(battle, move('brambleshove', 'f0'));
  assert.equal(stat(hog, 'grit'), hog.grit * (1 + MOVES.bristleup.boost.by), 'the brace has gone; Bristle Up has a turn left');
});

test('a sap lowers the stat for the stated number of the victim\'s turns; the same one again does not stack', () => {
  const battle = fight(2, [{ species: 'gnome', level: 6 }, { species: 'gnome', level: 6 }], [{ species: 'snailor', level: 6 }]);
  const snail = unitOf(battle, 'f0');
  const { by, turns } = MOVES.hookandyank.sap;
  act(battle, move('hookandyank', 'f0'));
  assert.equal(stat(snail, 'pep'), snail.pep * (1 - by));
  act(battle, move('hookandyank', 'f0')); // the other gnome, same round
  assert.equal(stat(snail, 'pep'), snail.pep * (1 - by), 'renewed, not doubled');
  assert.equal(snail.mods.filter((mod) => mod.stat === 'pep').length, 1);
  for (let i = 0; i < turns; i++) { act(battle, move('brace')); act(battle, move('brace')); }
  assert.equal(stat(snail, 'pep'), snail.pep, `gone after ${turns} of its turns`);
});

test('a mend heals a share of full Health and never past full', () => {
  const battle = fight(7, [{ species: 'toastghost', level: 3, hp: 20 }, { species: 'sockeel', level: 3 }], [{ species: 'snailor', level: 1 }]);
  const mended = () => battle.events.filter((e) => e.t === 'mend').pop();
  waitFor(battle, 'a0');
  const ghost = unitOf(battle, 'a0');
  const hurt = ghost.hp;
  act(battle, move('butterup', 'a0'));
  assert.equal(mended().amount, Math.round(ghost.maxHp * MOVES.butterup.mend));
  assert.equal(mended().hp, hurt + mended().amount);
  const eel = unitOf(battle, 'a1');
  waitFor(battle, 'a0');
  ghost.moves.forEach((slot) => { slot.wait = 0; });
  eel.hp = eel.maxHp - 1;
  act(battle, move('butterup', 'a1'));
  assert.deepEqual([mended().target, mended().amount, mended().hp], ['a1', 1, eel.maxHp]);
});

test('whoever is down takes no more turns and cannot be aimed at or mended', () => {
  const battle = fight(9, [{ species: 'toastghost', level: 3 }, { species: 'sockeel', level: 3, hp: 0 }], [{ species: 'dandepuff', level: 1 }, { species: 'dandepuff', level: 1, hp: 0 }]);
  assert.equal(standing(unitOf(battle, 'a1')), false);
  const order = battle.events.find((e) => e.t === 'round').order;
  assert.ok(!order.includes('a1'));
  waitFor(battle, 'a0');
  const options = choices(battle);
  assert.deepEqual(options.moves.find((m) => m.id === 'crumbtoss').targets, ['f0']);
  assert.deepEqual(options.moves.find((m) => m.id === 'butterup').targets, ['a0']);
  assert.equal(act(battle, move('butterup', 'a1')), false);
  assert.equal(act(battle, move('crumbtoss', 'f1')), false);
});

test('the fight is won when no restless Oddment is standing, and lost when no friend is', () => {
  const won = fight(1, [{ species: 'dustbunny', level: 20 }], [{ species: 'dandepuff', level: 1 }]);
  act(won, move('lintflurry', 'f0'));
  assert.equal(won.phase, 'won');
  assert.equal(chooser(won), null);
  assert.equal(choices(won), null);
  assert.deepEqual(won.events[won.events.length - 1], { t: 'end', won: true, why: 'cleared' });
  assert.equal(act(won, move('lintflurry', 'f0')), false, 'nothing more happens');

  const lost = fight(1, [{ species: 'dandepuff', level: 1 }], [{ species: 'grumblebee', level: 20 }]);
  assert.equal(lost.phase, 'lost', 'knocked out before getting a turn');
  assert.equal(lost.tally.downs, 1);
  assert.equal(foesOf(lost).length, 1);
  assert.equal(alliesOf(lost).length, 0);
});

test('a choice that is not allowed is refused and changes nothing', () => {
  const battle = fight(12, TRIO, [{ species: 'gnome', level: 3 }, { species: 'snailor', level: 3 }]);
  const before = snapshot(battle);
  const current = chooser(battle).key;
  const bad = [
    null, undefined, 'lintflurry', 7, {}, { type: 'move' }, { type: 'move', id: 'nope', target: 'f0' },
    { type: 'move', id: 'constructor', target: 'f0' }, { type: 'move', id: '__proto__', target: 'f0' },
    { type: 'move', id: 'kickupdust' }, // not learned yet at level 3
    { type: 'move', id: current === 'a0' ? 'wringout' : 'lintflurry', target: 'f0' }, // somebody else's move
    { type: 'move', id: chooser(battle).moves[0].id, target: 'a0' }, // a hit aimed at a friend
    { type: 'move', id: chooser(battle).moves[0].id, target: 'f2' }, // nobody there
    { type: 'move', id: chooser(battle).moves[0].id }, // no target
    { type: 'call', id: 'nope', target: 'f0' }, { type: 'call', id: 'reach', target: 'a0' }, { type: 'call', id: 'cheer', target: 'f0' },
    { type: 'call', id: 'patch', target: 'a0' }, // nobody is hurt
    { type: 'dance' },
  ];
  for (const action of bad) {
    assert.equal(act(battle, action), false, JSON.stringify(action));
    assert.equal(snapshot(battle), before, `changed by ${JSON.stringify(action)}`);
  }
});

test('a fight that will not end is called off as a loss', () => {
  const battle = fight(1, [{ species: 'snailor', level: 40 }], [{ species: 'dandepuff', level: 1 }], false);
  let turns = 0;
  while (battle.phase === 'fight' && turns < 500) { act(battle, move('brace')); turns++; }
  assert.equal(battle.phase, 'lost');
  assert.equal(battle.round, MAX_ROUNDS);
  assert.equal(turns, MAX_ROUNDS);
});

test('walking away loses the fight', () => {
  const battle = fight(1, TRIO, [{ species: 'gnome', level: 3 }]);
  assert.equal(concede(battle), true);
  assert.equal(battle.phase, 'lost');
  assert.equal(battle.events[battle.events.length - 1].why, 'conceded');
  assert.equal(concede(battle), false);
});

test('a fighter is built from its kind and level, and health carried in is kept within bounds', () => {
  const eel = makeFighter('ally', 1, { species: 'sockeel', level: 4, hp: 9999, friendId: 2 });
  assert.equal(eel.key, 'a1');
  assert.equal(eel.maxHp, statAt(SPECIES.sockeel.hp, 4));
  assert.equal(eel.hp, eel.maxHp);
  assert.equal(makeFighter('ally', 0, { species: 'sockeel', level: 4, hp: -5 }).hp, 0);
  assert.equal(eel.huff, 0, 'a friend is not in a huff');
  assert.deepEqual(eel.moves.map((slot) => slot.id), ['wringout', 'oddsocksnap']);
  assert.equal(makeFighter('foe', 2, { species: 'sockeel', level: 1 }).key, 'f2');
});

test('at most three a side take the field', () => {
  const many = Array.from({ length: 5 }, () => ({ species: 'dandepuff', level: 1 }));
  const battle = fight(1, many, many);
  assert.equal(battle.units.length, 6);
});

test('the stand-in player always offers something allowed, whatever its style', () => {
  for (const style of [{}, { careless: true }, { befriend: true }]) {
    for (let seed = 1; seed <= 25; seed++) {
      const battle = fight(seed, TRIO, [{ species: 'gnome', level: 3 }, { species: 'thornhog', level: 3 }, { species: 'sparkplug', level: 3 }], false);
      for (let guard = 0; guard < 600 && battle.phase === 'fight'; guard++) assert.equal(act(battle, suggest(battle, style)), true);
      assert.notEqual(battle.phase, 'fight');
    }
  }
});
