'use strict';
// Run: node --test proof-of-protection/check/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../grader.js');
const F = require('./fixtures.js');

const run = (domain, zones, opts) => G.runCheck(domain, F.zoneResolver(G, zones, opts));
const withZones = (extra) => Object.assign({}, F.THIRD_PARTY, extra);
const spfFor = async (record, extra) => {
  const zones = withZones(Object.assign({ 'x.test-firm.com': { TXT: [].concat(record) } }, extra || {}));
  return G.evaluateSpf('x.test-firm.com', F.zoneResolver(G, zones));
};
const dmarcFor = async (records, domain) => {
  domain = domain || 'firm.com';
  const zones = { [domain]: { TXT: ['v=spf1 -all'] } };
  if (records !== null) zones['_dmarc.' + domain] = { TXT: [].concat(records) };
  return G.evaluateDmarc(domain, F.zoneResolver(G, zones));
};

/* ---------------------------------------------------------------- input */

test('normalizeInput accepts emails, domains and URLs', () => {
  const cases = [
    ['jane@SmithCPA.com', 'smithcpa.com', 'email'],
    ['  smithcpa.com  ', 'smithcpa.com', 'domain'],
    ['SMITHCPA.COM.', 'smithcpa.com', 'domain'],
    ['https://www.smithcpa.com/contact?x=1#top', 'smithcpa.com', 'domain'],
    ['www.smithcpa.com', 'smithcpa.com', 'domain'],
    ['Jane Doe <jane@smithcpa.com>', 'smithcpa.com', 'email'],
    ['mailto:jane@smithcpa.com', 'smithcpa.com', 'email'],
    ['"odd@local"@smithcpa.com', 'smithcpa.com', 'email'],
    ['jane@mail.smithcpa.co.uk', 'mail.smithcpa.co.uk', 'email'],
    ['smithcpa.com:443', 'smithcpa.com', 'domain'],
    ['smithcpa.com,', 'smithcpa.com', 'domain'],
    ['bücher.de', 'xn--bcher-kva.de', 'domain'],
    ['xn--bcher-kva.de', 'xn--bcher-kva.de', 'domain'],
    ['smith-cpa.law', 'smith-cpa.law', 'domain'],
    ['www.com', 'www.com', 'domain']
  ];
  for (const [input, domain, kind] of cases) {
    const r = G.normalizeInput(input);
    assert.equal(r.ok, true, input + ' → ' + r.error);
    assert.equal(r.domain, domain, input);
    assert.equal(r.kind, kind, input);
  }
});

test('normalizeInput rejects IPs, localhost, private names and junk', () => {
  const cases = [
    ['', 'empty'], ['   ', 'empty'], [null, 'empty'], ['jane@', 'emailNoDomain'],
    ['192.168.1.1', 'ip'], ['http://10.0.0.1/admin', 'ip'], ['[::1]', 'ip'], ['2001:db8::1', 'ip'],
    ['user@[127.0.0.1]', 'ip'], ['0x7f000001', 'ip'], ['example.123', 'ip'],
    ['localhost', 'local'], ['jane@localhost', 'local'], ['printer.local', 'local'], ['server.internal', 'local'],
    ['nas.home.arpa', 'local'], ['site.test', 'local'], ['x.onion', 'local'],
    ['smithcpa', 'noTld'], ['smith cpa.com', 'invalid'], ['smith_cpa.com', 'invalid'], ['-smith.com', 'invalid'],
    ['smith-.com', 'invalid'], ['smith..com', 'invalid'], ['a'.repeat(64) + '.com', 'tooLong'],
    [('a'.repeat(60) + '.').repeat(5) + 'com', 'tooLong'], ['smith.c', 'invalid'], ['smith.c0m', 'invalid']
  ];
  for (const [input, code] of cases) {
    const r = G.normalizeInput(input);
    assert.equal(r.ok, false, String(input) + ' should be rejected');
    assert.equal(r.code, code, String(input));
    assert.ok(r.error && r.error.length > 10, 'has a plain-English message');
  }
});

/* ------------------------------------------------------------ DoH JSON */

test('joinTxt handles quoted, split, escaped and unquoted TXT data', () => {
  assert.equal(G.joinTxt('"v=spf1 -all"'), 'v=spf1 -all');
  assert.equal(G.joinTxt('"v=spf1 include:a.com " "include:b.com -all"'), 'v=spf1 include:a.com include:b.com -all');
  assert.equal(G.joinTxt('"v=spf1 include:a.com" "include:b.com -all"'), 'v=spf1 include:a.cominclude:b.com -all', 'no space is inserted between strings (RFC 7208 §3.3)');
  assert.equal(G.joinTxt('"part1""part2"'), 'part1part2');
  assert.equal(G.joinTxt('"say \\"hi\\""'), 'say "hi"');
  assert.equal(G.joinTxt('"back\\\\slash"'), 'back\\slash');
  assert.equal(G.joinTxt('"semi\\059colon"'), 'semi;colon');
  assert.equal(G.joinTxt('v=spf1 include:_spf.google.com ~all'), 'v=spf1 include:_spf.google.com ~all', 'Google returns unquoted text');
  assert.equal(G.joinTxt('  "padded"  '), 'padded');
  assert.equal(G.joinTxt(null), '');
  assert.equal(G.joinTxt('""'), '');
});

