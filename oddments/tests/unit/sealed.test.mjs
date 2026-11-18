// Three promises the game makes, checked against every file that ships:
// it runs nothing but its own code, it never touches the network, and it
// takes nothing from anybody else's game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES, MOVES, ELEMENTS, CALLS, ROOMS, STATS, LOOKS } from '../../web/js/core/balance.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const shipped = walk(WEB);
const text = shipped.filter((path) => /\.(js|css|html)$/.test(path)).map((path) => ({ path: path.slice(WEB.length), body: readFileSync(path, 'utf8') }));
const html = readFileSync(join(WEB, 'index.html'), 'utf8');

test('the content security policy allows the game\'s own files and nothing else', () => {
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const rules = Object.fromEntries(policy.split(';').map((rule) => rule.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(rules['default-src'], ["'none'"]);
  // Its own files, under the address they have on the web and the one they have inside the iOS app.
  const own = ["'self'", 'capacitor://localhost'];
  assert.deepEqual(rules['script-src'], own);
  assert.deepEqual(rules['style-src'], own, 'no inline styles either');
  assert.deepEqual(rules['img-src'], own);
  assert.deepEqual(rules['font-src'], own);
  assert.deepEqual(rules['base-uri'], ["'none'"]);
  assert.deepEqual(rules['form-action'], ["'none'"]);
  assert.equal(rules['connect-src'], undefined, 'nothing may be fetched: connect-src falls back to none');
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:|data:|blob:/.test(policy), policy);
});

test('the page carries no inline script, inline style or event-handler attribute', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module" src="js\/main\.js"/);
  assert.equal(scripts[0][2].trim(), '');
  assert.ok(!/<style\b/.test(html) && !/\sstyle=/.test(html) && !/\son[a-z]+=/.test(html));
});

