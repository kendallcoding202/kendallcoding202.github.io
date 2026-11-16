// What the insides of buildings look like.
//
// A room that has been painted (home and the Midnight Pantry so far) is put
// together here from its paintings, made for this game (docs/ART.md): the
// back wall, a floor that repeats, and the things that stand on it, each a
// picture of its own under web/assets/rooms/. The rooms not yet painted are
// still drawn in code, in the ink outline and night colours of the rest.
//
// Either way a room is painted once, flat on: the back wall across the top,
// the floor below it, and whatever lies flat on the floor. What stands on the
// floor (a bed, a barrel) is painted apart, every frame, so whoever walks
// behind it is hidden by it.
import { INK, rounded, oval, paint, outline, glow, paintProp, stood, worldSrc } from './scenery.js';

/** A fixed run of numbers from 0 to 1: the same room every time. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const box = (pen, x, y, w, h, r, colour, width = 4) => { rounded(pen, x, y, w, h, r); paint(pen, colour); outline(pen, width); };
const flat = (pen, x, y, w, h, colour) => { pen.fillStyle = colour; pen.fillRect(x, y, w, h); };
const arrived = (image) => !!image && image.complete && image.naturalWidth > 0;

// ---------------------------------------------------------------- floors and walls

function boards(pen, x, y, w, h, tones, seam) {
  const plank = 46;
  const next = run(11);
  for (let row = 0, top = y; top < y + h; row++, top += plank) {
    const tall = Math.min(plank, y + h - top);
    flat(pen, x, top, w, tall, tones[row % tones.length]);
    flat(pen, x, top, w, 2.5, seam);
    // Where one board ends and the next begins, staggered from row to row.
    for (let at = x + 40 + next() * 160; at < x + w - 20; at += 150 + next() * 140) flat(pen, at, top, 2.5, tall, seam);
  }
}

function tiles(pen, x, y, w, h, size, a, b, grout) {
  flat(pen, x, y, w, h, grout);
  for (let row = 0; row * size < h; row++) {
    for (let col = 0; col * size < w; col++) {
      const wide = Math.min(size, w - col * size) - 3;
      const tall = Math.min(size, h - row * size) - 3;
      if (wide > 0 && tall > 0) flat(pen, x + col * size + 1.5, y + row * size + 1.5, wide, tall, (row + col) % 2 ? a : b);
    }
  }
}

/** The shell of any room: darkness round it, shadow down its sides and under its back wall, a line round the lot. */
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

/** The mat you leave by, at the foot of the room, with light from outside falling across it. */
function mat(pen, room) {
  const { x, y } = room.door;
  glow(pen, x, y + 14, 150, '255,214,120', 0.2);
  box(pen, x - 62, y - 22, 124, 46, 9, '#3f7a5a', 3.5);
  pen.strokeStyle = 'rgba(255,247,232,.5)'; pen.lineWidth = 3;
  for (const dy of [-10, 2, 14]) { pen.beginPath(); pen.moveTo(x - 46, y + dy); pen.lineTo(x + 46, y + dy); pen.stroke(); }
  // The doorway itself: a break in the front of the room, lit from the lane.
  flat(pen, x - 70, room.h - 9, 140, 9, '#ffd98a');
  pen.fillStyle = INK;
  pen.beginPath(); pen.moveTo(x - 13, y + 34); pen.lineTo(x + 13, y + 34); pen.lineTo(x, y + 45); pen.closePath(); pen.fill();
}

// ---------------------------------------------------------------- rooms that have been painted

/** Where a room's paintings live. */
export const roomSrc = (name) => `assets/rooms/${name}.webp`;

