// The Keepsakes: one of a kind, one to a chapter. Found at a spot of its own
// once the chapter's places are all calm; made a friend of by reaching out,
// never by force; and, once yours, out again only now and then, in its rare
// colours. Fluff, the dust bunny of Pawst Lives, shows the way. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../web/js/core/game.js';
import { newState, reviveState } from '../../web/js/core/state.js';
import { playOut } from '../../web/js/core/auto.js';
import { SPECIES, SPECIES_IDS, MOVES, ROOMS, HEIRLOOM, KEEPSAKE, STRAYS, xpFor } from '../../web/js/core/balance.js';
import { HAUNTS, FLUFF_BESIDE, WILDS, PROPS, TREES, SPOTS, ROAD_POINTS, canStand, overTheWater, regionAt } from '../../web/js/core/world.js';
import { KEEPSAKES, chapterCalm, keepsakeMayBeOut, fairKeepsake, fairGroup, keepsakeOut, rollStrays, straysAbout, strayPool } from '../../web/js/core/strays.js';
import { LANE, FAR, FLUFF, asideOf } from '../../web/js/core/story.js';
import { ART } from '../../tools/art-manifest.mjs';

const NOW = 1_800_000_000_000;
const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const fresh = (seed = 11) => { const game = new Game(newState(NOW, seed), { now: NOW, fx: false }); game.begin({ name: 'Kit' }); return game; };
const calm = (game, rooms) => { for (const room of rooms) { game.state.rooms[room.id].clears = 1; game.state.rooms[room.id].calmed = 0b11111; } return game; };
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('there are two Keepsakes, one to a chapter: each one of a kind, in no place, never a stray, and it does not grow up', () => {
  assert.deepEqual(KEEPSAKES.map((keep) => [keep.species, keep.chapter]), [['keep_musicbox', 1], ['keep_bottleship', 2]]);
  const pools = new Set(ROOMS.flatMap((room) => room.path.flatMap((stop) => stop.pool.map(([id]) => id))));
  const game = calm(fresh(), ROOMS);
  const strays = new Set(strayPool(game.state).map(([id]) => id));
  for (const keep of KEEPSAKES) {
    const kind = SPECIES[keep.species];
    assert.ok(kind.name && kind.blurb.length > 30 && kind.notYet, keep.species);
    assert.equal(kind.boss, undefined);
    assert.equal(kind.grown, undefined, 'it is what it is');
    assert.ok(kind.huff > Math.max(...SPECIES_IDS.filter((id) => !SPECIES[id].keepsake).map((id) => SPECIES[id].huff)), 'it takes longer to reach than anyone');
    assert.ok(!pools.has(keep.species) && !strays.has(keep.species));
    // It is met at the strength of its chapter's last ringleader.
    const last = ROOMS.filter((room) => (room.chapter || 1) === keep.chapter).pop();
    assert.equal(keep.level, last.path[4].bossLevel);
    assert.equal(kind.moves.length, 3);
    for (const [move, at] of kind.moves) assert.ok(MOVES[move] && at === 1, `${move}: it knows all it knows already`);
    // Painted, in its own colours and its rare ones, and the manifest says how.
    for (const name of [`${keep.species}.webp`, `${keep.species}_heirloom.webp`]) assert.ok(existsSync(`${WEB}assets/sprites/${name}`) && statSync(`${WEB}assets/sprites/${name}`).size > 4000, name);
    const art = ART.find((entry) => entry.id === keep.species);
    assert.ok(art && art.kind === 'keep' && /not based on any existing game, film or cartoon character/.test(art.prompt) && /calm and kind expression/.test(art.prompt));
  }
  assert.ok(KEEPSAKE.again > 0 && KEEPSAKE.again <= 0.2);
});

test('each has a haunt of its own: open ground, off the streets, clear of everything, with room beside it for Fluff', () => {
  const roads = ROAD_POINTS.flat();
  for (const keep of KEEPSAKES) {
    const at = HAUNTS[keep.chapter];
    const fluff = { x: at.x + FLUFF_BESIDE.x, y: at.y + FLUFF_BESIDE.y };
    for (const [dx, dy] of [[0, 0], [60, 0], [-60, 0], [0, 50], [0, -50]]) assert.ok(canStand(at.x + dx, at.y + dy), `chapter ${keep.chapter}: open ground at its haunt`);
    assert.ok(canStand(fluff.x, fluff.y) && canStand(fluff.x, at.y + STRAYS.meet - 12), 'and beside it, and where you would stand to meet it');
    assert.ok(Math.min(...roads.map((point) => far(point, at))) > 100, 'off the streets');
    for (const wild of WILDS) assert.ok(far(wild, at) > 200, 'well away from where strays turn up');
    for (const prop of PROPS) assert.ok(far(prop, at) > prop.r + 90);
    for (const tree of TREES) assert.ok(far(tree, at) > tree.r + 60 && far(tree, fluff) > tree.r + 30);
    for (const spot of SPOTS) assert.ok(far(spot.door, at) > 250);
  }
  // The lane's is on the lane, at the top of it; the far bank's is over the water.
  assert.equal(regionAt(HAUNTS[1]).id, 'lane');
  assert.equal(overTheWater(HAUNTS[1]), false);
  assert.equal(overTheWater(HAUNTS[2]), true);
  assert.equal(regionAt(HAUNTS[2]).id, 'bank');
});

