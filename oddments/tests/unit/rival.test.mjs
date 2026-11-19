// The rival: Tansy Brisk, junior clearance officer, and her three. She waits
// by the road at five points along the way; nobody has to stop; a bout with
// her is her three against yours, and hers cannot be reached. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { createBattle, choices } from '../../web/js/core/battle.js';
import { SPECIES, ROOMS, ROOM_IDS, RIVAL, ELEMENT_IDS } from '../../web/js/core/balance.js';
import { RIVAL_AT, WILDS, HAUNTS, PEOPLE, SPOTS, TALK, canStand, districtAt, overTheWater } from '../../web/js/core/world.js';
import { CAST, storySoFar } from '../../web/js/core/story.js';
import { TANSY, rivalAbout, rivalDue, rivalDone, rivalMost, rivalOwes, rivalTeam, rivalSays, rivalAfter, rivalAside, rivalSoFar } from '../../web/js/core/rival.js';
import { bridgeOpen } from '../../web/js/core/rooms.js';

const NOW = 1_800_000_000_000;
const SPRITES = fileURLToPath(new URL('../../web/assets/sprites/', import.meta.url));
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
/** Calms every place up to and including one. */
const calmTo = (game, roomId) => { for (const id of ROOM_IDS.slice(0, ROOM_IDS.indexOf(roomId) + 1)) { game.state.rooms[id].clears = 1; game.state.rooms[id].calmed = 0b11111; } return game; };
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** A team about as strong as one that has come straight to a meeting (what the simulator's player has there). */
const AS_STRONG = [5, 8, 11, 15, 18];
const strong = (game, level) => { for (const friend of game.state.friends) { friend.level = level; friend.grown = level >= 8; } return game; };

test('the rival is Tansy Brisk, with a painting of her own; her three are a duster, a bar of soap and an iron', () => {
  assert.equal(TANSY, 'tansy');
  assert.equal(CAST.tansy.name, 'Tansy Brisk');
  assert.ok(CAST.tansy.role && existsSync(`${SPRITES}${CAST.tansy.art}.webp`), 'she has a painting');
  assert.deepEqual(RIVAL.kinds, ['coothug', 'soapslug', 'ironweasel']);
  for (const kind of RIVAL.kinds) assert.ok(SPECIES[kind] && !SPECIES[kind].boss && !SPECIES[kind].keepsake && SPECIES[kind].grown, kind);
  assert.equal(new Set(RIVAL.kinds.map((kind) => SPECIES[kind].element)).size, 3, 'three elements between them');
  assert.ok(RIVAL.kinds.every((kind) => ELEMENT_IDS.includes(SPECIES[kind].element)));
});

test('five meetings, each once a place further on is calm, each stronger than the last', () => {
  assert.equal(RIVAL.meetings.length, 5);
  assert.equal(RIVAL_AT.length, 5);
  let before = -1;
  let strength = 0;
  for (const meeting of RIVAL.meetings) {
    const at = ROOM_IDS.indexOf(meeting.after);
    assert.ok(at > before, `${meeting.after} is further on`);
    before = at;
    assert.equal(meeting.levels.length, 3);
    assert.ok(meeting.levels.every((level) => Number.isInteger(level) && level >= 1 && level <= 40));
    const sum = meeting.levels.reduce((a, b) => a + b, 0);
    assert.ok(sum > strength);
    strength = sum;
  }
  assert.equal(RIVAL.meetings[0].after, ROOMS[0].id, 'the first as soon as the garden is calm');
  assert.equal(ROOMS.find((room) => room.id === RIVAL.meetings[3].after), ROOMS.filter((room) => room.chapter !== 2).pop(), 'the fourth when the whole lane is');
  assert.equal(ROOMS.find((room) => room.id === RIVAL.meetings[4].after).chapter, 2, 'and the last over the water');
});

test('she waits on open ground, beside the way and in nobody\'s: clear of doors, neighbours, and the spots strays keep to', () => {
  RIVAL_AT.forEach((at, n) => {
    assert.ok(canStand(at.x, at.y), `meeting ${n + 1}`);
    for (const [dx, dy] of [[TALK - 20, 0], [-(TALK - 20), 0], [0, TALK - 20], [0, -(TALK - 20)]]) assert.ok(canStand(at.x + dx, at.y + dy), `room to stand beside her at meeting ${n + 1}`);
    assert.equal(districtAt(at), null, 'never inside a place');
    assert.ok(WILDS.every((wild) => far(wild, at) > 170), 'not where strays are');
    assert.ok(Object.values(HAUNTS).every((haunt) => far(haunt, at) > 240));
    assert.ok(PEOPLE.every((person) => far(person, at) > 2 * TALK + 20), 'not so near a neighbour that both would answer');
    assert.ok(SPOTS.every((spot) => far(spot.door, at) > 200), 'not at anybody\'s door');
    // She is on your side of the water until you are over it.
    assert.equal(overTheWater(at), n === 4, `meeting ${n + 1}`);
  });
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) assert.ok(far(RIVAL_AT[a], RIVAL_AT[b]) > 600);
});

