// Fetches every picture before the game shows, so nothing pops in mid-fight.
import { SPECIES, SPECIES_IDS, ROOMS, LOOK_IDS } from '../core/balance.js';
import { spriteSrc } from './dom.js';
import { WORLD_ART, worldSrc } from './scenery.js';

function load(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => { console.warn('missing asset', src); resolve(false); };
    img.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const sources = [];
  for (const id of SPECIES_IDS) {
    sources.push(spriteSrc(id));
    if (!SPECIES[id].boss) sources.push(spriteSrc(id, true));
  }
  for (const look of LOOK_IDS) sources.push(spriteSrc(look));
  for (const room of ROOMS) sources.push(`assets/bg/${room.bg}.webp`);
  for (const name of WORLD_ART) sources.push(worldSrc(name));
  let done = 0;
  await Promise.all(sources.map((src) => load(src).then(() => onProgress(++done / sources.length))));
  try { await document.fonts.load('700 16px Fredoka'); } catch { /* the system font will do */ }
}
