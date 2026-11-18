// Wishes: how a ringleader becomes a friend. Rules and words only: no DOM, no
// clock, no storage.
//
// A ringleader is too proud to reach: in its own place, restless, it cannot be
// calmed into coming home. But once its place is calm it comes outside to take
// the air, and each of them wants something. Grant the wish, walk up, and it
// asks for one more bout, a friendly one, it alone against your three. Win,
// and it comes home with you.
//
// Each wish is something the save already shows (who your friends are, what
// has grown, which places are calm), so nothing is kept for it: a wish is
// granted exactly while its count is full, and nothing in the game can undo
// one (friends do not leave, and nobody grows down).
//
// As a friend a ringleader is one of the team: it acts once a round, like
// anyone, with a share of the Health it had when it held a whole place against
// three (balance.CHIEF). That still makes it sturdier than any ordinary kind,
// so only one walks with you at a time.
// (The owner asked for this: "while I don't think you should be able to reach
// out and tame the boss, I think they're cool and would want them on my team",
// and "only one ring leader can be in your party at a time".)
import { SPECIES, ROOMS, RIVAL, CHIEF, MAX_LEVEL } from './balance.js';
import { WAITS } from './world.js';

const calm = (state, roomId) => state.rooms[roomId].clears > 0;
/** Whether a kind is a ringleader. */
export const isChief = (species) => !!SPECIES[species] && !!SPECIES[species].boss;
/** Your friends who are not ringleaders: the ones a wish counts. */
const ordinary = (state) => state.friends.filter((friend) => !isChief(friend.species));
const has = (state, species) => state.friends.some((friend) => friend.species === species);
/** The kinds that live in a place: everyone on any of its stops' lists. (Worked out once: who is out of doors is asked every frame.) */
const LIVES_IN = Object.fromEntries(ROOMS.map((room) => [room.id, [...new Set(room.path.flatMap((stop) => stop.pool.map(([kind]) => kind)))]]));
const livesIn = (roomId) => LIVES_IN[roomId];
const friendsFrom = (state, roomId) => livesIn(roomId).filter((kind) => has(state, kind)).length;
const upTo = (have, need) => [Math.min(have, need), need];
const LANE = ROOMS.filter((room) => room.chapter !== 2);

