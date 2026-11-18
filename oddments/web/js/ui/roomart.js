// What the insides of buildings look like.
//
// Every room you can walk into is put together here from its paintings, made
// for this game (docs/ART.md): the back wall, a floor that repeats, and the
// things that stand on it, each a picture of its own under web/assets/rooms/.
// What is drawn in code is only light and shade: the night lying on the
// floor, pools of lamplight, the shadow under each thing.
//
// A room is painted once, flat on: the back wall across the top, the floor
// below it, and whatever lies flat on the floor. What stands on the floor (a
// bed, a barrel) is painted apart, every frame, so whoever walks behind it is
// hidden by it.
import { INK, oval, paint, glow, stood } from './scenery.js';

const flat = (pen, x, y, w, h, colour) => { pen.fillStyle = colour; pen.fillRect(x, y, w, h); };
const arrived = (image) => !!image && image.complete && image.naturalWidth > 0;

/** The shell of any room: shadow down its sides and under its back wall, a line round the lot. */
function shell(pen, room) {
  const { w, h, wall } = room;
  for (const [x0, x1] of [[0, 34], [w, w - 34]]) {
    const side = pen.createLinearGradient(x0, 0, x1, 0);
    side.addColorStop(0, 'rgba(8,6,20,.5)'); side.addColorStop(1, 'rgba(8,6,20,0)');
    pen.fillStyle = side; pen.fillRect(Math.min(x0, x1), 0, 34, h);
  }
  const under = pen.createLinearGradient(0, wall, 0, wall + 46);
  under.addColorStop(0, 'rgba(8,6,20,.42)'); under.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = under; pen.fillRect(0, wall, w, 46);
  pen.lineWidth = 7; pen.strokeStyle = INK; pen.strokeRect(0, 0, w, h);
}

// ---------------------------------------------------------------- the rooms

/** Where a room's paintings live. */
export const roomSrc = (name) => `assets/rooms/${name}.webp`;

