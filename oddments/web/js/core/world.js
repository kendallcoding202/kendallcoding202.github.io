// The lane: one open neighbourhood, bigger than the screen every way, that you
// walk around freely. Home is in the middle; the places stand round it; the
// garden is a hedged corner of the same map that you walk straight into.
// Rules only: where things stand, where feet can go, and how one step of
// walking works. No drawing, no clock: the caller says how much time has passed.
import { ROOM_IDS } from './balance.js';
import { own } from './util.js';

export const WORLD = {
  w: 2280, h: 2200, // the size of the neighbourhood, in its own units
  edge: 34, // how close to the edge of the world feet may go
  speed: 280, // walking, in units a second
  reach: 86, // how near a door counts as being at it
  body: 15, // half the width of whoever is walking
  maxStep: 0.1, // seconds; a longer gap is walked as this, so nobody steps through a wall
  // How near a point of the way counts as having got to it, before turning for the next. Less than
  // the room a way keeps from things (see `roomy`), or turning that much early could clip a corner.
  arrive: 3,
};

// ---------------------------------------------------------------- places you walk into
//
// A place is a stretch of the same map with a way in (`gate`). Whoever is
// restless there waits in the open at its `posts`, one group per stop of the
// room's path, the boss last. Each group holds the ground it stands on; walk
// up to one and you have met it.
export const DISTRICTS = {
  garden: {
    x: 0, y: 0, w: 940, h: 940,
    gate: { x: 700, y: 962 },
    posts: [{ x: 480, y: 800 }, { x: 810, y: 620 }, { x: 220, y: 640 }, { x: 350, y: 400 }, { x: 680, y: 250 }],
  },
  // Tin Can Alley: a lane down the east edge of the world, walled with junk, one group wide. There
  // is no going round anyone in it: they are met in turn, from the gate at its foot to the far end.
  alley: {
    x: 2040, y: 0, w: 240, h: 1560, narrow: true,
    gate: { x: 2150, y: 1582 },
    posts: [{ x: 2150, y: 1300 }, { x: 2150, y: 1040 }, { x: 2150, y: 780 }, { x: 2150, y: 520 }, { x: 2150, y: 240 }],
  },
};
export const BARRICADE = 76; // how much of a gateway a barricade fills, while the place behind it is still shut
export const POST = { hold: 100, meet: 118 }; // how much ground a waiting group holds, and how near is meeting it
export const districtOf = (roomId) => (typeof roomId === 'string' && own(DISTRICTS, roomId) ? DISTRICTS[roomId] : null);

/** Which place a point is inside, or null out in the lane. Standing in a gateway is still outside. */
export function districtAt(pos) {
  if (!pos) return null;
  for (const id of Object.keys(DISTRICTS)) {
    const d = DISTRICTS[id];
    if (pos.x >= d.x && pos.x < d.x + d.w && pos.y >= d.y && pos.y < d.y + d.h) return id;
  }
  return null;
}

// ---------------------------------------------------------------- what stands where

// Every building: x is the middle of its front, y the foot of its front wall. Fronts face down the
// map, so streets run along the foot of each row. The garden's shed stands inside the garden.
const AT = {
  home: [1180, 1420], garden: [250, 262], alley: [1880, 1860], pantry: [1290, 520], wash: [1790, 1330],
  stacks: [1660, 1960], rooftops: [1090, 1990], attic: [470, 1960], dark: [1750, 330],
};
// Most buildings are much of a size; home is broader, and two are tall and thin.
const WIDE = { home: 226, wash: 176, rooftops: 136, attic: 158 };
const TALL = { home: 230, rooftops: 250, attic: 250 };
export const SPOT_IDS = ['home', ...ROOM_IDS];
export const SPOTS = SPOT_IDS.map((id) => {
  const [x, y] = AT[id];
  const w = WIDE[id] || 196; // how much ground the building takes, side to side
  const tall = TALL[id] || 200; // about how tall it stands
  const district = districtOf(id);
  // Feet cannot go where the lower part of the building stands; behind its roof is fine. Where you
  // stand to be "at" a place is its front door, or, for a place you walk into, just outside its gate.
  return { id, x, y, w, tall, block: { x: x - w / 2, y: y - 64, w, h: 64 }, door: district ? { x: district.gate.x, y: district.gate.y + 84 } : { x, y: y + 34 } };
});
export const spotOf = (id) => SPOTS.find((spot) => spot.id === id) || null;

