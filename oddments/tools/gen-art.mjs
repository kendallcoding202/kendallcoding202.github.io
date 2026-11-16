// Generates every image in tools/art-manifest.mjs that isn't already in art/raw/.
// Usage: NODE_USE_ENV_PROXY=1 node tools/gen-art.mjs [id ...]   (ids force a regenerate of just those)
// Needs OPENAI_API_KEY in the environment (or a proxy that injects it).
// Every image costs money: nothing is generated unless it is in the manifest
// and missing, and the manifest only lists art that has been agreed.
// An entry with `ref` is painted from a picture already made (art/raw/<ref>), so the
// same character can be shown another way; if the service will not take a picture to
// work from, the entry's words are used on their own instead.
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { ART } from './art-manifest.mjs';

const OUT = new URL('../art/raw/', import.meta.url);
const MODEL = process.env.ART_MODEL || 'gpt-image-2.6-flare';
const KEY = process.env.OPENAI_API_KEY || 'sk-dummy';
const CONCURRENCY = 4;

const only = process.argv.slice(2);
await mkdir(OUT, { recursive: true });

const exists = async (u) => access(u).then(() => true, () => false);

/** The picture an entry is to be painted from: the original as it came, or as archived. */
async function reference(id) {
  for (const [ext, type] of [['png', 'image/png'], ['webp', 'image/webp']]) {
    const url = new URL(`${id}.${ext}`, OUT);
    if (await exists(url)) return { bytes: await readFile(url), type, name: `${id}.${ext}` };
  }
  return null;
}

async function generate(item) {
  const dest = new URL(`${item.id}.png`, OUT);
  // Originals are archived as .webp after processing; either counts as done.
  const done = (await exists(dest)) || (await exists(new URL(`${item.id}.webp`, OUT)));
  if (!only.includes(item.id) && done) return 'skip';
  const body = {
    model: MODEL, prompt: item.prompt, size: item.size, quality: item.quality,
    output_format: 'png', n: 1,
    ...(item.transparent ? { background: 'transparent' } : {}),
  };
  let from = item.ref ? await reference(item.ref) : null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      let res;
      if (from) {
        // Painted from a picture: the same request as a form, with the picture attached.
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) form.append(key, String(value));
        form.append('image', new Blob([from.bytes], { type: from.type }), from.name);
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
        // Refused outright (not a hiccup): this service will not work from a picture. Use the words alone.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          console.error(`  ${item.id}: cannot be painted from a picture here (${res.status}: ${(await res.text()).slice(0, 200)}); using the words alone`);
          from = null;
          attempt--;
          continue;
        }
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const json = await res.json();
      if (!json.data) throw new Error(JSON.stringify(json).slice(0, 300));
      await writeFile(dest, Buffer.from(json.data[0].b64_json, 'base64'));
      return 'ok';
    } catch (err) {
      console.error(`  ${item.id} attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return 'FAILED';
}

const queue = ART.filter((a) => only.length === 0 || only.includes(a.id));
let done = 0;
const results = {};
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const r = await generate(item);
      results[r] = (results[r] || 0) + 1;
      done++;
      if (r !== 'skip') console.log(`[${done}] ${item.id}: ${r}`);
    }
  }),
);
console.log('done', results);
if (results.FAILED) process.exit(1);
