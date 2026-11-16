// Painting the world: the ground, the buildings and the things that stand on
// it. Everything here is drawn with shapes, in the look of the sprites: a bold
// dark outline, flat colour, one band of light and one of shade. It is a
// stand-in until the world is painted (see docs/ART.md), but a careful one.
//
// Nothing here moves or knows about the game. Each painter draws one thing
// once; lane.js keeps the results and puts them on screen every frame, so
// this can afford to be detailed.

export const INK = '#0d0a1c';
export const FONT = 'Fredoka, ui-rounded, system-ui, sans-serif';

const parts = (hexColour) => [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));
/** Two colours (as #rrggbb) mixed: 0 is all the first, 1 all the second. */
export const mix = (a, b, t) => { const p = parts(a); const q = parts(b); return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`; };
/** A fixed run of numbers from 0 to 1: looks only, so not the game's dice. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// ---------------------------------------------------------------- shapes

export function rounded(pen, x, y, w, h, r) {
  pen.beginPath();
  pen.moveTo(x + r, y);
  pen.arcTo(x + w, y, x + w, y + h, r);
  pen.arcTo(x + w, y + h, x, y + h, r);
  pen.arcTo(x, y + h, x, y, r);
  pen.arcTo(x, y, x + w, y, r);
  pen.closePath();
}
const shape = (pen, points) => { pen.beginPath(); points.forEach(([x, y], i) => (i ? pen.lineTo(x, y) : pen.moveTo(x, y))); pen.closePath(); };
export const oval = (pen, x, y, rx, ry) => { pen.beginPath(); pen.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
const disc = (pen, x, y, r) => { pen.beginPath(); pen.arc(x, y, r, 0, Math.PI * 2); };
export const paint = (pen, colour) => { pen.fillStyle = colour; pen.fill(); };
export const outline = (pen, width = 4.5) => { pen.lineWidth = width; pen.strokeStyle = INK; pen.lineJoin = 'round'; pen.lineCap = 'round'; pen.stroke(); };

export function glow(pen, x, y, r, rgb, alpha) {
  const g = pen.createRadialGradient(x, y, 2, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  pen.fillStyle = g;
  pen.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Several discs drawn as one shape: one outline round the lot, none between them. */
function clump(pen, discs, colour, width = 4.5) {
  for (const [x, y, r] of discs) { disc(pen, x, y, r); outline(pen, width * 2); }
  for (const [x, y, r] of discs) { disc(pen, x, y, r); paint(pen, colour); }
}

export function label(pen, text, x, y, colour = '#fff7e8', edge = 'rgba(255,255,255,.28)') {
  pen.font = `600 19px ${FONT}`;
  const tw = pen.measureText(text).width;
  rounded(pen, x - tw / 2 - 13, y - 16, tw + 26, 31, 15.5); paint(pen, 'rgba(13,10,28,.88)');
  pen.lineWidth = 2; pen.strokeStyle = edge; pen.stroke();
  pen.textBaseline = 'middle'; pen.textAlign = 'center'; pen.fillStyle = colour;
  pen.fillText(text, x, y + 1);
}

// ---------------------------------------------------------------- the ground

function grass(pen, w, top, bottom, next, blade, count) {
  // Soft patches of lighter and darker turf
  for (let i = 0; i < count / 9; i++) {
    oval(pen, next() * w, top + next() * (bottom - top), 50 + next() * 70, 20 + next() * 26);
    paint(pen, next() > 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(8,10,30,.13)');
  }
  // Tufts: three blades each
  pen.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = next() * w;
    const y = top + next() * (bottom - top);
    const tall = 7 + next() * 8;
    pen.strokeStyle = `rgba(${blade},${0.1 + next() * 0.2})`;
    pen.lineWidth = 2 + next();
    pen.beginPath();
    pen.moveTo(x - 4, y); pen.lineTo(x - 7, y - tall * 0.75);
    pen.moveTo(x, y); pen.lineTo(x, y - tall);
    pen.moveTo(x + 4, y); pen.lineTo(x + 7, y - tall * 0.75);
    pen.stroke();
  }
}

/** Points along a curve through the middles of a line of points, a step apart, each with the way it is heading. */
function along(points, step, smooth) {
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
  if (!smooth) { for (let i = 0; i < points.length - 1; i++) add(points[i], mid(points[i], points[i + 1]), points[i + 1]); return out; }
  let from = points[0];
  for (let i = 1; i < points.length - 1; i++) { const to = mid(points[i], points[i + 1]); add(from, points[i], to); from = to; }
  add(from, mid(from, points[points.length - 1]), points[points.length - 1]);
  return out;
}

/** A worn way: a dark edge, packed earth, a paler middle, pebbles at the sides and stepping stones down it. */
function wornWay(pen, trace, stones, next, tone) {
  pen.lineCap = 'round'; pen.lineJoin = 'round'; pen.setLineDash([]);
  trace(); pen.strokeStyle = tone.edge; pen.lineWidth = 92; pen.stroke();
  trace(); pen.strokeStyle = tone.body; pen.lineWidth = 78; pen.stroke();
  trace(); pen.strokeStyle = tone.middle; pen.lineWidth = 50; pen.stroke();
  for (const p of stones) {
    // Pebbles scattered toward the edges
    for (let i = 0; i < 2; i++) {
      const side = (next() > 0.5 ? 1 : -1) * (24 + next() * 12);
      oval(pen, p.x + Math.cos(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, p.y + Math.sin(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, 2.5 + next() * 2.5, 2 + next() * 2);
      paint(pen, tone.pebble);
    }
  }
  stones.forEach((p, i) => {
    if (i % 2) return;
    pen.save();
    pen.translate(p.x + (next() - 0.5) * 8, p.y + (next() - 0.5) * 8);
    pen.rotate(p.a + (next() - 0.5) * 0.5);
    rounded(pen, -16, -9, 32, 22, 9); paint(pen, 'rgba(8,10,30,.4)');
    rounded(pen, -16, -11, 32, 21, 9); paint(pen, tone.stone);
    rounded(pen, -11, -8, 16, 5, 2.5); paint(pen, 'rgba(255,255,255,.22)');
    pen.restore();
  });
}

/** A hedge all the way round the edge of the world. */
function border(pen, w, top, bottom) {
  const next = run(97);
  const discs = [];
  for (let y = top; y <= bottom; y += 30) { discs.push([-4 + next() * 8, y, 22 + next() * 6]); discs.push([w + 4 - next() * 8, y, 22 + next() * 6]); }
  clump(pen, discs, '#143039', 4);
  for (const [x, y, r] of discs) if (next() > 0.55) { disc(pen, x + (x < w / 2 ? 5 : -5), y - 6, r * 0.34); paint(pen, '#1d4650'); }
}

/** The lane's ground, from well above its top to well below its bottom (the view can scroll a little past both). */
export function paintLaneGround(pen, size, route, spots, lamps) {
  const top = -260;
  const bottom = size.h + 420;
  const sky = pen.createLinearGradient(0, 0, 0, size.h);
  sky.addColorStop(0, '#16233a'); sky.addColorStop(0.5, '#1a2f45'); sky.addColorStop(1, '#1d3948');
  pen.fillStyle = sky; pen.fillRect(-80, top, size.w + 160, bottom - top);
  const next = run(11);
  grass(pen, size.w, top, bottom, next, '120,200,180', 1500);
  // Clover and small night flowers
  for (let i = 0; i < 260; i++) { disc(pen, next() * size.w, top + next() * (bottom - top), 1.6 + next() * 1.8); paint(pen, next() > 0.6 ? 'rgba(255,240,200,.5)' : 'rgba(150,220,255,.34)'); }
  // The lane itself, from below home past every door in turn
  const trace = () => {
    pen.beginPath();
    pen.moveTo(route[0].x, route[0].y);
    for (let i = 1; i < route.length - 1; i++) pen.quadraticCurveTo(route[i].x, route[i].y, (route[i].x + route[i + 1].x) / 2, (route[i].y + route[i + 1].y) / 2);
    pen.lineTo(route[route.length - 1].x, route[route.length - 1].y);
  };
  wornWay(pen, trace, along(route, 24, true), next, { edge: 'rgba(8,10,30,.5)', body: '#453d6e', middle: '#51487e', pebble: 'rgba(190,180,235,.4)', stone: '#7d73b4' });
  // A swept apron in front of every door
  for (const spot of spots) { oval(pen, spot.door.x, spot.door.y - 4, 62, 26); paint(pen, '#51487e'); oval(pen, spot.door.x, spot.door.y - 6, 46, 17); paint(pen, 'rgba(255,255,255,.05)'); }
  // Lamplight pooling on the ground
  for (const lamp of lamps) glow(pen, lamp.x, lamp.y + 4, 140, '255,200,61', 0.2);
  border(pen, size.w, top, bottom);
}

/** The ground inside a place: a mown lawn in the room's own colour, flowers, and the way through. */
export function paintInsideGround(pen, room, area) {
  const top = -260;
  const bottom = area.h + 420;
  const lawn = pen.createLinearGradient(0, 0, 0, area.h);
  lawn.addColorStop(0, mix(room.tint, INK, 0.7)); lawn.addColorStop(1, mix(room.tint, INK, 0.6));
  pen.fillStyle = lawn; pen.fillRect(-80, top, area.w + 160, bottom - top);
  // Mown in stripes
  for (let y = top; y < bottom; y += 140) { pen.fillStyle = 'rgba(255,255,255,.028)'; pen.fillRect(-80, y, area.w + 160, 70); }
  const next = run(23);
  grass(pen, area.w, top, bottom, next, '200,245,170', 1300);
  const way = [{ x: area.gate.x, y: area.h + 80 }, area.gate, ...area.posts];
  wornWay(pen, () => { pen.beginPath(); way.forEach((p, i) => (i ? pen.lineTo(p.x, p.y) : pen.moveTo(p.x, p.y))); }, along(way, 24, false), next,
    { edge: 'rgba(8,10,30,.36)', body: mix(room.tint, '#6b5a48', 0.72), middle: mix(room.tint, '#8a765c', 0.74), pebble: 'rgba(255,240,205,.34)', stone: mix(room.tint, '#d9cba8', 0.78) });
  // Flowers, thickest in beds along the foot of each hedge
  const bloom = (x, y) => {
    const colour = ['#ff9bc0', '#ffe07a', '#f4f0ff', '#ffb37a'][Math.floor(next() * 4)];
    for (let k = 0; k < 5; k++) { disc(pen, x + Math.cos(k * 1.257) * 3.4, y + Math.sin(k * 1.257) * 3.4, 2.6); paint(pen, colour); }
    disc(pen, x, y, 2); paint(pen, '#7a4a00');
  };
  for (const block of area.blocks) for (let x = block.x + 16; x < block.x + block.w - 8; x += 26 + next() * 16) bloom(x, block.y + block.h + 12 + next() * 12);
  for (let i = 0; i < 70; i++) bloom(26 + next() * (area.w - 52), next() * area.h);
  glow(pen, area.gate.x, area.gate.y, 120, '255,200,61', 0.24);
  border(pen, area.w, top, bottom);
}

// ---------------------------------------------------------------- things that stand on the ground

/** A tree, drawn with its foot at (0, 0); r is how big. */
export function paintTree(pen, r) {
  oval(pen, 0, 5, r * 0.95, 10); paint(pen, 'rgba(8,6,20,.42)');
  rounded(pen, -7, -r * 0.95, 14, r, 4); paint(pen, '#4a3346'); outline(pen, 4);
  clump(pen, [[-r * 0.52, -r * 1.3, r * 0.7], [r * 0.52, -r * 1.3, r * 0.7], [0, -r * 1.85, r * 0.84]], '#2a6350');
  disc(pen, -r * 0.3, -r * 2.05, r * 0.34); paint(pen, '#3b876a');
  disc(pen, -r * 0.66, -r * 1.42, r * 0.22); paint(pen, '#3b876a');
  disc(pen, r * 0.5, -r * 1.05, r * 0.4); paint(pen, 'rgba(13,10,28,.16)');
}

/** A lamp post with its foot at (0, 0). */
export function paintLamp(pen) {
  oval(pen, 0, 2, 10, 4.5); paint(pen, 'rgba(8,6,20,.5)');
  rounded(pen, -7, -8, 14, 10, 3); paint(pen, '#2a2444'); outline(pen, 3.5);
  rounded(pen, -3.5, -78, 7, 72, 3); paint(pen, '#3a3360'); outline(pen, 3.5);
  glow(pen, 0, -90, 50, '255,220,130', 0.55);
  shape(pen, [[-13, -80], [13, -80], [9, -104], [-9, -104]]); paint(pen, '#ffd76a'); outline(pen, 3.5);
  shape(pen, [[-15, -104], [15, -104], [0, -118]]); paint(pen, '#3a3360'); outline(pen, 3.5);
  rounded(pen, -4, -100, 5, 14, 2); paint(pen, 'rgba(255,255,255,.55)');
}

/** A hedge filling a block of ground (block.x, block.y is its top-left). */
export function paintHedge(pen, block) {
  const next = run(Math.round(block.x * 7 + block.y));
  oval(pen, block.x + block.w / 2, block.y + block.h + 6, block.w * 0.5, 11); paint(pen, 'rgba(8,6,20,.36)');
  const discs = [];
  for (let x = block.x + 14; x <= block.x + block.w - 14; x += 34) discs.push([x, block.y - 8 + next() * 8, 26 + next() * 5]);
  for (const [x, y, r] of discs) { disc(pen, x, y, r); outline(pen, 9); }
  rounded(pen, block.x - 6, block.y - 6, block.w + 12, block.h + 6, 18); outline(pen, 9);
  rounded(pen, block.x - 6, block.y - 6, block.w + 12, block.h + 6, 18); paint(pen, '#1f5a3f');
  for (const [x, y, r] of discs) { disc(pen, x, y, r); paint(pen, '#27704c'); }
  for (const [x, y, r] of discs) { disc(pen, x - r * 0.3, y - r * 0.36, r * 0.36); paint(pen, '#349061'); }
  pen.save(); rounded(pen, block.x - 6, block.y - 6, block.w + 12, block.h + 6, 18); pen.clip();
  pen.fillStyle = 'rgba(13,10,28,.24)'; pen.fillRect(block.x - 6, block.y + block.h - 14, block.w + 12, 16);
  pen.restore();
}

/** A bush with something hiding in it, foot at (0, 0); big for a boss. */
export function paintBush(pen, big) {
  const k = big ? 1.5 : 1;
  oval(pen, 0, 6, 52 * k, 13 * k); paint(pen, 'rgba(8,6,20,.42)');
  clump(pen, [[-27 * k, -20 * k, 24 * k], [26 * k, -22 * k, 26 * k], [0, -42 * k, 29 * k]], '#1f5a3f');
  disc(pen, -9 * k, -52 * k, 11 * k); paint(pen, '#2c7a55');
  disc(pen, -36 * k, -26 * k, 8 * k); paint(pen, '#2c7a55');
}

/** The gate of a place, its opening centred on (0, 0). */
export function paintGate(pen) {
  for (const side of [-1, 1]) {
    for (let i = 1; i <= 3; i++) { rounded(pen, side * (66 + i * 20) - 6, -30, 12, 44, 5); paint(pen, '#8a6048'); outline(pen, 3.5); }
    rounded(pen, side * 110 - 44, -12, 88, 9, 4); paint(pen, '#7a5340'); outline(pen, 3.5);
    rounded(pen, side * 58 - 10, -54, 20, 70, 7); paint(pen, '#7a5340'); outline(pen, 4.5);
    disc(pen, side * 58, -58, 9); paint(pen, '#8a6048'); outline(pen, 4);
  }
  rounded(pen, -66, -68, 132, 16, 8); paint(pen, '#8a6048'); outline(pen, 4.5);
}

// ---------------------------------------------------------------- buildings

function wall(pen, x, y, w, h, colour, r = 10) {
  rounded(pen, x - w / 2, y - h, w, h, r); paint(pen, colour);
  pen.save(); rounded(pen, x - w / 2, y - h, w, h, r); pen.clip();
  pen.fillStyle = 'rgba(13,10,28,.24)'; pen.fillRect(x - w / 2, y - 17, w, 17);
  pen.fillStyle = 'rgba(255,255,255,.1)'; pen.fillRect(x - w / 2, y - h, w, 11);
  pen.restore();
  rounded(pen, x - w / 2, y - h, w, h, r); outline(pen, 5);
}

function roof(pen, points, colour, tiles = true) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs); const right = Math.max(...xs); const top = Math.min(...ys); const bottom = Math.max(...ys);
  shape(pen, points); paint(pen, colour);
  pen.save(); shape(pen, points); pen.clip();
  pen.fillStyle = 'rgba(255,255,255,.17)'; pen.fillRect(left, top, right - left, 12);
  if (tiles) {
    pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 2.5;
    for (let ty = top + 24, row = 0; ty < bottom + 8; ty += 19, row++) for (let tx = left + (row % 2 ? 0 : 14); tx < right + 14; tx += 28) { pen.beginPath(); pen.arc(tx, ty, 14, 0, Math.PI); pen.stroke(); }
  }
  pen.fillStyle = 'rgba(13,10,28,.2)'; pen.fillRect(left, bottom - 9, right - left, 9);
  pen.restore();
  shape(pen, points); outline(pen, 5);
}

/** A window: lit and warm if someone is in, dark if the place is shut. `art` shows a painting through it. */
function pane(pen, x, y, w, h, lit, { art = null, bars = true, r = 6 } = {}) {
  if (lit) glow(pen, x, y, Math.max(w, h) * 1.15, '255,210,110', 0.3);
  rounded(pen, x - w / 2, y - h / 2, w, h, r); paint(pen, lit ? '#ffd76a' : '#181433');
  if (art && art.complete && art.naturalWidth) {
    pen.save(); rounded(pen, x - w / 2, y - h / 2, w, h, r); pen.clip();
    const side = art.naturalHeight * 0.62;
    pen.drawImage(art, art.naturalWidth * 0.28, art.naturalHeight * 0.2, side * (w / h), side, x - w / 2, y - h / 2, w, h);
    if (!lit) { pen.fillStyle = 'rgba(13,10,28,.76)'; pen.fillRect(x - w / 2, y - h / 2, w, h); }
    pen.restore();
  } else if (lit) {
    rounded(pen, x - w / 2 + 4, y - h / 2 + 4, w * 0.3, h - 8, 3); paint(pen, 'rgba(255,255,255,.4)');
  }
  rounded(pen, x - w / 2, y - h / 2, w, h, r); outline(pen, 4.5);
  if (bars) { pen.beginPath(); pen.moveTo(x, y - h / 2); pen.lineTo(x, y + h / 2); pen.moveTo(x - w / 2, y); pen.lineTo(x + w / 2, y); pen.lineWidth = 3; pen.strokeStyle = INK; pen.stroke(); }
}

function porthole(pen, x, y, r, lit, art) {
  if (lit) glow(pen, x, y, r * 1.8, '160,235,255', 0.3);
  disc(pen, x, y, r + 7); paint(pen, '#d8eef2'); outline(pen, 4.5);
  pen.save(); disc(pen, x, y, r); pen.clip();
  pen.fillStyle = lit ? '#8fe0ea' : '#181433'; pen.fillRect(x - r, y - r, r * 2, r * 2);
  if (art && art.complete && art.naturalWidth) pen.drawImage(art, art.naturalWidth * 0.3, art.naturalHeight * 0.2, art.naturalHeight * 0.6, art.naturalHeight * 0.6, x - r, y - r, r * 2, r * 2);
  if (!lit) { pen.fillStyle = 'rgba(13,10,28,.76)'; pen.fillRect(x - r, y - r, r * 2, r * 2); }
  pen.restore();
  disc(pen, x, y, r); outline(pen, 4);
  pen.beginPath(); pen.arc(x, y, r - 6, Math.PI * 1.1, Math.PI * 1.5); pen.lineWidth = 3.5; pen.strokeStyle = 'rgba(255,255,255,.6)'; pen.stroke();
}

/** A door: arched, with a knob, and a padlock on it if the place is shut. */
function door(pen, x, y, w, h, colour, lit) {
  rounded(pen, x - w / 2 - 5, y - h - 5, w + 10, h + 7, w / 2 + 3); paint(pen, 'rgba(13,10,28,.32)');
  rounded(pen, x - w / 2, y - h, w, h + 2, w / 2 - 2); paint(pen, lit ? colour : '#221a3a'); outline(pen, 4.5);
  rounded(pen, x - w / 2 + 6, y - h + 8, w - 12, h * 0.36, w / 2 - 8); paint(pen, lit ? '#ffd76a' : '#181433'); outline(pen, 3);
  if (lit) { disc(pen, x + w / 2 - 9, y - h * 0.34, 3.4); paint(pen, '#ffe9a0'); outline(pen, 2); } else padlock(pen, x, y - h * 0.3);
}

function padlock(pen, x, y) {
  pen.lineWidth = 4.5; pen.strokeStyle = '#b6b0d6'; pen.lineCap = 'round'; pen.beginPath(); pen.arc(x, y, 7.5, Math.PI, 0); pen.stroke();
  rounded(pen, x - 11, y, 22, 17, 4); paint(pen, '#b6b0d6'); outline(pen, 3);
}

const flowerBox = (pen, x, y, w) => {
  rounded(pen, x - w / 2, y, w, 10, 3); paint(pen, '#7a5340'); outline(pen, 3);
  for (let i = 0; i < 4; i++) { disc(pen, x - w / 2 + 6 + (i * (w - 12)) / 3, y - 2, 5); paint(pen, ['#ff9bc0', '#ffe07a', '#f4f0ff', '#ff9bc0'][i]); outline(pen, 2.5); }
};

// One painter for each place. (x, y) is the middle of the foot of its front wall. `lit` is whether you
// can go in; `art` is that room's own painting, shown through a window. Each returns how tall it stands.
const BUILDINGS = {
  // Great-aunt Maribel's house: a cottage with a tiled roof and the lights on.
  home(pen, x, y, lit) {
    rounded(pen, x + 50, y - 212, 28, 56, 4); paint(pen, '#8a5a50'); outline(pen, 5);
    rounded(pen, x + 46, y - 218, 36, 12, 4); paint(pen, '#a36a5c'); outline(pen, 4.5);
    wall(pen, x, y, 232, 98, '#c8935a');
    roof(pen, [[x - 140, y - 90], [x - 62, y - 178], [x + 62, y - 178], [x + 140, y - 90]], '#d9722e');
    disc(pen, x, y - 132, 17); paint(pen, lit ? '#ffd76a' : '#181433'); outline(pen, 4.5);
    pen.beginPath(); pen.moveTo(x - 17, y - 132); pen.lineTo(x + 17, y - 132); pen.moveTo(x, y - 149); pen.lineTo(x, y - 115); pen.lineWidth = 3; pen.strokeStyle = INK; pen.stroke();
    pane(pen, x - 74, y - 58, 38, 38, lit); pane(pen, x + 74, y - 58, 38, 38, lit);
    flowerBox(pen, x - 74, y - 36, 48); flowerBox(pen, x + 74, y - 36, 48);
    door(pen, x, y, 46, 64, '#7a4a2a', lit);
    rounded(pen, x - 26, y + 3, 52, 10, 4); paint(pen, '#8a6048'); outline(pen, 3);
    return 220;
  },
  // The Garden Gate: a potting shed with a greenhouse on its side.
  garden(pen, x, y, lit, tint, art) {
    wall(pen, x - 22, y, 136, 86, mix(tint, INK, 0.3));
    roof(pen, [[x - 104, y - 78], [x - 60, y - 130], [x + 16, y - 130], [x + 60, y - 78]], mix(tint, INK, 0.5));
    // The greenhouse: glass in white frames
    shape(pen, [[x + 44, y], [x + 44, y - 62], [x + 70, y - 84], [x + 96, y - 62], [x + 96, y]]); paint(pen, lit ? '#bfeede' : '#1c2a3a'); outline(pen, 5);
    pen.save(); shape(pen, [[x + 44, y], [x + 44, y - 62], [x + 70, y - 84], [x + 96, y - 62], [x + 96, y]]); pen.clip();
    if (art && art.complete && art.naturalWidth) { pen.globalAlpha = lit ? 0.85 : 0.25; pen.drawImage(art, art.naturalWidth * 0.3, art.naturalHeight * 0.25, art.naturalHeight * 0.4, art.naturalHeight * 0.65, x + 44, y - 84, 52, 84); pen.globalAlpha = 1; }
    pen.strokeStyle = '#f4fff8'; pen.lineWidth = 3.5; pen.beginPath(); pen.moveTo(x + 70, y - 84); pen.lineTo(x + 70, y); pen.moveTo(x + 44, y - 34); pen.lineTo(x + 96, y - 34); pen.moveTo(x + 44, y - 62); pen.lineTo(x + 96, y - 62); pen.stroke();
    pen.restore();
    pane(pen, x - 62, y - 50, 34, 34, lit); flowerBox(pen, x - 62, y - 30, 44);
    door(pen, x, y, 42, 60, mix(tint, '#7a4a2a', 0.7), lit);
    // A sunflower by the door
    pen.strokeStyle = '#2f7a55'; pen.lineWidth = 4; pen.beginPath(); pen.moveTo(x - 96, y + 4); pen.lineTo(x - 96, y - 40); pen.stroke();
    disc(pen, x - 96, y - 46, 12); paint(pen, '#ffc83d'); outline(pen, 3.5); disc(pen, x - 96, y - 46, 5); paint(pen, '#7a4a00');
    return 134;
  },
  // Tin Can Alley: a brick lean-to with a tin roof, a drainpipe and two bins.
  alley(pen, x, y, lit, tint) {
    wall(pen, x - 8, y, 170, 82, mix(tint, INK, 0.28), 6);
    pen.strokeStyle = 'rgba(13,10,28,.26)'; pen.lineWidth = 2.5; pen.beginPath();
    for (let row = 0; row < 4; row++) for (let bx = x - 84 + (row % 2 ? 12 : 0); bx < x + 64; bx += 30) { pen.moveTo(bx, y - 24 - row * 16); pen.lineTo(bx + 16, y - 24 - row * 16); }
    pen.stroke();
    shape(pen, [[x - 104, y - 78], [x - 96, y - 122], [x + 88, y - 100], [x + 88, y - 78]]); paint(pen, mix(tint, '#ffffff', 0.12));
    pen.save(); shape(pen, [[x - 104, y - 78], [x - 96, y - 122], [x + 88, y - 100], [x + 88, y - 78]]); pen.clip();
    pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 3; pen.beginPath(); for (let cx = x - 92; cx < x + 88; cx += 15) { pen.moveTo(cx, y - 130); pen.lineTo(cx, y - 78); } pen.stroke();
    pen.restore();
    shape(pen, [[x - 104, y - 78], [x - 96, y - 122], [x + 88, y - 100], [x + 88, y - 78]]); outline(pen, 5);
    rounded(pen, x + 64, y - 96, 10, 96, 4); paint(pen, '#566178'); outline(pen, 3.5);
    pane(pen, x - 58, y - 48, 32, 30, lit);
    door(pen, x - 6, y, 42, 58, '#566178', lit);
    for (const [bx, tall] of [[x + 86, 44], [x + 112, 36]]) {
      rounded(pen, bx - 13, y + 8 - tall, 26, tall, 4); paint(pen, '#8a94a8'); outline(pen, 3.5);
      pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 2.5; pen.beginPath(); pen.moveTo(bx - 5, y + 14 - tall); pen.lineTo(bx - 5, y + 2); pen.moveTo(bx + 5, y + 14 - tall); pen.lineTo(bx + 5, y + 2); pen.stroke();
      oval(pen, bx, y + 8 - tall, 15, 5); paint(pen, '#a7b1c4'); outline(pen, 3.5);
    }
    return 126;
  },
  // The Midnight Pantry: a corner shop with a striped awning and jars in the window.
  pantry(pen, x, y, lit, tint) {
    wall(pen, x, y, 184, 92, mix(tint, INK, 0.22));
    rounded(pen, x - 100, y - 112, 200, 24, 7); paint(pen, mix(tint, INK, 0.5)); outline(pen, 5);
    rounded(pen, x - 94, y - 108, 188, 7, 3); paint(pen, 'rgba(255,255,255,.14)');
    pane(pen, x - 40, y - 34, 86, 44, lit, { bars: false });
    // Jars on a shelf
    for (let i = 0; i < 4; i++) { rounded(pen, x - 74 + i * 20, y - 44, 13, 20, 4); paint(pen, lit ? ['#ff8a96', '#8fe0ea', '#b6e07a', '#ffb37a'][i] : '#2a2444'); outline(pen, 2.5); rounded(pen, x - 73 + i * 20, y - 48, 11, 5, 2); paint(pen, '#7a5340'); outline(pen, 2); }
    door(pen, x + 54, y, 42, 62, mix(tint, '#7a4a2a', 0.6), lit);
    // The awning
    const stripes = 8;
    for (let i = 0; i < stripes; i++) { shape(pen, [[x - 88 + i * 22, y - 88], [x - 66 + i * 22, y - 88], [x - 62 + i * 23, y - 62], [x - 85 + i * 23, y - 62]]); paint(pen, i % 2 ? tint : '#fff1d6'); }
    shape(pen, [[x - 88, y - 88], [x + 88, y - 88], [x + 99, y - 62], [x - 85, y - 62]]); outline(pen, 4.5);
    for (let i = 0; i < stripes; i++) { pen.beginPath(); pen.arc(x - 73.5 + i * 23, y - 62, 11.5, 0, Math.PI); paint(pen, i % 2 ? tint : '#fff1d6'); pen.beginPath(); pen.arc(x - 73.5 + i * 23, y - 62, 11.5, 0, Math.PI); outline(pen, 3.5); }
    return 116;
  },
  // The Wash: a launderette with a porthole for a window.
  wash(pen, x, y, lit, tint, art) {
    wall(pen, x, y, 184, 96, mix(tint, INK, 0.24));
    rounded(pen, x - 100, y - 114, 200, 22, 7); paint(pen, mix(tint, INK, 0.52)); outline(pen, 5);
    rounded(pen, x - 94, y - 110, 188, 6, 3); paint(pen, 'rgba(255,255,255,.14)');
    porthole(pen, x - 38, y - 48, 31, lit, art);
    door(pen, x + 54, y, 42, 62, mix(tint, '#2a4a6a', 0.5), lit);
    for (const [bx, by, r] of [[x + 40, y - 84, 6], [x + 58, y - 78, 4], [x + 70, y - 88, 5]]) { disc(pen, bx, by, r); paint(pen, 'rgba(255,255,255,.3)'); pen.lineWidth = 2; pen.strokeStyle = 'rgba(255,255,255,.7)'; pen.stroke(); }
    return 118;
  },
  // The Dusty Stacks: a small library with books in the window.
  stacks(pen, x, y, lit, tint) {
    wall(pen, x, y, 180, 90, mix(tint, INK, 0.3), 6);
    roof(pen, [[x - 106, y - 84], [x, y - 142], [x + 106, y - 84]], mix(tint, INK, 0.56), false);
    disc(pen, x, y - 106, 11); paint(pen, lit ? '#ffd76a' : '#181433'); outline(pen, 4);
    for (const side of [-1, 1]) { rounded(pen, x + side * 78 - 7, y - 84, 14, 84, 4); paint(pen, mix(tint, '#ffffff', 0.3)); outline(pen, 3.5); }
    // A window of book spines
    rounded(pen, x - 64, y - 70, 62, 54, 5); paint(pen, lit ? '#3a2a1c' : '#181433'); outline(pen, 4.5);
    const next = run(41);
    for (let shelf = 0; shelf < 2; shelf++) for (let bx = x - 60; bx < x - 8; bx += 7) { rounded(pen, bx, y - 66 + shelf * 26, 6, 21 - next() * 5, 1.5); paint(pen, lit ? ['#ff8a96', '#8fe0ea', '#ffe07a', '#b6e07a', '#c9b8e8'][Math.floor(next() * 5)] : '#2a2444'); }
    pen.strokeStyle = INK; pen.lineWidth = 3; pen.beginPath(); pen.moveTo(x - 64, y - 43); pen.lineTo(x - 2, y - 43); pen.stroke();
    door(pen, x + 36, y, 42, 62, mix(tint, INK, 0.55), lit);
    for (let i = 0; i < 3; i++) { rounded(pen, x - 100 + i * 3, y - 2 - i * 9, 30 - i * 5, 9, 2.5); paint(pen, ['#ff8a96', '#8fe0ea', '#ffe07a'][i]); outline(pen, 3); }
    return 146;
  },
  // Moonlit Rooftops: a tall thin townhouse with crooked chimneys and a ladder up the side.
  rooftops(pen, x, y, lit, tint) {
    rounded(pen, x - 46, y - 214, 18, 46, 3); paint(pen, mix(tint, INK, 0.55)); outline(pen, 4.5);
    rounded(pen, x + 26, y - 200, 16, 34, 3); paint(pen, mix(tint, INK, 0.55)); outline(pen, 4.5);
    wall(pen, x, y, 126, 150, mix(tint, INK, 0.32), 6);
    roof(pen, [[x - 76, y - 144], [x, y - 208], [x + 76, y - 144]], mix(tint, INK, 0.6));
    pen.strokeStyle = INK; pen.lineWidth = 3.5; pen.beginPath(); pen.moveTo(x, y - 208); pen.lineTo(x, y - 232); pen.stroke();
    disc(pen, x, y - 242, 11); paint(pen, '#ffe07a'); outline(pen, 3.5); disc(pen, x + 6, y - 245, 9); paint(pen, mix(tint, INK, 0.74));
    pane(pen, x - 28, y - 112, 28, 30, lit); pane(pen, x + 28, y - 112, 28, 30, lit); pane(pen, x - 28, y - 68, 28, 30, lit);
    door(pen, x + 22, y, 40, 58, mix(tint, INK, 0.6), lit);
    // The ladder
    pen.strokeStyle = INK; pen.lineWidth = 7; pen.beginPath(); pen.moveTo(x + 78, y + 4); pen.lineTo(x + 70, y - 150); pen.moveTo(x + 98, y + 4); pen.lineTo(x + 90, y - 150); pen.stroke();
    pen.strokeStyle = '#b08a5c'; pen.lineWidth = 3.5; pen.beginPath(); pen.moveTo(x + 78, y + 4); pen.lineTo(x + 70, y - 150); pen.moveTo(x + 98, y + 4); pen.lineTo(x + 90, y - 150);
    for (let ry = y - 10; ry > y - 146; ry -= 20) { const lean = ((y + 4 - ry) / 154) * 8; pen.moveTo(x + 78 - lean, ry); pen.lineTo(x + 98 - lean, ry); }
    pen.stroke();
    return 256;
  },
  // The Tick-Tock Attic: a cottage with a clock tower growing out of it.
  attic(pen, x, y, lit, tint) {
    wall(pen, x, y, 184, 66, mix(tint, INK, 0.3), 6);
    roof(pen, [[x - 104, y - 60], [x - 60, y - 96], [x + 60, y - 96], [x + 104, y - 60]], mix(tint, INK, 0.55));
    wall(pen, x, y - 60, 100, 112, mix(tint, INK, 0.2), 6);
    roof(pen, [[x - 64, y - 166], [x, y - 220], [x + 64, y - 166]], mix(tint, INK, 0.55));
    if (lit) glow(pen, x, y - 124, 58, '255,230,150', 0.3);
    disc(pen, x, y - 124, 31); paint(pen, lit ? '#fff4d6' : '#3a3458'); outline(pen, 5);
    pen.strokeStyle = INK; pen.lineWidth = 3; pen.beginPath();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pen.moveTo(x + Math.cos(a) * 24, y - 124 + Math.sin(a) * 24); pen.lineTo(x + Math.cos(a) * 28, y - 124 + Math.sin(a) * 28); }
    pen.stroke();
    rounded(pen, x - 9, y - 84, 18, 20, 8); paint(pen, mix(tint, INK, 0.6)); outline(pen, 3.5);
    pane(pen, x - 62, y - 34, 30, 30, lit); pane(pen, x + 62, y - 34, 30, 30, lit);
    door(pen, x, y, 40, 54, mix(tint, INK, 0.6), lit);
    return 224;
  },
  // The Roaring Dark: a boarded-up shed with something plugged in inside.
  dark(pen, x, y, lit, tint) {
    wall(pen, x, y, 172, 84, mix(tint, INK, 0.68), 6);
    roof(pen, [[x - 100, y - 76], [x - 34, y - 132], [x + 106, y - 70]], mix(tint, INK, 0.8), false);
    glow(pen, x, y - 30, 70, '255,60,90', lit ? 0.4 : 0.16);
    rounded(pen, x - 24, y - 62, 48, 64, 5); paint(pen, '#1a0e1c'); outline(pen, 5);
    pen.strokeStyle = `rgba(255,70,100,${lit ? 0.9 : 0.4})`; pen.lineWidth = 2.5; pen.strokeRect(x - 19, y - 57, 38, 55);
    for (const [ax, ay, bx, by] of [[x - 34, y - 52, x + 34, y - 40], [x - 34, y - 14, x + 34, y - 28]]) {
      pen.lineCap = 'round'; pen.strokeStyle = INK; pen.lineWidth = 16; pen.beginPath(); pen.moveTo(ax, ay); pen.lineTo(bx, by); pen.stroke();
      pen.strokeStyle = '#6b4a3a'; pen.lineWidth = 9; pen.beginPath(); pen.moveTo(ax, ay); pen.lineTo(bx, by); pen.stroke();
    }
    pane(pen, x - 62, y - 44, 26, 24, false, { bars: false });
    for (const ex of [x - 67, x - 57]) { disc(pen, ex, y - 44, 2.6); paint(pen, '#ff5a6a'); }
    // A tangle of power cord
    pen.strokeStyle = INK; pen.lineWidth = 6; pen.lineCap = 'round'; pen.beginPath(); pen.moveTo(x + 44, y - 8);
    pen.bezierCurveTo(x + 70, y - 30, x + 96, y + 14, x + 70, y + 8); pen.bezierCurveTo(x + 50, y + 2, x + 100, y - 14, x + 108, y + 8); pen.stroke();
    if (!lit) padlock(pen, x, y - 22);
    return 136;
  },
};

/**
 * One building, standing with the middle of its front wall's foot at (x, y), its name over it.
 * `art` is the room's painting, for whichever window shows it.
 */
export function paintBuilding(pen, spot, { name, tint = '#e8a23d', open = true, cleared = false, art = null }) {
  const { x, y, w } = spot;
  oval(pen, x, y + 6, w * 0.6, 17); paint(pen, 'rgba(8,6,20,.45)');
  const tall = (BUILDINGS[spot.id] || BUILDINGS.home)(pen, x, y, open, tint, art);
  if (!open) {
    // Only where something has been painted: the building darkens, the air around it does not.
    pen.save();
    pen.globalCompositeOperation = 'source-atop';
    pen.fillStyle = 'rgba(13,10,28,.5)';
    pen.fillRect(x - 200, y - 320, 400, 380);
    pen.restore();
  }
  label(pen, `${cleared ? '✓ ' : ''}${name}`, x, y - tall - 24, cleared ? '#58d77a' : open ? '#fff7e8' : '#b6b0d6', cleared ? '#58d77a' : open ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)');
}

/** The little things that move on a building: smoke, bubbles, the hands of the clock, a red glow. */
export function paintLife(pen, spot, clock) {
  const { x, y } = spot;
  if (spot.id === 'home') {
    for (let i = 0; i < 3; i++) { const t = (clock * 0.22 + i / 3) % 1; disc(pen, x + 64 + Math.sin(t * 5 + i) * 7, y - 224 - t * 54, 7 + t * 9); paint(pen, `rgba(220,215,240,${0.3 * (1 - t)})`); }
  } else if (spot.id === 'wash') {
    for (let i = 0; i < 4; i++) { const t = (clock * 0.3 + i / 4) % 1; disc(pen, x + 30 + i * 14 + Math.sin(t * 6 + i) * 5, y - 118 - t * 46, 4 + (i % 2) * 2.5); pen.lineWidth = 2; pen.strokeStyle = `rgba(255,255,255,${0.75 * (1 - t)})`; pen.stroke(); }
  } else if (spot.id === 'attic') {
    const hand = (turns, long, width) => { const a = turns * Math.PI * 2 - Math.PI / 2; pen.strokeStyle = INK; pen.lineWidth = width; pen.lineCap = 'round'; pen.beginPath(); pen.moveTo(x, y - 124); pen.lineTo(x + Math.cos(a) * long, y - 124 + Math.sin(a) * long); pen.stroke(); };
    hand(clock / 240, 13, 5); hand(clock / 20, 21, 3.5);
    disc(pen, x, y - 124, 3.2); paint(pen, INK);
  } else if (spot.id === 'dark') {
    glow(pen, x, y - 30, 64, '255,60,90', 0.14 + 0.12 * Math.sin(clock * 2.4));
  }
}

/** Which places have a building of their own. */
export const PAINTED = Object.keys(BUILDINGS);
