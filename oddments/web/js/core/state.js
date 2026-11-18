// The save file: its shape, a fresh one, and repair of old or damaged ones.
import {
  SAVE_VERSION, SPECIES, SPECIES_IDS, START_TEAM, ROOM_IDS, TEAM_SIZE, ROSTER_MAX, MAX_LEVEL, NAME_LENGTH, DEFAULT_NAME,
  LOOK_IDS, lookOf, xpNeeded, roomOf, roomBuilt, WANDERERS, STRAYS, CHIEF,
} from './balance.js';
import { newFriend } from './progress.js';
import { roomOpen, bridgeOpen, maxHpOf, rollEncounter, fairEncounter, heldBy, heldIn, placeCalm, someone, staysCalm, calmedIn, wanderersMost } from './rooms.js';
import { own } from './util.js';
import { settleWhere, spotNear, overTheWater } from './world.js';
import { insideOf, settleIn } from './indoors.js';
import { newStory, reviveStory } from './story.js';
import { rollStrays, fairStrays, fairKeepsake, KEEPSAKES } from './strays.js';
import { giveName, tidyName } from './names.js';
import { rivalMost } from './rival.js';
import { isChief, chiefMayJoin, chiefsIn } from './wishes.js';
import { WILDS } from './world.js';

export function newState(now = Date.now(), seed = (now ^ 0x9e3779b9) | 0) {
  const friends = START_TEAM.map(([species, level], i) => newFriend(i + 1, species, level));
  const state = {
    v: SAVE_VERSION,
    rng: seed | 0,
    createdAt: now,
    lastSeen: now,
    day: 0, // what day it is, as whoever runs the game last said (a whole number of days; 0: nobody has said)
    started: false, // has the player finished the intro
    player: { name: DEFAULT_NAME, look: LOOK_IDS[0] },
    friends, // everyone who has come home: { id, species, level, xp, heirloom }
    nextFriendId: friends.length + 1,
    team: friends.map((friend) => friend.id), // up to three friend ids, in fighting order
    where: settleWhere(null), // where you are standing in the world; a new game starts at the door of home
    indoors: null, // the building you are inside and where on its floor: { id, x, y }. `where` is then its door
    // For each place: how often it has been called on, calmed and lost in, and which of its stops are calm for good (a bit each).
    rooms: Object.fromEntries(ROOM_IDS.map((id) => [id, { visits: 0, clears: 0, losses: 0, calmed: 0 }])),
    // The visit you are on, from stepping into a place until you rest at home:
    // { room, stop: how many stops are calm, hp: { friendId: health }, groups: [{ foes: [who], done, wander: true if a wanderer }] one per stop }
    visit: null,
    // How worn the team is out on the lane with no visit on (friend id to Health), from meeting strays; null when rested.
    worn: null,
    // Who is out on the lane this time: [{ at: which quiet spot, foes: [who], done }]. They have dice of their own.
    strays: [],
    strayRng: (seed ^ 0x5bd1e995) | 0,
    // The scrapbook: which kinds have been met, which as an Heirloom, and which you have seen grown up.
    book: Object.fromEntries(SPECIES_IDS.map((id) => [id, { met: friends.some((friend) => friend.species === id), heirloom: false, grown: false }])),
    stats: { battles: 0, wins: 0, losses: 0, rounds: 0, knockouts: 0, befriended: 0, heirlooms: 0 },
    story: newStory(), // which conversations have been had; the rest of the story is read from everything else here
    settings: { fast: false, sound: true, music: true }, // fast fights; sound effects; the tunes
    seen: {}, // one-time hints already shown
  };
  rollStrays(state);
  return state;
}

// ---------------------------------------------------------------- repair
//
// A save can come from anywhere: an older build, a damaged file, or one
// somebody edited by hand. Everything below treats it as hostile. Nothing is
// copied across as it stands: the state is built fresh and every field is
// read back one at a time, checked for type and kept inside a range the game
// can compute with, so no save, however it was made, can leave the game
// unable to start. Text is never taken from a save except the player's own
// name, and that is cut to length (the screens write it as text, not markup).

const MAX_COUNT = 1e9;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A finite number within [min, max], otherwise the fallback. */
function num(value, fallback, min = 0, max = 1e15) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
const int = (value, fallback, min = 0, max = MAX_COUNT) => Math.floor(num(value, fallback, min, max));

