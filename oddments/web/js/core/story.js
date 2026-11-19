// The story: who the people of the lane are, what each has to say just now,
// and what you are trying to do. Rules and words only: no drawing, no clock.
//
// What has happened is worked out from the save itself wherever it can be (a
// place is calm because its boss was calmed, not because a flag says so). The
// story keeps only what nothing else records: which conversations were had.
import { ROOMS, ROOM_IDS, RIVAL, roomBuilt } from './balance.js';
import { calmedIn } from './rooms.js';
import { toldOf } from './names.js';
import { rivalSoFar } from './rival.js';
import { chiefsSoFar } from './wishes.js';
import { inSample, sampleWords } from './sample.js';

export const CAST = {
  maribel: { name: 'Great-aunt Maribel', role: 'on the phone', art: 'cast_maribel' },
  ines: { name: 'Ines Tock', role: 'clock-mender', art: 'cast_ines' },
  dov: { name: 'Dov', role: 'bottle-cap collector', art: 'cast_dov' },
  spick: { name: 'Mr. Spick', role: 'Spick & Span Clearances', art: 'cast_spick' },
  tansy: { name: 'Tansy Brisk', role: 'junior clearance officer', art: 'cast_tansy' },
};
export const CAST_IDS = Object.keys(CAST);
/** Whoever stands in the lane to be talked to. (Great-aunt Maribel is away, and rings.) */
export const NEIGHBOURS = ['ines', 'dov', 'spick'];

/**
 * What the story remembers: whether each of the two calls was taken, how often each neighbour has been
 * heard out, and how many of her meetings Tansy Brisk has lost (see rival.js).
 */
export const newStory = () => ({ call: false, call2: false, call3: false, ines: 0, dov: 0, spick: 0, rival: 0, heard: 0 });
const MOST = 99;

/** A story from a save, made safe: every part a whole number in range, whatever was stored. */
export function reviveStory(raw) {
  const story = newStory();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return story;
  story.call = raw.call === true;
  story.call2 = raw.call2 === true;
  story.call3 = raw.call3 === true;
  for (const who of NEIGHBOURS) {
    const told = raw[who];
    if (typeof told === 'number' && Number.isFinite(told)) story[who] = Math.min(MOST, Math.max(0, Math.floor(told)));
  }
  // (How many she can have lost depends on which places are calm: whoever reads the rest of the save holds it to that.)
  if (Number.isInteger(raw.rival)) story.rival = Math.min(RIVAL.meetings.length, Math.max(0, raw.rival));
  // How many of those she has had her say about: never more than she has lost. (A save from before this was kept owes nothing.)
  story.heard = Number.isInteger(raw.heard) ? Math.min(story.rival, Math.max(0, raw.heard)) : story.rival;
  return story;
}

const FIRST = ROOMS[0];
const calm = (state, roomId) => state.rooms[roomId].clears > 0;
// Two chapters. The lane: the eight places great-aunt Maribel first rings about, to be calmed before
// Monday. And the far bank, over Kettle Bridge: four more, which she rings about when the lane is quiet.
export const LANE = ROOMS.filter((room) => room.chapter !== 2);
export const FAR = ROOMS.filter((room) => room.chapter === 2);
const calmOf = (state, rooms) => rooms.filter((room) => calm(state, room.id)).length;
/** How many places are calm, on both banks. */
export const placesCalm = (state) => ROOM_IDS.filter((id) => calm(state, id)).length;
/** Whether the whole lane is quiet: all eight. That is the first chapter done. */
export const laneQuiet = (state) => calmOf(state, LANE) === LANE.length;
/** Which chapter the story is in: 2 once the second call has been taken. */
export const chapterOf = (state) => (state.story.call2 ? 2 : 1);
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

/** The second call: the lane is quiet, Ines Tock has been told, and there is a far bank. */
export const CALL2 = [
  line('maribel', 'Hello, dear! Me again. Ines has told me everything. All eight, and Mr. Spick with nothing to put in his van! I laughed so hard I dropped the telephone in the sea. This is another one.'),
  line('maribel', 'Now. I have had a postcard from the far bank, over Kettle Bridge. It is the same story there: the Glasshouse, the old bath house, the Tinker\'s Shed, the Mending Room. All wide awake.'),
  line('maribel', 'The gate on the bridge has eight locks. And you, dear, are holding eight keys. I did wonder what they were for.'),
  line('maribel', 'The bridge is south of Chimney Hill. Start with the Glasshouse. And take your friends: some of them will be big enough by now to surprise you. Must dash, the boat is leaving. It is always leaving.'),
];

