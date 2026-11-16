// Indoors: a building you can walk into is a floor of its own. Rules only,
// like world.js: where things stand, where feet can go, what there is to do.
//
// The lane outside is one area and each inside is another; a door joins two.
// While you are indoors the save keeps both: where you stand on that floor
// (`state.indoors`) and, out in the lane, the door you came in by
// (`state.where`). So everything that asks "where are you in the world" still
// has an answer, and stepping out puts you where you went in.
//
// Two sorts of inside. Home is somewhere to be: a bed, the telephone, the
// scrapbook, and whoever of your friends is not out walking with you. A place
// (the Midnight Pantry and the five after it) is somewhere to calm: whoever is restless there waits
// at its `posts`, one group to each stop of the room's path, its ringleader
// last, exactly as in the garden.
import { own } from './util.js';
import { POST, stepWalk, routeTo, straighten, roomy } from './world.js';

export const INDOOR = {
  edge: 30, // how near the side walls feet may go
  back: 16, // and how near the back wall
  front: 22, // and the front
  body: 12, // half the width of whoever is walking, against furniture
  reach: 70, // how near a thing counts as being at it
  out: 26, // how near the door mat is stepping out
};

// Every inside is seen from the front: the back wall across the top (`wall` tall), the floor below
// it. x runs across and y down. `view` is how much of it fits across a phone.
//
// Scale. Out in the lane a person stands 96 units tall beside a cottage 240 wide: people are big
// for their buildings, as on any map. Indoors that will not do: a bed has to be a bed's length
// beside whoever sleeps in it. So a room says how big `people` are drawn on its floor, against
// the lane (home: nearly twice, which makes its bookshelf a little taller than you and its bed
// long enough to lie in), and everything about a body there (how wide it is, how far apart
// friends walk) goes by that. A place where groups wait keeps the lane's own scale, as the
// garden does, and its floor is drawn to that.
// `blocks` are the floor that furniture stands on; `spots` what there is to do and where you stand
// to do it; `door` is the mat you leave by and `start` where you stand on coming in.
export const INSIDES = {
  home: {
    kind: 'home', view: 620, w: 620, h: 1040, wall: 270, people: 1.8,
    door: { x: 310, y: 1010 }, start: { x: 310, y: 900 },
    blocks: [
      { id: 'bed', x: 26, y: 270, w: 236, h: 124 },
      { id: 'phone', x: 276, y: 270, w: 64, h: 54 },
      { id: 'shelf', x: 356, y: 270, w: 120, h: 46 },
      { id: 'hearth', x: 490, y: 270, w: 110, h: 56 },
      { id: 'basket', x: 64, y: 706, w: 116, h: 56 },
    ],
    spots: [
      { id: 'bed', x: 150, y: 452, does: 'rest' },
      { id: 'phone', x: 308, y: 392, does: 'ring' },
      { id: 'shelf', x: 420, y: 384, does: 'book' },
      { id: 'basket', x: 252, y: 760, does: 'team' },
    ],
    posts: [],
  },
  pantry: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'crates', x: 30, y: 1446, w: 90, h: 54 },
      { id: 'boxes', x: 646, y: 1256, w: 84, h: 50 },
      { id: 'bottles', x: 30, y: 1018, w: 80, h: 48 },
      { id: 'pallets', x: 646, y: 806, w: 84, h: 48 },
      { id: 'sacks', x: 30, y: 478, w: 84, h: 50 },
      { id: 'crates2', x: 646, y: 430, w: 84, h: 50 },
      { id: 'boxes2', x: 30, y: 760, w: 80, h: 48 },
    ],
    spots: [],
    posts: [{ x: 250, y: 1290 }, { x: 520, y: 1070 }, { x: 250, y: 840 }, { x: 520, y: 610 }, { x: 380, y: 350 }],
  },
  // The Wash: the launderette. A row of machines along the back wall; Machine Six is the one that roars.
  wash: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'hamper', x: 646, y: 1440, w: 84, h: 50 }, { id: 'bottles', x: 30, y: 1210, w: 80, h: 48 }, { id: 'hamper2', x: 646, y: 960, w: 84, h: 50 },
      { id: 'boxes', x: 30, y: 730, w: 84, h: 50 }, { id: 'hamper3', x: 646, y: 480, w: 84, h: 50 },
    ],
    spots: [],
    posts: [{ x: 510, y: 1290 }, { x: 240, y: 1070 }, { x: 510, y: 840 }, { x: 240, y: 610 }, { x: 380, y: 350 }],
  },
  // The Dusty Stacks: the old library. Bookcases the length of the back wall, a runner down the middle.
  stacks: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'books', x: 30, y: 1420, w: 84, h: 50 }, { id: 'boxes', x: 646, y: 1160, w: 84, h: 50 }, { id: 'books2', x: 30, y: 820, w: 84, h: 50 },
      { id: 'books3', x: 646, y: 600, w: 84, h: 50 }, { id: 'boxes2', x: 30, y: 420, w: 84, h: 50 },
    ],
    spots: [],
    posts: [{ x: 380, y: 1300 }, { x: 220, y: 1060 }, { x: 540, y: 860 }, { x: 240, y: 620 }, { x: 380, y: 350 }],
  },
  // Moonlit Rooftops: in at the door, up the stairs and out onto the slates. The sky is the back wall.
  rooftops: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'chimney', x: 646, y: 1380, w: 84, h: 50 }, { id: 'chimney2', x: 30, y: 1060, w: 84, h: 50 }, { id: 'chimney3', x: 646, y: 800, w: 84, h: 50 },
      { id: 'chimney4', x: 30, y: 400, w: 84, h: 50 }, { id: 'chimney5', x: 646, y: 500, w: 84, h: 50 },
    ],
    spots: [],
    posts: [{ x: 240, y: 1300 }, { x: 520, y: 1120 }, { x: 380, y: 860 }, { x: 220, y: 620 }, { x: 400, y: 350 }],
  },
  // The Tick-Tock Attic: under the rafters, among the trunks and the dust sheets.
  attic: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'trunk', x: 30, y: 1400, w: 84, h: 50 }, { id: 'sheet', x: 646, y: 1080, w: 84, h: 50 }, { id: 'boxes', x: 30, y: 860, w: 84, h: 50 },
      { id: 'trunk2', x: 646, y: 620, w: 84, h: 50 }, { id: 'sheet2', x: 30, y: 400, w: 84, h: 50 },
    ],
    spots: [],
    posts: [{ x: 520, y: 1300 }, { x: 250, y: 1100 }, { x: 500, y: 860 }, { x: 250, y: 640 }, { x: 380, y: 360 }],
  },
  // The Roaring Dark: the cupboard under the stairs. `dim`: you see only as far as your own lantern.
  dark: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1, dim: true,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'boxes', x: 646, y: 1400, w: 84, h: 50 }, { id: 'bucket', x: 30, y: 1080, w: 84, h: 50 }, { id: 'crates', x: 646, y: 860, w: 84, h: 50 },
      { id: 'boxes2', x: 30, y: 640, w: 84, h: 50 }, { id: 'bucket2', x: 646, y: 420, w: 84, h: 50 },
    ],
    spots: [],
    posts: [{ x: 260, y: 1290 }, { x: 520, y: 1090 }, { x: 260, y: 880 }, { x: 520, y: 660 }, { x: 380, y: 380 }],
  },
};
export const INSIDE_IDS = Object.keys(INSIDES);
export const insideOf = (id) => (own(INSIDES, id) ? INSIDES[id] : null);

