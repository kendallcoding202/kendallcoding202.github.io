// The seeded random generator: every roll in the game comes from here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRandom, rollInt, rollPick, clamp, own } from '../../web/js/core/util.js';

test('the same seed gives the same rolls, and the seed is the whole state', () => {
  const a = { rng: 42 };
  const b = { rng: 42 };
  const first = Array.from({ length: 50 }, () => nextRandom(a));
  assert.deepEqual(Array.from({ length: 50 }, () => nextRandom(b)), first);
  const resumed = { rng: a.rng }; // as if saved and loaded here
  assert.equal(nextRandom(resumed), nextRandom(a));
  assert.ok(Number.isInteger(a.rng));
});

test('rolls are spread evenly between 0 and 1', () => {
  const dice = { rng: 7 };
  const rolls = Array.from({ length: 20000 }, () => nextRandom(dice));
  assert.ok(rolls.every((r) => r >= 0 && r < 1));
  const mean = rolls.reduce((x, y) => x + y, 0) / rolls.length;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  for (let bucket = 0; bucket < 10; bucket++) {
    const share = rolls.filter((r) => Math.floor(r * 10) === bucket).length / rolls.length;
    assert.ok(Math.abs(share - 0.1) < 0.012, `bucket ${bucket}: ${share}`);
  }
});

test('whole-number rolls include both ends and nothing outside', () => {
  const dice = { rng: 3 };
  const seen = new Set(Array.from({ length: 500 }, () => rollInt(dice, 2, 5)));
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
  assert.equal(rollInt(dice, 4, 4), 4);
});

test('weighted picks follow the weights, and a zero weight is never picked', () => {
  const dice = { rng: 11 };
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 6000; i++) counts[rollPick(dice, ['a', 'b', 'c'], (x) => ({ a: 3, b: 1, c: 0 })[x])]++;
  assert.equal(counts.c, 0);
  assert.ok(Math.abs(counts.a / 6000 - 0.75) < 0.03);
  assert.ok(['x', 'y'].includes(rollPick(dice, ['x', 'y'], () => 0)), 'all-zero weights still pick something');
});

test('small helpers', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(own({ a: 1 }, 'a'), true);
  assert.equal(own({}, 'constructor'), false);
  assert.equal(own({ 1: 1 }, 1), false, 'only text keys');
});