/**
 * The third call, and the end of the story as it stands: both banks are quiet, Ines Tock has been
 * told, and great-aunt Maribel is on her way home. (Until this there was no ending: calming the last
 * place finished on a line of text.)
 */
export const CALL3 = [
  line('maribel', 'Hello, dear! It is me, and I am on the boat. Properly on it, this time. It has left. I checked twice.'),
  line('maribel', 'Ines says both banks are quiet. Twelve places! I only asked you to water the plants. I did ask you to water the plants?'),
  line('maribel', 'And Mr. Spick took his van back empty. He has put it in writing. He wants to know if he may keep a quiet one on his desk.'),
  line('maribel', 'Keep the keys, dear. All twelve. Anybody trusted by a toaster, a bath and a book with teeth is a house-sitter for life.'),
  line('maribel', 'Put the kettle on for when I get in. And tell them all I said goodnight. Even the vacuum.'),
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
    glasshouse: 'The Glasshouse, quiet? I had a letter from over the water this morning, and for once it was not damp. That marrow has been steaming the place up since the flower show.',
    deepend: 'They have turned the taps off at the Deep End. You can hear the river again instead. Old Clawfoot ran itself a bath in 1962 and never did get in it.',
    shed: 'No hammering from the Tinker\'s Shed? Then the Captain has stopped at last. That mower was borrowed from Maribel. Do not tell her where it has been.',
    mending: 'The Mending Room has stopped stitching. Madam Treadle sewed my mother\'s wedding dress, and half the curtains on this lane. She only ever wanted something to mend.',
  },
  // How to get to each place and what to take: said when the place before it has been calmed.
  toward: {
    alley: [
      'Tin Can Alley is next: east along the street to its end, and in at the foot of it. The bins had it barricaded all week. Word of a calm garden travels, and they have let it down.',
      'It is a narrow place. They come at you one after another, and Baron Pilfer holds court at the far end. Most of them are Clank, and Crumb jams Clank: take your Crumbwisp.',
    ],
    pantry: [
      'The Midnight Pantry is next: north of here, up the lane and left at the fork, the shop with the striped awning. That one you walk into, by its front door.',
      'Everything in there is past its date, and most of it is Crumb, with the Crumbwyrm at the back: a toaster that kept every crumb it was ever given. Suds wash away Crumb. Take your Eelastic.',
    ],
    wash: [
      'The Wash is next, and it is not on this lane. South from the green, down Bramble Way, as far as Lampwick Row: the launderette is on your right as you come in. There is a bench on the Row, if anyone needs to sit down.',
      'Suds, most of them, and Fluff mops up Suds: take your Hopmote. The Spin Cycle is the machine at the far end. It stopped giving socks back in March.',
    ],
    stacks: [
      'The Dusty Stacks is next: the old library, on Lampwick Row, east of the launderette.',
      'Paper and dust, so nearly all Fluff, and Spark singes Fluff: take a Strayglow or an Embernip if you have made a friend of one. The Overdue Tome is in the locked case.',
    ],
    rooftops: [
      'Moonlit Rooftops is next, and further still: east to the end of Lampwick Row, then south across Long Meadow to Chimney Hill. It is the tall thin house. In at the door, up the stairs, and out onto the slates.',
      'Stone and copper up there: Clank. Crumb jams Clank. And mind the Night Warden. It has watched that roof for two hundred years.',
    ],
    attic: [
      'The Tick-Tock Attic is next: the other tall house on Chimney Hill, toward the west end of the street, right up under the roof.',
      'Clockwork, mostly: Clank again, so Crumb again. Grandfather Golem keeps the far end. I have been meaning to mend him for thirty years.',
    ],
    dark: [
      'Only the Roaring Dark is left: the far shed, at the bottom of Dark Lane, past the west end of Chimney Hill. It is the cupboard under somebody\'s stairs, and something in it is plugged in.',
      'Spark, most of it, and Sprout grounds Spark: take a Wishclock or a Pricklebud. It is dark in there; you will see as far as your lantern. What roars is THE VACUUM, and it is Mr. Spick\'s.',
    ],
    glasshouse: [
      'The Glasshouse is first: over Kettle Bridge, south of Chimney Hill, then west along the street on Far Bank. You cannot miss it. It is the one made of windows.',
      'Green things in there: Sprout, most of them, and Clank mows Sprout. The Prize Marrow sits on the show bench at the far end. First prize, 1987, and it never stopped growing.',
    ],
    deepend: [
      'The Deep End is next: the old bath house, with the blue dome, at the east end of the street on Far Bank.',
      'Suds, most of them, and Fluff mops up Suds. Old Clawfoot is the bath itself, up on its four iron feet at the far end. And mind the floor. It is wet.',
    ],
    shed: [
      'The Tinker\'s Shed is next, and it is a walk: south from Far Bank by either road, as far as Bobbin Row. The big red shed at the east end. There is a bench on the Row.',
      'Tools, so Clank, and Crumb jams Clank. Captain Twostroke is the mower in the bay at the back. Nobody has ever found his off switch.',
    ],
    mending: [
      'Only the Mending Room is left: the lilac shop at the west end of Bobbin Row, with the cotton reel over the door.',
      'Thread and cloth: Fluff, nearly all of it, and Spark singes Fluff. Madam Treadle is the machine at the far end. She will stitch anything that stands still. So do not.',
    ],
  },
  // When the next place is not there to go to, and when there is no next place.
  again: 'So walk the places you have calmed again. A calm place stays calm, but a few are always wandering about in it, and there are kinds you have not met.',
  done: [
    'Mr. Spick will have nothing to put in his van on Monday but his own vacuum cleaner. I should like to see his face.',
    'Maribel will be so pleased. Go home, dear, and put the kettle on. Your friends will want to hear all about it.',
  ],
  // And when the far bank is quiet too.
  done2: [
    'Both banks, quiet. I can hear the river from my own doorstep, and I have not heard that in years.',
    'There is more of the world beyond Bobbin Row, and I dare say it is awake too. But not tonight. Tonight you put the kettle on.',
  ],
  heard: (place) => `${place} is calm. Good. That is one more off Mr. Spick's list.`,
  later: (state) => (placesCalm(state) >= ROOMS.length ? 'Both banks calm. I keep going to the door to listen, and there is nothing to hear but the river. Lovely.'
    : laneQuiet(state) ? (state.story.call2 ? `All eight calm on the lane, and ${calmOf(state, FAR)} of ${FAR.length} over the water. Mind the bridge in the dark.` : 'All eight calm. I keep going to the door to listen, and there is nothing to hear. Lovely. Is that your telephone?')
      : `${calmOf(state, LANE)} of ${LANE.length} calm, and Monday coming. We will get there.`),
};

