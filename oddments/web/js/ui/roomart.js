// What the insides of buildings look like. Everything here is drawn in code,
// in the ink outline and night colours of the rest of the game: no picture
// was generated for it. The only paintings used are ones the game already
// has (the crates and boxes of Tin Can Alley; great-aunt Maribel's portrait).
//
// A room is painted once, flat on: the back wall across the top, the floor
// below it, and the furniture that stands against the wall. What stands out
// on the floor (a basket, a stack of crates) is painted apart, so whoever
// walks behind it is hidden by it.
import { INK, rounded, oval, paint, outline, glow, paintProp } from './scenery.js';

/** A fixed run of numbers from 0 to 1: the same room every time. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const box = (pen, x, y, w, h, r, colour, width = 4) => { rounded(pen, x, y, w, h, r); paint(pen, colour); outline(pen, width); };
const flat = (pen, x, y, w, h, colour) => { pen.fillStyle = colour; pen.fillRect(x, y, w, h); };
const NIGHT = 'rgba(14,16,44,.34)'; // laid over everything indoors, as the lane has it laid over its grass

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

// ---------------------------------------------------------------- home

const QUILT = ['#e2b24a', '#b6a3dc', '#56b3bd', '#dc9a5c', '#93a5bf', '#77b558'];
const BOOKS = ['#d6455d', '#4fc4cf', '#ffc83d', '#7ac74f', '#c9b8e8', '#f2a65a', '#9fb0c8', '#7d6bd6'];

function homeWall(pen, room, art) {
  const { w, wall } = room;
  // Wallpaper in the blue of the night outside, striped; panelling below it; a skirting board.
  flat(pen, 0, 0, w, wall, '#2c3558');
  for (let x = 12; x < w; x += 44) flat(pen, x, 0, 15, wall - 78, '#333f68');
  flat(pen, 0, wall - 78, w, 78, '#5b3f33');
  for (let x = 26; x < w; x += 62) { pen.strokeStyle = 'rgba(13,10,28,.35)'; pen.lineWidth = 3; pen.strokeRect(x, wall - 62, 44, 44); }
  flat(pen, 0, wall - 86, w, 9, '#7a5646');
  flat(pen, 0, wall - 10, w, 10, '#3d2a22');
  const dark = pen.createLinearGradient(0, 0, 0, 70);
  dark.addColorStop(0, 'rgba(8,6,20,.6)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 70);

  // The window over the bed: the moon, a few stars, curtains drawn back.
  box(pen, 62, 40, 164, 124, 8, '#e9dcc0');
  const sky = pen.createLinearGradient(0, 50, 0, 154);
  sky.addColorStop(0, '#141f47'); sky.addColorStop(1, '#27407a');
  rounded(pen, 72, 50, 144, 104, 4); paint(pen, sky); outline(pen, 3);
  oval(pen, 176, 82, 17, 17); paint(pen, '#fff3c4');
  oval(pen, 183, 77, 15, 15); paint(pen, '#1b2c5e');
  for (const [x, y] of [[92, 68], [118, 96], [140, 62], [100, 128], [196, 126], [150, 134]]) { oval(pen, x, y, 2.2, 2.2); paint(pen, '#fff7e8'); }
  flat(pen, 142, 50, 4, 104, '#e9dcc0'); flat(pen, 72, 100, 144, 4, '#e9dcc0');
  for (const [x, lean] of [[52, 1], [236, -1]]) {
    pen.beginPath(); pen.moveTo(x, 30); pen.lineTo(x + lean * 34, 30); pen.quadraticCurveTo(x + lean * 30, 110, x + lean * 8, 176); pen.lineTo(x - lean * 6, 176); pen.closePath();
    paint(pen, '#c9544a'); outline(pen, 3.5);
  }
  flat(pen, 40, 24, 208, 8, '#7a5646'); pen.strokeStyle = INK; pen.lineWidth = 3; pen.strokeRect(40, 24, 208, 8);

  // Great-aunt Maribel, framed, over the telephone.
  box(pen, 276, 62, 64, 82, 6, '#b88a3c');
  flat(pen, 284, 70, 48, 66, '#efe3c8');
  if (art.maribel && art.maribel.complete && art.maribel.naturalWidth) {
    const tall = 62;
    const wide = tall * (art.maribel.naturalWidth / art.maribel.naturalHeight);
    pen.save(); pen.beginPath(); pen.rect(284, 70, 48, 66); pen.clip();
    pen.drawImage(art.maribel, 308 - wide / 2, 74, wide, tall);
    pen.restore();
  }
  pen.strokeStyle = INK; pen.lineWidth = 2.5; pen.strokeRect(284, 70, 48, 66);
}

function bed(pen, block) {
  const { x, y, w, h } = block;
  const foot = y + h;
  box(pen, x, y - 92, 26, h + 92, 8, '#6b4630'); // the headboard
  box(pen, x + w - 20, foot - 74, 20, 74, 6, '#6b4630'); // the footboard
  box(pen, x + 20, foot - 50, w - 36, 46, 6, '#8a5f40'); // its side
  box(pen, x + 18, y - 22, w - 32, h - 22, 14, '#f3ead8'); // the mattress, seen from above
  box(pen, x + 26, y - 14, 62, h - 40, 14, '#fffaf0', 3.5); // the pillow
  // A patchwork quilt, a patch for every element.
  pen.save();
  rounded(pen, x + 96, y - 22, w - 112, h - 22, 12); pen.clip();
  const next = run(3);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) flat(pen, x + 96 + col * 33, y - 22 + row * 34, 33, 34, QUILT[Math.floor(next() * QUILT.length)]);
  pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 2;
  for (let col = 1; col < 4; col++) { pen.beginPath(); pen.moveTo(x + 96 + col * 33, y - 22); pen.lineTo(x + 96 + col * 33, y + h); pen.stroke(); }
  for (let row = 1; row < 3; row++) { pen.beginPath(); pen.moveTo(x + 96, y - 22 + row * 34); pen.lineTo(x + w, y - 22 + row * 34); pen.stroke(); }
  pen.restore();
  rounded(pen, x + 96, y - 22, w - 112, h - 22, 12); outline(pen, 4);
}

function telephone(pen, block) {
  const { x, y, w, h } = block;
  const foot = y + h;
  box(pen, x + 4, foot - 40, 8, 40, 2, '#6b4630', 3); box(pen, x + w - 12, foot - 40, 8, 40, 2, '#6b4630', 3);
  box(pen, x, foot - 58, w, 22, 5, '#8a5f40');
  // An old telephone, the kind with a dial: the one great-aunt Maribel rings.
  const cx = x + w / 2;
  box(pen, cx - 22, foot - 86, 44, 30, 9, '#d6455d', 3.5);
  oval(pen, cx, foot - 70, 9, 9); paint(pen, '#fff7e8'); outline(pen, 2.5);
  oval(pen, cx, foot - 70, 3, 3); paint(pen, INK);
  pen.beginPath(); pen.moveTo(cx - 26, foot - 90); pen.quadraticCurveTo(cx, foot - 108, cx + 26, foot - 90);
  pen.lineWidth = 9; pen.strokeStyle = INK; pen.lineCap = 'round'; pen.stroke();
  pen.lineWidth = 4.5; pen.strokeStyle = '#d6455d'; pen.stroke();
  for (const side of [-1, 1]) { oval(pen, cx + side * 26, foot - 88, 7, 6); paint(pen, '#d6455d'); outline(pen, 3); }
}

function bookshelf(pen, block) {
  const { x, y, w, h } = block;
  const foot = y + h;
  const top = y - 196;
  box(pen, x, top, w, foot - top, 6, '#6b4630');
  flat(pen, x + 9, top + 9, w - 18, foot - top - 18, '#3d2a22');
  const next = run(19);
  for (let shelf = 0; shelf < 4; shelf++) {
    const base = top + 9 + (shelf + 1) * ((foot - top - 18) / 4);
    let at = x + 12;
    // The scrapbook lies flat on the third shelf, gold, where a hand would find it.
    if (shelf === 2) { box(pen, x + 14, base - 15, 50, 12, 3, '#ffc83d', 2.5); at = x + 70; }
    while (at < x + w - 20) {
      const wide = 8 + next() * 8;
      const tall = 30 + next() * 16;
      if (at + wide > x + w - 12) break;
      rounded(pen, at, base - tall - 3, wide, tall, 1.5); paint(pen, BOOKS[Math.floor(next() * BOOKS.length)]); outline(pen, 2);
      at += wide + 1;
    }
    flat(pen, x + 6, base - 3, w - 12, 6, '#8a5f40'); pen.strokeStyle = INK; pen.lineWidth = 2; pen.strokeRect(x + 6, base - 3, w - 12, 6);
  }
}

function hearth(pen, block) {
  const { x, y, w, h } = block;
  const foot = y + h;
  flat(pen, x + 6, 0, w - 12, y - 118, '#374573'); // the chimney breast, up to the ceiling
  pen.strokeStyle = INK; pen.lineWidth = 3; pen.strokeRect(x + 6, -4, w - 12, y - 114);
  box(pen, x, y - 118, w, foot - (y - 118), 8, '#8d8798');
  pen.strokeStyle = 'rgba(13,10,28,.28)'; pen.lineWidth = 2.5;
  for (let row = 0; row < 5; row++) {
    const top = y - 104 + row * 34;
    pen.beginPath(); pen.moveTo(x + 4, top); pen.lineTo(x + w - 4, top); pen.stroke();
    for (let at = x + (row % 2 ? 20 : 40); at < x + w - 8; at += 40) { pen.beginPath(); pen.moveTo(at, top); pen.lineTo(at, top + 34); pen.stroke(); }
  }
  rounded(pen, x + 18, y - 54, w - 36, foot - (y - 54) - 6, 26); paint(pen, '#17132e'); outline(pen, 4);
  box(pen, x - 8, y - 130, w + 16, 16, 4, '#6b4630'); // the mantelpiece
  box(pen, x + 14, y - 158, 9, 28, 2, '#fff7e8', 2.5); // a candle on it
  oval(pen, x + 18.5, y - 164, 4, 7); paint(pen, '#ffc83d');
  box(pen, x + w - 44, y - 160, 28, 30, 3, '#b88a3c', 2.5); // and a small frame
  flat(pen, x + w - 39, y - 155, 18, 20, '#9fd1c9');
}

/** The fire in the hearth, which is never the same twice: painted every frame, over the room. */
export function paintFire(pen, room, clock) {
  const block = room.blocks.find((b) => b.id === 'hearth');
  if (!block) return;
  const cx = block.x + block.w / 2;
  const foot = block.y + block.h - 8;
  glow(pen, cx, foot - 10, 210 + Math.sin(clock * 7) * 10, '255,170,70', 0.2 + 0.04 * Math.sin(clock * 11));
  for (const [dx, tall, colour, speed] of [[-13, 30, '#f2743a', 9], [11, 34, '#f2743a', 7.3], [0, 44, '#ffb347', 8.1], [0, 24, '#ffe9a6', 10.4]]) {
    const high = tall * (0.82 + 0.18 * Math.sin(clock * speed + dx));
    pen.beginPath(); pen.moveTo(cx + dx - 11, foot);
    pen.quadraticCurveTo(cx + dx - 13, foot - high * 0.5, cx + dx + Math.sin(clock * speed * 0.7) * 4, foot - high);
    pen.quadraticCurveTo(cx + dx + 13, foot - high * 0.5, cx + dx + 11, foot);
    pen.closePath(); paint(pen, colour);
  }
  box(pen, cx - 24, foot - 7, 48, 10, 4, '#5b3f33', 3); // a log
}

