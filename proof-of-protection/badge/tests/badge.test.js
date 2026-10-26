'use strict';
// Run: node --test proof-of-protection/badge/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../trust.js');
const B = require('../build-badges.js');
const BRAND = require('../../check/brand.js');

const DAY = 864e5;
const NOW = Date.parse('2026-10-26T15:00:00Z');
const firm = (o) => Object.assign({ status: 'verified', lastVerified: '2026-10-26T11:00:00Z', validUntil: '2026-10-29T11:00:00Z' }, o);
const allSvgText = (svg) => (svg.match(/<(title|text)[^>]*>[^<]*</g) || []).join(' ');

test('computeState: verified only while current and explicitly verified', () => {
  assert.equal(T.computeState(firm(), NOW).state, 'verified');
  assert.equal(T.computeState(firm(), Date.parse('2026-10-29T10:59:59Z')).state, 'verified');
  const cases = [
    [firm(), Date.parse('2026-10-29T11:00:00Z'), 'expired'],
    [firm(), NOW + 40 * DAY, 'expired'],
    [firm({ status: 'lapsed' }), NOW, 'status'],
    [firm({ status: 'Verified' }), NOW, 'status'],
    [firm({ status: undefined }), NOW, 'status'],
    [firm({ lastVerified: '2026-10-27T11:00:00Z' }), NOW, 'future'],
    [firm({ validUntil: '2026-10-25T00:00:00Z' }), NOW, 'invalid'],
    [firm({ validUntil: 'soon' }), NOW, 'invalid'],
    [firm({ lastVerified: null }), NOW, 'invalid'],
    [null, NOW, 'invalid'],
    ['verified', NOW, 'invalid']
  ];
  for (const [data, now, reason] of cases) {
    const s = T.computeState(data, now);
    assert.equal(s.state, 'lapsed', JSON.stringify(data));
    assert.equal(s.reason, reason, JSON.stringify(data));
  }
});

test('computeState caps validity at 31 days, so a typo cannot keep a badge verified', () => {
  const longOne = firm({ validUntil: '2027-10-26T11:00:00Z' });
  assert.equal(T.computeState(longOne, NOW + 30 * DAY).state, 'verified');
  assert.equal(T.computeState(longOne, NOW + 32 * DAY).state, 'lapsed');
});

test('safeUrl allows relative and https links only', () => {
  assert.equal(T.safeUrl('../demo/', 'x'), '../demo/');
  assert.equal(T.safeUrl('https://verify.example.org/p/123', 'x'), 'https://verify.example.org/p/123');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', '//evil.example', 'http://plain.example', '', null, 42]) {
    assert.equal(T.safeUrl(bad, '../demo/'), '../demo/', String(bad));
  }
});

test('isSlug accepts simple firm names only', () => {
  for (const ok of ['maple-street', 'smith-cpa-2', 'a']) assert.equal(T.isSlug(ok), true, ok);
  for (const bad of ['', 'Maple', '../etc', 'a/b', 'a.json', '-x', 'x'.repeat(64), null]) assert.equal(T.isSlug(bad), false, String(bad));
});

test('sample dates are always current', () => {
  for (const now of [Date.parse('2026-10-26T03:00:00'), Date.parse('2026-10-26T12:00:00'), Date.parse('2027-03-01T23:59:00')]) {
    const s = T.withSampleDates({ status: 'verified' }, now);
    assert.ok(Date.parse(s.lastVerified) <= now);
    assert.equal(T.computeState(s, now).state, 'verified');
  }
});

test('badges: honest wording, and lapsed badges never say "verified"', () => {
  for (const size of ['web', 'email']) {
    for (const theme of ['light', 'dark']) {
      const v = B.badgeSvg({ size, theme, state: 'verified' });
      const l = B.badgeSvg({ size, theme, state: 'lapsed' });
      assert.match(v, />Security checks verified</);
      assert.ok(v.includes(BRAND.product));
      assert.match(l, />Security checks lapsed</);
      assert.doesNotMatch(allSvgText(l), /verified/i, 'lapsed ' + size + ' ' + theme);
      for (const svg of [v, l]) {
        assert.doesNotMatch(allSvgText(svg), /unhackable|certified|compliant|guarantee|secure\b/i);
        assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
        assert.match(svg, /role="img"/);
        assert.equal((svg.match(/<text/g) || []).length, 2);
      }
    }
  }
  assert.match(B.badgeSvg({ size: 'web', theme: 'light', state: 'verified', checked: Date.parse('2026-10-26T11:00:00Z') }), /Checked 26 Oct 2026/);
});

test('badge text shrinks to fit rather than overflowing', () => {
  const max = B.SIZES.email.w - B.SIZES.email.x - 10;
  assert.equal(B.fit('Short', 12, max, true), 12);
  const long = 'A Much Longer Product Name Proof · Checked 26 Oct 2026';
  const size = B.fit(long, 10, max, false);
  assert.ok(size < 10);
  assert.ok(B.textWidth(long, size, false) <= max);
});

test('build --firm writes the state-correct badge under stable file names', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kovyr-badge-'));
  const firmsDir = path.join(tmp, 'firms');
  fs.mkdirSync(path.join(firmsDir, 'acme-cpa'), { recursive: true });
  fs.writeFileSync(path.join(firmsDir, 'acme-cpa', 'firm.json'), JSON.stringify(firm({ firm: 'Acme & Sons CPA' })));
  const log = console.log;
  console.log = () => {};
  try {
    const current = await B.buildFirm('acme-cpa', { firmsDir, png: false, now: NOW });
    assert.equal(current.state, 'verified');
    const files = fs.readdirSync(path.join(firmsDir, 'acme-cpa')).sort();
    assert.deepEqual(files, ['email-dark.svg', 'email-light.svg', 'firm.json', 'web-dark.svg', 'web-light.svg']);
    assert.match(fs.readFileSync(path.join(firmsDir, 'acme-cpa', 'web-light.svg'), 'utf8'), /Checked 26 Oct 2026/);

    const later = await B.buildFirm('acme-cpa', { firmsDir, png: false, now: NOW + 5 * DAY });
    assert.equal(later.state, 'lapsed');
    for (const f of ['email-dark.svg', 'email-light.svg', 'web-dark.svg', 'web-light.svg']) {
      const svg = fs.readFileSync(path.join(firmsDir, 'acme-cpa', f), 'utf8');
      assert.match(svg, /Security checks lapsed/, f);
      assert.doesNotMatch(allSvgText(svg), /verified/i, f);
    }
    await assert.rejects(B.buildFirm('../etc', { firmsDir, png: false }), /slug/);
  } finally {
    console.log = log;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the committed sample badges match the current brand constants', () => {
  const dir = path.join(__dirname, '..', 'img');
  for (const state of ['verified', 'lapsed']) {
    for (const size of ['web', 'email']) {
      for (const theme of ['light', 'dark']) {
        const file = path.join(dir, state + '-' + size + '-' + theme + '.svg');
        assert.equal(fs.readFileSync(file, 'utf8'), B.badgeSvg({ size, theme, state }), 'stale: re-run node badge/build-badges.js');
        assert.ok(fs.existsSync(file.replace(/\.svg$/, '.png')), 'missing PNG for ' + file);
      }
    }
  }
});

test('the firm template is valid and currently parseable', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firms', '_template', 'firm.json'), 'utf8'));
  assert.ok(data.firm && data.protections.length >= 5);
  assert.ok(T.computeState(data, Date.parse(data.lastVerified) + DAY).state === 'verified');
});