// For each room:
//   wall    'once': one painting across the whole back wall. 'pair': the painting and its mirror
//           image side by side (a long wall of shelves, at the size its jars should be beside you,
//           is two paintings wide).
//   tile    how much floor one repeat of the floor's painting covers, in the room's units.
//   night   how dark the night lies on the floor.
//   flat    what lies flat on the floor, painted into the room once: { art, x, y, wide }.
//   mat     how wide the door mat is (on the rooftops and in the attic, the hatch you came up by).
//   things  how wide each kind of thing stands on its block. (Block ids are in core/indoors.js.)
//   lights  where light pools on the floor: { x, y, r, rgb, alpha }, laid over the night.
//   glows   the same, on the back wall: a lamp in the painting, a machine with its light on.
const WARM = '255,214,120';
const PAINTED = {
  home: {
    wall: 'once', tile: 400, night: 0.3, mat: 128,
    flat: [{ art: 'rug', x: 300, y: 694, wide: 356 }],
    things: { hearth: 180, bed: 240, fern: 78, phone: 88, armchair: 122, teatable: 74, shelf: 150, basket: 124, drawers: 106, coats: 94 },
    lights: [{ x: 99, y: 372, r: 250, rgb: '255,170,70', alpha: 0.22 }, { x: 546, y: 716, r: 190, rgb: WARM, alpha: 0.2 }],
    // Great-aunt Maribel, in the frame over the telephone: where the inside of that frame is.
    portrait: { x: 485, y: 63, w: 77, h: 85 },
    // Moonlight through the window, slanting across the floor.
    moon: [[214, 300], [410, 300], [520, 560], [240, 560]],
  },
  pantry: {
    wall: 'pair', tile: 380, night: 0.34, mat: 124,
    flat: [],
    things: { sack: 58, barrel: 56, potatoes: 70, tins: 58, pickles: 46, cheese: 52, eggs: 58, milk: 64, stool: 56, onions: 60, scales: 62 },
    // The light somebody left on, at the far end (the one in the painting fights there are seen against).
    lights: [{ x: 96, y: 230, r: 300, rgb: '255,236,170', alpha: 0.2 }],
    skirting: '#1c2636',
  },
  wash: {
    wall: 'pair', tile: 380, night: 0.3, mat: 124,
    flat: [],
    things: { basket: 60, ironing: 78, towels: 54, soapbox: 48, airer: 84, bucket: 46, hamper: 54, socks: 64, chair: 52, sign: 50, trolley: 68 },
    lights: [{ x: 430, y: 250, r: 190, rgb: '255,70,90', alpha: 0.16 }],
    // Machine Six, counting from the left, has its light on red.
    glows: [{ x: 431, y: 163, r: 56, rgb: '255,60,84', alpha: 0.6 }],
    // It is that sort of floor.
    puddles: [[170, 1340, 46], [600, 1100, 38], [330, 760, 52], [560, 420, 40], [150, 520, 34], [420, 1440, 30]],
  },
  stacks: {
    wall: 'pair', tile: 280, night: 0.3, mat: 124,
    flat: [],
    things: { pile: 52, tomes: 56, desk: 80, globe: 50, steps: 56, trolley: 70, catalogue: 80, armchair: 78, lectern: 70, plant: 60, inkdesk: 58 },
    lights: [{ x: 214, y: 240, r: 200, rgb: WARM, alpha: 0.16 }, { x: 546, y: 240, r: 200, rgb: WARM, alpha: 0.16 }, { x: 690, y: 1150, r: 150, rgb: '190,255,190', alpha: 0.12 }],
    glows: [{ x: 214, y: 92, r: 60, rgb: WARM, alpha: 0.35 }, { x: 546, y: 92, r: 60, rgb: WARM, alpha: 0.35 }],
  },
  rooftops: {
    wall: 'once', tile: 400, night: 0.2, mat: 124,
    // Skylights: somebody is still up. And the ladder the sweep left.
    flat: [{ art: 'skylight', x: 640, y: 1180, wide: 112 }, { art: 'skylight', x: 122, y: 770, wide: 112 }, { art: 'ladder', x: 150, y: 1560, wide: 96 }],
    things: { chimney: 76, pot: 40, aerial: 80, tank: 80, dovecote: 70, planter: 96, slates: 64, finial: 44, dish: 60 },
    lights: [{ x: 640, y: 1180, r: 150, rgb: WARM, alpha: 0.24 }, { x: 122, y: 770, r: 150, rgb: WARM, alpha: 0.24 }, { x: 470, y: 330, r: 320, rgb: '168,200,255', alpha: 0.1 }],
  },
  attic: {
    wall: 'once', tile: 300, night: 0.36, mat: 126,
    flat: [],
    things: { trunk: 82, sheet: 76, boxes: 66, horse: 84, dummy: 44, cage: 44, cases: 74, toys: 82, mirror: 60, gramophone: 62, rug: 70 },
    lights: [],
    // Moonlight from the round window in the gable.
    moon: [[330, 360], [430, 360], [540, 760], [220, 760]],
  },
  dark: {
    wall: 'pair', tile: 300, night: 0.26, mat: 124,
    flat: [],
    things: { shoes: 76, shoeboxes: 52, toolbox: 70, ladder: 62, umbrellas: 46, broom: 60, paint: 58, cables: 76, reel: 60, board: 34, papers: 64 },
    // What roars at the far end glows a little, like a standby light.
    lights: [{ x: 380, y: 380, r: 260, rgb: '214,69,93', alpha: 0.2 }],
  },
  // ---- chapter two's four: each back wall one painting right across ----
  glasshouse: {
    wall: 'once', tile: 380, night: 0.24, mat: 124,
    flat: [],
    things: { pots: 44, seedtray: 72, can: 56, compost: 58, tomato: 58, bench: 88, palm: 68, crate: 72, hose: 60, steps: 62, cloche: 44 },
    // Moonlight through the glass.
    lights: [{ x: 520, y: 480, r: 330, rgb: '168,200,255', alpha: 0.12 }],
  },
  deepend: {
    wall: 'once', tile: 300, night: 0.28, mat: 124,
    flat: [],
    things: { basin: 58, rail: 70, scales: 50, stool: 54, fern: 60, bucket: 52, jug: 60, mirror: 52, radiator: 76, cabinet: 56, bottles: 58 },
    // The two wall lamps either side of the round mirror, and the wet they shine on.
    lights: [{ x: 206, y: 470, r: 210, rgb: WARM, alpha: 0.16 }, { x: 572, y: 470, r: 210, rgb: WARM, alpha: 0.16 }],
    glows: [{ x: 206, y: 106, r: 52, rgb: WARM, alpha: 0.4 }, { x: 572, y: 106, r: 52, rgb: WARM, alpha: 0.4 }],
    puddles: [[190, 1360, 44], [590, 1180, 36], [340, 800, 50], [560, 560, 40], [170, 640, 32], [430, 1450, 30]],
  },
  shed: {
    wall: 'once', tile: 340, night: 0.34, mat: 124,
    flat: [],
    things: { bench: 90, chest: 62, paint: 58, tools: 54, rope: 60, sawhorse: 78, planks: 72, jars: 64, grindstone: 70, ladder: 60, bin: 54 },
    // The bare bulb, at the right-hand end of the wall.
    lights: [{ x: 640, y: 500, r: 300, rgb: WARM, alpha: 0.2 }],
    glows: [{ x: 664, y: 88, r: 60, rgb: WARM, alpha: 0.45 }],
  },
  mending: {
    wall: 'once', tile: 300, night: 0.28, mat: 126,
    flat: [],
    things: { dummy: 50, wool: 62, buttons: 50, fabric: 62, chair: 54, reels: 62, table: 66, lamp: 46, drawers: 80, ribbons: 58, quilts: 68 },
    // Its own lamp, lit, where it stands; and the moon in the window.
    lights: [{ x: 658, y: 560, r: 230, rgb: WARM, alpha: 0.22 }, { x: 420, y: 470, r: 280, rgb: '168,200,255', alpha: 0.08 }],
  },
};
/** Whether somewhere is a room with paintings of its own. */
export const painted = (id) => Object.prototype.hasOwnProperty.call(PAINTED, id);
/** What a block is, from its id: a room's second barrel is 'barrel2'. */
const kindOf = (block) => block.id.replace(/\d+$/, '');

