// Rooms: who is restless at each stop of a place, and a visit from stepping in
// to resting at home. Rules only: no DOM, no clock, no storage.
//
// Whoever you calm stays calm. A place remembers which of its stops have been
// calmed (`calmed`, a bit for each stop), through resting and through being
// carried home, so you never calm the same group twice to get at its
// ringleader. Calm the ringleader and the whole place is calm for good.
import { SPECIES, ROOMS, HEIRLOOM, VISITORS, WANDERERS, BREATHER, TEAM_SIZE, roomOf, roomBuilt, statAt } from './balance.js';
import { nextRandom, rollInt, rollPick, own } from './util.js';
import { BARRICADE, districtOf, districtAt } from './world.js';

/** A room is open once it is built and the room before it has been cleared. */
export function roomOpen(state, roomId) {
  const index = ROOMS.findIndex((room) => room.id === roomId);
  if (index < 0 || !roomBuilt(ROOMS[index])) return false;
  return index === 0 || state.rooms[ROOMS[index - 1].id].clears > 0;
}

/** Whether a place has been calmed at least once. Calm places are where Heirlooms are looked for. */
export const placeCalm = (state, roomId) => own(state.rooms, roomId) && state.rooms[roomId].clears > 0;

/** Whether one stop of a place has been calmed: whoever was restless there is calm, and stays so. */
export const staysCalm = (state, roomId, stop) => own(state.rooms, roomId) && (placeCalm(state, roomId) || ((state.rooms[roomId].calmed >> stop) & 1) === 1);

/** How many stops of a place are calm for good: all of a calm place's, else those calmed so far. */
export function calmedIn(state, roomId) {
  const room = roomOf(roomId);
  if (!room || !own(state.rooms, roomId)) return 0;
  return room.path.filter((_, stop) => staysCalm(state, roomId, stop)).length;
}

/**
 * Who may turn up at a stop, as [kind, weight]: the stop's own list, and, in a place that has been
 * calmed, visitors as well (see VISITORS). Nobody visits a ringleader's stop.
 */
export function poolOf(room, stop, calm = false) {
  const spot = room.path[stop];
  return calm && !spot.boss ? [...spot.pool, ...VISITORS.kinds.map((id) => [id, VISITORS.weight])] : spot.pool;
}

/**
 * Who is waiting at a stop: a list of { species, level, heirloom }, at most
 * three. A boss stands in the middle with its company either side. In a place
 * that is `calm` (calmed before), Heirlooms are likelier and visitors may come.
 * (The same dice are thrown either way, so a seed's run of luck does not shift.)
 */
export function rollEncounter(dice, room, stop, calm = false) {
  const spot = room.path[stop];
  const pool = poolOf(room, stop, calm);
  const odds = calm ? HEIRLOOM.calmOdds : HEIRLOOM.odds;
  const company = [];
  const count = rollInt(dice, spot.size[0], spot.size[1]);
  for (let i = 0; i < count && company.length < TEAM_SIZE - (spot.boss ? 1 : 0); i++) {
    const [species] = rollPick(dice, pool, ([, weight]) => weight);
    const level = rollInt(dice, spot.level[0], spot.level[1]);
    const heirloom = SPECIES[species].huff > 0 && nextRandom(dice) < odds;
    company.push({ species, level, heirloom });
  }
  if (!spot.boss) return company;
  const boss = { species: spot.boss, level: spot.bossLevel, heirloom: false };
  return company.length > 1 ? [company[0], boss, ...company.slice(1)] : [boss, ...company];
}

export const maxHpOf = (friend) => statAt(SPECIES[friend.species].hp, friend.level);
export const teamOf = (state) => state.team.map((id) => state.friends.find((friend) => friend.id === id)).filter(Boolean);

/**
 * Whether a list is a fair roll for a stop: the right boss (if any) at the
 * right level, the right number of others, each from that stop's list (or a
 * visitor, where visitors can ever come) and at its levels. A save cannot swap
 * a boss for something soft.
 */
