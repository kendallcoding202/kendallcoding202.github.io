// A map of the world: the whole of it on one small picture, drawn in code
// from the same lists the world itself is laid out from, so it can never
// show a road or a door that is not there. It marks every place and how it
// stands (calm, open, still shut), the benches, where you are, and where
// your goal is. Opened from "What to do".
import { roomOf } from '../core/balance.js';
import { WORLD, REGIONS, ROAD_POINTS, SPOTS, DISTRICTS, BENCHES, GREEN, HEDGES, RIVER, BRIDGE, personAt } from '../core/world.js';
import { h } from './dom.js';
import { modal } from './modals.js';
import { FONT } from './scenery.js';

const INK = '#0d0a1c';
const short = (name) => name.replace(/^The /, '');

/**
 * What the map marks: { w, h, places: [{ id, name, x, y, state: 'home' | 'calm' | 'open' | 'shut', goal }],
 * benches, you, goal: a point to head for or null }. A place you walk into across the grass is
 * marked in the middle of its ground; a building, where it stands.
 */
export function mapMarks(game) {
  const { state } = game;
  const goal = game.goal();
  const places = SPOTS.map((spot) => {
    const room = roomOf(spot.id);
    const area = DISTRICTS[spot.id];
    const at = area ? { x: area.x + area.w / 2, y: area.y + area.h / 2 } : { x: spot.x, y: spot.y - spot.tall * 0.35 };
    return { id: spot.id, name: room ? short(room.name) : 'Home', ...at, state: !room ? 'home' : state.rooms[spot.id].clears > 0 ? 'calm' : game.roomOpen(spot.id) ? 'open' : 'shut', goal: goal.room === spot.id };
  });
  const person = goal.who ? personAt(goal.who) : null;
  return { w: WORLD.w, h: WORLD.h, places, benches: BENCHES.map(({ x, y }) => ({ x, y })), you: { x: state.where.x, y: state.where.y }, goal: person ? { x: person.x, y: person.y } : null, bridge: game.bridgeOpen() ? 'open' : 'shut' };
}

/**
 * Paints the map. The pen works in the map's own points: the world is `k` points to a unit, set
 * `left` points in from the edge (the room either side is for names). `wide` is the whole picture.
 */
