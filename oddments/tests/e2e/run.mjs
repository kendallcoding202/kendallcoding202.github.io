// End-to-end test: plays the real game in a headless browser, from first
// launch through walking the open world, stepping into the garden, a fight,
// a new friend, resting at home, the whole garden, a reload and damaged saves.
// node tests/e2e/run.mjs        (exit code 1 on any failure)
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { newState } from '../../web/js/core/state.js';
import { enterRoom } from '../../web/js/core/rooms.js';
import { SPECIES, HEIRLOOM } from '../../web/js/core/balance.js';
import { WORLD, DISTRICTS, POST } from '../../web/js/core/world.js';
const { chromium } = createRequire(import.meta.url)('playwright'); // preinstalled globally (NODE_PATH)

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failed = 0;
let passed = 0;
const errors = [];
const requests = [];

const failures = [];
function check(ok, what, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${what}`); }
  else { failed++; failures.push(what); console.log(`  FAIL  ${what} ${detail}`); }
}
const section = (name) => console.log(`\n${name}`);
/** Whether a picture has been asked for by the page. */
const roomPictures = (file) => requests.some((url) => url.endsWith(file));

async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message} ${String(e.stack || '').split('\n').slice(1, 4).map((line) => line.trim()).join(' < ')}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => requests.push(r.url()));
  return page;
}
const ready = (page) => page.waitForSelector('#app:not([hidden])');
const S = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => S(page, () => JSON.parse(JSON.stringify(window.oddments.game.state)));
const battle = (page) => S(page, () => { const b = window.oddments.game.battle; return b && JSON.parse(JSON.stringify({ ...b, dice: null, events: null })); });
const screen = (page) => S(page, () => document.querySelector('#screen').dataset.screen);
/** Waits until a fight is waiting for a choice (or is over). How a fight works is explained before a save's first: read past it. */
async function idle(page) {
  await page.waitForSelector('#fight[data-busy="0"], .modal.result, .modal.howto', { timeout: 30000 });
  for (let pages = 0; pages < 6 && await page.$('.modal.howto'); pages++) { await page.click('.modal.howto [data-id="next"]'); await page.waitForTimeout(30); }
  await page.waitForSelector('#fight[data-busy="0"], .modal.result', { timeout: 30000 });
}
const tab = async (page, id) => { await page.click(`[data-tab="${id}"]`); await page.waitForTimeout(120); };
const modalTitle = (page) => S(page, () => document.querySelector('.modal header span')?.textContent || null);
const snap = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });
/** Hears out whoever is talking, a line at a time, to the end. Returns how many lines there were. */
async function hearOut(page) {
  let lines = 0;
  for (; lines < 30 && await page.$('.modal.talk'); lines++) { await page.click('.modal.talk [data-id="next"]'); await page.waitForTimeout(40); }
  return lines;
}
/** Reads the pages about the three you set out with, to the end. Returns how many pages there were. */
async function meetThree(page) {
  await page.waitForSelector('.modal.three', { timeout: 8000 });
  let pages = 0;
  for (; pages < 9 && await page.$('.modal.three'); pages++) { await page.click('.modal.three [data-id="next"]'); await page.waitForTimeout(40); }
  return pages;
}
/** Begins a new game from the intro, hears out the call that follows, and meets the three. */
async function begin(page) {
  await page.click('[data-id="begin"]');
  await page.waitForSelector('.modal.talk');
  await hearOut(page);
  await meetThree(page);
}

/** Makes one choice the way the stand-in player would, by tapping the real buttons. False once the fight is over. */
async function botTurn(page, style = {}) {
  await idle(page);
  if (await page.$('.modal.result')) return false;
  // The module is imported inside the page: the content security policy allows the game's own files and nothing else.
  const action = await page.evaluate(async (opts) => {
    const { suggest } = await import('./js/core/auto.js');
    const g = window.oddments.game;
    return suggest(g.battle, { ...opts, have: g.state.friends.map((f) => f.species) });
  }, style);
  if (!action) return false;
  await page.click(action.type === 'move' ? `[data-move="${action.id}"]` : `[data-call="${action.id}"]`);
  if (await page.$('.unit.pick')) await page.click(`[data-unit="${action.target}"]`);
  return true;
}
async function botFight(page, style) {
  for (let guard = 0; guard < 300; guard++) if (!(await botTurn(page, style))) break;
  await page.waitForSelector('.modal.result', { timeout: 30000 });
}

// =============================================================== first launch
section('First launch');
let page = await newPage();
await page.goto(`${base}?debug&fast&reset&seed=7`);
await ready(page);
await page.waitForSelector('.modal.intro');
check(true, 'the intro appears on a fresh save');
check((await state(page)).started === false, 'the game waits for the player');
check((await page.$$('.modal [data-look]')).length === 4, 'the intro offers four looks');
check(!(await page.$('.modal.intro .x')), 'the intro cannot be dismissed without beginning');
await snap(page, 'e2e-intro');
await page.fill('[data-field="name"]', 'Marisol');
await page.click('.modal [data-look="sitter_c"]');
check(await S(page, () => document.querySelector('[data-look="sitter_c"]').classList.contains('on')), 'picking a look marks it');
await page.click('[data-id="begin"]');
await page.waitForSelector('.modal.talk');
let s = await state(page);
check(s.started && s.player.name === 'Marisol' && s.player.look === 'sitter_c', 'the house-sitter takes the chosen name and look');
check(!(await page.$('.modal.intro')), 'the intro closes');

// =============================================================== the story begins
section('The story begins');
check((await S(page, () => document.querySelector('.modal.talk .talkname b').textContent)) === 'Great-aunt Maribel' && (await S(page, () => document.querySelector('.modal.talk .talkname small').textContent)) === 'on the phone', 'the phone rings: it is great-aunt Maribel');
check(await S(page, () => document.querySelector('.modal.talk .talkface img').src.includes('cast_maribel')), 'with her picture');
check(!(await page.$('.modal.talk .x')), 'the call is heard out, not dismissed');
await page.waitForTimeout(250);
await snap(page, 'e2e-call');
const callLines = await hearOut(page);
s = await state(page);
check(callLines === 4 && s.story.call === true, 'she says her piece in four lines, and the call is remembered');
// Then, once, the three who are to walk with you: a page each, with where each came from.
await page.waitForSelector('.modal.three');
check(await S(page, () => { const m = document.querySelector('.modal.three'); return m.dataset.page === '1/5' && m.textContent.includes('waiting in the hall') && m.querySelectorAll('.threerow img').length === 3 && !m.querySelector('.x'); }), 'then her three are waiting in the hall: all three in a row, and a page to be read, not dismissed');
const told = [];
for (const [kind, name, element, word] of [['dustbunny', 'Hopmote', 'Fluff', 'under the spare bed'], ['sockeel', 'Eelastic', 'Suds', 'one of a pair'], ['toastghost', 'Crumbwisp', 'Crumb', 'in the toaster']]) {
  await page.click('.modal.three [data-id="next"]');
  await page.waitForTimeout(60);
  told.push(await S(page, (want) => { const m = document.querySelector('.modal.three'); const r = m.getBoundingClientRect(); const b = m.querySelector('.body');
    return m.querySelector(`.threekin[data-kind="${want.kind}"] img`).src.includes(want.kind) && m.querySelector('.threename h3').textContent === want.name && m.querySelector('.threename .el').textContent === want.element
      && m.textContent.includes(want.word) && r.top >= 0 && r.bottom <= innerHeight && b.scrollHeight <= b.clientHeight + 1; }, { kind, name, element, word }));
  if (kind === 'sockeel') await snap(page, 'e2e-three');
}
check(told.every(Boolean), 'each has a page of its own: its picture, its name and element, and where it came from, all fitting the screen', told.join(','));
await page.click('.modal.three [data-id="next"]');
check(await S(page, () => { const m = document.querySelector('.modal.three'); return m.dataset.page === '5/5' && m.textContent.includes('Look after them') && m.querySelector('[data-id="next"]').textContent === 'Off we go'; }), 'and a last word: look after them');
await page.click('.modal.three [data-id="next"]');
s = await state(page);
check(!(await page.$('.modal')) && s.seen.three === true, 'read once, and remembered as read');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'meet' && document.querySelector('.goalchip span').textContent === 'Find Ines Tock'), 'and you are left with something to do: find Ines Tock');
check((await S(page, () => document.querySelector('#lane .who b').textContent)) === 'Marisol', 'the name shows in the lane');
check(await S(page, () => document.querySelector('#lane .who img').src.includes('sitter_c')), 'and so does the look');

// =============================================================== the lane
section('The lane (the open world)');
const game = (p, fn, arg) => S(p, fn, arg);
const where = (p) => S(p, () => ({ ...window.oddments.game.state.where, near: window.oddments.game.near(), district: window.oddments.game.district() }));
const view = (p) => S(p, () => window.oddments.lane.view());
/** One tap toward something in the world, wherever it is: on it if it is in view, else at the edge of the screen nearest it
 *  (below the heading and the goal, above the card: a finger aiming to walk taps the world, not the things laid over it). */
async function tapToward(p, id) {
  const aim = await S(p, (what) => {
    const at = window.oddments.lane.screenOf(what);
    const box = document.querySelector('.lanecanvas').getBoundingClientRect();
    return { x: Math.min(box.right - 8, Math.max(box.left + 8, at.x)), y: Math.min(box.bottom - 200, Math.max(box.top + 110, at.y)) };
  }, id);
  await p.touchscreen.tap(aim.x, aim.y);
}
/** Walks to a place the way a finger would: by tapping toward its door until you are standing at it. */
async function walkTo(p, id) {
  for (let tries = 0; tries < 45; tries++) {
    if ((await where(p)).near === id) return true;
    await tapToward(p, id);
    await p.waitForTimeout(450);
  }
  return (await where(p)).near === id;
}
/** Walks in through a place's gate by tapping, as a finger would. */
async function walkIn(p, room) {
  for (let tries = 0; tries < 45 && (await where(p)).district !== room; tries++) {
    await tapToward(p, `in:${room}`);
    await p.waitForTimeout(450);
  }
  return (await where(p)).district === room;
}
/** Waits until the walker has stopped: two looks a moment apart that agree. */
async function stopped(p) {
  let last = await where(p);
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(150);
    const now = await where(p);
    if (now.x === last.x && now.y === last.y) return now;
    last = now;
  }
  return last;
}
/** Goes straight in through the garden gate (the engine's shortcut). */
async function enterGarden(p) {
  await S(p, () => { window.oddments.game.travelTo('garden'); window.oddments.ctx.show('lane'); });
}
/** Goes straight home and rests there by pressing Rest. */
async function restAtHome(p) {
  await S(p, () => { window.oddments.game.standAt('home'); window.oddments.ctx.show('lane'); });
  await p.click('.placecard[data-spot="home"] [data-act="rest"]');
  await p.waitForSelector('.placecard[data-spot="home"] [data-act="friends"]');
}
check(await S(page, () => {
  const canvas = document.querySelector('.lanecanvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const colours = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 997) colours.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
  return colours.size > 12;
}), 'the world is drawn');
let at = await where(page);
check(at.near === 'home' && (await S(page, () => document.querySelector('.placecard').dataset.spot)) === 'home', 'you start at the door of home');
check(await S(page, () => !document.querySelector('#tabs').hidden), 'the tabs show');
const firstView = await view(page);
check(firstView.w < WORLD.w / 2 && firstView.h < WORLD.h, `the world is much bigger than the screen (${Math.round(firstView.w)} of ${WORLD.w} across, ${Math.round(firstView.h)} of ${WORLD.h} down)`);
check((await game(page, () => window.oddments.game.travelTo('alley'))) === false, 'a place that is still shut cannot be walked into');
check((await game(page, () => window.oddments.game.travelTo('pantry'))) === false, 'nor one that is not built');
await snap(page, 'e2e-lane');

// --- someone to talk to
/** Walks up to a neighbour the way a finger would: by tapping them until you are near enough to talk. */
async function walkUpTo(p, who) {
  for (let tries = 0; tries < 45 && (await S(p, () => window.oddments.game.personNear())) !== who; tries++) {
    await tapToward(p, `person:${who}`);
    await p.waitForTimeout(450);
  }
  return (await S(p, () => window.oddments.game.personNear())) === who;
}
check(await walkUpTo(page, 'ines'), 'tapping Ines Tock walks you up to her');
await page.waitForSelector('.placecard[data-person="ines"]');
check(await S(page, () => document.querySelector('.placecard h2').textContent === 'Ines Tock' && document.querySelector('[data-act="talk"]').classList.contains('gold')), 'standing by her, the card offers to talk, and shows she has news');
await page.click('[data-act="talk"]');
await page.waitForSelector('.modal.talk');
check((await S(page, () => document.querySelector('.modal.talk .talkname b').textContent)) === 'Ines Tock', 'Talk starts the conversation');
await page.waitForTimeout(250);
await snap(page, 'e2e-ines');
check((await hearOut(page)) === 5, 'she explains Clutterkin, Reaching out and ringleaders in five lines');
s = await state(page);
check(s.story.ines === 1 && await S(page, () => document.querySelector('.goalchip').dataset.goal === 'friend' && document.querySelector('.goalchip span').textContent === 'Make a friend in the garden'), 'and the goal moves on: make a friend in the garden');
await page.waitForSelector('.placecard[data-person="ines"] [data-act="talk"].plain');
check(true, 'with nothing new to say, her Talk button is plain');
await page.click('[data-act="goal"]');
check((await modalTitle(page)) === 'What to do', 'the goal can be tapped for the story so far');
check(await S(page, () => document.querySelector('.modal.journal .aim b').textContent === 'Calm all eight places before Monday' && document.querySelector('.modal.journal .aim').textContent.includes('0 of 8 calm')), 'which says what the whole game is for, and how far along it is');
check((await page.$$('.modal.journal .sofar li')).length === 2, 'and what has happened so far');
await page.waitForTimeout(200);
await snap(page, 'e2e-journal');
await page.click('.modal [data-id="ok"]');

// --- facing every way you walk
await game(page, () => { window.oddments.game.state.where = { x: 1160, y: 1900 }; });
await page.waitForTimeout(700);
const turn = async (dx, dy) => {
  const me = await S(page, () => window.oddments.lane.screenOf('me'));
  await page.touchscreen.tap(me.x + dx, me.y + dy);
  await page.waitForTimeout(450);
  return S(page, () => window.oddments.lane.facing());
};
const faced = [await turn(0, -90), await turn(0, 90), await turn(90, 0), await turn(-90, 0)];
check(JSON.stringify(faced) === JSON.stringify(['back', 'front', 'right', 'left']), 'you turn to face the way you walk: away, toward you, right and left', faced.join(' '));
at = await where(page);

check(await walkTo(page, 'garden'), 'tapping walks you to the garden gate');
const moved = await stopped(page);
check(Math.hypot(moved.x - at.x, moved.y - at.y) > 400, 'by actually crossing the ground between');
const gateView = await view(page);
check(Math.abs(gateView.x - firstView.x) > 100 && Math.abs(gateView.y - firstView.y) > 100, 'and the view follows you across the world, both ways');
check(await walkUpTo(page, 'dov') && await S(page, () => document.querySelector('.placecard').dataset.person === 'dov'), 'Dov is by the garden gate, and can be walked up to');
await page.click('[data-act="talk"]');
check((await hearOut(page)) === 3 && (await state(page)).story.dov === 1, 'and has a tip or three');
check(await walkTo(page, 'garden'), 'the gate is a few steps from him');
await page.waitForSelector('.placecard[data-spot="garden"]');
check(await S(page, () => document.querySelector('.placecard h2').textContent.includes('The Garden Gate') && document.querySelector('[data-act="enter"]').textContent.includes('Walk on in')), 'standing at its gate tells you the way in is open');
check((await state(page)).visit === null && moved.district === null, 'reading the sign is not yet a visit');
check((await state(page)).seen.walked === true && await S(page, () => document.querySelector('.lanehint').hidden), 'the walking hint goes once you have walked');
await snap(page, 'e2e-lane-garden');
check(await walkTo(page, 'alley'), 'you can walk right across the lane to the next place, Tin Can Alley');
await page.waitForSelector('.placecard[data-spot="alley"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').disabled && document.querySelector('[data-act="enter"]').textContent === 'Clear The Garden Gate first'), 'its card says what has to be done first');
for (let i = 0; i < 4; i++) { await tapToward(page, 'in:alley'); await page.waitForTimeout(450); }
at = await stopped(page);
check(at.district === null && at.near === 'alley' && (await state(page)).visit === null, 'and the barricade in its gateway cannot be walked through');
check(Math.abs((await view(page)).x + (await view(page)).w / 2 - at.x) < 140, 'at the east edge of the world the view still keeps you near the middle of the screen');
await page.waitForTimeout(300);
await snap(page, 'e2e-alley-shut');
await page.goto(`${base}?debug&fast`);
await ready(page);
const again = await where(page);
check(Math.abs(again.x - at.x) < 1 && Math.abs(again.y - at.y) < 1 && again.near === 'alley', 'a reload leaves you standing where you were');
check(await walkTo(page, 'garden'), 'and you can walk back');
check(await walkIn(page, 'garden'), 'walking on through the gate takes you into the garden');
s = await state(page);
check(s.visit && s.visit.room === 'garden' && s.visit.stop === 0 && s.rooms.garden.visits === 1, 'and that begins a visit: no button to press');
check((await screen(page)) === 'lane', 'it is the same world, not another screen');
check(await S(page, () => !document.querySelector('#tabs').hidden), 'and the tabs stay out wherever you walk');

// =============================================================== inside a place
section('Inside the garden');
/** Walks straight up to a group (the engine's shortcut: the next one, unless told which); the screen notices and the fight starts. */
async function onward(p, index) {
  await S(p, (i) => (i === undefined ? window.oddments.game.approach() : window.oddments.game.approach(i)), index);
  // Nothing starts until you move: one tap toward them is the step that walks you in.
  await tapToward(p, index === undefined ? 'next' : `post:${index}`);
  await p.waitForSelector('#fight', { timeout: 15000 });
}
check(await S(page, () => document.querySelector('#lane h1').textContent === 'The Garden Gate' && document.querySelector('#lane .where').textContent === '0 of 5 calmed'), 'the heading says where you are and how the visit is going');
check(s.visit.groups.length === 5 && s.visit.groups.every((group) => group.foes.length >= 1 && !group.done), 'everyone restless is already out where you can see them');
await page.waitForSelector('.placecard.slim');
check((await page.$$('.teamcard')).length === 3, 'the team of three is listed');
check(await S(page, () => [...document.querySelectorAll('.teamcard .bar i')].every((i) => i.style.width === '100%')), 'everyone sets out rested');
await page.waitForTimeout(500);
await snap(page, 'e2e-inside');
// The boss stands in plain sight, but will not be met yet.
const bossPost = DISTRICTS.garden.posts[4];
const cameIn = (await where(page));
await game(page, (post) => { window.oddments.game.state.where = { x: post[0], y: post[1] }; }, [bossPost.x, bossPost.y + POST.hold + 8]);
await tapToward(page, 'post:4');
await page.waitForTimeout(700);
check((await screen(page)) === 'lane' && (await game(page, () => window.oddments.game.meeting())) === -1, 'the boss will not be met while the others are restless');
await game(page, (to) => { window.oddments.game.state.where = to; }, { x: cameIn.x, y: cameIn.y });
// Walk up to one of them by tapping where it stands, as a finger would. Not the nearest: any order will do.
const FIRST = 1;
const stood = await where(page);
for (let tries = 0; tries < 30 && (await S(page, () => window.oddments.game.place())) !== 'fight'; tries++) {
  await tapToward(page, `post:${FIRST}`);
  await page.waitForTimeout(500);
}
await page.waitForSelector('#fight', { timeout: 15000 });
s = await state(page);
check(Math.hypot(s.where.x - stood.x, s.where.y - stood.y) > 150, 'tapping where a group stands walks you up to it');
check((await game(page, () => window.oddments.game.facing)) === FIRST, 'and it is that group you meet, not one you passed on the way');

// =============================================================== a fight
section('A fight');
await idle(page);
check((await screen(page)) === 'fight', 'walking into them starts the fight');
check(JSON.stringify((await battle(page)).units.filter((u) => u.side === 'foe').map((u) => u.species)) === JSON.stringify((await state(page)).visit.groups[FIRST].foes.map((f) => f.species)), 'against exactly who was seen waiting');
let b = await battle(page);
const foeCount = b.units.filter((u) => u.side === 'foe').length;
check((await page.$$('.unit.ally')).length === 3 && (await page.$$('.unit.foe')).length === foeCount, 'three friends face whoever turned up');
check(await S(page, () => getComputedStyle(document.querySelector('.unit.ally .sprite')).transform.startsWith('matrix(-1')), 'friends are mirrored to face right');
check(await S(page, () => getComputedStyle(document.querySelector('.unit.foe .sprite')).transform === 'none'), 'the other side faces left as painted');
check(await S(page, () => document.querySelector('.arena .bg').src.includes('bg_garden')), 'in the garden');
check(await S(page, () => document.querySelector('.calls .caller img').src.includes('sitter_c')), 'with the house-sitter standing by their Calls');
check(await S(page, () => { const feet = [...document.querySelectorAll('.unit')].map((u) => Math.round(u.querySelector('.shadow').getBoundingClientRect().bottom)); return Math.max(...feet) - Math.min(...feet) <= 2; }), 'everyone stands on the same ground line');
check(await S(page, () => { const boxes = [...document.querySelectorAll('.unit .sprite')].map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left); return boxes.every((box, i) => i === 0 || box.left >= boxes[i - 1].right - 0.5); }), 'and nobody overlaps anybody');
check((await page.$$('.order .chip')).length === 3 + foeCount, 'the turn strip shows everyone once');
const chooser = await S(page, () => window.oddments.game.choices().unit.name);
check((await S(page, () => document.querySelector('#fight .who b').textContent)) === chooser, 'the panel names whose turn it is');
check((await page.$$('.move')).length === 3, 'two learned moves and Brace are offered');
check(await S(page, () => document.querySelector('[data-call="patch"]').disabled), 'Patch up is off while nobody is hurt');
await snap(page, 'e2e-fight');

// Tapping someone when no move is armed describes them.
await page.click('[data-unit="f0"]');
check((await modalTitle(page))?.includes(b.units.find((u) => u.key === 'f0').name), 'tapping an Clutterkin opens its card');
check(await S(page, () => document.querySelector('.modal .note').textContent.includes('soft spot')), 'which says what it has a soft spot for');
await page.click('.modal .x');

// Reach out, by tapping.
const huff0 = b.units.find((u) => u.key === 'f0').huff;
const reachBy = await page.evaluate(async () => { const { reachAmount } = await import('./js/core/battle.js'); const fight = window.oddments.game.battle; return reachAmount(fight, fight.units.find((u) => u.key === 'f0')); });
await page.click('[data-call="reach"]');
if (foeCount > 1) {
  check((await page.$$('.unit.pick')).length === foeCount, 'Reach out asks who');
  check(await S(page, () => document.querySelector('.unit.pick .edge').textContent.includes('pips')), 'and shows how many pips it would take off');
  await snap(page, 'e2e-reach');
  await page.click('[data-unit="f0"]');
}
await idle(page);
b = await battle(page);
check(reachBy >= 2 && b.units.find((u) => u.key === 'f0').huff === Math.max(0, huff0 - reachBy), `reaching out takes ${reachBy} pips off its Huff`);
check((await page.$$('[data-unit="f0"] .pips i.on')).length === Math.max(0, huff0 - reachBy), 'and the pips on screen say so');
check(await S(page, () => [...document.querySelectorAll('.call')].every((c) => c.disabled)), 'one Call a round: the rest wait');
check(b.order[b.at] === (await S(page, () => window.oddments.game.choices().unit.key)), 'a Call does not use up the friend\'s turn');

// A move with a choice of targets.
const first = await S(page, () => window.oddments.game.choices().moves[0].id);
const hp0 = Object.fromEntries(b.units.map((u) => [u.key, u.hp]));
await page.click(`[data-move="${first}"]`);
if (foeCount > 1) {
  check(await S(page, () => document.querySelector('.say').textContent.includes('tap a target')), 'a move with a choice asks for a target');
  check(await S(page, () => !!document.querySelector('[data-act="cancel"]')), 'and can be cancelled');
  await page.click(`[data-unit="f${foeCount - 1}"]`);
}
await page.waitForTimeout(150);
check((await S(page, () => document.querySelector('#fight').dataset.busy)) === '1', 'the buttons wait while the move plays');
await idle(page);
b = await battle(page);
const target = b.units.find((u) => u.key === `f${foeCount - 1}`);
check(target.hp < hp0[target.key], 'the hit lands and takes Health off');
check(await S(page, (key) => parseFloat(document.querySelector(`[data-unit="${key}"] .hpbar i`).style.width) < 100, target.key), 'and its bar on screen drops');

// Hitting the one you were calming puts a pip back.
if (b.phase === 'fight') {
  const calm = b.units.find((u) => u.key === 'f0');
  if (calm.hp > 0 && !calm.settled && foeCount > 1) {
    const move = await S(page, () => window.oddments.game.choices().moves[0].id);
    await page.click(`[data-move="${move}"]`);
    if (await page.$('.unit.pick')) await page.click('[data-unit="f0"]');
    await idle(page);
    const after = (await battle(page))?.units.find((u) => u.key === 'f0');
    check(!after || after.hp === 0 || after.huff === calm.huff + 1, 'hitting the one you were calming puts a pip back');
  }
}

// Finish it the friendly way: calm what can be calmed, by tapping.
await botFight(page, { befriend: true });
check(true, 'the fight plays to its end through the real buttons');
check((await modalTitle(page)) === 'Won', 'and is won');
s = await state(page);
const joined = await S(page, () => [...document.querySelectorAll('.modal .joined')].map((el) => el.dataset.joined));
check(joined.length >= 1 && joined.every((id) => s.friends.some((f) => f.species === id)), `a calmed Clutterkin comes home (${joined.join(', ')})`);
check(s.friends.length === 3 + joined.length && s.stats.befriended === joined.length, 'and is counted among your friends');
check(await S(page, () => document.querySelector('.modal .xp').textContent.includes('experience')), 'experience is shown');
check(!(await page.$('.modal.result .x')), 'the result has to be acknowledged');
await snap(page, 'e2e-result');
await page.click('[data-id="next"]');
check((await screen(page)) === 'lane', 'Onward puts you back in the garden');
check(await S(page, () => document.querySelector('.placecard').dataset.calmed === '1' && document.querySelector('.placecard h2').textContent.includes('1 of 5 calmed') && document.querySelector('#lane .where').textContent === '1 of 5 calmed'), 'which knows one group is calm');
s = await state(page);
check(s.visit.stop === 1 && s.visit.groups[FIRST].done && s.visit.groups.filter((group) => group.done).length === 1, 'that group, and only that group');
check(Object.values(s.visit.hp).every((hp) => hp > 0), 'with everyone on their feet after a breather');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'calm' && document.querySelector('.goalchip span').textContent === 'Calm the garden (1 of 5)'), 'with a friend made, the goal becomes the whole garden, and counts');
const afterWin = await where(page);
check(Math.abs(afterWin.x - s.where.x) < 1 && afterWin.district === 'garden', 'and you are standing where you stood');

// =============================================================== walking away, and home
section('Walking away');
await onward(page);
await idle(page);
await page.click('[data-act="menu"]');
check((await modalTitle(page)) === 'Fight', 'the fight has a menu');
await page.click('[data-act="fast"]');
check((await state(page)).settings.fast === true, 'fast fights can be switched on there');
await page.click('[data-id="concede"]');
await page.waitForSelector('.modal.result');
check((await modalTitle(page)) === 'Home again', 'walking away ends the visit');
await page.click('[data-id="next"]');
s = await state(page);
check((await screen(page)) === 'lane' && s.visit === null && s.rooms.garden.losses === 1, 'and it is counted');
check((await where(page)).near === 'home', 'carried home');
check(s.friends.length === 3 + joined.length, 'with every friend you had');

section('Friends');
await tab(page, 'friends');
check((await page.$$('.grid.team .friend')).length === 3, 'the team of three is shown');
check((await page.$$('.grid:not(.team) .friend')).length === joined.length, 'the new friend is resting at home');
await page.click(`.grid:not(.team) .friend[data-species="${joined[0]}"]`);
check((await modalTitle(page))?.startsWith(SPECIES[joined[0]].name), 'tapping a friend opens its card');
check(!(await page.$('.modal [data-act="about"]')), 'a friend made along the way has no story of its own on it');
check((await page.$$('.modal .moverow')).length === 3 && (await page.$$('.modal .stat')).length === 4, 'with its four stats and three moves');
await snap(page, 'e2e-friend');
const out = s.team[0];
await page.click(`[data-id="swap-${out}"]`);
s = await state(page);
const newcomer = s.friends.find((f) => f.species === joined[0]).id;
check(s.team[0] === newcomer && !s.team.includes(out), 'Swap puts it on the team in that place');
check(await S(page, (species) => !!document.querySelector(`.grid.team .friend[data-species="${species}"]`), joined[0]), 'and the screen shows it there');
await snap(page, 'e2e-friends');

section('Scrapbook');
await tab(page, 'book');
check((await page.$$('.page-tile')).length === Object.keys(SPECIES).length && Object.keys(SPECIES).length === 48, 'the scrapbook has a page for every kind');
const met = Object.values(s.book).filter((p) => p.met).length;
check((await page.$$('.page-tile:not(.unmet)')).length === met, `the ${met} kinds met so far are shown`);
check(await S(page, () => [...document.querySelectorAll('.page-tile.unmet')].every((t) => t.disabled && t.querySelector('b').textContent === '???')), 'the rest are shadows');
check((await page.$$('.ring > div')).length === 6, 'and the six elements are explained');
check(await S(page, () => { const hunt = document.querySelector('.card.hunt'); return !!hunt && hunt.dataset.kept === '0' && hunt.textContent.includes('0 of 40 kept') && hunt.textContent.includes('one in 60') && hunt.textContent.includes('one in 20'); }), 'the scrapbook has the hunt for Heirlooms: none kept yet, and how the odds stand');
check(await S(page, () => document.querySelector('[data-act="where"]').textContent.startsWith('Nowhere is calm yet') && document.querySelector('[data-act="tofind"]').textContent.startsWith('Still to find:') && document.querySelector('[data-act="tofind"]').textContent.includes('???')), 'it says nowhere is calm yet, and lists who is still to find, unmet kinds as ???');
await snap(page, 'e2e-book');

// =============================================================== reload
section('Saving');
await tab(page, 'lane');
await enterGarden(page);
await onward(page);
await idle(page);
const beforeReload = await state(page);
await page.goto(`${base}?debug&fast`);
await ready(page);
s = await state(page);
check(s.player.name === 'Marisol' && s.player.look === 'sitter_c' && s.friends.length === beforeReload.friends.length, 'a reload keeps the house-sitter and every friend');
check(JSON.stringify(s.team) === JSON.stringify(beforeReload.team) && s.settings.fast === true, 'and the team and settings');
check((await screen(page)) === 'lane' && s.visit && s.visit.stop === beforeReload.visit.stop && s.rooms.garden.calmed === beforeReload.rooms.garden.calmed, 'a reload in the middle of a fight puts you back in the garden before it, with whoever was calm still calm');
check(JSON.stringify(s.visit.groups) === JSON.stringify(beforeReload.visit.groups) && Math.abs(s.where.x - beforeReload.where.x) < 1 && Math.abs(s.where.y - beforeReload.where.y) < 1, 'facing the same ones, standing where you stood');
await page.waitForTimeout(600);
check((await screen(page)) === 'lane' && (await game(page, () => window.oddments.game.meeting())) >= 0, 'and nothing starts just because you are standing in front of them');
check(!(await page.$('.modal.intro')), 'the intro does not come back');
check(await S(page, () => Object.keys(localStorage).every((key) => key.startsWith('oddments.'))), 'the save is the only thing kept on the device');

// =============================================================== resting at home
section('Resting at home');
await tab(page, 'friends');
const teamBefore = JSON.stringify((await state(page)).team);
await page.click('.grid:not(.team) .friend');
const swapButton = await page.$('.modal [data-id^="swap-"]');
if (swapButton) { await swapButton.click(); await page.waitForTimeout(150); }
check(JSON.stringify((await state(page)).team) === teamBefore, 'the team cannot be changed in the middle of a visit');
if (await page.$('.modal .x')) await page.click('.modal .x');
await tab(page, 'lane');
check(await walkTo(page, 'home'), 'you can walk away from them, out of the garden and all the way home');
check((await screen(page)) === 'lane' && (await state(page)).stats.battles === beforeReload.stats.battles, 'without a fight starting as you turn to go');
check((await state(page)).visit !== null, 'walking home is not yet resting');
await page.waitForSelector('.placecard[data-spot="home"] [data-act="rest"]');
check((await page.$$('.placecard[data-spot="home"] .teamcard')).length === 3, 'at home the card shows how everyone is, and offers a rest');
check(await S(page, () => document.querySelector('.placecard[data-spot="home"] small').textContent.includes('Whoever you have calmed stays calm.')), 'and says that whoever you have calmed stays calm');
await snap(page, 'e2e-home-rest');
await page.click('.placecard[data-spot="home"] [data-act="rest"]');
await page.waitForSelector('.placecard[data-spot="home"] [data-act="friends"]');
s = await state(page);
check(s.visit === null, 'Rest ends the visit');
check(await game(page, () => window.oddments.game.teamHealth().every((member) => member.hp === member.max)), 'and everyone has their breath back');
// Whoever you calmed stays calm: rested, the garden still counts them, and walking back in only the others are waiting.
const keptCalm = s.rooms.garden.calmed;
const keptCount = [0, 1, 2, 3, 4].filter((stop) => (keptCalm >> stop) & 1).length;
check(keptCount >= 1 && keptCalm === beforeReload.rooms.garden.calmed, `resting does not undo anyone: ${keptCount} of the garden's groups are still calm`);
check(await S(page, (want) => document.querySelector('.goalchip span').textContent.endsWith(`(${want} of 5)`), keptCount), 'the goal still counts them');
check((await game(page, () => window.oddments.game.held().filter((point) => !point.r && point.x < 1000).length)) === 5 - keptCount, 'from outside, nobody keeps to cover where you calmed them');
await enterGarden(page);
s = await state(page);
check(s.visit.stop === keptCount && s.visit.groups.every((group, stop) => (((keptCalm >> stop) & 1) ? group.done || group.wander === true : !group.done && !group.wander)), 'back in the garden, only the ones not yet calmed are waiting for you');
check(await S(page, (want) => document.querySelector('#lane .where').textContent.startsWith(`${want} of 5 calmed`), keptCount), 'and the heading says how many are calm already');
await snap(page, 'e2e-garden-kept');

// =============================================================== the whole room
section('The whole garden');
// (Back to the three you started with: the Friends test above swapped a brand-new, low-level friend in.)
await S(page, () => window.oddments.game.setTeam([1, 2, 3]));
let cleared = false;
let visits = 0;
while (!cleared && visits < 6) {
  visits++;
  if (!(await state(page)).visit) await enterGarden(page);
  // The first time round, take them out of order: the far ones before the near ones.
  const order = visits === 1 ? [2, 0, 3, 1, 4] : [0, 1, 2, 3, 4];
  while ((await state(page)).visit) {
    // (Whoever was calmed on an earlier visit stays calm: the next is the first in that order still restless.)
    const groups = (await state(page)).visit.groups;
    const index = order.find((stop) => !groups[stop].done && !groups[stop].wander);
    await onward(page, index);
    await idle(page);
    if (index === 4) {
      check((await page.$$('.unit.boss')).length === 1 && (await page.$$('.unit.foe')).length === 3, 'the boss stands with two others');
      check((await S(page, () => document.querySelectorAll('.unit.boss .pips i').length)) === 0, 'and has no Huff to calm');
      check(await S(page, () => document.querySelectorAll('.order .chip.foe img[src*="boss_hydra"]').length === 2), 'it takes two turns a round');
      check(await S(page, () => window.oddments.sound().scene === 'boss'), 'and its fight has a ringleader\'s own tune');
      await snap(page, 'e2e-boss');
    }
    await botFight(page, { befriend: index < 4 });
    cleared = (await modalTitle(page)) === 'All calm';
    if (cleared) await snap(page, 'e2e-cleared');
    await page.click('[data-id="next"]');
    await page.waitForTimeout(80);
  }
}
s = await state(page);
check(cleared, `a sensible player calms the whole garden, taking the groups in any order (took ${visits} visit${visits === 1 ? '' : 's'})`);
check(s.rooms.garden.clears === 1 && s.rooms.garden.calmed === 31 && s.visit === null, 'clearing it is recorded and the visit is over');
check(s.book.boss_hydra.met && !s.friends.some((f) => SPECIES[f.species].boss), 'the boss was met, and did not come home');
check(s.friends.length >= 5, `friends were made along the way (${s.friends.length})`);
check(s.friends.filter((f) => s.team.includes(f.id)).every((f) => f.level > 3), 'and the team grew');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'report' && document.querySelector('.goalchip span').textContent === 'Tell Ines Tock'), 'the goal is now to tell Ines Tock');
check((await where(page)).district === 'garden' && (await game(page, () => window.oddments.game.held().filter((point) => point.x < 1000).length)) === 0, 'you are still standing in the garden, and nobody is about');
check(await S(page, () => document.querySelector('.placecard').hidden), 'with nothing to report');
await page.waitForTimeout(400);
await snap(page, 'e2e-garden-calm');
check(await walkTo(page, 'garden'), 'you can walk back out through the gate');
check((await game(page, () => window.oddments.game.held().filter((point) => point.x < 1000).length)) === 0, 'and from outside it is still calm: nobody has gone back into the bushes');
await page.waitForSelector('.placecard[data-spot="garden"]');
check(await S(page, () => document.querySelector('.placecard small').textContent.includes('Calm now, and it will stay calm') && document.querySelector('[data-act="enter"]').textContent.includes('Walk on in')), 'its card says it is calm, and will stay calm');
check(await S(page, () => document.querySelector('.placecard small').textContent.includes('A few are always wandering about in there') && document.querySelector('.placecard small').textContent.includes('Heirlooms come out more often among them')), 'and that a few wander about in there, among whom Heirlooms are likelier');
const visitsSoFar = (await state(page)).rooms.garden.visits;
check(await walkIn(page, 'garden') && (await state(page)).rooms.garden.visits === visitsSoFar + 1, 'you can walk back in');
s = await state(page);
const wandering = s.visit.groups.filter((group) => !group.done).length;
check(s.visit.stroll === true && wandering >= 1 && wandering <= 3 && s.visit.groups[4].foes.length === 0 && s.visit.groups[4].done, `it is a stroll: ${wandering} group${wandering === 1 ? '' : 's'} wandering, and no ringleader`);
check((await S(page, () => document.querySelector('#lane .where').textContent)) === `calm · ${wandering} wandering` && (await game(page, () => window.oddments.game.held().filter((point) => point.x < 1000 && !point.r).length)) === wandering, 'the heading says so, and only they hold any ground');
await page.waitForTimeout(500);
await snap(page, 'e2e-garden-stroll');
// Meet one of them, as a wanderer anywhere is met: walk up to it.
const wanderer = s.visit.groups.findIndex((group) => !group.done);
await onward(page, wanderer);
await idle(page);
check(await S(page, () => document.querySelector('.roundpill span').textContent.endsWith('· calm')) && (await page.$$('.unit.boss')).length === 0, 'the fight is with wanderers: no ringleader among them');
await botFight(page, { befriend: true });
check((await modalTitle(page)) === 'Won' || (await modalTitle(page)) === 'Home again', 'and it ends like any other, never as the place being calmed again');
await page.click('[data-id="next"]');
s = await state(page);
check(s.rooms.garden.clears === 1 && s.rooms.garden.calmed === 31, 'calming the garden is counted once, and its record stands');
await S(page, () => { window.oddments.game.goHome(); window.oddments.game.standBy('ines'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-person="ines"] [data-act="talk"].gold');
await page.click('[data-act="talk"]');
check((await hearOut(page)) === 3 && (await state(page)).story.ines === 2, 'she has news again, and hears about the garden');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'calm' && document.querySelector('.goalchip span').textContent === 'Calm Tin Can Alley (0 of 5)'), 'one place of eight is calm, and the goal moves on to the next');
await page.click('[data-act="goal"]');
check(await S(page, () => document.querySelector('.modal.journal .aim').textContent.includes('1 of 8 calm') && [...document.querySelectorAll('.modal.journal .sofar li')].some((li) => li.textContent === 'The Garden Gate is calm.')), 'and the journal has it down');
await snap(page, 'e2e-journal-calm');
await page.click('.modal [data-id="ok"]');