export function fairEncounter(room, stop, list) {
  const spot = room.path[stop];
  if (!spot || !Array.isArray(list) || list.length < 1 || list.length > TEAM_SIZE) return false;
  let bosses = 0;
  let company = 0;
  for (const foe of list) {
    if (!foe || typeof foe !== 'object' || !own(SPECIES, foe.species) || !Number.isInteger(foe.level) || typeof foe.heirloom !== 'boolean') return false;
    if (SPECIES[foe.species].boss) {
      if (foe.species !== spot.boss || foe.level !== spot.bossLevel || foe.heirloom) return false;
      bosses++;
    } else {
      if (!poolOf(room, stop, true).some(([id]) => id === foe.species) || foe.level < spot.level[0] || foe.level > spot.level[1]) return false;
      company++;
    }
  }
  return bosses === (spot.boss ? 1 : 0) && company >= spot.size[0] && company <= spot.size[1];
}

/**
 * The ground being held just now, as points to keep off (see world.canStand): a barricade in the
 * gateway of any place that is still shut; on a visit, every group there not yet calmed; and in a
 * place you are not visiting, the cover its restless ones keep to. A place you are standing in
 * with no visit on (you have just calmed it) holds nothing.
 */
export function heldBy(state, where = state.where) {
  const held = [];
  const here = districtAt(where);
  for (const room of ROOMS) {
    const area = districtOf(room.id);
    if (!area) continue;
    if (!roomOpen(state, room.id)) held.push({ x: area.gate.x, y: area.gate.y, r: BARRICADE });
    if (state.visit && state.visit.room === room.id) {
      area.posts.forEach((post, i) => { if (!state.visit.groups[i].done) held.push(post); });
    } else if (!placeCalm(state, room.id) && (state.visit || here !== room.id)) {
      // (Nobody keeps to cover at a stop that is calm, nor anywhere in a calm place: whoever wanders there is seen when you walk in.)
      held.push(...area.posts.filter((_, stop) => !staysCalm(state, room.id, stop)));
    }
  }
  return held;
}

/**
 * The ground being held on the floor of an indoor place: on a visit to it, every group there not
 * yet calmed. (Indoors there is nobody to see until you call: stepping in is calling.)
 */
export function heldIn(state, roomId, posts) {
  const visit = state.visit;
  if (!visit || visit.room !== roomId) return [];
  return posts.filter((post, i) => visit.groups[i] && !visit.groups[i].done);
}

/** Whether a group can be met now: it is still there, and the boss only once everyone else is calm. */
export function canMeet(visit, room, index) {
  if (!visit || !Number.isInteger(index) || index < 0 || index >= room.path.length || visit.groups[index].done) return false;
  return index < room.path.length - 1 || visit.stop >= room.path.length - 1;
}

/**
 * The group a sensible visitor meets next: the nearest stop to the gate still restless, the boss
 * last. Or -1. (On a stroll that is the nearest wanderer; in a place not yet calm, wanderers are
 * nobody's next: they are there if you want them.)
 */
export function nextGroup(visit, room) {
  for (let i = 0; i < room.path.length; i++) if (canMeet(visit, room, i) && !visit.groups[i].wander) return i;
  return -1;
}

/** A stop with nobody at it: how a calm place's ringleader, and most of its stops, are kept. */
const nobody = () => ({ foes: [], done: true });
/** Whether there is somebody at a stop of a visit, calmed or not. */
export const someone = (group) => !!group && Array.isArray(group.foes) && group.foes.length > 0;
/** How many groups of a visit are still about: restless, or wandering. */
export const stillAbout = (visit) => (visit ? visit.groups.filter((group) => !group.done).length : 0);
/** Whether the group at a stop of a visit is a wanderer, there if you want it: not somebody who has to be calmed. */
export const wandering = (visit, index) => !!visit && !!visit.groups[index] && !visit.groups[index].done && (visit.stroll === true || visit.groups[index].wander === true);

/**
 * How many groups of wanderers there can be in a place at once. In a calm place, WANDERERS says.
 * In one not yet calm they come only to stops already calmed, always leaving one of those empty
 * (so none until two are calm), and never where there is no walking round them: nobody you have
 * calmed is ever in the way of somebody you have not.
 */
