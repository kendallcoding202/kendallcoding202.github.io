// The world: one open map, much bigger than the screen every way, that you walk
// around freely. At the top is the lane: home in the middle of it, the garden a
// hedged corner you walk straight into, Tin Can Alley down its east side, the
// Midnight Pantry north of home. From the foot of the lane a road runs south
// through open country to two more clusters of places, and at the far end of
// the last of those is the far shed. Below that runs the river, from one side of
// the world to the other, with one bridge over it; and beyond the bridge is the
// far bank, chapter two: two more streets and four more places. It is all one
// map: no doors between.
// Rules only: where things stand, where feet can go, and how one step of
// walking works. No drawing, no clock: the caller says how much time has passed.
import { ROOM_IDS } from './balance.js';
import { own } from './util.js';

export const WORLD = {
  w: 2280, h: 7700, // the size of the world, in its own units: the lane is the top 2200 of it, the far bank the last 2050
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

// The world from top to bottom: each stretch has a name, which is what the heading says while you
// are in it. `y` is where it begins.
export const REGIONS = [
  { id: 'lane', name: 'The Lane', y: 0 },
  { id: 'bramble', name: 'Bramble Way', y: 2200 },
  { id: 'row', name: 'Lampwick Row', y: 3120 },
  { id: 'meadow', name: 'Long Meadow', y: 3640 },
  { id: 'hill', name: 'Chimney Hill', y: 4560 },
  { id: 'bank', name: 'Far Bank', y: 5535 }, // (from the middle of the river)
  { id: 'bobbin', name: 'Bobbin Row', y: 6760 },
];
/** The stretch of the world a point is in. */
export function regionAt(pos) {
  let found = REGIONS[0];
  for (const region of REGIONS) if (pos && pos.y >= region.y) found = region;
  return found;
}

// Every building: x is the middle of its front, y the foot of its front wall. Fronts face down the
// map, so streets run along the foot of each row. The garden's shed stands inside the garden.
// On the lane: home, the garden, Tin Can Alley, the Midnight Pantry. On Lampwick Row: the Wash and
// the Dusty Stacks. On Chimney Hill: Moonlit Rooftops and the Tick-Tock Attic, and down Dark Lane
// at the very end, the far shed. Over the bridge, on Far Bank: the Glasshouse and the Deep End (the
// old bath house). On Bobbin Row: the Mending Room and the Tinker's Shed.
const AT = {
  home: [1180, 1420], garden: [250, 262], alley: [1880, 1860], pantry: [1290, 520],
  wash: [760, 3330], stacks: [1540, 3330],
  rooftops: [1520, 4830], attic: [720, 4830],
  dark: [380, 5240],
  glasshouse: [640, 6080], deepend: [1640, 6080],
  shed: [1580, 7260], mending: [680, 7260],
};
// Most buildings are much of a size; home is broader, and two are tall and thin.
const WIDE = { home: 226, wash: 176, rooftops: 136, attic: 158, glasshouse: 216, deepend: 186, shed: 206 };
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

// The river: water from one side of the world to the other, below Chimney Hill. Nobody walks on
// water; the one way over is Kettle Bridge. Across the north end of the bridge stands a gate with
// eight locks, one for each key of the lane: it is shut until all eight places there are calm (see
// rooms.bridgeOpen), and `BRIDGE.gate` is the ground it holds while it is.
export const RIVER = { y: 5440, h: 190 };
export const BRIDGE = { x: 1090, w: 180, y: RIVER.y - 22, h: RIVER.h + 44, gate: { x: 1180, y: RIVER.y - 6, r: 104 } };
/** The water either side of the bridge, as blocks nobody can stand in. */
export const WATER = [
  { x: 0, y: RIVER.y, w: BRIDGE.x, h: RIVER.h },
  { x: BRIDGE.x + BRIDGE.w, y: RIVER.y, w: 2280 - BRIDGE.x - BRIDGE.w, h: RIVER.h },
];
/** Whether a point is on the bridge. */
export const onBridge = (pos) => !!pos && pos.x > BRIDGE.x && pos.x < BRIDGE.x + BRIDGE.w && pos.y > BRIDGE.y && pos.y < BRIDGE.y + BRIDGE.h;
/** What the heading says where you stand: the name of the stretch of the world you are in, or of the bridge while you are on it. */
export const whereabouts = (pos) => (onBridge(pos) ? 'Kettle Bridge' : regionAt(pos).name);
/** Whether a point is south of the river: on the far bank. */
export const overTheWater = (pos) => !!pos && pos.y > RIVER.y + RIVER.h / 2;

// Walls: solid blocks of ground, each made of whatever suits the place (`look`). The first three
// are the garden's hedge, leaving its gate; the rest wall Tin Can Alley off with junk, and fence
// its foot either side of its gate.
export const HEDGES = [
  { x: 0, y: 940, w: 630, h: 44, look: 'bush' }, { x: 770, y: 940, w: 214, h: 44, look: 'bush' },
  { x: 940, y: 0, w: 44, h: 940, look: 'bush' },
  { x: 2000, y: 0, w: 40, h: 1560, look: 'junk' },
  { x: 2000, y: 1560, w: 80, h: 44, look: 'fence' }, { x: 2220, y: 1560, w: 60, h: 44, look: 'fence' },
  // Hedgerows out in the country: lengths of hedge along the roads, with plenty of gaps. Looks, and
  // something to walk round; none of them shuts anything in.
  { x: 560, y: 2330, w: 300, h: 44, look: 'bush' }, { x: 1230, y: 2400, w: 44, h: 200, look: 'bush' },
  { x: 1420, y: 2760, w: 300, h: 44, look: 'bush' }, { x: 640, y: 2800, w: 260, h: 44, look: 'bush' },
  { x: 1340, y: 3030, w: 44, h: 190, look: 'bush' },
  { x: 1300, y: 3760, w: 280, h: 44, look: 'bush' }, { x: 2040, y: 3900, w: 44, h: 220, look: 'bush' },
  { x: 1240, y: 4160, w: 44, h: 220, look: 'bush' }, { x: 1960, y: 4380, w: 200, h: 44, look: 'bush' },
  { x: 560, y: 5120, w: 44, h: 200, look: 'bush' },
  // And a length of white fence in front of a garden or two, on the rows.
  { x: 520, y: 3500, w: 260, h: 26, look: 'picket' }, { x: 1480, y: 3500, w: 180, h: 26, look: 'picket' },
  { x: 1300, y: 5000, w: 260, h: 26, look: 'picket' },
  // The far bank: hedgerows along its roads, and white fence in front of a garden on each street.
  { x: 1400, y: 5760, w: 280, h: 44, look: 'bush' }, { x: 640, y: 5800, w: 44, h: 150, look: 'bush' },
  { x: 880, y: 6430, w: 300, h: 44, look: 'bush' }, { x: 1500, y: 6560, w: 44, h: 200, look: 'bush' },
  { x: 1040, y: 6800, w: 44, h: 220, look: 'bush' }, { x: 1240, y: 7560, w: 260, h: 44, look: 'bush' },
  { x: 820, y: 6250, w: 240, h: 26, look: 'picket' }, { x: 900, y: 7430, w: 180, h: 26, look: 'picket' },
];

// The streets, as the points each one bends through. Looks and a guide only: you can walk anywhere.
export const ROADS = [
  [[400, 1540], [700, 1570], [980, 1500], [1180, 1500], [1420, 1500], [1640, 1490], [1870, 1570], [1990, 1740], [2150, 1770], [2150, 1640]], // the street past home, east and round to the foot of Tin Can Alley
  [[980, 1500], [860, 1300], [720, 1130], [700, 960]], // up to the garden gate
  [[1420, 1500], [1500, 1200], [1560, 935]], // north from home to the fork
  [[1500, 1200], [1370, 900], [1290, 575]], // one way on to the pantry
  [[1560, 940], [1740, 950], [1800, 700]], // the other out to the old orchard
  [[900, 1530], [850, 1800], [980, 2040], [1120, 2170]], // two ways down from the street to where the lane ends
  [[1420, 1500], [1450, 1780], [1300, 2040], [1120, 2170]],
  [[400, 1540], [320, 1800], [520, 2050], [980, 2040]], // the back path, round the west field
  [[1120, 2170], [1010, 2420], [1240, 2680], [1060, 2930], [1150, 3150], [1150, 3400]], // Bramble Way, south to Lampwick Row
  [[420, 3400], [760, 3400], [1150, 3400], [1540, 3400], [1860, 3410]], // Lampwick Row, past two doors
  [[1860, 3410], [1960, 3660], [1740, 3930], [1880, 4230], [1760, 4560], [1880, 4900]], // across Long Meadow to Chimney Hill
  [[380, 4900], [720, 4900], [1120, 4900], [1520, 4900], [1880, 4900]], // the street on Chimney Hill, past two more
  [[380, 4900], [250, 5060], [232, 5250], [380, 5302]], // and Dark Lane, down and round to the door of the far shed
  [[1200, 4900], [1215, 5100], [1180, 5300], [1180, 5640], [1165, 5850], [1140, 6150]], // from Chimney Hill down to Kettle Bridge, over it, and up to Far Bank
  [[360, 6150], [640, 6150], [1140, 6150], [1640, 6150], [1920, 6160]], // the street on Far Bank, past two doors
  [[360, 6150], [300, 6420], [520, 6700], [380, 6980], [470, 7330]], // the west way down to Bobbin Row
  [[1920, 6160], [2000, 6450], [1800, 6750], [1930, 7050], [1900, 7330]], // and the east way
  [[470, 7330], [680, 7330], [1120, 7330], [1580, 7330], [1900, 7330]], // Bobbin Row, past two more
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

// Where each chapter's Keepsake is to be found, once that chapter's places are all calm: the old
// orchard at the top of the lane, north of where its road ends; and the river's far bank, west of
// the bridge. Open ground, off the streets, clear of everything, with room beside it for the dust
// bunny who shows you the way (`FLUFF_BESIDE`).
export const HAUNTS = { 1: { x: 1800, y: 520 }, 2: { x: 540, y: 5760 } };
export const FLUFF_BESIDE = { x: -66, y: 12 };

// The quiet spots where strays turn up (core/strays.js): beside a street but off it, well clear of
// every door and gate, of the neighbours, the benches, the green and each other. Most are out in the
// country between the rows of houses; a few are in the corners of the lane. Picked once, by a tool
// that looked for such ground, and kept: a spot nobody can reach, or one in the way, would be a bug.
export const WILDS = [
  [1706, 730], [1199, 789], [682, 1304], [1865, 1424], [235, 1625], [449, 2125], [1314, 2202], [991, 2203],
  [1311, 2799], [950, 2953], [420, 3260], [1010, 3325], [2013, 3421], [2019, 3781], [1643, 3947], [1688, 4347],
  [1946, 4666], [944, 4760], [380, 4760], [1273, 4816], [1835, 5040], [119, 5276],
  // On the far bank: nobody strays there until the bridge is open (see strays.js), so these come last.
  [1080, 6234], [2083, 6247], [259, 6250], [1793, 6506], [284, 6624], [614, 6680], [1968, 6855], [282, 7159], [993, 7218], [1854, 7470],
].map(([x, y]) => ({ x, y }));

// Things that stand about the country and the rows of houses: benches, signposts, a well, haystacks,
// ponds. [what, x, y, and for a signpost what it says]. Solid: each takes up as much ground as
// PROP_ROUND says. A bench is somewhere to sit down and get your breath back when home is a long
// walk off: one on Lampwick Row and one on Chimney Hill.
export const PROP_ROUND = { bench: 22, signpost: 8, well: 30, haystack: 32, scarecrow: 9, logs: 28, rock: 26, wheelbarrow: 24, mailbox: 7, pond: 50, boat: 34, reeds: 14, beehive: 18, barrow: 28, pump: 24, crates: 26 };
export const PROPS = [
  ['mailbox', 1036, 1452],
  ['signpost', 1210, 2236, 'South: Bramble Way, and Lampwick Row'],
  ['well', 640, 1840],
  ['pond', 1930, 880],
  ['rock', 1760, 1260],
  ['logs', 300, 1290],
  ['pond', 520, 2640],
  ['haystack', 1520, 2560],
  ['scarecrow', 780, 2620],
  ['logs', 1500, 2920],
  ['rock', 300, 2940],
  ['rock', 1960, 2450],
  ['haystack', 360, 2300],
  ['bench', 1320, 3490],
  ['well', 1000, 3570],
  ['mailbox', 895, 3307],
  ['mailbox', 1672, 3362],
  ['wheelbarrow', 1760, 3540],
  ['signpost', 1212, 3512, 'North: The Lane. East: Long Meadow'],
  ['haystack', 1380, 3990],
  ['haystack', 900, 4280],
  ['haystack', 560, 3920],
  ['scarecrow', 1100, 4130],
  ['pond', 640, 4420],
  ['rock', 420, 4180],
  ['logs', 2100, 4520],
  ['signpost', 1660, 4560, 'South: Chimney Hill'],
  ['bench', 1120, 4990],
  ['mailbox', 1620, 4844],
  ['mailbox', 835, 4807],
  ['wheelbarrow', 900, 5020],
  ['signpost', 470, 4990, 'Down Dark Lane: the far shed'],
  ['logs', 700, 5230],
  ['rock', 2010, 5210],
  ['well', 1700, 5120],
  // The far bank. A signpost at each end of the bridge; a boat pulled up below it; a bench and a
  // mailbox or two on each street; and what stands about a place where people grow and mend things.
  ['signpost', 1336, 5296, 'South: Kettle Bridge, and the Far Bank'],
  ['boat', 900, 5700],
  ['reeds', 1400, 5672], ['reeds', 640, 5676], ['reeds', 1960, 5680], ['reeds', 300, 5674],
  ['signpost', 1262, 5830, 'North: the bridge, and the lane'],
  ['mailbox', 824, 6066],
  ['mailbox', 1775, 6062],
  ['bench', 1320, 6240],
  ['beehive', 330, 5940], ['beehive', 436, 5890],
  ['barrow', 950, 5990],
  ['pump', 1900, 5920],
  ['crates', 1400, 6020],
  ['signpost', 1212, 6276, 'South, either way round: Bobbin Row'],
  ['pond', 1300, 6640],
  ['haystack', 760, 6560],
  ['rock', 1640, 6900],
  ['logs', 700, 6900],
  ['scarecrow', 1320, 7020],
  ['mailbox', 520, 7250],
  ['mailbox', 1715, 7242],
  ['bench', 1120, 7420],
  ['pump', 1120, 7200],
  ['crates', 1830, 7200],
  ['barrow', 380, 7480],
  ['well', 1700, 7540],
].map(([kind, x, y, says]) => ({ kind, x, y, r: PROP_ROUND[kind], ...(says ? { says } : {}) }));
export const BENCHES = PROPS.filter((prop) => prop.kind === 'bench').map((bench) => ({ ...bench, id: regionAt(bench).id }));
export const SIT = 84; // how near counts as at a bench
/** The bench you are standing at (the id of the stretch of the world it is in), or null. */
export function benchNear(pos) {
  for (const bench of BENCHES) if (pos && Math.hypot(pos.x - bench.x, pos.y - bench.y) <= SIT) return bench.id;
  return null;
}

// Mailboxes: one by home and one by each of the four far houses. Ines Tock lives on the green, a
// long walk from the rows beyond; a note posted in any of these reaches her, and her answer comes
// by return. So telling her a place is calm never means walking the length of the world.
export const MAILBOXES = PROPS.filter((prop) => prop.kind === 'mailbox');
export const POST_REACH = 76; // how near counts as at a mailbox
/** The mailbox you are standing at (its number), or -1. */
export function mailNear(pos) {
  for (let i = 0; i < MAILBOXES.length; i++) if (pos && Math.hypot(pos.x - MAILBOXES[i].x, pos.y - MAILBOXES[i].y) <= POST_REACH) return i;
  return -1;
}

// The people of the lane, and where each stands: Ines Tock and Mr. Spick either side of the top of
// the green, in sight of home's door; Dov by the garden gate. Solid, like a lamp post; you talk to
// one from a step or two away.
export const PEOPLE = [{ id: 'ines', x: 1048, y: 1572 }, { id: 'spick', x: 1330, y: 1556 }, { id: 'dov', x: 862, y: 1092 }].map((person) => ({ ...person, r: 13 }));
export const TALK = 78; // how near counts as near enough to talk
export const personAt = (id) => PEOPLE.find((person) => person.id === id) || null;

// A lamp beside every building, on the side nearer the middle of the map; two at the garden gate; some
// along the streets, and a lonely few out in the country. Thin, but solid.
export const LAMPS = [
  ...SPOTS.filter((spot) => spot.id !== 'alley').map((spot) => ({ x: spot.x + (spot.id === 'home' || spot.x < AT.home[0] ? 1 : -1) * (spot.w / 2 + 30), y: spot.y + 26, r: 7 })),
  ...[[602, 1012], [798, 1012], [800, 1470], [785, 1790], [1515, 1780], [1415, 1225], [250, 1790], [2080, 1644], [2220, 1644], [1560, 900],
    [1050, 2230], [1300, 2700], [1090, 3130], [440, 3350], [1085, 3345], [1890, 3350], [2020, 3690], [1940, 4270], [400, 4850], [1120, 4850], [1920, 4850], [170, 5080],
    // The far end of the bridge (the gateposts at the near end carry lanterns of their own), and along the two streets beyond it.
    [1060, 5682], [1300, 5682], [380, 6100], [1076, 6096], [1900, 6100], [300, 6500], [2064, 6500], [404, 7290], [1120, 7280], [1964, 7290]].map(([x, y]) => ({ x, y, r: 7 })),
];

// Trees, as circles to walk round: [x, y, how big]. They were scattered once by a fixed run of
// numbers, keeping off the streets, the doors, the green and each other, and are kept as they fell,
// so that the lane people know does not shuffle about each time the map grows. New ones are planted
// by hand.
export const TREES = [
  [110, 120, 26], [870, 120, 26], [110, 860, 26], [560, 545, 24], [139, 1473, 28], [1732, 1682, 26], [529, 1345, 29], [645, 1159, 28],
  [1515, 316, 29], [230, 1110, 26], [1776, 975, 29], [78, 2051, 30], [1151, 258, 28], [1648, 558, 29], [1153, 1054, 24], [1253, 1919, 29],
  [111, 1815, 25], [307, 2117, 26], [1339, 139, 28], [952, 1191, 28], [1924, 2032, 27], [1910, 588, 25], [475, 1077, 26], [1343, 1064, 28],
  [1055, 466, 29], [1118, 834, 26], [1051, 654, 27], [82, 1205, 26], [1632, 2140, 26], [1606, 1235, 30], [1930, 205, 30], [1470, 615, 28],
  [360, 1385, 30], [1550, 1603, 25], [2110, 1940, 26], [2195, 2110, 25], [1930, 1330, 26],
  // Out in the country and on the two rows beyond: planted by the same rule (off the streets and doors, well apart), south of the lane.
  [1647, 150, 28], [1922, 404, 26], [1593, 801, 29], [1909, 1060, 25], [506, 1795, 26], [995, 1822, 24], [781, 1897, 28], [1439, 2056, 29],
  [121, 2222, 29], [1839, 2232, 28], [921, 2267, 27], [639, 2285, 26], [2077, 2358, 25], [89, 2378, 26], [1840, 2390, 30], [1339, 2397, 25],
  [515, 2400, 25], [1164, 2402, 25], [278, 2410, 27], [1677, 2426, 25], [858, 2467, 28], [620, 2532, 24], [2174, 2542, 27], [1012, 2561, 24],
  [250, 2625, 24], [1743, 2638, 29], [2021, 2663, 29], [2195, 2706, 24], [1463, 2722, 27], [733, 2737, 30], [300, 2796, 25], [480, 2799, 28],
  [1782, 2803, 27], [1011, 2852, 27], [676, 2915, 29], [1213, 2918, 25], [1988, 2928, 29], [1703, 2945, 24], [120, 2949, 30], [869, 2964, 25],
  [2155, 2982, 29], [360, 3045, 25], [1424, 3068, 26], [690, 3086, 27], [2078, 3137, 27], [1705, 3176, 24], [94, 3178, 30], [932, 3179, 29],
  [293, 3224, 27], [1269, 3251, 26], [540, 3274, 29], [1806, 3322, 27], [1965, 3342, 28], [184, 3356, 30], [2195, 3410, 28], [2057, 3483, 24],
  [818, 3490, 25], [373, 3504, 24], [90, 3539, 24], [1134, 3598, 28], [1530, 3604, 26], [776, 3655, 27], [1806, 3675, 28], [569, 3701, 26],
  [1369, 3710, 24], [340, 3749, 24], [917, 3787, 25], [2176, 3805, 30], [1080, 3817, 30], [187, 3825, 24], [1247, 3828, 27], [745, 3845, 30],
  [1470, 3853, 28], [1686, 3881, 28], [355, 3905, 24], [1991, 3941, 27], [954, 3976, 27], [177, 3988, 30], [682, 4030, 30], [499, 4104, 28],
  [1353, 4147, 26], [295, 4148, 30], [2136, 4149, 27], [862, 4160, 29], [1965, 4171, 27], [1568, 4195, 24], [1739, 4233, 25], [604, 4274, 28],
  [1098, 4278, 29], [192, 4289, 27], [367, 4310, 24], [2181, 4312, 25], [2025, 4319, 28], [1364, 4363, 27], [969, 4395, 26], [1694, 4428, 28],
  [502, 4436, 29], [78, 4450, 24], [1532, 4457, 30], [1878, 4510, 30], [1205, 4542, 27], [837, 4556, 26], [249, 4558, 29], [1399, 4648, 24],
  [962, 4651, 24], [547, 4658, 27], [277, 4739, 28], [2128, 4761, 24], [102, 4768, 26], [1054, 4783, 28], [1748, 4804, 29], [231, 4920, 24],
  [1923, 4965, 27], [2152, 5043, 24], [756, 5082, 29], [129, 5128, 29], [1562, 5157, 27], [1011, 5169, 29], [2154, 5233, 24],
  [1805, 5263, 27], [1626, 5323, 25], [892, 5323, 25],
  // The far bank, planted by the same rule.
  [776, 5709, 30], [1597, 5719, 28], [171, 5724, 27], [1803, 5736, 28], [1325, 5738, 26], [360, 5750, 24], [1066, 5816, 28], [2090, 5877, 29],
  [113, 5883, 30], [889, 5906, 25], [1308, 5913, 24], [213, 6020, 27], [204, 6181, 30], [2143, 6190, 28], [1473, 6237, 27], [465, 6296, 28],
  [2047, 6350, 26], [1245, 6367, 30], [1774, 6370, 24], [240, 6397, 25], [1503, 6401, 24], [649, 6418, 29], [1665, 6585, 28], [102, 6602, 30],
  [1451, 6632, 28], [974, 6633, 25], [1131, 6653, 30], [358, 6703, 28], [2157, 6738, 25], [1722, 6766, 29], [603, 6770, 27], [1944, 6777, 24],
  [297, 6859, 26], [2072, 6877, 27], [124, 6886, 26], [1425, 6889, 29], [2189, 7002, 27], [1172, 7004, 27], [882, 7009, 30], [1543, 7013, 29],
  [560, 7018, 26], [283, 7040, 29], [1334, 7154, 29], [2110, 7181, 26], [864, 7234, 29], [186, 7337, 26], [2107, 7372, 25], [634, 7424, 26],
  [1956, 7457, 26], [239, 7494, 30], [1391, 7510, 27], [88, 7542, 24], [2162, 7558, 25], [723, 7576, 24], [1823, 7613, 24], [1538, 7615, 27],
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
for (const block of [...SPOTS.map((spot) => spot.block), ...HEDGES, ...WATER]) {
  const b = WORLD.body;
  stand({ x0: block.x - b, y0: block.y - b, x1: block.x + block.w + b, y1: block.y + block.h + b }, block.x - b, block.y - b, block.x + block.w + b, block.y + block.h + b);
}
for (const tree of TREES) { const reach = tree.r * 0.55 + WORLD.body; stand({ x: tree.x, y: tree.y, rr: reach * reach }, tree.x - reach, tree.y - reach, tree.x + reach, tree.y + reach); } // the trunk, not the leaves
for (const post of [...LAMPS, ...PEOPLE, ...PROPS]) { const reach = post.r + WORLD.body; stand({ x: post.x, y: post.y, rr: reach * reach }, post.x - reach, post.y - reach, post.x + reach, post.y + reach); }

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