// Walls: solid blocks of ground, each made of whatever suits the place (`look`). The first three
// are the garden's hedge, leaving its gate; the rest wall Tin Can Alley off with junk, and fence
// its foot either side of its gate.
export const HEDGES = [
  { x: 0, y: 940, w: 630, h: 44, look: 'bush' }, { x: 770, y: 940, w: 214, h: 44, look: 'bush' },
  { x: 940, y: 0, w: 44, h: 940, look: 'bush' },
  { x: 2000, y: 0, w: 40, h: 1560, look: 'junk' },
  { x: 2000, y: 1560, w: 80, h: 44, look: 'fence' }, { x: 2220, y: 1560, w: 60, h: 44, look: 'fence' },
];

// The streets, as the points each one bends through. Looks and a guide only: you can walk anywhere.
export const ROADS = [
  [[400, 1540], [700, 1570], [980, 1500], [1180, 1500], [1420, 1500], [1640, 1490], [1790, 1390]], // the street past home
  [[980, 1500], [860, 1300], [720, 1130], [700, 960]], // up to the garden gate
  [[1420, 1500], [1500, 1200], [1560, 935]], // north from home to the fork
  [[1500, 1200], [1370, 900], [1290, 575]], // one way on to the pantry
  [[1560, 940], [1740, 950], [1770, 650], [1750, 385]], // the other round to the far shed
  [[900, 1530], [850, 1800], [820, 2040]], // two ways down
  [[1420, 1500], [1450, 1780], [1400, 2040]],
  [[400, 2050], [820, 2040], [1090, 2045], [1400, 2040], [1700, 2030]], // the bottom street, past three doors
  [[400, 1540], [320, 1800], [400, 2050]], // and round the west side to meet it
  [[1640, 1490], [1870, 1570], [1990, 1740], [2150, 1770], [2150, 1640]], // east, and round to the foot of Tin Can Alley
].map((road) => road.map(([x, y]) => ({ x, y })));

/**
 * Points along a line of points, a step apart, each with the way it is heading. `smooth` rounds the
 * corners: the curve runs through the middle of each stretch and bends toward each corner.
 */
export function along(points, step, smooth) {
  const out = [];
  const add = (p0, c, p1) => {
    const far = Math.hypot(c.x - p0.x, c.y - p0.y) + Math.hypot(p1.x - c.x, p1.y - c.y);
    const n = Math.max(1, Math.round(far / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y, a: Math.atan2(2 * u * (c.y - p0.y) + 2 * t * (p1.y - c.y), 2 * u * (c.x - p0.x) + 2 * t * (p1.x - c.x)) });
    }
  };
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (!smooth || points.length < 3) { for (let i = 0; i < points.length - 1; i++) add(points[i], mid(points[i], points[i + 1]), points[i + 1]); return out; }
  let from = points[0];
  for (let i = 1; i < points.length - 1; i++) { const to = mid(points[i], points[i + 1]); add(from, points[i], to); from = to; }
  add(from, mid(from, points[points.length - 1]), points[points.length - 1]);
  return out;
}
/** Every street as the points it actually runs through, a few steps apart. */
export const ROAD_POINTS = ROADS.map((road) => along(road, 24, true));

// The green: the open grass below home, kept clear, where friends who stayed home potter about.
export const GREEN = { x: 930, y: 1570, w: 460, h: 200 };

// The quiet spots where strays turn up (core/strays.js): beside a street but off it, well clear of
// every door and gate, of the neighbours, of the green and of each other. Picked once, by a tool
// that looked for such ground, and kept: a spot nobody can reach, or one in the way, would be a bug.
export const WILDS = [
  [1844, 631], [244, 1914], [1412, 2119], [1359, 1300], [709, 1442], [827, 2122], [1266, 809], [1688, 1626], [295, 1508], [1643, 1016], [736, 1834], [1321, 1864],
].map(([x, y]) => ({ x, y }));

// The people of the lane, and where each stands: Ines Tock and Mr. Spick either side of the top of
// the green, in sight of home's door; Dov by the garden gate. Solid, like a lamp post; you talk to
// one from a step or two away.
export const PEOPLE = [{ id: 'ines', x: 1048, y: 1572 }, { id: 'spick', x: 1330, y: 1556 }, { id: 'dov', x: 862, y: 1092 }].map((person) => ({ ...person, r: 13 }));
export const TALK = 78; // how near counts as near enough to talk
export const personAt = (id) => PEOPLE.find((person) => person.id === id) || null;

// A lamp beside every building, on the side nearer home; two at the garden gate; a few along the streets. Thin, but solid.
export const LAMPS = [
  ...SPOTS.filter((spot) => spot.id !== 'alley').map((spot) => ({ x: spot.x + (spot.id === 'home' || spot.x < AT.home[0] ? 1 : -1) * (spot.w / 2 + 30), y: spot.y + 26, r: 7 })),
  ...[[602, 1012], [798, 1012], [800, 1470], [785, 1790], [1515, 1780], [1415, 1225], [1835, 800], [250, 1790], [2080, 1644], [2220, 1644], [1560, 900]].map(([x, y]) => ({ x, y, r: 7 })),
];

