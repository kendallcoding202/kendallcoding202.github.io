// The save file: its shape, a fresh one, and repair of old or damaged ones.
import {
  SAVE_VERSION, SPECIES, SPECIES_IDS, START_TEAM, ROOM_IDS, TEAM_SIZE, ROSTER_MAX, MAX_LEVEL, NAME_LENGTH, DEFAULT_NAME,
  LOOK_IDS, lookOf, xpNeeded, roomOf, roomBuilt,
} from './balance.js';
import { newFriend } from './progress.js';
import { roomOpen, maxHpOf, rollEncounter, fairEncounter, heldBy, placeCalm } from './rooms.js';
import { own } from './util.js';
import { settleWhere } from './world.js';
import { newStory, reviveStory } from './story.js';

export function newState(now = Date.now(), seed = (now ^ 0x9e3779b9) | 0) {
  const friends = START_TEAM.map(([species, level], i) => newFriend(i + 1, species, level));
  return {
    v: SAVE_VERSION,
    rng: seed | 0,
    createdAt: now,
    lastSeen: now,
    started: false, // has the player finished the intro
    player: { name: DEFAULT_NAME, look: LOOK_IDS[0] },
    friends, // everyone who has come home: { id, species, level, xp, heirloom }
    nextFriendId: friends.length + 1,
    team: friends.map((friend) => friend.id), // up to three friend ids, in fighting order
    where: settleWhere(null), // where you are standing in the world; a new game starts at the door of home
    rooms: Object.fromEntries(ROOM_IDS.map((id) => [id, { visits: 0, clears: 0, losses: 0, best: 0 }])),
    // The visit you are on, from stepping into a place until you rest at home:
    // { room, stop: how many groups are calmed, hp: { friendId: health }, groups: [{ foes: [who], done }] one per stop }
    visit: null,
    // The scrapbook: which kinds have been met, and which as an Heirloom.
    book: Object.fromEntries(SPECIES_IDS.map((id) => [id, { met: friends.some((friend) => friend.species === id), heirloom: false }])),
    stats: { battles: 0, wins: 0, losses: 0, rounds: 0, knockouts: 0, befriended: 0, heirlooms: 0 },
    story: newStory(), // which conversations have been had; the rest of the story is read from everything else here
    settings: { fast: false, sound: true, music: true }, // fast fights; sound effects; the tunes
    seen: {}, // one-time hints already shown
  };
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
const text = (value, fallback, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback);

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

/** One friend rebuilt from a saved one, or null if it is not one. Bosses are nobody's friend. */
function reviveFriend(raw) {
  if (!isObj(raw) || !own(SPECIES, raw.species) || SPECIES[raw.species].boss) return null;
  const level = int(raw.level, 1, 1, MAX_LEVEL);
  return {
    id: int(raw.id, 0, 0),
    species: raw.species,
    level,
    xp: level >= MAX_LEVEL ? 0 : int(raw.xp, 0, 0, xpNeeded(level) - 1),
    heirloom: raw.heirloom === true,
  };
}

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
  // Each group is kept only if it is a fair roll for its stop; otherwise it is rolled again. The
  // boss cannot have been calmed already (that ends the visit), nor before everyone else.
  visit.groups = room.path.map((_, stop) => {
    const saved = isObj(raw.groups[stop]) ? raw.groups[stop] : {};
    return {
      foes: fairEncounter(room, stop, saved.foes)
        ? saved.foes.map((foe) => ({ species: foe.species, level: foe.level, heirloom: foe.heirloom }))
        : rollEncounter(state, room, stop, placeCalm(state, room.id)),
      done: saved.done === true && stop < room.path.length - 1,
    };
  });
  visit.stop = visit.groups.filter((group) => group.done).length;
  return visit;
}

/** Turns whatever was in storage into a valid current-version state, or null if it is not a save at all. */
export function reviveState(saved, now = Date.now()) {
  if (!isObj(saved) || typeof saved.v !== 'number' || !Array.isArray(saved.friends)) return null;
  if (saved.v > SAVE_VERSION) return null; // written by a newer build; don't guess
  const state = newState(now, typeof saved.rng === 'number' && Number.isFinite(saved.rng) ? saved.rng | 0 : 1);
  state.createdAt = num(saved.createdAt, now, 0, now);
  state.lastSeen = num(saved.lastSeen, now, 0, now); // a clock set backwards must not put the save in the future
  state.started = saved.started === true;

  const player = isObj(saved.player) ? saved.player : {};
  state.player = { name: text(player.name, DEFAULT_NAME, NAME_LENGTH), look: lookOf(player.look) };

  // Friends: one of each kind, the first kept. A save with none starts with the usual three.
  const kinds = new Set();
  const friends = saved.friends.slice(0, 1000).map(reviveFriend)
    .filter((friend) => friend && !kinds.has(friend.species) && kinds.add(friend.species))
    .slice(0, ROSTER_MAX);
  if (friends.length) state.friends = friends;
  state.nextFriendId = Math.max(int(saved.nextFriendId, 1, 1), numberUniquely(state.friends));

  // The team: friends that exist, each once, topped up from the rest so nobody sets out short-handed.
  const ids = state.friends.map((friend) => friend.id);
  const team = [];
  for (const id of Array.isArray(saved.team) ? saved.team.slice(0, 16) : []) {
    if (ids.includes(id) && !team.includes(id) && team.length < TEAM_SIZE) team.push(id);
  }
  for (const id of ids) if (team.length < TEAM_SIZE && !team.includes(id)) team.push(id);
  state.team = team;

  const rooms = isObj(saved.rooms) ? saved.rooms : {};
  for (const id of ROOM_IDS) {
    const raw = isObj(rooms[id]) ? rooms[id] : {};
    const stops = roomBuilt(roomOf(id)) ? roomOf(id).path.length : 0;
    state.rooms[id] = { visits: int(raw.visits, 0), clears: stops ? int(raw.clears, 0) : 0, losses: int(raw.losses, 0), best: int(raw.best, 0, 0, stops) };
  }
  // The world was laid out afresh in version 2: a save from before it wakes up rested, at home.
  const mapped = saved.v >= 2;
  state.visit = mapped ? reviveVisit(saved.visit, state) : null;
  const where = mapped && isObj(saved.where) ? saved.where : null;
  // (Wherever the save says you stand is checked against the ground held as it would be with you standing there.)
  state.where = settleWhere(where, where ? heldBy(state, where) : []);

  const book = isObj(saved.book) ? saved.book : {};
  for (const id of SPECIES_IDS) {
    const raw = isObj(book[id]) ? book[id] : {};
    const friend = state.friends.find((f) => f.species === id);
    state.book[id] = { met: raw.met === true || !!friend, heirloom: raw.heirloom === true || !!(friend && friend.heirloom) };
  }

  const stats = isObj(saved.stats) ? saved.stats : {};
  for (const key of Object.keys(state.stats)) state.stats[key] = int(stats[key], 0);
  state.story = reviveStory(saved.story);
  const settings = isObj(saved.settings) ? saved.settings : {};
  // A switch an older save has never heard of keeps its usual setting: sound is on unless turned off.
  for (const key of Object.keys(state.settings)) if (typeof settings[key] === 'boolean') state.settings[key] = settings[key];
  const seen = isObj(saved.seen) ? saved.seen : {};
  state.seen = Object.fromEntries(Object.keys(seen).filter((key) => key.length <= 24 && seen[key] === true).slice(0, 64).map((key) => [key, true]));
  return state;
}
