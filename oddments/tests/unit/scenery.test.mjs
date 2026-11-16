// The painted world. Nothing here can look at a picture, but it can make sure
// every painter runs from start to finish on a stand-in canvas, that every
// place has a building of its own rather than a copy, and that the painting
// asks the canvas for nothing an iPhone on iOS 15 does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAINTED, paintLaneGround, paintInsideGround, paintBuilding, paintLife, paintTree, paintLamp, paintHedge, paintBush, paintGate, label, mix,
} from '../../web/js/ui/scenery.js';
import { WORLD, SPOTS, SPOT_IDS, LAMPS, AREAS } from '../../web/js/core/world.js';
import { ROOMS, roomOf } from '../../web/js/core/balance.js';

// What a 2D canvas on iOS 15 can do. A painter that reaches for anything else fails here.
const CAN = new Set([
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect',
  'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'measureText', 'drawImage',
  'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'setLineDash', 'createLinearGradient', 'createRadialGradient',
]);
const SET = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation']);

/** A stand-in for a canvas's 2D context that writes down everything asked of it. */
function standIn() {
  const calls = [];
  const pen = new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (SET.has(name)) return '';
      assert.ok(CAN.has(name), `the canvas on iOS 15 has no ${String(name)}`);
      return (...args) => {
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(name)} was given ${arg}`);
        calls.push(name);
        if (name === 'measureText') return { width: 80 };
        if (name.startsWith('create')) return { addColorStop() {} };
        return undefined;
      };
    },
    set(_, name) {
      assert.ok(SET.has(name), `the canvas on iOS 15 has no ${String(name)}`);
      return true;
    },
  });
  return pen;
}
const count = (pen, name) => pen.calls.filter((call) => call === name).length;
const ROUTE = [{ x: WORLD.w / 2, y: WORLD.h + 60 }, ...SPOTS.map((spot) => spot.door)];

test('home and every place has a building of its own', () => {
  assert.deepEqual([...PAINTED].sort(), [...SPOT_IDS].sort());
});

test('every building paints from start to finish, lit and shut, and no two are the same building', () => {
  const shapes = new Map();
  for (const spot of SPOTS) {
    const room = roomOf(spot.id);
    for (const open of [true, false]) {
      const pen = standIn();
      assert.doesNotThrow(() => paintBuilding(pen, spot, { name: room ? room.name : 'Home', tint: room ? room.tint : '#e8a23d', open, cleared: !open, art: null }), `${spot.id} ${open ? 'lit' : 'shut'}`);
      assert.ok(count(pen, 'fill') >= 8 && count(pen, 'stroke') >= 6, `${spot.id} is more than a box`);
      assert.equal(count(pen, 'save'), count(pen, 'restore'), `${spot.id} leaves the canvas as it found it`);
      if (open) shapes.set(spot.id, pen.calls.join(' '));
    }
    const life = standIn();
    assert.doesNotThrow(() => paintLife(life, spot, 12.5));
  }
  assert.equal(new Set(shapes.values()).size, SPOTS.length, 'nine different buildings');
});

test('a room\'s painting can be shown through a window once it has arrived, and is not needed before', () => {
  const image = { complete: true, naturalWidth: 1152, naturalHeight: 768 };
  for (const id of ['garden', 'wash']) {
    const withArt = standIn();
    const without = standIn();
    paintBuilding(withArt, SPOTS.find((s) => s.id === id), { name: 'x', tint: roomOf(id).tint, open: true, art: image });
    paintBuilding(without, SPOTS.find((s) => s.id === id), { name: 'x', tint: roomOf(id).tint, open: true, art: { complete: false, naturalWidth: 0 } });
    assert.equal(count(withArt, 'drawImage'), 1, `${id} shows its room`);
    assert.equal(count(without, 'drawImage'), 0);
  }
});

test('the ground of the lane and of every built place paints, with a way through it and stepping stones', () => {
  const lane = standIn();
  assert.doesNotThrow(() => paintLaneGround(lane, WORLD, ROUTE, SPOTS, LAMPS));
  assert.ok(count(lane, 'fill') > 600, 'grass, pebbles, stones, flowers');
  assert.ok(count(lane, 'quadraticCurveTo') >= SPOTS.length, 'the lane curves past every door');
  assert.equal(count(lane, 'save'), count(lane, 'restore'));
  for (const room of ROOMS.filter((r) => AREAS[r.id])) {
    const inside = standIn();
    assert.doesNotThrow(() => paintInsideGround(inside, room, AREAS[room.id]), room.id);
    assert.ok(count(inside, 'fill') > 600);
    assert.equal(count(inside, 'save'), count(inside, 'restore'));
  }
});

test('trees, lamps, hedges, bushes, the gate and name labels all paint', () => {
  for (const [name, painter] of [
    ['tree', (pen) => paintTree(pen, 28)], ['lamp', (pen) => paintLamp(pen)], ['hedge', (pen) => paintHedge(pen, AREAS.garden.blocks[0])],
    ['bush', (pen) => paintBush(pen, false)], ['boss bush', (pen) => paintBush(pen, true)], ['gate', (pen) => paintGate(pen)],
    ['label', (pen) => label(pen, 'The Garden Gate', 100, 100)],
  ]) {
    const pen = standIn();
    assert.doesNotThrow(() => painter(pen), name);
    assert.ok(count(pen, 'fill') + count(pen, 'fillText') >= 2, `${name} paints something`);
    assert.equal(count(pen, 'save'), count(pen, 'restore'), name);
  }
});

test('colours mix as told', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
  assert.equal(mix('#ff0000', '#0000ff', 0), 'rgb(255,0,0)');
  assert.equal(mix('#ff0000', '#0000ff', 1), 'rgb(0,0,255)');
});