// For each painted room:
//   wall    'once': one painting across the whole back wall. 'pair': the painting and its mirror
//           image side by side (a long wall of shelves, at the size its jars should be beside you,
//           is two paintings wide).
//   tile    how much floor one repeat of the floor's painting covers, in the room's units.
//   night   how dark the night lies on the floor.
//   flat    what lies flat on the floor, painted into the room once: { art, x, y, wide }.
//   mat     how wide the door mat is.
//   things  how wide each kind of thing stands on its block. (Block ids are in core/indoors.js.)
//   lights  where light pools: { x, y, r, rgb, alpha }, laid over the night.
const PAINTED = {
  home: {
    wall: 'once', tile: 400, night: 0.3, mat: 128,
    flat: [{ art: 'rug', x: 300, y: 694, wide: 356 }],
    things: { hearth: 180, bed: 240, fern: 78, phone: 88, armchair: 122, teatable: 74, shelf: 150, basket: 124, drawers: 106, coats: 94 },
    lights: [{ x: 99, y: 372, r: 250, rgb: '255,170,70', alpha: 0.22 }, { x: 546, y: 716, r: 190, rgb: '255,214,120', alpha: 0.2 }],
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
};
/** Whether a room has paintings of its own. */
export const painted = (id) => Object.prototype.hasOwnProperty.call(PAINTED, id);
/** What a block is, from its id: a room's second barrel is 'barrel2'. */
const kindOf = (block) => block.id.replace(/\d+$/, '');

function paintPainted(pen, id, room, art) {
  const look = PAINTED[id];
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
  // What lies on it, and the mat you leave by, with light from outside falling across it.
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
  glow(pen, x, y + 14, 150, '255,214,120', 0.2);
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
  if (look.skirting) { flat(pen, 0, wall - 12, w, 12, look.skirting); flat(pen, 0, wall - 13, w, 2.5, INK); }
  const dark = pen.createLinearGradient(0, 0, 0, 64);
  dark.addColorStop(0, 'rgba(8,6,20,.55)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 64);
  flat(pen, 0, wall - 1.5, w, 3, INK);
  shell(pen, room);
}

/** Something painted, standing on its block: its shadow, the painting, and whatever light it gives. Foot of its block at (0, 0). */
function paintThing(pen, kind, image, wide, flip, clock) {
  oval(pen, 0, 1, wide * 0.46, Math.max(7, wide * 0.09)); paint(pen, 'rgba(8,6,20,.4)');
  if (flip) { pen.save(); pen.scale(-1, 1); }
  const tall = stood(pen, image, 0, 7, wide);
  if (flip) pen.restore();
  if (!tall) return;
  // A fire is never the same twice, and a lamp left on is a lamp.
  if (kind === 'hearth') glow(pen, 0, -tall * 0.26, wide * (0.62 + 0.04 * Math.sin(clock * 7)), '255,170,70', 0.2 + 0.07 * Math.sin(clock * 11) * Math.sin(clock * 3.1));
  if (kind === 'drawers') glow(pen, 0, -tall * 0.84, wide * 0.8, '255,224,150', 0.34);
}

// ---------------------------------------------------------------- the Wash

function paintWash(pen, room) {
  const { w, h, wall } = room;
  tiles(pen, 0, 0, w, wall, 28, '#3d6f80', '#427889', '#2c5361');
  const dark = pen.createLinearGradient(0, 0, 0, 60);
  dark.addColorStop(0, 'rgba(8,6,20,.6)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 60);
  // Six machines along the back wall, doors shut. Machine Six has its light on red.
  for (let i = 0; i < 6; i++) {
    const x = 32 + i * 118;
    box(pen, x, wall - 130, 102, 124, 8, '#e8eef2', 3.5);
    flat(pen, x + 8, wall - 122, 86, 16, '#b9c7d1');
    oval(pen, x + 22, wall - 114, 5, 5); paint(pen, i === 5 ? '#d6455d' : '#58d77a');
    oval(pen, x + 51, wall - 56, 35, 35); paint(pen, '#9fb0c8'); outline(pen, 3.5);
    oval(pen, x + 51, wall - 56, 25, 25); paint(pen, i === 5 ? '#3a1f3c' : '#1f3f5c');
    oval(pen, x + 43, wall - 65, 8, 5); paint(pen, 'rgba(255,255,255,.32)');
  }
  flat(pen, 0, wall - 6, w, 6, '#1c3540');
  tiles(pen, 0, wall, w, h - wall, 47.5, '#8fb7c9', '#c9dde6', '#4f6f80');
  // Puddles: it is that sort of floor.
  for (const [x, y, rx] of [[170, 1180, 46], [600, 1060, 38], [330, 760, 52], [560, 420, 40], [150, 520, 34], [420, 1420, 30]]) {
    oval(pen, x, y, rx, rx * 0.42); paint(pen, 'rgba(255,255,255,.2)');
    oval(pen, x - rx * 0.3, y - rx * 0.1, rx * 0.3, rx * 0.1); paint(pen, 'rgba(255,255,255,.3)');
  }
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.42)');
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '160,220,255', 0.1);
  shell(pen, room);
}

/** A laundry basket, heaped. Foot of its floor at (0, 0). */
function hamper(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.56, 12); paint(pen, 'rgba(8,6,20,.42)');
  for (const [dx, dy, r, colour] of [[-16, -50, 17, '#d6455d'], [12, -54, 19, '#4fc4cf'], [-2, -62, 15, '#ffc83d'], [22, -46, 13, '#c9b8e8']]) { oval(pen, dx, dy, r, r * 0.8); paint(pen, colour); outline(pen, 3); }
  pen.beginPath(); pen.moveTo(-w / 2, -42); pen.lineTo(-w / 2 + 10, 2); pen.lineTo(w / 2 - 10, 2); pen.lineTo(w / 2, -42); pen.closePath();
  paint(pen, '#e9dcc0'); outline(pen, 4);
  pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 2.5;
  for (let x = -w / 2 + 14; x < w / 2 - 8; x += 13) { pen.beginPath(); pen.moveTo(x, -38); pen.lineTo(x + 2, -2); pen.stroke(); }
}

