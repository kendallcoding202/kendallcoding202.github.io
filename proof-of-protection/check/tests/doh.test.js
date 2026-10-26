'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../grader.js');
const D = require('../doh.js');
const F = require('./fixtures.js');

/** Fake fetch: `plan(provider, name, type)` returns a JSON body, 'TIMEOUT', 'NETWORK', 'BADJSON' or an HTTP status number. */
function fakeFetch(plan) {
  const calls = [];
  const fn = (url, init) => {
    const u = new URL(url);
    const provider = u.hostname === 'cloudflare-dns.com' ? 'cloudflare' : u.hostname === 'dns.google' ? 'google' : 'other';
    const name = u.searchParams.get('name');
    const type = u.searchParams.get('type');
    calls.push({ provider, name, type, headers: init && init.headers, init });
    const outcome = plan(provider, name, type);
    if (outcome === 'TIMEOUT') {
      return new Promise((resolve, reject) => {
        if (init && init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (outcome === 'NETWORK') return Promise.reject(new TypeError('Failed to fetch'));
    if (typeof outcome === 'number') return Promise.resolve({ ok: false, status: outcome, json: () => Promise.resolve({}) });
    if (outcome === 'BADJSON') return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(outcome) });
  };
  fn.calls = calls;
  return fn;
}

const zonePlan = (overrides) => (provider, name, type) => {
  if (overrides) {
    const o = overrides(provider, name, type);
    if (o !== undefined) return o;
  }
  return F.dohAnswer(F.ZONES, name, type, provider === 'google' ? 'google' : 'cloudflare');
};

test('asks Cloudflare first, with the dns-json accept header and no credentials', async () => {
  const fetch = fakeFetch(zonePlan());
  const { resolve } = D.createResolver({ fetch });
  const r = await resolve('strongfirm.com', 'TXT');
  assert.equal(r.status, 'NOERROR');
  assert.equal(r.provider, 'cloudflare');
  assert.ok(r.records.includes('v=spf1 include:spf.protection.outlook.com -all'));
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].headers.accept, 'application/dns-json');
  assert.equal(fetch.calls[0].init.credentials, 'omit');
  assert.equal(fetch.calls[0].init.referrerPolicy, 'no-referrer');
});

test('NXDOMAIN from Cloudflare is an answer, not a reason to fall back', async () => {
  const fetch = fakeFetch(zonePlan());
  const { resolve } = D.createResolver({ fetch });
  const r = await resolve('_dmarc.nodmarc.com', 'TXT');
  assert.equal(r.status, 'NXDOMAIN');
  assert.equal(fetch.calls.length, 1);
});

test('falls back to Google on network error, HTTP error, bad JSON and SERVFAIL', async () => {
  for (const failure of ['NETWORK', 500, 403, 'BADJSON', { Status: 2 }]) {
    const fetch = fakeFetch(zonePlan((p) => (p === 'cloudflare' ? failure : undefined)));
    const { resolve } = D.createResolver({ fetch });
    const r = await resolve('strongfirm.com', 'TXT');
    assert.equal(r.status, 'NOERROR', JSON.stringify(failure));
    assert.equal(r.provider, 'google');
    assert.ok(r.records.includes('v=spf1 include:spf.protection.outlook.com -all'), 'Google unquoted TXT parsed');
    assert.deepEqual(fetch.calls.map((c) => c.provider), ['cloudflare', 'google']);
  }
});

test('a Cloudflare timeout aborts the request and falls back to Google', async () => {
  const fetch = fakeFetch(zonePlan((p) => (p === 'cloudflare' ? 'TIMEOUT' : undefined)));
  const { resolve } = D.createResolver({ fetch, timeoutMs: 40 });
  const t0 = Date.now();
  const r = await resolve('strongfirm.com', 'MX');
  assert.equal(r.provider, 'google');
  assert.deepEqual(r.records, ['0 strongfirm-com.mail.protection.outlook.com.']);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(fetch.calls[0].init.signal.aborted, true);
});

test('when both providers fail, the last failure is reported', async () => {
  let r = await D.createResolver({ fetch: fakeFetch(() => 'TIMEOUT'), timeoutMs: 30 }).resolve('a.com', 'TXT');
  assert.equal(r.status, 'TIMEOUT');
  r = await D.createResolver({ fetch: fakeFetch(() => ({ Status: 2 })) }).resolve('a.com', 'TXT');
  assert.equal(r.status, 'SERVFAIL');
  r = await D.createResolver({ fetch: fakeFetch(() => 'NETWORK') }).resolve('a.com', 'TXT');
  assert.equal(r.status, 'ERROR');
  r = await D.createResolver({ fetch: fakeFetch(() => ({ Status: 5 })) }).resolve('a.com', 'TXT');
  assert.equal(r.status, 'REFUSED');
});

test('caches identical queries within one check', async () => {
  const fetch = fakeFetch(zonePlan());
  const { resolve, stats } = D.createResolver({ fetch });
  await Promise.all([resolve('strongfirm.com', 'TXT'), resolve('STRONGFIRM.com', 'TXT'), resolve('strongfirm.com', 'MX')]);
  assert.equal(fetch.calls.length, 2);
  assert.equal(stats.queries, 2);
});

test('after Cloudflare times out, later lookups go to Google first', async () => {
  const fetch = fakeFetch(zonePlan((p) => (p === 'cloudflare' ? 'TIMEOUT' : undefined)));
  const { resolve } = D.createResolver({ fetch, timeoutMs: 30 });
  await resolve('strongfirm.com', 'TXT');
  await resolve('strongfirm.com', 'MX');
  assert.deepEqual(fetch.calls.map((c) => c.provider), ['cloudflare', 'google', 'google']);
});

test('end to end: a full check over fake DoH, with and without Cloudflare', async () => {
  const ok = D.createResolver({ fetch: fakeFetch(zonePlan()) });
  const a = await G.runCheck('toomany.com', ok.resolve);
  assert.equal(a.grade.id, 'needs-work');
  assert.equal(a.checks.spf.lookups, 13);

  const downFetch = fakeFetch(zonePlan((p) => (p === 'cloudflare' ? 'NETWORK' : undefined)));
  const cfDown = D.createResolver({ fetch: downFetch });
  const b = await G.runCheck('strongfirm.com', cfDown.resolve);
  assert.equal(b.grade.id, 'strong');
  // The first parallel wave all tries Cloudflare; the SPF include lookup that
  // follows goes straight to Google because Cloudflare was demoted.
  const include = downFetch.calls.filter((c) => c.name === 'spf.protection.outlook.com').map((c) => c.provider);
  assert.deepEqual(include, ['google']);

  const allDown = D.createResolver({ fetch: fakeFetch(() => 'NETWORK') });
  assert.equal((await G.runCheck('strongfirm.com', allDown.resolve)).kind, 'unreachable');
});

test('resolve never rejects, even if fetch is missing', async () => {
  const r = await D.createResolver({ fetch: null, providers: [] }).resolve('a.com', 'TXT');
  assert.equal(r.status, 'ERROR');
});
