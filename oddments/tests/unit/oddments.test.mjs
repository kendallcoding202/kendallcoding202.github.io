// The data: the first twelve Oddkin, their moves and the first room.
// These tests hold the tables to the rules the engine relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SPECIES, SPECIES_IDS, MOVES, BRACE, ELEMENTS, STAT_IDS, START_TEAM, ROOMS, CALLS, LOOKS, TEAM_SIZE, MAX_LEVEL,
  movesAt, movesLearnedAt, moveOf, statAt, roomBuilt,
} from '../../web/js/core/balance.js';

const ASSETS = fileURLToPath(new URL('../../web/assets/', import.meta.url));

test('there are twelve Oddkin: eleven who can be friends and one boss', () => {
  assert.equal(SPECIES_IDS.length, 12);
  assert.deepEqual(SPECIES_IDS.filter((id) => SPECIES[id].boss), ['boss_hydra']);
});

test('every Oddkin has an element, four sensible stats, a line of text and its sprite', () => {
  for (const id of SPECIES_IDS) {
    const kind = SPECIES[id];
    assert.ok(ELEMENTS[kind.element], `${id} element`);
    for (const key of STAT_IDS) assert.ok(Number.isInteger(kind[key]) && kind[key] >= 4 && kind[key] <= 200, `${id} ${key}`);
    assert.ok(kind.name && kind.blurb, `${id} text`);
    assert.ok(existsSync(`${ASSETS}sprites/${id}.webp`), `${id} sprite`);
  }
});

test('every element has at least one of the twelve', () => {
  for (const element of Object.keys(ELEMENTS)) assert.ok(SPECIES_IDS.some((id) => SPECIES[id].element === element), element);
});

test('every Oddkin knows three moves, learned in order, the first a plain hit ready every turn', () => {
  const used = new Set();
  for (const id of SPECIES_IDS) {
    const { moves } = SPECIES[id];
    assert.equal(moves.length, 3, id);
    assert.equal(moves[0][1], 1, `${id} knows something at level 1`);
    for (let i = 1; i < moves.length; i++) assert.ok(moves[i][1] >= moves[i - 1][1], `${id} learns in order`);
    for (const [move, level] of moves) {
      assert.ok(MOVES[move], `${id}: ${move} exists`);
      assert.ok(level >= 1 && level <= MAX_LEVEL);
      assert.ok(!used.has(move), `${move} belongs to one Oddkin`);
      used.add(move);
    }
    const first = MOVES[moves[0][0]];
    assert.ok(first.kind === 'hit' && first.wait === 0 && first.power > 0, `${id} can always hit`);
  }
  assert.equal(used.size, Object.keys(MOVES).length, 'no move is left unused');
});

test('a move is one of five kinds and its numbers suit its kind', () => {
  for (const [id, move] of Object.entries(MOVES)) {
    assert.ok(ELEMENTS[move.element], `${id} element`);
    assert.ok(Number.isInteger(move.wait) && move.wait >= 0 && move.wait <= 5, `${id} wait`);
    assert.ok(move.name && move.desc, `${id} text`);
    if (move.kind === 'hit') assert.ok(move.aim === 'foe' && move.power >= 0.5 && move.power <= 2, id);
    else if (move.kind === 'sweep') assert.ok(move.aim === 'foes' && move.power >= 0.4 && move.power < 1 && move.wait >= 2, `${id}: a sweep hits less and waits`);
    else if (move.kind === 'mend') assert.ok(['self', 'ally', 'allies'].includes(move.aim) && move.mend > 0 && move.mend <= 0.4 && move.wait >= 2, id);
    else if (move.kind === 'boost') assert.ok(['self', 'ally', 'allies'].includes(move.aim) && STAT_IDS.includes(move.boost.stat) && move.boost.by > 0 && move.boost.turns >= 1, id);
    else if (move.kind === 'sap') assert.ok(['foe', 'foes'].includes(move.aim) && STAT_IDS.includes(move.sap.stat) && move.sap.by > 0 && move.sap.by < 1, id);
    else assert.fail(`${id}: unknown kind ${move.kind}`);
    if (move.sap) assert.ok(move.sap.by > 0 && move.sap.by < 1 && move.sap.turns >= 1 && move.sap.stat !== 'hp', `${id} sap`);
    if (move.power > 1.2) assert.ok(move.wait >= 2, `${id}: a strong hit has to wait`);
  }
  assert.equal(moveOf('brace'), BRACE);
  assert.equal(moveOf('lintflurry'), MOVES.lintflurry);
});

