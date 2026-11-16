// The story: who the people of the lane are, what each has to say just now,
// and what you are trying to do. Rules and words only: no drawing, no clock.
//
// What has happened is worked out from the save itself wherever it can be (a
// place is calm because its boss was calmed, not because a flag says so). The
// story keeps only what nothing else records: which conversations were had.
import { ROOMS, ROOM_IDS, roomOf, roomBuilt } from './balance.js';

export const CAST = {
  maribel: { name: 'Great-aunt Maribel', role: 'on the phone', art: 'cast_maribel' },
  ines: { name: 'Ines Tock', role: 'clock-mender', art: 'cast_ines' },
  dov: { name: 'Dov', role: 'bottle-cap collector', art: 'cast_dov' },
  spick: { name: 'Mr. Spick', role: 'Spick & Span Clearances', art: 'cast_spick' },
};
export const CAST_IDS = Object.keys(CAST);
/** Whoever stands in the lane to be talked to. (Great-aunt Maribel is away, and rings.) */
export const NEIGHBOURS = ['ines', 'dov', 'spick'];

/** What the story remembers: whether the first call was taken, and how often each neighbour has been heard out. */
export const newStory = () => ({ call: false, ines: 0, dov: 0, spick: 0 });
const MOST = 99;

/** A story from a save, made safe: every part a whole number in range, whatever was stored. */
export function reviveStory(raw) {
  const story = newStory();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return story;
  story.call = raw.call === true;
  for (const who of NEIGHBOURS) {
    const told = raw[who];
    if (typeof told === 'number' && Number.isFinite(told)) story[who] = Math.min(MOST, Math.max(0, Math.floor(told)));
  }
  return story;
}

const FIRST = ROOMS[0];
const calm = (state, roomId) => state.rooms[roomId].clears > 0;
/** How many of the eight places are calm. This is the whole game's goal: all of them, before Monday. */
export const placesCalm = (state) => ROOM_IDS.filter((id) => calm(state, id)).length;
/** The next place still to be calmed, or null when the whole lane is quiet. */
export const nextPlace = (state) => ROOMS.find((room) => !calm(state, room.id)) || null;

// ---------------------------------------------------------------- what they say

const line = (who, text) => ({ who, text });

/** The call that starts everything: great-aunt Maribel, from her trip. */
export const CALL = [
  line('maribel', 'Hello, dear! It is your great-aunt. Is the house behaving itself? ... No? Oh, good. I mean: oh dear.'),
  line('maribel', 'I ought to have said before I left. Things in that house wake up. Odd socks, burnt toast, the dust under the bed. The whole lane is the same. They are not wicked. They are restless.'),
  line('maribel', 'And the council has sent a clearance man. On Monday morning his van takes away anything that will not sit still. So before Monday we calm them down. All eight places on the lane.'),
  line('maribel', 'Three of mine will walk with you. Then find Ines Tock, on the green below the house. She will show you how it is done. Must dash, the boat is leaving!'),
];

const INES = {
  first: [
    'So you are the house-sitter. Maribel rang. I am Ines Tock. I mend clocks, and I have lived among Clutterkin longer than you have been alive.',
    'Clutterkin: that is what we call them. Odd socks, burnt toast, lost buttons. Clutter, some would say. Kin, I say, once they have stopped fretting.',
    'Restless, they pick fights, and your three will stand up for you. But you need not flatten everyone. Reach out to one, keep reaching, and it may calm down and come home with you.',
    'Every place on this lane has a ringleader. Calm everyone else there and it will face you. Calm it too, and the whole place settles.',
  ],
  sendOff: (place) => `Start with ${place}: up the lane, north and west of here. When your friends are worn out, come home and rest. Off you go.`,
  already: 'And the garden is calm already? Maribel said you were quick.',
  nudge: (place) => `${place} first. Everyone else, then the ringleader. And rest when you need to: there is no prize for limping.`,
  reach: 'And do try Reaching out. A friend made is worth more than a fight won.',
  // What she says on hearing that each place is calm, in the order the places come.
  calmed: {
    garden: [
      'The garden has gone quiet. I could hear it from here: that sprinkler has been hissing since Tuesday.',
      'That is one place of eight. Tin Can Alley is next: east along the street, past the launderette, and in at the foot of it. The bins had it barricaded all week. Word of a calm garden travels, and they have let it down.',
      'It is a narrow place. They come at you one after another, and the Bandit Baron holds court at the far end. Most of them are Clank, and Crumb jams Clank: take the Toast Ghost.',
    ],
    alley: [
      'Tin Can Alley, quiet. I never thought I would hear the day. The Baron has held court in there since the bin men changed their round.',
      'Two places of eight. The Midnight Pantry is next, and that I cannot get you into yet: this is as far as the lane is built.',
      'So walk the garden and the alley again. They are restless every time you rest, and there are kinds in both you have not met.',
    ],
  },
  heard: (place) => `${place} is calm. Good. That is one more off Mr. Spick's list.`,
  later: (state) => `${placesCalm(state)} of ${ROOMS.length} calm, and Monday coming. We will get there.`,
};

