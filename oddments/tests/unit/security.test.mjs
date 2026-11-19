// What the security audit of 18 November 2026 found, held in place. Each test
// here is a weakness that was real, or a guard that must not quietly go:
// the testing switches, a link that could erase a save, what reaches a public
// log, where the Apple key is allowed to be, and what a save may say.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { switchesFor } from '../../web/js/platform/switches.js';
import { scrub } from '../../tools/asc.mjs';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { NAME_LENGTH, DEFAULT_NAME } from '../../web/js/core/balance.js';

const NOW = 1_800_000_000_000;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, 'utf8');
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };

test('in a numbered build, which is the app, there are no testing switches at all', () => {
  const everything = '?debug&reset&fast&seed=7&day=20001';
  const hostile = { debug: true, reset: true, fast: true, seed: 7, day: 20001 };
  for (const build of ['31', '1', '0', '', '999']) {
    const app = switchesFor(build, everything, hostile);
    assert.equal(app.testing, false, `build "${build}"`);
    for (const name of ['debug', 'reset', 'fast', 'seed', 'day', 'news']) {
      assert.equal(app.has(name), false, `build "${build}": ${name}`);
      assert.equal(app.get(name), null);
      assert.ok(Number.isNaN(app.number(name)));
    }
  }
  // In a copy for trying things out they work, from the address or from what a host page set.
  const dev = switchesFor('dev', '?debug&seed=7&day=20001', { fast: true });
  assert.equal(dev.testing, true);
  assert.deepEqual([dev.has('debug'), dev.has('fast'), dev.has('reset'), dev.number('seed'), dev.number('day')], [true, true, false, 7, 20001]);
  assert.equal(switchesFor('dev', '', { seed: 9 }).number('seed'), 9);
  assert.ok(Number.isNaN(switchesFor('dev', '?seed=', null).number('seed')));
  assert.ok(Number.isNaN(switchesFor('dev', '?seed=abc', null).number('seed')));
});

test('a switch is only ever a plain value somebody set on purpose: nothing inherited, nothing that is an object', () => {
  const inherited = Object.create({ reset: true, debug: true });
  assert.equal(switchesFor('dev', '', inherited).has('reset'), false);
  assert.equal(switchesFor('dev', '', inherited).has('debug'), false);
  const odd = { reset: ['yes'], debug: { toString: () => 'true' }, seed: { valueOf: () => 7 }, fast: null, day: () => 1 };
  const got = switchesFor('dev', '', odd);
  for (const name of Object.keys(odd)) assert.equal(got.has(name), false, name);
  for (const flags of [null, undefined, 7, 'debug', ['debug'], true]) assert.equal(switchesFor('dev', '', flags).has('debug'), false, String(flags));
  // And the address is only ever read as an address's query.
  for (const search of [null, undefined, 7, {}, ['?debug']]) assert.equal(switchesFor('dev', search, null).has('debug'), false);
});