export function paintMap(pen, marks, { k, left, wide }) {
  const X = (x) => left + x * k;
  const Y = (y) => y * k;
  const tall = marks.h * k;
  // The ground, a little lighter where the world is; then each stretch of it, named down the side.
  pen.fillStyle = '#131b33'; pen.fillRect(0, 0, wide, tall);
  pen.fillStyle = '#1d3a3a'; pen.fillRect(X(0), 0, marks.w * k, tall);
  REGIONS.forEach((region, i) => {
    const end = i + 1 < REGIONS.length ? REGIONS[i + 1].y : marks.h;
    if (i % 2) { pen.fillStyle = 'rgba(255,255,255,.035)'; pen.fillRect(X(0), Y(region.y), marks.w * k, (end - region.y) * k); }
  });
  // Places you walk into across the grass: the garden's lawn, the alley's cobbles; and the green.
  for (const id of Object.keys(DISTRICTS)) {
    const area = DISTRICTS[id];
    pen.fillStyle = area.narrow ? 'rgba(140,155,181,.5)' : 'rgba(122,199,79,.3)';
    pen.fillRect(X(area.x), Y(area.y), area.w * k, area.h * k);
  }
  pen.fillStyle = 'rgba(190,255,170,.16)'; pen.fillRect(X(GREEN.x), Y(GREEN.y), GREEN.w * k, GREEN.h * k);
  pen.fillStyle = 'rgba(40,120,60,.9)';
  for (const hedge of HEDGES) if (hedge.look === 'bush') pen.fillRect(X(hedge.x), Y(hedge.y), Math.max(1.5, hedge.w * k), Math.max(1.5, hedge.h * k));
  // The river, from side to side.
  pen.fillStyle = '#2c6a8a'; pen.fillRect(X(0), Y(RIVER.y), marks.w * k, Math.max(3, RIVER.h * k));
  // The streets.
  pen.lineCap = 'round'; pen.lineJoin = 'round';
  for (const [colour, width] of [[INK, 4.4], ['#cdbb96', 2.4]]) {
    pen.strokeStyle = colour; pen.lineWidth = width;
    for (const road of ROAD_POINTS) { pen.beginPath(); road.forEach((point, i) => (i ? pen.lineTo(X(point.x), Y(point.y)) : pen.moveTo(X(point.x), Y(point.y)))); pen.stroke(); }
  }
  // The bridge: a pale bar over the river, with a dark bar across it while its gate is shut.
  pen.fillStyle = INK; pen.fillRect(X(BRIDGE.x) - 3, Y(RIVER.y) - 2, BRIDGE.w * k + 6, Math.max(3, RIVER.h * k) + 4);
  pen.fillStyle = '#cdbb96'; pen.fillRect(X(BRIDGE.x) - 1.5, Y(RIVER.y) - 0.5, BRIDGE.w * k + 3, Math.max(3, RIVER.h * k) + 1);
  if (marks.bridge === 'shut') { pen.fillStyle = '#6f6a8c'; pen.fillRect(X(BRIDGE.x) - 5, Y(RIVER.y) - 3.5, BRIDGE.w * k + 10, 3); }
  // Benches: a small brown bar.
  for (const bench of marks.benches) { pen.fillStyle = INK; pen.fillRect(X(bench.x) - 5, Y(bench.y) - 3, 10, 6); pen.fillStyle = '#c08552'; pen.fillRect(X(bench.x) - 4, Y(bench.y) - 2, 8, 4); }
  // Every place: a dot that says how it stands, and its name beside it, on whichever side has the room.
  pen.font = `600 10.5px ${FONT}`; pen.textBaseline = 'middle';
  for (const place of marks.places) {
    const x = X(place.x);
    const y = Y(place.y);
    const fill = { home: '#ffc83d', calm: '#58d77a', open: '#fff7e8', shut: '#6f6a8c' }[place.state];
    if (place.goal) { pen.beginPath(); pen.arc(x, y, 10.5, 0, Math.PI * 2); pen.strokeStyle = '#ffc83d'; pen.lineWidth = 2.2; pen.stroke(); }
    pen.beginPath(); pen.arc(x, y, 6, 0, Math.PI * 2); pen.fillStyle = fill; pen.fill(); pen.lineWidth = 2; pen.strokeStyle = INK; pen.stroke();
    pen.fillStyle = INK; pen.textAlign = 'center'; pen.font = `700 9px ${FONT}`;
    if (place.state === 'calm') pen.fillText('✓', x, y + 0.5);
    if (place.state === 'home') pen.fillText('⌂', x, y + 0.5);
    pen.font = `600 10.5px ${FONT}`;
    // Its name goes on whichever side has room for it: toward the nearer edge if it fits there (so
    // names do not crowd the middle, where the streets are), otherwise the other way.
    const long = ((pen.measureText(place.name) || {}).width || place.name.length * 6) + 14;
    const outward = place.x >= marks.w / 2;
    const right = outward ? x + long <= wide : x - long < 0;
    pen.textAlign = right ? 'left' : 'right';
    const tx = x + (right ? 10 : -10);
    pen.lineWidth = 3; pen.strokeStyle = 'rgba(13,10,28,.85)'; pen.strokeText(place.name, tx, y);
    pen.fillStyle = place.state === 'shut' ? '#b6b0d6' : place.state === 'calm' ? '#aef0c0' : '#fff7e8'; pen.fillText(place.name, tx, y);
  }
  // Where the goal is, if it is a person; and you.
  if (marks.goal) { pen.beginPath(); pen.arc(X(marks.goal.x), Y(marks.goal.y), 4, 0, Math.PI * 2); pen.fillStyle = '#ffc83d'; pen.fill(); pen.lineWidth = 1.5; pen.strokeStyle = INK; pen.stroke(); }
  const yx = X(marks.you.x);
  const yy = Y(Math.max(0, Math.min(marks.h, marks.you.y)));
  pen.beginPath(); pen.arc(yx, yy, 9, 0, Math.PI * 2); pen.fillStyle = 'rgba(255,90,106,.28)'; pen.fill();
  pen.beginPath(); pen.arc(yx, yy, 4.5, 0, Math.PI * 2); pen.fillStyle = '#ff5a6a'; pen.fill(); pen.lineWidth = 2; pen.strokeStyle = '#fff7e8'; pen.stroke();
}

/** Opens the map. */
export function mapDialog(game) {
  const marks = mapMarks(game);
  // As tall as the screen has room for; the world is much taller than it is wide, so the picture
  // is given room either side of it for names.
  const tall = Math.round(Math.max(240, Math.min(620, window.innerHeight - 382)));
  const k = tall / marks.h;
  const wide = Math.round(Math.max(marks.w * k, Math.min(270, window.innerWidth - 70)));
  const left = (wide - marks.w * k) / 2;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const canvas = h('canvas', { class: 'mapcanvas', width: Math.round(wide * dpr), height: Math.round(tall * dpr), 'aria-label': 'A map of the world, with where you are.' });
  const pen = canvas.getContext('2d');
  pen.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintMap(pen, marks, { k, left, wide });
  const key = (cls, words) => h('span', { class: `mapkey ${cls}` }, h('i'), words);
  const dialog = modal({
    title: 'Map', cls: 'map',
    body: [h('div', { class: 'mapframe' }, canvas), h('div', { class: 'mapkeys' }, key('you', 'You'), key('calm', 'Calm'), key('open', 'Open'), key('shut', 'Shut'), key('bench', 'Bench'))],
    actions: [{ id: 'ok', label: 'OK', kind: 'plain' }],
  });
  dialog.el.dataset.places = marks.places.map((place) => `${place.id}:${place.state}${place.goal ? ':goal' : ''}`).join(',');
  dialog.el.dataset.size = `${wide}x${tall}`;
  return dialog;
}
