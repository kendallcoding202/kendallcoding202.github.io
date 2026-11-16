// The App Store Connect key arrives as text pasted into a GitHub secret, and
// Xcode refuses it unless it is a letter-perfect PEM. These tests pin the
// repair: however the paste was mangled, the same key must come out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { pemFrom, readKey, shapeProblems, token, tidy, describeBuild } from '../../tools/asc.mjs';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const original = privateKey.export({ type: 'pkcs8', format: 'pem' });
const der = (key) => key.export({ type: 'pkcs8', format: 'der' }).toString('hex');
const bodyOnly = original.split('\n').filter((line) => line && !line.startsWith('-----'));

const pastes = {
  'exactly as downloaded': original,
  'without the trailing line break': original.trimEnd(),
  'with Windows line endings': original.replace(/\n/g, '\r\n'),
  'with the line breaks turned into spaces': original.trim().replace(/\n/g, ' '),
  'as one unbroken line': original.trim().replace(/\n/g, ''),
  'without the BEGIN and END lines': bodyOnly.join('\n'),
  'with literal \\n in place of line breaks': original.trim().replace(/\n/g, '\\n'),
  'wrapped in quotes with stray spaces': `  "${original.trim()}"  \n\n`,
  'with every line indented': original.split('\n').map((line) => `    ${line}`).join('\n'),
};

for (const [how, pasted] of Object.entries(pastes)) {
  test(`a key pasted ${how} is read as the same key`, () => {
    const { key, pem, error } = readKey(pasted);
    assert.equal(error, undefined);
    assert.equal(der(key), der(privateKey));
    const lines = pem.trimEnd().split('\n');
    assert.equal(lines[0], '-----BEGIN PRIVATE KEY-----');
    assert.equal(lines.at(-1), '-----END PRIVATE KEY-----');
    assert.ok(lines.slice(1, -2).every((line) => line.length === 64), 'every full line is 64 characters, as Xcode requires');
    assert.ok(lines.at(-2).length <= 64);
  });
}

test('something that is not the key is refused with a reason, never echoed', () => {
  for (const wrong of ['', '   ', 'AB12CD34EF', '69a6de70-03db-47e3-e053-5b8c7c11a4d1', 'AuthKey_AB12CD34EF.p8', original.slice(0, 120)]) {
    const { key, error } = readKey(wrong);
    assert.equal(key, undefined);
    assert.match(error, /^ASC_KEY_P8 is /);
    if (wrong.trim()) assert.ok(!error.includes(wrong.trim()), 'the message does not repeat what was pasted');
  }
  assert.equal(pemFrom('  \n'), null);
});

test('a private key of the wrong kind is refused', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.match(readKey(rsa).error, /not the kind App Store Connect issues/);
});

test('ids are tidied, and a swapped or mistyped one is named', () => {
  const good = { ASC_KEY_ID: 'AB12CD34EF', ASC_ISSUER_ID: '69a6de70-03db-47e3-e053-5b8c7c11a4d1', APPLE_TEAM_ID: 'Z9Y8X7W6V5' };
  assert.equal(tidy(' AB12CD34EF\n'), 'AB12CD34EF');
  assert.deepEqual(shapeProblems(good), []);
  assert.deepEqual(shapeProblems({ ...good, ASC_KEY_ID: ' AB12CD34EF \n' }), [], 'a stray space or line break is not a problem');
  const swapped = shapeProblems({ ...good, ASC_KEY_ID: good.ASC_ISSUER_ID, ASC_ISSUER_ID: good.ASC_KEY_ID });
  assert.equal(swapped.length, 2);
  assert.match(swapped[0], /^ASC_KEY_ID should be 10 capital letters and digits/);
  assert.ok(!swapped.join(' ').includes(good.ASC_ISSUER_ID), 'the stored value is never printed');
});

test('the sign-in token is one Apple can verify', () => {
  const now = Date.UTC(2026, 10, 14);
  const [head, body, signature] = token('AB12CD34EF', 'issuer-id', privateKey, now).split('.');
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
  assert.deepEqual(decode(head), { alg: 'ES256', kid: 'AB12CD34EF', typ: 'JWT' });
  assert.deepEqual(decode(body), { iss: 'issuer-id', iat: now / 1000, exp: now / 1000 + 600, aud: 'appstoreconnect-v1' });
  const raw = Buffer.from(signature, 'base64url');
  assert.equal(raw.length, 64, 'ES256 signatures are the raw 64-byte form, not DER');
  assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, raw));
});

test('a build\'s state is reported in plain words', () => {
  const build = { version: '1.0.0', number: '4' };
  assert.match(describeBuild({ ...build, processing: 'PROCESSING' }), /^Build 1\.0\.0 \(4\): Apple is still processing it/);
  assert.match(describeBuild({ ...build, processing: 'INVALID' }), /rejected it during processing \(INVALID\)/);
  assert.match(describeBuild({ ...build, processing: 'VALID', internal: 'READY_FOR_BETA_TESTING' }), /processed and ready to test/);
  assert.match(describeBuild({ ...build, processing: 'VALID', internal: 'IN_BETA_TESTING' }), /available to testers/);
  assert.match(describeBuild({ ...build, processing: 'VALID', internal: 'MISSING_EXPORT_COMPLIANCE' }), /export compliance question/);
  assert.match(describeBuild({ ...build, processing: 'VALID', internal: 'SOMETHING_NEW' }), /processed \(SOMETHING_NEW\)/, 'a state added by Apple later is passed through, not hidden');
  assert.match(describeBuild({ ...build, processing: 'VALID' }), /no TestFlight state yet/);
  assert.match(describeBuild({ ...build, processing: 'VALID', internal: 'IN_BETA_TESTING', expired: true }), /expired/);
});
