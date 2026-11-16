// Painting the world: the ground, the buildings and the things that stand on
// it. The buildings, the tree, the lamp, the hedge bush and the grass are
// painted art (web/assets/world/, made by tools/process-art.py from one sheet
// and one texture); this lays them out, and draws in code the few things that
// have no painting yet: the path, its stepping stones, the gate and the name
// plates.
//
// Nothing here moves or knows about the game. Each painter draws one thing
// once; lane.js keeps the results and puts them on screen every frame.
import { along } from '../core/world.js';

export const INK = '#0d0a1c';
export const FONT = 'Fredoka, ui-rounded, system-ui, sans-serif';

/** The painted pictures of the world, by name, and where each lives. */
export const WORLD_ART = ['grass', 'earth', 'p_tree', 'p_lamp', 'p_bush', 'b_home', 'b_garden', 'b_alley', 'b_pantry', 'b_wash', 'b_stacks', 'b_rooftops', 'b_attic', 'b_dark'];
export const worldSrc = (name) => `assets/world/${name}.webp`;
/** How wide each building stands, in the world's units. Its height follows from its painting. */
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

export function label(pen, text, x, y, colour = '#fff7e8', edge = 'rgba(255,255,255,.28)', size = 24) {
  pen.font = `600 ${size}px ${FONT}`;
  const tw = pen.measureText(text).width;
  const tall = size * 1.6;
  rounded(pen, x - tw / 2 - size * 0.7, y - tall / 2, tw + size * 1.4, tall, tall / 2); paint(pen, 'rgba(13,10,28,.88)');
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

/** Lays the grass painting over the ground, then a wash of colour to set the hour. */
function turf(pen, grass, x0, y0, x1, y1, wash) {
  pen.fillStyle = '#1b3a44';
  pen.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (arrived(grass)) {
    for (let y = Math.floor(y0 / TILE) * TILE; y < y1; y += TILE) {
      for (let x = Math.floor(x0 / TILE) * TILE; x < x1; x += TILE) pen.drawImage(grass, x, y, TILE + 0.5, TILE + 0.5);
    }
  }
  pen.fillStyle = wash;
  pen.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Broad soft patches, so the eye does not find where the tile repeats
  const next = run(11);
  const count = Math.round(((x1 - x0) * (y1 - y0)) / 26000);
  for (let i = 0; i < count; i++) {
    oval(pen, x0 + next() * (x1 - x0), y0 + next() * (y1 - y0), 70 + next() * 90, 30 + next() * 34);
    paint(pen, next() > 0.5 ? 'rgba(255,255,255,.03)' : 'rgba(8,10,30,.12)');
  }
}

const STONE_ROOM = 40; // how far apart two stepping stones must be: a stone is 28 long

/**
 * Where the stepping stones of these ways go: one every other point along each. Where two ways meet,
 * each would lay a stone on the same spot; the first one there keeps it, so stones never pile up.
 */
export function steppingStones(ways) {
  const next = run(31);
  const laid = [];
  for (const way of ways) {
    way.forEach((p, i) => {
      if (i % 2) return;
      const x = p.x + (next() - 0.5) * 8;
      const y = p.y + (next() - 0.5) * 8;
      const a = p.a + (next() - 0.5) * 0.5;
      if (!laid.some((stone) => Math.hypot(stone.x - x, stone.y - y) < STONE_ROOM)) laid.push({ x, y, a });
    });
  }
  return laid;
}

/**
 * Worn ways: a dark edge, packed earth, pebbles at the sides and stepping stones down the middle.
 * `ways` is a list of lines, each as its points (see `along`); they are laid as one, so where two
 * meet there is no seam.
 */
function wornWays(pen, ways, earth, tone) {
  const next = run(47);
  const trace = () => { pen.beginPath(); for (const way of ways) way.forEach((p, i) => (i ? pen.lineTo(p.x, p.y) : pen.moveTo(p.x, p.y))); };
  pen.lineCap = 'round'; pen.lineJoin = 'round'; pen.setLineDash([]);
  trace(); pen.strokeStyle = 'rgba(8,10,30,.42)'; pen.lineWidth = 90; pen.stroke();
  trace(); pen.strokeStyle = arrived(earth) ? pen.createPattern(earth, 'repeat') : '#6a5a5e'; pen.lineWidth = 76; pen.stroke();
  trace(); pen.strokeStyle = tone.wash; pen.lineWidth = 76; pen.stroke();
  trace(); pen.strokeStyle = 'rgba(255,240,215,.07)'; pen.lineWidth = 46; pen.stroke();
  for (const way of ways) {
    for (const p of way) {
      for (let i = 0; i < 2; i++) {
        const side = (next() > 0.5 ? 1 : -1) * (23 + next() * 12);
        oval(pen, p.x + Math.cos(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, p.y + Math.sin(p.a + Math.PI / 2) * side + (next() - 0.5) * 14, 2.5 + next() * 2.5, 2 + next() * 2);
        paint(pen, tone.pebble);
      }
    }
  }
  for (const stone of steppingStones(ways)) {
    pen.save();
    pen.translate(stone.x, stone.y);
    pen.rotate(stone.a);
    // A worn slab set in the earth: a soft dark edge below it, a little light along its top, no hard line.
    rounded(pen, -14, -7, 28, 19, 8); paint(pen, 'rgba(8,10,30,.4)');
    rounded(pen, -14, -9.5, 28, 18, 8); paint(pen, tone.stone);
    rounded(pen, -9, -7, 13, 4, 2); paint(pen, 'rgba(255,255,255,.16)');
    pen.restore();
  }
}

/** A hedge of painted bushes all the way round the world, in the dark at the edge of things. */
function border(pen, bush, w, h) {
  const next = run(97);
  pen.fillStyle = '#10222c';
  pen.fillRect(-400, -400, w + 800, 412); pen.fillRect(-400, h - 4, w + 800, 700);
  pen.fillRect(-400, -400, 412, h + 1100); pen.fillRect(w - 12, -400, 412, h + 1100);
  for (let x = -20; x <= w + 20; x += 46) stood(pen, bush, x + next() * 8, 26 + next() * 6, 88);
  for (let y = 20; y <= h; y += 46) {
    stood(pen, bush, -14 + next() * 8, y + 30, 88);
    stood(pen, bush, w + 14 - next() * 8, y + 30 + 23, 88);
  }
  for (let x = -20; x <= w + 20; x += 46) stood(pen, bush, x + next() * 8, h + 34 + next() * 6, 88);
  pen.fillStyle = 'rgba(8,10,30,.4)';
  pen.fillRect(-400, -400, w + 800, 418); pen.fillRect(-400, h - 12, w + 800, 700);
  pen.fillRect(-400, 18, 430, h - 30); pen.fillRect(w - 30, 18, 430, h - 30);
}

const flower = (pen, x, y, colour) => {
  for (let k = 0; k < 5; k++) { disc(pen, x + Math.cos(k * 1.257) * 3.4, y + Math.sin(k * 1.257) * 3.4, 2.6); paint(pen, colour); }
  disc(pen, x, y, 2); paint(pen, '#7a4a00');
};
const BLOOMS = ['#ff9bc0', '#ffe07a', '#f4f0ff', '#ffb37a'];
/** Flowers the way they grow: in drifts, a few together, with the odd one on its own. */
function drifts(pen, next, x0, y0, x1, y1, count, colours) {
  for (let i = 0; i < count; i++) {
    const cx = x0 + next() * (x1 - x0);
    const cy = y0 + next() * (y1 - y0);
    const colour = colours[Math.floor(next() * colours.length)];
    const many = 1 + Math.floor(next() * next() * 9);
    for (let k = 0; k < many; k++) { const a = next() * Math.PI * 2; const far = next() * 34; flower(pen, cx + Math.cos(a) * far * 1.3, cy + Math.sin(a) * far * 0.7, colour); }
  }
}

/**
 * The ground of the whole world, and a little past every edge of it (the view can scroll that far).
 * `world` says what is where: { w, h, roads, spots, lamps, hedges, green, lawns }, a lawn being a
 * place you walk into: { x, y, w, h, tint, gate, posts }.
 */
export function paintGround(pen, world, art) {
  const { w, h } = world;
  turf(pen, art.grass, -400, -400, w + 400, h + 700, 'rgba(14,16,44,.42)');
  drifts(pen, run(5), 40, 40, w - 40, h - 40, 90, ['#fff0c8', '#a8dcff']);

  // The green below home: a lighter sweep of grass
  const green = world.green;
  oval(pen, green.x + green.w / 2, green.y + green.h / 2, green.w * 0.62, green.h * 0.74); paint(pen, 'rgba(190,255,170,.07)');

  // Each place you walk into: its own light on the grass, mown in stripes, flower beds along its hedges
  for (const lawn of world.lawns) {
    const [r, g, b] = parts(lawn.tint);
    pen.save();
    pen.beginPath(); pen.rect(lawn.x, lawn.y, lawn.w, lawn.h); pen.clip();
    pen.fillStyle = `rgba(${Math.round(r * 0.5)},${Math.round(g * 0.62)},${Math.round(b * 0.34)},.3)`;
    pen.fillRect(lawn.x, lawn.y, lawn.w, lawn.h);
    for (let y = lawn.y; y < lawn.y + lawn.h; y += 150) { pen.fillStyle = 'rgba(255,255,255,.035)'; pen.fillRect(lawn.x, y, lawn.w, 75); }
    const way = [lawn.gate, { x: lawn.gate.x, y: lawn.gate.y - 110 }, ...lawn.posts.map((post) => ({ x: post.x, y: post.y + 20 }))];
    wornWays(pen, [along(way, 24, true)], art.earth, { wash: 'rgba(120,96,40,.16)', pebble: 'rgba(255,240,205,.34)', stone: '#a89e88' });
    drifts(pen, run(23), lawn.x + 60, lawn.y + 60, lawn.x + lawn.w - 40, lawn.y + lawn.h - 40, 34, BLOOMS);
    pen.restore();
    glow(pen, lawn.gate.x, lawn.gate.y + 30, 130, '255,200,61', 0.2);
  }

  // The streets
  const tone = { wash: 'rgba(40,34,84,.42)', pebble: 'rgba(205,196,235,.36)', stone: '#857d9e' };
  wornWays(pen, world.roads, art.earth, tone);
  // A swept apron in front of every door
  for (const spot of world.spots) {
    oval(pen, spot.door.x, spot.door.y - 4, 64, 27); paint(pen, arrived(art.earth) ? pen.createPattern(art.earth, 'repeat') : '#6a5a5e');
    oval(pen, spot.door.x, spot.door.y - 4, 64, 27); paint(pen, tone.wash);
  }
  // Lamplight pooling on the ground
  for (const lamp of world.lamps) glow(pen, lamp.x, lamp.y + 4, 150, '255,200,61', 0.22);
  border(pen, art.bush, w, h);
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

/** Where the bushes of a hedge stand: shoulder to shoulder along whichever way the block is longer. */
export function bushesOf(block) {
  if (block.w >= block.h) {
    const count = Math.max(2, Math.round(block.w / 52));
    return Array.from({ length: count }, (_, i) => ({ x: block.x + 26 + (i * (block.w - 52)) / (count - 1), y: block.y + block.h + 2 }));
  }
  const count = Math.max(2, Math.round(block.h / 44));
  return Array.from({ length: count }, (_, i) => ({ x: block.x + block.w / 2, y: block.y + 34 + (i * (block.h - 34)) / (count - 1) }));
}

/** The gateway of a place, its opening centred on (0, 0): two posts and a bar across. */
export function paintGate(pen) {
  oval(pen, 0, 18, 84, 12); paint(pen, 'rgba(8,6,20,.35)');
  for (const side of [-1, 1]) {
    rounded(pen, side * 62 - 10, -54, 20, 74, 7); paint(pen, '#7a5340'); outline(pen, 4.5);
    disc(pen, side * 62, -58, 9); paint(pen, '#9a6a48'); outline(pen, 4);
  }
  rounded(pen, -70, -70, 140, 16, 8); paint(pen, '#9a6a48'); outline(pen, 4.5);
}

/**
 * One building: its painting standing with the middle of its foot at the spot, its name (if it is
 * given one) over it. A place that is shut is in the dark, with a padlock on it.
 */
export function paintBuilding(pen, spot, { image, name = '', open = true, cleared = false }) {
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
  if (name) label(pen, `${cleared ? '✓ ' : ''}${name}`, x, y - tall - 18, cleared ? '#58d77a' : open ? '#fff7e8' : '#b6b0d6', cleared ? '#58d77a' : open ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.14)');
}