/** Paints a whole room, flat on, with its top left corner at (0, 0). `art` is its paintings, by name (see roomArt). */
export function paintRoom(pen, id, room, art) {
  const look = painted(id) ? PAINTED[id] : { wall: 'once', tile: 400, night: 0.3, mat: 124, flat: [], things: {}, lights: [] };
  const { w, h, wall } = room;
  // The floor: its painting, over and over.
  flat(pen, 0, wall, w, h - wall, '#3a3046');
  const tile = art[`${id}_floor`];
  if (arrived(tile)) {
    pen.save();
    pen.beginPath(); pen.rect(0, wall, w, h - wall); pen.clip();
    for (let y = wall; y < h; y += look.tile) for (let x = 0; x < w; x += look.tile) pen.drawImage(tile, x, y, look.tile + 0.5, look.tile + 0.5);
    pen.restore();
  }
  for (const [x, y, rx] of look.puddles || []) {
    oval(pen, x, y, rx, rx * 0.42); paint(pen, 'rgba(255,255,255,.2)');
    oval(pen, x - rx * 0.3, y - rx * 0.1, rx * 0.3, rx * 0.1); paint(pen, 'rgba(255,255,255,.3)');
  }
  // What lies on it, and the mat you leave by.
  for (const thing of look.flat) {
    const image = art[`${id}_${thing.art}`];
    if (arrived(image)) { const tall = thing.wide * (image.naturalHeight / image.naturalWidth); pen.drawImage(image, thing.x - thing.wide / 2, thing.y - tall / 2, thing.wide, tall); }
  }
  const { x, y } = room.door;
  const rug = art[`${id}_mat`];
  if (arrived(rug)) { const tall = look.mat * (rug.naturalHeight / rug.naturalWidth); pen.drawImage(rug, x - look.mat / 2, Math.min(y - tall / 2 - 6, h - tall - 3), look.mat, tall); }
  // Night, over the floor and all that lies on it; then the light there is.
  flat(pen, 0, wall, w, h - wall, `rgba(14,16,44,${look.night})`);
  if (look.moon) { pen.beginPath(); look.moon.forEach(([mx, my], i) => (i ? pen.lineTo(mx, my) : pen.moveTo(mx, my))); pen.closePath(); paint(pen, 'rgba(168,220,255,.08)'); }
  for (const light of look.lights) glow(pen, light.x, light.y, light.r, light.rgb, light.alpha);
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '255,200,61', 0.08);
  glow(pen, x, y + 14, 150, WARM, 0.2); // light from outside, falling across the mat
  flat(pen, x - 70, h - 9, 140, 9, '#ffd98a'); // the doorway itself: a break in the front of the room, lit from the lane
  pen.fillStyle = INK;
  pen.beginPath(); pen.moveTo(x - 13, h - 20); pen.lineTo(x + 13, h - 20); pen.lineTo(x, h - 9); pen.closePath(); pen.fill();

  // The back wall, over the top edge of the floor.
  flat(pen, 0, 0, w, wall, '#27364a');
  const picture = art[`${id}_wall`];
  if (arrived(picture)) {
    if (look.wall === 'pair') {
      pen.drawImage(picture, 0, 0, w / 2 + 0.5, wall);
      pen.save(); pen.translate(w, 0); pen.scale(-1, 1); pen.drawImage(picture, 0, 0, w / 2 + 0.5, wall); pen.restore();
    } else pen.drawImage(picture, 0, 0, w, wall);
  }
  if (look.portrait && arrived(art.maribel)) {
    const frame = look.portrait;
    flat(pen, frame.x, frame.y, frame.w, frame.h, '#efe3c8');
    const tall = frame.h * 1.5;
    const wide = tall * (art.maribel.naturalWidth / art.maribel.naturalHeight);
    pen.save(); pen.beginPath(); pen.rect(frame.x, frame.y, frame.w, frame.h); pen.clip();
    pen.drawImage(art.maribel, frame.x + frame.w / 2 - wide / 2, frame.y + 5, wide, tall);
    pen.restore();
    pen.strokeStyle = INK; pen.lineWidth = 2.5; pen.strokeRect(frame.x, frame.y, frame.w, frame.h);
  }
  for (const light of look.glows || []) glow(pen, light.x, light.y, light.r, light.rgb, light.alpha);
  if (look.skirting) { flat(pen, 0, wall - 12, w, 12, look.skirting); flat(pen, 0, wall - 13, w, 2.5, INK); }
  const dark = pen.createLinearGradient(0, 0, 0, 64);
  dark.addColorStop(0, 'rgba(8,6,20,.55)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 64);
  flat(pen, 0, wall - 1.5, w, 3, INK);
  shell(pen, room);
}

