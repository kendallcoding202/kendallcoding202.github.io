// Growing up: a friend that reaches its kind's level grows into its grown
// form, for good. When it happens, what it changes (its strength, its name,
// its picture), that it is kept in the save, and that every kind has its grown
// form painted. And that as the game advances, some of whoever is restless has
// grown up too: a mix, more of them grown the further along you are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { SPECIES, SPECIES_IDS, ROOMS, START_TEAM, MAX_LEVEL, GROWTH, GROWN_BOOST, GROWN_ODDS, GROWN_WORTH, LONE_SHARE, grownOdds, roomOf, statAt, xpNeeded, xpFor } from '../../web/js/core/balance.js';
import { gainXp, newFriend, settleUp } from '../../web/js/core/progress.js';
import { createBattle, unitOf, makeFighter } from '../../web/js/core/battle.js';
import { maxHpOf, rollEncounter, fairEncounter } from '../../web/js/core/rooms.js';
import { rollStrays, fairStrays } from '../../web/js/core/strays.js';
import { nameOf, kindNameOf, artOf, calledOf, giveName } from '../../web/js/core/names.js';
import { THREE, putRight, grewWords } from '../../web/js/core/story.js';
import { playOut } from '../../web/js/core/auto.js';
import { ART } from '../../tools/art-manifest.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const NOW = 1_800_000_000_000;
const KINDS = SPECIES_IDS.filter((id) => !SPECIES[id].boss);
function fresh(seed = 3) {
  const state = newState(NOW, seed);
  state.started = true;
  return new Game(state, { now: NOW, fx: false });
}
const back = (game, edit = () => {}) => { const raw = JSON.parse(game.serialize(NOW)); edit(raw); return reviveState(raw, NOW); };
/** A friend of a kind, one point of experience short of the level it grows up at. */
function nearly(species, id = 1) {
  const at = SPECIES[species].grown.at;
  const friend = newFriend(id, species, at - 1);
  friend.xp = xpNeeded(at - 1) - 1;
  return friend;
}

test('every kind that can be a friend grows up: later the further along it lives, always above the level it is first met at, and never a ringleader', () => {
  const firstMet = {};
  for (const room of ROOMS) for (const spot of room.path) for (const [kind] of spot.pool) if (!(kind in firstMet)) firstMet[kind] = { room: ROOMS.indexOf(room), top: 0 };
  for (const room of ROOMS) for (const spot of room.path) for (const [kind] of spot.pool) if (firstMet[kind].room === ROOMS.indexOf(room)) firstMet[kind].top = Math.max(firstMet[kind].top, spot.level[1]);
  const starters = START_TEAM.map(([kind]) => kind);
  for (const id of KINDS) {
    const { grown } = SPECIES[id];
    assert.ok(grown && Number.isInteger(grown.at) && grown.at >= 7 && grown.at <= 18 && grown.at < MAX_LEVEL, id);
    if (starters.includes(id)) continue;
    assert.ok(grown.at > firstMet[id].top, `${id} grows at ${grown.at}, above the ${firstMet[id].top} it is met at: growing up is earned at your side`);
  }
  // The three you set out with grow first, and together.
  const first = starters.map((kind) => SPECIES[kind].grown.at);
  assert.equal(new Set(first).size, 1);
  assert.ok(KINDS.every((id) => SPECIES[id].grown.at >= first[0]));
  // A kind from a later place never grows sooner than one from an earlier place.
  const byPlace = ROOMS.map((room, i) => KINDS.filter((id) => firstMet[id] && firstMet[id].room === i).map((id) => SPECIES[id].grown.at));
  for (let i = 1; i < byPlace.length; i++) assert.ok(Math.min(...byPlace[i]) >= Math.max(...byPlace[i - 1]), ROOMS[i].id);
  for (const id of SPECIES_IDS.filter((each) => SPECIES[each].boss)) assert.equal(SPECIES[id].grown, undefined, `${id} does not grow`);
  assert.ok(GROWN_BOOST > 1.02 && GROWN_BOOST <= 1.25);
});

