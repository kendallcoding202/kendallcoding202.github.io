// End-to-end test: plays the real game in a headless browser, from first
// launch through walking the lane, a fight, a new friend, the whole first
// room, a reload and damaged saves.
// node tests/e2e/run.mjs        (exit code 1 on any failure)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from '../../tools/serve.mjs';
import { newState } from '../../web/js/core/state.js';
import { enterRoom } from '../../web/js/core/rooms.js';
import { SPECIES, HEIRLOOM } from '../../web/js/core/balance.js';
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

function check(ok, what, detail = '') {
  if (ok) { passed++; console.log(`  ok    ${what}`); }
  else { failed++; console.log(`  FAIL  ${what} ${detail}`); }
}
const section = (name) => console.log(`\n${name}`);

async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => requests.push(r.url()));
  return page;
}
const ready = (page) => page.waitForSelector('#app:not([hidden])');
const S = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => S(page, () => JSON.parse(JSON.stringify(window.oddments.game.state)));
const battle = (page) => S(page, () => { const b = window.oddments.game.battle; return b && JSON.parse(JSON.stringify({ ...b, dice: null, events: null })); });
const screen = (page) => S(page, () => document.querySelector('#screen').dataset.screen);
const idle = (page) => page.waitForSelector('#fight[data-busy="0"], .modal.result', { timeout: 30000 });
const tab = async (page, id) => { await page.click(`[data-tab="${id}"]`); await page.waitForTimeout(120); };
const modalTitle = (page) => S(page, () => document.querySelector('.modal header span')?.textContent || null);
const snap = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

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
await page.waitForTimeout(200);
let s = await state(page);
check(s.started && s.player.name === 'Marisol' && s.player.look === 'sitter_c', 'the house-sitter takes the chosen name and look');
check(!(await page.$('.modal')), 'the intro closes');
check((await S(page, () => document.querySelector('#lane .who b').textContent)) === 'Marisol', 'the name shows in the lane');
check(await S(page, () => document.querySelector('#lane .who img').src.includes('sitter_c')), 'and so does the look');

// =============================================================== the lane
section('The lane (the open world)');
const where = (p) => S(p, () => ({ ...window.oddments.game.state.where, near: window.oddments.game.near() }));
/** Walks to a place the way a finger would: by tapping toward its door until you are standing at it. */
async function walkTo(p, id) {
  for (let tries = 0; tries < 30; tries++) {
    if ((await where(p)).near === id) return true;
    const aim = await S(p, (spot) => {
      const at = window.oddments.lane.screenOf(spot);
      const box = document.querySelector('.lanecanvas').getBoundingClientRect();
      return { x: Math.min(box.right - 8, Math.max(box.left + 8, at.x)), y: Math.min(box.bottom - 8, Math.max(box.top + 70, at.y)) };
    }, id);
    await p.touchscreen.tap(aim.x, aim.y);
    await p.waitForTimeout(450);
  }
  return (await where(p)).near === id;
}
/** Goes straight to the garden door (the engine's shortcut) and walks in. */
async function enterGarden(p) {
  await S(p, () => { window.oddments.game.standAt('garden'); window.oddments.ctx.show('lane'); });
  await p.click('.placecard[data-spot="garden"] [data-act="enter"]');
}
check(await S(page, () => {
  const canvas = document.querySelector('.lanecanvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const colours = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 997) colours.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
  return colours.size > 12;
}), 'the lane is drawn');
let at = await where(page);
check(at.near === 'home' && (await S(page, () => document.querySelector('.placecard').dataset.spot)) === 'home', 'you start at the door of home');
check(await S(page, () => !document.querySelector('#tabs').hidden), 'the tabs show out in the lane');
check((await S(page, () => window.oddments.game.enterRoom('garden'))) === false, 'a room cannot be walked into from somewhere else');
await snap(page, 'e2e-lane');
check(await walkTo(page, 'garden'), 'tapping walks you to the garden gate');
const moved = await where(page);
check(Math.hypot(moved.x - at.x, moved.y - at.y) > 150, 'by actually crossing the ground between');
await page.waitForSelector('.placecard[data-spot="garden"]');
check(await S(page, () => document.querySelector('.placecard h2').textContent.includes('The Garden Gate') && !document.querySelector('[data-act="enter"]').disabled), 'standing at its door offers the way in');
check((await state(page)).seen.walked === true && await S(page, () => document.querySelector('.lanehint').hidden), 'the walking hint goes once you have walked');
await snap(page, 'e2e-lane-garden');
check(await walkTo(page, 'alley'), 'you can walk on to a place that is not built yet');
await page.waitForSelector('.placecard[data-spot="alley"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').disabled && document.querySelector('[data-act="enter"]').textContent === 'Not built yet'), 'but its door is locked');
check((await S(page, () => window.oddments.game.enterRoom('alley'))) === false, 'and the game cannot be told otherwise');
at = await where(page);
await page.goto(`${base}?debug&fast`);
await ready(page);
const again = await where(page);
check(Math.abs(again.x - at.x) < 1 && Math.abs(again.y - at.y) < 1 && again.near === 'alley', 'a reload leaves you standing where you were');
check(await walkTo(page, 'garden'), 'and you can walk back');
await page.click('.placecard[data-spot="garden"] [data-act="enter"]');
check((await screen(page)) === 'path', 'Walk in opens the path');
check(await S(page, () => document.querySelector('#tabs').hidden), 'the tabs are put away inside a place');

