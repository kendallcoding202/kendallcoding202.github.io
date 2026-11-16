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
// `blocks` are the floor that furniture stands on: each is named for what stands there (a second
// one of a kind has a number on the end), and the screen has a painting for every name. `spots`
// are what there is to do and where you stand to do it; `door` is the mat you leave by and `start`
// where you stand on coming in.
export const INSIDES = {
  // Home: great-aunt Maribel's front room. Along the back wall, under its painting: the hearth
  // under the picture of the cottage, the bed under the window, the telephone under the other
  // picture. On the floor: an armchair and the tea things by the fire, the bookshelf with the
  // scrapbook on it, the basket, a chest of drawers with a lamp, and the coat stand by the door.
  home: {
    kind: 'home', view: 620, w: 620, h: 1040, wall: 284, people: 1.8,
    door: { x: 310, y: 1010 }, start: { x: 310, y: 900 },
    blocks: [
      { id: 'hearth', x: 14, y: 284, w: 170, h: 46 },
      { id: 'bed', x: 196, y: 284, w: 228, h: 68 },
      { id: 'fern', x: 438, y: 284, w: 32, h: 26 },
      { id: 'phone', x: 484, y: 284, w: 80, h: 42 },
      { id: 'armchair', x: 28, y: 452, w: 108, h: 48 },
      { id: 'teatable', x: 150, y: 476, w: 56, h: 28 },
      { id: 'shelf', x: 462, y: 516, w: 138, h: 40 },
      { id: 'basket', x: 40, y: 826, w: 116, h: 44 },
      { id: 'drawers', x: 496, y: 800, w: 100, h: 40 },
      { id: 'coats', x: 400, y: 952, w: 36, h: 24 },
    ],
    spots: [
      { id: 'bed', x: 310, y: 410, does: 'rest' },
      { id: 'phone', x: 576, y: 376, does: 'ring' }, // (beside the telephone, not in front of it: it should be seen)
      { id: 'shelf', x: 531, y: 606, does: 'book' },
      { id: 'basket', x: 236, y: 852, does: 'team' },
    ],
    posts: [],
  },
  // The Midnight Pantry: shelves the length of the back wall, and stores stood about its sides in
  // twos: sacks and barrels, crates of potatoes and milk, tins, jars, a cheese, eggs, the scales.
  pantry: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'potatoes', x: 30, y: 1470, w: 66, h: 28 }, { id: 'barrel', x: 100, y: 1446, w: 50, h: 26 },
      { id: 'milk', x: 668, y: 1296, w: 60, h: 26 }, { id: 'pickles', x: 624, y: 1322, w: 40, h: 24 },
      { id: 'tins', x: 30, y: 1046, w: 54, h: 26 }, { id: 'sack', x: 88, y: 1070, w: 54, h: 26 },
      { id: 'scales', x: 668, y: 836, w: 58, h: 26 }, { id: 'eggs', x: 612, y: 862, w: 52, h: 24 },
      { id: 'cheese', x: 34, y: 630, w: 48, h: 24 }, { id: 'onions', x: 86, y: 654, w: 56, h: 24 },
      { id: 'barrel2', x: 676, y: 430, w: 50, h: 26 }, { id: 'sack2', x: 618, y: 452, w: 54, h: 26 },
      { id: 'stool', x: 36, y: 404, w: 52, h: 26 },
      // Against the back wall, either side of where the Crumbwyrm waits.
      { id: 'barrel3', x: 40, y: 202, w: 50, h: 26 }, { id: 'sack3', x: 96, y: 206, w: 54, h: 26 },
      { id: 'milk2', x: 652, y: 204, w: 60, h: 26 }, { id: 'tins2', x: 592, y: 208, w: 54, h: 26 },
    ],
    spots: [],
    posts: [{ x: 250, y: 1290 }, { x: 520, y: 1070 }, { x: 250, y: 840 }, { x: 520, y: 610 }, { x: 380, y: 350 }],
  },
  // The Wash: the launderette. Ten machines along the back wall; Machine Six is the one that glows.
  wash: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'trolley', x: 30, y: 1456, w: 62, h: 28 }, { id: 'basket', x: 96, y: 1480, w: 54, h: 26 },
      { id: 'chair', x: 682, y: 1300, w: 46, h: 24 }, { id: 'chair2', x: 632, y: 1300, w: 46, h: 24 },
      { id: 'airer', x: 30, y: 1200, w: 78, h: 26 }, { id: 'socks', x: 112, y: 1226, w: 58, h: 22 },
      { id: 'hamper', x: 680, y: 960, w: 48, h: 26 }, { id: 'towels', x: 628, y: 984, w: 48, h: 24 },
      { id: 'ironing', x: 30, y: 730, w: 72, h: 26 }, { id: 'soapbox', x: 106, y: 752, w: 42, h: 24 },
      { id: 'bucket', x: 690, y: 470, w: 40, h: 24 }, { id: 'sign', x: 640, y: 492, w: 44, h: 22 },
      { id: 'hamper2', x: 40, y: 204, w: 48, h: 26 }, { id: 'towels2', x: 94, y: 208, w: 48, h: 24 },
      { id: 'trolley2', x: 668, y: 204, w: 62, h: 28 }, { id: 'soapbox2', x: 620, y: 210, w: 42, h: 24 },
    ],
    spots: [],
    posts: [{ x: 510, y: 1290 }, { x: 240, y: 1070 }, { x: 510, y: 840 }, { x: 240, y: 610 }, { x: 380, y: 350 }],
  },
  // The Dusty Stacks: the old library. Bookcases the length of the back wall.
  stacks: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'trolley', x: 30, y: 1440, w: 64, h: 26 }, { id: 'pile', x: 98, y: 1462, w: 46, h: 24 },
      { id: 'armchair', x: 656, y: 1420, w: 72, h: 30 }, { id: 'plant', x: 612, y: 1452, w: 40, h: 24 },
      { id: 'desk', x: 654, y: 1150, w: 74, h: 28 }, { id: 'tomes', x: 600, y: 1176, w: 50, h: 22 },
      { id: 'catalogue', x: 30, y: 830, w: 74, h: 30 }, { id: 'steps', x: 108, y: 858, w: 50, h: 24 },
      { id: 'lectern', x: 664, y: 610, w: 64, h: 28 }, { id: 'pile2', x: 612, y: 636, w: 46, h: 24 },
      { id: 'globe', x: 40, y: 420, w: 44, h: 24 }, { id: 'inkdesk', x: 88, y: 440, w: 52, h: 24 },
      { id: 'plant2', x: 40, y: 204, w: 40, h: 24 }, { id: 'tomes2', x: 86, y: 210, w: 50, h: 22 },
      { id: 'armchair2', x: 650, y: 204, w: 72, h: 30 },
    ],
    spots: [],
    posts: [{ x: 380, y: 1300 }, { x: 220, y: 1060 }, { x: 540, y: 860 }, { x: 240, y: 620 }, { x: 380, y: 350 }],
  },
  // Moonlit Rooftops: in at the door, up the stairs and out by a hatch onto the slates. The back
  // wall is the sky over the town, so it stands taller than a room's.
  rooftops: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 300, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'planter', x: 30, y: 1440, w: 90, h: 26 },
      { id: 'chimney', x: 650, y: 1380, w: 70, h: 34 }, { id: 'slates', x: 590, y: 1410, w: 56, h: 24 },
      { id: 'tank', x: 34, y: 1060, w: 74, h: 30 }, { id: 'pot', x: 112, y: 1090, w: 34, h: 22 },
      { id: 'dovecote', x: 664, y: 800, w: 56, h: 24 }, { id: 'dish', x: 610, y: 826, w: 50, h: 22 },
      { id: 'finial', x: 690, y: 540, w: 40, h: 26 }, { id: 'pot2', x: 650, y: 562, w: 34, h: 22 },
      { id: 'chimney2', x: 36, y: 420, w: 70, h: 34 }, { id: 'aerial', x: 116, y: 450, w: 30, h: 20 },
      { id: 'planter2', x: 640, y: 318, w: 90, h: 26 },
    ],
    spots: [],
    posts: [{ x: 240, y: 1300 }, { x: 520, y: 1120 }, { x: 380, y: 860 }, { x: 220, y: 620 }, { x: 400, y: 390 }],
  },
  // The Tick-Tock Attic: under the rafters, among the trunks and the dust sheets. Its back wall is
  // the gable end, taller than a room's, with the shelf of clocks along it.
  attic: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 350, people: 1,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'trunk', x: 30, y: 1400, w: 76, h: 30 }, { id: 'dummy', x: 112, y: 1430, w: 34, h: 22 },
      { id: 'toys', x: 650, y: 1440, w: 76, h: 30 },
      { id: 'sheet', x: 656, y: 1080, w: 70, h: 28 }, { id: 'cage', x: 614, y: 1108, w: 36, h: 22 },
      { id: 'boxes', x: 30, y: 860, w: 60, h: 28 }, { id: 'rug', x: 94, y: 884, w: 60, h: 26 },
      { id: 'cases', x: 656, y: 620, w: 68, h: 28 }, { id: 'mirror', x: 608, y: 646, w: 44, h: 24 },
      { id: 'horse', x: 34, y: 470, w: 78, h: 28 }, { id: 'gramophone', x: 116, y: 496, w: 50, h: 24 },
      { id: 'boxes2', x: 60, y: 356, w: 60, h: 28 }, { id: 'trunk2', x: 630, y: 354, w: 76, h: 30 },
    ],
    spots: [],
    posts: [{ x: 520, y: 1300 }, { x: 250, y: 1100 }, { x: 500, y: 860 }, { x: 250, y: 680 }, { x: 380, y: 440 }],
  },
  // The Roaring Dark: the cupboard under the stairs. `dim`: you see only as far as your own lantern.
  dark: {
    kind: 'place', view: 760, w: 760, h: 1640, wall: 200, people: 1, dim: true,
    door: { x: 380, y: 1610 }, start: { x: 380, y: 1500 },
    blocks: [
      { id: 'shoes', x: 654, y: 1400, w: 70, h: 28 }, { id: 'umbrellas', x: 612, y: 1426, w: 38, h: 22 },
      { id: 'cables', x: 30, y: 1440, w: 70, h: 26 },
      { id: 'ladder', x: 34, y: 1080, w: 56, h: 24 }, { id: 'paint', x: 94, y: 1104, w: 52, h: 24 },
      { id: 'toolbox', x: 660, y: 860, w: 64, h: 24 }, { id: 'reel', x: 604, y: 884, w: 52, h: 24 },
      { id: 'papers', x: 30, y: 640, w: 58, h: 24 }, { id: 'board', x: 92, y: 664, w: 28, h: 20 },
      { id: 'shoeboxes', x: 680, y: 420, w: 46, h: 24 }, { id: 'broom', x: 626, y: 444, w: 52, h: 24 },
      { id: 'paint2', x: 36, y: 404, w: 52, h: 24 }, { id: 'cables2', x: 92, y: 430, w: 70, h: 26 },
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
