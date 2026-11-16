// The painted world. Nothing here can look at a picture, but it can make sure
// every painting the world needs is there, that every painter runs from start
// to finish on a stand-in canvas (with its painting, and before it arrives),
// and that the painting asks the canvas for nothing an iPhone on iOS 15 lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  WORLD_ART, BUILDING_WIDE, worldSrc, paintGround, paintBuilding, paintProp, paintLamp, paintGate, bushesOf, stood, label, mix,
} from '../../web/js/ui/scenery.js';
import { WORLD, SPOTS, LAMPS, HEDGES, ROAD_POINTS, GREEN, DISTRICTS, canStand } from '../../web/js/core/world.js';

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
const GROUND = {
  w: WORLD.w, h: WORLD.h, roads: ROAD_POINTS, spots: SPOTS, lamps: LAMPS, hedges: HEDGES, green: GREEN,
  lawns: [{ ...DISTRICTS.garden, tint: '#7ac74f' }],
};

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
    const plain = standIn();
    paintBuilding(plain, spot, { image: here, open: true });
    assert.equal(count(plain, 'fillText'), 0, 'a building given no name has no name plate');
  }
});

test('the ground of the whole world is the grass painting, with streets of earth and stepping stones and a lawn for the garden', () => {
  const art = { grass: here, earth: here, bush: here };
  const world = standIn();
  paintGround(world, GROUND, art);
  assert.ok(count(world, 'drawImage') > 200, 'grass laid over everything, and a hedge of bushes round the edge');
  assert.ok(count(world, 'createPattern') >= 2, 'the streets and the garden path are earth');
  assert.ok(count(world, 'lineTo') > 400, 'every street is traced');
  assert.ok(count(world, 'fill') > 600, 'stones, pebbles, flowers');
  assert.equal(count(world, 'clip'), 1, 'the lawn is kept inside its hedge');
  assert.equal(count(world, 'save'), count(world, 'restore'));
  // Before the paintings arrive the ground still paints: plain, but there.
  const early = standIn();
  assert.doesNotThrow(() => paintGround(early, GROUND, { grass: coming, earth: coming, bush: coming }));
  assert.equal(count(early, 'drawImage'), 0);
  assert.ok(count(early, 'fillRect') >= 2);
  // With no place to walk into, it is all lane.
  assert.doesNotThrow(() => paintGround(standIn(), { ...GROUND, lawns: [] }, art));
});

test('a hedge is bushes shoulder to shoulder, standing on the ground the hedge holds', () => {
  for (const block of HEDGES) {
    const bushes = bushesOf(block);
    const long = Math.max(block.w, block.h);
    assert.ok(bushes.length >= long / 60 && bushes.length <= long / 38, `${bushes.length} bushes along ${long}`);
    for (const bush of bushes) {
      assert.ok(bush.x >= block.x && bush.x <= block.x + block.w && bush.y >= block.y && bush.y <= block.y + block.h + 4, 'each stands in its hedge');
      if (bush.x > WORLD.edge && bush.y > WORLD.edge) assert.equal(canStand(bush.x, bush.y - 8), false, 'and where a bush is drawn, feet cannot go');
    }
  }
  assert.equal(bushesOf({ x: 0, y: 0, w: 60, h: 44 }).length, 2);
});

test('trees, lamps, the gate and name plates all paint', () => {
  const tree = standIn();
  paintProp(tree, here, 90);
  assert.equal(count(tree, 'drawImage'), 1);
  const lamp = standIn();
  paintLamp(lamp, here);
  assert.equal(count(lamp, 'drawImage'), 1);
  assert.equal(count(lamp, 'createRadialGradient'), 1, 'and its light');
  const gate = standIn();
  paintGate(gate);
  assert.ok(count(gate, 'fill') >= 6);
  const plate = standIn();
  label(plate, 'The Garden Gate', 100, 100);
  assert.equal(count(plate, 'fillText'), 1);
  assert.ok(plate.sets.some((set) => set.startsWith('font=600 24px')), 'a name plate is big enough to read with the whole lane in view');
  const small = standIn();
  label(small, 'calm the others first', 100, 100, '#fff', '#000', 19);
  assert.ok(small.sets.some((set) => set.startsWith('font=600 19px')));
});

test('colours mix as told', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
  assert.equal(mix('#ff0000', '#0000ff', 0), 'rgb(255,0,0)');
  assert.equal(mix('#ff0000', '#0000ff', 1), 'rgb(0,0,255)');
});
