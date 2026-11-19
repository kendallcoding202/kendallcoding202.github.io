// Ringleaders as friends. A ringleader cannot be reached; but once its place
// is calm it takes the air outside, and has a wish. Grant it, win one more
// bout, a friendly one, and it comes home. Only one walks with you at a time.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { playable } from '../../web/js/core/trial.js';
import { makeFighter, choices } from '../../web/js/core/battle.js';
import { SPECIES, SPECIES_IDS, ROOMS, ROOM_IDS, CHIEF, MAX_LEVEL, TEAM_SIZE, statAt, friendHp, xpNeeded } from '../../web/js/core/balance.js';
import { WAITS, RIVAL_AT, WILDS, HAUNTS, PEOPLE, SPOTS, TALK, canStand, districtAt, overTheWater, spotOf } from '../../web/js/core/world.js';
import { WISHES, CHIEFS, isChief, wishOf, wishList, chiefMayJoin, chiefLevel, chiefsOut, chiefSeen, chiefJoins, chiefAsides, chiefsSoFar, teamKeepsTo } from '../../web/js/core/wishes.js';
import { maxHpOf } from '../../web/js/core/rooms.js';
import { newFriend, gainXp } from '../../web/js/core/progress.js';
import { storySoFar } from '../../web/js/core/story.js';

const NOW = 1_800_000_000_000;
const SPRITES = fileURLToPath(new URL('../../web/assets/sprites/', import.meta.url));
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
const calmTo = (game, roomId) => { for (const id of ROOM_IDS.slice(0, ROOM_IDS.indexOf(roomId) + 1)) { game.state.rooms[id].clears = 1; game.state.rooms[id].calmed = 0b11111; } return game; };
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Gives the house-sitter a friend of a kind (at home), as if it had come home from a fight. */
const befriend = (game, species, more = {}) => {
  const state = game.state;
  let friend = state.friends.find((one) => one.species === species);
  if (!friend) { friend = newFriend(state.nextFriendId++, species, more.level || 6); state.friends.push(friend); }
  Object.assign(friend, more);
  state.book[species].met = true;
  return friend;
};
const kindsOf = (roomId) => [...new Set(ROOMS.find((room) => room.id === roomId).path.flatMap((stop) => stop.pool.map(([kind]) => kind)))];
const ORDINARY = SPECIES_IDS.filter((id) => !SPECIES[id].boss && !SPECIES[id].keepsake);
/** What grants each wish, done to a game. */
const GRANT = {
  boss_hydra: (game) => { for (const kind of kindsOf('garden')) befriend(game, kind); },
  boss_baron: (game) => { befriend(game, 'dandepuff', { heirloom: true }); },
  boss_crumbwyrm: (game) => { befriend(game, 'toastghost', { grown: true, level: 8 }); },
  boss_spincycle: (game) => { befriend(game, 'sockgoblin'); },
  boss_tome: (game) => { for (const kind of ORDINARY.slice(0, 40)) game.state.book[kind].met = true; },
  boss_warden: (game) => { calmTo(game, 'dark'); },
  boss_clock: (game) => { for (const kind of ['dustbunny', 'sockeel', 'toastghost', 'dandepuff', 'thornhog']) befriend(game, kind, { grown: true, level: 9 }); },
  boss_vacuum: (game) => { calmTo(game, 'shed'); game.state.story.rival = 5; },
  boss_marrow: (game) => { for (const kind of ['dandepuff', 'thornhog', 'gnome']) befriend(game, kind, { heirloom: true }); },
  boss_bathtub: (game) => { for (const kind of kindsOf('deepend')) befriend(game, kind); },
  boss_mower: (game) => { for (const kind of ORDINARY.slice(0, 30)) befriend(game, kind); },
  boss_treadle: (game) => { befriend(game, 'teddybear'); },
};
/** A game with a ringleader's place calm and its wish granted, the team strong enough for anything. */
function granted(species, seed = 11, level = 20) {
  const game = calmTo(fresh(seed), CHIEFS.find((one) => one.species === species).room);
  for (const friend of game.state.friends) friend.level = level;
  GRANT[species](game);
  return game;
}

