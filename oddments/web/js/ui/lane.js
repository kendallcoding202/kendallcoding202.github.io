// The world you walk in: one open neighbourhood, with the view following you
// across it. The rules for where feet can go are in core/world.js; what things
// look like is in scenery.js; this keeps the view on you, takes your taps,
// and puts it all on screen every frame.
//
// The ground and everything standing on it is painted once and kept (see
// `bake`), then placed each frame, so a frame costs a handful of pictures
// however detailed the painting was.
import { ROOMS, SPECIES, ELEMENTS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, POST, SPOTS, TREES, LAMPS, HEDGES, ROAD_POINTS, GREEN, DISTRICTS, PEOPLE, spotOf, personAt, districtAt } from '../core/world.js';
import { CAST } from '../core/story.js';
import { h, sprite, spriteSrc } from './dom.js';
import { elementTag, bar } from './parts.js';
import { modal, toast, modalOpen } from './modals.js';
import { converse } from './talk.js';
import { play } from '../platform/sound.js';
import { FONT, oval, paint, glow, label, worldSrc, paintGround, paintBuilding, paintProp, paintLamp, paintGate, wallOf } from './scenery.js';

// How much of the world fits across the screen. People and Clutterkin are small in a big place.
// On a wider screen (a folding phone, open) you see more of the world, not the same view blown up:
// past ZOOM_MOST screen points to a unit, extra width goes to showing more.
const VIEW = 760;
const ZOOM_MOST = 0.66;
const MOST_DOTS = 2.4e6; // the most pixels the world is ever drawn with: about what a large iPhone has
const HOME = { name: 'Home', blurb: 'Great-aunt Maribel\'s house, where you are staying.' };
const GAP = 60; // how far apart the team walks behind you: a little more than any of them is tall
const LANE = 'The Lane';

const images = {};
// Everything painted so far, kept between visits to this screen (coming back from a fight should not
// mean painting the world again) for as long as the screen stays the same size.
const painted = { size: '', pieces: new Map() };
const picture = (src) => images[src] || (images[src] = Object.assign(new Image(), { src }));
/** A fixed run of numbers from 0 to 1: looks only, so not the game's dice. */
const run = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// How each place you walk into is dressed: what is underfoot, what its gateway is made of, and what
// whoever is restless there hides in or behind when you are not in among them. (The garden: grass,
// wood, bushes.)
const DRESS = { alley: { floor: 'cobbles', gate: 'iron', cover: 'a_bin', coverWide: 62 } };
const PLAIN = { floor: 'grass', gate: 'wood', cover: 'p_bush', coverWide: 100 };
// The places you walk into that are built: their ground, and who waits where.
const PLACES = ROOMS.filter((room) => roomBuilt(room) && DISTRICTS[room.id]).map((room) => ({ room, area: DISTRICTS[room.id], dress: DRESS[room.id] || PLAIN }));
const EAST = 150; // how far past the east edge of the world the view may travel, so a place along that edge is not seen pressed to the side of the screen
// Fireflies, and every piece of every wall: fixed, so worked out once. A paved place along the east
// edge of the world gets a wall of junk there too. That one is looks only: the edge is what stops you.
const FLIES = (() => { const next = run(29); return Array.from({ length: 120 }, () => ({ x: next() * WORLD.w, y: next() * WORLD.h, r: next() })); })();
const WALLS = [
  ...HEDGES,
  ...PLACES.filter(({ area, dress }) => dress.floor === 'cobbles' && area.x + area.w >= WORLD.w).map(({ area }) => ({ x: WORLD.w - 34, y: area.y, w: 44, h: area.h, look: 'junk' })),
].flatMap(wallOf);
const GROUND = {
  w: WORLD.w, h: WORLD.h, roads: ROAD_POINTS, spots: SPOTS.filter((spot) => !DISTRICTS[spot.id]), lamps: LAMPS, hedges: HEDGES, green: GREEN,
  lawns: PLACES.map(({ room, area, dress }) => ({ x: area.x, y: area.y, w: area.w, h: area.h, tint: room.tint, gate: area.gate, posts: area.posts, floor: dress.floor })),
};
// Where feet fall on stone, not grass, and how far apart footfalls are. And the goal as last heard
// of: a new one gets a bell, once, whichever screen it changed on.
const PAVED = new Set(PLACES.filter(({ dress }) => dress.floor === 'cobbles').map(({ room }) => room.id));
const FOOTFALL = 36;
let goalHeard = null;
/** How the world is laid out for painting: for tools/postcard.mjs, which paints the same world for the loading screen. */
export const LAID_OUT = { PLACES, WALLS, GROUND };
/** The last place that is built: where this slice of the game ends. */
const LAST_BUILT = ROOMS.filter(roomBuilt).pop();

