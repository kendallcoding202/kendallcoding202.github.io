// The lane: the small open world you walk around between places. Rules only:
// where things stand, where feet can go, and how one step of walking works.
// No drawing, no clock: the caller says how much time has passed.
import { ROOM_IDS } from './balance.js';

export const WORLD = {
  // The size of the lane, in its own units. It is exactly one screen wide, so the view only ever
  // travels up and down it, and nothing is ever cut off at the sides.
  w: 640, h: 1860,
  edge: 26, // how close to the edge of the world feet may go
  speed: 255, // walking, in units a second
  reach: 82, // how near a door counts as being at it
  body: 15, // half the width of whoever is walking
  maxStep: 0.1, // seconds; a longer gap is walked as this, so nobody steps through a wall
};

// Where every place stands: x is the middle of its front, y the foot of its
// front wall. Home is where you are staying; the rest are the eight rooms.
const AT = {
  home: [320, 1700], garden: [165, 1460], alley: [475, 1290], pantry: [165, 1120], wash: [475, 950],
  stacks: [165, 780], rooftops: [475, 610], attic: [165, 440], dark: [372, 250],
};
// Most buildings are much of a size; home is broader, and two are tall and thin.
const WIDE = { home: 226, wash: 176, rooftops: 136, attic: 158 };
const TALL = { home: 230, rooftops: 250, attic: 250 };
export const SPOT_IDS = ['home', ...ROOM_IDS];
export const SPOTS = SPOT_IDS.map((id) => {
  const [x, y] = AT[id];
  const w = WIDE[id] || 196; // how much ground the building takes, side to side
  const tall = TALL[id] || 200; // about how tall it stands
  // Feet cannot go where the lower part of the building stands; behind its roof is fine.
  return { id, x, y, w, tall, block: { x: x - w / 2, y: y - 64, w, h: 64 }, door: { x, y: y + 34 } };
});
export const spotOf = (id) => SPOTS.find((spot) => spot.id === id) || null;

// Trees, as circles to walk round.
export const TREES = [
  [48, 1800, 28], [592, 1806, 30], [596, 1580, 28], [44, 1610, 26], [598, 1440, 28], [42, 1280, 28], [598, 1100, 28],
  [42, 940, 26], [598, 765, 28], [42, 600, 26], [598, 430, 28], [44, 250, 26], [560, 150, 26], [604, 60, 22],
].map(([x, y, r]) => ({ x, y, r }));

// A lamp beside every building, on the side the lane is (the last building's on its open side). Thin, but solid.
export const LAMPS = SPOTS.map((spot) => ({ x: spot.x + (spot.id === 'dark' || spot.x <= WORLD.w / 2 ? 1 : -1) * (spot.w / 2 + 30), y: spot.y + 26, r: 7 }));

/** Whether feet can be at this point: inside the lane, and not in a building, a tree or a lamp post. */
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
  for (const lamp of LAMPS) {
    const reach = lamp.r + b;
    if ((x - lamp.x) * (x - lamp.x) + (y - lamp.y) * (y - lamp.y) < reach * reach) return false;
  }
  return true;
}

/**
 * One step of walking from `pos` toward `target`, `dt` seconds long. Returns
 * the new position and whether anything moved. A wall is slid along rather
 * than stuck to; if there is no way on, you stop. `can` says where feet may
 * be: the lane by default, or the inside of a place.
 */
export function stepWalk(pos, target, dt, can = canStand) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const far = Math.hypot(dx, dy);
  const step = Math.min(far, WORLD.speed * Math.min(Math.max(dt, 0), WORLD.maxStep));
  if (!(far > 1.5) || !(step > 0)) return { x: pos.x, y: pos.y, moving: false };
  const sx = (dx / far) * step;
  const sy = (dy / far) * step;
  if (can(pos.x + sx, pos.y + sy)) return { x: pos.x + sx, y: pos.y + sy, moving: true };
  // Blocked: keep whichever part of the step is still free, preferring the bigger.
  const tries = Math.abs(sx) >= Math.abs(sy) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  for (const [mx, my] of tries) {
    if (Math.abs(mx) + Math.abs(my) > 0.2 && can(pos.x + mx, pos.y + my)) return { x: pos.x + mx, y: pos.y + my, moving: true };
  }
  return { x: pos.x, y: pos.y, moving: false };
}

const CELL = 24; // route-finding works on squares this big

/**
 * A stricter idea of where feet can be: only where there is this much room on every side. A way
 * found with it keeps clear of things, so walking it never brushes a lamp post or catches a corner.
 */
export const roomy = (can, room = 6) => (x, y) => can(x, y) && can(x + room, y) && can(x - room, y) && can(x, y + room) && can(x, y - room);

/**
 * The way to walk from `from` to `to` without going through anything: a list
 * of points to head for in turn. If `to` is somewhere feet cannot be (a tap
 * on a building, or on whoever is waiting), the way ends as near to it as
 * feet can get. `can(x, y)` says where feet may be; `size` is { w, h }.
 */