// ---------------------------------------------------------------- the Dusty Stacks

const BOOKS = ['#d6455d', '#4fc4cf', '#ffc83d', '#7ac74f', '#c9b8e8', '#f2a65a', '#9fb0c8', '#7d6bd6'];

function paintStacks(pen, room) {
  const { w, h, wall } = room;
  flat(pen, 0, 0, w, wall, '#3d2a22');
  // Bookcases the length of the back wall.
  const next = run(53);
  for (let bay = 0; bay < 5; bay++) {
    const x = 14 + bay * 147;
    box(pen, x, 22, 140, wall - 26, 4, '#6b4630', 3.5);
    flat(pen, x + 8, 30, 124, wall - 42, '#2b1d17');
    for (let shelf = 0; shelf < 3; shelf++) {
      const base = 30 + (shelf + 1) * ((wall - 42) / 3);
      let at = x + 11;
      while (at < x + 124) {
        const wide = 7 + next() * 7;
        const tall = 26 + next() * 16;
        if (at + wide > x + 130) break;
        rounded(pen, at, base - tall - 3, wide, tall, 1.5); paint(pen, BOOKS[Math.floor(next() * BOOKS.length)]); outline(pen, 2);
        at += wide + 1;
      }
      flat(pen, x + 6, base - 3, 128, 5, '#8a5f40');
    }
  }
  const dark = pen.createLinearGradient(0, 0, 0, 60);
  dark.addColorStop(0, 'rgba(8,6,20,.6)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 60);
  boards(pen, 0, wall, w, h - wall, ['#5d4332', '#553c2c', '#59402f'], '#33231a');
  // A runner down the middle, worn where everyone has walked.
  box(pen, 296, wall + 36, 168, h - wall - 150, 6, '#8f2f3a', 4);
  pen.strokeStyle = '#e2b24a'; pen.lineWidth = 4; pen.strokeRect(310, wall + 50, 140, h - wall - 178);
  flat(pen, 340, wall + 60, 80, h - wall - 198, 'rgba(13,10,28,.12)');
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.4)');
  for (const post of room.posts) glow(pen, post.x, post.y, 160, '255,200,61', 0.12);
  shell(pen, room);
}

