// The story: who the people of the lane are, what each has to say just now,
// and what you are trying to do. Rules and words only: no drawing, no clock.
//
// What has happened is worked out from the save itself wherever it can be (a
// place is calm because its boss was calmed, not because a flag says so). The
// story keeps only what nothing else records: which conversations were had.
import { ROOMS, ROOM_IDS, roomOf, roomBuilt } from './balance.js';
import { calmedIn } from './rooms.js';

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
  sendOff: (place) => `Start with ${place}: up the lane, north and west of here. When your friends are worn out, come home and rest: whoever you have calmed stays calm. Off you go.`,
  already: 'And the garden is calm already? Maribel said you were quick.',
  nudge: (place) => `${place} first. Everyone else, then the ringleader. And rest when you need to: there is no prize for limping.`,
  reach: 'And do try Reaching out. A friend made is worth more than a fight won.',
  // Her first word on hearing that each place is calm.
  calmed: {
    garden: 'The garden has gone quiet. I could hear it from here: that sprinkler has been hissing since Tuesday.',
    alley: 'Tin Can Alley, quiet. I never thought I would hear the day. The Baron has held court in there since the bin men changed their round.',
    pantry: 'The pantry, quiet? I thought I could smell toast. That thing has been popping all night for a fortnight.',
    wash: 'The Wash has stopped thumping. Do you know, I had stopped hearing it. Now I can hear that it has stopped.',
    stacks: 'Not a page turning in the Dusty Stacks? Then somebody has finally paid that fine.',
    rooftops: 'I saw the weathervane swing round and settle. So the roofs are quiet. It has not pointed true since the storm.',
    attic: 'Every clock in that attic struck at once, and then held its tongue. I mend clocks. I know a calm one when I hear it.',
    dark: 'The cupboard under the stairs has stopped roaring. Then that is all of them. All eight, and Monday not here yet.',
  },
  // How to get to each place and what to take: said when the place before it has been calmed.
  toward: {
    alley: [
      'Tin Can Alley is next: east along the street, past the launderette, and in at the foot of it. The bins had it barricaded all week. Word of a calm garden travels, and they have let it down.',
      'It is a narrow place. They come at you one after another, and Baron Pilfer holds court at the far end. Most of them are Clank, and Crumb jams Clank: take your Crumbwisp.',
    ],
    pantry: [
      'The Midnight Pantry is next: north of here, up the lane and left at the fork, the shop with the striped awning. That one you walk into, by its front door.',
      'Everything in there is past its date, and most of it is Crumb, with the Crumbwyrm at the back: a toaster that kept every crumb it was ever given. Suds wash away Crumb. Take your Eelastic.',
    ],
    wash: [
      'The Wash is next: the launderette, east along the street. In by its front door, like the pantry.',
      'Suds, most of them, and Fluff mops up Suds: take your Hopmote. The Spin Cycle is the machine at the far end. It stopped giving socks back in March.',
    ],
    stacks: [
      'The Dusty Stacks is next: the old library, down the lane and east along the bottom street.',
      'Paper and dust, so nearly all Fluff, and Spark singes Fluff: take a Strayglow or an Embernip if you have made a friend of one. The Overdue Tome is in the locked case.',
    ],
    rooftops: [
      'Moonlit Rooftops is next: the tall thin house on the bottom street, straight down from the green. In at the door, up the stairs, and out onto the slates.',
      'Stone and copper up there: Clank. Crumb jams Clank. And mind the Night Warden. It has watched that roof for two hundred years.',
    ],
    attic: [
      'The Tick-Tock Attic is next: the tall house at the west end of the bottom street, right up under the roof.',
      'Clockwork, mostly: Clank again, so Crumb again. Grandfather Golem keeps the far end. I have been meaning to mend him for thirty years.',
    ],
    dark: [
      'Only the Roaring Dark is left: the far shed, north past the fork and round to the east. It is the cupboard under somebody\'s stairs, and something in it is plugged in.',
      'Spark, most of it, and Sprout grounds Spark: take a Wishclock or a Pricklebud. It is dark in there; you will see as far as your lantern. What roars is THE VACUUM, and it is Mr. Spick\'s.',
    ],
  },
  // When the next place is not there to go to, and when there is no next place.
  again: 'So walk the places you have calmed again. A calm place stays calm, but a few are always wandering about in it, and there are kinds you have not met.',
  done: [
    'Mr. Spick will have nothing to put in his van on Monday but his own vacuum cleaner. I should like to see his face.',
    'Maribel will be so pleased. Go home, dear, and put the kettle on. Your friends will want to hear all about it.',
  ],
  heard: (place) => `${place} is calm. Good. That is one more off Mr. Spick's list.`,
  later: (state) => (placesCalm(state) >= ROOMS.length ? 'All eight calm. I keep going to the door to listen, and there is nothing to hear. Lovely.'
    : `${placesCalm(state)} of ${ROOMS.length} calm, and Monday coming. We will get there.`),
};

