// Prints the new art the full game would need, with counts. The numbers that
// depend on the game's tables are read from them, so the list stays true as
// the tables grow. Nothing here generates or costs anything.
//   node tools/art-needs.mjs
import { SPECIES, SPECIES_IDS, ELEMENT_IDS, CALL_IDS, STAT_IDS, ROOMS, LOOKS } from '../web/js/core/balance.js';

// The whole game: every monster and boss painted for Pawst Lives.
export const FULL = { kinds: 40, bosses: 8, places: ROOMS.length };
const CAST = ['Great-aunt Maribel', 'Dov', 'Ines Tock', 'Mr. Spick'];

export function artNeeds() {
  const friendsNow = SPECIES_IDS.filter((id) => !SPECIES[id].boss);
  const named = friendsNow.filter((id) => SPECIES[id].grown).length;
  const rows = [
    ['People', 'The house-sitter, final sprite (one of the four candidate looks, or a repaint)', 1],
    ['People', `The cast: ${CAST.join(', ')}`, CAST.length],
    ['Grown-up forms', `One per kind (${named} are named in the tables; ${FULL.kinds - named} still to design). Bosses do not grow`, FULL.kinds],
    ['The world', 'The lane: one painted map to walk on (today the ground is drawn in code)', 1],
    ['The world', 'Buildings seen from the lane: home and the eight places', FULL.places + 1],
    ['The world', 'The inside of each place: a painted map to walk through', FULL.places],
    ['The world', 'Things to walk round: hedge, tree, gate, lamp, fence, and one special thing per place', 5 + FULL.places],
    ['Icons', `Elements (${ELEMENT_IDS.length}), Calls (${CALL_IDS.length}), stats (${STAT_IDS.length - 1}; Health exists), tabs (4), the Heirloom mark (1)`, ELEMENT_IDS.length + CALL_IDS.length + (STAT_IDS.length - 1) + 4 + 1],
    ['Identity', 'App icon and title art, once the game has its name', 2],
  ];
  const free = [
    ['Heirlooms', `Rare colours for all ${FULL.kinds} kinds and their ${FULL.kinds} grown forms: recoloured in code by tools/heirlooms.py`, FULL.kinds * 2],
    ['Fights', `The ${FULL.places} room paintings and all ${FULL.kinds + FULL.bosses} monster sprites from Pawst Lives, as they are`, FULL.places + FULL.kinds + FULL.bosses],
  ];
  return { rows, free, total: rows.reduce((sum, row) => sum + row[2], 0), made: LOOKS.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, free, total, made } = artNeeds();
  console.log('New art the full game would need\n');
  for (const [group, what, count] of rows) console.log(`${String(count).padStart(4)}  ${group.padEnd(15)} ${what}`);
  console.log(`${String(total).padStart(4)}  new images in all (${made} candidate images have been generated so far)\n`);
  console.log('Needs no new images');
  for (const [group, what, count] of free) console.log(`${String(count).padStart(4)}  ${group.padEnd(15)} ${what}`);
}
