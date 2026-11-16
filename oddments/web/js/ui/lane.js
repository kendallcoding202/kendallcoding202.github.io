// The lane: the open world between places. You walk it; the rules for where
// feet can go are in core/world.js, and this draws them.
//
// Everything on the ground here is drawn in code as a stand-in: there is no
// painted map yet (see docs/ART.md). The people, the Oddments and the little
// window in each building are the real art.
import { ROOMS, SPECIES, ELEMENTS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, SPOTS, TREES, spotOf } from '../core/world.js';
import { h, sprite, spriteSrc } from './dom.js';
import { elementTag } from './parts.js';

const VIEW = 580; // how much of the lane fits across the screen, in its own units
const HOME = { name: 'Home', blurb: 'Great-aunt Maribel\'s house, where you are staying. Out here in the lane everyone gets their breath back.' };
const INK = '#0d0a1c';

const images = {};
const picture = (src) => images[src] || (images[src] = Object.assign(new Image(), { src }));

// The lane itself runs from below home, past every door in turn.
const ROUTE = [{ x: WORLD.w / 2, y: WORLD.h + 40 }, ...SPOTS.map((spot) => spot.door)];
// Fixed scatter for grass tufts and fireflies: looks only, so not the game's dice.
const scatter = (n, seed) => { let s = seed; const next = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: n }, () => ({ x: next() * WORLD.w, y: next() * WORLD.h, r: next() })); };
const TUFTS = scatter(70, 11);
const FLIES = scatter(34, 29);

