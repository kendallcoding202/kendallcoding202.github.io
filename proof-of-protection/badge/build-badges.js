#!/usr/bin/env node
'use strict';
/*
 * Builds the Kovyr Proof badges from the brand constants in ../check/brand.js.
 *
 *   node badge/build-badges.js                 sample badges → badge/img/
 *   node badge/build-badges.js --firm <slug>   one firm → badge/firms/<slug>/
 *   node badge/build-badges.js --all           every firm folder (skips _*)
 *
 * Options: --now <ISO date> (pretend it's this time), --no-png (SVG only).
 *
 * Firm mode reads firms/<slug>/firm.json and draws Verified or Lapsed using
 * the same rule as the trust page (trust.js computeState). Static images
 * can't expire on their own, so run --all at least daily (see README.md).
 * PNGs (for email signatures) are rendered with Playwright's Chromium.
 */
const fs = require('fs');
const path = require('path');
const BRAND = require('../check/brand.js');
const TRUST = require('./trust.js');

const HERE = __dirname;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Liberation Sans', sans-serif";

// The Kovyr vault-dial mark (same geometry as kovyr-vault/packaging/make_icon.py
// render_mark), drawn in a 1024 box. `tile`, `dial` and `hub` set its colours.
function markSvg(c) {
  return (
    '<rect x="32" y="32" width="960" height="960" rx="232" fill="' + c.tile + '"/>' +
    '<g transform="translate(512 512) scale(0.86) translate(-512 -512)" fill="none" stroke="' + c.dial + '">' +
    '<circle cx="512" cy="512" r="300" stroke-width="76"/>' +
    '<path stroke-width="52" d="M870 512H938M765.1 765.1L813.2 813.2M512 870V938M258.9 765.1L210.8 813.2M154 512H86M258.9 258.9L210.8 210.8M512 154V86M765.1 258.9L813.2 210.8"/>' +
    '<path stroke-width="58" d="M512 512V716M512 512L335.3 410M512 512L688.7 410"/>' +
    '</g>' +
    '<circle cx="512" cy="512" r="89" fill="' + c.dial + '"/>' +
    '<circle cx="512" cy="512" r="50" fill="' + c.hub + '"/>'
  );
}

const COLORS = {
  light: {
    verified: { bg: '#ffffff', border: '#e2e8f0', title: '#1c2733', sub: '#5a6b7b', tile: '#1e3a5f', dial: '#eef4fb', hub: '#5b9bd5', dot: '#1a7f4e', glyph: '#ffffff', ring: '#ffffff' },
    lapsed: { bg: '#ffffff', border: '#e2e8f0', title: '#1c2733', sub: '#8a5a12', tile: '#7b8794', dial: '#f5f7fa', hub: '#c3cbd4', dot: '#b7791f', glyph: '#ffffff', ring: '#ffffff' }
  },
  dark: {
    verified: { bg: '#16202e', border: '#24303f', title: '#e6edf3', sub: '#9fb0c0', tile: '#1e3a5f', dial: '#eef4fb', hub: '#6ea3d8', dot: '#4ec98c', glyph: '#0d1622', ring: '#16202e' },
    lapsed: { bg: '#16202e', border: '#24303f', title: '#e6edf3', sub: '#e0b05c', tile: '#3a4656', dial: '#c3cbd4', hub: '#7b8794', dot: '#e0b05c', glyph: '#0d1622', ring: '#16202e' }
  }
};