test('every ringleader has a wish, in plain words, and a painting to stand outside in', () => {
  assert.deepEqual(CHIEFS.map((one) => one.species), ROOMS.map((room) => room.path[4].boss));
  assert.deepEqual(Object.keys(WISHES), CHIEFS.map((one) => one.species), 'one each, in the order of their places');
  assert.equal(CHIEFS.length, 12);
  for (const { species } of CHIEFS) {
    const wish = WISHES[species];
    assert.ok(isChief(species) && existsSync(`${SPRITES}${species}.webp`), species);
    for (const key of ['wish', 'how', 'waits', 'ready', 'joins']) {
      assert.ok(typeof wish[key] === 'string' && wish[key].length > 4 && wish[key].length < 240 && !/undefined|NaN|\[object/.test(wish[key]), `${species}.${key}`);
    }
    assert.ok(wish.wish.length <= 40, `${species}: the wish itself is short enough for a heading`);
  }
  assert.equal(new Set(Object.values(WISHES).map((wish) => wish.wish)).size, 12, 'no two want the same thing');
  assert.equal(isChief('dustbunny'), false);
  assert.equal(isChief('keep_musicbox'), false);
  assert.equal(isChief('nobody'), false);
  assert.equal(wishOf(fresh().state, 'dustbunny'), null);
});

test('each takes the air to one side of its own door: in sight, on open ground, in nobody\'s way', () => {
  assert.deepEqual(Object.keys(WAITS), CHIEFS.map((one) => one.species));
  for (const { species, room } of CHIEFS) {
    const at = WAITS[species];
    const door = spotOf(room).door;
    assert.ok(canStand(at.x, at.y), species);
    for (const [dx, dy] of [[TALK - 20, 0], [-(TALK - 20), 0], [0, TALK - 20], [0, -(TALK - 20)]].slice(0, 3)) assert.ok(canStand(at.x + dx, at.y + dy) || canStand(at.x - dx, at.y + dy), `room to stand beside ${species}`);
    assert.equal(districtAt(at), null, 'outside, not in a place');
    assert.ok(far(at, door) > 110 && far(at, door) < 360, `${species} is near its own door and not in it (${Math.round(far(at, door))})`);
    assert.ok(SPOTS.every((spot) => far(spot.door, at) > 110), 'and in nobody else\'s');
    assert.ok(WILDS.every((wild) => far(wild, at) > 170) && Object.values(HAUNTS).every((haunt) => far(haunt, at) > 240) && RIVAL_AT.every((spot) => far(spot, at) > 2 * TALK + 20) && PEOPLE.every((person) => far(person, at) > 2 * TALK + 20), `${species} shares its spot with nobody`);
    assert.equal(overTheWater(at), ROOMS.find((one) => one.id === room).chapter === 2, `${species} is on its own bank`);
  }
  const spots = Object.values(WAITS);
  for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) assert.ok(far(spots[a], spots[b]) > 2 * TALK + 20);
});

test('nobody is outside until its own place is calm; then it is, with its wish, and no bout to be had yet', () => {
  const game = fresh();
  assert.deepEqual(chiefsOut(game.state), []);
  assert.deepEqual(game.waiting(), []);
  calmTo(game, 'garden');
  assert.deepEqual(chiefsOut(game.state), [{ species: 'boss_hydra', room: 'garden', ...WAITS.boss_hydra, granted: false }]);
  assert.deepEqual(game.waiting().filter((one) => one.chief), [{ id: 'boss_hydra', chief: true, room: 'garden', ...WAITS.boss_hydra, due: -1 }]);
  const wish = game.wish('boss_hydra');
  assert.equal(wish.wish, 'Company in the garden');
  assert.deepEqual([wish.have, wish.need, wish.granted], [0, kindsOf('garden').length, false]);
  assert.equal(wish.seen, WISHES.boss_hydra.waits);
  assert.equal(game.wish('dustbunny'), null);
  assert.equal(game.standByWaiting('boss_hydra'), true);
  assert.equal(game.waitingNear(), 'boss_hydra');
  assert.equal(game.hail(), null, 'a ringleader has nothing to say: what it wants is seen');
  assert.equal(game.boutDue(), false);
  assert.equal(game.startBout(), null);
  assert.deepEqual(game.also().filter((one) => one.id.startsWith('chief:')), []);
  calmTo(game, 'pantry');
  assert.deepEqual(chiefsOut(game.state).map((one) => one.species), ['boss_hydra', 'boss_baron', 'boss_crumbwyrm']);
});