test('every grown form is painted, in its own colours and its Heirloom colours, from its kind\'s own picture', () => {
  for (const id of KINDS) {
    for (const name of [`${id}_grown.webp`, `${id}_grown_heirloom.webp`]) {
      const path = `${WEB}assets/sprites/${name}`;
      assert.ok(existsSync(path), `${name} is in the game`);
      assert.ok(statSync(path).size > 4000 && statSync(path).size < 90_000, `${name} is ${statSync(path).size} bytes`);
    }
    const entry = ART.find((art) => art.id === `${id}_grown`);
    assert.ok(entry && entry.ref === id, `${id}: the manifest paints it from the young one's picture`);
    assert.match(entry.prompt, /obviously different from the reference picture at a glance/);
    assert.match(entry.prompt, /not based on any existing game, film or cartoon character/);
  }
  // (Forty more are painted and waiting, for the kinds of chapter two: in the manifest before they are in the game.)
  assert.ok(ART.filter((art) => art.kind === 'grown').length >= KINDS.length);
});

test('a friend grows up on gaining the level its kind grows at, once, and not before', () => {
  for (const species of ['dustbunny', 'gnome', 'robodisc']) {
    const at = SPECIES[species].grown.at;
    const friend = nearly(species);
    assert.deepEqual(gainXp(newFriend(9, species, at - 2), 1), { levels: 0, learned: [], grew: false });
    const gained = gainXp(friend, 1);
    assert.equal(gained.levels, 1);
    assert.equal(gained.grew, true, `${species} grows at level ${at}`);
    assert.deepEqual([friend.level, friend.grown], [at, true]);
    // Not again.
    const next = gainXp(friend, xpNeeded(at));
    assert.deepEqual([next.levels, next.grew, friend.grown], [1, false, true]);
  }
  // Several levels at once, straight past it.
  const leap = newFriend(2, 'sockeel', 2);
  assert.equal(gainXp(leap, 1e6).grew, true);
  assert.equal(leap.grown, true);
  // One that came home already past the level grows at its next level, not on the doorstep.
  const late = newFriend(3, 'gnome', SPECIES.gnome.grown.at + 2);
  assert.equal('grown' in late, false);
  assert.deepEqual(gainXp(late, 5), { levels: 0, learned: [], grew: false });
  assert.equal(gainXp(late, xpNeeded(late.level)).grew, true);
  // At the very top there are no more levels to gain, so nothing more happens.
  const top = newFriend(4, 'gnome', MAX_LEVEL);
  assert.equal(gainXp(top, 1e6).grew, false);
});

test('grown up, it is stronger in every way, under its grown form\'s name and picture', () => {
  for (const level of [8, 12, 20, MAX_LEVEL]) {
    for (const base of [9, 44, 61]) assert.equal(statAt(base, level, true), Math.max(1, Math.round(base * (1 + GROWTH * (level - 1)) * GROWN_BOOST)));
    assert.ok(statAt(44, level, true) > statAt(44, level));
    assert.equal(statAt(44, level, false), statAt(44, level));
  }
  const friend = { ...newFriend(1, 'dustbunny', 10), grown: true };
  const young = newFriend(2, 'dustbunny', 10);
  assert.ok(maxHpOf(friend) > maxHpOf(young));
  const [big, small] = [makeFighter('ally', 0, { species: 'dustbunny', level: 10, grown: true }), makeFighter('ally', 0, { species: 'dustbunny', level: 10 })];
  for (const stat of ['maxHp', 'oomph', 'grit', 'pep']) assert.ok(big[stat] > small[stat], stat);
  assert.deepEqual([big.grown, small.grown, big.name, small.name], [true, false, SPECIES.dustbunny.grown.name, SPECIES.dustbunny.name]);
  assert.deepEqual(big.moves, small.moves, 'the same moves');
  // Names and pictures.
  assert.deepEqual([kindNameOf(friend), nameOf(friend), artOf(friend)], ['Hartmote', 'Hartmote', 'dustbunny_grown']);
  assert.deepEqual([kindNameOf(young), nameOf(young), artOf(young)], ['Hopmote', 'Hopmote', 'dustbunny']);
  assert.equal(artOf(big), 'dustbunny_grown', 'a fighter has its picture the same way');
  // A name of your own is kept through growing up; its grown kind's own name is not a name of your own; its old one can be.
  friend.nick = 'Biscuit';
  assert.equal(nameOf(friend), 'Biscuit');
  assert.equal(giveName(friend, 'Hartmote'), 'Hartmote');
  assert.equal('nick' in friend, false);
  assert.equal(giveName(friend, 'Hopmote'), 'Hopmote');
  assert.equal(friend.nick, 'Hopmote', 'still Hopmote to you, if you like');
  // A ringleader cannot be made grown.
  assert.equal(makeFighter('foe', 0, { species: 'boss_hydra', level: 5, grown: true }).grown, false);
});

