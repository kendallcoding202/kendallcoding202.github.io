// Quick look: opens the game at phone size, optionally runs a snippet, saves a screenshot.
// node tests/e2e/shot.mjs <name> [query] [js-to-eval]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { serve } from '../../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright'); // preinstalled globally (NODE_PATH)
const [name = 'shot', query = 'debug&reset&fast&seed=7', code = ''] = process.argv.slice(2);
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
await page.waitForSelector('#app:not([hidden])', { timeout: 15000 }).catch(() => errors.push('app never appeared'));
await page.waitForTimeout(700);
if (code) { try { const r = await page.evaluate(code); if (r !== undefined) console.log('result:', JSON.stringify(r)); } catch (e) { errors.push('EVAL ' + e.message); } await page.waitForTimeout(900); }
await page.screenshot({ path: `${OUT}${name}.png` });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close(); server.close();