test('parseDohJson maps status codes and filters answer types', () => {
  const ok = G.parseDohJson({ Status: 0, Answer: [
    { name: 'a.com.', type: 5, data: 'b.com.' },
    { name: 'b.com.', type: 16, data: '"v=spf1 -all"' },
    { name: 'b.com.', type: 46, data: 'RRSIG junk' }
  ] }, 'TXT');
  assert.deepEqual(ok, { status: 'NOERROR', records: ['v=spf1 -all'], cnames: ['b.com'] });
  assert.equal(G.parseDohJson({ Status: 3 }, 'TXT').status, 'NXDOMAIN');
  assert.equal(G.parseDohJson({ Status: 2 }, 'TXT').status, 'SERVFAIL');
  assert.equal(G.parseDohJson({ Status: 5 }, 'MX').status, 'REFUSED');
  assert.deepEqual(G.parseDohJson({ Status: 0 }, 'MX').records, []);
  assert.deepEqual(G.parseDohJson({ Status: 0, Answer: [{ type: 15, data: '10 mx.a.com.' }, { type: 15 }] }, 'MX').records, ['10 mx.a.com.']);
  for (const bad of [null, undefined, {}, { Status: '0' }, 'html', []]) {
    assert.equal(G.parseDohJson(bad, 'TXT').status, 'ERROR');
  }
  assert.equal(G.isAnswer({ status: 'NXDOMAIN' }), true);
  assert.equal(G.isAnswer({ status: 'SERVFAIL' }), false);
  assert.equal(G.isAnswer(null), false);
});

/* ----------------------------------------------------- MX and provider */

test('parseMx sorts by priority and recognises null MX', () => {
  assert.deepEqual(G.parseMx(['20 b.example.net.', '10 A.Example.NET.', 'garbage']), [
    { priority: 10, host: 'a.example.net' }, { priority: 20, host: 'b.example.net' }
  ]);
  const nullMx = G.evaluateMx({ status: 'NOERROR', records: ['0 .'] });
  assert.equal(nullMx.nullMx, true);
  assert.equal(nullMx.status, 'info');
  assert.equal(G.evaluateMx({ status: 'NOERROR', records: [] }).status, 'warn');
  assert.equal(G.evaluateMx({ status: 'NXDOMAIN', records: [] }).status, 'warn');
  assert.equal(G.evaluateMx({ status: 'SERVFAIL', records: [] }).status, 'error');
  assert.equal(G.evaluateMx({ status: 'NOERROR', records: ['10 mx.a.com.'] }).status, 'pass');
});

test('detectProvider recognises Microsoft 365, Google Workspace, gateways and others', () => {
  const mx = (...hosts) => ({ status: 'pass', hosts });
  const spf = (...includes) => ({ includes, records: includes.length ? ['v=spf1 include:' + includes[0] + ' -all'] : [] });
  assert.equal(G.detectProvider(mx('smithcpa-com.mail.protection.outlook.com'), spf()).id, 'm365');
  assert.equal(G.detectProvider(mx('smithcpa-com.r-v1.mx.microsoft'), spf()).id, 'm365');
  for (const h of ['aspmx.l.google.com', 'alt1.aspmx.l.google.com', 'smtp.google.com', 'aspmx2.googlemail.com']) {
    assert.equal(G.detectProvider(mx(h), spf()).id, 'google', h);
  }
  const pp = G.detectProvider(mx('mx0a-001.pphosted.com'), spf('spf.protection.outlook.com'));
  assert.equal(pp.id, 'm365');
  assert.match(pp.label, /behind Proofpoint/);
  const mc = G.detectProvider(mx('us-smtp-inbound-1.mimecast.com'), spf());
  assert.equal(mc.id, 'other');
  assert.equal(mc.name, 'Mimecast');
  assert.equal(G.detectProvider(mx('smtp.secureserver.net'), spf()).name, 'GoDaddy email');
  assert.equal(G.detectProvider(mx('mail.myfirm.com'), spf()).id, 'other');
  assert.equal(G.detectProvider(mx(), spf()).id, 'none', 'no MX and no senders = unused domain');
  assert.equal(G.detectProvider(mx(), spf('sendgrid.net')).id, 'other', 'no MX but SPF lists senders');
  assert.equal(G.detectProvider(mx(), spf('_spf.google.com')).id, 'google');
  const failed = G.detectProvider({ status: 'error', hosts: [] }, spf());
  assert.equal(failed.id, 'other', 'a failed MX lookup is never treated as "no email"');
});

/* ----------------------------------------------------------- SPF parse */