test('a Keepsake is out every time you set out once its chapter is calm, until it is your friend; and never before', () => {
  const game = fresh(4);
  assert.equal(chapterCalm(game.state, 1), false);
  for (let i = 0; i < 60; i++) assert.ok(rollStrays(game.state).every((stray) => !stray.keep), 'nothing of the kind while the lane is restless');
  assert.equal(game.keepsake(), null);
  assert.equal(game.aside(), null);
  // Seven places calm is not the chapter.
  calm(game, LANE.slice(0, 7));
  for (let i = 0; i < 40; i++) assert.ok(rollStrays(game.state).every((stray) => !stray.keep));
  calm(game, LANE);
  assert.equal(chapterCalm(game.state, 1), true);
  assert.equal(chapterCalm(game.state, 2), false);
  let rare = 0;
  for (let i = 0; i < 400; i++) {
    const keeps = rollStrays(game.state).filter((stray) => stray.keep);
    assert.deepEqual(keeps.map((stray) => [stray.keep, stray.foes.length, stray.foes[0].species, stray.foes[0].level, stray.done]), [[1, 1, 'keep_musicbox', 13, false]], 'the lane\'s, alone, and only the lane\'s');
    assert.equal(fairGroup(game.state, keeps[0]), true);
    if (keeps[0].foes[0].heirloom) rare++;
  }
  assert.ok(rare > 400 * HEIRLOOM.calmOdds * 0.3 && rare < 400 * HEIRLOOM.calmOdds * 2.5, `${rare} of 400 in its rare colours: about as often as anyone in a calm place`);
  // It stands at its haunt, where the screen and the way-finding look for it.
  rollStrays(game.state);
  const out = game.keepsake();
  assert.deepEqual([out.keep, out.species], [1, 'keep_musicbox']);
  const seen = straysAbout(game.state).find((stray) => stray.keep === 1);
  assert.deepEqual([seen.x, seen.y, seen.index], [HAUNTS[1].x, HAUNTS[1].y, out.index]);
  assert.deepEqual(keepsakeOut(game.state), out);
  // Both banks calm: both are out, each at its own.
  calm(game, FAR);
  const both = rollStrays(game.state).filter((stray) => stray.keep);
  assert.deepEqual(both.map((stray) => [stray.keep, stray.foes[0].species, stray.foes[0].level]), [[1, 'keep_musicbox', 13], [2, 'keep_bottleship', 17]]);
});

test('it is made a friend of by reaching out, as anyone is: it comes home, is in the scrapbook, and is not out again as it was', () => {
  const game = calm(fresh(9), LANE);
  for (const friend of game.state.friends) { friend.level = 16; friend.grown = true; }
  let joined = null;
  rollStrays(game.state); // (as the game does the moment the chapter's last place is calmed)
  for (let outing = 0; outing < 12 && !joined; outing++) {
    game.goHome(); // a rest, if there is anything to rest from: and then it is out again
    const out = game.keepsake();
    assert.ok(out, 'it is out again after a rest, however the last meeting went');
    assert.equal(game.approachStrays(out.index), true);
    assert.equal(game.strayNear(), out.index);
    const battle = game.startStrays();
    assert.ok(battle);
    const foes = battle.units.filter((unit) => unit.side === 'foe');
    assert.deepEqual(foes.map((unit) => [unit.species, unit.level, unit.boss, unit.maxHuff]), [['keep_musicbox', 13, false, SPECIES.keep_musicbox.huff + (out.heirloom ? HEIRLOOM.huff : 0)]]);
    playOut(battle, { befriend: true, have: game.state.friends.map((friend) => friend.species) });
    const summary = game.finishBattle();
    assert.equal(summary.keepsake, 'keep_musicbox');
    assert.equal(summary.strays, true);
    assert.equal(summary.lone, false, 'one on its own, but nobody is short-changed for meeting it');
    if (summary.won) assert.equal(game.keepsake(), null, 'met, it is gone until you next rest');
    if (summary.joined.some((one) => one.species === 'keep_musicbox')) joined = summary;
  }
  assert.ok(joined, 'a sensible stand-in makes a friend of it within a dozen outings');
  assert.equal(joined.xp, xpFor('keep_musicbox', 13));
  const mine = game.state.friends.find((friend) => friend.species === 'keep_musicbox');
  assert.ok(mine && mine.level === 13 && !mine.grown);
  assert.equal(game.state.book.keep_musicbox.met, true);
  // Yours now: it is out again only in the colours yours has not got, and only now and then.
  let again = 0;
  for (let i = 0; i < 600; i++) {
    const keeps = rollStrays(game.state).filter((stray) => stray.keep);
    if (keeps.length) { again++; assert.equal(keeps[0].foes[0].heirloom, !mine.heirloom); assert.equal(mine.heirloom, false); }
  }
  if (!mine.heirloom) assert.ok(again > 600 * KEEPSAKE.again * 0.5 && again < 600 * KEEPSAKE.again * 1.7, `${again} of 600 outings`);
  // And with those colours too, never again: there is nothing more of it to find.
  mine.heirloom = true;
  for (let i = 0; i < 200; i++) assert.ok(rollStrays(game.state).every((stray) => !stray.keep));
});

