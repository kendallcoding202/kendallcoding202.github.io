// The game as one object: it owns the save and exposes every action a player
// can take. No DOM, no storage, no clock of its own (the caller passes the
// time in), which is what makes it testable.
import { TEAM_SIZE, NAME_LENGTH, lookOf, roomOf } from './balance.js';
import { createBattle, choices, act, concede } from './battle.js';
import { settleUp } from './progress.js';
import { rollEncounter, enterRoom, leaveRoom, afterFight, roomOpen, teamOf, maxHpOf } from './rooms.js';
import { stepWalk, spotNear, spotOf } from './world.js';

export class Game {
  /**
   * @param state a state from newState() or reviveState()
   * @param opts.now wall-clock milliseconds
   * @param opts.fx false to skip recording fight events (headless simulation)
   */
  constructor(state, { now = Date.now(), fx = true } = {}) {
    this.state = state;
    this.now = now;
    this.fx = fx;
    this.battle = null; // the fight in progress; never saved
  }

  /** Where the player is: out in the 'lane', on a room's 'path', or in a 'fight'. */
  place() {
    if (this.battle) return 'fight';
    return this.state.visit ? 'path' : 'lane';
  }

  // ------------------------------------------------------------ the lane

  /** Walks toward a point for `dt` seconds. Returns whether you moved. Only out in the lane. */
  walk(target, dt) {
    if (this.place() !== 'lane' || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const next = stepWalk(this.state.where, target, dt);
    this.state.where = { x: next.x, y: next.y };
    return next.moving;
  }

  /** The place whose door you are standing at: 'home', a room id, or null. */
  near() { return spotNear(this.state.where); }

  /** Goes straight to a place's door. For the simulator and tests; a player walks. */
  standAt(spotId) {
    const spot = spotOf(spotId);
    if (this.place() !== 'lane' || !spot) return false;
    this.state.where = { x: spot.door.x, y: spot.door.y };
    return true;
  }

  /** Goes straight to a room and walks in. For the simulator and tests. */
  travelTo(roomId) { return this.standAt(roomId) && this.enterRoom(roomId); }

  // ------------------------------------------------------------ the house-sitter

  /** Ends the intro. Name and look are the player's; both can be changed later. */
  begin({ name, look } = {}) {
    this.setLook({ name, look });
    this.state.started = true;
    return true;
  }

  setLook({ name, look } = {}) {
    const player = this.state.player;
    const clean = String(name === undefined || name === null ? '' : name).trim().slice(0, NAME_LENGTH);
    if (clean) player.name = clean;
    if (look !== undefined) player.look = lookOf(look);
    return { name: player.name, look: player.look };
  }

  // ------------------------------------------------------------ friends

  friend(id) { return this.state.friends.find((friend) => friend.id === id) || null; }
  team() { return teamOf(this.state); }

  /**
   * Chooses who walks with you: one to three friend ids, each once. Only out
   * in the lane: nobody is swapped half way down a path.
   */
  setTeam(ids) {
    if (this.place() !== 'lane' || !Array.isArray(ids)) return false;
    const team = ids.filter((id, i) => this.friend(id) && ids.indexOf(id) === i);
    if (team.length !== ids.length || team.length < 1 || team.length > TEAM_SIZE) return false;
    this.state.team = team;
    return true;
  }

  // ------------------------------------------------------------ rooms

  roomOpen(roomId) { return roomOpen(this.state, roomId); }
  /** Walks in. You have to be standing at its door. */
  enterRoom(roomId) { return this.place() === 'lane' && this.near() === roomId && enterRoom(this.state, roomId); }
  leaveRoom() { return this.place() === 'path' && leaveRoom(this.state); }

  /** The Health each team member has right now: as left on the path, or full out in the lane. */
  teamHealth() {
    const visit = this.state.visit;
    return this.team().map((friend) => ({ id: friend.id, max: maxHpOf(friend), hp: visit ? Math.min(maxHpOf(friend), visit.hp[friend.id] || 0) : maxHpOf(friend) }));
  }

  // ------------------------------------------------------------ fights

  /** Meets whoever is waiting at this stop on the path. Returns the fight, or null. */
  startEncounter() {
    if (this.place() !== 'path') return null;
    const { state } = this;
    const visit = state.visit;
    const foes = rollEncounter(state, roomOf(visit.room), visit.stop);
    for (const foe of foes) {
      state.book[foe.species].met = true;
      if (foe.heirloom) state.book[foe.species].heirloom = true;
    }
    const allies = this.team().map((friend) => ({ species: friend.species, level: friend.level, hp: visit.hp[friend.id] || 0, friendId: friend.id, heirloom: friend.heirloom }));
    this.battle = createBattle(state, { allies, foes, fx: this.fx });
    return this.battle;
  }

  choices() { return this.battle ? choices(this.battle) : null; }
  act(action) { return !!this.battle && act(this.battle, action); }
  concede() { return !!this.battle && concede(this.battle); }

  /**
   * Banks a fight that is over and moves on: along the path after a win,
   * back out to the lane after a loss or once the room's boss is beaten. Returns what
   * happened, or null if there is no finished fight.
   */
  finishBattle() {
    const { battle, state } = this;
    if (!battle || battle.phase === 'fight') return null;
    const summary = settleUp(state, battle);
    const left = {};
    for (const unit of battle.units) if (unit.side === 'ally') left[unit.friendId] = unit.hp;
    const room = state.visit.room;
    const stop = state.visit.stop;
    const moved = afterFight(state, summary.won, left);
    // Worn out, they are carried home; otherwise you step back out of the door you went in by.
    if (!summary.won) state.where = { ...spotOf('home').door };
    for (const friend of state.friends) if (friend.heirloom) state.book[friend.species].heirloom = true;
    this.battle = null;
    return { ...summary, room, stop, cleared: moved.cleared, home: moved.home };
  }

  // ------------------------------------------------------------ misc

  serialize(now = this.now) {
    this.state.lastSeen = now;
    return JSON.stringify(this.state);
  }
}