const DOV = {
  first: [
    'Psst. You are the new house-sitter! I am Dov. I collect bottle caps. I have got four hundred and six.',
    'Want a tip? Everything in there has a soft spot. It goes easier on things it is not scared of. Bring one of those along and Reaching out works better.',
    'And look at who is waiting before you walk up. If one of them is glinting gold, that is an Heirloom. Those are rare. I have only ever seen two.',
  ],
  tips: [
    'Tap one of them in a fight and it tells you its soft spot. Nobody ever taps them. I tap everything.',
    'See the strays out on the lane? They are lost. You can walk up to one, or walk past. I walk up. It is good practice. Two together teach you more than one on its own.',
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
    'There is a bench on Lampwick Row and another on Chimney Hill. Sit down and everyone gets their breath back. I timed it. It is the same as going home.',
    'You do not have to walk all the way back to tell Ines things. Post her a note. There is a mailbox by every house out there. She writes back before you have let go of the flap.',
    'There is a new one from Spick and Span, with boxes on her back. She called my bottle caps "unattended". You do not have to stop for her. I would, though. I want to see her lose.',
  ],
};

const SPICK = {
  first: [
    'Spick. Spick and Span Clearances. Do not mind me, I am counting.',
    'Eight premises on this lane with unattended moving property. Clutter, in plain words. Monday morning the van comes, and whatever is still rattling about goes in it.',
    'If it is sitting quietly, it is furniture, and furniture is not my department. Makes no odds to me either way.',
  ],
  later: (state) => {
    const quiet = calmOf(state, LANE);
    const left = LANE.length - quiet;
    if (quiet === 0) return `None quiet. ${LANE.length} for the van, as it stands.`;
    if (left === 0 && placesCalm(state) >= ROOMS.length) return 'Both banks quiet, they tell me. I have never had so little to do. I find I do not mind.';
    if (left === 0 && state.story.call2) return 'Far Bank? Not on my sheet. Different council. I should not go telling them, if I were you. That was a joke. I do not make many.';
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
  if (!next) return [first, ...(FAR.length ? INES.done2 : INES.done)];
  // The last of the lane: that is the first chapter, and great-aunt Maribel rings about the second.
  if (place.chapter !== 2 && next.chapter === 2) return [first, ...INES.done];
  const far = calmOf(state, FAR);
  const count = place.chapter === 2 ? `${COUNT[far] || far} of the four over the water.`
    : `${COUNT[placesCalm(state)] || placesCalm(state)} place${placesCalm(state) === 1 ? '' : 's'} of eight.`;
  // In the free sample, the place after its last is not one she can send you to.
  if (!inSample(next.id)) return [first, `${count} ${next.name} is next, and that is a longer story than tonight's.`, INES.again];
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
    // (Nowhere to send you: everything is calm, or the next place is not built, or it is over the water and great-aunt Maribel has not rung about that yet.)
    if (!next || !roomBuilt(next) || (next.chapter === 2 && !story.call2)) return say([INES.later(state)]);
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

/**
 * Whether the telephone is ringing: the first call, as soon as the game begins; the second, once the
 * whole lane is quiet and Ines Tock has heard so; the third, once both banks are and she has heard that.
 */
export function callDue(state) {
  return !state.story.call || secondCallDue(state) || thirdCallDue(state);
}
/** Whether it is the second call that is due: the one about the far bank. */
function secondCallDue(state) {
  return FAR.length > 0 && !state.story.call2 && laneQuiet(state) && reported(state) >= LANE.length;
}

/** Whether both banks are quiet: every place there is. */
export const bothQuiet = (state) => placesCalm(state) === ROOMS.length;
/** Whether it is the third call that is due: the one that ends the story. */
function thirdCallDue(state) {
  return state.story.call2 && !state.story.call3 && bothQuiet(state) && reported(state) >= ROOMS.length;
}
/** Whether the story has been told to its end: the third call is taken. */
export const storyEnded = (state) => state.story.call3 === true;

/** Takes the call that is due. Returns its lines, and null when no call is. */
export function takeCall(state) {
  if (!callDue(state)) return null;
  if (!state.story.call) { state.story.call = true; return CALL; }
  if (secondCallDue(state)) { state.story.call2 = true; return CALL2; }
  state.story.call3 = true;
  return CALL3;
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
    grew: 'It came out from under the spare bed this morning and did not fit back. The antlers are coat hangers from the wardrobe. It keeps catching them on door frames and pretending it meant to.',
  },
  {
    kind: 'sockeel', what: 'an odd sock', place: 'wash',
    about: 'Eelastic went into the wash as one of a pair and came out alone. That was years ago. It still looks behind every door on the lane, in case. It is the steady one: it takes a knock, wrings itself out and carries on.',
    knack: 'Steady. It has the most Health of the three, and no weak side.',
    after: 'Behind Machine Six there is a sock. One sock, blue stripes, a little shrunk. Eelastic looks at it for a long time. Then it stops looking behind doors.',
    grew: 'It used to fit in one drawer. Now it loops twice round the banister and still has enough of itself left over to hold the door open for you.',
  },
  {
    kind: 'toastghost', what: 'a slice of burnt toast', place: 'pantry',
    about: 'Somebody put Crumbwisp in the toaster one morning and never came back for it. Great-aunt Maribel did, in the end. It has never quite forgiven the toaster, and it will give its last crumb to anyone who is hurt.',
    knack: 'Slow and tough. Before long it learns to mend its friends.',
    after: 'Crumbwisp floats over to the toaster and looks in. Nobody is in there now. It comes back and settles on your shoulder, warm as ever.',
    grew: 'Somebody forgot it in the toaster once. Nobody could forget it now: it fills the kitchen doorway, and the butter has stopped sliding off.',
  },
];
export const THREE_WORDS = {
  open: 'Great-aunt Maribel\'s three are waiting in the hall. They have lived in this house longer than you have been alive, and between them they have decided to keep an eye on you.',
  again: 'A word about the three who set out with you. They have lived in great-aunt Maribel\'s house longer than you have been alive, and between them they decided to keep an eye on you.',
  close: 'From tonight they are your companions, and they would like to be your friends. They walk with you because Maribel asked them to, and because nobody else will stand up for things like them before Monday. Look after them. They mean to look after you.',
};
/** The story of one of the three, by its kind: { what, about, knack }, or null for anyone else. */
export const aboutOf = (kind) => THREE.find((one) => one.kind === kind) || null;
/**
 * What is said when a friend grows up: for one of the three, a few words of its own; for anyone,
 * null (the screen has plain words for that).
 */
export const grewWords = (kind) => { const one = aboutOf(kind); return one && one.grew ? one.grew : null; };
/** What is put right for one of the three when a place is calmed: { kind, text }, or null. */
export function putRight(state, roomId) {
  const one = THREE.find((each) => each.place === roomId && state.friends.some((friend) => friend.species === each.kind));
  return one ? { kind: one.kind, text: toldOf(state, one.kind, one.after) } : null;
}

// ---------------------------------------------------------------- the keys

// A key for each place. Its ringleader hands it over when the place is calm, and it is yours to
// keep: a house-sitter is somebody trusted with the keys. Nothing is spent to get one and nothing
// needs one; they are what you have to show for a place, and there is one more hook on the ring
// for each place still to calm. You hold a place's key for exactly as long as the place is calm,
// which is for good, so the save keeps nothing more for them.
export const KEYS = {
  garden: { name: 'The Gate Key', line: 'Green iron, with a leaf for a handle. Old Summerlong kept it safe in the long grass all summer.' },
  alley: { name: 'The Tin Key', line: 'Cut from a can, with a bottle cap for a handle. Baron Pilfer wore it on a string, and takes it off himself.' },
  pantry: { name: 'The Pantry Key', line: 'Copper, with a slice of toast for a handle. The Crumbwyrm had been asleep on it.' },
  wash: { name: 'The Wash Key', line: 'Blue enamel, with a ring of bubbles for a handle. The Spin Cycle lets it out with the last rinse.' },
  stacks: { name: 'The Stacks Key', line: 'Old brass, with an open book for a handle. It was keeping a place in the Overdue Tome.' },
  rooftops: { name: 'The Rooftop Key', line: 'Silver, with a moon for a handle. The Night Warden has turned it in the same lock every night for years.' },
  attic: { name: 'The Attic Key', line: 'A clock key, with a gear set in it. It is what Grandfather Golem is wound with, and he lets you hold it.' },
  dark: { name: 'The Dark Key', line: 'Black iron, with one small red light. THE VACUUM swallowed it years ago, and gives it back.' },
  glasshouse: { name: 'The Glass Key', line: 'Green glass in a white frame, with a marrow flower growing through it. The Prize Marrow wore it under its rosette.' },
  deepend: { name: 'The Bath Key', line: 'White china and brass, with a tap for a handle. Old Clawfoot pulls it up on the end of the plug chain.' },
  shed: { name: 'The Shed Key', line: 'Grey steel, with a cog for a handle and a brown tag. Captain Twostroke kept it in his grass box.' },
  mending: { name: 'The Thimble Key', line: 'Rose gold, with scissor loops for a handle. Madam Treadle had sewn it into a hem, and unpicks it for you.' },
};
/** The whole ring, in the order of the places: [{ room, place, name, line, held }]. */
export const keysOf = (state) => ROOMS.map((room) => ({ room: room.id, place: room.name, chapter: room.chapter || 1, ...KEYS[room.id], held: calm(state, room.id) }));
/** The key a place gives: { room, name, line }. */
export const keyOf = (roomId) => (KEYS[roomId] ? { room: roomId, ...KEYS[roomId] } : null);

// ---------------------------------------------------------------- the Keepsakes

// One to a chapter: a creature there is only one of, found at a spot of its own once the chapter's
// places are all calm. Fluff shows the way: a small dust bunny with a red bow, who got out of THE
// VACUUM. (Fluff is the dust bunny who guides the cat in Pawst Lives; here it guides you.)
export const FLUFF = { name: 'Fluff', art: 'npc_fluff' };
const SEEK = {
  1: 'A small dust bunny with a red bow has been following you: Fluff, who got out of THE VACUUM. It keeps hopping off toward the old orchard, north of home and right at the fork. Something up there is playing a lullaby.',
  2: 'Fluff, the dust bunny with the red bow, is down on the far bank of the river, west of Kettle Bridge, looking at the water. Something is out on it.',
};
const SEEK_AGAIN = {
  1: 'Fluff is up at the old orchard again, and the lullaby sounds different tonight: brighter. Somebody has come out in their best colours.',
  2: 'Fluff is down on the far bank again, west of the bridge. The water is glinting gold.',
};
/**
 * Something else worth doing just now, beside the goal: a Keepsake is out. `out` is the one that is
 * (see strays.keepsakeOut), `met` whether you have met its kind before. Returns { title, detail, keep }, or null.
 */
export function asideOf(out, met) {
  if (!out) return null;
  return { title: met ? 'A Keepsake is out again' : 'Follow Fluff', detail: (met ? SEEK_AGAIN : SEEK)[out.keep] || '', keep: out.keep };
}

// ---------------------------------------------------------------- tonight

/**
 * What is different today: the calm place that is lively. `room` is that place (see rooms.livelyPlace).
 * Returns { title, detail, room }, or null if nowhere is.
 */
export function tonightOf(room) {
  if (!room) return null;
  return {
    title: `${room.name} is lively tonight`,
    detail: 'More of them are out wandering there than usual, and far more of them in their rare colours. Tomorrow it will be somewhere else.',
    room: room.id,
  };
}

// ---------------------------------------------------------------- what you are trying to do

// How the goal of calming each place is put. (A place not listed here gets a plain line.)
const CALMING = {
  garden: { title: 'Calm the garden', detail: 'Calm everyone else there and Old Summerlong, the sprinkler, will face you. Rest at home whenever you need to: whoever you have calmed stays calm.' },
  alley: { title: 'Calm Tin Can Alley', detail: 'East along the street, to its end. A narrow place: they come one after another, and Baron Pilfer is at the far end. Crumb jams Clank.' },
  pantry: { title: 'Calm the Midnight Pantry', detail: 'North of home, left at the fork: go in by its front door. Calm everyone on the floor and the Crumbwyrm will face you. Suds wash away Crumb.' },
  wash: { title: 'Calm the Wash', detail: 'The launderette on Lampwick Row: south from the green, down Bramble Way. In by its front door. Mostly Suds, and Fluff mops up Suds. The Spin Cycle is the machine at the far end.' },
  stacks: { title: 'Calm the Dusty Stacks', detail: 'The old library on Lampwick Row, east of the launderette. Nearly all Fluff, and Spark singes Fluff. The Overdue Tome is in the locked case.' },
  rooftops: { title: 'Calm Moonlit Rooftops', detail: 'The tall thin house on Chimney Hill: east along Lampwick Row, then south across Long Meadow. In, and up onto the slates. Clank up there, and Crumb jams Clank. Mind the Night Warden.' },
  attic: { title: 'Calm the Tick-Tock Attic', detail: 'The other tall house on Chimney Hill, toward the west end of its street. Clockwork: Crumb jams Clank. Grandfather Golem keeps the far end.' },
  dark: { title: 'Calm the Roaring Dark', detail: 'The far shed, down Dark Lane from the west end of Chimney Hill. Mostly Spark, and Sprout grounds Spark. You see as far as your lantern. THE VACUUM is in there.' },
  glasshouse: { title: 'Calm the Glasshouse', detail: 'Over Kettle Bridge, south of Chimney Hill: your eight keys open its gate. Then west along the street on Far Bank. Mostly Sprout, and Clank mows Sprout. The Prize Marrow is on the show bench.' },
  deepend: { title: 'Calm the Deep End', detail: 'The old bath house with the blue dome, at the east end of the street on Far Bank. Mostly Suds, and Fluff mops up Suds. Old Clawfoot is the bath at the far end.' },
  shed: { title: 'Calm the Tinker\'s Shed', detail: 'The big red shed at the east end of Bobbin Row: south from Far Bank by either road. Clank, and Crumb jams Clank. Captain Twostroke is the mower at the back.' },
  mending: { title: 'Calm the Mending Room', detail: 'The lilac shop at the west end of Bobbin Row. Nearly all Fluff, and Spark singes Fluff. Madam Treadle is the sewing machine at the far end.' },
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
    return goal('report', 'Tell Ines Tock', `${latestCalm(state).name} is calm. She will want to know. She is on the green below home; or post her a note from any mailbox, and she answers by return.`, { who: 'ines' });
  }
  const next = nextPlace(state);
  // The lane is quiet and Ines Tock knows: the telephone rings, and that call is the way on.
  if (secondCallDue(state)) return goal('call', 'Answer the telephone', 'It is ringing in the house: you can hear it from the green. That will be great-aunt Maribel again.');
  // Both banks quiet and Ines Tock knows: it rings once more.
  if (thirdCallDue(state)) return goal('call', 'Answer the telephone', 'It is ringing in the house again. That will be great-aunt Maribel, to hear how it all came out.');
  // The free sample ends where the last place it holds does (see sample.js).
  if (next && !inSample(next.id)) { const words = sampleWords().goal; return goal('sample', words.title, words.detail); }
  if (next && roomBuilt(next)) {
    if (next === FIRST && state.stats.befriended === 0) {
      return goal('friend', 'Make a friend in the garden', 'Walk in through the garden gate. In a fight, Reach out to one you like instead of hitting it, and win.', { room: next.id });
    }
    const stops = next.path.length;
    const about = CALMING[next.id] || { title: `Calm ${next.name}`, detail: 'Calm everyone else there and its ringleader will face you. Rest at home whenever you need to: whoever you have calmed stays calm.' };
    return goal('calm', about.title, about.detail, { room: next.id, count: [calmedIn(state, next.id), stops] });
  }
  return goal('more', next ? `${next.name} is next` : FAR.length ? 'Both banks are quiet' : 'The lane is quiet',
    next ? 'It is not built yet: this is as far as the slice goes. The places you have calmed stay calm, with a few always wandering about in them: more friends to make, and Heirlooms come out more often among them.'
      : FAR.length ? 'Every place on the lane and over the water is calm. There is more of the world beyond Bobbin Row, and it is on its way. Until then, a few are always wandering about in the calm places: friends still to make, and Heirlooms to find.'
        : 'Every place on the lane is calm. Mr. Spick has nothing to collect.',
    { count: [placesCalm(state), ROOMS.length] });
}