// Trees, as circles to walk round: [x, y, how big]. They were scattered once by a fixed run of
// numbers, keeping off the streets, the doors, the green and each other, and are kept as they fell,
// so that the lane people know does not shuffle about each time the map grows. New ones are planted
// by hand.
export const TREES = [
  [110, 120, 26], [870, 120, 26], [110, 860, 26], [560, 545, 24], [139, 1473, 28], [1732, 1682, 26], [529, 1345, 29], [645, 1159, 28],
  [1515, 316, 29], [230, 1110, 26], [662, 1772, 29], [1776, 975, 29], [78, 2051, 30], [1151, 258, 28], [1648, 558, 29], [1153, 1054, 24],
  [1253, 1919, 29], [111, 1815, 25], [307, 2117, 26], [1339, 139, 28], [952, 1191, 28], [1924, 2032, 27], [1910, 588, 25], [475, 1077, 26],
  [1343, 1064, 28], [1055, 466, 29], [1118, 834, 26], [1051, 654, 27], [940, 1835, 28], [82, 1205, 26], [1632, 2140, 26], [1606, 1235, 30],
  [1930, 205, 30], [1470, 615, 28], [360, 1385, 30], [1550, 1603, 25],
  [2110, 1940, 26], [2195, 2110, 25], [1930, 1330, 26],
].map(([x, y, r]) => ({ x, y, r }));

// ---------------------------------------------------------------- where feet can go

// Everything that never moves, sorted into squares of ground so a point is only checked against
// what is near it. Each thing is kept already grown by half a body's width.
const SQUARE = 200;
const ACROSS = Math.ceil(WORLD.w / SQUARE);
const DOWN = Math.ceil(WORLD.h / SQUARE);
const solid = Array.from({ length: ACROSS * DOWN }, () => []);
function stand(thing, x0, y0, x1, y1) {
  for (let r = Math.max(0, Math.floor(y0 / SQUARE)); r <= Math.min(DOWN - 1, Math.floor(y1 / SQUARE)); r++) {
    for (let c = Math.max(0, Math.floor(x0 / SQUARE)); c <= Math.min(ACROSS - 1, Math.floor(x1 / SQUARE)); c++) solid[r * ACROSS + c].push(thing);
  }
}
for (const block of [...SPOTS.map((spot) => spot.block), ...HEDGES]) {
  const b = WORLD.body;
  stand({ x0: block.x - b, y0: block.y - b, x1: block.x + block.w + b, y1: block.y + block.h + b }, block.x - b, block.y - b, block.x + block.w + b, block.y + block.h + b);
}
for (const tree of TREES) { const reach = tree.r * 0.55 + WORLD.body; stand({ x: tree.x, y: tree.y, rr: reach * reach }, tree.x - reach, tree.y - reach, tree.x + reach, tree.y + reach); } // the trunk, not the leaves
for (const post of [...LAMPS, ...PEOPLE]) { const reach = post.r + WORLD.body; stand({ x: post.x, y: post.y, rr: reach * reach }, post.x - reach, post.y - reach, post.x + reach, post.y + reach); }

const NOBODY = [];

/**
 * Whether feet can be at this point: inside the world, and not in a building, a hedge, a tree, a
 * lamp post or a person. `held` is the ground being held just now by whoever is waiting: a list of points,
 * each holding POST.hold around it unless it says otherwise ({ x, y, r }).
 */
export function canStand(x, y, held = NOBODY) {
  if (!(x >= WORLD.edge && x <= WORLD.w - WORLD.edge && y >= WORLD.edge && y <= WORLD.h - WORLD.edge)) return false;
  for (const thing of solid[Math.floor(y / SQUARE) * ACROSS + Math.floor(x / SQUARE)]) {
    if (thing.rr === undefined) { if (x > thing.x0 && x < thing.x1 && y > thing.y0 && y < thing.y1) return false; }
    else if ((x - thing.x) * (x - thing.x) + (y - thing.y) * (y - thing.y) < thing.rr) return false;
  }
  for (const post of held) {
    const reach = post.r || POST.hold; // a point may say how much ground it holds; otherwise as much as a group does
    if ((x - post.x) * (x - post.x) + (y - post.y) * (y - post.y) < reach * reach) return false;
  }
  return true;
}
/** The same question as one thing to hand round: where feet can be while this ground is held. */
export const standing = (held = NOBODY) => (x, y) => canStand(x, y, held);