test('she is not about until the garden is calm; then she is, and the journal says where', () => {
  const game = fresh();
  assert.equal(rivalAbout(game.state), null);
  assert.deepEqual(game.waiting(), []);
  assert.deepEqual(game.also(), []);
  assert.equal(rivalSays(game.state), null);
  calmTo(game, 'garden');
  assert.deepEqual(rivalAbout(game.state), { ...RIVAL_AT[0], due: 0 });
  assert.deepEqual(game.waiting().filter((one) => !one.chief), [{ id: 'tansy', ...RIVAL_AT[0], due: 0 }]);
  const [aside] = game.also();
  assert.equal(aside.id, 'rival');
  assert.match(aside.title, /Spick & Span/);
  assert.match(aside.detail, /east of the green/);
  assert.match(aside.detail, /Nobody has to stop/);
  assert.equal(aside.art, 'cast_tansy');
  assert.deepEqual(rivalSoFar(game.state), [], 'nothing in the story so far until you have met');
});

test('nobody has to stop: she is heard only from beside her, and hearing her out changes nothing', () => {
  const game = calmTo(fresh(), 'garden');
  assert.equal(game.waitingNear(), null);
  assert.equal(game.hail('tansy'), null);
  assert.equal(game.boutDue('tansy'), false);
  assert.equal(game.startBout('tansy'), null);
  const before = JSON.stringify(game.state);
  assert.equal(game.standByWaiting('tansy'), true);
  const stood = JSON.stringify({ ...game.state, where: null });
  assert.equal(game.waitingNear(), 'tansy');
  const lines = game.hail();
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.who === 'tansy' && line.text.length > 10));
  assert.match(lines[0].text, /Tansy Brisk, junior clearance officer/);
  assert.equal(JSON.stringify({ ...game.state, where: null }), stood, 'hearing her changes nothing');
  assert.equal(JSON.stringify({ ...JSON.parse(before), where: null }), stood);
  assert.equal(game.boutDue(), true);
  // Not from indoors, and not in a fight.
  game.standAt('home'); game.enter('home');
  assert.equal(game.waitingNear(), null);
});

test('a bout is her three against yours, at the strength the meeting says, and none of hers can be reached', () => {
  for (let meeting = 0; meeting < 5; meeting++) {
    const game = strong(calmTo(fresh(3 + meeting), RIVAL.meetings[meeting].after), AS_STRONG[meeting] + 3);
    game.state.story.rival = meeting;
    game.state.story.heard = meeting;
    assert.equal(rivalDue(game.state), meeting);
    game.standByWaiting('tansy');
    const battle = game.startBout();
    assert.ok(battle, `meeting ${meeting + 1}`);
    assert.equal(game.place(), 'fight');
    assert.deepEqual(game.bout, { who: 'tansy', meeting });
    const foes = battle.units.filter((unit) => unit.side === 'foe');
    assert.deepEqual(foes.map((foe) => foe.species), RIVAL.kinds);
    assert.deepEqual(foes.map((foe) => foe.level), RIVAL.meetings[meeting].levels);
    for (const foe of foes) {
      assert.equal(foe.owned, true);
      assert.equal(foe.maxHuff, 0, 'in no Huff: it is not lost');
      assert.equal(foe.grown, foe.level >= SPECIES[foe.species].grown.at, 'grown up once it is big enough');
      assert.equal(game.state.book[foe.species].met, true, 'and it goes in the scrapbook as met');
    }
    assert.deepEqual(foes.map((foe) => foe.name), meeting >= 3 ? ['Flick', 'Sliver', 'Crease'] : ['Unit One', 'Unit Two', 'Unit Three'], 'numbers, as issued; then names');
    assert.deepEqual(choices(battle).calls.find((call) => call.id === 'reach').targets, [], 'nobody to reach');
    const friends = game.state.friends.length;
    playOut(battle, { befriend: true, have: [] });
    const summary = game.finishBattle();
    assert.equal(summary.won, true, `a team three levels up wins meeting ${meeting + 1}`);
    assert.equal(game.state.friends.length, friends, 'nobody of hers comes home with you');
    assert.deepEqual(summary.joined, []);
    assert.ok(summary.xp > 0, 'but a bout teaches like any fight');
    assert.equal(summary.rival.meeting, meeting);
    assert.ok(summary.rival.lines.length >= 2 && summary.rival.lines.every((line) => line.who === 'tansy'));
    assert.equal(summary.home, false);
    assert.equal(game.bout, null);
    assert.equal(game.place(), 'lane');
    assert.equal(game.state.story.rival, meeting + 1);
    assert.equal(game.state.story.heard, meeting, 'and what she has to say about it is still to be said');
    assert.equal(rivalOwes(game.state), meeting);
    assert.equal(game.rested(), false, 'and wears everyone out like any fight: a breather, not a rest');
  }
});

