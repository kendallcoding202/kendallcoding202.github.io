// Fetches every picture before the game shows, so nothing pops in mid-fight.
import { SPECIES, SPECIES_IDS, ROOMS, LOOK_IDS } from '../core/balance.js';
import { CAST, CAST_IDS } from '../core/story.js';
import { spriteSrc } from './dom.js';
import { WORLD_ART, worldSrc } from './scenery.js';
import { ROOM_ART } from './roomart.js';

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
    // A kind that grows up has a second picture, and that has its Heirloom colours too.
    if (SPECIES[id].grown) sources.push(spriteSrc(`${id}_grown`), spriteSrc(`${id}_grown`, true));
  }
  // People: each look of the house-sitter from the side, the front and behind, and the cast.
  for (const look of LOOK_IDS) sources.push(spriteSrc(look), spriteSrc(`${look}_front`), spriteSrc(`${look}_back`));
  for (const id of CAST_IDS) sources.push(spriteSrc(CAST[id].art));
  for (const room of ROOMS) sources.push(`assets/bg/${room.bg}.webp`);
  sources.push('assets/bg/bg_lane.webp'); // what a fight with strays, out on the lane, is seen against
  for (const name of WORLD_ART) sources.push(worldSrc(name));
  sources.push(...ROOM_ART); // the insides of buildings: their walls, floors and furniture
  let done = 0;
  await Promise.all(sources.map((src) => load(src).then(() => onProgress(++done / sources.length))));
  try { await document.fonts.load('700 16px Fredoka'); } catch { /* the system font will do */ }
}
