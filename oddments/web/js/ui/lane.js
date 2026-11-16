// The world you walk in: the lane between places, and the inside of a place
// once you have walked through its door. The rules for where feet can go are
// in core/world.js, and this draws them.
//
// Everything on the ground here is drawn in code as a stand-in: there is no
// painted map yet (see docs/ART.md). The people, the Oddments and the little
// window in each building are the real art.
import { ROOMS, SPECIES, ELEMENTS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, SPOTS, TREES, LAMPS, spotOf, areaOf } from '../core/world.js';
import { h, sprite, spriteSrc } from './dom.js';
import { elementTag, bar } from './parts.js';

// The world is exactly one screen wide: the view only ever travels up and down.
const VIEW = WORLD.w;
const HOME = { name: 'Home', blurb: 'Great-aunt Maribel\'s house, where you are staying. Out here in the lane everyone gets their breath back.' };
const INK = '#0d0a1c';
const FONT = 'Fredoka, ui-rounded, system-ui, sans-serif';
const GAP = 60; // how far apart the team walks behind you: a little more than any of them is tall

const images = {};
const picture = (src) => images[src] || (images[src] = Object.assign(new Image(), { src }));

// The lane itself runs from below home, past every door in turn.
const ROUTE = [{ x: WORLD.w / 2, y: WORLD.h + 60 }, ...SPOTS.map((spot) => spot.door)];
// Fixed scatter for grass, flowers and fireflies: looks only, so not the game's dice.
const scatter = (n, seed) => { let s = seed; const next = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: n }, () => ({ x: next() * WORLD.w, y: next() * WORLD.h, r: next() })); };
const PATCHES = scatter(46, 11);
const BLADES = scatter(150, 7);
const FLIES = scatter(30, 29);
const BLOOMS = scatter(70, 53);