// =============================================================== the second place
section('Tin Can Alley');
await S(page, () => { window.oddments.game.standAt('alley'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="alley"]');
check(await S(page, () => document.querySelector('.placecard h2').textContent.includes('Tin Can Alley') && document.querySelector('[data-act="enter"]').textContent.includes('Walk on in')), 'with the garden calm, its barricade is down and its gate open');
check(await game(page, () => window.oddments.game.held().every((point) => !point.r)), 'nothing is left in the gateway');
await page.waitForTimeout(400);
await snap(page, 'e2e-alley-gate');
check(await walkIn(page, 'alley'), 'you walk in through the gate');
s = await state(page);
check(s.visit && s.visit.room === 'alley' && s.visit.stop === 0 && s.visit.groups.length === 5 && s.rooms.alley.visits === 1, 'and that begins a visit to it');
check(await S(page, () => document.querySelector('#lane h1').textContent === 'Tin Can Alley' && document.querySelector('#lane .where').textContent === '0 of 5 calmed'), 'the heading says so');
await page.waitForTimeout(500);
await snap(page, 'e2e-alley');
// Tap the far end of the alley, as a finger would. Whoever is nearest the gate fills it from wall to wall, so that is who you meet.
for (let tries = 0; tries < 30 && (await S(page, () => window.oddments.game.place())) !== 'fight'; tries++) {
  await tapToward(page, 'post:4');
  await page.waitForTimeout(500);
}
await page.waitForSelector('#fight', { timeout: 15000 });
check((await game(page, () => window.oddments.game.facing)) === 0, 'tapping the far end of the alley walks you into the first group: there is no going round');
await idle(page);
check(await S(page, () => document.querySelector('#fight img.bg').src.includes('bg_alley')), 'the fight is in the alley');
check(await S(page, () => window.oddments.sound().scene === 'clatter'), 'to the alley\'s own fight tune, not the garden\'s');
check((await battle(page)).units.filter((u) => u.side === 'foe').every((u) => ['cancrab', 'ratscal'].includes(u.species)), 'against the kinds that hang about its bins');
let alleyCalm = false;
let calls = 0;
let baronSeen = false;
const metInTurn = [];
while (!alleyCalm && calls < 8) {
  calls++;
  if (!(await state(page)).visit) await S(page, () => { window.oddments.game.travelTo('alley'); window.oddments.ctx.show('lane'); });
  while ((await state(page)).visit) {
    const index = (await state(page)).visit.stop;
    if ((await screen(page)) !== 'fight') await onward(page, index);
    await idle(page);
    if (calls === 1) metInTurn.push(await game(page, () => window.oddments.game.facing));
    if (index === 4 && !baronSeen) {
      baronSeen = true;
      const foes = (await page.$$('.unit.foe')).length;
      check((await page.$$('.unit.boss')).length === 1 && (foes === 2 || foes === 3), 'the Bandit Baron holds court at the far end, with one or two others');
      check(await S(page, () => document.querySelectorAll('.order .chip.foe img[src*="boss_baron"]').length === 2), 'and takes two turns a round');
      await snap(page, 'e2e-baron');
    }
    await botFight(page, { befriend: index < 4 });
    alleyCalm = (await modalTitle(page)) === 'All calm';
    await page.click('[data-id="next"]');
    await page.waitForTimeout(80);
  }
}
s = await state(page);
check(alleyCalm, `a sensible player calms the alley (took ${calls} visit${calls === 1 ? '' : 's'})`);
check(metInTurn.every((group, i) => group === i), 'meeting its groups in turn, from the gate up', metInTurn.join(' '));
check(s.rooms.alley.clears === 1 && s.rooms.alley.calmed === 31 && s.visit === null, 'calming it is recorded and the visit is over');
check(s.book.boss_baron.met && ['cancrab', 'sockgoblin', 'coothug'].filter((kind) => s.book[kind].met).length >= 2, 'the Baron is in the scrapbook, and so are kinds met nowhere else');
check((await where(page)).district === 'alley', 'you are still standing in the alley');
await page.waitForTimeout(400);
await snap(page, 'e2e-alley-calm');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'report'), 'the goal is to tell Ines Tock again');
await S(page, () => { window.oddments.game.standBy('ines'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-person="ines"] [data-act="talk"].gold');
await page.click('[data-act="talk"]');
check((await hearOut(page)) === 3 && (await state(page)).story.ines === 3, 'she hears about the alley');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'calm' && document.querySelector('.goalchip span').textContent === 'Calm the Midnight Pantry (0 of 5)'), 'two places are calm, and the goal is the third: the Midnight Pantry');
// One visit at a time: out calling on the garden, the card at the alley gate says to rest first.
await S(page, () => { window.oddments.game.travelTo('garden'); window.oddments.game.standAt('alley'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="alley"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').textContent.includes('still out calling on The Garden Gate')), 'while you are out calling on one place, the other tells you to rest first');
// And a place you walk into by its door says the same, in place of its button.
await S(page, () => { window.oddments.game.standAt('pantry'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="pantry"]');
check(await S(page, () => !document.querySelector('[data-act="inside"]') && document.querySelector('[data-act="enter"]').textContent.includes('still out calling on The Garden Gate')), 'and so does the door of the pantry');
await S(page, () => { window.oddments.game.goHome(); window.oddments.game.standAt('wash'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="wash"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').disabled && document.querySelector('[data-act="enter"]').textContent === 'Clear The Midnight Pantry first' && !document.querySelector('[data-act="inside"]')), 'the place after the pantry is shut until the pantry is calm, and says so');
await snap(page, 'e2e-house-cleared');

// =============================================================== strays
section('Strays, out on the lane');
{
  // (Home, rested, with the garden and the alley calm: everything above has been played.)
  await S(page, () => { const g = window.oddments.game; if (!g.rested()) g.goHome(); g.standAt('home'); window.oddments.ctx.show('lane'); });
  s = await state(page);
  const about = await game(page, () => window.oddments.game.strays());
  check(about.length >= 4 && about.length <= 7 && s.strays.length === about.length && s.worn === null, `a few strays are out in the world (${about.length} groups), and everyone is rested`);
  check((await screen(page)) === 'lane' && !(await page.$('#fight')), 'none of them starts anything while you stand at your own door');
  // Walk right across the lane, to a door on the far side: the way found goes round every one of them.
  const battlesBefore = s.stats.battles;
  check(await walkTo(page, 'alley'), 'you can walk from one side of the lane to the other');
  check((await state(page)).stats.battles === battlesBefore && (await screen(page)) === 'lane', 'and meet no stray on the way: nobody has to');
  // Now go and meet one: tap it, walk up, and the fight is on.
  const one = about[0];
  await S(page, (at) => { window.oddments.game.state.where = { x: at.x - 170, y: at.y + 60 }; window.oddments.ctx.show('lane'); }, one);
  await page.waitForTimeout(250);
  check(await game(page, () => window.oddments.game.strayNear()) === -1, 'standing a little way off one, you have not met it');
  const mark = await S(page, (index) => window.oddments.lane.screenOf(`stray:${index}`), one.index);
  await page.touchscreen.tap(mark.x, mark.y - 8);
  await page.waitForSelector('#fight', { timeout: 15000 });
  await idle(page);
  check(await S(page, () => document.querySelector('#fight img.bg').src.includes('bg_lane') && document.querySelector('.roundpill').textContent.includes('Out on the lane') && window.oddments.sound().scene === 'fight'), 'tap a stray and you walk up to it: the fight is out on the lane, against the lane\'s own painting');
  check((await S(page, () => document.querySelectorAll('.unit.foe').length)) === one.foes.length && (await S(page, () => document.querySelectorAll('.unit.boss').length)) === 0, 'against whoever was standing there, and no ringleader');
  await snap(page, 'e2e-stray-fight');
  await botFight(page, {});
  const strayTitle = await modalTitle(page);
  const strayWords = await S(page, () => document.querySelector('.modal.result .body').textContent);
  check(strayTitle === 'Won' && strayWords.includes('off home'), 'won, it says they are calm and off home', `${strayTitle}: ${strayWords.slice(0, 80)}`);
  await page.click('[data-id="next"]');
  await page.waitForSelector('#lane');
  s = await state(page);
  check(s.strays[one.index].done === true && s.visit === null && s.worn !== null && (await game(page, () => window.oddments.game.strays().length)) === about.length - 1, 'they are gone, no visit began, and the team is as worn as the fight left it');
  check(await game(page, () => window.oddments.game.teamHealth().every((member) => member.hp > 0 && member.hp <= member.max)), 'with a breather taken');
  // Home: the card offers a rest, and resting brings others out.
  await S(page, () => { window.oddments.game.standAt('home'); window.oddments.ctx.show('lane'); });
  await page.waitForSelector('.placecard[data-spot="home"] [data-act="rest"]');
  check(await S(page, () => document.querySelector('.placecard[data-spot="home"] small').textContent.includes('Other strays will be out')), 'at home there is a rest to be had, and it says other strays will be out');
  await snap(page, 'e2e-stray-rest');
  await page.click('.placecard[data-spot="home"] [data-act="rest"]');
  await page.waitForSelector('.placecard[data-spot="home"] [data-act="friends"]');
  s = await state(page);
  check(s.worn === null && s.strays.every((stray) => !stray.done) && s.strays.length >= 2, 'rested, everyone is fresh and a new lot of strays is out');
  // A reload keeps who is out and who has been met.
  const again = await game(page, () => window.oddments.game.strays()[0]);
  await S(page, (index) => { const g = window.oddments.game; g.state.strays[index].done = true; window.oddments.ctx.save(); }, again.index);
  await page.goto(`${base}?debug&fast`);
  await ready(page);
  s = await state(page);
  check(s.strays[again.index].done === true && s.strays.length >= 2, 'a reload keeps who is out on the lane, and who has been met');
}

// =============================================================== the country beyond the lane
section('The country beyond the lane');
{
  await S(page, () => { const g = window.oddments.game; if (!g.rested()) g.goHome(); g.standAt('home'); window.oddments.ctx.show('lane'); });
  check((await S(page, () => document.querySelector('#lane h1').textContent)) === 'The Lane', 'at home, the heading says you are on the lane');
  // South from the green, down Bramble Way, to the first door on Lampwick Row: a long walk, on foot, by tapping.
  const fightsBefore = (await state(page)).stats.battles;
  const seenOnTheWay = new Set();
  const namer = setInterval(async () => { try { seenOnTheWay.add(await S(page, () => document.querySelector('#lane h1') && document.querySelector('#lane h1').textContent)); } catch { /* between screens */ } }, 400);
  const arrived = await walkTo(page, 'wash');
  clearInterval(namer);
  check(arrived, 'you can walk from home all the way to the Wash, on Lampwick Row');
  check(seenOnTheWay.has('Bramble Way') && (await S(page, () => document.querySelector('#lane h1').textContent)) === 'Lampwick Row', 'the heading names each stretch as you come to it: Bramble Way, then Lampwick Row', [...seenOnTheWay].join(', '));
  s = await state(page);
  check(s.where.y > 3200 && s.stats.battles === fightsBefore && (await screen(page)) === 'lane', 'and nothing on the road made you fight: strays are there if you want them');
  check(await S(page, () => { const card = document.querySelector('.placecard'); return !card.hidden && card.dataset.spot === 'wash' && card.querySelector('h2').textContent.startsWith('The Wash'); }), 'at its door, the Wash has its card');
  await snap(page, 'e2e-lampwick-row');
  // The bench on the Row. Rested, it has nothing to offer; worn, it rests everyone as home does.
  await S(page, () => { window.oddments.game.standAtBench('row'); window.oddments.ctx.show('lane'); });
  await page.waitForSelector('.placecard[data-spot="bench"]');
  check(await S(page, () => { const card = document.querySelector('.placecard[data-spot="bench"]'); return card.querySelector('h2').textContent === 'A bench' && card.querySelector('[data-act="rest"]').disabled; }), 'by the bench its card comes up; rested, there is nothing to sit down for');
  await S(page, () => { const g = window.oddments.game; g.travelTo('garden'); g.state.visit.hp = Object.fromEntries(g.team().map((friend) => [friend.id, 2])); g.standAtBench('row'); window.oddments.ctx.show('lane'); });
  await page.waitForSelector('.placecard[data-spot="bench"] [data-act="rest"]:not([disabled])');
  check((await page.$$('.placecard[data-spot="bench"] .teamcard')).length === 3 && await S(page, () => document.querySelector('.placecard[data-spot="bench"] small').textContent.includes('the same as at home')), 'worn, it shows how everyone is and offers a sit down');
  await snap(page, 'e2e-bench');
  await page.click('.placecard[data-spot="bench"] [data-act="rest"]');
  await page.waitForSelector('.placecard[data-spot="bench"] [data-act="rest"][disabled]');
  s = await state(page);
  check(s.visit === null && s.worn === null && await game(page, () => window.oddments.game.teamHealth().every((member) => member.hp === member.max)), 'sit down, and everyone has their breath back, a long way from home');
  check(roomPictures('assets/world/r_bench.webp') && roomPictures('assets/world/r_signpost.webp') && roomPictures('assets/world/r_pond.webp'), 'the bench, the signposts and the ponds are paintings, fetched with the rest');
  // The map: opened from "What to do". Every place is on it, with how it stands.
  await page.click('.goalchip');
  await page.waitForSelector('.modal.journal [data-id="map"]');
  await page.click('.modal.journal [data-id="map"]');
  await page.waitForSelector('.modal.map canvas');
  const mapped = await S(page, () => {
    const m = document.querySelector('.modal.map');
    const canvas = m.querySelector('canvas');
    const box = canvas.getBoundingClientRect();
    const frame = m.getBoundingClientRect();
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colours = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 53) colours.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    return { places: m.dataset.places, tall: box.height, wide: box.width, fits: frame.top >= 0 && frame.bottom <= innerHeight && frame.left >= 0 && frame.right <= innerWidth, colours: colours.size, keys: m.querySelectorAll('.mapkey').length };
  });
  check(mapped.places.startsWith('home:home,garden:calm,alley:calm,pantry:open') && mapped.places.includes('dark:shut') && mapped.keys === 5, 'the map marks home and all eight places: two calm, the pantry open, the rest still shut', mapped.places);
  check(mapped.fits && mapped.tall > mapped.wide && mapped.colours > 12, `it is a picture of the whole world, taller than it is wide, and it fits the screen (${Math.round(mapped.wide)} x ${Math.round(mapped.tall)}, ${mapped.colours} colours)`);
  await snap(page, 'e2e-map');
  await page.click('.modal.map [data-id="ok"]');
  check(!(await page.$('.modal')), 'and it closes');
  await S(page, () => { window.oddments.game.standAt('home'); window.oddments.ctx.show('lane'); });
}

// =============================================================== going indoors
section('Going indoors: home');
const indoors = (p) => S(p, () => { const g = window.oddments.game; return { id: g.indoors(), at: g.state.indoors && { ...g.state.indoors }, near: g.near(), by: g.spotNear() && g.spotNear().id, shown: document.querySelector('#screen').dataset.indoors }; });
/** One tap toward something on the floor you are on: on it if it can be seen, else as near as a finger can get (above the card, below the heading). */
async function tapFloor(p, what) {
  const aim = await S(p, (id) => {
    const at = window.oddments.lane.screenOf(id);
    const box = document.querySelector('.lanecanvas').getBoundingClientRect();
    const card = document.querySelector('.placecard');
    const foot = card && !card.hidden ? card.getBoundingClientRect().top - 12 : box.bottom - 6;
    return { x: Math.min(box.right - 8, Math.max(box.left + 8, at.x)), y: Math.min(foot, Math.max(box.top + 150, at.y)) };
  }, what);
  await p.touchscreen.tap(aim.x, aim.y);
}
/** Walks across a floor to something on it, the way a finger would: by tapping toward it until you are standing by it. */
async function walkToThing(p, thing) {
  for (let tries = 0; tries < 30; tries++) {
    if ((await indoors(p)).by === thing) return true;
    await tapFloor(p, `thing:${thing}`);
    await p.waitForTimeout(450);
  }
  return (await indoors(p)).by === thing;
}
/** Walks to the door mat and so out, by tapping it. */
async function walkOut(p) {
  for (let tries = 0; tries < 30 && (await indoors(p)).id; tries++) {
    await tapFloor(p, 'door');
    await p.waitForTimeout(450);
  }
  await p.waitForSelector('#lane', { timeout: 8000 });
  return !(await indoors(p)).id;
}
await S(page, () => { window.oddments.game.standAt('home'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="home"] [data-act="inside"]');
check(await S(page, () => document.querySelector('[data-act="inside"]').textContent === 'Go inside' && !!document.querySelector('[data-act="friends"]')), 'at the door of home there is a way in, beside choosing your team');
await page.click('[data-act="inside"]');
await page.waitForSelector('#inside[data-room="home"]');
let inn = await indoors(page);
check(inn.id === 'home' && inn.shown === 'home' && (await screen(page)) === 'lane' && inn.near === 'home', 'Go inside, and you are indoors: on its floor, and in the world still at its door');
check(await S(page, () => document.querySelector('#inside h1').textContent === 'Home' && !document.querySelector('#tabs').hidden && document.querySelector('[data-tab="lane"]').classList.contains('on')), 'the heading says Home, and the tabs are still there');
check(await S(page, () => { const v = window.oddments.lane.view(); const box = document.querySelector('.lanecanvas').getBoundingClientRect(); return Math.abs(v.w * v.k - box.width) < 1 && v.w >= 620 - 0.5 && v.x <= 0.5; }), 'the whole width of the room is on the screen');
check(await S(page, () => {
  const canvas = document.querySelector('.lanecanvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const colours = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 97) colours.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
  return colours.size > 40;
}), 'and it is painted: wall, floor and furniture, not a blank');
await page.waitForTimeout(400);
await snap(page, 'e2e-home-inside');
// What there is to do in here: walk up to each thing and its card comes up.
check(await walkToThing(page, 'bed'), 'tapping the bed walks you to it');
check(await S(page, () => { const card = document.querySelector('.placecard'); return !card.hidden && card.dataset.thing === 'bed' && card.querySelector('h2').textContent === 'Your bed' && card.querySelector('[data-act="rest"]').disabled && !card.textContent.includes('null'); }), 'the bed: nothing to rest from, so it says everyone is rested');
check(await walkToThing(page, 'phone'), 'and to the telephone');
await page.click('[data-act="ring"]');
await page.waitForSelector('.modal.talk');
check(await S(page, () => document.querySelector('.modal.talk .talkname b').textContent === 'Great-aunt Maribel' && document.querySelector('.modal.talk .talkwords').textContent.includes('Calm the Midnight Pantry')), 'ring great-aunt Maribel and she reminds you what you were doing');
await hearOut(page);
check(await walkToThing(page, 'shelf'), 'and to the bookshelf');
await page.click('[data-act="book"]');
check((await screen(page)) === 'book', 'where the scrapbook opens');
await tab(page, 'lane');
check(!!(await page.$('#inside[data-room="home"]')), 'back on the Lane tab you are still indoors');
check(await walkToThing(page, 'basket'), 'and to the basket');
await page.click('[data-act="team"]');
check((await screen(page)) === 'friends', 'where the team is chosen');
await tab(page, 'lane');
// Indoors is kept across a reload, like everything else.
await S(page, () => window.oddments.ctx.save());
await page.reload();
await ready(page);
await page.waitForSelector('#inside[data-room="home"]');
inn = await indoors(page);
check(inn.id === 'home' && inn.by === 'basket', 'reload, and you are standing where you were, indoors');
check(await walkOut(page), 'tapping the door mat walks you to it, and out');
inn = await indoors(page);
check(inn.near === 'home' && (await S(page, () => document.querySelector('#lane h1').textContent)) === 'The Lane', 'and you are in the lane again, at the door you went in by');
// A tap on the building itself, from the lane, is asking to go in.
await S(page, () => { const g = window.oddments.game; g.state.where = { x: g.state.where.x - 120, y: g.state.where.y + 90 }; window.oddments.ctx.show('lane'); });
await page.waitForTimeout(300);
for (let tries = 0; tries < 12 && !(await indoors(page)).id; tries++) {
  const front = await S(page, () => { const at = window.oddments.lane.screenOf('home'); const k = document.querySelector('.lanecanvas').getBoundingClientRect().width / window.oddments.lane.view().w; return { x: at.x, y: at.y - 80 * k }; });
  await page.touchscreen.tap(front.x, front.y);
  await page.waitForTimeout(600);
}
await page.waitForSelector('#inside[data-room="home"]', { timeout: 8000 });
check((await indoors(page)).id === 'home', 'a tap on the front of the house walks you up to its door and in');
check((await S(page, () => window.oddments.sound().heard.door)) >= 1, 'with the sound of the door');
// Resting in your own bed, when there is something to rest from.
await S(page, () => { const g = window.oddments.game; g.leave(); g.travelTo('garden'); g.standAt('home'); g.enter('home'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('#inside[data-room="home"]');
check(await walkToThing(page, 'bed'), 'out calling on the garden, home, and to bed');
check(await S(page, () => { const card = document.querySelector('.placecard'); return card.querySelectorAll('.teamcard').length === 3 && !card.querySelector('[data-act="rest"]').disabled; }), 'the bed shows how everyone is, and offers a rest');
await page.click('[data-act="rest"]');
await page.waitForTimeout(200);
check((await state(page)).visit === null, 'which ends the visit, as resting at the door does');
await S(page, () => { window.oddments.game.leave(); window.oddments.ctx.show('lane'); });

section('Going indoors: the Midnight Pantry');
await S(page, () => { window.oddments.game.standAt('pantry'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-spot="pantry"] [data-act="inside"]');
check(await S(page, () => document.querySelector('.placecard h2').textContent.includes('The Midnight Pantry') && document.querySelector('[data-act="inside"]').textContent === 'Go in'), 'with the alley calm, the pantry is open, and its door has a way in');
await page.waitForTimeout(300);
await snap(page, 'e2e-pantry-door');
await page.click('[data-act="inside"]');
await page.waitForSelector('#inside[data-room="pantry"]');
s = await state(page);
check(s.indoors.id === 'pantry' && s.visit && s.visit.room === 'pantry' && s.visit.stop === 0 && s.visit.groups.length === 5 && s.rooms.pantry.visits === 1, 'going in begins a visit to it');
check(await S(page, () => document.querySelector('#inside h1').textContent === 'The Midnight Pantry' && document.querySelector('#inside .where').textContent === '0 of 5 calmed' && document.querySelectorAll('.placecard.slim .teamcard').length === 3), 'the heading says where you are and how it is going, and the team is listed');
await page.waitForTimeout(500);
await snap(page, 'e2e-pantry');
// Walk into the nearest group by tapping where it stands.
for (let tries = 0; tries < 30 && (await S(page, () => window.oddments.game.place())) !== 'fight'; tries++) {
  await tapFloor(page, 'post:0');
  await page.waitForTimeout(500);
}
await page.waitForSelector('#fight', { timeout: 15000 });
await idle(page);
check((await game(page, () => window.oddments.game.facing)) === 0 && await S(page, () => document.querySelector('#fight img.bg').src.includes('bg_pantry')), 'tapping a group walks you into it, and the fight is in the pantry');
check((await battle(page)).units.filter((u) => u.side === 'foe').every((u) => ['dumpling', 'jellywobble'].includes(u.species)), 'against kinds met nowhere else');
check(await S(page, () => window.oddments.sound().scene === 'fight'), 'to the scuffle: the pantry has no tune of its own yet');
await botFight(page, { befriend: true });
const wonFirst = (await modalTitle(page)) === 'Won';
await page.click('[data-id="next"]');
if (wonFirst) {
  await page.waitForSelector('#inside[data-room="pantry"]');
  s = await state(page);
  check(s.indoors.id === 'pantry' && s.visit.stop === 1 && s.visit.groups[0].done, 'win, and you are back on its floor with that group calm');
  // Step out part way through, and the door says you can go back in; the visit is still on.
  check(await walkOut(page), 'you can walk out in the middle of a visit');
  await page.waitForSelector('.placecard[data-spot="pantry"] [data-act="inside"]');
  check((await state(page)).visit.stop === 1 && await S(page, () => document.querySelector('[data-act="inside"]').textContent === 'Go back in'), 'and its door offers the way back in, with everything as you left it');
} else check(false, 'the stand-in wins the first fight in the pantry');
// Calm the whole place. (The stand-in is given the levels for it: this is about going indoors, not about the fights.)
await S(page, () => { for (const friend of window.oddments.game.state.friends) friend.level = Math.max(friend.level, 11); });
let pantryCalm = false;
let crumbwyrmSeen = false;
let toasterWords = null;
for (let calls = 0; calls < 6 && !pantryCalm; calls++) {
  if (!(await state(page)).visit) await S(page, () => { window.oddments.game.travelTo('pantry'); window.oddments.ctx.show('lane'); });
  else if (!(await indoors(page)).id) await S(page, () => { window.oddments.game.standAt('pantry'); window.oddments.game.enter('pantry'); window.oddments.ctx.show('lane'); });
  while ((await state(page)).visit) {
    const index = await S(page, () => window.oddments.game.nextGroup());
    await onward(page, index);
    await idle(page);
    if (index === 4 && !crumbwyrmSeen) {
      crumbwyrmSeen = true;
      check((await page.$$('.unit.boss')).length === 1 && await S(page, () => !!document.querySelector('.unit.boss img[src*="boss_crumbwyrm"]')) && await S(page, () => window.oddments.sound().scene === 'boss'), 'its ringleader, the Crumbwyrm, is at the far end, to a ringleader\'s tune');
      await snap(page, 'e2e-pantry-boss');
    }
    await botFight(page, { befriend: true });
    if ((await modalTitle(page)) === 'All calm') toasterWords = await S(page, () => { const right = document.querySelector('.modal.result .putright'); return right && { kind: right.dataset.kind, text: right.textContent, art: right.querySelector('img').src }; });
    await page.click('[data-id="next"]');
    await page.waitForTimeout(120);
  }
  pantryCalm = (await state(page)).rooms.pantry.clears > 0;
}
s = await state(page);
check(pantryCalm && s.rooms.pantry.calmed === 31 && s.book.boss_crumbwyrm.met, 'the pantry is calmed, and the Crumbwyrm is in the scrapbook');
check(!!toasterWords && toasterWords.kind === 'toastghost' && toasterWords.text.includes('Crumbwisp floats over to the toaster') && toasterWords.art.includes('toastghost'), 'and with it calm, something is put right for Crumbwisp, who was forgotten in that toaster', JSON.stringify(toasterWords));
check(['dumpling', 'pepperimp', 'eggknight', 'jellywobble'].filter((kind) => s.book[kind].met).length === 4, 'all four of its kinds have been met');
check(s.indoors && s.indoors.id === 'pantry' && !!(await page.$('#inside[data-room="pantry"]')) && (await S(page, () => document.querySelector('#inside .where').textContent)) === 'calm', 'you are still standing in it, and it says it is calm');
await page.waitForTimeout(400);
await snap(page, 'e2e-pantry-calm');
check(await walkOut(page), 'and you walk out');
await S(page, () => { window.oddments.game.standBy('ines'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('.placecard[data-person="ines"] [data-act="talk"].gold');
await page.click('[data-act="talk"]');
check((await hearOut(page)) === 3 && (await state(page)).story.ines === 4, 'Ines Tock hears about the pantry');
check(await S(page, () => document.querySelector('.goalchip').dataset.goal === 'calm' && document.querySelector('.goalchip span').textContent === 'Calm the Wash (0 of 5)'), 'three places of eight are calm, and the goal is the fourth');

// =============================================================== the five places after it, and the end
section('The rest of the lane, to the end');
// (The stand-in is given the levels for each: this is about every place being there to walk into and calm, and the
// story reaching its end. How hard each is, is the simulator's business.)
const LATER = [
  ['wash', 'The Wash', 'boss_spincycle', 'bg_wash', 'Calm the Dusty Stacks (0 of 5)'],
  ['stacks', 'The Dusty Stacks', 'boss_tome', 'bg_stacks', 'Calm Moonlit Rooftops (0 of 5)'],
  ['rooftops', 'Moonlit Rooftops', 'boss_warden', 'bg_rooftops', 'Calm the Tick-Tock Attic (0 of 5)'],
  ['attic', 'The Tick-Tock Attic', 'boss_clock', 'bg_attic', 'Calm the Roaring Dark (0 of 5)'],
  ['dark', 'The Roaring Dark', 'boss_vacuum', 'bg_dark', 'The lane is quiet (8 of 8)'],
];
for (const [room, name, boss, bg, goalAfter] of LATER) {
  await S(page, (id) => { const g = window.oddments.game; for (const friend of g.state.friends) friend.level = Math.max(friend.level, 26); g.standAt(id); window.oddments.ctx.show('lane'); }, room);
  await page.waitForSelector(`.placecard[data-spot="${room}"] [data-act="inside"]`);
  await page.click('[data-act="inside"]');
  await page.waitForSelector(`#inside[data-room="${room}"]`);
  s = await state(page);
  const painted = await S(page, () => {
    const canvas = document.querySelector('.lanecanvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colours = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 97) colours.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    return colours.size;
  });
  check(s.indoors.id === room && s.visit && s.visit.room === room && s.visit.groups.every((group) => group.foes.length >= 1) && (await S(page, () => document.querySelector('#inside h1').textContent)) === name && painted > 30, `${name}: its door opens, it has a floor of its own, and five groups are waiting on it`, `colours ${painted}`);
  await page.waitForTimeout(350);
  await snap(page, `e2e-${room}`);
  // Everyone but the ringleader is calmed by the rules alone; the ringleader is met and fought on the screen.
  await page.evaluate(async () => {
    const { playOut } = await import('./js/core/auto.js');
    const g = window.oddments.game;
    while (g.state.visit && g.state.visit.stop < 4) { playOut(g.startEncounter(), { befriend: true, have: g.state.friends.map((f) => f.species) }); g.finishBattle(); }
    window.oddments.ctx.show('lane');
  });
  s = await state(page);
  if (!s.visit || s.visit.room !== room || s.visit.stop !== 4) { check(false, `${name}: the stand-in calms its first four groups`); continue; }
  await onward(page, 4);
  await idle(page);
  check(await S(page, (want) => !!document.querySelector(`.unit.boss img[src*="${want.boss}"]`) && document.querySelector('#fight img.bg').src.includes(want.bg) && window.oddments.sound().scene === 'boss', { boss, bg }), `${name}: its ringleader is met at the far end, in front of its own painting`);
  await botFight(page, { befriend: true });
  const title = await modalTitle(page);
  const said = await S(page, () => document.querySelector('.modal.result .body').textContent);
  check(title === 'All calm' && said.includes(`${name} is calm!`) && (room === 'dark' ? said.includes('That is all eight') : said.includes('is next')), `${name}: calming it says so${room === 'dark' ? ', and that it is all eight' : ', and where is next'}`, `${title}: ${said.slice(0, 120)}`);
  // For two of the three you set out with, one of these places is where its story began.
  const right = await S(page, () => { const el = document.querySelector('.modal.result .putright'); return el ? `${el.dataset.kind}: ${el.textContent}` : ''; });
  if (room === 'wash') check(right.startsWith('sockeel:') && right.includes('Behind Machine Six there is a sock'), 'The Wash: Eelastic, who went into the wash as one of a pair, finds what it was looking for');
  else if (room === 'dark') check(right.startsWith('dustbunny:') && right.includes('sneezes on it'), 'The Roaring Dark: Hopmote walks up to the one thing it was frightened of');
  else check(right === '', `${name}: nothing of the kind is said where it does not belong`);
  await page.click('[data-id="next"]');
  await page.waitForSelector(`#inside[data-room="${room}"]`);
  check((await S(page, () => document.querySelector('#inside .where').textContent)) === 'calm' && (await state(page)).rooms[room].clears === 1, `${name}: and it stays calm`);
  // She is told face to face; except the news of the Dusty Stacks, which goes in the mailbox by its door.
  if (room === 'stacks') {
    await S(page, () => { const g = window.oddments.game; g.leave(); g.standAtMail(2); window.oddments.ctx.show('lane'); });
    await page.waitForSelector('.placecard[data-spot="mailbox"] [data-act="post"]:not([disabled])');
    check(await S(page, () => document.querySelector('.placecard[data-spot="mailbox"] h2').textContent === 'A mailbox' && document.querySelector('.goalchip').dataset.goal === 'report'), 'The Dusty Stacks: by the mailbox outside, there is a note to post');
    await page.click('[data-act="post"]');
    await page.waitForSelector('.modal.talk');
    check((await S(page, () => document.querySelector('.modal.talk .talkname b').textContent)) === 'Ines Tock', 'and Ines Tock answers by return');
  } else {
    await S(page, () => { window.oddments.game.standBy('ines'); window.oddments.ctx.show('lane'); });
    await page.waitForSelector('.placecard[data-person="ines"] [data-act="talk"].gold');
    await page.click('[data-act="talk"]');
  }
  const heard = await hearOut(page);
  check(heard === 3 && (await S(page, () => document.querySelector('.goalchip span').textContent)) === goalAfter, `${name}: Ines Tock hears of it, and the goal moves on: ${goalAfter}`);
}
s = await state(page);
check(Object.values(s.rooms).every((record) => record.clears === 1) && await S(page, () => document.querySelector('.goalchip').dataset.goal === 'more'), 'all eight places are calm: the lane is quiet');
check(['boss_spincycle', 'boss_tome', 'boss_warden', 'boss_clock', 'boss_vacuum'].every((id) => s.book[id].met), 'and every ringleader is in the scrapbook');
// Home, and the telephone: great-aunt Maribel hears the end of it.
await page.evaluate(async () => { const { INSIDES } = await import('./js/core/indoors.js'); const g = window.oddments.game; const phone = INSIDES.home.spots.find((spot) => spot.does === 'ring'); g.standAt('home'); g.enter('home'); g.state.indoors.x = phone.x; g.state.indoors.y = phone.y; window.oddments.ctx.show('lane'); });
await page.waitForSelector('#inside[data-room="home"] [data-act="ring"]');
await page.click('[data-act="ring"]');
await page.waitForSelector('.modal.talk');
check(await S(page, () => document.querySelector('.modal.talk .talkwords').textContent.includes('The lane is quiet')), 'ring great-aunt Maribel, and she knows the lane is quiet');
await hearOut(page);
// A calm place walked into at the end is a stroll, indoors as out.
await S(page, () => { const g = window.oddments.game; g.leave(); g.travelTo('attic'); window.oddments.ctx.show('lane'); });
await page.waitForSelector('#inside[data-room="attic"]');
s = await state(page);
check(s.visit.stroll === true && /^calm · [123] wandering$/.test(await S(page, () => document.querySelector('#inside .where').textContent)) && s.visit.groups[4].foes.length === 0, 'walk back into a calm place indoors and it is a stroll: a few wandering, no ringleader');
await S(page, () => { const g = window.oddments.game; g.goHome(); window.oddments.ctx.show('lane'); });

// =============================================================== heirlooms
section('Heirlooms');
// Find a new game whose very first fight has an Heirloom in it, the same way the game will roll it.
let rareSeed = 0;
for (let seed = 1; seed < 20000 && !rareSeed; seed++) {
  const probe = newState(Date.now(), seed);
  enterRoom(probe, 'garden'); // everyone is rolled as you step in
  if (probe.visit.groups[0].foes.some((foe) => foe.heirloom)) rareSeed = seed;
}
check(rareSeed > 0, `a seed whose first fight has an Heirloom exists (${rareSeed})`);
await page.goto(`${base}?debug&fast&reset&seed=${rareSeed}`);
await ready(page);
await begin(page);
await enterGarden(page);
check((await state(page)).visit.groups[0].foes.some((foe) => foe.heirloom), 'the Heirloom can be seen waiting before it is met');
await onward(page);
await idle(page);
b = await battle(page);
const rare = b.units.find((u) => u.side === 'foe' && u.heirloom);
check(!!rare, 'the Heirloom turns up in the browser as it did in the engine');
check(await S(page, (key) => document.querySelector(`[data-unit="${key}"] .sprite`).src.includes('_heirloom'), rare.key), 'it is drawn in its rare colours');
check(await S(page, (key) => document.querySelector(`[data-unit="${key}"]`).classList.contains('rare'), rare.key), 'and its name plate is gold');
check((await S(page, (key) => document.querySelectorAll(`[data-unit="${key}"] .pips i`).length, rare.key)) === SPECIES[rare.species].huff + HEIRLOOM.huff, 'it is one pip prouder');
await snap(page, 'e2e-heirloom');
await botFight(page, { befriend: true });
s = await state(page);
const kept = s.friends.find((f) => f.species === rare.species);
check(kept && kept.heirloom === true, 'calmed, it comes home in its colours');
await page.click('[data-id="next"]');
await restAtHome(page);
await tab(page, 'friends');
check(await S(page, (species) => document.querySelector(`.friend[data-species="${species}"] img`).src.includes('_heirloom') && !!document.querySelector(`.friend[data-species="${species}"] .heirloom`), rare.species), 'and is shown as an Heirloom among your friends');
await tab(page, 'book');
check(await S(page, (species) => !!document.querySelector(`[data-kind="${species}"] .stamp.gold`) && document.querySelector(`[data-kind="${species}"]`).classList.contains('rare'), rare.species), 'with a gold stamp in the scrapbook');
check(await S(page, () => document.querySelector('.card.hunt').dataset.kept === '1' && document.querySelector('.card.hunt').textContent.includes('1 of 40 kept')), 'and the hunt counts it: one of forty kept');
check(await S(page, (name) => !document.querySelector('[data-act="tofind"]').textContent.includes(`${name},`) && !document.querySelector('[data-act="tofind"]').textContent.endsWith(`${name}.`), SPECIES[rare.species].name), 'it is off the list of those still to find');
await snap(page, 'e2e-heirloom-book');
// Walking into a place where one is waiting, you are told (and hear it) before you have picked it out.
await S(page, () => { window.oddments.game.standAt('garden'); window.oddments.ctx.show('lane'); });
let glinted = false;
for (let tries = 0; tries < 400 && !glinted; tries++) {
  if ((await where(page)).district !== 'garden') { await tapToward(page, 'in:garden'); await page.waitForTimeout(450); }
  const visit = (await state(page)).visit;
  if (!visit) continue;
  if (visit.groups.some((group) => group.foes.some((foe) => foe.heirloom))) { glinted = !!(await page.$('.toast.gold')) && (await S(page, () => window.oddments.sound().heard.heirloom >= 1)); break; }
  // Nobody rare this time: rest and step in again, as someone looking for one would.
  await restAtHome(page);
  await S(page, () => { window.oddments.game.standAt('garden'); window.oddments.ctx.show('lane'); });
}
check(glinted, 'stepping in where an Heirloom waits, a gold notice says something is glinting, and it is heard');
await snap(page, 'e2e-heirloom-glint');

// =============================================================== damaged saves
section('Damaged and edited saves');
const good = await S(page, () => localStorage.getItem('oddments.save'));
// (The page saves itself as it is left; stop that first, or it would write the good save back over the damaged one.)
await S(page, () => { window.oddments.ctx.save = () => false; localStorage.setItem('oddments.save', '{"v":1,"friends":[{"id":1,"spec'); });
await page.goto(`${base}?debug&fast`);
await ready(page);
check(!!(await page.$('.modal.intro')), 'a save cut off half way starts a new game instead of breaking');
check((await S(page, () => localStorage.getItem('oddments.save.unreadable')))?.startsWith('{"v":1,"friends":[{"id":1,"spec'), 'and the damaged one is set aside, not thrown away');
const edited = JSON.parse(good);
edited.friends.push({ id: 1, species: 'boss_hydra', level: 99999 }, { id: 2, species: 'sockeel', level: 1e308, xp: -5 }, { id: 77, species: '<img src=x onerror=alert(1)>', level: 3 });
edited.friends[0].level = 1e9;
edited.team = [1, 1, 99, 'x'];
edited.player = { name: '<img src=x onerror=window.pwned=1>', look: 'javascript:alert(1)' };
edited.visit = { room: 'dark', stop: 99, groups: [{ done: true }], hp: { 1: 1e99 } };
edited.where = { x: 1e308, y: -4 };
await S(page, (json) => { window.oddments.ctx.save = () => false; localStorage.setItem('oddments.save', json); }, JSON.stringify(edited));
await page.goto(`${base}?debug&fast`);
await ready(page);
s = await state(page);
check(!(await page.$('#rescue')) && (await screen(page)) === 'lane', 'an edited save loads into a playable game');
check((await where(page)).near === 'home', 'standing somewhere real: an impossible position becomes the door of home');
check(s.friends.every((f) => SPECIES[f.species] && !SPECIES[f.species].boss && f.level >= 1 && f.level <= 40), 'with no boss for a friend and no impossible levels');
check(new Set(s.friends.map((f) => f.species)).size === s.friends.length && s.team.length === 3, 'one friend of each kind and a full team');
check(s.visit === null, 'and no visit to a room that is not built');
check((await S(page, () => window.pwned)) === undefined && (await S(page, () => document.querySelector('#lane .who b').textContent)).startsWith('<img src=x'), 'a name is only ever shown as text');
check(s.player.look === 'sitter_a', 'a made-up look falls back to the first');

// =============================================================== starting over
section('Starting over');
await tab(page, 'settings');
await snap(page, 'e2e-settings');
await page.click('[data-act="reset"]');
check((await modalTitle(page)) === 'Start over?', 'starting over asks first');
await page.click('[data-id="keep"]');
check((await state(page)).friends.length === s.friends.length, 'and can be backed out of');
await page.click('[data-act="reset"]');
await page.click('[data-id="erase"]');
await page.waitForSelector('.modal.intro', { timeout: 15000 });
s = await state(page);
check(s.friends.length === 3 && !s.started && s.rooms.garden.clears === 0, 'erasing gives a brand-new game');

// =============================================================== reading a fight
section('Reading a fight');
// Not played fast: the dust, the pages and the bubble are seen at their own pace. On a phone with a status bar.
const read = await newPage({ width: 393, height: 852 });
await read.goto(`${base}?debug&reset&seed=11`);
await ready(read);
await S(read, () => { document.documentElement.style.setProperty('--safe-top', '59px'); document.documentElement.style.setProperty('--safe-bottom', '34px'); });
await begin(read);
// The washing line, with two who will show both tags: one a Fluff move hurts more, one it hurts less.
await S(read, () => {
  const o = window.oddments;
  o.game.travelTo('garden');
  o.game.state.visit.groups[1].foes = [{ species: 'snailor', level: 2, heirloom: false }, { species: 'sparkplug', level: 2, heirloom: false }];
  o.game.approach(1);
  o.ctx.show('lane');
});
await tapToward(read, 'post:1');
await read.waitForSelector('canvas.shift', { timeout: 15000 });
check(await S(read, () => { const c = document.querySelector('canvas.shift').getBoundingClientRect(); return c.left <= 0 && c.top <= 0 && c.right >= innerWidth && c.bottom >= innerHeight; }) && (await screen(read)) === 'lane', 'walking into a group, dust billows up over the whole screen while the world is still behind it');
await read.waitForSelector('#fight', { timeout: 15000 });
check(!!(await read.$('canvas.shift')), 'the fight is set out behind the dust');
await read.waitForSelector('canvas.shift', { state: 'detached', timeout: 5000 });
let heardNow = (await S(read, () => window.oddments.sound())).heard;
check(heardNow.meet === 1 && heardNow.scuffle === 1 && heardNow.poof === 1, 'which clears to show it: a sting, a scuffle and a puff are heard', JSON.stringify(heardNow));

// Before the very first fight, how a fight works.
await read.waitForSelector('.modal.howto');
check((await S(read, () => document.querySelector('#fight').dataset.busy)) === '1' && (await state(read)).seen.fights === true, 'before your very first fight, how a fight works is explained, and the fight waits');
check(await S(read, () => {
  const m = document.querySelector('.modal.howto');
  return m.dataset.page === '1/3' && m.querySelectorAll('.elring .ringchip').length === 7 && m.querySelector('.edge.strong').textContent === 'Hurts more' && m.querySelector('.edge.weak').textContent === 'Hurts less'
    && m.textContent.includes('50% more damage') && m.textContent.includes('30% less damage');
}), 'first the ring of elements, and what the two tags over a target mean, in numbers');
const pageFits = () => S(read, () => { const m = document.querySelector('.modal.howto'); const r = m.getBoundingClientRect(); const b = m.querySelector('.body'); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && b.scrollHeight <= b.clientHeight + 1; });
let pagesFit = await pageFits();
await snap(read, 'e2e-howto');
await read.click('.modal.howto [data-id="next"]');
check(await S(read, () => { const m = document.querySelector('.modal.howto'); return m.dataset.page === '2/3' && m.textContent.includes('Huff') && m.textContent.includes('Reach out takes 2 pips off (3 ') && m.querySelectorAll('.howkin .pips i').length === 3; }), 'then making friends: the pips, and what Reach out does to them');
pagesFit = pagesFit && await pageFits();
await read.click('.modal.howto [data-id="next"]');
check(await S(read, () => { const m = document.querySelector('.modal.howto'); return m.dataset.page === '3/3' && m.querySelectorAll('.howcall').length === 3 && m.querySelector('[data-id="next"]').textContent === 'Got it'; }), 'then your own part: the three Calls');
pagesFit = pagesFit && await pageFits();
check(pagesFit, 'every page fits the screen without scrolling');
await read.click('.modal.howto [data-id="next"]');
await read.waitForSelector('#fight[data-busy="0"]', { timeout: 30000 });
check(!(await read.$('.modal.howto')), 'and with that read, the fight begins');

// The tags over targets: what the move will do to them, in words that cannot be read the other way round.
const mover = await S(read, () => window.oddments.game.choices().unit.species);
await read.click('[data-move="lintflurry"]');
await read.waitForTimeout(150);
const tags = await S(read, () => [...document.querySelectorAll('.unit.foe')].map((u) => { const e = u.querySelector('.edge'); const r = e.getBoundingClientRect(); return { text: e.hidden ? '' : e.textContent, left: r.left, right: r.right, bottom: r.bottom, head: u.querySelector('.sprite').getBoundingClientRect().top }; }));
check(mover === 'dustbunny' && tags.length === 2 && tags[0].text === 'Hurts more' && tags[1].text === 'Hurts less', 'choosing who to hit, each is tagged with what the move will do to it: "Hurts more", "Hurts less"', JSON.stringify(tags));
const inRow = [...tags].sort((a, b) => a.left - b.left);
check(tags.every((t) => t.bottom <= t.head + 0.5 && t.left >= 0 && t.right <= 393) && inRow[0].right <= inRow[1].left, 'the tags sit above their heads, not on them, and do not touch each other', JSON.stringify(tags));
await snap(read, 'e2e-tags');
await read.click('[data-act="cancel"]');

// Reach out to one that is not ready.
const before = (await battle(read)).units.find((u) => u.key === 'f0').huff;
await read.click('[data-call="reach"]');
await read.click('[data-unit="f0"]');
await read.waitForSelector('.float.bubble');
await read.waitForTimeout(320);
const said = await S(read, () => {
  const b = document.querySelector('.float.bubble').getBoundingClientRect();
  const unit = document.querySelector('[data-unit="f0"]');
  return { text: document.querySelector('.float.bubble').textContent, foot: b.bottom + 8, head: unit.querySelector('.sprite').getBoundingClientRect().top, left: b.left, right: b.right, turned: unit.classList.contains('refuse'), say: document.querySelector('.say').textContent };
});
check(said.text === 'Not yet!' && said.turned, 'reached, and not ready to come: it turns its back and says "Not yet!"', JSON.stringify(said));
check(said.foot <= said.head + 0.5 && said.left >= 0 && said.right <= 393, 'in a bubble above its head: clear of it, tail and all, and on the screen', JSON.stringify(said));
check(said.say === `${SPECIES.snailor.name} ${SPECIES.snailor.notYet}.`, 'and the line says how its kind says no', said.say);
await snap(read, 'e2e-notyet');
await read.waitForSelector('#fight[data-busy="0"]', { timeout: 30000 });
const after = (await battle(read)).units.find((u) => u.key === 'f0').huff;
check(after > 0 && after < before && (await S(read, () => document.querySelector('.say').textContent)) === `${after} more pip${after === 1 ? '' : 's'} to go. ${SPECIES.dustbunny.name}'s turn.`, 'then how far there is to go, and that the turn is still yours');
heardNow = (await S(read, () => window.oddments.sound())).heard;
check(heardNow.notyet === 1 && heardNow.pip === 1, 'both heard: the pips coming off, and its "uh-uh"');
// The explanation can be read again from the fight's menu, and is not shown unasked a second time.
await read.click('[data-act="menu"]');
await read.click('.modal.menu [data-id="howto"]');
check(!!(await read.$('.modal.howto')) && !(await read.$('.modal.menu')), 'the fight\'s menu opens the explanation again');
await read.click('.modal.howto .x');
await S(read, () => { window.oddments.game.concede(); window.oddments.game.finishBattle(); window.oddments.game.travelTo('garden'); window.oddments.game.startEncounter(0); window.oddments.ctx.show('fight'); });
await read.waitForSelector('#fight[data-busy="0"]', { timeout: 30000 });
check(!(await read.$('.modal.howto')), 'a second fight starts straight away, with no explanation');

// The top of the map, on a phone whose status bar pushes the heading down: it all comes out from under.
await S(read, () => {
  const o = window.oddments;
  o.game.concede(); o.game.finishBattle();
  o.game.travelTo('garden');
  o.game.state.where = { x: o.game.state.where.x, y: 52 };
  o.ctx.show('lane');
});
await read.waitForTimeout(500);
const top = await S(read, () => {
  const v = window.oddments.lane.view();
  const box = document.querySelector('.lanecanvas').getBoundingClientRect();
  const k = box.width / v.w;
  return { edge: box.top + (0 - v.y) * k, head: window.oddments.lane.screenOf('me').y - 96 * k, chip: document.querySelector('.goalchip').getBoundingClientRect().bottom, who: document.querySelector('#lane .who').getBoundingClientRect().bottom };
});
check(top.chip > 130 && top.edge >= top.chip && top.head >= top.chip && top.edge >= top.who, 'at the very top of the map, the edge of the world and your own head are clear of the heading, your name and the goal', JSON.stringify(top));
await snap(read, 'e2e-top');
await read.context().close();

// =============================================================== other phones
section('Other screen sizes');
// (iPhone Duo's point sizes are not published by Apple; these assume three pixels to a point on the outer screen and
// the size one developer measured the inner one drawing at. The game does not depend on the exact numbers.)
for (const [name, viewport] of [
  ['small phone (320x568)', { width: 320, height: 568 }], ['iPhone SE (375x667)', { width: 375, height: 667 }], ['large phone (430x932)', { width: 430, height: 932 }],
  ['folding phone, closed (466x678)', { width: 466, height: 678 }], ['folding phone, open (669x951)', { width: 669, height: 951 }],
]) {
  const other = await newPage(viewport);
  await other.goto(`${base}?debug&fast&reset&seed=7`);
  await ready(other);
  await other.click('[data-id="begin"]');
  await other.waitForSelector('.modal.talk');
  await other.waitForTimeout(300);
  const fitsTalk = await S(other, () => { const r = document.querySelector('.modal.talk').getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  await hearOut(other);
  await other.waitForSelector('.modal.three');
  await other.click('.modal.three [data-id="next"]');
  await other.waitForTimeout(120);
  const fitsThree = await S(other, () => { const m = document.querySelector('.modal.three'); const r = m.getBoundingClientRect(); const b = m.querySelector('.body'); return document.documentElement.scrollWidth <= innerWidth && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.scrollHeight <= b.clientHeight + 1; });
  check(fitsThree, `${viewport.width}x${viewport.height}: the page about one of the three fits the screen`);
  for (let pages = 0; pages < 9 && await other.$('.modal.three'); pages++) { await other.click('.modal.three [data-id="next"]'); await other.waitForTimeout(40); }
  await other.waitForTimeout(300);
  const fitsGoal = await S(other, () => { const r = document.querySelector('.goalchip').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height < 40; });
  const fitsHome = await S(other, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#tabs').getBoundingClientRect().bottom <= innerHeight + 0.5 && document.querySelector('[data-act="friends"]').getBoundingClientRect().bottom <= document.querySelector('#tabs').getBoundingClientRect().top + 0.5);
  await enterGarden(other);
  await other.waitForSelector('.placecard.slim');
  await other.waitForTimeout(400); // the card slides up into place; measure it once it has landed
  const fitsPath = await S(other, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.placecard.slim').getBoundingClientRect().bottom <= document.querySelector('#tabs').getBoundingClientRect().top + 0.5 && document.querySelector('.placecard.slim').getBoundingClientRect().height < innerHeight * 0.25);
  await onward(other);
  await idle(other);
  await other.waitForTimeout(500); // the fight screen arrives with a short zoom; measure it once it has landed
  const fitsFight = await S(other, () => {
    const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.top >= -0.5; };
    return document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.move, .call, .unit, .order')].every(inside);
  });
  check(fitsTalk && fitsGoal && fitsHome && fitsPath && fitsFight, `everything fits on a ${name}`, `talk ${fitsTalk} goal ${fitsGoal} home ${fitsHome} path ${fitsPath} fight ${fitsFight}`);
  await snap(other, `e2e-size-${viewport.width}`);
  await other.context().close();
}

// =============================================================== the loading screen
section('The loading screen');
const opening = await newPage();
// (The room paintings are held back a moment, so the screen can be looked at while its bar is filling.)
await opening.route('**/assets/bg/**', async (route) => { await new Promise((resolve) => setTimeout(resolve, 600)); route.continue(); });
const opened = Date.now();
await opening.goto(`${base}?debug&reset&seed=7`, { waitUntil: 'domcontentloaded' });
await opening.waitForFunction(() => { const scene = document.querySelector('#boot .bootscene'); return !!scene && scene.complete && scene.naturalWidth > 0; });
check(await S(opening, () => document.querySelector('#boot .bootscene').src.endsWith('assets/boot/lane.webp') && document.querySelector('#boot .bootscene').naturalWidth === document.querySelector('#boot .bootscene').naturalHeight), 'the loading screen is a postcard of the lane, painted from the game');
check(await S(opening, () => { const r = document.querySelector('#boot .bootscene').getBoundingClientRect(); const style = getComputedStyle(document.querySelector('#boot .bootscene')); return r.left <= 0.5 && r.top <= 0.5 && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5 && style.objectFit === 'cover' && style.animationName === 'boot-drift'; }), 'it fills the screen from its middle, as the iPhone launch image does, and drifts slowly toward the cottage');
check(await S(opening, () => document.querySelectorAll('#boot .boottitle span').length === 10 && document.querySelector('#boot .boottitle').textContent === 'Clutterkin' && document.querySelector('#boot .boottag').textContent === 'The house is awake.' && document.querySelectorAll('#boot .bootfly').length === 7), 'with the name over it, and fireflies');
check(await S(opening, () => [...document.querySelectorAll('#boot .boottitle span, #boot .boottag, #boot .bootbar, #bootline')].every((el) => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5; })), 'and everything written on it fits the screen');
await opening.waitForFunction(() => parseInt(document.querySelector('#bootfill') ? document.querySelector('#bootfill').style.width : '100', 10) > 0);
check(await S(opening, () => !document.querySelector('#bootline') || /…$/.test(document.querySelector('#bootline').textContent)), 'it says what is being got ready');
await opening.screenshot({ path: `${OUT}e2e-loading.png` });
await ready(opening);
const shownFor = Date.now() - opened;
check(shownFor >= 1100, `it is seen for a moment, not flashed past (${shownFor} ms)`);
await opening.waitForTimeout(900);
check(await S(opening, () => !document.querySelector('#boot') && !!document.querySelector('.modal.intro')), 'and then it is gone, and the game begins');
await opening.context().close();

// =============================================================== sound
// (A test cannot listen. It can read what the sound code says it is doing: whether the audio clock is
// running, which tune is playing, and how often each effect has been asked for.)
section('Sound');
const loud = await newPage();
await loud.goto(`${base}?debug&fast&reset&seed=7`);
await ready(loud);
const sounding = (p) => S(p, () => window.oddments.sound());
let snd = await sounding(loud);
check(snd.running === false && snd.playing === false, 'nothing sounds before the first touch');
check(snd.effects === true && snd.music === true, 'sound effects and music are both on to begin with');
await loud.click('[data-id="begin"]');
await loud.waitForSelector('.modal.talk');
await loud.waitForTimeout(300);
snd = await sounding(loud);
check(snd.running && snd.playing && snd.scene === 'world', 'after it the lullaby plays');
check(snd.heard.ring === 1 && snd.heard.talk === 1 && snd.heard.tap >= 1, 'the phone rings, great-aunt Maribel has a voice, and a button its tap', JSON.stringify(snd.heard));
await hearOut(loud);
check((await sounding(loud)).heard.talk === 4, 'a voice for every line she says');
await meetThree(loud);
await walkUpTo(loud, 'ines');
check((await sounding(loud)).heard.step >= 3, 'footsteps as you walk');
await S(loud, () => { window.oddments.game.standAt('alley'); window.oddments.ctx.show('lane'); });
await loud.waitForTimeout(300);
await tapToward(loud, 'in:alley');
await loud.waitForTimeout(200);
check((await sounding(loud)).heard.nope === 1, 'a tap on the barricade gets the sound of something that will not budge');
await S(loud, () => { window.oddments.game.standAt('garden'); window.oddments.ctx.show('lane'); });
check(await walkIn(loud, 'garden'), 'walking in through the garden gate');
await loud.waitForTimeout(200);
check((await sounding(loud)).heard.gate === 1, 'the gate is heard');
await onward(loud);
snd = await sounding(loud);
check(snd.heard.meet === 1 && snd.scene === 'fight' && snd.playing, 'meeting a group has its sting, and the music changes to the scuffle');
await idle(loud);
await botFight(loud, {});
snd = await sounding(loud);
check(snd.heard.use >= 2 && (snd.heard.hit || 0) + (snd.heard.strong || 0) + (snd.heard.weak || 0) >= 2, 'moves and hits are heard', JSON.stringify(snd.heard));
check((snd.heard.win || 0) + (snd.heard.lose || 0) === 1, 'and so is how it ended');
await loud.click('[data-id="next"]');
await loud.waitForTimeout(200);
check((await sounding(loud)).scene === 'world', 'back in the world, the lullaby again');
await tab(loud, 'settings');
check((await loud.$$('#settings .switch')).length === 3 && await S(loud, () => document.querySelector('[data-act="sound"]').classList.contains('on') && document.querySelector('[data-act="music"]').classList.contains('on')), 'Settings has a switch for sound effects and one for music, both on');
await loud.click('[data-act="music"]');
await loud.waitForTimeout(200);
snd = await sounding(loud);
check(snd.music === false && snd.playing === false && snd.effects === true, 'music off stops the tune and leaves the effects');
await loud.click('[data-act="sound"]');
snd = await sounding(loud);
check(snd.effects === false && (await state(loud)).settings.sound === false && (await state(loud)).settings.music === false, 'sound effects off, and both are remembered');
await loud.goto(`${base}?debug&fast`);
await ready(loud);
await tab(loud, 'settings');
snd = await sounding(loud);
check(snd.effects === false && snd.music === false && await S(loud, () => !document.querySelector('[data-act="sound"]').classList.contains('on')), 'after a reload they are still off');
check(snd.running === true && snd.playing === false, 'so a touch wakes the audio but nothing plays');
await loud.click('[data-act="music"]');
await loud.waitForTimeout(300);
check((await sounding(loud)).playing === true, 'and music comes back the moment it is switched on');
await loud.context().close();

// =============================================================== a folding phone
section('A folding phone, opened and closed in the middle of things');
const CLOSED = { width: 466, height: 678 };
const OPEN = { width: 669, height: 951 };
const fold = await newPage(CLOSED);
await fold.goto(`${base}?debug&fast&reset&seed=7`);
await ready(fold);
await begin(fold);
await fold.waitForTimeout(300);
const fills = (p) => S(p, () => {
  const app = document.querySelector('#app').getBoundingClientRect();
  const canvas = document.querySelector('.lanecanvas');
  const box = canvas ? canvas.getBoundingClientRect() : app;
  return Math.abs(app.width - innerWidth) < 1 && Math.abs(box.width - innerWidth) < 1 && document.documentElement.scrollWidth <= innerWidth;
});
const fightFits = (p) => S(p, () => {
  const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.top >= -0.5; };
  return document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.move, .call, .unit, .order')].every(inside);
});
const shut = await view(fold);
const stoodAt = await where(fold);
check(await fills(fold), 'closed, the game fills the screen from edge to edge');
await fold.setViewportSize(OPEN);
await fold.waitForTimeout(500);
const wide = await view(fold);
check(await fills(fold), 'opened, it fills the bigger screen too: no bars down the sides');
check(wide.w > shut.w + 150 && wide.h > shut.h, `and shows more of the world, not the same view blown up (${Math.round(shut.w)} units across, then ${Math.round(wide.w)})`);
const still = await where(fold);
check(still.x === stoodAt.x && still.y === stoodAt.y && still.near === 'home', 'you are standing where you were');
check(wide.x < still.x && still.x < wide.x + wide.w && wide.y < still.y && still.y < wide.y + wide.h, 'and still in view');
await fold.waitForTimeout(200);
await snap(fold, 'e2e-fold-open');
check(await walkUpTo(fold, 'ines'), 'walking works as before on the open screen');
// Into a fight, then close the phone half way through it.
await enterGarden(fold);
await onward(fold);
await idle(fold);
await fold.waitForTimeout(500);
check(await fightFits(fold), 'a fight fits the open screen');
check(await S(fold, () => getComputedStyle(document.querySelector('.moves')).gridTemplateColumns.split(' ').length === 2 && getComputedStyle(document.querySelector('.move .long')).display !== 'none'), 'with the moves two to a row and all their words');
await snap(fold, 'e2e-fold-fight-open');
check(await botTurn(fold, {}), 'a move can be made');
await idle(fold);
const midFight = await battle(fold);
await fold.setViewportSize(CLOSED);
await fold.waitForTimeout(500);
check(await fightFits(fold), 'closed in the middle of the fight, everything still fits');
const afterFold = await battle(fold);
check(afterFold.round === midFight.round && JSON.stringify(afterFold.units.map((u) => u.hp)) === JSON.stringify(midFight.units.map((u) => u.hp)), 'and the fight is exactly where it was');
await snap(fold, 'e2e-fold-fight-closed');
await botFight(fold, {});
await fold.click('[data-id="next"]');
await fold.waitForTimeout(300);
await fold.setViewportSize(OPEN);
await fold.waitForTimeout(500);
check((await screen(fold)) === 'lane' && await fills(fold), 'opened again afterwards, you are back in the world and it fills the screen');
await tab(fold, 'book');
check(await S(fold, () => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length === 4), 'the scrapbook has four to a row on the open screen');
await fold.setViewportSize(CLOSED);
await fold.waitForTimeout(300);
check(await S(fold, () => getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length === 3), 'and three closed');
await fold.context().close();

// =============================================================== the page keeps to itself
section('Nothing leaves the device');
const foreign = requests.filter((url) => !url.startsWith(base));
check(foreign.length === 0, 'every request the game made was for one of its own files', foreign.slice(0, 3).join(' '));
check(requests.length > 40, `(${requests.length} requests watched)`);
const roomPaintings = readdirSync(new URL('../../web/assets/rooms/', import.meta.url));
check(roomPaintings.length === 98 && roomPaintings.every((file) => requests.some((url) => url.endsWith(`assets/rooms/${file}`))), `every painting of every room was fetched (${roomPaintings.length} of them)`);
check(errors.length === 0, 'no errors, and nothing refused by the content security policy', errors.slice(0, 5).join(' | '));

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
for (const what of failures) console.log(`FAILED: ${what}`);
process.exit(failed ? 1 : 0);