test('win, and she is gone until the next place she has in mind is calm; then she is further down the road', () => {
  const game = strong(calmTo(fresh(), 'garden'), 9);
  game.standByWaiting('tansy');
  playOut(game.startBout(), {});
  const stood = game.waiting().find((one) => one.id === 'tansy');
  assert.equal(game.finishBattle().won, true);
  // She stands where she was until she has had her say about it, with no bout to be had meanwhile. And that is kept:
  // close the game on the news of the win, and she is there still, with it still to say. (Found by review: it used
  // to be held in memory only, and was lost.)
  assert.deepEqual(rivalAbout(game.state), { ...RIVAL_AT[0], due: -1, owes: 0 });
  assert.deepEqual(game.waiting().filter((one) => !one.chief), [{ id: 'tansy', x: stood.x, y: stood.y, due: -1, owes: 0 }]);
  assert.equal(game.boutDue('tansy'), false);
  assert.deepEqual(game.also(), []);
  const reopened = reviveState(JSON.parse(game.serialize(NOW)), NOW);
  assert.deepEqual(rivalAbout(reopened), { ...RIVAL_AT[0], due: -1, owes: 0 }, 'a reload keeps it owed');
  // Even with the place she is waiting on next already calm, she says her piece about this one first.
  const ahead = reviveState(JSON.parse(calmTo(new Game(reviveState(JSON.parse(game.serialize(NOW)), NOW), { now: NOW, fx: false }), 'pantry').serialize(NOW)), NOW);
  assert.deepEqual([rivalDue(ahead), rivalAbout(ahead).owes], [-1, 0]);
  assert.equal(game.waitingNear(), 'tansy');
  assert.match(game.hail()[0].text, /Unit Two, stop wagging/);
  assert.equal(game.heardOut(), true);
  assert.equal(game.heardOut(), false, 'said once');
  assert.equal(game.state.story.heard, 1);
  assert.equal(rivalAbout(game.state), null, 'the alley is not what she is waiting for');
  assert.deepEqual(game.waiting().filter((one) => !one.chief), []);
  calmTo(game, 'alley');
  assert.equal(rivalAbout(game.state), null);
  assert.deepEqual(game.also(), []);
  calmTo(game, 'pantry');
  assert.deepEqual(rivalAbout(game.state), { ...RIVAL_AT[1], due: 1 });
  assert.match(game.also()[0].title, /Tansy Brisk is waiting/);
  assert.match(storySoFar(game.state).join(' '), /got the better of her once/);
  // Calm a long way on without stopping for her, and she is still at the meeting you owe her.
  calmTo(game, 'dark');
  assert.equal(rivalAbout(game.state).due, 1);
});

test('lose, and you are carried home like after any fight, and she is waiting still', () => {
  const game = calmTo(fresh(), 'garden');
  game.standByWaiting('tansy');
  const battle = game.startBout();
  game.concede();
  const summary = game.finishBattle();
  assert.equal(summary.won, false);
  assert.equal(summary.home, true);
  assert.equal(game.near(), 'home');
  assert.equal(game.rested(), true);
  assert.deepEqual(summary.rival.lines, []);
  assert.match(summary.rival.text, /Tansy Brisk/);
  assert.equal(game.state.story.rival, 0);
  assert.equal(rivalAbout(game.state).due, 0);
  assert.equal(battle.phase, 'lost');
});

test('a team too worn out to stand does not get a bout', () => {
  const game = calmTo(fresh(), 'garden');
  game.state.worn = Object.fromEntries(game.state.team.map((id) => [id, 0]));
  game.standByWaiting('tansy');
  assert.equal(game.startBout(), null);
  assert.equal(game.bout, null);
});

test('five wins and it is over: she has handed in her boxes, and stays on Bobbin Row with a word for you', () => {
  const game = calmTo(fresh(), 'mending');
  game.state.story.rival = 5;
  game.state.story.heard = 5;
  assert.equal(rivalDone(game.state), true);
  assert.equal(rivalDue(game.state), -1);
  assert.deepEqual(rivalAbout(game.state), { ...RIVAL_AT[4], due: -1 });
  assert.deepEqual(game.also().filter((one) => one.id === 'rival'), []);
  game.standByWaiting('tansy');
  assert.equal(game.boutDue(), false);
  assert.equal(game.startBout(), null);
  const words = new Set();
  for (let n = 0; n < 8; n++) { game.state.stats.battles = n; const said = game.hail(); assert.equal(said.length, 1); words.add(said[0].text); }
  assert.equal(words.size, 4);
  assert.match(rivalSoFar(game.state)[0], /handed in her boxes/);
  assert.match(rivalAfter(4, true).lines.map((line) => line.text).join(' '), /vacuum cleaner, signed out of the depot/);
});

