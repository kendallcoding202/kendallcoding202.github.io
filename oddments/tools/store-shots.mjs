// The pictures for the App Store page: eight, each 1290 x 2796 (Apple's
// 6.9-inch iPhone size: a 430 x 932 page at three times).
//
//   node tools/store-shots.mjs [outdir]        (default: store/screenshots)
//
// The first is the key art (store/art/keyart.jpg, painted for this from the
// game's own characters) with the title over it, as the loading screen has
// it. The other seven are the real game: it is run in a browser at the size
// of a phone, set up at a moment worth showing by the game's own rules, and
// photographed as it is. Each photograph is then set in the same frame: a
// caption in the title's lettering, the screen below it, the key art out of
// focus behind, and one or two of the game's own creatures standing by.
// Nothing in a photograph is drawn over or made up.
//
// (The owner asked for this: "I really want to put emphasis on the first
// couple screenshots we use ... I want them to look good.")
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = process.argv[2] || `${ROOT}store/screenshots/`;
mkdirSync(OUT, { recursive: true });
const KEYART = `data:image/jpeg;base64,${readFileSync(`${ROOT}store/art/keyart.jpg`).toString('base64')}`;

const PHONE = { width: 390, height: 844 }; // the size the game is photographed at
const PAGE = { width: 430, height: 932 }; // the size each picture is made at, times three

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const errors = [];

// ------------------------------------------------------------------ photographing the game

/** A new game on a page the size of a phone, the introduction read, some way in. */
async function fresh(seed) {
  const page = await browser.newPage({ viewport: PHONE, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${base}?debug&reset&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  // (Room for the phone's own bars, as on a real one.)
  await page.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '50px'); document.documentElement.style.setProperty('--safe-bottom', '30px'); });
  await page.fill('.modal.intro input', 'Robin').catch(() => {});
  await page.click('[data-id="begin"]');
  await page.waitForSelector('.modal.talk');
  for (let i = 0; i < 30 && await page.$('.modal.talk'); i++) { await page.click('.modal.talk [data-id="next"]'); await page.waitForTimeout(40); }
  await page.waitForSelector('.modal.three', { timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 9 && await page.$('.modal.three'); i++) { await page.click('.modal.three [data-id="next"]'); await page.waitForTimeout(40); }
  await page.evaluate(async () => {
    const { ROOMS, SPECIES } = await import('./js/core/balance.js');
    const { newFriend } = await import('./js/core/progress.js');
    const o = window.oddments; const s = o.game.state;
    // Puts the game some way in: so many places calm, these friends made, hints already read.
    window.setUp = ({ calm = 0, level = 5, friends = [], heirlooms = [], grown = [], team = null, ines = null } = {}) => {
      for (const key of ['strays', 'howto', 'walked', 'three']) s.seen[key] = true;
      ROOMS.forEach((room, i) => { s.rooms[room.id].clears = i < calm ? 1 : 0; s.rooms[room.id].calmed = i < calm ? 31 : 0; });
      s.story.ines = ines === null ? calm + 1 : ines; s.story.call = true; s.story.call2 = calm >= 8; s.story.dov = 1; s.story.spick = 1;
      for (const species of friends) if (!s.friends.some((f) => f.species === species)) s.friends.push(newFriend(s.nextFriendId++, species, level));
      for (const f of s.friends) { f.level = level; f.heirloom = heirlooms.includes(f.species); f.grown = grown.includes(f.species) && !!SPECIES[f.species].grown; s.book[f.species].met = true; if (f.heirloom) s.book[f.species].heirloom = true; if (f.grown) s.book[f.species].grown = true; }
      if (team) s.team = team.map((species) => s.friends.find((f) => f.species === species).id);
      s.stats.befriended = s.friends.length - 3;
      s.visit = null; s.worn = null; s.indoors = null; s.strays = [];
    };
  });
  return page;
}
const photo = async (page, wait = 900) => { await page.waitForTimeout(wait); const bytes = await page.screenshot({ type: 'png' }); await page.close(); return `data:image/png;base64,${bytes.toString('base64')}`; };
/** Past the pages that explain a fight, which a save's first fight shows. */
const intoFight = async (page) => { await page.waitForSelector('#fight', { timeout: 20000 }); for (let i = 0; i < 8 && await page.$('.modal.howto'); i++) { await page.click('.modal.howto [data-id="next"]'); await page.waitForTimeout(120); } await page.waitForSelector('#fight[data-busy="0"]', { timeout: 20000 }); };
const GROWN = ['dustbunny', 'sockeel', 'toastghost'];

