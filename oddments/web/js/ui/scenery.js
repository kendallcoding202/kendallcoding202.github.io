// Painting the world: the ground, the buildings and the things that stand on
// it. The buildings, the tree, the lamp, the hedge bush and the grass are
// painted art (web/assets/world/, made by tools/process-art.py from one sheet
// and one texture); this lays them out, and draws in code the few things that
// have no painting yet: the path, its stepping stones, the gate and the name
// plates.
//
// Nothing here moves or knows about the game. Each painter draws one thing
// once; lane.js keeps the results and puts them on screen every frame.

export const INK = '#0d0a1c';
export const FONT = 'Fredoka, ui-rounded, system-ui, sans-serif';

/** The painted pictures of the world, by name, and where each lives. */
export const WORLD_ART = ['grass', 'earth', 'p_tree', 'p_lamp', 'p_bush', 'b_home', 'b_garden', 'b_alley', 'b_pantry', 'b_wash', 'b_stacks', 'b_rooftops', 'b_attic', 'b_dark'];
export const worldSrc = (name) => `assets/world/${name}.webp`;
/** How wide each building stands in the lane, in the world's units. Its height follows from its painting. */
export const BUILDING_WIDE = { home: 240, garden: 214, alley: 208, pantry: 214, wash: 190, stacks: 208, rooftops: 148, attic: 170, dark: 214 };