const DOV = {
  first: [
    'Psst. You are the new house-sitter! I am Dov. I collect bottle caps. I have got four hundred and six.',
    'Want a tip? Everything in there has a soft spot. It goes easier on things it is not scared of. Bring one of those along and Reaching out works better.',
    'And look at who is waiting before you walk up. If one of them is glinting gold, that is an Heirloom. Those are rare. I have only ever seen two.',
  ],
  tips: [
    'Tap one of them in a fight and it tells you its soft spot. Nobody ever taps them. I tap everything.',
    'Down the alley they come one at a time. There is no going round. I tried. I got pecked.',
    'Crumb jams Clank. Take the Toast Ghost down Tin Can Alley and watch the tins dent.',
    'Want an Heirloom? Go back where it is calm. They feel safe there and bring out their best colours. I saw three in the garden in one week. Three!',
    'If you hit the one you are making friends with, it gets in a Huff again. So pick one, and hit the others.',
    'My nan says the Sprinkler was never turned off. Imagine being left on for a week. I would be cross too.',
    'You can only have one of each kind. If you calm a kind you have already got, it goes off happy and yours learns from it.',
  ],
};

const SPICK = {
  first: [
    'Spick. Spick and Span Clearances. Do not mind me, I am counting.',
    'Eight premises on this lane with unattended moving property. Clutter, in plain words. Monday morning the van comes, and whatever is still rattling about goes in it.',
    'If it is sitting quietly, it is furniture, and furniture is not my department. Makes no odds to me either way.',
  ],
  later: (state) => {
    const quiet = placesCalm(state);
    const left = ROOMS.length - quiet;
    if (quiet === 0) return `None quiet. ${ROOMS.length} for the van, as it stands.`;
    return `${quiet} quiet. ${left} for the van, as it stands. I check twice, mind.`;
  },
};

/** How many calm places Ines Tock has heard about. */
const reported = (state) => Math.max(0, state.story.ines - 1);
/** The furthest place along the lane that is calm, or null. */
const latestCalm = (state) => ROOMS.filter((room) => calm(state, room.id)).pop() || null;

/** Whether someone has something new to say: talking to them now would move the story on. */
export function hasNews(state, who) {
  const story = state.story;
  if (who === 'ines') return story.ines === 0 || placesCalm(state) > reported(state);
  if (who === 'dov' || who === 'spick') return story[who] === 0;
  return false;
}

/**
 * Talks to a neighbour. Returns what they say, as lines of { who, text }, and
 * remembers that it was said. Null if there is nobody by that name to talk to.
 */
export function talk(state, who) {
  const story = state.story;
  if (!NEIGHBOURS.includes(who)) return null;
  const say = (texts) => texts.map((text) => line(who, text));
  if (who === 'ines') {
    const calmNow = placesCalm(state);
    if (story.ines === 0) {
      // Met for the first time. Whatever is calm already, she takes as read.
      story.ines = Math.min(MOST, 1 + calmNow);
      return say([...INES.first, calmNow ? INES.already : INES.sendOff(FIRST.name)]);
    }
    if (calmNow > reported(state)) {
      // However much has gone quiet since she last heard, she hears it all at once, and speaks of the furthest.
      const place = latestCalm(state);
      story.ines = Math.min(MOST, 1 + calmNow);
      return say(INES.calmed[place.id] || [INES.heard(place.name)]);
    }
    const next = nextPlace(state);
    if (!next || !roomBuilt(next)) return say([INES.later(state)]);
    return say(state.stats.befriended === 0 ? [INES.nudge(next.name), INES.reach] : [INES.nudge(next.name)]);
  }
  if (who === 'dov') {
    const told = story.dov;
    story.dov = Math.min(MOST, told + 1);
    return say(told === 0 ? DOV.first : [DOV.tips[(told - 1) % DOV.tips.length]]);
  }
  const told = story.spick;
  story.spick = Math.min(MOST, told + 1);
  return say(told === 0 ? SPICK.first : [SPICK.later(state)]);
}