const SCENES = {
  // A fight in the garden, one of them half won over: reaching out, not throwing anything.
  async reach() {
    const page = await fresh(21);
    await page.evaluate(() => { window.setUp({ calm: 0, level: 4, ines: 1 }); const o = window.oddments; o.game.travelTo('garden'); const stop = o.game.state.visit.groups.findIndex((g) => !g.done && g.foes.length === 3); o.game.approach(stop < 0 ? 0 : stop); o.game.startEncounter(stop < 0 ? 0 : stop); o.ctx.show('fight'); });
    await intoFight(page);
    await page.click('[data-call="reach"]');
    await page.click('.unit.foe.pick');
    await page.waitForSelector('#fight[data-busy="0"]', { timeout: 20000 });
    return photo(page, 700);
  },
  // The scrapbook, well on the way: friends made, some grown up, some in their rare colours.
  async scrapbook() {
    const page = await fresh(57);
    await page.evaluate(async () => {
      const { SPECIES } = await import('./js/core/balance.js');
      const kinds = Object.keys(SPECIES).filter((id) => !SPECIES[id].boss && !SPECIES[id].keepsake);
      window.setUp({ calm: 6, level: 12, friends: kinds.slice(0, 34), heirlooms: ['dandepuff', 'gnome', 'sparkplug', 'bubblejelly', 'bookworm'], grown: kinds.slice(0, 16) });
      const o = window.oddments; const s = o.game.state;
      for (const id of kinds.slice(34, 44)) s.book[id].met = true;
      for (const id of ['boss_hydra', 'boss_baron', 'boss_crumbwyrm', 'boss_spincycle', 'boss_tome', 'boss_warden']) s.book[id].met = true;
      o.ctx.show('book');
      // (From the first row of pictures, with room above it for the phone's own bar.)
      const grid = document.querySelector('#book .grid.book');
      grid.scrollIntoView({ block: 'start' });
      let scroller = grid.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
      if (scroller) scroller.scrollTop -= 50;
    });
    return photo(page);
  },
  // A ringleader: the Crumbwyrm, in the Midnight Pantry.
  async ringleader() {
    const page = await fresh(33);
    await page.evaluate((grown) => { window.setUp({ calm: 2, level: 8, grown }); const o = window.oddments; const s = o.game.state; s.rooms.pantry.calmed = 0b01111; o.game.travelTo('pantry'); o.game.approach(4); o.game.startEncounter(4); o.ctx.show('fight'); }, GROWN);
    await intoFight(page);
    return photo(page);
  },
  // Two friends grow up after a fight.
  async growing() {
    const page = await fresh(93);
    await page.evaluate(async () => {
      const { xpNeeded } = await import('./js/core/balance.js');
      window.setUp({ calm: 1, level: 7, ines: 2 });
      const o = window.oddments; const s = o.game.state;
      for (const f of s.friends) f.xp = xpNeeded(7) - 1;
      o.game.travelTo('alley'); o.game.approach(0); o.game.startEncounter(0); o.ctx.show('fight');
    });
    await intoFight(page);
    await page.evaluate(async () => { const { playOut } = await import('./js/core/auto.js'); const o = window.oddments; playOut(o.game.battle, {}); o.ctx.show('fight'); });
    await page.waitForSelector('.modal.result', { timeout: 60000 });
    return photo(page, 1200);
  },
  // A ringleader out of doors, with a wish.
  async wish() {
    const page = await fresh(69);
    await page.evaluate((grown) => { window.setUp({ calm: 3, level: 9, grown, friends: ['dandepuff', 'thornhog', 'grumblebee', 'snailor', 'gnome', 'capbeetle', 'sparkplug'] }); const o = window.oddments; o.game.standByWaiting('boss_hydra'); o.ctx.show('lane'); }, GROWN);
    return photo(page, 1800);
  },
  // Indoors: the Midnight Pantry, everyone standing about, the Crumbwyrm at the far end.
  async indoors() {
    const page = await fresh(45);
    await page.evaluate((grown) => { window.setUp({ calm: 2, level: 8, grown }); const o = window.oddments; o.game.travelTo('pantry'); o.game.state.indoors.y = 760; o.ctx.show('lane'); }, GROWN);
    return photo(page, 2200);
  },
  // Out in the lane at night: you, your three, home and the neighbours.
  async lane() {
    const page = await fresh(7);
    await page.evaluate(() => { window.setUp({ calm: 1, level: 6 }); const o = window.oddments; o.game.state.where = { x: 1195, y: 1668 }; o.ctx.show('lane'); });
    return photo(page, 1800);
  },
};

// ------------------------------------------------------------------ the frame they are set in

