// Indoors: the screen for the inside of a building. The rules (where feet can
// go, what there is to do) are in core/indoors.js and what a room looks like
// is in roomart.js; this keeps the view on you, takes your taps, and puts it
// on screen every frame, as lane.js does for the world outside.
import { SPECIES, ELEMENTS, roomOf } from '../core/balance.js';
import { POST } from '../core/world.js';
import { insideOf } from '../core/indoors.js';
import { CAST, THREE } from '../core/story.js';
import { nameOf, calledOf, artOf } from '../core/names.js';
import { h, sprite, spriteSrc } from './dom.js';
import { bar } from './parts.js';
import { howItGoes } from './text.js';
import { toast, modalOpen } from './modals.js';
import { converse } from './talk.js';
import { play } from '../platform/sound.js';
import { dustShift, throughDoor } from './shift.js';
import { FONT, oval, paint, glow, label, elementMark } from './scenery.js';
import { paintRoom, roomArt, standingIn } from './roomart.js';

const HOME_NAME = 'Home';
const HEAD = 62; // how far down the screen the heading reaches at the least, in screen points
const GAP = 60; // how far apart the team walks behind you
const FOOTFALL = 36;
const CLOSEST = 1.05; // screen points to a unit at the most: on a wide screen the room is not blown up to fit
const images = {};
const picture = (src) => images[src] || (images[src] = Object.assign(new Image(), { src }));
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// What each thing at home is called, what is said about it, and what its button says.
const SPOTS = {
  rest: { name: 'Your bed', about: 'Rest here and everyone gets their breath back.', label: 'Rest' },
  ring: { name: 'The telephone', about: 'Great-aunt Maribel is always glad of a call.', label: 'Ring great-aunt Maribel' },
  book: { name: 'The scrapbook', about: 'Everyone you have met, and everyone you have brought home.', label: 'Open it' },
  team: { name: 'The basket', about: 'Whoever is not walking with you sleeps here. Choose who comes.', label: 'Choose your team' },
};