export function laneScreen(ctx) {
  const { game } = ctx;
  const { state } = game;
  // Inside a place, or out in the lane: the same screen, a different map.
  const inside = game.place() === 'path';
  const room = inside ? roomOf(state.visit.room) : null;
  const area = inside ? areaOf(room.id) : null;
  const size = inside ? area : WORLD;
  const here = () => game.standing() || { x: 0, y: 0 };

  const canvas = h('canvas', { class: 'lanecanvas', 'aria-label': 'Tap to walk.' });
  const card = h('div', { class: `placecard${inside ? ' slim' : ''}`, hidden: true });
  const hint = h('div', { class: 'lanehint', hidden: !!state.seen.walked }, 'Tap or drag to walk');
  const sub = h('small', { class: 'where' });
  const wrap = h('div', { class: 'lanewrap' }, canvas,
    h('header', { class: 'bar-top over' }, h('div', null, h('h1', null, inside ? room.name : 'The Lane'), sub), h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))),
    hint, card);
  const el = h('section', { id: 'lane', class: inside ? 'inside' : '' }, wrap);
  const pen = canvas.getContext('2d');

  let way = []; // the points still to walk through to get where you tapped
  let met = false; // a fight is about to start
  let stirred = false; // you have touched the screen since it appeared
  let mark = null; // the ring where you last tapped
  let raf = 0;
  let last = 0;
  let clock = 0;
  let drawn = 0;
  let facing = 1;
  let stride = 0; // how far you have walked, for the bounce in your step
  let spring = 0; // 0 standing still, 1 walking: eased, so a step never snaps
  let cardFor; // which place the card is showing (undefined: not drawn yet)
  const cam = { x: 0, y: 0, k: 1, w: VIEW, h: VIEW, dpr: 1, set: false };
  // Where you have just been, newest first, for the friends walking behind you.
  const start = here();
  const trail = Array.from({ length: 12 }, (_, i) => ({ x: start.x - i * 16, y: start.y + i * 2.5 }));
  const pals = game.team().map((friend, i) => ({ friend, x: start.x - (i + 1) * GAP, y: start.y + (i + 1) * 7, f: 1, step: i * 9 }));
  const held = new Set();

  // ------------------------------------------------------------ the camera

  function fit() {
    const box = wrap.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    cam.k = box.width / VIEW; // screen pixels to a unit
    cam.w = VIEW;
    cam.h = box.height / cam.k;
    cam.dpr = dpr;
    cam.set = false;
  }

  // The title sits over the top of the view and a card over the bottom; you are kept in the clear
  // band between them, and the ends of the world can scroll out from under both.
  function look(dt) {
    const top = 62 / cam.k;
    const bottom = (inside ? 118 : 168) / cam.k;
    const lo = -top;
    const hi = size.h - cam.h + bottom;
    const want = hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, here().y - top - (cam.h - top - bottom) * 0.6));
    cam.x = (size.w - cam.w) / 2;
    cam.y = cam.set ? cam.y + (want - cam.y) * (1 - Math.exp(-dt * 6.5)) : want;
    cam.set = true;
  }

  const toWorld = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    return { x: (clientX - box.left) / cam.k + cam.x, y: (clientY - box.top) / cam.k + cam.y };
  };

  // ------------------------------------------------------------ drawing: shared

  function rounded(x, y, w, hgt, r) {
    pen.beginPath();
    pen.moveTo(x + r, y);
    pen.arcTo(x + w, y, x + w, y + hgt, r);
    pen.arcTo(x + w, y + hgt, x, y + hgt, r);
    pen.arcTo(x, y + hgt, x, y, r);
    pen.arcTo(x, y, x + w, y, r);
    pen.closePath();
  }
  const oval = (x, y, rx, ry) => { pen.beginPath(); pen.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
  const outline = (width = 4.5) => { pen.lineWidth = width; pen.strokeStyle = INK; pen.lineJoin = 'round'; pen.stroke(); };
  const paint = (colour) => { pen.fillStyle = colour; pen.fill(); };
  const shade = (alpha) => paint(`rgba(13,10,28,${alpha})`);
  const seen = (y, margin = 260) => y > cam.y - margin && y < cam.y + cam.h + margin;

  function glow(x, y, r, colour, alpha) {
    const g = pen.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, `rgba(${colour},${alpha})`);
    g.addColorStop(1, `rgba(${colour},0)`);
    pen.fillStyle = g;
    pen.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function label(text, x, y, colour = '#fff7e8', edge = 'rgba(255,255,255,.28)') {
    pen.font = `600 19px ${FONT}`;
    const tw = pen.measureText(text).width;
    rounded(x - tw / 2 - 13, y - 16, tw + 26, 31, 15.5); paint('rgba(13,10,28,.86)');
    pen.lineWidth = 2; pen.strokeStyle = edge; pen.stroke();
    pen.textBaseline = 'middle'; pen.textAlign = 'center'; pen.fillStyle = colour;
    pen.fillText(text, x, y + 1);
  }

  /** The ground everything stands on: a base colour, soft patches, and blades of grass. */
  function turf(base, light, dark, blade) {
    pen.fillStyle = base;
    pen.fillRect(cam.x - 4, cam.y - 4, cam.w + 8, cam.h + 8);
    for (const patch of PATCHES) {
      if (!seen(patch.y, 90)) continue;
      oval(patch.x, patch.y, 52 + patch.r * 60, 22 + patch.r * 24);
      paint(patch.r > 0.5 ? light : dark);
    }
    pen.strokeStyle = blade; pen.lineWidth = 2.4; pen.lineCap = 'round';
    pen.beginPath();
    for (const b of BLADES) {
      if (!seen(b.y, 20)) continue;
      pen.moveTo(b.x - 5, b.y); pen.lineTo(b.x - 7, b.y - 9);
      pen.moveTo(b.x, b.y); pen.lineTo(b.x, b.y - 12);
      pen.moveTo(b.x + 5, b.y); pen.lineTo(b.x + 7, b.y - 9);
    }
    pen.stroke();
  }

  /** A worn way along a line of points: a dark edge, the path, and stepping stones down the middle. */
  function worn(trace, edge, body, stones) {
    pen.lineCap = 'round'; pen.lineJoin = 'round'; pen.setLineDash([]);
    trace(); pen.strokeStyle = edge; pen.lineWidth = 86; pen.stroke();
    trace(); pen.strokeStyle = body; pen.lineWidth = 72; pen.stroke();
    trace(); pen.strokeStyle = stones; pen.lineWidth = 13; pen.setLineDash([1, 34]); pen.stroke();
    pen.setLineDash([]);
  }

  /** A sprite standing with its feet at (x, y). Oddments are painted facing left; people facing right. */
  function stand(src, x, y, tall, faceRight, paintedRight, lift = 0, lean = 0) {
    const art = picture(src);
    oval(x, y + 2, tall * 0.3 * (1 - lift / (tall * 0.5)), tall * 0.085); paint('rgba(8,6,20,.5)');
    if (!art.complete || !art.naturalWidth) return;
    const wide = tall * Math.min(1.5, art.naturalWidth / art.naturalHeight);
    const high = wide > tall * 1.2 ? wide * (art.naturalHeight / art.naturalWidth) : tall;
    pen.save();
    pen.translate(x, y - lift);
    pen.rotate(lean);
    if (faceRight !== paintedRight) pen.scale(-1, 1);
    pen.drawImage(art, -wide / 2, -high, wide, high);
    pen.restore();
  }

  // ------------------------------------------------------------ drawing: the lane

  function laneGround() {
    turf('#1b3044', 'rgba(60,110,130,.16)', 'rgba(8,14,30,.22)', 'rgba(110,170,160,.2)');
    worn(() => {
      pen.beginPath();
      pen.moveTo(ROUTE[0].x, ROUTE[0].y);
      for (let i = 1; i < ROUTE.length - 1; i++) pen.quadraticCurveTo(ROUTE[i].x, ROUTE[i].y, (ROUTE[i].x + ROUTE[i + 1].x) / 2, (ROUTE[i].y + ROUTE[i + 1].y) / 2);
      pen.lineTo(ROUTE[ROUTE.length - 1].x, ROUTE[ROUTE.length - 1].y);
    }, '#131b30', '#4a4174', 'rgba(140,128,196,.5)');
    // Lamplight pools on the ground, under everything that stands on it.
    for (const lamp of LAMPS) if (seen(lamp.y)) glow(lamp.x, lamp.y + 4, 130, '255,200,61', 0.16 + 0.02 * Math.sin(clock * 2 + lamp.y));
  }

  function lampPost(lamp) {
    oval(lamp.x, lamp.y + 2, 9, 4); paint('rgba(8,6,20,.5)');
    pen.fillStyle = '#2a2444'; pen.fillRect(lamp.x - 3, lamp.y - 74, 6, 76);
    pen.lineWidth = 3; pen.strokeStyle = INK; pen.strokeRect(lamp.x - 3, lamp.y - 74, 6, 76);
    rounded(lamp.x - 11, lamp.y - 98, 22, 26, 7); paint('#ffd76a'); outline(3.5);
    glow(lamp.x, lamp.y - 85, 44, '255,220,130', 0.5);
  }

  function building(spot) {
    const place = roomOf(spot.id);
    const tint = place ? place.tint : '#e8a23d';
    const open = !place || game.roomOpen(place.id);
    const cleared = !!place && state.rooms[place.id].clears > 0;
    const { x, y, w, tall } = spot;
    const wallTop = y - tall * 0.56;
    const top = y - tall;

    oval(x, y + 6, w * 0.58, 16); paint('rgba(8,6,20,.45)');
    if (open) glow(x, y + 34, 96, '255,200,61', 0.3);
    // Wall, a little lighter along the top, darker along the foot
    rounded(x - w / 2, wallTop, w, y - wallTop, 11); paint(tint); shade(open ? 0.46 : 0.8);
    pen.save(); rounded(x - w / 2, wallTop, w, y - wallTop, 11); pen.clip();
    pen.fillStyle = 'rgba(13,10,28,.26)'; pen.fillRect(x - w / 2, y - 16, w, 16);
    pen.restore();
    rounded(x - w / 2, wallTop, w, y - wallTop, 11); outline(5);
    // Roof, with a band of light along its ridge
    const roof = () => { pen.beginPath(); pen.moveTo(x - w / 2 - 17, wallTop + 9); pen.lineTo(x - w * 0.2, top); pen.lineTo(x + w * 0.2, top); pen.lineTo(x + w / 2 + 17, wallTop + 9); pen.closePath(); };
    roof(); paint(tint); shade(open ? 0.2 : 0.68);
    pen.save(); roof(); pen.clip();
    pen.fillStyle = open ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.04)'; pen.fillRect(x - w, top, w * 2, 13);
    pen.restore();
    roof(); outline(5);
    if (place) {
      // A round window on to what is inside: the room's own painting.
      const wy = (wallTop + top) / 2 + 9;
      const art = picture(`assets/bg/${place.bg}.webp`);
      pen.save(); pen.beginPath(); pen.arc(x, wy, 26, 0, Math.PI * 2); pen.clip();
      if (art.complete && art.naturalWidth) pen.drawImage(art, art.naturalWidth * 0.3, art.naturalHeight * 0.2, art.naturalHeight * 0.6, art.naturalHeight * 0.6, x - 26, wy - 26, 52, 52);
      if (!open) { pen.fillStyle = 'rgba(13,10,28,.72)'; pen.fillRect(x - 27, wy - 27, 54, 54); }
      pen.restore();
      pen.beginPath(); pen.arc(x, wy, 26, 0, Math.PI * 2); outline(5);
    } else {
      // Home: a chimney, and the lights are on.
      pen.fillStyle = '#6b4a55'; pen.fillRect(x + w * 0.22, top - 16, 24, 44); pen.strokeStyle = INK; pen.lineWidth = 5; pen.strokeRect(x + w * 0.22, top - 16, 24, 44);
    }
    // Windows either side of the door, with their bars
    for (const side of [-1, 1]) {
      const wx = x + side * w * 0.3;
      rounded(wx - 16, wallTop + 17, 32, 32, 6); paint(open ? '#ffd76a' : '#181433'); outline(4.5);
      pen.beginPath(); pen.moveTo(wx, wallTop + 17); pen.lineTo(wx, wallTop + 49); pen.moveTo(wx - 16, wallTop + 33); pen.lineTo(wx + 16, wallTop + 33); pen.lineWidth = 3; pen.strokeStyle = INK; pen.stroke();
    }
    // The door, lit if you can go in
    rounded(x - 22, y - 54, 44, 56, 17); paint(open ? '#ffc83d' : '#181433'); outline(5);
    if (open) { pen.beginPath(); pen.arc(x + 11, y - 22, 3.4, 0, Math.PI * 2); paint('#7a4a00'); } else {
      pen.lineWidth = 4.5; pen.strokeStyle = '#9a93bd'; pen.beginPath(); pen.arc(x, y - 31, 7.5, Math.PI, 0); pen.stroke();
      rounded(x - 11, y - 31, 22, 17, 4); paint('#9a93bd');
    }
    label(`${cleared ? '✓ ' : ''}${place ? place.name : HOME.name}`, x, top - 24, cleared ? '#58d77a' : open ? '#fff7e8' : '#9a93bd', cleared ? '#58d77a' : open ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.12)');
  }

  function tree(t) {
    oval(t.x, t.y + 5, t.r * 0.95, 10); paint('rgba(8,6,20,.42)');
    rounded(t.x - 7, t.y - t.r * 0.95, 14, t.r, 4); paint('#4a3346'); outline(4);
    pen.beginPath(); pen.arc(t.x, t.y - t.r * 1.5, t.r * 1.08, 0, Math.PI * 2); paint('#2a6350'); outline(5);
    pen.beginPath(); pen.arc(t.x - t.r * 0.32, t.y - t.r * 1.82, t.r * 0.44, 0, Math.PI * 2); paint('#3b876a');
  }

  // ------------------------------------------------------------ drawing: the inside of a place

  function insideGround() {
    pen.fillStyle = room.tint; pen.fillRect(cam.x - 4, cam.y - 4, cam.w + 8, cam.h + 8);
    turf('rgba(13,10,28,.64)', 'rgba(255,255,255,.05)', 'rgba(0,0,0,.14)', 'rgba(190,240,170,.2)');
    // The worn way through, from the gate past every stop.
    worn(() => { pen.beginPath(); pen.moveTo(area.gate.x, area.h + 60); pen.lineTo(area.gate.x, area.gate.y); for (const post of area.posts) pen.lineTo(post.x, post.y); },
      'rgba(13,10,28,.3)', 'rgba(255,236,190,.12)', 'rgba(255,240,205,.2)');
    // A few flowers
    for (const bloom of BLOOMS) {
      if (bloom.y > area.h || !seen(bloom.y, 20)) continue;
      pen.beginPath(); pen.arc(bloom.x, bloom.y, 3.6, 0, Math.PI * 2);
      paint(bloom.r < 0.34 ? '#ff9bc0' : bloom.r < 0.67 ? '#ffe07a' : '#f4f0ff');
    }
    glow(area.gate.x, area.gate.y, 110, '255,200,61', 0.26);
  }

  function hedge(block) {
    oval(block.x + block.w / 2, block.y + block.h + 5, block.w * 0.5, 10); paint('rgba(8,6,20,.36)');
    rounded(block.x - 6, block.y - 30, block.w + 12, block.h + 30, 22); paint('#1f5a3f'); outline(5);
    pen.save(); rounded(block.x - 6, block.y - 30, block.w + 12, block.h + 30, 22); pen.clip();
    pen.fillStyle = '#2c7a55';
    for (let x = block.x + 14; x < block.x + block.w; x += 44) { pen.beginPath(); pen.arc(x, block.y - 22, 20, 0, Math.PI * 2); pen.fill(); }
    pen.fillStyle = 'rgba(13,10,28,.2)'; pen.fillRect(block.x - 6, block.y + block.h - 12, block.w + 12, 14);
    pen.restore();
  }

  function gate() {
    // It stands just behind where you come in, so you are inside it, not under it.
    const x = area.gate.x;
    const y = area.gate.y + 52;
    for (const side of [-1, 1]) { rounded(x + side * 58 - 9, y - 50, 18, 64, 7); paint('#7a5340'); outline(4.5); }
    rounded(x - 64, y - 62, 128, 18, 9); paint('#8a6048'); outline(4.5);
    label('Out to the lane', x, y + 34, '#ffc83d', 'rgba(255,200,61,.5)');
  }

  /** Whoever is at a stop: the ones you can see waiting at the next one, a rustle in the bushes further in. */
  function waiting(stop) {
    const post = area.posts[stop];
    const spot = room.path[stop];
    if (stop > state.visit.stop) {
      const big = spot.boss ? 1.5 : 1;
      const sway = Math.sin(clock * 2.2 + stop * 2) * 2.5;
      oval(post.x, post.y + 6, 50 * big, 13 * big); paint('rgba(8,6,20,.42)');
      for (const [dx, dy, r] of [[-26, -20, 24], [24, -22, 26], [0, -40, 28]]) { pen.beginPath(); pen.arc(post.x + dx * big + sway, post.y + dy * big, r * big, 0, Math.PI * 2); paint('#1f5a3f'); outline(4.5); }
      pen.beginPath(); pen.arc(post.x - 8 * big + sway, post.y - 46 * big, 11 * big, 0, Math.PI * 2); paint('#2c7a55');
      pen.font = `700 ${Math.round(30 * big)}px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      pen.fillStyle = spot.boss ? '#ff8a96' : '#fff7e8';
      pen.fillText('?', post.x + sway, post.y - 30 * big);
      return;
    }
    const foes = state.visit.waiting || [];
    const boss = foes.some((foe) => SPECIES[foe.species].boss);
    const gap = boss ? 86 : foes.length > 2 ? 60 : 72;
    foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      const x = post.x + (i - (foes.length - 1) / 2) * gap;
      const y = post.y + (kind.boss ? -14 : boss ? 20 : 0);
      if (foe.heirloom) glow(x, y - 22, 54, '255,200,61', 0.42 + 0.2 * Math.sin(clock * 5));
      stand(spriteSrc(foe.species, foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0), kind.boss ? 140 : 58, false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7)) * 3);
    });
    label(spot.name, post.x, post.y - (boss ? 178 : 88), spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.28)');
  }

  // ------------------------------------------------------------ drawing: everything, back to front

  function draw() {
    const k = cam.k * cam.dpr;
    pen.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    if (inside) insideGround(); else laneGround();
    // The hedge all the way round the edge of the world
    pen.strokeStyle = '#122030'; pen.lineWidth = 40; pen.lineJoin = 'round'; pen.strokeRect(-6, -6, size.w + 12, size.h + 12);
    if (mark && mark.life > 0) {
      pen.beginPath(); pen.ellipse(mark.x, mark.y, 24 * (1.3 - mark.life), 11 * (1.3 - mark.life), 0, 0, Math.PI * 2);
      pen.strokeStyle = `rgba(255,200,61,${Math.max(0, mark.life)})`; pen.lineWidth = 4; pen.stroke();
    }
    // Back to front, so whoever is further down the screen is in front.
    const things = [];
    if (inside) {
      things.push({ y: area.gate.y + 54, draw: gate });
      for (const block of area.blocks) things.push({ y: block.y + block.h, draw: () => hedge(block) });
      for (let stop = state.visit.stop; stop < area.posts.length; stop++) things.push({ y: area.posts[stop].y + 22, draw: () => waiting(stop) });
    } else {
      for (const spot of SPOTS) if (seen(spot.y)) things.push({ y: spot.y, draw: () => building(spot) });
      for (const t of TREES) if (seen(t.y)) things.push({ y: t.y, draw: () => tree(t) });
      for (const lamp of LAMPS) if (seen(lamp.y)) things.push({ y: lamp.y, draw: () => lampPost(lamp) });
    }
    const { x, y } = here();
    for (const pal of pals) {
      const fly = SPECIES[pal.friend.species].fly;
      const lift = fly ? 9 + Math.sin(clock * 3 + pal.step) * 4 : Math.abs(Math.sin(pal.step / 15)) * 5 * spring;
      things.push({ y: pal.y - 0.01, draw: () => stand(spriteSrc(pal.friend.species, pal.friend.heirloom), pal.x, pal.y, 54, pal.f > 0, false, lift) });
    }
    const hop = Math.abs(Math.sin(stride / 17)) * 7 * spring;
    things.push({ y, draw: () => stand(spriteSrc(state.player.look), x, y, 96, facing > 0, true, hop, Math.sin(stride / 17) * 0.035 * spring) });
    things.sort((a, b) => a.y - b.y);
    for (const thing of things) thing.draw();
    for (const fly of FLIES) {
      if (fly.y > size.h || !seen(fly.y, 30)) continue;
      const bright = 0.2 + 0.6 * Math.abs(Math.sin(clock * (0.6 + fly.r) + fly.r * 40));
      const fx = fly.x + Math.sin(clock * 0.7 + fly.r * 9) * 14;
      const fy = fly.y + Math.cos(clock * 0.5 + fly.r * 7) * 12;
      pen.beginPath(); pen.arc(fx, fy, 6, 0, Math.PI * 2); paint(`rgba(255,224,122,${bright * 0.22})`);
      pen.beginPath(); pen.arc(fx, fy, 2.4, 0, Math.PI * 2); paint(`rgba(255,236,160,${bright})`);
    }
  }

  // ------------------------------------------------------------ the card for wherever you are

  function drawCard() {
    if (inside) {
      // Inside, the card is always there: how far you have got, how everyone is, and the way out.
      const stop = state.visit.stop;
      if (cardFor === stop) return;
      cardFor = stop;
      const spot = room.path[stop];
      const health = game.teamHealth();
      sub.textContent = `Stop ${stop + 1} of ${room.path.length}`;
      card.hidden = false;
      card.dataset.spot = room.id;
      card.dataset.stop = String(stop);
      card.replaceChildren(
        h('div', { class: 'cardhead' },
          h('h2', null, spot.name, ' ', h('small', null, `stop ${stop + 1} of ${room.path.length}`)),
          h('button', { class: 'btn plain small', data: { act: 'home' }, onclick: () => { if (game.leaveRoom()) { ctx.save(); ctx.show('lane'); } } }, 'Leave')),
        h('div', { class: 'teamlist' }, game.team().map((friend, i) => h('div', { class: `teamcard${health[i].hp <= 0 ? ' down' : ''}` },
          sprite(friend.species, friend.heirloom, 'flip'),
          h('div', null, h('b', null, SPECIES[friend.species].name), bar(`hp${health[i].hp / health[i].max < 0.3 ? ' low' : ''}`, health[i].hp / health[i].max, `${health[i].hp} / ${health[i].max}`))))));
      return;
    }
    const id = game.near();
    if (id === cardFor) return;
    cardFor = id;
    card.hidden = !id;
    card.dataset.spot = id || '';
    if (!id) return;
    const place = roomOf(id);
    if (!place) {
      card.replaceChildren(h('h2', null, HOME.name), h('small', null, HOME.blurb),
        h('button', { class: 'btn plain', data: { act: 'friends' }, onclick: () => ctx.show('friends') }, 'Choose your team'));
      return;
    }
    const open = game.roomOpen(place.id);
    const record = state.rooms[place.id];
    const before = ROOMS[ROOMS.indexOf(place) - 1];
    const bossId = roomBuilt(place) ? place.path[place.path.length - 1].boss : null;
    card.replaceChildren(
      h('h2', null, place.name, ' ', elementTag(place.element)),
      h('small', null, place.blurb, ' ', roomBuilt(place)
        ? `${place.path.length} stops, the last a boss${bossId && state.book[bossId].met ? ` (${SPECIES[bossId].name})` : ''}. Mostly ${ELEMENTS[place.element].name}.${record.visits ? ` Furthest: stop ${record.best} of ${place.path.length}.` : ''}`
        : 'Not built yet: this slice ends at the garden.'),
      open
        ? h('button', { class: 'btn gold', data: { act: 'enter' }, onclick: () => { if (game.enterRoom(place.id)) { ctx.save(); ctx.show('path'); } } }, record.clears ? 'Walk in again' : 'Walk in')
        : h('button', { class: 'btn gold', disabled: true, data: { act: 'enter' } }, roomBuilt(place) ? `Clear ${before.name} first` : 'Not built yet'));
  }

  // ------------------------------------------------------------ walking

  function aim(event) {
    stirred = true;
    const to = toWorld(event.clientX, event.clientY);
    way = game.routeTo(to);
    mark = { x: to.x, y: to.y, life: 1 };
    if (!state.seen.walked) { state.seen.walked = true; hint.hidden = true; }
  }
  let dragging = false;
  let aimed = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; aimed = performance.now(); aim(event); });
  // While a finger is held, follow it, finding the way afresh a few times a second.
  canvas.addEventListener('pointermove', (event) => { if (dragging && performance.now() - aimed > 140) { aimed = performance.now(); aim(event); } });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, () => { dragging = false; });
  const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  const keyDown = (event) => { if (KEYS[event.key] && !event.target.closest('input')) { held.add(event.key); stirred = true; } };
  const keyUp = (event) => held.delete(event.key);

  /** The point a given distance back along where you have walked. */
  function behind(far) {
    let left = far;
    for (let i = 1; i < trail.length; i++) {
      const seg = Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      if (seg >= left && seg > 0) return { x: trail[i - 1].x + ((trail[i].x - trail[i - 1].x) * left) / seg, y: trail[i - 1].y + ((trail[i].y - trail[i - 1].y) * left) / seg };
      left -= seg;
    }
    return trail[trail.length - 1];
  }

  function frame(time) {
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    clock += dt;
    const before = here();
    if (held.size) {
      let dx = 0; let dy = 0;
      for (const key of held) { dx += KEYS[key][0]; dy += KEYS[key][1]; }
      if (dx || dy) way = [{ x: before.x + dx * 60, y: before.y + dy * 60 }];
    }
    // Head for each point of the way in turn.
    while (way.length && Math.hypot(way[0].x - before.x, way[0].y - before.y) < 7) way.shift();
    const moving = !met && way.length > 0 && game.walk(way[0], dt);
    const now = here();
    if (moving) {
      const dx = now.x - before.x;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      stride += Math.hypot(dx, now.y - before.y);
      if (Math.hypot(now.x - trail[0].x, now.y - trail[0].y) > 5) { trail.unshift({ x: now.x, y: now.y }); if (trail.length > 60) trail.length = 60; }
    } else if (way.length) way.shift();
    spring += ((moving ? 1 : 0) - spring) * (1 - Math.exp(-dt * 12));
    // The team keeps its distance behind you along the way you came, and eases into place.
    const ease = 1 - Math.exp(-dt * 10);
    pals.forEach((pal, i) => {
      const to = behind(GAP * (i + 1));
      const dx = (to.x - pal.x) * ease;
      const dy = (to.y - pal.y) * ease;
      pal.x += dx; pal.y += dy;
      pal.step += Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.25) pal.f = dx > 0 ? 1 : -1;
    });
    if (mark) mark.life -= dt * 1.6;
    look(dt);
    drawCard();
    draw();
    drawn++;
    // Walk into whoever is waiting and the fight is on. Only once you have moved: after a reload you
    // may be standing right in front of them, and should get to choose whether to walk in or walk out.
    if (inside && !met && stirred && game.meeting()) {
      met = true;
      way = [];
      wrap.classList.add('meeting');
      setTimeout(() => { if (game.startEncounter()) ctx.show('fight'); }, ctx.fast ? 60 : 460);
    }
    raf = requestAnimationFrame(frame);
  }

  const api = {
    /** Where something is on the screen right now (for tests, which tap it like a finger would). */
    screenOf(id) {
      // A place's door out in the lane; inside a place, 'next' is whoever is waiting and 'gate' the way out.
      const point = inside ? (id === 'gate' ? area.gate : area.posts[state.visit.stop]) : spotOf(id).door;
      const box = canvas.getBoundingClientRect();
      return { x: box.left + (point.x - cam.x) * cam.k, y: box.top + (point.y - cam.y) * cam.k };
    },
    /** How many frames have been drawn, to measure how smoothly it runs. */
    frames: () => drawn,
  };

  let watcher = null;
  return {
    el,
    shown() {
      fit();
      watcher = new ResizeObserver(() => { fit(); look(0); draw(); });
      watcher.observe(wrap);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      if (window.oddments) window.oddments.lane = api;
      last = performance.now();
      look(0);
      drawCard();
      draw();
      raf = requestAnimationFrame(frame);
    },
    gone() {
      cancelAnimationFrame(raf);
      if (watcher) watcher.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      ctx.save();
    },
  };
}