test('parseSpf reads terms, qualifiers and modifiers', () => {
  const p = G.parseSpf('v=spf1 ip4:192.0.2.0/24 ip6:2001:db8::/32 a mx:mail.firm.com/24 a/24 ~include:_spf.google.com exists:%{i}.x.com redirect=_spf.firm.com exp=explain.firm.com foo=bar -all');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.terms.map((t) => t.qualifier + t.mechanism), ['+ip4', '+ip6', '+a', '+mx', '+a', '~include', '+exists', '-all']);
  assert.equal(p.terms[3].value, 'mail.firm.com');
  assert.equal(p.terms[3].cidr, '/24');
  assert.equal(p.redirect, '_spf.firm.com');
  assert.equal(p.exp, 'explain.firm.com');
  assert.equal(p.all.qualifier, '-');
  assert.match(p.warnings.join(' '), /redirect= " is ignored|"redirect=" is ignored/);
});

test('parseSpf is case-insensitive and tolerates extra whitespace', () => {
  assert.equal(G.isSpfRecord('V=SPF1 INCLUDE:X.COM -ALL'), true);
  assert.equal(G.isSpfRecord('v=spf1'), true);
  assert.equal(G.isSpfRecord('v=spf10 -all'), false);
  assert.equal(G.isSpfRecord('spf2.0/pra include:x.com'), false);
  const p = G.parseSpf('V=SPF1   INCLUDE:SPF.PROTECTION.OUTLOOK.COM    -ALL  ');
  assert.deepEqual(p.errors, []);
  assert.equal(p.terms[0].value, 'spf.protection.outlook.com');
  assert.equal(p.all.qualifier, '-');
});

test('parseSpf flags malformed terms', () => {
  const bad = ['inlcude:x.com', 'ip4:300.1.1.1', 'ip4:1.2.3.4/33', 'ip4 1.2.3.4', 'ip6:zz::1', 'include', 'include:', 'include:localhost', 'all:x', 'ptr/24', 'mx:', 'redirect=', '+-all', 'a:bad..domain.com'];
  for (const t of bad) {
    const p = G.parseSpf('v=spf1 ' + t + ' -all');
    assert.ok(p.errors.length >= 1, t + ' should be an error');
  }
  assert.match(G.parseSpf('v=spf1 a v=spf1 mx -all').errors[0], /pasted together/);
  assert.match(G.parseSpf('v=spf1 redirect=a.com redirect=b.com').errors[0], /more than once/);
  assert.match(G.parseSpf('v=spf1 -all include:x.com').warnings[0], /never checked/);
});

/* -------------------------------------------------------- SPF evaluate */