// =============================================================== inside a place
section('Inside the garden');
/** Walks straight up to whoever is waiting (the engine's shortcut); the screen notices and the fight starts. */
async function onward(p) {
  await S(p, () => window.oddments.game.approach());
  // Nothing starts until you move: one tap toward them is the step that walks you in.
  const aim = await S(p, () => {
    const to = window.oddments.lane.screenOf('next');
    const box = document.querySelector('.lanecanvas').getBoundingClientRect();
    return { x: Math.min(box.right - 8, Math.max(box.left + 8, to.x)), y: Math.min(box.bottom - 8, Math.max(box.top + 70, to.y)) };
  });
  await p.touchscreen.tap(aim.x, aim.y);
  await p.waitForSelector('#fight', { timeout: 15000 });
}
s = await state(page);
check(await S(page, () => window.oddments.game.atGate()) && s.visit.stop === 0, 'you come in at the gate');
check(await S(page, () => document.querySelector('#lane').classList.contains('inside') && document.querySelector('#lane h1').textContent === 'The Garden Gate'), 'and are inside the garden, not on a menu');
check(s.visit.waiting.length >= 1 && await S(page, () => document.querySelector('.placecard').dataset.stop === '0' && document.querySelector('.placecard h2').textContent.includes('By the Gate')), 'whoever is at the first stop is already waiting');
check((await page.$$('.teamcard')).length === 3, 'the team of three is listed');
check(await S(page, () => [...document.querySelectorAll('.teamcard .bar i')].every((i) => i.style.width === '100%')), 'everyone sets out rested');
await snap(page, 'e2e-inside');
const stood = s.visit.at;
// Walk up to them by tapping where they stand, as a finger would.
for (let tries = 0; tries < 25 && (await S(page, () => window.oddments.game.place())) !== 'fight'; tries++) {
  const aim = await S(page, () => {
    const to = window.oddments.lane.screenOf('next');
    const box = document.querySelector('.lanecanvas').getBoundingClientRect();
    return { x: Math.min(box.right - 8, Math.max(box.left + 8, to.x)), y: Math.min(box.bottom - 8, Math.max(box.top + 70, to.y)) };
  });
  await page.touchscreen.tap(aim.x, aim.y);
  await page.waitForTimeout(500);
}
await page.waitForSelector('#fight', { timeout: 15000 });
s = await state(page);
check(Math.hypot(s.visit.at.x - stood.x, s.visit.at.y - stood.y) > 150, 'tapping where they stand walks you there, round the hedge');

// =============================================================== a fight
section('A fight');
await idle(page);
check((await screen(page)) === 'fight', 'walking into them starts the fight');
check(JSON.stringify((await battle(page)).units.filter((u) => u.side === 'foe').map((u) => u.species)) === JSON.stringify((await state(page)).visit.waiting.map((f) => f.species)), 'against exactly who was seen waiting');
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
check((await modalTitle(page))?.includes(b.units.find((u) => u.key === 'f0').name), 'tapping an Oddment opens its card');
check(await S(page, () => document.querySelector('.modal .note').textContent.includes('soft spot')), 'which says what it has a soft spot for');
await page.click('.modal .x');