/** Takes the first call. Returns its lines the first time, and null once it has been taken. */
export function takeCall(state) {
  if (state.story.call) return null;
  state.story.call = true;
  return CALL;
}

// ---------------------------------------------------------------- what you are trying to do

// How the goal of calming each place is put. (A place not listed here gets a plain line.)
const CALMING = {
  garden: { title: 'Calm the garden', detail: 'Calm everyone else there and the Sprinkler will face you. Rest at home whenever you need to.' },
  alley: { title: 'Calm Tin Can Alley', detail: 'East along the street, past the launderette. A narrow place: they come one after another, and the Bandit Baron is at the far end. Crumb jams Clank.' },
};

/**
 * The thing to do next: { id, title, detail, who, room, count }. `who` is a
 * neighbour to go and see and `room` a place to go to (either may be null);
 * `count` is [how far, out of how many] where the goal can be counted.
 */
export function goalOf(state) {
  const story = state.story;
  const goal = (id, title, detail, extra = {}) => ({ id, title, detail, who: null, room: null, count: null, ...extra });
  if (story.ines === 0) return goal('meet', 'Find Ines Tock', 'She mends clocks and knows about Clutterkin. She is waiting on the green, just below home.', { who: 'ines' });
  if (placesCalm(state) > reported(state)) {
    return goal('report', 'Tell Ines Tock', `${latestCalm(state).name} is calm. She will want to know.`, { who: 'ines' });
  }
  const next = nextPlace(state);
  if (next && roomBuilt(next)) {
    if (next === FIRST && state.stats.befriended === 0) {
      return goal('friend', 'Make a friend in the garden', 'Walk in through the garden gate. In a fight, Reach out to one you like instead of hitting it, and win.', { room: next.id });
    }
    const stops = next.path.length;
    const about = CALMING[next.id] || { title: `Calm ${next.name}`, detail: 'Calm everyone else there and its ringleader will face you. Rest at home whenever you need to.' };
    return goal('calm', about.title, about.detail, { room: next.id, count: [Math.min(stops, state.rooms[next.id].best), stops] });
  }
  return goal('more', next ? `${next.name} is next` : 'The lane is quiet',
    next ? 'It is not built yet: this is as far as the slice goes. The places you have calmed are restless again whenever you have rested, with more friends to make, and Heirlooms come out more often where it is calm.' : 'Every place on the lane is calm. Mr. Spick has nothing to collect.',
    { count: [placesCalm(state), ROOMS.length] });
}

/** The one line that is the point of the whole game, with how far along it is. */
export function aimOf(state) {
  return { title: 'Calm all eight places before Monday', count: [placesCalm(state), ROOMS.length] };
}

/** What has happened so far, oldest first, as short plain sentences: the journal. */
export function storySoFar(state) {
  const story = state.story;
  const told = [];
  if (story.call) told.push('Great-aunt Maribel rang. The house and the whole lane are awake, and a clearance van comes on Monday for anything that will not sit still.');
  if (story.ines > 0) told.push('Ines Tock showed you how it is done: stand up for yourself if you must, Reach out if you can.');
  if (story.spick > 0) told.push('Mr. Spick is counting. Whatever is quiet by Monday is furniture, and not his department.');
  if (state.stats.befriended > 0) told.push(`You have made ${state.stats.befriended === 1 ? 'a friend' : `${state.stats.befriended} friends`} of the restless ones.`);
  for (const id of ROOM_IDS) if (calm(state, id)) told.push(`${roomOf(id).name} is calm.`);
  return told;
}