test('the journal says where to look, in Fluff\'s name; and Fluff has a picture, which is Pawst Lives\' own', () => {
  assert.deepEqual(FLUFF, { name: 'Fluff', art: 'npc_fluff' });
  assert.ok(existsSync(`${WEB}assets/sprites/${FLUFF.art}.webp`) && statSync(`${WEB}assets/sprites/${FLUFF.art}.webp`).size > 4000);
  assert.equal(ART.some((art) => art.id === FLUFF.art), false, 'nothing was generated for it here: the picture is the one painted for Pawst Lives');
  assert.equal(asideOf(null, false), null);
  const game = calm(fresh(6), LANE);
  rollStrays(game.state);
  let aside = game.aside();
  assert.deepEqual([aside.title, aside.keep], ['Follow Fluff', 1]);
  assert.match(aside.detail, /Fluff.*THE VACUUM.*old orchard.*lullaby/);
  assert.ok(aside.detail.length > 80 && aside.detail.length < 260);
  game.state.book.keep_musicbox.met = true;
  aside = game.aside();
  assert.equal(aside.title, 'A Keepsake is out again');
  assert.match(aside.detail, /old orchard/);
  // The far bank's, when that is calm too and the lane's is already a friend.
  calm(game, FAR);
  game.state.friends.push({ id: 99, species: 'keep_musicbox', level: 13, xp: 0, heirloom: true });
  rollStrays(game.state);
  aside = game.aside();
  assert.deepEqual([aside.title, aside.keep], ['Follow Fluff', 2]);
  assert.match(aside.detail, /far bank.*west of Kettle Bridge/);
});

test('a save cannot conjure a Keepsake, change one, or have two of the same', () => {
  const game = calm(fresh(8), LANE);
  rollStrays(game.state);
  const raw = JSON.parse(game.serialize(NOW));
  const mine = raw.strays.find((stray) => stray.keep === 1);
  assert.ok(mine && mine.at === -1);
  // As saved, it comes back as it was.
  const back = reviveState(JSON.parse(JSON.stringify(raw)), NOW);
  assert.deepEqual(back.strays.filter((stray) => stray.keep), [{ at: -1, keep: 1, foes: [{ species: 'keep_musicbox', level: 13, heirloom: mine.foes[0].heirloom }], done: false }]);
  const tries = [
    ['the far bank\'s, with the far bank restless', { at: -1, keep: 2, foes: [{ species: 'keep_bottleship', level: 17, heirloom: false }], done: false }],
    ['a soft one', { at: -1, keep: 1, foes: [{ species: 'keep_musicbox', level: 1, heirloom: false }], done: false }],
    ['a grown one', { at: -1, keep: 1, foes: [{ species: 'keep_musicbox', level: 13, heirloom: false, grown: true }], done: false }],
    ['two of them', { at: -1, keep: 1, foes: [{ species: 'keep_musicbox', level: 13, heirloom: false }, { species: 'keep_musicbox', level: 13, heirloom: false }], done: false }],
    ['somebody else in its place', { at: -1, keep: 1, foes: [{ species: 'dandepuff', level: 13, heirloom: false }], done: false }],
    ['no such chapter', { at: -1, keep: 7, foes: [{ species: 'keep_musicbox', level: 13, heirloom: false }], done: false }],
  ];
  for (const [what, stray] of tries) {
    assert.equal(fairKeepsake(game.state, stray), false, what);
    const hostile = { ...raw, strays: [...raw.strays.filter((one) => !one.keep), stray] };
    assert.ok(reviveState(JSON.parse(JSON.stringify(hostile)), NOW).strays.every((one) => !one.keep), `${what}: not kept`);
  }
  // The same one listed twice is kept once.
  const twice = reviveState(JSON.parse(JSON.stringify({ ...raw, strays: [...raw.strays, mine] })), NOW);
  assert.equal(twice.strays.filter((stray) => stray.keep === 1).length, 1);
  // With the lane restless again in the save, it is not there at all.
  const restless = JSON.parse(JSON.stringify(raw));
  restless.rooms.dark.clears = 0;
  assert.ok(reviveState(restless, NOW).strays.every((stray) => !stray.keep));
  assert.equal(keepsakeMayBeOut(game.state, KEEPSAKES[1], false), false);
});