/** Something standing on its block: its shadow, its painting, and whatever light it gives. Foot of its block at (0, 0). */
function paintThing(pen, kind, image, wide, flip, clock) {
  oval(pen, 0, 1, wide * 0.46, Math.max(7, wide * 0.09)); paint(pen, 'rgba(8,6,20,.4)');
  if (flip) { pen.save(); pen.scale(-1, 1); }
  const tall = stood(pen, image, 0, 7, wide);
  if (flip) pen.restore();
  if (!tall) return;
  // A fire is never the same twice, and a lamp left on is a lamp.
  if (kind === 'hearth') glow(pen, 0, -tall * 0.26, wide * (0.62 + 0.04 * Math.sin(clock * 7)), '255,170,70', 0.2 + 0.07 * Math.sin(clock * 11) * Math.sin(clock * 3.1));
  if (kind === 'drawers') glow(pen, 0, -tall * 0.84, wide * 0.8, '255,224,150', 0.34);
  if (kind === 'desk') glow(pen, 0, -tall * 0.8, wide * 0.7, '190,255,190', 0.22);
}

/** The paintings a room needs, as [name, where it lives]. */
export function roomArt(id, room) {
  if (!painted(id)) return [];
  const look = PAINTED[id];
  const names = ['wall', 'floor', 'mat', ...new Set(look.flat.map((thing) => thing.art)), ...new Set(room.blocks.map(kindOf).filter((kind) => look.things[kind]))];
  return names.map((name) => [`${id}_${name}`, roomSrc(`${id}_${name}`)]);
}
/** Every painting of every room, to fetch before the game shows. */
export const ROOM_ART = Object.keys(PAINTED).flatMap((id) => ['wall', 'floor', 'mat', ...new Set(PAINTED[id].flat.map((thing) => thing.art)), ...Object.keys(PAINTED[id].things)].map((name) => roomSrc(`${id}_${name}`)));

/**
 * Everything standing on a room's floor: { id, x, y: how far down the floor its foot is, paint(pen, art, clock) }
 * with the pen moved to its foot. (A second thing of a kind faces the other way.)
 */
export function standingIn(id, room) {
  const look = painted(id) ? PAINTED[id] : { things: {} };
  return room.blocks.filter((block) => look.things[kindOf(block)]).map((block) => {
    const kind = kindOf(block);
    return {
      id: block.id, x: block.x + block.w / 2, y: block.y + block.h,
      paint: (pen, art, clock = 0) => paintThing(pen, kind, art[`${id}_${kind}`], look.things[kind], kind !== block.id, clock),
    };
  });
}