const SIZES = {
  web: { w: 280, h: 64, rx: 12, tile: 44, tx: 10, ty: 10, trx: 10, dot: { cx: 50, cy: 50, r: 9 }, x: 66, y1: 29, s1: 14.5, y2: 47, s2: 12 },
  email: { w: 232, h: 40, rx: 8, tile: 28, tx: 6, ty: 6, trx: 7, dot: { cx: 32, cy: 32, r: 6.5 }, x: 44, y1: 18, s1: 12, y2: 31.5, s2: 10 }
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Rough Helvetica/Arial advance widths (em) so a longer brand name shrinks
// to fit instead of running off the badge. Errs on the wide side.
function textWidth(str, size, bold) {
  let em = 0;
  for (const ch of str) {
    if (' .,:;\'!|ilIjtf'.includes(ch)) em += 0.29;
    else if ('mwMW@'.includes(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else if (/[0-9]/.test(ch)) em += 0.57;
    else if ('·›'.includes(ch)) em += 0.4;
    else em += 0.56;
  }
  return em * size * (bold ? 1.08 : 1);
}

function fit(str, size, max, bold) {
  const w = textWidth(str, size, bold);
  return w <= max ? size : Math.floor((size * max) / w * 10) / 10;
}

function shortDate(ms) {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/**
 * One badge as an SVG string.
 * opts: { size: 'web'|'email', theme: 'light'|'dark', state: 'verified'|'lapsed', checked?: ms }
 */
function badgeSvg(opts) {
  const L = SIZES[opts.size];
  const C = COLORS[opts.theme][opts.state];
  const verified = opts.state === 'verified';
  const line1 = verified ? 'Security checks verified' : 'Security checks lapsed';
  const tail = verified ? (opts.checked ? 'Checked ' + shortDate(opts.checked) : 'Click to verify') : 'Not current';
  const line2 = BRAND.product + ' · ' + tail;
  const title = verified
    ? 'Security checks verified by ' + BRAND.product + (opts.checked ? ', checked ' + shortDate(opts.checked) : '') + '. Click to verify.'
    : BRAND.product + ' security checks have lapsed and are not current.';
  const maxText = L.w - L.x - 10;
  const s1 = fit(line1, L.s1, maxText, true);
  const s2 = fit(line2, L.s2, maxText, false);
  const k = L.tile / 1024;
  const d = L.dot;
  const r = d.r;
  const glyph = verified
    ? '<path d="M' + (d.cx - r * 0.45) + ' ' + (d.cy + r * 0.02) + 'l' + r * 0.3 + ' ' + r * 0.3 + 'l' + r * 0.58 + ' -' + r * 0.6 + '" fill="none" stroke="' + C.glyph + '" stroke-width="' + r * 0.26 + '" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M' + d.cx + ' ' + (d.cy - r * 0.5) + 'v' + r * 0.55 + '" stroke="' + C.glyph + '" stroke-width="' + r * 0.26 + '" stroke-linecap="round"/><circle cx="' + d.cx + '" cy="' + (d.cy + r * 0.45) + '" r="' + r * 0.15 + '" fill="' + C.glyph + '"/>';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + L.w + '" height="' + L.h + '" viewBox="0 0 ' + L.w + ' ' + L.h + '" role="img" aria-labelledby="t">' +
    '<title id="t">' + esc(title) + '</title>' +
    '<rect x="0.5" y="0.5" width="' + (L.w - 1) + '" height="' + (L.h - 1) + '" rx="' + L.rx + '" fill="' + C.bg + '" stroke="' + C.border + '"/>' +
    '<g transform="translate(' + L.tx + ' ' + L.ty + ') scale(' + k + ')">' + markSvg(C) + '</g>' +
    '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="' + (r + 1.6) + '" fill="' + C.ring + '"/>' +
    '<circle cx="' + d.cx + '" cy="' + d.cy + '" r="' + r + '" fill="' + C.dot + '"/>' + glyph +
    '<text x="' + L.x + '" y="' + L.y1 + '" font-family="' + FONT + '" font-size="' + s1 + '" font-weight="700" fill="' + C.title + '">' + esc(line1) + '</text>' +
    '<text x="' + L.x + '" y="' + L.y2 + '" font-family="' + FONT + '" font-size="' + s2 + '" fill="' + C.sub + '">' + esc(line2) + '</text>' +
    '</svg>\n'
  );
}

function standaloneMark() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="' + esc(BRAND.company) + '">' +
    markSvg({ tile: '#1e3a5f', dial: '#eef4fb', hub: '#5b9bd5' }) + '</svg>\n';
}

/** All 8 variants for a state map: { verified|lapsed: true }. Returns [{ file, svg, png }]. */
function variants(states, naming, checked) {
  const out = [];
  for (const state of states) {
    for (const size of ['web', 'email']) {
      for (const theme of ['light', 'dark']) {
        out.push({ file: naming(state, size, theme), svg: badgeSvg({ size, theme, state, checked }), size, theme, state });
      }
    }
  }
  return out;
}

async function renderPngs(items, dir) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.warn('  (Playwright not installed: skipped PNGs. Install it with `npm i -g playwright` to render them.)');
    return [];
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const written = [];
  for (const it of items) {
    await page.setContent('<!doctype html><html><body style="margin:0;background:transparent">' + it.svg + '</body></html>');
    const file = path.join(dir, it.file + '.png');
    await page.locator('svg').screenshot({ path: file, omitBackground: true });
    written.push(file);
  }
  await browser.close();
  return written;
}

function parseArgs(argv) {
  const args = { png: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--firm') args.firm = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--now') args.now = Date.parse(argv[++i]);
    else if (a === '--no-png') args.png = false;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error('Unknown option ' + a);
  }
  return args;
}

async function buildSamples(args) {
  const dir = args.out || path.join(HERE, 'img');
  fs.mkdirSync(dir, { recursive: true });
  const items = variants(['verified', 'lapsed'], (s, z, t) => s + '-' + z + '-' + t);
  for (const it of items) fs.writeFileSync(path.join(dir, it.file + '.svg'), it.svg);
  fs.writeFileSync(path.join(dir, 'mark.svg'), standaloneMark());
  const pngs = args.png ? await renderPngs(items, dir) : [];
  console.log('Sample badges: ' + items.length + ' SVG + ' + pngs.length + ' PNG → ' + path.relative(process.cwd(), dir));
}

async function buildFirm(slug, args) {
  if (!TRUST.isSlug(slug)) throw new Error('Firm slug must be lowercase letters, digits and dashes: ' + slug);
  const dir = path.join(args.firmsDir || path.join(HERE, 'firms'), slug);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'firm.json'), 'utf8'));
  const st = TRUST.computeState(data, isNaN(args.now) || args.now === undefined ? Date.now() : args.now);
  const out = args.out ? path.join(args.out, slug) : dir;
  fs.mkdirSync(out, { recursive: true });
  // Same file names whatever the state, so the firm's embed code never changes.
  const items = variants([st.state], (s, z, t) => z + '-' + t, st.state === 'verified' ? st.lastVerified : null);
  for (const it of items) fs.writeFileSync(path.join(out, it.file + '.svg'), it.svg);
  const pngs = args.png ? await renderPngs(items, out) : [];
  console.log(slug + ': ' + st.state.toUpperCase() + ' (' + st.reason + ')' + ' → ' + items.length + ' SVG + ' + pngs.length + ' PNG');
  return st;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 17).join('\n'));
    return;
  }
  if (args.firm) return buildFirm(args.firm, args);
  if (args.all) {
    const firms = path.join(HERE, 'firms');
    const slugs = fs.existsSync(firms) ? fs.readdirSync(firms).filter((n) => !n.startsWith('_') && fs.existsSync(path.join(firms, n, 'firm.json'))) : [];
    if (!slugs.length) console.log('No firm folders in ' + firms);
    for (const s of slugs) await buildFirm(s, args);
    return;
  }
  return buildSamples(args);
}

module.exports = { badgeSvg, standaloneMark, textWidth, fit, buildFirm, COLORS, SIZES };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