test('as the game advances, more of the restless have grown up: none on the lane itself, a few from the Wash, more than half by the end', () => {
  const odds = ROOMS.map((room) => grownOdds(room));
  assert.deepEqual(odds.slice(0, 3), [0, 0, 0], 'none in the garden, the alley or the pantry');
  for (let i = 1; i < odds.length; i++) assert.ok(odds[i] >= odds[i - 1], `${ROOMS[i].id}: never fewer than the place before`);
  assert.ok(odds[3] > 0 && odds[3] <= 0.3, 'a few in the Wash');
  assert.ok(odds[odds.length - 1] > 0.5 && odds[odds.length - 1] < 0.8, 'more than half at the end, but still a mix');
  assert.deepEqual(Object.keys(GROWN_ODDS), ROOMS.map((room) => room.id));
  for (const room of ROOMS) {
    let grown = 0;
    let all = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      for (const stop of [0, room.path.length - 1]) {
        for (const foe of rollEncounter({ rng: seed * 7919 }, room, stop)) {
          if (SPECIES[foe.species].boss) { assert.equal('grown' in foe, false, 'a ringleader is as it is'); continue; }
          all++;
          if (foe.grown) grown++;
          assert.ok(foe.grown === undefined || foe.grown === true);
        }
      }
    }
    const share = grown / all;
    if (grownOdds(room) === 0) assert.equal(grown, 0, `${room.id}: nobody grown`);
    else assert.ok(Math.abs(share - grownOdds(room)) < 0.05, `${room.id}: ${share.toFixed(2)} of them grown, for ${grownOdds(room)}`);
  }
});

test('a save cannot put a grown one where none are met, or grow a ringleader', () => {
  const [garden, wash] = [roomOf('garden'), roomOf('wash')];
  const pair = (room, extra) => room.path[0].pool.slice(0, 1).flatMap(([kind]) => [{ species: kind, level: room.path[0].level[0], heirloom: false, ...extra }, { species: kind, level: room.path[0].level[0], heirloom: false }]);
  assert.equal(fairEncounter(wash, 0, pair(wash, {})), true);
  assert.equal(fairEncounter(wash, 0, pair(wash, { grown: true })), true, 'grown ones are met in the Wash');
  assert.equal(fairEncounter(garden, 0, pair(garden, { grown: true })), false, 'but never in the garden');
  for (const wrong of [false, 'yes', 1, null]) assert.equal(fairEncounter(wash, 0, pair(wash, { grown: wrong })), false, `grown: ${wrong}`);
  const last = wash.path.length - 1;
  const boss = { species: wash.path[last].boss, level: wash.path[last].bossLevel, heirloom: false };
  const company = { species: wash.path[last].pool[0][0], level: wash.path[last].level[0], heirloom: false };
  assert.equal(fairEncounter(wash, last, [boss, company]), true);
  assert.equal(fairEncounter(wash, last, [{ ...boss, grown: true }, company]), false);
});