test('each wish is counted from what the save already shows, and is granted exactly when its count is full', () => {
  for (const { species, room } of CHIEFS) {
    const game = calmTo(fresh(), room);
    // (THE VACUUM's wish needs the rival's last meeting, which is further on than its own place; the Night Warden's is the lane itself.)
    const before = wishOf(game.state, species);
    assert.ok(Number.isInteger(before.have) && Number.isInteger(before.need) && before.need >= 1 && before.have >= 0 && before.have <= before.need, species);
    if (species !== 'boss_warden' && species !== 'boss_crumbwyrm') assert.equal(before.granted, false, `${species}: not granted just by calming its place`);
    assert.equal(before.granted, before.have >= before.need);
    GRANT[species](game);
    const after = wishOf(game.state, species);
    assert.deepEqual([after.have, after.granted], [after.need, true], `${species}: ${after.have} of ${after.need}`);
    assert.equal(chiefSeen(game.state, species), WISHES[species].ready);
    assert.equal(chiefsOut(game.state).find((one) => one.species === species).granted, true);
  }
  // A few of them, by the count.
  const game = calmTo(fresh(), 'mending');
  assert.deepEqual(wishOf(game.state, 'boss_spincycle').have, 1, 'an Eelastic walks with you from the start: half a pair');
  assert.deepEqual([wishOf(game.state, 'boss_tome').have, wishOf(game.state, 'boss_tome').need], [3, 40]);
  befriend(game, 'dandepuff', { heirloom: true });
  assert.equal(wishOf(game.state, 'boss_baron').granted, true);
  assert.deepEqual([wishOf(game.state, 'boss_marrow').have, wishOf(game.state, 'boss_marrow').granted], [1, false]);
  assert.deepEqual([wishOf(game.state, 'boss_vacuum').have, wishOf(game.state, 'boss_vacuum').need], [0, 5]);
  game.state.story.rival = 3;
  assert.equal(wishOf(game.state, 'boss_vacuum').have, 3);
  // The Crumbwyrm's is about the slice it forgot: nobody else growing up will do.
  befriend(game, 'dustbunny', { grown: true });
  assert.equal(wishOf(game.state, 'boss_crumbwyrm').granted, false);
});

test('a ringleader who is your friend does not count toward anybody\'s wish', () => {
  const game = calmTo(fresh(), 'mending');
  for (const kind of ORDINARY.slice(0, 29)) befriend(game, kind);
  assert.deepEqual([wishOf(game.state, 'boss_mower').have, wishOf(game.state, 'boss_mower').granted], [29, false]);
  game.state.friends.push(newFriend(game.state.nextFriendId++, 'boss_hydra', 20));
  assert.equal(wishOf(game.state, 'boss_mower').have, 29, 'a crew is thirty of the ordinary sort');
  befriend(game, ORDINARY[29]);
  assert.equal(wishOf(game.state, 'boss_mower').granted, true);
});

test('wish granted: walk up and it asks for one more bout, alone, as it ever was, and cannot be reached', () => {
  for (const { species, room } of CHIEFS) {
    const game = granted(species, 5 + CHIEFS.findIndex((one) => one.species === species), 24);
    const friends = game.state.friends.length;
    const befriended = game.state.stats.befriended;
    assert.equal(game.standByWaiting(species), true, species);
    assert.equal(game.boutDue(), true);
    const level = chiefLevel(game.state, species);
    const battle = game.startBout();
    assert.ok(battle, species);
    assert.deepEqual(game.bout, { who: species, chief: true, level });
    const foes = battle.units.filter((unit) => unit.side === 'foe');
    assert.equal(foes.length, 1);
    assert.deepEqual([foes[0].species, foes[0].level, foes[0].boss, foes[0].turns, foes[0].maxHuff], [species, level, true, 2, 0]);
    assert.equal(foes[0].maxHp, statAt(SPECIES[species].hp, level), 'at its full Health: it is a ringleader until it is a friend');
    assert.deepEqual(choices(battle).calls.find((call) => call.id === 'reach').targets, [], 'too proud to reach, even now');
    playOut(battle, { befriend: true, have: [] });
    const summary = game.finishBattle();
    assert.equal(summary.won, true, `${species}: three at level 24 win`);
    // It comes home, at the strength it fought at; it is not put on the team for you.
    const friend = game.state.friends.find((one) => one.species === species);
    assert.ok(friend, `${species} is a friend`);
    assert.deepEqual([friend.level, friend.xp, friend.heirloom, friend.grown], [level, 0, false, undefined]);
    assert.equal(game.state.friends.length, friends + 1);
    assert.equal(game.state.stats.befriended, befriended + 1);
    assert.deepEqual(summary.joined, [{ id: friend.id, species, level, heirloom: false, grown: false }]);
    assert.deepEqual(summary.chief, { species, joined: true, text: chiefJoins(species) });
    assert.equal(game.state.team.includes(friend.id), false);
    assert.equal(summary.home, false);
    assert.equal(game.bout, null);
    assert.equal(chiefsOut(game.state).some((one) => one.species === species), false, 'and it is not outside any more');
    assert.match(chiefsSoFar(game.state)[0], new RegExp(`${SPECIES[species].name} had a wish`));
    assert.ok(storySoFar(game.state).some((line) => line.includes('had a wish')));
    assert.equal(ROOMS.find((one) => one.id === room).path[4].boss, species);
  }
});

