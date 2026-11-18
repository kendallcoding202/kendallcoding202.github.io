// The world you walk in: one open neighbourhood, with the view following you
// across it. The rules for where feet can go are in core/world.js; what things
// look like is in scenery.js; this keeps the view on you, takes your taps,
// and puts it all on screen every frame.
//
// The ground and everything standing on it is painted once and kept (see
// `bake`), then placed each frame, so a frame costs a handful of pictures
// however detailed the painting was.
import { ROOMS, SPECIES, ELEMENTS, STRAYS, roomOf, roomBuilt } from '../core/balance.js';
import { WORLD, POST, SPOTS, TREES, LAMPS, HEDGES, ROAD_POINTS, GREEN, DISTRICTS, PEOPLE, PROPS, BENCHES, MAILBOXES, RIVER, BRIDGE, FLUFF_BESIDE, spotOf, personAt, districtAt, regionAt, whereabouts } from '../core/world.js';
import { CAST, FLUFF } from '../core/story.js';
import { nameOf, artOf } from '../core/names.js';
import { h, sprite, spriteSrc } from './dom.js';
import { howItGoes } from './text.js';
import { elementTag, bar } from './parts.js';
import { modal, toast, modalOpen } from './modals.js';
import { converse } from './talk.js';
import { meetTheThree } from './three.js';
import { mapDialog } from './map.js';
import { keyRing } from './keys.js';
import { play } from '../platform/sound.js';
import { dustShift, throughDoor } from './shift.js';
import { insideOf } from '../core/indoors.js';
import { FONT, PROP_WIDE, GATE_WIDE, oval, paint, glow, label, elementMark, hoverOn, hoverLift, walkTall, worldSrc, paintGround, paintBuilding, paintProp, paintFlat, paintLamp, paintGate, paintBridgeGate, ripples, wallOf } from './scenery.js';