test('strays are grown as often as whoever is in the furthest place open to you', () => {
  const share = (calm) => {
    const game = fresh(7);
    game.begin({ name: 'Kit' });
    for (const room of ROOMS.slice(0, calm)) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 31; }
    let grown = 0;
    let all = 0;
    for (let i = 0; i < 120; i++) for (const stray of rollStrays(game.state)) for (const foe of stray.foes) { all++; if (foe.grown) grown++; assert.equal(fairStrays(game.state, stray.foes), true); }
    return { share: grown / all, game };
  };
  assert.equal(share(0).share, 0, 'with only the garden open, none');
  assert.equal(share(2).share, 0, 'nor with the pantry the furthest');
  const far = share(ROOMS.length - 1);
  assert.ok(Math.abs(far.share - grownOdds(ROOMS[ROOMS.length - 1])) < 0.06, `with the Roaring Dark open, ${far.share.toFixed(2)} of them`);
  // What is fair out on the lane depends on how far you have got.
  const early = share(0).game;
  const kind = ROOMS[0].path[0].pool[0][0];
  assert.equal(fairStrays(early.state, [{ species: kind, level: 1, heirloom: false }]), true);
  assert.equal(fairStrays(early.state, [{ species: kind, level: 1, heirloom: false, grown: true }]), false);
  assert.equal(fairStrays(far.game.state, [{ species: kind, level: 1, heirloom: false, grown: true }]), true);
});

test('a grown one that is restless is as much stronger as a grown friend, goes by its grown name, teaches more, and comes home grown', () => {
  const [young, big] = [makeFighter('foe', 0, { species: 'gnome', level: 9 }), makeFighter('foe', 0, { species: 'gnome', level: 9, grown: true })];
  for (const stat of ['maxHp', 'oomph', 'grit', 'pep']) assert.equal(big[stat], statAt(SPECIES.gnome[stat === 'maxHp' ? 'hp' : stat], 9, true), stat);
  assert.ok(big.maxHp > young.maxHp);
  assert.deepEqual([big.grown, big.name, artOf(big), young.name], [true, SPECIES.gnome.grown.name, 'gnome_grown', SPECIES.gnome.name]);
  assert.equal(big.huff, young.huff, 'no harder and no easier to reach');
  // Worth a quarter more.
  assert.equal(xpFor('gnome', 9, true), Math.round(xpFor('gnome', 9) * GROWN_WORTH));
  assert.ok(GROWN_WORTH > 1 && GROWN_WORTH <= 1.5);
  assert.equal(xpFor('boss_hydra', 5, true), xpFor('boss_hydra', 5), 'a ringleader is worth what it always was');
  // A fight with one grown and one young, both calmed: the grown one teaches more and comes home grown.
  const state = newState(NOW, 9);
  const battle = createBattle(state, { allies: state.team.map((id, i) => ({ species: state.friends[i].species, level: 9, friendId: id })), foes: [{ species: 'gnome', level: 9, grown: true }, { species: 'ratscal', level: 9 }], fx: false });
  unitOf(battle, 'f0').settled = true;
  unitOf(battle, 'f1').settled = true;
  battle.phase = 'won';
  const summary = settleUp(state, battle);
  assert.equal(summary.xp, xpFor('gnome', 9, true) + xpFor('ratscal', 9));
  assert.deepEqual(summary.joined.map((one) => [one.species, one.grown]), [['gnome', true], ['ratscal', false]]);
  const [gnome, rat] = [state.friends.find((friend) => friend.species === 'gnome'), state.friends.find((friend) => friend.species === 'ratscal')];
  assert.deepEqual([gnome.grown, 'grown' in rat, nameOf(gnome), nameOf(rat)], [true, false, SPECIES.gnome.grown.name, SPECIES.ratscal.name]);
  assert.deepEqual([state.book.gnome.grown, state.book.ratscal.grown], [true, false]);
  assert.ok(gnome.level < SPECIES.gnome.grown.at + 1, 'whatever its level: it was grown when you met it');
  // And it is still grown after the save is read back.
  const kept = reviveState(JSON.parse(JSON.stringify(state)), NOW);
  assert.equal(kept.friends.find((friend) => friend.species === 'gnome').grown, true);
});