export function laneScreen(ctx) {
  const { game } = ctx;
  const { state } = game;
  const here = () => state.where;

  const canvas = h('canvas', { class: 'lanecanvas', 'aria-label': 'Tap to walk.' });
  const card = h('div', { class: 'placecard', hidden: true });
  const hint = h('div', { class: 'lanehint', hidden: !!state.seen.walked }, 'Tap or drag to walk');
  // What to do next, always in sight; a tap opens the story so far.
  const goalText = h('span');
  const goalChip = h('button', { class: 'goalchip', data: { act: 'goal' }, onclick: () => journal() }, h('i', null, 'Goal'), goalText);
  const title = h('h1', null, LANE);
  const sub = h('small', { class: 'where' });
  const wrap = h('div', { class: 'lanewrap' }, canvas,
    h('header', { class: 'bar-top over' }, h('div', null, title, sub), h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))),
    goalChip, hint, card);
  const el = h('section', { id: 'lane' }, wrap);
  const pen = canvas.getContext('2d');

  let way = []; // the points still to walk through to get where you tapped
  let met = false; // a fight is about to start
  let stirred = false; // you have touched the screen since it appeared
  // Whoever you were already standing beside when the screen appeared (after a reload, say). They are
  // not met just because you move: only if you tap them, or walk off and come back.
  let passedOver = game.meeting();
  let mark = null; // the ring where you last tapped
  let raf = 0;
  let last = 0;
  let clock = 0;
  let drawn = 0;
  let facing = 1;
  let aspect = 'front'; // which way you are turned: 'side' (see `facing`), 'front' toward the screen, 'back' away from it
  let stride = 0; // how far you have walked, for the bounce in your step
  let footfall = 0; // how far you had walked at your last footfall
  let spring = 0; // 0 standing still, 1 walking: eased, so a step never snaps
  let cardFor; // what the card is showing (undefined: not drawn yet)
  let everything = false; // true while painting the whole world once, before the first frame
  const cam = { x: 0, y: 0, k: 1, w: VIEW, h: VIEW, dpr: 1, set: false };
  // Where you have just been, newest first, for the friends walking behind you.
  const start = here();
  const trail = Array.from({ length: 12 }, (_, i) => ({ x: start.x - i * 16, y: start.y + i * 2.5 }));
  const pals = game.team().map((friend, i) => ({ friend, x: start.x - (i + 1) * GAP, y: start.y + (i + 1) * 7, f: 1, step: i * 9 }));
  // Friends who stayed home potter about on the green. Looks only: you walk straight through them.
  const homebodies = state.friends.filter((friend) => !state.team.includes(friend.id)).slice(0, 9).map((friend, i) => {
    // Each has its own run of numbers, well stirred before it is used: small seeds start small.
    const next = run((friend.id * 48271 + 11) % 2147483646 + 1);
    for (let k = 0; k < 4; k++) next();
    const spot = () => ({ x: GREEN.x + 50 + next() * (GREEN.w - 100), y: GREEN.y + 30 + next() * (GREEN.h - 60) });
    return { friend, ...spot(), to: spot(), spot, wait: next() * 3 + i * 0.4, f: 1, step: 0, next };
  });
  // What stands at each post was last seen as (bushes, a group, nothing), and since when: for the little pop as it changes.
  const shown = new Map();
  const held = new Set();

  // ------------------------------------------------------------ painted once, placed every frame

  const kept = painted.pieces;
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
  const put = (p, dx = 0, dy = 0, scale = 1) => (scale === 1
    ? pen.drawImage(p.sheet, p.x + dx, p.y + dy, p.w, p.h)
    : pen.drawImage(p.sheet, p.x * scale + dx, p.y * scale + dy, p.w * scale, p.h * scale));
  // A painting may still be arriving when something is first painted from it: paint again once it is here.
  const painting = (name) => {
    const image = picture(worldSrc(name));
    if (!image.complete) image.addEventListener('load', () => kept.clear(), { once: true });
    return image;
  };
  const groundArt = () => ({ grass: painting('grass'), earth: painting('earth'), cobbles: painting('cobbles'), bush: painting('p_bush'), tree: painting('p_tree') });

  // ------------------------------------------------------------ the camera

  function fit() {
    const box = wrap.getBoundingClientRect();
    // Sharp, but not past what can be drawn sixty times a second: a big screen (a folding phone,
    // open) is drawn a little less finely than a small one, never with more dots in all.
    const dpr = Math.min(2.5, window.devicePixelRatio || 1, Math.sqrt(MOST_DOTS / Math.max(1, box.width * box.height)));
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    cam.w = Math.max(VIEW, box.width / ZOOM_MOST);
    cam.k = box.width / cam.w; // screen pixels to a unit
    cam.h = box.height / cam.k;
    cam.dpr = dpr;
    cam.set = false;
    // At a new size everything is painted afresh; at the same size what was painted before still serves.
    const size = `${canvas.width}x${canvas.height}@${dpr}`;
    if (painted.size !== size) { painted.size = size; kept.clear(); }
  }

  // How far past the top and bottom of the world the view may travel, so they can scroll out from
  // under the title and the card. With no card up, the bottom has nothing to get out from under.
  const over = () => ({ top: 62 / cam.k, bottom: 168 / cam.k });
  const pastFoot = () => (card.hidden ? 44 : 168) / cam.k;
  const within = (lo, hi, v) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

  function look(dt) {
    const { top, bottom } = over();
    const at = here();
    const wantX = within(0, WORLD.w + EAST - cam.w, at.x - cam.w / 2);
    const wantY = within(-top, WORLD.h - cam.h + pastFoot(), at.y - top - (cam.h - top - bottom) * 0.56);
    const ease = cam.set ? 1 - Math.exp(-dt * 6.5) : 1;
    cam.x += (wantX - cam.x) * ease;
    cam.y += (wantY - cam.y) * ease;
    cam.set = true;
  }

  const toWorld = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    return { x: (clientX - box.left) / cam.k + cam.x, y: (clientY - box.top) / cam.k + cam.y };
  };
  const seen = (x, y, margin = 320) => everything || (x > cam.x - margin && x < cam.x + cam.w + margin && y > cam.y - margin && y < cam.y + cam.h + margin);

  // ------------------------------------------------------------ drawing

  function ground() {
    // The whole ground is one picture; only the part in view is copied to the screen. On a big
    // screen it is kept a little soft rather than let it grow past what a phone will hold.
    const { top, bottom } = over();
    const y0 = -top - 20;
    const tall = WORLD.h + top + bottom + 40;
    const wide = WORLD.w + EAST;
    const sharp = Math.min(1, 1.7 / (cam.k * cam.dpr), Math.sqrt(9e6 / (wide * tall)) / (cam.k * cam.dpr));
    const full = bake('ground', 0, y0, wide, tall, (brush) => paintGround(brush, GROUND, groundArt()), sharp);
    const scale = full.sheet.width / full.w;
    const x0 = Math.max(0, cam.x - 2);
    const x1 = Math.min(full.w, cam.x + cam.w + 2);
    const from = Math.max(full.y, cam.y - 2);
    const to = Math.min(full.y + full.h, cam.y + cam.h + 2);
    pen.drawImage(full.sheet, x0 * scale, (from - full.y) * scale, (x1 - x0) * scale, (to - from) * scale, x0, from, x1 - x0, to - from);
  }

  /** A sprite standing with its feet at (x, y). Clutterkin are painted facing left; people facing right. */
  function stand(src, x, y, tall, faceRight, paintedRight, lift = 0, lean = 0) {
    const image = picture(src);
    // The shadow shrinks as whoever it is lifts off the ground, but is never less than nothing.
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

  function building(spot) {
    const place = roomOf(spot.id);
    const inside = !!DISTRICTS[spot.id]; // the garden's shed stands in the garden: it is scenery, not a door
    const open = !place || inside || game.roomOpen(place.id);
    const cleared = !!place && state.rooms[place.id].clears > 0;
    if (!place) glow(pen, spot.x, spot.y + 30, 104, '255,200,61', 0.3); // light spilling from the door of home
    put(bake(`${spot.id}|${open}|${cleared}`, spot.x - 180, spot.y - 350, 360, 404,
      (brush) => paintBuilding(brush, spot, { image: painting(`b_${spot.id}`), name: inside ? '' : place ? place.name : HOME.name, open, cleared: cleared && !inside })));
  }

  /** How big something that has just appeared is drawn: it pops up over a third of a second. */
  function pop(key, what) {
    const was = shown.get(key);
    if (!was || was.what !== what) shown.set(key, { what, since: was ? clock : -1 });
    const t = Math.min(1, (clock - shown.get(key).since) / 0.34);
    const u = t - 1;
    return t >= 1 ? 1 : Math.max(0.05, 1 + 2.7 * u * u * u + 1.7 * u * u); // out quickly, a touch past full size, and back
  }

  /** Whoever is at one post of a place: a rustle in a bush (or a rattle in a bin) until you call on the place, then the group itself. */
  function waiting(place, index) {
    const { room, area, dress } = place;
    const post = area.posts[index];
    const spot = room.path[index];
    const visit = state.visit && state.visit.room === room.id ? state.visit : null;
    const key = `${room.id}|${index}`;
    if (!visit) {
      // Not calling here, you only see that something is in there. Just cleared and still inside, nothing is.
      if (!state.visit && game.district() === room.id) { shown.set(key, { what: 'none', since: -1 }); return; }
      const big = spot.boss ? 1.5 : 1;
      const size = pop(key, 'bush');
      const sway = Math.sin(clock * 2.2 + index * 2) * 2.5;
      put(bake(`cover|${dress.cover}|${big}`, -90, -150, 180, 180, (brush) => paintProp(brush, painting(dress.cover), dress.coverWide * big)), post.x + sway, post.y, size);
      pen.font = `700 ${Math.round(34 * big * size)}px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      pen.fillStyle = spot.boss ? '#ff8a96' : '#fff7e8';
      pen.lineWidth = 6; pen.strokeStyle = 'rgba(13,10,28,.85)'; pen.lineJoin = 'round'; pen.strokeText('?', post.x + sway, post.y - 44 * big * size);
      pen.fillText('?', post.x + sway, post.y - 44 * big * size);
      return;
    }
    const group = visit.groups[index];
    if (group.done) { shown.set(key, { what: 'none', since: -1 }); return; }
    const size = pop(key, 'group');
    const foes = group.foes;
    const boss = foes.some((foe) => SPECIES[foe.species].boss);
    // Where there is no room either side of a boss, its company stands in front of it instead.
    const gap = boss ? (area.narrow ? 60 : 86) : foes.length > 2 ? 60 : 72;
    foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      const x = post.x + (i - (foes.length - 1) / 2) * gap * size;
      const y = post.y + (kind.boss ? -14 : boss ? (area.narrow ? 36 : 20) : 0);
      if (foe.heirloom) glow(pen, x, y - 22, 54, '255,200,61', 0.42 + 0.2 * Math.sin(clock * 5));
      stand(spriteSrc(foe.species, foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0) * size, (kind.boss ? 140 : 58) * size, false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7)) * 3 * size);
    });
    if (size < 1) return;
    const top = post.y - (boss ? 182 : 92);
    const others = room.path.length - 1 - visit.stop;
    label(pen, spot.name, post.x, top, spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.28)');
    // The boss will not be met until everyone else is calm, and says so.
    if (spot.boss && others > 0) label(pen, `calm the other ${others} first`, post.x, top + 38, '#b6b0d6', 'rgba(255,255,255,.14)', 19);
  }

  /** One of the people of the lane: turned toward you, their name over them when you are near, a mark if they have news. */
  function neighbour(person) {
    const cast = CAST[person.id];
    const image = picture(spriteSrc(cast.art));
    // People were painted to one scale, so a child stands shorter than the grown-ups.
    const tall = image.naturalHeight ? 96 * (image.naturalHeight / 300) : 96;
    const you = here();
    stand(spriteSrc(cast.art), person.x, person.y, tall, you.x >= person.x, true, 0, Math.sin(clock * 1.6 + person.x) * 0.012);
    const near = Math.hypot(you.x - person.x, you.y - person.y) < 230;
    if (game.hasNews(person.id)) {
      const bob = Math.sin(clock * 4) * 3;
      const top = person.y - tall - (near ? 52 : 22) + bob;
      pen.beginPath(); pen.arc(person.x, top, 15, 0, Math.PI * 2); paint(pen, '#ffc83d');
      pen.lineWidth = 3; pen.strokeStyle = 'rgba(13,10,28,.9)'; pen.stroke();
      pen.font = `700 22px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle'; pen.fillStyle = '#17132e';
      pen.fillText('!', person.x, top + 1);
    }
    if (near) label(pen, cast.name, person.x, person.y - tall - 20, '#fff7e8', 'rgba(255,255,255,.28)', 19);
  }

  /** Where the goal is, if it is somewhere: a person to see, or the gate of a place you are not yet in. */
  function goalPoint() {
    const goal = game.goal();
    if (goal.who) return personAt(goal.who);
    if (goal.room && DISTRICTS[goal.room] && game.district() !== goal.room) return DISTRICTS[goal.room].gate;
    return null;
  }

  /** A gold arrow at the edge of the view, toward the goal, whenever the goal is out of sight. */
  function pointer() {
    const to = goalPoint();
    if (!to) return;
    const { top, bottom } = over();
    const box = { x0: cam.x + 44, x1: cam.x + cam.w - 44, y0: cam.y + top + 70, y1: cam.y + cam.h - bottom - 60 };
    if (to.x > box.x0 && to.x < box.x1 && to.y > box.y0 && to.y < box.y1) return;
    // From the middle of the view toward the goal, stopped at the edge.
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const dx = to.x - cx;
    const dy = to.y - cy;
    const reach = Math.min(dx ? ((dx > 0 ? box.x1 : box.x0) - cx) / dx : Infinity, dy ? ((dy > 0 ? box.y1 : box.y0) - cy) / dy : Infinity);
    const beat = 1 + Math.sin(clock * 5) * 0.08;
    pen.save();
    pen.translate(cx + dx * reach, cy + dy * reach);
    pen.rotate(Math.atan2(dy, dx));
    pen.scale(beat, beat);
    pen.beginPath(); pen.moveTo(20, 0); pen.lineTo(-12, -16); pen.lineTo(-5, 0); pen.lineTo(-12, 16); pen.closePath();
    paint(pen, '#ffc83d'); pen.lineWidth = 4; pen.lineJoin = 'round'; pen.strokeStyle = 'rgba(13,10,28,.9)'; pen.stroke();
    pen.restore();
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
    for (const spot of SPOTS) if (seen(spot.x, spot.y)) things.push({ y: spot.y, draw: () => building(spot) });
    for (const t of TREES) if (seen(t.x, t.y)) things.push({ y: t.y, draw: () => put(bake(`tree|${t.r}`, -t.r * 1.9, -t.r * 3.8, t.r * 3.8, t.r * 3.8 + 24, (brush) => paintProp(brush, painting('p_tree'), t.r * 3.3)), t.x, t.y) });
    for (const lamp of LAMPS) if (seen(lamp.x, lamp.y)) things.push({ y: lamp.y, draw: () => put(bake('lamp', -60, -160, 120, 172, (brush) => paintLamp(brush, painting('p_lamp'))), lamp.x, lamp.y) });
    for (const piece of WALLS) if (seen(piece.x, piece.y, 120)) things.push({ y: piece.y, draw: () => put(bake(`wall|${piece.art}|${Math.round(piece.wide)}`, -70, -120, 140, 140, (brush) => paintProp(brush, painting(piece.art), piece.wide)), piece.x, piece.y) });
    for (const place of PLACES) {
      const { room, area, dress } = place;
      const cleared = state.rooms[room.id].clears > 0;
      const open = game.roomOpen(room.id);
      if (seen(area.gate.x, area.gate.y)) {
        things.push({ y: area.gate.y + 14, draw: () => {
          put(bake(`gate|${dress.gate}`, -100, -90, 200, 130, (brush) => paintGate(brush, dress.gate)), area.gate.x, area.gate.y + 16);
          if (open) { label(pen, `${cleared ? '✓ ' : ''}${room.name}`, area.gate.x, area.gate.y - 86, cleared ? '#58d77a' : '#fff7e8', cleared ? '#58d77a' : 'rgba(255,255,255,.3)'); return; }
          // Shut: whoever is in there has piled up everything they have in the gateway.
          put(bake('barricade', -100, -150, 200, 170, (brush) => paintProp(brush, painting('a_barricade'), 172)), area.gate.x, area.gate.y + 34);
          label(pen, room.name, area.gate.x, area.gate.y - 132, '#b6b0d6', 'rgba(255,255,255,.14)');
          label(pen, `calm ${ROOMS[ROOMS.indexOf(room) - 1].name} first`, area.gate.x, area.gate.y - 96, '#b6b0d6', 'rgba(255,255,255,.14)', 19);
        } });
      }
      area.posts.forEach((post, index) => { if (seen(post.x, post.y)) things.push({ y: post.y + 22, draw: () => waiting(place, index) }); });
    }
    for (const person of PEOPLE) {
      if (!seen(person.x, person.y)) continue;
      things.push({ y: person.y, draw: () => neighbour(person) });
    }
    for (const body of homebodies) {
      if (!seen(body.x, body.y)) continue;
      const fly = SPECIES[body.friend.species].fly;
      things.push({ y: body.y, draw: () => stand(spriteSrc(body.friend.species, body.friend.heirloom), body.x, body.y, 54, body.f > 0, false, fly ? 9 + Math.sin(clock * 3 + body.step) * 4 : Math.abs(Math.sin(body.step / 15)) * 5) });
    }
    const { x, y } = here();
    for (const pal of pals) {
      const fly = SPECIES[pal.friend.species].fly;
      const lift = fly ? 9 + Math.sin(clock * 3 + pal.step) * 4 : Math.abs(Math.sin(pal.step / 15)) * 5 * spring;
      things.push({ y: pal.y - 0.01, draw: () => stand(spriteSrc(pal.friend.species, pal.friend.heirloom), pal.x, pal.y, 54, pal.f > 0, false, lift) });
    }
    const hop = Math.abs(Math.sin(stride / 17)) * 7 * spring;
    const view = aspect === 'side' ? state.player.look : `${state.player.look}_${aspect}`;
    things.push({ y, draw: () => stand(spriteSrc(view), x, y, 96, aspect !== 'side' || facing > 0, true, hop, Math.sin(stride / 17) * 0.035 * spring) });
    things.sort((a, b) => a.y - b.y);
    for (const thing of things) thing.draw();
    for (const fly of FLIES) {
      if (!seen(fly.x, fly.y, 30)) continue;
      const bright = 0.2 + 0.6 * Math.abs(Math.sin(clock * (0.6 + fly.r) + fly.r * 40));
      const fx = fly.x + Math.sin(clock * 0.7 + fly.r * 9) * 14;
      const fy = fly.y + Math.cos(clock * 0.5 + fly.r * 7) * 12;
      pen.beginPath(); pen.arc(fx, fy, 6, 0, Math.PI * 2); paint(pen, `rgba(255,224,122,${bright * 0.22})`);
      pen.beginPath(); pen.arc(fx, fy, 2.4, 0, Math.PI * 2); paint(pen, `rgba(255,236,160,${bright})`);
    }
    if (!everything) pointer();
  }

  // ------------------------------------------------------------ the card for wherever you are

  const teamList = () => {
    const health = game.teamHealth();
    return h('div', { class: 'teamlist' }, game.team().map((friend, i) => h('div', { class: `teamcard${health[i].hp <= 0 ? ' down' : ''}` },
      sprite(friend.species, friend.heirloom, 'flip'),
      h('div', null, h('b', null, SPECIES[friend.species].name), bar(`hp${health[i].hp / health[i].max < 0.3 ? ' low' : ''}`, health[i].hp / health[i].max, `${health[i].hp} / ${health[i].max}`)))));
  };

  function drawCard() {
    const visit = state.visit;
    const who = game.personNear();
    const id = who ? null : game.near();
    const inside = game.district();
    const goal = game.goal();
    const key = `${who}:${who ? game.hasNews(who) : ''}|${id}|${visit ? `${visit.room}:${visit.stop}` : ''}|${inside}|${goal.id}:${goal.count || ''}`;
    if (key === cardFor) return;
    cardFor = key;
    goalText.textContent = goal.count ? `${goal.title} (${goal.count[0]} of ${goal.count[1]})` : goal.title;
    if (goalHeard !== null && goalHeard !== goal.id) play('goal');
    goalHeard = goal.id;
    goalChip.dataset.goal = goal.id;
    // The heading says where you are, and how a visit is going.
    title.textContent = inside ? roomOf(inside).name : LANE;
    sub.textContent = visit ? `${visit.stop} of ${roomOf(visit.room).path.length} calmed` : '';
    card.hidden = !who && !id && !visit;
    card.dataset.spot = id || '';
    card.dataset.person = who || '';
    card.dataset.visit = visit ? visit.room : '';
    card.dataset.calmed = visit ? String(visit.stop) : '';
    card.className = `placecard${!who && !id && visit ? ' slim' : ''}`;
    if (card.hidden) return;

    if (who) {
      const cast = CAST[who];
      const news = game.hasNews(who);
      card.replaceChildren(
        h('div', { class: 'personhead' }, sprite(cast.art), h('div', null, h('h2', null, cast.name), h('small', null, cast.role))),
        h('button', { class: `btn ${news ? 'gold' : 'plain'}`, data: { act: 'talk' }, onclick: () => {
          const lines = game.talkTo(who);
          if (!lines) return;
          ctx.save();
          converse(lines, () => { cardFor = undefined; });
        } }, 'Talk'));
      return;
    }

    if (id === 'home') {
      if (visit) {
        card.replaceChildren(h('h2', null, HOME.name), h('small', null, 'Rest here and everyone gets their breath back. Whoever you calmed out there will be restless again by the time you go back.'), teamList(),
          h('button', { class: 'btn gold', data: { act: 'rest' }, onclick: () => { if (game.rest()) { ctx.save(); play('rest'); toast('Everyone is rested.', { kind: 'good' }); cardFor = undefined; } } }, 'Rest'));
        return;
      }
      card.replaceChildren(h('h2', null, HOME.name), h('small', null, HOME.blurb, ' Friends who are not walking with you potter about on the green.'),
        h('button', { class: 'btn plain', data: { act: 'friends' }, onclick: () => ctx.show('friends') }, 'Choose your team'));
      return;
    }
    const place = id ? roomOf(id) : null;
    if (place) {
      const record = state.rooms[place.id];
      const built = roomBuilt(place);
      const before = ROOMS[ROOMS.indexOf(place) - 1];
      const bossId = built ? place.path[place.path.length - 1].boss : null;
      card.replaceChildren(
        h('h2', null, place.name, ' ', elementTag(place.element)),
        h('small', null, place.blurb, ' ', built
          ? `${place.path.length} groups to calm, the last a boss${bossId && state.book[bossId].met ? ` (${SPECIES[bossId].name})` : ''}. Mostly ${ELEMENTS[place.element].name}.${record.visits ? ` Most calmed in one go: ${record.best} of ${place.path.length}.` : ''}${record.clears ? ' Calm now: Heirlooms come out more often here.' : ''}`
          : `Not built yet: this slice ends at ${LAST_BUILT.name}.`),
        built && game.roomOpen(place.id)
          ? h('p', { class: 'cardnote', data: { act: 'enter' } }, !visit ? 'The gate is open. Walk on in.'
            : visit.room === place.id ? 'Rest at home whenever you need to: it is not far.'
              : `You are still out calling on ${roomOf(visit.room).name}. Rest at home first: nobody here will come out to you until you have.`)
          : h('button', { class: 'btn gold', disabled: true, data: { act: 'enter' } }, built ? `Clear ${before.name} first` : 'Not built yet'));
      return;
    }
    // Out on a visit and not at a door: how everyone is, and how far you have got.
    const room = roomOf(visit.room);
    card.replaceChildren(
      h('div', { class: 'cardhead' }, h('h2', null, room.name, ' ', h('small', null, `${visit.stop} of ${room.path.length} calmed`)), h('small', { class: 'resthint' }, inside && inside !== visit.room ? 'Rest at home before calling here' : 'Rest at home')),
      teamList());
  }

  /** The story so far, the aim of it all, and what to do next. */
  function journal() {
    const goal = game.goal();
    const aim = game.aim();
    const told = game.journal();
    modal({
      title: 'What to do', cls: 'journal',
      body: [
        h('div', { class: 'aim' }, h('b', null, aim.title), bar('xp', aim.count[0] / aim.count[1], `${aim.count[0]} of ${aim.count[1]} calm`)),
        h('div', { class: 'now' }, h('small', null, 'Now'), h('b', null, goal.count ? `${goal.title} (${goal.count[0]} of ${goal.count[1]})` : goal.title), h('p', null, goal.detail)),
        told.length ? h('div', { class: 'sofar' }, h('small', null, 'So far'), h('ul', null, told.map((line) => h('li', null, line)))) : null,
      ],
      actions: [{ id: 'ok', label: 'OK', kind: 'plain' }],
    });
  }

  // ------------------------------------------------------------ walking

  function aim(event) {
    stirred = true;
    const to = toWorld(event.clientX, event.clientY);
    if (passedOver >= 0 && state.visit) {
      const post = DISTRICTS[state.visit.room].posts[passedOver];
      if (Math.hypot(to.x - post.x, to.y - post.y) <= POST.meet) passedOver = -1; // a tap on them is choosing to meet them
    }
    way = game.routeTo(to);
    // A tap on a barricade, or past it into the place it shuts, gets the sound of something that will not budge.
    if (PLACES.some(({ room, area }) => !game.roomOpen(room.id) && (districtAt(to) === room.id || Math.hypot(to.x - area.gate.x, to.y - area.gate.y) <= 90))) play('nope');
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

  /** Friends on the green amble to a spot, stand a while, and pick another. */
  function potter(dt) {
    for (const body of homebodies) {
      if (body.wait > 0) { body.wait -= dt; continue; }
      const dx = body.to.x - body.x;
      const dy = body.to.y - body.y;
      const far = Math.hypot(dx, dy);
      if (far < 3) { body.to = body.spot(); body.wait = 1.5 + body.next() * 4; continue; }
      const step = Math.min(far, 46 * dt);
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
    const visiting = !!state.visit;
    if (held.size) {
      let dx = 0; let dy = 0;
      for (const key of held) { dx += KEYS[key][0]; dy += KEYS[key][1]; }
      if (dx || dy) way = [{ x: before.x + dx * 60, y: before.y + dy * 60 }];
    }
    // Head for each point of the way in turn.
    while (way.length && Math.hypot(way[0].x - before.x, way[0].y - before.y) < WORLD.arrive) way.shift();
    if (modalOpen()) { way = []; held.clear(); }
    // The call that starts the story rings as soon as the game has begun and nothing else is on the
    // screen (and once, for a save from before there was a story).
    else if (!state.story.call) {
      const call = game.takeCall();
      if (call) { ctx.save(); play('ring'); converse(call, () => { cardFor = undefined; }); }
    }
    const moving = !met && way.length > 0 && game.walk(way[0], dt);
    const now = here();
    if (moving) {
      const dx = now.x - before.x;
      const dy = now.y - before.y;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      // Turn to face the way you are going. Walking on a slant keeps whichever way you were already turned.
      if (Math.abs(dy) > Math.abs(dx) * 1.3) aspect = dy > 0 ? 'front' : 'back';
      else if (Math.abs(dx) > Math.abs(dy) * 1.3) aspect = 'side';
      stride += Math.hypot(dx, now.y - before.y);
      if (stride - footfall >= FOOTFALL) { footfall = stride; play('step', { hard: PAVED.has(game.district()) }); }
      if (Math.hypot(now.x - trail[0].x, now.y - trail[0].y) > 5) { trail.unshift({ x: now.x, y: now.y }); if (trail.length > 60) trail.length = 60; }
    } else if (way.length) way.shift();
    // Stepping through a gate begins a visit: worth keeping straight away.
    if (!visiting && state.visit) {
      ctx.save();
      play('gate');
      // If one of them is an Heirloom, you hear it glint, and are told, before you have picked it out.
      if (state.visit.groups.some((group) => group.foes.some((foe) => foe.heirloom))) {
        setTimeout(() => play('heirloom'), 550);
        toast('Something in here is glinting gold.', { kind: 'gold' });
      }
    }
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
    potter(dt);
    if (mark) mark.life -= dt * 1.6;
    look(dt);
    drawCard();
    draw();
    drawn++;
    // Walk into whoever is waiting and the fight is on. Only once you have moved: after a reload you
    // may be standing right in front of them, and should get to choose whether to walk in or walk off.
    const beside = game.meeting();
    if (beside !== passedOver) passedOver = -1;
    const group = !met && stirred && passedOver < 0 ? beside : -1;
    if (group >= 0) {
      met = true;
      way = [];
      play('meet');
      wrap.classList.add('meeting');
      setTimeout(() => { if (game.startEncounter(group)) ctx.show('fight'); }, ctx.fast ? 60 : 460);
    }
    raf = requestAnimationFrame(frame);
  }

  // Everything in the world is painted before the first frame is shown, by drawing the whole of it
  // once. Otherwise the first sight of each building would cost a frame mid-walk.
  function warm() {
    everything = true;
    draw();
    everything = false;
    cam.set = false;
    look(0);
  }

  const api = {
    /** Where something in the world is on the screen right now (for tests, which tap it like a finger would). */
    screenOf(id) {
      // A place's door or gate by its id; 'next' is the group to meet next, 'post:2' a group by number;
      // 'in:garden' is a few steps inside a place's gate; 'person:ines' is a neighbour; 'me' is you.
      const visit = state.visit;
      const area = (room) => DISTRICTS[room];
      let point;
      if (id === 'next') point = visit ? area(visit.room).posts[game.nextGroup()] : null;
      else if (id.startsWith('post:')) point = visit ? area(visit.room).posts[Number(id.slice(5))] : null;
      else if (id.startsWith('in:')) point = { x: area(id.slice(3)).gate.x, y: area(id.slice(3)).gate.y - 96 };
      else if (id.startsWith('person:')) point = personAt(id.slice(7));
      else if (id === 'me') point = here();
      else point = spotOf(id).door;
      if (!point) return null;
      const box = canvas.getBoundingClientRect();
      return { x: box.left + (point.x - cam.x) * cam.k, y: box.top + (point.y - cam.y) * cam.k };
    },
    /** Which way you are turned: 'front', 'back', or 'left' / 'right'. */
    facing: () => (aspect === 'side' ? (facing > 0 ? 'right' : 'left') : aspect),
    /** The part of the world in view, in the world's own units. */
    view: () => ({ x: cam.x, y: cam.y, w: cam.w, h: cam.h }),
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
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      ctx.save();
    },
  };
}