export function laneScreen(ctx) {
  const { game } = ctx;
  const { state } = game;
  const canvas = h('canvas', { class: 'lanecanvas', 'aria-label': 'The lane. Tap to walk.' });
  const card = h('div', { class: 'placecard', hidden: true });
  const hint = h('div', { class: 'lanehint', hidden: !!state.seen.walked }, 'Tap or drag to walk');
  const wrap = h('div', { class: 'lanewrap' }, canvas,
    h('header', { class: 'bar-top over' }, h('h1', null, 'The Lane'), h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))), hint);
  const el = h('section', { id: 'lane' }, wrap, card);
  const pen = canvas.getContext('2d');

  let target = null; // where you are walking to
  let mark = null; // the ring where you last tapped
  let raf = 0;
  let last = 0;
  let clock = 0;
  let facing = 1;
  let moving = false;
  let cardFor; // which place the card is showing (undefined: not drawn yet)
  let cam = { x: 0, y: 0, k: 1, w: VIEW, h: VIEW };
  const trail = []; // where you have just been, for the friends walking behind you
  const held = new Set();
  let watcher = null;

  // ------------------------------------------------------------ the camera

  function fit() {
    const box = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    cam.k = box.width / VIEW; // screen pixels to a unit
    cam.w = VIEW;
    cam.h = box.height / cam.k;
    cam.dpr = dpr;
  }

  function look() {
    const { x, y } = state.where;
    cam.x = Math.max(0, Math.min(WORLD.w - cam.w, x - cam.w / 2));
    cam.y = Math.max(Math.min(0, WORLD.h - cam.h), Math.min(WORLD.h - cam.h, y - cam.h * 0.56));
  }

  const toWorld = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    return { x: (clientX - box.left) / cam.k + cam.x, y: (clientY - box.top) / cam.k + cam.y };
  };

  // ------------------------------------------------------------ drawing

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
  const outline = (width = 4) => { pen.lineWidth = width; pen.strokeStyle = INK; pen.lineJoin = 'round'; pen.stroke(); };

  function ground() {
    pen.fillStyle = '#1e3346';
    pen.fillRect(cam.x - 4, cam.y - 4, cam.w + 8, cam.h + 8);
    for (const tuft of TUFTS) {
      oval(tuft.x, tuft.y, 46 + tuft.r * 50, 20 + tuft.r * 22);
      pen.fillStyle = tuft.r > 0.5 ? '#234057' : '#1a2c3e';
      pen.fill();
    }
    // The lane: a worn path from door to door.
    const path = () => {
      pen.beginPath();
      pen.moveTo(ROUTE[0].x, ROUTE[0].y);
      for (let i = 1; i < ROUTE.length - 1; i++) pen.quadraticCurveTo(ROUTE[i].x, ROUTE[i].y, (ROUTE[i].x + ROUTE[i + 1].x) / 2, (ROUTE[i].y + ROUTE[i + 1].y) / 2);
      pen.lineTo(ROUTE[ROUTE.length - 1].x, ROUTE[ROUTE.length - 1].y);
    };
    pen.lineCap = 'round'; pen.lineJoin = 'round';
    path(); pen.strokeStyle = '#141d30'; pen.lineWidth = 92; pen.stroke();
    path(); pen.strokeStyle = '#4b4273'; pen.lineWidth = 78; pen.stroke();
    path(); pen.strokeStyle = '#5a5088'; pen.lineWidth = 52; pen.stroke();
    // The edge of the world: a hedge all the way round.
    pen.strokeStyle = '#12202f'; pen.lineWidth = 36;
    pen.strokeRect(0, 0, WORLD.w, WORLD.h);
  }

  function building(spot) {
    const room = roomOf(spot.id);
    const tint = room ? room.tint : '#e8a23d';
    const open = !room || game.roomOpen(room.id);
    const cleared = !!room && state.rooms[room.id].clears > 0;
    const { x, y, w, tall } = spot;
    const wallTop = y - tall * 0.56;
    const top = y - tall;
    const dim = (alpha) => { pen.fillStyle = `rgba(13,10,28,${alpha})`; pen.fill(); };

    oval(x, y + 6, w * 0.56, 15); pen.fillStyle = 'rgba(8,6,20,.45)'; pen.fill();
    // Wall
    rounded(x - w / 2, wallTop, w, y - wallTop, 10); pen.fillStyle = tint; pen.fill(); dim(open ? 0.5 : 0.78); outline(5);
    // Roof
    pen.beginPath(); pen.moveTo(x - w / 2 - 16, wallTop + 8); pen.lineTo(x - w * 0.2, top); pen.lineTo(x + w * 0.2, top); pen.lineTo(x + w / 2 + 16, wallTop + 8); pen.closePath();
    pen.fillStyle = tint; pen.fill(); dim(open ? 0.22 : 0.66); outline(5);
    // A round window on to what is inside: the room's own painting.
    const wy = (wallTop + top) / 2 + 8;
    if (room) {
      const art = picture(`assets/bg/${room.bg}.webp`);
      pen.save(); pen.beginPath(); pen.arc(x, wy, 25, 0, Math.PI * 2); pen.clip();
      if (art.complete && art.naturalWidth) pen.drawImage(art, art.naturalWidth * 0.3, art.naturalHeight * 0.2, art.naturalHeight * 0.6, art.naturalHeight * 0.6, x - 25, wy - 25, 50, 50);
      if (!open) { pen.fillStyle = 'rgba(13,10,28,.7)'; pen.fillRect(x - 26, wy - 26, 52, 52); }
      pen.restore();
      pen.beginPath(); pen.arc(x, wy, 25, 0, Math.PI * 2); outline(4);
    } else {
      // Home: a chimney, and the lights are on.
      pen.fillStyle = '#5b3f4a'; pen.fillRect(x + w * 0.22, top - 14, 22, 40); pen.strokeStyle = INK; pen.lineWidth = 4; pen.strokeRect(x + w * 0.22, top - 14, 22, 40);
    }
    // Windows either side of the door
    for (const side of [-1, 1]) {
      rounded(x + side * w * 0.3 - 15, wallTop + 16, 30, 30, 5);
      pen.fillStyle = open ? '#ffd76a' : '#161230'; pen.fill(); outline(4);
    }
    // The door, lit if you can go in
    rounded(x - 21, y - 52, 42, 54, 16); pen.fillStyle = open ? '#ffc83d' : '#161230'; pen.fill(); outline(5);
    if (open) {
      const glow = pen.createRadialGradient(x, y + 30, 4, x, y + 30, 74);
      glow.addColorStop(0, 'rgba(255,200,61,.34)'); glow.addColorStop(1, 'rgba(255,200,61,0)');
      pen.fillStyle = glow; oval(x, y + 30, 74, 40); pen.fill();
    } else {
      // A padlock
      pen.lineWidth = 4; pen.strokeStyle = '#8d86b0'; pen.beginPath(); pen.arc(x, y - 30, 7, Math.PI, 0); pen.stroke();
      pen.fillStyle = '#8d86b0'; pen.fillRect(x - 10, y - 30, 20, 15);
    }
    // Its name
    const name = room ? room.name : HOME.name;
    pen.font = '600 17px Fredoka, ui-rounded, system-ui, sans-serif';
    const tw = pen.measureText(name).width + (cleared ? 22 : 0);
    rounded(x - tw / 2 - 11, top - 36, tw + 22, 27, 13); pen.fillStyle = 'rgba(13,10,28,.82)'; pen.fill();
    pen.lineWidth = 2; pen.strokeStyle = cleared ? '#58d77a' : open ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.12)'; pen.stroke();
    pen.textBaseline = 'middle'; pen.textAlign = 'center';
    pen.fillStyle = cleared ? '#58d77a' : open ? '#fff7e8' : '#8d86b0';
    pen.fillText(`${cleared ? '✓ ' : ''}${name}`, x, top - 22);
  }

  function tree(t) {
    oval(t.x, t.y + 5, t.r * 0.9, 9); pen.fillStyle = 'rgba(8,6,20,.4)'; pen.fill();
    pen.fillStyle = '#3d2c40'; pen.fillRect(t.x - 6, t.y - t.r * 0.9, 12, t.r * 0.95);
    pen.beginPath(); pen.arc(t.x, t.y - t.r * 1.45, t.r, 0, Math.PI * 2); pen.fillStyle = '#2b6552'; pen.fill(); outline(4);
    pen.beginPath(); pen.arc(t.x - t.r * 0.3, t.y - t.r * 1.75, t.r * 0.42, 0, Math.PI * 2); pen.fillStyle = '#3a8368'; pen.fill();
  }

  /** A sprite standing with its feet at (x, y). Sprites of Oddments face left as painted; people face right. */
  function stand(src, x, y, tall, faceRight, paintedRight, step) {
    const art = picture(src);
    oval(x, y + 2, tall * 0.3, tall * 0.085); pen.fillStyle = 'rgba(8,6,20,.5)'; pen.fill();
    if (!art.complete || !art.naturalWidth) return;
    const wide = tall * Math.min(1.5, art.naturalWidth / art.naturalHeight);
    const lift = step ? Math.abs(Math.sin(step)) * tall * 0.07 : 0;
    pen.save();
    pen.translate(x, y - lift);
    if (faceRight !== paintedRight) pen.scale(-1, 1);
    pen.drawImage(art, -wide / 2, -tall, wide, tall);
    pen.restore();
  }

  function draw() {
    look();
    pen.setTransform(cam.k * cam.dpr, 0, 0, cam.k * cam.dpr, -cam.x * cam.k * cam.dpr, -cam.y * cam.k * cam.dpr);
    ground();
    if (mark && mark.life > 0) {
      pen.beginPath(); pen.ellipse(mark.x, mark.y, 22 * (1.3 - mark.life), 10 * (1.3 - mark.life), 0, 0, Math.PI * 2);
      pen.strokeStyle = `rgba(255,200,61,${mark.life})`; pen.lineWidth = 4; pen.stroke();
    }
    // Back to front, so whoever is further down the screen is in front.
    const things = [];
    for (const spot of SPOTS) things.push({ y: spot.y, draw: () => building(spot) });
    for (const t of TREES) things.push({ y: t.y, draw: () => tree(t) });
    const { x, y } = state.where;
    const team = game.team();
    team.forEach((friend, i) => {
      const at = trail[Math.min(trail.length - 1, (i + 1) * 10)] || { x: x - facing * 40 * (i + 1), y: y - 4, f: facing };
      const fly = SPECIES[friend.species].fly ? 8 + Math.sin(clock * 3 + i) * 4 : 0;
      things.push({ y: at.y - 0.01 * (i + 1), draw: () => stand(spriteSrc(friend.species, friend.heirloom), at.x, at.y - fly, 56, at.f > 0, false, moving ? clock * 11 + i * 1.3 : 0) });
    });
    things.push({ y, draw: () => stand(spriteSrc(state.player.look), x, y, 100, facing > 0, true, moving ? clock * 11 : 0) });
    things.sort((a, b) => a.y - b.y);
    for (const thing of things) thing.draw();
    for (const fly of FLIES) {
      const glow = 0.25 + 0.55 * Math.abs(Math.sin(clock * (0.6 + fly.r) + fly.r * 40));
      pen.beginPath(); pen.arc(fly.x + Math.sin(clock * 0.7 + fly.r * 9) * 12, fly.y + Math.cos(clock * 0.5 + fly.r * 7) * 10, 2.6, 0, Math.PI * 2);
      pen.fillStyle = `rgba(255,224,122,${glow})`; pen.fill();
    }
  }

  // ------------------------------------------------------------ the card for wherever you are standing

  function drawCard() {
    const id = game.near();
    if (id === cardFor) return;
    cardFor = id;
    card.hidden = !id;
    card.dataset.spot = id || '';
    if (!id) return;
    const room = roomOf(id);
    if (!room) {
      card.replaceChildren(h('h2', null, HOME.name), h('small', null, HOME.blurb),
        h('button', { class: 'btn plain', data: { act: 'friends' }, onclick: () => ctx.show('friends') }, 'Choose your team'));
      return;
    }
    const open = game.roomOpen(room.id);
    const record = state.rooms[room.id];
    const before = ROOMS[ROOMS.indexOf(room) - 1];
    const bossId = roomBuilt(room) ? room.path[room.path.length - 1].boss : null;
    card.replaceChildren(
      h('h2', null, room.name, ' ', elementTag(room.element)),
      h('small', null, room.blurb),
      roomBuilt(room)
        ? h('small', null, `${room.path.length} stops, the last a boss${bossId && state.book[bossId].met ? `: ${SPECIES[bossId].name}` : ''}. Mostly ${ELEMENTS[room.element].name}.${record.visits ? ` Furthest: stop ${record.best} of ${room.path.length}.` : ''}`)
        : h('small', null, 'This place is in the lane but not built yet. The slice ends at the garden.'),
      open
        ? h('button', { class: 'btn gold', data: { act: 'enter' }, onclick: () => { if (game.enterRoom(room.id)) { ctx.save(); ctx.show('path'); } } }, record.clears ? 'Walk in again' : 'Walk in')
        : h('button', { class: 'btn gold', disabled: true, data: { act: 'enter' } }, roomBuilt(room) ? `Clear ${before.name} first` : 'Not built yet'));
  }

  // ------------------------------------------------------------ walking

  function aim(event) {
    target = toWorld(event.clientX, event.clientY);
    mark = { x: target.x, y: target.y, life: 1 };
    if (!state.seen.walked) { state.seen.walked = true; hint.hidden = true; }
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; aim(event); });
  canvas.addEventListener('pointermove', (event) => { if (dragging) aim(event); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, () => { dragging = false; });
  const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  const keyDown = (event) => { if (KEYS[event.key] && !event.target.closest('input')) held.add(event.key); };
  const keyUp = (event) => held.delete(event.key);

  function frame(time) {
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    clock += dt;
    if (held.size) {
      let dx = 0; let dy = 0;
      for (const key of held) { dx += KEYS[key][0]; dy += KEYS[key][1]; }
      target = dx || dy ? { x: state.where.x + dx * 60, y: state.where.y + dy * 60 } : target;
    }
    const before = state.where;
    moving = !!target && game.walk(target, dt);
    if (moving) {
      const dx = state.where.x - before.x;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      trail.unshift({ x: before.x, y: before.y, f: facing });
      if (trail.length > 40) trail.length = 40;
    } else if (target && !held.size) target = null;
    if (mark) mark.life -= dt * 1.6;
    drawCard();
    draw();
    raf = requestAnimationFrame(frame);
  }

  const api = {
    /** Where a place's door is on the screen right now (for tests, which tap it like a finger would). */
    screenOf(id) {
      const spot = spotOf(id);
      const box = canvas.getBoundingClientRect();
      look();
      return { x: box.left + (spot.door.x - cam.x) * cam.k, y: box.top + (spot.door.y - cam.y) * cam.k, inView: spot.door.y > cam.y + 10 && spot.door.y < cam.y + cam.h - 10 };
    },
  };

  return {
    el,
    shown() {
      fit();
      // The card for a place takes room from the view when it appears; keep the drawing true to its box.
      watcher = new ResizeObserver(() => { fit(); draw(); });
      watcher.observe(wrap);
      window.addEventListener('resize', fit);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      if (window.oddments) window.oddments.lane = api;
      last = performance.now();
      drawCard();
      draw();
      raf = requestAnimationFrame(frame);
    },
    gone() {
      cancelAnimationFrame(raf);
      if (watcher) watcher.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      ctx.save();
    },
  };
}
