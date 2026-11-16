// Paints a postcard of the lane: the picture behind the game's loading screen
// and the iOS app's launch image. It is the real world, painted by the game's
// own painters from the game's own art (the same ground, buildings, lamps and
// trees you walk among), with home in the middle, everyone's lights on, no
// name plates and nothing laid over it. Nothing new is generated and it costs
// nothing.
//
// One square picture serves both. A phone held upright shows the middle strip
// of it from top to bottom, in the launch image and on the loading screen
// alike, so the one becomes the other without a jump.
//
//   node tools/postcard.mjs            writes web/assets/boot/lane.webp and the three launch images
//
// Needs Playwright (as the browser test does): the painting is done by a
// headless browser, because the painters draw on a canvas.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = fileURLToPath(new URL('../', import.meta.url));

// What is in the picture: a square of the world this many units across, centred here (home's door
// is at 1180, 1454). And how big each copy is, in pixels across.
const VIEW = { x: 1150, y: 1450, across: 1500 };
const LAUNCH = 2732; // iOS launch images are this size
const WEB = 1600; // the loading screen's copy: smaller, since it has to arrive before anything else

const server = await serve();
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`http://127.0.0.1:${server.address().port}/?fast`, { waitUntil: 'domcontentloaded' });

const made = await page.evaluate(async ({ view, launch, web }) => {
  const { WORLD, SPOTS, TREES, LAMPS, PEOPLE } = await import('./js/core/world.js');
  const { START_TEAM, LOOKS } = await import('./js/core/balance.js');
  const { CAST } = await import('./js/core/story.js');
  const paint = await import('./js/ui/scenery.js');
  const { LAID_OUT } = await import('./js/ui/lane.js');
  const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`missing ${src}`)); image.src = src; });
  const art = {};
  for (const name of paint.WORLD_ART) art[name] = await load(paint.worldSrc(name));
  const sprite = (id) => load(`assets/sprites/${id}.webp`);

  const canvas = document.createElement('canvas');
  canvas.width = launch;
  canvas.height = launch;
  const pen = canvas.getContext('2d');
  const k = launch / view.across;
  const x0 = view.x - view.across / 2;
  const y0 = view.y - view.across / 2;
  pen.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);

  // The ground: grass, streets and stepping stones, the green, the hedge round the world.
  paint.paintGround(pen, LAID_OUT.GROUND, { grass: art.grass, earth: art.earth, cobbles: art.cobbles, bush: art.p_bush, tree: art.p_tree });

  // Everything that stands on it, furthest first, as the game draws it.
  const things = [];
  const at = (x, y, draw) => things.push({ y, draw: () => { pen.save(); pen.translate(x, y); draw(); pen.restore(); } });
  /** Someone standing with their feet at (x, y): their shadow, then their picture. Clutterkin are painted facing left, people right. */
  const stand = (image, x, y, tall, flip) => things.push({ y, draw: () => {
    paint.oval(pen, x, y + 2, tall * 0.3, tall * 0.085); paint.paint(pen, 'rgba(8,6,20,.5)');
    const wide = tall * Math.min(1.5, image.naturalWidth / image.naturalHeight);
    const high = wide > tall * 1.2 ? wide * (image.naturalHeight / image.naturalWidth) : tall;
    pen.save(); pen.translate(x, y); if (flip) pen.scale(-1, 1); pen.drawImage(image, -wide / 2, -high, wide, high); pen.restore();
  } });
  for (const spot of SPOTS) {
    things.push({ y: spot.y, draw: () => {
      // Every window lit and every door unlocked: this is the lane as it will be, not as it is on the first night.
      paint.glow(pen, spot.x, spot.y + 30, 104, '255,200,61', spot.id === 'home' ? 0.3 : 0.16);
      paint.paintBuilding(pen, spot, { image: art[`b_${spot.id}`], name: '', open: true });
    } });
  }
  for (const tree of TREES) at(tree.x, tree.y, () => paint.paintProp(pen, art.p_tree, tree.r * 3.3));
  for (const lamp of LAMPS) at(lamp.x, lamp.y, () => paint.paintLamp(pen, art.p_lamp));
  for (const piece of LAID_OUT.WALLS) at(piece.x, piece.y, () => paint.paintProp(pen, art[piece.art], piece.wide));
  for (const { room, area, dress } of LAID_OUT.PLACES) {
    at(area.gate.x, area.gate.y + 16, () => paint.paintGate(pen, dress.gate));
    // Whoever is restless there keeps to cover, as from outside.
    area.posts.forEach((post, i) => at(post.x, post.y, () => paint.paintProp(pen, art[dress.cover], dress.coverWide * (room.path[i].boss ? 1.5 : 1))));
  }
  // The house-sitter at the door of home, turned toward you, with the three they set out with; and the neighbours.
  const door = SPOTS.find((spot) => spot.id === 'home').door;
  stand(await sprite(`${LOOKS[0].id}_front`), door.x, door.y + 10, 96, false);
  const beside = [[-66, 20], [62, 24], [22, 52]];
  for (let i = 0; i < START_TEAM.length; i++) stand(await sprite(START_TEAM[i][0]), door.x + beside[i][0], door.y + beside[i][1], 54, beside[i][0] < 0);
  for (const person of PEOPLE) {
    const image = await sprite(CAST[person.id].art);
    stand(image, person.x, person.y, 96 * (image.naturalHeight / 300), door.x < person.x);
  }
  things.sort((a, b) => a.y - b.y);
  for (const thing of things) thing.draw();

  // Fireflies, scattered by a fixed run of numbers so the postcard is the same every time it is painted.
  let seed = 29;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 170; i++) {
    const x = next() * WORLD.w;
    const y = next() * WORLD.h;
    const bright = 0.35 + 0.6 * next();
    pen.beginPath(); pen.arc(x, y, 6, 0, Math.PI * 2); paint.paint(pen, `rgba(255,224,122,${bright * 0.22})`);
    pen.beginPath(); pen.arc(x, y, 2.4, 0, Math.PI * 2); paint.paint(pen, `rgba(255,236,160,${bright})`);
  }

  const small = document.createElement('canvas');
  small.width = web;
  small.height = web;
  const brush = small.getContext('2d');
  brush.imageSmoothingQuality = 'high';
  brush.drawImage(canvas, 0, 0, web, web);
  return { launch: canvas.toDataURL('image/jpeg', 0.88), web: small.toDataURL('image/webp', 0.8), things: things.length };
}, { view: VIEW, launch: LAUNCH, web: WEB });

await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const bytes = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
mkdirSync(`${ROOT}web/assets/boot`, { recursive: true });
writeFileSync(`${ROOT}web/assets/boot/lane.webp`, bytes(made.web));
// (Three names, one picture: the launch screen is told a size for each sharpness of screen and is given the same one.)
for (const name of ['splash-2732x2732.jpg', 'splash-2732x2732-1.jpg', 'splash-2732x2732-2.jpg']) writeFileSync(`${ROOT}ios/App/App/Assets.xcassets/Splash.imageset/${name}`, bytes(made.launch));
console.log(`postcard painted (${made.things} things standing in it): loading screen ${Math.round(bytes(made.web).length / 1024)} KB, launch image ${Math.round(bytes(made.launch).length / 1024)} KB`);
