// Experience and levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gainXp, newFriend, settleUp } from '../../web/js/core/progress.js';
import { createBattle, unitOf, makeFighter } from '../../web/js/core/battle.js';
import { newState } from '../../web/js/core/state.js';
import { xpNeeded, xpFor, MAX_LEVEL, BENCH_SHARE, LONE_SHARE, SPECIES, GROWTH } from '../../web/js/core/balance.js';

test('each level needs more experience than the one before', () => {
  for (let level = 1; level < MAX_LEVEL; level++) {
    assert.ok(Number.isInteger(xpNeeded(level)) && xpNeeded(level) > 0);
    assert.ok(xpNeeded(level + 1) > xpNeeded(level));
  }
});

test('a tougher Clutterkin is worth more, and a boss four times as much', () => {
  assert.ok(xpFor('gnome', 4) > xpFor('gnome', 3));
  assert.equal(xpFor('boss_hydra', 5), 4 * xpFor('gnome', 5));
});

test('experience fills the bar, carries the remainder over a level, and can cross several at once', () => {
  const friend = newFriend(1, 'dustbunny', 1);
  assert.deepEqual(gainXp(friend, xpNeeded(1) - 1), { levels: 0, learned: [], grew: false });
  assert.deepEqual([friend.level, friend.xp], [1, xpNeeded(1) - 1]);
  assert.deepEqual(gainXp(friend, 5), { levels: 1, learned: [], grew: false });
  assert.deepEqual([friend.level, friend.xp], [2, 4]);
  const jump = xpNeeded(2) + xpNeeded(3) + xpNeeded(4) + xpNeeded(5);
  const gained = gainXp(friend, jump);
  assert.equal(gained.levels, 4);
  assert.deepEqual([friend.level, friend.xp], [6, 4]);
  assert.deepEqual(gained.learned, ['underbed', 'kickupdust'], 'the moves learned on the way, in order');
});

test('nothing, a negative amount or nonsense teaches nothing', () => {
  const friend = newFriend(1, 'sockeel', 3);
  for (const amount of [0, -50, NaN, undefined, 'lots']) assert.deepEqual(gainXp(friend, amount), { levels: 0, learned: [], grew: false });
  assert.deepEqual([friend.level, friend.xp], [3, 0]);
});

test('levels stop at the cap and experience stops with them', () => {
  const friend = newFriend(1, 'sockeel', MAX_LEVEL - 1);
  assert.equal(gainXp(friend, 1e9).levels, 1);
  assert.deepEqual([friend.level, friend.xp], [MAX_LEVEL, 0]);
  assert.deepEqual(gainXp(friend, 1e9), { levels: 0, learned: [], grew: false });
  assert.equal(friend.xp, 0);
});

test('a level makes an Clutterkin a tenth of its base stronger in every stat', () => {
  const at = (level) => makeFighter('ally', 0, { species: 'sockeel', level });
  const base = SPECIES.sockeel;
  for (const level of [1, 2, 5, 11, MAX_LEVEL]) {
    const eel = at(level);
    const scale = 1 + GROWTH * (level - 1);
    assert.deepEqual([eel.maxHp, eel.oomph, eel.grit, eel.pep], [base.hp, base.oomph, base.grit, base.pep].map((v) => Math.round(v * scale)));
  }
});

/** A fresh save with one more friend at home, and a fight against `foes` with the first `down` of them knocked down. */
function fought(foes, down, phase) {
  const state = newState(1e12, 9);
  state.friends.push(newFriend(state.nextFriendId++, 'gnome', 2));
  const battle = createBattle(state, { allies: state.team.map((id, i) => ({ species: state.friends[i].species, level: 3, friendId: id })), foes, fx: false });
  for (let i = 0; i < down; i++) unitOf(battle, `f${i}`).hp = 0;
  battle.phase = phase;
  return { state, battle };
}

test('a win pays the team in full and friends at home a share', () => {
  const foes = [{ species: 'thornhog', level: 3 }, { species: 'grumblebee', level: 2 }];
  const { state, battle } = fought(foes, 2, 'won');
  const summary = settleUp(state, battle);
  const total = xpFor('thornhog', 3) + xpFor('grumblebee', 2);
  assert.equal(summary.xp, total);
  for (const friend of state.friends.slice(0, 3)) assert.equal(friend.xp, total, `${friend.species} was on the team`);
  assert.equal(state.friends[3].xp, Math.floor(total * BENCH_SHARE), 'the Gnome stayed at home');
  assert.equal(summary.gains.filter((g) => g.team).length, 3);
  assert.deepEqual([state.stats.battles, state.stats.wins, state.stats.losses], [1, 1, 0]);
});

test('a fight teaches by its size: two teach twice what one does, three three times, and one met alone only a share of its worth', () => {
  const one = (level) => ({ species: 'grumblebee', level });
  const taught = (foes) => { const { state, battle } = fought(foes, foes.length, 'won'); return settleUp(state, battle); };
  const worth = xpFor('grumblebee', 3);
  const [alone, pair, three] = [taught([one(3)]), taught([one(3), one(3)]), taught([one(3), one(3), one(3)])];
  assert.deepEqual([pair.xp, three.xp], [2 * worth, 3 * worth]);
  assert.deepEqual([alone.lone, pair.lone, three.lone], [true, false, false]);
  assert.equal(alone.xp, Math.round(worth * LONE_SHARE));
  assert.ok(LONE_SHARE > 0.4 && LONE_SHARE < 1, 'less than its worth, but worth meeting');
  assert.ok(alone.xp * 3 < pair.xp, 'one on its own is worth less than a third of a pair');
  // The share is of the whole fight, and the friends at home get their share of that.
  const { state, battle } = fought([one(3)], 1, 'won');
  settleUp(state, battle);
  assert.equal(state.friends[0].xp, alone.xp);
  assert.equal(state.friends[3].xp, Math.floor(alone.xp * BENCH_SHARE));
  // A ringleader is never short-changed, even if one were ever met alone.
  const boss = taught([{ species: 'boss_hydra', level: 5 }]);
  assert.deepEqual([boss.lone, boss.xp], [false, xpFor('boss_hydra', 5)]);
  // And however strong the one, a pair of the same is always the better lesson.
  for (let level = 1; level <= MAX_LEVEL; level++) assert.ok(Math.round(xpFor('grumblebee', level) * LONE_SHARE) < xpFor('grumblebee', level));
});

test('a loss still pays for whoever was knocked down first: nothing is ever a dead end', () => {
  const foes = [{ species: 'thornhog', level: 3 }, { species: 'grumblebee', level: 2 }];
  const { state, battle } = fought(foes, 1, 'lost');
  const summary = settleUp(state, battle);
  assert.equal(summary.won, false);
  assert.equal(summary.xp, xpFor('thornhog', 3));
  assert.equal(state.friends[0].xp, xpFor('thornhog', 3));
  assert.deepEqual([state.stats.wins, state.stats.losses], [0, 1]);
});

test('the summary says who went up a level and what they learned', () => {
  const { state, battle } = fought([{ species: 'boss_hydra', level: 30 }], 1, 'won');
  const summary = settleUp(state, battle);
  const bunny = summary.gains.find((g) => g.species === 'dustbunny');
  assert.equal(bunny.from, 3);
  assert.ok(bunny.to >= 6);
  assert.deepEqual(bunny.learned, ['kickupdust']);
  assert.equal(state.friends[0].level, bunny.to);
});
