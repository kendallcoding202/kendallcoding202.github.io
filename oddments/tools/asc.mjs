// App Store Connect credentials: check them, and hand Xcode a clean key file.
//
//   node tools/asc.mjs check            are the four secrets the right things,
//                                       does Apple accept them, and does the
//                                       app record exist? Run on a Linux runner
//                                       before any Mac time is spent.
//   node tools/asc.mjs write-key FILE   write the private key as a strict PEM
//   node tools/asc.mjs status [--invite]
//                                       what has Apple done with the uploaded
//                                       builds, and who can test them? With
//                                       --invite, and only if nobody can yet,
//                                       make an internal tester group that gets
//                                       every build and invite the account holder.
//
// Reads ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, APPLE_TEAM_ID and BUNDLE_ID from
// the environment. It never prints a secret, a person's name, an email address
// or the bundle id: this repository is public, and so is everything a workflow prints.
// That goes for Apple's own words too: what Apple says about an error is passed
// through `scrub` before it is printed, because Apple may quote back what it was sent.
import { createPrivateKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com';

/** Letters, digits and nothing else: pasted values often carry a space or a line break. */
export const tidy = (value) => String(value || '').replace(/\s+/g, '');

/**
 * Rebuilds the .p8 text as the strict PEM Xcode insists on (a BEGIN line,
 * 64-character lines, an END line). A paste can lose its line breaks, its
 * BEGIN/END lines, or gain quotes and literal "\n"; none of that changes the
 * key itself, so it is all repaired here. Returns null if nothing is left.
 */
export function pemFrom(raw) {
  const body = String(raw || '')
    .replace(/\\[rn]/g, '\n')
    .replace(/-+\s*(BEGIN|END)[A-Z ]*-+/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return null;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

/** The key object, or a sentence saying what is wrong with what was pasted. */
export function readKey(raw) {
  const pem = pemFrom(raw);
  const size = pem ? pem.split('\n').slice(1, -2).join('').length : 0;
  const hint = `It holds ${size} characters of key data; a real key holds about 200. `
    + 'Open the downloaded AuthKey_XXXXXXXXXX.p8 file in a text editor, select all, copy, and paste that as the secret.';
  if (!pem) return { error: `ASC_KEY_P8 is empty. ${hint}` };
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return { error: `ASC_KEY_P8 is a private key, but not the kind App Store Connect issues. ${hint}` };
    }
    return { key, pem };
  } catch {
    return { error: `ASC_KEY_P8 is not a private key. ${hint}` };
  }
}

/** What each id should look like, so a swapped or mistyped one can be named. */
export const SHAPES = {
  ASC_KEY_ID: { test: /^[A-Z0-9]{10}$/, want: '10 capital letters and digits, from the Key ID column' },
  ASC_ISSUER_ID: { test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, want: 'a long id with four dashes, shown above the keys table' },
  APPLE_TEAM_ID: { test: /^[A-Z0-9]{10}$/, want: '10 capital letters and digits, from Membership details' },
};

export function shapeProblems(env) {
  const problems = [];
  for (const [name, shape] of Object.entries(SHAPES)) {
    const value = tidy(env[name]);
    if (!shape.test.test(value)) problems.push(`${name} should be ${shape.want}; the stored value is ${value.length} characters and does not look like that.`);
  }
  return problems;
}

/** A short-lived sign-in token for the App Store Connect API. */
export function token(keyId, issuer, key, now = Date.now()) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const at = Math.floor(now / 1000);
  const unsigned = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({ iss: issuer, iat: at, exp: at + 600, aud: 'appstoreconnect-v1' })}`;
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

/**
 * Somebody else's words about an error, made fit for a public log: none of our own identifiers
 * (`hide`), no email address, nothing in quotes (a name, a bundle id), and not much of it.
 */
export function scrub(text, hide = []) {
  let out = String(text || '');
  for (const value of hide) if (typeof value === 'string' && value.length >= 4) out = out.split(value).join('(hidden)');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(an address)')
    .replace(/"[^"]*"|'[^']*'|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g, '"..."');
  return out.length > 300 ? `${out.slice(0, 300)}...` : out;
}
/** Our own identifiers, as they are in the environment: never to appear in anything printed. */
const ours = (env = process.env) => ['BUNDLE_ID', 'APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID'].map((name) => tidy(env[name])).filter(Boolean);

/** One request. `path` may be a full URL, as Apple's "next page" links are. */
export async function call(method, path, jwt, body) {
  const res = await fetch(path.startsWith('https://') ? path : API + path, {
    signal: AbortSignal.timeout(60_000),
    method,
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON: the status says enough */ }
  const detail = scrub((json?.errors || []).map((e) => e.detail || e.title).filter(Boolean).join(' '), ours());
  return { status: res.status, data: json?.data ?? [], included: json?.included || [], next: json?.links?.next, detail };
}
const get = (path, jwt) => call('GET', path, jwt);
const post = (path, jwt, data) => call('POST', path, jwt, { data });

/** Apple's state words for a build, as one plain sentence. */
export function describeBuild({ version, number, processing, internal, expired }) {
  const name = `Build ${version || '?'} (${number})`;
  if (expired) return `${name}: expired.`;
  if (processing === 'PROCESSING') return `${name}: Apple is still processing it. Not installable yet.`;
  if (processing === 'FAILED' || processing === 'INVALID') return `${name}: Apple rejected it during processing (${processing}). The reason is in the email Apple sent.`;
  const words = {
    READY_FOR_BETA_TESTING: 'processed and ready to test',
    IN_BETA_TESTING: 'processed and available to testers',
    MISSING_EXPORT_COMPLIANCE: 'processed, but waiting for the export compliance question to be answered in App Store Connect',
    IN_EXPORT_COMPLIANCE_REVIEW: 'processed, in export compliance review',
    PROCESSING: 'processed, TestFlight is still preparing it',
    PROCESSING_EXCEPTION: 'processed, but TestFlight hit a problem preparing it',
    EXPIRED: 'expired',
  };
  return `${name}: ${words[internal] || `processed (${internal || 'no TestFlight state yet'})`}.`;
}

const inActions = !!process.env.GITHUB_ACTIONS;
/** What this tool calls the tester group it makes. */
const GROUP = 'Team';
export const say = (text) => console.log(text);
export const warn = (text) => console.log(inActions ? `::warning::${text}` : `warning: ${text}`);
export function fail(text) {
  console.log(inActions ? `::error::${text}` : `error: ${text}`);
  process.exit(1);
}

async function check(env) {
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8', 'APPLE_TEAM_ID'].filter((name) => !tidy(env[name]));
  // Everything that is missing is named at once, so one look says all that is left to add.
  if (!tidy(env.BUNDLE_ID)) missing.push('IOS_BUNDLE_ID');
  if (missing.length) fail(`Not set: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} under Settings -> Secrets and variables -> Actions. See docs/TESTFLIGHT.md.`);

  const { key, error } = readKey(env.ASC_KEY_P8);
  if (error) fail(error);
  say('ASC_KEY_P8 is a readable App Store Connect private key.');

  const shapes = shapeProblems(env);
  shapes.forEach(warn);

  const bundleId = tidy(env.BUNDLE_ID);
  const jwt = token(tidy(env.ASC_KEY_ID), tidy(env.ASC_ISSUER_ID), key);
  const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId&limit=50`, jwt);
  if (apps.status === 401) {
    fail(['Apple did not accept these credentials. The private key itself is readable, so ASC_KEY_ID or ASC_ISSUER_ID does not belong to it, or the key was revoked.', ...shapes, `Apple said: ${apps.detail}`].join(' '));
  }
  if (apps.status !== 200) fail(`App Store Connect answered ${apps.status}. ${apps.detail}`);
  say('Apple accepted the key, key id and issuer id.');

  // One thing this check cannot see: whether the key has Admin access. Apple signs an upload with a
  // certificate it keeps itself and only does so for an Admin key; with any other the upload stops at
  // "Cloud signing permission error". An App Manager key was tried against everything a key can read
  // here (users, invitations, certificates, profiles, devices) and was allowed all of it, exactly as
  // an Admin key would be. So the only test is the upload itself.
  say('Not checked here, because it cannot be: that the key has Admin access, which Apple needs to sign the upload.');

  const ids = await get(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&fields[bundleIds]=identifier,seedId&limit=50`, jwt);
  const registered = ids.data.find((b) => b.attributes?.identifier === bundleId);
  if (registered && registered.attributes.seedId !== tidy(env.APPLE_TEAM_ID)) {
    warn('APPLE_TEAM_ID is not the team this bundle id was registered under. Check it against Membership details.');
  }

  const app = apps.data.find((a) => a.attributes?.bundleId === bundleId);
  if (app) {
    say(`App record found: "${app.attributes.name}".`);
    return;
  }
  const all = await get('/v1/apps?fields[apps]=name,bundleId&limit=200', jwt);
  fail([
    'There is no app in App Store Connect with the bundle id stored as IOS_BUNDLE_ID, so there is nowhere to upload to.',
    registered ? 'The bundle id is registered; the app itself still has to be created (Apps -> + -> New App).' : 'The bundle id is not registered on this account either.',
    `The account has ${all.data.length} app(s) under other bundle ids. See docs/TESTFLIGHT.md, step 2.`,
  ].join(' '));
}

export async function signIn(env) {
  const { key, error } = readKey(env.ASC_KEY_P8);
  if (error) fail(error);
  const jwt = token(tidy(env.ASC_KEY_ID), tidy(env.ASC_ISSUER_ID), key);
  const bundleId = tidy(env.BUNDLE_ID);
  const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId&limit=50`, jwt);
  if (apps.status !== 200) fail(`App Store Connect answered ${apps.status}. ${apps.detail} Run "check" for a diagnosis.`);
  const app = apps.data.find((a) => a.attributes?.bundleId === bundleId);
  if (!app) fail('There is no app in App Store Connect with the bundle id stored as IOS_BUNDLE_ID.');
  return { jwt, app };
}