test('out and about: a place far along has a mix waiting, they are kept through a save, and meeting a grown one is written in the scrapbook', () => {
  // Find a save whose visit to the Roaring Dark has both a grown one and a young one at its first stop.
  let game = null;
  for (let seed = 1; seed < 60 && !game; seed++) {
    const tried = fresh(seed);
    tried.begin({ name: 'Kit' });
    for (const room of ROOMS.slice(0, -1)) { tried.state.rooms[room.id].clears = 1; tried.state.rooms[room.id].calmed = 31; }
    for (const friend of tried.state.friends) friend.level = 13;
    tried.travelTo('dark');
    const foes = tried.state.visit.groups[0].foes;
    if (foes.some((foe) => foe.grown) && foes.some((foe) => !foe.grown)) game = tried;
  }
  assert.ok(game, 'a mix turns up');
  const waiting = game.state.visit.groups[0].foes;
  const state = back(game);
  assert.deepEqual(state.visit.groups[0].foes, waiting, 'the same group, grown and young, after the save is read back');
  const grownKind = waiting.find((foe) => foe.grown).species;
  assert.equal(game.state.book[grownKind].grown, false);
  const battle = game.startEncounter();
  assert.ok(battle);
  assert.equal(game.state.book[grownKind].grown, true, 'met');
  const units = battle.units.filter((unit) => unit.side === 'foe');
  assert.deepEqual(units.map((unit) => unit.grown), waiting.map((foe) => !!foe.grown));
  for (const unit of units) assert.equal(unit.name, unit.grown ? SPECIES[unit.species].grown.name : SPECIES[unit.species].name);
});

test('a fight that brings the level says who grew, and from then on that friend fights grown', () => {
  const game = fresh(3);
  game.begin({ name: 'Kit' });
  const [first, second] = game.team();
  const at = SPECIES[first.species].grown.at;
  Object.assign(first, { level: at - 1, xp: xpNeeded(at - 1) - 1 });
  Object.assign(second, { level: at - 3, xp: 0 });
  const before = maxHpOf(first);
  const stray = game.strays()[0];
  assert.equal(game.approachStrays(stray.index), true);
  let battle = game.startStrays();
  assert.equal(battle.units.find((unit) => unit.friendId === first.id).grown, false);
  playOut(battle, {});
  assert.equal(battle.phase, 'won');
  const result = game.finishBattle();
  const gain = result.gains.find((each) => each.id === first.id);
  assert.deepEqual([gain.grew, gain.from, gain.to >= at], [true, at - 1, true]);
  assert.equal(result.gains.find((each) => each.id === second.id).grew, false);
  assert.deepEqual([first.grown, game.state.book[first.species].grown, game.state.book[second.species].grown], [true, true, false]);
  assert.ok(maxHpOf(first) > before);
  // How worn it is carries over; it is not made whole by growing, and never above its new most.
  const health = game.teamHealth().find((member) => member.id === first.id);
  assert.ok(health.hp > 0 && health.hp <= health.max && health.max === maxHpOf(first));
  // The next fight.
  game.rest();
  const next = game.strays()[0];
  game.approachStrays(next.index);
  battle = game.startStrays();
  const unit = battle.units.find((each) => each.friendId === first.id);
  assert.deepEqual([unit.grown, unit.name, unit.maxHp], [true, SPECIES[first.species].grown.name, maxHpOf(first)]);
});

