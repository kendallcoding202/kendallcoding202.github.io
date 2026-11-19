// The rival: Tansy Brisk, junior clearance officer of Spick & Span Clearances,
// and her three. Rules and words only: no DOM, no clock, no storage.
//
// She is your counterpart. The lane is hers to tidy and yours to calm, and she
// would like to know whose way works. She waits by the road at five points
// along the way (world.RIVAL_AT), each once a place further on is calm
// (balance.RIVAL). Nobody has to stop for her. Walk up and she says her piece;
// say yes, and it is a bout: her three against yours.
//
// Her three are not lost. The depot issued them to her, with numbers instead
// of names, and they cannot be reached: a bout with her is won or it is not.
// Over the five meetings that changes, which is the point of her.
//
// The save keeps two numbers for all of it: how many of her meetings you have
// won (`story.rival`), and how many of those she has had her say about
// (`story.heard`). Where she is, who is with her and what she says all follow
// from those, and from which places are calm. Having lost, she stands where
// she was until she has been heard out, however long that takes: close the
// game on the news of a win and she is still there, with it still to say.
// (The owner asked for her: "a villain to the game that's our counterpart ...
// just to add more depth to the game".)
import { SPECIES, RIVAL } from './balance.js';
import { RIVAL_AT } from './world.js';

/** Who she is in the cast (see story.CAST). */
export const TANSY = 'tansy';

// What her three answer to: numbers, as issued; and from the fourth meeting, names.
const UNITS = ['Unit One', 'Unit Two', 'Unit Three'];
const NAMES = ['Flick', 'Sliver', 'Crease'];
const NAMED_FROM = 3;

// Each meeting: where she is (for the journal), what she says as you walk up, and what she says
// once it is over, won or lost.
const MEETINGS = [
  {
    where: 'by the street east of the green, on the way to Tin Can Alley',
    before: [
      'You. House-sitter. Tansy Brisk, junior clearance officer, Spick and Span. Mr. Spick counts them. I collect them.',
      'I had the garden down for Monday. Now my sheet says "sitting quietly". That is your doing.',
      'You make friends of them. I put them in boxes. Let us see whose way works. Unit One, Unit Two, Unit Three: fall in.',
    ],
    won: [
      'Hm. Unit Two, stop wagging. We lost.',
      'Beginner\'s luck. I shall be further down the lane. Do keep up.',
    ],
    lost: 'Tansy Brisk ticks a box on her clipboard. "One to tidiness. Come back when they have had a rest."',
  },
  {
    where: 'on Bramble Way, south of the green, on the way to Lampwick Row',
    before: [
      'There you are. Three places calm. My sheet has never been so empty, and I do not like an empty sheet.',
      'I have been drilling the Units. Regulation drills. Unit Three presses its own box flat now.',
      'Again. Properly, this time.',
    ],
    won: [
      'Unit One! That was not in the drill.',
      'It was rather good, though. Do not tell Mr. Spick I said so.',
    ],
    lost: 'Tansy Brisk writes it down twice. "That is what drilling does. Rest them, and try me again."',
  },
  {
    where: 'in Long Meadow, on the way to Chimney Hill',
    before: [
      'Five places. Five! Do you know what I am paid by? The box. There are no boxes. You have calmed all my boxes.',
      'So I asked myself what you have that I have not. Then Flick... Unit One. Then Unit One sat on my foot all night, and I did not write it up.',
      'Never mind that. Units, fall in. This one is for the sheet.',
    ],
    won: [
      'Well fought. That is not a regulation phrase. I looked.',
      'They have got bigger, mine. Nobody issued that. I think they did it on purpose.',
    ],
    lost: 'Tansy Brisk looks at her three, and then at her sheet, and does not write anything. "Again, when you are rested."',
  },
  {
    where: 'on Chimney Hill, just above Kettle Bridge',
    before: [
      'All eight. Mr. Spick has put it in writing. He is very nearly smiling. It is dreadful.',
      'You are going over the bridge, I suppose. It is a different council over there. I am not supposed to cross.',
      'One more on this side, before you go. Not for the sheet: I threw the sheet in the river. Units... no. Flick. Sliver. Crease. Fall in.',
    ],
    won: [
      'They answer faster to their names. I timed it.',
      'Go on, then. Over you go. I shall think of a reason to follow.',
    ],
    lost: 'Tansy Brisk says "Good, Crease. Good, all of you," and then looks surprised at herself. "Rest yours. I will be here."',
  },
  {
    where: 'at the top of Bobbin Row, over the water',
    before: [
      'Before you say anything: I am on holiday. A clearance officer gets one day a year. I had saved eleven.',
      'I have handed in my boxes. Flat-packed, as per regulation. It was the last regulation I kept.',
      'One last bout, and this one is only for the fun of it. Flick, Sliver, Crease: show them what we have learned.',
    ],
    won: [
      'Best of five, to you. I counted properly. I always do.',
      'I shall stay over here a while. Somebody ought to tell these ones they are not clutter. I know how it is done now. I watched you.',
      'Oh, and this is for you. Form nine: one vacuum cleaner, signed out of the depot for good. It has been asking after a dust bunny.',
    ],
    lost: 'Tansy Brisk laughs, which nobody on the lane has heard before. "We have been practising. Rest them, and come and find us."',
  },
];

