// What a fight tells you in words: a Clutterkin that is not ready to come,
// what the tags over a target mean, and the pages that explain a fight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPECIES, SPECIES_IDS, STRONG, WEAK, REACH } from '../../web/js/core/balance.js';
import { createBattle, act, unitOf } from '../../web/js/core/battle.js';
import { lineFor, notYetOf, toGo } from '../../web/js/ui/text.js';
import { EDGE_WORDS } from '../../web/js/ui/howto.js';

const read = (path) => readFileSync(new URL(`../../web/${path}`, import.meta.url), 'utf8');
const reachable = SPECIES_IDS.filter((id) => SPECIES[id].huff > 0);

test('every kind that can be reached says "not yet" in its own way; a ringleader, which cannot be, has none', () => {
  const ways = reachable.map((id) => SPECIES[id].notYet);
  for (const [i, way] of ways.entries()) {
    assert.equal(typeof way, 'string', reachable[i]);
    // It follows the name and is followed by a full stop: "Thornhog bristles."
    assert.match(way, /^[a-z][a-z ,'-]+[a-z]$/, `${reachable[i]}: "${way}"`);
    assert.ok(way.length <= 28, `${reachable[i]}: "${way}" is ${way.length} letters`);
  }
  assert.equal(new Set(ways).size, ways.length, 'no two alike');
  for (const id of SPECIES_IDS.filter((kind) => !reachable.includes(kind))) assert.equal(SPECIES[id].notYet, undefined, id);
  assert.equal(notYetOf('thornhog'), SPECIES.thornhog.notYet);
  for (const odd of [null, undefined, '', 'nobody', 'boss_hydra', 'constructor']) assert.equal(notYetOf(odd), 'turns away', String(odd));
});

test('the line for a Reach out that was not enough fits on one line of the smallest phone', () => {
  for (const id of reachable) {
    const line = lineFor({ t: 'huff', target: 'f0', huff: 2, by: -2 }, () => SPECIES[id].name, () => id);
    assert.equal(line, `${SPECIES[id].name} ${SPECIES[id].notYet}.`);
    assert.ok(line.length <= 44, `"${line}" is ${line.length} letters`);
  }
  // With nobody to say which kind it is, it still says something.
  assert.equal(lineFor({ t: 'huff', target: 'f0', huff: 1, by: -2 }, () => 'It'), 'It turns away.');
  // Settling has a line of its own; a hit that puts a pip back has its own too.
  assert.equal(lineFor({ t: 'huff', target: 'f0', huff: 0, by: -2 }, () => 'It', () => 'thornhog'), null);
  assert.equal(lineFor({ t: 'huff', target: 'f0', huff: 3, by: 1 }, () => 'It', () => 'thornhog'), 'It is back in a huff.');
  assert.equal(toGo(1), '1 more pip to go.');
  assert.equal(toGo(3), '3 more pips to go.');
});

test('in a real fight, reaching out to one that is not ready is told as a refusal, and to one that is as settling', () => {
  const dice = { rng: 5 };
  const battle = createBattle(dice, { allies: [{ species: 'dustbunny', level: 9 }], foes: [{ species: 'thornhog', level: 1 }] });
  const name = (key) => unitOf(battle, key).name;
  const kind = (key) => unitOf(battle, key).species;
  const said = [];
  for (let reach = 0; reach < 6 && battle.phase === 'fight'; reach++) {
    const from = battle.events.length;
    assert.equal(act(battle, { type: 'call', id: 'reach', target: 'f0' }), true);
    for (const event of battle.events.slice(from)) if (event.t === 'huff' || event.t === 'settle') said.push(lineFor(event, name, kind));
    if (battle.phase === 'fight') act(battle, { type: 'move', id: 'brace' }); // sit tight, so as not to put a pip back
  }
  const refusals = Math.ceil(SPECIES.thornhog.huff / REACH.base) - 1;
  assert.ok(refusals >= 1);
  assert.deepEqual(said, [...Array(refusals).fill(`${SPECIES.thornhog.name} ${SPECIES.thornhog.notYet}.`), null, `${SPECIES.thornhog.name} settles down.`]);
});

test('the tags over a target say what the move will do, in words that cannot be read the other way round', () => {
  assert.deepEqual(EDGE_WORDS, { strong: 'Hurts more', weak: 'Hurts less' });
  const fight = read('js/ui/fight.js');
  assert.ok(fight.includes('EDGE_WORDS.strong') && fight.includes('EDGE_WORDS.weak'), 'the fight screen uses the same words as the explanation');
  assert.equal(/'Strong'|'Weak'/.test(fight), false, 'and no longer says only "Strong" or "Weak"');
  // The explanation gives the numbers from the rules, not numbers of its own.
  const howto = read('js/ui/howto.js');
  assert.ok(howto.includes('share(STRONG)') && howto.includes('share(WEAK)') && howto.includes('REACH.base'));
  assert.equal(Math.round((STRONG - 1) * 100), 50);
  assert.equal(Math.round((1 - WEAK) * 100), 30);
});

test('how a fight works is shown before the first fight only, and can be asked for again', () => {
  const fight = read('js/ui/fight.js');
  assert.match(fight, /if \(game\.state\.seen\.fights\) play\(\);\s+else \{ game\.state\.seen\.fights = true; ctx\.save\(\); howToFight\(play\); \}/);
  assert.match(fight, /id: 'howto', label: 'How a fight works'/);
});