/** A pile of books somebody meant to put back. Foot at (0, 0). */
function bookpile(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.5, 10); paint(pen, 'rgba(8,6,20,.42)');
  const next = run(block.x + block.y);
  let top = 0;
  for (let i = 0; i < 5; i++) {
    const wide = w * (0.62 + next() * 0.3);
    const tall = 11 + next() * 5;
    const lean = (next() - 0.5) * 12;
    box(pen, -wide / 2 + lean, top - tall, wide, tall, 2.5, BOOKS[Math.floor(next() * BOOKS.length)], 3);
    flat(pen, -wide / 2 + lean + 4, top - tall + 3, 5, tall - 6, 'rgba(255,247,232,.6)');
    top -= tall;
  }
}

// ---------------------------------------------------------------- Moonlit Rooftops

function paintRooftops(pen, room) {
  const { w, h, wall } = room;
  const sky = pen.createLinearGradient(0, 0, 0, wall);
  sky.addColorStop(0, '#0e1736'); sky.addColorStop(1, '#2a3f78');
  pen.fillStyle = sky; pen.fillRect(0, 0, w, wall);
  const next = run(67);
  for (let i = 0; i < 46; i++) { oval(pen, next() * w, next() * (wall - 50), 1.4 + next() * 1.4, 1.4 + next() * 1.4); paint(pen, `rgba(255,247,232,${0.4 + next() * 0.6})`); }
  oval(pen, 600, 74, 36, 36); paint(pen, '#fff3c4');
  oval(pen, 614, 64, 31, 31); paint(pen, '#15214a');
  glow(pen, 596, 78, 150, '255,243,196', 0.12);
  // Other people's roofs, a long way down, a window lit here and there.
  pen.fillStyle = '#131a36';
  pen.beginPath(); pen.moveTo(0, wall);
  for (const [x, y] of [[0, 150], [60, 118], [120, 150], [150, 150], [150, 132], [176, 132], [176, 150], [250, 150], [320, 104], [390, 150], [470, 150], [470, 120], [500, 120], [500, 150], [560, 150], [640, 112], [720, 150], [760, 140]]) pen.lineTo(x, y);
  pen.lineTo(w, wall); pen.closePath(); pen.fill();
  for (const [x, y] of [[84, 160], [300, 150], [336, 166], [610, 152], [700, 168], [214, 170]]) flat(pen, x, y, 12, 14, '#ffd98a');
  box(pen, -4, wall - 20, w + 8, 20, 3, '#59607a', 3.5); // the parapet
  // Slates, row on row.
  flat(pen, 0, wall, w, h - wall, '#2f3a52');
  const tone = ['#4a5876', '#53627f', '#44506c', '#4e5c7a'];
  for (let row = 0, y = wall; y < h; row++, y += 34) {
    for (let x = (row % 2 ? -30 : 0); x < w; x += 60) {
      rounded(pen, x + 1.5, y + 1.5, 57, 31, 5); paint(pen, tone[Math.floor(next() * tone.length)]);
    }
  }
  // Skylights: somebody is still up.
  for (const [x, y] of [[96, 1180], [560, 700], [120, 760]]) {
    glow(pen, x + 44, y + 30, 150, '255,214,120', 0.2);
    box(pen, x, y, 88, 60, 5, '#ffd98a', 4);
    flat(pen, x + 42, y + 3, 4, 54, INK); flat(pen, x + 3, y + 28, 82, 4, INK);
  }
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.3)');
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '168,200,255', 0.1);
  shell(pen, room);
}