test('nothing that ships can reach the network, run text as code, or write markup from text', () => {
  const banned = [
    [/\bfetch\s*\(/, 'fetch'], [/XMLHttpRequest/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'], [/\bEventSource\b/, 'EventSource'],
    [/sendBeacon/, 'sendBeacon'], [/\bimportScripts\b/, 'importScripts'], [/serviceWorker/, 'a service worker'], [/RTCPeerConnection/, 'WebRTC'],
    [/https?:\/\//, 'a web address'], [/\beval\s*\(/, 'eval'], [/new\s+Function\b/, 'new Function'], [/document\.write/, 'document.write'],
    [/\.innerHTML\b/, 'innerHTML'], [/\.outerHTML\b/, 'outerHTML'], [/insertAdjacentHTML/, 'insertAdjacentHTML'],
    [/document\.cookie/, 'cookies'], [/indexedDB/, 'IndexedDB'], [/navigator\.(geolocation|clipboard|share)/, 'a device permission'],
    [/google|analytics|gtag|facebook|firebase|sentry|adsbygoogle|admob/i, 'an ad or tracking service'],
  ];
  const found = [];
  for (const { path, body } of text) {
    body.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      for (const [pattern, what] of banned) if (pattern.test(code)) found.push(`${path}:${i + 1} ${what}`);
    });
  }
  assert.deepEqual(found, []);
});

test('everything that ships is a kind of file the game means to ship, and it is small', () => {
  const odd = shipped.filter((path) => !/\.(js|css|html|webp|woff2|txt)$/.test(path)).map((path) => path.slice(WEB.length));
  assert.deepEqual(odd, []);
  const bytes = shipped.reduce((sum, path) => sum + statSync(path).size, 0);
  // (Most of it is pictures: about 35 KB for each of the forty kinds with its Heirloom, and about 250 KB for each
  // of the seven rooms you can walk into: a back wall, a floor and twelve things to stand on it. The limit was
  // 4 MB until the rooms were painted, on 16 November 2026, and 6.5 MB until the forty grown-up forms were, on
  // 18 November 2026: about 30 KB each, and as much again for each one's Heirloom colours. Then 8.5 MB until
  // chapter two was painted, the same day: forty more kinds, each young and grown, in two sets of colours,
  // which is about 5.5 MB. The four new places' rooms, buildings and keys were another 1.8 MB, which brought it
  // to 14.4 MB: so the limit is 15 MB now, and anything that takes it past that should be looked at first.)
  assert.ok(bytes < 15_000_000, `${Math.round(bytes / 1024)} KB`);
});

test('only this device\'s own storage is used, under the game\'s own name', () => {
  const users = text.filter(({ body }) => /localStorage|sessionStorage/.test(body)).map(({ path }) => path);
  assert.deepEqual(users, ['js/platform/storage.js']);
  // And only one file knows about the iOS app's native side, which it uses for the save and nothing else.
  const bridged = text.filter(({ body }) => /Capacitor|nativePromise|webkit\.messageHandlers/.test(body)).map(({ path }) => path);
  assert.deepEqual(bridged, ['js/platform/native.js']);
  const asked = text.flatMap(({ body }) => [...body.matchAll(/native\('(\w+)', '(\w+)'/g)].map((m) => `${m[1]}.${m[2]}`));
  assert.deepEqual([...new Set(asked)].sort(), ['Preferences.get', 'Preferences.remove', 'Preferences.set']);
  assert.match(readFileSync(join(WEB, 'js/platform/storage.js'), 'utf8'), /const KEY = 'oddments\.save'/);
});

test('the rules never touch the screen, the clock or storage', () => {
  const core = text.filter(({ path }) => path.startsWith('js/core/'));
  assert.ok(core.length >= 9);
  const found = [];
  for (const { path, body } of core) {
    body.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (/\b(document|window|localStorage|navigator|requestAnimationFrame|setTimeout|setInterval|performance|canvas)\b/.test(code)) found.push(`${path}:${i + 1} reaches outside the rules`);
      if (/Math\.random\(/.test(code)) found.push(`${path}:${i + 1} rolls dice that are not the seeded ones`);
      if (/Date\.now\(\)/.test(code) && !/now = Date\.now\(\)/.test(code)) found.push(`${path}:${i + 1} reads the clock for itself`);
      if (/from '\.\.\/(ui|platform)\//.test(code)) found.push(`${path}:${i + 1} imports a screen`);
    });
  }
  assert.deepEqual(found, []);
});

// It must be its own game. These are other games' words: names, creatures,
// things and turns of phrase. None may appear in anything a player can read.
const NOT_OURS = [
  'pokemon', 'pokémon', 'poke', 'pikachu', 'pokedex', 'pokéball', 'pokeball', 'trainer', 'gym leader', 'gym badge', 'shiny', 'shinies',
  'evolve', 'evolution', 'super effective', 'not very effective', 'a wild ', 'gotta catch', 'catch \'em', 'fainted', 'hidden machine',
  'digimon', 'digivolve', 'temtem', 'palworld', 'pal sphere', 'yo-kai', 'yokai', 'monster rancher', 'dragon quest', 'slime', 'cassette beasts',
  'coromon', 'nexomon', 'monster hunter', 'tamer', 'capture', 'captured',
];
test('nothing a player can read is taken from another game', () => {
  const readable = [
    ...Object.values(SPECIES).flatMap((kind) => [kind.name, kind.blurb, kind.grown ? kind.grown.name : '']),
    ...Object.values(MOVES).flatMap((move) => [move.name, move.desc]),
    ...Object.values(ELEMENTS).flatMap((element) => [element.name, element.why]),
    ...Object.values(CALLS).flatMap((call) => [call.name, call.desc]),
    ...Object.values(STATS).flatMap((stat) => [stat.name, stat.hint]),
    ...ROOMS.flatMap((room) => [room.name, room.blurb, ...(room.path || []).map((spot) => spot.name)]),
    ...LOOKS.map((look) => look.name),
    // Every piece of text the screens write, everything anyone in the story says, and the page itself.
    ...text.filter(({ path }) => path.startsWith('js/ui/') || path === 'js/main.js' || path === 'js/core/story.js' || path === 'index.html').flatMap(({ body }) => [...body.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g)].map((m) => m[1] || m[2] || m[3] || '')),
  ].join('\n').toLowerCase();
  assert.ok(readable.length > 5000);
  assert.ok(readable.includes('ines tock') && readable.includes('clearance man'), 'the story is among what is read');
  assert.deepEqual(NOT_OURS.filter((word) => readable.includes(word)), []);
});

test('our own words are in place: six elements, four stats, three Calls', () => {
  assert.deepEqual(Object.values(ELEMENTS).map((e) => e.name).sort(), ['Clank', 'Crumb', 'Fluff', 'Spark', 'Sprout', 'Suds']);
  assert.deepEqual(Object.values(STATS).map((s) => s.name), ['Health', 'Oomph', 'Grit', 'Pep']);
  assert.deepEqual(Object.values(CALLS).map((c) => c.name), ['Reach out', 'Cheer on', 'Patch up']);
});
