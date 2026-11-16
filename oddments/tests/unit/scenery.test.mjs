// The painted world. Nothing here can look at a picture, but it can make sure
// every painting the world needs is there, that every painter runs from start
// to finish on a stand-in canvas (with its painting, and before it arrives),
// and that the painting asks the canvas for nothing an iPhone on iOS 15 lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  WORLD_ART, BUILDING_WIDE, worldSrc, paintLaneGround, paintInsideGround, paintBuilding, paintProp, paintLamp, paintHedge, paintGate, stood, label, mix,
} from '../../web/js/ui/scenery.js';
import { WORLD, SPOTS, LAMPS, AREAS } from '../../web/js/core/world.js';
import { ROOMS } from '../../web/js/core/balance.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));

// What a 2D canvas on iOS 15 can do. A painter that reaches for anything else fails here.
const CAN = new Set([
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect',
  'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'measureText', 'drawImage',
  'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'setLineDash', 'createLinearGradient', 'createRadialGradient', 'createPattern',
]);
const SET = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation']);

/** A stand-in for a canvas's 2D context that writes down everything asked of it. */
function standIn() {
  const calls = [];
  const sets = [];
  return new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'sets') return sets;
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
    set(_, name, value) {
      assert.ok(SET.has(name), `the canvas on iOS 15 has no ${String(name)}`);
      sets.push(`${String(name)}=${value}`);
      return true;
    },
  });
}
const count = (pen, name) => pen.calls.filter((call) => call === name).length;
const here = { complete: true, naturalWidth: 360, naturalHeight: 340 }; // a painting that has arrived
const coming = { complete: false, naturalWidth: 0, naturalHeight: 0 }; // one that has not yet
const ROUTE = [{ x: WORLD.w / 2, y: WORLD.h + 60 }, ...SPOTS.map((spot) => spot.door)];

test('every painting the world needs is in the game, and home and every place has a building', () => {
  for (const name of WORLD_ART) {
    const path = `${WEB}${worldSrc(name)}`;
    assert.ok(existsSync(path), `${name} is there`);
    assert.ok(statSync(path).size > 3000, `${name} is a real picture`);
  }
  for (const spot of SPOTS) {
    assert.ok(WORLD_ART.includes(`b_${spot.id}`), `${spot.id} has a painting`);
    assert.ok(BUILDING_WIDE[spot.id] > 0, `${spot.id} has a size`);
    // It stands about as wide as the ground the rules give it: a little overhang, never a wall of air.
    assert.ok(BUILDING_WIDE[spot.id] >= spot.w && BUILDING_WIDE[spot.id] <= spot.w + 24, `${spot.id}: ${BUILDING_WIDE[spot.id]} wide on ${spot.w} of ground`);
  }
  assert.equal(new Set(WORLD_ART).size, WORLD_ART.length);
});

test('a painting stands with its foot where it is put, as tall as its shape says', () => {
  const pen = standIn();
  assert.equal(stood(pen, { complete: true, naturalWidth: 200, naturalHeight: 300 }, 50, 400, 100), 150);
  assert.deepEqual(pen.calls, ['drawImage']);
  assert.equal(stood(standIn(), coming, 0, 0, 100), 0, 'nothing is drawn before it arrives');
  assert.equal(stood(standIn(), null, 0, 0, 100), 0);
});

test('every building paints, open and shut, with its painting and before it arrives', () => {
  for (const spot of SPOTS) {
    const open = standIn();
    paintBuilding(open, spot, { image: here, name: 'A place', open: true });
    assert.equal(count(open, 'drawImage'), 1, `${spot.id} is its painting`);
    assert.ok(count(open, 'fillText') === 1, `${spot.id} has its name over it`);
    const shut = standIn();
    paintBuilding(shut, spot, { image: here, name: 'A place', open: false });
    assert.ok(shut.sets.includes('globalCompositeOperation=source-atop'), `${spot.id}: shut, it is in the dark`);
    assert.ok(count(shut, 'fill') > count(open, 'fill'), `${spot.id}: and has a padlock on it`);
    assert.equal(count(shut, 'save'), count(shut, 'restore'));
    const early = standIn();
    assert.doesNotThrow(() => paintBuilding(early, spot, { image: coming, name: 'A place', open: true, cleared: true }));
    assert.equal(count(early, 'drawImage'), 0);
    assert.equal(count(early, 'fillText'), 1, 'its name is there even so');
  }
});

test('the ground of the lane and of every built place is the grass painting, with a way of earth and stepping stones', () => {
  const art = { grass: here, earth: here, bush: here };
  const lane = standIn();
  paintLaneGround(lane, WORLD, ROUTE, SPOTS, LAMPS, art);
  assert.ok(count(lane, 'drawImage') > 40, 'grass laid over the whole lane, and a hedge of bushes down its sides');
  assert.ok(count(lane, 'createPattern') >= 1, 'the way is earth');
  assert.ok(count(lane, 'quadraticCurveTo') >= SPOTS.length, 'and curves past every door');
  assert.ok(count(lane, 'fill') > 200, 'stones, pebbles, flowers');
  assert.equal(count(lane, 'save'), count(lane, 'restore'));
  for (const room of ROOMS.filter((r) => AREAS[r.id])) {
    const inside = standIn();
    paintInsideGround(inside, room, AREAS[room.id], art);
    assert.ok(count(inside, 'drawImage') > 40 && count(inside, 'createPattern') >= 1, room.id);
    assert.equal(count(inside, 'save'), count(inside, 'restore'));
  }
  // Before the paintings arrive the ground still paints: plain, but there.
  const early = standIn();
  assert.doesNotThrow(() => paintLaneGround(early, WORLD, ROUTE, SPOTS, LAMPS, { grass: coming, earth: coming, bush: coming }));
  assert.equal(count(early, 'drawImage'), 0);
  assert.ok(count(early, 'fillRect') >= 2);
});

test('trees, lamps, hedges, the gate and name plates all paint', () => {
  const tree = standIn();
  paintProp(tree, here, 90);
  assert.equal(count(tree, 'drawImage'), 1);
  const lamp = standIn();
  paintLamp(lamp, here);
  assert.equal(count(lamp, 'drawImage'), 1);
  assert.equal(count(lamp, 'createRadialGradient'), 1, 'and its light');
  const hedge = standIn();
  paintHedge(hedge, AREAS.garden.blocks[0], here);
  assert.ok(count(hedge, 'drawImage') >= 6, 'a hedge is bushes shoulder to shoulder');
  const gate = standIn();
  paintGate(gate);
  assert.ok(count(gate, 'fill') >= 8);
  const plate = standIn();
  label(plate, 'The Garden Gate', 100, 100);
  assert.equal(count(plate, 'fillText'), 1);
});

test('colours mix as told', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
  assert.equal(mix('#ff0000', '#0000ff', 0), 'rgb(255,0,0)');
  assert.equal(mix('#ff0000', '#0000ff', 1), 'rgb(0,0,255)');
});