// For each ringleader: what it wants (`wish`), what that takes in plain words (`how`), how far along
// you are (`count`: [have, need]), and what is seen of it outside its place: before the wish is
// granted (`waits`), once it is (`ready`), and when it comes home (`joins`).
export const WISHES = {
  boss_hydra: {
    wish: 'Company in the garden',
    how: 'Make a friend of every kind that lives in the garden.',
    count: (state) => [friendsFrom(state, 'garden'), livesIn('garden').length],
    waits: 'Old Summerlong is watering the verge, all three heads at once. It keeps looking back at the garden, counting who is in it.',
    ready: 'Old Summerlong counts your friends from the garden, twice, with each head. Then it turns the hose on you, very gently. It wants one more go, for the fun of it.',
    joins: 'Old Summerlong coils its hose and falls in behind you. All three heads agree, which is rare.',
  },
  boss_baron: {
    wish: 'Something handed down',
    how: 'Keep a friend in Heirloom colours.',
    count: (state) => upTo(ordinary(state).filter((friend) => friend.heirloom).length, 1),
    waits: 'Baron Pilfer is holding court on an upturned bucket. He looks your friends over for anything gold, and sighs.',
    ready: 'Baron Pilfer has seen the Heirloom. He bows, as low as a fur stole can. Then he puts up his lid: a bout, between people of quality.',
    joins: 'Baron Pilfer takes off his crown and puts it back on the other way round. He is with you. He would like that known.',
  },
  boss_crumbwyrm: {
    wish: 'To say sorry to the slice it forgot',
    how: 'Let your Crumbwisp grow up.',
    count: (state) => [state.friends.some((friend) => friend.species === 'toastghost' && friend.grown) ? 1 : 0, 1],
    waits: 'The Crumbwyrm is outside the pantry, cooling. It looks at the slice of toast that walks with you, and then at the ground.',
    ready: 'The Crumbwyrm looks up at what the slice it forgot has become, and pops, once, quietly. That is sorry, in toaster. Now it wants to show what it can do.',
    joins: 'The Crumbwyrm follows the one it forgot all the way home, two steps behind, keeping it warm.',
  },
  boss_spincycle: {
    wish: 'To give a sock back',
    how: 'Bring it a pair: an Eelastic and a Frayling, both your friends.',
    count: (state) => [['sockeel', 'sockgoblin'].filter((kind) => has(state, kind)).length, 2],
    waits: 'The Spin Cycle has rolled out onto the pavement. Its drum turns over, slowly, with one sock in it. It is looking for the other.',
    ready: 'An Eelastic and a Frayling, side by side. The Spin Cycle stops dead. Then its door swings open, and it squares up: one last spin.',
    joins: 'The Spin Cycle gives the sock back. It trundles after you with its door open, in case you find any more.',
  },
  boss_tome: {
    wish: 'A scrapbook worth reading',
    how: 'Meet forty kinds.',
    count: (state) => upTo(Object.keys(state.book).filter((kind) => !isChief(kind) && state.book[kind].met).length, 40),
    waits: 'The Overdue Tome is out of its case, reading the street. It turns a page of your scrapbook with its tongue, and finds it short.',
    ready: 'The Overdue Tome reads your scrapbook from cover to cover and shuts it, satisfied. Then it opens wide: it would like the last word.',
    joins: 'The Overdue Tome tucks itself under your arm. It is still overdue. It has decided that you are the library.',
  },
  boss_warden: {
    wish: 'To come down off the roof',
    how: 'Calm all eight places on the lane: then there is nothing left to watch for.',
    count: (state) => [LANE.filter((room) => calm(state, room.id)).length, LANE.length],
    waits: 'The Night Warden has come down as far as the gatepost. It watches both ends of the street at once, and will not sit.',
    ready: 'Eight places quiet. The Night Warden looks up the lane and down it and finds nothing to watch for. It spreads its wings: a bout, to see who keeps the watch now.',
    joins: 'The Night Warden steps down off the gatepost. Two hundred years on one roof. It would like to see another.',
  },
  boss_clock: {
    wish: 'To see somebody grow up',
    how: 'Have five friends who have grown up.',
    count: (state) => upTo(ordinary(state).filter((friend) => friend.grown).length, 5),
    waits: 'Grandfather Golem stands by his own front door, ticking. He looks at your friends the way one looks at children: to see if they have grown.',
    ready: 'Grandfather Golem counts five of yours grown up, and strikes five, exactly right, for the first time in years. He raises his pendulum: now show him.',
    joins: 'Grandfather Golem falls into step. He is slow, and he is never late.',
  },
  boss_vacuum: {
    wish: 'To be signed out of the depot',
    how: 'It belongs to Spick & Span. Get the better of Tansy Brisk all five times, and she will sign the form.',
    count: (state) => [Math.min(state.story.rival, RIVAL.meetings.length), RIVAL.meetings.length],
    waits: 'THE VACUUM is outside, unplugged, with a brown label tied to its hose: PROPERTY OF SPICK & SPAN. It keeps turning the label over.',
    ready: 'Form nine, signed. THE VACUUM reads its label one last time and lets it blow away. Then it roars, once, to see if you still jump.',
    joins: 'THE VACUUM rolls along behind you, bag empty, switched off. Somebody small and grey rides on top.',
  },
  boss_marrow: {
    wish: 'Another first prize',
    how: 'Keep three friends in Heirloom colours: it does like a rosette.',
    count: (state) => upTo(ordinary(state).filter((friend) => friend.heirloom).length, 3),
    waits: 'The Prize Marrow has had itself wheeled out on its bench. It is wearing its rosette, and looking for anybody else\'s.',
    ready: 'Three Heirlooms. The Prize Marrow looks at each the way a judge does, and nods. Then it rolls up its tendrils: best in show is decided on the day.',
    joins: 'The Prize Marrow lends your team its rosette, to wear in turns, and comes along to see that they do.',
  },
  boss_bathtub: {
    wish: 'Somebody to share the bath',
    how: 'Make a friend of every kind that lives in the Deep End.',
    count: (state) => [friendsFrom(state, 'deepend'), livesIn('deepend').length],
    waits: 'Old Clawfoot stands on the bath house steps, steaming gently. It has run a bath. Nobody is in it.',
    ready: 'Everybody from the Deep End is with you. Old Clawfoot looks at them, and at the bath, and stamps one iron foot: last one in.',
    joins: 'Old Clawfoot walks home behind you on its four iron feet, slopping a little. Everyone gets a turn in the bath.',
  },
  boss_mower: {
    wish: 'A crew',
    how: 'Have thirty friends at home.',
    count: (state) => upTo(ordinary(state).length, 30),
    waits: 'Captain Twostroke idles outside the shed, inspecting whoever goes by. He is counting heads. He has not got to thirty.',
    ready: 'Thirty friends at home. Captain Twostroke revs, once: that is a crew. He lowers his blades, to see whether its sitter can lead it.',
    joins: 'Captain Twostroke falls in at the back and keeps everybody in step. Nobody has found the off switch. Nobody is looking.',
  },
  boss_treadle: {
    wish: 'Something to mend',
    how: 'Bring her a Patchpaw, the bear with one eye from the Tick-Tock Attic: make a friend of one.',
    count: (state) => [has(state, 'teddybear') ? 1 : 0, 1],
    waits: 'Madam Treadle has brought her table out into the light. Her needle is threaded. She looks each of your friends over for a loose seam.',
    ready: 'Madam Treadle sees the bear with one eye, and her wheel stops. Very gently, she sews the other one back on. Then she squares up: she has not had a proper bout in years.',
    joins: 'Madam Treadle folds her table and comes along. By the time you are home, three of your friends have new buttons.',
  },
};

