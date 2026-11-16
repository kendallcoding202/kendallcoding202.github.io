// Walking into a fight: the cloud of dust that covers the screen while the
// fight is set out. Nothing here can look at it, but it can make sure that at
// the moment the screens are swapped there is no gap to see through, on any
// size of screen and from wherever it started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHIFT, puffsFor, puffAt } from '../../web/js/ui/shift.js';

const SCREENS = [[320, 568], [375, 667], [393, 852], [430, 932], [466, 678], [669, 951], [1024, 768]];
const covered = (puffs, x, y, t, hold) => puffs.some((puff) => Math.hypot(x - puff.x, y - puff.y) <= puff.r * puffAt(puff, t, hold).size);

test('at full size the puffs leave no gap anywhere on the screen, whatever its size and wherever they billow from', () => {
  for (const [w, h] of SCREENS) {
    for (const from of [{ x: w / 2, y: h / 2 }, { x: 0, y: 0 }, { x: w, y: h * 0.3 }, { x: w * 0.2, y: h }]) {
      const puffs = puffsFor(w, h, from);
      assert.ok(puffs.length >= 20 && puffs.length <= 90, `${w}x${h}: ${puffs.length} puffs`);
      for (const moment of [SHIFT.in, SHIFT.in + SHIFT.hold - 1]) {
        for (let y = 0; y <= h; y += 6) for (let x = 0; x <= w; x += 6) assert.ok(covered(puffs, x, y, moment, SHIFT.hold), `${w}x${h} from ${from.x},${from.y}: a gap at ${x},${y}`);
      }
    }
  }
});

test('it billows out from where you met them, and clears from the middle', () => {
  const [w, h] = [393, 852];
  const from = { x: 300, y: 250 };
  const puffs = puffsFor(w, h, from);
  const near = puffs.reduce((a, b) => (a.d < b.d ? a : b));
  const far = puffs.reduce((a, b) => (a.d > b.d ? a : b));
  assert.equal(puffAt(far, 0).size, 0, 'nothing at first');
  assert.ok(puffAt(near, SHIFT.in * 0.3).size > 0.5 && puffAt(far, SHIFT.in * 0.3).size === 0, 'the nearest puff is up before the furthest has begun');
  for (const puff of puffs) {
    assert.ok(Math.abs(puffAt(puff, SHIFT.in).size - 1) < 1e-9 && puffAt(puff, SHIFT.in).drift === 0, 'all full size when the screens are swapped');
    assert.ok(puffAt(puff, SHIFT.in + SHIFT.hold + SHIFT.out).size < 1e-9, 'all gone at the end');
    // Never much past full size, never less than nothing.
    for (let t = 0; t <= SHIFT.in + SHIFT.hold + SHIFT.out; t += 10) { const { size } = puffAt(puff, t); assert.ok(size >= 0 && size <= 1.2, `size ${size} at ${t}`); }
  }
  const middle = puffs.reduce((a, b) => (a.c < b.c ? a : b));
  const edge = puffs.reduce((a, b) => (a.c > b.c ? a : b));
  const clearing = SHIFT.in + SHIFT.hold + SHIFT.out * 0.45;
  assert.ok(puffAt(middle, clearing).size < 0.4 && puffAt(edge, clearing).size === 1, 'the middle thins while the edge is still whole');
  // The same cloud every time.
  assert.deepEqual(puffsFor(w, h, from), puffs);
});

test('it is over quickly, a ringleader holds it a little longer, and anyone who has asked for less movement gets a plain fade', () => {
  assert.ok(SHIFT.in >= 300 && SHIFT.in <= 600 && SHIFT.out >= 300 && SHIFT.out <= 600);
  assert.ok(SHIFT.bossHold > SHIFT.hold && SHIFT.in + SHIFT.bossHold + SHIFT.out <= 1400, 'never more than a second and a half');
  const source = readFileSync(new URL('../../web/js/ui/shift.js', import.meta.url), 'utf8');
  assert.ok(source.includes('prefers-reduced-motion: reduce'));
  // Should frames stop coming, the fight still starts and the cloud still goes.
  assert.match(source, /setTimeout\(swap, SHIFT\.in \+ \d+\)/);
  assert.match(source, /setTimeout\(end, total \+ \d+\)/);
  // Fights played fast (and the tests) skip it.
  const lane = readFileSync(new URL('../../web/js/ui/lane.js', import.meta.url), 'utf8');
  assert.match(lane, /if \(ctx\.fast\) setTimeout\(begin, 60\);/);
});
