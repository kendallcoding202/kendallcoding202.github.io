// Holds each place to the shape tools/sim.mjs reports, so a change to a
// number in balance.js that makes fights drag, or a place a wall or a
// walkover, fails here rather than being found by a player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, report } from '../../tools/sim.mjs';
import { ROOMS } from '../../web/js/core/balance.js';

const PLAYERS = 200;
const friendly = simulate({ players: PLAYERS, visits: 4, style: 'friendly' });
const brawler = simulate({ players: PLAYERS, visits: 2, style: 'brawler' });
const careless = simulate({ players: PLAYERS, visits: 4, style: 'careless' });
// The second place, played by people who have calmed the first, however long that took them.
const alley = simulate({ players: PLAYERS, visits: 4, style: 'friendly', room: 'alley' });
const alleyBrawler = simulate({ players: PLAYERS, visits: 3, style: 'brawler', room: 'alley' });
const boss = (result) => result.stops[result.stops.length - 1];

test('a sensible player nearly always reaches the boss on the first visit', () => {
  for (const result of [friendly, brawler]) {
    assert.ok(result.stops[0].won >= 0.99, 'the first fight is not lost');
    assert.ok(boss(result).reached >= 0.9, `reached the boss: ${boss(result).reached}`);
  }
});

test('the boss is a real fight: most sensible players win it first time, not all', () => {
  for (const result of [friendly, brawler]) {
    const first = result.byVisit[0].clearedThisVisit;
    assert.ok(first >= 0.6 && first <= 0.93, `${result.style} cleared on the first visit: ${first}`);
    assert.ok(result.byVisit[1].clearedByNow >= 0.97, `${result.style} cleared by the second: ${result.byVisit[1].clearedByNow}`);
    assert.ok(boss(result).left < result.stops[0].left, 'it costs more Health than the first fight');
    assert.ok(boss(result).left >= 0.15 && boss(result).left <= 0.6, `Health left after the boss: ${boss(result).left}`);
  }
});

test('reaching out is a real choice: it costs a little, never the room', () => {
  assert.ok(Math.abs(friendly.byVisit[0].clearedThisVisit - brawler.byVisit[0].clearedThisVisit) < 0.15);
  assert.ok(friendly.byVisit[0].friends >= 5, `friends after one visit: ${friendly.byVisit[0].friends}`);
  assert.equal(brawler.byVisit[0].friends, 3);
  assert.ok(friendly.byVisit[3].friends >= 9, 'nearly everyone in the garden is a friend after four visits');
});

test('fights are short: a few rounds each, and the whole room is a few minutes', () => {
  for (const result of [friendly, brawler]) {
    for (const stop of result.stops) {
      assert.ok(stop.rounds >= 1 && stop.rounds <= 7, `${stop.name}: ${stop.rounds} rounds`);
      assert.ok(stop.roundsHigh <= 10, `${stop.name}: a long one is ${stop.roundsHigh} rounds`);
      assert.ok(stop.seconds <= 120, `${stop.name}: about ${stop.seconds}s`);
    }
    assert.ok(result.byVisit[0].minutes >= 2 && result.byVisit[0].minutes <= 8, `first visit: ${result.byVisit[0].minutes} minutes`);
  }
  assert.ok(boss(friendly).rounds > friendly.stops[0].rounds, 'the boss takes longer than the gate');
});

test('tapping at random does not clear the room, but is never stuck: it gets stronger every visit', () => {
  assert.ok(careless.byVisit[0].clearedThisVisit <= 0.05);
  assert.ok(careless.stops[0].won >= 0.95, 'even so, the very first fight is won');
  for (let v = 1; v < careless.byVisit.length; v++) assert.ok(careless.byVisit[v].level > careless.byVisit[v - 1].level);
});

test('an Heirloom is rare but real: in a few fights in a hundred at first, and about three times that once the place is calm', () => {
  const [first, ...later] = friendly.heirloomByVisit;
  assert.ok(first > 0.01 && first < 0.08, `first visit: ${first}`);
  // (By the second visit four players in five have calmed the garden; by the third, all of them.)
  for (const share of later.slice(1)) assert.ok(share > first * 1.8 && share < 0.2, `once calm: ${share} against ${first}`);
  assert.ok(friendly.heirloomFightShare > first && friendly.heirloomFightShare < 0.15, String(friendly.heirloomFightShare));
  assert.ok(friendly.heirloomsKept > 0.8 && friendly.heirloomsKept < 4, `kept after four visits: ${friendly.heirloomsKept}`);
  assert.equal(brawler.heirloomsKept, 0, 'and none for someone who never reaches out');
});

test('the report prints a line for every stop and every visit', () => {
  const text = report(friendly);
  for (const spot of ROOMS[0].path) assert.ok(text.includes(spot.name), spot.name);
  assert.ok(text.includes('How long fights last') && text.includes('How hard the place is'));
  assert.equal(text.includes('NaN'), false);
  assert.equal(text.includes('Getting here took'), false, 'nothing comes before the first place');
  const second = report(alley);
  for (const spot of ROOMS[1].path) assert.ok(second.includes(spot.name), spot.name);
  assert.ok(second.startsWith('Tin Can Alley') && second.includes('Getting here took'));
  assert.equal(second.includes('NaN'), false);
});

test('everyone who sets out for the second place gets there, most after one visit to the first', () => {
  for (const result of [alley, alleyBrawler]) {
    assert.equal(result.before.arrived, 1);
    assert.ok(result.before.visits >= 1 && result.before.visits <= 1.5, `visits to the garden first: ${result.before.visits}`);
  }
});

test('the second place is harder than the first, and fair: about half calm it first time, nearly all by the second', () => {
  for (const result of [alley, alleyBrawler]) {
    assert.ok(result.stops[0].won >= 0.99, 'the first fight is not lost');
    assert.ok(boss(result).reached >= 0.8, `reached the Baron: ${boss(result).reached}`);
    const first = result.byVisit[0].clearedThisVisit;
    assert.ok(first >= 0.35 && first <= 0.75, `${result.style} calmed it on the first visit: ${first}`);
    assert.ok(result.byVisit[1].clearedByNow >= 0.9, `${result.style} by the second: ${result.byVisit[1].clearedByNow}`);
    assert.ok(result.byVisit[2].clearedByNow >= 0.98, `${result.style} by the third: ${result.byVisit[2].clearedByNow}`);
  }
  assert.ok(alley.byVisit[0].clearedThisVisit < friendly.byVisit[0].clearedThisVisit, 'harder than the garden');
});

test('fights in the second place are short too, and a visit is still a few minutes', () => {
  for (const result of [alley, alleyBrawler]) {
    for (const stop of result.stops) {
      assert.ok(stop.rounds >= 1 && stop.rounds <= 7, `${stop.name}: ${stop.rounds} rounds`);
      assert.ok(stop.roundsHigh <= 10, `${stop.name}: a long one is ${stop.roundsHigh} rounds`);
      assert.ok(stop.seconds <= 120, `${stop.name}: about ${stop.seconds}s`);
    }
    assert.ok(result.byVisit[0].minutes >= 2 && result.byVisit[0].minutes <= 8, `first visit: ${result.byVisit[0].minutes} minutes`);
  }
  assert.ok(alley.byVisit[3].friends >= 11, `friends after four visits to the alley: ${alley.byVisit[3].friends}`);
});
