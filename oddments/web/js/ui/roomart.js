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
  // Three shelves the length of the wall, and everything on them a size a hand could lift down.
  for (const base of [66, 122, 178]) {
    let at = 18;
    while (at < w - 40) {
      const sort = next();
      const colour = JARS[Math.floor(next() * JARS.length)];
      if (sort < 0.45) {
        // A jar: glass, what is in it, a lid.
        const wide = 18 + next() * 9;
        const tall = 24 + next() * 12;
        box(pen, at, base - tall, wide, tall, 5, '#9fc4cf', 2.5);
        rounded(pen, at + 2.5, base - tall * 0.72, wide - 5, tall * 0.72 - 2.5, 3.5); paint(pen, colour);
        box(pen, at + 2, base - tall - 5, wide - 4, 7, 2, '#8a5f40', 2.5);
        at += wide + 5;
      } else if (sort < 0.75) {
        // A tin, with a band round it.
        const wide = 20 + next() * 7;
        const tall = 19 + next() * 7;
        box(pen, at, base - tall, wide, tall, 3, '#aeb7c6', 2.5);
        flat(pen, at + 1.5, base - tall * 0.72, wide - 3, tall * 0.46, colour);
        at += wide + 5;
      } else {
        // A packet.
        const wide = 17 + next() * 7;
        const tall = 30 + next() * 10;
        box(pen, at, base - tall, wide, tall, 2, colour, 2.5);
        oval(pen, at + wide / 2, base - tall * 0.58, wide * 0.28, wide * 0.28); paint(pen, 'rgba(255,247,232,.75)');
        at += wide + 5;
      }
    }
    box(pen, 8, base, w - 16, 8, 2.5, '#6b4630', 3);
  }
  flat(pen, 0, wall - 12, w, 12, '#1c2636');
  // The light somebody left on, at the far end: the one in the painting.
  glow(pen, 96, wall + 30, 260, '255,236,170', 0.26);
}

function paintPantry(pen, room) {
  const { w, h, wall } = room;
  pantryWall(pen, room);
  tiles(pen, 0, wall, w, h - wall, 47.5, '#b9573f', '#ead9bd', '#6b3f33');
  mat(pen, room);
  flat(pen, 0, wall, w, h - wall, 'rgba(14,16,44,.42)');
  glow(pen, 96, wall + 30, 300, '255,236,170', 0.2);
  for (const post of room.posts) glow(pen, post.x, post.y, 150, '255,200,61', 0.1);
  shell(pen, room);
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

const PAINTERS = { home: paintHome, pantry: paintPantry, wash: paintWash, stacks: paintStacks, rooftops: paintRooftops, attic: paintAttic, dark: paintDark };
/** Paints a whole room, flat on, with its top left corner at (0, 0). `art` is the paintings it may use. */
export const paintRoom = (pen, id, room, art) => (PAINTERS[id] || paintPantry)(pen, room, art);

// What stands out on the floor, by the id of the block it stands on: a painting from Tin Can Alley
// (and how wide it stands), or something drawn here.
const STANDING = {
  basket: { draw: basket }, hamper: { draw: hamper }, books: { draw: bookpile }, chimney: { draw: chimney }, trunk: { draw: trunk }, sheet: { draw: dustsheet }, bucket: { draw: bucket },
  crates: { art: 'a_crate', wide: 96 }, boxes: { art: 'a_boxes', wide: 90 }, bottles: { art: 'a_bottles', wide: 84 },
  pallets: { art: 'a_pallets', wide: 90 }, sacks: { art: 'a_boxes', wide: 90 },
};
/** What stands on a block: by its id, less any number on the end (a room's second crate is 'crates2'). */
const standingOf = (block) => STANDING[block.id.replace(/\d+$/, '')] || null;
/** The paintings a room needs from the world's (assets/world), by name. */
export const roomArt = (room) => [...new Set(room.blocks.map((block) => standingOf(block) && standingOf(block).art).filter(Boolean))];
/** Everything standing out on a room's floor: { y: how far down the floor its foot is, paint(pen, art) } with the pen moved to its foot. */
export function standingIn(room) {
  return room.blocks.filter((block) => standingOf(block)).map((block) => {
    const what = standingOf(block);
    return {
      id: block.id, x: block.x + block.w / 2, y: block.y + block.h,
      paint: (pen, art) => (what.draw ? what.draw(pen, block) : paintProp(pen, art[what.art], what.wide)),
    };
  });
}