test('moves are learned at the levels the table says', () => {
  assert.deepEqual(movesAt('dustbunny', 1), ['lintflurry']);
  assert.deepEqual(movesAt('dustbunny', 3), ['lintflurry', 'underbed']);
  assert.deepEqual(movesAt('dustbunny', 40), ['lintflurry', 'underbed', 'kickupdust']);
  assert.deepEqual(movesLearnedAt('dustbunny', 6), ['kickupdust']);
  assert.deepEqual(movesLearnedAt('dustbunny', 5), []);
  assert.equal(movesAt('boss_hydra', 1).length, 3, 'a boss knows everything from the start');
});

test('each level adds a tenth of the base stat', () => {
  assert.equal(statAt(50, 1), 50);
  assert.equal(statAt(50, 2), 55);
  assert.equal(statAt(50, 11), 100);
  assert.equal(statAt(13, 3), 16); // 15.6
  assert.ok(statAt(1, 1) >= 1);
});

test('who can be calmed has a Huff; a boss has none and acts twice', () => {
  for (const id of SPECIES_IDS) {
    const kind = SPECIES[id];
    if (kind.boss) assert.ok(kind.huff === 0 && kind.turns === 2 && !kind.grown, id);
    else assert.ok(Number.isInteger(kind.huff) && kind.huff >= 2 && kind.huff <= 6, `${id} huff`);
  }
});

test('every friend has a grown form waiting for its art, with a name of its own', () => {
  const names = new Set(SPECIES_IDS.map((id) => SPECIES[id].name));
  for (const id of SPECIES_IDS.filter((k) => !SPECIES[k].boss)) {
    const { grown } = SPECIES[id];
    assert.ok(grown && grown.name && grown.at > 6 && grown.at <= MAX_LEVEL, id);
    assert.ok(!names.has(grown.name), `${grown.name} is a new name`);
    names.add(grown.name);
  }
});

test('you start with three friends of three different elements, each knowing two moves', () => {
  assert.equal(START_TEAM.length, TEAM_SIZE);
  assert.equal(new Set(START_TEAM.map(([id]) => SPECIES[id].element)).size, 3);
  for (const [id, level] of START_TEAM) {
    assert.ok(SPECIES[id] && !SPECIES[id].boss);
    assert.equal(movesAt(id, level).length, 2);
  }
});

test('the house has eight rooms; the first is built and ends in its boss', () => {
  assert.equal(ROOMS.length, 8);
  assert.equal(new Set(ROOMS.map((room) => room.id)).size, 8);
  for (const room of ROOMS) {
    assert.ok(room.name && room.blurb && ELEMENTS[room.element]);
    assert.ok(existsSync(`${ASSETS}bg/${room.bg}.webp`), `${room.id} background`);
  }
  assert.deepEqual(ROOMS.filter(roomBuilt).map((room) => room.id), ['garden']);
  const { path } = ROOMS[0];
  assert.equal(path.length, 5);
  path.forEach((spot, i) => {
    const last = i === path.length - 1;
    assert.equal(!!spot.boss, last, 'only the last stop has a boss');
    if (spot.boss) assert.ok(SPECIES[spot.boss].boss && spot.bossLevel >= 1);
    assert.ok(spot.name && spot.size[0] >= 1 && spot.size[0] <= spot.size[1] && spot.size[1] <= TEAM_SIZE - (last ? 1 : 0));
    assert.ok(spot.level[0] >= 1 && spot.level[0] <= spot.level[1]);
    for (const [id, weight] of spot.pool) assert.ok(SPECIES[id] && !SPECIES[id].boss && weight > 0, `${spot.name}: ${id}`);
  });
  for (let i = 1; i < path.length; i++) assert.ok(path[i].level[1] >= path[i - 1].level[1] || path[i].boss, 'the path gets harder');
});

test('every kind that can be a friend turns up somewhere in the first room, or is with you from the start', () => {
  const met = new Set([...START_TEAM.map(([id]) => id), ...ROOMS[0].path.flatMap((spot) => spot.pool.map(([id]) => id))]);
  for (const id of SPECIES_IDS.filter((k) => !SPECIES[k].boss)) assert.ok(met.has(id), id);
});

test('the house-sitter has three Calls and four looks, each with its sprite', () => {
  assert.deepEqual(Object.keys(CALLS), ['reach', 'cheer', 'patch']);
  for (const call of Object.values(CALLS)) assert.ok(call.name && call.desc && [1, 2].includes(call.every) && ['foe', 'ally'].includes(call.aim));
  assert.equal(LOOKS.length, 4);
  for (const look of LOOKS) assert.ok(look.name && existsSync(`${ASSETS}sprites/${look.id}.webp`), look.id);
});
