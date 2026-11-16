// The game is meant for iPhones back to iOS 15.0, whose web view is older
// than anything the tests run in. A JavaScript or CSS feature it lacks does
// not fail politely there: at best one screen breaks, at worst every save
// fails to load. Nothing here can run that old engine, so this keeps a list
// of features that arrived after it and fails if shipped code uses one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));

// Feature -> the iOS version that first has it.
const TOO_NEW = [
  [/Object\.hasOwn\(/, 'Object.hasOwn (15.4)'],
  [/\.at\(/, 'Array/String.prototype.at (15.4)'],
  [/\.findLast(Index)?\(/, 'findLast (15.4)'],
  [/structuredClone\(/, 'structuredClone (15.4)'],
  [/randomUUID\(/, 'crypto.randomUUID (15.4)'],
  [/\.to(Sorted|Reversed|Spliced)\(/, 'toSorted and friends (16)'],
  [/(Object|Map)\.groupBy\(/, 'groupBy (17.4)'],
  [/Array\.fromAsync\(/, 'Array.fromAsync (16.4)'],
  [/Promise\.withResolvers\(/, 'Promise.withResolvers (17.4)'],
  [/AbortSignal\.timeout\(/, 'AbortSignal.timeout (16)'],
  [/\(\?<[=!]/, 'regular-expression lookbehind (16.4)'],
  [/\broundRect\(/, 'canvas roundRect (16)'],
  [/\bOffscreenCanvas\b/, 'OffscreenCanvas (16.4)'],
  [/\brequestIdleCallback\b/, 'requestIdleCallback (never)'],
  [/\.showModal\(/, '<dialog> (15.4)'],
  [/\bstatic\s*\{/, 'class static blocks (16.4)'],
  [/\.(inert)\s*=/, 'inert (15.5)'],
];
const CSS_TOO_NEW = [
  [/:has\(/, ':has() (15.4)'],
  [/\d[dsl]v[hw]\b/, 'dvh/svh/lvh units (15.4)'],
  [/@container\b/, 'container queries (16)'],
  [/\btext-wrap\s*:/, 'text-wrap (17.4)'],
  [/@layer\b/, 'cascade layers (15.4)'],
  [/\bcolor-mix\(/, 'color-mix (16.2)'],
];

function files(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, keep);
    return keep(name) ? [path] : [];
  });
}

test('shipped JavaScript uses nothing newer than iOS 15.0', () => {
  const sources = files(join(WEB, 'js'), (name) => name.endsWith('.js'));
  assert.ok(sources.length > 15, 'found the game\'s source');
  const found = [];
  for (const path of sources) {
    readFileSync(path, 'utf8').split('\n').forEach((text, i) => {
      const code = text.replace(/\/\/.*$/, ''); // a comment may name a feature to explain why it is avoided
      for (const [pattern, what] of TOO_NEW) if (pattern.test(code)) found.push(`${path.slice(WEB.length)}:${i + 1} uses ${what}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the stylesheet uses nothing newer than iOS 15.0', () => {
  const css = readFileSync(join(WEB, 'css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  css.split('\n').forEach((line, i) => { for (const [pattern, what] of CSS_TOO_NEW) if (pattern.test(line)) found.push(`style.css:${i + 1} uses ${what}`); });
  assert.deepEqual(found, []);
});

test('styles that need a -webkit- prefix on iOS 15 have one', () => {
  const css = readFileSync(join(WEB, 'css/style.css'), 'utf8');
  for (const rule of css.split('}')) {
    for (const property of ['backdrop-filter', 'user-select']) {
      if (new RegExp(`[^-]${property}\\s*:`).test(rule)) assert.ok(rule.includes(`-webkit-${property}`), `${property} without its prefix in: ${rule.trim().slice(0, 80)}`);
    }
  }
});