test('lose the friendly bout and you are carried home; the wish stays granted, and it will be there', () => {
  const game = granted('boss_baron', 4, 6);
  game.standByWaiting('boss_baron');
  game.startBout();
  game.concede();
  const summary = game.finishBattle();
  assert.equal(summary.won, false);
  assert.equal(summary.home, true);
  assert.deepEqual(summary.joined, []);
  assert.equal(summary.chief.joined, false);
  assert.match(summary.chief.text, /Baron Pilfer was enjoying that/);
  assert.equal(game.state.friends.some((friend) => friend.species === 'boss_baron'), false);
  assert.equal(chiefsOut(game.state).find((one) => one.species === 'boss_baron').granted, true);
  assert.equal(game.near(), 'home');
});

test('it is as strong as it was in its own place, or if you have come a long way since, a level behind your strongest', () => {
  const game = calmTo(fresh(), 'garden');
  assert.equal(chiefLevel(game.state, 'boss_hydra'), 5, 'as it was');
  for (const friend of game.state.friends) friend.level = 6;
  assert.equal(chiefLevel(game.state, 'boss_hydra'), 5);
  game.state.friends[1].level = 19;
  assert.equal(chiefLevel(game.state, 'boss_hydra'), 18, 'it has been keeping up');
  assert.equal(game.wish('boss_hydra').level, 18);
  game.state.friends[1].level = MAX_LEVEL;
  assert.equal(chiefLevel(game.state, 'boss_hydra'), MAX_LEVEL - 1);
  // A ringleader friend's own level does not pull the others up after it.
  game.state.friends[1].level = 7;
  game.state.friends.push(newFriend(99, 'boss_baron', 30));
  assert.equal(chiefLevel(game.state, 'boss_hydra'), 6);
});

test('as a friend it is one of the team: one turn a round, a share of its old Health, sturdier than any ordinary kind and less than a Keepsake', () => {
  assert.deepEqual(CHIEF, { hp: 0.55, team: 1 });
  const sturdiest = Math.max(...ORDINARY.map((id) => SPECIES[id].hp));
  const keepsakes = SPECIES_IDS.filter((id) => SPECIES[id].keepsake).map((id) => SPECIES[id].hp);
  for (const { species } of CHIEFS) {
    const kind = SPECIES[species];
    assert.equal(friendHp(species), Math.round(kind.hp * 0.55));
    assert.ok(friendHp(species) > sturdiest && friendHp(species) < Math.min(...keepsakes), `${species}: ${friendHp(species)}`);
    const friend = newFriend(1, species, 12);
    assert.equal(maxHpOf(friend), statAt(friendHp(species), 12));
    const ally = makeFighter('ally', 0, { species, level: 12, friendId: 1 });
    assert.deepEqual([ally.turns, ally.boss, ally.chief, ally.maxHp, ally.maxHuff], [1, false, true, statAt(friendHp(species), 12), 0]);
    assert.equal(ally.moves.length, 3, 'it knows all it knows');
    assert.deepEqual([ally.oomph, ally.grit, ally.pep], [statAt(kind.oomph, 12), statAt(kind.grit, 12), statAt(kind.pep, 12)]);
    // In its own place it is what it always was.
    const foe = makeFighter('foe', 0, { species, level: 12 });
    assert.deepEqual([foe.turns, foe.boss, foe.chief, foe.maxHp], [2, true, false, statAt(kind.hp, 12)]);
    // It learns like anyone, and it does not grow up: it is what it is.
    const gained = gainXp(friend, xpNeeded(12) + 1);
    assert.deepEqual([friend.level, gained.grew, friend.grown], [13, false, undefined]);
  }
  for (const id of ORDINARY) assert.equal(friendHp(id), SPECIES[id].hp, 'nobody else\'s Health is touched');
});