export function routeTo(from, to, can, size) {
  const cols = Math.ceil(size.w / CELL);
  const rows = Math.ceil(size.h / CELL);
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  const col = (x) => Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
  const row = (y) => Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
  const start = row(from.y) * cols + col(from.x);
  const goal = row(to.y) * cols + col(to.x);
  const open = (cell) => can((cell % cols) * CELL + CELL / 2, Math.floor(cell / cols) * CELL + CELL / 2);
  const far = (cell) => Math.hypot((cell % cols) * CELL + CELL / 2 - to.x, Math.floor(cell / cols) * CELL + CELL / 2 - to.y);
  // Breadth-first outward from where you stand, remembering how each square was reached.
  const prev = new Int32Array(cols * rows).fill(-1);
  const queue = [start];
  prev[start] = start;
  let best = start;
  let bestFar = far(start);
  for (let head = 0; head < queue.length && best !== goal; head++) {
    const cell = queue[head];
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (prev[next] !== -1 || !open(next)) continue;
      // No cutting a corner between two blocked squares.
      if (dc && dr && (!open(r * cols + nc) || !open(nr * cols + c))) continue;
      prev[next] = cell;
      queue.push(next);
      const d = far(next);
      if (d < bestFar) { best = next; bestFar = d; }
    }
  }
  const way = [];
  for (let cell = best; cell !== start; cell = prev[cell]) way.unshift({ x: (cell % cols) * CELL + CELL / 2, y: Math.floor(cell / cols) * CELL + CELL / 2 });
  if (best === goal && can(to.x, to.y) && Math.hypot(to.x - from.x, to.y - from.y) > 2) { if (way.length) way.pop(); way.push({ x: to.x, y: to.y }); }
  return way;
}

/**
 * The same way with the corners taken out: wherever you can walk straight to
 * a later point without touching anything, the points between are dropped.
 * A way found on squares zig-zags; walked like this it does not.
 */
export function straighten(from, way, can) {
  const out = [];
  let at = from;
  for (let i = 0; i < way.length;) {
    let j = way.length - 1;
    while (j > i && !clearWay(at, way[j], can)) j--;
    out.push(way[j]);
    at = way[j];
    i = j + 1;
  }
  return out;
}

/** Whether you can walk in a straight line from one point to another without touching anything. */
export function clearWay(a, b, can) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
  for (let i = 1; i <= steps; i++) {
    if (!can(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)) return false;
  }
  return true;
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

// ---------------------------------------------------------------- inside a place
//
// Walk through a door and you are inside the place: a map of its own that you
// cross on foot. Hedges (`blocks`) leave one winding way from the gate to the
// far end, and whoever is waiting at each stop stands in a gap of it (`posts`,
// one per stop of the room's path, in order): there is no getting past them
// without meeting them. `gate` is where you come in and where you go out.
export const AREAS = {
  garden: {
    w: 640, h: 1620,
    gate: { x: 320, y: 1530 },
    blocks: [
      { x: 0, y: 1240, w: 440, h: 44 }, { x: 200, y: 960, w: 440, h: 44 },
      { x: 0, y: 680, w: 440, h: 44 }, { x: 200, y: 400, w: 440, h: 44 },
    ],
    // Each gap is narrower than the ground a group holds, so there is no squeezing by.
    posts: [{ x: 535, y: 1262 }, { x: 105, y: 982 }, { x: 535, y: 702 }, { x: 105, y: 422 }, { x: 320, y: 215 }],
  },
};
export const POST = { hold: 100, meet: 118 }; // how much ground a waiting group holds, and how near is meeting it
export const areaOf = (roomId) => (typeof roomId === 'string' && Object.prototype.hasOwnProperty.call(AREAS, roomId) ? AREAS[roomId] : null);

/**
 * Whether feet can be at this point inside a place. `stop` is how far you
 * have got: whoever is waiting at that stop, and at every stop after it,
 * still holds their ground.
 */
export function canStandIn(area, x, y, stop) {
  if (!(x >= WORLD.edge && x <= area.w - WORLD.edge && y >= WORLD.edge && y <= area.h - WORLD.edge)) return false;
  const b = WORLD.body;
  for (const block of area.blocks) {
    if (x > block.x - b && x < block.x + block.w + b && y > block.y - b && y < block.y + block.h + b) return false;
  }
  for (let i = Math.max(0, stop); i < area.posts.length; i++) {
    const post = area.posts[i];
    if ((x - post.x) * (x - post.x) + (y - post.y) * (y - post.y) < POST.hold * POST.hold) return false;
  }
  return true;
}

/** Whether you have walked up to whoever is waiting at this stop. */
export function meetingAt(area, pos, stop) {
  const post = area.posts[stop];
  return !!post && Math.hypot(pos.x - post.x, pos.y - post.y) <= POST.meet;
}

export const atGate = (area, pos) => Math.hypot(pos.x - area.gate.x, pos.y - area.gate.y) <= WORLD.reach;

/** A position inside a place made safe: somewhere feet can be given how far you have got, or the gate. */
export function settleInside(area, raw, stop) {
  const ok = raw && typeof raw === 'object' && typeof raw.x === 'number' && typeof raw.y === 'number'
    && Number.isFinite(raw.x) && Number.isFinite(raw.y) && canStandIn(area, raw.x, raw.y, stop);
  return ok ? { x: raw.x, y: raw.y } : { x: area.gate.x, y: area.gate.y };
}