const DOV = {
  first: [
    'Psst. You are the new house-sitter! I am Dov. I collect bottle caps. I have got four hundred and six.',
    'Want a tip? Everything in there has a soft spot. It goes easier on things it is not scared of. Bring one of those along and Reaching out works better.',
    'And look at who is waiting before you walk up. If one of them is glinting gold, that is an Heirloom. Those are rare. I have only ever seen two.',
  ],
  tips: [
    'Tap one of them in a fight and it tells you its soft spot. Nobody ever taps them. I tap everything.',
    'See the strays out on the lane? They are lost. You can walk up to one, or walk past. I walk up. It is good practice.',
    'Down the alley they come one at a time. There is no going round. I tried. I got pecked.',
    'Crumb jams Clank. Take your Crumbwisp down Tin Can Alley and watch the tins dent.',
    'Want an Heirloom? Go back where it is calm. They feel safe there and bring out their best colours. I saw three in the garden in one week. Three!',
    'If you hit the one you are making friends with, it gets in a Huff again. So pick one, and hit the others.',
    'My nan says Old Summerlong was never turned off. Imagine being left on all summer. I would be cross too.',
    'You can go indoors, you know. Tap a front door. Yours has a bed in it, and a telephone, and whoever you left at home.',
    'In the pantry they are spread about the floor, not in a line. You can go round them, if you keep wide.',
    'The gargoyles up on the roofs are really water spouts. Fluff mops up Suds. I am just saying.',
    'My cousin went in the cupboard under the stairs once. He said you cannot see past your own lantern. He came out very clean.',
    'You can only have one of each kind. If you calm a kind you have already got, it goes off happy and yours learns from it.',
    'Strays get everyone out of puff, same as anywhere. Go home and rest, and there will be different ones out when you set off again.',
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
    if (left === 0) return 'Eight quiet. Nothing for the van. I shall have to put that in writing.';
    return `${quiet} quiet. ${left} for the van, as it stands. I check twice, mind.`;
  },
};

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
/**
 * What Ines Tock says on hearing that a place is calm: her word on it, then how many that makes
 * and where to go next; or, if the next place is not there to go to, to walk the calm ones again;
 * or, if there is no next place, that it is done.
 */
function inesHears(state, place) {
  const first = INES.calmed[place.id] || INES.heard(place.name);
  const next = nextPlace(state);
  if (!next) return [first, ...INES.done];
  const count = `${COUNT[placesCalm(state)] || placesCalm(state)} place${placesCalm(state) === 1 ? '' : 's'} of eight.`;
  if (!roomBuilt(next) || !INES.toward[next.id]) return [first, `${count} ${next.name} is next, and that I cannot get you into yet: this is as far as the lane is built.`, INES.again];
  const [way, ...more] = INES.toward[next.id];
  return [first, `${count} ${way}`, ...more];
}

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
      return say(inesHears(state, place));
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