test('only one ringleader walks with you at a time', () => {
  const game = calmTo(fresh(), 'alley');
  const [a, b, c] = game.state.team;
  const hydra = newFriend(game.state.nextFriendId++, 'boss_hydra', 9);
  const baron = newFriend(game.state.nextFriendId++, 'boss_baron', 9);
  game.state.friends.push(hydra, baron);
  assert.equal(game.mayTeam([a, b, hydra.id]), true);
  assert.equal(game.setTeam([a, b, hydra.id]), true);
  assert.equal(game.mayTeam([a, hydra.id, baron.id]), 'chiefs');
  assert.equal(game.setTeam([a, hydra.id, baron.id]), false);
  assert.deepEqual(game.state.team, [a, b, hydra.id], 'and nothing is changed by being refused');
  assert.equal(game.setTeam([a, b, baron.id]), true, 'one may be swapped for the other');
  assert.equal(game.setTeam([baron.id]), true, 'or walk with you alone');
  assert.equal(teamKeepsTo(game.state, [hydra.id, baron.id]), false);
  assert.equal(teamKeepsTo(game.state, [a, b, c]), true);
  // The other reasons a team is refused are still told apart.
  assert.equal(game.mayTeam([a, a]), 'wrong');
  assert.equal(game.mayTeam([]), 'wrong');
  assert.equal(game.mayTeam('abc'), 'wrong');
  assert.equal(game.mayTeam([a, b, c, hydra.id]), 'wrong');
  game.state.worn = { [a]: 1 };
  assert.equal(game.mayTeam([a, b, c]), 'worn');
  assert.ok(TEAM_SIZE > CHIEF.team);
});

test('with one on the team the game still plays: it fights at your side, and takes its turn like anyone', () => {
  const game = calmTo(fresh(7), 'garden');
  for (const friend of game.state.friends) friend.level = 9;
  const hydra = newFriend(game.state.nextFriendId++, 'boss_hydra', 9);
  game.state.friends.push(hydra);
  game.setTeam([hydra.id, game.state.team[0], game.state.team[1]]);
  assert.equal(playable(JSON.parse(JSON.stringify(game.state)), NOW), true, 'a save with a ringleader on the team passes its rehearsal');
  game.travelTo('garden');
  const stop = game.state.visit.groups.findIndex((group) => !group.done);
  game.approach(stop);
  const battle = game.startEncounter(stop);
  const ally = battle.units.find((unit) => unit.species === 'boss_hydra');
  assert.deepEqual([ally.side, ally.turns, ally.chief], ['ally', 1, true]);
  assert.equal(battle.order.filter((key) => key === ally.key).length, 1, 'once a round');
  playOut(battle, {});
  const summary = game.finishBattle();
  assert.equal(summary.won, true);
  assert.ok(summary.gains.some((gain) => gain.species === 'boss_hydra' && gain.team), 'and learns from it');
});

test('a save keeps a ringleader friend only if its place is calm, with no rare colours, and one to a team', () => {
  const game = calmTo(fresh(), 'alley');
  const [a, b] = game.state.team;
  const hydra = newFriend(game.state.nextFriendId++, 'boss_hydra', 9);
  const baron = newFriend(game.state.nextFriendId++, 'boss_baron', 9);
  game.state.friends.push(hydra, baron);
  game.setTeam([a, hydra.id, b]);
  const saved = () => JSON.parse(game.serialize(NOW));
  // As it went in.
  let back = reviveState(saved(), NOW);
  assert.deepEqual(back.friends.filter((friend) => isChief(friend.species)).map((friend) => [friend.species, friend.level]), [['boss_hydra', 9], ['boss_baron', 9]]);
  assert.deepEqual(back.team, [a, hydra.id, b]);
  // A save that puts two on the team: the second is left at home.
  let raw = saved();
  raw.team = [hydra.id, baron.id, a];
  back = reviveState(raw, NOW);
  assert.deepEqual(back.team, [hydra.id, a, b], 'and the team is made up with somebody else');
  // Rare colours and a grown form are not theirs to have.
  raw = saved();
  Object.assign(raw.friends.find((friend) => friend.species === 'boss_hydra'), { heirloom: true, grown: true });
  back = reviveState(raw, NOW);
  const kept = back.friends.find((friend) => friend.species === 'boss_hydra');
  assert.deepEqual([kept.heirloom, kept.grown], [false, undefined]);
  assert.equal(back.book.boss_hydra.heirloom, false);
  // One whose place is not calm cannot have come home: it is not kept, and nor is its place on the team.
  raw = saved();
  raw.rooms.alley.clears = 0;
  back = reviveState(raw, NOW);
  assert.deepEqual(back.friends.filter((friend) => isChief(friend.species)).map((friend) => friend.species), ['boss_hydra']);
  raw.rooms.garden.clears = 0;
  back = reviveState(raw, NOW);
  assert.equal(back.friends.some((friend) => isChief(friend.species)), false);
  assert.equal(back.team.length, 3);
  assert.equal(chiefMayJoin(back, 'boss_hydra'), false);
  // A ringleader from a place that does not exist, or a made-up one, is nobody.
  raw = saved();
  raw.friends.push({ id: 500, species: 'boss_nobody', level: 9, xp: 0 }, { id: 501, species: 'boss_treadle', level: 40, xp: 0 });
  back = reviveState(raw, NOW);
  assert.deepEqual(back.friends.filter((friend) => isChief(friend.species)).map((friend) => friend.species), ['boss_hydra', 'boss_baron']);
  // Only ringleaders, and too many of them on the team: one walks with you, and the save still plays.
  raw = saved();
  raw.friends = raw.friends.filter((friend) => isChief(friend.species));
  raw.team = raw.friends.map((friend) => friend.id);
  back = reviveState(raw, NOW);
  assert.deepEqual(back.team, [hydra.id]);
  assert.equal(playable(back, NOW), true);
});

