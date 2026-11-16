// Prints the new art the full game would still need, with counts. The numbers
// that depend on the game's tables are read from them, so the list stays true
// as the tables grow. Nothing here generates or costs anything.
//   node tools/art-needs.mjs
import { SPECIES, SPECIES_IDS, ELEMENT_IDS, CALL_IDS, STAT_IDS, ROOMS, roomBuilt } from '../web/js/core/balance.js';
import { ART } from './art-manifest.mjs';

// The whole game: every monster and boss painted for Pawst Lives.
export const FULL = { kinds: 40, bosses: 8, places: ROOMS.length };

export function artNeeds() {
  const friendsNow = SPECIES_IDS.filter((id) => !SPECIES[id].boss);
  const named = friendsNow.filter((id) => SPECIES[id].grown).length;
  const unbuilt = ROOMS.filter((room) => !roomBuilt(room)).length;
  const rows = [
    ['People', 'The house-sitter, final sprite (one of the four candidate looks, or a repaint)', 1],
    ['Grown-up forms', `One per kind (${named} are named in the tables; ${FULL.kinds - named} still to design). Bosses do not grow`, FULL.kinds],
    ['The world', `For each place still to build (${unbuilt}): a sheet of the things that stand in it and a ground of its own, as Tin Can Alley has. And one sheet of painted gateways`, unbuilt * 2 + 1],
    ['Icons', `Elements (${ELEMENT_IDS.length}), Calls (${CALL_IDS.length}), stats (${STAT_IDS.length - 1}; Health exists), tabs (4), the Heirloom mark (1)`, ELEMENT_IDS.length + CALL_IDS.length + (STAT_IDS.length - 1) + 4 + 1],
    ['Identity', 'Title art (the app icon is painted)', 1],
  ];
  const free = [
    ['People', 'The cast (Ines Tock, Dov, Mr. Spick, Great-aunt Maribel) and the house-sitter from the front and behind: painted', 0],
    ['The world', 'The open neighbourhood, the garden and Tin Can Alley: buildings, trees, lamps, hedges, grass, junk, fence and cobbles, from the four world images already made', 0],
    ['Identity', 'The app icon and launch image, from the one icon painting', 0],
    ['Heirlooms', `Rare colours for all ${FULL.kinds} kinds and their ${FULL.kinds} grown forms: recoloured in code by tools/heirlooms.py`, FULL.kinds * 2],
    ['Fights', `The ${FULL.places} room paintings and all ${FULL.kinds + FULL.bosses} monster sprites from Pawst Lives, as they are`, FULL.places + FULL.kinds + FULL.bosses],
  ];
  return { rows, free, total: rows.reduce((sum, row) => sum + row[2], 0), made: ART.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, free, total, made } = artNeeds();
  console.log('New art the full game would still need\n');
  for (const [group, what, count] of rows) console.log(`${String(count).padStart(4)}  ${group.padEnd(15)} ${what}`);
  console.log(`${String(total).padStart(4)}  new images in all (${made} images have been generated so far)\n`);
  console.log('Needs no new images');
  for (const [group, what, count] of free) console.log(`${String(count || '').padStart(4)}  ${group.padEnd(15)} ${what}`);
}