test('only one file reads the address or what a host page set, and the game is handed to a console only in a copy for testing', () => {
  const files = ['web/js/main.js', ...readdirSync(`${ROOT}web/js/ui`).map((name) => `web/js/ui/${name}`), ...readdirSync(`${ROOT}web/js/platform`).map((name) => `web/js/platform/${name}`), ...readdirSync(`${ROOT}web/js/core`).map((name) => `web/js/core/${name}`)];
  const readers = files.filter((path) => /location\.search|URLSearchParams|ODDMENTS_FLAGS/.test(read(path)));
  assert.deepEqual(readers, ['web/js/platform/switches.js']);
  const main = read('web/js/main.js');
  // The handle for a console is behind `switches.testing`, wherever the page says it lives.
  const handle = main.split('\n').filter((line) => /window\.oddments\s*=/.test(line));
  assert.equal(handle.length, 1);
  assert.match(handle[0], /^\s*if \(switches\.testing && \(/);
  // Erasing by a link asks a person first, and sets the erased game aside.
  const reset = main.slice(main.indexOf("if (flag('reset'))"), main.indexOf('let state = null;'));
  assert.match(reset, /window\.confirm\(/);
  assert.match(reset, /navigator\.webdriver === true/);
  assert.match(reset, /keepErased\(had\)/);
  assert.ok(reset.indexOf('keepErased(had)') < reset.indexOf('clearSave()'), 'set aside before it is erased');
  // So does erasing from Settings.
  assert.match(main, /resetGame\(\) \{[^\n]*keepErased\(had\)[^\n]*clearSave\(\)/);
});

test('what somebody else says about an error is made fit for a public log before it is printed', () => {
  const ours = ['com.example.person.game', 'ABCDE12345', 'KEYID12345', '11111111-2222-3333-4444-555555555555'];
  const said = 'The request for "Jane Q Example" <jane.example@mail.test> on team ABCDE12345 failed: bundle com.example.person.game, key KEYID12345 of 11111111-2222-3333-4444-555555555555, owner \'J. Example\' and “Jane”.';
  const out = scrub(said, ours);
  for (const secret of [...ours, 'Jane', 'jane.example', 'mail.test', 'J. Example']) assert.equal(out.includes(secret), false, `${secret} is gone`);
  assert.match(out, /The request for "\.\.\." <\(an address\)> on team \(hidden\) failed/);
  // It is cut short, takes anything at all, and leaves plain words alone.
  assert.ok(scrub('x'.repeat(5000)).length <= 303);
  for (const odd of [null, undefined, 7, {}, []]) assert.equal(typeof scrub(odd), 'string');
  assert.equal(scrub('There is no app with that identifier.'), 'There is no app with that identifier.');
  assert.equal(scrub('short ab', ['ab']), 'short ab', 'a value too short to be an identifier is not hunted for');
  // The tool passes Apple's words through it, and prints only the tester group it named itself.
  const tool = read('tools/asc.mjs');
  assert.match(tool, /const detail = scrub\(/);
  assert.match(tool, /name === GROUP \? /);
  assert.match(tool, /::add-mask::\$\{value\}/);
});

test('the house-sitter\'s name is one clean line, like any friend\'s: nothing unseen, nothing that turns the text round', () => {
  const game = fresh();
  const nasty = `A‮b​c\nd\u0007e⁦f`;
  game.setLook({ name: nasty });
  assert.equal(game.state.player.name, 'A b c d e f');
  game.setLook({ name: '‮​\n' });
  assert.equal(game.state.player.name, 'A b c d e f', 'a name of nothing but unseen characters is no name: the old one stays');
  game.setLook({ name: 'x'.repeat(500) });
  assert.equal(game.state.player.name.length, NAME_LENGTH);
  // From a save, too.
  const raw = JSON.parse(game.serialize(NOW));
  for (const [name, want] of [[nasty, 'A b c d e f'], ['  Kit  ', 'Kit'], ['​', DEFAULT_NAME], [7, DEFAULT_NAME], [null, DEFAULT_NAME], ['y'.repeat(9999), 'y'.repeat(NAME_LENGTH)]]) {
    assert.equal(reviveState({ ...JSON.parse(JSON.stringify(raw)), player: { name, look: raw.player.look } }, NOW).player.name, want, JSON.stringify(name).slice(0, 30));
  }
});

test('a save\'s list of hints already shown is plain lower-case names set to true, and nothing else', () => {
  const game = fresh();
  const raw = JSON.parse(game.serialize(NOW));
  const seen = JSON.parse('{"three":true,"strays":true,"walked":false,"__proto__":true,"constructor":true,"prototype":true,"With-Dash":true,"UPPER":true,"has space":true,"x1":true,"":true,"toString":true}');
  seen['a'.repeat(25)] = true;
  seen.fights = 'yes';
  const back = reviveState({ ...JSON.parse(JSON.stringify(raw)), seen }, NOW);
  assert.deepEqual(Object.keys(back.seen).sort(), ['strays', 'three']);
  assert.equal(Object.getPrototypeOf(back.seen), Object.prototype);
  assert.equal({}.three, undefined, 'and nothing was written anywhere it should not be');
  // Every hint the game itself sets passes its own rule.
  const set = [...new Set(['web/js/main.js', 'web/js/ui/lane.js', 'web/js/ui/inside.js', 'web/js/ui/fight.js', 'web/js/ui/friends.js', 'web/js/ui/three.js', 'web/js/ui/howto.js'].flatMap((path) => [...read(path).matchAll(/seen\.([A-Za-z0-9_]+)\s*=\s*true/g)].map((m) => m[1])))];
  assert.ok(set.length >= 3);
  for (const name of set) assert.match(name, /^[a-z]{1,24}$/, `${name} would be kept`);
});

test('every stored copy of the save is tried, newest first: a damaged one cannot hide a good one', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => { store.set(key, String(value)); }, removeItem: (key) => { store.delete(key); } };
  const { loadSaves, loadSave, keepErased, clearSave, newer } = await import('../../web/js/platform/storage.js');
  assert.deepEqual(await loadSaves(), []);
  assert.equal(await loadSave(), null);
  store.set('oddments.save', '{"lastSeen":5}');
  assert.deepEqual(await loadSaves(), ['{"lastSeen":5}']);
  assert.equal(await loadSave(), '{"lastSeen":5}');
  // Of two copies the one played more recently is first, whichever way round they are held; one that is not even text is last.
  assert.equal(newer('{"lastSeen":5}', '{"lastSeen":9}'), '{"lastSeen":9}');
  assert.equal(newer('{"lastSeen":9}', '{"lastSeen":5}'), '{"lastSeen":9}');
  assert.equal(newer('{"lastSeen":5}', 'not a save'), '{"lastSeen":5}');
  // Erasing on purpose sets the game aside first, in a place of its own.
  keepErased('{"lastSeen":5}');
  await clearSave();
  assert.equal(await loadSave(), null);
  assert.equal(store.get('oddments.save.erased'), '{"lastSeen":5}');
  // And the page tries each copy in turn before it gives up on a save.
  const main = read('web/js/main.js');
  assert.match(main, /for \(const copy of copies\) \{[\s\S]*?reviveState\(JSON\.parse\(copy\)[\s\S]*?break;/);
  delete globalThis.localStorage;
});

test('the Apple key is given only to the steps that use it, is on disk only while signing, and is always removed', () => {
  const flow = readFileSync(`${REPO}.github/workflows/oddments-ios.yml`, 'utf8');
  const lines = flow.split('\n');
  // No secret is set for a whole job (six spaces of indent) or the whole workflow: only under a step's own `env:` (ten).
  const withSecrets = lines.filter((line) => /\$\{\{\s*secrets\./.test(line));
  assert.ok(withSecrets.length >= 10);
  for (const line of withSecrets) assert.match(line, /^ {10}[A-Z_0-9]+: \$\{\{ secrets\.[A-Z_0-9]+ \}\}$/, `"${line.trim()}" is a step's own`);
  // The steps that fetch code, install tools, copy the game in and archive it are handed nothing.
  const stepOf = (name) => { const at = lines.findIndex((line) => line.includes(`- name: ${name}`)); assert.ok(at >= 0, name); const end = lines.findIndex((line, i) => i > at && /^ {6}- /.test(line)); return lines.slice(at, end < 0 ? lines.length : end).join('\n'); };
  for (const name of ['Copy the game into the Xcode project', 'Pick an Xcode the App Store accepts', 'Archive', 'Sign and upload to App Store Connect']) {
    // (These names are used by more than one job; none of them, in any job, may be handed a secret.)
    const all = lines.map((line, i) => (line.includes(`- name: ${name}`) ? i : -1)).filter((i) => i >= 0);
    for (const at of all) { const end = lines.findIndex((line, i) => i > at && /^ {6}- /.test(line)); assert.equal(/secrets\./.test(lines.slice(at, end < 0 ? lines.length : end).join('\n')), false, `${name} is handed no secret`); }
  }
  assert.equal(/secrets\./.test(flow.split('\n').filter((line) => /^ {6}- (uses|run): /.test(line)).join('\n')), false);
  // In the upload: archive first, then the key is written, then signing, then it is removed whatever happened.
  const upload = flow.slice(flow.indexOf('\n  testflight:'));
  const order = ['- name: Archive', '- name: Write the API key where Xcode can read it', '- name: Sign and upload to App Store Connect', '- name: Remove the key'].map((name) => upload.indexOf(name));
  assert.ok(order.every((at) => at > 0) && order.join() === [...order].sort((a, b) => a - b).join(), `in order: ${order}`);
  assert.match(stepOf('Remove the key'), /if: always\(\)/);
  assert.match(stepOf('Write the API key where Xcode can read it'), /ASC_KEY_P8: \$\{\{ secrets\.ASC_KEY_P8 \}\}/);
  // What the signing step prints is scrubbed: both kinds of quotes, addresses, team ids, a certificate's owner.
  const sign = stepOf('Sign and upload to App Store Connect');
  for (const piece of ["s/'[^']*'/'...'/g", '(an address)', 'Developer|Distribution', 'rm -f "$RUNNER_TEMP/export.log"']) assert.ok(sign.includes(piece), piece);
  // The token these jobs hold can read the repository and nothing more, and only a person can start them.
  assert.match(flow, /\npermissions:\n  contents: read\n/);
  assert.match(flow, /\non:\n  workflow_dispatch:/);
  assert.equal(/pull_request|^\s*push:/m.test(flow), false);
});

test('every action a workflow uses is pinned to an exact commit, the test browser to a named version, and key files cannot be committed by accident', () => {
  const dir = `${REPO}.github/workflows/`;
  const ours = readdirSync(dir).filter((name) => name.startsWith('oddments-'));
  assert.ok(ours.length >= 2);
  for (const name of ours) {
    const flow = readFileSync(dir + name, 'utf8');
    const uses = [...flow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    for (const action of uses) assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
    assert.match(flow, /\npermissions:\n  contents: read\n/, `${name}: its token can only read`);
    assert.equal(/pull_request_target/.test(flow), false, name);
    for (const install of flow.match(/npm install[^\n]*/g) || []) assert.match(install, /@\d+\.\d+\.\d+/, `${name}: "${install.trim()}" names a version`);
  }
  const ignored = read('.gitignore');
  for (const pattern of ['*.p8', 'AuthKey_*', '.env', '*.p12', '*.mobileprovision']) assert.ok(ignored.split('\n').includes(pattern), pattern);
});

test('the app asks for nothing and reaches nothing: no permissions, no web addresses of its own, no exceptions to secure transport', () => {
  const plist = read('ios/App/App/Info.plist');
  assert.equal(/Usage(Description)?<\/key>/.test(plist), false, 'it asks for no permission (camera, photos, location, tracking, ...)');
  for (const key of ['CFBundleURLTypes', 'NSAppTransportSecurity', 'NSAllowsArbitraryLoads', 'UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace', 'LSApplicationQueriesSchemes']) assert.equal(plist.includes(key), false, key);
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.server, undefined, 'it loads its own files, from inside the app, and nothing else');
  assert.equal(JSON.stringify(config).includes('allowNavigation'), false);
  assert.equal(JSON.stringify(config).includes('cleartext'), false);
  const privacy = read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  // The page's own policy: nothing from anywhere else, nothing inline, nowhere to send anything.
  const page = read('web/index.html');
  const policy = (page.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  assert.match(policy, /default-src 'none'/);
  assert.equal(/connect-src|unsafe-inline|unsafe-eval|https?:|\*/.test(policy), false, policy);
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /form-action 'none'/);
});
