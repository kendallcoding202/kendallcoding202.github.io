// The free sample. The copy of the game on the web holds the first two places
// and stops there; the app is the whole game. Rules and words only: no DOM, no
// clock, no storage.
//
// Whoever starts the game says which of the two this is, once, before a save
// is read (see platform/sample.js: the app can never be the sample). Everything
// else asks here.
//
// A place the sample does not hold is simply not open (rooms.roomOpen). So its
// gate stays barricaded, a save cannot be standing in it, and nothing that
// follows from its being calm can happen. Nothing is taken from a save: its
// friends, levels and keys are as they were.
// (The owner, asked what should become of a whole game free on the web once
// the app is paid for: "go with your suggestion", which was to keep the garden
// and Tin Can Alley playable there.)
import { ROOMS, SPECIES, SPECIES_IDS, SAMPLE, roomBuilt } from './balance.js';

let on = false;

/** Says whether this is the free sample. Anything but `true` is the whole game. */
export function setSample(value) { on = value === true; }

/** Whether this is the free sample. */
export const sampleOn = () => on;

/** The places the sample holds: the first few. */
export const samplePlaces = () => ROOMS.slice(0, SAMPLE.places);

/** Whether a place is one you can ever go into: any place, in the whole game; in the sample, one it holds. */
export function inSample(roomId) {
  if (!on) return true;
  const index = ROOMS.findIndex((room) => room.id === roomId);
  return index >= 0 && index < SAMPLE.places;
}

/** Whether the sample has been played to its end: every place it holds is calm. Never, in the whole game. */
export const sampleDone = (state) => on && samplePlaces().every((room) => state.rooms[room.id].clears > 0);

const both = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Where the whole game is to be had. (The one line to change on the day the app has a page of its own.)
const COMING = 'coming to iPhone';
const WHERE = `The whole game is ${COMING}.`;

/** What the sample says of itself, wherever it has to: counted from the game, so it stays true. */
export function sampleWords() {
  const held = both(samplePlaces().map((room) => room.name));
  const places = ROOMS.filter(roomBuilt).length;
  const kinds = SPECIES_IDS.filter((id) => !SPECIES[id].boss).length;
  return {
    where: WHERE,
    held,
    /** On the first screen. */
    intro: `This is the free sample: ${held}, the first ${SAMPLE.places} places of ${places}. ${WHERE}`,
    /** At the gate of a place the sample does not hold. */
    gate: (name) => `The free sample ends here. ${name} is in the whole game, ${COMING}.`,
    /** The goal, once the sample is played out. */
    goal: { title: 'That is the free sample', detail: `${held} are calm, and they stay calm. A few are always wandering about in them: friends still to make, and Heirlooms to find. The rest of the lane is in the whole game. ${WHERE}` },
    /** The card at the end of it. */
    end: [
      `${held} are calm, and that was your doing. Thank you for playing.`,
      `The whole game goes on from here: ${places} places on both banks of the river, ${kinds} kinds of Clutterkin to make friends of, a ringleader in every place with a wish of its own, and somebody from Spick & Span who would sooner put them all in boxes. ${WHERE}`,
      'Nothing here goes away. Your friends are yours, and a few are always wandering about in the calm places.',
    ],
  };
}
