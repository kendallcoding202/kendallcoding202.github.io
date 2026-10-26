'use strict';
/*
 * Browser test for Kovyr Check (Playwright + Chromium). Not part of
 * `node --test`: run it directly.
 *
 *   node proof-of-protection/check/tests/browser.e2e.js [screenshot-dir]
 *
 * Serves the proof-of-protection folder locally, answers every DNS-over-HTTPS
 * request from fixtures.js via page.route, blocks (and fails on) any other
 * third-party request, and fails on console errors or horizontal scrolling.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const F = require('./fixtures.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.resolve(process.argv[2] || process.env.SCREENSHOT_DIR || path.join(require('os').tmpdir(), 'kovyr-check-screenshots'));
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Route DoH to fixtures. mode: 'ok' | 'cloudflare-down' | 'all-down'. */
async function attach(page, mode) {
  const seen = { cloudflare: [], google: [], blocked: [], consoleErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') seen.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => seen.consoleErrors.push(String(e)));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const isCf = url.hostname === 'cloudflare-dns.com';
    const isGoogle = url.hostname === 'dns.google';
    if (!isCf && !isGoogle) {
      seen.blocked.push(url.href);
      return route.abort('blockedbyclient');
    }
    const name = url.searchParams.get('name');
    const type = url.searchParams.get('type');
    (isCf ? seen.cloudflare : seen.google).push(type + ' ' + name);
    if (mode === 'all-down' || (mode === 'cloudflare-down' && isCf)) {
      return isCf ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'unavailable' }) : route.abort('connectionrefused');
    }
    if (isCf) assert.equal(route.request().headers().accept, 'application/dns-json');
    const ans = F.dohAnswer(F.ZONES, name, type, isCf ? 'cloudflare' : 'google');
    if (ans === 'TIMEOUT') return; // never answer; the page's own timeout must handle it
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': isCf ? 'application/dns-json' : 'application/json; charset=UTF-8' },
      body: JSON.stringify(ans)
    });
  });
  return seen;
}

async function noHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, label + ': horizontal scroll (' + sw + ' > ' + iw + ')');
}

async function check(page, base, value) {
  await page.goto(base + '/check/');
  await page.fill('#domain-input', value);
  await page.click('#check-button');
  await page.waitForSelector('#result-title', { timeout: 20000 });
}