/**
 * One step of walking from `pos` toward `target`, `dt` seconds long. Returns
 * the new position and whether anything moved. A wall is slid along rather
 * than stuck to; if there is no way on, you stop. `can` says where feet may be.
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
export function routeTo(from, to, can, size = WORLD) {
  const cols = Math.ceil(size.w / CELL);
  const rows = Math.ceil(size.h / CELL);
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  const col = (x) => Math.min(cols - 1, Math.max(0, Math.floor(x / CELL)));
  const row = (y) => Math.min(rows - 1, Math.max(0, Math.floor(y / CELL)));
  const start = row(from.y) * cols + col(from.x);
  const goal = row(to.y) * cols + col(to.x);
  // Each square is looked at once and remembered: 0 not yet, 1 free, 2 not.
  const known = new Uint8Array(cols * rows);
  const open = (cell) => known[cell] === 1 || (known[cell] === 0 && (known[cell] = can((cell % cols) * CELL + CELL / 2, Math.floor(cell / cols) * CELL + CELL / 2) ? 1 : 2) === 1);
  const far = (cell) => Math.hypot((cell % cols) * CELL + CELL / 2 - to.x, Math.floor(cell / cols) * CELL + CELL / 2 - to.y);
  // Breadth-first outward from where you stand, remembering how each square was reached.
  const prev = new Int32Array(cols * rows).fill(-1);
  const queue = [start];
  prev[start] = start;
  let best = start;
  let bestFar = far(start);
  for (let head = 0; head < queue.length && prev[goal] === -1; head++) {
    const cell = queue[head];
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    // Straight neighbours first, so that of two ways equally short the one with fewer bends is found.
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
  // Got there: then that is where the way ends, even if a square beside it is as near to the exact point.
  if (prev[goal] !== -1) best = goal;
  const way = [];
  for (let cell = best; cell !== start; cell = prev[cell]) way.unshift({ x: (cell % cols) * CELL + CELL / 2, y: Math.floor(cell / cols) * CELL + CELL / 2 });
  if (best === goal && can(to.x, to.y) && Math.hypot(to.x - from.x, to.y - from.y) > 2) { if (way.length) way.pop(); way.push({ x: to.x, y: to.y }); return way; }
  // The point itself is somewhere feet cannot be. The way so far ends at the middle of the nearest
  // square; go on from there straight toward the point for as long as feet can, so that a tap on
  // whoever is waiting really does walk you up to them.
  const last = way.length ? way[way.length - 1] : from;
  const gap = Math.hypot(to.x - last.x, to.y - last.y);
  let reach = 0;
  for (let far2 = 2; far2 < gap && can(last.x + ((to.x - last.x) * far2) / gap, last.y + ((to.y - last.y) * far2) / gap); far2 += 2) reach = far2;
  if (reach > 0) way.push({ x: last.x + ((to.x - last.x) * reach) / gap, y: last.y + ((to.y - last.y) * reach) / gap });
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
    // Look as far ahead as a long stride of the map, no further: the world is big and most of it is open.
    let j = Math.min(way.length - 1, i + 40);
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

/** The place whose door (or gate) you are standing at, or null. */
export function spotNear(pos) {
  let best = null;
  let bestFar = WORLD.reach;
  for (const spot of SPOTS) {
    const far = Math.hypot(pos.x - spot.door.x, pos.y - spot.door.y);
    if (far <= bestFar) { best = spot.id; bestFar = far; }
  }
  return best;
}

/** The person you are standing near enough to talk to (their id), or null. */
export function personNear(pos) {
  let best = null;
  let bestFar = TALK;
  for (const person of PEOPLE) {
    const far = Math.hypot(pos.x - person.x, pos.y - person.y);
    if (far <= bestFar) { best = person.id; bestFar = far; }
  }
  return best;
}

/** Whoever is waiting at one of these posts that you have walked up to: its number, or -1. */
export function postNear(posts, pos) {
  for (let i = 0; i < posts.length; i++) {
    if (posts[i] && Math.hypot(pos.x - posts[i].x, pos.y - posts[i].y) <= POST.meet) return i;
  }
  return -1;
}

/** A position from anywhere (a save, say) made safe: a real point feet can be at just now, or the door of home. */
export function settleWhere(raw, held = NOBODY) {
  const home = spotOf('home').door;
  if (!raw || typeof raw !== 'object' || typeof raw.x !== 'number' || typeof raw.y !== 'number') return { x: home.x, y: home.y };
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !canStand(raw.x, raw.y, held)) return { x: home.x, y: home.y };
  return { x: raw.x, y: raw.y };
}