// How much of the world fits across the screen. People and Clutterkin are small in a big place.
// On a wider screen (a folding phone, open) you see more of the world, not the same view blown up:
// past ZOOM_MOST screen points to a unit, extra width goes to showing more.
const VIEW = 760;
const ZOOM_MOST = 0.66;
const MOST_DOTS = 2.4e6; // the most pixels the world is ever drawn with: about what a large iPhone has
const HOME = { name: 'Home', blurb: 'Great-aunt Maribel\'s house, where you are staying.' };
// A tap on a building's front door (this far either side of its middle, this far up its wall) is asking
// to go in. A tap on the ground in front of it is only asking to stand there.
const DOORWAY = { wide: 50, up: 120, down: 4 };
const GAP = 60; // how far apart the team walks behind you: a little more than any of them is tall
const HEAD = 62; // how far down the screen the heading reaches at the very least, in screen points
const HEADROOM = 52; // how far above the top edge of the world whoever stands right against it reaches, in the world's units

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
const FLIES = (() => { const next = run(29); return Array.from({ length: Math.round((WORLD.w * WORLD.h) / 42000) }, () => ({ x: next() * WORLD.w, y: next() * WORLD.h, r: next() })); })();
// Lily pads on the river, clear of the bridge: [x, y, how wide]. Looks only.
const LILIES = [[240, 5522, 120], [540, 5572, 96], [800, 5500, 110], [1500, 5566, 118], [1830, 5506, 100], [2090, 5578, 112]];
// The ground is painted a square at a time, as each first comes into view, and only so many are
// kept: the world is far too big to hold as one picture. GROUND_TOP is how far above the top of
// the world the ground goes on (the view can travel a little past every edge).
const CHUNK = 760;
const GROUND_TOP = -640;
const CHUNKS_KEPT = 14;
const WALLS = [
  ...HEDGES,
  ...PLACES.filter(({ area, dress }) => dress.floor === 'cobbles' && area.x + area.w >= WORLD.w).map(({ area }) => ({ x: WORLD.w - 34, y: area.y, w: 44, h: area.h, look: 'junk' })),
].flatMap(wallOf);
const GROUND = {
  w: WORLD.w, h: WORLD.h, roads: ROAD_POINTS, spots: SPOTS.filter((spot) => !DISTRICTS[spot.id]), lamps: LAMPS, hedges: HEDGES, green: GREEN,
  river: RIVER, bridge: BRIDGE,
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
  // The map, one tap away: beside the goal, always in sight.
  const mapChip = h('button', { class: 'mapchip', data: { act: 'map' }, 'aria-label': 'Open the map', onclick: () => mapDialog(game) }, h('i'), 'Map');
  const title = h('h1', null, whereabouts(state.where));
  const sub = h('small', { class: 'where' });
  const wrap = h('div', { class: 'lanewrap' }, canvas,
    h('header', { class: 'bar-top over' }, h('div', null, title, sub), h('span', { class: 'who' }, sprite(state.player.look), h('b', null, state.player.name))),
    goalChip, mapChip, hint, card);
  const el = h('section', { id: 'lane' }, wrap);
  const pen = canvas.getContext('2d');

  let way = []; // the points still to walk through to get where you tapped
  let wantIn = null; // the building whose door you tapped: you go in when you get there
  let going = false; // you are going in through a door
  let met = false; // a fight is about to start
  let stirred = false; // you have touched the screen since it appeared
  // Whoever you were already standing beside when the screen appeared (after a reload, say). They are
  // not met just because you move: only if you tap them, or walk off and come back.
  let passedOver = game.meeting();
  let passedStray = game.strayNear(); // and the same for a stray you were standing beside
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
  let ahead = null; // which way you are walking, for painting the ground just ahead ({ x, y } each -1, 0 or 1)
  const cam = { x: 0, y: 0, k: 1, w: VIEW, h: VIEW, dpr: 1, top: HEAD, set: false };
  // Where you have just been, newest first, for the friends walking behind you.
  const start = here();
  const trail = Array.from({ length: 12 }, (_, i) => ({ x: start.x - i * 16, y: start.y + i * 2.5 }));
  const pals = game.team().map((friend, i) => ({ friend, x: start.x - (i + 1) * GAP, y: start.y + (i + 1) * 7, f: 1, step: i * 9, hover: i * 1.7 }));
  // Friends who stayed home potter about on the green. Looks only: you walk straight through them.
  const homebodies = state.friends.filter((friend) => !state.team.includes(friend.id)).slice(0, 9).map((friend, i) => {
    // Each has its own run of numbers, well stirred before it is used: small seeds start small.
    const next = run((friend.id * 48271 + 11) % 2147483646 + 1);
    for (let k = 0; k < 4; k++) next();
    const spot = () => ({ x: GREEN.x + 50 + next() * (GREEN.w - 100), y: GREEN.y + 30 + next() * (GREEN.h - 60) });
    return { friend, ...spot(), to: spot(), spot, wait: next() * 3 + i * 0.4, f: 1, step: 0, hover: i * 2.1, next };
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
    // How far down the screen the heading and the goal reach. They sit below a phone's status bar
    // (its clock, its camera), so this differs from phone to phone: measured, not assumed. The top of
    // the world must be able to come out from under all of it.
    const chip = goalChip.getBoundingClientRect();
    cam.top = chip.height ? Math.max(HEAD, chip.bottom - box.top + 12) : HEAD;
    // At a new size everything is painted afresh; at the same size what was painted before still serves.
    const size = `${canvas.width}x${canvas.height}@${dpr}`;
    if (painted.size !== size) { painted.size = size; kept.clear(); }
  }

  // How far past the top and bottom of the world the view may travel, so they can scroll out from
  // under the title and the card. With no card up, the bottom has nothing to get out from under.
  const over = () => ({ top: cam.top / cam.k, bottom: 168 / cam.k });
  const pastFoot = () => (card.hidden ? 44 : 168) / cam.k;
  const within = (lo, hi, v) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

  function look(dt) {
    const { top, bottom } = over();
    const at = here();
    const wantX = within(0, WORLD.w + EAST - cam.w, at.x - cam.w / 2);
    const wantY = within(-top - HEADROOM, WORLD.h - cam.h + pastFoot(), at.y - top - (cam.h - top - bottom) * 0.56);
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

  /** One square of the ground, painted the first time it is wanted and kept a while. */
  function chunk(col, row) {
    const key = `ground|${col}|${row}`;
    // A little soft rather than past what a phone will hold: never more than 1.3 dots to a unit.
    const sharp = Math.min(1, 1.3 / (cam.k * cam.dpr));
    if (kept.has(key)) { const piece = kept.get(key); kept.delete(key); kept.set(key, piece); return piece; } // (used last, so thrown out last)
    const piece = bake(key, col * CHUNK, GROUND_TOP + row * CHUNK, CHUNK, CHUNK, (brush) => paintGround(brush, GROUND, groundArt()), sharp);
    const squares = [...kept.keys()].filter((name) => name.startsWith('ground|'));
    for (const old of squares.slice(0, Math.max(0, squares.length - CHUNKS_KEPT))) kept.delete(old);
    return piece;
  }
  const across = Math.ceil((WORLD.w + EAST) / CHUNK);
  const down = Math.ceil((WORLD.h + 700 - GROUND_TOP) / CHUNK);

  function ground() {
    // Only the squares in view are put on the screen (and so only they are ever painted).
    const c0 = Math.max(0, Math.floor((cam.x - 2) / CHUNK));
    const c1 = Math.min(across - 1, Math.floor((cam.x + cam.w + 2) / CHUNK));
    const r0 = Math.max(0, Math.floor((cam.y - 2 - GROUND_TOP) / CHUNK));
    const r1 = Math.min(down - 1, Math.floor((cam.y + cam.h + 2 - GROUND_TOP) / CHUNK));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) { const p = chunk(col, row); pen.drawImage(p.sheet, p.x, p.y, p.w + 0.5, p.h + 0.5); }
    // And one square just out of view, the way you are heading, is painted ahead of time: a frame
    // spent on it now is a frame not dropped as you walk into it.
    if (ahead && !everything) {
      const col = Math.floor((cam.x + cam.w / 2 + ahead.x * (cam.w / 2 + CHUNK * 0.6)) / CHUNK);
      const row = Math.floor((cam.y + cam.h / 2 + ahead.y * (cam.h / 2 + CHUNK * 0.6) - GROUND_TOP) / CHUNK);
      if (col >= 0 && col < across && row >= 0 && row < down && !kept.has(`ground|${col}|${row}`)) chunk(col, row);
      ahead = null;
    }
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
      // Not calling here, you only see that something is in there. Just cleared and still inside, nothing is;
      // and a place that is calm has nobody keeping to cover at all (whoever wanders there is seen when you walk in).
      if (game.staysCalm(room.id, index) || (!state.visit && game.district() === room.id)) { shown.set(key, { what: 'none', since: -1 }); return; }
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
      stand(spriteSrc(artOf(foe), foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0) * size, (kind.boss ? 140 : foe.grown ? 74 : 58) * size, false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7)) * 3 * size);
      if (size >= 1) elementMark(pen, ELEMENTS[kind.element].name, ELEMENTS[kind.element].color, x, y + 16, kind.boss ? 18 : foes.length > 2 ? 14 : 16);
    });
    if (size < 1) return;
    const top = post.y - (boss ? 182 : 92);
    const others = room.path.length - 1 - visit.stop;
    // (Whoever is only wandering about says so: they are there if you want them, not in your way.)
    if (visit.stroll || group.wander) label(pen, 'wandering', post.x, top, '#cdeed6', 'rgba(205,238,214,.3)', 21);
    else label(pen, spot.name, post.x, top, spot.boss ? '#ffd9de' : '#fff7e8', spot.boss ? '#ff5a6a' : 'rgba(255,255,255,.28)');
    // The boss will not be met until everyone else is calm, and says so.
    if (spot.boss && others > 0) label(pen, `calm the other ${others} first`, post.x, top + 38, '#b6b0d6', 'rgba(255,255,255,.14)', 19);
  }

  /**
   * Strays: lost Clutterkin out on the lane, pottering about a spot of their own. They face you as
   * you come near, and are named for what they are, so nobody takes them for someone in the way.
   */
  function strays(stray) {
    const you = here();
    const near = Math.hypot(you.x - stray.x, you.y - stray.y) < 260;
    const size = pop(`stray|${stray.index}`, 'stray');
    if (stray.keep) { keepsake(stray, near, you, size); return; }
    stray.foes.forEach((foe, i) => {
      const kind = SPECIES[foe.species];
      // Each ambles a little way about where it stands, in its own time.
      const drift = Math.sin(clock * 0.55 + stray.index * 2.1 + i * 3.3) * 15;
      const x = stray.x + (i - (stray.foes.length - 1) / 2) * 62 * size + drift;
      const y = stray.y + Math.cos(clock * 0.4 + stray.index + i * 1.7) * 6;
      if (foe.heirloom) glow(pen, x, y - 22, 54, '255,200,61', 0.42 + 0.2 * Math.sin(clock * 5));
      const turned = near ? you.x > x : Math.cos(clock * 0.55 + stray.index * 2.1 + i * 3.3) > 0;
      stand(spriteSrc(artOf(foe), foe.heirloom), x, y - (kind.fly ? 9 + Math.sin(clock * 3 + i) * 4 : 0) * size, (foe.grown ? 74 : 58) * size, turned, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 3.2 + i * 1.7 + stray.index)) * 3 * size);
      if (near && size >= 1) elementMark(pen, ELEMENTS[kind.element].name, ELEMENTS[kind.element].color, stray.x + (i - (stray.foes.length - 1) / 2) * 62, stray.y + 16, stray.foes.length > 2 ? 14 : 16);
    });
    if (near && size >= 1) label(pen, ['a stray', 'two strays', 'three strays'][stray.foes.length - 1] || 'strays', stray.x, stray.y - 92, '#cdeed6', 'rgba(205,238,214,.3)', 21);
  }

  /**
   * A Keepsake at its haunt: it stays where it is, in a soft light of its own (gold, if it is out in its
   * rare colours), with Fluff sitting beside it, looking from it to you. Its name is over it once you
   * have met it; until then, only that somebody is there.
   */
  function keepsake(stray, near, you, size) {
    const foe = stray.foes[0];
    const kind = SPECIES[foe.species];
    const { x, y } = stray;
    glow(pen, x, y - 26, 96, foe.heirloom ? '255,200,61' : '190,225,255', 0.3 + 0.12 * Math.sin(clock * 1.7));
    // A few notes of whatever it is playing, drifting up.
    for (let i = 0; i < 3; i++) {
      const t = (clock * 0.22 + i / 3) % 1;
      pen.globalAlpha = Math.sin(t * Math.PI) * 0.7;
      pen.fillStyle = foe.heirloom ? '#ffe9a8' : '#dff1ff'; pen.font = `700 ${17 * size}px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      pen.fillText(['♪', '♫', '✦'][i], x + 30 + Math.sin(clock * 1.3 + i * 2.1) * 14 + i * 9, y - 62 - t * 54);
    }
    pen.globalAlpha = 1;
    stand(spriteSrc(FLUFF.art), x + FLUFF_BESIDE.x, y + FLUFF_BESIDE.y, 44 * size, near ? you.x > x + FLUFF_BESIDE.x : true, false, Math.max(0, Math.sin(clock * 2.6)) * 4 * size);
    stand(spriteSrc(artOf(foe), foe.heirloom), x, y - (kind.fly ? 10 + Math.sin(clock * 1.6) * 4 : 0) * size, 80 * size, near ? you.x > x : false, false, 0);
    if (!near || size < 1) return;
    elementMark(pen, ELEMENTS[kind.element].name, ELEMENTS[kind.element].color, x, y + 16, 16);
    label(pen, state.book[foe.species].met ? kind.name : 'somebody new', x, y - 124, foe.heirloom ? '#ffe9a8' : '#dff1ff', 'rgba(223,241,255,.3)', 21);
    label(pen, FLUFF.name, x + FLUFF_BESIDE.x - 10, y - 46, '#e9e4f7', 'rgba(255,255,255,.2)', 17);
  }

  /** One of the people of the lane: turned toward you, their name over them when you are near, a mark if they have news. */
  function neighbour(person, news = game.hasNews(person.id)) {
    const cast = CAST[person.id];
    const image = picture(spriteSrc(cast.art));
    // People were painted to one scale, so a child stands shorter than the grown-ups.
    const tall = image.naturalHeight ? 96 * (image.naturalHeight / 300) : 96;
    const you = here();
    stand(spriteSrc(cast.art), person.x, person.y, tall, you.x >= person.x, true, 0, Math.sin(clock * 1.6 + person.x) * 0.012);
    const near = Math.hypot(you.x - person.x, you.y - person.y) < 230;
    if (news) newsMark(person.x, person.y - tall - (near ? 52 : 22));
    if (near) label(pen, cast.name, person.x, person.y - tall - 20, '#fff7e8', 'rgba(255,255,255,.28)', 19);
  }

  /** The gold mark over somebody who has something for you: news, or a bout. */
  function newsMark(x, y) {
    const top = y + Math.sin(clock * 4) * 3;
    pen.beginPath(); pen.arc(x, top, 15, 0, Math.PI * 2); paint(pen, '#ffc83d');
    pen.lineWidth = 3; pen.strokeStyle = 'rgba(13,10,28,.9)'; pen.stroke();
    pen.font = `700 22px ${FONT}`; pen.textAlign = 'center'; pen.textBaseline = 'middle'; pen.fillStyle = '#17132e';
    pen.fillText('!', x, top + 1);
  }

  /**
   * A ringleader taking the air outside its own place, calm now. It turns to look at you as you come
   * near, and its name is over it then. Once its wish is granted it stands in a gold light, with the mark over it.
   */
  function chiefOut(one) {
    const kind = SPECIES[one.id];
    const you = here();
    const near = Math.hypot(you.x - one.x, you.y - one.y) < 250;
    const tall = 116;
    const ready = one.due >= 0;
    if (ready) glow(pen, one.x, one.y - 50, 118, '255,200,61', 0.26 + 0.1 * Math.sin(clock * 2.2));
    stand(spriteSrc(one.id), one.x, one.y - (kind.fly ? 8 + Math.sin(clock * 1.6) * 4 : 0), tall, near ? you.x > one.x : false, false, kind.fly ? 0 : Math.max(0, Math.sin(clock * 1.5 + one.x)) * 2.5);
    if (ready) newsMark(one.x, one.y - tall - (near ? 60 : 26));
    if (!near) return;
    elementMark(pen, ELEMENTS[kind.element].name, ELEMENTS[kind.element].color, one.x, one.y + 18, 17);
    label(pen, kind.name, one.x, one.y - tall - 24, ready ? '#ffe9a8' : '#fff7e8', ready ? 'rgba(255,200,61,.5)' : 'rgba(255,255,255,.28)', 20);
  }

  /** Where the goal is, if it is somewhere: a person to see, or the gate of a place you are not yet in. */
  function goalPoint() {
    const goal = game.goal();
    // News for Ines Tock can be told to her, or posted: whichever of her and the mailboxes is nearer.
    if (goal.id === 'report') { const you = here(); return [personAt(goal.who), ...MAILBOXES].reduce((a, b) => (Math.hypot(a.x - you.x, a.y - you.y) <= Math.hypot(b.x - you.x, b.y - you.y) ? a : b)); }
    if (goal.who) return personAt(goal.who);
    if (goal.room && DISTRICTS[goal.room] && game.district() !== goal.room) return DISTRICTS[goal.room].gate;
    if (goal.room && insideOf(goal.room)) return spotOf(goal.room).door; // a place you walk into by its door
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
    if (cam.y + cam.h > RIVER.y - 20 && cam.y < RIVER.y + RIVER.h + 20) ripples(pen, RIVER, clock, cam.x, cam.x + cam.w, BRIDGE);
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
    for (const stray of game.strays()) if (seen(stray.x, stray.y)) things.push({ y: stray.y + 8, draw: () => strays(stray) });
    // Whoever is waiting by the road (Tansy Brisk, when she is about): drawn as a neighbour is, with the mark over her while she wants a bout.
    // And the ringleader of any place that is calm, taking the air outside it.
    for (const one of game.waiting()) if (seen(one.x, one.y, 200)) things.push({ y: one.y, draw: () => (one.chief ? chiefOut(one) : neighbour(one, one.due >= 0)) });
    // The gate on the bridge: shut, with its eight locks, until the whole lane is calm; then only its posts.
    if (seen(BRIDGE.gate.x, BRIDGE.gate.y, 260)) {
      const open = game.bridgeOpen();
      things.push({ y: BRIDGE.gate.y + (open ? -40 : 30), draw: () => {
        put(bake(`bridgegate|${open}`, -GATE_WIDE * 0.6, -GATE_WIDE, GATE_WIDE * 1.2, GATE_WIDE + 24, (brush) => paintBridgeGate(brush, painting('r_gate'), GATE_WIDE, open)), BRIDGE.gate.x, BRIDGE.gate.y + 24);
        if (open) return;
        const you = here();
        if (Math.hypot(you.x - BRIDGE.gate.x, you.y - BRIDGE.gate.y) < 330) {
          const keys = ROOMS.filter((room) => room.chapter !== 2 && state.rooms[room.id].clears > 0).length;
          label(pen, 'Kettle Bridge', BRIDGE.gate.x, BRIDGE.gate.y - 196, '#b6b0d6', 'rgba(255,255,255,.14)');
          label(pen, `eight locks: you hold ${keys} of the keys`, BRIDGE.gate.x, BRIDGE.gate.y - 160, '#b6b0d6', 'rgba(255,255,255,.14)', 19);
        }
      } });
    }
    // Lily pads on the river: they lie flat, behind everything.
    for (const [lx, ly, wide] of LILIES) {
      if (!seen(lx, ly, 120)) continue;
      things.push({ y: RIVER.y - 400, draw: () => put(bake(`lilies|${wide}`, -wide * 0.6, -wide * 0.5, wide * 1.2, wide, (brush) => paintFlat(brush, painting('r_lilies'), wide)), lx, ly) });
    }
    // Whatever stands about the country: a bench, a signpost, a well. A pond lies flat, behind whatever stands by it.
    for (const prop of PROPS) {
      if (!seen(prop.x, prop.y)) continue;
      const flat = prop.kind === 'pond';
      things.push({ y: flat ? prop.y - 60 : prop.y, draw: () => {
        const wide = PROP_WIDE[prop.kind];
        put(bake(`prop|${prop.kind}`, -wide * 0.6, flat ? -wide * 0.5 : -wide * 1.6, wide * 1.2, flat ? wide : wide * 1.7 + 16,
          (brush) => (flat ? paintFlat(brush, painting(`r_${prop.kind}`), wide) : paintProp(brush, painting(`r_${prop.kind}`), wide))), prop.x, prop.y);
        const you = here();
        if (prop.says && Math.hypot(you.x - prop.x, you.y - prop.y) < 210) label(pen, prop.says, Math.max(cam.x + 150, Math.min(cam.x + cam.w - 150, prop.x)), prop.y - 124, '#fff7e8', 'rgba(255,255,255,.28)', 18);
      } });
    }
    for (const body of homebodies) {
      if (!seen(body.x, body.y)) continue;
      const fly = SPECIES[body.friend.species].fly;
      things.push({ y: body.y, draw: () => stand(spriteSrc(artOf(body.friend), body.friend.heirloom), body.x, body.y, walkTall(body.friend, SPECIES[body.friend.species].boss), body.f > 0, false, fly ? hoverLift(body.hover) : Math.abs(Math.sin(body.step / 15)) * 5) });
    }
    const { x, y } = here();
    for (const pal of pals) {
      const fly = SPECIES[pal.friend.species].fly;
      const lift = fly ? hoverLift(pal.hover) : Math.abs(Math.sin(pal.step / 15)) * 5 * spring;
      things.push({ y: pal.y - 0.01, draw: () => stand(spriteSrc(artOf(pal.friend), pal.friend.heirloom), pal.x, pal.y, walkTall(pal.friend, SPECIES[pal.friend.species].boss), pal.f > 0, false, lift) });
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
      sprite(artOf(friend), friend.heirloom, 'flip'),
      h('div', null, h('b', null, nameOf(friend)), bar(`hp${health[i].hp / health[i].max < 0.3 ? ' low' : ''}`, health[i].hp / health[i].max, `${health[i].hp} / ${health[i].max}`)))));
  };

  /** In through the door you are standing at: the screen dips to dark, and you are indoors. */
  function goIn(id) {
    if (going || met || game.mayEnter(id) !== true) return false;
    going = true;
    way = [];
    play('door');
    throughDoor(() => { game.enter(id); ctx.save(); ctx.show('lane'); }, ctx.fast);
    return true;
  }

  function drawCard() {
    const visit = state.visit;
    const who = game.personNear();
    // Somebody waiting by the road, and whether what they want is a bout.
    const caller = who ? null : game.waitingNear();
    const bout = caller ? game.boutDue(caller) : false;
    const id = who || caller ? null : game.near();
    const inside = game.district();
    const goal = game.goal();
    const bench = who || caller || id ? null : game.benchNear();
    // (A mailbox is worth a card only when there is something to post: by a door, the door's card comes first.)
    const mail = !who && !caller && !bench && game.mailNear() >= 0 && (!id || goal.id === 'report') && state.story.ines > 0;
    const region = regionAt(here());
    const wish = caller ? game.wish(caller) : null; // (a ringleader's: null for anybody else)
    const key = `${who}:${who ? game.hasNews(who) : ''}|${caller}:${bout}:${wish ? wish.have : ''}|${id}|${visit ? `${visit.room}:${visit.stop}` : ''}|${inside}|${goal.id}:${goal.count || ''}|${game.rested()}|${bench}|${whereabouts(here())}|${mail}`;
    if (key === cardFor) return;
    cardFor = key;
    goalText.textContent = goal.count ? `${goal.title} (${goal.count[0]} of ${goal.count[1]})` : goal.title;
    if (goalHeard !== null && goalHeard !== goal.id) play('goal');
    goalHeard = goal.id;
    goalChip.dataset.goal = goal.id;
    // The heading says where you are, and how a visit is going.
    title.textContent = inside ? roomOf(inside).name : whereabouts(here());
    sub.textContent = visit ? howItGoes(visit, roomOf(visit.room)) : '';
    card.hidden = !who && !caller && !id && !visit && !bench && !mail;
    card.dataset.spot = mail ? 'mailbox' : id || (bench ? 'bench' : '');
    card.dataset.person = who || caller || '';
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

    // A ringleader, taking the air outside its place: what is seen of it, its wish and how far along that is;
    // and once the wish is granted, the bout it would like.
    if (caller && wish) {
      const kind = SPECIES[caller];
      const place = roomOf(game.waiting().find((one) => one.id === caller).room);
      card.className = 'placecard';
      card.replaceChildren(...[
        h('div', { class: 'personhead chief' }, sprite(caller), h('div', null, h('h2', null, kind.name, ' ', elementTag(kind.element)), h('small', null, `ringleader of ${place.name}, calm now`))),
        h('p', { class: 'seen', data: { act: 'seen' } }, wish.seen),
        h('div', { class: `wish${wish.granted ? ' granted' : ''}`, data: { act: 'wish' } },
          h('b', null, wish.granted ? `Wish granted: ${wish.wish}` : `Wish: ${wish.wish}`),
          wish.granted ? null : h('small', null, wish.how),
          wish.granted ? null : bar('xp', wish.have / wish.need, `${wish.have} of ${wish.need}`)),
        wish.granted ? h('button', { class: 'btn gold', data: { act: 'bout' }, onclick: () => askBout(caller) }, 'A friendly bout') : null,
      ].filter(Boolean));
      return;
    }

    // Somebody waiting by the road. They say their piece; then, if it is a bout they want, it is yours to say yes or no.
    if (caller) {
      const cast = CAST[caller];
      card.className = 'placecard';
      card.replaceChildren(...[
        h('div', { class: 'personhead' }, sprite(cast.art), h('div', null, h('h2', null, cast.name), h('small', null, cast.role))),
        bout ? h('small', { data: { act: 'boutnote' } }, 'She wants a bout: her three against yours. Nobody has to stop for her.') : null,
        h('button', { class: `btn ${bout ? 'gold' : 'plain'}`, data: { act: 'talk' }, onclick: () => {
          const lines = game.hail(caller);
          if (!lines) return;
          converse(lines, () => { cardFor = undefined; if (game.boutDue(caller)) askBout(caller); });
        } }, bout ? 'Hear her out' : 'Talk')].filter(Boolean));
      return;
    }

    // A mailbox: news for Ines Tock goes in here, and her answer comes by return.
    if (mail) {
      card.className = 'placecard';
      const news = game.hasNews('ines');
      card.replaceChildren(h('h2', null, 'A mailbox'),
        h('small', null, news ? 'Ines Tock will want to hear your news. Post her a note here and she answers by return: no need to walk back to the green.' : 'Nothing to post just now. When a place is calm, Ines Tock can be told from here.'),
        h('button', { class: `btn ${news ? 'gold' : 'plain'}`, disabled: !news, data: { act: 'post' }, onclick: () => {
          const lines = game.postToInes();
          if (!lines) return;
          ctx.save();
          play('ring');
          converse(lines, () => { cardFor = undefined; });
        } }, 'Post a note to Ines Tock'));
      return;
    }

    // A bench: somewhere to sit down and get your breath back, when home is a long walk off.
    if (bench) {
      card.className = 'placecard';
      const fresh = game.rested();
      card.replaceChildren(...[h('h2', null, 'A bench'),
        h('small', null, fresh ? 'Somewhere to sit down when your friends are worn out. Nobody needs it just now.'
          : `Sit down a while and everyone gets their breath back, the same as at home. ${!visit ? 'Other strays will be out by the time you get up.' : visit.stroll ? 'Others will have wandered in by the time you go back.' : 'Whoever you have calmed stays calm.'}`),
        fresh ? null : teamList(),
        h('button', { class: `btn ${fresh ? 'plain' : 'gold'}`, disabled: fresh, data: { act: 'rest' }, onclick: () => { if (game.rest()) { ctx.save(); play('rest'); toast('Everyone is rested.', { kind: 'good' }); cardFor = undefined; } } }, 'Sit and rest')].filter(Boolean));
      return;
    }

    if (id === 'home') {
      const inside = (kind) => h('button', { class: `btn ${kind}`, data: { act: 'inside' }, onclick: () => goIn('home') }, 'Go inside');
      if (!game.rested()) {
        card.replaceChildren(h('h2', null, HOME.name), h('small', null, `Rest here and everyone gets their breath back. ${!visit ? 'Other strays will be out on the lane by the time you set off.' : visit.stroll ? 'Others will have wandered in by the time you go back.' : 'Whoever you have calmed stays calm.'}`), teamList(),
          h('div', { class: 'cardrow' },
            h('button', { class: 'btn gold', data: { act: 'rest' }, onclick: () => { if (game.rest()) { ctx.save(); play('rest'); toast('Everyone is rested.', { kind: 'good' }); cardFor = undefined; } } }, 'Rest'),
            inside('plain')));
        return;
      }
      card.replaceChildren(h('h2', null, HOME.name), h('small', null, HOME.blurb, ' Friends who are not walking with you potter about on the green, and come in when you do.'),
        h('div', { class: 'cardrow' }, inside('gold'), h('button', { class: 'btn plain', data: { act: 'friends' }, onclick: () => ctx.show('friends') }, 'Choose your team')));
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
          ? (record.clears ? `Calm now, and it will stay calm. A few are always wandering about in there, different each time you have rested: Heirlooms come out more often among them. Mostly ${ELEMENTS[place.element].name}.`
            : `${place.path.length} groups to calm, the last a boss${bossId && state.book[bossId].met ? ` (${SPECIES[bossId].name})` : ''}. Mostly ${ELEMENTS[place.element].name}.${game.calmedIn(place.id) ? ` ${game.calmedIn(place.id)} of ${place.path.length} calmed so far, and they stay calm.` : ''}`)
          : `Not built yet: this slice ends at ${LAST_BUILT.name}.`),
        // A place you walk into by its door has a button for it (or says why not just now); one you
        // walk into across the grass says so.
        built && game.roomOpen(place.id) && insideOf(place.id)
          ? (visit && visit.room !== place.id
            ? h('p', { class: 'cardnote', data: { act: 'enter' } }, `You are still out calling on ${roomOf(visit.room).name}. Rest at home first: nobody in here will come out to you until you have.`)
            : h('button', { class: 'btn gold', data: { act: 'inside' }, onclick: () => goIn(place.id) }, visit ? 'Go back in' : 'Go in'))
          : built && game.roomOpen(place.id)
          ? h('p', { class: 'cardnote', data: { act: 'enter' } }, !visit ? 'The gate is open. Walk on in.'
            : visit.room === place.id ? 'Rest at home whenever you need to: it is not far.'
              : `You are still out calling on ${roomOf(visit.room).name}. Rest at home first: nobody here will come out to you until you have.`)
          : h('button', { class: 'btn gold', disabled: true, data: { act: 'enter' } }, built ? `Clear ${before.name} first` : 'Not built yet'));
      return;
    }
    // Out on a visit and not at a door: how everyone is, and how far you have got.
    const room = roomOf(visit.room);
    card.replaceChildren(
      h('div', { class: 'cardhead' }, h('h2', null, room.name, ' ', h('small', null, howItGoes(visit, room, true))), h('small', { class: 'resthint' }, inside && inside !== visit.room ? 'Rest at home before calling here' : 'Rest at home')),
      teamList());
  }

  /**
   * A bout, or not: asked once they have said their piece. Yes, and the dust goes up as it does for
   * any fight; no, and nothing has happened, and they will be here.
   */
  function askBout(who) {
    const worn = !game.rested();
    // A ringleader's is a friendly one: it alone, as it ever was, and it comes home if you win.
    const wish = game.wish(who);
    const name = wish ? SPECIES[who].name : CAST[who].name;
    modal({
      title: wish ? `A friendly bout with ${name}?` : `A bout with ${name}?`, cls: 'askbout',
      body: [
        h('p', null, wish ? `${name} alone against your three, at level ${wish.level}, and every bit a ringleader still. Too proud to reach, even now: this one is won by standing up for yourselves.`
          : 'Her three against yours. They are hers, not lost: there is nobody to Reach out to, so this one is won by standing up for yourselves.'),
        h('p', { class: 'note' }, wish
          ? (worn ? 'Your friends are not rested. There is time to sit down somewhere first, if you like: a wish granted stays granted.' : `Win, and ${name} comes home with you. Lose, and you are carried home: a wish granted stays granted.`)
          : (worn ? 'Your friends are not rested. She will wait while you sit down somewhere first, if you like.' : 'Win, and she moves on down the road. Lose, and you are carried home, and she will be waiting here still.')),
        teamList(),
      ],
      actions: [
        { id: 'later', label: 'Not just now', kind: 'plain' },
        { id: 'bout', label: wish ? 'A friendly bout' : 'Have it out', onClick: () => { setTimeout(() => beginBout(who), 0); } },
      ],
    });
  }
  function beginBout(who) {
    const at = game.waiting().find((one) => one.id === who);
    if (met || !at || !game.boutDue(who)) return;
    met = true;
    way = [];
    const begin = () => { if (game.startBout(who)) ctx.show('fight'); else met = false; };
    const boss = !!at.chief;
    play('meet', { boss });
    wrap.classList.add('meeting');
    if (ctx.fast) setTimeout(begin, 60);
    else {
      const box = canvas.getBoundingClientRect();
      play('scuffle');
      dustShift({ from: { x: box.left + (at.x - cam.x) * cam.k, y: box.top + (at.y - 30 - cam.y) * cam.k }, boss, covered: () => { begin(); play('poof'); } });
    }
  }

  /** The story so far, the aim of it all, and what to do next. */
  function journal() {
    const goal = game.goal();
    const aim = game.aim();
    const told = game.journal();
    const aside = game.aside();
    const also = game.also();
    const tonight = game.tonight();
    modal({
      title: 'What to do', cls: 'journal',
      body: [
        h('div', { class: 'aim' }, h('b', null, aim.title), bar('xp', aim.count[0] / aim.count[1], `${aim.count[0]} of ${aim.count[1]} calm`)),
        keyRing(state),
        h('div', { class: 'now' }, h('small', null, 'Now'), h('b', null, goal.count ? `${goal.title} (${goal.count[0]} of ${goal.count[1]})` : goal.title), h('p', null, goal.detail)),
        // What is different today: the calm place that is lively.
        tonight ? h('div', { class: 'now tonight', data: { room: tonight.room } }, h('small', null, 'Tonight'), h('b', null, tonight.title), h('p', null, tonight.detail)) : null,
        // Something else worth doing: a Keepsake is out, and Fluff knows where.
        aside ? h('div', { class: 'now aside', data: { keep: String(aside.keep) } }, sprite(FLUFF.art), h('div', null, h('small', null, 'Also'), h('b', null, aside.title), h('p', null, aside.detail))) : null,
        // And whoever is waiting by the road for you.
        also.map((one) => h('div', { class: 'now aside', data: { also: one.id } }, sprite(one.art), h('div', null, h('small', null, 'Also'), h('b', null, one.title), h('p', null, one.detail)))),
        told.length ? h('div', { class: 'sofar' }, h('small', null, 'So far'), h('ul', null, told.map((line) => h('li', null, line)))) : null,
      ],
      actions: [{ id: 'map', label: 'Map', kind: 'plain', onClick: () => { setTimeout(() => mapDialog(game), 0); } }, { id: 'ok', label: 'OK', kind: 'plain' }],
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
    if (passedStray >= 0) {
      const stray = game.strays().find((one) => one.index === passedStray);
      if (stray && Math.hypot(to.x - stray.x, to.y - stray.y) <= STRAYS.meet + 24) passedStray = -1;
    }
    // A tap on the front door of a building you can go into walks you to it, and in.
    const door = SPOTS.find((spot) => insideOf(spot.id) && Math.abs(to.x - spot.x) <= DOORWAY.wide && to.y >= spot.y - DOORWAY.up && to.y <= spot.y + DOORWAY.down);
    wantIn = door ? door.id : null;
    way = game.routeTo(door ? door.door : to);
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
      body.hover = hoverOn(body.hover, dt);
      if (body.wait > 0) { body.wait -= dt; continue; }
      const dx = body.to.x - body.x;
      const dy = body.to.y - body.y;
      const far = Math.hypot(dx, dy);
      if (far < 3) { body.to = body.spot(); body.wait = 1.5 + body.next() * 4; continue; }
      const step = Math.min(far, 46 * dt);
      body.x += (dx / far) * step; body.y += (dy / far) * step;
      body.step += step;
      body.hover = hoverOn(body.hover, 0, step);
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
    else if (game.callDue()) {
      const call = game.takeCall();
      if (call) { ctx.save(); play('ring'); converse(call, () => { cardFor = undefined; }); }
    }
    // Then, once, the three who are to walk with you. (A save from before this was written is told
    // about them as the old friends they are.)
    else if (state.started && !state.seen.three) {
      const fresh = state.stats.battles === 0;
      state.seen.three = true;
      ctx.save();
      meetTheThree(fresh, () => { cardFor = undefined; });
    }
    const moving = !met && way.length > 0 && game.walk(way[0], dt);
    const now = here();
    if (moving) {
      const dx = now.x - before.x;
      const dy = now.y - before.y;
      if (Math.abs(dx) > 0.2) facing = dx > 0 ? 1 : -1;
      ahead = { x: Math.abs(dx) > 0.6 ? Math.sign(dx) : 0, y: Math.abs(dy) > 0.6 ? Math.sign(dy) : 0 };
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
      pal.hover = hoverOn(pal.hover, dt, Math.hypot(dx, dy));
      if (Math.abs(dx) > 0.25) pal.f = dx > 0 ? 1 : -1;
    });
    // You tapped a door and have walked up to it: in you go. (If it is shut, you are left standing at it, and its card says why.)
    if (wantIn && !moving && way.length === 0) { if (game.near() === wantIn) goIn(wantIn); wantIn = null; }
    // Once you are indoors this screen has had its day: the one for that floor has taken over.
    if (state.indoors) return;
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
    // The same for a stray: walk right up to one and you have met it. (Nobody has to: the way found
    // for you goes round them, and they hold no ground.)
    const lost = game.strayNear();
    if (lost !== passedStray) passedStray = -1;
    if (group < 0 && !met && stirred && passedStray < 0 && lost >= 0) {
      met = true;
      way = [];
      const at = game.strays().find((one) => one.index === lost);
      const begin = () => { if (game.startStrays(lost)) ctx.show('fight'); else { met = false; passedStray = lost; } };
      play('meet', { boss: false });
      wrap.classList.add('meeting');
      if (ctx.fast) setTimeout(begin, 60);
      else {
        const box = canvas.getBoundingClientRect();
        play('scuffle');
        dustShift({ from: { x: box.left + (at.x - cam.x) * cam.k, y: box.top + (at.y - 30 - cam.y) * cam.k }, boss: false, covered: () => { begin(); play('poof'); } });
      }
    }
    // The first time one comes into view, a word about what it is.
    if (!state.seen.strays && !met && game.strays().some((stray) => Math.hypot(stray.x - now.x, stray.y - now.y) < 330)) {
      state.seen.strays = true;
      toast('A stray, lost out on the lane. Walk up to it to meet it, or walk on by: it is up to you.');
    }
    // And the first time somebody waiting by the road does.
    if (!state.seen.waiting && !met && game.waiting().some((one) => !one.chief && one.due >= 0 && Math.hypot(one.x - now.x, one.y - now.y) < 330)) {
      state.seen.waiting = true;
      toast('Somebody is waiting by the road, with boxes on her back. Walk up if you want to hear what she has to say.');
    }
    // And the first time a ringleader is seen out of doors.
    if (!state.seen.wishes && !met && !modalOpen() && game.waiting().some((one) => one.chief && Math.hypot(one.x - now.x, one.y - now.y) < 330)) {
      state.seen.wishes = true;
      toast('A ringleader, calm now, taking the air out of doors. Walk up: every ringleader has a wish.');
    }
    if (group >= 0) {
      met = true;
      way = [];
      const boss = !!roomOf(state.visit.room).path[group].boss;
      const begin = () => { if (game.startEncounter(group)) ctx.show('fight'); };
      play('meet', { boss });
      wrap.classList.add('meeting');
      if (ctx.fast) setTimeout(begin, 60);
      else {
        // A scuffle of dust billows up from where they stand until it fills the screen; the fight is
        // set out behind it, and it clears to show them.
        const post = DISTRICTS[state.visit.room].posts[group];
        const box = canvas.getBoundingClientRect();
        play('scuffle');
        dustShift({ from: { x: box.left + (post.x - cam.x) * cam.k, y: box.top + (post.y - 30 - cam.y) * cam.k }, boss, covered: () => { begin(); play('poof'); } });
      }
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
      else if (id.startsWith('stray:')) point = game.strays().find((one) => one.index === Number(id.slice(6))) || null;
      else if (id.startsWith('waiting:')) point = game.waiting().find((one) => one.id === id.slice(8)) || null;
      else if (id.startsWith('bench:')) point = BENCHES.find((bench) => bench.id === id.slice(6)) || null;
      else if (id.startsWith('mail:')) point = MAILBOXES[Number(id.slice(5))] || null;
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
