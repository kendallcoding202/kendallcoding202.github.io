// The insides of buildings. Nothing here can look at a picture, but it can
// make sure that every room you can walk into has its paintings, that every
// painting a room needs is in the game, that everything feet are kept out of
// has something standing on it to see, that a thing is about as wide as the
// floor the rules give it, and that every room paints from start to finish
// on a stand-in canvas, with its paintings and before they arrive, asking
// for nothing an iPhone on iOS 15 lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOM_ART, roomSrc, roomArt, painted, paintRoom, standingIn } from '../../web/js/ui/roomart.js';
import { INSIDES, INSIDE_IDS } from '../../web/js/core/indoors.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));

const CAN = new Set([
  'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect',
  'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'measureText', 'drawImage',
  'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'setLineDash', 'createLinearGradient', 'createRadialGradient', 'createPattern',
]);
const SET = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'globalCompositeOperation']);
/** A stand-in for a canvas's 2D context that writes down everything asked of it, and where each picture was put. */
function standIn() {
  const calls = [];
  const drawn = [];
  let depth = 0;
  return new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'drawn') return drawn;
      if (name === 'depth') return depth;
      if (SET.has(name)) return '';
      assert.ok(CAN.has(name), `the canvas on iOS 15 has no ${String(name)}`);
      return (...args) => {
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(name)} was given ${arg}`);
        calls.push(name);
        if (name === 'save') depth++;
        if (name === 'restore') depth--;
        if (name === 'drawImage') drawn.push(args);
        if (name === 'measureText') return { width: 80 };
        if (name.startsWith('create')) return { addColorStop() {} };
        return undefined;
      };
    },
    set(_, name) { assert.ok(SET.has(name), `the canvas on iOS 15 has no ${String(name)}`); return true; },
  });
}
const count = (pen, name) => pen.calls.filter((call) => call === name).length;
const arrivedArt = (id, room) => Object.fromEntries([['maribel', { complete: true, naturalWidth: 200, naturalHeight: 300 }], ...roomArt(id, room).map(([name]) => [name, { complete: true, naturalWidth: 300, naturalHeight: 280, name }])]);
const comingArt = (id, room) => Object.fromEntries([['maribel', { complete: false, naturalWidth: 0, naturalHeight: 0 }], ...roomArt(id, room).map(([name]) => [name, { complete: false, naturalWidth: 0, naturalHeight: 0 }])]);

test('every room you can walk into is painted; every painting it needs is in the game, and nothing is in the folder that no room uses', () => {
  for (const id of INSIDE_IDS) assert.ok(painted(id), `${id} is painted`);
  assert.equal(INSIDE_IDS.length, 7);
  assert.equal(painted('garden'), false, 'the garden is a corner of the lane, not a room');
  assert.equal(painted('constructor'), false);
  assert.equal(new Set(ROOM_ART).size, ROOM_ART.length);
  for (const src of ROOM_ART) {
    assert.ok(existsSync(`${WEB}${src}`), `${src} is there`);
    assert.ok(statSync(`${WEB}${src}`).size > 2500, `${src} is a real picture`);
  }
  const used = new Set();
  for (const id of INSIDE_IDS) {
    const needs = roomArt(id, INSIDES[id]);
    for (const part of ['wall', 'floor', 'mat']) assert.ok(needs.some(([name, src]) => name === `${id}_${part}` && src === roomSrc(`${id}_${part}`)), `${id} has a ${part}`);
    for (const [, src] of needs) { assert.ok(ROOM_ART.includes(src), `${src} is fetched before the game shows`); used.add(src); }
  }
  // Each room's sheet was twelve things: with its wall and floor, fourteen pictures, and every one of them is used in its room.
  assert.equal(ROOM_ART.length, 7 * 14);
  assert.deepEqual(ROOM_ART.filter((src) => !used.has(src)), [], 'no picture is fetched that its room does not show');
  const folder = readdirSync(`${WEB}assets/rooms`).map((file) => `assets/rooms/${file}`);
  assert.deepEqual(folder.filter((file) => !ROOM_ART.includes(file)), [], 'no picture ships that nothing shows');
});

test('everything feet are kept out of can be seen: each block of every floor has something standing on it, about as wide as the block', () => {
  for (const id of INSIDE_IDS) {
    const room = INSIDES[id];
    const things = standingIn(id, room);
    assert.deepEqual(things.map((thing) => thing.id), room.blocks.map((block) => block.id), `${id}: one thing to a block`);
    const art = arrivedArt(id, room);
    for (const thing of things) {
      const block = room.blocks.find((b) => b.id === thing.id);
      assert.equal(thing.x, block.x + block.w / 2);
      assert.equal(thing.y, block.y + block.h, 'its foot is at the front of its block');
      const pen = standIn();
      thing.paint(pen, art, 1.5);
      assert.equal(pen.depth, 0, `${id} ${thing.id}: every save has its restore`);
      // A thing is one picture, standing centred on its block, a little wider than the floor it takes: never a wall of air.
      assert.equal(pen.drawn.length, 1, `${id} ${thing.id} is one painting`);
      const [image, x, , wide] = pen.drawn[0];
      assert.equal(image.name, `${id}_${thing.id.replace(/\d+$/, '')}`);
      assert.ok(Math.abs(x + wide / 2) < 0.001, 'centred');
      assert.ok(wide >= block.w - 2 && wide <= block.w + 60, `${id} ${thing.id}: ${wide} wide on ${block.w} of floor`);
      // Before its painting arrives it is a shadow and nothing else, and nothing breaks.
      const early = standIn();
      thing.paint(early, comingArt(id, room), 0);
      assert.equal(count(early, 'drawImage'), 0);
    }
  }
});

test('every room paints from start to finish, with its paintings and before they arrive', () => {
  for (const id of INSIDE_IDS) {
    const room = INSIDES[id];
    const pen = standIn();
    paintRoom(pen, id, room, arrivedArt(id, room));
    assert.ok(pen.calls.length > 20, `${id} is painted`);
    assert.equal(pen.depth, 0, `${id}: every save has its restore`);
    const early = standIn();
    paintRoom(early, id, room, comingArt(id, room));
    assert.equal(count(early, 'drawImage'), 0, `${id}: nothing is drawn from a painting that has not arrived`);
    assert.ok(count(early, 'fillRect') >= 2, `${id}: but there is a floor and a wall to stand in`);
    // Its wall across the whole width (once, or as a pair), its floor repeated to cover it, its mat at the door.
    const wall = pen.drawn.filter(([image]) => image.name === `${id}_wall`);
    assert.ok(wall.length === 1 || wall.length === 2, `${id}: the wall is one painting or a pair`);
    for (const [, , y, wide, tall] of wall) { assert.equal(y, 0); assert.equal(tall, room.wall); assert.ok(Math.abs(wide * wall.length - room.w) <= 1); }
    const tiles = pen.drawn.filter(([image]) => image.name === `${id}_floor`);
    const size = tiles[0][3];
    assert.ok(tiles.length >= Math.floor(room.w / size) * Math.floor((room.h - room.wall) / size), `${id}: ${tiles.length} tiles of floor`);
    assert.ok(tiles.every(([, , y]) => y >= room.wall), 'the floor is below the wall');
    const mat = pen.drawn.filter(([image]) => image.name === `${id}_mat`);
    assert.equal(mat.length, 1);
    assert.ok(Math.abs(mat[0][1] + mat[0][3] / 2 - room.door.x) < 0.001 && mat[0][2] + mat[0][4] <= room.h, `${id}: the mat is at the door, on the floor`);
  }
});
