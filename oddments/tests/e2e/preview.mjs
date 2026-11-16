// Smoke test for a copy of the game somewhere other than web/: the preview
// build (tools/build-preview.mjs), or the copy published on the web. Checks
// that it starts, that you can walk, and that a fight begins and can be won.
//   node tests/e2e/preview.mjs                 builds dist/preview/ and tests it, page and fragment
//   node tests/e2e/preview.mjs https://...     tests the copy at that address
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve } from '../../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright'); // preinstalled globally (NODE_PATH)

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const remote = process.argv[2];
let server = null;
const targets = [];
if (remote) {
  targets.push(['published copy', remote.endsWith('/') ? remote : `${remote}/`]);
} else {
  execFileSync('node', [`${ROOT}tools/build-preview.mjs`], { stdio: 'inherit' });
  const fragment = await readFile(`${ROOT}dist/preview/fragment.html`, 'utf8');
  await writeFile(`${ROOT}dist/preview/shell.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${fragment}</body></html>`);
  server = await serve(0, `${ROOT}dist/preview`);
  const base = `http://127.0.0.1:${server.address().port}/`;
  targets.push(['preview page', base], ['preview fragment in a host shell', `${base}shell.html`]);
}

const browser = await chromium.launch();
let failed = 0;
for (const [name, url] of targets) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  const foreign = [];
  const origin = new URL(url).origin;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(origin)) foreign.push(r.url()); });
  let ok = false;
  try {
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}debug&fast&reset&seed=7`);
    await page.waitForSelector('.modal.intro', { timeout: 30000 });
    await page.click('[data-id="begin"]');
    // Walk to the garden gate by tapping, go in, walk up to whoever is waiting, and win.
    for (let i = 0; i < 30 && (await page.evaluate(() => window.oddments.game.near())) !== 'garden'; i++) {
      const aim = await page.evaluate(() => { const to = window.oddments.lane.screenOf('garden'); const box = document.querySelector('.lanecanvas').getBoundingClientRect(); return { x: Math.min(box.right - 8, Math.max(box.left + 8, to.x)), y: Math.min(box.bottom - 8, Math.max(box.top + 70, to.y)) }; });
      await page.touchscreen.tap(aim.x, aim.y);
      await page.waitForTimeout(450);
    }
    await page.click('.placecard[data-spot="garden"] [data-act="enter"]');
    for (let i = 0; i < 30 && (await page.evaluate(() => window.oddments.game.place())) !== 'fight'; i++) {
      const aim = await page.evaluate(() => { const to = window.oddments.lane.screenOf('next'); const box = document.querySelector('.lanecanvas').getBoundingClientRect(); return { x: Math.min(box.right - 8, Math.max(box.left + 8, to.x)), y: Math.min(box.bottom - 8, Math.max(box.top + 70, to.y)) }; });
      await page.touchscreen.tap(aim.x, aim.y);
      await page.waitForTimeout(450);
    }
    await page.waitForSelector('#fight[data-busy="0"]', { timeout: 30000 });
    await page.screenshot({ path: `${OUT}preview-${targets.length > 1 ? name.split(' ')[1] : 'published'}.png` });
    for (let i = 0; i < 200; i++) {
      await page.waitForSelector('#fight[data-busy="0"], .modal.result', { timeout: 30000 });
      if (await page.$('.modal.result')) break;
      await page.click('.move:not([disabled])');
      if (await page.$('.unit.pick')) await page.click('.unit.pick');
    }
    const won = await page.evaluate(() => document.querySelector('.modal.result header span').textContent);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ok = won === 'Won' && fits && errors.length === 0 && foreign.length === 0;
    console.log(ok ? `ok    ${name}: starts, walks, fights and wins (${url})` : `FAIL  ${name}: result "${won}", fits ${fits}, errors: ${errors.join(' | ') || 'none'}, other requests: ${foreign.slice(0, 3).join(' ') || 'none'}`);
  } catch (err) {
    console.log(`FAIL  ${name}: ${err.message.split('\n')[0]}; errors: ${errors.join(' | ') || 'none'}`);
  }
  if (!ok) failed++;
  await page.close();
}
await browser.close();
if (server) server.close();
process.exit(failed ? 1 : 0);
