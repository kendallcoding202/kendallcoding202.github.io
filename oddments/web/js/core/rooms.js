// Rooms: who turns up at each stop on a path, and a visit from walking in to
// going home. Rules only: no DOM, no clock, no storage.
import { SPECIES, ROOMS, HEIRLOOM, BREATHER, TEAM_SIZE, roomOf, roomBuilt, statAt } from './balance.js';
import { nextRandom, rollInt, rollPick } from './util.js';

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

/** Walks into a room with the team rested. Returns false if the room is not open. */
export function enterRoom(state, roomId) {
  if (state.visit || !roomOpen(state, roomId) || teamOf(state).length === 0) return false;
  state.visit = { room: roomId, stop: 0, hp: Object.fromEntries(teamOf(state).map((friend) => [friend.id, maxHpOf(friend)])) };
  state.rooms[roomId].visits++;
  return true;
}

/** Goes home. Everyone is rested the next time they set out. */
export function leaveRoom(state) {
  if (!state.visit) return false;
  state.visit = null;
  return true;
}

/**
 * Moves the visit on after a fight. `left` maps friend id to the Health it
 * finished with. A win takes a breather and steps to the next stop, or home
 * with the room cleared after the boss; a loss goes home.
 * Returns { cleared, home }.
 */
export function afterFight(state, won, left) {
  const visit = state.visit;
  const room = roomOf(visit.room);
  const record = state.rooms[visit.room];
  if (!won) {
    record.losses++;
    state.visit = null;
    return { cleared: false, home: true };
  }
  record.best = Math.max(record.best, visit.stop + 1);
  if (visit.stop + 1 >= room.path.length) {
    record.clears++;
    state.visit = null;
    return { cleared: true, home: true };
  }
  visit.stop++;
  for (const friend of teamOf(state)) {
    const max = maxHpOf(friend);
    visit.hp[friend.id] = Math.min(max, Math.max(0, left[friend.id] || 0) + Math.ceil(max * BREATHER));
  }
  return { cleared: false, home: false };
}