async function openAllDetails(page) {
  await page.$$eval('details.check', (els) => els.forEach((d) => { d.open = true; }));
}

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log('  ✓ ' + name + ' (' + (Date.now() - t0) + ' ms)');
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e));
  }
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/' + '';
  const BASE = base.replace(/\/$/, '');
  const browser = await chromium.launch();
  const newPage = async (opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }, opts || {}));
    const page = await ctx.newPage();
    return { ctx, page };
  };
  const finish = async (ctx, seen, label) => {
    assert.deepEqual(seen.consoleErrors, [], label + ': console errors');
    assert.deepEqual(seen.blocked, [], label + ': unexpected third-party requests');
    await ctx.close();
  };
  console.log('Kovyr Check browser tests → screenshots in ' + SHOTS);

  await scenario('landing page renders at 390px and 1280px, light and dark', async () => {
    for (const [w, scheme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
      const { ctx, page } = await newPage({ viewport: { width: w, height: 844 }, colorScheme: scheme });
      const seen = await attach(page, 'ok');
      await page.goto(BASE + '/check/');
      assert.equal(await page.title(), 'Free email spoofing check · Kovyr Check');
      const privacy = await page.textContent('#privacy');
      assert.match(privacy, /This check runs in your browser\. It asks a public DNS service \(Cloudflare\) for your domain's public records\. Kovyr doesn't see or store what you type unless you choose to send us your results\./);
      assert.equal(await page.getAttribute('label[for="domain-input"]', 'for'), 'domain-input');
      await noHorizontalScroll(page, 'landing ' + w);
      await page.screenshot({ path: path.join(SHOTS, `check-landing-${w}-${scheme}.png`), fullPage: true });
      assert.equal(seen.cloudflare.length + seen.google.length, 0, 'no DNS queries before the user asks');
      await finish(ctx, seen, 'landing');
    }
  });

  await scenario('1. strong Microsoft 365 domain → Strong', async () => {
    for (const [w, scheme] of [[1280, 'light'], [390, 'dark']]) {
      const { ctx, page } = await newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const seen = await attach(page, 'ok');
      await check(page, BASE, 'Jane.Doe@StrongFirm.com');
      assert.match(await page.textContent('#result-title'), /Strong/);
      assert.match(await page.textContent('.grade-domain'), /strongfirm\.com · Email by Microsoft 365/);
      assert.equal(await page.textContent('#fixes-title'), 'Nothing urgent to fix');
      const href = await page.getAttribute('#cta-mail', 'href');
      assert.ok(href.startsWith('mailto:kendall@kovyr.com?subject='));
      const body = decodeURIComponent(href.split('&body=')[1]);
      assert.match(body, /strongfirm\.com/);
      assert.match(body, /Result: Strong/);
      assert.ok(seen.cloudflare.length >= 12 && seen.google.length === 0, 'Cloudflare answered everything');
      assert.ok(page.url().endsWith('#d=strongfirm.com'), 'shareable hash');
      await noHorizontalScroll(page, 'strong ' + w);
      await openAllDetails(page);
      await page.screenshot({ path: path.join(SHOTS, `check-strong-${w}-${scheme}.png`), fullPage: true });
      await finish(ctx, seen, 'strong');
    }
  });

  await scenario('2. Microsoft 365 with p=none → Needs work, M365-specific fix, copy works', async () => {
    for (const [w, scheme] of [[1280, 'light'], [390, 'light']]) {
      const { ctx, page } = await newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      const seen = await attach(page, 'ok');
      await check(page, BASE, 'monitorfirm.com');
      assert.match(await page.textContent('#result-title'), /Needs work/);
      const fix = await page.textContent('.fix-list > li:first-child');
      assert.match(fix, /Switch DMARC from "monitor" to "block"/);
      assert.match(fix, /Microsoft Defender portal/);
      assert.match(fix, /v=DMARC1; p=quarantine; rua=mailto:reports@monitorfirm\.com/);
      assert.ok(await page.$('.fix-list a[href^="https://learn.microsoft.com/"]'), 'links Microsoft docs');
      await page.click('.fix-list .copy');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'v=DMARC1; p=quarantine; rua=mailto:reports@monitorfirm.com');
      const it = await page.getAttribute('.share-row a', 'href');
      assert.ok(it.startsWith('mailto:?subject='));
      await noHorizontalScroll(page, 'needs-work ' + w);
      await page.screenshot({ path: path.join(SHOTS, `check-needswork-m365-${w}-${scheme}.png`), fullPage: true });
      await finish(ctx, seen, 'p=none');
    }
  });

  await scenario('3. Google Workspace, no DMARC, ~all → At risk', async () => {
    for (const [w, scheme] of [[390, 'light'], [1280, 'dark']]) {
      const { ctx, page } = await newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const seen = await attach(page, 'ok');
      await check(page, BASE, 'owner@nodmarc.com');
      assert.match(await page.textContent('#result-title'), /At risk/);
      assert.match(await page.textContent('.grade-domain'), /Google Workspace/);
      const titles = await page.$$eval('.fix-list > li h3', (els) => els.map((e) => e.textContent));
      assert.deepEqual(titles, ['Publish a DMARC record', 'Tighten SPF from ~all to -all']);
      assert.ok(await page.$('.fix-list a[href^="https://support.google.com/a/"]'), 'links Google docs');
      const dkim = await page.textContent('details.check-pass:has-text("DKIM")');
      assert.match(dkim, /google/);
      await noHorizontalScroll(page, 'at-risk ' + w);
      await page.screenshot({ path: path.join(SHOTS, `check-atrisk-nodmarc-${w}-${scheme}.png`), fullPage: true });
      await finish(ctx, seen, 'no dmarc');
    }
  });

  await scenario('4a. SPF +all → At risk, first fix removes +all', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 900 }, colorScheme: 'dark' });
    const seen = await attach(page, 'ok');
    await check(page, BASE, 'openspf.com');
    assert.match(await page.textContent('#result-title'), /At risk/);
    const first = await page.textContent('.fix-list > li:first-child');
    assert.match(first, /Stop your SPF record from approving everyone/);
    assert.match(first, /v=spf1 include:emailsrvr\.com -all/);
    await noHorizontalScroll(page, '+all');
    await page.screenshot({ path: path.join(SHOTS, 'check-atrisk-plusall-390-dark.png'), fullPage: true });
    await finish(ctx, seen, '+all');
  });

  await scenario('4b. SPF over 10 lookups → Needs work with a lookup breakdown', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 900 }, colorScheme: 'light' });
    const seen = await attach(page, 'ok');
    await check(page, BASE, 'toomany.com');
    assert.match(await page.textContent('#result-title'), /Needs work/);
    assert.match(await page.textContent('.fix-list > li:first-child'), /Trim your SPF record to 10 lookups or fewer/);
    await page.click('details.check:has-text("Approved senders") > summary');
    const total = await page.textContent('table.breakdown tr:last-child td:last-child');
    assert.equal(total.trim(), '13');
    await noHorizontalScroll(page, 'too many');
    await page.screenshot({ path: path.join(SHOTS, 'check-toomany-390-light.png'), fullPage: true });
    await finish(ctx, seen, 'too many');
  });

  await scenario('5. Cloudflare down → falls back to Google', async () => {
    const { ctx, page } = await newPage();
    const seen = await attach(page, 'cloudflare-down');
    await check(page, BASE, 'strongfirm.com');
    assert.match(await page.textContent('#result-title'), /Strong/);
    assert.ok(seen.google.length >= 12, 'Google answered');
    // Chromium logs the simulated 503s as network errors; page scripts logged nothing.
    seen.consoleErrors = seen.consoleErrors.filter((e) => !/Failed to load resource.*503/.test(e));
    await finish(ctx, seen, 'fallback');
  });

  await scenario('6. both DNS services unreachable → clear message, no grade', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
    const seen = await attach(page, 'all-down');
    // Chromium logs failed fetches as console errors; those are expected here.
    await check(page, BASE, 'strongfirm.com');
    assert.equal(await page.textContent('#result-title'), "We couldn't reach a DNS service");
    assert.equal(await page.$('.grade-card'), null);
    await page.screenshot({ path: path.join(SHOTS, 'check-unreachable-390-light.png'), fullPage: true });
    seen.consoleErrors = seen.consoleErrors.filter((e) => !/Failed to load resource|ERR_CONNECTION_REFUSED|503/.test(e));
    await finish(ctx, seen, 'all down');
  });

  await scenario('7. NXDOMAIN typo → "did you mean" suggestion', async () => {
    const { ctx, page } = await newPage();
    const seen = await attach(page, 'ok');
    await check(page, BASE, 'jane@strongfirm.con');
    assert.equal(await page.textContent('#result-title'), "We couldn't find strongfirm.con");
    await page.click('text=Check strongfirm.com instead');
    await page.waitForSelector('.grade-card');
    assert.match(await page.textContent('#result-title'), /Strong/);
    await finish(ctx, seen, 'nxdomain');
  });

  await scenario('8. input validation rejects IPs and localhost without any DNS query', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
    const seen = await attach(page, 'ok');
    await page.goto(BASE + '/check/');
    for (const [value, re] of [['192.168.1.1', /IP address/], ['localhost', /private or test name/], ['', /Type your work email/], ['smithcpa', /Include the ending/]]) {
      await page.fill('#domain-input', value);
      await page.click('#check-button');
      await page.waitForSelector('#domain-error:not([hidden])');
      assert.match(await page.textContent('#domain-error'), re);
      assert.equal(await page.getAttribute('#domain-input', 'aria-invalid'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'domain-input');
    }
    await page.screenshot({ path: path.join(SHOTS, 'check-input-error-390-light.png') });
    assert.equal(seen.cloudflare.length + seen.google.length, 0);
    await finish(ctx, seen, 'validation');
  });

  await scenario('9. a shared #d= link runs the check on load', async () => {
    const { ctx, page } = await newPage();
    const seen = await attach(page, 'ok');
    await page.goto(BASE + '/check/#d=shoutyfirm.com');
    await page.waitForSelector('.grade-card');
    assert.match(await page.textContent('.grade-domain'), /behind Proofpoint/);
    assert.equal(await page.inputValue('#domain-input'), 'shoutyfirm.com');
    await finish(ctx, seen, 'hash');
  });

  await scenario('10. DMARC lookup hangs → times out and shows "Not graded"', async () => {
    const { ctx, page } = await newPage();
    const seen = await attach(page, 'ok');
    await check(page, BASE, 'halfslow.com');
    assert.match(await page.textContent('#result-title'), /Not graded/);
    assert.match(await page.textContent('details.check-error'), /timed out/);
    await finish(ctx, seen, 'timeout');
  });

  await scenario('keyboard: focus is visible and lands on the result heading', async () => {
    const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
    const seen = await attach(page, 'ok');
    await page.goto(BASE + '/check/');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.focus('#domain-input');
    await page.keyboard.type('monitorfirm.com');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#result-title');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'result-title');
    await page.focus('details.check > summary');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.equal(outline, 'solid');
    await finish(ctx, seen, 'keyboard');
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' browser scenarios passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