/** The basket by the wall, with its cushion: where the team is chosen. Foot of its floor at (0, 0). */
function basket(pen, block) {
  const w = block.w;
  oval(pen, 0, 2, w * 0.56, 13); paint(pen, 'rgba(8,6,20,.42)');
  oval(pen, 0, -44, w * 0.44, 18); paint(pen, '#c9b8e8'); outline(pen, 3.5); // the cushion, plumped
  pen.beginPath(); pen.moveTo(-w / 2, -40); pen.quadraticCurveTo(-w / 2 + 2, 2, -w / 2 + 16, 2); pen.lineTo(w / 2 - 16, 2); pen.quadraticCurveTo(w / 2 - 2, 2, w / 2, -40);
  pen.quadraticCurveTo(0, -22, -w / 2, -40); pen.closePath();
  paint(pen, '#c08552'); outline(pen, 4);
  pen.strokeStyle = 'rgba(13,10,28,.35)'; pen.lineWidth = 2.5;
  for (const dy of [-22, -10]) { pen.beginPath(); pen.moveTo(-w / 2 + 6, dy - 6); pen.quadraticCurveTo(0, dy + 8, w / 2 - 6, dy - 6); pen.stroke(); }
}

function paintHome(pen, room, art) {
  const { w, h, wall } = room;
  homeWall(pen, room, art);
  boards(pen, 0, wall, w, h - wall, ['#80583a', '#75502f', '#7b5536'], '#4f3421');
  // A rug in the middle of the floor.
  oval(pen, 318, 640, 196, 124); paint(pen, '#a8443f'); outline(pen, 4.5);
  oval(pen, 318, 640, 172, 104); pen.lineWidth = 7; pen.strokeStyle = '#f2dfb8'; pen.stroke();
  oval(pen, 318, 640, 118, 66); pen.lineWidth = 3.5; pen.strokeStyle = 'rgba(242,223,184,.55)'; pen.stroke();
  for (let i = 0; i < 6; i++) { oval(pen, 318 + Math.cos((i * Math.PI) / 3) * 62, 640 + Math.sin((i * Math.PI) / 3) * 34, 9, 6); paint(pen, QUILT[i]); }
  // Moonlight through the window, slanting across the floor.
  pen.beginPath(); pen.moveTo(80, wall + 126); pen.lineTo(220, wall + 126); pen.lineTo(330, wall + 330); pen.lineTo(150, wall + 330); pen.closePath();
  paint(pen, 'rgba(168,220,255,.07)');
  mat(pen, room);
  flat(pen, 0, 0, w, h, NIGHT);
  // Against the back wall, left to right. (After the night wash: the furniture keeps its colour by lamp and firelight.)
  const by = (id) => room.blocks.find((block) => block.id === id);
  bookshelf(pen, by('shelf'));
  hearth(pen, by('hearth'));
  bed(pen, by('bed'));
  telephone(pen, by('phone'));
  glow(pen, 308, wall + 40, 120, '255,214,120', 0.12);
  shell(pen, room);
}