/** The one line that is the point of the whole game, with how far along it is. */
export function aimOf(state) {
  if (chapterOf(state) === 2) return { title: 'Calm the four places over the water', count: [calmOf(state, FAR), FAR.length] };
  return { title: 'Calm all eight places before Monday', count: [calmOf(state, LANE), LANE.length] };
}

/** What has happened so far, oldest first, as short plain sentences: the journal. */
export function storySoFar(state) {
  const story = state.story;
  const told = [];
  if (story.call) told.push('Great-aunt Maribel rang. The house and the whole lane are awake, and a clearance van comes on Monday for anything that will not sit still.');
  if (story.ines > 0) told.push('Ines Tock showed you how it is done: stand up for yourself if you must, Reach out if you can.');
  if (story.spick > 0) told.push('Mr. Spick is counting. Whatever is quiet by Monday is furniture, and not his department.');
  if (state.stats.befriended > 0) told.push(`You have made ${state.stats.befriended === 1 ? 'a friend' : `${state.stats.befriended} friends`} of the restless ones.`);
  for (const room of LANE) if (calm(state, room.id)) told.push(`${room.name} is calm.`);
  if (story.call2) told.push('Great-aunt Maribel rang again: the far bank is awake too. Your eight keys opened the gate on Kettle Bridge.');
  for (const room of FAR) if (calm(state, room.id)) told.push(`${room.name} is calm.`);
  if (story.call3) told.push('Great-aunt Maribel rang a third time, from the boat home. Both banks are quiet, and the keys are yours to keep.');
  told.push(...rivalSoFar(state));
  told.push(...chiefsSoFar(state));
  return told;
}
