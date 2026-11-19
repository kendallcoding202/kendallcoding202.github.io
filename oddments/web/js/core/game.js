// The game as one object: it owns the save and exposes every action a player
// can take. No DOM, no storage, no clock of its own (the caller passes the
// time in), which is what makes it testable.
import { TEAM_SIZE, NAME_LENGTH, lookOf, roomOf, roomBuilt } from './balance.js';
import { createBattle, choices, act, concede } from './battle.js';
import { settleUp } from './progress.js';
import { rollEncounter, fairEncounter, enterRoom, leaveRoom, afterFight, canMeet, nextGroup, heldBy, heldIn, roomOpen, bridgeOpen, livelyPlace, placeCalm, staysCalm, calmedIn, teamOf, maxHpOf, rested, healthOf } from './rooms.js';
import { rollStrays, fairStrays, fairGroup, keepsakeOut, straysAbout, strayNear, afterStrays, afterOpen } from './strays.js';
import { TANSY, rivalAbout, rivalTeam, rivalSays, rivalAfter, rivalAside, rivalHeard } from './rival.js';
import { RIVAL, SPECIES, ROSTER_MAX } from './balance.js';
import { newFriend } from './progress.js';
import { isChief, wishOf, wishList, chiefsOut, chiefLevel, chiefSeen, chiefJoins, chiefWon, chiefAsides, teamKeepsTo } from './wishes.js';
import { STRAYS } from './balance.js';
import { insideOf, stepIn, routeIn, spotIn, onMat, besidePost } from './indoors.js';
import { WORLD, POST, BENCHES, SIT, MAILBOXES, POST_REACH, stepWalk, routeTo, straighten, roomy, standing, canStand, spotNear, spotOf, districtOf, districtAt, postNear, personNear, personAt, benchNear, mailNear, TALK } from './world.js';
import { goalOf, aimOf, storySoFar, hasNews, talk, takeCall, callDue, asideOf, tonightOf } from './story.js';
import { nameOf, giveName, tidyName } from './names.js';

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
    this.wild = -1; // or, if it is with strays out on the lane, which of them
    this.bout = null; // or, if it is a bout with somebody who was waiting out in the open, who: { who, meeting } for Tansy Brisk, { who, chief: true, level } for a ringleader
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
    if (state.indoors) {
      // Indoors you walk that floor, and stepping onto the door mat is stepping out.
      const room = insideOf(state.indoors.id);
      const next = stepIn(room, state.indoors, target, dt, this.heldIndoors());
      state.indoors.x = next.x;
      state.indoors.y = next.y;
      if (next.moving && onMat(room, next)) this.leave();
      return next.moving;
    }
    const from = districtAt(state.where);
    const next = stepWalk(state.where, target, dt, standing(this.held()));
    state.where = { x: next.x, y: next.y };
    const into = districtAt(state.where);
    if (into && into !== from && !state.visit) enterRoom(state, into);
    return next.moving;
  }

  /** Where you are standing: out in the lane, or on the floor of whatever you are inside. Null during a fight. */
  standing() {
    if (this.place() === 'fight') return null;
    return this.state.indoors ? { x: this.state.indoors.x, y: this.state.indoors.y } : this.state.where;
  }

  // ------------------------------------------------------------ indoors

  /** The building you are inside ('home', or a place's id), or null out in the lane. */
  indoors() { return this.state.indoors ? this.state.indoors.id : null; }

  /** The ground being held on the floor you are on: whoever is still waiting there. */
  heldIndoors() {
    const id = this.indoors();
    return id ? heldIn(this.state, id, insideOf(id).posts) : [];
  }

  /**
   * Whether you may go into a building from its door, and if not why: 'shut' (not yet open, or
   * not built), 'elsewhere' (you are out calling on another place and have not rested), or 'away'
   * (you are not at its door). True if you may.
   */
  mayEnter(id) {
    const inside = insideOf(id);
    if (!inside || this.place() === 'fight' || this.state.indoors || this.near() !== id) return 'away';
    const room = roomOf(id);
    if (!room) return true;
    if (!roomBuilt(room) || !roomOpen(this.state, id)) return 'shut';
    return this.state.visit && this.state.visit.room !== id ? 'elsewhere' : true;
  }

  /** Goes in through the door you are standing at. Stepping into a place, rested, begins a visit to it. */
  enter(id) {
    if (this.mayEnter(id) !== true) return false;
    const { state } = this;
    const inside = insideOf(id);
    state.where = { ...spotOf(id).door };
    state.indoors = { id, x: inside.start.x, y: inside.start.y };
    if (roomOf(id) && !state.visit) enterRoom(state, id);
    return true;
  }

  /** Steps out: you are in the lane again, at the door you went in by. */
  leave() {
    if (!this.state.indoors || this.place() === 'fight') return false;
    this.state.indoors = null;
    return true;
  }

  /** What you are standing by indoors (a bed, a telephone: { id, does }), or null. */
  spotNear() {
    const id = this.indoors();
    return id && this.place() !== 'fight' ? spotIn(insideOf(id), this.state.indoors) : null;
  }

  /** The place you are inside (a room id), or null out in the lane. */
  district() { return districtAt(this.state.where); }

  /** The way to walk to a point from where you stand, round whatever is between: points to head for in turn. */
  routeTo(target) {
    const from = this.standing();
    if (!from || !target) return [];
    if (this.state.indoors) {
      // The same care indoors: a wide berth round every group but the one you are heading for.
      const wide = POST.meet + 14;
      const close = (post, point) => Math.hypot(point.x - post.x, point.y - post.y) <= wide;
      return routeIn(insideOf(this.state.indoors.id), from, target, this.heldIndoors().map((post) => (close(post, target) || close(post, from) ? post : { x: post.x, y: post.y, r: wide })));
    }
    // Brushing past a group is meeting it. So the way gives everyone a wide berth, except whoever
    // you are heading for, and whoever you are already standing beside (you have to get away somehow).
    const berth = POST.meet + 14;
    const beside = (post, point) => Math.hypot(point.x - post.x, point.y - post.y) <= berth;
    const all = this.held();
    // Strays hold no ground, but walking into one is meeting it: so the way goes round any you are
    // not heading for (a tap on one, or right beside it, is heading for it).
    const round = (start) => this.strays().filter((stray) => Math.hypot(target.x - stray.x, target.y - stray.y) > STRAYS.meet + 24 && Math.hypot(start.x - stray.x, start.y - stray.y) > STRAYS.berth)
      .map((stray) => ({ x: stray.x, y: stray.y, r: STRAYS.berth }));
    const wide = (start) => [...all.map((post) => (post.r || beside(post, target) || beside(post, start) ? post : { x: post.x, y: post.y, r: berth })), ...round(start)];
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
    const can = (post, i) => (canMeet(visit, room, i) ? post : null);
    // Whoever waits indoors is met indoors, on that floor; whoever waits out in the lane, out in the lane.
    const inside = insideOf(visit.room);
    if (inside) return this.indoors() === visit.room ? postNear(inside.posts.map(can), this.state.indoors) : -1;
    return this.state.indoors ? -1 : postNear(districtOf(visit.room).posts.map(can), this.state.where);
  }

  /** The group a sensible visitor would meet next (its number), or -1. */
  nextGroup() { return this.place() === 'path' ? nextGroup(this.state.visit, roomOf(this.state.visit.room)) : -1; }

  /** Goes straight up to a group: the next one, unless told which. For the simulator and tests; a player walks. */
  approach(index = this.nextGroup()) {
    const visit = this.state.visit;
    if (this.place() !== 'path' || !canMeet(visit, roomOf(visit.room), index)) return false;
    const inside = insideOf(visit.room);
    if (inside) {
      if (this.indoors() !== visit.room) return false;
      const at = besidePost(inside, inside.posts[index], this.heldIndoors());
      if (at) { this.state.indoors.x = at.x; this.state.indoors.y = at.y; }
      return !!at;
    }
    if (this.state.indoors) return false;
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

  // ------------------------------------------------------------ strays

  /** Whoever is still out on the lane this time: [{ index, x, y, foes }]. */
  strays() { return straysAbout(this.state); }

  /** The strays you have walked right up to and can meet (their number), or -1. Never from indoors, or in a fight. */
  strayNear() { return this.place() === 'fight' || this.state.indoors ? -1 : strayNear(this.state, this.state.where); }

  /** Something worth doing beside the goal: a Keepsake is out, and where. { title, detail, keep }, or null. */
  aside() { const out = keepsakeOut(this.state); return asideOf(out, !!out && this.state.book[out.species].met); }

  /** The Keepsake that is out just now ({ index, keep, species, heirloom }), or null. */
  keepsake() { return keepsakeOut(this.state); }

  /** Goes straight up to a group of strays. For the simulator and tests; a player walks. */
  approachStrays(index) {
    const stray = this.strays().find((one) => one.index === index);
    if (this.place() === 'fight' || !stray) return false;
    this.state.indoors = null;
    this.state.where = { x: stray.x, y: stray.y + STRAYS.meet - 12 };
    return true;
  }

  /** Meets the strays you have walked up to. Returns the fight, or null. */
  startStrays(index = this.strayNear()) {
    if (this.place() === 'fight' || this.strayNear() !== index || index < 0) return null;
    const { state } = this;
    const stray = state.strays[index];
    if (!fairGroup(state, stray)) { rollStrays(state); return null; }
    for (const foe of stray.foes) {
      state.book[foe.species].met = true;
      if (foe.heirloom) state.book[foe.species].heirloom = true;
      if (foe.grown) state.book[foe.species].grown = true;
    }
    const health = healthOf(state);
    const allies = this.team().map((friend) => ({ species: friend.species, level: friend.level, hp: health[friend.id], friendId: friend.id, heirloom: friend.heirloom, name: nameOf(friend), grown: !!friend.grown }));
    if (!allies.some((ally) => ally.hp > 0)) return null;
    this.wild = index;
    this.facing = -1;
    this.battle = createBattle(state, { allies, foes: stray.foes, fx: this.fx });
    return this.battle;
  }

  // ------------------------------------------------------------ whoever waits by the road

  /**
   * Whoever is standing out in the open to be walked up to just now: [{ id, x, y, due }]. `due` is
   * the bout they want (for Tansy Brisk, which of her meetings; for a ringleader, 0 once its wish is
   * granted), or -1 if there is none to be had yet. A ringleader (`chief`) is taking the air outside
   * its own place (`room`), which is calm.
   */
  waiting() {
    const { state } = this;
    const list = chiefsOut(state).map((one) => ({ id: one.species, chief: true, room: one.room, x: one.x, y: one.y, due: one.granted ? 0 : -1 }));
    const tansy = rivalAbout(state);
    // (Having just lost, she stands where she was, with `owes`: the meeting she has still to have her say about.)
    if (tansy) list.push({ id: TANSY, ...tansy });
    return list;
  }

  /**
   * A ringleader's wish and how it stands: { wish, how, have, need, granted, seen, level }, `seen` what
   * is seen of it outside its place just now and `level` how strong it would be in its friendly bout.
   * Null for anybody else.
   */
  wish(species) {
    const wish = wishOf(this.state, species);
    return wish ? { ...wish, seen: chiefSeen(this.state, species), level: chiefLevel(this.state, species) } : null;
  }

  /** Whoever had something still to say about a bout they lost has said it. Returns whether they had. */
  heardOut(id = TANSY) { return id === TANSY ? rivalHeard(this.state) : false; }

  /** The one of them you are standing near enough to talk to (their id), or null. Nobody during a fight, or from indoors. */
  waitingNear() {
    if (this.place() === 'fight' || this.state.indoors) return null;
    const { x, y } = this.state.where;
    const near = this.waiting().find((one) => Math.hypot(one.x - x, one.y - y) <= TALK);
    return near ? near.id : null;
  }

  /** Every ringleader's wish and how it stands, in the order of their places: see wishes.wishList. */
  wishes() { return wishList(this.state); }

  /** What the one you are standing by has to say: lines of { who, text }. Hearing it changes nothing. Null from anywhere else. */
  hail(id = this.waitingNear()) { return id === TANSY && this.waitingNear() === id ? rivalSays(this.state) : null; }

  /** Whether the one you are standing by wants a bout: `startBout` would begin one. */
  boutDue(id = this.waitingNear()) {
    const one = id && this.waitingNear() === id ? this.waiting().find((each) => each.id === id) : null;
    return !!one && one.due >= 0;
  }

  /**
   * Has it out with whoever you are standing by: their three against yours, as worn as yours are.
   * Nobody of theirs can be reached. Returns the fight, or null.
   */
  startBout(id = this.waitingNear()) {
    if (!this.boutDue(id)) return null;
    const { state } = this;
    const chief = isChief(id);
    const meeting = this.waiting().find((each) => each.id === id).due;
    // A ringleader's friendly bout is it alone, as it ever was in its own place, at the strength it has kept up to.
    const foes = chief ? [{ species: id, level: chiefLevel(state, id), heirloom: false }] : rivalTeam(meeting);
    const health = healthOf(state);
    const allies = this.team().map((friend) => ({ species: friend.species, level: friend.level, hp: health[friend.id], friendId: friend.id, heirloom: friend.heirloom, name: nameOf(friend), grown: !!friend.grown }));
    if (!allies.some((ally) => ally.hp > 0)) return null;
    for (const foe of foes) {
      state.book[foe.species].met = true;
      if (foe.grown) state.book[foe.species].grown = true;
    }
    this.bout = chief ? { who: id, chief: true, level: foes[0].level } : { who: id, meeting };
    this.wild = -1;
    this.facing = -1;
    this.battle = createBattle(state, { allies, foes, fx: this.fx });
    return this.battle;
  }

  /** Goes straight up to whoever is waiting. For the simulator and tests; a player walks. */
  standByWaiting(id) {
    const one = this.waiting().find((each) => each.id === id);
    if (this.place() === 'fight' || !one) return false;
    const held = this.held();
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = one.x + dx * (TALK - 20);
      const y = one.y + dy * (TALK - 20);
      if (canStand(x, y, held)) { this.state.where = { x, y }; this.state.indoors = null; return true; }
    }
    return false;
  }

  /** Other things worth doing beside the goal and the Keepsake: [{ id, title, detail, art }]. (Tansy Brisk is waiting; a ringleader has its wish.) */
  also() { return [rivalAside(this.state), ...chiefAsides(this.state)].filter(Boolean); }

  /** Whether everyone is rested: not out on a visit, and not worn from meeting strays. */
  rested() { return rested(this.state); }

  /** The place whose door or gate you are standing at: 'home', a room id, or null. */
  near() { return spotNear(this.state.where); }

  /** Goes straight to a place's door. For the simulator and tests; a player walks. */
  standAt(spotId) {
    const spot = spotOf(spotId);
    if (this.place() === 'fight' || !spot) return false;
    this.state.where = { x: spot.door.x, y: spot.door.y };
    this.state.indoors = null;
    return true;
  }

  /** Goes straight through a place's gate, rested, and so begins a visit. For the simulator and tests. */
  travelTo(roomId) {
    // A place you walk into by its door: to the door, and in.
    if (insideOf(roomId) && roomOf(roomId)) return this.place() === 'lane' && this.standAt(roomId) && this.enter(roomId);
    const district = districtOf(roomId);
    if (this.place() !== 'lane' || !district || !roomOpen(this.state, roomId)) return false;
    this.state.indoors = null;
    this.state.where = { x: district.gate.x, y: district.gate.y - 70 };
    return enterRoom(this.state, roomId);
  }

  // ------------------------------------------------------------ the story

  /** The thing to do next, and the aim of the whole game: see story.js. */
  goal() { return goalOf(this.state); }
  aim() { return aimOf(this.state); }
  journal() { return storySoFar(this.state); }

  /** The neighbour you are standing near enough to talk to (their id), or null. Nobody during a fight, or from indoors. */
  personNear() { return this.place() === 'fight' || this.state.indoors ? null : personNear(this.state.where); }
  hasNews(who) { return hasNews(this.state, who); }

  /** Talks to whoever you are standing by. Returns what they say (lines of { who, text }), or null. */
  talkTo(who) { return this.personNear() === who ? talk(this.state, who) : null; }

  /** The mailbox you are standing at (its number), or -1. Never from indoors, or in a fight. */
  mailNear() { return this.place() === 'fight' || this.state.indoors ? -1 : mailNear(this.state.where); }

  /**
   * Posts Ines Tock a note from the mailbox you are standing at, and has her answer by return:
   * what she would have said had you walked back and told her. Only once you have met her, and
   * only when there is news she has not heard. Returns her lines, or null.
   */
  postToInes() {
    if (this.mailNear() < 0 || this.state.story.ines === 0 || !hasNews(this.state, 'ines')) return null;
    return talk(this.state, 'ines');
  }

  /** Goes straight to a mailbox. For the simulator and tests; a player walks. */
  standAtMail(index) {
    const box = MAILBOXES[index];
    if (this.place() === 'fight' || !box) return false;
    const held = this.held();
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = box.x + dx * (POST_REACH - 30);
      const y = box.y + dy * (POST_REACH - 30);
      if (canStand(x, y, held)) { this.state.where = { x, y }; this.state.indoors = null; return true; }
    }
    return false;
  }

  /** Takes great-aunt Maribel's first call, once the game has begun. Its lines the first time; null after. */
  takeCall() { return this.state.started && this.place() !== 'fight' ? takeCall(this.state) : null; }

  /**
   * Says what day it is: a whole number that goes up by one each real day, by the player's own
   * clock (the rules keep no clock). Which calm place is lively follows from it. Returns whether
   * the day changed. Anything that is not a whole, positive number is ignored.
   */
  setDay(day) {
    if (!Number.isInteger(day) || !(day > 0) || day >= 1e6 || day === this.state.day) return false;
    this.state.day = day;
    return true;
  }

  /** What is different today: { title, detail, room }, or null. */
  tonight() { return tonightOf(livelyPlace(this.state)); }

  /** The place that is lively today (its id), or null. */
  lively() { const room = livelyPlace(this.state); return room ? room.id : null; }

  /** Whether the gate on Kettle Bridge stands open: the whole lane is calm. */
  bridgeOpen() { return bridgeOpen(this.state); }

  /** Whether the telephone is ringing: the first call, or the one that opens the far bank. */
  callDue() { return callDue(this.state); }

  /** Goes straight up to a neighbour. For the simulator and tests; a player walks. */
  standBy(who) {
    const person = personAt(who);
    if (this.place() === 'fight' || !person) return false;
    const held = this.held();
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = person.x + dx * (TALK - 20);
      const y = person.y + dy * (TALK - 20);
      if (canStand(x, y, held)) { this.state.where = { x, y }; this.state.indoors = null; return true; }
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
    const clean = tidyName(name === undefined || name === null ? '' : String(name)); // one line, no unseen characters, as for a friend's name
    if (clean) player.name = clean;
    if (look !== undefined) player.look = lookOf(look);
    return { name: player.name, look: player.look };
  }

  // ------------------------------------------------------------ friends

  friend(id) { return this.state.friends.find((friend) => friend.id === id) || null; }

  /**
   * Gives a friend a name of your own ('' takes it away again, and it goes by its kind's).
   * Not in the middle of a fight. Returns what it is called now, or null if there is no such friend.
   */
  nameFriend(id, text) {
    const friend = this.friend(id);
    return !friend || this.place() === 'fight' ? null : giveName(friend, text);
  }
  team() { return teamOf(this.state); }

  /**
   * Chooses who walks with you: one to three friend ids, each once. Only when
   * rested: nobody is swapped half way through a visit.
   */
  setTeam(ids) {
    if (this.mayTeam(ids) !== true) return false;
    this.state.team = [...ids];
    return true;
  }

  /**
   * Whether these may be the team, and if not why: 'worn' (not rested), 'wrong' (not one to three
   * friends, each once), or 'chiefs' (more ringleaders than walk with you at once). True if they may.
   */
  mayTeam(ids) {
    if (this.place() !== 'lane' || this.state.worn) return 'worn';
    if (!Array.isArray(ids)) return 'wrong';
    const team = ids.filter((id, i) => this.friend(id) && ids.indexOf(id) === i);
    if (team.length !== ids.length || team.length < 1 || team.length > TEAM_SIZE) return 'wrong';
    return teamKeepsTo(this.state, team) ? true : 'chiefs';
  }

  // ------------------------------------------------------------ rooms

  roomOpen(roomId) { return roomOpen(this.state, roomId); }

  /** Whether one stop of a place has been calmed (and so stays calm), and how many of its stops have. */
  staysCalm(roomId, stop) { return staysCalm(this.state, roomId, stop); }
  calmedIn(roomId) { return calmedIn(this.state, roomId); }

  /**
   * Rests, which ends a visit: everyone is fresh. Whoever was calmed stays calm, and other
   * strays will be out. You have to be standing at home's door, or at a bench, with something
   * to rest from.
   */
  rest() {
    if (this.place() === 'fight' || (this.near() !== 'home' && !this.benchNear()) || !leaveRoom(this.state)) return false;
    rollStrays(this.state);
    return true;
  }

  /** The bench you are standing at (see world.BENCHES), or null. Never from indoors, or in a fight. */
  benchNear() { return this.place() === 'fight' || this.state.indoors ? null : benchNear(this.state.where); }

  /** Goes straight to a bench. For the simulator and tests; a player walks. */
  standAtBench(id) {
    const bench = BENCHES.find((one) => one.id === id);
    if (this.place() === 'fight' || !bench) return false;
    const held = this.held();
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const x = bench.x + dx * (SIT - 30);
      const y = bench.y + dy * (SIT - 30);
      if (canStand(x, y, held)) { this.state.where = { x, y }; this.state.indoors = null; return true; }
    }
    return false;
  }

  /** Goes straight home and rests. For the simulator and tests; a player walks. */
  goHome() {
    if (this.place() === 'fight' || this.rested()) return false;
    this.standAt('home');
    return this.rest();
  }

  /** The Health each team member has right now: as the visit has left it, or the lane, or full when rested. */
  teamHealth() {
    const health = healthOf(this.state);
    return this.team().map((friend) => ({ id: friend.id, max: maxHpOf(friend), hp: health[friend.id] }));
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
    if (!fairEncounter(room, index, group.foes)) group.foes = rollEncounter(state, room, index, placeCalm(state, room.id));
    for (const foe of group.foes) {
      state.book[foe.species].met = true;
      if (foe.heirloom) state.book[foe.species].heirloom = true;
      if (foe.grown) state.book[foe.species].grown = true;
    }
    const allies = this.team().map((friend) => ({ species: friend.species, level: friend.level, hp: visit.hp[friend.id] || 0, friendId: friend.id, heirloom: friend.heirloom, name: nameOf(friend), grown: !!friend.grown }));
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
    if (this.bout && this.bout.chief) {
      // A ringleader's friendly bout: won, it comes home with you, at the strength it fought at;
      // lost, you are carried home, and it will be there (a wish granted stays granted).
      const { who, level } = this.bout;
      const moved = afterOpen(state, summary.won, left);
      let joined = false;
      if (summary.won && !state.friends.some((friend) => friend.species === who) && state.friends.length < ROSTER_MAX) {
        const friend = newFriend(state.nextFriendId++, who, level, false);
        state.friends.push(friend);
        summary.joined.push({ id: friend.id, species: who, level, heirloom: false, grown: false });
        state.stats.befriended++;
        joined = true;
      }
      if (moved.home) { state.where = { ...spotOf('home').door }; state.indoors = null; rollStrays(state); }
      for (const friend of state.friends) if (friend.heirloom) state.book[friend.species].heirloom = true;
      this.battle = null;
      this.bout = null;
      return { ...summary, room: null, stop: -1, cleared: false, home: moved.home, chief: { species: who, joined, text: summary.won ? chiefJoins(who) : chiefWon(who) } };
    }
    if (this.bout) {
      // A bout with somebody who was waiting by the road: won, that meeting is done with, and everyone
      // takes a breather where they stand; lost, you are carried home, and they will be waiting still.
      const { meeting } = this.bout;
      const moved = afterOpen(state, summary.won, left);
      if (summary.won) state.story.rival = Math.min(RIVAL.meetings.length, Math.max(state.story.rival, meeting + 1));
      if (moved.home) { state.where = { ...spotOf('home').door }; state.indoors = null; rollStrays(state); }
      for (const friend of state.friends) if (friend.heirloom) state.book[friend.species].heirloom = true;
      this.battle = null;
      this.bout = null;
      return { ...summary, room: null, stop: -1, cleared: false, home: moved.home, rival: { meeting, ...rivalAfter(meeting, summary.won) } };
    }
    if (this.wild >= 0) {
      // Strays, out on the lane: calm, they are gone until you next rest; worn out, you are carried home.
      const keepsake = state.strays[this.wild].keep ? state.strays[this.wild].foes[0].species : null;
      const moved = afterStrays(state, this.wild, summary.won, left);
      if (moved.home) { state.where = { ...spotOf('home').door }; state.indoors = null; rollStrays(state); }
      for (const friend of state.friends) if (friend.heirloom) state.book[friend.species].heirloom = true;
      this.battle = null;
      this.wild = -1;
      return { ...summary, room: null, stop: -1, cleared: false, home: moved.home, strays: true, keepsake };
    }
    const room = state.visit.room;
    const stop = this.facing;
    const moved = afterFight(state, stop, summary.won, left);
    if (!summary.won) { state.where = { ...spotOf('home').door }; state.indoors = null; }
    // Rested again (carried home, or the place calmed): others will be out on the lane.
    if (this.rested()) rollStrays(state);
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