/** The ringleaders, in the order of their places: [{ species, room }]. */
export const CHIEFS = ROOMS.map((room) => ({ species: room.path[room.path.length - 1].boss, room: room.id }));
const placeOf = (species) => { const chief = CHIEFS.find((one) => one.species === species); return chief ? ROOMS.find((room) => room.id === chief.room) : null; };

/** How a ringleader's wish stands: { wish, how, have, need, granted }, or null for anybody else. */
export function wishOf(state, species) {
  const wish = WISHES[species];
  if (!wish) return null;
  const [have, need] = wish.count(state);
  return { wish: wish.wish, how: wish.how, have, need, granted: have >= need };
}

/** Whether a ringleader may be your friend at all: its own place is calm. (A save is held to this.) */
export const chiefMayJoin = (state, species) => { const room = placeOf(species); return !!room && calm(state, room.id); };

/**
 * How strong a ringleader is when it asks for its friendly bout, and so when it comes home: as it
 * was in its own place, or if you have come a long way since, a level behind your strongest friend.
 * It has been keeping up.
 */
export function chiefLevel(state, species) {
  const room = placeOf(species);
  const strongest = ordinary(state).reduce((most, friend) => Math.max(most, friend.level), 1);
  return Math.min(MAX_LEVEL, Math.max(room.path[room.path.length - 1].bossLevel, strongest - 1));
}

/**
 * The ringleaders taking the air outside their places just now: every one whose place is calm and
 * who is not your friend yet. [{ species, room, x, y, granted }]
 */
export function chiefsOut(state) {
  return CHIEFS.filter(({ species, room }) => calm(state, room) && !has(state, species))
    .map(({ species, room }) => ({ species, room, ...WAITS[species], granted: wishOf(state, species).granted }));
}

/** What is seen of a ringleader as you walk up to it outside its place: one line. */
export const chiefSeen = (state, species) => (wishOf(state, species).granted ? WISHES[species].ready : WISHES[species].waits);
/** What is seen when it comes home with you; and when the friendly bout goes its way. */
export const chiefJoins = (species) => WISHES[species].joins;
export const chiefWon = (species) => `${SPECIES[species].name} was enjoying that, and will be here when everyone is rested: a wish granted stays granted.`;

/** How many ringleaders may walk with you at once, and whether a team (friend ids) keeps to it. */
export const chiefsIn = (state, ids) => ids.filter((id) => { const friend = state.friends.find((one) => one.id === id); return !!friend && isChief(friend.species); }).length;
export const teamKeepsTo = (state, ids) => chiefsIn(state, ids) <= CHIEF.team;

/** Other things worth doing: a ringleader whose wish is granted is waiting. [{ id, title, detail, art }] */
export function chiefAsides(state) {
  return chiefsOut(state).filter((one) => one.granted).map((one) => ({
    id: `chief:${one.species}`, art: one.species,
    title: `${SPECIES[one.species].name}'s wish is granted`,
    detail: `Waiting outside ${placeOf(one.species).name}, for one more bout: a friendly one. Win it, and you have a ringleader for a friend.`,
  }));
}

/** The ringleaders' part of the story so far: who has come home. */
export function chiefsSoFar(state) {
  const home = CHIEFS.filter(({ species }) => has(state, species)).map(({ species }) => SPECIES[species].name);
  if (!home.length) return [];
  return [`${home.length === 1 ? home[0] : `${home.slice(0, -1).join(', ')} and ${home[home.length - 1]}`} had a wish, and you granted it. ${home.length === 1 ? 'A ringleader lives' : `${home.length} ringleaders live`} with you now.`];
}