const parts = (hexColour) => [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));
/** Two colours (as #rrggbb) mixed: 0 is all the first, 1 all the second. */
export const mix = (a, b, t) => { const p = parts(a); const q = parts(b); return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`; };
/** A fixed run of numbers from 0 to 1: looks only, so not the game's dice. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const arrived = (image) => !!image && image.complete && image.naturalWidth > 0;

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

export function label(pen, text, x, y, colour = '#fff7e8', edge = 'rgba(255,255,255,.28)') {
  pen.font = `600 19px ${FONT}`;
  const tw = pen.measureText(text).width;
  rounded(pen, x - tw / 2 - 13, y - 16, tw + 26, 31, 15.5); paint(pen, 'rgba(13,10,28,.88)');
  pen.lineWidth = 2; pen.strokeStyle = edge; pen.stroke();
  pen.textBaseline = 'middle'; pen.textAlign = 'center'; pen.fillStyle = colour;
  pen.fillText(text, x, y + 1);
}

/** A painting standing with the middle of its foot at (x, y), `wide` across. Returns how tall it stands. */
export function stood(pen, image, x, y, wide) {
  if (!arrived(image)) return 0;
  const tall = wide * (image.naturalHeight / image.naturalWidth);
  pen.drawImage(image, x - wide / 2, y - tall, wide, tall);
  return tall;
}

// ---------------------------------------------------------------- the ground

const TILE = 300; // how much ground one tile of the grass painting covers

/** Lays the grass painting over a stretch of ground, then a wash of colour to set the hour and the place. */
function turf(pen, grass, w, top, bottom, wash) {
  pen.fillStyle = '#1b3a44';
  pen.fillRect(-80, top, w + 160, bottom - top);
  if (arrived(grass)) {
    for (let y = Math.floor(top / TILE) * TILE; y < bottom; y += TILE) {
      for (let x = -TILE; x < w + TILE; x += TILE) pen.drawImage(grass, x, y, TILE + 0.5, TILE + 0.5);
    }
  }
  pen.fillStyle = wash;
  pen.fillRect(-80, top, w + 160, bottom - top);
  // Broad soft patches, so the eye does not find where the tile repeats
  const next = run(11);
  for (let i = 0; i < 60; i++) {
    oval(pen, next() * w, top + next() * (bottom - top), 70 + next() * 90, 30 + next() * 34);
    paint(pen, next() > 0.5 ? 'rgba(255,255,255,.03)' : 'rgba(8,10,30,.12)');
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

/** A worn way: a dark edge, packed earth, pebbles at the sides and stepping stones down the middle. */
function wornWay(pen, trace, stones, earth, tone) {
  const next = run(31);
  pen.lineCap = 'round'; pen.lineJoin = 'round'; pen.setLineDash([]);
  trace(); pen.strokeStyle = 'rgba(8,10,30,.42)'; pen.lineWidth = 90; pen.stroke();
  trace(); pen.strokeStyle = arrived(earth) ? pen.createPattern(earth, 'repeat') : '#6a5a5e'; pen.lineWidth = 76; pen.stroke();
  trace(); pen.strokeStyle = tone.wash; pen.lineWidth = 76; pen.stroke();
  trace(); pen.strokeStyle = 'rgba(255,240,215,.07)'; pen.lineWidth = 46; pen.stroke();
  for (const p of stones) {
    for (let i = 0; i < 2; i++) {
      const side = (next() > 0.5 ? 1 : -1) * (23 + next() * 12);
      oval(pen, p.x + Math.cos(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, p.y + Math.sin(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, 2.5 + next() * 2.5, 2 + next() * 2);
      paint(pen, tone.pebble);
    }
  }
  stones.forEach((p, i) => {
    if (i % 2) return;
    pen.save();
    pen.translate(p.x + (next() - 0.5) * 8, p.y + (next() - 0.5) * 8);
    pen.rotate(p.a + (next() - 0.5) * 0.5);
    // A worn slab set in the earth: a soft dark edge below it, a little light along its top, no hard line.
    rounded(pen, -14, -7, 28, 19, 8); paint(pen, 'rgba(8,10,30,.4)');
    rounded(pen, -14, -9.5, 28, 18, 8); paint(pen, tone.stone);
    rounded(pen, -9, -7, 13, 4, 2); paint(pen, 'rgba(255,255,255,.16)');
    pen.restore();
  });
}

/** A hedge of painted bushes down both sides of the world. */
function border(pen, bush, w, top, bottom) {
  const next = run(97);
  pen.fillStyle = '#10222c';
  pen.fillRect(-80, top, 92, bottom - top); pen.fillRect(w - 12, top, 92, bottom - top);
  for (let y = top; y <= bottom; y += 46) {
    stood(pen, bush, -14 + next() * 8, y + 30, 88);
    stood(pen, bush, w + 14 - next() * 8, y + 30 + 23, 88);
  }
  // In the dark at the edge of things
  pen.fillStyle = 'rgba(8,10,30,.4)';
  pen.fillRect(-80, top, 110, bottom - top); pen.fillRect(w - 30, top, 110, bottom - top);
}

const flower = (pen, x, y, colour) => {
  for (let k = 0; k < 5; k++) { disc(pen, x + Math.cos(k * 1.257) * 3.4, y + Math.sin(k * 1.257) * 3.4, 2.6); paint(pen, colour); }
  disc(pen, x, y, 2); paint(pen, '#7a4a00');
};

/** The lane's ground, from well above its top to well below its bottom (the view can scroll a little past both). */
export function paintLaneGround(pen, size, route, spots, lamps, art) {
  const top = -260;
  const bottom = size.h + 420;
  turf(pen, art.grass, size.w, top, bottom, 'rgba(14,16,44,.42)');
  const next = run(5);
  for (let i = 0; i < 90; i++) flower(pen, 30 + next() * (size.w - 60), top + next() * (bottom - top), next() > 0.6 ? '#fff0c8' : '#a8dcff');
  // The lane itself, from below home past every door in turn
  const trace = () => {
    pen.beginPath();
    pen.moveTo(route[0].x, route[0].y);
    for (let i = 1; i < route.length - 1; i++) pen.quadraticCurveTo(route[i].x, route[i].y, (route[i].x + route[i + 1].x) / 2, (route[i].y + route[i + 1].y) / 2);
    pen.lineTo(route[route.length - 1].x, route[route.length - 1].y);
  };
  const tone = { wash: 'rgba(40,34,84,.42)', pebble: 'rgba(205,196,235,.36)', stone: '#857d9e' };
  wornWay(pen, trace, along(route, 24, true), art.earth, tone);
  // A swept apron in front of every door
  for (const spot of spots) {
    oval(pen, spot.door.x, spot.door.y - 4, 64, 27); paint(pen, arrived(art.earth) ? pen.createPattern(art.earth, 'repeat') : '#6a5a5e');
    oval(pen, spot.door.x, spot.door.y - 4, 64, 27); paint(pen, tone.wash);
  }
  // Lamplight pooling on the ground
  for (const lamp of lamps) glow(pen, lamp.x, lamp.y + 4, 150, '255,200,61', 0.22);
  border(pen, art.bush, size.w, top, bottom);
}

/** The ground inside a place: the same grass in the room's own light, flower beds, and the way through. */
export function paintInsideGround(pen, room, area, art) {
  const top = -260;
  const bottom = area.h + 420;
  const [r, g, b] = parts(room.tint);
  turf(pen, art.grass, area.w, top, bottom, `rgba(${Math.round(r * 0.45)},${Math.round(g * 0.5)},${Math.round(b * 0.3)},.34)`);
  // Mown in stripes
  for (let y = top; y < bottom; y += 150) { pen.fillStyle = 'rgba(255,255,255,.03)'; pen.fillRect(-80, y, area.w + 160, 75); }
  const way = [{ x: area.gate.x, y: area.h + 80 }, area.gate, ...area.posts];
  wornWay(pen, () => { pen.beginPath(); way.forEach((p, i) => (i ? pen.lineTo(p.x, p.y) : pen.moveTo(p.x, p.y))); }, along(way, 24, false), art.earth,
    { wash: 'rgba(120,96,40,.16)', pebble: 'rgba(255,240,205,.34)', stone: '#a89e88' });
  // Flowers, thickest in beds along the foot of each hedge
  const next = run(23);
  const colours = ['#ff9bc0', '#ffe07a', '#f4f0ff', '#ffb37a'];
  for (const block of area.blocks) for (let x = block.x + 16; x < block.x + block.w - 8; x += 24 + next() * 16) flower(pen, x, block.y + block.h + 14 + next() * 14, colours[Math.floor(next() * 4)]);
  for (let i = 0; i < 70; i++) flower(pen, 40 + next() * (area.w - 80), next() * area.h, colours[Math.floor(next() * 4)]);
  glow(pen, area.gate.x, area.gate.y, 120, '255,200,61', 0.24);
  border(pen, art.bush, area.w, top, bottom);
}

// ---------------------------------------------------------------- things that stand on the ground

/** A painted thing (a tree, a bush) with its foot at (0, 0) and its shadow under it. */
export function paintProp(pen, image, wide) {
  oval(pen, 0, 3, wide * 0.4, wide * 0.1); paint(pen, 'rgba(8,6,20,.42)');
  stood(pen, image, 0, 8, wide);
}

/** A lamp post with its foot at (0, 0), and the light round its lantern. */
export function paintLamp(pen, image) {
  oval(pen, 0, 2, 13, 5); paint(pen, 'rgba(8,6,20,.5)');
  const tall = stood(pen, image, 0, 6, 37);
  glow(pen, 0, 6 - tall * 0.78, 52, '255,214,120', 0.5);
}

/** A hedge filling a block of ground (block.x, block.y is its top-left): painted bushes, shoulder to shoulder. */
export function paintHedge(pen, block, bush) {
  oval(pen, block.x + block.w / 2, block.y + block.h + 6, block.w * 0.5, 12); paint(pen, 'rgba(8,6,20,.4)');
  const count = Math.max(2, Math.round(block.w / 52));
  for (let i = 0; i < count; i++) stood(pen, bush, block.x + 26 + (i * (block.w - 52)) / (count - 1), block.y + block.h + 10, 92);
}

/** The gate of a place, its opening centred on (0, 0). */
export function paintGate(pen) {
  for (const side of [-1, 1]) {
    for (let i = 1; i <= 3; i++) { rounded(pen, side * (66 + i * 20) - 6, -30, 12, 44, 5); paint(pen, '#9a6a48'); outline(pen, 3.5); }
    rounded(pen, side * 110 - 44, -12, 88, 9, 4); paint(pen, '#7a5340'); outline(pen, 3.5);
    rounded(pen, side * 58 - 10, -54, 20, 70, 7); paint(pen, '#7a5340'); outline(pen, 4.5);
    disc(pen, side * 58, -58, 9); paint(pen, '#9a6a48'); outline(pen, 4);
  }
  rounded(pen, -66, -68, 132, 16, 8); paint(pen, '#9a6a48'); outline(pen, 4.5);
}

/**
 * One building: its painting standing with the middle of its foot at the spot, its name over it. A
 * place that is shut is in the dark, with a padlock on it.
 */
export function paintBuilding(pen, spot, { image, name, open = true, cleared = false }) {
  const { x, y } = spot;
  const wide = BUILDING_WIDE[spot.id] || 210;
  oval(pen, x, y + 6, wide * 0.52, 17); paint(pen, 'rgba(8,6,20,.45)');
  const tall = stood(pen, image, x, y + 12, wide) || wide * 0.9;
  if (!open) {
    // Only where something has been painted: the building darkens, the air round it does not.
    pen.save();
    pen.globalCompositeOperation = 'source-atop';
    pen.fillStyle = 'rgba(13,10,34,.62)';
    pen.fillRect(x - 200, y - 340, 400, 400);
    pen.restore();
    disc(pen, x, y - 30, 21); paint(pen, 'rgba(13,10,28,.9)'); pen.lineWidth = 2.5; pen.strokeStyle = 'rgba(255,255,255,.3)'; pen.stroke();
    pen.lineWidth = 4.5; pen.strokeStyle = '#d6d0f0'; pen.lineCap = 'round'; pen.beginPath(); pen.arc(x, y - 33, 7, Math.PI, 0); pen.stroke();
    rounded(pen, x - 10.5, y - 33, 21, 16, 4); paint(pen, '#d6d0f0');
  }
  label(pen, `${cleared ? '✓ ' : ''}${name}`, x, y - tall - 14, cleared ? '#58d77a' : open ? '#fff7e8' : '#b6b0d6', cleared ? '#58d77a' : open ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)');
}