// Reach out, by tapping.
const huff0 = b.units.find((u) => u.key === 'f0').huff;
await page.click('[data-call="reach"]');
if (foeCount > 1) {
  check((await page.$$('.unit.pick')).length === foeCount, 'Reach out asks who');
  check(await S(page, () => document.querySelector('.unit.pick .edge').textContent.includes('pips')), 'and shows how many pips it would take off');
  await snap(page, 'e2e-reach');
  await page.click('[data-unit="f0"]');
}
await idle(page);
b = await battle(page);
check(b.units.find((u) => u.key === 'f0').huff === huff0 - 2, 'reaching out takes two pips off its Huff');
check((await page.$$('[data-unit="f0"] .pips i.on')).length === huff0 - 2, 'and the pips on screen say so');
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
check(joined.length >= 1 && joined.every((id) => s.friends.some((f) => f.species === id)), `a calmed Oddment comes home (${joined.join(', ')})`);
check(s.friends.length === 3 + joined.length && s.stats.befriended === joined.length, 'and is counted among your friends');
check(await S(page, () => document.querySelector('.modal .xp').textContent.includes('experience')), 'experience is shown');
check(!(await page.$('.modal.result .x')), 'the result has to be acknowledged');
await snap(page, 'e2e-result');
await page.click('[data-id="next"]');
check((await screen(page)) === 'path', 'Onward puts you back in the garden');
check(await S(page, () => document.querySelector('.placecard').dataset.stop === '1' && document.querySelector('.placecard h2').textContent.includes('stop 2 of 5')), 'with the next group waiting further in');
s = await state(page);
check(s.visit.stop === 1 && Object.values(s.visit.hp).every((hp) => hp > 0), 'with everyone on their feet after a breather');

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
check((await screen(page)) === 'lane' && s.visit === null && s.rooms.garden.losses === 1, 'and you are back in the lane');
check((await where(page)).near === 'home', 'carried home');
check(s.friends.length === 3 + joined.length, 'with every friend you had');

section('Friends');
await tab(page, 'friends');
check((await page.$$('.grid.team .friend')).length === 3, 'the team of three is shown');
check((await page.$$('.grid:not(.team) .friend')).length === joined.length, 'the new friend is resting at home');
await page.click(`.grid:not(.team) .friend[data-species="${joined[0]}"]`);
check((await modalTitle(page))?.startsWith(SPECIES[joined[0]].name), 'tapping a friend opens its card');
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
check((await page.$$('.page-tile')).length === 12, 'the scrapbook has a page for every kind');
const met = Object.values(s.book).filter((p) => p.met).length;
check((await page.$$('.page-tile:not(.unmet)')).length === met, `the ${met} kinds met so far are shown`);
check(await S(page, () => [...document.querySelectorAll('.page-tile.unmet')].every((t) => t.disabled && t.querySelector('b').textContent === '???')), 'the rest are shadows');
check((await page.$$('.ring > div')).length === 6, 'and the six elements are explained');
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
check((await screen(page)) === 'path' && s.visit && s.visit.stop === 0, 'a reload in the middle of a fight puts you back inside the garden before it');
check(JSON.stringify(s.visit.waiting) === JSON.stringify(beforeReload.visit.waiting) && Math.abs(s.visit.at.x - beforeReload.visit.at.x) < 1, 'facing the same ones, standing where you stood');
await page.waitForTimeout(600);
check((await screen(page)) === 'path', 'and nothing starts until you move: you can still walk back out');
check(!(await page.$('.modal.intro')), 'the intro does not come back');
check(await S(page, () => Object.keys(localStorage).every((key) => key.startsWith('oddments.'))), 'the save is the only thing kept on the device');

// =============================================================== the whole room
section('The whole room');
// (Back to the three you started with: the Friends test above swapped a brand-new, low-level friend in.)
if ((await screen(page)) === 'path') await page.click('[data-act="home"]');
await S(page, () => window.oddments.game.setTeam([1, 2, 3]));
let cleared = false;
let visits = 0;
while (!cleared && visits < 6) {
  visits++;
  if ((await screen(page)) === 'lane') await enterGarden(page);
  while ((await screen(page)) === 'path') {
    const stop = (await state(page)).visit.stop;
    await onward(page);
    await idle(page);
    if (stop === 4) {
      check((await page.$$('.unit.boss')).length === 1 && (await page.$$('.unit.foe')).length === 3, 'the boss stands with two others');
      check((await S(page, () => document.querySelectorAll('.unit.boss .pips i').length)) === 0, 'and has no Huff to calm');
      check(await S(page, () => document.querySelectorAll('.order .chip.foe img[src*="boss_hydra"]').length === 2), 'it takes two turns a round');
      await snap(page, 'e2e-boss');
    }
    await botFight(page, { befriend: stop < 4 });
    cleared = (await modalTitle(page)) === 'Room cleared';
    if (cleared) await snap(page, 'e2e-cleared');
    await page.click('[data-id="next"]');
    await page.waitForTimeout(80);
  }
}
s = await state(page);
check(cleared, `a sensible player clears the garden (took ${visits} visit${visits === 1 ? '' : 's'})`);
check(s.rooms.garden.clears === 1 && s.rooms.garden.best === 5 && s.visit === null, 'clearing it is recorded and you are back in the lane');
check(s.book.boss_hydra.met && !s.friends.some((f) => SPECIES[f.species].boss), 'the boss was met, and did not come home');
check(s.friends.length >= 5, `friends were made along the way (${s.friends.length})`);
check(s.friends.filter((f) => s.team.includes(f.id)).every((f) => f.level > 3), 'and the team grew');
check((await where(page)).near === 'garden', 'you step back out at the garden gate');
await page.waitForSelector('.placecard[data-spot="garden"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').textContent === 'Walk in again'), 'the garden can be walked again');
await S(page, () => { window.oddments.game.standAt('alley'); });
await page.waitForSelector('.placecard[data-spot="alley"]');
check(await S(page, () => document.querySelector('[data-act="enter"]').disabled && document.querySelector('[data-act="enter"]').textContent === 'Not built yet'), 'the next place is still not built: the slice ends here');
await snap(page, 'e2e-house-cleared');

