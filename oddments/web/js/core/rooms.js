// Rooms: who is restless at each stop of a place, and a visit from stepping in
// to resting at home. Rules only: no DOM, no clock, no storage.
import { SPECIES, ROOMS, HEIRLOOM, BREATHER, TEAM_SIZE, roomOf, roomBuilt, statAt } from './balance.js';
import { nextRandom, rollInt, rollPick, own } from './util.js';
import { BARRICADE, districtOf, districtAt } from './world.js';

/** A room is open once it is built and the room before it has been cleared. */
export function roomOpen(state, roomId) {
  const index = ROOMS.findIndex((room) => room.id === roomId);
  if (index < 0 || !roomBuilt(ROOMS[index])) return false;
  return index === 0 || state.rooms[ROOMS[index - 1].id].clears > 0;
}

/**
 * Who is waiting at a stop: a list of { species, level, heirloom }, at most
 * three. A boss stands in the middle with its company either side.
 */
export function rollEncounter(dice, room, stop) {
  const spot = room.path[stop];
  const company = [];
  const count = rollInt(dice, spot.size[0], spot.size[1]);
  for (let i = 0; i < count && company.length < TEAM_SIZE - (spot.boss ? 1 : 0); i++) {
    const [species] = rollPick(dice, spot.pool, ([, weight]) => weight);
    const level = rollInt(dice, spot.level[0], spot.level[1]);
    const heirloom = SPECIES[species].huff > 0 && nextRandom(dice) < HEIRLOOM.odds;
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
 * right level, the right number of others, each from that stop's list and at
 * its levels. A save cannot swap a boss for something soft.
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
      if (!spot.pool.some(([id]) => id === foe.species) || foe.level < spot.level[0] || foe.level > spot.level[1]) return false;
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
    } else if (state.visit || here !== room.id) {
      held.push(...area.posts);
    }
  }
  return held;
}

/** Whether a group can be met now: it is still there, and the boss only once everyone else is calm. */
export function canMeet(visit, room, index) {
  if (!visit || !Number.isInteger(index) || index < 0 || index >= room.path.length || visit.groups[index].done) return false;
  return index < room.path.length - 1 || visit.stop >= room.path.length - 1;
}

/** The group a sensible visitor meets next: the nearest stop to the gate still restless, the boss last. Or -1. */
export function nextGroup(visit, room) {
  for (let i = 0; i < room.path.length; i++) if (canMeet(visit, room, i)) return i;
  return -1;
}

/**
 * Steps into a place with the team rested. Everyone who is restless there is
 * rolled now, one group for each stop of its path, so they can all be seen
 * standing about before any of them is met. `stop` counts the groups calmed
 * so far. Returns false if the place is not open.
 */
export function enterRoom(state, roomId) {
  if (state.visit || !roomOpen(state, roomId) || teamOf(state).length === 0) return false;
  const room = roomOf(roomId);
  state.visit = {
    room: roomId, stop: 0,
    hp: Object.fromEntries(teamOf(state).map((friend) => [friend.id, maxHpOf(friend)])),
    groups: room.path.map((_, stop) => ({ foes: rollEncounter(state, room, stop), done: false })),
  };
  state.rooms[roomId].visits++;
  return true;
}

/** Rests at home. Everyone is fresh the next time they set out, and whoever was calmed is restless again. */
export function leaveRoom(state) {
  if (!state.visit) return false;
  state.visit = null;
  return true;
}

/**
 * Moves the visit on after a fight with group `index`. `left` maps friend id
 * to the Health it finished with. A win calms that group and everyone takes a
 * breather, or the place is cleared and the visit over once its boss is
 * calmed; a loss ends the visit at home.
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
  visit.stop = visit.groups.filter((group) => group.done).length;
  record.best = Math.max(record.best, visit.stop);
  if (index === room.path.length - 1) {
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