/** A chimney stack with two pots. Foot at (0, 0). */
function chimney(pen, block) {
  const w = block.w * 0.84;
  oval(pen, 0, 3, w * 0.62, 12); paint(pen, 'rgba(8,6,20,.45)');
  box(pen, -w / 2, -92, w, 94, 3, '#8a4a3c', 4);
  pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 2;
  for (let row = 0; row < 5; row++) {
    const y = -78 + row * 18;
    pen.beginPath(); pen.moveTo(-w / 2 + 3, y); pen.lineTo(w / 2 - 3, y); pen.stroke();
    for (let x = -w / 2 + (row % 2 ? 12 : 24); x < w / 2 - 4; x += 24) { pen.beginPath(); pen.moveTo(x, y); pen.lineTo(x, y + 18); pen.stroke(); }
  }
  box(pen, -w / 2 - 6, -104, w + 12, 14, 3, '#6f7689', 3.5);
  for (const dx of [-w * 0.22, w * 0.22]) box(pen, dx - 10, -130, 20, 28, 4, '#c0714f', 3.5);
}

// ---------------------------------------------------------------- the Tick-Tock Attic

function paintAttic(pen, room) {
  const { w, h, wall } = room;
  flat(pen, 0, 0, w, wall, '#3b2c26');
  pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 3;
  for (let x = 38; x < w; x += 38) { pen.beginPath(); pen.moveTo(x, 0); pen.lineTo(x, wall); pen.stroke(); }
  // The gable: two rafters meeting at the ridge, a round window between them, cobwebs in the corners.
  for (const [x0, x1] of [[-10, w / 2], [w + 10, w / 2]]) {
    pen.beginPath(); pen.moveTo(x0, wall - 6); pen.lineTo(x1, -10);
    pen.lineWidth = 26; pen.strokeStyle = INK; pen.stroke();
    pen.lineWidth = 18; pen.strokeStyle = '#6b4630'; pen.stroke();
  }
  oval(pen, w / 2, 112, 50, 50); paint(pen, '#e9dcc0'); outline(pen, 4);
  const sky = pen.createLinearGradient(0, 70, 0, 154);
  sky.addColorStop(0, '#141f47'); sky.addColorStop(1, '#27407a');
  oval(pen, w / 2, 112, 40, 40); paint(pen, sky);
  oval(pen, w / 2 + 12, 100, 13, 13); paint(pen, '#fff3c4');
  flat(pen, w / 2 - 2, 72, 4, 80, '#e9dcc0'); flat(pen, w / 2 - 40, 110, 80, 4, '#e9dcc0');
  pen.strokeStyle = 'rgba(255,255,255,.28)'; pen.lineWidth = 1.6;
  for (const [cx, side] of [[0, 1], [w, -1]]) {
    for (const r of [40, 70, 100]) { pen.beginPath(); pen.arc(cx, wall, r, side > 0 ? -Math.PI / 2 : Math.PI, side > 0 ? 0 : -Math.PI / 2); pen.stroke(); }
    for (const a of [0.2, 0.75, 1.3]) { pen.beginPath(); pen.moveTo(cx, wall); pen.lineTo(cx + side * Math.cos(a) * 108, wall - Math.sin(a) * 108); pen.stroke(); }
  }
  const dark = pen.createLinearGradient(0, 0, 0, 60);
  dark.addColorStop(0, 'rgba(8,6,20,.6)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 60);
  flat(pen, 0, wall - 8, w, 8, '#241a16');
  boards(pen, 0, wall, w, h - wall, ['#8a7458', '#7f6a50', '#857055'], '#54432f');
  // Moonlight from the round window, and dust lying where nobody walks.
  pen.beginPath(); pen.moveTo(330, wall + 10); pen.lineTo(430, wall + 10); pen.lineTo(520, wall + 420); pen.lineTo(240, wall + 420); pen.closePath();
  paint(pen, 'rgba(168,220,255,.07)');
  const next = run(71);
  for (let i = 0; i < 14; i++) { oval(pen, 50 + next() * (w - 100), wall + 60 + next() * (h - wall - 160), 30 + next() * 40, 10 + next() * 12); paint(pen, 'rgba(255,247,232,.05)'); }
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.4)');
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '255,200,61', 0.1);
  shell(pen, room);
}