async function status(env, { invite }) {
  const { jwt, app } = await signIn(env);
  say(`App: "${app.attributes.name}"`);

  const builds = await get(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`
    + '&fields[builds]=version,processingState,uploadedDate,expired,buildBetaDetail,preReleaseVersion&include=buildBetaDetail,preReleaseVersion'
    + '&fields[buildBetaDetails]=internalBuildState&fields[preReleaseVersions]=version', jwt);
  if (builds.status !== 200) fail(`Could not list builds (${builds.status}). ${builds.detail}`);
  if (!builds.data.length) say('No builds yet. An upload can take a few minutes to appear here at all.');
  const linked = (build, relation) => {
    const ref = build.relationships?.[relation]?.data;
    return ref ? builds.included.find((x) => x.type === ref.type && x.id === ref.id)?.attributes : undefined;
  };
  for (const build of builds.data) {
    say(`${describeBuild({
      version: linked(build, 'preReleaseVersion')?.version,
      number: build.attributes.version,
      processing: build.attributes.processingState,
      internal: linked(build, 'buildBetaDetail')?.internalBuildState,
      expired: build.attributes.expired,
    })} Uploaded ${build.attributes.uploadedDate}.`);
  }

  const groups = await get(`/v1/betaGroups?filter[app]=${app.id}&fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds&limit=50`, jwt);
  if (groups.status !== 200) fail(`Could not list tester groups (${groups.status}). ${groups.detail}`);
  let reachable = 0;
  for (const group of groups.data) {
    const testers = await get(`/v1/betaGroups/${group.id}/betaTesters?fields[betaTesters]=inviteType&limit=200`, jwt);
    const { name, isInternalGroup, hasAccessToAllBuilds } = group.attributes;
    // (A group's name is whatever somebody typed. Only the name this tool itself gives one is printed.)
    say(`Tester group ${name === GROUP ? `"${GROUP}"` : '(named by its owner)'} (${isInternalGroup ? 'internal' : 'external'}${hasAccessToAllBuilds ? ', gets every build' : ''}): ${testers.data.length} tester(s).`);
    reachable += testers.data.length;
  }
  if (!groups.data.length) say('No tester groups: nobody can install a build through TestFlight yet.');
  if (!invite) return;
  if (reachable) { say('Someone can already test, so nothing was changed.'); return; }

  let group = groups.data.find((g) => g.attributes.isInternalGroup);
  if (!group) {
    const made = await post('/v1/betaGroups', jwt, {
      type: 'betaGroups',
      attributes: { name: 'Team', isInternalGroup: true, hasAccessToAllBuilds: true },
      relationships: { app: { data: { type: 'apps', id: app.id } } },
    });
    if (made.status !== 201) fail(`Could not create the internal tester group (${made.status}). ${made.detail}`);
    group = made.data;
    say('Created the internal tester group "Team", which gets every build automatically.');
  }

  const users = await get('/v1/users?fields[users]=username,firstName,lastName,roles&limit=200', jwt);
  if (users.status !== 200) fail(`Could not read the team's users (${users.status}). ${users.detail}`);
  const holder = users.data.find((u) => (u.attributes.roles || []).includes('ACCOUNT_HOLDER'));
  if (!holder) fail('Could not find the account holder among the team\'s users. Add yourself to the "Team" group under TestFlight in App Store Connect.');
  const groupRef = { data: [{ type: 'betaGroups', id: group.id }] };
  const added = await post('/v1/betaTesters', jwt, {
    type: 'betaTesters',
    attributes: { email: holder.attributes.username, firstName: holder.attributes.firstName, lastName: holder.attributes.lastName },
    relationships: { betaGroups: groupRef },
  });
  if (added.status === 201) { say('Invited the account holder to test. TestFlight emails the invitation.'); return; }
  if (added.status === 409) {
    const existing = await get(`/v1/betaTesters?filter[email]=${encodeURIComponent(holder.attributes.username)}&fields[betaTesters]=inviteType&limit=1`, jwt);
    const tester = existing.data[0];
    const joined = tester && await call('POST', `/v1/betaGroups/${group.id}/relationships/betaTesters`, jwt, { data: [{ type: 'betaTesters', id: tester.id }] });
    if (joined && joined.status === 204) { say('Added the account holder to the tester group.'); return; }
  }
  fail(`Could not add the account holder as a tester (${added.status}). ${added.detail} Add yourself to the "Team" group under TestFlight in App Store Connect.`);
}

function writeKey(env, file) {
  const { pem, error } = readKey(env.ASC_KEY_P8);
  if (error) fail(error);
  writeFileSync(file, pem, { mode: 0o600 });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [command, file] = process.argv.slice(2);
  // In a workflow, tell the runner to hide our identifiers wherever they might be printed, tidied
  // as this tool uses them (a pasted secret can carry a space the runner's own mask would keep).
  if (inActions) for (const value of ours()) console.log(`::add-mask::${value}`);
  if (command === 'check') await check(process.env);
  else if (command === 'write-key' && file) writeKey(process.env, file);
  else if (command === 'status') await status(process.env, { invite: file === '--invite' });
  else { console.error('usage: node tools/asc.mjs check | write-key FILE | status [--invite]'); process.exit(2); }
}
