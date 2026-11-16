// The lane: the small open world you walk around between places. Rules only:
// where things stand, where feet can go, and how one step of walking works.
// No drawing, no clock: the caller says how much time has passed.
import { ROOM_IDS } from './balance.js';

export const WORLD = {
  w: 720, h: 1640, // the size of the lane, in its own units (about two thirds of a pixel each on a phone)
  edge: 26, // how close to the edge of the world feet may go
  speed: 255, // walking, in units a second
  reach: 82, // how near a door counts as being at it
  body: 15, // half the width of whoever is walking
  maxStep: 0.1, // seconds; a longer gap is walked as this, so nobody steps through a wall
};

// Where every place stands: x is the middle of its front, y the foot of its
// front wall. Home is where you are staying; the rest are the eight rooms.
const AT = {
  home: [360, 1500], garden: [180, 1270], alley: [540, 1110], pantry: [180, 950], wash: [540, 790],
  stacks: [180, 630], rooftops: [540, 470], attic: [180, 320], dark: [520, 180],
};
export const SPOT_IDS = ['home', ...ROOM_IDS];
export const SPOTS = SPOT_IDS.map((id) => {
  const [x, y] = AT[id];
  const w = id === 'home' ? 250 : 190; // how wide the building is
  const tall = id === 'home' ? 190 : 150; // how tall it is drawn
  // Feet cannot go where the lower part of the building stands; behind its roof is fine.
  return { id, x, y, w, tall, block: { x: x - w / 2, y: y - 64, w, h: 64 }, door: { x, y: y + 34 } };
});
export const spotOf = (id) => SPOTS.find((spot) => spot.id === id) || null;

// Trees, as circles to walk round.
export const TREES = [
  [60, 1580, 30], [660, 1585, 32], [640, 1400, 28], [70, 1420, 26], [665, 1250, 28], [55, 1105, 28],
  [668, 940, 28], [52, 790, 26], [666, 625, 28], [54, 470, 26], [664, 320, 28], [330, 150, 24], [58, 160, 26], [670, 70, 24],
].map(([x, y, r]) => ({ x, y, r }));

/** Whether feet can be at this point: inside the lane, and not in a building or a tree. */
export function canStand(x, y) {
  if (!(x >= WORLD.edge && x <= WORLD.w - WORLD.edge && y >= WORLD.edge && y <= WORLD.h - WORLD.edge)) return false;
  const b = WORLD.body;
  for (const { block } of SPOTS) {
    if (x > block.x - b && x < block.x + block.w + b && y > block.y - b && y < block.y + block.h + b) return false;
  }
  for (const tree of TREES) {
    const reach = tree.r * 0.55 + b; // the trunk, not the leaves
    if ((x - tree.x) * (x - tree.x) + (y - tree.y) * (y - tree.y) < reach * reach) return false;
  }
  return true;
}

/**
 * One step of walking from `pos` toward `target`, `dt` seconds long. Returns
 * the new position and whether anything moved. A wall is slid along rather
 * than stuck to; if there is no way on, you stop.
 */
export function stepWalk(pos, target, dt) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const far = Math.hypot(dx, dy);
  const step = Math.min(far, WORLD.speed * Math.min(Math.max(dt, 0), WORLD.maxStep));
  if (!(far > 1.5) || !(step > 0)) return { x: pos.x, y: pos.y, moving: false };
  const sx = (dx / far) * step;
  const sy = (dy / far) * step;
  if (canStand(pos.x + sx, pos.y + sy)) return { x: pos.x + sx, y: pos.y + sy, moving: true };
  // Blocked: keep whichever part of the step is still free, preferring the bigger.
  const tries = Math.abs(sx) >= Math.abs(sy) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [mx, my] of tries) {
    if (Math.abs(mx) + Math.abs(my) > 0.2 && canStand(pos.x + mx, pos.y + my)) return { x: pos.x + mx, y: pos.y + my, moving: true };
  }
  return { x: pos.x, y: pos.y, moving: false };
}

/** The place whose door you are standing at, or null. */
export function spotNear(pos) {
  let best = null;
  let bestFar = WORLD.reach;
  for (const spot of SPOTS) {
    const far = Math.hypot(pos.x - spot.door.x, pos.y - spot.door.y);
    if (far <= bestFar) { best = spot.id; bestFar = far; }
  }
  return best;
}

/** A position from anywhere (a save, say) made safe: a real point feet can be at, or the door of home. */
export function settleWhere(raw) {
  const home = spotOf('home').door;
  if (!raw || typeof raw !== 'object' || typeof raw.x !== 'number' || typeof raw.y !== 'number') return { x: home.x, y: home.y };
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !canStand(raw.x, raw.y)) return { x: home.x, y: home.y };
  return { x: raw.x, y: raw.y };
}