/** A travelling trunk, strapped shut. Foot at (0, 0). */
function trunk(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.56, 11); paint(pen, 'rgba(8,6,20,.42)');
  box(pen, -w / 2, -50, w, 52, 7, '#7a4f38', 4);
  box(pen, -w / 2, -62, w, 20, 9, '#8a5f40', 4);
  for (const dx of [-w * 0.26, w * 0.26]) flat(pen, dx - 5, -60, 10, 60, '#3d2a22');
  box(pen, -8, -44, 16, 14, 3, '#e2b24a', 3);
}

/** Something under a dust sheet. Nobody remembers what. Foot at (0, 0). */
function dustsheet(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.6, 12); paint(pen, 'rgba(8,6,20,.42)');
  pen.beginPath(); pen.moveTo(-w / 2 - 4, 2);
  pen.quadraticCurveTo(-w / 2, -70, -w * 0.18, -84); pen.quadraticCurveTo(0, -96, w * 0.2, -80); pen.quadraticCurveTo(w / 2 + 2, -64, w / 2 + 6, 2);
  pen.closePath(); paint(pen, '#d9d2c0'); outline(pen, 4);
  pen.strokeStyle = 'rgba(13,10,28,.22)'; pen.lineWidth = 2.5;
  for (const dx of [-w * 0.24, 0, w * 0.26]) { pen.beginPath(); pen.moveTo(dx, -74); pen.quadraticCurveTo(dx + 6, -40, dx - 2, -2); pen.stroke(); }
}

// ---------------------------------------------------------------- the Roaring Dark

function paintDark(pen, room) {
  const { w, h, wall } = room;
  flat(pen, 0, 0, w, wall, '#241b26');
  // The underside of the stairs: each tread a step lower, from the left.
  pen.fillStyle = '#3a2a30';
  pen.beginPath(); pen.moveTo(0, 0);
  for (let i = 0; i < 9; i++) { pen.lineTo(i * 84, 18 + i * 14); pen.lineTo((i + 1) * 84, 18 + i * 14); }
  pen.lineTo(w, 0); pen.closePath(); pen.fill();
  pen.strokeStyle = INK; pen.lineWidth = 3;
  pen.beginPath(); pen.moveTo(0, 18);
  for (let i = 0; i < 9; i++) { pen.lineTo((i + 1) * 84, 18 + i * 14); pen.lineTo((i + 1) * 84, 32 + i * 14); }
  pen.stroke();
  // Coats on their hooks, and the fuse box.
  flat(pen, 40, 150, 430, 8, '#6b4630');
  [['#5b6f8f', 78], ['#8f2f3a', 168], ['#4f7a5a', 258], ['#c9a04f', 348], ['#59506e', 430]].forEach(([colour, x]) => {
    pen.beginPath(); pen.moveTo(x - 22, 160); pen.quadraticCurveTo(x - 34, 196, x - 26, wall - 4); pen.lineTo(x + 26, wall - 4); pen.quadraticCurveTo(x + 34, 196, x + 22, 160); pen.closePath();
    paint(pen, colour); outline(pen, 3);
    oval(pen, x, 154, 6, 6); paint(pen, '#b9c7d1'); outline(pen, 2);
  });
  box(pen, 600, 128, 92, 62, 5, '#8d8798', 3.5);
  for (let i = 0; i < 4; i++) flat(pen, 612 + i * 18, 140, 10, 26, '#2c3558');
  oval(pen, 676, 178, 5, 5); paint(pen, '#d6455d');
  glow(pen, 676, 178, 70, '214,69,93', 0.35);
  flat(pen, 0, wall - 8, w, 8, '#15101a');
  boards(pen, 0, wall, w, h - wall, ['#3b3040', '#352b3a', '#382e3d'], '#1e1722');
  mat(pen, room);
  // What roars at the far end glows a little, like a standby light.
  const far = room.posts[room.posts.length - 1];
  glow(pen, far.x, far.y, 260, '214,69,93', 0.2);
  flat(pen, 0, wall, w, h - wall, 'rgba(8,6,20,.3)');
  shell(pen, room);
}