// ---------------------------------------------------------------- the Midnight Pantry

const JARS = ['#e8c873', '#c97b4a', '#8fb86a', '#d9d2c0', '#b4563f', '#e2a84f', '#7aa7b8'];

function pantryWall(pen, room) {
  const { w, wall } = room;
  flat(pen, 0, 0, w, wall, '#27364a');
  const dark = pen.createLinearGradient(0, 0, 0, 60);
  dark.addColorStop(0, 'rgba(8,6,20,.6)'); dark.addColorStop(1, 'rgba(8,6,20,0)');
  pen.fillStyle = dark; pen.fillRect(0, 0, w, 60);
  const next = run(41);
  for (const base of [88, 176]) {
    let at = 22;
    while (at < w - 60) {
      const sort = next();
      const colour = JARS[Math.floor(next() * JARS.length)];
      if (sort < 0.45) {
        // A jar: glass, what is in it, a lid.
        const wide = 34 + next() * 16;
        const tall = 44 + next() * 20;
        box(pen, at, base - tall, wide, tall, 9, '#9fc4cf', 3);
        rounded(pen, at + 4, base - tall * 0.72, wide - 8, tall * 0.72 - 4, 6); paint(pen, colour);
        box(pen, at + 3, base - tall - 8, wide - 6, 11, 3, '#8a5f40', 3);
        at += wide + 8;
      } else if (sort < 0.75) {
        // A tin, with a band round it.
        const wide = 38 + next() * 10;
        const tall = 34 + next() * 10;
        box(pen, at, base - tall, wide, tall, 4, '#aeb7c6', 3);
        flat(pen, at + 2, base - tall * 0.72, wide - 4, tall * 0.46, colour);
        at += wide + 8;
      } else {
        // A packet.
        const wide = 30 + next() * 10;
        const tall = 56 + next() * 16;
        box(pen, at, base - tall, wide, tall, 3, colour, 3);
        oval(pen, at + wide / 2, base - tall * 0.58, wide * 0.28, wide * 0.28); paint(pen, 'rgba(255,247,232,.75)');
        at += wide + 8;
      }
    }
    box(pen, 8, base, w - 16, 12, 3, '#6b4630', 3.5);
  }
  flat(pen, 0, wall - 12, w, 12, '#1c2636');
  // The light somebody left on, at the far end: the one in the painting.
  glow(pen, 96, wall + 30, 260, '255,236,170', 0.26);
}