// ---------------------------------------------------------------- the three you set out with
//
// Great-aunt Maribel's own: the three who walk with you from the first night. The game is about
// things that were left, lost or forgotten, and each of these was. So each has its story, told
// once at the start (`about`), a word on what it is like in a fight (`knack`), and one place on
// the lane where that story began. When that place is calm, something is put right (`after`).
// (The owner asked for this: "explain a little more about your starting companions. Need to build
// some type of emotional attachment to the game.")
export const THREE = [
  {
    kind: 'dustbunny', what: 'the dust under the bed', place: 'dark',
    about: 'Hopmote has lived under the spare bed for as long as anyone remembers, minding whatever rolls under there: buttons, a marble, one earring. It is shy of nearly everything and frightened of exactly one thing: a roaring it hears some nights, from somewhere down the lane. Last night it slept on your feet.',
    knack: 'Quick, and it hits hardest of the three. It does not take a knock well.',
    after: 'THE VACUUM is quiet. Hopmote walks right up to it, all on its own, and sneezes on it. Nothing happens. It sneezes again, to be sure.',
  },
  {
    kind: 'sockeel', what: 'an odd sock', place: 'wash',
    about: 'Eelastic went into the wash as one of a pair and came out alone. That was years ago. It still looks behind every door on the lane, in case. It is the steady one: it takes a knock, wrings itself out and carries on.',
    knack: 'Steady. It has the most Health of the three, and no weak side.',
    after: 'Behind Machine Six there is a sock. One sock, blue stripes, a little shrunk. Eelastic looks at it for a long time. Then it stops looking behind doors.',
  },
  {
    kind: 'toastghost', what: 'a slice of burnt toast', place: 'pantry',
    about: 'Somebody put Crumbwisp in the toaster one morning and never came back for it. Great-aunt Maribel did, in the end. It has never quite forgiven the toaster, and it will give its last crumb to anyone who is hurt.',
    knack: 'Slow and tough. Before long it learns to mend its friends.',
    after: 'Crumbwisp floats over to the toaster and looks in. Nobody is in there now. It comes back and settles on your shoulder, warm as ever.',
  },
];
export const THREE_WORDS = {
  open: 'Great-aunt Maribel\'s three are waiting in the hall. They have lived in this house longer than you have been alive, and between them they have decided to keep an eye on you.',
  again: 'A word about the three who set out with you. They have lived in great-aunt Maribel\'s house longer than you have been alive, and between them they decided to keep an eye on you.',
  close: 'They are not pets, and they are not yours. They walk with you because Maribel asked them to, and because nobody else will stand up for things like them before Monday. Look after them. They mean to look after you.',
};
/** The story of one of the three, by its kind: { what, about, knack }, or null for anyone else. */
export const aboutOf = (kind) => THREE.find((one) => one.kind === kind) || null;
/** What is put right for one of the three when a place is calmed: { kind, text }, or null. */
export function putRight(state, roomId) {
  const one = THREE.find((each) => each.place === roomId && state.friends.some((friend) => friend.species === each.kind));
  return one ? { kind: one.kind, text: one.after } : null;
}

// ---------------------------------------------------------------- what you are trying to do

// How the goal of calming each place is put. (A place not listed here gets a plain line.)
const CALMING = {
  garden: { title: 'Calm the garden', detail: 'Calm everyone else there and Old Summerlong, the sprinkler, will face you. Rest at home whenever you need to: whoever you have calmed stays calm.' },
  alley: { title: 'Calm Tin Can Alley', detail: 'East along the street, past the launderette. A narrow place: they come one after another, and Baron Pilfer is at the far end. Crumb jams Clank.' },
  pantry: { title: 'Calm the Midnight Pantry', detail: 'North of home, left at the fork: go in by its front door. Calm everyone on the floor and the Crumbwyrm will face you. Suds wash away Crumb.' },
  wash: { title: 'Calm the Wash', detail: 'The launderette, east along the street: in by its front door. Mostly Suds, and Fluff mops up Suds. The Spin Cycle is the machine at the far end.' },
  stacks: { title: 'Calm the Dusty Stacks', detail: 'The old library, east along the bottom street. Nearly all Fluff, and Spark singes Fluff. The Overdue Tome is in the locked case.' },
  rooftops: { title: 'Calm Moonlit Rooftops', detail: 'The tall thin house straight down from the green: in, and up onto the slates. Clank up there, and Crumb jams Clank. Mind the Night Warden.' },
  attic: { title: 'Calm the Tick-Tock Attic', detail: 'The tall house at the west end of the bottom street. Clockwork: Crumb jams Clank. Grandfather Golem keeps the far end.' },
  dark: { title: 'Calm the Roaring Dark', detail: 'The far shed, north past the fork and round to the east. Mostly Spark, and Sprout grounds Spark. You see as far as your lantern. THE VACUUM is in there.' },
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
    const about = CALMING[next.id] || { title: `Calm ${next.name}`, detail: 'Calm everyone else there and its ringleader will face you. Rest at home whenever you need to: whoever you have calmed stays calm.' };
    return goal('calm', about.title, about.detail, { room: next.id, count: [calmedIn(state, next.id), stops] });
  }
  return goal('more', next ? `${next.name} is next` : 'The lane is quiet',
    next ? 'It is not built yet: this is as far as the slice goes. The places you have calmed stay calm, with a few always wandering about in them: more friends to make, and Heirlooms come out more often among them.' : 'Every place on the lane is calm. Mr. Spick has nothing to collect.',
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