export function wanderersMost(state, roomId) {
  const room = roomOf(roomId);
  if (placeCalm(state, roomId)) return Math.min(room.path.length - 1, WANDERERS.groups[1]);
  const area = districtOf(roomId);
  if (area && area.narrow) return 0;
  const calm = room.path.slice(0, -1).filter((_, stop) => staysCalm(state, roomId, stop)).length;
  return Math.max(0, Math.min(calm - 1, WANDERERS.groups[1]));
}

/** Which of some stops have wanderers at them this time: a few, `most` at the most, by the dice. */
function wanderedTo(dice, stops, most) {
  const from = [...stops];
  const count = Math.min(most, rollInt(dice, WANDERERS.groups[0], WANDERERS.groups[1]));
  const chosen = new Set();
  while (chosen.size < count) chosen.add(from.splice(Math.floor(nextRandom(dice) * from.length), 1)[0]);
  return chosen;
}

/**
 * Steps into a place with the team rested. Everyone who is still restless
 * there is rolled now, one group for each stop not yet calmed, so they can
 * all be seen standing about before any of them is met. A stop calmed on an
 * earlier visit has nobody at it, or a few wanderers (`wander`): there to be
 * met if you want the practice, never in the way of the ringleader. `stop`
 * counts the stops that are calm. Returns false if the place is not open.
 *
 * A place already calm stays calm. Stepping into it is a stroll (`stroll`):
 * a few wanderers at some of its stops, nobody at the rest, and no ringleader.
 */
export function enterRoom(state, roomId) {
  if (state.visit || !roomOpen(state, roomId) || teamOf(state).length === 0) return false;
  const room = roomOf(roomId);
  const stroll = placeCalm(state, roomId);
  const last = room.path.length - 1;
  const calm = room.path.map((_, stop) => stop).filter((stop) => stop < last && staysCalm(state, roomId, stop));
  const most = wanderersMost(state, roomId);
  const about = most > 0 ? wanderedTo(state, calm, most) : new Set();
  state.visit = {
    room: roomId, stop: stroll ? 0 : calm.length, stroll,
    hp: Object.fromEntries(teamOf(state).map((friend) => [friend.id, maxHpOf(friend)])),
    groups: room.path.map((_, stop) => {
      if (about.has(stop)) return stroll ? { foes: rollEncounter(state, room, stop, true), done: false } : { foes: rollEncounter(state, room, stop, false), done: false, wander: true };
      if (calm.includes(stop) || (stroll && stop === last)) return nobody();
      return { foes: rollEncounter(state, room, stop, false), done: false };
    }),
  };
  state.rooms[roomId].visits++;
  return true;
}

/** Rests at home. Everyone is fresh the next time they set out. Whoever was calmed stays calm; others may have wandered in by then. */
export function leaveRoom(state) {
  if (!state.visit) return false;
  state.visit = null;
  return true;
}

/**
 * Moves the visit on after a fight with group `index`. `left` maps friend id
 * to the Health it finished with. A win calms that group, for good, and
 * everyone takes a breather, or the place is cleared and the visit over once
 * its boss is calmed; a loss ends the visit at home, with everyone calmed
 * before it still calm.
 * Returns { cleared, home }.
 */
export function afterFight(state, index, won, left) {
  const visit = state.visit;
  const room = roomOf(visit.room);
  const record = state.rooms[visit.room];
  if (!won) {
    record.losses++;
    state.visit = null;
    return { cleared: false, home: true };
  }
  visit.groups[index].done = true;
  // On a stroll the count is of wanderers calmed; the place's record was made when it was calmed.
  if (visit.stroll) visit.stop = visit.groups.filter((group) => group.done && someone(group)).length;
  else {
    record.calmed |= 1 << index; // (a wanderer's stop was calm already)
    visit.stop = calmedIn(state, visit.room);
  }
  if (index === room.path.length - 1 && !visit.stroll) {
    record.clears++;
    state.visit = null;
    return { cleared: true, home: false };
  }
  for (const friend of teamOf(state)) {
    const max = maxHpOf(friend);
    visit.hp[friend.id] = Math.min(max, Math.max(0, left[friend.id] || 0) + Math.ceil(max * BREATHER));
  }
  return { cleared: false, home: false };
}