/** Gives every record a whole, positive id of its own, and returns the next free one. */
function numberUniquely(records) {
  let highest = records.reduce((most, r) => Math.max(most, r.id), 0);
  const taken = new Set();
  for (const record of records) {
    if (record.id < 1 || taken.has(record.id)) record.id = ++highest;
    taken.add(record.id);
  }
  return highest + 1;
}

/**
 * One friend rebuilt from a saved one, or null if it is not one. A ringleader is a friend only if its
 * own place is calm: it came home from there, after its wish (see wishes.js). It keeps no rare colours.
 */
function reviveFriend(raw, state) {
  if (!isObj(raw) || !own(SPECIES, raw.species)) return null;
  const chief = isChief(raw.species);
  if (chief && !chiefMayJoin(state, raw.species)) return null;
  const level = int(raw.level, 1, 1, MAX_LEVEL);
  const friend = {
    id: int(raw.id, 0, 0),
    species: raw.species,
    level,
    xp: level >= MAX_LEVEL ? 0 : int(raw.xp, 0, 0, xpNeeded(level) - 1),
    heirloom: raw.heirloom === true && !chief,
  };
  // Grown up: only a kind that grows. (At any level: one that was grown when it came home is grown from the start.)
  if (raw.grown === true && SPECIES[raw.species].grown) friend.grown = true;
  giveName(friend, raw.nick); // a name of your own, if it was given one: tidied again on the way in
  return friend;
}

/** One of the restless, as the save may keep it: what the game made, and nothing else. (Whether it is a fair one is checked before this.) */
const keptFoe = (foe) => (foe.grown === true ? { species: foe.species, level: foe.level, heirloom: foe.heirloom, grown: true } : { species: foe.species, level: foe.level, heirloom: foe.heirloom });

function reviveVisit(raw, state) {
  if (!isObj(raw) || typeof raw.room !== 'string' || !roomOpen(state, raw.room) || !Array.isArray(raw.groups)) return null;
  const room = roomOf(raw.room);
  const hp = isObj(raw.hp) ? raw.hp : {};
  const visit = { room: room.id, stop: 0, hp: {} };
  for (const id of state.team) {
    const friend = state.friends.find((f) => f.id === id);
    visit.hp[id] = int(hp[id], maxHpOf(friend), 0, maxHpOf(friend));
  }
  // Nobody on their feet is not a visit: they are at home.
  if (!Object.values(visit.hp).some((left) => left > 0)) return null;
  const kept = (foes) => foes.map(keptFoe);
  // A calm place stays calm, whatever the save says of it: this is a stroll. Wanderers are kept
  // where they are a fair roll for their stop, as many as there can be and no more, and never at
  // its ringleader's. Nobody is rolled afresh: a stroll with nobody left is still a stroll.
  visit.stroll = placeCalm(state, room.id);
  if (visit.stroll) {
    let about = 0;
    visit.groups = room.path.map((_, stop) => {
      const saved = isObj(raw.groups[stop]) ? raw.groups[stop] : {};
      if (stop === room.path.length - 1 || about >= WANDERERS.groups[1] || !fairEncounter(room, stop, saved.foes)) return { foes: [], done: true };
      about++;
      return { foes: kept(saved.foes), done: saved.done === true };
    });
    visit.stop = visit.groups.filter((group) => group.done && someone(group)).length;
    return visit;
  }
  // Whoever is restless at a stop is kept only if a fair roll for it; otherwise rolled again. A
  // group the save says is calmed, is: calming is for good. The boss cannot have been calmed
  // already (that calms the place), nor before everyone else. At a stop that was calm before this
  // visit there is nobody, or a wanderer: as many as there can be, and no more.
  const last = room.path.length - 1;
  const most = wanderersMost(state, room.id);
  let about = 0;
  visit.groups = room.path.map((_, stop) => {
    const saved = isObj(raw.groups[stop]) ? raw.groups[stop] : {};
    const fair = fairEncounter(room, stop, saved.foes);
    if (stop < last && staysCalm(state, room.id, stop)) {
      if (saved.done !== true && saved.wander === true && fair && about < most) { about++; return { foes: kept(saved.foes), done: false, wander: true }; }
      return saved.wander === true && fair ? { foes: kept(saved.foes), done: true, wander: true } : { foes: fair ? kept(saved.foes) : [], done: true };
    }
    const done = saved.done === true && stop < last;
    if (done) state.rooms[room.id].calmed |= 1 << stop;
    return { foes: fair ? kept(saved.foes) : done ? [] : rollEncounter(state, room, stop, false), done };
  });
  visit.stop = calmedIn(state, room.id);
  return visit;
}