test('SPF: missing, near-miss and multiple records', async () => {
  const none = await spfFor('google-site-verification=abc');
  assert.equal(none.state, 'missing');
  assert.equal(none.status, 'fail');
  const near = await spfFor('spf1 include:spf.protection.outlook.com -all');
  assert.equal(near.state, 'missing');
  assert.match(near.details[0], /doesn't start with "v=spf1"/);
  const multi = await spfFor(['v=spf1 include:spf.protection.outlook.com -all', 'v=spf1 include:_spf.google.com ~all']);
  assert.equal(multi.state, 'multiple');
  assert.deepEqual(multi.issues, ['spf-multiple']);
  assert.deepEqual(multi.includes, ['spf.protection.outlook.com', '_spf.google.com']);
});

test('SPF: the "all" qualifier decides the state', async () => {
  const expect = {
    'v=spf1 include:spf.protection.outlook.com -all': ['pass', 'pass'],
    'v=spf1 include:spf.protection.outlook.com ~all': ['soft', 'warn'],
    'v=spf1 include:spf.protection.outlook.com ?all': ['neutral', 'fail'],
    'v=spf1 include:spf.protection.outlook.com +all': ['open', 'fail'],
    'v=spf1 include:spf.protection.outlook.com all': ['open', 'fail'],
    'v=spf1 include:spf.protection.outlook.com': ['neutral', 'fail']
  };
  for (const [rec, [state, status]] of Object.entries(expect)) {
    const r = await spfFor(rec);
    assert.equal(r.state, state, rec);
    assert.equal(r.status, status, rec);
  }
  assert.ok((await spfFor('v=spf1 +all')).issues.includes('spf-plus-all'));
  assert.ok((await spfFor('v=spf1 mx')).issues.includes('spf-no-all'));
});

test('SPF: counts lookups through a real-world include chain over 10', async () => {
  const r = await G.evaluateSpf('toomany.com', F.zoneResolver(G));
  // outlook 1 + google 4 + sendgrid 1 + mailchimp 1 + constant contact 1 + salesforce 2 + zendesk 1 + a 1 + mx 1
  assert.equal(r.lookups, 13);
  assert.equal(r.state, 'broken');
  assert.ok(r.issues.includes('spf-too-many-lookups'));
  assert.match(r.summary, /13 DNS lookups/);
  const google = r.breakdown.find((b) => b.term === 'include:_spf.google.com');
  assert.equal(google.lookups, 4);
  assert.equal(r.breakdown.reduce((n, b) => n + b.lookups, 0), 13);
  assert.match(r.details.join(' '), /macros/);
});

test('SPF: exactly 10 lookups passes with a warning note; 11 fails', async () => {
  const mk = (n) => 'v=spf1 ' + Array.from({ length: n }, (_, i) => 'a:h' + i + '.firm.com').join(' ') + ' -all';
  const ten = await spfFor(mk(10));
  assert.equal(ten.lookups, 10);
  assert.equal(ten.state, 'pass');
  assert.match(ten.details.join(' '), /close to the 10-lookup limit/);
  const eleven = await spfFor(mk(11));
  assert.equal(eleven.lookups, 11);
  assert.equal(eleven.state, 'broken');
});

test('SPF: include loops and deep chains terminate', async () => {
  const loop = await G.evaluateSpf('loopfirm.com', F.zoneResolver(G));
  assert.ok(loop.issues.includes('spf-loop'));
  assert.ok(loop.issues.includes('spf-include-missing'));
  assert.equal(loop.state, 'broken');
  assert.match(loop.details.join(' '), /loopfirm\.com → spf\.loopfirm\.com → loopfirm\.com/);

  const zones = {};
  for (let i = 0; i < 15; i++) zones['l' + i + '.deep.com'] = { TXT: ['v=spf1 include:l' + (i + 1) + '.deep.com -all'] };
  zones['deep.com'] = { TXT: ['v=spf1 include:l0.deep.com -all'] };
  const resolve = F.zoneResolver(G, zones);
  const deep = await G.evaluateSpf('deep.com', resolve);
  assert.ok(deep.lookups > 10);
  assert.ok(resolve.log.length <= 12, 'stops following at the depth limit');
  assert.match(deep.details.join(' '), /stopped following/);
});

test('SPF: fan-out is capped so a hostile record cannot cause unbounded queries', async () => {
  const zones = { 'fan.com': { TXT: ['v=spf1 ' + Array.from({ length: 8 }, (_, i) => 'include:f' + i + '.fan.com').join(' ') + ' -all'] } };
  for (let i = 0; i < 8; i++) zones['f' + i + '.fan.com'] = { TXT: ['v=spf1 ' + Array.from({ length: 8 }, (_, j) => 'include:g' + j + '.fan.com').join(' ') + ' -all'] };
  for (let j = 0; j < 8; j++) zones['g' + j + '.fan.com'] = { TXT: ['v=spf1 ip4:192.0.2.' + j + ' -all'] };
  const resolve = F.zoneResolver(G, zones);
  const r = await G.evaluateSpf('fan.com', resolve);
  assert.ok(resolve.log.length <= 41, 'at most 40 include queries plus the root, got ' + resolve.log.length);
  assert.equal(r.state, 'broken');
});

test('SPF: include targets that are missing, failing or macro-based', async () => {
  const missing = await spfFor('v=spf1 include:nowhere-vendor.com -all');
  assert.equal(missing.state, 'broken');
  assert.deepEqual(missing.missingIncludes, ['nowhere-vendor.com']);
  const flaky = await spfFor('v=spf1 include:flaky.com -all', { 'flaky.com': { $rcode: 2 } });
  assert.equal(flaky.state, 'pass', 'a third-party SERVFAIL is not your error');
  assert.deepEqual(flaky.unresolved, ['flaky.com']);
  assert.match(flaky.details.join(' '), /real lookup count may be higher/);
  const slow = await spfFor('v=spf1 include:slow-vendor.com -all', { 'slow-vendor.com': { $timeout: true } });
  assert.deepEqual(slow.unresolved, ['slow-vendor.com']);
  const macro = await spfFor('v=spf1 include:%{d}._spf.vendor.com -all');
  assert.equal(macro.lookups, 1);
  assert.equal(macro.state, 'pass');
});

test('SPF: redirect= counts as a lookup and supplies the "all"', async () => {
  const r = await G.evaluateSpf('redirectfirm.com', F.zoneResolver(G));
  assert.equal(r.lookups, 5);
  assert.equal(r.allQualifier, '-');
  assert.equal(r.state, 'pass');
  const ignored = await spfFor('v=spf1 redirect=_spf.google.com -all');
  assert.equal(ignored.lookups, 0, 'redirect is ignored when "all" is present');
  assert.equal(ignored.status, 'warn');
  const dead = await spfFor('v=spf1 redirect=dead.example-vendor.com', { 'dead.example-vendor.com': { $rcode: 2 } });
  assert.equal(dead.state, 'error');
});

test('SPF: ptr is flagged as deprecated; root lookup failures are errors', async () => {
  const ptr = await spfFor('v=spf1 ptr -all');
  assert.ok(ptr.issues.includes('spf-ptr'));
  assert.equal(ptr.status, 'warn');
  const resolveFail = (status) => () => Promise.resolve({ status, records: [] });
  for (const status of ['SERVFAIL', 'TIMEOUT', 'ERROR']) {
    const r = await G.evaluateSpf('firm.com', resolveFail(status));
    assert.equal(r.state, 'error');
    assert.equal(r.status, 'error');
  }
});

test('rewriteSpf and mergeSpf build correct suggested records', () => {
  assert.equal(G.rewriteSpf('v=spf1 include:emailsrvr.com +all', { all: '-' }), 'v=spf1 include:emailsrvr.com -all');
  assert.equal(G.rewriteSpf('v=spf1 mx', { all: '-' }), 'v=spf1 mx -all');
  assert.equal(G.rewriteSpf('V=SPF1 ptr a ?ALL', { all: '-', dropPtr: true }), 'v=spf1 a -all');
  assert.equal(G.rewriteSpf('v=spf1 redirect=x.com', { all: '-' }), 'v=spf1 redirect=x.com');
  assert.equal(
    G.mergeSpf(['v=spf1 include:spf.protection.outlook.com -all', 'v=spf1 include:_spf.google.com INCLUDE:spf.protection.outlook.com ~all']),
    'v=spf1 include:spf.protection.outlook.com include:_spf.google.com ~all'
  );
});

/* --------------------------------------------------------- DMARC parse */

test('parseDmarc reads valid records, including uppercase', () => {
  const p = G.parseDmarc('v=DMARC1; p=reject; rua=mailto:a@firm.com,mailto:b@vendor.net!10m; pct=100; adkim=s');
  assert.equal(p.valid, true);
  assert.equal(p.policy, 'reject');
  assert.deepEqual(p.rua, ['mailto:a@firm.com', 'mailto:b@vendor.net!10m']);
  assert.equal(p.pct, 100);
  const up = G.parseDmarc('V=DMARC1;P=REJECT;RUA=mailto:DMARC@FIRM.COM;');
  assert.equal(up.valid, true);
  assert.equal(up.policy, 'reject');
  const lowerVersion = G.parseDmarc('v=dmarc1; p=quarantine');
  assert.equal(lowerVersion.valid, true);
  assert.match(lowerVersion.warnings.join(' '), /exactly as "v=DMARC1"/);
  assert.equal(G.parseDmarc('  v=DMARC1 ;  p = none ; ').policy, 'none');
});

test('parseDmarc catches malformed tags', () => {
  const cases = {
    'v=DMARC1; p=rejected': /isn't a valid policy/,
    'v=DMARC1 p=reject rua=mailto:x@firm.com': /semicolons/,
    'v=DMARC1; p': /missing "="/,
    'p=reject; v=DMARC1': /must start with v=DMARC1/,
    'v=DMARC2; p=reject': /must be v=DMARC1/,
    'v=DMARC1': /no policy/,
    '': /must start with v=DMARC1/
  };
  for (const [rec, re] of Object.entries(cases)) {
    const p = G.parseDmarc(rec);
    assert.equal(p.valid, false, rec);
    assert.match(p.errors.join(' '), re, rec);
  }
  const noP = G.parseDmarc('v=DMARC1; rua=mailto:x@firm.com');
  assert.equal(noP.valid, true, 'missing p= with rua is treated as p=none');
  assert.equal(noP.policy, 'none');
});

test('parseDmarc warns on ignorable mistakes', () => {
  const p = G.parseDmarc('v=DMARC1; p=reject; pct=150; sp=blah; rua=dmarc@firm.com; adkim=x; p=none; colour=blue');
  assert.equal(p.valid, true);
  assert.equal(p.pct, 100);
  assert.equal(p.subPolicy, 'reject');
  assert.deepEqual(p.rua, []);
  const w = p.warnings.join(' ');
  for (const re of [/pct=150/, /sp=blah/, /rua=dmarc@firm.com/, /adkim=x/, /more than once/, /Unknown tag "colour="/]) assert.match(w, re);
  assert.equal(G.parseDmarc('v=DMARC1; p=reject; pct=abc').pct, 100);
  assert.equal(G.parseDmarc('v=DMARC1; p=reject; pct=0').pct, 0);
});

test('buildDmarc produces clean records', () => {
  const p = G.parseDmarc('v=DMARC1; p=none; sp=none; pct=50; rua=mailto:a@firm.com; colour=blue; adkim=z');
  assert.equal(G.buildDmarc(p, { p: 'quarantine', pct: null, sp: null }), 'v=DMARC1; p=quarantine; rua=mailto:a@firm.com');
  assert.equal(G.buildDmarc(null, { rua: 'mailto:d@firm.com' }), 'v=DMARC1; p=none; rua=mailto:d@firm.com');
});

/* ------------------------------------------------------ DMARC evaluate */

test('DMARC: missing, multiple, invalid and policy states', async () => {
  assert.equal((await dmarcFor(null)).state, 'missing');
  assert.equal((await dmarcFor('some-verification=1')).state, 'missing');
  const multi = await dmarcFor(['v=DMARC1; p=reject', 'v=DMARC1; p=none']);
  assert.equal(multi.state, 'multiple');
  assert.equal((await dmarcFor('v=DMARC1; p=bogus')).state, 'invalid');
  const none = await dmarcFor('v=DMARC1; p=none; rua=mailto:d@firm.com');
  assert.equal(none.state, 'none');
  assert.equal(none.status, 'warn');
  assert.match(none.summary, /monitoring only/);
  const q = await dmarcFor('v=DMARC1; p=quarantine; rua=mailto:d@firm.com');
  assert.equal(q.state, 'enforced');
  assert.equal(q.status, 'pass');
  const r = await dmarcFor('v=DMARC1; p=reject');
  assert.equal(r.state, 'enforced');
  assert.ok(r.issues.includes('dmarc-no-rua'));
  const pct = await dmarcFor('v=DMARC1; p=reject; pct=20; rua=mailto:d@firm.com');
  assert.equal(pct.state, 'partial');
  assert.ok(pct.issues.includes('dmarc-pct'));
  const sp = await dmarcFor('v=DMARC1; p=reject; sp=none; rua=mailto:d@firm.com');
  assert.equal(sp.state, 'partial');
  assert.ok(sp.issues.includes('dmarc-sp-none'));
});

test('DMARC: subdomains inherit the organisational policy (sp=)', async () => {
  const zones = {
    'mail.firm.com': { TXT: ['v=spf1 -all'] },
    '_dmarc.firm.com': { TXT: ['v=DMARC1; p=reject; sp=quarantine; rua=mailto:d@firm.com'] }
  };
  const r = await G.evaluateDmarc('mail.firm.com', F.zoneResolver(G, zones));
  assert.equal(r.inheritedFrom, 'firm.com');
  assert.equal(r.policy, 'quarantine');
  assert.equal(r.state, 'enforced');
  assert.equal(G.orgDomain('a.b.smithcpa.com'), 'smithcpa.com');
  assert.equal(G.orgDomain('mail.smithcpa.co.uk'), 'smithcpa.co.uk');
  assert.equal(G.orgDomain('smithcpa.co.uk'), 'smithcpa.co.uk');
  assert.equal(G.orgDomain('smithcpa.com'), 'smithcpa.com');
});

test('DMARC: SERVFAIL and timeouts are errors, never "missing"', async () => {
  for (const status of ['SERVFAIL', 'TIMEOUT', 'ERROR', 'REFUSED']) {
    const r = await G.evaluateDmarc('firm.com', () => Promise.resolve({ status, records: [] }));
    assert.equal(r.state, 'error', status);
  }
});

/* ---------------------------------------------------- DKIM and extras */

test('parseDkim estimates key size and spots revoked keys', () => {
  assert.equal(G.parseDkim('v=DKIM1; k=rsa; p=' + F.KEY_2048).bits, 2048);
  assert.equal(G.parseDkim('v=DKIM1; p=' + F.KEY_1024).bits, 1024);
  assert.equal(G.parseDkim('v=DKIM1; k=rsa; p=').revoked, true);
  assert.equal(G.parseDkim('v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=').keyType, 'ed25519');
});

test('DKIM is informational: "not found" is never a failure', async () => {
  const strong = await run('strongfirm.com');
  assert.equal(strong.checks.dkim.status, 'pass');
  assert.deepEqual(strong.checks.dkim.found.map((f) => f.selector), ['selector1', 'selector2']);
  assert.equal(strong.checks.dkim.found[0].bits, 2048, 'split TXT strings are joined before parsing');

  const monitor = await run('monitorfirm.com');
  assert.equal(monitor.checks.dkim.status, 'info');
  assert.match(monitor.checks.dkim.summary, /not a failure/);
  assert.match(monitor.checks.dkim.details.join(' '), /DKIM may not be switched on in Microsoft 365/);

  const partial = await run('partialfirm.com');
  assert.match(partial.checks.dkim.details.join(' '), /1024-bit/);

  const allFail = G.evaluateDkim(G.DKIM_SELECTORS.map((s) => ({ selector: s, res: { status: 'TIMEOUT', records: [] } })), { id: 'm365' });
  assert.equal(allFail.status, 'error');
});

test('MTA-STS and TLS-RPT are optional extras', () => {
  const ok = (rec) => ({ status: 'NOERROR', records: [].concat(rec) });
  assert.equal(G.evaluateOptional('mta-sts', ok('v=STSv1; id=20260101T000000;')).status, 'pass');
  assert.equal(G.evaluateOptional('mta-sts', ok('v=STSv1; id=bad-id!')).status, 'warn');
  assert.equal(G.evaluateOptional('mta-sts', ok(['v=STSv1; id=a1', 'v=STSv1; id=b2'])).status, 'warn');
  const missing = G.evaluateOptional('mta-sts', { status: 'NXDOMAIN', records: [] });
  assert.equal(missing.status, 'info');
  assert.equal(missing.optional, true);
  assert.equal(G.evaluateOptional('tls-rpt', ok('v=TLSRPTv1; rua=mailto:t@firm.com')).status, 'pass');
  assert.equal(G.evaluateOptional('tls-rpt', ok('v=TLSRPTv1;')).status, 'warn');
  assert.equal(G.evaluateOptional('tls-rpt', { status: 'SERVFAIL', records: [] }).status, 'error');
});

/* ------------------------------------------------------------- grading */

test('gradeOf follows the spoofing-exposure rules', () => {
  const t = [
    ['pass', 'enforced', 'strong'], ['soft', 'enforced', 'strong'],
    ['pass', 'none', 'needs-work'], ['pass', 'partial', 'needs-work'], ['broken', 'enforced', 'needs-work'],
    ['missing', 'enforced', 'needs-work'], ['soft', 'none', 'needs-work'],
    ['open', 'enforced', 'at-risk'], ['pass', 'missing', 'at-risk'], ['pass', 'invalid', 'at-risk'],
    ['pass', 'multiple', 'at-risk'], ['missing', 'none', 'at-risk'], ['neutral', 'none', 'at-risk'],
    ['broken', 'none', 'at-risk'], ['error', 'missing', 'at-risk'], ['open', 'error', 'at-risk'],
    ['error', 'enforced', 'incomplete'], ['pass', 'error', 'incomplete']
  ];
  for (const [spf, dmarc, grade] of t) assert.equal(G.gradeOf(spf, dmarc), grade, spf + '/' + dmarc);
});

test('full runs grade every fixture domain as expected', async () => {
  const expected = {
    'strongfirm.com': ['strong', []],
    'monitorfirm.com': ['needs-work', ['dmarc-none']],
    'nodmarc.com': ['at-risk', ['dmarc-missing', 'spf-softfail']],
    'openspf.com': ['at-risk', ['spf-plus-all', 'dmarc-none']],
    'toomany.com': ['needs-work', ['spf-too-many-lookups']],
    'multispf.com': ['needs-work', ['spf-multiple']],
    'parked-firm.com': ['at-risk', ['dmarc-missing', 'spf-missing']],
    'shoutyfirm.com': ['strong', []],
    'typofirm.com': ['at-risk', ['dmarc-invalid', 'spf-syntax']],
    'partialfirm.com': ['needs-work', ['dmarc-pct', 'dmarc-sp-none', 'spf-ptr']],
    'loopfirm.com': ['needs-work', ['spf-include-missing', 'spf-loop']],
    'billing.strongfirm.com': ['strong', []],
    'redirectfirm.com': ['strong', []],
    'servfail-firm.com': ['incomplete', []],
    'halfslow.com': ['incomplete', []]
  };
  for (const [domain, [grade, codes]] of Object.entries(expected)) {
    const r = await run(domain);
    assert.equal(r.kind, 'report', domain);
    assert.equal(r.grade.id, grade, domain);
    assert.deepEqual(r.topFixes.map((f) => f.code), codes, domain);
    assert.ok(r.topFixes.length <= 3);
    assert.ok(r.grade.summary.includes(domain), 'summary names the domain');
  }
});

test('Google-format (unquoted) answers grade the same as Cloudflare format', async () => {
  for (const d of ['strongfirm.com', 'toomany.com', 'nodmarc.com', 'redirectfirm.com']) {
    const a = await run(d, undefined, { format: 'cloudflare' });
    const b = await run(d, undefined, { format: 'google' });
    assert.equal(a.grade.id, b.grade.id, d);
    assert.equal(a.checks.spf.lookups, b.checks.spf.lookups, d);
  }
});

test('NXDOMAIN, total outage and resolver exceptions', async () => {
  assert.deepEqual(await run('no-such-firm-xyz.com'), { kind: 'nxdomain', domain: 'no-such-firm-xyz.com' });
  const slow = await run('slow-firm.com');
  assert.equal(slow.kind, 'unreachable');
  const throwing = await G.runCheck('firm.com', () => { throw new Error('boom'); });
  assert.equal(throwing.kind, 'unreachable');
  const rejecting = await G.runCheck('firm.com', () => Promise.reject(new Error('network down')));
  assert.equal(rejecting.kind, 'unreachable');
  const servfail = await run('servfail-firm.com');
  assert.equal(servfail.grade.id, 'incomplete');
  assert.equal(servfail.checks.mx.status, 'error');
  assert.match(servfail.checks.spf.summary, /SERVFAIL/);
});

test('a critical finding still grades At risk when another lookup times out', async () => {
  const zones = withZones({
    'mixed.com': { MX: ['10 mx1.emailsrvr.com.'], TXT: ['v=spf1 +all'] },
    '_dmarc.mixed.com': { $timeout: true }
  });
  const r = await run('mixed.com', zones);
  assert.equal(r.checks.dmarc.state, 'error');
  assert.equal(r.grade.id, 'at-risk');
});

test('progress callback fires for every step and may throw safely', async () => {
  const steps = [];
  await G.runCheck('strongfirm.com', F.zoneResolver(G), { onProgress: (s) => steps.push(s) });
  assert.deepEqual(steps.slice().sort(), ['dkim', 'dmarc', 'extras', 'mx', 'spf']);
  const r = await G.runCheck('strongfirm.com', F.zoneResolver(G), { onProgress: () => { throw new Error('ui bug'); } });
  assert.equal(r.grade.id, 'strong');
});

/* ------------------------------------------------- tailored fix content */

test('fixes are tailored to Microsoft 365', async () => {
  const r = await run('monitorfirm.com');
  const fix = r.topFixes[0];
  assert.equal(fix.code, 'dmarc-none');
  assert.equal(fix.severity, 'major');
  assert.match(fix.steps.join(' '), /Microsoft Defender portal/);
  assert.match(fix.steps.join(' '), /reports@monitorfirm\.com/);
  assert.equal(fix.record.host, '_dmarc');
  assert.equal(fix.record.value, 'v=DMARC1; p=quarantine; rua=mailto:reports@monitorfirm.com');
  assert.ok(fix.docs.some((d) => d.url.startsWith('https://learn.microsoft.com/')));
});

test('fixes are tailored to Google Workspace', async () => {
  const r = await run('nodmarc.com');
  const fix = r.topFixes[0];
  assert.equal(fix.code, 'dmarc-missing');
  assert.equal(fix.severity, 'critical');
  assert.equal(fix.record.value, 'v=DMARC1; p=none; rua=mailto:dmarc-reports@nodmarc.com');
  assert.match(fix.steps.join(' '), /DKIM signing looks set up/, 'DKIM already found under "google"');
  assert.ok(fix.docs.some((d) => d.url.startsWith('https://support.google.com/a/')));
  const spf = await run('google-nospf.com', withZones({ 'google-nospf.com': { MX: ['1 smtp.google.com.'] }, '_dmarc.google-nospf.com': { TXT: ['v=DMARC1; p=none; rua=mailto:a@google-nospf.com'] } }));
  const spfFix = spf.fixes.find((f) => f.code === 'spf-missing');
  assert.equal(spfFix.record.value, 'v=spf1 include:_spf.google.com ~all');
  assert.match(spf.fixes.find((f) => f.code === 'dmarc-none').steps.join(' '), /Google Admin console/);
});

test('fixes for other providers, unused domains and broken records', async () => {
  const open = await run('openspf.com');
  assert.equal(open.topFixes[0].record.value, 'v=spf1 include:emailsrvr.com -all');
  assert.deepEqual(open.topFixes[0].docs.map((d) => d.url), [G.DOCS.generic.url], 'generic FTC guide for non-M365/Google');

  const parked = await run('parked-firm.com');
  assert.equal(parked.provider.id, 'none');
  assert.equal(parked.topFixes[0].record.value, 'v=DMARC1; p=reject');
  assert.equal(parked.topFixes[1].record.value, 'v=spf1 -all');

  const multi = await run('multispf.com');
  assert.equal(multi.topFixes[0].record.value, 'v=spf1 include:spf.protection.outlook.com include:_spf.google.com ~all');

  const partial = await run('partialfirm.com');
  assert.equal(partial.fixes.find((f) => f.code === 'dmarc-pct').record.value, 'v=DMARC1; p=reject; sp=none; rua=mailto:d@partialfirm.com');
  assert.equal(partial.fixes.find((f) => f.code === 'spf-ptr').record.value, 'v=spf1 include:spf.protection.outlook.com -all');

  const many = await run('toomany.com');
  assert.match(many.topFixes[0].steps.join(' '), /include:_spf\.google\.com \(4\)/);

  const typo = await run('typofirm.com');
  assert.equal(typo.topFixes[0].record.value, 'v=DMARC1; p=none; rua=mailto:dmarc-reports@typofirm.com');
  assert.match(typo.topFixes[1].steps.join(' '), /inlcude/);
});

test('strong domains get nice-to-haves, not fixes', async () => {
  const strong = await run('strongfirm.com');
  assert.deepEqual(strong.fixes, []);
  assert.deepEqual(strong.niceToHave, []);
  const shouty = await run('shoutyfirm.com');
  assert.deepEqual(shouty.niceToHave.map((n) => n.code), ['mtasts-missing', 'tlsrpt-missing']);
  assert.equal(shouty.niceToHave[1].record.value, 'v=TLSRPTv1; rua=mailto:tls-reports@shoutyfirm.com');
});

/* -------------------------------------------------------------- sharing */

test('owner and IT emails carry the domain, grade and fixes', async () => {
  const brand = { company: 'Kovyr', check: 'Kovyr Check', fullCheck: 'Proof Check' };
  const r = await run('openspf.com');
  const owner = G.ownerEmail(r, brand);
  assert.match(owner.subject, /openspf\.com/);
  assert.match(owner.subject, /At risk/);
  assert.match(owner.body, /Result: At risk/);
  assert.match(owner.body, /1\. Stop your SPF record from approving everyone/);
  const link = G.mailto('kendall@kovyr.com', owner.subject, owner.body);
  assert.ok(link.startsWith('mailto:kendall@kovyr.com?subject='));
  assert.ok(link.includes('%0D%0A'), 'CRLF line breaks per RFC 6068');
  assert.ok(!/[\s<>"]/.test(link), 'fully encoded');
  assert.equal(decodeURIComponent(link.split('&body=')[1]).replace(/\r\n/g, '\n'), owner.body);
  const it = G.itEmail(r, brand);
  assert.match(it.body, /Record: TXT at "@": v=spf1 include:emailsrvr\.com -all/);
  assert.ok(G.mailto('', it.subject, it.body).startsWith('mailto:?subject='));
});