// When it is all over she stays where the last meeting was, and has a word for you.
const LATER = [
  'On holiday. Day three of eleven. Crease has ironed the bench.',
  'Flick has made a friend of a Thimblet. I did not issue that either.',
  'Mr. Spick sent a postcard. It says "Nothing to report." He has underlined it. I think he is pleased.',
  'Sliver slid off this morning and came back with three others. I am not boxing them. I am counting them. It is different.',
];

const said = (texts) => texts.map((text) => ({ who: TANSY, text }));
const calm = (state, roomId) => state.rooms[roomId].clears > 0;

/** Whether all five meetings are won. */
export const rivalDone = (state) => state.story.rival >= RIVAL.meetings.length;

/** The meeting she lost and has not yet had her say about (0 is the first), or -1. */
export const rivalOwes = (state) => (state.story.heard < state.story.rival ? state.story.rival - 1 : -1);

/** She has had her say. Returns whether there was anything owed. */
export function rivalHeard(state) {
  if (rivalOwes(state) < 0) return false;
  state.story.heard = state.story.rival;
  return true;
}

/**
 * The meeting that is due (0 is the first), or -1: the one after those you have won, once its place
 * is calm, and once she has had her say about the last.
 */
export function rivalDue(state) {
  if (rivalOwes(state) >= 0) return -1;
  const meeting = RIVAL.meetings[state.story.rival];
  return meeting && calm(state, meeting.after) ? state.story.rival : -1;
}

/** How many of her meetings can have been won as things stand: a save cannot say more. */
export function rivalMost(state) {
  let most = 0;
  while (most < RIVAL.meetings.length && calm(state, RIVAL.meetings[most].after)) most++;
  return most;
}

/**
 * Where she is standing just now: { x, y, due }, `due` the meeting she wants (or -1, when she only
 * has a word for you: it is all over, or she has just lost, and then `owes` says which meeting).
 * Null when she is not about.
 */
export function rivalAbout(state) {
  const owes = rivalOwes(state);
  if (owes >= 0) return { ...RIVAL_AT[owes], due: -1, owes };
  const due = rivalDue(state);
  if (due >= 0) return { ...RIVAL_AT[due], due };
  return rivalDone(state) ? { ...RIVAL_AT[RIVAL_AT.length - 1], due: -1 } : null;
}

/** Her three as they come to a meeting: grown up once they are big enough, and nobody's to reach (`owned`). */
export function rivalTeam(meeting) {
  const levels = RIVAL.meetings[meeting].levels;
  return RIVAL.kinds.map((species, i) => {
    const foe = { species, level: levels[i], heirloom: false, owned: true, name: (meeting >= NAMED_FROM ? NAMES : UNITS)[i] };
    if (SPECIES[species].grown && levels[i] >= SPECIES[species].grown.at) foe.grown = true;
    return foe;
  });
}

/** What she says as you walk up: her piece before the meeting that is due, or a word when it is all over. Null if she is not about. */
export function rivalSays(state) {
  const owes = rivalOwes(state);
  if (owes >= 0) return said(MEETINGS[owes].won);
  const due = rivalDue(state);
  if (due >= 0) return said(MEETINGS[due].before);
  // (Which word changes as the game goes on, with nothing kept to say which.)
  return rivalDone(state) ? said([LATER[state.stats.battles % LATER.length]]) : null;
}

/** What she says when a meeting is over: lines of hers if you won; if not, one plain line of what she did. */
export const rivalAfter = (meeting, won) => (won ? { lines: said(MEETINGS[meeting].won), text: '' } : { lines: [], text: MEETINGS[meeting].lost });

/** Something else worth doing: she is waiting, and where. { id, title, detail, art }, or null. */
export function rivalAside(state) {
  const due = rivalDue(state);
  if (due < 0) return null;
  return {
    id: 'rival', art: 'cast_tansy',
    title: due === 0 ? 'Somebody from Spick & Span is waiting' : 'Tansy Brisk is waiting',
    detail: `${due === 0 ? 'A young woman in a boiler suit, with boxes on her back,' : 'She'} is ${MEETINGS[due].where}. She wants a bout: her three against yours. Nobody has to stop.`,
  };
}

/** Her part of the story so far, for the journal: a line or two, or none. */
export function rivalSoFar(state) {
  const won = Math.min(state.story.rival, RIVAL.meetings.length);
  if (won === 0) return [];
  if (rivalDone(state)) return ['Tansy Brisk of Spick & Span put things in boxes, and wanted to see whose way worked. Yours did, five times. She has handed in her boxes, and her three have names.'];
  return [`Tansy Brisk of Spick & Span puts things in boxes, and wants to see whose way works. You have got the better of her ${['', 'once', 'twice', 'three times', 'four times'][won]}.`];
}