export function insideScreen(ctx) {
  const { game } = ctx;
  const { state } = game;
  const id = state.indoors.id;
  const room = insideOf(id);
  const place = roomOf(id);
  const here = () => state.indoors || room.start;
  const big = room.people || 1; // how big people and Clutterkin are drawn on this floor, against the lane

  const canvas = h('canvas', { class: 'lanecanvas', 'aria-label': 'Tap to walk.' });
  const card = h('div', { class: 'placecard', hidden: true });
  const goalText = h('span');
  const goalChip = h('div', { class: 'goalchip', data: { act: 'goal' } }, h('i', null, 'Goal'), goalText);
  const title = h('h1', null, place ? place.name : HOME_NAME);
  const sub = h('small', { class: 'where' });
  const wrap = h('div', { class: 'lanewrap indoors' }, canvas,
    h('header', { class: 'bar-top over' }, h('div', null, title, sub), h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))),
    goalChip, card);
  const el = h('section', { id: 'inside', data: { room: id } }, wrap);
  const pen = canvas.getContext('2d');

  let way = [];
  let met = false; // a fight is about to start
  let gone = false; // you have stepped out
  let stirred = false;
  let passedOver = game.meeting();
  let mark = null;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let facing = 1;
  let aspect = 'back'; // you come in facing into the room
  let stride = 0;
  let footfall = 0;
  let spring = 0;
  let cardFor;
  let sheet = null; // the room, painted once
  const cam = { x: 0, y: 0, k: 1, w: room.view, h: room.view, dpr: 1, top: HEAD, set: false };
  const start = here();
  const trail = Array.from({ length: 12 }, (_, i) => ({ x: start.x, y: Math.min(room.h - 24, start.y + i * 14) }));
  const pals = game.team().map((friend, i) => ({ friend, x: start.x + (i - 1) * 46 * big, y: Math.min(room.h - 24, start.y + 40 + i * 6), f: 1, step: i * 9 }));
  // At home, whoever is not walking with you is in here with you, pottering about the floor.
  const stayers = room.kind !== 'home' ? [] : state.friends.filter((friend) => !state.team.includes(friend.id)).slice(0, 6).map((friend, i) => {
    const next = run((friend.id * 48271 + 23) % 2147483646 + 1);
    for (let k = 0; k < 4; k++) next();
    const spot = () => {
      for (let tries = 0; tries < 12; tries++) {
        const x = 80 + next() * (room.w - 160);
        const y = room.wall + 190 + next() * (room.h - room.wall - 400);
        if (Math.hypot(x - room.door.x, y - room.door.y) > 190 && !room.blocks.some((b) => x > b.x - 50 && x < b.x + b.w + 50 && y > b.y - 50 && y < b.y + b.h + 50)) return { x, y };
      }
      return { x: room.w / 2, y: room.wall + 300 };
    };
    return { friend, ...spot(), to: spot(), spot, wait: next() * 3 + i * 0.4, f: 1, step: 0, next };
  });
  const things = standingIn(id, room);
  const art = { maribel: picture(spriteSrc(CAST.maribel.art)) };
  for (const [name, src] of roomArt(id, room)) art[name] = picture(src);
  const shown = new Map();
  const held = new Set();

  // ------------------------------------------------------------ the camera

  function fit() {
    const box = wrap.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    cam.k = Math.min(CLOSEST, box.width / room.view);
    cam.w = box.width / cam.k;
    cam.h = box.height / cam.k;
    cam.dpr = dpr;
    cam.set = false;
    const chip = goalChip.getBoundingClientRect();
    cam.top = chip.height ? Math.max(HEAD, chip.bottom - box.top + 12) : HEAD;
    sheet = null;
  }

  function look(dt) {
    const top = cam.top / cam.k;
    const foot = (card.hidden ? 26 : 150) / cam.k;
    const at = here();
    // Across: the room in the middle of the screen. Down: all of it under the heading if it fits, else following you.
    cam.x = (room.w - cam.w) / 2;
    const fits = room.h + top + foot <= cam.h;
    const want = fits ? -top : Math.max(-top, Math.min(room.h - cam.h + foot, at.y - top - (cam.h - top - foot) * 0.56));
    const ease = cam.set ? 1 - Math.exp(-dt * 6.5) : 1;
    cam.y += (want - cam.y) * ease;
    cam.set = true;
  }

  const toRoom = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    return { x: (clientX - box.left) / cam.k + cam.x, y: (clientY - box.top) / cam.k + cam.y };
  };

  // ------------------------------------------------------------ drawing

  function stand(src, x, y, height, faceRight, paintedRight, rise = 0, lean = 0) {
    const image = picture(src);
    const tall = height * big;
    const lift = rise * big;
    oval(pen, x, y + 2, Math.max(0, tall * 0.3 * (1 - Math.min(1, lift / (tall * 0.5)))), tall * 0.085); paint(pen, 'rgba(8,6,20,.5)');
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

  /** How big something that has just appeared is drawn: it pops up over a third of a second. */
  function pop(key, what) {
    const was = shown.get(key);
    if (!was || was.what !== what) shown.set(key, { what, since: was ? clock : -1 });
    const t = Math.min(1, (clock - shown.get(key).since) / 0.34);
    const u = t - 1;
    return t >= 1 ? 1 : Math.max(0.05, 1 + 2.7 * u * u * u + 1.7 * u * u);
  }

  /** Whoever is waiting at one post of an indoor place. */
  function waiting(index) {
    const visit = state.visit && state.visit.room === id ? state.visit : null;
    const key = `post|${index}`;
    if (!visit || visit.groups[index].done) { shown.set(key, { what: 'none', since: -1 }); return; }
    const post = room.posts[index];
    const spot = place.path[index];
    const size = pop(key, 'group');
    const foes = visit.groups[index].foes;
    const boss = foes.some((foe) => SPECIES[foe.species].boss);
    const gap = boss ? 86 : foes.length > 2 ? 60 : 72;
    foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      const x = post.x + (i - (foes.length - 1) / 2) * gap * size;
      const y = post.y + (kind.boss ? -14 : boss ? 20 : 0);
      if (foe.heirloom) glow(pen, x, y - 22, 54, '255,200,61', 0.42 + 0.2 * Math.sin(clock * 5));
      stand(spriteSrc(artOf(foe), foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0) * size, (kind.boss ? 140 : foe.grown ? 74 : 58) * size, false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7)) * 3 * size);
      if (size >= 1) elementMark(pen, ELEMENTS[kind.element].name, ELEMENTS[kind.element].color, x, y + 16, kind.boss ? 18 : foes.length > 2 ? 14 : 16);
    });
    if (size < 1) return;
    const top = post.y - (boss ? 182 : 92);
    const others = place.path.length - 1 - visit.stop;
    if (visit.stroll || visit.groups[index].wander) label(pen, 'wandering', post.x, top, '#cdeed6', 'rgba(205,238,214,.3)', 21);
    else label(pen, spot.name, post.x, top, spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.28)');
    if (spot.boss && others > 0) label(pen, `calm the other ${others} first`, post.x, top + 38, '#b6b0d6', 'rgba(255,255,255,.14)', 19);
  }

  function draw() {
    const k = cam.k * cam.dpr;
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.fillStyle = '#0d0a1c';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
    if (!sheet) {
      sheet = document.createElement('canvas');
      sheet.width = Math.max(1, Math.ceil(room.w * k));
      sheet.height = Math.max(1, Math.ceil(room.h * k));
      const brush = sheet.getContext('2d');
      brush.setTransform(k, 0, 0, k, 0, 0);
      paintRoom(brush, id, room, art);
      // A painting may still be arriving the first time: paint the room again once it is here.
      for (const image of Object.values(art)) if (!image.complete) image.addEventListener('load', () => { sheet = null; }, { once: true });
    }
    pen.drawImage(sheet, 0, 0, room.w, room.h);
    if (mark && mark.life > 0) {
      pen.beginPath(); pen.ellipse(mark.x, mark.y, 24 * (1.3 - mark.life), 11 * (1.3 - mark.life), 0, 0, Math.PI * 2);
      pen.strokeStyle = `rgba(255,200,61,${Math.max(0, mark.life)})`; pen.lineWidth = 4; pen.stroke();
    }
    // Back to front, so whoever is further down the floor is in front.
    const row = [];
    for (const thing of things) row.push({ y: thing.y, draw: () => { pen.save(); pen.translate(thing.x, thing.y); thing.paint(pen, art, clock); pen.restore(); } });
    room.posts.forEach((post, index) => row.push({ y: post.y + 22, draw: () => waiting(index) }));
    for (const body of stayers) {
      const fly = SPECIES[body.friend.species].fly;
      row.push({ y: body.y, draw: () => stand(spriteSrc(artOf(body.friend), body.friend.heirloom), body.x, body.y, body.friend.grown ? 70 : 54, body.f > 0, false, fly ? 9 + Math.sin(clock * 3 + body.step) * 4 : Math.abs(Math.sin(body.step / (15 * big))) * 5) });
    }
    const { x, y } = here();
    for (const pal of pals) {
      const fly = SPECIES[pal.friend.species].fly;
      const lift = fly ? 9 + Math.sin(clock * 3 + pal.step) * 4 : Math.abs(Math.sin(pal.step / (15 * big))) * 5 * spring;
      row.push({ y: pal.y - 0.01, draw: () => stand(spriteSrc(artOf(pal.friend), pal.friend.heirloom), pal.x, pal.y, pal.friend.grown ? 70 : 54, pal.f > 0, false, lift) });
    }
    const hop = Math.abs(Math.sin(stride / (17 * big))) * 7 * spring;
    const view = aspect === 'side' ? state.player.look : `${state.player.look}_${aspect}`;
    row.push({ y, draw: () => stand(spriteSrc(view), x, y, 96, aspect !== 'side' || facing > 0, true, hop, Math.sin(stride / (17 * big)) * 0.035 * spring) });
    row.sort((a, b) => a.y - b.y);
    for (const thing of row) thing.draw();
    // Somewhere dark, you see only as far as your own lantern: a few steps each way.
    if (room.dim) {
      const light = pen.createRadialGradient(x, y - 40, 80, x, y - 40, 440);
      light.addColorStop(0, 'rgba(8,6,20,0)'); light.addColorStop(1, 'rgba(8,6,20,.8)');
      pen.fillStyle = light; pen.fillRect(cam.x - 2, cam.y - 2, cam.w + 4, cam.h + 4);
      glow(pen, x, y - 50, 150, '255,214,120', 0.14);
    }
    // What there is to do in here, each marked where you stand to do it, and named when you are near.
    const by = game.spotNear();
    for (const spot of room.spots) {
      const near = by && by.id === spot.id;
      const bob = Math.sin(clock * 3 + spot.x) * 3;
      pen.beginPath(); pen.arc(spot.x, spot.y - 4, (near ? 9 : 6) * Math.sqrt(big), 0, Math.PI * 2);
      paint(pen, near ? '#ffc83d' : 'rgba(255,200,61,.55)');
      pen.lineWidth = 2.5; pen.strokeStyle = 'rgba(13,10,28,.85)'; pen.stroke();
      if (!near) { pen.font = `700 ${Math.round(20 * Math.sqrt(big))}px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle'; pen.fillStyle = '#ffc83d'; pen.lineWidth = 5; pen.strokeText('▾', spot.x, spot.y - 30 + bob); pen.fillText('▾', spot.x, spot.y - 30 + bob); }
    }
    label(pen, 'Way out', room.door.x, room.door.y - 44, '#fff7e8', 'rgba(255,255,255,.28)', Math.round(18 * Math.sqrt(big)));
  }

  // ------------------------------------------------------------ the card

  const teamList = () => {
    const health = game.teamHealth();
    return h('div', { class: 'teamlist' }, game.team().map((friend, i) => h('div', { class: `teamcard${health[i].hp <= 0 ? ' down' : ''}` },
      sprite(artOf(friend), friend.heirloom, 'flip'),
      h('div', null, h('b', null, nameOf(friend)), bar(`hp${health[i].hp / health[i].max < 0.3 ? ' low' : ''}`, health[i].hp / health[i].max, `${health[i].hp} / ${health[i].max}`)))));
  };

  function act(spot) {
    if (spot.does === 'rest') {
      if (game.rest()) { ctx.save(); play('rest'); toast(state.friends.some((friend) => friend.species === THREE[0].kind) ? `Everyone is rested. ${calledOf(state, THREE[0].kind)} slept on your feet.` : 'Everyone is rested.', { kind: 'good' }); } else toast('Everyone is rested already.');
      cardFor = undefined;
    } else if (spot.does === 'ring') {
      const goal = game.goal();
      play('ring');
      converse([{ who: 'maribel', text: `Hello, dear. Now, where were we? ${goal.title}. ${goal.detail}` }], () => { cardFor = undefined; });
    } else if (spot.does === 'book') ctx.show('book');
    else if (spot.does === 'team') ctx.show('friends');
  }

  function drawCard() {
    const visit = state.visit;
    const spot = game.spotNear();
    const goal = game.goal();
    const key = `${spot ? spot.id : ''}|${visit ? `${visit.room}:${visit.stop}` : ''}|${goal.id}:${goal.count || ''}|${game.rested()}`;
    if (key === cardFor) return;
    cardFor = key;
    goalText.textContent = goal.count ? `${goal.title} (${goal.count[0]} of ${goal.count[1]})` : goal.title;
    goalChip.dataset.goal = goal.id;
    const mine = visit && visit.room === id;
    sub.textContent = mine ? howItGoes(visit, place) : place ? (state.rooms[id].clears > 0 ? 'calm' : '') : '';
    card.hidden = !spot && !mine;
    card.dataset.thing = spot ? spot.id : '';
    card.dataset.visit = mine ? visit.room : '';
    card.dataset.calmed = mine ? String(visit.stop) : '';
    card.className = `placecard${!spot && mine ? ' slim' : ''}`;
    if (card.hidden) return;
    if (spot) {
      const words = SPOTS[spot.does];
      const resting = spot.does === 'rest';
      const fresh = game.rested(); // nothing to rest from: not out on a visit, and not worn from strays
      card.replaceChildren(...[h('h2', null, words.name),
        h('small', null, resting && fresh ? 'Everyone is rested. Come back when they are worn out.' : resting ? `${words.about} ${!visit ? 'Other strays will be out on the lane by the time you set off.' : visit.stroll ? 'Others will have wandered in by the time you go back.' : 'Whoever you have calmed stays calm.'}` : words.about),
        resting && !fresh ? teamList() : null,
        h('button', { class: `btn ${resting && fresh ? 'plain' : 'gold'}`, disabled: resting && fresh, data: { act: spot.does }, onclick: () => act(spot) }, words.label)].filter(Boolean));
      return;
    }
    card.replaceChildren(
      h('div', { class: 'cardhead' }, h('h2', null, place.name, ' ', h('small', null, howItGoes(visit, place, true))), h('small', { class: 'resthint' }, 'Rest at home')),
      teamList());
  }

  // ------------------------------------------------------------ walking

  function aim(event) {
    stirred = true;
    const to = toRoom(event.clientX, event.clientY);
    if (passedOver >= 0) {
      const post = room.posts[passedOver];
      if (post && Math.hypot(to.x - post.x, to.y - post.y) <= POST.meet) passedOver = -1;
    }
    // A tap on the way out, or past it, is a tap on the mat.
    const out = to.y > room.h - 60 && Math.abs(to.x - room.door.x) < 110;
    way = game.routeTo(out ? room.door : to);
    mark = { x: out ? room.door.x : to.x, y: out ? room.door.y : to.y, life: 1 };
  }
  let dragging = false;
  let aimed = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; aimed = performance.now(); aim(event); });
  canvas.addEventListener('pointermove', (event) => { if (dragging && performance.now() - aimed > 140) { aimed = performance.now(); aim(event); } });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, () => { dragging = false; });
  const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  const keyDown = (event) => { if (KEYS[event.key] && !event.target.closest('input')) { held.add(event.key); stirred = true; } };
  const keyUp = (event) => held.delete(event.key);

  function behind(far) {
    let left = far;
    for (let i = 1; i < trail.length; i++) {
      const seg = Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
      if (seg >= left && seg > 0) return { x: trail[i - 1].x + ((trail[i].x - trail[i - 1].x) * left) / seg, y: trail[i - 1].y + ((trail[i].y - trail[i - 1].y) * left) / seg };
      left -= seg;
    }
    return trail[trail.length - 1];
  }

  function potter(dt) {
    for (const body of stayers) {
      if (body.wait > 0) { body.wait -= dt; continue; }
      const dx = body.to.x - body.x;
      const dy = body.to.y - body.y;
      const far = Math.hypot(dx, dy);
      if (far < 3) { body.to = body.spot(); body.wait = 1.5 + body.next() * 4; continue; }
      const step = Math.min(far, 42 * big * dt);
      body.x += (dx / far) * step; body.y += (dy / far) * step;
      body.step += step;
      if (Math.abs(dx) > 1) body.f = dx > 0 ? 1 : -1;
    }
  }

  function frame(time) {
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
    last = time;
    clock += dt;
    const before = { ...here() };
    if (held.size) {
      let dx = 0; let dy = 0;
      for (const key of held) { dx += KEYS[key][0]; dy += KEYS[key][1]; }
      if (dx || dy) way = [{ x: before.x + dx * 60, y: before.y + dy * 60 }];
    }
    while (way.length && Math.hypot(way[0].x - before.x, way[0].y - before.y) < 3) way.shift();
    if (modalOpen()) { way = []; held.clear(); }
    const moving = !met && !gone && way.length > 0 && game.walk(way[0], dt);
    // Stepping onto the mat is stepping out: back to the lane, at the door you came in by.
    if (!state.indoors) {
      if (!gone) { gone = true; play('door'); ctx.save(); throughDoor(() => ctx.show('lane'), ctx.fast); }
      return;
    }
    const now = here();
    if (moving) {
      const dx = now.x - before.x;
      const dy = now.y - before.y;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      if (Math.abs(dy) > Math.abs(dx) * 1.3) aspect = dy > 0 ? 'front' : 'back';
      else if (Math.abs(dx) > Math.abs(dy) * 1.3) aspect = 'side';
      stride += Math.hypot(dx, dy);
      if (stride - footfall >= FOOTFALL * big) { footfall = stride; play('step', { hard: true }); }
      if (Math.hypot(now.x - trail[0].x, now.y - trail[0].y) > 5) { trail.unshift({ x: now.x, y: now.y }); if (trail.length > 60) trail.length = 60; }
    } else if (way.length) way.shift();
    spring += ((moving ? 1 : 0) - spring) * (1 - Math.exp(-dt * 12));
    const ease = 1 - Math.exp(-dt * 10);
    pals.forEach((pal, i) => {
      const to = behind(GAP * big * (i + 1));
      const dx = (to.x - pal.x) * ease;
      const dy = (to.y - pal.y) * ease;
      pal.x += dx; pal.y += dy;
      pal.step += Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.25) pal.f = dx > 0 ? 1 : -1;
    });
    potter(dt);
    if (mark) mark.life -= dt * 1.6;
    look(dt);
    drawCard();
    draw();
    // Walk into whoever is waiting and the fight is on (only once you have moved: see lane.js).
    const beside = game.meeting();
    if (beside !== passedOver) passedOver = -1;
    const group = !met && stirred && passedOver < 0 ? beside : -1;
    if (group >= 0) {
      met = true;
      way = [];
      const boss = !!place.path[group].boss;
      const begin = () => { if (game.startEncounter(group)) ctx.show('fight'); };
      play('meet', { boss });
      if (ctx.fast) setTimeout(begin, 60);
      else {
        const post = room.posts[group];
        const box = canvas.getBoundingClientRect();
        play('scuffle');
        dustShift({ from: { x: box.left + (post.x - cam.x) * cam.k, y: box.top + (post.y - 30 - cam.y) * cam.k }, boss, covered: () => { begin(); play('poof'); } });
      }
    }
    raf = requestAnimationFrame(frame);
  }

  const api = {
    /** Where something on this floor is on the screen right now (for tests, which tap it like a finger would). */
    screenOf(what) {
      const visit = state.visit;
      let point;
      if (what === 'door') point = room.door;
      else if (what === 'me') point = here();
      else if (what === 'next') point = visit ? room.posts[game.nextGroup()] : null;
      else if (what.startsWith('post:')) point = room.posts[Number(what.slice(5))];
      else if (what.startsWith('thing:')) point = room.spots.find((spot) => spot.id === what.slice(6));
      if (!point) return null;
      const box = canvas.getBoundingClientRect();
      return { x: box.left + (point.x - cam.x) * cam.k, y: box.top + (point.y - cam.y) * cam.k };
    },
    facing: () => (aspect === 'side' ? (facing > 0 ? 'right' : 'left') : aspect),
    view: () => ({ x: cam.x, y: cam.y, w: cam.w, h: cam.h, k: cam.k }),
    indoors: id,
  };

  let watcher = null;
  return {
    el,
    shown() {
      fit();
      watcher = new ResizeObserver(() => { fit(); cam.set = false; look(0); draw(); });
      watcher.observe(wrap);
      window.addEventListener('keydown', keyDown);
      window.addEventListener('keyup', keyUp);
      if (window.oddments) window.oddments.lane = api;
      look(0);
      last = performance.now();
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