test('the journal says when one has its wish and where it is waiting; the story so far says who has come home', () => {
  const game = granted('boss_spincycle');
  const asides = chiefAsides(game.state);
  assert.deepEqual(asides.map((one) => one.id), ['chief:boss_spincycle']);
  assert.deepEqual(game.also().filter((one) => one.id.startsWith('chief:')), asides);
  assert.equal(asides[0].art, 'boss_spincycle');
  assert.match(asides[0].title, /The Spin Cycle's wish is granted/);
  assert.match(asides[0].detail, /outside The Wash/);
  assert.match(asides[0].detail, /a ringleader for a friend/);
  assert.deepEqual(chiefsSoFar(game.state), []);
  game.state.friends.push(newFriend(60, 'boss_spincycle', 9), newFriend(61, 'boss_hydra', 9), newFriend(62, 'boss_baron', 9));
  assert.deepEqual(chiefAsides(game.state), [], 'at home, it is not waiting anywhere');
  assert.match(chiefsSoFar(game.state)[0], /^Old Summerlong, Baron Pilfer and The Spin Cycle had a wish, and you granted it\. 3 ringleaders live with you now\.$/);
});

test('the list of wishes is every ringleader in the order of their places, and says which are out of doors, granted, or at home', () => {
  const game = calmTo(fresh(), 'pantry');
  let list = game.wishes();
  assert.deepEqual(list, wishList(game.state));
  assert.deepEqual(list.map((one) => one.species), CHIEFS.map((one) => one.species));
  assert.deepEqual(list.map((one) => one.calm), [true, true, true, false, false, false, false, false, false, false, false, false]);
  assert.ok(list.every((one) => one.home === false && one.wish && one.how && Number.isInteger(one.have) && Number.isInteger(one.need)));
  assert.deepEqual(list.filter((one) => one.granted).map((one) => one.species), []);
  befriend(game, 'toastghost', { grown: true });
  game.state.friends.push(newFriend(game.state.nextFriendId++, 'boss_baron', 9));
  list = game.wishes();
  assert.deepEqual(list.filter((one) => one.granted).map((one) => one.species), ['boss_crumbwyrm']);
  assert.deepEqual(list.filter((one) => one.home).map((one) => one.species), ['boss_baron']);
  assert.deepEqual(wishList(fresh().state).filter((one) => one.calm), [], 'nobody is out of doors to begin with');
});

test('a rested team that has earned the bout wins it: the wish is the hard part', () => {
  for (const { species, room } of CHIEFS) {
    const place = ROOMS.find((one) => one.id === room);
    const level = place.path[4].bossLevel + 1; // about what a team has when it has just calmed the place
    let won = 0;
    const N = 30;
    for (let seed = 1; seed <= N; seed++) {
      const game = granted(species, seed, level);
      // (Whatever the wish took, the three who walk with you are the three you set out with, at that level.)
      game.standByWaiting(species);
      const battle = game.startBout();
      playOut(battle, {});
      if (game.finishBattle().won) won++;
    }
    assert.ok(won / N >= 0.8, `${species}: won ${won} of ${N}`);
  }
});
