// The world you walk in: the lane between places, and the inside of a place
// once you have walked through its door. The rules for where feet can go are
// in core/world.js; what things look like is in scenery.js; this keeps the
// view on you, takes your taps, and puts it all on screen every frame.
//
// The ground and everything standing on it is painted once and kept (see
// `bake`), then placed each frame, so a frame costs a handful of pictures
// however detailed the painting was.
import { ROOMS, SPECIES, ELEMENTS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, SPOTS, TREES, LAMPS, spotOf, areaOf } from '../core/world.js';
import { h, sprite, spriteSrc } from './dom.js';
import { elementTag, bar } from './parts.js';
import { FONT, oval, paint, glow, label, worldSrc, paintLaneGround, paintInsideGround, paintBuilding, paintProp, paintLamp, paintHedge, paintGate } from './scenery.js';

// The world is exactly one screen wide: the view only ever travels up and down.
const VIEW = WORLD.w;
const HOME = { name: 'Home', blurb: 'Great-aunt Maribel\'s house, where you are staying. Out here in the lane everyone gets their breath back.' };
const GAP = 60; // how far apart the team walks behind you: a little more than any of them is tall

const images = {};
const picture = (src) => images[src] || (images[src] = Object.assign(new Image(), { src }));

// The lane itself runs from below home, past every door in turn.
const ROUTE = [{ x: WORLD.w / 2, y: WORLD.h + 60 }, ...SPOTS.map((spot) => spot.door)];
// Fireflies: looks only, so not the game's dice.
const FLIES = (() => { let s = 29; const next = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 30 }, () => ({ x: next() * WORLD.w, y: next() * WORLD.h, r: next() })); })();

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

  // ------------------------------------------------------------ painted once, placed every frame

  let kept = new Map();
  /** Paints a piece of the world (x, y, w, h in the world's own units) into a picture of its own, once. */
  function bake(key, x, y, w, hgt, painter, sharp = 1) {
    let piece = kept.get(key);
    if (!piece) {
      const k = cam.k * cam.dpr * sharp;
      const sheet = document.createElement('canvas');
      sheet.width = Math.max(1, Math.ceil(w * k));
      sheet.height = Math.max(1, Math.ceil(hgt * k));
      const brush = sheet.getContext('2d');
      brush.setTransform(k, 0, 0, k, -x * k, -y * k);
      painter(brush);
      piece = { sheet, x, y, w, h: hgt };
      kept.set(key, piece);
    }
    return piece;
  }
  const put = (p, dx = 0, dy = 0) => pen.drawImage(p.sheet, p.x + dx, p.y + dy, p.w, p.h);
  // A painting may still be arriving when something is first painted from it: paint again once it is here.
  const painting = (name) => {
    const image = picture(worldSrc(name));
    if (!image.complete) image.addEventListener('load', () => { kept = new Map(); }, { once: true });
    return image;
  };
  const groundArt = () => ({ grass: painting('grass'), earth: painting('earth'), bush: painting('p_bush') });

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
    kept = new Map(); // everything is painted afresh at the new size
  }

  // How far past the ends of the world the view may travel, so they can scroll out from under the
  // title at the top and the card at the bottom.
  const over = () => ({ top: 62 / cam.k, bottom: (inside ? 118 : 168) / cam.k });

  function look(dt) {
    const { top, bottom } = over();
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
  const seen = (y, margin = 300) => y > cam.y - margin && y < cam.y + cam.h + margin;

  // ------------------------------------------------------------ drawing

  function ground() {
    // The whole ground is one picture; only the part in view is copied to the screen.
    const { top, bottom } = over();
    const y0 = -top - 20;
    const full = bake('ground', 0, y0, size.w, size.h + top + bottom + 40,
      (brush) => (inside ? paintInsideGround(brush, room, area, groundArt()) : paintLaneGround(brush, size, ROUTE, SPOTS, LAMPS, groundArt())), Math.min(1, 1.7 / (cam.k * cam.dpr)));
    const scale = full.sheet.width / full.w;
    const from = Math.max(full.y, cam.y - 2);
    const to = Math.min(full.y + full.h, cam.y + cam.h + 2);
    pen.drawImage(full.sheet, 0, (from - full.y) * scale, full.sheet.width, (to - from) * scale, 0, from, full.w, to - from);
  }

  /** A sprite standing with its feet at (x, y). Oddments are painted facing left; people facing right. */
  function stand(src, x, y, tall, faceRight, paintedRight, lift = 0, lean = 0) {
    const image = picture(src);
    oval(pen, x, y + 2, tall * 0.3 * (1 - lift / (tall * 0.5)), tall * 0.085); paint(pen, 'rgba(8,6,20,.5)');
    if (!image.complete || !image.naturalWidth) return;
    const wide = tall * Math.min(1.5, image.naturalWidth / image.naturalHeight);
    const high = wide > tall * 1.2 ? wide * (image.naturalHeight / image.naturalWidth) : tall;
    pen.save();
    pen.translate(x, y - lift);
    pen.rotate(lean);
    if (faceRight !== paintedRight) pen.scale(-1, 1);
    pen.drawImage(image, -wide / 2, -high, wide, high);
    pen.restore();
  }

  function building(spot) {
    const place = roomOf(spot.id);
    const open = !place || game.roomOpen(place.id);
    const cleared = !!place && state.rooms[place.id].clears > 0;
    if (open) glow(pen, spot.x, spot.y + 30, 104, '255,200,61', 0.3); // light spilling from an open door
    put(bake(`${spot.id}|${open}|${cleared}`, spot.x - 170, spot.y - 330, 340, 384,
      (brush) => paintBuilding(brush, spot, { image: painting(`b_${spot.id}`), name: place ? place.name : HOME.name, open, cleared })));
  }

  /** Whoever is at a stop: the ones you can see waiting at the next one, a rustle in the bushes further in. */
  function waiting(stop) {
    const post = area.posts[stop];
    const spot = room.path[stop];
    if (stop > state.visit.stop) {
      const big = spot.boss ? 1.5 : 1;
      const sway = Math.sin(clock * 2.2 + stop * 2) * 2.5;
      put(bake(`bush|${big}`, -90, -150, 180, 180, (brush) => paintProp(brush, painting('p_bush'), 100 * big)), post.x + sway, post.y);
      pen.font = `700 ${Math.round(30 * big)}px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      pen.fillStyle = spot.boss ? '#ff8a96' : '#fff7e8';
      pen.lineWidth = 6; pen.strokeStyle = 'rgba(13,10,28,.85)'; pen.lineJoin = 'round'; pen.strokeText('?', post.x + sway, post.y - 44 * big);
      pen.fillText('?', post.x + sway, post.y - 44 * big);
      return;
    }
    const foes = state.visit.waiting || [];
    const boss = foes.some((foe) => SPECIES[foe.species].boss);
    const gap = boss ? 86 : foes.length > 2 ? 60 : 72;
    foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      const x = post.x + (i - (foes.length - 1) / 2) * gap;
      const y = post.y + (kind.boss ? -14 : boss ? 20 : 0);
      if (foe.heirloom) glow(pen, x, y - 22, 54, '255,200,61', 0.42 + 0.2 * Math.sin(clock * 5));
      stand(spriteSrc(foe.species, foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0), kind.boss ? 140 : 58, false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7)) * 3);
    });
    label(pen, spot.name, post.x, post.y - (boss ? 178 : 88), spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.28)');
  }

  function draw() {
    const k = cam.k * cam.dpr;
    pen.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    ground();
    if (mark && mark.life > 0) {
      pen.beginPath(); pen.ellipse(mark.x, mark.y, 24 * (1.3 - mark.life), 11 * (1.3 - mark.life), 0, 0, Math.PI * 2);
      pen.strokeStyle = `rgba(255,200,61,${Math.max(0, mark.life)})`; pen.lineWidth = 4; pen.stroke();
    }
    // Back to front, so whoever is further down the screen is in front.
    const things = [];
    if (inside) {
      things.push({ y: area.gate.y + 54, draw: () => { put(bake('gate', -160, -90, 320, 120, paintGate), area.gate.x, area.gate.y + 52); label(pen, 'Out to the lane', area.gate.x, area.gate.y + 86, '#ffc83d', 'rgba(255,200,61,.5)'); } });
      area.blocks.forEach((block, i) => { if (seen(block.y)) things.push({ y: block.y + block.h, draw: () => put(bake(`hedge|${i}`, block.x - 30, block.y - 60, block.w + 60, block.h + 96, (brush) => paintHedge(brush, block, painting('p_bush')))) }); });
      for (let stop = state.visit.stop; stop < area.posts.length; stop++) if (seen(area.posts[stop].y)) things.push({ y: area.posts[stop].y + 22, draw: () => waiting(stop) });
    } else {
      for (const spot of SPOTS) if (seen(spot.y)) things.push({ y: spot.y, draw: () => building(spot) });
      for (const t of TREES) if (seen(t.y)) things.push({ y: t.y, draw: () => put(bake(`tree|${t.r}`, -t.r * 1.9, -t.r * 3.8, t.r * 3.8, t.r * 3.8 + 24, (brush) => paintProp(brush, painting('p_tree'), t.r * 3.3)), t.x, t.y) });
      for (const lamp of LAMPS) if (seen(lamp.y)) things.push({ y: lamp.y, draw: () => put(bake('lamp', -60, -160, 120, 172, (brush) => paintLamp(brush, painting('p_lamp'))), lamp.x, lamp.y) });
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
      pen.beginPath(); pen.arc(fx, fy, 6, 0, Math.PI * 2); paint(pen, `rgba(255,224,122,${bright * 0.22})`);
      pen.beginPath(); pen.arc(fx, fy, 2.4, 0, Math.PI * 2); paint(pen, `rgba(255,236,160,${bright})`);
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

  // Everything on this map is painted before the first frame is shown, by looking at the whole of it
  // once, a screenful at a time. Otherwise the first sight of each building would cost a frame mid-walk.
  function warm() {
    const { top, bottom } = over();
    for (let y = -top; y < size.h + bottom; y += cam.h * 0.8) { cam.y = y; draw(); }
    cam.set = false;
    look(0);
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
      watcher = new ResizeObserver(() => { fit(); warm(); draw(); });
      watcher.observe(wrap);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      if (window.oddments) window.oddments.lane = api;
      warm();
      last = performance.now();
      drawCard();
      draw();
      raf = requestAnimationFrame(frame);
    },
    gone() {
      cancelAnimationFrame(raf);
      if (watcher) watcher.disconnect();
      kept = new Map();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      ctx.save();
    },
  };
}
