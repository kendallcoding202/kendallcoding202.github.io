// The loading screen and the iOS launch image: one postcard of the lane, painted
// from the game's own world by tools/postcard.mjs. Nothing here can look at the
// picture, but it can make sure both copies are there, are what the page and
// the app ask for, and are light enough to arrive first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SPLASH = `${ROOT}ios/App/App/Assets.xcassets/Splash.imageset/`;
const page = readFileSync(`${ROOT}web/index.html`, 'utf8');
const css = readFileSync(`${ROOT}web/css/style.css`, 'utf8');

test('the loading screen is a picture of the lane, small enough to arrive before anything else', () => {
  const boot = page.slice(page.indexOf('<div id="boot">'), page.indexOf('<div id="app"'));
  const pictures = [...boot.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pictures, ['assets/boot/lane.webp'], 'one picture, and it is the postcard');
  const file = `${ROOT}web/${pictures[0]}`;
  assert.ok(existsSync(file), 'the postcard is in the game');
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.ok(bytes.length > 60_000 && bytes.length < 400_000, `the postcard is ${Math.round(bytes.length / 1024)} KB`);
  // The name is there for anyone, however it is read; so is what is being got ready, and the bar.
  assert.match(boot, /<h1 class="boottitle" aria-label="Clutterkin">/);
  assert.equal(boot.match(/<h1[^>]*>(.*?)<\/h1>/s)[1].replace(/<[^>]+>/g, ''), 'Clutterkin');
  for (const id of ['bootline', 'bootfill']) assert.ok(boot.includes(`id="${id}"`), id);
});

test('the picture fills the screen from its middle and may be asked to hold still', () => {
  const rule = css.match(/\.bootscene \{[^}]*\}/)[0];
  assert.match(rule, /object-fit: cover/);
  assert.match(rule, /object-position: 50% 50%/, 'from the middle: where the iOS launch image shows the same picture from');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.bootscene[^}]*animation: none/, 'for anyone who has asked their phone for less movement');
  // Nothing left over from loading screens that came before.
  for (const gone of ['bootrays', 'boothero', 'bootrow', 'conic-gradient']) assert.equal(css.includes(gone) || page.includes(gone), false, gone);
});

test('the iOS launch image is the same postcard: every file the app lists is there, and nothing else is', () => {
  const listing = JSON.parse(readFileSync(`${SPLASH}Contents.json`, 'utf8'));
  const names = listing.images.map((image) => image.filename);
  assert.deepEqual(listing.images.map((image) => image.scale), ['1x', '2x', '3x']);
  assert.equal(new Set(names).size, 3);
  assert.deepEqual(readdirSync(SPLASH).sort(), ['Contents.json', ...names].sort(), 'no stray pictures in the folder');
  const first = readFileSync(`${SPLASH}${names[0]}`);
  for (const name of names) {
    const bytes = readFileSync(`${SPLASH}${name}`);
    assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, `${name} is a JPEG`);
    assert.ok(bytes.equals(first), 'the same picture at every sharpness of screen');
    assert.ok(statSync(`${SPLASH}${name}`).size < 2_000_000, `${name} is ${Math.round(bytes.length / 1024)} KB`);
  }
  // A JPEG says how big it is in its first start-of-frame block: square, and iOS's launch size.
  let at = 2;
  let size = null;
  while (at < first.length && !size) {
    const marker = first[at + 1];
    const long = first.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc2) size = [first.readUInt16BE(at + 7), first.readUInt16BE(at + 5)];
    at += 2 + long;
  }
  assert.deepEqual(size, [2732, 2732]);
});

test('the postcard is painted by the game\'s own painters, from the world as the game lays it out', () => {
  const tool = readFileSync(`${ROOT}tools/postcard.mjs`, 'utf8');
  for (const used of ['paintGround', 'paintBuilding', 'paintProp', 'paintLamp', 'LAID_OUT', 'WORLD_ART']) assert.ok(tool.includes(used), `the tool uses ${used}`);
  assert.match(readFileSync(`${ROOT}web/js/ui/lane.js`, 'utf8'), /export const LAID_OUT = \{ PLACES, WALLS, GROUND \};/);
  assert.equal(/fetch\(|generat(e|ing) (an |a )?image/i.test(tool.replace(/Nothing new is generated/g, '')), false, 'it generates nothing new');
});