/** Turns whatever was in storage into a valid current-version state, or null if it is not a save at all. */
export function reviveState(saved, now = Date.now()) {
  if (!isObj(saved) || typeof saved.v !== 'number' || !Array.isArray(saved.friends)) return null;
  if (saved.v > SAVE_VERSION) return null; // written by a newer build; don't guess
  const state = newState(now, typeof saved.rng === 'number' && Number.isFinite(saved.rng) ? saved.rng | 0 : 1);
  state.createdAt = num(saved.createdAt, now, 0, now);
  state.lastSeen = num(saved.lastSeen, now, 0, now); // a clock set backwards must not put the save in the future
  state.day = Number.isInteger(saved.day) && saved.day > 0 && saved.day < 1e6 ? saved.day : 0;
  state.started = saved.started === true;

  const player = isObj(saved.player) ? saved.player : {};
  state.player = { name: tidyName(player.name) || DEFAULT_NAME, look: lookOf(player.look) };

  // (The places first: whether a ringleader can be a friend depends on whether its place is calm.)
  const rooms = isObj(saved.rooms) ? saved.rooms : {};
  for (const id of ROOM_IDS) {
    const raw = isObj(rooms[id]) ? rooms[id] : {};
    const stops = roomBuilt(roomOf(id)) ? roomOf(id).path.length : 0;
    const clears = stops ? int(raw.clears, 0) : 0;
    // Which stops are calm for good: all of a calm place's; otherwise those calmed so far, never the
    // ringleader's (calming that is calming the place). A save from before groups stayed calm kept
    // only how many had been calmed in one go (`best`): that many, from the gate, are calm.
    const others = stops ? (1 << (stops - 1)) - 1 : 0;
    const calmed = clears > 0 ? (others << 1) | 1 : Number.isInteger(raw.calmed) ? raw.calmed & others : (1 << int(raw.best, 0, 0, Math.max(0, stops - 1))) - 1;
    state.rooms[id] = { visits: int(raw.visits, 0), clears, losses: int(raw.losses, 0), calmed };
  }
  // Friends: one of each kind, the first kept. A save with none starts with the usual three.
  const kinds = new Set();
  const friends = saved.friends.slice(0, 1000).map((raw) => reviveFriend(raw, state))
    .filter((friend) => friend && !kinds.has(friend.species) && kinds.add(friend.species))
    .slice(0, ROSTER_MAX);
  if (friends.length) state.friends = friends;
  state.nextFriendId = Math.max(int(saved.nextFriendId, 1, 1), numberUniquely(state.friends));

  // The team: friends that exist, each once, topped up from the rest so nobody sets out short-handed.
  const ids = state.friends.map((friend) => friend.id);
  const team = [];
  // (Only so many ringleaders walk with you at once: one more than that is left at home.)
  const fits = (id) => chiefsIn(state, [...team, id]) <= CHIEF.team;
  for (const id of Array.isArray(saved.team) ? saved.team.slice(0, 16) : []) {
    if (ids.includes(id) && !team.includes(id) && team.length < TEAM_SIZE && fits(id)) team.push(id);
  }
  for (const id of ids) if (team.length < TEAM_SIZE && !team.includes(id) && fits(id)) team.push(id);
  state.team = team;

  // The world was laid out afresh in version 2: a save from before it wakes up rested, at home.
  const mapped = saved.v >= 2;
  state.visit = mapped ? reviveVisit(saved.visit, state) : null;
  // Worn from strays, with no visit on: each of the team at a Health they could have. (On a visit, the
  // visit keeps it. Nobody on their feet is not worn: they were carried home.)
  if (mapped && !state.visit && isObj(saved.worn)) {
    const worn = {};
    for (const id of state.team) { const friend = state.friends.find((f) => f.id === id); worn[id] = int(saved.worn[id], maxHpOf(friend), 0, maxHpOf(friend)); }
    if (Object.values(worn).some((left) => left > 0)) state.worn = worn;
  }
  // Strays: the dice they are rolled with, and whoever is out. Each group is kept only at a quiet spot
  // of its own and only if it is fair as things stand; a save with none to keep is given a fresh lot.
  if (typeof saved.strayRng === 'number' && Number.isFinite(saved.strayRng)) state.strayRng = saved.strayRng | 0;
  const taken = new Set();
  const keeps = new Set();
  const groups = (bridgeOpen(state) ? STRAYS.farGroups : STRAYS.groups)[1];
  const listed = Array.isArray(saved.strays) ? saved.strays.slice(0, 64).filter(isObj) : [];
  // A Keepsake in the list is kept if it may fairly be out: the right one, once, with its chapter calm.
  const keepsakes = listed.filter((stray) => Number.isInteger(stray.keep) && fairKeepsake(state, stray) && !keeps.has(stray.keep) && keeps.add(stray.keep)).slice(0, KEEPSAKES.length);
  const kept = listed.filter((stray) => stray.keep === undefined && Number.isInteger(stray.at) && stray.at >= 0 && stray.at < WILDS.length
    && (bridgeOpen(state) || !overTheWater(WILDS[stray.at]))
    && !taken.has(stray.at) && fairStrays(state, stray.foes) && taken.add(stray.at)).slice(0, groups);
  if (Array.isArray(saved.strays) && (kept.length || saved.strays.length === 0)) {
    state.strays = [...kept.map((stray) => ({ at: stray.at, foes: stray.foes.map(keptFoe), done: stray.done === true })),
      ...keepsakes.map((stray) => ({ at: -1, keep: stray.keep, foes: stray.foes.map(keptFoe), done: stray.done === true }))];
  } else rollStrays(state);
  const where = mapped && isObj(saved.where) ? saved.where : null;
  // (Wherever the save says you stand is checked against the ground held as it would be with you standing there.)
  state.where = settleWhere(where, where ? heldBy(state, where) : []);
  // Nobody is over the water while the gate on the bridge is shut: a save that says so wakes at home.
  if (overTheWater(state.where) && !bridgeOpen(state)) state.where = settleWhere(null);
  // Indoors only if it is somewhere there is to be, you are at its door in the world, and the point
  // is one feet can be at. A place still shut, or one you are not visiting while visiting another,
  // is not somewhere you can be standing: then you are outside its door.
  const indoors = isObj(saved.indoors) ? saved.indoors : null;
  const inside = indoors && typeof indoors.id === 'string' ? insideOf(indoors.id) : null;
  if (inside && spotNear(state.where) === indoors.id) {
    const place = roomOf(indoors.id);
    const fine = !place || (roomBuilt(place) && roomOpen(state, indoors.id) && (!state.visit || state.visit.room === indoors.id));
    if (fine) state.indoors = { id: indoors.id, ...settleIn(inside, indoors, heldIn(state, indoors.id, inside.posts)) };
  }

  const book = isObj(saved.book) ? saved.book : {};
  for (const id of SPECIES_IDS) {
    const raw = isObj(book[id]) ? book[id] : {};
    const friend = state.friends.find((f) => f.species === id);
    state.book[id] = { met: raw.met === true || !!friend, heirloom: raw.heirloom === true || !!(friend && friend.heirloom), grown: !!SPECIES[id].grown && (raw.grown === true || !!(friend && friend.grown)) };
  }

  const stats = isObj(saved.stats) ? saved.stats : {};
  for (const key of Object.keys(state.stats)) state.stats[key] = int(stats[key], 0);
  state.story = reviveStory(saved.story);
  // The second call cannot have been taken before the lane was quiet.
  if (state.story.call2 && !bridgeOpen(state)) state.story.call2 = false;
  // Nor can Tansy Brisk have lost a meeting whose place is not calm yet.
  state.story.rival = Math.min(state.story.rival, rivalMost(state));
  const settings = isObj(saved.settings) ? saved.settings : {};
  // A switch an older save has never heard of keeps its usual setting: sound is on unless turned off.
  for (const key of Object.keys(state.settings)) if (typeof settings[key] === 'boolean') state.settings[key] = settings[key];
  const seen = isObj(saved.seen) ? saved.seen : {};
  // (Hints are named in plain lower-case letters. Nothing else is kept: not a name the language itself uses.)
  state.seen = Object.fromEntries(Object.keys(seen).filter((key) => /^[a-z]{1,24}$/.test(key) && !['constructor', 'prototype'].includes(key) && seen[key] === true).slice(0, 64).map((key) => [key, true]));
  return state;
}