test('everything she says is plain words, and none of it is too long for the screen', () => {
  const game = calmTo(fresh(), 'mending');
  for (let meeting = 0; meeting < 5; meeting++) {
    game.state.story.rival = meeting;
    game.state.story.heard = meeting;
    const texts = [...rivalSays(game.state), ...rivalAfter(meeting, true).lines].map((line) => line.text).concat(rivalAfter(meeting, false).text, rivalAside(game.state).detail, rivalAside(game.state).title);
    for (const text of texts) {
      assert.ok(typeof text === 'string' && text.length > 8 && text.length < 240, text);
      assert.ok(!/undefined|NaN|\[object/.test(text), text);
    }
    assert.equal(rivalAfter(meeting, false).lines.length, 0);
    assert.equal(rivalAfter(meeting, true).text, '');
  }
});

test('a save cannot say she has lost a meeting whose place is not calm, nor more than five', () => {
  const saved = (rival, upTo) => {
    const game = fresh();
    if (upTo) calmTo(game, upTo);
    const raw = JSON.parse(game.serialize(NOW));
    raw.story.rival = rival;
    return reviveState(raw, NOW);
  };
  assert.equal(saved(5, null).story.rival, 0);
  assert.equal(saved(5, 'garden').story.rival, 1);
  assert.equal(saved(5, 'alley').story.rival, 1);
  assert.equal(saved(5, 'dark').story.rival, 4);
  assert.equal(saved(2, 'dark').story.rival, 2);
  assert.equal(saved(5, 'mending').story.rival, 5);
  assert.equal(saved(99, 'mending').story.rival, 5);
  for (const wrong of [-1, 2.5, '3', null, {}, [], NaN, Infinity, true]) assert.equal(saved(wrong, 'mending').story.rival, wrong === -1 ? 0 : 0, JSON.stringify(wrong));
  assert.equal(rivalMost(fresh().state), 0);
  // What she has had her say about is never more than she has lost; and a save from the builds before that was kept owes nothing.
  assert.equal(saved(5, 'garden').story.heard, 0);
  const early = JSON.parse(calmTo(fresh(), 'dark').serialize(NOW));
  early.story.rival = 3; delete early.story.heard;
  assert.deepEqual([reviveState(early, NOW).story.rival, reviveState(early, NOW).story.heard], [3, 3]);
  early.story.heard = 9;
  assert.equal(reviveState(early, NOW).story.heard, 3);
  // A save from before there was a rival has met nobody.
  const old = JSON.parse(calmTo(fresh(), 'stacks').serialize(NOW));
  delete old.story.rival;
  const back = reviveState(old, NOW);
  assert.equal(back.story.rival, 0);
  assert.equal(rivalAbout(back).due, 0, 'so she is waiting where she would first have been');
});

test('the last meeting is over the water, and the bridge is open by the time it is due', () => {
  const game = calmTo(fresh(), RIVAL.meetings[4].after);
  game.state.story.rival = 4;
  game.state.story.heard = 4;
  assert.equal(bridgeOpen(game.state), true);
  assert.equal(game.standByWaiting('tansy'), true);
  assert.equal(overTheWater(game.state.where), true);
});

test('a rested team that has come straight there wins most bouts, and none is a walkover', () => {
  // (The simulator's whole game sets these: see balance.RIVAL. This is a guard against a change that tips them over.)
  for (let meeting = 0; meeting < 5; meeting++) {
    let won = 0;
    let left = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const game = strong(fresh(seed), AS_STRONG[meeting]);
      const allies = game.team().map((friend) => ({ species: friend.species, level: friend.level, friendId: friend.id, heirloom: false, grown: !!friend.grown }));
      const battle = createBattle({ rng: seed * 7919 }, { allies, foes: rivalTeam(meeting), fx: false });
      playOut(battle, {});
      if (battle.phase === 'won') { won++; left += battle.units.filter((unit) => unit.side === 'ally').reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0) / 3; }
    }
    assert.ok(won / N >= 0.7, `meeting ${meeting + 1}: won ${won} of ${N}`);
    assert.ok(left / Math.max(1, won) < 0.7, `meeting ${meeting + 1}: not a walkover (${(left / won).toFixed(2)} of everyone's Health left)`);
  }
});