/** A mop and its bucket. Foot at (0, 0). */
function bucket(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.5, 10); paint(pen, 'rgba(8,6,20,.42)');
  pen.beginPath(); pen.moveTo(22, -40); pen.lineTo(46, -128); pen.lineWidth = 9; pen.strokeStyle = INK; pen.lineCap = 'round'; pen.stroke();
  pen.lineWidth = 4.5; pen.strokeStyle = '#c08552'; pen.stroke();
  pen.beginPath(); pen.moveTo(-w * 0.36, -46); pen.lineTo(-w * 0.28, 2); pen.lineTo(w * 0.28, 2); pen.lineTo(w * 0.36, -46); pen.closePath();
  paint(pen, '#7aa7b8'); outline(pen, 4);
  oval(pen, 0, -46, w * 0.36, 9); paint(pen, '#4f6f80'); outline(pen, 3.5);
  for (const dx of [8, 18, 28]) { oval(pen, dx, -44, 7, 10); paint(pen, '#e9dcc0'); outline(pen, 2.5); }
}

// ---------------------------------------------------------------- which room, and what stands on its floor

const PAINTERS = { wash: paintWash, stacks: paintStacks, rooftops: paintRooftops, attic: paintAttic, dark: paintDark };
/** Paints a whole room, flat on, with its top left corner at (0, 0). `art` is the paintings it may use (see roomArt). */
export const paintRoom = (pen, id, room, art) => (painted(id) ? paintPainted(pen, id, room, art) : (PAINTERS[id] || paintDark)(pen, room, art));

// In a room not yet painted, what stands out on the floor, by the kind of block it stands on: a
// painting from Tin Can Alley (and how wide it stands), or something drawn here.
const STANDING = {
  hamper: { draw: hamper }, books: { draw: bookpile }, chimney: { draw: chimney }, trunk: { draw: trunk }, sheet: { draw: dustsheet }, bucket: { draw: bucket },
  crates: { art: 'a_crate', wide: 96 }, boxes: { art: 'a_boxes', wide: 90 }, bottles: { art: 'a_bottles', wide: 84 },
  pallets: { art: 'a_pallets', wide: 90 }, sacks: { art: 'a_boxes', wide: 90 },
};
const standingOf = (block) => STANDING[kindOf(block)] || null;

/** The paintings a room needs, as [name, where it lives]: its own if it has been painted, else the alley's it borrows. */
export function roomArt(id, room) {
  if (!painted(id)) return [...new Set(room.blocks.map((block) => standingOf(block) && standingOf(block).art).filter(Boolean))].map((name) => [name, worldSrc(name)]);
  const look = PAINTED[id];
  const names = ['wall', 'floor', 'mat', ...look.flat.map((thing) => thing.art), ...new Set(room.blocks.map(kindOf).filter((kind) => look.things[kind]))];
  return names.map((name) => [`${id}_${name}`, roomSrc(`${id}_${name}`)]);
}
/** Every painting of every painted room, to fetch ahead of walking in. */
export const ROOM_ART = Object.keys(PAINTED).flatMap((id) => ['wall', 'floor', 'mat', ...PAINTED[id].flat.map((thing) => thing.art), ...Object.keys(PAINTED[id].things)].map((name) => roomSrc(`${id}_${name}`)));

/**
 * Everything standing on a room's floor: { id, x, y: how far down the floor its foot is, paint(pen, art, clock) }
 * with the pen moved to its foot.
 */
export function standingIn(id, room) {
  const look = painted(id) ? PAINTED[id] : null;
  return room.blocks.filter((block) => (look ? look.things[kindOf(block)] : standingOf(block))).map((block) => {
    const kind = kindOf(block);
    const what = look ? null : standingOf(block);
    return {
      id: block.id, x: block.x + block.w / 2, y: block.y + block.h,
      paint: (pen, art, clock = 0) => (look ? paintThing(pen, kind, art[`${id}_${kind}`], look.things[kind], kind !== block.id, clock)
        : what.draw ? what.draw(pen, block) : paintProp(pen, art[what.art], what.wide)),
    };
  });
}