function paintPantry(pen, room) {
  const { w, h, wall } = room;
  pantryWall(pen, room);
  tiles(pen, 0, wall, w, h - wall, 76, '#b9573f', '#ead9bd', '#6b3f33');
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.42)');
  glow(pen, 96, wall + 30, 300, '255,236,170', 0.2);
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '255,200,61', 0.1);
  shell(pen, room);
}

// ---------------------------------------------------------------- which room, and what stands on its floor

const PAINTERS = { home: paintHome, pantry: paintPantry };
/** Paints a whole room, flat on, with its top left corner at (0, 0). `art` is the paintings it may use. */
export const paintRoom = (pen, id, room, art) => (PAINTERS[id] || paintPantry)(pen, room, art);

// What stands out on the floor, by the id of the block it stands on: a painting from Tin Can Alley
// (and how wide it stands), or something drawn here.
const STANDING = {
  basket: { draw: basket },
  crates: { art: 'a_crate', wide: 132 }, boxes: { art: 'a_boxes', wide: 122 }, bottles: { art: 'a_bottles', wide: 112 },
  pallets: { art: 'a_pallets', wide: 118 }, sacks: { art: 'a_boxes', wide: 122 },
};
/** The paintings a room needs from the world's (assets/world), by name. */
export const roomArt = (room) => [...new Set(room.blocks.map((block) => STANDING[block.id] && STANDING[block.id].art).filter(Boolean))];
/** Everything standing out on a room's floor: { y: how far down the floor its foot is, paint(pen, art) } with the pen moved to its foot. */
export function standingIn(room) {
  return room.blocks.filter((block) => STANDING[block.id]).map((block) => {
    const what = STANDING[block.id];
    return {
      id: block.id, x: block.x + block.w / 2, y: block.y + block.h,
      paint: (pen, art) => (what.draw ? what.draw(pen, block) : paintProp(pen, art[what.art], what.wide)),
    };
  });
}
