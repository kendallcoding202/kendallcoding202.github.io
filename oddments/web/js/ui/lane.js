// The world you walk in: the lane between places, and the inside of a place
// once you have walked through its door. The rules for where feet can go are
// in core/world.js, and this draws them.
//
// Everything on the ground here is drawn in code as a stand-in: there is no
// painted map yet (see docs/ART.md). The people, the Oddments and the little
// window in each building are the real art.
import { ROOMS, SPECIES, ELEMENTS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, SPOTS, TREES, POST, spotOf, areaOf } from '../core/world.js';
import { h, sprite, spriteSrc } from './dom.js';
import { elementTag, bar } from './parts.js';

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
  // Inside a place, or out in the lane: the same screen, a different map.
  const inside = game.place() === 'path';
  const room = inside ? roomOf(state.visit.room) : null;
  const area = inside ? areaOf(room.id) : null;
  const size = inside ? area : WORLD;
  const here = () => game.standing() || { x: 0, y: 0 };
  const canvas = h('canvas', { class: 'lanecanvas', 'aria-label': 'Tap to walk.' });
  const card = h('div', { class: 'placecard', hidden: true });
  const hint = h('div', { class: 'lanehint', hidden: !!state.seen.walked }, 'Tap or drag to walk');
  const title = h('h1', null, inside ? room.name : 'The Lane');
  const wrap = h('div', { class: 'lanewrap' }, canvas,
    h('header', { class: 'bar-top over' }, title, h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))), hint);
  const el = h('section', { id: 'lane', class: inside ? 'inside' : '' }, wrap, card);
  const pen = canvas.getContext('2d');

  let way = []; // the points still to walk through to get where you tapped
  let met = false; // a fight is about to start
  let stirred = false; // you have touched the screen since it appeared
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
    const { x, y } = here();
    cam.x = Math.max(0, Math.min(size.w - cam.w, x - cam.w / 2));
    cam.y = Math.max(Math.min(0, size.h - cam.h), Math.min(size.h - cam.h, y - cam.h * 0.56));
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

  // ------------------------------------------------------------ drawing the inside of a place

  const label = (text, x, y, colour = '#fff7e8', edge = 'rgba(255,255,255,.3)') => {
    pen.font = '600 17px Fredoka, ui-rounded, system-ui, sans-serif';
    const tw = pen.measureText(text).width;
    rounded(x - tw / 2 - 11, y - 14, tw + 22, 27, 13); pen.fillStyle = 'rgba(13,10,28,.82)'; pen.fill();
    pen.lineWidth = 2; pen.strokeStyle = edge; pen.stroke();
    pen.textBaseline = 'middle'; pen.textAlign = 'center'; pen.fillStyle = colour;
    pen.fillText(text, x, y);
  };

  function insideGround() {
    pen.fillStyle = room.tint; pen.fillRect(cam.x - 4, cam.y - 4, cam.w + 8, cam.h + 8);
    pen.fillStyle = 'rgba(13,10,28,.66)'; pen.fillRect(cam.x - 4, cam.y - 4, cam.w + 8, cam.h + 8);
    for (const tuft of TUFTS) {
      if (tuft.y > area.h) continue;
      oval(tuft.x, tuft.y, 40 + tuft.r * 44, 16 + tuft.r * 18);
      pen.fillStyle = tuft.r > 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.14)'; pen.fill();
    }
    // The worn way through, from the gate past every stop.
    const through = () => { pen.beginPath(); pen.moveTo(area.gate.x, area.h + 40); pen.lineTo(area.gate.x, area.gate.y); for (const post of area.posts) pen.lineTo(post.x, post.y); };
    pen.lineCap = 'round'; pen.lineJoin = 'round';
    through(); pen.strokeStyle = 'rgba(13,10,28,.3)'; pen.lineWidth = 96; pen.stroke();
    through(); pen.strokeStyle = 'rgba(255,240,200,.1)'; pen.lineWidth = 78; pen.stroke();
    pen.strokeStyle = '#12202f'; pen.lineWidth = 36; pen.strokeRect(0, 0, area.w, area.h);
  }

  function hedge(block) {
    oval(block.x + block.w / 2, block.y + block.h + 4, block.w * 0.5, 9); pen.fillStyle = 'rgba(8,6,20,.35)'; pen.fill();
    rounded(block.x, block.y - 26, block.w, block.h + 26, 20); pen.fillStyle = '#245c40'; pen.fill(); outline(5);
    for (let x = block.x + 26; x < block.x + block.w - 10; x += 46) { pen.beginPath(); pen.arc(x, block.y - 14, 13, Math.PI, 0); pen.fillStyle = '#2f7a55'; pen.fill(); }
  }

  function gate() {
    const { x, y } = area.gate;
    const glow = pen.createRadialGradient(x, y, 4, x, y, 80);
    glow.addColorStop(0, 'rgba(255,200,61,.32)'); glow.addColorStop(1, 'rgba(255,200,61,0)');
    pen.fillStyle = glow; oval(x, y, 80, 44); pen.fill();
    for (const side of [-1, 1]) { rounded(x + side * 52 - 8, y - 4, 16, 58, 6); pen.fillStyle = '#6b4a3a'; pen.fill(); outline(4); }
    label('Out to the lane', x, y + 74, '#ffc83d', 'rgba(255,200,61,.5)');
  }

  /** Whoever is at a stop: the ones you can see waiting at the next one, a rustle further in. */
  function waiting(stop) {
    const post = area.posts[stop];
    const spot = room.path[stop];
    if (stop > state.visit.stop) {
      oval(post.x, post.y + 4, spot.boss ? 66 : 46, spot.boss ? 22 : 16); pen.fillStyle = 'rgba(8,6,20,.5)'; pen.fill();
      pen.font = '700 34px Fredoka, ui-rounded, system-ui, sans-serif'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      pen.fillStyle = spot.boss ? '#ff5a6a' : 'rgba(255,247,232,.55)';
      pen.fillText('?', post.x + Math.sin(clock * 2 + stop) * 3, post.y - 22);
      return;
    }
    const foes = state.visit.waiting || [];
    const gap = foes.length > 2 ? 62 : 74;
    foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      const x = post.x + (i - (foes.length - 1) / 2) * gap;
      const tall = kind.boss ? 150 : 62;
      if (foe.heirloom) { oval(x, post.y + 2, 30, 11); pen.strokeStyle = `rgba(255,200,61,${0.5 + 0.4 * Math.sin(clock * 5)})`; pen.lineWidth = 4; pen.stroke(); }
      stand(spriteSrc(foe.species, foe.heirloom), x, post.y - (kind.fly ? 8 + Math.sin(clock * 3 + i) * 4 : 0) + (kind.boss ? -6 : i % 2 ? 6 : 0), tall, false, false, clock * 4 + i * 2);
    });
    label(spot.name, post.x, post.y - (foes.some((foe) => SPECIES[foe.species].boss) ? 176 : 88), spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.3)');
  }

  function draw() {
    look();
    pen.setTransform(cam.k * cam.dpr, 0, 0, cam.k * cam.dpr, -cam.x * cam.k * cam.dpr, -cam.y * cam.k * cam.dpr);
    if (inside) insideGround(); else ground();
    if (mark && mark.life > 0) {
      pen.beginPath(); pen.ellipse(mark.x, mark.y, 22 * (1.3 - mark.life), 10 * (1.3 - mark.life), 0, 0, Math.PI * 2);
      pen.strokeStyle = `rgba(255,200,61,${mark.life})`; pen.lineWidth = 4; pen.stroke();
    }
    // Back to front, so whoever is further down the screen is in front.
    const things = [];
    if (inside) {
      things.push({ y: area.gate.y - 30, draw: gate });
      for (const block of area.blocks) things.push({ y: block.y + block.h, draw: () => hedge(block) });
      for (let stop = state.visit.stop; stop < area.posts.length; stop++) things.push({ y: area.posts[stop].y + 8, draw: () => waiting(stop) });
    } else {
      for (const spot of SPOTS) things.push({ y: spot.y, draw: () => building(spot) });
      for (const t of TREES) things.push({ y: t.y, draw: () => tree(t) });
    }
    const { x, y } = here();
    const team = game.team();
    team.forEach((friend, i) => {
      const at = trail[Math.min(trail.length - 1, (i + 1) * 10)] || { x: x - facing * 40 * (i + 1), y: y - 4, f: facing };
      const fly = SPECIES[friend.species].fly ? 8 + Math.sin(clock * 3 + i) * 4 : 0;
      things.push({ y: at.y - 0.01 * (i + 1), draw: () => stand(spriteSrc(friend.species, friend.heirloom), at.x, at.y - fly, 56, at.f > 0, false, moving ? clock * 11 + i * 1.3 : 0) });
    });
    things.push({ y, draw: () => stand(spriteSrc(state.player.look), x, y, 100, facing > 0, true, moving ? clock * 11 : 0) });
    void POST;
    things.sort((a, b) => a.y - b.y);
    for (const thing of things) thing.draw();
    for (const fly of FLIES) {
      if (fly.y > size.h) continue;
      const glow = 0.25 + 0.55 * Math.abs(Math.sin(clock * (0.6 + fly.r) + fly.r * 40));
      pen.beginPath(); pen.arc(fly.x + Math.sin(clock * 0.7 + fly.r * 9) * 12, fly.y + Math.cos(clock * 0.5 + fly.r * 7) * 10, 2.6, 0, Math.PI * 2);
      pen.fillStyle = `rgba(255,224,122,${glow})`; pen.fill();
    }
  }

  // ------------------------------------------------------------ the card for wherever you are standing

  function drawCard() {
    if (inside) {
      // Inside, the card is always there: how far you have got, how everyone is, and the way out.
      const stop = state.visit.stop;
      if (cardFor === stop) return;
      cardFor = stop;
      const spot = room.path[stop];
      const health = game.teamHealth();
      card.hidden = false;
      card.dataset.spot = room.id;
      card.dataset.stop = String(stop);
      card.replaceChildren(
        h('h2', null, spot.name, ' ', h('small', null, `stop ${stop + 1} of ${room.path.length}`)),
        h('small', null, spot.boss ? 'Something big is waiting at the far end. Walk up to it when you are ready.' : 'Someone is waiting up ahead. Walk up to them to meet them.'),
        h('div', { class: 'teamlist' }, game.team().map((friend, i) => h('div', { class: `teamcard${health[i].hp <= 0 ? ' down' : ''}` },
          sprite(friend.species, friend.heirloom, 'flip'),
          h('div', null, h('b', null, SPECIES[friend.species].name), bar(`hp${health[i].hp / health[i].max < 0.3 ? ' low' : ''}`, health[i].hp / health[i].max, `${health[i].hp} / ${health[i].max}`))))),
        h('button', { class: 'btn plain', data: { act: 'home' }, onclick: () => { if (game.leaveRoom()) { ctx.save(); ctx.show('lane'); } } }, 'Back out to the lane'));
      return;
    }
    const id = game.near();
    if (id === cardFor) return;
    cardFor = id;
    card.hidden = !id;
    card.dataset.spot = id || '';
    if (!id) return;
    const spot = roomOf(id);
    if (!spot) {
      card.replaceChildren(h('h2', null, HOME.name), h('small', null, HOME.blurb),
        h('button', { class: 'btn plain', data: { act: 'friends' }, onclick: () => ctx.show('friends') }, 'Choose your team'));
      return;
    }
    const open = game.roomOpen(spot.id);
    const record = state.rooms[spot.id];
    const before = ROOMS[ROOMS.indexOf(spot) - 1];
    const bossId = roomBuilt(spot) ? spot.path[spot.path.length - 1].boss : null;
    card.replaceChildren(
      h('h2', null, spot.name, ' ', elementTag(spot.element)),
      h('small', null, spot.blurb),
      roomBuilt(spot)
        ? h('small', null, `${spot.path.length} stops, the last a boss${bossId && state.book[bossId].met ? `: ${SPECIES[bossId].name}` : ''}. Mostly ${ELEMENTS[spot.element].name}.${record.visits ? ` Furthest: stop ${record.best} of ${spot.path.length}.` : ''}`)
        : h('small', null, 'This place is in the lane but not built yet. The slice ends at the garden.'),
      open
        ? h('button', { class: 'btn gold', data: { act: 'enter' }, onclick: () => { if (game.enterRoom(spot.id)) { ctx.save(); ctx.show('path'); } } }, record.clears ? 'Walk in again' : 'Walk in')
        : h('button', { class: 'btn gold', disabled: true, data: { act: 'enter' } }, roomBuilt(spot) ? `Clear ${before.name} first` : 'Not built yet'));
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
    moving = way.length > 0 && game.walk(way[0], dt);
    if (moving) {
      const dx = here().x - before.x;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      trail.unshift({ x: before.x, y: before.y, f: facing });
      if (trail.length > 40) trail.length = 40;
    } else if (way.length) way.shift();
    if (mark) mark.life -= dt * 1.6;
    drawCard();
    draw();
    // Walk into whoever is waiting and the fight is on. Only once you have moved: after a reload you
    // may be standing right in front of them, and should get to choose whether to walk in or walk out.
    if (inside && !met && stirred && game.meeting()) {
      met = true;
      way = [];
      wrap.classList.add('meeting');
      setTimeout(() => { if (game.startEncounter()) ctx.show('fight'); }, ctx.fast ? 60 : 420);
    }
    raf = requestAnimationFrame(frame);
  }

  const api = {
    /** Where a place's door is on the screen right now (for tests, which tap it like a finger would). */
    screenOf(id) {
      // A place's door out in the lane; inside a place, 'next' is whoever is waiting and 'gate' the way out.
      const point = inside ? (id === 'gate' ? area.gate : area.posts[state.visit.stop]) : spotOf(id).door;
      const box = canvas.getBoundingClientRect();
      look();
      return { x: box.left + (point.x - cam.x) * cam.k, y: box.top + (point.y - cam.y) * cam.k, inView: point.y > cam.y + 10 && point.y < cam.y + cam.h - 10 };
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
