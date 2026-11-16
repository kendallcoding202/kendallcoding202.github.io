// The game as one object: it owns the save and exposes every action a player
// can take. No DOM, no storage, no clock of its own (the caller passes the
// time in), which is what makes it testable.
import { TEAM_SIZE, NAME_LENGTH, lookOf, roomOf } from './balance.js';
import { createBattle, choices, act, concede } from './battle.js';
import { settleUp } from './progress.js';
import { rollEncounter, fairEncounter, enterRoom, leaveRoom, afterFight, canMeet, nextGroup, heldBy, roomOpen, teamOf, maxHpOf } from './rooms.js';
import { WORLD, POST, stepWalk, routeTo, straighten, roomy, standing, canStand, spotNear, spotOf, districtOf, districtAt, postNear, personNear, personAt, TALK } from './world.js';
import { goalOf, aimOf, storySoFar, hasNews, talk, takeCall } from './story.js';

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
    this.facing = -1; // which group that fight is with
  }

  /**
   * How things stand: in a 'fight'; out on a 'path' (you have stepped into a place and not yet
   * rested, wherever you have since walked); or at ease in the 'lane'.
   */
  place() {
    if (this.battle) return 'fight';
    return this.state.visit ? 'path' : 'lane';
  }

  // ------------------------------------------------------------ walking the world

  /** The ground being held just now: by whoever is waiting, in every place, and by any barricade. See rooms.heldBy. */
  held() { return heldBy(this.state); }

  /**
   * Walks toward a point for `dt` seconds. Returns whether you moved. Never during a fight.
   * Step through an open place's gate, rested, and your visit to it begins.
   */
  walk(target, dt) {
    const { state } = this;
    if (this.place() === 'fight' || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
    const from = districtAt(state.where);
    const next = stepWalk(state.where, target, dt, standing(this.held()));
    state.where = { x: next.x, y: next.y };
    const into = districtAt(state.where);
    if (into && into !== from && !state.visit) enterRoom(state, into);
    return next.moving;
  }

  /** Where you are standing. Null during a fight. */
  standing() { return this.place() === 'fight' ? null : this.state.where; }

  /** The place you are inside (a room id), or null out in the lane. */
  district() { return districtAt(this.state.where); }

  /** The way to walk to a point from where you stand, round whatever is between: points to head for in turn. */
  routeTo(target) {
    const from = this.standing();
    if (!from || !target) return [];
    // Brushing past a group is meeting it. So the way gives everyone a wide berth, except whoever
    // you are heading for, and whoever you are already standing beside (you have to get away somehow).
    const berth = POST.meet + 14;
    const beside = (post, point) => Math.hypot(point.x - post.x, point.y - post.y) <= berth;
    const all = this.held();
    const wide = (start) => all.map((post) => (post.r || beside(post, target) || beside(post, start) ? post : { x: post.x, y: post.y, r: berth }));
    // And it is found with room to spare on every side; walking it then touches nothing.
    const find = (start, to, can) => straighten(start, routeTo(start, to, can, WORLD), can);
    const into = districtAt(target);
    const area = districtOf(into);
    if (!area || !area.narrow) return find(from, target, roomy(standing(wide(from))));

    // A narrow place is one group wide, with no going round anyone. "As near as feet can get" to a
    // point beyond someone would be the far side of its wall, out in the lane, which is not what a
    // tap up the alley means. So the way there goes to its gate, and from then on stays inside it
    // (a narrow place is entered from its foot); and if someone stands in the way, it walks up to
    // them: whoever blocks the way is who you meet.
    const inside = (x, y) => x >= area.x && x < area.x + area.w && y >= area.y && y <= area.gate.y + WORLD.reach + 46;
    const lead = [];
    let start = from;
    if (!inside(from.x, from.y)) {
      const door = spotOf(into).door;
      lead.push(...find(from, door, roomy(standing(wide(from)))));
      start = lead.length ? lead[lead.length - 1] : from;
      if (Math.hypot(start.x - door.x, start.y - door.y) > 40) return lead;
    }
    const kept = (can) => (x, y) => inside(x, y) && can(x, y);
    const short = (way) => { const end = way.length ? way[way.length - 1] : start; return Math.hypot(end.x - target.x, end.y - target.y); };
    const careful = kept(roomy(standing(wide(start))));
    let rest = find(start, target, careful);
    if (short(rest) > 40) {
      const plain = kept(roomy(standing(all)));
      const near = find(start, target, plain);
      if (short(near) < short(rest) - 20) rest = near;
    }
    return [...lead, ...rest];
  }

  /** On a visit: the group you have walked up to and can meet (its number), or -1. */
  meeting() {
    const visit = this.state.visit;
    if (this.place() !== 'path') return -1;
    const room = roomOf(visit.room);
    return postNear(districtOf(visit.room).posts.map((post, i) => (canMeet(visit, room, i) ? post : null)), this.state.where);
  }

  /** The group a sensible visitor would meet next (its number), or -1. */
  nextGroup() { return this.place() === 'path' ? nextGroup(this.state.visit, roomOf(this.state.visit.room)) : -1; }

  /** Goes straight up to a group: the next one, unless told which. For the simulator and tests; a player walks. */
  approach(index = this.nextGroup()) {
    const visit = this.state.visit;
    if (this.place() !== 'path' || !canMeet(visit, roomOf(visit.room), index)) return false;
    const post = districtOf(visit.room).posts[index];
    const held = this.held();
    // Stand just short of them: straight below, or failing that either side or above.
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = post.x + dx * (POST.hold + 8);
      const y = post.y + dy * (POST.hold + 8);
      if (canStand(x, y, held)) { this.state.where = { x, y }; return true; }
    }
    return false;
  }

  /** The place whose door or gate you are standing at: 'home', a room id, or null. */
  near() { return spotNear(this.state.where); }

  /** Goes straight to a place's door. For the simulator and tests; a player walks. */
  standAt(spotId) {
    const spot = spotOf(spotId);
    if (this.place() === 'fight' || !spot) return false;
    this.state.where = { x: spot.door.x, y: spot.door.y };
    return true;
  }

  /** Goes straight through a place's gate, rested, and so begins a visit. For the simulator and tests. */
  travelTo(roomId) {
    const district = districtOf(roomId);
    if (this.place() !== 'lane' || !district || !roomOpen(this.state, roomId)) return false;
    this.state.where = { x: district.gate.x, y: district.gate.y - 70 };
    return enterRoom(this.state, roomId);
  }

  // ------------------------------------------------------------ the story

  /** The thing to do next, and the aim of the whole game: see story.js. */
  goal() { return goalOf(this.state); }
  aim() { return aimOf(this.state); }
  journal() { return storySoFar(this.state); }

  /** The neighbour you are standing near enough to talk to (their id), or null. Nobody during a fight. */
  personNear() { return this.place() === 'fight' ? null : personNear(this.state.where); }
  hasNews(who) { return hasNews(this.state, who); }

  /** Talks to whoever you are standing by. Returns what they say (lines of { who, text }), or null. */
  talkTo(who) { return this.personNear() === who ? talk(this.state, who) : null; }

  /** Takes great-aunt Maribel's first call, once the game has begun. Its lines the first time; null after. */
  takeCall() { return this.state.started && this.place() !== 'fight' ? takeCall(this.state) : null; }

  /** Goes straight up to a neighbour. For the simulator and tests; a player walks. */
  standBy(who) {
    const person = personAt(who);
    if (this.place() === 'fight' || !person) return false;
    const held = this.held();
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = person.x + dx * (TALK - 20);
      const y = person.y + dy * (TALK - 20);
      if (canStand(x, y, held)) { this.state.where = { x, y }; return true; }
    }
    return false;
  }

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
   * Chooses who walks with you: one to three friend ids, each once. Only when
   * rested: nobody is swapped half way through a visit.
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

  /**
   * Rests at home, which ends a visit: everyone is fresh, and whoever was calmed is restless
   * again. You have to be standing at home's door.
   */
  rest() { return this.place() === 'path' && this.near() === 'home' && leaveRoom(this.state); }

  /** Goes straight home and rests. For the simulator and tests; a player walks there. */
  goHome() {
    if (this.place() !== 'path') return false;
    this.standAt('home');
    return leaveRoom(this.state);
  }

  /** The Health each team member has right now: as the visit has left it, or full when rested. */
  teamHealth() {
    const visit = this.state.visit;
    return this.team().map((friend) => ({ id: friend.id, max: maxHpOf(friend), hp: visit ? Math.min(maxHpOf(friend), visit.hp[friend.id] || 0) : maxHpOf(friend) }));
  }

  // ------------------------------------------------------------ fights

  /**
   * Meets a group: the next one, unless told which. Returns the fight, or null.
   * (The screen calls this when you walk into them; see `meeting`.)
   */
  startEncounter(index = this.nextGroup()) {
    if (this.place() !== 'path') return null;
    const { state } = this;
    const visit = state.visit;
    const room = roomOf(visit.room);
    if (!canMeet(visit, room, index)) return null;
    const group = visit.groups[index];
    if (!fairEncounter(room, index, group.foes)) group.foes = rollEncounter(state, room, index);
    for (const foe of group.foes) {
      state.book[foe.species].met = true;
      if (foe.heirloom) state.book[foe.species].heirloom = true;
    }
    const allies = this.team().map((friend) => ({ species: friend.species, level: friend.level, hp: visit.hp[friend.id] || 0, friendId: friend.id, heirloom: friend.heirloom }));
    this.facing = index;
    this.battle = createBattle(state, { allies, foes: group.foes, fx: this.fx });
    return this.battle;
  }

  choices() { return this.battle ? choices(this.battle) : null; }
  act(action) { return !!this.battle && act(this.battle, action); }
  concede() { return !!this.battle && concede(this.battle); }

  /**
   * Banks a fight that is over. After a win you are where you were, with that
   * group calmed (and the place cleared if it was the boss); after a loss the
   * team is carried home to rest. Returns what happened, or null if there is
   * no finished fight.
   */
  finishBattle() {
    const { battle, state } = this;
    if (!battle || battle.phase === 'fight') return null;
    const summary = settleUp(state, battle);
    const left = {};
    for (const unit of battle.units) if (unit.side === 'ally') left[unit.friendId] = unit.hp;
    const room = state.visit.room;
    const stop = this.facing;
    const moved = afterFight(state, stop, summary.won, left);
    if (!summary.won) state.where = { ...spotOf('home').door };
    for (const friend of state.friends) if (friend.heirloom) state.book[friend.species].heirloom = true;
    this.battle = null;
    this.facing = -1;
    return { ...summary, room, stop, cleared: moved.cleared, home: moved.home };
  }

  // ------------------------------------------------------------ misc

  serialize(now = this.now) {
    this.state.lastSeen = now;
    return JSON.stringify(this.state);
  }
}
