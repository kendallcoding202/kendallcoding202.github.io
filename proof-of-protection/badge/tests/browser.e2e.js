'use strict';
/*
 * Browser test for the trust pages and badges (Playwright + Chromium).
 *   node proof-of-protection/badge/tests/browser.e2e.js [screenshot-dir]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const IMG = path.join(ROOT, 'badge', 'img');
const SHOTS = path.resolve(process.argv[2] || process.env.SCREENSHOT_DIR || path.join(require('os').tmpdir(), 'kovyr-badge-screenshots'));
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const firmJson = (o) => JSON.stringify(Object.assign({
  firm: 'Acme & Sons CPA', tagline: 'Accounting · Testville', status: 'verified',
  lastVerified: iso(Date.now() - 2 * 3600e3), validUntil: iso(Date.now() + 2 * DAY), proofUrl: '../demo/',
  coverage: '3 of 3 laptops', protections: [{ label: 'Laptops encrypted', detail: '3 of 3', source: 'Device check', met: true }, { label: 'Backups tested', detail: 'Overdue', source: 'Staff record', met: false }]
}, o));

async function setup(page, firmBody) {
  const seen = { errors: [], blocked: [] };
  page.on('console', (m) => { if (m.type() === 'error') seen.errors.push(m.text()); });
  page.on('pageerror', (e) => seen.errors.push(String(e)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') { seen.blocked.push(url.href); return route.abort(); }
    if (firmBody !== undefined && /\/badge\/firms\/test-firm\/firm\.json$/.test(url.pathname)) {
      return firmBody === 404 ? route.fulfill({ status: 404, body: 'nf' }) : route.fulfill({ status: 200, contentType: 'application/json', body: firmBody });
    }
    const img = /\/badge\/firms\/test-firm\/(web|email)-(light|dark)\.(svg|png)$/.exec(url.pathname);
    if (img) return route.fulfill({ status: 200, path: path.join(IMG, 'verified-' + img[1] + '-' + img[2] + '.' + img[3]) });
    return route.continue();
  });
  return seen;
}

async function done(ctx, seen, label, allow) {
  const errs = seen.errors.filter((e) => !(allow && allow.test(e)));
  if (errs.length) console.log('    console:', errs);
  assert.deepEqual(errs, [], label + ': console errors');
  assert.deepEqual(seen.blocked, [], label + ': third-party requests');
  await ctx.close();
}

async function noHScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw, label + ': horizontal scroll ' + sw + ' > ' + iw);
}

const visibleText = (page) => page.evaluate(() => document.body.innerText);
const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log('  ✓ ' + name);
  } catch (e) {
    results.push(false);
    console.log('  ✗ ' + name + '\n    ' + String(e.stack || e).split('\n').slice(0, 4).join('\n    '));
  }
}

(async () => {
  const server = await serve();
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const open = async (opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }, opts || {}));
    return { ctx, page: await ctx.newPage() };
  };
  console.log('Badge + trust page browser tests → screenshots in ' + SHOTS);

  await scenario('sample trust page: verified state at 390/1280, light/dark', async () => {
    for (const [w, scheme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
      const { ctx, page } = await open({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const seen = await setup(page);
      await page.goto(BASE + '/badge/sample.html');
      await page.waitForSelector('#status-title');
      assert.equal(await page.textContent('#status-title'), 'Security checks verified');
      assert.match(await page.textContent('#firm-name'), /^Maple Street Tax & Bookkeeping \(sample\)$/);
      assert.match(await page.textContent('.sample-banner'), /Fictional firm/);
      assert.match(await page.textContent('.status-card'), /Last verified:/);
      const labels = await page.$$eval('.protection .p-label', (els) => els.map((e) => e.textContent));
      for (const want of ['Multi-factor sign-in or passkeys on every account', 'Laptops encrypted', 'Updates current', 'Backups tested', 'Tamper alarm on']) assert.ok(labels.includes(want), want);
      assert.equal(await page.$$eval('.protection.p-check', (e) => e.length), labels.length);
      const verify = page.locator('a.btn-primary', { hasText: 'Verify the proof yourself' });
      assert.equal(await verify.getAttribute('href'), '../demo/');
      assert.equal(await verify.evaluate((a) => a.href), BASE + '/demo/');
      assert.match(await page.textContent('.limits'), /doesn't show/);
      assert.match(await page.textContent('.limits'), /not a certification or an audit/);
      const imgsOk = await page.$$eval('.badge-demo img', (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0));
      assert.ok(imgsOk, 'badge images load');
      assert.equal(await page.title(), 'Maple Street Tax & Bookkeeping (sample): security checks · Kovyr Proof');
      await noHScroll(page, 'sample ' + w);
      await page.screenshot({ path: path.join(SHOTS, `trust-sample-verified-${w}-${scheme}.png`), fullPage: true });
      await done(ctx, seen, 'sample ' + w);
    }
  });

  await scenario('sample: preview toggle and ?state=lapsed show Lapsed with no "verified" claim', async () => {
    for (const [w, scheme] of [[390, 'light'], [1280, 'dark']]) {
      const { ctx, page } = await open({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const seen = await setup(page);
      await page.goto(BASE + '/badge/sample.html');
      await page.click('button[data-preview="lapsed"]');
      assert.equal(await page.textContent('#status-title'), 'Security checks lapsed');
      assert.equal(await page.getAttribute('button[data-preview="lapsed"]', 'aria-pressed'), 'true');
      const text = await visibleText(page);
      assert.doesNotMatch(text, /Security checks verified/);
      assert.equal(await page.$$eval('.protection.p-check', (e) => e.length), 0, 'no ticks when lapsed');
      assert.match(await page.textContent('#prot-title'), /not current/);
      assert.match(await page.getAttribute('.badge-demo img', 'src'), /lapsed-web-light\.svg/);
      await noHScroll(page, 'lapsed ' + w);
      await page.screenshot({ path: path.join(SHOTS, `trust-sample-lapsed-${w}-${scheme}.png`), fullPage: true });
      await page.click('button[data-preview="verified"]');
      assert.equal(await page.textContent('#status-title'), 'Security checks verified');
      await done(ctx, seen, 'toggle');
    }
    const { ctx, page } = await open();
    const seen = await setup(page);
    await page.goto(BASE + '/badge/sample.html?state=lapsed');
    assert.equal(await page.textContent('#status-title'), 'Security checks lapsed');
    await page.goto(BASE + '/badge/sample.html?state=verified');
    assert.equal(await page.textContent('#status-title'), 'Security checks verified');
    await done(ctx, seen, '?state');
  });

  await scenario('real firm page: current data shows Verified, unmet items show as gaps', async () => {
    const { ctx, page } = await open({ viewport: { width: 390, height: 844 } });
    const seen = await setup(page, firmJson());
    await page.goto(BASE + '/badge/trust.html?f=test-firm');
    await page.waitForSelector('#status-title');
    assert.equal(await page.textContent('#status-title'), 'Security checks verified');
    assert.equal(await page.textContent('#firm-name'), 'Acme & Sons CPA');
    assert.equal(await page.$('.sample-banner'), null);
    assert.equal(await page.$('.badge-demo'), null, 'sample-only section hidden');
    assert.match(await page.textContent('.protection.p-gap'), /Not met/);
    assert.equal(await page.title(), 'Acme & Sons CPA: security checks · Kovyr Proof');
    assert.doesNotMatch(page.url(), /state=/);
    await page.goto(BASE + '/badge/trust.html?f=test-firm&state=lapsed');
    assert.equal(await page.textContent('#status-title'), 'Security checks verified', 'the preview switch only works on the sample');
    await done(ctx, seen, 'real current');
  });

  await scenario('real firm page fails safe: expired, future-dated, wrong status → Lapsed', async () => {
    const bad = [
      firmJson({ validUntil: iso(Date.now() - 60e3) }),
      firmJson({ lastVerified: iso(Date.now() + 2 * DAY), validUntil: iso(Date.now() + 5 * DAY) }),
      firmJson({ status: 'paused' }),
      firmJson({ lastVerified: iso(Date.now() - 40 * DAY), validUntil: iso(Date.now() + 300 * DAY) }),
      firmJson({ validUntil: undefined })
    ];
    for (const body of bad) {
      const { ctx, page } = await open();
      const seen = await setup(page, body);
      await page.goto(BASE + '/badge/trust.html?f=test-firm');
      await page.waitForSelector('#status-title');
      assert.equal(await page.textContent('#status-title'), 'Security checks lapsed', body);
      assert.doesNotMatch(await visibleText(page), /Security checks verified/);
      await done(ctx, seen, 'fail-safe');
    }
  });

  await scenario('real firm page: unsafe proof link replaced; missing firm and bad slug show no status', async () => {
    let { ctx, page } = await open();
    let seen = await setup(page, firmJson({ proofUrl: 'javascript:alert(1)', firm: '<img src=x onerror=alert(1)>' }));
    await page.goto(BASE + '/badge/trust.html?f=test-firm');
    await page.waitForSelector('#status-title');
    assert.equal(await page.getAttribute('.verify a', 'href'), '../demo/');
    assert.equal(await page.textContent('#firm-name'), '<img src=x onerror=alert(1)>', 'rendered as text');
    assert.equal(await page.$('#firm-name img'), null);
    await done(ctx, seen, 'unsafe');

    ({ ctx, page } = await open());
    seen = await setup(page, 404);
    await page.goto(BASE + '/badge/trust.html?f=test-firm');
    await page.waitForSelector('main h1');
    assert.match(await page.textContent('main h1'), /couldn't find/);
    assert.doesNotMatch(await visibleText(page), /verified/i);
    await page.screenshot({ path: path.join(SHOTS, 'trust-missing-390-light.png') });
    await done(ctx, seen, '404', /404/);

    ({ ctx, page } = await open());
    seen = await setup(page);
    await page.goto(BASE + '/badge/trust.html?f=../../etc/passwd');
    await page.waitForSelector('main h1');
    assert.equal(await page.textContent('main h1'), 'No firm selected');
    await done(ctx, seen, 'bad slug');
  });

  await scenario('badge setup page: per-firm absolute URLs, neutral alt text, copy works', async () => {
    for (const [w, scheme] of [[390, 'light'], [1280, 'dark']]) {
      const { ctx, page } = await open({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      const seen = await setup(page, firmJson());
      await page.goto(BASE + '/badge/embed.html?f=test-firm');
      await page.waitForFunction(() => /Acme/.test(document.getElementById('for-firm').textContent));
      const sig = await page.inputValue('#sig-code');
      assert.ok(sig.includes('href="' + BASE + '/badge/trust.html?f=test-firm"'), sig);
      assert.ok(sig.includes('src="' + BASE + '/badge/firms/test-firm/email-light.png"'), sig);
      assert.ok(sig.includes('alt="Kovyr Proof security checks: see current status"'));
      for (const id of ['#sig-code', '#web-code', '#web-code-dark']) assert.doesNotMatch(await page.inputValue(id), /verified/i, id + ' alt/title must not claim verified');
      assert.match(await page.inputValue('#web-code-dark'), /firms\/test-firm\/web-dark\.svg/);
      await page.click('#copy-sig');
      await page.waitForFunction(() => /Copied/.test(document.getElementById('sig-status').textContent));
      assert.ok(await page.$$eval('main img', (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)));
      await noHScroll(page, 'embed ' + w);
      await page.screenshot({ path: path.join(SHOTS, `badge-embed-${w}-${scheme}.png`), fullPage: true });
      await done(ctx, seen, 'embed');
    }
    const { ctx, page } = await open();
    const seen = await setup(page);
    await page.goto(BASE + '/badge/embed.html');
    assert.match(await page.textContent('#for-firm'), /Sample/);
    assert.match(await page.inputValue('#sig-code'), /img\/verified-email-light\.png/);
    await page.goto(BASE + '/badge/embed.html?f=Bad/Slug');
    assert.match(await page.textContent('#embed-error'), /invalid firm name/);
    await done(ctx, seen, 'embed sample');
  });

  await scenario('with JavaScript off, no page claims "verified"', async () => {
    for (const p of ['/badge/sample.html', '/badge/trust.html?f=test-firm']) {
      const { ctx, page } = await open({ javaScriptEnabled: false });
      await page.goto(BASE + p);
      assert.doesNotMatch(await visibleText(page), /verified/i, p);
      await ctx.close();
    }
  });

  await scenario('badge SVGs parse cleanly and their text fits in several fonts', async () => {
    const { ctx, page } = await open({ deviceScaleFactor: 2, viewport: { width: 760, height: 600 } });
    const files = fs.readdirSync(IMG).filter((f) => f.endsWith('.svg') && f !== 'mark.svg');
    assert.equal(files.length, 8);
    for (const f of files) {
      const svg = fs.readFileSync(path.join(IMG, f), 'utf8');
      const report = await page.evaluate((src) => {
        const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
        if (doc.querySelector('parsererror')) return { error: doc.querySelector('parsererror').textContent };
        document.body.innerHTML = src;
        const el = document.body.querySelector('svg');
        const w = el.viewBox.baseVal.width;
        const out = [];
        for (const font of ['Liberation Sans', 'DejaVu Sans', 'Inter', 'FreeSans', 'Carlito']) {
          let max = 0;
          el.querySelectorAll('text').forEach((t) => {
            t.setAttribute('font-family', font);
            const b = t.getBBox();
            max = Math.max(max, b.x + b.width);
          });
          out.push({ font, right: max, width: w });
        }
        return { fits: out };
      }, svg);
      assert.ok(!report.error, f + ': ' + report.error);
      for (const r of report.fits) assert.ok(r.right <= r.width - 4, f + ' overflows in ' + r.font + ' (' + r.right.toFixed(1) + ' / ' + r.width + ')');
    }
    // Contact sheet of every badge as browsers render them.
    const cells = files.sort().map((f) => `<div style="padding:14px;background:${f.includes('dark') ? '#0d1622' : '#f5f7fa'}"><img src="${BASE}/badge/img/${f}"><div style="font:12px sans-serif;color:#888">${f}</div></div>`).join('');
    await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:1fr 1fr">${cells}</body>`);
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth));
    await page.screenshot({ path: path.join(SHOTS, 'badges-all.png'), fullPage: true });
    await ctx.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' badge scenarios passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