// =============================================================== heirlooms
section('Heirlooms');
// Find a new game whose very first fight has an Heirloom in it, the same way the game will roll it.
let rareSeed = 0;
for (let seed = 1; seed < 20000 && !rareSeed; seed++) {
  const probe = newState(Date.now(), seed);
  enterRoom(probe, 'garden'); // whoever is at the first stop is rolled as you walk in
  if (probe.visit.waiting.some((foe) => foe.heirloom)) rareSeed = seed;
}
check(rareSeed > 0, `a seed whose first fight has an Heirloom exists (${rareSeed})`);
await page.goto(`${base}?debug&fast&reset&seed=${rareSeed}`);
await ready(page);
await page.click('[data-id="begin"]');
await enterGarden(page);
check((await state(page)).visit.waiting.some((foe) => foe.heirloom), 'the Heirloom can be seen waiting before it is met');
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
await page.click('[data-act="home"]');
await tab(page, 'friends');
check(await S(page, (species) => document.querySelector(`.friend[data-species="${species}"] img`).src.includes('_heirloom') && !!document.querySelector(`.friend[data-species="${species}"] .heirloom`), rare.species), 'and is shown as an Heirloom among your friends');
await tab(page, 'book');
check(await S(page, (species) => !!document.querySelector(`[data-kind="${species}"] .stamp.gold`), rare.species), 'with a gold stamp in the scrapbook');
await snap(page, 'e2e-heirloom-book');

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
edited.visit = { room: 'dark', stop: 99, hp: { 1: 1e99 } };
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

// =============================================================== other phones
section('Other screen sizes');
for (const [name, viewport] of [['small phone (320x568)', { width: 320, height: 568 }], ['iPhone SE (375x667)', { width: 375, height: 667 }], ['large phone (430x932)', { width: 430, height: 932 }]]) {
  const other = await newPage(viewport);
  await other.goto(`${base}?debug&fast&reset&seed=7`);
  await ready(other);
  await other.click('[data-id="begin"]');
  const fitsHome = await S(other, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#tabs').getBoundingClientRect().bottom <= innerHeight + 0.5 && document.querySelector('[data-act="friends"]').getBoundingClientRect().bottom <= document.querySelector('#tabs').getBoundingClientRect().top + 0.5);
  await enterGarden(other);
  const fitsPath = await S(other, () => document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-act="home"]').getBoundingClientRect().bottom <= innerHeight + 0.5);
  await onward(other);
  await idle(other);
  const fitsFight = await S(other, () => {
    const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 && r.top >= -0.5; };
    return document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.move, .call, .unit, .order')].every(inside);
  });
  check(fitsHome && fitsPath && fitsFight, `everything fits on a ${name}`, `home ${fitsHome} path ${fitsPath} fight ${fitsFight}`);
  await snap(other, `e2e-size-${viewport.width}`);
  await other.context().close();
}

// =============================================================== the page keeps to itself
section('Nothing leaves the device');
const foreign = requests.filter((url) => !url.startsWith(base));
check(foreign.length === 0, 'every request the game made was for one of its own files', foreign.slice(0, 3).join(' '));
check(requests.length > 40, `(${requests.length} requests watched)`);
check(errors.length === 0, 'no errors, and nothing refused by the content security policy', errors.slice(0, 5).join(' | '));

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