const FRAME = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Fredoka"; src: url("/assets/fonts/fredoka.woff2") format("woff2"); font-weight: 300 700; }
* { box-sizing: border-box; }
html, body { margin: 0; width: ${PAGE.width}px; height: ${PAGE.height}px; overflow: hidden; background: #0d0a1c; font-family: "Fredoka", sans-serif; }
#poster { position: relative; width: 100%; height: 100%; overflow: hidden; }
.ink { text-shadow: 0 .09em 0 #17132e, .05em 0 0 #17132e, -.05em 0 0 #17132e, 0 -.05em 0 #17132e, .04em .04em 0 #17132e, -.04em .04em 0 #17132e, .04em -.04em 0 #17132e, -.04em -.04em 0 #17132e, 0 .16em .35em rgba(8,6,20,.6); }
.star { position: absolute; border-radius: 50%; background: #fff7e8; }
.fly { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #ffeca0; box-shadow: 0 0 8px 4px rgba(255,224,122,.5); }

/* The first picture: the key art, its night sky carried on upward for the title to stand in. */
.hero { background: linear-gradient(#030c33, #05276a 26%, #0b2634 96%); }
.hero .key { position: absolute; left: 0; top: 242px; width: 430px; height: 645px; }
.hero .rise { position: absolute; left: 0; right: 0; top: 240px; height: 44px; background: linear-gradient(#05276a, rgba(5,39,100,0)); }
.hero .fall { position: absolute; left: 0; right: 0; top: 810px; height: 122px; background: linear-gradient(rgba(11,38,52,0), #0b2634 62%, #08202c); }
.hero h1 { position: absolute; left: 0; right: 0; top: 72px; margin: 0; text-align: center; font-size: 77px; font-weight: 700; letter-spacing: 1px; line-height: 1; color: #fff7e8; }
.hero h1 span { display: inline-block; }
.hero .tag { position: absolute; left: 0; right: 0; top: 163px; margin: 0; text-align: center; font-size: 25px; font-weight: 600; color: #ffe9a6; text-shadow: 0 2px 0 #17132e, 0 0 10px rgba(8,6,20,.8); }
.hero .foot { position: absolute; left: 20px; right: 20px; bottom: 30px; margin: 0; text-align: center; font-size: 25px; font-weight: 700; line-height: 1.14; color: #fff7e8; white-space: pre-line; }

/* The others: a caption, then the screen, the key art out of focus behind. */
.shot .back { position: absolute; left: -40px; top: -40px; width: 510px; height: 1012px; object-fit: cover; object-position: 42% 55%; filter: blur(16px) brightness(.5) saturate(1.15); }
.shot .dusk { position: absolute; inset: 0; background: linear-gradient(rgba(13,10,28,.72), rgba(13,10,28,.2) 24%, rgba(13,10,28,.08) 60%, rgba(13,10,28,.55)); }
.shot h2 { position: absolute; left: 14px; right: 14px; top: 34px; margin: 0; text-align: center; font-size: 43px; font-weight: 700; line-height: 1.03; color: #fff7e8; white-space: pre-line; }
.shot .sub { position: absolute; left: 22px; right: 22px; top: 133px; margin: 0; text-align: center; font-size: 17.5px; font-weight: 600; line-height: 1.2; color: #ffe9a6; text-shadow: 0 2px 0 #17132e, 0 0 10px rgba(8,6,20,.8); }
.shot .phone { position: absolute; left: 50%; top: 190px; width: 338px; height: 731.5px; margin-left: -169px; border-radius: 44px; background: #0d0a1c; padding: 7px; box-shadow: 0 0 0 2px rgba(255,233,166,.42), 0 18px 40px rgba(4,3,12,.7), 0 0 60px rgba(255,200,61,.14); }
.shot .phone img { display: block; width: 100%; height: 100%; border-radius: 37px; }
.shot .beside { position: absolute; object-fit: contain; object-position: center bottom; filter: drop-shadow(0 5px 0 rgba(13,10,28,.55)) drop-shadow(0 0 12px rgba(8,6,20,.5)); }
.shot .beside.flip { transform: scaleX(-1); }
</style></head><body><div id="poster"></div></body></html>`;

/** Builds one picture on the frame page and photographs it. `spec` is { hero } or { screen, title, sub, beside }. */
async function compose(page, name, spec) {
  await page.evaluate(async ({ spec, keyart }) => {
    const root = document.getElementById('poster');
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; root.append(node); return node; };
    const loaded = (img) => new Promise((resolve, reject) => { if (img.complete && img.naturalWidth) resolve(); else { img.onload = resolve; img.onerror = () => reject(new Error(`could not load ${img.src.slice(0, 60)}`)); } });
    root.replaceChildren();
    const waits = [];
    // A fixed run of numbers, so the stars and fireflies are where they were the last time this was made.
    let seed = spec.seed || 7;
    const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    if (spec.hero) {
      root.className = 'hero';
      for (let i = 0; i < 46; i++) { const star = el('i', 'star'); const size = 1 + next() * 1.8; Object.assign(star.style, { left: `${next() * 430}px`, top: `${next() * 250}px`, width: `${size}px`, height: `${size}px`, opacity: String(0.35 + next() * 0.6) }); }
      const key = el('img', 'key'); key.src = keyart; waits.push(loaded(key));
      el('div', 'rise'); el('div', 'fall');
      const title = el('h1', 'ink');
      // (The letters step up and down a little, as they do on the loading screen.)
      [...'Clutterkin'].forEach((letter, i) => { const span = document.createElement('span'); span.textContent = letter; span.style.transform = `translateY(${Math.round(Math.sin(i * 0.9) * 5)}px)`; title.append(span); });
      el('p', 'tag', 'The house is awake.');
      el('p', 'foot ink', spec.hero);
    } else {
      root.className = 'shot';
      const back = el('img', 'back'); back.src = keyart; waits.push(loaded(back));
      if (spec.backAt) back.style.objectPosition = spec.backAt;
      el('div', 'dusk');
      for (let i = 0; i < 9; i++) { const fly = el('i', 'fly'); Object.assign(fly.style, { left: `${6 + next() * 418}px`, top: `${150 + next() * 760}px`, opacity: String(0.45 + next() * 0.5) }); }
      el('h2', 'ink', spec.title);
      el('p', 'sub', spec.sub);
      const phone = el('div', 'phone'); const screen = document.createElement('img'); screen.src = spec.screen; phone.append(screen); waits.push(loaded(screen));
      // One or two of the game's own, standing by: [picture, left, bottom, tall, turned the other way].
      for (const [art, left, bottom, tall, flip] of spec.beside || []) {
        const img = el('img', `beside${flip ? ' flip' : ''}`); img.src = `/assets/sprites/${art}.webp`;
        Object.assign(img.style, { left: `${left}px`, bottom: `${bottom}px`, height: `${tall}px`, width: `${tall * 1.5}px` });
        waits.push(loaded(img));
      }
    }
    await Promise.all(waits);
    await document.fonts.ready;
  }, { spec, keyart: KEYART });
  await page.waitForTimeout(250);
  // (Saved as JPEG, which the App Store takes: a third the size of a PNG, and nothing a phone screen would show is lost.)
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 93 });
  console.log('  wrote', `${name}.jpg`);
}

// ------------------------------------------------------------------ the eight

const frame = await browser.newPage({ viewport: PAGE, deviceScaleFactor: 3 });
frame.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await frame.route('**/__store.html', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: FRAME }));
await frame.goto(`${base}__store.html`);

await compose(frame, '1-clutterkin', { hero: 'Make friends with everything\nthe house forgot.' });
// What each says, what it shows, and who stands by: [picture, left, bottom, how tall, turned the other way].
const PANELS = [
  ['2-reach-out', 'reach', 'Reach out,\nmake a friend', 'Turn-based fights where kindness wins', [['dustbunny', -35, 4, 92, true], ['dandepuff', 340, 8, 76, false]], '30% 60%'],
  ['3-eighty-kinds', 'scrapbook', 'Eighty kinds\nto befriend', 'And rare Heirloom colours to find', [['keep_musicbox', -38, 6, 96, true], ['npc_fluff', 350, 6, 62, false]], '70% 62%'],
  ['4-ringleaders', 'ringleader', 'Calm every\nringleader', 'Twelve places. Twelve too proud to reach', [['toastghost', -34, 10, 92, true]], '55% 45%'],
  ['5-growing-up', 'growing', 'Watch them\ngrow up', 'Every friend grows into something new', [['dustbunny_grown', -50, 2, 112, true], ['sockeel', 336, 10, 64, false]], '25% 55%'],
  ['6-wishes', 'wish', 'Grant a wish,\ngain a ringleader', 'Each wants something only you can bring', [['boss_hydra', 306, 0, 120, false]], '62% 30%'],
  ['7-indoors', 'indoors', 'Every room\nis wide awake', 'A pantry at midnight. An attic of clocks', [['eggknight', -30, 6, 86, true], ['teddybear', 338, 6, 78, false]], '50% 70%'],
  ['8-the-lane', 'lane', 'A whole lane\nto wander', 'No ads. Nothing to buy. Yours to keep', [['sitter_a_front', -62, 0, 132, false], ['gnome', 338, 6, 76, false]], '40% 40%'],
];
for (const [name, scene, title, sub, beside, backAt] of PANELS) {
  const screen = await SCENES[scene]();
  await compose(frame, name, { screen, title, sub, beside, backAt, seed: name.length * 131 + 5 });
}

await browser.close();
server.close();
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('done:', OUT);