const NOBODY = [];

/**
 * Whether feet can be at this point of a floor: on it, clear of the walls, and not in the furniture.
 * `held` is the ground being held just now by whoever is waiting there (see world.canStand).
 */
export function canStandIn(room, x, y, held = NOBODY) {
  if (!(x >= INDOOR.edge && x <= room.w - INDOOR.edge && y >= room.wall + INDOOR.back && y <= room.h - INDOOR.front)) return false;
  const body = INDOOR.body * (room.people || 1);
  for (const block of room.blocks) {
    if (x > block.x - body && x < block.x + block.w + body && y > block.y - body && y < block.y + block.h + body) return false;
  }
  for (const post of held) {
    const reach = post.r || POST.hold;
    if ((x - post.x) * (x - post.x) + (y - post.y) * (y - post.y) < reach * reach) return false;
  }
  return true;
}
/** The same question as one thing to hand round. */
export const standingIn = (room, held = NOBODY) => (x, y) => canStandIn(room, x, y, held);

/** One step of walking across a floor: see world.stepWalk. */
export const stepIn = (room, pos, target, dt, held = NOBODY) => stepWalk(pos, target, dt, standingIn(room, held));

/** The way across a floor from one point to another, round the furniture and whoever is waiting. */
export function routeIn(room, from, to, held = NOBODY) {
  const can = roomy(standingIn(room, held));
  return straighten(from, routeTo(from, to, can, room), can);
}

/** What you are standing by on this floor (one of its `spots`), or null. */
export function spotIn(room, pos) {
  let best = null;
  let bestFar = INDOOR.reach;
  for (const spot of room.spots) {
    const far = Math.hypot(pos.x - spot.x, pos.y - spot.y);
    if (far <= bestFar) { best = spot; bestFar = far; }
  }
  return best;
}

/** Whether standing here is standing on the door mat: one more step and you are outside. */
export const onMat = (room, pos) => Math.hypot(pos.x - room.door.x, pos.y - room.door.y) <= INDOOR.out;

/** A place to stand just short of a post: straight below it, or failing that either side or above. For tests and the simulator. */
export function besidePost(room, post, held = NOBODY) {
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
    const x = post.x + dx * (POST.hold + 8);
    const y = post.y + dy * (POST.hold + 8);
    if (canStandIn(room, x, y, held)) return { x, y };
  }
  return null;
}

/** A point on a floor from anywhere (a save, say) made safe: itself if feet can be there, otherwise where you come in. */
export function settleIn(room, raw, held = NOBODY) {
  if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !canStandIn(room, raw.x, raw.y, held)) return { x: room.start.x, y: room.start.y };
  return { x: raw.x, y: raw.y };
}