test('what a visitor of its own kind teaches can be the level that does it, and the news says so', () => {
  const state = newState(NOW, 9);
  const mine = state.friends[0];
  const at = SPECIES[mine.species].grown.at;
  // A lone visitor of the same kind, calmed: the fight itself does not teach enough, the visit does.
  const level = 30;
  const fight = Math.round(xpFor(mine.species, level) * LONE_SHARE);
  Object.assign(mine, { level: at - 1, xp: xpNeeded(at - 1) - fight - 10 });
  assert.ok(mine.xp >= 0 && xpFor(mine.species, level) > 10);
  const battle = createBattle(state, { allies: state.team.map((id, i) => ({ species: state.friends[i].species, level: state.friends[i].level, friendId: id })), foes: [{ species: mine.species, level }], fx: false });
  unitOf(battle, 'f0').settled = true;
  battle.phase = 'won';
  const summary = settleUp(state, battle);
  assert.deepEqual(summary.visited, [mine.species]);
  const gain = summary.gains.find((each) => each.id === mine.id);
  assert.equal(mine.grown, true);
  assert.deepEqual([gain.grew, gain.to], [true, mine.level]);
  assert.equal(state.book[mine.species].grown, true);
});

test('being grown is kept in the save; only a kind that grows can be grown, and only true is true', () => {
  const game = fresh(6);
  const [first, second, third] = game.state.friends;
  Object.assign(first, { level: SPECIES[first.species].grown.at, grown: true, nick: 'Biscuit' });
  game.state.book[first.species].grown = true;
  let state = back(game);
  assert.deepEqual([state.friends[0].grown, state.friends[0].nick, state.book[first.species].grown], [true, 'Biscuit', true]);
  assert.equal('grown' in state.friends[1], false);
  assert.equal(state.book[second.species].grown, false);
  // Tampered with. (Grown at a low level is not tampering: one that was grown when it came home is.)
  state = back(game, (raw) => {
    raw.friends[1].grown = true;
    raw.friends[2].grown = 'yes';
    raw.friends[0].nick = SPECIES[first.species].grown.name; // its grown kind's own name is not a name of your own
    raw.book[third.species].grown = 1;
    raw.book.boss_hydra.grown = true;
  });
  assert.equal(state.friends[1].grown, true);
  assert.equal(state.book[second.species].grown, true, 'and the scrapbook follows whoever is at home');
  assert.equal('grown' in state.friends[2], false, 'only true is true');
  assert.equal('nick' in state.friends[0], false);
  assert.deepEqual([state.book[third.species].grown, state.book.boss_hydra.grown], [false, false]);
  // The scrapbook never forgets one that is grown at home, whatever the save's own book says.
  state = back(game, (raw) => { raw.book[first.species].grown = false; });
  assert.equal(state.book[first.species].grown, true);
  // And a save from before any of this simply has nobody grown.
  state = back(fresh(2), (raw) => { for (const id of Object.keys(raw.book)) delete raw.book[id].grown; });
  assert.ok(Object.values(state.book).every((page) => page.grown === false));
});

test('the three have a few words each for the day they grow up, and their stories are told with their grown names', () => {
  for (const one of THREE) {
    const words = grewWords(one.kind);
    assert.ok(typeof words === 'string' && words.length >= 60 && words.length <= 220, `${one.kind}: ${words && words.length}`);
    assert.ok(!words.includes(SPECIES[one.kind].name) && !words.includes(SPECIES[one.kind].grown.name), 'it is told without its name, so it reads right whatever it is called');
  }
  assert.equal(grewWords('gnome'), null);
  const game = fresh(4);
  const one = THREE[0];
  const friend = game.state.friends.find((each) => each.species === one.kind);
  Object.assign(friend, { level: SPECIES[one.kind].grown.at, grown: true });
  assert.equal(calledOf(game.state, one.kind), SPECIES[one.kind].grown.name);
  const told = putRight(game.state, one.place).text;
  assert.ok(told.includes(SPECIES[one.kind].grown.name) && !told.includes(SPECIES[one.kind].name), told);
});
